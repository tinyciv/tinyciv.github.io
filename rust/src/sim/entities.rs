//! Entity authority for one game: lifetime, array order, sleeping, role
//! membership and ID allocation for units and buildings.
//!
//! Every unit and building is a bevy entity in the simulation World. The host
//! keeps the serializable view objects and publishes the scalars a role
//! depends on; which roles those scalars imply is decided here. Array order
//! is registration order (the host arrays are appended to and compacted in
//! the same order), so ordered role views never sort.
use bevy_ecs::prelude::*;
use rustc_hash::FxHashMap;
use std::collections::BTreeMap;

use super::kinds::{building, unit};

pub const ROLE_COUNT: usize = 13;
pub const UNITS: u32 = 0;
pub const BUILDINGS: u32 = 1;
/// Returned by `remove` when the ID is not registered.
pub const MISSING: u32 = u32::MAX;

// Unit role bits.
pub const UNIT: u32 = 1;
pub const WORKER: u32 = 1 << 1;
pub const BUILDER: u32 = 1 << 2;
pub const COLLECTOR: u32 = 1 << 3;
pub const SOLDIER: u32 = 1 << 4;
pub const LEADER: u32 = 1 << 5;
pub const RETINUE: u32 = 1 << 6;
pub const ACTIVE: u32 = 1 << 7;
pub const WILDLIFE: u32 = 1 << 8;
pub const WOUNDED: u32 = 1 << 9;
pub const DAMAGE_CLOCK: u32 = 1 << 10;
pub const COLLISION: u32 = 1 << 11;
/// Role changes that advance the unit membership revision. Scheduling
/// (active), wounds and damage clocks are not membership.
const UNIT_REVISION_MASK: u32 = 127 | WILDLIFE | COLLISION | (1 << 12);

// Building role bits.
pub const BUILDING: u32 = 1;
pub const PALACE: u32 = 1 << 1;
pub const FARM: u32 = 1 << 2;
pub const CONSTRUCTION: u32 = 1 << 3;
pub const LIBRARY: u32 = 1 << 4;
pub const MONUMENT: u32 = 1 << 5;
pub const HEALER_SHACK: u32 = 1 << 6;
pub const BALLISTA: u32 = 1 << 7;
pub const SCOUT_LODGE: u32 = 1 << 8;
pub const SUPPLY_DEPOT: u32 = 1 << 9;
pub const TOWER_WEAPON: u32 = 1 << 10;
pub const IRRIGATION: u32 = 1 << 11;

// Host-published unit flags.
pub const FLAG_BUILDER: u32 = 1;
pub const FLAG_COLLECTOR: u32 = 2;
pub const FLAG_ENGINEER: u32 = 4;
/// The damage clock has not been initialized (no finite last-damage time).
pub const FLAG_DAMAGE_CLOCK_UNSET: u32 = 8;
/// The unit carries no explicit maximum; its kind decides.
pub const FLAG_MAX_HP_UNSET: u32 = 16;

#[derive(Component, Clone, Copy, Debug, PartialEq, Eq)]
pub struct SimId(pub i64);
/// Registration sequence: the entity's position in host array order.
#[derive(Component, Clone, Copy, Debug, PartialEq, Eq)]
pub struct Sequence(pub u64);
#[derive(Component, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Roles(pub u32);
#[derive(Component)]
pub struct UnitRow;
#[derive(Component)]
pub struct BuildingRow;
/// Excluded from the ordered active view until woken.
#[derive(Component)]
pub struct Sleeping;
#[derive(Component, Clone, Copy, Debug, PartialEq)]
pub struct UnitTraits { pub kind: u32, pub flags: u32, pub hp: f64, pub max_hp: f64 }
#[derive(Component, Clone, Copy, Debug, PartialEq, Eq)]
pub struct BuildingTraits { pub kind: u32, pub construction: bool }

