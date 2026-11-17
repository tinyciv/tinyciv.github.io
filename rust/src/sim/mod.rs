//! The per-game simulation core: one bevy World per GameState.
//!
//! Resources: `SimClock` (simulated time, economy tick and the host-owned
//! run flags), `Rng` (the single mulberry32 stream every rule draws from),
//! `EngineTable` (handles of the staged engines this game owns, released
//! together with the game) and `SavedSections` (snapshot sections waiting for
//! the engine that restores them). Later migration steps add their
//! components and resources to this same World.
//!
//! `time`, `tick` and the RNG state are authoritative here; the host mirrors
//! them from `outbox()` after each command. `speed`, `paused`, `game_over`,
//! `victory` and `victory_continued` are still decided by TypeScript and are
//! synchronized into the clock before it advances and before a save.
pub mod achievements;
pub mod campaign;
pub mod scenarios;
pub mod barbarian_galleys;
pub mod scenario_access;
pub mod quests;
pub mod quest_hermits;
pub mod ai_policy;
pub mod ai_logic;
pub mod ai_empire;
pub mod ai_investment;
pub mod maintenance;
pub mod world_features;
pub mod diplomacy;
pub mod cheats;
pub mod boat_push;
pub mod galleys;
pub mod warships;
pub mod fisheries;
pub mod field_cannons;
pub mod military_academies;
pub mod rowboats;
pub mod entities;
pub mod forts;
pub mod destruction;
pub mod shell_impacts;
pub mod harbor_trade;
pub mod granaries;
pub mod geothermal;
pub mod thermal_baths;
pub mod drainage;
pub mod paved_roads;
pub mod sites;
pub mod exploration;
pub mod battle_support;
pub mod bird_flocks;
pub mod kinds;
pub mod marauders;
pub mod rng;
pub mod retinue;
pub mod retinue_settling;
pub mod offensive;
pub mod offensive_ai;
pub mod save;
pub mod structures;
pub mod work;

use bevy_ecs::prelude::*;
use std::collections::BTreeMap;

#[derive(Resource, Clone, Copy, Debug, PartialEq, Default)]
pub struct SimClock {
    pub time: f64,
    pub tick: f64,
    pub speed: f64,
    pub paused: bool,
    pub game_over: bool,
    pub victory: bool,
    pub victory_continued: bool,
}

#[derive(Resource, Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rng(pub rng::Mulberry32);

/// Staged engines still live in their own registries in `lib.rs`; the game
/// owns them through this table, in creation order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u32)]
pub enum EngineKind {
    Movement = 1,
    Settlement = 2,
    Morale = 3,
    HealthInitialization = 4,
    HealthRegeneration = 5,
    Projectiles = 6,
    Construction = 7,
    Research = 8,
    Population = 9,
    PathBudget = 10,
}
impl EngineKind {
    pub fn from_code(code: u32) -> Option<Self> {
        Some(match code {
            1 => Self::Movement, 2 => Self::Settlement, 3 => Self::Morale, 4 => Self::HealthInitialization,
            5 => Self::HealthRegeneration, 6 => Self::Projectiles, 7 => Self::Construction, 8 => Self::Research,
            9 => Self::Population, 10 => Self::PathBudget, _ => return None,
        })
    }
}

#[derive(Resource, Default, Debug)]
pub struct EngineTable { engines: Vec<(EngineKind, u32)> }
impl EngineTable {
    pub fn own(&mut self, kind: EngineKind, handle: u32) { self.engines.push((kind, handle)); }
    pub fn release(&mut self, kind: EngineKind, handle: u32) -> bool {
        let before = self.engines.len();
        self.engines.retain(|entry| *entry != (kind, handle));
        before != self.engines.len()
    }
    pub fn latest(&self, kind: EngineKind) -> Option<u32> {
        self.engines.iter().rev().find(|(owned, _)| *owned == kind).map(|(_, handle)| *handle)
    }
    pub fn drain(&mut self) -> Vec<(EngineKind, u32)> { std::mem::take(&mut self.engines) }
    pub fn len(&self) -> usize { self.engines.len() }
}

