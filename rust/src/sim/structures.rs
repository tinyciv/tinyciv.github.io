//! Resident building index. The host publishes one row per building when its
//! owner, footprint or lifecycle flags change; every query here reads
//! maintained indexes instead of rescanning the whole building list per unit.
//!
//! Rows are `Structure` components on the building entities of the simulation
//! World and the index is one of its resources. Row order is the building's
//! registration sequence (host array order), so ordered results and distance
//! ties match the original stable sorts.
use bevy_ecs::prelude::*;
use std::collections::{BTreeMap, BTreeSet};
use rstar::{PointDistance, RTree, RTreeObject, AABB};
use rustc_hash::FxHashMap;

use crate::jsmath::hypot2;
use super::kinds::building::{defensive, farm, height, route, wall, width, IRRIGATION, PALACE, RUIN, WOODEN_TOWER};

fn obstructs(row: &Structure) -> bool {
    row.flags & PRESENT != 0 && !farm(row.kind) && !route(row.kind) && row.kind != IRRIGATION && row.kind != RUIN
}

pub const ALIVE: u32 = 1;
pub const PRESENT: u32 = 2;
pub const READY: u32 = 4;

/// Candidate classes for nearest/near queries.
pub const CLASS_REFUGE: u32 = 0;
pub const CLASS_SHELTER: u32 = 1;
fn in_class(class: u32, row: &Structure) -> bool {
    if row.flags & PRESENT == 0 || row.kind == IRRIGATION || farm(row.kind) || route(row.kind) { return false; }
    match class { CLASS_REFUGE => !wall(row.kind), CLASS_SHELTER => true, _ => false }
}

#[derive(Component, Clone, Copy, Debug)]
pub struct Structure { id: i64, sequence: u64, faction: f64, x: f64, y: f64, kind: u32, flags: u32 }

/// Only eligible structures enter these trees. Copies are updated with the
/// authoritative row, never rebuilt while a fleeing unit searches for shelter.
#[derive(Clone, PartialEq)]
struct SpatialStructure { id: i64, sequence: u64, envelope: AABB<[f64; 2]> }
impl RTreeObject for SpatialStructure {
    type Envelope = AABB<[f64; 2]>;
    fn envelope(&self) -> Self::Envelope { self.envelope }
}
impl SpatialStructure {
    fn distance(&self, point: &[f64; 2]) -> f64 {
        let lower = self.envelope.lower(); let upper = self.envelope.upper();
        hypot2((lower[0] - point[0]).max(0.0).max(point[0] - upper[0]),
            (lower[1] - point[1]).max(0.0).max(point[1] - upper[1]))
    }
}
impl PointDistance for SpatialStructure {
    fn distance_2(&self, point: &[f64; 2]) -> f64 { self.envelope.distance_2(point) }
}

fn faction_key(faction: f64) -> i64 { if faction.is_finite() { faction as i64 } else { i64::MIN } }

/// Per-cell reference counts; cells outside the map are ignored.
#[derive(Default)]
struct CellCounts { counts: Vec<u16> }
impl CellCounts {
    fn add(&mut self, cell: Option<usize>, delta: i32) {
        let Some(cell) = cell else { return; };
        if cell >= self.counts.len() { if delta < 0 { return; } self.counts.resize(cell + 1, 0); }
        let value = self.counts[cell] as i32 + delta;
        self.counts[cell] = value.max(0) as u16;
    }
    fn has(&self, cell: f64) -> bool {
        cell >= 0.0 && (cell as usize) < self.counts.len() && self.counts[cell as usize] != 0
    }
}

#[derive(Resource)]
pub struct StructureIndex {
    width: i64,
    /// (sequence, entity) in registration order.
    ordered: BTreeMap<u64, Entity>,
    by_faction: BTreeMap<i64, BTreeSet<u64>>,
    revision: f64,
    /// Wall/palisade corner cells, whatever their state.
    wall_cells: CellCounts,
    /// Corner cells of present wooden towers.
    wooden_tower_cells: CellCounts,
    /// Footprint cells of living buildings that are neither farms nor irrigation.
    solid_cells: CellCounts,
    defenses: BTreeMap<i64, Vec<f64>>,
    output: Vec<f64>,
    scratch: Vec<(f64, u64, i64)>,
    proximity: FxHashMap<i64, [RTree<SpatialStructure>; 2]>,
    clearance: BTreeSet<usize>,
}
impl Default for StructureIndex { fn default() -> Self { Self::new(1) } }

