//! Automatic road surfacing. Local spatial buckets and a deterministic bounded
//! queue keep housing edits out of movement probes and frame-wide scans.
use bevy_ecs::prelude::*;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use super::{entities::EntityTables, kinds::building::{HOUSE, ROAD}};

const RADIUS: f64 = 10.0;
const BUDGET: usize = 256;
const READY: u32 = 3; // alive and completed
pub const DIRT_SPEED: f64 = 1.5;
pub const PAVED_SPEED: f64 = DIRT_SPEED * 1.25;
#[derive(Component, Clone, Copy, PartialEq)]
struct Site { entity: Entity, id: i64, kind: u32, faction: i32, x: f64, y: f64, flags: u32, tier: u8 }
impl Site {
    fn ready(self) -> bool { self.flags & READY == READY }
    fn bucket(self) -> (i32, i32, i32) { (self.faction, (self.x / RADIUS).floor() as i32, (self.y / RADIUS).floor() as i32) }
}
#[derive(Resource, Default)]
pub struct PavedRoads {
    sites: BTreeMap<i64, Site>,
    houses: BTreeMap<(i32, i32, i32), BTreeSet<i64>>,
    roads: BTreeMap<(i32, i32, i32), BTreeSet<i64>>,
    faction_roads: BTreeMap<i32, BTreeSet<i64>>,
    unlocked: BTreeSet<i32>, paved: BTreeSet<i64>,
    queued: BTreeSet<i64>, queue: VecDeque<i64>,
    output: Vec<f64>, last: Option<f64>,
}
impl PavedRoads {
    fn enqueue(&mut self, id: i64) { if self.queued.insert(id) { self.queue.push_back(id); } }
    fn near(&self, site: Site, houses: bool) -> Vec<i64> {
        let (f, bx, by) = site.bucket();
        let buckets = if houses { &self.houses } else { &self.roads };
        let mut ids = Vec::new();
        for y in by - 1..=by + 1 { for x in bx - 1..=bx + 1 {
            if let Some(bucket) = buckets.get(&(f, x, y)) {
                for id in bucket { if let Some(other) = self.sites.get(id) {
                    if (other.x - site.x).powi(2) + (other.y - site.y).powi(2) <= RADIUS * RADIUS { ids.push(*id); }
                } }
            }
        } }
        ids
    }
    fn detach(&mut self, site: Site) {
        if site.kind == HOUSE {
            for id in self.near(site, false) { self.enqueue(id); }
            if let Some(bucket) = self.houses.get_mut(&site.bucket()) { bucket.remove(&site.id); }
        } else {
            if let Some(bucket) = self.roads.get_mut(&site.bucket()) { bucket.remove(&site.id); }
            if let Some(ids) = self.faction_roads.get_mut(&site.faction) { ids.remove(&site.id); }
        }
    }
    pub fn faction(&mut self, faction: i32, unlocked: bool) {
        let changed = if unlocked { self.unlocked.insert(faction) } else { self.unlocked.remove(&faction) };
        if changed {
            let ids: Vec<_> = self.faction_roads.get(&faction).into_iter().flatten().copied().collect();
            for id in ids { self.enqueue(id); }
        }
    }
    pub fn update(&mut self, now: f64) -> usize {
        self.output.clear();
        if self.last.is_some_and(|last| now >= last && now + 1e-7 < last + 1.0) { return 0; }
        self.last = Some(now);
        for _ in 0..BUDGET {
            let Some(id) = self.queue.pop_front() else { break; };
            self.queued.remove(&id);
            let Some(road) = self.sites.get(&id).copied().filter(|s| s.kind == ROAD) else { continue; };
            let eligible = if road.ready() && self.unlocked.contains(&road.faction) {
                let houses = self.near(road, true);
                let highest = houses.iter().filter(|id| self.sites[id].tier == 4).count();
                // Both middle values must be level 4 for an even population.
                // An empty neighborhood never qualifies.
                highest * 2 > houses.len()
            } else { false };
            let changed = if eligible { self.paved.insert(id) } else { self.paved.remove(&id) };
            if changed { self.output.extend_from_slice(&[id as f64, eligible as u8 as f64]); }
        }
        self.output.len() / 2
    }
    pub fn output(&self) -> *const f64 { self.output.as_ptr() }
}
pub fn clear(world: &mut World) {
    world.resource_scope(|world, mut roads: Mut<PavedRoads>| {
        for site in roads.sites.values() { if let Ok(mut e) = world.get_entity_mut(site.entity) { e.remove::<Site>(); } }
        *roads = PavedRoads::default();
    });
}
pub fn remove(world: &mut World, id: i64) {
    world.resource_scope(|world, mut roads: Mut<PavedRoads>| {
        if let Some(site) = roads.sites.remove(&id) {
            roads.detach(site); roads.paved.remove(&id);
            if let Ok(mut e) = world.get_entity_mut(site.entity) { e.remove::<Site>(); }
        }
    });
}
pub fn upsert(world: &mut World, id: i64, kind: u32, faction: i32, x: f64, y: f64, flags: u32, tier: f64) {
    if !matches!(kind, HOUSE | ROAD) || !x.is_finite() || !y.is_finite() { remove(world, id); return; }
    let Some((entity, _)) = world.resource::<EntityTables>().buildings.locate(id) else { return; };
    let tier = if tier.is_finite() { tier.floor().clamp(1.0, 4.0) as u8 } else { 1 };
    let site = Site { entity, id, kind, faction, x, y, flags, tier };
    if world.resource::<PavedRoads>().sites.get(&id) == Some(&site) { return; }
    world.entity_mut(entity).insert(site);
    let mut roads = world.resource_mut::<PavedRoads>();
    if let Some(old) = roads.sites.get(&id).copied() { roads.detach(old); }
    roads.sites.insert(id, site);
    if kind == HOUSE {
        if site.ready() { roads.houses.entry(site.bucket()).or_default().insert(id); }
        for road in roads.near(site, false) { roads.enqueue(road); }
    } else {
        roads.roads.entry(site.bucket()).or_default().insert(id);
        roads.faction_roads.entry(faction).or_default().insert(id);
        roads.enqueue(id);
    }
}
