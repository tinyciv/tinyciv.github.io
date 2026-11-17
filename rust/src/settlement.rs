//! Settlement engine: cities, villages and seceded cities as resident Bevy
//! entities. Owns affiliation (loyalty is the affiliation toward the owner),
//! village diplomacy and the hostility matrix, confederation decisions,
//! village evolution (stages, layout slots, adoption, recruitment, claims) and
//! the saved snapshot. The host only encodes inputs and applies decided
//! effects: approved building placements, unit spawns and ownership transfers.
use bevy_ecs::prelude::*;
use bevy_ecs::schedule::SingleThreadedExecutor;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use crate::affiliation::{self as af, SLOTS, OTHER_SLOT, TARGET_SLOTS};
use crate::cadence::next_deadline;
use crate::village_plan::{self as plan, SlotKind};

pub const FACTION_STRIDE: usize = 8;
pub const UPSERT_STRIDE: usize = 12;
pub const CIVIC_STRIDE: usize = 9;
pub const RESULT_STRIDE: usize = 4;
pub const CHANGED_STRIDE: usize = 14;
pub const EVENT_STRIDE: usize = 4;
pub const REQUEST_STRIDE: usize = 10;
pub const SPAWN_STRIDE: usize = 6;
pub const CHARGE_STRIDE: usize = 4;
pub const BREAKDOWN_STRIDE: usize = 12;
pub const STATUS_LENGTH: usize = 21;
pub const HEADER: usize = 8;

/// Tuned so an untraded village reaches stage 2 in about 15–20 minutes.
pub const VILLAGE_BASE_INCOME: f64 = 0.2;
pub const VILLAGE_START_TREASURY: f64 = 120.0;
pub const GROWTH_INTERVAL: f64 = 90.0;
pub const RECRUIT_INTERVAL: f64 = 90.0;
pub const ADOPT_INTERVAL: f64 = 60.0;
pub const AI_INTERVAL: f64 = 90.0;
pub const GROWTH_BUDGET: u8 = 4;
pub const MAX_OUTSTANDING: usize = 4;
pub const MAX_TRANSIENT: u8 = 5;
pub const ADOPTION_RADIUS: f64 = 40.0;
pub const ADOPTION_THRESHOLD: f64 = 0.6;
pub const GUARD_COST: f64 = 40.0;
pub const SECTOR: i32 = 8;

pub const K_HOUSE: u8 = 1; pub const K_WELL: u8 = 2; pub const K_GUARD_POST: u8 = 3; pub const K_WOODEN_TOWER: u8 = 4;
pub const K_TOWER: u8 = 5; pub const K_FORT: u8 = 6; pub const K_MONUMENT: u8 = 7; pub const K_LIBRARY: u8 = 8;
pub const K_BLACKSMITH: u8 = 9; pub const K_ARCHERY: u8 = 10; pub const K_STABLE: u8 = 11; pub const K_SCOUT: u8 = 12;
pub const K_HEALER: u8 = 13; pub const K_DOCK: u8 = 14; pub const K_DEPOT: u8 = 15; pub const K_PALACE: u8 = 16;
#[allow(dead_code)] pub const K_TENT: u8 = 17; pub const K_ROAD: u8 = 18; pub const K_UPGRADE: u8 = 255;

pub const CITY: u8 = 1; pub const VILLAGE: u8 = 2; pub const SECEDED: u8 = 3;
pub const EV_SECEDE: u8 = 1; pub const EV_PETITION: u8 = 2; pub const EV_STAGE: u8 = 3; pub const EV_ADOPTED: u8 = 4;
pub const EV_RELATION: u8 = 5; pub const EV_AI_CONFEDERATE: u8 = 6; pub const EV_SLOT_SKIPPED: u8 = 7; pub const EV_AI_TRADE: u8 = 8;
pub const NEUTRAL: u8 = 0; pub const TRADE: u8 = 1; pub const ALLIED: u8 = 2; pub const WAR: u8 = 3;
pub const F_DEFEATED: u32 = 1; pub const F_HUMAN: u32 = 2; pub const F_VILLAGE: u32 = 4; pub const F_CONFEDERATED: u32 = 8; pub const F_MULTIPLAYER: u32 = 16;
pub const A_TRADE: u32 = 1; pub const A_ALLY: u32 = 2; pub const A_CONFEDERATE: u32 = 3; pub const A_WAR: u32 = 4; pub const A_PETITION: u32 = 5;
pub const R_NEAR: u32 = 1; pub const R_REMOTE: u32 = 2; pub const R_LEADER: u32 = 4; pub const R_REALM: u32 = 8; pub const R_AI: u32 = 16;
pub const OK: u32 = 0; pub const NO_REALM: u32 = 1; pub const NO_LEADER: u32 = 2; pub const NO_REACH: u32 = 3; pub const ALREADY_TRADING: u32 = 4;
pub const AT_WAR: u32 = 5; pub const ALREADY_ALLIED: u32 = 6; pub const ALREADY_WAR: u32 = 7; pub const NEED_GOLD: u32 = 8;
pub const LOW_AFFILIATION: u32 = 9; pub const NEEDS_ALLIANCE: u32 = 10; pub const COOLDOWN: u32 = 11; pub const NO_CAMP: u32 = 12;
pub const NO_PETITION: u32 = 13; pub const REFUSED: u32 = 14; pub const NOT_VILLAGE: u32 = 15;
pub const T_SECEDE: u32 = 1; pub const T_CAPTURE: u32 = 2; pub const T_CONFEDERATE_VILLAGE: u32 = 3; pub const T_CONFEDERATE_CIV: u32 = 4;
pub const B_TRANSIENT: u32 = 2; pub const B_SIBLING: u32 = 6;
pub const S_PENDING: u8 = 0; pub const S_BUILT: u8 = 1; pub const S_SKIPPED: u8 = 2; pub const S_CONVERTED: u8 = 3;
pub const FL_WARNING: u32 = 1; pub const FL_GRACE: u32 = 2; pub const FL_SECEDE: u32 = 4; pub const FL_PETITION: u32 = 8; pub const FL_REMOVED: u32 = 16;
const NONE: i32 = i32::MIN;
const SNAPSHOT_MAGIC: f64 = 24183.0; // 0x5E77
const SNAPSHOT_VERSION: f64 = 1.0;

pub fn constant(index: u32) -> f64 {
    match index {
        0..=99 => af::constant(index),
        100 => FACTION_STRIDE as f64, 101 => UPSERT_STRIDE as f64, 102 => CIVIC_STRIDE as f64, 103 => RESULT_STRIDE as f64,
        104 => CHANGED_STRIDE as f64, 105 => EVENT_STRIDE as f64, 106 => REQUEST_STRIDE as f64, 107 => SPAWN_STRIDE as f64,
        108 => CHARGE_STRIDE as f64, 109 => BREAKDOWN_STRIDE as f64, 110 => VILLAGE_BASE_INCOME, 111 => GROWTH_INTERVAL,
        112 => ADOPT_INTERVAL, 113 => plan::PATCH as f64, 114 => STATUS_LENGTH as f64, 115 => HEADER as f64,
        _ => f64::NAN,
    }
}
pub fn kind_size(kind: u8) -> (i32, i32) { match kind { K_FORT => (3, 3), K_LIBRARY | K_PALACE => (2, 2), K_ARCHERY | K_DEPOT => (2, 1), _ => (1, 1) } }
fn build_cost(kind: u8) -> f64 {
    match kind { K_ROAD => 3.0, K_HOUSE => 40.0, K_WELL => 30.0, K_GUARD_POST => 120.0, K_WOODEN_TOWER => 100.0,
        K_LIBRARY => 200.0, K_MONUMENT => 250.0, K_DOCK => 120.0, _ => 150.0 }
}
fn advanced(kind: u8) -> bool { matches!(kind, K_LIBRARY | K_BLACKSMITH | K_ARCHERY | K_STABLE | K_SCOUT | K_HEALER | K_DOCK | K_DEPOT | K_FORT) }
/// Adoptable kinds: (kind, minimum stage, uses a lot).
const ADOPTABLE: [(u8, u8, bool); 9] = [(K_WOODEN_TOWER, 3, false), (K_LIBRARY, 2, true), (K_BLACKSMITH, 2, true), (K_HEALER, 2, true),
    (K_DOCK, 2, false), (K_MONUMENT, 3, true), (K_SCOUT, 3, true), (K_STABLE, 3, true), (K_ARCHERY, 3, true)];
const ADOPTION_CAP: [u8; 5] = [0, 0, 1, 2, 4];
const STAGE_GATES: [(f64, f64, f64); 5] = [(0.0, 0.0, 0.0), (300.0, 4.0, 1.0), (900.0, 7.0, 0.8), (1500.0, 11.0, 0.8), (2400.0, 15.0, 0.8)];
const HOUSE_TARGET: [u8; 5] = [1, 1, 2, 3, 3];
fn identity_bonus(identity: u8) -> [f64; 4] { match identity { 0 => [0.1, 0.0, 0.0, 0.0], 1 => [0.0, 0.15, 0.0, 0.0], 2 => [0.0, 0.0, 0.15, 0.0], 3 => [0.0, 0.0, 0.0, 0.15], _ => [0.0; 4] } }

// ---------------------------------------------------------------- components

#[derive(Component, Clone, Debug)]
struct Site { id: i64, kind: u8, owner: i32, x: f64, y: f64, population: f64, guards: f64, founded_at: f64,
    village_id: i32, identity: u8, ready: bool, removed: bool, activated: bool }
impl Site { fn live(&self) -> bool { self.ready && !self.removed && self.activated } }
#[derive(Component, Clone, Debug)]
struct Heritage { civ: i8, kin: i8, former_owner: i32 }
#[derive(Component, Clone, Debug)]
struct Affiliation {
    value: [f64; SLOTS], target: [f64; SLOTS], rate: [f64; SLOTS], alignment: [f64; SLOTS], base: [f64; SLOTS],
    trade: [f64; SLOTS], exposure: [f64; SLOTS], protector: [f64; SLOTS], snub: [f64; SLOTS], init: u32,
    hostile_exposure: f64, grace_until: f64, warning: bool, secede_pending: bool, owner_slot: i32,
    threat: f64, protection: f64, governance: f64, independence: f64,
}
impl Default for Affiliation {
    fn default() -> Self { Self { value: [0.0; SLOTS], target: [0.0; SLOTS], rate: [0.0; SLOTS], alignment: [0.0; SLOTS], base: [0.0; SLOTS],
        trade: [0.0; SLOTS], exposure: [0.0; SLOTS], protector: [0.0; SLOTS], snub: [0.0; SLOTS], init: 0, hostile_exposure: 0.0,
        grace_until: 0.0, warning: false, secede_pending: false, owner_slot: -1, threat: 0.0, protection: 0.0, governance: 0.0, independence: 0.0 } }
}
#[derive(Component, Clone, Default, Debug)]
struct Civic { guard_posts: f64, towers: f64, forts: f64, advanced: f64, monument: bool, houses: f64, house_levels: f64, nearest: Option<f64> }
#[derive(Component, Clone, Default, Debug)]
struct Presence { slot: [f64; SLOTS], hostile: f64, friendly: f64, hostiles: Vec<i64> }
#[derive(Component, Clone, Debug)]
struct Village {
    stage: u8, family: u8, transform: u8, lot: (i32, i32), treasury: f64, reserved: f64, lifetime_income: f64,
    relations: [u8; SLOTS], trading: u16, lifetime_trade: [f64; SLOTS], cooldown_until: [f64; SLOTS], relations_revision: u32,
    petition_slot: i32, petition_since: f64, petition_open_until: f64, petition_next: f64,
    next_growth_at: f64, next_recruit_at: f64, next_adopt_at: f64, budget: u8,
}
impl Default for Village {
    fn default() -> Self { Self { stage: 0, family: plan::FAMILY_NONE, transform: 0, lot: (0, 0), treasury: VILLAGE_START_TREASURY, reserved: 0.0,
        lifetime_income: 0.0, relations: [NEUTRAL; SLOTS], trading: 0, lifetime_trade: [0.0; SLOTS], cooldown_until: [0.0; SLOTS], relations_revision: 1,
        petition_slot: -1, petition_since: f64::NAN, petition_open_until: f64::NAN, petition_next: 0.0,
        next_growth_at: f64::NAN, next_recruit_at: f64::NAN, next_adopt_at: f64::NAN, budget: 0 } }
}
impl Village { fn ally(&self) -> Option<usize> { self.relations.iter().position(|&r| r == ALLIED) } }
#[derive(Component, Clone, Default, Debug)]
struct Plan { status: Vec<u8>, alternate: Vec<u8>, retries: Vec<u8>, rearmed: Vec<u8>, adopted: u32, adopted_from: [i32; 16],
    lots: [u8; 4], claim: Vec<i64>, claim_revision: u32, claim_dirty: bool, outstanding: bool, failed_upgrades: BTreeSet<i64> }
#[derive(Component, Clone, Debug)]
struct Published([f64; CHANGED_STRIDE]);

// ---------------------------------------------------------------- resources

#[derive(Clone, Copy, Default, Debug)]
struct FactionRow { civ: i8, flags: u32, gold: f64, population: f64, village_id: i32, relation: u8, achievements: u32 }
#[derive(Resource)]
struct Factions { rows: BTreeMap<i32, FactionRow>, slots: [i32; SLOTS], revision: u64, civ_war: BTreeSet<(i32, i32)>, next_ai_at: BTreeMap<i32, f64> }
impl Default for Factions { fn default() -> Self { Self { rows: BTreeMap::new(), slots: [NONE; SLOTS], revision: 1, civ_war: BTreeSet::new(), next_ai_at: BTreeMap::new() } } }
impl Factions {
    fn slot(&self, id: i32) -> Option<usize> { if id < 0 { None } else { self.slots[..TARGET_SLOTS].iter().position(|&f| f == id) } }
    fn row(&self, id: i32) -> FactionRow { self.rows.get(&id).copied().unwrap_or_default() }
    fn civ(&self, id: i32) -> i8 { self.rows.get(&id).map_or(-1, |row| row.civ) }
    fn human(&self, id: i32) -> bool { self.row(id).flags & F_HUMAN != 0 }
    fn multiplayer(&self) -> bool { self.rows.values().any(|row| row.flags & F_MULTIPLAYER != 0) }
    fn active(&self, slot: usize) -> Option<i32> {
        let id = self.slots[slot];
        let row = self.rows.get(&id)?;
        (id != NONE && row.flags & (F_DEFEATED | F_CONFEDERATED | F_VILLAGE) == 0 && row.relation != 3).then_some(id)
    }
    fn civ_hostile(&self, a: i32, b: i32) -> bool {
        if a == 0 { return self.row(b).relation == 2; }
        if b == 0 { return self.row(a).relation == 2; }
        self.civ_war.contains(&(a.min(b), a.max(b)))
    }
}
#[derive(Resource, Default)]
struct Index { by_id: BTreeMap<i64, Entity>, revision: u64 }
#[derive(Clone, Copy, Debug)]
struct CivicRow { kind: u8, faction: i32, x: f64, y: f64, w: f64, h: f64, ready: bool, village: bool, level: u8 }
#[derive(Resource, Default)]
struct Civics { rows: BTreeMap<i64, CivicRow>, sectors: BTreeMap<(i32, i32), BTreeSet<i64>>, dirty: bool, seen_revision: u64 }
impl Civics {
    fn sector(row: &CivicRow) -> (i32, i32) { ((row.x / SECTOR as f64).floor() as i32, (row.y / SECTOR as f64).floor() as i32) }
    fn upsert(&mut self, id: i64, row: Option<CivicRow>) {
        if let Some(previous) = self.rows.remove(&id) {
            let sector = Self::sector(&previous);
            if let Some(set) = self.sectors.get_mut(&sector) { set.remove(&id); if set.is_empty() { self.sectors.remove(&sector); } }
        }
        if let Some(row) = row { self.sectors.entry(Self::sector(&row)).or_default().insert(id); self.rows.insert(id, row); }
        self.dirty = true;
    }
}
#[derive(Resource)]
struct Clock { now: f64, next_sense_at: f64, last_sensed_at: f64, next_integrate_at: f64, last_integrated_at: f64,
    sense_elapsed: f64, integrate_elapsed: f64, sense_due: bool, integrate_due: bool, seed: u64, width: i32, height: i32 }