impl StructureIndex {
    pub fn new(width: i32) -> Self {
        Self { width: width.max(1) as i64, ordered: BTreeMap::new(), by_faction: BTreeMap::new(), revision: 0.0,
            wall_cells: CellCounts::default(), wooden_tower_cells: CellCounts::default(), solid_cells: CellCounts::default(),
            defenses: BTreeMap::new(), output: vec![0.0], scratch: Vec::new(), proximity: FxHashMap::default(), clearance: BTreeSet::new() }
    }
    pub fn width(&self) -> i32 { self.width as i32 }
    fn row(world: &World, entity: Entity) -> &Structure { world.get::<Structure>(entity).expect("structure row") }
    fn cell(&self, x: f64, y: f64) -> Option<usize> {
        if !x.is_finite() || !y.is_finite() { return None; }
        let (x, y) = (x.floor() as i64, y.floor() as i64);
        (x >= 0 && y >= 0 && x < self.width).then(|| (y * self.width + x) as usize)
    }
    fn count_cells(&mut self, row: &Structure, delta: i32) {
        let corner = self.cell(row.x, row.y);
        if wall(row.kind) { self.wall_cells.add(corner, delta); }
        if row.kind == WOODEN_TOWER && row.flags & PRESENT != 0 { self.wooden_tower_cells.add(corner, delta); }
        if row.flags & ALIVE != 0 && !farm(row.kind) && row.kind != IRRIGATION {
            for dy in 0..height(row.kind) as i64 { for dx in 0..width(row.kind) as i64 {
                let cell = self.cell(row.x + dx as f64, row.y + dy as f64);
                self.solid_cells.add(cell, delta);
            } }
        }
    }

    fn index_proximity(&mut self, row: &Structure, insert: bool) {
        if !row.x.is_finite() || !row.y.is_finite() { return; }
        let entry = SpatialStructure { id: row.id, sequence: row.sequence,
            envelope: AABB::from_corners([row.x, row.y], [row.x + width(row.kind), row.y + height(row.kind)]) };
        let trees = self.proximity.entry(faction_key(row.faction)).or_default();
        for (class, tree) in trees.iter_mut().enumerate() {
            if in_class(class as u32, row) {
                if insert { tree.insert(entry.clone()); } else { tree.remove(&entry); }
            }
        }
    }

    /// Publishes a building row. `entity` and `sequence` come from the entity table.
    pub fn upsert(&mut self, world: &mut World, entity: Entity, sequence: u64, id: i64, faction: f64, x: f64, y: f64, kind: u32, flags: u32) {
        let next = Structure { id, sequence, faction, x, y, kind, flags };
        let previous = world.get::<Structure>(entity).copied();
        // Queue only footprint/lifecycle changes, never routine damage ticks.
        if obstructs(&next) && previous.is_none_or(|old| !obstructs(&old)
            || old.x != x || old.y != y || old.kind != kind
            || !(old.faction == faction || old.faction.is_nan() && faction.is_nan())) {
            for dy in 0..height(kind) as i64 { for dx in 0..width(kind) as i64 {
                if let Some(cell) = self.cell(x + dx as f64, y + dy as f64) { self.clearance.insert(cell); }
            } }
        }
        if let Some(previous) = world.get::<Structure>(entity).copied() {
            let same_faction = previous.faction == faction || previous.faction.is_nan() && faction.is_nan();
            if same_faction && previous.x == x && previous.y == y && previous.kind == kind && previous.flags == flags { return; }
            self.count_cells(&previous, -1);
            self.index_proximity(&previous, false);
            if !same_faction {
                if let Some(set) = self.by_faction.get_mut(&faction_key(previous.faction)) { set.remove(&previous.sequence); }
                self.by_faction.entry(faction_key(faction)).or_default().insert(sequence);
            }
        } else {
            self.ordered.insert(sequence, entity);
            self.by_faction.entry(faction_key(faction)).or_default().insert(sequence);
        }
        world.entity_mut(entity).insert(next);
        self.count_cells(&next, 1);
        self.index_proximity(&next, true);
        self.revision += 1.0;
    }

