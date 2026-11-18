//! City grain collection points. Only town/granary lifecycle changes dirty the
//! network; harvests use a maintained tile index and never scan buildings.
use bevy_ecs::prelude::*;
use std::collections::BTreeMap;
use rustc_hash::FxHashMap;

use super::entities::{assign_worker_slot_storage, EntityTables};
use super::kinds::building::{self, GRANARY, PALACE};

pub const GOLD: f64 = 200.0;
pub const UPKEEP: f64 = 3.0;
pub const HP: f64 = 300.0;
pub const RADIUS: f64 = 6.0;
pub const YIELD_MULTIPLIER: f64 = 1.25;
pub const COLLECTION_RADIUS: f64 = 25.0;
pub const ALIVE: u32 = 1;
pub const READY: u32 = 2;
pub const REASSIGN: u32 = 1;
pub const ENTER: u32 = 2;

pub fn constant(index: u32) -> f64 {
    match index { 0 => GOLD, 1 => UPKEEP, 2 => HP, 3 => RADIUS, 4 => YIELD_MULTIPLIER,
        5 => COLLECTION_RADIUS, _ => f64::NAN }
}

#[derive(Component, Clone, Copy, Debug, PartialEq)]
struct StorageSite { entity: Entity, id: i64, kind: u32, faction: i32, x: f64, y: f64, flags: u32 }
impl StorageSite {
    fn center(self) -> (f64, f64) { (self.x + building::width(self.kind) / 2.0, self.y + building::height(self.kind) / 2.0) }
    fn ready(self) -> bool { self.flags & (ALIVE | READY) == (ALIVE | READY) }
}

/// The host saves these two values on the courier view, so loading imports the
/// same assignment before the next staffing command. Residents still belong to
/// their town; the storage building is only their departure/delivery point.
#[derive(Component, Clone, Copy, Debug)]
pub struct FarmStorageAssignment { pub city: i64, pub storage: i64 }

#[derive(Resource, Default)]
pub struct Granaries {
    sites: BTreeMap<i64, StorageSite>, dirty: bool,
    owners: BTreeMap<i64, i64>, reserved: BTreeMap<i64, usize>, active: BTreeMap<i64, i64>,
    coverage: FxHashMap<(i32, i32, i32), u16>,
    output: [f64; 4],
}

impl Granaries {
    fn nearest_city(&self, faction: i32, x: f64, y: f64) -> Option<i64> {
        self.sites.values().filter(|site| site.kind == PALACE && site.faction == faction && site.ready())
            .map(|site| { let (cx, cy) = site.center(); (site.id, (x - cx).powi(2) + (y - cy).powi(2)) })
            .min_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0))).map(|entry| entry.0)
    }
    fn refresh(&mut self) {
        if !self.dirty { return; }
        self.owners.clear(); self.reserved.clear(); self.active.clear(); self.coverage.clear();
        for site in self.sites.values().filter(|site| site.kind == GRANARY && site.flags & ALIVE != 0) {
            let (cx, cy) = site.center();
            let Some(city) = self.nearest_city(site.faction, cx, cy) else { continue; };
            self.owners.insert(site.id, city);
            *self.reserved.entry(city).or_default() += 1;
            // Captures/new towns can join formerly separate cities. Only the
            // oldest completed granary operates if their assignments converge.
            if site.ready() { self.active.entry(city).or_insert(site.id); }
        }
        for &id in self.active.values() {
            let site = self.sites[&id]; let (cx, cy) = site.center();
            for y in (cy - 0.5 - RADIUS).ceil() as i32..=(cy - 0.5 + RADIUS).floor() as i32 {
                for x in (cx - 0.5 - RADIUS).ceil() as i32..=(cx - 0.5 + RADIUS).floor() as i32 {
                    if x >= 0 && y >= 0 && (x as f64 + 0.5 - cx).powi(2) + (y as f64 + 0.5 - cy).powi(2) <= RADIUS * RADIUS + 1e-9 {
                        *self.coverage.entry((site.faction, x, y)).or_default() += 1;
                    }
                }
            }
        }
        self.dirty = false;
    }
    /// 0 allowed, 1 no completed city, 2 a completed or ordered granary already
    /// reserves that city. Coordinates are the proposed footprint's top-left.
    pub fn placement(&mut self, faction: i32, x: f64, y: f64) -> u32 {
        self.refresh();
        let Some(city) = self.nearest_city(faction, x + 1.0, y + 1.0) else { return 1; };
        if self.reserved.contains_key(&city) { 2 } else { 0 }
    }
    pub fn owner(&mut self, id: i64) -> f64 { self.refresh(); self.owners.get(&id).map_or(f64::NAN, |id| *id as f64) }
    pub fn for_city(&mut self, city: i64) -> f64 { self.refresh(); self.active.get(&city).map_or(f64::NAN, |id| *id as f64) }
    pub fn yield_multiplier(&mut self, faction: i32, x: i32, y: i32) -> f64 {
        self.refresh();
        if self.coverage.contains_key(&(faction, x, y)) { YIELD_MULTIPLIER } else { 1.0 }
    }
    /// Terrain-weighted route costs are observations from the shared native
    /// navigation fields. Only a reachable, shorter route selects the granary.
    pub fn select_storage(&mut self, city: i64, town_cost: f64, granary_cost: f64) -> f64 {
        self.refresh();
        if granary_cost.is_finite() && (!town_cost.is_finite() || granary_cost < town_cost) {
            if let Some(id) = self.active.get(&city) { return *id as f64; }
        }
        city as f64
    }
    fn valid_storage(&self, city: i64, storage: i64) -> bool {
        self.sites.get(&city).is_some_and(|site| site.kind == PALACE && site.ready())
            && (storage == city || self.active.get(&city) == Some(&storage))
    }
    fn assignment(&mut self, city: i64, storage: i64, previous: f64, inside: bool) -> (i64, u32) {
        self.refresh();
        let storage = if self.valid_storage(city, storage) { storage } else { city };
        let flags = if previous == storage as f64 { 0 } else { REASSIGN | if inside { ENTER } else { 0 } };
        self.output = [storage as f64, flags as f64, 0.0, 0.0];
        (storage, flags)
    }
    pub fn deposit(&mut self, city: i64, storage: i64, faction: i32, amount: f64) -> f64 {
        self.refresh();
        if !amount.is_finite() || !self.valid_storage(city, storage)
            || self.sites.get(&city).is_none_or(|site| site.faction != faction) { return 0.0; }
        amount.max(0.0)
    }
    pub fn in_range(&mut self, city: i64, x: f64, y: f64) -> bool {
        self.refresh();
        let Some(town) = self.sites.get(&city).filter(|site| site.kind == PALACE && site.ready()) else { return false; };
        let (cx, cy) = town.center(); let distance = (x + 0.5 - cx).hypot(y + 0.5 - cy);
        if distance < 2.0 { return false; }
        if distance <= COLLECTION_RADIUS { return true; }
        self.active.get(&city).and_then(|id| self.sites.get(id)).is_some_and(|site| {
            let (gx, gy) = site.center(); (x + 0.5 - gx).hypot(y + 0.5 - gy) <= COLLECTION_RADIUS
        })
    }
    pub fn bounds(&mut self, city: i64, width: i32, height: i32) -> *const f64 {
        self.refresh();
        let Some(town) = self.sites.get(&city) else { self.output = [0.0, -1.0, 0.0, -1.0]; return self.output.as_ptr(); };
        let (cx, cy) = town.center();
        let (gx, gy) = self.active.get(&city).and_then(|id| self.sites.get(id)).map_or((cx, cy), |site| site.center());
        self.output = [(cx.min(gx) - COLLECTION_RADIUS).floor().max(0.0),
            (cx.max(gx) + COLLECTION_RADIUS).ceil().min((width - 1) as f64),
            (cy.min(gy) - COLLECTION_RADIUS).floor().max(0.0),
            (cy.max(gy) + COLLECTION_RADIUS).ceil().min((height - 1) as f64)];
        self.output.as_ptr()
    }
}