#[derive(Resource)]
struct Rng(u64);
impl Rng { fn next(&mut self) -> f64 { self.0 = self.0.wrapping_add(0x9E3779B97F4A7C15); (plan::splitmix(self.0) >> 11) as f64 / (1u64 << 53) as f64 } }
#[derive(Clone, Debug)]
struct Sample { faction: i32, weight: f64, distance: f64, id: i64 }
#[derive(Resource, Default)]
struct Sensed { samples: BTreeMap<i64, Vec<Sample>> }
#[derive(Resource, Default)]
struct Hostility { ids: Vec<i32>, index: BTreeMap<i32, usize>, bits: Vec<u8>, revision: u64, dirty: bool, seen_factions: u64 }
impl Hostility {
    fn hostile(&self, a: i32, b: i32) -> bool {
        match (self.index.get(&a), self.index.get(&b)) { (Some(&i), Some(&j)) => self.bits[i * self.ids.len() + j] != 0, _ => false }
    }
}
#[derive(Clone, Debug)]
enum Work { Slots { slots: Vec<usize> }, Upgrade { house: i64 }, Conversion { slot: usize } }
#[derive(Clone, Debug)]
struct Outstanding { village: i64, work: Work, cost: f64, rows: Vec<u32>, results: BTreeMap<u32, (bool, u32)> }
#[derive(Resource, Default)]
struct Requests { next_id: u32, next_group: u32, outstanding: BTreeMap<u32, Outstanding>, by_request: BTreeMap<u32, u32> }
#[derive(Resource, Default)]
struct Outbox { changed: Vec<f64>, events: Vec<f64>, requests: Vec<f64>, spawns: Vec<f64>, charges: Vec<f64>, queued: Vec<[f64; 4]> }
impl Outbox { fn event(&mut self, code: u8, settlement: i64, faction: i32, arg: f64) { self.queued.push([code as f64, settlement as f64, faction as f64, arg]); } }

// ---------------------------------------------------------------- helpers

fn alignment_for(site: &Site, heritage: &Heritage, factions: &Factions, faction: i32) -> f64 {
    let civ = factions.civ(faction);
    match site.kind {
        VILLAGE => af::village_alignment(heritage.kin, civ),
        SECEDED if faction == heritage.former_owner => 0.80,
        _ => af::base_alignment(heritage.civ, civ),
    }
}
fn ensure_slot(aff: &mut Affiliation, site: &Site, heritage: &Heritage, factions: &Factions, slot: usize) {
    if aff.init & (1 << slot) != 0 { return; }
    let faction = factions.slots[slot];
    let alignment = alignment_for(site, heritage, factions, faction);
    aff.alignment[slot] = alignment; aff.base[slot] = alignment;
    aff.value[slot] = af::CULTURE_WEIGHT * af::culture(alignment); aff.target[slot] = aff.value[slot]; aff.rate[slot] = 0.0;
    aff.init |= 1 << slot;
}
fn village_independence(village: &Village, plan: Option<&Plan>, civic: &Civic, threat: f64) -> f64 {
    let adopted = |kind: u8| plan.is_some_and(|plan| plan.adopted & (1 << kind) != 0);
    af::independence(village.stage, civic.guard_posts, adopted(K_LIBRARY), adopted(K_MONUMENT), threat)
}
fn tribute(site: &Site, village: &Village) -> f64 { af::tribute(site.population, village.stage) }
fn stage_phase(village_id: i32, multiplier: i64, interval: f64) -> f64 { ((village_id as i64 * multiplier).rem_euclid(interval as i64)) as f64 }
fn first_after(now: f64, phase: f64, interval: f64) -> f64 { let base = (now / interval).floor() * interval + phase; if base <= now { base + interval } else { base } }

/// Diplomatic view of villages for the hostility rules.
struct Diplomacy<'a> { factions: &'a Factions, villages: BTreeMap<i32, (i64, [u8; SLOTS])> }
impl Diplomacy<'_> {
    fn relation(&self, relations: &[u8; SLOTS], other: i32) -> u8 { self.factions.slot(other).map_or(NEUTRAL, |slot| relations[slot]) }
    fn ally(&self, relations: &[u8; SLOTS]) -> Option<i32> { relations.iter().position(|&r| r == ALLIED).map(|slot| self.factions.slots[slot]) }
    fn village_rule(&self, village: i32, relations: &[u8; SLOTS], other: i32) -> bool {
        if other == village { return false; }
        let ally = self.ally(relations);
        if other == -2 { return ally.is_some(); }
        if other < 0 { return false; }
        if self.relation(relations, other) == WAR { return true; }
        let Some(ally) = ally else { return false; };
        if ally == other { return false; }
        if let Some((_, other_relations)) = self.villages.get(&other) { return self.relation(other_relations, ally) == WAR; }
        if self.factions.multiplayer() && self.factions.human(ally) && self.factions.human(other) { return true; }
        self.factions.civ_hostile(ally, other) && (ally == 0 || other == 0)
    }
    /// Same rule order as the former atWar + villageHostility.
    fn hostile(&self, a: i32, b: i32) -> bool {
        if a == b { return false; }
        if self.factions.multiplayer() && self.factions.human(a) && self.factions.human(b) { return true; }
        let pick = match (self.villages.get(&a), self.villages.get(&b)) {
            (Some(x), Some(y)) => Some(if x.0 <= y.0 { (a, b, x.1) } else { (b, a, y.1) }),
            (Some(x), None) => Some((a, b, x.1)), (None, Some(y)) => Some((b, a, y.1)), _ => None,
        };
        if let Some((village, other, relations)) = pick { return self.village_rule(village, &relations, other); }
        if a == -2 || b == -2 { return a >= 0 || b >= 0; }
        if a < 0 || b < 0 { return false; }
        self.factions.civ_hostile(a, b)
    }
}

// ---------------------------------------------------------------- systems

fn activate(clock: Res<Clock>, factions: Res<Factions>, index: Res<Index>, mut civics: ResMut<Civics>,
    mut sites: Query<(&mut Site, &mut Heritage, &mut Affiliation, Option<&mut Village>, Option<&mut Plan>)>) {
    let cities: Vec<(f64, f64, i32)> = index.by_id.values().filter_map(|&e| sites.get(e).ok())
        .filter(|(s, ..)| s.kind == CITY && s.ready && !s.removed && s.owner >= 0).map(|(s, ..)| (s.x, s.y, s.owner)).collect();
    for &entity in index.by_id.values() {
        let Ok((mut site, mut heritage, mut aff, village, plan)) = sites.get_mut(entity) else { continue; };
        if site.activated || !site.ready || site.removed { continue; }
        site.activated = true;
        if site.founded_at.is_nan() { site.founded_at = clock.now; }
        if site.kind == CITY {
            if let Some(slot) = factions.slot(site.owner) {
                ensure_slot(&mut aff, &site, &heritage, &factions, slot);
                if aff.owner_slot != slot as i32 { aff.value[slot] = af::LOYALTY_START; aff.grace_until = clock.now + af::LOYALTY_GRACE; aff.owner_slot = slot as i32; }
            }
        }
        if site.kind == VILLAGE && heritage.kin == -2 {
            let nearest = cities.iter().min_by(|a, b| ((a.0 - site.x).powi(2) + (a.1 - site.y).powi(2))
                .total_cmp(&((b.0 - site.x).powi(2) + (b.1 - site.y).powi(2))).then(a.2.cmp(&b.2)));
            heritage.kin = nearest.map_or(-1, |c| factions.civ(c.2));
            aff.init = 0;
        }
        if let Some(mut village) = village {
            let id = site.village_id;
            if village.next_growth_at.is_nan() { village.next_growth_at = first_after(clock.now, stage_phase(id, 17, GROWTH_INTERVAL), GROWTH_INTERVAL); }
            if village.next_recruit_at.is_nan() { village.next_recruit_at = first_after(clock.now, stage_phase(id, 17, RECRUIT_INTERVAL) + 45.0, RECRUIT_INTERVAL); }
            if village.next_adopt_at.is_nan() { village.next_adopt_at = first_after(clock.now, stage_phase(id, 7, ADOPT_INTERVAL), ADOPT_INTERVAL); }
        }
        if let Some(mut plan) = plan { plan.claim_dirty = true; }
        civics.dirty = true;
    }
}

fn reassign_civic(mut civics: ResMut<Civics>, index: Res<Index>, mut sites: Query<(&Site, &mut Civic)>) {
    if !civics.dirty && civics.seen_revision == index.revision { return; }
    civics.dirty = false; civics.seen_revision = index.revision;
    let mut owners: BTreeMap<i32, Vec<(i64, f64, f64, u8)>> = BTreeMap::new();
    for (&id, &entity) in &index.by_id {
        if let Ok((site, _)) = sites.get(entity) { if site.live() { owners.entry(site.owner).or_default().push((id, site.x, site.y, site.kind)); } }
    }
    let mut counts: BTreeMap<i64, Civic> = BTreeMap::new();
    for row in civics.rows.values() {
        if !row.ready { continue; }
        let Some(list) = owners.get(&row.faction) else { continue; };
        let (cx, cy) = (row.x + row.w / 2.0, row.y + row.h / 2.0);
        let Some(&(home, ..)) = list.iter().min_by(|a, b| ((a.1 - cx).powi(2) + (a.2 - cy).powi(2))
            .total_cmp(&((b.1 - cx).powi(2) + (b.2 - cy).powi(2))).then(a.0.cmp(&b.0))) else { continue; };
        let civic = counts.entry(home).or_default();
        match row.kind {
            K_GUARD_POST => civic.guard_posts += 1.0, K_WOODEN_TOWER | K_TOWER => civic.towers += 1.0,
            K_MONUMENT => civic.monument = true,
            K_HOUSE => { civic.houses += 1.0; civic.house_levels += row.level.max(1) as f64; }
            _ => {}
        }
        if row.kind == K_FORT { civic.forts += 1.0; }
        if advanced(row.kind) { civic.advanced += 1.0; }
    }
    for list in owners.values() {
        for &(id, x, y, kind) in list {
            if kind != CITY { continue; }
            let nearest = list.iter().filter(|o| o.0 != id && o.3 == CITY).map(|o| (o.1 - x).hypot(o.2 - y)).fold(None, |m: Option<f64>, d| Some(m.map_or(d, |m| m.min(d))));
            counts.entry(id).or_default().nearest = nearest;
        }
    }
    for (&id, &entity) in &index.by_id {
        if let Ok((_, mut civic)) = sites.get_mut(entity) { *civic = counts.remove(&id).unwrap_or_default(); }
    }
}

fn refresh_hostility(factions: Res<Factions>, mut hostility: ResMut<Hostility>, index: Res<Index>, sites: Query<(&Site, Option<&Village>)>) {
    if !hostility.dirty && hostility.seen_factions == factions.revision { return; }
    hostility.dirty = false; hostility.seen_factions = factions.revision;
    let mut villages = BTreeMap::new();
    for &entity in index.by_id.values() {
        if let Ok((site, Some(village))) = sites.get(entity) { if site.kind != CITY { villages.insert(site.owner, (site.village_id as i64, village.relations)); } }
    }
    let diplomacy = Diplomacy { factions: &factions, villages };
    let mut ids = vec![-2]; ids.extend(factions.rows.keys().copied());
    let n = ids.len(); let mut bits = vec![0u8; n * n];
    for (i, &a) in ids.iter().enumerate() { for (j, &b) in ids.iter().enumerate() { bits[i * n + j] = u8::from(diplomacy.hostile(a, b)); } }
    if bits != hostility.bits || ids != hostility.ids {
        hostility.index = ids.iter().enumerate().map(|(i, &id)| (id, i)).collect();
        hostility.ids = ids; hostility.bits = bits; hostility.revision += 1;
    }
}

fn allied_with_owner(site: &Site, village: Option<&Village>, factions: &Factions, ally_of: &BTreeMap<i32, i32>, faction: i32) -> bool {
    if let Some(village) = village { if site.kind != CITY { return village.ally().is_some_and(|slot| factions.slots[slot] == faction); } }
    ally_of.get(&faction) == Some(&site.owner) || site.owner == 0 && factions.row(faction).relation == 3
}

fn sense_presence(clock: Res<Clock>, factions: Res<Factions>, hostility: Res<Hostility>, sensed: Res<Sensed>, index: Res<Index>,
    mut sites: Query<(&Site, &mut Affiliation, &mut Presence, Option<&Village>)>) {
    if !clock.sense_due { return; }
    let dt = clock.sense_elapsed;
    let ally_of: BTreeMap<i32, i32> = index.by_id.values().filter_map(|&e| sites.get(e).ok())
        .filter_map(|(s, _, _, v)| v.and_then(|v| v.ally()).map(|slot| (s.owner, factions.slots[slot]))).collect();
    for (&id, &entity) in &index.by_id {
        let Ok((site, mut aff, mut presence, village)) = sites.get_mut(entity) else { continue; };
        if !site.live() { continue; }
        let mut increments = [0.0; SLOTS]; let mut slot_presence = [0.0; SLOTS];
        let (mut hostile, mut friendly) = (0.0, 0.0);
        let mut nearest: Vec<(f64, i64)> = Vec::new();
        for sample in sensed.samples.get(&id).map(|v| v.as_slice()).unwrap_or(&[]) {
            let g = sample.faction;
            if g == site.owner || allied_with_owner(site, village, &factions, &ally_of, g) { friendly += sample.weight; continue; }
            let slot = factions.slot(g).unwrap_or(OTHER_SLOT);
            let is_hostile = hostility.hostile(site.owner, g);
            if is_hostile && site.kind == VILLAGE { nearest.push((sample.distance, sample.id)); }
            if sample.weight <= 0.0 { continue; }
            slot_presence[slot] += sample.weight;
            if is_hostile { hostile += sample.weight; increments[slot] += sample.weight; }
            else { increments[slot] += af::INTIMIDATION_WEIGHT * sample.weight; }
        }
        for slot in 0..SLOTS { aff.exposure[slot] = af::accumulate_exposure(aff.exposure[slot], increments[slot], dt); }
        aff.hostile_exposure = af::accumulate_exposure(aff.hostile_exposure, hostile, dt);
        for slot in 0..TARGET_SLOTS {
            let Some(faction) = factions.active(slot) else { continue; };
            if faction == site.owner || hostility.hostile(site.owner, faction) { continue; }
            aff.protector[slot] = af::accumulate_protector(aff.protector[slot], slot_presence[slot], hostile, dt);
        }
        nearest.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1))); nearest.truncate(8);
        presence.slot = slot_presence; presence.hostile = hostile; presence.friendly = friendly;
        presence.hostiles = nearest.into_iter().map(|(_, id)| id).collect();
    }
}

fn integrate_affiliation(clock: Res<Clock>, factions: Res<Factions>, hostility: Res<Hostility>, index: Res<Index>, mut outbox: ResMut<Outbox>,
    mut sites: Query<(&Site, &Heritage, &mut Affiliation, &Civic, &Presence, Option<&mut Village>, Option<&Plan>)>) {
    if !clock.integrate_due { return; }
    for (&id, &entity) in &index.by_id {
        let Ok((site, heritage, mut aff, civic, presence, mut village, plan)) = sites.get_mut(entity) else { continue; };
        if !site.live() { continue; }
        let mut remaining = clock.integrate_elapsed; let mut t = clock.now - remaining;
        let owner_slot = if site.kind == CITY { factions.slot(site.owner) } else { None };
        aff.owner_slot = owner_slot.map_or(-1, |s| s as i32);
        let protection = af::protection(civic.guard_posts, civic.towers, civic.forts, presence.friendly);
        let culture = if owner_slot.is_some() { factions.row(site.owner).achievements } else { 0 };
        let governance = crate::sim::achievements::effect(culture, 11,
            af::governance(af::support(civic.nearest), civic.advanced, civic.monument), 0);
        loop {
            let dt = remaining.min(af::INTEGRATE_INTERVAL); remaining -= dt; t += dt;
            let threat = crate::sim::achievements::effect(culture, 12, af::threat(aff.hostile_exposure, protection), 0);
            aff.threat = threat; aff.protection = protection; aff.governance = governance;
            for slot in 0..TARGET_SLOTS {
                let Some(faction) = factions.active(slot) else { continue; };
                ensure_slot(&mut aff, site, heritage, &factions, slot);
                aff.trade[slot] = af::half_life(aff.trade[slot], dt, af::TRADE_HALF_LIFE);
                aff.snub[slot] = af::half_life(aff.snub[slot], dt, af::SNUB_HALF_LIFE);
                let owner = owner_slot == Some(slot);
                let allied = village.as_ref().is_some_and(|v| v.relations[slot] == ALLIED);
                aff.alignment[slot] = af::drift_alignment(aff.alignment[slot], aff.base[slot], owner, aff.value[slot], allied, dt);
                let trade = af::trade(aff.trade[slot]);
                let (target, rate) = if owner {
                    let target = af::owner_target(aff.alignment[slot], governance, trade, threat, aff.snub[slot]);
                    (target, af::owner_rate(target, aff.value[slot], t < aff.grace_until))
                } else {
                    let war = match village.as_ref() { Some(v) if site.kind != CITY => v.relations[slot] == WAR, _ => hostility.hostile(site.owner, faction) };
                    let target = af::foreign_target(aff.alignment[slot], trade, allied, af::protector(aff.protector[slot]),
                        af::fear(aff.exposure[slot]), aff.snub[slot], war);
                    (target, af::foreign_rate(target, aff.value[slot]))
                };
                aff.target[slot] = target; aff.rate[slot] = rate;
                aff.value[slot] = af::advance(aff.value[slot], rate, dt);
            }
            if remaining <= 1e-9 { break; }
        }
        if let Some(slot) = owner_slot {
            aff.warning = af::warning(aff.rate[slot], aff.target[slot], aff.value[slot]);
            if aff.value[slot] <= 0.0 && !aff.secede_pending { aff.secede_pending = true; outbox.event(EV_SECEDE, id, site.owner, 0.0); }
        } else { aff.warning = false; }
        if let Some(village) = village.as_mut() {
            aff.independence = village_independence(village, plan, civic, aff.threat);
            if site.kind == VILLAGE {
                let now = clock.now;
                if village.petition_open_until < now { village.petition_open_until = f64::NAN; }
                match village.ally() {
                    Some(slot) if aff.value[slot] >= af::petition_threshold(aff.independence) => {
                        if village.petition_slot != slot as i32 || village.petition_since.is_nan() { village.petition_slot = slot as i32; village.petition_since = now; }
                        if now - village.petition_since >= af::PETITION_HOLD && now >= village.petition_next && village.petition_open_until.is_nan() {
                            village.petition_open_until = now + af::PETITION_HOLD; village.petition_next = now + af::PETITION_INTERVAL;
                            let faction = factions.slots[slot];
                            outbox.event(EV_PETITION, id, faction, 0.0);
                            if !factions.human(faction) { outbox.event(EV_AI_CONFEDERATE, id, faction, 0.0); }
                        }
                    }
                    _ => { village.petition_since = f64::NAN; }
                }
            }
        }
    }
}