    /// Forgets a building that is about to be despawned (or unpublished).
    pub fn remove(&mut self, world: &World, entity: Entity) {
        let Some(row) = world.get::<Structure>(entity).copied() else { return; };
        self.count_cells(&row, -1);
        self.index_proximity(&row, false);
        self.ordered.remove(&row.sequence);
        if let Some(set) = self.by_faction.get_mut(&faction_key(row.faction)) { set.remove(&row.sequence); }
        self.revision += 1.0;
    }

    /// Drops every row (the host republishes) and adopts the world width.
    pub fn clear(&mut self, world: &mut World, width: i32) {
        for entity in self.ordered.values() {
            if let Ok(mut row) = world.get_entity_mut(*entity) { row.remove::<Structure>(); }
        }
        let revision = self.revision + 1.0;
        *self = Self::new(width);
        self.revision = revision;
    }

    /// Advances whenever a row changes.
    #[allow(dead_code)]
    pub fn revision(&self) -> f64 { self.revision }

    /// Coalesced obstacle additions, consumed once by the host's movement bridge.
    pub fn take_clearance(&mut self) -> *const f64 {
        self.output.clear(); self.output.push(self.clearance.len() as f64);
        self.output.extend(self.clearance.iter().map(|&cell| cell as f64));
        self.clearance.clear(); self.output.as_ptr()
    }

