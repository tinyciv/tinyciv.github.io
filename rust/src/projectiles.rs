//! Persistent projectile flight and ordered impact decisions. Flight advances
//! in bounded contiguous batches. The host publishes an impact before importing
//! the next batch's target observations, preserving death/capture interleaving.
use bevy_ecs::prelude::*;
use bevy_ecs::schedule::SingleThreadedExecutor;
use std::collections::{BTreeMap, BTreeSet};
use crate::combat;
use crate::terrain_rays::MountainTerrain;

pub const INPUT_STRIDE: usize = 16;
pub const OUTPUT_STRIDE: usize = 6;
const EXISTS: u32 = 1;
const BUILDING: u32 = 2;
const HOSTILE: u32 = 4;
const HUNTABLE: u32 = 8;
const OBSERVABLE: u32 = 16;
const PROTECTED: u32 = 32;
const ROUTE: u32 = 64;
const CANNONBALL: u32 = 5;

#[derive(Component)]
struct Flight {
    start_x: f64, start_y: f64, x: f64, y: f64, end_x: f64, end_y: f64,
    elapsed: f64, duration: f64, damage: f64, faction: f64, kind: u32,
    tower_arrow: bool, status: u32,
    shell_landing: Option<(f64, f64, bool)>,
}

#[derive(Component, Default)]
struct Observation { x: f64, y: f64, facts: u32 }

#[derive(Resource, Default)]
struct Rows(Vec<Entity>);

#[derive(Resource, Default)]
struct Step { start: usize, end: usize, dt: f64 }

fn minimum(a: f64, b: f64) -> f64 { if a.is_nan() || b.is_nan() { f64::NAN } else { a.min(b) } }
fn maximum(a: f64, b: f64) -> f64 { if a.is_nan() || b.is_nan() { f64::NAN } else { a.max(b) } }

pub fn duration(start_x: f64, start_y: f64, end_x: f64, end_y: f64) -> f64 {
    maximum(0.12, (end_x - start_x).hypot(end_y - start_y) / 12.0)
}

pub fn duration_for_kind(start_x: f64, start_y: f64, end_x: f64, end_y: f64, kind: u32) -> f64 {
    if kind == 4 { maximum(0.04, (end_x - start_x).hypot(end_y - start_y) / 40.0) }
    else { duration(start_x, start_y, end_x, end_y) }
}

impl Flight {
    fn line_mode(&self) -> u32 {
        if (self.kind == 1 || self.kind == 2) && !self.tower_arrow || matches!(self.kind, 3 | 4 | CANNONBALL) { 2 } else { 1 }
    }
    fn potential_impact(&self, dt: f64) -> u32 {
        if minimum(1.0, (self.elapsed + dt) / self.duration) < 1.0 { 0 } else { self.line_mode() }
    }
}

fn advance_flights(rows: Res<Rows>, step: Res<Step>, terrain: Res<MountainTerrain>, mut flights: Query<(&mut Flight, &Observation)>) {
    // Explicit row order, rather than archetype order, controls impact order.
    // Only this contiguous range is visited, so N simultaneous impacts do not
    // repeatedly scan all N projectiles.
    for entity in &rows.0[step.start..step.end] {
        let (mut flight, target) = flights.get_mut(*entity).expect("projectile row");
        flight.shell_landing = None;
        let building = target.facts & BUILDING != 0;
        if target.facts & EXISTS == 0
            || !(target.facts & HOSTILE != 0 || !building && target.facts & HUNTABLE != 0 && flight.faction >= 0.0)
            || !building && target.facts & OBSERVABLE == 0
            || building && (target.facts & PROTECTED != 0 || flight.kind == CANNONBALL && target.facts & ROUTE != 0) {
            flight.status = 0;
            continue;
        }
        flight.end_x = target.x; flight.end_y = target.y;
        flight.elapsed += step.dt;
        let progress = minimum(1.0, flight.elapsed / flight.duration);
        let next_x = flight.start_x + (target.x - flight.start_x) * progress;
        let next_y = flight.start_y + (target.y - flight.start_y) * progress;
        // Sweep the complete traveled segment: a fast bullet or a large dt
        // must not tunnel through even one mountain cell. Arcing projectiles
        // and tower shots obey the same solid-mountain rule as straight shots.
        if let Some(entry) = terrain.0.first_blocked(flight.x, flight.y, next_x, next_y, false) {
            flight.x += (next_x - flight.x) * entry;
            flight.y += (next_y - flight.y) * entry;
            if flight.kind == CANNONBALL {
                flight.shell_landing = Some((flight.x, flight.y, false));
                flight.status = 4;
            } else { flight.status = 0; }
            continue;
        }
        flight.x = next_x; flight.y = next_y;
        flight.status = if progress < 1.0 { 1 } else { flight.line_mode() + 1 };
        if flight.kind == CANNONBALL && progress >= 1.0 { flight.shell_landing = Some((flight.end_x, flight.end_y, true)); }
    }
}

