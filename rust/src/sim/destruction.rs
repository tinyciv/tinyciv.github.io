//! Sparse building-death events. Only these transient ECS entities are visited;
//! living buildings are never polled for visual effects.
use bevy_ecs::prelude::*;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use super::{SimClock, kinds::building};

pub const ANIMATION_SECONDS: f64 = 4.0 / 3.0;
pub const RUBBLE_SECONDS: f64 = 10.0 / 3.0;
const MAX_EFFECTS: usize = 256;
const STRIDE: usize = 6;

#[derive(Component, Clone, Copy)]
pub struct Destruction {
    id: i64, x: f64, y: f64, kind: u32, faction: f64, started: f64,
}

#[derive(Resource)]
pub struct Destructions {
    ordered: VecDeque<Entity>,
    by_id: BTreeMap<i64, Entity>,
    revision: u64,
    published: u64,
    output: Vec<f64>,
}
impl Default for Destructions {
    fn default() -> Self {
        Self { ordered: VecDeque::new(), by_id: BTreeMap::new(), revision: 1,
            published: 0, output: vec![0.0, 0.0] }
    }
}
fn eligible(kind: u32) -> bool {
    kind <= building::GRANARY && !building::route(kind)
        && !matches!(kind, building::IRRIGATION | building::RUIN)
}
impl Destructions {
    fn remove(&mut self, world: &mut World, entity: Entity) {
        if let Some(row) = world.get::<Destruction>(entity) { self.by_id.remove(&row.id); }
        world.despawn(entity);
        self.revision += 1;
    }
    fn push(&mut self, world: &mut World, row: Destruction) {
        if let Some(entity) = self.by_id.get(&row.id).copied() {
            self.ordered.retain(|other| *other != entity);
            self.remove(world, entity);
        }
        if self.ordered.len() == MAX_EFFECTS {
            let oldest = self.ordered.pop_front().unwrap();
            self.remove(world, oldest);
        }
        let entity = world.spawn(row).id();
        self.ordered.push_back(entity); self.by_id.insert(row.id, entity);
        self.revision += 1;
    }
}

pub fn record(world: &mut World, id: i64, x: f64, y: f64, kind: u32, faction: f64, hp: f64) -> bool {
    if !eligible(kind) || !hp.is_finite() || hp > 0.0 || !x.is_finite() || !y.is_finite() || !faction.is_finite() { return false; }
    let started = world.resource::<SimClock>().time;
    world.resource_scope(|world, mut effects: Mut<Destructions>| {
        if effects.by_id.get(&id).and_then(|entity| world.get::<Destruction>(*entity))
            .is_some_and(|row| row.started == started) { return false; }
        effects.push(world, Destruction { id, x, y, kind, faction, started });
        true
    })
}

/// Constant-time until the earliest expiry; no high-frequency entity scans.
pub fn expire(world: &mut World) {
    let now = world.resource::<SimClock>().time;
    world.resource_scope(|world, mut effects: Mut<Destructions>| {
        while let Some(entity) = effects.ordered.front().copied() {
            let row = world.get::<Destruction>(entity).unwrap();
            if now < row.started + ANIMATION_SECONDS + RUBBLE_SECONDS { break; }
            effects.ordered.pop_front(); effects.remove(world, entity);
        }
    });
}

/// A captured palace is transferred instead of leaving a destruction effect.
pub fn cancel(world: &mut World, id: i64) {
    world.resource_scope(|world, mut effects: Mut<Destructions>| {
        if let Some(entity) = effects.by_id.get(&id).copied() {
            effects.ordered.retain(|other| *other != entity);
            effects.remove(world, entity);
        }
    });
}

/// Cached mirror: [revision, count, (id,x,y,kind,faction,started,width,height)*].
/// Frame choice and alpha interpolation are presentation, not ECS mutations.
pub fn view(world: &mut World) -> *const f64 {
    world.resource_scope(|world, mut effects: Mut<Destructions>| {
        if effects.published != effects.revision {
            let mut out = std::mem::take(&mut effects.output);
            out.clear(); out.extend_from_slice(&[effects.revision as f64, effects.ordered.len() as f64]);
            for entity in &effects.ordered {
                let row = world.get::<Destruction>(*entity).unwrap();
                out.extend_from_slice(&[row.id as f64, row.x, row.y, row.kind as f64, row.faction, row.started,
                    building::width(row.kind), building::height(row.kind)]);
            }
            effects.output = out; effects.published = effects.revision;
        }
        effects.output.as_ptr()
    })
}

pub fn snapshot(world: &World) -> Vec<f64> {
    let effects = world.resource::<Destructions>();
    let mut out = Vec::with_capacity(effects.ordered.len() * STRIDE);
    for entity in &effects.ordered {
        let row = world.get::<Destruction>(*entity).unwrap();
        out.extend_from_slice(&[row.id as f64, row.x, row.y, row.kind as f64, row.faction, row.started]);
    }
    out
}
pub fn decode(data: &[f64]) -> Option<Vec<Destruction>> {
    if data.len() % STRIDE != 0 || data.len() / STRIDE > MAX_EFFECTS { return None; }
    let mut ids = BTreeSet::new(); let mut rows = Vec::new();
    for row in data.chunks_exact(STRIDE) {
        if row.iter().any(|value| !value.is_finite()) || row[0] < 0.0 || row[0].fract() != 0.0
            || row[0] > 9_007_199_254_740_991.0 || row[3].fract() != 0.0 || row[3] < 0.0
            || row[3] > building::GRANARY as f64 || !eligible(row[3] as u32) || row[5] < 0.0
            || !ids.insert(row[0] as i64) { return None; }
        rows.push(Destruction { id: row[0] as i64, x: row[1], y: row[2], kind: row[3] as u32, faction: row[4], started: row[5] });
    }
    rows.sort_by(|a, b| a.started.total_cmp(&b.started));
    Some(rows)
}
pub fn restore(world: &mut World, rows: Vec<Destruction>) {
    world.resource_scope(|world, mut effects: Mut<Destructions>| {
        while let Some(entity) = effects.ordered.pop_front() { effects.remove(world, entity); }
        for row in rows { effects.push(world, row); }
    });
    expire(world);
}