    /// The `skip`-th nearest building of a class by footprint edge distance;
    /// equal distances keep registration order. NaN when there is none.
    pub fn nearest(&mut self, faction: f64, x: f64, y: f64, class: u32, skip: usize) -> f64 {
        if !x.is_finite() || !y.is_finite() { return f64::NAN; }
        let Some(tree) = self.proximity.get(&faction_key(faction)).and_then(|trees| trees.get(class as usize)) else { return f64::NAN; };
        let mut scratch = std::mem::take(&mut self.scratch);
        scratch.clear();
        let point = [x, y]; let mut boundary = f64::INFINITY;
        for row in tree.nearest_neighbor_iter(point) {
            let distance = row.distance(&point);
            // Include the complete final distance tie, then use registration
            // order. R-tree traversal order must never decide a gameplay tie.
            // Broad-phase squared distances can differ by a rounding unit from
            // the exact JS-compatible hypot used for gameplay ordering.
            if row.distance_2(&point) > boundary { break; }
            scratch.push((distance, row.sequence, row.id));
            if scratch.len() == skip.saturating_add(1) { boundary = row.distance_2(&point) * (1.0 + 1e-12) + 1e-12; }
        }
        scratch.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal).then(a.1.cmp(&b.1)));
        let result = scratch.get(skip).map_or(f64::NAN, |entry| entry.2 as f64);
        self.scratch = scratch;
        result
    }

    /// Whether any building of a class lies within `radius` (exclusive) of a point.
    pub fn near(&self, faction: f64, x: f64, y: f64, radius: f64, class: u32) -> bool {
        if !x.is_finite() || !y.is_finite() || !(radius > 0.0) { return false; }
        let Some(tree) = self.proximity.get(&faction_key(faction)).and_then(|trees| trees.get(class as usize)) else { return false; };
        let area = AABB::from_corners([x - radius, y - radius], [x + radius, y + radius]);
        tree.locate_in_envelope_intersecting(area).any(|row| row.distance(&[x, y]) < radius)
    }

    /// Ids in registration order: [count, ids...]. A NaN faction matches every
    /// owner; `kinds` entries below zero are unused and an all-unused list
    /// matches every kind. All `flags` bits must be set.
    pub fn query(&mut self, world: &World, faction: f64, flags: u32, kinds: [i32; 4]) -> *const f64 {
        let mask = kinds.into_iter().filter(|kind| *kind >= 0 && *kind < 64).fold(0_u64, |mask, kind| mask | (1_u64 << kind));
        self.query_mask(world, faction, flags, mask)
    }
    /// A 64-bit kind set includes later military schools without truncating
    /// queries to the original four transport slots. Zero matches every kind.
    pub fn query_mask(&mut self, world: &World, faction: f64, flags: u32, kinds: u64) -> *const f64 {
        let mut output = std::mem::take(&mut self.output);
        output.clear(); output.push(0.0);
        let matches = |row: &Structure| row.flags & flags == flags
            && (kinds == 0 || row.kind < 64 && kinds & (1_u64 << row.kind) != 0);
        if faction.is_nan() {
            for entity in self.ordered.values() { let row = Self::row(world, *entity); if matches(row) { output.push(row.id as f64); } }
        } else if let Some(sequences) = self.by_faction.get(&faction_key(faction)) {
            for sequence in sequences { let row = Self::row(world, self.ordered[sequence]); if matches(row) { output.push(row.id as f64); } }
        }
        output[0] = (output.len() - 1) as f64;
        self.output = output;
        self.output.as_ptr()
    }

    /// A wall or palisade cell that javelins arc over (no present wooden tower on it).
    pub fn arc_cell(&self, cell: f64) -> bool { self.wall_cells.has(cell) && !self.wooden_tower_cells.has(cell) }

    /// A living building other than a farm or irrigation covers this tile.
    pub fn solid_at(&self, x: f64, y: f64) -> bool {
        self.cell(x, y).is_some_and(|cell| self.solid_cells.has(cell as f64))
    }

    /// Snapshot the partition of defensive buildings among ready palaces of
    /// their own faction (nearest palace center; the lower id wins a tie).
    pub fn refresh_defenses(&mut self, world: &World) {
        let mut palaces: BTreeMap<i64, Vec<(i64, f64, f64)>> = BTreeMap::new();
        for entity in self.ordered.values() {
            let row = Self::row(world, *entity);
            if row.kind == PALACE && row.flags & READY != 0 { palaces.entry(faction_key(row.faction)).or_default().push((row.id, row.x, row.y)); }
        }
        let mut defenses: BTreeMap<i64, Vec<f64>> = BTreeMap::new();
        for entity in self.ordered.values() {
            let row = Self::row(world, *entity);
            if !defensive(row.kind) || row.faction.is_nan() { continue; }
            let Some(candidates) = palaces.get(&faction_key(row.faction)) else { continue; };
            let (cx, cy) = (row.x + width(row.kind) / 2.0, row.y + height(row.kind) / 2.0);
            let mut best = f64::INFINITY; let mut owner: Option<i64> = None;
            for &(id, x, y) in candidates {
                let (dx, dy) = (cx - x - 1.0, cy - y - 1.0);
                let distance = dx * dx + dy * dy;
                if distance < best || distance == best && owner.is_some_and(|current| id < current) { best = distance; owner = Some(id); }
            }
            if let Some(owner) = owner { defenses.entry(owner).or_default().push(row.id as f64); }
        }
        self.defenses = defenses;
    }

    /// Defensive buildings assigned to a palace in the last snapshot: [count, ids...].
    pub fn defenses(&mut self, palace: i64) -> *const f64 {
        let mut output = std::mem::take(&mut self.output);
        output.clear(); output.push(0.0);
        if let Some(ids) = self.defenses.get(&palace) { output.extend_from_slice(ids); }
        output[0] = (output.len() - 1) as f64;
        self.output = output;
        self.output.as_ptr()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sim::entities::{self, EntityTables, BUILDINGS};
    use crate::sim::kinds::building::{CAMP, GUARD_POST, HOUSE, PALISADE, WALL};

    fn world() -> World {
        let mut world = World::new();
        world.init_resource::<EntityTables>();
        world.insert_resource(StructureIndex::new(40));
        world
    }
    fn upsert(world: &mut World, id: i64, faction: f64, x: f64, y: f64, kind: u32, flags: u32) {
        entities::insert(world, BUILDINGS, id);
        let (entity, sequence) = world.resource::<EntityTables>().buildings.locate(id).unwrap();
        world.resource_scope(|world, mut index: Mut<StructureIndex>| index.upsert(world, entity, sequence, id, faction, x, y, kind, flags));
    }
    fn remove(world: &mut World, id: i64) {
        let (entity, _) = world.resource::<EntityTables>().buildings.locate(id).unwrap();
        world.resource_scope(|world, mut index: Mut<StructureIndex>| index.remove(world, entity));
        entities::remove(world, BUILDINGS, id);
    }
    fn ids(pointer: *const f64) -> Vec<f64> {
        unsafe { let count = *pointer as usize; std::slice::from_raw_parts(pointer.add(1), count).to_vec() }
    }
    fn query(world: &mut World, faction: f64, flags: u32, kinds: [i32; 4]) -> Vec<f64> {
        world.resource_scope(|world, mut index: Mut<StructureIndex>| ids(index.query(world, faction, flags, kinds)))
    }
    fn defenses(world: &mut World, palace: i64) -> Vec<f64> { ids(world.resource_mut::<StructureIndex>().defenses(palace)) }
    fn refresh(world: &mut World) { world.resource_scope(|world, mut index: Mut<StructureIndex>| index.refresh_defenses(world)); }

    #[test]
    fn obstacle_events_follow_ruin_restoration_and_construction_lifecycle() {
        let mut world = world();
        upsert(&mut world, 1, 0.0, 4.0, 4.0, RUIN, ALIVE | PRESENT | READY);
        assert!(ids(world.resource_mut::<StructureIndex>().take_clearance()).is_empty());
        upsert(&mut world, 1, 0.0, 4.0, 4.0, PALACE, ALIVE | PRESENT | READY);
        assert_eq!(ids(world.resource_mut::<StructureIndex>().take_clearance()), vec![164.0, 165.0, 204.0, 205.0]);
        upsert(&mut world, 1, 0.0, 4.0, 4.0, PALACE, ALIVE | PRESENT | READY);
        assert!(ids(world.resource_mut::<StructureIndex>().take_clearance()).is_empty());
        upsert(&mut world, 2, 0.0, 8.0, 8.0, HOUSE, ALIVE);
        assert!(ids(world.resource_mut::<StructureIndex>().take_clearance()).is_empty());
        upsert(&mut world, 2, 0.0, 8.0, 8.0, HOUSE, ALIVE | PRESENT);
        assert_eq!(ids(world.resource_mut::<StructureIndex>().take_clearance()), vec![328.0]);
        upsert(&mut world, 3, 0.0, 9.0, 9.0, CAMP, ALIVE | PRESENT | READY);
        assert!(ids(world.resource_mut::<StructureIndex>().take_clearance()).is_empty());
    }

    #[test]
    fn nearest_refuge_skips_walls_farms_and_other_owners_and_keeps_order_on_ties() {
        let mut world = world();
        upsert(&mut world, 1, 0.0, 10.0, 5.0, WALL, ALIVE | PRESENT | READY);
        upsert(&mut world, 2, 0.0, 12.0, 5.0, HOUSE, ALIVE | PRESENT | READY);
        upsert(&mut world, 3, 0.0, 8.0, 5.0, HOUSE, ALIVE | PRESENT | READY);
        upsert(&mut world, 4, 1.0, 10.0, 6.0, HOUSE, ALIVE | PRESENT | READY);
        upsert(&mut world, 5, 0.0, 10.0, 4.0, CAMP, ALIVE | PRESENT | READY);
        upsert(&mut world, 6, 0.0, 30.0, 5.0, HOUSE, ALIVE);
        // Unit at (10.5, 5.5): houses 2 and 3 are both 1.5 away; 2 registered first.
        let nearest = |world: &mut World, skip| world.resource_mut::<StructureIndex>().nearest(0.0, 10.5, 5.5, CLASS_REFUGE, skip);
        assert_eq!(nearest(&mut world, 0), 2.0);
        assert_eq!(nearest(&mut world, 1), 3.0);
        assert!(nearest(&mut world, 2).is_nan());
        assert!(world.resource::<StructureIndex>().near(0.0, 10.5, 5.5, 2.5, CLASS_SHELTER));
        assert!(!world.resource::<StructureIndex>().near(2.0, 10.5, 5.5, 2.5, CLASS_SHELTER));
        upsert(&mut world, 2, 1.0, 12.0, 5.0, HOUSE, ALIVE | PRESENT | READY);
        assert_eq!(nearest(&mut world, 0), 3.0);
        remove(&mut world, 3);
        assert!(nearest(&mut world, 0).is_nan());
    }

    #[test]
    fn queries_cells_and_defenses_follow_row_changes() {
        let mut world = world();
        upsert(&mut world, 1, 0.0, 4.0, 4.0, PALACE, ALIVE | PRESENT | READY);
        upsert(&mut world, 2, 0.0, 20.0, 4.0, PALACE, ALIVE | PRESENT | READY);
        upsert(&mut world, 3, 0.0, 7.0, 4.0, WOODEN_TOWER, ALIVE | PRESENT | READY);
        upsert(&mut world, 4, 0.0, 18.0, 4.0, GUARD_POST, ALIVE | PRESENT);
        upsert(&mut world, 5, 0.0, 9.0, 9.0, WALL, ALIVE | PRESENT | READY);
        upsert(&mut world, 6, 1.0, 9.0, 10.0, WALL, 0);
        assert_eq!(query(&mut world, 0.0, READY, [PALACE as i32, -1, -1, -1]), vec![1.0, 2.0]);
        assert_eq!(query(&mut world, f64::NAN, 0, [WALL as i32, PALISADE as i32, -1, -1]), vec![5.0, 6.0]);
        assert_eq!(query(&mut world, 0.0, READY, [-1; 4]), vec![1.0, 2.0, 3.0, 5.0]);
        let arc = |world: &World, cell: f64| world.resource::<StructureIndex>().arc_cell(cell);
        let solid = |world: &World, x: f64, y: f64| world.resource::<StructureIndex>().solid_at(x, y);
        assert!(arc(&world, 9.0 * 40.0 + 9.0) && arc(&world, 10.0 * 40.0 + 9.0));
        upsert(&mut world, 7, 0.0, 9.0, 9.0, WOODEN_TOWER, ALIVE | PRESENT);
        assert!(!arc(&world, 9.0 * 40.0 + 9.0));
        assert!(solid(&world, 5.0, 5.0) && solid(&world, 9.0, 9.0) && !solid(&world, 9.0, 10.0) && !solid(&world, 6.0, 5.0));
        refresh(&mut world);
        assert_eq!(defenses(&mut world, 1), vec![3.0, 7.0]);
        assert_eq!(defenses(&mut world, 2), vec![4.0]);
        upsert(&mut world, 2, 0.0, 20.0, 4.0, PALACE, 0);
        assert_eq!(defenses(&mut world, 2), vec![4.0]);
        refresh(&mut world);
        assert_eq!(defenses(&mut world, 1), vec![3.0, 4.0, 7.0]);
        assert!(!solid(&world, 20.0, 4.0));
    }

    #[test]
    fn clearing_unpublishes_rows_but_keeps_the_entities() {
        let mut world = world();
        upsert(&mut world, 1, 0.0, 4.0, 4.0, PALACE, ALIVE | PRESENT | READY);
        world.resource_scope(|world, mut index: Mut<StructureIndex>| index.clear(world, 64));
        assert_eq!(query(&mut world, f64::NAN, 0, [-1; 4]), Vec::<f64>::new());
        assert!(world.resource::<EntityTables>().buildings.contains(1));
        upsert(&mut world, 1, 0.0, 4.0, 4.0, PALACE, ALIVE | PRESENT | READY);
        assert_eq!(query(&mut world, 0.0, READY, [-1; 4]), vec![1.0]);
        assert!(world.resource::<StructureIndex>().solid_at(5.0, 5.0));
    }
}
