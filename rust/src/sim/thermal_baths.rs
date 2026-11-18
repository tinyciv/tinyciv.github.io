//! Thermal baths reserve one complete mud pool and improve houses belonging to
//! their nearest friendly town. Rebuild assignments only on site lifecycle edits.
use bevy_ecs::prelude::*;
use std::collections::{BTreeMap, BTreeSet};
use super::entities::EntityTables;
use super::kinds::building::{self, HOUSE, APARTMENTS, PALACE, THERMAL_BATH};

pub const GOLD: f64 = 300.0;
pub const UPKEEP: f64 = 3.0;
pub const HP: f64 = 400.0;
pub const HOUSING_MULTIPLIER: f64 = 1.3;
const ALIVE: u32 = 1;
const READY: u32 = 2;

pub fn constant(index: u32) -> f64 {
    match index { 0 => GOLD, 1 => UPKEEP, 2 => HP, 3 => HOUSING_MULTIPLIER, _ => f64::NAN }
}

#[derive(Component, Clone, Copy, PartialEq)]
struct BathSite { entity: Entity, id: i64, kind: u32, faction: i32, x: f64, y: f64, flags: u32 }
impl BathSite {
    fn ready(self) -> bool { self.flags & (ALIVE | READY) == (ALIVE | READY) }
    fn center(self) -> (f64, f64) { (self.x + building::width(self.kind) / 2.0, self.y + building::height(self.kind) / 2.0) }
}

#[derive(Resource, Default)]
pub struct ThermalBaths {
    sites: BTreeMap<i64, BathSite>, dirty: bool,
    towns: BTreeSet<i64>, baths: BTreeSet<i64>, houses: BTreeSet<i64>,
    owners: BTreeMap<i64, i64>, boosted_cities: BTreeSet<i64>,
    house_cities: BTreeMap<i64, i64>,
    input: [f64; 8],
}
impl ThermalBaths {
    pub fn input(&mut self) -> *mut f64 { self.input.as_mut_ptr() }
    fn nearest_city(&self, faction: i32, x: f64, y: f64) -> Option<i64> {
        self.towns.iter().filter_map(|id| self.sites.get(id)).filter(|s| s.faction == faction && s.ready())
            .map(|s| { let (cx, cy) = s.center(); (s.id, (x - cx).powi(2) + (y - cy).powi(2)) })
            .min_by(|a,b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0))).map(|v| v.0)
    }
    fn refresh(&mut self) {
        if !self.dirty { return; }
        self.owners.clear(); self.boosted_cities.clear(); self.house_cities.clear();
        for s in self.baths.iter().filter_map(|id| self.sites.get(id)).filter(|s| s.flags & ALIVE != 0) {
            let (x,y) = s.center();
            if let Some(city) = self.nearest_city(s.faction, x, y) {
                self.owners.insert(s.id, city);
                if s.ready() { self.boosted_cities.insert(city); }
            }
        }
        if !self.boosted_cities.is_empty() {
            for s in self.houses.iter().filter_map(|id| self.sites.get(id)).filter(|s| s.flags & ALIVE != 0) {
                let (x,y) = s.center();
                if let Some(city) = self.nearest_city(s.faction, x, y) { self.house_cities.insert(s.id, city); }
            }
        }
        self.dirty = false;
    }
    /// Four input [variant, anchor] pairs must identify the SAME complete mud
    /// pool. Offset placements, ordinary land and volcanoes are never accepted.
    /// 0 allowed; 1 wrong terrain/footprint; 2 no completed friendly town.
    pub fn placement(&self, faction: i32, x: f64, y: f64, width: usize, height: usize) -> u32 {
        if !x.is_finite() || !y.is_finite() || x.fract() != 0.0 || y.fract() != 0.0 || x < 0.0 || y < 0.0
            || x + 2.0 > width as f64 || y + 2.0 > height as f64 { return 1; }
        let anchor = y * width as f64 + x;
        let variant = self.input[0];
        if !(4.0..=6.0).contains(&variant) || variant.fract() != 0.0
            || (0..4).any(|i| self.input[i * 2] != variant || self.input[i * 2 + 1] != anchor) { return 1; }
        if self.nearest_city(faction, x + 1.0, y + 1.0).is_none() { return 2; }
        0
    }
    pub fn owner(&mut self, id: i64) -> f64 { self.refresh(); self.owners.get(&id).map_or(f64::NAN, |id| *id as f64) }
    pub fn city_multiplier(&mut self, id: i64) -> f64 {
        self.refresh(); if self.boosted_cities.contains(&id) { HOUSING_MULTIPLIER } else { 1.0 }
    }
    pub fn capacity(&mut self, id: i64, faction: i32, x: f64, y: f64, base: f64) -> f64 {
        self.refresh();
        if self.boosted_cities.is_empty() { return base; }
        // New construction templates may be queried before entity insertion.
        let city = self.house_cities.get(&id).copied().or_else(|| self.nearest_city(faction, x + 0.5, y + 0.5));
        if city.is_some_and(|id| self.boosted_cities.contains(&id)) { (base * HOUSING_MULTIPLIER).round() } else { base }
    }
}

pub fn clear(world: &mut World) {
    world.resource_scope(|world, mut network: Mut<ThermalBaths>| {
        for site in network.sites.values() { if let Ok(mut entity) = world.get_entity_mut(site.entity) { entity.remove::<BathSite>(); } }
        *network = ThermalBaths::default();
    });
}
pub fn remove(world: &mut World, id: i64) {
    world.resource_scope(|world, mut network: Mut<ThermalBaths>| {
        if let Some(site) = network.sites.remove(&id) {
            network.towns.remove(&id); network.baths.remove(&id); network.houses.remove(&id);
            if let Ok(mut entity) = world.get_entity_mut(site.entity) { entity.remove::<BathSite>(); }
            network.dirty = true;
        }
    });
}
pub fn upsert(world: &mut World, id: i64, kind: u32, faction: i32, x: f64, y: f64, flags: u32) {
    if !matches!(kind, PALACE | HOUSE | APARTMENTS | THERMAL_BATH) { remove(world, id); return; }
    let Some((entity, _)) = world.resource::<EntityTables>().buildings.locate(id) else { return; };
    let site = BathSite { entity, id, kind, faction, x, y, flags };
    if world.resource::<ThermalBaths>().sites.get(&id) == Some(&site) { return; }
    world.entity_mut(entity).insert(site);
    let mut network = world.resource_mut::<ThermalBaths>();
    network.towns.remove(&id); network.baths.remove(&id); network.houses.remove(&id);
    match kind { PALACE => { network.towns.insert(id); }, THERMAL_BATH => { network.baths.insert(id); }, HOUSE | APARTMENTS => { network.houses.insert(id); }, _ => {} }
    network.sites.insert(id, site); network.dirty = true;
}