pub fn unit_roles(traits: &UnitTraits, sleeping: bool) -> u32 {
    let kind = traits.kind;
    let max_hp = if traits.flags & FLAG_MAX_HP_UNSET != 0 { unit::default_max_hp(kind) } else { traits.max_hp };
    let mut mask = UNIT;
    if kind == unit::WORKER { mask |= WORKER; }
    if traits.flags & FLAG_BUILDER != 0 { mask |= BUILDER; }
    if traits.flags & FLAG_COLLECTOR != 0 { mask |= COLLECTOR; }
    if unit::soldier(kind) { mask |= SOLDIER; }
    if kind == unit::LEADER { mask |= LEADER; }
    if kind == unit::SAILBOAT { mask |= 1 << 12; }
    if unit::retinue(kind) { mask |= RETINUE; }
    if !sleeping { mask |= ACTIVE; }
    if kind == unit::BOAR || kind == unit::MARSH_BIRD { mask |= WILDLIFE; }
    if traits.hp > 0.0 && traits.hp < max_hp { mask |= WOUNDED; }
    if traits.flags & FLAG_DAMAGE_CLOCK_UNSET != 0 { mask |= DAMAGE_CLOCK; }
    if !unit::civilian(kind, traits.flags & FLAG_ENGINEER != 0) { mask |= COLLISION; }
    mask
}

pub fn building_roles(traits: &BuildingTraits) -> u32 {
    let kind = traits.kind;
    let mut mask = BUILDING;
    if kind == building::PALACE { mask |= PALACE; }
    if kind == building::SHIPYARD { mask |= 1 << 12; }
    if building::farm(kind) { mask |= FARM; }
    if traits.construction { mask |= CONSTRUCTION; }
    if kind == building::LIBRARY { mask |= LIBRARY; }
    if kind == building::MONUMENT { mask |= MONUMENT; }
    if kind == building::HEALER_SHACK { mask |= HEALER_SHACK; }
    if matches!(kind, building::BALLISTA | building::SIEGE_CANNON) { mask |= BALLISTA; }
    if kind == building::SCOUT_LODGE { mask |= SCOUT_LODGE; }
    if kind == building::SUPPLY_DEPOT { mask |= SUPPLY_DEPOT; }
    if matches!(kind, building::WOODEN_TOWER | building::TOWER | building::FORT | building::PALACE) { mask |= TOWER_WEAPON; }
    if kind == building::IRRIGATION { mask |= IRRIGATION; }
    mask
}

#[derive(Clone, Copy)]
struct Row { entity: Entity, mask: u32, sequence: u64 }

/// One ordered entity collection (units or buildings).
pub struct Table {
    rows: FxHashMap<i64, Row>,
    /// Registration sequence to ID: host array order.
    ordered: BTreeMap<u64, i64>,
    next_sequence: u64,
    counts: [u32; ROLE_COUNT],
    /// Cached ordered views: [count, ids...] per role, and the whole table.
    views: [Vec<f64>; ROLE_COUNT],
    stale: [bool; ROLE_COUNT],
    order: Vec<f64>,
    order_stale: bool,
    revision: f64,
    revision_mask: u32,
}
impl Table {
    fn new(revision_mask: u32) -> Self {
        Self { rows: FxHashMap::default(), ordered: BTreeMap::new(), next_sequence: 0, counts: [0; ROLE_COUNT],
            views: std::array::from_fn(|_| vec![0.0]), stale: [false; ROLE_COUNT], order: vec![0.0], order_stale: false,
            revision: 0.0, revision_mask }
    }
    pub fn len(&self) -> usize { self.rows.len() }
    pub fn contains(&self, id: i64) -> bool { self.rows.contains_key(&id) }
    /// The entity and registration sequence of a registered ID.
    pub fn locate(&self, id: i64) -> Option<(Entity, u64)> { self.rows.get(&id).map(|row| (row.entity, row.sequence)) }
    pub fn revision(&self) -> f64 { self.revision }
    /// A wholesale replacement is a membership change even when the rows match.
    pub fn touch(&mut self) { self.revision += 1.0; }
    pub fn count(&self, role: usize) -> u32 { self.counts[role] }
    pub fn ids(&self) -> impl Iterator<Item = i64> + '_ { self.rows.keys().copied() }