fn village_economy(clock: Res<Clock>, mut villages: Query<(&Site, &mut Village)>) {
    if !clock.integrate_due { return; }
    for (site, mut village) in villages.iter_mut() {
        if site.kind != VILLAGE || !site.live() { continue; }
        let income = VILLAGE_BASE_INCOME * clock.integrate_elapsed;
        village.treasury += income; village.lifetime_income += income;
    }
}

fn completion(template: &plan::Template, plan: &Plan, stage: u8) -> f64 {
    let (mut done, mut total) = (0.0, 0.0);
    for (index, slot) in template.slots.iter().enumerate() {
        if slot.stage != stage || matches!(slot.kind, SlotKind::Hub) || !eligible(slot.kind, plan) { continue; }
        total += 1.0;
        if plan.status[index] != S_PENDING { done += 1.0; }
    }
    if total == 0.0 { 1.0 } else { done / total }
}
fn eligible(kind: SlotKind, plan: &Plan) -> bool {
    match kind {
        SlotKind::Tower => plan.adopted & (1 << K_WOODEN_TOWER) != 0,
        SlotKind::Lot(l) => plan.lots[l as usize] != 0,
        SlotKind::Quay => plan.adopted & (1 << K_DOCK) != 0,
        _ => true,
    }
}

fn village_stage(clock: Res<Clock>, index: Res<Index>, mut outbox: ResMut<Outbox>, mut villages: Query<(&Site, &mut Village, &mut Plan)>) {
    for (&id, &entity) in &index.by_id {
        let Ok((site, mut village, mut plan)) = villages.get_mut(entity) else { continue; };
        if site.kind != VILLAGE || !site.live() || village.family == plan::FAMILY_NONE || clock.now < village.next_growth_at { continue; }
        village.next_growth_at = next_deadline(village.next_growth_at, clock.now, GROWTH_INTERVAL);
        village.budget = GROWTH_BUDGET;
        if village.stage >= 4 { continue; }
        let next = village.stage + 1;
        let (age, villagers, needed) = STAGE_GATES[next as usize];
        let done = plan::with_template(village.family, |t| completion(t, &plan, village.stage)).unwrap_or(0.0);
        if clock.now - site.founded_at < age || site.population < villagers || done + 1e-9 < needed { continue; }
        village.stage = next;
        outbox.event(EV_STAGE, id, site.owner, next as f64);
        for index in 0..plan.status.len() {
            if plan.status[index] == S_SKIPPED && plan.rearmed[index] == 0 { plan.status[index] = S_PENDING; plan.alternate[index] = 0; plan.retries[index] = 0; plan.rearmed[index] = 1; }
        }
        plan.claim_dirty = true;
    }
}

fn village_adoption(clock: Res<Clock>, index: Res<Index>, factions: Res<Factions>, civics: Res<Civics>, mut outbox: ResMut<Outbox>,
    mut villages: Query<(&Site, &Affiliation, &mut Village, &mut Plan)>) {
    for (&id, &entity) in &index.by_id {
        let Ok((site, aff, mut village, mut plan)) = villages.get_mut(entity) else { continue; };
        if site.kind != VILLAGE || !site.live() || village.family == plan::FAMILY_NONE || clock.now < village.next_adopt_at { continue; }
        village.next_adopt_at = next_deadline(village.next_adopt_at, clock.now, ADOPT_INTERVAL);
        let (cx, cy) = (village.lot.0 as f64 + 1.0, village.lot.1 as f64 + 1.0);
        let mut influence: BTreeMap<u8, (f64, BTreeMap<i32, f64>)> = BTreeMap::new();
        let reach = (ADOPTION_RADIUS / SECTOR as f64).ceil() as i32;
        let (sx, sy) = ((cx / SECTOR as f64).floor() as i32, (cy / SECTOR as f64).floor() as i32);
        for y in sy - reach..=sy + reach { for x in sx - reach..=sx + reach {
            let Some(ids) = civics.sectors.get(&(x, y)) else { continue; };
            for building in ids {
                let row = &civics.rows[building];
                if !row.ready || row.village || !ADOPTABLE.iter().any(|a| a.0 == row.kind) { continue; }
                let Some(slot) = factions.slot(row.faction) else { continue; };
                if factions.active(slot).is_none() { continue; }
                let d = (row.x + row.w / 2.0 - cx).hypot(row.y + row.h / 2.0 - cy);
                if d > ADOPTION_RADIUS { continue; }
                let contribution = (1.0 - d / ADOPTION_RADIUS) * (0.5 + aff.value[slot] / 100.0);
                let entry = influence.entry(row.kind).or_default();
                entry.0 += contribution; *entry.1.entry(row.faction).or_default() += contribution;
            }
        } }
        let mut ranked: Vec<(u8, f64, i32)> = influence.into_iter().map(|(kind, (total, by))| {
            let source = by.iter().max_by(|a, b| a.1.total_cmp(b.1).then(b.0.cmp(a.0))).map_or(-1, |(f, _)| *f);
            (kind, total, source)
        }).collect();
        ranked.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
        for (kind, total, source) in ranked {
            let Some(&(_, min_stage, lot)) = ADOPTABLE.iter().find(|a| a.0 == kind) else { continue; };
            if total < ADOPTION_THRESHOLD || village.stage < min_stage || plan.adopted & (1 << kind) != 0 { continue; }
            if kind == K_DOCK && village.family != plan::RIVERSIDE { continue; }
            if lot {
                let used = plan.lots.iter().filter(|&&k| k != 0).count() as u8;
                if used >= ADOPTION_CAP[village.stage as usize] { continue; }
                let Some(free) = plan.lots.iter().position(|&k| k == 0) else { continue; };
                plan.lots[free] = kind;
            }
            plan.adopted |= 1 << kind; plan.adopted_from[kind as usize % 16] = source;
            outbox.event(EV_ADOPTED, id, source, kind as f64);
        }
    }
}

struct Emission { rows: Vec<[f64; REQUEST_STRIDE]>, work: Work, cost: f64 }

fn world_cells(village: &Village, cells: &[(i32, i32)]) -> Vec<(i32, i32)> { plan::footprint(village.lot, cells, village.transform) }
fn slot_cells(slot: &plan::Slot, alternate: u8) -> &[(i32, i32)] {
    if alternate == 0 { &slot.cells } else { slot.alternates.get(alternate as usize - 1).map_or(&slot.cells, |c| c) }
}
fn lot_footprint(template: &plan::Template, village: &Village, slot: &plan::Slot, kind: u8) -> (i32, i32, i32, i32) {
    let world = world_cells(village, &slot.cells);
    let (mx, my) = (world.iter().map(|c| c.0).min().unwrap(), world.iter().map(|c| c.1).min().unwrap());
    let (w, h) = kind_size(kind);
    if (w, h) == (2, 2) { return (mx, my, 2, 2); }
    let roads: BTreeSet<(i32, i32)> = template.slots.iter().filter(|s| s.kind == SlotKind::Road).flat_map(|s| world_cells(village, &s.cells)).collect();
    let fronts = |x: i32, y: i32| [(1, 0), (-1, 0), (0, 1), (0, -1)].iter().any(|(dx, dy)| roads.contains(&(x + dx, y + dy)));
    if (w, h) == (2, 1) { let row = if fronts(mx, my + 1) || fronts(mx + 1, my + 1) { my + 1 } else { my }; return (mx, row, 2, 1); }
    let mut cells = world.clone(); cells.sort_by_key(|&(x, y)| (y, x));
    let cell = cells.iter().copied().find(|&(x, y)| fronts(x, y)).unwrap_or((mx, my));
    (cell.0, cell.1, 1, 1)
}

fn next_emission(template: &plan::Template, site: &Site, village: &Village, plan: &Plan, civics: &Civics) -> Option<Emission> {
    let available = village.treasury - village.reserved;
    let target = HOUSE_TARGET[village.stage as usize];
    let house = civics.rows.iter().filter(|(id, row)| row.kind == K_HOUSE && row.village && row.faction == site.owner && row.ready
        && row.level < target && !plan.failed_upgrades.contains(id)).map(|(id, row)| (*id, *row)).next();
    if let Some((house, row)) = house {
        let level = row.level.max(1) + 1; let cost = if level == 2 { 50.0 } else { 100.0 };
        if available >= cost {
            return Some(Emission { rows: vec![[0.0, site.village_id as f64, K_UPGRADE as f64, row.x, row.y, 1.0, 1.0, 0.0, cost, level as f64]],
                work: Work::Upgrade { house }, cost });
        }
    }
    if village.stage >= 3 {
        if let Some(index) = template.slots.iter().enumerate().position(|(i, s)| s.kind == SlotKind::Tent && plan.status[i] == S_BUILT) {
            let cost = build_cost(K_HOUSE);
            if available < cost { return None; }
            let (x, y) = world_cells(village, &template.slots[index].cells)[0];
            return Some(Emission { rows: vec![[0.0, site.village_id as f64, K_HOUSE as f64, x as f64, y as f64, 1.0, 1.0, 0.0, cost, 1.0]],
                work: Work::Conversion { slot: index }, cost });
        }
    }
    for (index, slot) in template.slots.iter().enumerate() {
        if slot.stage > village.stage || plan.status[index] != S_PENDING || matches!(slot.kind, SlotKind::Hub | SlotKind::Tent) || !eligible(slot.kind, plan) { continue; }
        let mut rows = Vec::new(); let mut slots = vec![index]; let mut cost = 0.0;
        let push = |rows: &mut Vec<[f64; REQUEST_STRIDE]>, kind: u8, x: i32, y: i32, w: i32, h: i32| {
            rows.push([0.0, site.village_id as f64, kind as f64, x as f64, y as f64, w as f64, h as f64, 0.0, build_cost(kind), if kind == K_HOUSE { 1.0 } else { 0.0 }]);
        };
        match slot.kind {
            SlotKind::Road => {
                // A chain of up to four cells: each later cell touches the
                // previous one (lowest template index first).
                let mut last = world_cells(village, &slot.cells)[0];
                push(&mut rows, K_ROAD, last.0, last.1, 1, 1);
                while rows.len() < 4 {
                    let next = template.slots.iter().enumerate().skip(index + 1).find(|(i, other)| other.kind == SlotKind::Road
                        && other.stage <= village.stage && plan.status[*i] == S_PENDING && !slots.contains(i)
                        && { let c = world_cells(village, &other.cells)[0]; (c.0 - last.0).abs() + (c.1 - last.1).abs() == 1 });
                    let Some((i, other)) = next else { break; };
                    last = world_cells(village, &other.cells)[0];
                    push(&mut rows, K_ROAD, last.0, last.1, 1, 1); slots.push(i);
                }
            }
            SlotKind::House => for c in world_cells(village, slot_cells(slot, plan.alternate[index])) { push(&mut rows, K_HOUSE, c.0, c.1, 1, 1); },
            SlotKind::Well => { let c = world_cells(village, &slot.cells)[0]; push(&mut rows, K_WELL, c.0, c.1, 1, 1); }
            SlotKind::GuardPost => { let c = world_cells(village, slot_cells(slot, plan.alternate[index]))[0]; push(&mut rows, K_GUARD_POST, c.0, c.1, 1, 1); }
            SlotKind::Tower => { let c = world_cells(village, slot_cells(slot, plan.alternate[index]))[0]; push(&mut rows, K_WOODEN_TOWER, c.0, c.1, 1, 1); }
            SlotKind::Quay => { let c = world_cells(village, &slot.cells)[0]; push(&mut rows, K_DOCK, c.0, c.1, 1, 1); }
            SlotKind::Lot(l) => { let kind = plan.lots[l as usize]; let (x, y, w, h) = lot_footprint(template, village, slot, kind); push(&mut rows, kind, x, y, w, h); }
            SlotKind::Hub | SlotKind::Tent => unreachable!(),
        }
        for row in &rows { cost += row[8]; }
        if available < cost { return None; }
        return Some(Emission { rows, work: Work::Slots { slots }, cost });
    }
    None
}

fn village_growth(index: Res<Index>, civics: Res<Civics>, mut requests: ResMut<Requests>, mut outbox: ResMut<Outbox>,
    mut villages: Query<(&Site, &mut Village, &mut Plan)>) {
    for (&id, &entity) in &index.by_id {
        if requests.outstanding.len() >= MAX_OUTSTANDING { break; }
        let Ok((site, mut village, mut plan)) = villages.get_mut(entity) else { continue; };
        if site.kind != VILLAGE || !site.live() || village.budget == 0 || plan.outstanding { continue; }
        let emission = plan::with_template(village.family, |t| next_emission(t, site, &village, &plan, &civics)).flatten();
        let Some(emission) = emission else { village.budget = 0; continue; };
        village.budget -= 1; plan.outstanding = true; village.reserved += emission.cost;
        requests.next_group += 1; let group = requests.next_group;
        let mut ids = Vec::new();
        for mut row in emission.rows {
            requests.next_id += 1; let rid = requests.next_id;
            row[0] = rid as f64; row[7] = group as f64;
            outbox.requests.extend_from_slice(&row); ids.push(rid);
            requests.by_request.insert(rid, group);
        }
        requests.outstanding.insert(group, Outstanding { village: id, work: emission.work, cost: emission.cost, rows: ids, results: BTreeMap::new() });
    }
}

fn village_recruit(clock: Res<Clock>, index: Res<Index>, mut outbox: ResMut<Outbox>, mut villages: Query<(&Site, &Civic, &mut Village, Option<&Plan>)>) {
    for &entity in index.by_id.values() {
        let Ok((site, civic, mut village, plan)) = villages.get_mut(entity) else { continue; };
        if site.kind != VILLAGE || !site.live() || clock.now < village.next_recruit_at { continue; }
        village.next_recruit_at = next_deadline(village.next_recruit_at, clock.now, RECRUIT_INTERVAL);
        let villagers = (5.0 + civic.house_levels).min(28.0);
        if site.population < villagers { outbox.spawns.extend_from_slice(&[site.village_id as f64, 1.0, 8.0, site.id as f64, 0.0, -1.0]); }
        let guards = (2.0 + (civic.houses / 2.0).floor() + 3.0 * civic.guard_posts).min(12.0);
        if site.guards < guards && village.treasury - village.reserved >= GUARD_COST {
            village.treasury -= GUARD_COST;
            let attack = if plan.is_some_and(|p| p.adopted & (1 << K_BLACKSMITH) != 0) { 20.0 } else { 16.0 };
            outbox.spawns.extend_from_slice(&[site.village_id as f64, 2.0, attack, site.id as f64, GUARD_COST, -1.0]);
        }
    }
}