pub struct ProjectileEngine {
    world: World,
    schedule: Schedule,
    entities: BTreeMap<i64, Entity>,
    roster: Vec<i64>,
    input: Vec<f64>,
    output: Vec<f64>,
    plan: Vec<f64>,
    event: [f64; 3],
    count: usize,
}

impl Default for ProjectileEngine {
    fn default() -> Self {
        let mut world = World::new();
        world.init_resource::<Rows>(); world.init_resource::<Step>(); world.init_resource::<MountainTerrain>();
        let mut schedule = Schedule::default();
        schedule.set_executor(SingleThreadedExecutor::new());
        schedule.add_systems(advance_flights);
        Self { world, schedule, entities: BTreeMap::new(), roster: Vec::new(), input: Vec::new(),
            output: Vec::new(), plan: Vec::new(), event: [0.0; 3], count: 0 }
    }
}

impl ProjectileEngine {
    pub fn set_terrain(&mut self, terrain: MountainTerrain) {
        if !std::sync::Arc::ptr_eq(&self.world.resource::<MountainTerrain>().0, &terrain.0) {
            self.world.insert_resource(terrain);
        }
    }

    /// Input rows: [local ID,startX,startY,elapsed,duration,damage,kind,
    /// towerArrow,faction,x,y,endX,endY,targetX,targetY,targetFacts].
    /// IDs remain private runtime identities, absent from serialized views.
    pub fn prepare(&mut self, capacity: usize) -> *mut f64 {
        if self.input.len() < capacity * INPUT_STRIDE {
            self.input.resize(capacity * INPUT_STRIDE, 0.0);
            self.output.resize(capacity * OUTPUT_STRIDE, 0.0);
            self.plan.resize(capacity, 0.0);
        }
        self.input.as_mut_ptr()
    }

    /// Publish a launch (or an explicit restored flight) once. Ordinary ticks
    /// retain Flight in Bevy and import only target observations.
    pub fn publish(&mut self, row: usize) {
        let values = &self.input[row * INPUT_STRIDE..];
        let id = values[0] as i64;
        let flight = Flight { start_x: values[1], start_y: values[2], elapsed: values[3], duration: values[4],
            damage: values[5], kind: values[6] as u32, tower_arrow: values[7] != 0.0, faction: values[8],
            x: values[9], y: values[10], end_x: values[11], end_y: values[12], status: 0, shell_landing: None };
        let entity = *self.entities.entry(id).or_insert_with(|| self.world.spawn_empty().id());
        self.world.entity_mut(entity).insert((flight, Observation::default()));
    }

    /// Retain existing Bevy entities while importing presentation/save views.
    /// The plan only predicts timing, never snapshots target eligibility. Every
    /// actual impact is resolved after earlier domain callbacks are published.
    #[cfg(test)]
    pub fn begin(&mut self, count: usize, dt: f64) -> *const f64 {
        for row in 0..count { self.publish(row); }
        self.begin_resident(count, dt, true)
    }