    fn insert(&mut self, id: i64, entity: Entity) -> u64 {
        let sequence = self.next_sequence;
        self.next_sequence += 1;
        self.rows.insert(id, Row { entity, mask: 0, sequence });
        self.ordered.insert(sequence, id);
        self.order_stale = true;
        sequence
    }
    /// Applies a recomputed mask and returns the changed role bits.
    fn set_mask(&mut self, id: i64, mask: u32, track_revision: bool) -> u32 {
        let Some(row) = self.rows.get_mut(&id) else { return 0; };
        let changed = row.mask ^ mask;
        row.mask = mask;
        for bit in 0..ROLE_COUNT {
            if changed & (1 << bit) == 0 { continue; }
            if mask & (1 << bit) != 0 { self.counts[bit] += 1; } else { self.counts[bit] -= 1; }
            self.stale[bit] = true;
        }
        if track_revision && changed & self.revision_mask != 0 { self.revision += 1.0; }
        changed
    }
    fn remove(&mut self, id: i64) -> Option<Row> {
        let row = self.rows.remove(&id)?;
        self.ordered.remove(&row.sequence);
        for bit in 0..ROLE_COUNT {
            if row.mask & (1 << bit) != 0 { self.counts[bit] -= 1; self.stale[bit] = true; }
        }
        self.order_stale = true;
        self.revision += 1.0;
        Some(row)
    }
    /// IDs holding a role, in array order: [count, ids...].
    pub fn view(&mut self, role: usize) -> &[f64] {
        if self.stale[role] {
            self.stale[role] = false;
            let view = &mut self.views[role];
            view.clear(); view.push(0.0);
            for id in self.ordered.values() { if self.rows[id].mask & (1 << role) != 0 { view.push(*id as f64); } }
            view[0] = (view.len() - 1) as f64;
        }
        &self.views[role]
    }
    /// Every ID in array order: [count, ids...].
    pub fn order(&mut self) -> &[f64] {
        if self.order_stale {
            self.order_stale = false;
            self.order.clear(); self.order.push(0.0);
            self.order.extend(self.ordered.values().map(|id| *id as f64));
            self.order[0] = (self.order.len() - 1) as f64;
        }
        &self.order
    }
}

/// Both collections and the shared ID allocator.
#[derive(Resource)]
pub struct EntityTables {
    pub units: Table,
    pub buildings: Table,
    /// Unset until the first allocation scans the registered IDs, exactly as
    /// the host allocator did: IDs removed before that scan may be reused,
    /// later removals never are.
    next_id: Option<i64>,
}
impl Default for EntityTables {
    fn default() -> Self { Self { units: Table::new(UNIT_REVISION_MASK), buildings: Table::new(u32::MAX), next_id: None } }
}
impl EntityTables {
    pub fn table(&self, table: u32) -> &Table { if table == UNITS { &self.units } else { &self.buildings } }
    pub fn table_mut(&mut self, table: u32) -> &mut Table { if table == UNITS { &mut self.units } else { &mut self.buildings } }
    fn reserve(&mut self, id: i64) { if let Some(next) = self.next_id.as_mut() { *next = (*next).max(id.saturating_add(1)); } }
    pub fn peek_id(&mut self) -> i64 {
        if let Some(next) = self.next_id { return next; }
        let next = self.units.ids().chain(self.buildings.ids()).fold(1, |next, id| next.max(id.saturating_add(1)));
        self.next_id = Some(next);
        next
    }
    pub fn allocate_id(&mut self, minimum: i64) -> i64 {
        let id = self.peek_id().max(minimum);
        self.next_id = Some(id.saturating_add(1));
        id
    }
}