fn ai_village_diplomacy(clock: Res<Clock>, mut factions: ResMut<Factions>, mut hostility: ResMut<Hostility>, index: Res<Index>,
    mut outbox: ResMut<Outbox>, mut sites: Query<(&Site, &Affiliation, Option<&mut Village>)>) {
    let ai: Vec<i32> = factions.rows.iter().filter(|(id, row)| **id >= 0 && row.flags & (F_HUMAN | F_VILLAGE | F_DEFEATED | F_CONFEDERATED) == 0 && row.relation != 3)
        .map(|(id, _)| *id).collect();
    let mut changed = false;
    for faction in ai {
        let Some(slot) = factions.slot(faction) else { continue; };
        let due = *factions.next_ai_at.entry(faction).or_insert(clock.now + (faction as f64 * 13.0).rem_euclid(AI_INTERVAL));
        if clock.now < due { continue; }
        factions.next_ai_at.insert(faction, next_deadline(due, clock.now, AI_INTERVAL));
        let row = factions.row(faction);
        let cities: Vec<(f64, f64)> = index.by_id.values().filter_map(|&e| sites.get(e).ok())
            .filter(|(s, ..)| s.kind == CITY && s.live() && s.owner == faction).map(|(s, ..)| (s.x, s.y)).collect();
        let mut villages: Vec<(f64, i64, Entity)> = Vec::new();
        let mut trading = false;
        for (&id, &entity) in &index.by_id {
            let Ok((site, _, Some(village))) = sites.get(entity) else { continue; };
            if site.kind != VILLAGE || !site.live() { continue; }
            if village.trading & (1 << slot) != 0 { trading = true; }
            let d = cities.iter().map(|c| (c.0 - site.x).hypot(c.1 - site.y)).fold(f64::INFINITY, f64::min);
            villages.push((d, id, entity));
        }
        villages.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
        // 1. Trade with the closest reachable, nonhostile village (host confirms the route).
        if row.population >= 20.0 && row.gold >= af::VILLAGE_TRADE_COST + 1000.0 && !trading {
            let mut rank = 0;
            for &(_, id, entity) in &villages {
                let Ok((site, aff, Some(village))) = sites.get(entity) else { continue; };
                if hostility.hostile(site.owner, faction) || village.relations[slot] == WAR || aff.value[slot] < af::VILLAGE_TRADE_MIN { continue; }
                outbox.event(EV_AI_TRADE, id, faction, rank as f64); rank += 1;
                if rank >= 4 { break; }
            }
            if rank > 0 { continue; }
        }
        // 2. Alliance with a trading partner, 3. confederation of an ally.
        let mut acted = false;
        for &(_, id, entity) in &villages {
            let Ok((site, aff, Some(mut village))) = sites.get_mut(entity) else { continue; };
            let value = aff.value[slot];
            if village.trading & (1 << slot) != 0 && village.ally().is_none() && village.relations[slot] != WAR && value >= 55.0 {
                let cost = af::alliance_cost(village.lifetime_trade[slot]);
                if row.gold >= cost + 1500.0 {
                    village.relations[slot] = ALLIED; village.relations_revision += 1; changed = true;
                    outbox.charges.extend_from_slice(&[faction as f64, cost, 1.0, A_ALLY as f64]);
                    outbox.event(EV_RELATION, id, faction, ALLIED as f64);
                    if let Some(r) = factions.rows.get_mut(&faction) { r.gold -= cost; }
                    acted = true; break;
                }
            }
            if village.relations[slot] == ALLIED && clock.now >= village.cooldown_until[slot] {
                let fee = tribute(site, &village);
                if value >= af::accept_threshold(aff.independence) && row.gold >= fee + 1000.0 {
                    outbox.event(EV_AI_CONFEDERATE, id, faction, fee); acted = true; break;
                }
            }
        }
        let _ = acted;
    }
    if changed { hostility.dirty = true; }
}

fn refresh_claims(clock: Res<Clock>, index: Res<Index>, mut villages: Query<(&Site, &Village, &mut Plan)>) {
    for &entity in index.by_id.values() {
        let Ok((site, village, mut plan)) = villages.get_mut(entity) else { continue; };
        if !plan.claim_dirty || site.kind != VILLAGE || village.family == plan::FAMILY_NONE { continue; }
        plan.claim_dirty = false;
        let mut cells = BTreeSet::new();
        let (width, height) = (clock.width, clock.height);
        let mut add = |x: i32, y: i32| { if x >= 0 && y >= 0 && x < width && y < height { cells.insert(y as i64 * width as i64 + x as i64); } };
        let (cx, cy) = (village.lot.0 as f64 + 1.0, village.lot.1 as f64 + 1.0);
        for y in (cy - 4.0) as i32..=(cy + 4.0) as i32 { for x in (cx - 4.0) as i32..=(cx + 4.0) as i32 {
            if (x as f64 + 0.5 - cx).hypot(y as f64 + 0.5 - cy) <= 3.0 { add(x, y); }
        } }
        plan::with_template(village.family, |template| {
            for (index, slot) in template.slots.iter().enumerate() {
                let status = plan.status[index];
                let cells = world_cells(village, slot_cells(slot, plan.alternate[index]));
                if status == S_BUILT || status == S_CONVERTED {
                    for c in &cells { for dy in -1..=1 { for dx in -1..=1 { add(c.0 + dx, c.1 + dy); } } }
                } else if status == S_PENDING && slot.stage <= village.stage {
                    for c in &cells { add(c.0, c.1); }
                }
            }
        });
        plan.claim = cells.into_iter().collect(); plan.claim_revision += 1;
    }
}

fn publish(index: Res<Index>, factions: Res<Factions>, mut outbox: ResMut<Outbox>,
    mut sites: Query<(&Site, &Affiliation, Option<&Village>, Option<&Plan>, &mut Published)>) {
    let queued = std::mem::take(&mut outbox.queued);
    for event in queued { outbox.events.extend_from_slice(&event); }
    for (&id, &entity) in &index.by_id {
        let Ok((site, aff, village, plan, mut published)) = sites.get_mut(entity) else { continue; };
        let row = changed_row(id, site, aff, village, plan, &factions);
        let previous = &published.0;
        let differs = (0..CHANGED_STRIDE).any(|i| {
            let (a, b) = (row[i], previous[i]);
            if a.is_nan() && b.is_nan() { return false; }
            let tolerance = match i { 2 | 3 | 8 => 0.05, 4 => 0.0005, 9 => 0.5, _ => 0.0 };
            !((a - b).abs() <= tolerance)
        });
        if differs { outbox.changed.extend_from_slice(&row); published.0 = row; }
    }
}
fn changed_row(id: i64, site: &Site, aff: &Affiliation, village: Option<&Village>, plan: Option<&Plan>, factions: &Factions) -> [f64; CHANGED_STRIDE] {
    let owner = (aff.owner_slot >= 0).then_some(aff.owner_slot as usize);
    let mut flags = 0;
    if aff.warning { flags |= FL_WARNING; }
    if owner.is_some() && aff.grace_until > 0.0 && aff.rate[owner.unwrap()] == 0.0 && aff.target[owner.unwrap()] < aff.value[owner.unwrap()] { flags |= FL_GRACE; }
    if aff.secede_pending { flags |= FL_SECEDE; }
    if village.is_some_and(|v| !v.petition_open_until.is_nan()) { flags |= FL_PETITION; }
    if site.removed { flags |= FL_REMOVED; }
    let top = (0..TARGET_SLOTS).filter(|&s| factions.active(s).is_some() && Some(s) != owner && aff.init & (1 << s) != 0)
        .max_by(|&a, &b| aff.value[a].total_cmp(&aff.value[b]).then(b.cmp(&a))).map_or(-1.0, |s| factions.slots[s] as f64);
    [id as f64, site.owner as f64, owner.map_or(f64::NAN, |s| aff.value[s]), owner.map_or(f64::NAN, |s| aff.target[s]),
        owner.map_or(0.0, |s| aff.rate[s]), flags as f64, village.map_or(0.0, |v| v.stage as f64), village.map_or(0.0, |v| v.family as f64),
        if village.is_some() { aff.independence } else { f64::NAN }, village.map_or(0.0, |v| v.treasury - v.reserved),
        plan.map_or(0.0, |p| p.claim_revision as f64), top, village.map_or(0.0, |v| v.relations_revision as f64), site.kind as f64]
}

// ---------------------------------------------------------------- engine

pub struct SettlementEngine {
    world: World, schedule: Schedule,
    factions_input: Vec<f64>, upsert_input: Vec<f64>, civic_input: Vec<f64>, results_input: Vec<f64>, plan_input: Vec<f64>, import_input: Vec<f64>,
    header: [f64; HEADER], export: Vec<f64>, hostility_output: Vec<f64>,
}

impl SettlementEngine {
    pub fn new(width: i32, height: i32, seed: f64) -> Self {
        let mut world = World::new();
        let seed_bits = if seed.is_finite() { seed as i64 as u64 } else { 0 };
        world.insert_resource(Clock { now: 0.0, next_sense_at: 0.0, last_sensed_at: f64::NAN, next_integrate_at: 0.0, last_integrated_at: f64::NAN,
            sense_elapsed: 0.0, integrate_elapsed: 0.0, sense_due: false, integrate_due: false, seed: seed_bits, width, height });
        world.insert_resource(Rng(plan::splitmix(seed_bits ^ 0x5E77_5E77)));
        world.init_resource::<Factions>(); world.init_resource::<Index>(); world.init_resource::<Civics>(); world.init_resource::<Sensed>();
        world.init_resource::<Hostility>(); world.init_resource::<Requests>(); world.init_resource::<Outbox>();
        world.resource_mut::<Hostility>().dirty = true;
        let mut schedule = Schedule::default(); schedule.set_executor(SingleThreadedExecutor::new());
        schedule.add_systems((activate, reassign_civic, refresh_hostility, sense_presence, integrate_affiliation, village_economy,
            village_stage, village_adoption, village_growth, village_recruit, ai_village_diplomacy, refresh_claims, publish).chain());
        Self { world, schedule, factions_input: Vec::new(), upsert_input: Vec::new(), civic_input: Vec::new(), results_input: Vec::new(),
            plan_input: vec![0.0; (plan::PATCH * plan::PATCH) as usize], import_input: Vec::new(), header: [0.0; HEADER],
            export: Vec::new(), hostility_output: Vec::new() }
    }
    fn entity(&self, id: i64) -> Option<Entity> { self.world.resource::<Index>().by_id.get(&id).copied() }
    fn village_entity(&mut self, village_id: i32) -> Option<Entity> {
        let entities: Vec<Entity> = self.world.resource::<Index>().by_id.values().copied().collect();
        entities.into_iter().find(|&e| self.world.get::<Site>(e).is_some_and(|s| s.village_id == village_id && s.kind != CITY))
    }
    fn grow(buffer: &mut Vec<f64>, size: usize) -> *mut f64 { if buffer.len() < size { buffer.resize(size, 0.0); } buffer.as_mut_ptr() }

    pub fn factions_input(&mut self, count: usize) -> *mut f64 { Self::grow(&mut self.factions_input, count * FACTION_STRIDE) }
    pub fn factions_commit(&mut self, count: usize) {
        let input = std::mem::take(&mut self.factions_input);
        {
            let mut factions = self.world.resource_mut::<Factions>();
            let mut rows = BTreeMap::new();
            for row in input[..count * FACTION_STRIDE].chunks_exact(FACTION_STRIDE) {
                rows.insert(row[0] as i32, FactionRow { civ: row[1] as i8, flags: row[2] as u32, gold: row[3], population: row[4], village_id: row[5] as i32, relation: row[6] as u8, achievements: row[7] as u32 });
            }
            let relevant = |rows: &BTreeMap<i32, FactionRow>| rows.iter().map(|(id, r)| (*id, r.civ, r.flags, r.village_id, r.relation)).collect::<Vec<_>>();
            if relevant(&rows) != relevant(&factions.rows) { factions.revision += 1; }
            for (&id, row) in &rows {
                if id >= 0 && row.village_id < 0 && factions.slot(id).is_none() {
                    if let Some(free) = factions.slots[..TARGET_SLOTS].iter().position(|&f| f == NONE) { factions.slots[free] = id; }
                }
            }
            factions.slots[OTHER_SLOT] = -2;
            factions.rows = rows;
        }
        self.factions_input = input;
    }
    pub fn civ_war(&mut self, a: i32, b: i32, war: bool) {
        let mut factions = self.world.resource_mut::<Factions>();
        let pair = (a.min(b), a.max(b));
        let changed = if war { factions.civ_war.insert(pair) } else { factions.civ_war.remove(&pair) };
        if changed { factions.revision += 1; }
    }

    pub fn upsert_input(&mut self, count: usize) -> *mut f64 { Self::grow(&mut self.upsert_input, count * UPSERT_STRIDE) }
    pub fn upsert_commit(&mut self, count: usize) {
        let input = std::mem::take(&mut self.upsert_input);
        for row in input[..count * UPSERT_STRIDE].chunks_exact(UPSERT_STRIDE) { self.upsert(row); }
        self.upsert_input = input;
    }
    fn upsert(&mut self, row: &[f64]) {
        let id = row[0] as i64; let kind = row[1] as u8; let owner = row[2] as i32; let flags = row[9] as u32;
        let ready = flags & 1 != 0; let removed = flags & 2 != 0;
        let now = self.world.resource::<Clock>().now;
        if let Some(entity) = self.entity(id) {
            let previous = self.world.get::<Site>(entity).unwrap().clone();
            let structural = previous.removed != removed || previous.ready != ready || previous.owner != owner || previous.kind != kind
                || previous.x != row[3] || previous.y != row[4];
            {
                let mut site = self.world.get_mut::<Site>(entity).unwrap();
                site.x = row[3]; site.y = row[4]; site.population = row[5]; site.guards = row[10];
                site.ready = ready; site.removed = removed; site.identity = row[8] as u8;
                if site.kind != kind && kind != 0 { site.kind = kind; }
            }
            if previous.owner != owner && !removed { self.reassign(entity, owner, kind, T_CAPTURE, now); }
            if structural { self.world.resource_mut::<Index>().revision += 1; self.world.resource_mut::<Hostility>().dirty = true; }
            return;
        }
        if removed { return; }
        let site = Site { id, kind, owner, x: row[3], y: row[4], population: row[5], guards: row[10], founded_at: f64::NAN,
            village_id: row[7] as i32, identity: row[8] as u8, ready, removed, activated: false };
        let heritage = Heritage { civ: row[6] as i8, kin: if kind == VILLAGE { -2 } else { -1 }, former_owner: -1 };
        let mut entity = self.world.spawn((site, heritage, Affiliation::default(), Civic::default(), Presence::default(), Published([f64::NAN; CHANGED_STRIDE])));
        if kind != CITY { entity.insert(Village::default()); }
        if kind == VILLAGE { entity.insert(Plan::default()); }
        let entity = entity.id();
        let mut index = self.world.resource_mut::<Index>(); index.by_id.insert(id, entity); index.revision += 1;
        self.world.resource_mut::<Hostility>().dirty = true;
    }
    /// Install a founding layout (family/orientation/lot) for a village.
    pub fn village_layout(&mut self, village_id: i32, family: u8, transform: u8, lot_x: i32, lot_y: i32) {
        let Some(entity) = self.village_entity(village_id) else { return; };
        let Some(count) = plan::with_template(family, |t| t.slots.iter().map(|s| u8::from(matches!(s.kind, SlotKind::Hub | SlotKind::Tent))).collect::<Vec<u8>>()) else { return; };
        if let Some(mut village) = self.world.get_mut::<Village>(entity) {
            if village.family != plan::FAMILY_NONE { return; }
            village.family = family; village.transform = transform % 8; village.lot = (lot_x, lot_y);
        }
        if let Some(mut plan) = self.world.get_mut::<Plan>(entity) {
            plan.status = count.iter().map(|&built| if built == 1 { S_BUILT } else { S_PENDING }).collect();
            plan.alternate = vec![0; count.len()]; plan.retries = vec![0; count.len()]; plan.rearmed = vec![0; count.len()];
            plan.claim_dirty = true;
        }
    }

    pub fn civic_input(&mut self, count: usize) -> *mut f64 { Self::grow(&mut self.civic_input, count * CIVIC_STRIDE) }
    pub fn civic_commit(&mut self, count: usize) {
        let input = std::mem::take(&mut self.civic_input);
        {
            let mut civics = self.world.resource_mut::<Civics>();
            for row in input[..count * CIVIC_STRIDE].chunks_exact(CIVIC_STRIDE) {
                let flags = row[7] as u32;
                let value = (flags & 2 == 0).then_some(CivicRow { kind: row[1] as u8, faction: row[2] as i32, x: row[3], y: row[4], w: row[5], h: row[6],
                    ready: flags & 1 != 0, village: flags & 4 != 0, level: row[8] as u8 });
                civics.upsert(row[0] as i64, value);
            }
        }
        self.civic_input = input;
    }

