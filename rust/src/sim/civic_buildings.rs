//! Civic structures and capturable gold mines. Lifecycle events maintain
//! hospital spatial trees and factory counts. Mine capture samples troops at
//! 1 Hz; its spatial query never compares every troop with every building.
use bevy_ecs::prelude::*;
use rstar::{RTree, primitives::GeomWithData};
use std::collections::{BTreeMap, BTreeSet};
use super::kinds::{unit, building::{HOSPITAL, APARTMENTS, FACTORY, GOLD_MINE, PALACE}};

pub const UNIT_STRIDE: usize = 9;
pub const CAPTURE_SECONDS: f64 = 12.0;
pub const CAPTURE_RADIUS: f64 = 4.0;
pub const HOSPITAL_RADIUS: f64 = 8.0;
pub const MINE_WORLD_SHARE: f64 = 0.1;
const FACTORY_BONUS: f64 = 0.20;
const COAL_FACTORY_BONUS: f64 = 0.35;

pub fn targetable(kind: u32, hp: f64) -> bool { kind != GOLD_MINE && hp > 0.0 }
pub fn removable(kind: u32) -> bool { kind != GOLD_MINE }

pub fn constant(kind: u32, property: u32) -> f64 {
    match (kind, property) {
        (HOSPITAL, 0) => 450.0, (HOSPITAL, 1) => 600.0, (HOSPITAL, 2) => 5.0,
        (APARTMENTS, 0) => 300.0, (APARTMENTS, 1) => 450.0, (APARTMENTS, 2) => 0.0,
        (FACTORY, 0) => 600.0, (FACTORY, 1) => 650.0, (FACTORY, 2) => 8.0,
        (GOLD_MINE, 0) => 0.0, (GOLD_MINE, 1) => 1000.0, (GOLD_MINE, 2) => 0.0,
        (APARTMENTS, 3) => 24.0, (HOSPITAL, 3) => HOSPITAL_RADIUS,
        (GOLD_MINE, 3) => CAPTURE_SECONDS, (FACTORY, 3) => FACTORY_BONUS,
        (FACTORY, 4) => COAL_FACTORY_BONUS,
        _ => f64::NAN,
    }
}

#[derive(Component)]
pub struct CivicStructure;

#[derive(Clone, Copy, PartialEq)]
struct Site { kind: u32, faction: i32, x: f64, y: f64, ready: bool }
impl Site { fn center(self) -> [f64; 2] { [self.x + 1.0, self.y + 1.0] } }
#[derive(Clone, Copy)]
struct Mine { id: i64, owner: i32, x: f64, y: f64, challenger: i32, progress: f64 }