/// Commands on the simulation World. Each returns what the host needs to
/// refresh its cached views: the changed (or removed) role bits.
pub fn insert(world: &mut World, table: u32, id: i64) -> bool {
    if world.resource::<EntityTables>().table(table).contains(id) { return false; }
    let entity = if table == UNITS { world.spawn((SimId(id), Roles(0), UnitRow)).id() }
        else { world.spawn((SimId(id), Roles(0), BuildingRow)).id() };
    let mut tables = world.resource_mut::<EntityTables>();
    let sequence = tables.table_mut(table).insert(id, entity);
    tables.reserve(id);
    world.entity_mut(entity).insert(Sequence(sequence));
    true
}

/// Removes a row and returns its role bits, or `MISSING`.
pub fn remove(world: &mut World, table: u32, id: i64) -> u32 {
    let Some(row) = world.resource_mut::<EntityTables>().table_mut(table).remove(id) else { return MISSING; };
    world.despawn(row.entity);
    row.mask
}

fn apply_mask(world: &mut World, table: u32, id: i64, entity: Entity, mask: u32, track_revision: bool) -> u32 {
    let changed = world.resource_mut::<EntityTables>().table_mut(table).set_mask(id, mask, track_revision);
    if changed != 0 { world.entity_mut(entity).insert(Roles(mask)); }
    changed
}

/// Publishes the scalars unit roles depend on. `sleeping`: -1 keeps the
/// current scheduling state, 0 wakes, 1 puts the unit to sleep.
pub fn unit_traits(world: &mut World, id: i64, traits: UnitTraits, sleeping: i32, track_revision: bool) -> u32 {
    let Some((entity, _)) = world.resource::<EntityTables>().units.locate(id) else { return 0; };
    let mut row = world.entity_mut(entity);
    let asleep = match sleeping { 0 => false, 1 => true, _ => row.contains::<Sleeping>() };
    if sleeping == 1 { row.insert(Sleeping); } else if sleeping == 0 { row.remove::<Sleeping>(); }
    row.insert(traits);
    apply_mask(world, UNITS, id, entity, unit_roles(&traits, asleep), track_revision)
}

pub fn unit_sleeping(world: &World, id: i64) -> bool {
    world.resource::<EntityTables>().units.locate(id).is_some_and(|(entity, _)| world.entity(entity).contains::<Sleeping>())
}

pub fn building_traits(world: &mut World, id: i64, traits: BuildingTraits, track_revision: bool) -> u32 {
    let Some((entity, _)) = world.resource::<EntityTables>().buildings.locate(id) else { return 0; };
    world.entity_mut(entity).insert(traits);
    apply_mask(world, BUILDINGS, id, entity, building_roles(&traits), track_revision)
}