pub fn clear(world: &mut World) {
    world.resource_scope(|world, mut network: Mut<Granaries>| {
        for site in network.sites.values() { if let Ok(mut entity) = world.get_entity_mut(site.entity) { entity.remove::<StorageSite>(); } }
        *network = Granaries::default();
    });
}
pub fn remove(world: &mut World, id: i64) {
    world.resource_scope(|world, mut network: Mut<Granaries>| {
        if let Some(site) = network.sites.remove(&id) {
            if let Ok(mut entity) = world.get_entity_mut(site.entity) { entity.remove::<StorageSite>(); }
            network.dirty = true;
        }
    });
}
pub fn upsert(world: &mut World, id: i64, kind: u32, faction: i32, x: f64, y: f64, flags: u32) {
    if !matches!(kind, PALACE | GRANARY) { remove(world, id); return; }
    let Some((entity, _)) = world.resource::<EntityTables>().buildings.locate(id) else { return; };
    let site = StorageSite { entity, id, kind, faction, x, y, flags };
    if world.resource::<Granaries>().sites.get(&id) == Some(&site) { return; }
    world.entity_mut(entity).insert(site);
    let mut network = world.resource_mut::<Granaries>(); network.sites.insert(id, site); network.dirty = true;
}
pub fn assign(world: &mut World, unit: i64, city: i64, storage: i64, previous: f64, inside: bool) -> *const f64 {
    world.resource_scope(|world, mut network: Mut<Granaries>| {
        let (storage, _) = network.assignment(city, storage, previous, inside);
        let assignment = FarmStorageAssignment { city, storage };
        if let Some((entity, _)) = world.resource::<EntityTables>().units.locate(unit) {
            world.entity_mut(entity).insert(assignment);
        } else {
            assign_worker_slot_storage(world, unit, assignment);
        }
        network.output.as_ptr()
    })
}

pub fn deposit(world: &mut World, unit: i64, city: i64, storage: i64, faction: i32, amount: f64) -> f64 {
    let assignment = world.resource::<EntityTables>().units.locate(unit)
        .and_then(|(entity, _)| world.get::<FarmStorageAssignment>(entity));
    if assignment.is_none_or(|assigned| assigned.city != city || assigned.storage != storage) { return 0.0; }
    world.resource_mut::<Granaries>().deposit(city, storage, faction, amount)
}