    pub fn trade(&mut self, settlement: i64, other: i64, faction: i32, partner: i32, gold: f64, kind: u32) {
        if !gold.is_finite() || gold <= 0.0 { return; }
        let slot_f = self.world.resource::<Factions>().slot(faction);
        let slot_g = self.world.resource::<Factions>().slot(partner);
        let credit = |engine: &mut Self, id: i64, slot: Option<usize>, amount: f64| {
            if let (Some(entity), Some(slot)) = (engine.entity(id), slot) {
                if let Some(mut aff) = engine.world.get_mut::<Affiliation>(entity) { aff.trade[slot] += amount; }
            }
        };
        match kind {
            1 => {
                credit(self, settlement, slot_f, gold);
                if let Some(entity) = self.entity(other) { if let Some(owner) = self.world.get::<Site>(entity).map(|s| s.owner) {
                    let slot = self.world.resource::<Factions>().slot(owner); credit(self, other, slot, 0.5 * gold);
                } }
                if let Some(entity) = self.entity(settlement) { if let Some(mut village) = self.world.get_mut::<Village>(entity) {
                    village.treasury += gold; village.lifetime_income += gold;
                    if let Some(slot) = slot_f { village.lifetime_trade[slot] += gold; }
                } }
            }
            2 => { credit(self, settlement, slot_f, gold); credit(self, other, slot_f, gold); }
            _ => {
                credit(self, settlement, slot_g, gold); credit(self, other, slot_f, gold);
                credit(self, settlement, slot_f, 0.5 * gold); credit(self, other, slot_g, 0.5 * gold);
            }
        }
    }
    pub fn casualty(&mut self, settlement: i64, attacker: i32, population: f64) {
        let Some(entity) = self.entity(settlement) else { return; };
        let owner = self.world.get::<Site>(entity).unwrap().owner;
        let slot = self.world.resource::<Factions>().slot(attacker).unwrap_or(OTHER_SLOT);
        let hostile = self.world.resource::<Hostility>().hostile(owner, attacker);
        let amount = af::casualty_exposure(population);
        let mut aff = self.world.get_mut::<Affiliation>(entity).unwrap();
        aff.exposure[slot] += amount;
        if hostile { aff.hostile_exposure += amount; }
    }
    /// The faction's Leader died: every city it owns loses half its loyalty
    /// (affiliation toward the owner).
    pub fn leader_death(&mut self, faction: i32) {
        let Some(slot) = self.world.resource::<Factions>().slot(faction) else { return; };
        let mut query = self.world.query::<(&Site, &mut Affiliation)>();
        for (site, mut aff) in query.iter_mut(&mut self.world) {
            if site.owner != faction || site.removed || slot >= aff.value.len() { continue; }
            aff.value[slot] = af::clamp(aff.value[slot] * 0.5, 0.0, 100.0);
        }
    }
    /// Scenario/debug input: set one affiliation row directly (fixtures, editor).
    pub fn quest_reward(&mut self, settlement: i64, faction: i32, amount: f64) {
        let Some(entity) = self.entity(settlement) else { return; };
        let Some(slot) = self.world.resource::<Factions>().slot(faction) else { return; };
        let site = self.world.get::<Site>(entity).unwrap().clone();
        let heritage = self.world.get::<Heritage>(entity).unwrap().clone();
        self.world.resource_scope(|world, factions: Mut<Factions>| {
            let mut aff = world.get_mut::<Affiliation>(entity).unwrap();
            ensure_slot(&mut aff, &site, &heritage, &factions, slot);
            aff.value[slot] = af::clamp(aff.value[slot] + amount.max(0.0), 0.0, 100.0);
        });
    }
    pub fn quest_post_upkeep(&mut self, village: i32, amount: f64) {
        let Some(entity) = self.village_entity(village) else { return; };
        if let Some(mut village) = self.world.get_mut::<Village>(entity) {
            let paid = amount.max(0.0).min((village.treasury - village.reserved).max(0.0));
            village.treasury -= paid;
        }
    }
    /// Scenario/debug input: set one affiliation row directly (fixtures, editor).
    pub fn set_affiliation(&mut self, settlement: i64, faction: i32, value: f64) {
        let Some(entity) = self.entity(settlement) else { return; };
        let Some(slot) = self.world.resource::<Factions>().slot(faction) else { return; };
        let site = self.world.get::<Site>(entity).unwrap().clone(); let heritage = self.world.get::<Heritage>(entity).unwrap().clone();
        self.world.resource_scope(|world, factions: Mut<Factions>| {
            let mut aff = world.get_mut::<Affiliation>(entity).unwrap();
            ensure_slot(&mut aff, &site, &heritage, &factions, slot);
            aff.value[slot] = af::clamp(value, 0.0, 100.0);
        });
    }
    /// Scenario input: set a village relation without charges (fixtures, editor).
    pub fn set_relation(&mut self, village_id: i32, faction: i32, relation: u8, trading: bool) {
        let Some(entity) = self.village_entity(village_id) else { return; };
        let Some(slot) = self.world.resource::<Factions>().slot(faction) else { return; };
        let id = self.world.get::<Site>(entity).unwrap().id;
        let mut village = self.world.get_mut::<Village>(entity).unwrap();
        if relation == ALLIED { for r in village.relations.iter_mut() { if *r == ALLIED { *r = NEUTRAL; } } }
        village.relations[slot] = relation;
        if trading { village.trading |= 1 << slot; } else { village.trading &= !(1 << slot); }
        village.relations_revision += 1;
        self.world.resource_mut::<Hostility>().dirty = true;
        self.world.resource_mut::<Outbox>().event(EV_RELATION, id, faction, relation as f64);
    }

    /// Village services have their own origin, independent of domestic route
    /// slots. New towns never replace a living origin or reset its caravan.
    pub fn village_trade_origin(&mut self, village_id: i32, faction: i32, preferred: i64) -> i64 {
        let Some(entity) = self.village_entity(village_id) else { return -1; };
        let factions = self.world.resource::<Factions>();
        let Some(slot) = factions.slot(faction) else { return -1; };
        let village = self.world.get::<Village>(entity).unwrap();
        let hub = self.world.get::<Site>(entity).unwrap();
        if !hub.ready || hub.removed || village.trading & (1 << slot) == 0 || village.relations[slot] == WAR
            || factions.row(faction).flags & (F_DEFEATED | F_VILLAGE | F_CONFEDERATED) != 0 { return -1; }
        let eligible = |site: &Site| site.kind == CITY && site.owner == faction && site.ready && !site.removed;
        if self.entity(preferred).and_then(|e| self.world.get::<Site>(e)).is_some_and(eligible) { return preferred; }
        self.world.resource::<Index>().by_id.values().filter_map(|&e| self.world.get::<Site>(e))
            .filter(|site| eligible(site)).min_by(|a, b| {
                let distance = |site: &Site| (site.x - hub.x).powi(2) + (site.y - hub.y).powi(2);
                distance(a).total_cmp(&distance(b)).then(a.id.cmp(&b.id))
            }).map_or(-1, |site| site.id)
    }

    pub fn results_input(&mut self, count: usize) -> *mut f64 { Self::grow(&mut self.results_input, count * RESULT_STRIDE) }
    pub fn results_commit(&mut self, count: usize) {
        let input = std::mem::take(&mut self.results_input);
        for row in input[..count * RESULT_STRIDE].chunks_exact(RESULT_STRIDE) {
            let rid = row[0] as u32;
            let Some(group) = self.world.resource_mut::<Requests>().by_request.remove(&rid) else { continue; };
            let complete = {
                let mut requests = self.world.resource_mut::<Requests>();
                let Some(outstanding) = requests.outstanding.get_mut(&group) else { continue; };
                outstanding.results.insert(rid, (row[1] != 0.0, row[3] as u32));
                outstanding.results.len() == outstanding.rows.len()
            };
            if complete { let done = self.world.resource_mut::<Requests>().outstanding.remove(&group).unwrap(); self.finish(done); }
        }
        self.results_input = input;
    }
    fn finish(&mut self, done: Outstanding) {
        let Some(entity) = self.entity(done.village) else { return; };
        let ok = done.results.values().all(|r| r.0);
        let reason = done.results.values().map(|r| r.1).find(|&r| r != 0 && r != B_SIBLING).unwrap_or(1);
        let first_failure = done.rows.iter().position(|rid| done.results.get(rid).is_some_and(|r| !r.0 && r.1 != B_SIBLING)).unwrap_or(0);
        let (family, village_id) = {
            let mut village = self.world.get_mut::<Village>(entity).unwrap();
            village.reserved = (village.reserved - done.cost).max(0.0);
            if ok { village.treasury -= done.cost; }
            (village.family, self.world.get::<Site>(entity).unwrap().id)
        };
        let mut skipped = Vec::new();
        {
            let mut plan = self.world.get_mut::<Plan>(entity).unwrap();
            plan.outstanding = false;
            match &done.work {
                Work::Upgrade { house } => { if !ok { plan.failed_upgrades.insert(*house); } }
                Work::Conversion { slot } => { plan.status[*slot] = if ok { S_CONVERTED } else { S_SKIPPED }; plan.claim_dirty = true; }
                Work::Slots { slots } => {
                    plan.claim_dirty = true;
                    if ok { for &slot in slots { plan.status[slot] = S_BUILT; } }
                    else {
                        let slot = slots[first_failure.min(slots.len() - 1)];
                        let retry = reason == B_TRANSIENT && { plan.retries[slot] += 1; plan.retries[slot] < MAX_TRANSIENT };
                        if !retry {
                            let alternates = plan::with_template(family, |t| t.slots[slot].alternates.len()).unwrap_or(0) as u8;
                            plan.retries[slot] = 0;
                            if plan.alternate[slot] < alternates { plan.alternate[slot] += 1; }
                            else { plan.status[slot] = S_SKIPPED; skipped.push(slot); }
                        }
                    }
                }
            }
            if !skipped.is_empty() {
                let mut plan_copy = std::mem::take(&mut *plan);
                plan::with_template(family, |t| skipped.extend(propagate_skips(t, &mut plan_copy)));
                *plan = plan_copy;
            }
        }
        let mut outbox = self.world.resource_mut::<Outbox>();
        for slot in skipped { outbox.event(EV_SLOT_SKIPPED, village_id, -1, slot as f64); }
    }

    fn ensure_engine_slot(&mut self, entity: Entity, slot: usize) {
        let site = self.world.get::<Site>(entity).unwrap().clone(); let heritage = self.world.get::<Heritage>(entity).unwrap().clone();
        self.world.resource_scope(|world, factions: Mut<Factions>| {
            let mut aff = world.get_mut::<Affiliation>(entity).unwrap();
            ensure_slot(&mut aff, &site, &heritage, &factions, slot);
        });
    }

    /// `[trade×3, ally×3, confederate×3, war×3, acceptThreshold, value, relation, trading, cooldownUntil, tribute, independence, petitionOpen, stage]`.
    pub fn village_status(&mut self, village_id: i32, faction: i32, gold: f64, reach: u32) -> [f64; STATUS_LENGTH] {
        let mut out = [0.0; STATUS_LENGTH];
        let Some(entity) = self.village_entity(village_id) else { for a in 0..4 { out[a * 3 + 1] = NO_CAMP as f64; } return out; };
        let Some(slot) = self.world.resource::<Factions>().slot(faction) else { for a in 0..4 { out[a * 3 + 1] = NO_REALM as f64; } return out; };
        self.ensure_engine_slot(entity, slot);
        let now = self.world.resource::<Clock>().now;
        let site = self.world.get::<Site>(entity).unwrap().clone();
        let aff = self.world.get::<Affiliation>(entity).unwrap().clone();
        let village = self.world.get::<Village>(entity).unwrap().clone();
        let value = aff.value[slot]; let relation = village.relations[slot];
        let trading = village.trading & (1 << slot) != 0;
        let petition = !village.petition_open_until.is_nan() && village.petition_slot == slot as i32;
        let fee = if petition { 0.0 } else { tribute(&site, &village) };
        let threshold = af::accept_threshold(aff.independence);
        let common = if site.removed || !site.ready { NO_CAMP } else if reach & (R_REALM | R_AI) == 0 { NO_REALM }
            else if reach & (R_LEADER | R_AI) == 0 { NO_LEADER } else if reach & (R_NEAR | R_REMOTE | R_AI) == 0 { NO_REACH } else { OK };
        let option = |out: &mut [f64; STATUS_LENGTH], action: usize, cost: f64, unavailable: u32| {
            let reason = if common != OK { common } else if unavailable != OK { unavailable } else if gold < cost { NEED_GOLD } else { OK };
            out[action * 3] = f64::from(u8::from(reason == OK)); out[action * 3 + 1] = reason as f64; out[action * 3 + 2] = cost;
        };
        option(&mut out, 0, af::VILLAGE_TRADE_COST, if trading { ALREADY_TRADING } else if relation == WAR { AT_WAR } else if value < af::VILLAGE_TRADE_MIN { LOW_AFFILIATION } else { OK });
        option(&mut out, 1, af::alliance_cost(village.lifetime_trade[slot]), if village.ally().is_some() { ALREADY_ALLIED } else if relation == WAR { AT_WAR }
            else if value < af::VILLAGE_ALLIANCE_MIN { LOW_AFFILIATION } else { OK });
        option(&mut out, 2, fee, if site.kind == CITY { NOT_VILLAGE } else if relation != ALLIED { NEEDS_ALLIANCE }
            else if now < village.cooldown_until[slot] { COOLDOWN } else { OK });
        option(&mut out, 3, 0.0, if relation == WAR { ALREADY_WAR } else { OK });
        out[12] = threshold; out[13] = value; out[14] = relation as f64; out[15] = f64::from(u8::from(trading));
        out[16] = village.cooldown_until[slot]; out[17] = fee; out[18] = aff.independence; out[19] = f64::from(u8::from(petition)); out[20] = village.stage as f64;
        out
    }
    /// `[ok, reason, cost, outcome(1 done, 2 accepted-pending-transfer, 3 refused)]`.
    pub fn village_command(&mut self, village_id: i32, faction: i32, action: u32, gold: f64, reach: u32) -> [f64; 4] {
        let status = self.village_status(village_id, faction, gold, reach);
        let index = match action { A_TRADE => 0, A_ALLY => 1, A_CONFEDERATE | A_PETITION => 2, A_WAR => 3, _ => return [0.0, NOT_VILLAGE as f64, 0.0, 0.0] };
        if action == A_PETITION && status[19] == 0.0 { return [0.0, NO_PETITION as f64, 0.0, 0.0]; }
        if status[index * 3] == 0.0 { return [0.0, status[index * 3 + 1], status[index * 3 + 2], 0.0]; }
        let entity = self.village_entity(village_id).unwrap();
        let slot = self.world.resource::<Factions>().slot(faction).unwrap();
        let id = self.world.get::<Site>(entity).unwrap().id;
        let cost = status[index * 3 + 2];
        if index == 2 {
            if status[19] != 0.0 || status[13] >= status[12] { return [1.0, OK as f64, cost, 2.0]; }
            let now = self.world.resource::<Clock>().now;
            self.world.get_mut::<Affiliation>(entity).unwrap().snub[slot] += af::SNUB;
            self.world.get_mut::<Village>(entity).unwrap().cooldown_until[slot] = now + af::REFUSAL_COOLDOWN;
            return [0.0, REFUSED as f64, 0.0, 3.0];
        }
        let relation = {
            let mut village = self.world.get_mut::<Village>(entity).unwrap();
            match action {
                A_TRADE => { if village.relations[slot] != ALLIED { village.relations[slot] = TRADE; } village.trading |= 1 << slot; }
                A_ALLY => { village.relations[slot] = ALLIED; }
                _ => { village.relations[slot] = WAR; village.trading &= !(1 << slot); }
            }
            village.relations_revision += 1; village.relations[slot]
        };
        self.world.resource_mut::<Hostility>().dirty = true;
        self.world.resource_mut::<Outbox>().event(EV_RELATION, id, faction, relation as f64);
        self.refresh_hostility_now();
        [1.0, OK as f64, cost, 1.0]
    }
    fn refresh_hostility_now(&mut self) {
        let mut system = IntoSystem::into_system(refresh_hostility);
        system.initialize(&mut self.world);
        let _ = system.run((), &mut self.world);
    }
    /// `[value, target, rate, culture, trade, alliance, protector, fear, threat, governance, snub, independence]`.
    pub fn breakdown(&mut self, settlement: i64, faction: i32) -> [f64; BREAKDOWN_STRIDE] {
        let Some(entity) = self.entity(settlement) else { return [f64::NAN; BREAKDOWN_STRIDE]; };
        let Some(slot) = self.world.resource::<Factions>().slot(faction) else { return [f64::NAN; BREAKDOWN_STRIDE]; };
        self.ensure_engine_slot(entity, slot);
        let site = self.world.get::<Site>(entity).unwrap();
        // A city not yet activated by a step reports the start value it will receive.
        let pending_start = !site.activated && site.kind == CITY && self.world.resource::<Factions>().slot(site.owner) == Some(slot);
        let aff = self.world.get::<Affiliation>(entity).unwrap();
        let owner = aff.owner_slot == slot as i32 || pending_start;
        let value = if pending_start { af::LOYALTY_START } else { aff.value[slot] };
        let allied = self.world.get::<Village>(entity).is_some_and(|v| v.relations[slot] == ALLIED);
        [value, aff.target[slot], aff.rate[slot], af::CULTURE_WEIGHT * af::culture(aff.alignment[slot]), af::trade(aff.trade[slot]),
            if allied && !owner { af::ALLIANCE_BONUS } else { 0.0 }, if owner { 0.0 } else { af::protector(aff.protector[slot]) },
            if owner { 0.0 } else { af::fear(aff.exposure[slot]) }, if owner { aff.threat } else { 0.0 }, if owner { aff.governance } else { 0.0 },
            aff.snub[slot], aff.independence]
    }
    /// `[relation per slot (16), tradingMask, alliedFaction(-1)]` in faction ids order of slots.
    pub fn village_relations(&mut self, village_id: i32) -> Vec<f64> {
        let mut out = vec![f64::NAN; SLOTS + 2];
        let Some(entity) = self.village_entity(village_id) else { return out; };
        let village = self.world.get::<Village>(entity).unwrap();
        let factions = self.world.resource::<Factions>();
        for slot in 0..SLOTS { out[slot] = village.relations[slot] as f64; }
        out[SLOTS] = village.trading as f64;
        out[SLOTS + 1] = village.ally().map_or(-1.0, |s| factions.slots[s] as f64);
        out
    }
    pub fn slot_factions(&self) -> [f64; SLOTS] { let f = self.world.resource::<Factions>(); f.slots.map(|id| if id == NONE { f64::NAN } else { id as f64 }) }
    pub fn civ_confederate(&mut self, target: i32, requester: i32, roll: bool) -> [f64; 3] {
        let Some(slot) = self.world.resource::<Factions>().slot(requester) else { return [0.0, 0.0, 0.0]; };
        let entities: Vec<Entity> = self.world.resource::<Index>().by_id.values().copied().collect();
        let (mut weighted, mut weights, mut plain, mut count) = (0.0, 0.0, 0.0, 0.0);
        for entity in entities {
            let site = self.world.get::<Site>(entity).unwrap().clone();
            if site.kind != CITY || site.owner != target || !site.live() { continue; }
            self.ensure_engine_slot(entity, slot);
            let value = self.world.get::<Affiliation>(entity).unwrap().value[slot];
            weighted += value * site.population.max(0.0); weights += site.population.max(0.0); plain += value; count += 1.0;
        }
        let affiliation = if weights > 0.0 { weighted / weights } else if count > 0.0 { plain / count } else { 0.0 };
        let war = self.world.resource::<Factions>().civ_hostile(target, requester);
        let chance = af::civ_confederate_chance(affiliation, war);
        if !roll { return [0.0, 0.0, (chance * 100.0).round()]; }
        let mut rng = self.world.resource_mut::<Rng>();
        let accepted = rng.next() < chance;
        let declared = !accepted && rng.next() < af::civ_refusal_war_chance(affiliation);
        [f64::from(u8::from(accepted)), f64::from(u8::from(declared)), (chance * 100.0).round()]
    }
    pub fn civ_affiliation(&mut self, target: i32, requester: i32) -> f64 {
        let Some(slot) = self.world.resource::<Factions>().slot(requester) else { return 0.0; };
        let entities: Vec<Entity> = self.world.resource::<Index>().by_id.values().copied().collect();
        let (mut weighted, mut weights, mut plain, mut count) = (0.0, 0.0, 0.0, 0.0);
        for entity in entities {
            let site = self.world.get::<Site>(entity).unwrap().clone();
            if site.kind != CITY || site.owner != target || !site.live() { continue; }
            self.ensure_engine_slot(entity, slot);
            let value = self.world.get::<Affiliation>(entity).unwrap().value[slot];
            weighted += value * site.population.max(0.0); weights += site.population.max(0.0); plain += value; count += 1.0;
        }
        if weights > 0.0 { weighted / weights } else if count > 0.0 { plain / count } else { 0.0 }
    }