    pub fn begin_resident(&mut self, count: usize, dt: f64, changed: bool) -> *const f64 {
        assert!(count * INPUT_STRIDE <= self.input.len(), "projectile batch exceeds capacity");
        self.count = count;
        if changed {
            let ids: BTreeSet<i64> = (0..count).map(|row| self.input[row * INPUT_STRIDE] as i64).collect();
            assert_eq!(ids.len(), count, "duplicate projectile ID");
            let world = &mut self.world;
            self.entities.retain(|id, entity| {
                if ids.contains(id) { true } else { world.despawn(*entity); false }
            });
            self.roster.clear();
            let mut rows = world.resource_mut::<Rows>(); rows.0.clear();
            // Drop the resource borrow before spawning into the same world.
            drop(rows);
            for row in 0..count {
                let id = self.input[row * INPUT_STRIDE] as i64;
                let entity = self.entities[&id];
                self.roster.push(id); world.resource_mut::<Rows>().0.push(entity);
            }
        }
        for row in 0..count {
            let entity = self.world.resource::<Rows>().0[row];
            self.plan[row] = self.world.get::<Flight>(entity).expect("resident flight").potential_impact(dt) as f64;
        }
        *self.world.resource_mut::<Step>() = Step { start: 0, end: 0, dt };
        self.plan.as_ptr()
    }

    /// Output per row: [0 discard/1 flying/2 pending arc/3 pending straight/4 shell terrain contact,
    /// x,y,endX,endY,elapsed]. A pending row must receive one impact() call.
    pub fn advance(&mut self, start: usize, count: usize) -> *const f64 {
        let end = start.checked_add(count).expect("projectile range overflow");
        assert!(end <= self.count, "projectile range exceeds roster");
        for row in start..end {
            let values = &self.input[row * INPUT_STRIDE..];
            let entity = self.world.resource::<Rows>().0[row];
            *self.world.get_mut::<Observation>(entity).expect("projectile observation") = Observation {
                x: values[13], y: values[14], facts: values[15] as u32,
            };
        }
        { let mut step = self.world.resource_mut::<Step>(); step.start = start; step.end = end; }
        self.schedule.run(&mut self.world);
        for row in start..end {
            let entity = self.world.resource::<Rows>().0[row];
            let flight = self.world.get::<Flight>(entity).expect("advanced projectile");
            let index = row * OUTPUT_STRIDE;
            self.output[index..index + OUTPUT_STRIDE].copy_from_slice(&[
                flight.status as f64, flight.x, flight.y, flight.end_x, flight.end_y, flight.elapsed,
            ]);
        }
        self.output.as_ptr()
    }

    /// [0 blocked/1 hit/2 death, previousHP,nextHP]. Target HP and formation
    /// defense are sampled at this actual impact, after all preceding impacts.
    pub fn impact(&mut self, row: usize, clear: bool, hp: f64, kills: f64, infantry_multiplier: f64) -> *const f64 {
        assert!(row < self.count, "projectile impact exceeds roster");
        let entity = self.world.resource::<Rows>().0[row];
        let facts = self.world.get::<Observation>(entity).expect("impact observation").facts;
        let mut flight = self.world.get_mut::<Flight>(entity).expect("impact projectile");
        let pending = flight.status == 2 || flight.status == 3;
        flight.status = 0;
        self.event = if !pending || !clear || hp <= 0.0 {
            [0.0, hp, hp]
        } else {
            let damage = if facts & BUILDING != 0 {
                flight.damage
            } else {
                let multiplier = if flight.kind == CANNONBALL { combat::CANNON_UNIT_DAMAGE_MULTIPLIER } else { 1.0 };
                combat::incoming_damage(kills, flight.damage * multiplier) / infantry_multiplier
            };
            let next_hp = maximum(0.0, hp - damage);
            [if next_hp <= 0.0 { 2.0 } else { 1.0 }, hp, next_hp]
        };
        self.event.as_ptr()
    }
    /// Consume one canonical landing after impact resolution, or an explicit
    /// terrain terminal. Early eligibility cancellations never produce one.
    pub fn take_shell_landing(&mut self, row: usize) -> Option<(f64, f64, bool)> {
        if row >= self.count { return None; }
        let entity = self.world.resource::<Rows>().0[row];
        let mut flight = self.world.get_mut::<Flight>(entity)?;
        if matches!(flight.status, 2 | 3) { return None; }
        flight.shell_landing.take()
    }
}