/// Imported sections whose engine is created lazily by the host. The
/// settlement section stays available so a re-created settlement engine
/// (save migration) restores the same snapshot, as before.
#[derive(Resource, Default, Debug)]
pub struct SavedSections { pub settlement: Option<Vec<f64>> }

/// Explicit commands and changes of allegiance invalidate pending decisions.
#[derive(Resource, Default, Debug)]
pub struct DecisionRevision(pub f64);

pub const OUTBOX_LENGTH: usize = 8;

pub struct Sim {
    pub world: World,
    /// Boxed so the host can keep one view of it while the registry rebalances.
    outbox: Box<[f64; OUTBOX_LENGTH]>,
    export: Vec<f64>,
    import: Vec<f64>,
}

impl Sim {
    pub fn new(seed: u32) -> Self {
        let mut world = World::new();
        world.insert_resource(SimClock { speed: 1.0, ..SimClock::default() });
        world.insert_resource(Rng(rng::Mulberry32::new(seed)));
        world.init_resource::<EngineTable>();
        world.init_resource::<achievements::Accounts>();
        world.init_resource::<campaign::Campaign>();
        world.init_resource::<scenarios::Scenarios>();
        world.init_resource::<barbarian_galleys::BarbarianGalleys>();
        world.init_resource::<scenario_access::ScenarioAccess>();
        world.init_resource::<quests::Quests>();
        world.init_resource::<ai_policy::Policies>();
        world.init_resource::<ai_empire::Empire>();
        world.init_resource::<ai_investment::Investments>();
        world.init_resource::<diplomacy::Diplomacy>();
        world.init_resource::<cheats::Cheats>();
        world.init_resource::<boat_push::BoatPush>();
        world.init_resource::<rowboats::Rowboats>();
        world.init_resource::<warships::Warships>();
        world.init_resource::<fisheries::Fisheries>();
        world.init_resource::<field_cannons::FieldCannons>();
        world.init_resource::<military_academies::MilitaryAcademies>();
        world.init_resource::<SavedSections>();
        world.init_resource::<entities::EntityTables>();
        world.init_resource::<destruction::Destructions>();
        world.init_resource::<shell_impacts::ShellImpacts>();
        world.init_resource::<harbor_trade::HarborTrade>();
        world.init_resource::<granaries::Granaries>();
        world.init_resource::<geothermal::Geothermal>();
        world.init_resource::<world_features::WorldFeatures>();
        world.init_resource::<thermal_baths::ThermalBaths>();
        world.init_resource::<drainage::Drainage>();
        world.init_resource::<paved_roads::PavedRoads>();
        world.init_resource::<sites::Sites>();
        world.init_resource::<exploration::Exploration>();
        world.init_resource::<battle_support::BattleSupport>();
        world.init_resource::<bird_flocks::BirdFlocks>();
        world.init_resource::<structures::StructureIndex>();
        world.init_resource::<work::WorkScheduler>();
        world.init_resource::<marauders::MarauderSchedule>();
        world.init_resource::<marauders::RaiderAggression>();
        world.init_resource::<DecisionRevision>();
        world.init_resource::<retinue::RetinueComposition>();
        world.init_resource::<retinue_settling::RetinueSettling>();
        world.init_resource::<offensive::Offensives>();
        world.init_resource::<offensive_ai::OffensiveAi>();
        let mut sim = Self { world, outbox: Box::new([0.0; OUTBOX_LENGTH]), export: Vec::new(), import: Vec::new() };
        sim.publish();
        sim
    }
    pub fn exploration_contact(&mut self,actor:i32,x:f64,y:f64,flags:u32)->*const f64{
        let result=exploration::contact(&mut self.world,actor,x,y,flags);self.publish();result
    }
    pub fn exploration_reward(&mut self,id:usize,actor:i32,choice:i32)->*const f64{
        let result=exploration::reward(&mut self.world,id,actor,choice);self.publish();result
    }
    pub fn clock(&self) -> SimClock { *self.world.resource::<SimClock>() }
    pub fn rng_state(&self) -> u32 { self.world.resource::<Rng>().0.state }