    fn reassign(&mut self, entity: Entity, owner: i32, kind: u8, transfer: u32, now: f64) {
        let previous = self.world.get::<Site>(entity).unwrap().clone();
        let factions_slot = |engine: &Self, id: i32| engine.world.resource::<Factions>().slot(id);
        {
            let mut site = self.world.get_mut::<Site>(entity).unwrap();
            site.owner = owner; if kind != 0 { site.kind = kind; }
        }
        let new_kind = self.world.get::<Site>(entity).unwrap().kind;
        if transfer == T_SECEDE {
            let mut heritage = self.world.get_mut::<Heritage>(entity).unwrap(); heritage.former_owner = previous.owner;
            if let Some(slot) = factions_slot(self, previous.owner) {
                let mut aff = self.world.get_mut::<Affiliation>(entity).unwrap();
                aff.alignment[slot] = 0.80; aff.base[slot] = 0.80; aff.secede_pending = false; aff.owner_slot = -1; aff.warning = false;
            }
            if self.world.get::<Village>(entity).is_none() { self.world.entity_mut(entity).insert(Village::default()); }
        } else if new_kind == CITY {
            if previous.kind == VILLAGE {
                let kin = self.world.get::<Heritage>(entity).unwrap().kin;
                self.world.get_mut::<Heritage>(entity).unwrap().civ = kin;
            }
            self.world.entity_mut(entity).remove::<Village>(); self.world.entity_mut(entity).remove::<Plan>();
            if let Some(slot) = factions_slot(self, owner) {
                self.ensure_engine_slot(entity, slot);
                let mut aff = self.world.get_mut::<Affiliation>(entity).unwrap();
                aff.value[slot] = if transfer == T_CAPTURE && previous.kind == CITY { af::CAPTURE_LOYALTY } else { aff.value[slot].max(af::CAPTURE_LOYALTY) };
                aff.grace_until = now + af::LOYALTY_GRACE; aff.owner_slot = slot as i32; aff.secede_pending = false;
            }
        }
        self.world.resource_mut::<Index>().revision += 1;
        self.world.resource_mut::<Hostility>().dirty = true;
    }
    /// Executed by the host after it carried out an approved transfer.
    pub fn commit_transfer(&mut self, old_id: i64, new_id: i64, owner: i32, transfer: u32, village_id: i32) {
        let now = self.world.resource::<Clock>().now;
        let Some(entity) = self.entity(old_id) else { return; };
        if old_id != new_id {
            if let Some(existing) = self.entity(new_id) { self.world.despawn(existing); }
            let mut index = self.world.resource_mut::<Index>(); index.by_id.remove(&old_id); index.by_id.insert(new_id, entity);
            let mut site = self.world.get_mut::<Site>(entity).unwrap(); site.id = new_id;
        }
        {
            let mut site = self.world.get_mut::<Site>(entity).unwrap();
            site.removed = false; site.ready = true; site.activated = true;
            if transfer == T_SECEDE { site.village_id = village_id; }
            if transfer == T_CONFEDERATE_VILLAGE || transfer == T_CAPTURE && site.kind == SECEDED { site.village_id = -1; }
        }
        let kind = match transfer { T_SECEDE => SECEDED, _ => CITY };
        let mode = if transfer == T_CAPTURE && self.world.get::<Site>(entity).unwrap().kind == SECEDED { T_CONFEDERATE_CIV } else { transfer };
        self.reassign(entity, owner, kind, mode, now);
    }

    pub fn claim(&mut self, village_id: i32) -> Vec<f64> {
        let Some(entity) = self.village_entity(village_id) else { return vec![0.0]; };
        let Some(plan) = self.world.get::<Plan>(entity) else { return vec![0.0]; };
        let mut out = vec![plan.claim.len() as f64]; out.extend(plan.claim.iter().map(|&c| c as f64)); out
    }
    pub fn village_hostiles(&mut self, village_id: i32) -> Vec<f64> {
        let Some(entity) = self.village_entity(village_id) else { return vec![0.0]; };
        let presence = self.world.get::<Presence>(entity).unwrap();
        let mut out = vec![presence.hostiles.len() as f64]; out.extend(presence.hostiles.iter().map(|&id| id as f64)); out
    }
    /// `[count, (faction, food, trade, construction, research)...]`.
    pub fn village_bonuses(&mut self) -> Vec<f64> {
        let factions: Vec<i32> = self.world.resource::<Factions>().rows.iter().filter(|(id, r)| **id >= 0 && r.village_id < 0).map(|(id, _)| *id).collect();
        let slots = self.world.resource::<Factions>().slots;
        let entities: Vec<Entity> = self.world.resource::<Index>().by_id.values().copied().collect();
        let mut identities: BTreeMap<i32, BTreeSet<u8>> = BTreeMap::new();
        for entity in entities {
            let site = self.world.get::<Site>(entity).unwrap();
            if site.removed || !site.ready || site.identity > 3 { continue; }
            if site.kind == CITY { identities.entry(site.owner).or_default().insert(site.identity); continue; }
            if let Some(slot) = self.world.get::<Village>(entity).and_then(|v| v.ally()) { identities.entry(slots[slot]).or_default().insert(site.identity); }
        }
        let mut out = vec![factions.len() as f64];
        for faction in factions {
            let mut bonus = [0.0; 4];
            for &identity in identities.get(&faction).into_iter().flatten() { for (b, v) in bonus.iter_mut().zip(identity_bonus(identity)) { *b += v; } }
            out.push(faction as f64); out.extend_from_slice(&bonus);
        }
        out
    }
    pub fn plan_input(&mut self) -> *mut f64 { self.plan_input.as_mut_ptr() }
    pub fn plan_choose_harbor(&mut self, village_id: i32, center_x: i32, center_y: i32, force_family: u8, attempt: u32) -> [f64; 14] {
        let mut out = [0.0; 14];
        let patch = plan::Patch { cells: &self.plan_input };
        let Some(choice) = plan::choose(&patch, self.world.resource::<Clock>().seed, village_id as i64, force_family) else { return out; };
        let dock = plan::founding_dock(&patch, &choice);
        // Half the villages seek a coast first; inland maps still found their
        // full population after the bounded coastal attempt window.
        if village_id % 2 == 1 && attempt < 160 && dock.is_none() { return out; }
        let w = |p: (i32, i32)| ((center_x + p.0) as f64, (center_y + p.1) as f64);
        let (hx, hy) = w(choice.hub); let (t1x, t1y) = w(choice.tents[0]); let (t2x, t2y) = w(choice.tents[1]);
        out[..11].copy_from_slice(&[1.0, choice.family as f64, choice.transform as f64, center_x as f64, center_y as f64,
            hx, hy, t1x, t1y, t2x, t2y]);
        if let Some((x, y)) = dock { out[11] = 1.0; out[12] = (center_x + x) as f64; out[13] = (center_y + y) as f64; }
        out
    }

    /// Military census sample for every live settlement (design 4.3).
    fn sample(&mut self, movement: &crate::movement::Engine) {
        let mut samples = BTreeMap::new();
        let entities: Vec<(i64, Entity)> = self.world.resource::<Index>().by_id.iter().map(|(&id, &e)| (id, e)).collect();
        for (id, entity) in entities {
            let site = self.world.get::<Site>(entity).unwrap();
            if !site.live() { continue; }
            let radius = if site.kind == VILLAGE { af::VILLAGE_SENSE_RADIUS } else { af::CITY_SENSE_RADIUS };
            let reach = if site.kind == VILLAGE { radius + 2.0 } else { radius };
            let (x, y) = (site.x, site.y);
            let mut list = Vec::new();
            movement.military_in_rect(x - reach, y - reach, x + reach, y + reach, |member| {
                let distance = (member.x - x).hypot(member.y - y);
                if distance > reach { return; }
                let faction = member.faction as i32;
                let weight = af::kind_weight(member.kind) * af::proximity(distance, radius) * if faction == -2 { 1.25 } else { 1.0 };
                list.push(Sample { faction, weight: if distance <= radius { weight } else { 0.0 }, distance, id: member.id });
            });
            samples.insert(id, list);
        }
        self.world.resource_mut::<Sensed>().samples = samples;
    }

    pub fn step(&mut self, now: f64, movement: Option<&crate::movement::Engine>) -> *const f64 {
        {
            let mut outbox = self.world.resource_mut::<Outbox>();
            outbox.changed.clear(); outbox.events.clear(); outbox.requests.clear(); outbox.spawns.clear(); outbox.charges.clear();
        }
        let sense_due;
        {
            let mut clock = self.world.resource_mut::<Clock>();
            clock.now = now.max(clock.now);
            let now = clock.now;
            clock.sense_due = movement.is_some() && now >= clock.next_sense_at;
            if clock.sense_due {
                clock.sense_elapsed = if clock.last_sensed_at.is_nan() { 0.0 } else { now - clock.last_sensed_at };
                clock.last_sensed_at = now; clock.next_sense_at = next_deadline(clock.next_sense_at, now, af::SENSE_INTERVAL);
            }
            clock.integrate_due = now >= clock.next_integrate_at;
            if clock.integrate_due {
                clock.integrate_elapsed = if clock.last_integrated_at.is_nan() { 0.0 } else { now - clock.last_integrated_at };
                clock.last_integrated_at = now; clock.next_integrate_at = next_deadline(clock.next_integrate_at, now, af::INTEGRATE_INTERVAL);
            }
            sense_due = clock.sense_due;
        }
        if sense_due { if let Some(movement) = movement { self.sample(movement); } }
        self.schedule.run(&mut self.world);
        let outbox = self.world.resource::<Outbox>();
        self.header = [(outbox.changed.len() / CHANGED_STRIDE) as f64, (outbox.events.len() / EVENT_STRIDE) as f64,
            (outbox.requests.len() / REQUEST_STRIDE) as f64, (outbox.spawns.len() / SPAWN_STRIDE) as f64, (outbox.charges.len() / CHARGE_STRIDE) as f64,
            self.world.resource::<Hostility>().revision as f64, 0.0, 0.0];
        self.header.as_ptr()
    }
    pub fn outbox(&self, section: u32) -> *const f64 {
        let outbox = self.world.resource::<Outbox>();
        match section { 0 => outbox.changed.as_ptr(), 1 => outbox.events.as_ptr(), 2 => outbox.requests.as_ptr(), 3 => outbox.spawns.as_ptr(), _ => outbox.charges.as_ptr() }
    }
    pub fn hostility(&mut self) -> *const f64 {
        self.refresh_hostility_now();
        let hostility = self.world.resource::<Hostility>();
        let n = hostility.ids.len();
        self.hostility_output.clear(); self.hostility_output.push(n as f64);
        self.hostility_output.extend(hostility.ids.iter().map(|&id| id as f64));
        self.hostility_output.extend(hostility.bits.iter().map(|&b| b as f64));
        self.hostility_output.as_ptr()
    }
    pub fn hostility_revision(&mut self) -> f64 { self.refresh_hostility_now(); self.world.resource::<Hostility>().revision as f64 }