#[derive(Default)]
pub struct Engines { next_handle: u32, engines: BTreeMap<u32, ProjectileEngine> }
impl Engines {
    pub fn create(&mut self) -> u32 {
        self.next_handle = self.next_handle.checked_add(1).expect("projectile handle overflow");
        self.engines.insert(self.next_handle, ProjectileEngine::default()); self.next_handle
    }
    pub fn drop_engine(&mut self, handle: u32) { self.engines.remove(&handle); }
    pub fn get_mut(&mut self, handle: u32) -> &mut ProjectileEngine { self.engines.get_mut(&handle).expect("unknown projectile engine") }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shot(id: f64, kind: f64, duration: f64) -> [f64; INPUT_STRIDE] {
        [id, 0.0, 0.0, 0.0, duration, 20.0, kind, 0.0, 0.0, 0.0, 0.0, 10.0, 0.0, 10.0, 0.0,
            (EXISTS | HOSTILE | OBSERVABLE) as f64]
    }
    fn import(engine: &mut ProjectileEngine, rows: &[[f64; INPUT_STRIDE]], dt: f64) {
        engine.prepare(rows.len());
        for (row, values) in rows.iter().enumerate() {
            engine.input[row * INPUT_STRIDE..(row + 1) * INPUT_STRIDE].copy_from_slice(values);
        }
        engine.begin(rows.len(), dt);
        // Observations are deliberately supplied only after begin().
        for (row, values) in rows.iter().enumerate() {
            engine.input[row * INPUT_STRIDE + 13..(row + 1) * INPUT_STRIDE].copy_from_slice(&values[13..]);
        }
    }
    fn project(engine: &ProjectileEngine, row: &mut [f64; INPUT_STRIDE], index: usize) {
        let result = &engine.output[index * OUTPUT_STRIDE..];
        row[9] = result[1]; row[10] = result[2]; row[11] = result[3]; row[12] = result[4]; row[3] = result[5];
    }

    #[test]
    fn fractional_flight_tracks_a_moving_target_without_restarting_its_clock() {
        let mut engine = ProjectileEngine::default(); let mut row = shot(1.0, 0.0, 0.125);
        import(&mut engine, &[row], 0.05); assert_eq!(engine.plan[0], 0.0);
        engine.advance(0, 1); assert_eq!(engine.output[..6], [1.0, 4.0, 0.0, 10.0, 0.0, 0.05]);
        project(&engine, &mut row, 0); row[13] = 20.0;
        import(&mut engine, &[row], 0.05); engine.advance(0, 1);
        assert_eq!(engine.output[..6], [1.0, 16.0, 0.0, 20.0, 0.0, 0.1]);
        project(&engine, &mut row, 0);
        import(&mut engine, &[row], 0.025); assert_eq!(engine.plan[0], 1.0);
        engine.advance(0, 1); assert_eq!(engine.output[..5], [2.0, 20.0, 0.0, 20.0, 0.0]);
    }

    #[test]
    fn projectile_variants_choose_their_existing_wall_clearance_rules() {
        for (kind, tower, mode) in [(0.0, 0.0, 1.0), (1.0, 0.0, 2.0), (2.0, 0.0, 2.0), (3.0, 0.0, 2.0), (1.0, 1.0, 1.0)] {
            let mut engine = ProjectileEngine::default(); let mut row = shot(1.0, kind, 0.01); row[7] = tower;
            import(&mut engine, &[row], 0.02); assert_eq!(engine.plan[0], mode);
            engine.advance(0, 1); assert_eq!(engine.output[0], mode + 1.0);
            engine.impact(0, false, 100.0, 0.0, 1.0); assert_eq!(engine.event, [0.0, 100.0, 100.0]);
            engine.impact(0, true, 100.0, 0.0, 1.0); assert_eq!(engine.event[0], 0.0);
        }
    }