#[derive(Resource, Default)]
pub struct CivicBuildings {
    sites: BTreeMap<i64, Site>,
    hospitals: BTreeMap<i32, RTree<[f64; 2]>>,
    factories: BTreeMap<i32, usize>,
    coal_cities: BTreeSet<i64>,
    coal_factories: BTreeMap<i32, usize>,
    coal_dirty: bool,
    mines: BTreeMap<i64, Mine>,
    // Integer-cell membership is bounded by fixed capture radius and
    // nonoverlapping 2×2 structures. Generated mines are 24+ tiles apart.
    mine_cells: BTreeMap<(i32, i32), Vec<i64>>,
    earned_gold: f64,
    input: Vec<f64>, output: Vec<f64>,
}
impl CivicBuildings {
    pub fn clear_sites(&mut self) {
        self.sites.clear(); self.hospitals.clear(); self.factories.clear();
        self.mines.clear(); self.mine_cells.clear();
        self.coal_factories.clear(); self.coal_dirty = true;
    }
    pub fn remove(&mut self, id: i64) {
        if let Some(site) = self.sites.remove(&id) {
            if site.kind == HOSPITAL && site.ready {
                if let Some(tree) = self.hospitals.get_mut(&site.faction) { tree.remove(&site.center()); }
            }
            if site.kind == FACTORY && site.ready {
                if let Some(count) = self.factories.get_mut(&site.faction) { *count = count.saturating_sub(1); }
            }
            if site.ready && matches!(site.kind, FACTORY | PALACE) { self.coal_dirty = true; }
            if site.kind == GOLD_MINE {
                self.mines.remove(&id);
                for y in site.y as i32 - 3..=site.y as i32 + 5 { for x in site.x as i32 - 3..=site.x as i32 + 5 {
                    if let Some(ids) = self.mine_cells.get_mut(&(x,y)) { ids.retain(|value| *value != id); if ids.is_empty() { self.mine_cells.remove(&(x,y)); } }
                }}
            }
        }
    }
    pub fn site(&mut self, id: i64, kind: u32, faction: f64, x: f64, y: f64, flags: u32) {
        if !matches!(kind, HOSPITAL | APARTMENTS | FACTORY | GOLD_MINE | PALACE) || flags & 1 == 0 { self.remove(id); return; }
        let site = Site { kind, faction: faction as i32, x, y, ready: flags & 5 == 5 };
        if self.sites.get(&id) == Some(&site) { return; }
        let previous = self.mines.get(&id).copied();
        self.remove(id);
        self.sites.insert(id, site);
        if site.ready && matches!(kind, FACTORY | PALACE) { self.coal_dirty = true; }
        if site.kind == HOSPITAL && site.ready { self.hospitals.entry(site.faction).or_default().insert(site.center()); }
        if site.kind == FACTORY && site.ready { *self.factories.entry(site.faction).or_default() += 1; }
        if site.kind == GOLD_MINE && site.ready {
            let saved = previous.filter(|mine| mine.owner == site.faction);
            self.mines.insert(id, Mine { id, owner: site.faction, x, y,
                challenger: saved.map_or(-1, |m| m.challenger), progress: saved.map_or(0.0, |m| m.progress) });
            for y in y as i32 - 3..=y as i32 + 5 { for x in x as i32 - 3..=x as i32 + 5 {
                self.mine_cells.entry((x,y)).or_default().push(id);
            }}
        }
    }
    pub fn mine_progress(&mut self, id: i64, challenger: i32, progress: f64) {
        if let Some(mine) = self.mines.get_mut(&id) {
            mine.challenger = challenger; mine.progress = progress.clamp(0.0, CAPTURE_SECONDS);
        }
    }
    pub fn set_coal_cities(&mut self, count: usize) {
        let cities: BTreeSet<_> = self.input[..count].iter().map(|id| *id as i64).collect();
        if self.coal_cities != cities {
            self.coal_cities = cities;
            self.coal_dirty = true;
        }
    }
    /// Coal changes the contribution of the factories assigned to a supplying
    /// city. Rebuild the counts only after a supply or relevant site change.
    fn refresh_coal_factories(&mut self) {
        if !std::mem::take(&mut self.coal_dirty) { return; }
        self.coal_factories.clear();
        if self.coal_cities.is_empty() { return; }
        type City = GeomWithData<[f64; 2], i64>;
        let owners: BTreeSet<_> = self.coal_cities.iter().filter_map(|id| self.sites.get(id))
            .filter(|site| site.kind == PALACE && site.ready).map(|site| site.faction).collect();
        let mut palaces: BTreeMap<i32, Vec<City>> = BTreeMap::new();
        for (&id, site) in &self.sites {
            if site.kind == PALACE && site.ready && owners.contains(&site.faction) {
                palaces.entry(site.faction).or_default().push(GeomWithData::new(site.center(), id));
            }
        }
        let city_trees: BTreeMap<_, _> = palaces.into_iter()
            .map(|(faction, cities)| (faction, RTree::bulk_load(cities))).collect();
        for site in self.sites.values().filter(|site| site.kind == FACTORY && site.ready) {
            let Some(tree) = city_trees.get(&site.faction) else { continue; };
            let mut nearest = tree.nearest_neighbor_iter_with_distance_2(site.center());
            let Some((city, distance)) = nearest.next() else { continue; };
            // The same center and lower-id tiebreak as the city ownership view.
            let city = nearest.take_while(|(_, next)| *next == distance)
                .fold(city.data, |id, (candidate, _)| id.min(candidate.data));
            if self.coal_cities.contains(&city) { *self.coal_factories.entry(site.faction).or_default() += 1; }
        }
    }
    pub fn factory_income(&mut self, faction: i32, base: f64) -> f64 {
        self.refresh_coal_factories();
        let total = self.factories.get(&faction).copied().unwrap_or(0);
        let supplied = self.coal_factories.get(&faction).copied().unwrap_or(0);
        let bonus = (total - supplied) as f64 * FACTORY_BONUS + supplied as f64 * COAL_FACTORY_BONUS;
        base.max(0.0) * (1.0 + bonus.min(1.0))
    }
    pub fn income(&mut self, amount: f64) { if amount.is_finite() && amount > 0.0 { self.earned_gold += amount; } }
    pub fn snapshot(&self) -> [f64; 1] { [self.earned_gold] }
    pub fn restore(&mut self, values: &[f64]) -> bool {
        if values.len() != 1 || !values[0].is_finite() || values[0] < 0.0 { return false; }
        self.earned_gold = values[0]; true
    }
    pub fn prepare(&mut self, words: usize) -> *mut f64 { self.input.resize(words, 0.0); self.input.as_mut_ptr() }
    /// Outputs tagged records [kind, id, value, extra]: healed HP (0), mine
    /// owner/capture progress (1), challenger (2), or faction gold receipt (3).
    pub fn step(&mut self, count: usize, now: f64, elapsed: f64) -> *const f64 {
        self.output.clear(); self.output.push(0.0);
        let mut presence: BTreeMap<i64, (i32, bool)> = BTreeMap::new();
        for row in 0..count {
            let r = &self.input[row * UNIT_STRIDE..(row + 1) * UNIT_STRIDE];
            let (id,faction,x,y,hp,max_hp,damaged,flags) = (r[0],r[1] as i32,r[2],r[3],r[4],r[5],r[6],r[7] as u32);
            if hp <= 0.0 || faction < 0 || flags & 1 == 0 { continue; }
            let kind = r[8] as u32;
            if unit::soldier(kind) || kind == unit::LEADER {
                for mine_id in self.mine_cells.get(&(x.floor() as i32,y.floor() as i32)).into_iter().flatten() {
                    let Some(mine) = self.mines.get(mine_id) else { continue; };
                    if (mine.x+1.0-x).powi(2)+(mine.y+1.0-y).powi(2) > CAPTURE_RADIUS.powi(2) { continue; }
                    let entry = presence.entry(*mine_id).or_insert((faction,false));
                    if entry.0 != faction { entry.1 = true; }
                }
            }
            let human = kind <= unit::MERCHANT && kind != unit::SUPPLY_CART || kind == unit::MUSKETMAN;
            if hp < max_hp && now - damaged >= 5.0 && human {
                if self.hospitals.get(&faction).and_then(|tree| tree.nearest_neighbor([x,y]))
                    .is_some_and(|point| (point[0]-x).powi(2)+(point[1]-y).powi(2) <= HOSPITAL_RADIUS.powi(2)) {
                    let quiet = elapsed.min((now-damaged-5.0).max(0.0));
                    self.output.extend_from_slice(&[0.0,id,(hp+quiet*3.0).min(max_hp),0.0]);
                }
            }
        }
        for mine in self.mines.values_mut() {
            match presence.get(&mine.id) {
                Some(&(faction,false)) if faction != mine.owner => {
                    if mine.challenger != faction { mine.challenger = faction; mine.progress = 0.0; }
                    mine.progress += elapsed;
                    if mine.progress + 1e-7 >= CAPTURE_SECONDS { mine.owner = faction; mine.progress = 0.0; mine.challenger = -1; }
                }
                Some(&(_,true)) => {}, // Contest pauses the existing claim.
                _ => { mine.progress = 0.0; mine.challenger = -1; },
            }
            self.output.extend_from_slice(&[1.0,mine.id as f64,mine.owner as f64,mine.progress,
                2.0,mine.id as f64,mine.challenger as f64, presence.get(&mine.id).is_some_and(|value| value.1) as u8 as f64]);
        }
        self.output[0] = ((self.output.len()-1)/4) as f64;
        self.output.as_ptr()
    }
    /// A fixed 10% world-output pool is shared equally among every mine,
    /// including neutral ones. Mine receipts never feed this pool recursively.
    pub fn dividends(&mut self) -> *const f64 {
        self.output.clear(); self.output.push(0.0);
        let each = self.earned_gold * MINE_WORLD_SHARE / self.mines.len().max(1) as f64;
        self.earned_gold = 0.0;
        let mut receipts = BTreeMap::<i32,f64>::new();
        for mine in self.mines.values() { if mine.owner >= 0 { *receipts.entry(mine.owner).or_default() += each; } }
        for (faction,gold) in receipts { if gold > 0.0 { self.output.extend_from_slice(&[3.0,faction as f64,gold,0.0]); } }
        self.output[0] = ((self.output.len()-1)/4) as f64; self.output.as_ptr()
    }
    /// Reuses the host's procedural terrain and resource layout. Two linear
    /// passes prefer gold deposits, then sparse buildable fallback locations.
    /// Fixed neighborhood exclusion makes placement O(world area).
    pub fn generate(&mut self, width: usize, height: usize, seed: u32) -> *const f64 {
        self.output.clear(); self.output.push(0.0);
        let mut reserved = vec![false; width*height];
        let mut near_gold = vec![false; width*height];
        for index in 0..width*height {
            if self.input[index] as u32 & 2 == 0 { continue; }
            let (x,y)=(index%width,index/width);
            for cy in y.saturating_sub(5)..=(y+5).min(height-1) { for cx in x.saturating_sub(5)..=(x+5).min(width-1) { near_gold[cy*width+cx]=true; } }
        }
        let wanted = (width*height/22000).clamp(2,12);
        for gold_only in [true,false] {
            for offset in 0..width*height {
                let index = (offset + seed as usize % (width*height).max(1)) % (width*height).max(1);
                if self.output[0] >= wanted as f64 { break; }
                let x=index%width; let y=index/width;
                if x+2>=width || y+2>=height || reserved[index] { continue; }
                let footprint=[index,index+1,index+width,index+width+1];
                if footprint.iter().any(|cell| self.input.get(*cell).copied().unwrap_or(0.0) as u32 & 1 == 0) { continue; }
                if gold_only && !near_gold[index] { continue; }
                self.output.extend_from_slice(&[x as f64,y as f64]); self.output[0]+=1.0;
                for cy in y.saturating_sub(24)..=(y+24).min(height-1) { for cx in x.saturating_sub(24)..=(x+24).min(width-1) { reserved[cy*width+cx]=true; } }
            }
        }
        self.output.as_ptr()
    }
}