    // ------------------------------------------------------------ snapshot
    pub fn export(&mut self) -> usize {
        let mut out = vec![SNAPSHOT_MAGIC, SNAPSHOT_VERSION];
        {
            let clock = self.world.resource::<Clock>();
            let rng = self.world.resource::<Rng>().0;
            out.extend_from_slice(&[clock.now, clock.next_sense_at, clock.last_sensed_at, clock.next_integrate_at, clock.last_integrated_at,
                (rng >> 32) as f64, (rng & 0xFFFF_FFFF) as f64]);
            let factions = self.world.resource::<Factions>();
            out.extend(factions.slots.iter().map(|&id| if id == NONE { f64::NAN } else { id as f64 }));
            out.push(factions.civ_war.len() as f64);
            for &(a, b) in &factions.civ_war { out.extend_from_slice(&[a as f64, b as f64]); }
            out.push(factions.next_ai_at.len() as f64);
            for (&id, &at) in &factions.next_ai_at { out.extend_from_slice(&[id as f64, at]); }
        }
        let entities: Vec<(i64, Entity)> = self.world.resource::<Index>().by_id.iter().map(|(&id, &e)| (id, e)).collect();
        out.push(entities.len() as f64);
        for (_, entity) in entities {
            let s = self.world.get::<Site>(entity).unwrap(); let h = self.world.get::<Heritage>(entity).unwrap();
            let a = self.world.get::<Affiliation>(entity).unwrap();
            let b = |v: bool| f64::from(u8::from(v));
            out.extend_from_slice(&[s.id as f64, s.kind as f64, s.owner as f64, s.x, s.y, s.population, s.guards, s.founded_at, s.village_id as f64,
                s.identity as f64, b(s.ready), b(s.removed), b(s.activated), h.civ as f64, h.kin as f64, h.former_owner as f64,
                a.init as f64, a.hostile_exposure, a.grace_until, b(a.warning), b(a.secede_pending), a.owner_slot as f64, a.threat, a.protection, a.governance, a.independence]);
            let slots: Vec<usize> = (0..SLOTS).filter(|&k| a.init & (1 << k) != 0 || a.exposure[k] != 0.0 || a.trade[k] != 0.0 || a.protector[k] != 0.0 || a.snub[k] != 0.0).collect();
            out.push(slots.len() as f64);
            for k in slots { out.extend_from_slice(&[k as f64, a.value[k], a.target[k], a.rate[k], a.alignment[k], a.base[k], a.trade[k], a.exposure[k], a.protector[k], a.snub[k]]); }
            match self.world.get::<Village>(entity) {
                Some(v) => {
                    out.push(1.0);
                    out.extend_from_slice(&[v.stage as f64, v.family as f64, v.transform as f64, v.lot.0 as f64, v.lot.1 as f64, v.treasury, v.reserved,
                        v.lifetime_income, v.trading as f64, v.relations_revision as f64, v.petition_slot as f64, v.petition_since, v.petition_open_until,
                        v.petition_next, v.next_growth_at, v.next_recruit_at, v.next_adopt_at, v.budget as f64]);
                    out.extend(v.relations.iter().map(|&r| r as f64)); out.extend_from_slice(&v.lifetime_trade); out.extend_from_slice(&v.cooldown_until);
                }
                None => out.push(0.0),
            }
            match self.world.get::<Plan>(entity) {
                Some(p) => {
                    out.push(1.0); out.push(p.status.len() as f64);
                    for i in 0..p.status.len() { out.extend_from_slice(&[p.status[i] as f64, p.alternate[i] as f64, p.retries[i] as f64, p.rearmed[i] as f64]); }
                    out.push(p.adopted as f64); out.extend(p.adopted_from.iter().map(|&f| f as f64)); out.extend(p.lots.iter().map(|&l| l as f64));
                    out.push(p.claim_revision as f64);
                }
                None => out.push(0.0),
            }
        }
        self.export = out; self.export.len()
    }
    pub fn export_ptr(&self) -> *const f64 { self.export.as_ptr() }
    /// The current snapshot, for the sectioned simulation save (`sim::save`).
    pub fn snapshot(&mut self) -> &[f64] { let len = self.export(); &self.export[..len] }
    /// Restore a snapshot taken by `snapshot`; false leaves the engine unchanged.
    pub fn restore(&mut self, data: &[f64]) -> bool { self.import(data).is_some() }
    pub fn import_input(&mut self, len: usize) -> *mut f64 { Self::grow(&mut self.import_input, len) }
    pub fn import_commit(&mut self, len: usize) -> bool {
        let input = std::mem::take(&mut self.import_input);
        let ok = self.import(&input[..len.min(input.len())]).is_some();
        self.import_input = input; ok
    }
    fn import(&mut self, data: &[f64]) -> Option<()> {
        let mut r = Reader { data, at: 0 };
        if r.next()? != SNAPSHOT_MAGIC || r.next()? != SNAPSHOT_VERSION { return None; }
        let (width, height, seed) = { let c = self.world.resource::<Clock>(); (c.width, c.height, c.seed) };
        let mut fresh = SettlementEngine::new(width, height, seed as i64 as f64);
        {
            let mut clock = fresh.world.resource_mut::<Clock>();
            clock.now = r.next()?; clock.next_sense_at = r.next()?; clock.last_sensed_at = r.next()?; clock.next_integrate_at = r.next()?; clock.last_integrated_at = r.next()?;
        }
        let hi = r.next()? as u64; let lo = r.next()? as u64; fresh.world.resource_mut::<Rng>().0 = (hi << 32) | lo;
        {
            let mut factions = fresh.world.resource_mut::<Factions>();
            for slot in 0..SLOTS { let v = r.next()?; factions.slots[slot] = if v.is_nan() { NONE } else { v as i32 }; }
            for _ in 0..r.next()? as usize { let (a, b) = (r.next()? as i32, r.next()? as i32); factions.civ_war.insert((a, b)); }
            for _ in 0..r.next()? as usize { let (id, at) = (r.next()? as i32, r.next()?); factions.next_ai_at.insert(id, at); }
        }
        for _ in 0..r.next()? as usize {
            let site = Site { id: r.next()? as i64, kind: r.next()? as u8, owner: r.next()? as i32, x: r.next()?, y: r.next()?, population: r.next()?, guards: r.next()?,
                founded_at: r.next()?, village_id: r.next()? as i32, identity: r.next()? as u8, ready: r.next()? != 0.0, removed: r.next()? != 0.0, activated: r.next()? != 0.0 };
            let heritage = Heritage { civ: r.next()? as i8, kin: r.next()? as i8, former_owner: r.next()? as i32 };
            let mut a = Affiliation { init: r.next()? as u32, hostile_exposure: r.next()?, grace_until: r.next()?, warning: r.next()? != 0.0, secede_pending: r.next()? != 0.0,
                owner_slot: r.next()? as i32, threat: r.next()?, protection: r.next()?, governance: r.next()?, independence: r.next()?, ..Affiliation::default() };
            for _ in 0..r.next()? as usize {
                let k = r.next()? as usize;
                a.value[k] = r.next()?; a.target[k] = r.next()?; a.rate[k] = r.next()?; a.alignment[k] = r.next()?; a.base[k] = r.next()?;
                a.trade[k] = r.next()?; a.exposure[k] = r.next()?; a.protector[k] = r.next()?; a.snub[k] = r.next()?;
            }
            let id = site.id;
            let mut entity = fresh.world.spawn((site, heritage, a, Civic::default(), Presence::default(), Published([f64::NAN; CHANGED_STRIDE])));
            if r.next()? != 0.0 {
                let mut v = Village { stage: r.next()? as u8, family: r.next()? as u8, transform: r.next()? as u8, lot: (r.next()? as i32, r.next()? as i32),
                    treasury: r.next()?, reserved: r.next()?, lifetime_income: r.next()?, trading: r.next()? as u16, relations_revision: r.next()? as u32,
                    petition_slot: r.next()? as i32, petition_since: r.next()?, petition_open_until: r.next()?, petition_next: r.next()?,
                    next_growth_at: r.next()?, next_recruit_at: r.next()?, next_adopt_at: r.next()?, budget: r.next()? as u8, ..Village::default() };
                for k in 0..SLOTS { v.relations[k] = r.next()? as u8; }
                for k in 0..SLOTS { v.lifetime_trade[k] = r.next()?; }
                for k in 0..SLOTS { v.cooldown_until[k] = r.next()?; }
                v.reserved = 0.0;
                entity.insert(v);
            }
            if r.next()? != 0.0 {
                let n = r.next()? as usize; let mut p = Plan::default();
                for _ in 0..n { p.status.push(r.next()? as u8); p.alternate.push(r.next()? as u8); p.retries.push(r.next()? as u8); p.rearmed.push(r.next()? as u8); }
                p.adopted = r.next()? as u32;
                for k in 0..16 { p.adopted_from[k] = r.next()? as i32; }
                for k in 0..4 { p.lots[k] = r.next()? as u8; }
                p.claim_revision = r.next()? as u32; p.claim_dirty = true;
                entity.insert(p);
            }
            let entity = entity.id();
            fresh.world.resource_mut::<Index>().by_id.insert(id, entity);
        }
        if r.at != data.len() { return None; }
        fresh.world.resource_mut::<Index>().revision += 1;
        // Claims are derived; recompute without advancing the claim revision.
        let entities: Vec<Entity> = fresh.world.resource::<Index>().by_id.values().copied().collect();
        for entity in &entities { if let Some(mut p) = fresh.world.get_mut::<Plan>(*entity) { p.claim_revision = p.claim_revision.saturating_sub(1); } }
        let mut claims = IntoSystem::into_system(refresh_claims); claims.initialize(&mut fresh.world); let _ = claims.run((), &mut fresh.world);
        let SettlementEngine { world, schedule, .. } = fresh;
        self.world = world; self.schedule = schedule;
        Some(())
    }
}
struct Reader<'a> { data: &'a [f64], at: usize }
impl Reader<'_> { fn next(&mut self) -> Option<f64> { let v = self.data.get(self.at).copied(); self.at += 1; v } }

/// Skip unreachable roads and frontage-less structures after a skip.
fn propagate_skips(template: &plan::Template, plan: &mut Plan) -> Vec<usize> {
    let mut skipped = Vec::new();
    let alive: BTreeMap<(i32, i32), usize> = template.slots.iter().enumerate()
        .filter(|(i, s)| s.kind == SlotKind::Road && plan.status[*i] != S_SKIPPED).map(|(i, s)| (s.cells[0], i)).collect();
    let lot = |c: &(i32, i32)| template.symbols.get(c) == Some(&'P');
    let near = [(1, 0), (-1, 0), (0, 1), (0, -1)];
    let mut reached = BTreeSet::new(); let mut queue: VecDeque<(i32, i32)> = alive.keys().copied()
        .filter(|c| near.iter().any(|(dx, dy)| lot(&(c.0 + dx, c.1 + dy)))).collect();
    while let Some(c) = queue.pop_front() {
        if !reached.insert(c) { continue; }
        for (dx, dy) in near { let n = (c.0 + dx, c.1 + dy); if alive.contains_key(&n) && !reached.contains(&n) { queue.push_back(n); } }
    }
    for (&cell, &index) in &alive { if !reached.contains(&cell) && plan.status[index] == S_PENDING { plan.status[index] = S_SKIPPED; skipped.push(index); } }
    let houses: BTreeMap<(i32, i32), usize> = template.slots.iter().enumerate().filter(|(_, s)| s.kind == SlotKind::House)
        .flat_map(|(i, s)| s.cells.iter().map(move |&c| (c, i))).collect();
    for (index, slot) in template.slots.iter().enumerate() {
        if plan.status[index] != S_PENDING { continue; }
        let lost = match slot.kind {
            SlotKind::House | SlotKind::GuardPost | SlotKind::Lot(_) | SlotKind::Quay => {
                let cells = slot_cells(slot, plan.alternate[index]);
                !cells.iter().any(|c| near.iter().any(|(dx, dy)| { let n = (c.0 + dx, c.1 + dy); lot(&n) || reached.contains(&n) }))
            }
            SlotKind::Well => houses.get(&slot.cells[0]).is_some_and(|&h| plan.status[h] == S_SKIPPED),
            _ => false,
        };
        if lost { plan.status[index] = S_SKIPPED; skipped.push(index); }
    }
    skipped
}

#[derive(Default)]
pub struct Engines { next_handle: u32, engines: BTreeMap<u32, SettlementEngine> }
impl Engines {
    pub fn create(&mut self, width: i32, height: i32, seed: f64) -> u32 {
        self.next_handle = self.next_handle.checked_add(1).expect("settlement handle overflow");
        self.engines.insert(self.next_handle, SettlementEngine::new(width, height, seed)); self.next_handle
    }
    pub fn drop_engine(&mut self, handle: u32) { self.engines.remove(&handle); }
    pub fn get_mut(&mut self, handle: u32) -> &mut SettlementEngine { self.engines.get_mut(&handle).expect("unknown settlement engine") }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn engine() -> SettlementEngine { SettlementEngine::new(120, 90, 7.0) }
    fn factions(e: &mut SettlementEngine, rows: &[[f64; FACTION_STRIDE]]) {
        let p = e.factions_input(rows.len());
        let input = unsafe { std::slice::from_raw_parts_mut(p, rows.len() * FACTION_STRIDE) };
        for (i, row) in rows.iter().enumerate() { input[i * FACTION_STRIDE..(i + 1) * FACTION_STRIDE].copy_from_slice(row); }
        e.factions_commit(rows.len());
    }
    fn upsert(e: &mut SettlementEngine, row: [f64; UPSERT_STRIDE]) {
        let p = e.upsert_input(1);
        unsafe { std::slice::from_raw_parts_mut(p, UPSERT_STRIDE) }.copy_from_slice(&row);
        e.upsert_commit(1);
    }
    fn civic(e: &mut SettlementEngine, row: [f64; CIVIC_STRIDE]) {
        let p = e.civic_input(1);
        unsafe { std::slice::from_raw_parts_mut(p, CIVIC_STRIDE) }.copy_from_slice(&row);
        e.civic_commit(1);
    }
    fn header(e: &mut SettlementEngine, now: f64) -> [f64; HEADER] { let p = e.step(now, None); unsafe { *(p as *const [f64; HEADER]) } }
    fn section(e: &SettlementEngine, s: u32, len: usize) -> Vec<f64> { unsafe { std::slice::from_raw_parts(e.outbox(s), len) }.to_vec() }
    /// Player 0 (human), rival 1 at peace, village faction 5 (village 1).
    fn rows(e: &mut SettlementEngine) {
        factions(e, &[[0.0, 0.0, 2.0, 5000.0, 20.0, -1.0, 0.0, 0.0], [1.0, 1.0, 0.0, 5000.0, 30.0, -1.0, 1.0, 0.0],
            [5.0, -1.0, 4.0, 0.0, 3.0, 1.0, 1.0, 0.0]]);
        upsert(e, [100.0, 1.0, 0.0, 20.0, 20.0, 10.0, 0.0, -1.0, 255.0, 1.0, 0.0, 0.0]);
        upsert(e, [200.0, 1.0, 1.0, 90.0, 60.0, 10.0, 1.0, -1.0, 255.0, 1.0, 0.0, 0.0]);
    }
    fn world() -> SettlementEngine {
        let mut e = engine();
        rows(&mut e);
        upsert(&mut e, [300.0, 2.0, 5.0, 40.0, 30.0, 3.0, -1.0, 1.0, 0.0, 1.0, 1.0, 0.0]);
        e
    }
    fn loyalty(e: &mut SettlementEngine, id: i64) -> f64 { e.breakdown(id, 0)[0] }

    #[test]
    fn own_city_settles_at_seventy_through_the_schedule() {
        let mut e = world();
        for t in 0..=720 { header(&mut e, t as f64); }
        assert!((loyalty(&mut e, 100) - 70.0).abs() < 0.5, "loyalty {}", loyalty(&mut e, 100));
    }

    #[test]
    fn breakdown_reports_the_start_value_before_activation() {
        let mut e = world();
        assert_eq!(loyalty(&mut e, 100), af::LOYALTY_START);
        header(&mut e, 0.0);
        assert_eq!(loyalty(&mut e, 100), af::LOYALTY_START);
    }

    #[test]
    fn elapsed_is_chunked_not_lost() {
        let mut a = world(); let mut b = world();
        header(&mut a, 0.0); header(&mut b, 0.0);
        for t in (5..=30).step_by(5) { header(&mut a, t as f64); }
        header(&mut b, 30.0);
        assert!((loyalty(&mut a, 100) - loyalty(&mut b, 100)).abs() < 1e-9);
    }

    #[test]
    fn secession_emits_once_and_waits_for_commit() {
        let mut e = world();
        header(&mut e, 0.0);
        e.set_affiliation(100, 0, 0.0);
        { let entity = e.entity(100).unwrap(); e.world.get_mut::<Affiliation>(entity).unwrap().grace_until = 0.0; }
        // A culturally foreign city with heavy threat targets below zero.
        { let entity = e.entity(100).unwrap(); let mut a = e.world.get_mut::<Affiliation>(entity).unwrap(); a.alignment[0] = 0.3; a.base[0] = 0.3; a.hostile_exposure = 30.0; }
        let mut secessions = 0;
        for t in (5..=60).step_by(5) {
            let h = header(&mut e, t as f64);
            let events = section(&e, 1, h[1] as usize * EVENT_STRIDE);
            secessions += events.chunks(EVENT_STRIDE).filter(|ev| ev[0] == EV_SECEDE as f64 && ev[1] == 100.0).count();
        }
        assert_eq!(secessions, 1);
        e.commit_transfer(100, 100, 6, T_SECEDE, 2);
        let entity = e.entity(100).unwrap();
        assert!(!e.world.get::<Affiliation>(entity).unwrap().secede_pending);
        assert_eq!(e.world.get::<Site>(entity).unwrap().kind, SECEDED);
        assert_eq!(e.world.get::<Affiliation>(entity).unwrap().alignment[0], 0.80);
    }

    #[test]
    fn village_status_reasons() {
        let mut e = world(); header(&mut e, 0.0);
        let all = R_NEAR | R_LEADER | R_REALM;
        let s = e.village_status(1, 0, 5000.0, all);
        assert_eq!(s[1], OK as f64, "trade allowed at initial kin affiliation");
        assert_eq!(s[4], LOW_AFFILIATION as f64);
        assert_eq!(s[7], NEEDS_ALLIANCE as f64);
        assert_eq!(e.village_status(1, 0, 5000.0, R_LEADER | R_REALM)[1], NO_REACH as f64);
        assert_eq!(e.village_status(1, 0, 5000.0, R_NEAR | R_REALM)[1], NO_LEADER as f64);
        assert_eq!(e.village_status(1, 0, 100.0, all)[1], NEED_GOLD as f64);
        assert_eq!(e.village_command(1, 0, A_TRADE, 5000.0, all), [1.0, 0.0, 250.0, 1.0]);
        assert_eq!(e.village_status(1, 0, 5000.0, all)[1], ALREADY_TRADING as f64);
        e.set_affiliation(300, 0, 50.0);
        assert_eq!(e.village_command(1, 0, A_ALLY, 5000.0, all)[3], 1.0);
        assert_eq!(e.village_status(1, 1, 5000.0, all)[4], ALREADY_ALLIED as f64);
        assert_eq!(e.village_command(1, 0, A_WAR, 0.0, all)[3], 1.0);
        assert_eq!(e.village_status(1, 0, 5000.0, all)[10], ALREADY_WAR as f64);
        assert_eq!(e.village_status(1, 0, 5000.0, all)[1], AT_WAR as f64);
    }

    #[test]
    fn confederation_threshold_exact() {
        let mut e = world(); header(&mut e, 0.0);
        e.set_relation(1, 0, ALLIED, true);
        let all = R_NEAR | R_LEADER | R_REALM;
        let threshold = e.village_status(1, 0, 5000.0, all)[12];
        assert_eq!(threshold, 60.0, "independence 70 - 10");
        e.set_affiliation(300, 0, threshold);
        assert_eq!(e.village_command(1, 0, A_CONFEDERATE, 5000.0, all)[3], 2.0);
        e.set_affiliation(300, 0, threshold - 0.01);
        assert_eq!(e.village_command(1, 0, A_CONFEDERATE, 5000.0, all)[3], 3.0);
    }

    #[test]
    fn refusal_sets_cooldown_and_snub_without_charge() {
        let mut e = world(); header(&mut e, 0.0);
        e.set_relation(1, 0, ALLIED, true);
        let all = R_NEAR | R_LEADER | R_REALM;
        let refused = e.village_command(1, 0, A_CONFEDERATE, 5000.0, all);
        assert_eq!(refused, [0.0, REFUSED as f64, 0.0, 3.0]);
        let status = e.village_status(1, 0, 5000.0, all);
        assert_eq!(status[7], COOLDOWN as f64); assert_eq!(status[16], af::REFUSAL_COOLDOWN);
        assert_eq!(e.breakdown(300, 0)[10], af::SNUB);
        header(&mut e, 91.0);
        assert_eq!(e.village_status(1, 0, 5000.0, all)[6], 1.0);
    }