    #[test]
    fn cancels_missing_peaceful_hidden_and_protected_targets_before_advancing() {
        for facts in [0, EXISTS | OBSERVABLE, EXISTS | HOSTILE, EXISTS | HOSTILE | BUILDING | PROTECTED] {
            let mut engine = ProjectileEngine::default(); let mut row = shot(1.0, 0.0, 0.01); row[15] = facts as f64;
            import(&mut engine, &[row], 0.02); engine.advance(0, 1);
            assert_eq!(engine.output[0], 0.0); assert_eq!(engine.output[5], 0.0);
        }
        for (faction, expected) in [(0.0, 2.0), (-2.0, 0.0)] {
            let mut engine = ProjectileEngine::default(); let mut row = shot(1.0, 0.0, 0.01);
            row[8] = faction; row[15] = (EXISTS | HUNTABLE | OBSERVABLE) as f64;
            import(&mut engine, &[row], 0.02); engine.advance(0, 1); assert_eq!(engine.output[0], expected);
        }
    }

    #[test]
    fn publishes_impacts_in_original_order_and_accepts_updated_target_facts_between_them() {
        let mut engine = ProjectileEngine::default();
        import(&mut engine, &[shot(9.0, 0.0, 0.01), shot(2.0, 0.0, 0.01)], 0.02);
        let first = engine.entities[&9];
        engine.advance(0, 1); engine.impact(0, true, 10.0, 0.0, 1.0);
        assert_eq!(engine.event, [2.0, 10.0, 0.0]);
        // The first death/capture removes eligibility before the second row.
        engine.input[INPUT_STRIDE + 15] = 0.0;
        engine.advance(1, 1); assert_eq!(engine.output[OUTPUT_STRIDE], 0.0);
        import(&mut engine, &[shot(9.0, 0.0, 1.0)], 0.02);
        assert_eq!(engine.entities[&9], first); assert!(!engine.entities.contains_key(&2));
        import(&mut engine, &[], 0.02); assert!(engine.entities.is_empty());
    }

    #[test]
    fn actual_impact_applies_elite_and_formation_defense_but_buildings_keep_raw_damage() {
        let mut engine = ProjectileEngine::default(); let mut row = shot(1.0, 0.0, 0.01); row[5] = 100.0;
        import(&mut engine, &[row], 0.02); engine.advance(0, 1); engine.impact(0, true, 100.0, 500.0, 2.0);
        assert_eq!(engine.event, [1.0, 100.0, 92.5]);
        row[6] = CANNONBALL as f64;
        import(&mut engine, &[row], 0.02); engine.advance(0, 1); engine.impact(0, true, 100.0, 500.0, 2.0);
        assert_eq!(engine.event, [1.0, 100.0, 96.25]);
        row[15] = (EXISTS | HOSTILE | BUILDING) as f64;
        import(&mut engine, &[row], 0.02); engine.advance(0, 1); engine.impact(0, true, 100.0, 500.0, 2.0);
        assert_eq!(engine.event, [2.0, 100.0, 0.0]);
    }

    #[test]
    fn cannonballs_cannot_damage_a_directly_ordered_road_target() {
        let mut engine = ProjectileEngine::default();
        let mut row = shot(1.0, 5.0, 0.01);
        row[15] = (EXISTS | HOSTILE | BUILDING | ROUTE) as f64;
        import(&mut engine, &[row], 0.02); engine.advance(0, 1);
        assert_eq!(engine.output[0], 0.0);
        engine.impact(0, true, 100.0, 0.0, 1.0);
        assert_eq!(engine.event, [0.0, 100.0, 100.0]);
    }

    #[test]
    fn launch_duration_has_the_same_minimum_and_distance_speed() {
        assert_eq!(duration(0.0, 0.0, 0.0, 0.0), 0.12);
        assert_eq!(duration(0.0, 0.0, 3.0, 4.0), 5.0 / 12.0);
        assert_eq!(duration(0.0, 0.0, 12.0, 0.0), 1.0);
    }
}