/// Drops every row of both collections and forgets the allocator scan (a new
/// host store is importing a state).
pub fn reset(world: &mut World) {
    let tables = std::mem::take(&mut *world.resource_mut::<EntityTables>());
    for row in tables.units.rows.values().chain(tables.buildings.rows.values()) { world.despawn(row.entity); }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn world() -> World { let mut world = World::new(); world.init_resource::<EntityTables>(); world }
    fn traits(kind: u32, flags: u32) -> UnitTraits { UnitTraits { kind, flags, hp: 100.0, max_hp: 100.0 } }
    fn unit(world: &mut World, id: i64, kind: u32, flags: u32) -> u32 {
        assert!(insert(world, UNITS, id));
        unit_traits(world, id, traits(kind, flags), -1, true)
    }
    fn view(world: &mut World, table: u32, role: u32) -> Vec<f64> {
        let mut tables = world.resource_mut::<EntityTables>();
        let view = tables.table_mut(table).view(role.trailing_zeros() as usize);
        view[1..].to_vec()
    }

    #[test]
    fn role_views_keep_registration_order_through_removal_and_reinsertion() {
        let mut world = world();
        unit(&mut world, 9, unit::WARRIOR, 0); unit(&mut world, 2, unit::WORKER, FLAG_BUILDER); unit(&mut world, 4, unit::ARCHER, 0);
        assert!(!insert(&mut world, UNITS, 9));
        assert_eq!(view(&mut world, UNITS, UNIT), vec![9.0, 2.0, 4.0]);
        assert_eq!(view(&mut world, UNITS, SOLDIER), vec![9.0, 4.0]);
        assert_eq!(view(&mut world, UNITS, BUILDER), vec![2.0]);
        let removed = remove(&mut world, UNITS, 9);
        assert_eq!(removed & (SOLDIER | RETINUE | COLLISION | ACTIVE), SOLDIER | RETINUE | COLLISION | ACTIVE);
        assert_eq!(remove(&mut world, UNITS, 9), MISSING);
        unit(&mut world, 9, unit::WARRIOR, 0);
        assert_eq!(view(&mut world, UNITS, SOLDIER), vec![4.0, 9.0]);
        let mut tables = world.resource_mut::<EntityTables>();
        assert_eq!(tables.units.order()[1..], [2.0, 4.0, 9.0]);
        assert_eq!(tables.units.count(SOLDIER.trailing_zeros() as usize), 2);
    }

    #[test]
    fn unit_roles_follow_kind_flags_health_and_sleep() {
        let mut world = world();
        let changed = unit(&mut world, 1, unit::WORKER, FLAG_COLLECTOR);
        assert_eq!(changed, UNIT | WORKER | COLLECTOR | ACTIVE);
        // Engineers collide; ordinary civilians do not.
        assert_eq!(unit_traits(&mut world, 1, traits(unit::WORKER, FLAG_COLLECTOR | FLAG_ENGINEER), -1, true), COLLISION);
        assert_eq!(unit_traits(&mut world, 1, UnitTraits { hp: 40.0, ..traits(unit::WORKER, FLAG_COLLECTOR | FLAG_ENGINEER) }, -1, true), WOUNDED);
        // No explicit maximum: a worker is whole at 50.
        let unset = UnitTraits { kind: unit::WORKER, flags: FLAG_MAX_HP_UNSET, hp: 50.0, max_hp: f64::NAN };
        assert_eq!(unit_roles(&unset, false) & WOUNDED, 0);
        assert_eq!(unit_roles(&UnitTraits { hp: 49.0, ..unset }, false) & WOUNDED, WOUNDED);
        assert_eq!(unit_roles(&UnitTraits { kind: unit::WARRIOR, hp: 60.0, ..unset }, false) & WOUNDED, WOUNDED);
        assert_eq!(unit_traits(&mut world, 1, traits(unit::WORKER, 0), 1, false), COLLECTOR | ACTIVE | WOUNDED | COLLISION);
        assert!(unit_sleeping(&world, 1));
        assert_eq!(view(&mut world, UNITS, ACTIVE), Vec::<f64>::new());
        assert_eq!(unit_traits(&mut world, 1, traits(unit::BOAR, FLAG_DAMAGE_CLOCK_UNSET), 0, true), WORKER | ACTIVE | WILDLIFE | DAMAGE_CLOCK | COLLISION);
        assert!(!unit_sleeping(&world, 1));
        assert_eq!(unit_roles(&traits(unit::SLINGER, 0), false), UNIT | SOLDIER | ACTIVE | COLLISION);
        assert_eq!(unit_roles(&traits(unit::LEADER, 0), false), UNIT | LEADER | ACTIVE | COLLISION);
        assert_eq!(unit_roles(&traits(unit::SCOUT, 0), false), UNIT | ACTIVE);
        assert_eq!(unit_roles(&traits(unit::DEER, 0), false), UNIT | ACTIVE | COLLISION);
    }

    #[test]
    fn membership_revisions_ignore_scheduling_wounds_and_damage_clocks() {
        let mut world = world();
        unit(&mut world, 1, unit::WARRIOR, 0);
        let revision = |world: &World| world.resource::<EntityTables>().units.revision();
        let start = revision(&world);
        unit_traits(&mut world, 1, UnitTraits { hp: 20.0, ..traits(unit::WARRIOR, FLAG_DAMAGE_CLOCK_UNSET) }, 1, true);
        assert_eq!(revision(&world), start);
        unit_traits(&mut world, 1, traits(unit::WORKER, 0), -1, false);
        assert_eq!(revision(&world), start, "untracked updates never advance the revision");
        unit_traits(&mut world, 1, traits(unit::ARCHER, 0), -1, true);
        assert_eq!(revision(&world), start + 1.0);
        remove(&mut world, UNITS, 1);
        assert_eq!(revision(&world), start + 2.0);
    }

    #[test]
    fn building_roles_follow_kind_and_construction() {
        let mut world = world();
        assert!(insert(&mut world, BUILDINGS, 7));
        assert_eq!(building_traits(&mut world, 7, BuildingTraits { kind: building::PALACE, construction: true }, true),
            BUILDING | PALACE | CONSTRUCTION | TOWER_WEAPON);
        assert_eq!(building_traits(&mut world, 7, BuildingTraits { kind: building::PALACE, construction: false }, true), CONSTRUCTION);
        assert_eq!(building_traits(&mut world, 7, BuildingTraits { kind: building::COTTAGE, construction: false }, true), PALACE | FARM | TOWER_WEAPON);
        assert_eq!(building_roles(&BuildingTraits { kind: building::FORT, construction: false }), BUILDING | TOWER_WEAPON);
        assert_eq!(building_roles(&BuildingTraits { kind: building::TOWER, construction: false }), BUILDING | TOWER_WEAPON);
        assert_eq!(world.resource::<EntityTables>().buildings.revision(), 3.0);
    }

    #[test]
    fn allocation_scans_once_then_never_reuses_and_ignores_speculative_ids() {
        let mut world = world();
        unit(&mut world, 40, unit::WARRIOR, 0); unit(&mut world, 12, unit::WARRIOR, 0);
        assert!(insert(&mut world, BUILDINGS, 25)); assert!(insert(&mut world, BUILDINGS, -999));
        // A removal before the first scan frees its ID, as in the host allocator.
        remove(&mut world, UNITS, 40);
        let mut tables = world.resource_mut::<EntityTables>();
        assert_eq!(tables.peek_id(), 26);
        assert_eq!(tables.allocate_id(1), 26);
        assert_eq!(tables.allocate_id(100), 100);
        assert_eq!(tables.peek_id(), 101);
        drop(tables);
        unit(&mut world, 500, unit::WARRIOR, 0);
        remove(&mut world, UNITS, 500);
        assert!(insert(&mut world, BUILDINGS, -5));
        assert_eq!(world.resource_mut::<EntityTables>().allocate_id(1), 501);
        assert!(insert(&mut world, UNITS, 9_007_199_254_740_991));
        assert_eq!(world.resource_mut::<EntityTables>().peek_id(), 9_007_199_254_740_992);
    }

    #[test]
    fn reset_drops_rows_and_restarts_the_allocator_scan() {
        let mut world = world();
        unit(&mut world, 3, unit::WARRIOR, 0); assert!(insert(&mut world, BUILDINGS, 8));
        world.resource_mut::<EntityTables>().allocate_id(50);
        reset(&mut world);
        assert_eq!(world.resource::<EntityTables>().units.len() + world.resource::<EntityTables>().buildings.len(), 0);
        assert_eq!(world.query::<&SimId>().iter(&world).count(), 0);
        unit(&mut world, 3, unit::WARRIOR, 0);
        assert_eq!(world.resource_mut::<EntityTables>().peek_id(), 4);
        assert_eq!(world.resource::<EntityTables>().units.revision(), 1.0);
    }
}