    #[test]
    fn petition_requires_sustained_condition_and_rate_limit() {
        let mut e = world(); header(&mut e, 0.0);
        e.set_relation(1, 0, ALLIED, true);
        let mut petitions = Vec::new();
        for t in (5..=900).step_by(5) {
            e.set_affiliation(300, 0, 100.0);
            let h = header(&mut e, t as f64);
            for ev in section(&e, 1, h[1] as usize * EVENT_STRIDE).chunks(EVENT_STRIDE) { if ev[0] == EV_PETITION as f64 { petitions.push(t); } }
        }
        assert_eq!(petitions.len(), 2, "{petitions:?}");
        assert!(petitions[0] >= 120 && petitions[1] - petitions[0] >= 600);
    }

    #[test]
    fn hostility_matches_legacy_rules() {
        let mut e = world(); header(&mut e, 0.0);
        let hostile = |e: &mut SettlementEngine, a: i32, b: i32| { e.refresh_hostility_now(); e.world.resource::<Hostility>().hostile(a, b) };
        assert!(!hostile(&mut e, 5, 0)); assert!(!hostile(&mut e, 5, -2)); assert!(hostile(&mut e, 0, -2));
        e.set_relation(1, 0, ALLIED, false);
        assert!(hostile(&mut e, 5, -2), "allied villages fight raiders");
        factions(&mut e, &[[0.0, 0.0, 2.0, 5000.0, 20.0, -1.0, 0.0, 0.0], [1.0, 1.0, 0.0, 5000.0, 30.0, -1.0, 2.0, 0.0], [5.0, -1.0, 4.0, 0.0, 3.0, 1.0, 1.0, 0.0]]);
        assert!(hostile(&mut e, 5, 1), "allied villages fight the player's enemies");
        e.set_relation(1, 0, WAR, false);
        assert!(hostile(&mut e, 0, 5) && !hostile(&mut e, 5, -2));
    }

    #[test]
    fn civic_counts_and_protection_follow_nearest_same_owner() {
        let mut e = world();
        civic(&mut e, [900.0, K_GUARD_POST as f64, 0.0, 22.0, 22.0, 1.0, 1.0, 1.0, 0.0]);
        civic(&mut e, [901.0, K_LIBRARY as f64, 0.0, 24.0, 20.0, 2.0, 2.0, 1.0, 0.0]);
        civic(&mut e, [902.0, K_GUARD_POST as f64, 1.0, 22.0, 22.0, 1.0, 1.0, 1.0, 0.0]);
        header(&mut e, 0.0);
        let entity = e.entity(100).unwrap();
        let c = e.world.get::<Civic>(entity).unwrap();
        assert_eq!((c.guard_posts, c.advanced), (1.0, 1.0));
    }

    fn founded(family: u8) -> SettlementEngine {
        let mut e = world();
        e.village_layout(1, family, 0, 40, 30);
        e
    }

    #[test]
    fn stage_gates_require_age_population_and_completion() {
        let mut e = founded(plan::ROADSIDE);
        header(&mut e, 0.0);
        let entity = e.village_entity(1).unwrap();
        // Everything for stage 0 is built at founding; age and villagers gate stage 1.
        for t in 1..=400 { let h = header(&mut e, t as f64); answer_all(&mut e, h, true); }
        assert_eq!(e.world.get::<Village>(entity).unwrap().stage, 0, "three villagers are too few");
        e.world.get_mut::<Site>(entity).unwrap().population = 4.0;
        for t in 401..=600 { let h = header(&mut e, t as f64); answer_all(&mut e, h, true); }
        assert_eq!(e.world.get::<Village>(entity).unwrap().stage, 1);
    }

    fn answer_all(e: &mut SettlementEngine, h: [f64; HEADER], ok: bool) -> Vec<Vec<f64>> {
        let rows: Vec<Vec<f64>> = section(e, 2, h[2] as usize * REQUEST_STRIDE).chunks(REQUEST_STRIDE).map(|c| c.to_vec()).collect();
        if rows.is_empty() { return rows; }
        let p = e.results_input(rows.len());
        let input = unsafe { std::slice::from_raw_parts_mut(p, rows.len() * RESULT_STRIDE) };
        for (i, row) in rows.iter().enumerate() { input[i * RESULT_STRIDE..(i + 1) * RESULT_STRIDE].copy_from_slice(&[row[0], f64::from(u8::from(ok)), 1000.0 + row[0], if ok { 0.0 } else { 1.0 }]); }
        e.results_commit(rows.len());
        rows
    }

    #[test]
    fn growth_requests_are_bounded_and_ordered() {
        let mut e = founded(plan::ROADSIDE);
        let entity = e.village_entity(1).unwrap();
        e.world.get_mut::<Site>(entity).unwrap().population = 20.0;
        e.world.get_mut::<Village>(entity).unwrap().treasury = 10_000.0;
        let mut kinds = Vec::new();
        for t in 0..=400 {
            let h = header(&mut e, t as f64);
            assert!(h[2] as usize <= 4 * MAX_OUTSTANDING);
            let groups: BTreeSet<u64> = section(&e, 2, h[2] as usize * REQUEST_STRIDE).chunks(REQUEST_STRIDE).map(|r| r[7] as u64).collect();
            assert!(groups.len() <= 1, "one group per village per step");
            for row in answer_all(&mut e, h, true) { kinds.push(row[2] as u8); }
        }
        assert_eq!(kinds.first(), Some(&K_ROAD), "roads come first");
        assert!(kinds.contains(&K_HOUSE));
        let first_house = kinds.iter().position(|&k| k == K_HOUSE).unwrap();
        assert!(kinds[..first_house].iter().all(|&k| k == K_ROAD));
    }

    #[test]
    fn treasury_never_double_spends_outstanding_requests() {
        let mut e = founded(plan::ROADSIDE);
        let entity = e.village_entity(1).unwrap();
        e.world.get_mut::<Site>(entity).unwrap().population = 20.0;
        e.world.get_mut::<Village>(entity).unwrap().treasury = 13.0;
        header(&mut e, 0.0);
        let h = header(&mut e, 90.0);
        let rows = section(&e, 2, h[2] as usize * REQUEST_STRIDE);
        let cost: f64 = rows.chunks(REQUEST_STRIDE).map(|r| r[8]).sum();
        assert!(cost <= 13.0);
        let v = e.world.get::<Village>(entity).unwrap();
        assert!(v.treasury - v.reserved >= 0.0);
        let h = header(&mut e, 90.5);
        assert_eq!(h[2], 0.0, "no new request while one is outstanding");
    }

    #[test]
    fn failed_slot_uses_alternates_then_skips_dependents() {
        let mut e = founded(plan::ROADSIDE);
        let entity = e.village_entity(1).unwrap();
        e.world.get_mut::<Site>(entity).unwrap().population = 20.0;
        e.world.get_mut::<Village>(entity).unwrap().treasury = 10_000.0;
        e.world.get_mut::<Site>(entity).unwrap().guards = 99.0;
        // Fail every request: roads have no alternates and skip; dependents follow.
        for t in 0..=600 { let h = header(&mut e, t as f64); answer_all(&mut e, h, false); }
        let plan = e.world.get::<Plan>(entity).unwrap();
        let stage1: Vec<u8> = plan::with_template(plan::ROADSIDE, |t| t.slots.iter().enumerate().filter(|(_, s)| s.stage == 1).map(|(i, _)| plan.status[i]).collect()).unwrap();
        assert!(stage1.iter().all(|&s| s == S_SKIPPED), "{stage1:?}");
        assert!(e.world.get::<Village>(entity).unwrap().treasury >= 10_000.0, "no charge for failed sites");
    }

    #[test]
    fn transient_failures_retry_five_times() {
        let mut e = founded(plan::ROADSIDE);
        let entity = e.village_entity(1).unwrap();
        e.world.get_mut::<Site>(entity).unwrap().population = 20.0;
        e.world.get_mut::<Village>(entity).unwrap().treasury = 10_000.0;
        header(&mut e, 0.0);
        let mut attempts = 0;
        for t in 1..=1200 {
            let h = header(&mut e, t as f64 * 0.5);
            let rows = section(&e, 2, h[2] as usize * REQUEST_STRIDE);
            if rows.is_empty() { continue; }
            if attempts < 5 { attempts += 1; }
            let p = e.results_input(h[2] as usize);
            let input = unsafe { std::slice::from_raw_parts_mut(p, h[2] as usize * RESULT_STRIDE) };
            for (i, row) in rows.chunks(REQUEST_STRIDE).enumerate() { input[i * RESULT_STRIDE..(i + 1) * RESULT_STRIDE].copy_from_slice(&[row[0], 0.0, 0.0, if i == 0 { 2.0 } else { 6.0 }]); }
            e.results_commit(h[2] as usize);
            if e.world.get::<Plan>(entity).unwrap().status.iter().any(|&s| s == S_SKIPPED) { break; }
        }
        assert_eq!(attempts, 5);
    }

    #[test]
    fn adoption_threshold_caps_and_persistence() {
        let mut e = founded(plan::ROADSIDE);
        let entity = e.village_entity(1).unwrap();
        e.world.get_mut::<Village>(entity).unwrap().stage = 2;
        civic(&mut e, [900.0, K_LIBRARY as f64, 0.0, 53.0, 30.0, 2.0, 2.0, 1.0, 0.0]);
        civic(&mut e, [901.0, K_BLACKSMITH as f64, 0.0, 52.0, 30.0, 1.0, 1.0, 1.0, 0.0]);
        header(&mut e, 0.0); e.set_affiliation(300, 0, 60.0);
        for t in 1..=61 { header(&mut e, t as f64); }
        let plan = e.world.get::<Plan>(entity).unwrap();
        assert_eq!(plan.lots.iter().filter(|&&k| k != 0).count(), 1, "stage 2 caps one lot kind");
        assert!(plan.adopted & (1 << K_LIBRARY) != 0 || plan.adopted & (1 << K_BLACKSMITH) != 0);
        let adopted = plan.adopted;
        civic(&mut e, [900.0, K_LIBRARY as f64, 0.0, 53.0, 30.0, 2.0, 2.0, 3.0, 0.0]);
        for t in 62..=200 { header(&mut e, t as f64); }
        assert_eq!(e.world.get::<Plan>(entity).unwrap().adopted & adopted, adopted, "adoption is permanent");
    }

    #[test]
    fn towers_wait_for_wooden_tower_adoption_and_dock_needs_quay() {
        let template_tower = plan::with_template(plan::ROADSIDE, |t| t.slots.iter().position(|s| s.kind == SlotKind::Tower).unwrap()).unwrap();
        let mut p = Plan { status: vec![0; 200], ..Plan::default() };
        assert!(!eligible(SlotKind::Tower, &p));
        p.adopted |= 1 << K_WOODEN_TOWER;
        assert!(eligible(SlotKind::Tower, &p));
        assert!(!eligible(SlotKind::Quay, &Plan::default()));
        let _ = template_tower;
        // Dock adoption is refused off the river.
        let mut e = founded(plan::ROADSIDE);
        let entity = e.village_entity(1).unwrap();
        e.world.get_mut::<Village>(entity).unwrap().stage = 3;
        civic(&mut e, [900.0, K_DOCK as f64, 0.0, 45.0, 30.0, 1.0, 1.0, 1.0, 0.0]);
        header(&mut e, 0.0); e.set_affiliation(300, 0, 90.0);
        for t in 1..=61 { header(&mut e, t as f64); }
        assert_eq!(e.world.get::<Plan>(entity).unwrap().adopted & (1 << K_DOCK), 0);
    }

    #[test]
    fn claim_contains_built_and_pending_current_stage() {
        let mut e = founded(plan::ROADSIDE);
        header(&mut e, 0.0);
        let claim = e.claim(1);
        let cells: BTreeSet<i64> = claim[1..].iter().map(|&c| c as i64).collect();
        assert!(cells.contains(&(30 * 120 + 40)), "lot");
        let hub = plan::place((40, 30), (-1, 1), 0);
        assert!(cells.contains(&((hub.1 + 1) as i64 * 120 + hub.0 as i64)), "neighbor of the built hub");
    }

    #[test]
    fn ai_trade_alliance_confederation_order() {
        let mut e = world(); header(&mut e, 0.0);
        let mut codes = Vec::new();
        for t in 1..=400 {
            let h = header(&mut e, t as f64);
            for ev in section(&e, 1, h[1] as usize * EVENT_STRIDE).chunks(EVENT_STRIDE) {
                if ev[2] == 1.0 && [EV_AI_TRADE, EV_RELATION, EV_AI_CONFEDERATE].contains(&(ev[0] as u8)) {
                    codes.push(ev[0] as u8);
                    if ev[0] as u8 == EV_AI_TRADE && ev[3] == 0.0 { e.village_command(1, 1, A_TRADE, 5000.0, R_AI); }
                }
            }
            e.set_affiliation(300, 1, 95.0);
        }
        let first = |code: u8| codes.iter().position(|&c| c == code);
        assert!(first(EV_AI_TRADE).unwrap() < first(EV_RELATION).unwrap());
        assert!(first(EV_RELATION).unwrap() < first(EV_AI_CONFEDERATE).unwrap(), "{codes:?}");
    }

    #[test]
    fn civ_confederation_uses_population_weighted_affiliation() {
        let mut e = world(); header(&mut e, 0.0);
        e.set_affiliation(200, 0, 50.0);
        assert_eq!(e.civ_confederate(1, 0, false)[2], 50.0);
        let mut accepted = 0;
        for _ in 0..400 { accepted += e.civ_confederate(1, 0, true)[0] as i32; }
        assert!((150..=250).contains(&accepted), "{accepted}");
    }

    #[test]
    fn export_import_round_trip_is_bit_exact() {
        let mut e = founded(plan::MARKET_CROSS);
        let entity = e.village_entity(1).unwrap();
        e.world.get_mut::<Site>(entity).unwrap().population = 20.0;
        for t in 0..300 { let h = header(&mut e, t as f64); answer_all(&mut e, h, t % 3 != 0); }
        e.trade(300, 100, 0, -1, 80.0, 1);
        let len = e.export(); let a = unsafe { std::slice::from_raw_parts(e.export_ptr(), len) }.to_vec();
        let mut f = engine();
        let p = f.import_input(len); unsafe { std::slice::from_raw_parts_mut(p, len) }.copy_from_slice(&a);
        assert!(f.import_commit(len));
        let len2 = f.export(); let b = unsafe { std::slice::from_raw_parts(f.export_ptr(), len2) }.to_vec();
        assert_eq!(a.len(), b.len());
        assert!(a.iter().zip(&b).all(|(x, y)| x.to_bits() == y.to_bits() || x.is_nan() && y.is_nan()));
    }

    #[test]
    fn continuation_after_import_matches_uninterrupted_run() {
        let run = |split: Option<usize>| {
            let mut e = founded(plan::ROADSIDE);
            let entity = e.village_entity(1).unwrap();
            e.world.get_mut::<Site>(entity).unwrap().population = 20.0;
            let mut log = Vec::new();
            for t in 0..600usize {
                if Some(t) == split {
                    let len = e.export(); let data = unsafe { std::slice::from_raw_parts(e.export_ptr(), len) }.to_vec();
                    let mut f = engine();
                    let p = f.import_input(len); unsafe { std::slice::from_raw_parts_mut(p, len) }.copy_from_slice(&data);
                    assert!(f.import_commit(len));
                    // The host re-sends its faction and settlement rows after import.
                    rows(&mut f);
                    upsert(&mut f, [300.0, 2.0, 5.0, 40.0, 30.0, 20.0, -1.0, 1.0, 0.0, 1.0, 1.0, 0.0]);
                    e = f;
                }
                let h = header(&mut e, t as f64 * 0.5);
                log.extend(section(&e, 2, h[2] as usize * REQUEST_STRIDE));
                log.extend(section(&e, 1, h[1] as usize * EVENT_STRIDE));
                answer_all(&mut e, h, true);
            }
            log
        };
        let control = run(None); let resumed = run(Some(300));
        assert_eq!(control.len(), resumed.len());
        assert!(control.iter().zip(&resumed).all(|(a, b)| a.to_bits() == b.to_bits()));
    }

    #[test]
    fn trade_credits_both_partners() {
        let mut e = world(); header(&mut e, 0.0);
        e.trade(100, 200, 0, 1, 40.0, 3);
        assert!(e.breakdown(100, 1)[4] > 0.0 && e.breakdown(200, 0)[4] > 0.0 && e.breakdown(100, 0)[4] > 0.0);
        e.trade(300, 100, 0, -1, 40.0, 1);
        let entity = e.village_entity(1).unwrap();
        assert_eq!(e.world.get::<Village>(entity).unwrap().lifetime_trade[0], 40.0);
    }

    #[test]
    fn village_bonuses_count_allies_and_confederated_identity() {
        let mut e = world(); header(&mut e, 0.0);
        e.set_relation(1, 0, ALLIED, false);
        let b = e.village_bonuses();
        assert_eq!(b[0], 2.0); assert_eq!(&b[1..6], &[0.0, 0.1, 0.0, 0.0, 0.0]);
        e.commit_transfer(300, 400, 0, T_CONFEDERATE_VILLAGE, 1);
        let b = e.village_bonuses();
        assert_eq!(&b[1..6], &[0.0, 0.1, 0.0, 0.0, 0.0], "identity persists after confederation");
        assert!(loyalty(&mut e, 400) >= 60.0);
    }
}