    /// Outbox: [time, tick, rng state, speed, paused, game over, victory, victory continued].
    fn publish(&mut self) {
        let clock = self.clock();
        *self.outbox = [clock.time, clock.tick, self.rng_state() as f64, clock.speed, clock.paused as u8 as f64,
            clock.game_over as u8 as f64, clock.victory as u8 as f64, clock.victory_continued as u8 as f64];
    }
    pub fn outbox(&self) -> &[f64; OUTBOX_LENGTH] { &self.outbox }

    pub fn random(&mut self) -> f64 {
        let value = self.world.resource_mut::<Rng>().0.next_f64();
        self.outbox[2] = self.rng_state() as f64;
        value
    }
    /// Fixture/editor seed command.
    pub fn seed(&mut self, seed: u32) { self.world.resource_mut::<Rng>().0 = rng::Mulberry32::new(seed); self.publish(); }

    /// Host patch of time and tick (fixtures, editor, imported scenes).
    pub fn set_clock(&mut self, time: f64, tick: f64) {
        let mut clock = self.world.resource_mut::<SimClock>();
        clock.time = time; clock.tick = tick;
        self.publish();
    }
    pub fn set_flags(&mut self, speed: f64, paused: bool, game_over: bool, victory: bool, victory_continued: bool) {
        let mut clock = self.world.resource_mut::<SimClock>();
        clock.speed = speed; clock.paused = paused; clock.game_over = game_over; clock.victory = victory; clock.victory_continued = victory_continued;
        self.publish();
    }
    /// One simulation substep advances simulated time first (`stepGame`).
    pub fn advance(&mut self, dt: f64) -> f64 {
        let mut clock = self.world.resource_mut::<SimClock>();
        clock.time += dt;
        let time = clock.time;
        destruction::expire(&mut self.world);
        shell_impacts::expire(&mut self.world);
        self.publish();
        time
    }
    /// Consumes one due economy tick: tick < floor((time + 1e-7) / interval).
    pub fn economy_tick(&mut self, interval: f64) -> bool {
        let mut clock = self.world.resource_mut::<SimClock>();
        let due = ((clock.time + 1e-7) / interval).floor();
        if clock.tick >= due { return false; }
        clock.tick += 1.0;
        self.publish();
        true
    }

    // ------------------------------------------------------------ entities
    /// A new host store is importing a state: drop every unit and building.
    pub fn entities_reset(&mut self) {
        self.world.resource_mut::<military_academies::MilitaryAcademies>().clear_sites();
        thermal_baths::clear(&mut self.world);
        granaries::clear(&mut self.world);
        let width = self.world.resource::<structures::StructureIndex>().width();
        self.world.resource_scope(|world, mut index: Mut<structures::StructureIndex>| index.clear(world, width));
        entities::reset(&mut self.world);
        self.world.resource_mut::<marauders::MarauderSchedule>().clear_clocks();
    }
    pub fn entity_insert(&mut self, table: u32, id: i64) -> bool { entities::insert(&mut self.world, table, id) }
    /// Role bits of the removed row, or `entities::MISSING`.
    pub fn entity_remove(&mut self, table: u32, id: i64) -> u32 {
        if table == entities::BUILDINGS { thermal_baths::remove(&mut self.world, id); }
        if table == entities::BUILDINGS { self.world.resource_mut::<military_academies::MilitaryAcademies>().remove(id); }
        if table == entities::BUILDINGS {
            if let Some((entity, _)) = self.world.resource::<entities::EntityTables>().buildings.locate(id) {
                self.world.resource_scope(|world, mut index: Mut<structures::StructureIndex>| index.remove(world, entity));
            }
        }
        else {
            self.world.resource_mut::<marauders::MarauderSchedule>().forget(id);
            self.world.resource_mut::<campaign::Campaign>().forget(id);
        }
        entities::remove(&mut self.world, table, id)
    }
    pub fn tables(&mut self) -> Mut<'_, entities::EntityTables> { self.world.resource_mut::<entities::EntityTables>() }

    pub fn marauders(&mut self) -> Mut<'_, marauders::MarauderSchedule> { self.world.resource_mut::<marauders::MarauderSchedule>() }
    pub fn raider_aggression(&mut self) -> Mut<'_, marauders::RaiderAggression> { self.world.resource_mut::<marauders::RaiderAggression>() }
    pub fn decision_revision(&mut self) -> Mut<'_, DecisionRevision> { self.world.resource_mut::<DecisionRevision>() }
    pub fn work(&mut self) -> Mut<'_, work::WorkScheduler> { self.world.resource_mut::<work::WorkScheduler>() }

    // ---------------------------------------------------------- structures
    pub fn structures(&mut self) -> Mut<'_, structures::StructureIndex> { self.world.resource_mut::<structures::StructureIndex>() }
    /// Unpublishes every building row; the host republishes for this width.
    pub fn structures_clear(&mut self, width: i32) {
        self.world.resource_mut::<military_academies::MilitaryAcademies>().clear_sites();
        self.world.resource_scope(|world, mut index: Mut<structures::StructureIndex>| index.clear(world, width));
    }
    pub fn structure_upsert(&mut self, id: i64, faction: f64, x: f64, y: f64, kind: u32, flags: u32) {
        let Some((entity, sequence)) = self.world.resource::<entities::EntityTables>().buildings.locate(id) else { return; };
        self.world.resource_mut::<military_academies::MilitaryAcademies>().site(id, kind, faction, flags);
        if kind == kinds::building::MILITARY_ACADEMY && faction.is_finite() && flags & 5 == 5 {
            self.world.entity_mut(entity).insert(military_academies::Academy);
        } else { self.world.entity_mut(entity).remove::<military_academies::Academy>(); }
        self.world.resource_scope(|world, mut index: Mut<structures::StructureIndex>|
            index.upsert(world, entity, sequence, id, faction, x, y, kind, flags));
    }
    pub fn structure_query(&mut self, faction: f64, flags: u32, kinds: [i32; 4]) -> *const f64 {
        self.world.resource_scope(|world, mut index: Mut<structures::StructureIndex>| index.query(world, faction, flags, kinds))
    }
    pub fn structure_refresh_defenses(&mut self) {
        self.world.resource_scope(|world, mut index: Mut<structures::StructureIndex>| index.refresh_defenses(world));
    }

    pub fn engines(&mut self) -> Mut<'_, EngineTable> { self.world.resource_mut::<EngineTable>() }
    pub fn latest_engine(&self, kind: EngineKind) -> Option<u32> { self.world.resource::<EngineTable>().latest(kind) }
    pub fn saved_settlement(&self) -> Option<&[f64]> { self.world.resource::<SavedSections>().settlement.as_deref() }

    fn core_section(&self) -> [f64; save::CORE_LENGTH] {
        let clock = self.clock();
        [clock.time, clock.tick, clock.speed, clock.paused as u8 as f64, clock.game_over as u8 as f64,
            clock.victory as u8 as f64, clock.victory_continued as u8 as f64, self.rng_state() as f64]
    }
    /// Sectioned snapshot; `settlement` is the live engine export, if any,
    /// otherwise the restored section is carried forward unchanged.
    pub fn export(&mut self, settlement: Option<&[f64]>) -> &[f64] {
        let core = self.core_section();
        let settlement = settlement.map(<[f64]>::to_vec).or_else(|| self.saved_settlement().map(<[f64]>::to_vec));
        let mut sections: Vec<(u32, &[f64])> = vec![(save::CORE, &core)];
        if let Some(payload) = settlement.as_deref() { sections.push((save::SETTLEMENT, payload)); }
        let aggression = self.world.resource::<marauders::RaiderAggression>().snapshot();
        sections.push((save::RAIDER_AGGRESSION, &aggression));
        let harbor = self.world.resource::<harbor_trade::HarborTrade>().snapshot();
        sections.push((save::HARBOR_TRADE, &harbor));
        let destruction = destruction::snapshot(&self.world);
        sections.push((save::BUILDING_DESTRUCTION, &destruction));
        let diplomacy = diplomacy::snapshot(&self.world);
        sections.push((save::DIPLOMACY, &diplomacy));
        let policies = ai_policy::snapshot(&self.world);
        sections.push((save::AI_POLICIES, &policies));
        let quests = quests::snapshot(&self.world);
        sections.push((save::QUESTS, &quests));
        let campaign = self.world.resource::<campaign::Campaign>().snapshot();
        sections.push((save::CAMPAIGN, &campaign));
        let offensives = self.world.resource::<offensive::Offensives>().snapshot();
        sections.push((save::OFFENSIVES, &offensives));
        let offensive_ai = self.world.resource::<offensive_ai::OffensiveAi>().snapshot();
        sections.push((save::OFFENSIVE_AI, &offensive_ai));
        let mut out = std::mem::take(&mut self.export);
        save::encode(&sections, &mut out);
        self.export = out;
        &self.export
    }
    pub fn export_ptr(&self) -> *const f64 { self.export.as_ptr() }
    pub fn import_input(&mut self, len: usize) -> *mut f64 { self.import.clear(); self.import.resize(len, 0.0); self.import.as_mut_ptr() }
    /// Restores section 0 and keeps the settlement section for its engine.
    /// Returns false (and changes nothing) for an invalid snapshot.
    pub fn import_commit(&mut self, len: usize) -> bool {
        let data = std::mem::take(&mut self.import);
        let ok = self.restore(&data[..len.min(data.len())]);
        self.import = data;
        ok
    }
    pub fn restore(&mut self, data: &[f64]) -> bool {
        let Some(sections) = save::decode(data) else { return false; };
        let mut core = None;
        let mut settlement = None;
        let mut aggression = marauders::RaiderAggression::default();
        let mut harbor = harbor_trade::HarborTrade::default();
        let mut destruction = Vec::new();
        let mut diplomacy = None;
        let mut policies = None;
        let mut quests = None;
        let mut campaign = campaign::Campaign::default();
        let mut offensives = offensive::Offensives::default();
        let mut offensive_ai = offensive_ai::OffensiveAi::default();
        for (id, range) in sections {
            match id {
                save::CORE if range.len() == save::CORE_LENGTH => core = Some(&data[range]),
                save::CORE => return false,
                save::SETTLEMENT => settlement = Some(data[range].to_vec()),
                save::RAIDER_AGGRESSION => {
                    let Some(restored) = marauders::RaiderAggression::restore(&data[range]) else { return false; };
                    aggression = restored;
                }
                save::HARBOR_TRADE => {
                    let Some(restored) = harbor_trade::HarborTrade::restore(&data[range]) else { return false; };
                    harbor = restored;
                }
                save::DIPLOMACY => diplomacy = Some(data[range].to_vec()),
                save::QUESTS => quests = Some(data[range].to_vec()),
                save::CAMPAIGN => {
                    let Some(restored) = campaign::Campaign::restore(&data[range]) else { return false; };
                    campaign = restored;
                }
                save::OFFENSIVES => {
                    let Some(restored) = offensive::Offensives::restore(&data[range]) else { return false; };
                    offensives = restored;
                }
                save::OFFENSIVE_AI => {
                    let Some(restored) = offensive_ai::OffensiveAi::restore(&data[range]) else { return false; };
                    offensive_ai = restored;
                }
                save::AI_POLICIES => {
                    let Some(saved) = ai_policy::decode(&data[range]) else { return false; };
                    policies = Some(saved);
                }
                save::BUILDING_DESTRUCTION => {
                    let Some(restored) = destruction::decode(&data[range]) else { return false; };
                    destruction = restored;
                }
                _ => {}
            }
        }
        let Some(core) = core else { return false; };
        if !core[7].is_finite() { return false; }
        if let Some(payload) = diplomacy {
            if !diplomacy::Diplomacy::restore(&mut self.world, &payload) { return false; }
        }
        *self.world.resource_mut::<SimClock>() = SimClock {
            time: core[0], tick: core[1], speed: core[2], paused: core[3] != 0.0, game_over: core[4] != 0.0,
            victory: core[5] != 0.0, victory_continued: core[6] != 0.0,
        };
        self.world.resource_mut::<Rng>().0 = rng::Mulberry32::new(core[7] as u32);
        self.world.resource_mut::<SavedSections>().settlement = settlement;
        self.world.insert_resource(aggression);
        self.world.insert_resource(harbor);
        self.world.insert_resource(campaign);
        self.world.insert_resource(offensives);
        self.world.insert_resource(offensive_ai);
        destruction::restore(&mut self.world, destruction);
        if let Some(saved) = policies { ai_policy::restore(&mut self.world, saved); }
        if let Some(saved) = quests { if !quests::restore(&mut self.world, &saved) { return false; } }
        self.publish();
        true
    }
}

#[derive(Default)]
pub struct Sims { next_handle: u32, sims: BTreeMap<u32, Sim> }
impl Sims {
    pub fn create(&mut self, seed: u32) -> u32 {
        self.next_handle = self.next_handle.checked_add(1).expect("simulation handle overflow");
        self.sims.insert(self.next_handle, Sim::new(seed));
        self.next_handle
    }
    /// Removes the game; the caller releases the engines it owned.
    pub fn remove(&mut self, handle: u32) -> Option<Sim> { self.sims.remove(&handle) }
    pub fn get(&self, handle: u32) -> &Sim { self.sims.get(&handle).expect("unknown simulation") }
    pub fn get_mut(&mut self, handle: u32) -> &mut Sim { self.sims.get_mut(&handle).expect("unknown simulation") }
    pub fn try_get_mut(&mut self, handle: u32) -> Option<&mut Sim> { self.sims.get_mut(&handle) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clock_advances_and_consumes_each_economy_tick_once() {
        let mut sim = Sim::new(7);
        for _ in 0..25 { sim.advance(0.1); }
        let interval = 0.5;
        let mut ticks = 0;
        while sim.economy_tick(interval) { ticks += 1; }
        assert_eq!(ticks, 5);
        assert!(!sim.economy_tick(interval));
        assert_eq!(sim.outbox()[1], 5.0);
        let mut time = 0.0f64;
        for _ in 0..25 { time += 0.1; }
        assert_eq!(sim.outbox()[0].to_bits(), time.to_bits(), "f64 accumulation identical to the host's");
    }

    #[test]
    fn random_draws_publish_the_generator_state() {
        let mut sim = Sim::new(1);
        let mut reference = rng::Mulberry32::new(1);
        for _ in 0..100 { assert_eq!(sim.random(), reference.next_f64()); }
        assert_eq!(sim.outbox()[2], reference.state as f64);
        sim.seed(99);
        assert_eq!(sim.outbox()[2], 99.0);
    }

    #[test]
    fn snapshot_round_trips_clock_rng_and_the_settlement_section() {
        let mut sim = Sim::new(5);
        sim.set_flags(3.0, true, false, true, true);
        sim.set_clock(123.25, 4.0);
        for _ in 0..17 { sim.random(); }
        let saved = sim.export(Some(&[9.0, 8.0, 7.0])).to_vec();
        let mut copy = Sim::new(0);
        assert!(copy.restore(&saved));
        assert_eq!(copy.clock(), sim.clock());
        assert_eq!(copy.rng_state(), sim.rng_state());
        assert_eq!(copy.saved_settlement(), Some(&[9.0, 8.0, 7.0][..]));
        assert_eq!(copy.random(), sim.random(), "the stream continues after a load");
        // Without a live engine the restored section is carried into the next save.
        assert_eq!(copy.export(None).to_vec()[save::CORE_LENGTH + 5..], saved[save::CORE_LENGTH + 5..]);
        assert!(!copy.restore(&saved[..saved.len() - 1]));
        assert_eq!(copy.saved_settlement(), Some(&[9.0, 8.0, 7.0][..]), "a rejected snapshot changes nothing");
    }

    #[test]
    fn engine_table_tracks_ownership_in_creation_order() {
        let mut table = EngineTable::default();
        table.own(EngineKind::Movement, 3);
        table.own(EngineKind::Settlement, 1);
        table.own(EngineKind::Movement, 4);
        assert_eq!(table.latest(EngineKind::Movement), Some(4));
        assert!(table.release(EngineKind::Movement, 4));
        assert!(!table.release(EngineKind::Movement, 4));
        assert_eq!(table.latest(EngineKind::Movement), Some(3));
        assert_eq!(table.drain(), vec![(EngineKind::Movement, 3), (EngineKind::Settlement, 1)]);
        assert_eq!(table.len(), 0);
    }
}
