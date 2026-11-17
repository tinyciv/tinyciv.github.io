//! Browser and native simulation core. No rendering, DOM, host callbacks, or
//! operating-system services are needed to execute game rules.
pub mod jsmath;
mod navigation;
mod progression;
mod cadence;
mod combat;
mod health;
mod population;
mod path_budget;
mod projectiles;
mod construction;
mod movement;
mod morale;
mod research;
mod census;
mod affiliation;
mod village_plan;
mod settlement;
mod sim;
mod rivers;
mod relief;
mod ore;
mod terrain_sites;
mod terrain_rays;

use std::cell::RefCell;

thread_local! {
    static TERRAIN_RAYS: RefCell<terrain_rays::Terrains> = RefCell::new(terrain_rays::Terrains::default());
    static TERRAIN_SITES: RefCell<terrain_sites::TerrainSites> = RefCell::new(terrain_sites::TerrainSites::default());
    static ORES: RefCell<ore::Ores> = RefCell::new(ore::Ores::default());
    static HERMIT_PLAN: RefCell<sim::quest_hermits::Planner> = RefCell::new(sim::quest_hermits::Planner::default());
    static RELIEF: RefCell<relief::Relief> = RefCell::new(relief::Relief::default());
    static RIVERS: RefCell<rivers::Rivers> = RefCell::new(rivers::Rivers::default());
    static NAVIGATION: RefCell<navigation::Navigation> = RefCell::new(navigation::Navigation::default());
    static OUTPUT: RefCell<[f64; 8]> = const { RefCell::new([0.0; 8]) };
    static HEALTH: RefCell<health::Engines> = RefCell::new(health::Engines::default());
    static POPULATION: RefCell<population::Engines> = RefCell::new(population::Engines::default());
    static PATH_BUDGETS: RefCell<path_budget::Schedulers> = RefCell::new(path_budget::Schedulers::default());
    static PROJECTILES: RefCell<projectiles::Engines> = RefCell::new(projectiles::Engines::default());
    static CONSTRUCTION: RefCell<construction::Engines> = RefCell::new(construction::Engines::default());
    static CONSTRUCTION_LINE: RefCell<construction::LineBuffer> = RefCell::new(construction::LineBuffer::default());
    static MOVEMENT: RefCell<movement::Engines> = RefCell::new(movement::Engines::default());
    static MORALE: RefCell<morale::Engines> = RefCell::new(morale::Engines::default());
    static RESEARCH: RefCell<research::Engines> = RefCell::new(research::Engines::default());
}

#[unsafe(no_mangle)]
pub extern "C" fn terrain_rays_create() -> u32 { TERRAIN_RAYS.with_borrow_mut(|t| t.create()) }
#[unsafe(no_mangle)]
pub extern "C" fn terrain_rays_drop(handle: u32) { TERRAIN_RAYS.with_borrow_mut(|t| t.drop_field(handle)); }
#[unsafe(no_mangle)]
pub extern "C" fn terrain_rays_input(handle: u32, count: usize) -> *mut f64 { TERRAIN_RAYS.with_borrow_mut(|t| t.get_mut(handle).prepare(count)) }
#[unsafe(no_mangle)]
pub extern "C" fn terrain_rays_commit(handle: u32, width: usize, height: usize) { TERRAIN_RAYS.with_borrow_mut(|t| t.get_mut(handle).commit(width, height)); }
#[unsafe(no_mangle)]
pub extern "C" fn terrain_rays_clear(handle: u32, sx: f64, sy: f64, tx: f64, ty: f64, visible_target: u32) -> u32 {
    TERRAIN_RAYS.with_borrow(|t| t.get(handle).terrain().0.first_blocked(sx, sy, tx, ty, visible_target != 0).is_none() as u32)
}
#[unsafe(no_mangle)]
pub extern "C" fn terrain_rays_nearby(handle: u32, x: f64, y: f64, radius: f64) -> u32 {
    TERRAIN_RAYS.with_borrow(|t| t.get(handle).terrain().0.nearby(x, y, radius) as u32)
}
#[unsafe(no_mangle)]
pub extern "C" fn terrain_rays_observers_input(handle: u32, count: usize) -> *mut f64 {
    TERRAIN_RAYS.with_borrow_mut(|t| t.get_mut(handle).prepare_observers(count))
}
#[unsafe(no_mangle)]
pub extern "C" fn terrain_rays_observe(handle: u32) { TERRAIN_RAYS.with_borrow_mut(|t| t.get_mut(handle).observe()); }
#[unsafe(no_mangle)]
pub extern "C" fn terrain_rays_landmark_visible(handle: u32, cell: usize, kind: u32) -> u32 {
    TERRAIN_RAYS.with_borrow_mut(|t| t.get_mut(handle).landmark_visible(cell, kind) as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn relief_input(length: usize) -> *mut f64 { RELIEF.with_borrow_mut(|r| r.prepare(length)) }
#[unsafe(no_mangle)]
pub extern "C" fn relief_prune_mountains(width: usize, height: usize) -> *const f64 { RELIEF.with_borrow_mut(|r| r.prune_mountains(width, height)) }
#[unsafe(no_mangle)]
pub extern "C" fn relief_footprints(width: usize, height: usize, count: usize) -> *const f64 { RELIEF.with_borrow_mut(|r| r.footprints(width, height, count)) }
#[unsafe(no_mangle)]
pub extern "C" fn ore_input(length:usize)->*mut f64 { ORES.with_borrow_mut(|o|o.prepare(length)) }
#[unsafe(no_mangle)]
pub extern "C" fn terrain_sites_input(count:usize)->*mut f64 { TERRAIN_SITES.with_borrow_mut(|s|s.prepare(count)) }
#[unsafe(no_mangle)]
pub extern "C" fn terrain_sites_calculate(width:usize,height:usize)->*const u8 { TERRAIN_SITES.with_borrow_mut(|s|s.calculate(width,height)) }
#[unsafe(no_mangle)]
pub extern "C" fn terrain_sites_mountain_gap()->u32 { terrain_sites::MOUNTAIN_GAP as u32 }
#[unsafe(no_mangle)]
pub extern "C" fn ore_generate(width:usize,height:usize,seed:u32,first_group:u32,tutorial:u32)->*const f64 { ORES.with_borrow_mut(|o|o.generate(width,height,seed,first_group,tutorial!=0)) }
#[unsafe(no_mangle)]
pub extern "C" fn ore_work_yield(kind:u32,cells:usize)->f64 { ORES.with_borrow_mut(|o|o.work_yield(kind,cells)) }
#[unsafe(no_mangle)]
pub extern "C" fn resource_habitats(width:usize,height:usize)->*const f64 { ORES.with_borrow_mut(|o|o.habitats(width,height)) }
#[unsafe(no_mangle)]
pub extern "C" fn resource_group_limit(resource:u32)->u32 { ore::group_limit(resource) }
#[unsafe(no_mangle)]
pub extern "C" fn resource_ground_policy(resource:u32,width:u32,height:u32,row:u32)->u32 { ore::footprint_ground_policy(resource,width,height,row) }
#[unsafe(no_mangle)]
pub extern "C" fn resource_work_access(resource:u32,phase:u32,worker:u32)->u32 { ore::work_access(resource,phase,worker!=0) as u32 }
#[unsafe(no_mangle)]
pub extern "C" fn relief_generate(width:usize,height:usize,seed:u32,coverage:f64,mountains:f64,hill_size:f64,clustering:f64,spacing:f64,clumps:f64,strings:f64,length_min:f64,length_max:f64,breadth:f64,bend:f64)->*const f64 {
    RELIEF.with_borrow_mut(|r|r.generate(width,height,seed,coverage,mountains,hill_size,clustering,spacing,clumps,strings,length_min,length_max,breadth,bend))
}
#[unsafe(no_mangle)]
pub extern "C" fn relief_policy(kind: u32) -> u32 { relief::policy(kind) }
#[unsafe(no_mangle)]
pub extern "C" fn relief_construction_allowed(flags: u32, wall: u32) -> u32 { relief::construction_allowed(flags, wall != 0) }
#[unsafe(no_mangle)]
pub extern "C" fn relief_edge_policy(mask: u32) -> u32 { relief::edge(mask) }
#[unsafe(no_mangle)]
pub extern "C" fn relief_height_advantage(source: u32, target: u32) -> u32 { relief::higher(source,target) }

#[unsafe(no_mangle)]
pub extern "C" fn river_input(count: usize) -> *mut f64 { RIVERS.with_borrow_mut(|r| r.prepare(count)) }
#[unsafe(no_mangle)]
pub extern "C" fn river_plan(width: usize, height: usize, target: usize, seed: u32) -> *const f64 {
    RIVERS.with_borrow_mut(|r| r.plan(width, height, target, seed))
}
#[unsafe(no_mangle)]
pub extern "C" fn river_resistance(width: usize, height: usize, seed: u32, meander: f64) -> *const f64 {
    RIVERS.with_borrow_mut(|r| r.resistance(width, height, seed, meander))
}
#[unsafe(no_mangle)]
pub extern "C" fn river_channel_width(flow: f64, scale: f64, lake: u32) -> f64 { rivers::channel_width(flow, scale, lake != 0) }
#[unsafe(no_mangle)]
pub extern "C" fn hermit_plan_input(length:usize)->*mut f64{HERMIT_PLAN.with_borrow_mut(|p|p.prepare(length))}
#[unsafe(no_mangle)]
pub extern "C" fn hermit_plan()->*const f64{HERMIT_PLAN.with_borrow_mut(|p|p.run())}

#[unsafe(no_mangle)]
pub extern "C" fn sim_quests_input(handle: u32, length: usize) -> *mut f64 {
    with_sim(handle, |g| g.world.resource_mut::<sim::quests::Quests>().prepare(length))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_quests_due(handle: u32, now: f64) -> u32 {
    with_sim(handle, |g| g.world.resource_mut::<sim::quests::Quests>().due(now) as u32)
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_quests_geometry(handle: u32, width: usize, height: usize) {
    with_sim(handle, |g| g.world.resource_mut::<sim::quests::Quests>().geometry(width, height));
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_quests_sync(handle: u32) -> *const f64 {
    with_sim(handle, |g| { g.world.resource_mut::<sim::quests::Quests>().sync(); sim::quests::update(&mut g.world) })
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_quests_command(handle: u32, actor: i32, kind: u8, mode: u32) -> *const f64 {
    with_sim(handle, |g| sim::quests::command(&mut g.world, actor, kind, mode))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_quests_death(handle: u32, id: f64, actor: i32) {
    with_sim(handle, |g| g.world.resource_mut::<sim::quests::Quests>().death(id as i64, actor));
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_quests_hold_hermit(handle: u32, id: f64) -> u32 {
    with_sim(handle, |g| g.world.resource::<sim::quests::Quests>().holds_hermit(&g.world, id as i64) as u32)
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_quests_permits(handle: u32, actor: i32, kind: u32, x: i32, y: i32) -> u32 {
    with_sim(handle, |g| g.world.resource::<sim::quests::Quests>().permits(&g.world, actor, kind, x, y) as u32)
}
#[unsafe(no_mangle)]
pub extern "C" fn quest_effect(mask: u32, kind: u32, value: f64) -> f64 { sim::quests::effect(mask, kind, value) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_quests_authoritative(handle:u32)->u32{with_sim(handle,|g|g.world.resource::<sim::quests::Quests>().authoritative()as u32)}
#[unsafe(no_mangle)]
pub extern "C" fn sim_quests_mirrors(handle:u32,width:usize,height:usize){with_sim(handle,|g|sim::quests::mirrors(&mut g.world,width,height));}
#[unsafe(no_mangle)]
pub extern "C" fn sim_quests_reserved(handle:u32,id:f64,actor:i32,kind:u32,x:i32,y:i32)->u32{
    with_sim(handle,|g|g.world.resource::<sim::quests::Quests>().reserved(&g.world,id as i64,actor,kind,x,y)as u32)
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_quests_access(handle:u32,a:i32,b:i32)->u32{with_sim(handle,|g|g.world.resource::<sim::quests::Quests>().access(a,b)as u32)}
#[unsafe(no_mangle)]
pub extern "C" fn sim_quests_voyage(handle:u32,actor:i32,x:f64,y:f64,aboard:u32){with_sim(handle,|g|sim::quests::voyage_event(&mut g.world,actor,x,y,aboard!=0));}

#[unsafe(no_mangle)]
pub extern "C" fn settlement_quest_reward(handle: u32, settlement: f64, faction: i32, amount: f64) {
    SETTLEMENTS.with_borrow_mut(|values| values.get_mut(handle).quest_reward(settlement as i64, faction, amount));
}
#[unsafe(no_mangle)]
pub extern "C" fn settlement_quest_post_upkeep(handle:u32,village:i32,amount:f64){SETTLEMENTS.with_borrow_mut(|values|values.get_mut(handle).quest_post_upkeep(village,amount));}
#[unsafe(no_mangle)]
pub extern "C" fn sim_quests_transfer_posts(handle:u32,village:i32)->*const f64{with_sim(handle,|g|sim::quests::transfer_posts(&mut g.world,village))}

fn output<const N: usize>(values: [f64; N]) -> *const f64 {
    OUTPUT.with_borrow_mut(|output| { output[..N].copy_from_slice(&values); output.as_ptr() })
}

#[unsafe(no_mangle)]
pub extern "C" fn fort_health_multiplier(level: u32) -> f64 { sim::forts::health_multiplier(level) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_fort_upgrade(handle: u32, id: f64, level: u32, gold: f64, hp: f64, maximum: f64, flags: u32, commit: u32) -> *const f64 {
    output(with_sim(handle, |game| sim::forts::upgrade(&mut game.world, id as i64, level, gold, hp, maximum, flags, commit != 0)))
}

#[unsafe(no_mangle)]
pub extern "C" fn progression_constant(index: u32) -> f64 { progression::constant(index) }
#[unsafe(no_mangle)]
pub extern "C" fn progression_xp_required(level: f64) -> f64 { progression::xp_required(level) }
#[unsafe(no_mangle)]
pub extern "C" fn progression_skill_cap(skill: u32) -> f64 { progression::skill_cap(skill) }
#[unsafe(no_mangle)]
pub extern "C" fn progression_award(level: f64, xp: f64, points: f64, amount: f64, hp: f64, max_hp: f64, attack: f64, strength: f64) -> *const f64 {
    output(progression::award(level, xp, points, amount, hp, max_hp, attack, strength))
}
#[unsafe(no_mangle)]
pub extern "C" fn progression_learn(skill: u32, rank: f64, points: f64, attack: f64, defense: f64, unlocked: u32) -> *const f64 {
    output(progression::learn(skill, rank, points, attack, defense, unlocked != 0))
}
#[unsafe(no_mangle)]
pub extern "C" fn progression_death(level: f64, xp: f64, points: f64, max_hp: f64, attack: f64, strength: f64) -> *const f64 {
    output(progression::death(level, xp, points, max_hp, attack, strength))
}
#[unsafe(no_mangle)]
pub extern "C" fn progression_purchase(gold: f64, cost: f64) -> f64 { progression::purchase(gold, cost) }
#[unsafe(no_mangle)]
pub extern "C" fn progression_charge(gold: f64, amount: f64) -> *const f64 { output(progression::charge(gold, amount)) }

#[unsafe(no_mangle)]
pub extern "C" fn cadence_next_deadline(deadline: f64, now: f64, interval: f64) -> f64 { cadence::next_deadline(deadline, now, interval) }
#[unsafe(no_mangle)]
pub extern "C" fn cadence_decision_due(now: f64, key: i32, next_at: f64, sampled_at: f64, previous_interval: f64, active: u32, urgent: u32) -> *const f64 {
    output(cadence::decision_due(now, key, next_at, sampled_at, previous_interval, active != 0, urgent != 0))
}
#[unsafe(no_mangle)]
pub extern "C" fn combat_constant(index: u32) -> f64 { combat::constant(index) }
#[unsafe(no_mangle)]
pub extern "C" fn combat_veterancy(kills: f64) -> u32 { combat::veterancy(kills) }
#[unsafe(no_mangle)]
pub extern "C" fn combat_equipment_multiplier(level: u32) -> f64 { combat::equipment_multiplier(level) }
#[unsafe(no_mangle)]
pub extern "C" fn combat_dealt_multiplier(kills: f64) -> f64 { combat::dealt_multiplier(kills) }
#[unsafe(no_mangle)]
pub extern "C" fn combat_taken_multiplier(kills: f64) -> f64 { combat::taken_multiplier(kills) }
#[unsafe(no_mangle)]
pub extern "C" fn combat_incoming_damage(kills: f64, damage: f64) -> f64 { combat::incoming_damage(kills, damage) }
#[unsafe(no_mangle)]
pub extern "C" fn combat_attack_damage(attack: f64, defense: f64) -> f64 { combat::attack_damage(attack, defense) }
#[unsafe(no_mangle)]
pub extern "C" fn combat_record_kill(kills: f64) -> f64 { combat::record_kill(kills) }
#[unsafe(no_mangle)]
pub extern "C" fn combat_unit_attack(scout: u32, attack: f64, kills: f64, weapon: u32, equipment: f64, archer_multiplier: f64, raider: u32, strength: f64, technology_bonus: f64, raider_bonus: f64, culture: u32, context: u32, quests: u32) -> f64 {
    combat::unit_attack_cultural(scout, attack, kills, weapon, equipment, archer_multiplier, raider, strength, technology_bonus, raider_bonus, culture, context, quests)
}
#[unsafe(no_mangle)]
pub extern "C" fn combat_unit_damage(scout: u32, attack: f64, kills: f64, weapon: u32, equipment: f64, archer_multiplier: f64, raider: u32, strength: f64, technology_bonus: f64, raider_bonus: f64, defense: f64, culture: u32, context: u32, quests: u32) -> f64 {
    combat::unit_damage_cultural(scout, attack, kills, weapon, equipment, archer_multiplier, raider, strength, technology_bonus, raider_bonus, defense, culture, context, quests)
}
#[unsafe(no_mangle)]
pub extern "C" fn combat_unit_defense(defense: f64, kills: f64, armor: u32, equipment: f64, brace: f64, technology_bonus: f64, raider_bonus: f64, culture: u32, context: u32) -> f64 {
    combat::unit_defense_cultural(defense, kills, armor, equipment, brace, technology_bonus, raider_bonus, culture, context)
}

#[unsafe(no_mangle)]
pub extern "C" fn health_constant(index: u32) -> f64 { health::constant(index) }
#[unsafe(no_mangle)]
pub extern "C" fn health_create() -> u32 { HEALTH.with_borrow_mut(|engines| engines.create()) }
#[unsafe(no_mangle)]
pub extern "C" fn health_drop(handle: u32) { HEALTH.with_borrow_mut(|engines| engines.drop_engine(handle)); }
#[unsafe(no_mangle)]
pub extern "C" fn health_input(handle: u32, capacity: u32) -> *mut f64 {
    HEALTH.with_borrow_mut(|engines| engines.get_mut(handle).prepare(capacity as usize))
}
#[unsafe(no_mangle)]
pub extern "C" fn health_run(handle: u32, count: u32, now: f64, dt: f64, mode: u32) -> *const f64 {
    HEALTH.with_borrow_mut(|engines| engines.get_mut(handle).run(count as usize, now, dt, mode))
}

#[unsafe(no_mangle)]
pub extern "C" fn population_constant(index: u32) -> f64 { population::constant(index) }
#[unsafe(no_mangle)]
pub extern "C" fn population_configure(handle: u32, cities: u32, houses: u32) -> *mut f64 {
    POPULATION.with_borrow_mut(|engines| engines.get_mut(handle).configure(cities as usize, houses as usize))
}
#[unsafe(no_mangle)]
pub extern "C" fn population_run(handle: u32, food: f64, population: f64, hunting: f64, unfed: f64, growth: f64, achievements: u32) -> *const f64 {
    POPULATION.with_borrow_mut(|engines| engines.get_mut(handle).run_with_growth(food, population, hunting, unfed,
        sim::achievements::effect(achievements, 4, growth, 0)))
}

/// 6: coastal village founding and native harbor commerce.
#[unsafe(no_mangle)]
pub extern "C" fn simulation_abi_version() -> u32 { 13 }

#[unsafe(no_mangle)]
pub extern "C" fn research_constant(index: u32) -> f64 { research::constant(index) }
#[unsafe(no_mangle)]
pub extern "C" fn research_level(raw: f64) -> f64 { research::level(raw) }
#[unsafe(no_mangle)]
pub extern "C" fn research_allocation(raw: f64) -> f64 { research::allocation(raw) }
#[unsafe(no_mangle)]
pub extern "C" fn research_library_multiplier(count: u32) -> f64 { research::library_multiplier(count as usize) }
#[unsafe(no_mangle)]
pub extern "C" fn research_graph_prepare(count: u32) -> *mut f64 { RESEARCH.with_borrow_mut(|values| values.prepare_graph(count as usize)) }
#[unsafe(no_mangle)]
pub extern "C" fn research_graph_commit(count: u32) { RESEARCH.with_borrow_mut(|values| values.commit_graph(count as usize)); }
#[unsafe(no_mangle)]
pub extern "C" fn research_cost(branch: u32, bonus: f64, scenario: u32) -> f64 { RESEARCH.with_borrow(|values| values.cost(branch as usize, bonus, scenario==2)) }
#[unsafe(no_mangle)]
pub extern "C" fn research_create() -> u32 { RESEARCH.with_borrow_mut(|values| values.create()) }
#[unsafe(no_mangle)]
pub extern "C" fn research_drop(handle: u32) { RESEARCH.with_borrow_mut(|values| values.drop_engine(handle)); }
#[unsafe(no_mangle)]
pub extern "C" fn research_prepare(handle: u32, priorities: u32, funding: u32, receipts: u32) -> *mut f64 {
    RESEARCH.with_borrow_mut(|values| values.get_mut(handle).prepare(priorities as usize, funding as usize, receipts as usize))
}
#[unsafe(no_mangle)]
pub extern "C" fn research_run(handle: u32, mode: u32, now: f64, dt: f64, gross: f64, efficiency: f64, target: f64) -> *const f64 {
    RESEARCH.with_borrow_mut(|values| values.get_mut(handle).run(mode, now, dt, gross, efficiency, target))
}

#[unsafe(no_mangle)]
pub extern "C" fn morale_constant(index: u32) -> f64 { morale::constant(index) }
#[unsafe(no_mangle)]
pub extern "C" fn morale_casualty_allowed(hp: f64, flags: u32) -> u32 { morale::casualty_allowed(hp, flags) as u32 }
#[unsafe(no_mangle)]
pub extern "C" fn morale_begin_rout(now: f64, faction: f64, order: u32, until: f64) -> *const f64 { output(morale::begin_rout(now, faction, order, until)) }
#[unsafe(no_mangle)]
pub extern "C" fn morale_leader_rout(flags: u32, faction: f64, hp: f64, order: u32) -> u32 { morale::leader_rout(flags, faction, hp, order) as u32 }
#[unsafe(no_mangle)]
pub extern "C" fn morale_retinue_member(flags: u32, faction: f64, hp: f64, order: u32, leader_faction: f64) -> u32 { morale::retinue_member(flags, faction, hp, order, leader_faction) }
#[unsafe(no_mangle)]
pub extern "C" fn morale_can_rally(now: f64, faction: f64, until: f64) -> u32 { morale::can_rally(now, faction, until) as u32 }
#[unsafe(no_mangle)]
pub extern "C" fn morale_contagion(routing: f64, standing: f64, near_leader: u32) -> f64 { morale::contagion(routing, standing, near_leader != 0) }
#[unsafe(no_mangle)]
pub extern "C" fn morale_create() -> u32 { MORALE.with_borrow_mut(|values| values.create()) }
#[unsafe(no_mangle)]
pub extern "C" fn morale_drop(handle: u32) { MORALE.with_borrow_mut(|values| values.drop_engine(handle)); }
#[unsafe(no_mangle)]
pub extern "C" fn morale_input(handle: u32, capacity: u32) -> *mut f64 { MORALE.with_borrow_mut(|values| values.get_mut(handle).prepare(capacity as usize)) }
#[unsafe(no_mangle)]
pub extern "C" fn morale_reset(handle: u32, count: u32) { MORALE.with_borrow_mut(|values| values.get_mut(handle).reset(count as usize)); }
#[unsafe(no_mangle)]
pub extern "C" fn morale_record(handle: u32, unit: f64, faction: f64, x: f64, y: f64, time: f64) {
    MORALE.with_borrow_mut(|values| values.get_mut(handle).record(unit as i64, faction as i64, x, y, time));
}
#[unsafe(no_mangle)]
pub extern "C" fn morale_prune(handle: u32, now: f64) -> *const f64 { MORALE.with_borrow_mut(|values| values.get_mut(handle).prune(now)) }
#[unsafe(no_mangle)]
pub extern "C" fn morale_pressure(handle: u32, now: f64, x: f64, y: f64, faction: f64, shock_until: f64) -> *const f64 {
    MORALE.with_borrow_mut(|values| values.get_mut(handle).pressure(now, x, y, faction as i64, shock_until))
}
#[unsafe(no_mangle)]
pub extern "C" fn morale_factions(handle: u32) -> *const f64 { MORALE.with_borrow(|values| values.get(handle).factions()) }
#[unsafe(no_mangle)]
pub extern "C" fn morale_faction_count(handle: u32) -> u32 { MORALE.with_borrow(|values| values.get(handle).faction_count() as u32) }
#[unsafe(no_mangle)]
pub extern "C" fn morale_pressure_finish(handle: u32, living: f64) -> *const f64 { MORALE.with_borrow_mut(|values| values.get_mut(handle).finish(living)) }
#[unsafe(no_mangle)]
pub extern "C" fn morale_living(handle: u32, faction: f64, x: f64, y: f64, count: u32) -> f64 {
    MORALE.with_borrow_mut(|values| values.get_mut(handle).living(faction as i64, x, y, count as usize))
}
#[unsafe(no_mangle)]
pub extern "C" fn morale_commander_shock(handle: u32, x: f64, y: f64, count: u32) -> *const f64 { MORALE.with_borrow_mut(|values| values.get_mut(handle).commander_shock(x, y, count as usize)) }
#[unsafe(no_mangle)]
pub extern "C" fn morale_integrate(handle: u32, id: f64, now: f64, dt: f64) -> *const f64 { MORALE.with_borrow_mut(|values| values.get_mut(handle).integrate(id as i64, now, dt)) }
#[unsafe(no_mangle)]
pub extern "C" fn morale_remove_actor(handle: u32, id: f64) { MORALE.with_borrow_mut(|values| values.get_mut(handle).remove_actor(id as i64)); }

#[unsafe(no_mangle)]
pub extern "C" fn movement_create(width: i32, height: i32) -> u32 { MOVEMENT.with_borrow_mut(|values| values.create(width, height)) }
#[unsafe(no_mangle)]
pub extern "C" fn movement_drop(handle: u32) { MOVEMENT.with_borrow_mut(|values| values.drop_engine(handle)); }
#[unsafe(no_mangle)]
pub extern "C" fn movement_begin(handle: u32) { MOVEMENT.with_borrow_mut(|values| values.get_mut(handle).begin()); }
#[unsafe(no_mangle)]
pub extern "C" fn movement_actor(handle: u32, id: f64, x: f64, y: f64, kind: u32, faction: f64, hp: f64, flags: u32, drill: f64, order: f64, bucket_order: f64, indexed_cell: f64, overlay: u32) {
    MOVEMENT.with_borrow_mut(|values| values.get_mut(handle).actor(id as i64, x, y, kind, faction, hp, flags, drill, order as i64, bucket_order,
        if indexed_cell.is_nan() { None } else { Some(indexed_cell as i64) }, overlay != 0));
}
#[unsafe(no_mangle)]
pub extern "C" fn movement_remove(handle: u32, id: f64) { MOVEMENT.with_borrow_mut(|values| values.get_mut(handle).remove(id as i64)); }
#[unsafe(no_mangle)]
pub extern "C" fn movement_candidates(handle: u32, cell: f64, overlay: u32) -> *const f64 {
    MOVEMENT.with_borrow_mut(|values| values.get_mut(handle).candidates(cell as i64, overlay != 0))
}
#[unsafe(no_mangle)]
pub extern "C" fn movement_occupant(handle: u32, cell: f64, id: f64, kind: u32, faction: f64, flags: u32, drill: f64, mode: u32) -> f64 {
    MOVEMENT.with_borrow(|values| values.get(handle).occupant(cell as i64, id as i64, kind, faction, flags, drill, mode))
}
#[unsafe(no_mangle)]
pub extern "C" fn movement_civilian(kind: u32, flags: u32) -> u32 { movement::civilian(kind, flags) as u32 }
#[unsafe(no_mangle)]
pub extern "C" fn movement_radius(kind: u32) -> f64 { movement::collision_radius(kind) }
#[unsafe(no_mangle)]
pub extern "C" fn movement_collides(akind: u32, afaction: f64, aflags: u32, adrill: f64, bkind: u32, bfaction: f64, bflags: u32, bdrill: f64) -> u32 {
    movement::collides(akind, afaction, aflags, adrill, bkind, bfaction, bflags, bdrill) as u32
}
#[unsafe(no_mangle)]
pub extern "C" fn movement_obstructs(aid: f64, akind: u32, afaction: f64, aflags: u32, adrill: f64, bid: f64, bkind: u32, bfaction: f64, bflags: u32, bdrill: f64, bhp: f64) -> u32 {
    movement::obstructs(aid as i64, akind, afaction, aflags, adrill, bid as i64, bkind, bfaction, bflags, bdrill, bhp) as u32
}
#[unsafe(no_mangle)]
pub extern "C" fn movement_grid_create(handle: u32, width: i32, height: i32) -> u32 { MOVEMENT.with_borrow_mut(|values| values.get_mut(handle).grid_create(width, height)) }
#[unsafe(no_mangle)]
pub extern "C" fn movement_grid_input(handle: u32, capacity: u32) -> *mut f64 { MOVEMENT.with_borrow_mut(|values| values.get_mut(handle).grid_input(capacity as usize)) }
#[unsafe(no_mangle)]
pub extern "C" fn movement_grid_patch(handle: u32, grid: u32, count: u32) { MOVEMENT.with_borrow_mut(|values| values.get_mut(handle).grid_patch(grid, count as usize)); }
#[unsafe(no_mangle)]
pub extern "C" fn movement_mask_create(handle: u32, count: u32) -> u32 { MOVEMENT.with_borrow_mut(|values| values.get_mut(handle).mask_create(count as usize)) }
#[unsafe(no_mangle)]
pub extern "C" fn movement_mask_input(handle: u32, mask: u32) -> *mut f64 { MOVEMENT.with_borrow_mut(|values| values.get_mut(handle).mask_input(mask)) }
#[unsafe(no_mangle)]
pub extern "C" fn movement_mask_commit(handle: u32, mask: u32) { MOVEMENT.with_borrow_mut(|values| values.get_mut(handle).mask_commit(mask)); }
#[unsafe(no_mangle)]
pub extern "C" fn movement_mask_drop(handle: u32, mask: u32) { MOVEMENT.with_borrow_mut(|values| values.drop_mask(handle, mask)); }
#[unsafe(no_mangle)]
pub extern "C" fn movement_sweep(handle: u32, grid: u32, fx: f64, fy: f64, tx: f64, ty: f64, mask_a: u32, mask_b: u32) -> u32 {
    MOVEMENT.with_borrow(|values| values.get(handle).sweep(grid, fx, fy, tx, ty, mask_a, mask_b)) as u32
}
#[unsafe(no_mangle)]
pub extern "C" fn movement_trace(handle: u32, grid: u32, fx: f64, fy: f64, tx: f64, ty: f64) -> *const f64 {
    MOVEMENT.with_borrow_mut(|values| values.get_mut(handle).trace(grid, fx, fy, tx, ty))
}

#[unsafe(no_mangle)]
pub extern "C" fn movement_steer(handle: u32, id: f64, geometry: u32, grid: u32, mask_a: u32, mask_b: u32, mask_c: u32, exempt: u32,
    next_x: f64, next_y: f64, speed: f64, dt: f64, anchor_x: f64, anchor_y: f64, radius: f64) -> *const f64 {
    let probe = movement::Probe { engine: geometry, grid, masks: [mask_a, mask_b, mask_c], exempt_current: exempt != 0 };
    let result = MOVEMENT.with_borrow_mut(|values| values.steer(handle, id as i64, probe, next_x, next_y, speed, dt, anchor_x, anchor_y, radius));
    output(result)
}
#[unsafe(no_mangle)]
pub extern "C" fn movement_separation_stride() -> u32 { movement::SEPARATION_STRIDE as u32 }
#[unsafe(no_mangle)]
pub extern "C" fn movement_evacuate(handle: u32, id: f64, geometry: u32, grid: u32, blockers: u32, guard: u32, forbidden: u32, footprint: u32) -> *const f64 {
    let probe = movement::Probe { engine: geometry, grid, masks: [blockers, guard, forbidden], exempt_current: false };
    output(MOVEMENT.with_borrow_mut(|values| values.evacuate(handle, id as i64, probe, footprint)))
}
#[unsafe(no_mangle)]
pub extern "C" fn movement_separation_input(count: u32) -> *mut f64 { MOVEMENT.with_borrow_mut(|values| values.separation_input(count as usize)) }
#[unsafe(no_mangle)]
pub extern "C" fn movement_separate(handle: u32, count: u32, radius: f64) -> *const f64 {
    MOVEMENT.with_borrow_mut(|values| values.separate(handle, count as usize, radius))
}

#[unsafe(no_mangle)]
pub extern "C" fn projectiles_create() -> u32 { PROJECTILES.with_borrow_mut(|values| values.create()) }
#[unsafe(no_mangle)]
pub extern "C" fn projectiles_drop(handle: u32) { PROJECTILES.with_borrow_mut(|values| values.drop_engine(handle)); }
#[unsafe(no_mangle)]
pub extern "C" fn projectiles_input(handle: u32, capacity: u32) -> *mut f64 {
    PROJECTILES.with_borrow_mut(|values| values.get_mut(handle).prepare(capacity as usize))
}
#[unsafe(no_mangle)]
pub extern "C" fn projectiles_publish(handle: u32, row: u32) {
    PROJECTILES.with_borrow_mut(|values| values.get_mut(handle).publish(row as usize));
}
#[unsafe(no_mangle)]
pub extern "C" fn projectiles_terrain(handle: u32, terrain: u32) {
    let field = TERRAIN_RAYS.with_borrow(|t| t.get(terrain).terrain().clone());
    PROJECTILES.with_borrow_mut(|values| values.get_mut(handle).set_terrain(field));
}
#[unsafe(no_mangle)]
pub extern "C" fn projectiles_begin(handle: u32, count: u32, dt: f64, changed: u32) -> *const f64 {
    PROJECTILES.with_borrow_mut(|values| values.get_mut(handle).begin_resident(count as usize, dt, changed != 0))
}
#[unsafe(no_mangle)]
pub extern "C" fn projectiles_advance(handle: u32, start: u32, count: u32) -> *const f64 {
    PROJECTILES.with_borrow_mut(|values| values.get_mut(handle).advance(start as usize, count as usize))
}
#[unsafe(no_mangle)]
pub extern "C" fn projectiles_impact(handle: u32, row: u32, clear: u32, hp: f64, kills: f64, infantry_multiplier: f64) -> *const f64 {
    PROJECTILES.with_borrow_mut(|values| values.get_mut(handle).impact(row as usize, clear != 0, hp, kills, infantry_multiplier))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_projectile_shell_landing(handle: u32, projectiles: u32, row: u32, building: u32, target_y: f64, height: f64) -> u32 {
    let landing = PROJECTILES.with_borrow_mut(|values| values.get_mut(projectiles).take_shell_landing(row as usize));
    landing.is_some_and(|(x,y,at_target)| with_sim(handle, |game| sim::shell_impacts::record(&mut game.world,x,y,at_target,building!=0,target_y,height))) as u32
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_shell_impacts(handle: u32) -> *const f64 { with_sim(handle, |game| sim::shell_impacts::view(&mut game.world)) }
#[unsafe(no_mangle)]
pub extern "C" fn projectiles_duration(sx: f64, sy: f64, ex: f64, ey: f64) -> f64 { projectiles::duration(sx, sy, ex, ey) }
#[unsafe(no_mangle)]
pub extern "C" fn projectiles_duration_for_kind(sx: f64, sy: f64, ex: f64, ey: f64, kind: u32) -> f64 { projectiles::duration_for_kind(sx, sy, ex, ey, kind) }

#[unsafe(no_mangle)]
pub extern "C" fn construction_create() -> u32 { CONSTRUCTION.with_borrow_mut(|values| values.create()) }
#[unsafe(no_mangle)]
pub extern "C" fn construction_drop(handle: u32) { CONSTRUCTION.with_borrow_mut(|values| values.drop_engine(handle)); }
#[unsafe(no_mangle)]
pub extern "C" fn construction_prepare(handle: u32, capacity: u32) -> *mut f64 {
    CONSTRUCTION.with_borrow_mut(|values| values.get_mut(handle).prepare(capacity as usize))
}
#[unsafe(no_mangle)]
pub extern "C" fn construction_run(handle: u32, count: u32, now: f64, mode: u32) -> *const f64 {
    CONSTRUCTION.with_borrow_mut(|values| values.get_mut(handle).run(count as usize, now, mode))
}
#[unsafe(no_mangle)]
pub extern "C" fn construction_remove(handle: u32, id: f64) { CONSTRUCTION.with_borrow_mut(|values| values.get_mut(handle).remove(id as i64)); }
#[unsafe(no_mangle)]
pub extern "C" fn construction_duration(kind: u32) -> f64 { construction::duration(kind) }
#[unsafe(no_mangle)]
pub extern "C" fn construction_access(x: f64, y: f64, width: i32, height: i32) -> *const f64 {
    CONSTRUCTION_LINE.with_borrow_mut(|buffer| buffer.access(x, y, width, height))
}
#[unsafe(no_mangle)]
pub extern "C" fn water_cell_navigable(flags: u32) -> u32 {
    // A ford changes land traversal; boats still use the underlying water,
    // including a ford on a creek. Waterfalls and stairs remain impassable.
    u32::from(flags & 27 == 17 && (flags & 4 == 0 || flags & 32 != 0))
}
#[unsafe(no_mangle)]
pub extern "C" fn rowboat_eligible(kind: u32, engineer: u32) -> u32 {
    u32::from(sim::rowboats::eligible(kind, engineer != 0))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_rowboat_input(handle: u32, count: usize) -> *mut f64 {
    with_sim(handle, |game| game.world.resource_mut::<sim::rowboats::Rowboats>().prepare(count))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_rowboat_profile(handle: u32, count: usize) -> *const f64 {
    with_sim(handle, |game| game.world.resource_mut::<sim::rowboats::Rowboats>().profile(count))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_rowboat_aboard(handle: u32, kind: u32, engineer: u32, land: u32, water: u32, bridge: u32) -> u32 {
    with_sim(handle, |game| u32::from(game.world.resource::<sim::rowboats::Rowboats>().aboard(kind, engineer != 0, land != 0, water != 0, bridge != 0)))
}
#[unsafe(no_mangle)]
pub extern "C" fn construction_progress(start: f64, duration: f64, waiting: i32, paused: f64, now: f64) -> f64 { construction::progress(start, duration, waiting, paused, now) }
#[unsafe(no_mangle)]
pub extern "C" fn construction_initial_hp(maximum: f64) -> f64 { construction::initial_hp(maximum) }
#[unsafe(no_mangle)]
pub extern "C" fn construction_health_fraction(maximum: f64, progress: f64) -> f64 { construction::health_fraction(maximum, progress) }
#[unsafe(no_mangle)]
pub extern "C" fn construction_targetable(hp: f64) -> u32 { u32::from(hp > 0.0) }
#[unsafe(no_mangle)]
pub extern "C" fn construction_refund(paid: f64, start: f64, duration: f64, waiting: i32, paused: f64, now: f64) -> f64 { construction::refund(paid, start, duration, waiting, paused, now) }
#[unsafe(no_mangle)]
pub extern "C" fn construction_repair_rate(maximum: f64, duration: f64) -> f64 { construction::repair_rate(maximum, duration) }
#[unsafe(no_mangle)]
pub extern "C" fn construction_repair(hp: f64, maximum: f64, duration: f64, speed: f64, elapsed: f64) -> f64 { construction::repair(hp, maximum, duration, speed, elapsed) }
#[unsafe(no_mangle)]
pub extern "C" fn construction_line(fx: f64, fy: f64, tx: f64, ty: f64) -> *const f64 {
    CONSTRUCTION_LINE.with_borrow_mut(|values| values.line(fx, fy, tx, ty))
}

#[unsafe(no_mangle)]
pub extern "C" fn path_budget_limit() -> u32 { path_budget::REQUESTS_PER_UPDATE as u32 }
#[unsafe(no_mangle)]
pub extern "C" fn path_budget_create() -> u32 { PATH_BUDGETS.with_borrow_mut(|values| values.create()) }
#[unsafe(no_mangle)]
pub extern "C" fn path_budget_drop(handle: u32) { PATH_BUDGETS.with_borrow_mut(|values| values.drop_scheduler(handle)); }
#[unsafe(no_mangle)]
pub extern "C" fn path_budget_input(handle: u32) -> *mut f64 { PATH_BUDGETS.with_borrow_mut(|values| values.get_mut(handle).input()) }
#[unsafe(no_mangle)]
pub extern "C" fn path_budget_count(handle: u32) -> u32 { PATH_BUDGETS.with_borrow(|values| values.get(handle).count() as u32) }
#[unsafe(no_mangle)]
pub extern "C" fn path_budget_begin(handle: u32) -> *const f64 { PATH_BUDGETS.with_borrow_mut(|values| values.get_mut(handle).begin()) }
#[unsafe(no_mangle)]
pub extern "C" fn path_budget_removed_count(handle: u32) -> u32 { PATH_BUDGETS.with_borrow(|values| values.get(handle).removed_count() as u32) }
#[unsafe(no_mangle)]
pub extern "C" fn path_budget_end(handle: u32) { PATH_BUDGETS.with_borrow_mut(|values| values.get_mut(handle).end()); }
#[unsafe(no_mangle)]
pub extern "C" fn path_budget_request(handle: u32, token: f64, immediate: u32) -> u32 {
    PATH_BUDGETS.with_borrow_mut(|values| values.get_mut(handle).request(token as i64, immediate != 0))
}

// Navigation exports retain a numeric, allocation-free query boundary. The
// terrain arrays stay resident; callers refresh them only on topology changes.
#[unsafe(no_mangle)]
pub extern "C" fn configure(cells: u32, columns: u32) {
    NAVIGATION.with_borrow_mut(|navigation| navigation.configure(cells as usize, columns as usize));
}

macro_rules! offset {
    ($function:ident, $field:ident, $ty:ty) => {
        #[unsafe(no_mangle)]
        pub extern "C" fn $function() -> *const $ty {
            NAVIGATION.with_borrow(|navigation| navigation.$field.as_ptr())
        }
    };
}
offset!(edgesOffset, edges, u8);
offset!(terrainOffset, terrain, f64);
offset!(landOffset, land, u8);
offset!(landOriginsOffset, land_origins, i32);
offset!(landGoalsOffset, land_goals, i32);
offset!(blockedOffset, blocked, u8);
offset!(softOffset, soft, u8);
offset!(penaltyOffset, penalty, f64);
offset!(outputOffset, output, i32);
offset!(costsOffset, costs, f64);
offset!(ownersOffset, previous, i32);

#[unsafe(no_mangle)]
pub extern "C" fn travelMap(origins: u32, speed: f64, max_seconds: f64) {
    NAVIGATION.with_borrow_mut(|navigation| navigation.travel_map(origins as usize, speed, max_seconds));
}
#[unsafe(no_mangle)]
pub extern "C" fn nearestMap(origins: u32) {
    NAVIGATION.with_borrow_mut(|navigation| navigation.nearest_map(origins as usize));
}
#[unsafe(no_mangle)]
pub extern "C" fn searchMany(origins: u32, min_x: i32, min_y: i32, max_x: i32, max_y: i32) -> i32 {
    NAVIGATION.with_borrow_mut(|navigation| navigation.search_many(origins as usize, min_x, min_y, max_x, max_y))
}
#[unsafe(no_mangle)]
pub extern "C" fn indexLand() { NAVIGATION.with_borrow_mut(|navigation| navigation.index_land()); }
#[unsafe(no_mangle)]
pub extern "C" fn routeIsGround(start: u32, size: u32) -> u32 {
    NAVIGATION.with_borrow(|navigation| u32::from(navigation.route_is_ground(start as usize, size as usize)))
}
#[unsafe(no_mangle)]
pub extern "C" fn preferLandMany(origins: u32, goals: u32, size: u32) -> i32 {
    NAVIGATION.with_borrow_mut(|navigation| navigation.prefer_land_many(origins as usize, goals as usize, size as usize, true))
}
#[unsafe(no_mangle)]
pub extern "C" fn preferLand(start: u32, size: u32, includes_start: u32) -> i32 {
    NAVIGATION.with_borrow_mut(|navigation| navigation.prefer_land(start as usize, size as usize, includes_start != 0))
}
#[unsafe(no_mangle)]
pub extern "C" fn search(start: u32, gx: i32, gy: i32, goal_open: u32, partial: u32, cardinal: u32, nearest: f64) -> i32 {
    NAVIGATION.with_borrow_mut(|navigation| navigation.search(start as usize, gx, gy, goal_open != 0, partial != 0, cardinal != 0, nearest))
}

// ---------------------------------------------------------------- settlements
thread_local! {
    static SETTLEMENTS: RefCell<settlement::Engines> = RefCell::new(settlement::Engines::default());
    static SETTLEMENT_OUTPUT: RefCell<Vec<f64>> = const { RefCell::new(Vec::new()) };
}
fn settlement_vector(values: Vec<f64>) -> *const f64 {
    SETTLEMENT_OUTPUT.with_borrow_mut(|output| { *output = values; output.as_ptr() })
}
fn with_settlement<R>(handle: u32, f: impl FnOnce(&mut settlement::SettlementEngine) -> R) -> R {
    SETTLEMENTS.with_borrow_mut(|engines| f(engines.get_mut(handle)))
}
#[unsafe(no_mangle)]
pub extern "C" fn settlement_constant(index: u32) -> f64 { settlement::constant(index) }
#[unsafe(no_mangle)]
pub extern "C" fn settlement_create(width: i32, height: i32, seed: f64) -> u32 { SETTLEMENTS.with_borrow_mut(|e| e.create(width, height, seed)) }
#[unsafe(no_mangle)]
pub extern "C" fn settlement_drop(handle: u32) { SETTLEMENTS.with_borrow_mut(|e| e.drop_engine(handle)) }
/// Borrows the movement census immutably for the duration of the step.
#[unsafe(no_mangle)]
pub extern "C" fn settlement_step(handle: u32, now: f64, movement_handle: u32) -> *const f64 {
    MOVEMENT.with_borrow(|movement| SETTLEMENTS.with_borrow_mut(|s| {
        let census = (movement_handle != 0).then(|| movement.get(movement_handle));
        s.get_mut(handle).step(now, census)
    }))
}
#[unsafe(no_mangle)]
pub extern "C" fn settlement_outbox(handle: u32, section: u32) -> *const f64 { with_settlement(handle, |e| e.outbox(section)) }
#[unsafe(no_mangle)]
pub extern "C" fn settlement_factions_input(handle: u32, count: u32) -> *mut f64 { with_settlement(handle, |e| e.factions_input(count as usize)) }
#[unsafe(no_mangle)]
pub extern "C" fn settlement_factions_commit(handle: u32, count: u32) { with_settlement(handle, |e| e.factions_commit(count as usize)) }
#[unsafe(no_mangle)]
pub extern "C" fn settlement_civ_war(handle: u32, a: i32, b: i32, war: u32) { with_settlement(handle, |e| e.civ_war(a, b, war != 0)) }
#[unsafe(no_mangle)]
pub extern "C" fn settlement_upsert_input(handle: u32, count: u32) -> *mut f64 { with_settlement(handle, |e| e.upsert_input(count as usize)) }
#[unsafe(no_mangle)]
pub extern "C" fn settlement_upsert_commit(handle: u32, count: u32) { with_settlement(handle, |e| e.upsert_commit(count as usize)) }
#[unsafe(no_mangle)]
pub extern "C" fn settlement_village_layout(handle: u32, village: i32, family: u32, transform: u32, lot_x: i32, lot_y: i32) {
    with_settlement(handle, |e| e.village_layout(village, family as u8, transform as u8, lot_x, lot_y))
}
#[unsafe(no_mangle)]
pub extern "C" fn settlement_civic_input(handle: u32, count: u32) -> *mut f64 { with_settlement(handle, |e| e.civic_input(count as usize)) }
#[unsafe(no_mangle)]
pub extern "C" fn settlement_civic_commit(handle: u32, count: u32) { with_settlement(handle, |e| e.civic_commit(count as usize)) }
#[unsafe(no_mangle)]
pub extern "C" fn settlement_trade(handle: u32, settlement: f64, other: f64, faction: i32, partner: i32, gold: f64, kind: u32) {
    with_settlement(handle, |e| e.trade(settlement as i64, other as i64, faction, partner, gold, kind))
}
#[unsafe(no_mangle)]
pub extern "C" fn settlement_casualty(handle: u32, settlement: f64, attacker: i32, population: f64) {
    with_settlement(handle, |e| e.casualty(settlement as i64, attacker, population))
}
#[unsafe(no_mangle)]
pub extern "C" fn settlement_leader_death(handle: u32, faction: i32) {
    with_settlement(handle, |e| e.leader_death(faction))
}
#[unsafe(no_mangle)]
pub extern "C" fn settlement_set_affiliation(handle: u32, settlement: f64, faction: i32, value: f64) {
    with_settlement(handle, |e| e.set_affiliation(settlement as i64, faction, value))
}
#[unsafe(no_mangle)]
pub extern "C" fn settlement_set_relation(handle: u32, village: i32, faction: i32, relation: u32, trading: u32) {
    with_settlement(handle, |e| e.set_relation(village, faction, relation as u8, trading != 0))
}
#[unsafe(no_mangle)]
pub extern "C" fn settlement_village_trade_origin(handle: u32, village: i32, faction: i32, preferred: f64) -> f64 {
    with_settlement(handle, |e| e.village_trade_origin(village, faction, preferred as i64) as f64)
}
#[unsafe(no_mangle)]
pub extern "C" fn settlement_build_results_input(handle: u32, count: u32) -> *mut f64 { with_settlement(handle, |e| e.results_input(count as usize)) }
#[unsafe(no_mangle)]
pub extern "C" fn settlement_build_results_commit(handle: u32, count: u32) { with_settlement(handle, |e| e.results_commit(count as usize)) }
#[unsafe(no_mangle)]
pub extern "C" fn settlement_plan_input(handle: u32) -> *mut f64 { with_settlement(handle, |e| e.plan_input()) }
#[unsafe(no_mangle)]
pub extern "C" fn settlement_plan_choose(handle: u32, village: i32, center_x: i32, center_y: i32, force_family: u32, attempt: u32) -> *const f64 {
    settlement_vector(with_settlement(handle, |e| e.plan_choose_harbor(village, center_x, center_y, force_family as u8, attempt)).to_vec())
}
#[unsafe(no_mangle)]
pub extern "C" fn settlement_hostility(handle: u32) -> *const f64 { with_settlement(handle, |e| e.hostility()) }
#[unsafe(no_mangle)]
pub extern "C" fn settlement_hostility_revision(handle: u32) -> f64 { with_settlement(handle, |e| e.hostility_revision()) }
#[unsafe(no_mangle)]
pub extern "C" fn settlement_village_relations(handle: u32, village: i32) -> *const f64 { settlement_vector(with_settlement(handle, |e| e.village_relations(village))) }
#[unsafe(no_mangle)]
pub extern "C" fn settlement_slot_factions(handle: u32) -> *const f64 { settlement_vector(with_settlement(handle, |e| e.slot_factions()).to_vec()) }
#[unsafe(no_mangle)]
pub extern "C" fn settlement_breakdown(handle: u32, settlement: f64, faction: i32) -> *const f64 {
    settlement_vector(with_settlement(handle, |e| e.breakdown(settlement as i64, faction)).to_vec())
}
#[unsafe(no_mangle)]
pub extern "C" fn settlement_village_status(handle: u32, village: i32, faction: i32, gold: f64, reach: u32) -> *const f64 {
    settlement_vector(with_settlement(handle, |e| e.village_status(village, faction, gold, reach)).to_vec())
}
#[unsafe(no_mangle)]
pub extern "C" fn settlement_village_command(handle: u32, village: i32, faction: i32, action: u32, gold: f64, reach: u32) -> *const f64 {
    settlement_vector(with_settlement(handle, |e| e.village_command(village, faction, action, gold, reach)).to_vec())
}
#[unsafe(no_mangle)]
pub extern "C" fn settlement_civ_confederate(handle: u32, target: i32, requester: i32) -> *const f64 {
    settlement_vector(with_settlement(handle, |e| e.civ_confederate(target, requester, true)).to_vec())
}
#[unsafe(no_mangle)]
pub extern "C" fn settlement_civ_confederate_status(handle: u32, target: i32, requester: i32) -> *const f64 {
    settlement_vector(with_settlement(handle, |e| e.civ_confederate(target, requester, false)).to_vec())
}
#[unsafe(no_mangle)]
pub extern "C" fn settlement_civ_affiliation(handle: u32, target: i32, requester: i32) -> f64 { with_settlement(handle, |e| e.civ_affiliation(target, requester)) }
#[unsafe(no_mangle)]
pub extern "C" fn settlement_commit_transfer(handle: u32, old_id: f64, new_id: f64, owner: i32, kind: u32, village: i32) {
    with_settlement(handle, |e| e.commit_transfer(old_id as i64, new_id as i64, owner, kind, village))
}
#[unsafe(no_mangle)]
pub extern "C" fn settlement_claim(handle: u32, village: i32) -> *const f64 { settlement_vector(with_settlement(handle, |e| e.claim(village))) }
#[unsafe(no_mangle)]
pub extern "C" fn settlement_village_hostiles(handle: u32, village: i32) -> *const f64 { settlement_vector(with_settlement(handle, |e| e.village_hostiles(village))) }
#[unsafe(no_mangle)]
pub extern "C" fn settlement_village_bonuses(handle: u32) -> *const f64 { settlement_vector(with_settlement(handle, |e| e.village_bonuses())) }
#[unsafe(no_mangle)]
pub extern "C" fn settlement_export(handle: u32) -> *const f64 { with_settlement(handle, |e| { e.export(); e.export_ptr() }) }
#[unsafe(no_mangle)]
pub extern "C" fn settlement_export_len(handle: u32) -> u32 { with_settlement(handle, |e| e.export() as u32) }
#[unsafe(no_mangle)]
pub extern "C" fn settlement_import_input(handle: u32, len: u32) -> *mut f64 { with_settlement(handle, |e| e.import_input(len as usize)) }
#[unsafe(no_mangle)]
pub extern "C" fn settlement_import_commit(handle: u32, len: u32) -> u32 { with_settlement(handle, |e| u32::from(e.import_commit(len as usize))) }

// ------------------------------------------------------------- simulation core
thread_local! {
    static SIMS: RefCell<sim::Sims> = RefCell::new(sim::Sims::default());
}
fn with_sim<R>(handle: u32, f: impl FnOnce(&mut sim::Sim) -> R) -> R { SIMS.with_borrow_mut(|sims| f(sims.get_mut(handle))) }

#[unsafe(no_mangle)]
pub extern "C" fn ai_investment_constant(kind:u32, upkeep:u32)->f64 {sim::ai_investment::constant(kind,upkeep!=0)}
#[unsafe(no_mangle)]
pub extern "C" fn watchtower_upkeep(human:u32)->f64 {sim::maintenance::watchtower(human!=0)}
#[unsafe(no_mangle)]
pub extern "C" fn sim_world_features_input(handle:u32,len:usize)->*mut f64 {
    with_sim(handle,|game|game.world.resource_mut::<sim::world_features::WorldFeatures>().input(len))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_world_features_generate(handle:u32,width:usize,height:usize,seed:u32,starts:usize)->*const f64 {
    with_sim(handle,|game|game.world.resource_mut::<sim::world_features::WorldFeatures>().generate(width,height,seed,starts))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_ai_investment_input(handle:u32,len:usize)->*mut f64 {
    with_sim(handle,|g|g.world.resource_mut::<sim::ai_investment::Investments>().input(len))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_ai_investment_plan(handle:u32,faction:i32,mode:u32)->*const f64 {
    with_sim(handle,|g|{let policy=sim::ai_policy::policy(&g.world,faction);
        g.world.resource_mut::<sim::ai_investment::Investments>().plan(mode,policy)})
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_ai_empire_input(handle:u32)->*mut f64 {with_sim(handle,|g|g.world.resource_mut::<sim::ai_empire::Empire>().input())}
#[unsafe(no_mangle)]
pub extern "C" fn sim_ai_empire_due(handle:u32,faction:i32,now:f64)->u32 {with_sim(handle,|g|{
    let p=sim::ai_policy::policy(&g.world,faction);g.world.resource_mut::<sim::ai_empire::Empire>().due(faction,now,p) as u32
})}
#[unsafe(no_mangle)]
pub extern "C" fn sim_ai_empire_plan(handle:u32,faction:i32,now:f64)->*const f64 {with_sim(handle,|g|{
    let p=sim::ai_policy::policy(&g.world,faction);g.world.resource_mut::<sim::ai_empire::Empire>().plan(faction,now,p)
})}
#[unsafe(no_mangle)]
pub extern "C" fn sim_ai_empire_feedback(handle:u32,faction:i32,now:f64,result:u32,x:f64,y:f64) {with_sim(handle,|g|g.world.resource_mut::<sim::ai_empire::Empire>().feedback(faction,now,result,x,y))}
#[unsafe(no_mangle)]
pub extern "C" fn sim_ai_empire_goal(handle:u32,faction:i32,now:f64)->*const f64 {with_sim(handle,|g|g.world.resource_mut::<sim::ai_empire::Empire>().goal(faction,now))}

#[unsafe(no_mangle)]
pub extern "C" fn sim_ai_policy_input(handle: u32) -> *mut f64 {
    with_sim(handle, |game| game.world.resource_mut::<sim::ai_policy::Policies>().input())
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_ai_policy_register(handle: u32) -> u32 {
    with_sim(handle, |game| game.world.resource_mut::<sim::ai_policy::Policies>().register())
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_ai_policy_validate(handle: u32) -> u32 {
    with_sim(handle, |game| game.world.resource::<sim::ai_policy::Policies>().valid_input() as u32)
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_ai_policy_assign(handle: u32, faction: i32, policy: u32) -> u32 {
    with_sim(handle, |game| sim::ai_policy::assign(&mut game.world, faction, policy) as u32)
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_ai_policy_view(handle: u32, mode: u32, index: i32) -> *const f64 {
    with_sim(handle, |game| sim::ai_policy::view(&mut game.world, mode, index))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_ai_logic_input(handle:u32,len:usize)->*mut f64 {
    with_sim(handle,|g|g.world.resource_mut::<sim::ai_policy::Policies>().logic_input(len))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_ai_logic_validate(handle:u32,mode:u32)->u32 {
    with_sim(handle,|g|g.world.resource::<sim::ai_policy::Policies>().logic_valid(mode) as u32)
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_ai_logic_set(handle:u32,code:u32,mode:u32)->u32 {
    with_sim(handle,|g|g.world.resource_mut::<sim::ai_policy::Policies>().logic_set(code,mode) as u32)
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_ai_logic_view(handle:u32,code:u32)->*const f64 {
    with_sim(handle,|g|g.world.resource_mut::<sim::ai_policy::Policies>().logic_view(code))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_ai_logic_faults(handle:u32,code:u32)->u32 {
    with_sim(handle,|g|g.world.resource::<sim::ai_policy::Policies>().faults(code))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_ai_policy_decide(handle: u32, faction: i32, mode: u32,
    a: f64, b: f64, c: f64, d: f64, e: f64, f: f64) -> f64 {
    with_sim(handle, |game| {
        if mode==21 && !game.world.resource::<sim::ai_empire::Empire>().siege_waiting(faction,game.clock().time,d) {return 0.0;}
        sim::ai_policy::decide(&mut game.world, faction, mode, [a,b,c,d,e,f])
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn sim_harbor_input(handle: u32, len: usize) -> *mut f64 {
    with_sim(handle, |game| game.world.resource_mut::<sim::harbor_trade::HarborTrade>().prepare(len))
}
#[unsafe(no_mangle)]
pub extern "C" fn marsh_bird_speed(fleeing:u32)->f64 { sim::bird_flocks::speed(fleeing!=0) }
#[unsafe(no_mangle)]
pub extern "C" fn marsh_bird_turn(from:f64,to:f64,dt:f64,fleeing:u32)->f64 { sim::bird_flocks::turn(from,to,dt,fleeing!=0) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_bird_input(handle:u32,count:usize)->*mut f64 { with_sim(handle,|game|game.world.resource_mut::<sim::bird_flocks::BirdFlocks>().prepare(count)) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_bird_plan(handle:u32,count:usize,now:f64,gx:f64,gy:f64,wandering:u32,fleeing:u32,tx:f64,ty:f64)->*const f64 {
    with_sim(handle,|game|game.world.resource_mut::<sim::bird_flocks::BirdFlocks>().plan(count,now,gx,gy,wandering!=0,fleeing!=0,tx,ty))
}
#[unsafe(no_mangle)]
pub extern "C" fn galley_constant(index: u32, transport: u32) -> f64 { sim::galleys::constant(index, transport != 0) }
#[unsafe(no_mangle)]
pub extern "C" fn barbarian_galley_constant(index:u32)->f64{sim::barbarian_galleys::constant(index)}
#[unsafe(no_mangle)]
pub extern "C" fn barbarian_galley_fleet(army:usize)->usize{sim::barbarian_galleys::fleet(army)}
#[unsafe(no_mangle)]
pub extern "C" fn barbarian_galley_board(occupant:f64,person:f64)->u32{sim::barbarian_galleys::can_board(occupant as i64,person as i64)as u32}
#[unsafe(no_mangle)]
pub extern "C" fn sim_barbarian_input(handle:u32,n:usize)->*mut f64{with_sim(handle,|g|g.world.resource_mut::<sim::barbarian_galleys::BarbarianGalleys>().input(n))}
#[unsafe(no_mangle)]
pub extern "C" fn sim_barbarian_step(handle:u32,boats:usize,targets:usize,now:f64)->*const f64{with_sim(handle,|g|g.world.resource_mut::<sim::barbarian_galleys::BarbarianGalleys>().step(boats,targets,now))}
#[unsafe(no_mangle)]
pub extern "C" fn galley_landing(x:f64,y:f64,angle:f64,px:f64,py:f64)->u32{sim::galleys::landing(x,y,angle,px,py)as u32}
#[unsafe(no_mangle)]
pub extern "C" fn sim_boat_push_input(handle: u32, count: usize) -> *mut f64 {
    with_sim(handle, |game| game.world.resource_mut::<sim::boat_push::BoatPush>().prepare(count))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_boat_push_geometry(handle: u32, x: i32, y: i32, width: usize) -> *mut f64 {
    with_sim(handle, |game| game.world.resource_mut::<sim::boat_push::BoatPush>().prepare_geometry(x, y, width))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_boat_push_run(handle: u32, count: usize, mode: u32, x: f64, y: f64, facing: f64) -> *const f64 {
    with_sim(handle, |game| game.world.resource_mut::<sim::boat_push::BoatPush>().run(count, mode, x, y, facing))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_harbor_sync_due(handle: u32, now: f64) -> u32 {
    with_sim(handle, |game| game.world.resource::<sim::harbor_trade::HarborTrade>().sync_due(now) as u32)
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_harbor_commit(handle: u32, mode: u32, len: usize, width: usize, now: f64) {
    with_sim(handle, |game| game.world.resource_mut::<sim::harbor_trade::HarborTrade>().commit(mode, len, width, now))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_harbor_step(handle: u32, now: f64, dt: f64) -> *const f64 {
    with_sim(handle, |game| game.world.resource_mut::<sim::harbor_trade::HarborTrade>().step(now, dt))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_trade_boat_steer(handle: u32, x: f64, y: f64, facing: f64, tx: f64, ty: f64, dt: f64, until: f64, now: f64) -> *const f64 {
    with_sim(handle, |game| game.world.resource_mut::<sim::harbor_trade::HarborTrade>().steer_merchant(x, y, facing, tx, ty, dt, sim::fisheries::speed(until, now, 1.3)))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_harbor_push(handle: u32, village: f64, faction: i32, x: f64, y: f64) {
    with_sim(handle, |game| game.world.resource_mut::<sim::harbor_trade::HarborTrade>().push(village as i64, faction, x, y));
}

#[unsafe(no_mangle)]
pub extern "C" fn sim_battle_input(handle: u32, count: usize) -> *mut f64 {
    with_sim(handle, |game| game.world.resource_mut::<sim::battle_support::BattleSupport>().prepare(count))
}

#[unsafe(no_mangle)]
pub extern "C" fn granary_constant(index: u32) -> f64 { sim::granaries::constant(index) }
#[unsafe(no_mangle)]
pub extern "C" fn thermal_bath_constant(index: u32) -> f64 { sim::thermal_baths::constant(index) }

#[unsafe(no_mangle)]
pub extern "C" fn sim_drainage_input(handle:u32,length:usize)->*mut f64 { with_sim(handle,|g|g.world.resource_mut::<sim::drainage::Drainage>().input(length)) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_drainage_shores(handle:u32,cell:usize)->*const f64 { with_sim(handle,|g|g.world.resource_mut::<sim::drainage::Drainage>().shores(cell)) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_drainage_soil(handle:u32,cell:usize)->*const f64 { with_sim(handle,|g|g.world.resource_mut::<sim::drainage::Drainage>().soil_patch(cell)) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_drainage_commit(handle:u32,mode:u32,width:usize,height:usize,count:usize) { with_sim(handle,|g|g.world.resource_mut::<sim::drainage::Drainage>().commit(mode,width,height,count)); }
#[unsafe(no_mangle)]
pub extern "C" fn sim_drainage_plan(handle:u32,now:f64)->*const f64 { with_sim(handle,|g|g.world.resource_mut::<sim::drainage::Drainage>().plan(now)) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_drainage_length(handle:u32)->usize { with_sim(handle,|g|g.world.resource::<sim::drainage::Drainage>().length()) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_drainage_release(handle:u32,worker:f64,now:f64) { with_sim(handle,|g|g.world.resource_mut::<sim::drainage::Drainage>().release(worker as i64,now)); }
#[unsafe(no_mangle)]
pub extern "C" fn sim_drainage_step(handle:u32,worker:f64,cell:usize,bank:usize,faction:i32,x:f64,y:f64,active:u32,dt:f64)->*const f64 {
    with_sim(handle,|g|g.world.resource_mut::<sim::drainage::Drainage>().step(worker as i64,cell,bank,faction,x,y,active!=0,dt))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_sites_input(handle: u32, count: usize) -> *mut f64 { with_sim(handle, |g| g.world.resource_mut::<sim::sites::Sites>().input(count)) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_sites_geometry(handle: u32, width: usize, height: usize, count: usize) { with_sim(handle, |g| sim::sites::geometry(&mut g.world, width, height, count)); }
#[unsafe(no_mangle)]
pub extern "C" fn sim_sites_due(handle: u32, actor: i32, now: f64) -> u32 { with_sim(handle, |g| g.world.resource_mut::<sim::sites::Sites>().due(actor, now) as u32) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_sites_sample(handle: u32, x: f64, y: f64, flags: u32) -> *const f64 {
    with_sim(handle, |g| g.world.resource_scope(|world, mut sites: bevy_ecs::prelude::Mut<sim::sites::Sites>| {
        sites.sample(world.resource::<sim::structures::StructureIndex>(), x, y, flags)
    }))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_sites_target(handle: u32, id: usize, x: f64, y: f64, flags: u32) -> i32 {
    with_sim(handle, |g| g.world.resource::<sim::sites::Sites>().target(g.world.resource::<sim::structures::StructureIndex>(), id, x, y, flags))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_bath_reset(handle: u32) { with_sim(handle, |g| sim::thermal_baths::clear(&mut g.world)); }
#[unsafe(no_mangle)]
pub extern "C" fn sim_bath_upsert(handle: u32, id: f64, kind: u32, faction: i32, x: f64, y: f64, flags: u32) {
    with_sim(handle, |g| sim::thermal_baths::upsert(&mut g.world, id as i64, kind, faction, x, y, flags));
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_bath_remove(handle: u32, id: f64) { with_sim(handle, |g| sim::thermal_baths::remove(&mut g.world, id as i64)); }
#[unsafe(no_mangle)]
pub extern "C" fn sim_bath_input(handle: u32) -> *mut f64 { with_sim(handle, |g| g.world.resource_mut::<sim::thermal_baths::ThermalBaths>().input()) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_bath_placement(handle: u32, faction: i32, x: f64, y: f64, width: usize, height: usize) -> u32 {
    with_sim(handle, |g| g.world.resource::<sim::thermal_baths::ThermalBaths>().placement(faction, x, y, width, height))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_bath_owner(handle: u32, id: f64) -> f64 {
    with_sim(handle, |g| g.world.resource_mut::<sim::thermal_baths::ThermalBaths>().owner(id as i64))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_bath_city_multiplier(handle: u32, city: f64) -> f64 {
    with_sim(handle, |g| g.world.resource_mut::<sim::thermal_baths::ThermalBaths>().city_multiplier(city as i64))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_bath_capacity(handle: u32, id: f64, faction: i32, x: f64, y: f64, base: f64) -> f64 {
    with_sim(handle, |g| g.world.resource_mut::<sim::thermal_baths::ThermalBaths>().capacity(id as i64, faction, x, y, base))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_granary_reset(handle: u32) { with_sim(handle, |game| sim::granaries::clear(&mut game.world)); }
#[unsafe(no_mangle)]
pub extern "C" fn sim_granary_upsert(handle: u32, id: f64, kind: u32, faction: i32, x: f64, y: f64, flags: u32) {
    with_sim(handle, |game| sim::granaries::upsert(&mut game.world, id as i64, kind, faction, x, y, flags));
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_granary_remove(handle: u32, id: f64) { with_sim(handle, |game| sim::granaries::remove(&mut game.world, id as i64)); }
#[unsafe(no_mangle)]
pub extern "C" fn sim_granary_placement(handle: u32, faction: i32, x: f64, y: f64) -> u32 {
    with_sim(handle, |game| game.world.resource_mut::<sim::granaries::Granaries>().placement(faction, x, y))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_granary_owner(handle: u32, id: f64) -> f64 {
    with_sim(handle, |game| game.world.resource_mut::<sim::granaries::Granaries>().owner(id as i64))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_granary_for_city(handle: u32, city: f64) -> f64 {
    with_sim(handle, |game| game.world.resource_mut::<sim::granaries::Granaries>().for_city(city as i64))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_granary_yield(handle: u32, faction: i32, x: i32, y: i32) -> f64 {
    with_sim(handle, |game| game.world.resource_mut::<sim::granaries::Granaries>().yield_multiplier(faction, x, y))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_granary_select(handle: u32, city: f64, town_cost: f64, granary_cost: f64) -> f64 {
    with_sim(handle, |game| game.world.resource_mut::<sim::granaries::Granaries>().select_storage(city as i64, town_cost, granary_cost))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_granary_assign(handle: u32, unit: f64, city: f64, storage: f64, previous: f64, inside: u32) -> *const f64 {
    with_sim(handle, |game| sim::granaries::assign(&mut game.world, unit as i64, city as i64, storage as i64, previous, inside != 0))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_granary_deposit(handle: u32, unit: f64, city: f64, storage: f64, faction: i32, amount: f64) -> f64 {
    with_sim(handle, |game| sim::granaries::deposit(&mut game.world, unit as i64, city as i64, storage as i64, faction, amount))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_granary_in_range(handle: u32, city: f64, x: f64, y: f64) -> u32 {
    with_sim(handle, |game| game.world.resource_mut::<sim::granaries::Granaries>().in_range(city as i64, x, y) as u32)
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_granary_bounds(handle: u32, city: f64, width: i32, height: i32) -> *const f64 {
    with_sim(handle, |game| game.world.resource_mut::<sim::granaries::Granaries>().bounds(city as i64, width, height))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_battle_run(handle: u32, count: usize, mode: u32, x: f64, y: f64, faction: f64, skip: f64) -> *const f64 {
    with_sim(handle, |game| game.world.resource_mut::<sim::battle_support::BattleSupport>().run(count, mode, x, y, faction, skip))
}
#[unsafe(no_mangle)]
pub extern "C" fn battle_city_defended(kind: u32, level: u32) -> u32 { sim::battle_support::city_defended(kind, level) as u32 }
#[unsafe(no_mangle)]
pub extern "C" fn battle_ready_shot(kind: u32, cooldown: f64, attack: f64, recall: u32, forced: u32) -> u32 {
    sim::battle_support::ready_shot(kind, cooldown, attack, recall != 0, forced != 0) as u32
}
#[unsafe(no_mangle)]
pub extern "C" fn farm_site_allowed(stair: u32) -> u32 { sim::battle_support::farm_site(stair) as u32 }
#[unsafe(no_mangle)]
pub extern "C" fn governor_purchase_allowed(handle: u32, faction: f64, placing: u32, kind: u32) -> u32 {
    with_sim(handle, |game| {
        let intents = &game.world.resource::<sim::battle_support::BattleSupport>().placing_factions;
        sim::battle_support::governor_purchase(faction, faction, placing != 0 || intents.contains(&(faction as i64)), kind) as u32
    })
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_placement_intent(handle: u32, faction: f64, placing: u32) {
    with_sim(handle, |game| {
        let mut support = game.world.resource_mut::<sim::battle_support::BattleSupport>();
        if placing != 0 { support.placing_factions.insert(faction as i64); }
        else { support.placing_factions.remove(&(faction as i64)); }
    });
}
#[unsafe(no_mangle)]
pub extern "C" fn siege_attack(cannon: u32, attack: f64) -> f64 { sim::battle_support::siege_attack(cannon != 0, attack) }
#[unsafe(no_mangle)]
pub extern "C" fn siege_cooldown(cooldown: f64, dt: f64, fired: u32) -> f64 { sim::battle_support::siege_cooldown(cooldown, dt, fired != 0) }
#[unsafe(no_mangle)]
pub extern "C" fn tower_cooldown(cooldown: f64, dt: f64, fired: u32) -> f64 { sim::battle_support::tower_cooldown(cooldown, dt, fired != 0) }
#[unsafe(no_mangle)]
pub extern "C" fn starting_road_arm(corner: u32, step: u32) -> *const f64 {
    let (x,y) = sim::battle_support::road_arm(corner,step); output([x,y])
}

fn create_engine(kind: sim::EngineKind, a: f64, b: f64, c: f64) -> u32 {
    use sim::EngineKind::*;
    match kind {
        Movement => MOVEMENT.with_borrow_mut(|values| values.create(a as i32, b as i32)),
        Settlement => SETTLEMENTS.with_borrow_mut(|values| values.create(a as i32, b as i32, c)),
        Morale => MORALE.with_borrow_mut(|values| values.create()),
        HealthInitialization | HealthRegeneration => HEALTH.with_borrow_mut(|values| values.create()),
        Projectiles => PROJECTILES.with_borrow_mut(|values| values.create()),
        Construction => CONSTRUCTION.with_borrow_mut(|values| values.create()),
        Research => RESEARCH.with_borrow_mut(|values| values.create()),
        Population => POPULATION.with_borrow_mut(|values| values.create()),
        PathBudget => PATH_BUDGETS.with_borrow_mut(|values| values.create()),
    }
}
fn drop_engine(kind: sim::EngineKind, handle: u32) {
    use sim::EngineKind::*;
    match kind {
        Movement => MOVEMENT.with_borrow_mut(|values| values.drop_engine(handle)),
        Settlement => SETTLEMENTS.with_borrow_mut(|values| values.drop_engine(handle)),
        Morale => MORALE.with_borrow_mut(|values| values.drop_engine(handle)),
        HealthInitialization | HealthRegeneration => HEALTH.with_borrow_mut(|values| values.drop_engine(handle)),
        Projectiles => PROJECTILES.with_borrow_mut(|values| values.drop_engine(handle)),
        Construction => CONSTRUCTION.with_borrow_mut(|values| values.drop_engine(handle)),
        Research => RESEARCH.with_borrow_mut(|values| values.drop_engine(handle)),
        Population => POPULATION.with_borrow_mut(|values| values.drop_engine(handle)),
        PathBudget => PATH_BUDGETS.with_borrow_mut(|values| values.drop_scheduler(handle)),
    }
}
fn engine_kind(code: u32) -> sim::EngineKind { sim::EngineKind::from_code(code).expect("unknown engine kind") }

/// One bevy World per game: clock, RNG and the table of engines it owns.
#[unsafe(no_mangle)]
pub extern "C" fn sim_create(seed: f64) -> u32 { SIMS.with_borrow_mut(|sims| sims.create(sim::rng::to_uint32(seed))) }

#[unsafe(no_mangle)]
pub extern "C" fn sim_scenario_input(handle:u32,length:usize,width:i32,height:i32)->*mut f64 {
    with_sim(handle,|game| {let mut scenarios=game.world.resource_mut::<sim::scenarios::Scenarios>();scenarios.configure(width,height);scenarios.input(length)})
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_scenario_prepare(handle: u32, scenario: u32,width:i32,height:i32) -> *const f64 {
    with_sim(handle, |game| sim::scenarios::prepare(&mut game.world, scenario,width,height))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_scenario_symmetry(handle:u32)->*const f64 {
    with_sim(handle,|game|game.world.resource_mut::<sim::scenarios::Scenarios>().symmetry())
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_scenario_symmetric_sites(handle:u32,count:usize)->*const f64 {
    with_sim(handle,|game|game.world.resource_mut::<sim::scenarios::Scenarios>().symmetric_sites(count))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_scenario_progress(handle:u32,elapsed:f64,population:f64,housing:f64,food:f64)->u32 {
    with_sim(handle,|game|sim::scenarios::progress(&mut game.world,elapsed,population,housing,food))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_scenario_goal(handle:u32,scenario:u32,faction:i32)->u32 {
    with_sim(handle,|game|sim::scenarios::goal(&game.world,scenario,faction)as u32)
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_scenario_equipment(handle:u32)->*const f64 {
    with_sim(handle,|game|sim::scenarios::equipment(&mut game.world))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_scenario_woodland(handle:u32)->*const f64 {
    with_sim(handle,|game|sim::scenarios::woodland(&mut game.world))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_scenario_irrigation(handle:u32,coverage:f64)->*const f64 {
    with_sim(handle,|game|sim::scenarios::irrigation(&mut game.world,coverage))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_scenario_channel(handle:u32,width:f64)->*const f64 {with_sim(handle,|game|game.world.resource_mut::<sim::scenarios::Scenarios>().channel(width))}
#[unsafe(no_mangle)]
pub extern "C" fn scenario_gold_income(scenario:u32,amount:f64,earned:u32)->f64 {sim::scenarios::gold_income(scenario,amount,earned!=0)}
#[unsafe(no_mangle)]
pub extern "C" fn sim_scenario_length(handle: u32) -> usize {
    with_sim(handle, |game| sim::scenarios::length(&game.world))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_scenario_access_input(handle:u32,length:usize)->*mut f64 {
    with_sim(handle,|g|g.world.resource_mut::<sim::scenario_access::ScenarioAccess>().input(length))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_scenario_access_reset(handle:u32){with_sim(handle,|g|g.world.resource_mut::<sim::scenario_access::ScenarioAccess>().reset());}
#[unsafe(no_mangle)]
pub extern "C" fn sim_scenario_access_batch(handle:u32,count:usize)->u32{with_sim(handle,|g|g.world.resource_mut::<sim::scenario_access::ScenarioAccess>().batch(count)as u32)}
#[unsafe(no_mangle)]
pub extern "C" fn sim_scenario_access_geometry(handle:u32,width:i32,height:i32){with_sim(handle,|g|g.world.resource_mut::<sim::scenario_access::ScenarioAccess>().geometry(width,height));}
#[unsafe(no_mangle)]
pub extern "C" fn sim_scenario_access_site(handle:u32,id:f64,kind:u32,x:i32,y:i32,w:i32,h:i32,flags:u32){with_sim(handle,|g|g.world.resource_mut::<sim::scenario_access::ScenarioAccess>().site(id as i64,kind,x,y,w,h,flags));}
#[unsafe(no_mangle)]
pub extern "C" fn sim_scenario_access_check(handle:u32,kind:u32,x:i32,y:i32,w:i32,h:i32)->u32{with_sim(handle,|g|g.world.resource_mut::<sim::scenario_access::ScenarioAccess>().placement(kind,x,y,w,h)as u32)}
#[unsafe(no_mangle)]
pub extern "C" fn sim_scenario_access_audit(handle:u32,starts:usize)->*const f64{with_sim(handle,|g|g.world.resource_mut::<sim::scenario_access::ScenarioAccess>().audit(starts))}
#[unsafe(no_mangle)]
pub extern "C" fn sim_scenario_access_length(handle:u32)->usize{with_sim(handle,|g|g.world.resource::<sim::scenario_access::ScenarioAccess>().length())}
#[unsafe(no_mangle)]
pub extern "C" fn sim_scenario_roads(handle:u32,targets:usize,roads:usize)->*const f64{with_sim(handle,|g|g.world.resource_mut::<sim::scenario_access::ScenarioAccess>().roads(targets,roads))}
#[unsafe(no_mangle)]
pub extern "C" fn sim_scenario_street_audit(handle:u32,targets:usize,roads:usize)->*const f64{with_sim(handle,|g|g.world.resource_mut::<sim::scenario_access::ScenarioAccess>().street_audit(targets,roads))}
#[unsafe(no_mangle)]
pub extern "C" fn sim_scenario_street_sites(handle:u32,id:f64,roads:usize)->*const f64{with_sim(handle,|g|g.world.resource_mut::<sim::scenario_access::ScenarioAccess>().street_sites(id as i64,roads))}
#[unsafe(no_mangle)]
pub extern "C" fn scenario_civic_inner(kind:u32,x:f64,y:f64,cx:f64,cy:f64)->u32{sim::scenarios::civic_inner(kind,x,y,cx,cy)as u32}
#[unsafe(no_mangle)]
pub extern "C" fn sim_scenario_city_claim(handle: u32, scenario: u32, x: i32, y: i32, radius: f64,width:i32,height:i32) -> *const f64 {
    with_sim(handle, |game| sim::scenarios::city_claim(&mut game.world, scenario, x, y, radius,width,height))
}
/// Import the faction's current shares into this game's command resource.
#[unsafe(no_mangle)]
pub extern "C" fn sim_retinue_input(handle: u32) -> *mut f64 {
    with_sim(handle, |game| game.world.resource_mut::<sim::retinue::RetinueComposition>().0.as_mut_ptr())
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_retinue_set_fraction(handle: u32, role: u32, fraction: f64, schools: f64, unlocked: u32) -> u32 {
    with_sim(handle, |game| game.world.resource_mut::<sim::retinue::RetinueComposition>().set_fraction(role as usize, fraction, schools as u64, unlocked) as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn sim_retinue_plan(handle: u32, total: f64, unlocked: u32) -> *const f64 {
    with_sim(handle, |game| game.world.resource_mut::<sim::retinue::RetinueComposition>().plan(total, unlocked))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_retinue_recruits_input(handle: u32) -> *mut f64 {
    with_sim(handle, |game| game.world.resource_mut::<sim::retinue::RetinueComposition>().2.as_mut_ptr())
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_retinue_recruit(handle: u32, schools: f64, spears_available: u32) -> u32 {
    with_sim(handle, |game| game.world.resource::<sim::retinue::RetinueComposition>().recruit(schools as u64, spears_available != 0) as u32)
}
#[unsafe(no_mangle)]
pub extern "C" fn retinue_stat(role: u32, field: u32) -> f64 { sim::retinue::stat(role as usize, field as usize) }
#[unsafe(no_mangle)]
pub extern "C" fn retinue_upkeep(kind: u32) -> f64 { sim::retinue::upkeep(kind) }
#[unsafe(no_mangle)]
pub extern "C" fn retinue_uses_firearm(kind: u32, gunpowder: u32) -> u32 { sim::retinue::uses_firearm(kind, gunpowder != 0) as u32 }
#[unsafe(no_mangle)]
pub extern "C" fn sim_retinue_settle(h: u32, leader: f64, unit: f64, x: f64, y: f64, gx: f64, gy: f64, lx: f64, ly: f64, flags: u32, stuck: f64) -> u32 {
    with_sim(h, |g| sim::retinue_settling::settle(&mut g.world, leader as i64, unit as i64, x, y, gx, gy, lx, ly, flags, stuck) as u32)
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_retinue_yield_allowed(h: u32, requester: f64, blocker: f64, x: f64, y: f64, flags: u32) -> u32 {
    with_sim(h, |g| sim::retinue_settling::yield_allowed(&g.world, requester as i64, blocker as i64, x, y, flags) as u32)
}
#[unsafe(no_mangle)]
pub extern "C" fn retinue_fraction(raw: f64, remaining: f64, unlocked: u32) -> f64 { sim::retinue::fraction(raw, remaining, unlocked != 0) }
#[unsafe(no_mangle)]
pub extern "C" fn retinue_attack_timing(kind: u32, animation: u32) -> f64 { sim::retinue::attack_timing(kind, animation != 0) }
#[unsafe(no_mangle)]
pub extern "C" fn retinue_training_school(role: u32, building: u32) -> u32 { sim::retinue::training_school(role as usize, building) as u32 }
/// Drops the game and every engine it still owns.
#[unsafe(no_mangle)]
pub extern "C" fn sim_drop(handle: u32) {
    let removed = SIMS.with_borrow_mut(|sims| sims.remove(handle));
    if let Some(mut game) = removed { for (kind, engine) in game.engines().drain() { drop_engine(kind, engine); } }
}
/// Creates an engine owned by this game. Arguments: movement (width, height),
/// settlement (width, height, seed); unused otherwise.
#[unsafe(no_mangle)]
pub extern "C" fn sim_engine_create(handle: u32, kind: u32, a: f64, b: f64, c: f64) -> u32 {
    let kind = engine_kind(kind);
    let engine = create_engine(kind, a, b, c);
    with_sim(handle, |game| game.engines().own(kind, engine));
    engine
}
/// Releases one engine early (its host view was replaced and collected). A
/// game that was already dropped released it then; this is a no-op.
#[unsafe(no_mangle)]
pub extern "C" fn sim_engine_release(handle: u32, kind: u32, engine: u32) {
    let kind = engine_kind(kind);
    let owned = SIMS.with_borrow_mut(|sims| sims.try_get_mut(handle).is_some_and(|game| game.engines().release(kind, engine)));
    if owned { drop_engine(kind, engine); }
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_engine_count(handle: u32) -> u32 { with_sim(handle, |game| game.engines().len() as u32) }
// ------------------------------------------------------------------ entities
// Units (table 0) and buildings (table 1) are entities of the game's World.
// The host keeps the view objects; lifetime, array order, sleeping, role
// membership and ID allocation are decided here. Mutations return the role
// bits that changed so the host refreshes only the affected cached views.
fn ordered_ptr(values: &[f64]) -> *const f64 { values.as_ptr() }
/// Drops every unit and building (a new host store imports a state).
#[unsafe(no_mangle)]
pub extern "C" fn sim_entities_reset(handle: u32) { with_sim(handle, |game| game.entities_reset()) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_entity_insert(handle: u32, table: u32, id: f64) -> u32 { with_sim(handle, |game| game.entity_insert(table, id as i64) as u32) }
/// Role bits of the removed row; `u32::MAX` when the ID was not registered.
#[unsafe(no_mangle)]
pub extern "C" fn sim_entity_remove(handle: u32, table: u32, id: f64) -> u32 { with_sim(handle, |game| game.entity_remove(table, id as i64)) }
/// Fatal-damage event; eligibility, footprint, cap and expiry belong to the ECS.
#[unsafe(no_mangle)]
pub extern "C" fn sim_building_destruction_record(handle: u32, id: f64, x: f64, y: f64, kind: u32, faction: f64, hp: f64) -> u32 {
    with_sim(handle, |game| sim::destruction::record(&mut game.world, id as i64, x, y, kind, faction, hp) as u32)
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_building_destructions(handle: u32) -> *const f64 {
    with_sim(handle, |game| sim::destruction::view(&mut game.world))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_building_destruction_cancel(handle: u32, id: f64) {
    with_sim(handle, |game| sim::destruction::cancel(&mut game.world, id as i64))
}
/// Unit role inputs. Flags: builder 1, collector 2, engineer 4, damage clock
/// unset 8, maximum unset 16. `sleeping`: -1 keep, 0 wake, 1 sleep.
#[unsafe(no_mangle)]
pub extern "C" fn sim_unit_traits(handle: u32, id: f64, kind: u32, flags: u32, hp: f64, max_hp: f64, sleeping: i32, track_revision: u32) -> u32 {
    with_sim(handle, |game| sim::entities::unit_traits(&mut game.world, id as i64,
        sim::entities::UnitTraits { kind, flags, hp, max_hp }, sleeping, track_revision != 0))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_unit_sleeping(handle: u32, id: f64) -> u32 { with_sim(handle, |game| sim::entities::unit_sleeping(&game.world, id as i64) as u32) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_building_traits(handle: u32, id: f64, kind: u32, construction: u32, track_revision: u32) -> u32 {
    with_sim(handle, |game| sim::entities::building_traits(&mut game.world, id as i64,
        sim::entities::BuildingTraits { kind, construction: construction != 0 }, track_revision != 0))
}
/// IDs holding a role in array order: [count, ids...].
#[unsafe(no_mangle)]
pub extern "C" fn sim_entity_view(handle: u32, table: u32, role: u32) -> *const f64 {
    with_sim(handle, |game| ordered_ptr(game.tables().table_mut(table).view(role as usize)))
}
/// Every ID in array order: [count, ids...].
#[unsafe(no_mangle)]
pub extern "C" fn sim_entity_order(handle: u32, table: u32) -> *const f64 { with_sim(handle, |game| ordered_ptr(game.tables().table_mut(table).order())) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_entity_count(handle: u32, table: u32, role: u32) -> u32 { with_sim(handle, |game| game.tables().table(table).count(role as usize)) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_entity_revision(handle: u32, table: u32) -> f64 { with_sim(handle, |game| game.tables().table(table).revision()) }
/// Advances the membership revision after a wholesale replacement.
#[unsafe(no_mangle)]
pub extern "C" fn sim_entity_touch(handle: u32, table: u32) { with_sim(handle, |game| game.tables().table_mut(table).touch()) }
/// The next ID an allocation would return.
#[unsafe(no_mangle)]
pub extern "C" fn sim_entity_peek_id(handle: u32) -> f64 { with_sim(handle, |game| game.tables().peek_id() as f64) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_entity_allocate_id(handle: u32, minimum: f64) -> f64 { with_sim(handle, |game| game.tables().allocate_id(minimum as i64) as f64) }

// ---------------------------------------------------------------------- work
// Recurring maintenance scheduler. Keys are interned process-wide; each game
// keeps its clocks, FIFO budget queue and publication scopes.
thread_local! {
    static WORK_KEYS: RefCell<sim::work::WorkKeys> = RefCell::new(sim::work::WorkKeys::default());
}
/// Buffer for a key name as UTF-16 code units; commit returns its stable ID.
#[unsafe(no_mangle)]
pub extern "C" fn work_key_input(len: u32) -> *mut f64 { WORK_KEYS.with_borrow_mut(|keys| keys.input(len as usize)) }
#[unsafe(no_mangle)]
pub extern "C" fn work_key_commit(len: u32) -> u32 { WORK_KEYS.with_borrow_mut(|keys| keys.commit(len as usize) as u32) }
#[unsafe(no_mangle)]
pub extern "C" fn work_key_interval(key: u32) -> f64 { WORK_KEYS.with_borrow(|keys| keys.get(key as u16).interval) }
/// Elapsed game time to integrate if this key's work runs now, or NaN when it
/// must not run. A NaN `phase` uses the key's own phase.
#[unsafe(no_mangle)]
pub extern "C" fn sim_work_elapsed(handle: u32, key: u32, now: f64, dt: f64, phase: f64) -> f64 {
    WORK_KEYS.with_borrow(|keys| {
        let info = keys.get(key as u16);
        let phase = if phase.is_nan() { info.phase } else { phase };
        with_sim(handle, |game| game.work().elapsed(key as u16, info, phase, now, dt)).unwrap_or(f64::NAN)
    })
}
/// Scopes: 0 interactive budget, 1 immediate publication, 2 deferred
/// maintenance. Returns 0 when the scope was already open.
#[unsafe(no_mangle)]
pub extern "C" fn sim_work_enter(handle: u32, scope: u32) -> u32 { with_sim(handle, |game| game.work().enter(scope) as u32) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_work_exit(handle: u32, scope: u32) { with_sim(handle, |game| game.work().exit(scope)) }
/// A new store or world was imported: forget every clock.
#[unsafe(no_mangle)]
pub extern "C" fn sim_work_reset(handle: u32) { with_sim(handle, |game| game.work().reset()) }

// ----------------------------------------------------------------- marauders
#[unsafe(no_mangle)]
pub extern "C" fn sim_raider_provoke(handle: u32, camp: f64, faction: i32) { with_sim(handle, |game| game.raider_aggression().provoke(camp as i64, faction)) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_raider_may_attack(handle: u32, intensity: f64, camp: f64, faction: i32) -> u32 {
    with_sim(handle, |game| game.raider_aggression().may_attack(intensity, camp as i64, faction) as u32)
}
/// Start of a simulation step for the hidden-marauder clocks.
#[unsafe(no_mangle)]
pub extern "C" fn sim_marauder_begin(handle: u32, time: f64) { with_sim(handle, |game| game.marauders().begin(time)) }
/// Charges `dt` to a unit (kind 0) or formation (kind 1) clock: 0 not due,
/// 1 phase due, 2 no step has begun yet.
#[unsafe(no_mangle)]
pub extern "C" fn sim_marauder_charge(handle: u32, kind: u32, id: f64, dt: f64) -> u32 { with_sim(handle, |game| game.marauders().charge(kind, id as i64, dt)) }
/// Consumes the accumulated time of a clock.
#[unsafe(no_mangle)]
pub extern "C" fn sim_marauder_take(handle: u32, kind: u32, id: f64) -> f64 { with_sim(handle, |game| game.marauders().take(kind, id as i64)) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_marauder_pack_due(handle: u32, pack: f64) -> u32 { with_sim(handle, |game| game.marauders().pack_due(pack as i64) as u32) }

// ----------------------------------------------------------------- decisions
#[unsafe(no_mangle)]
pub extern "C" fn sim_decision_revision(handle: u32) -> f64 { with_sim(handle, |game| game.decision_revision().0) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_decisions_invalidate(handle: u32) { with_sim(handle, |game| game.decision_revision().0 += 1.0) }

// ---------------------------------------------------------------- structures
// Resident building index over the building entities: rows change only when
// the host publishes a changed building, and every query reads maintained
// indexes (no world scans).
#[unsafe(no_mangle)]
pub extern "C" fn sim_structures_clear(handle: u32, width: i32) { with_sim(handle, |game| game.structures_clear(width)) }
/// Flags: alive 1, present 2, ready 4. Ignored for an unregistered building.
#[unsafe(no_mangle)]
pub extern "C" fn sim_structure_upsert(handle: u32, id: f64, faction: f64, x: f64, y: f64, kind: u32, flags: u32) {
    with_sim(handle, |game| game.structure_upsert(id as i64, faction, x, y, kind, flags));
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_structure_clearance(handle: u32) -> *const f64 {
    with_sim(handle, |game| game.structures().take_clearance())
}
/// Id of the `skip`-th nearest building of a class to a point, or NaN.
#[unsafe(no_mangle)]
pub extern "C" fn sim_structure_nearest(handle: u32, faction: f64, x: f64, y: f64, class: u32, skip: u32) -> f64 {
    with_sim(handle, |game| game.structures().nearest(faction, x, y, class, skip as usize))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_structure_near(handle: u32, faction: f64, x: f64, y: f64, radius: f64, class: u32) -> u32 {
    with_sim(handle, |game| game.structures().near(faction, x, y, radius, class) as u32)
}
/// [count, ids...] in building order.
#[unsafe(no_mangle)]
pub extern "C" fn sim_structure_query(handle: u32, faction: f64, flags: u32, k0: i32, k1: i32, k2: i32, k3: i32) -> *const f64 {
    with_sim(handle, |game| game.structure_query(faction, flags, [k0, k1, k2, k3]))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_structure_arc_cell(handle: u32, cell: f64) -> u32 { with_sim(handle, |game| game.structures().arc_cell(cell) as u32) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_structure_solid_at(handle: u32, x: f64, y: f64) -> u32 { with_sim(handle, |game| game.structures().solid_at(x, y) as u32) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_structure_refresh_defenses(handle: u32) { with_sim(handle, |game| game.structure_refresh_defenses()) }
/// [count, ids...] of the defensive buildings assigned to a palace.
#[unsafe(no_mangle)]
pub extern "C" fn sim_structure_defenses(handle: u32, palace: f64) -> *const f64 { with_sim(handle, |game| game.structures().defenses(palace as i64)) }

/// [time, tick, rng state, speed, paused, game over, victory, victory continued].
#[unsafe(no_mangle)]
pub extern "C" fn sim_outbox(handle: u32) -> *const f64 { with_sim(handle, |game| game.outbox().as_ptr()) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_campaign_income(handle: u32, faction: i32, amount: f64, category: u32) {
    with_sim(handle, |game| game.world.resource_mut::<sim::campaign::Campaign>().income(faction, amount, category));
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_campaign_casualty(handle: u32, id: f64, faction: i32, kind: u32, killer: i32, hostile: u32) {
    with_sim(handle, |game| game.world.resource_mut::<sim::campaign::Campaign>().casualty(id as i64, faction, kind, killer, hostile != 0));
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_campaign_researched(handle: u32, faction: i32) {
    with_sim(handle, |game| game.world.resource_mut::<sim::campaign::Campaign>().researched(faction));
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_campaign_population(handle: u32, faction: i32, population: f64) {
    with_sim(handle, |game| game.world.resource_mut::<sim::campaign::Campaign>().population(faction, population));
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_campaign_view(handle: u32, faction: i32) -> *const f64 {
    with_sim(handle, |game| game.world.resource_mut::<sim::campaign::Campaign>().view(faction))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_campaign_reset(handle: u32) {
    with_sim(handle, |game| game.world.insert_resource(sim::campaign::Campaign::default()));
}
/// Fishing-zone stream: [next state, draw].
#[unsafe(no_mangle)]
pub extern "C" fn rng_lcg_draw(state: f64) -> *const f64 { let (next, draw) = sim::rng::lcg_draw(state); output([next as f64, draw]) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_random(handle: u32) -> f64 { with_sim(handle, |game| game.random()) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_geothermal_input(handle: u32, cells: usize, starts: usize) -> *mut f64 {
    with_sim(handle, |game| game.world.resource_mut::<sim::geothermal::Geothermal>().prepare(cells, starts))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_geothermal_generate(handle: u32, width: usize, height: usize, starts: usize, seed: u32) -> *const f64 {
    with_sim(handle, |game| game.world.resource_mut::<sim::geothermal::Geothermal>().generate(width, height, starts, seed))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_seed(handle: u32, seed: f64) { with_sim(handle, |game| game.seed(sim::rng::to_uint32(seed))) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_clock_set(handle: u32, time: f64, tick: f64) { with_sim(handle, |game| game.set_clock(time, tick)) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_clock_flags(handle: u32, speed: f64, paused: u32, game_over: u32, victory: u32, victory_continued: u32) {
    with_sim(handle, |game| game.set_flags(speed, paused != 0, game_over != 0, victory != 0, victory_continued != 0))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_advance(handle: u32, dt: f64) -> f64 { with_sim(handle, |game| game.advance(dt)) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_economy_tick(handle: u32, interval: f64) -> u32 { with_sim(handle, |game| game.economy_tick(interval) as u32) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_cheat_gold_tick(handle: u32, enabled: u32, multiplayer: u32, gold: f64) -> *const f64 {
    output(with_sim(handle, |game| sim::cheats::gold_tick(&mut game.world, enabled != 0, multiplayer != 0, gold)))
}
/// Builds the sectioned snapshot and returns its length in f64 words; read it
/// with `sim_export_ptr` afterwards (building it may grow memory).
#[unsafe(no_mangle)]
pub extern "C" fn sim_export(handle: u32) -> u32 {
    let settlement = SIMS.with_borrow(|sims| sims.get(handle).latest_engine(sim::EngineKind::Settlement));
    let snapshot = settlement.map(|engine| SETTLEMENTS.with_borrow_mut(|values| values.get_mut(engine).snapshot().to_vec()));
    with_sim(handle, |game| game.export(snapshot.as_deref()).len() as u32)
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_export_ptr(handle: u32) -> *const f64 { with_sim(handle, |game| game.export_ptr()) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_import_input(handle: u32, len: u32) -> *mut f64 { with_sim(handle, |game| game.import_input(len as usize)) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_import_commit(handle: u32, len: u32) -> u32 { with_sim(handle, |game| game.import_commit(len as usize) as u32) }
/// Restores the imported settlement section into a settlement engine this
/// game owns. Returns 1 when a section was restored, 0 when there was none
/// and 2 when it was invalid (the host reports an invalid save).
#[unsafe(no_mangle)]
pub extern "C" fn sim_settlement_restore(handle: u32, engine: u32) -> u32 {
    let saved = SIMS.with_borrow(|sims| sims.get(handle).saved_settlement().map(<[f64]>::to_vec));
    match saved {
        None => 0,
        Some(data) => if SETTLEMENTS.with_borrow_mut(|values| values.get_mut(engine).restore(&data)) { 1 } else { 2 },
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn achievement_cost(id: usize) -> f64 { sim::achievements::COSTS.get(id).copied().unwrap_or(f64::NAN) }
#[unsafe(no_mangle)]
pub extern "C" fn achievement_prerequisites(id: usize) -> u32 { sim::achievements::PREREQUISITES.get(id).copied().unwrap_or(0) }
#[unsafe(no_mangle)]
pub extern "C" fn achievement_status(mask: u32, culture: f64, id: usize) -> u32 { sim::achievements::status(mask, culture, id) }
#[unsafe(no_mangle)]
pub extern "C" fn achievement_effect(mask: u32, effect: u32, value: f64, context: u32) -> f64 { sim::achievements::effect(mask, effect, value, context) }
#[unsafe(no_mangle)]
pub extern "C" fn achievement_domestic_trade(seconds: f64, origin: f64, partner: f64, bonus: f64, origin_residents: f64, partner_residents: f64, mask: u32, domestic: u32) -> f64 {
    sim::achievements::domestic_trade_payout(seconds, origin, partner, bonus, origin_residents, partner_residents, mask, domestic != 0)
}
#[unsafe(no_mangle)]
pub extern "C" fn culture_earned(culture: f64, spent: f64) -> f64 { sim::achievements::earned(culture, spent) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_achievement_input(handle: u32) -> *mut f64 {
    with_sim(handle, |game| game.world.resource_mut::<sim::achievements::Accounts>().input.as_mut_ptr())
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_achievement_purchase(handle: u32, id: usize) -> *const f64 {
    with_sim(handle, |game| sim::achievements::purchase(&mut game.world, id))
}

// Diplomacy input is reused for sparse account/observation syncs and commands.
#[unsafe(no_mangle)]
pub extern "C" fn sim_diplomacy_match(handle:u32,a:i32,b:i32)->u32 {
    with_sim(handle,|game|game.world.resource_scope(|world,mut diplomacy:bevy_ecs::prelude::Mut<sim::diplomacy::Diplomacy>|
        diplomacy.configure_match(world,a,b) as u32))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_diplomacy_input(handle: u32, len: usize) -> *mut f64 {
    with_sim(handle, |game| game.world.resource_mut::<sim::diplomacy::Diplomacy>().prepare(len))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_diplomacy_sync(handle: u32, now: f64) {
    with_sim(handle, |game| sim::diplomacy::sync(&mut game.world, now))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_diplomacy_step(handle: u32, now: f64) -> *const f64 {
    with_sim(handle, |game| { sim::diplomacy::step(&mut game.world, now); game.world.resource::<sim::diplomacy::Diplomacy>().output.as_ptr() })
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_diplomacy_command(handle: u32, mode: u32, a: i32, b: i32, offer: u32, confirmed: u32) -> *const f64 {
    with_sim(handle, |game| { sim::diplomacy::command(&mut game.world, mode, a, b, offer, confirmed != 0); game.world.resource::<sim::diplomacy::Diplomacy>().output.as_ptr() })
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_diplomacy_casualty(handle: u32, a: i32, b: i32, city: u32) {
    with_sim(handle, |game| sim::diplomacy::casualty(&mut game.world, a, b, city != 0))
}

#[unsafe(no_mangle)]
pub extern "C" fn paved_road_speed(paved: u32) -> f64 {
    if paved != 0 { sim::paved_roads::PAVED_SPEED } else { sim::paved_roads::DIRT_SPEED }
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_paving_reset(handle: u32) { with_sim(handle, |g| sim::paved_roads::clear(&mut g.world)); }
#[unsafe(no_mangle)]
pub extern "C" fn sim_paving_upsert(handle: u32, id: f64, kind: u32, faction: i32, x: f64, y: f64, flags: u32, tier: f64) {
    with_sim(handle, |g| sim::paved_roads::upsert(&mut g.world, id as i64, kind, faction, x, y, flags, tier));
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_paving_remove(handle: u32, id: f64) { with_sim(handle, |g| sim::paved_roads::remove(&mut g.world, id as i64)); }
#[unsafe(no_mangle)]
pub extern "C" fn sim_paving_faction(handle: u32, faction: i32, level: f64) {
    with_sim(handle, |g| g.world.resource_mut::<sim::paved_roads::PavedRoads>().faction(faction, research::level(level) > 0.0));
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_paving_update(handle: u32, now: f64) -> usize {
    with_sim(handle, |g| g.world.resource_mut::<sim::paved_roads::PavedRoads>().update(now))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_paving_output(handle: u32) -> *const f64 {
    with_sim(handle, |g| g.world.resource::<sim::paved_roads::PavedRoads>().output())
}

#[unsafe(no_mangle)]
pub extern "C" fn naval_constant(index:u32,class:u32)->f64 {sim::warships::constant(index,class)}
#[unsafe(no_mangle)]
pub extern "C" fn sim_naval_input(handle:u32,length:usize)->*mut f64 {with_sim(handle,|g|g.world.resource_mut::<sim::warships::Warships>().input(length))}
#[unsafe(no_mangle)]
pub extern "C" fn sim_naval_geometry(handle:u32,width:i32,height:i32){with_sim(handle,|g|g.world.resource_mut::<sim::warships::Warships>().geometry(width,height));}
#[unsafe(no_mangle)]
pub extern "C" fn sim_naval_patch(handle:u32,count:usize){with_sim(handle,|g|g.world.resource_mut::<sim::warships::Warships>().patch(count));}
#[unsafe(no_mangle)]
pub extern "C" fn sim_naval_terrain(handle:u32,terrain:u32){
    let field=TERRAIN_RAYS.with_borrow(|t|t.get(terrain).terrain().clone());
    with_sim(handle,|g|g.world.resource_mut::<sim::warships::Warships>().terrain(field));
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_naval_command(handle:u32,mode:u32)->*const f64{with_sim(handle,|g|sim::warships::command(&mut g.world,mode))}
#[unsafe(no_mangle)]
pub extern "C" fn sim_naval_record_sink(handle:u32,id:f64,x:f64,y:f64,angle:f64,class:u32,faction:i32,now:f64){
    with_sim(handle,|g|g.world.resource_mut::<sim::warships::Warships>().record_sink(id as i64,x,y,angle,class,faction,now));
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_naval_sinks(handle:u32,now:f64)->*const f64{
    with_sim(handle,|g|g.world.resource_mut::<sim::warships::Warships>().sinking(now))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_naval_step(handle:u32,ships:usize,factions:usize,relations:usize,targets:usize,now:f64,dt:f64)->*const f64{with_sim(handle,|g|sim::warships::step(&mut g.world,ships,factions,relations,targets,now,dt))}
#[unsafe(no_mangle)]
pub extern "C" fn sim_naval_output_length(handle:u32)->usize{with_sim(handle,|g|sim::warships::output_length(&g.world))}

// Hidden fish stocks, renewable whales and ECS voyage lifecycle.
#[unsafe(no_mangle)]
pub extern "C" fn fishery_constant(index:u32)->f64 {sim::fisheries::constant(index)}
#[unsafe(no_mangle)]
pub extern "C" fn fishery_speed(until:f64,now:f64,value:f64)->f64 {sim::fisheries::speed(until,now,value)}
#[unsafe(no_mangle)]
pub extern "C" fn sim_fishery_input(handle:u32,length:usize)->*mut f64 {with_sim(handle,|g|g.world.resource_mut::<sim::fisheries::Fisheries>().input(length))}
#[unsafe(no_mangle)]
pub extern "C" fn sim_fishery_commit(handle:u32,mode:u32,count:usize,width:usize,height:usize,seed:u32,now:f64) {with_sim(handle,|g|sim::fisheries::commit(&mut g.world,mode,count,width,height,seed,now));}
#[unsafe(no_mangle)]
pub extern "C" fn sim_fishery_scenario_whales(handle:u32)->u32 {with_sim(handle,|g|sim::fisheries::scenario_whales(&mut g.world))}
#[unsafe(no_mangle)]
pub extern "C" fn sim_fishery_atoll_provision(handle:u32,cx:f64,cy:f64,rx:f64,ry:f64,multiplier:u32)->u32 {
    with_sim(handle,|g|sim::fisheries::atoll_fisheries(&mut g.world,cx,cy,rx,ry,multiplier))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_fishery_step(handle:u32,now:f64,dt:f64)->*const f64 {with_sim(handle,|g|sim::fisheries::step(&mut g.world,now,dt))}
#[unsafe(no_mangle)]
pub extern "C" fn sim_fishery_length(handle:u32)->usize {with_sim(handle,|g|g.world.resource::<sim::fisheries::Fisheries>().len())}
#[unsafe(no_mangle)]
pub extern "C" fn sim_fishery_placement(handle:u32,x:f64,y:f64)->u32 {with_sim(handle,|g|g.world.resource::<sim::fisheries::Fisheries>().placement(x,y)as u32)}

#[unsafe(no_mangle)]
pub extern "C" fn sim_fishery_push(handle:u32,id:f64,x:f64,y:f64){with_sim(handle,|g|sim::fisheries::push(&mut g.world,id as i64,x,y));}

#[unsafe(no_mangle)]
pub extern "C" fn naval_fleet_upkeep(count:usize)->f64{sim::warships::fleet_upkeep(count)}

// Exploration encounter transport. Rules and persistent mirrors are documented
// in sim/exploration.rs and src/game/exploration-native.ts.
#[unsafe(no_mangle)]
pub extern "C" fn sim_exploration_input(handle:u32,length:usize)->*mut f64{with_sim(handle,|g|g.world.resource_mut::<sim::exploration::Exploration>().prepare(length))}
#[unsafe(no_mangle)]
pub extern "C" fn sim_exploration_geometry(handle:u32,width:usize,height:usize){with_sim(handle,|g|g.world.resource_mut::<sim::exploration::Exploration>().geometry(width,height));}
#[unsafe(no_mangle)]
pub extern "C" fn sim_exploration_initialize(handle:u32,seed:u32,restore:u32)->*const f64{with_sim(handle,|g|sim::exploration::initialize(&mut g.world,seed,restore!=0))}
#[unsafe(no_mangle)]
pub extern "C" fn sim_exploration_contact(handle:u32,actor:i32,x:f64,y:f64,flags:u32)->*const f64{with_sim(handle,|g|g.exploration_contact(actor,x,y,flags))}
#[unsafe(no_mangle)]
pub extern "C" fn sim_exploration_reward(handle:u32,id:usize,actor:i32,choice:i32)->*const f64{with_sim(handle,|g|g.exploration_reward(id,actor,choice))}
#[unsafe(no_mangle)]
pub extern "C" fn sim_exploration_length(handle:u32)->usize{with_sim(handle,|g|g.world.resource::<sim::exploration::Exploration>().length())}
#[unsafe(no_mangle)]
pub extern "C" fn exploration_ranger(field:u32,value:f64,enabled:u32)->f64{sim::exploration::ranger(field,value,enabled!=0)}
#[unsafe(no_mangle)]
pub extern "C" fn exploration_town_upkeep(until:f64,now:f64,value:f64)->f64{sim::exploration::town_upkeep(until,now,value)}
#[unsafe(no_mangle)]
pub extern "C" fn exploration_ranger_recruit(entitled:f64,alive:f64)->u32{sim::exploration::ranger_recruit(entitled,alive) as u32}

#[unsafe(no_mangle)]
pub extern "C" fn exploration_ambush_committed(was:u32,alive:u32,fleeing:u32,distance:f64)->u32{sim::exploration::ambush_committed(was!=0,alive!=0,fleeing!=0,distance) as u32}
#[unsafe(no_mangle)]
pub extern "C" fn exploration_refugee_arrived(x:f64,y:f64,gx:f64,gy:f64)->u32{sim::exploration::refugee_arrived(x,y,gx,gy) as u32}
#[unsafe(no_mangle)]
pub extern "C" fn exploration_ordinary_slots(total:f64,rangers:f64)->f64{sim::exploration::ordinary_slots(total,rangers)}
#[unsafe(no_mangle)]
pub extern "C" fn sim_exploration_build_allowed(handle:u32,x:i32,y:i32,width:i32,height:i32)->u32{with_sim(handle,|g|sim::exploration::build_allowed(&g.world,x,y,width,height) as u32)}

#[unsafe(no_mangle)]
pub extern "C" fn sim_exploration_reward_due(handle:u32,id:usize,now:f64)->u32{with_sim(handle,|g|g.world.resource_mut::<sim::exploration::Exploration>().reward_due(id,now) as u32)}

#[unsafe(no_mangle)]
pub extern "C" fn exploration_ambush_active(finished:u32,standing:usize)->u32{sim::exploration::ambush_active(finished!=0,standing) as u32}

#[unsafe(no_mangle)]
pub extern "C" fn field_cannon_constant(i:u32)->f64{sim::field_cannons::constant(i)}
#[unsafe(no_mangle)]
pub extern "C" fn sim_field_input(h:u32,n:usize)->*mut f64{with_sim(h,|g|g.world.resource_mut::<sim::field_cannons::FieldCannons>().prepare(n))}
#[unsafe(no_mangle)]
pub extern "C" fn sim_field_reset(h:u32){with_sim(h,|g|g.world.resource_mut::<sim::field_cannons::FieldCannons>().reset());}
#[unsafe(no_mangle)]
pub extern "C" fn sim_field_site(h:u32,id:f64,kind:u32,faction:i32,x:f64,y:f64,flags:u32){with_sim(h,|g|g.world.resource_mut::<sim::field_cannons::FieldCannons>().site(id as i64,kind,faction,x,y,flags));}
#[unsafe(no_mangle)]
pub extern "C" fn sim_field_convert(h:u32,n:usize)->*const f64{with_sim(h,|g|g.world.resource_mut::<sim::field_cannons::FieldCannons>().convert(n))}
#[unsafe(no_mangle)]
pub extern "C" fn sim_field_due(h:u32,id:f64,now:f64)->u32{with_sim(h,|g|sim::field_cannons::due(&g.world,id as i64,now) as u32)}
#[unsafe(no_mangle)]
pub extern "C" fn sim_field_step(h:u32,id:f64,now:f64,dt:f64,n:usize)->*const f64{with_sim(h,|g|MOVEMENT.with_borrow(|m|sim::field_cannons::step(&mut g.world,id as i64,now,dt,n,m)))}

#[unsafe(no_mangle)]
pub extern "C" fn sim_field_road(h:u32,x:f64,y:f64,nx:f64,ny:f64)->u32{with_sim(h,|g|g.world.resource::<sim::field_cannons::FieldCannons>().road_move(x,y,nx,ny) as u32)}

#[unsafe(no_mangle)]
pub extern "C" fn field_cannon_total_upkeep(count:u32)->f64{count as f64*sim::field_cannons::UPKEEP}

#[unsafe(no_mangle)]
pub extern "C" fn sim_field_order(h:u32,id:f64){with_sim(h,|g|sim::field_cannons::order(&mut g.world,id as i64));}
#[unsafe(no_mangle)]
pub extern "C" fn sim_field_status(h:u32,id:f64)->*const f64{with_sim(h,|g|sim::field_cannons::status(&mut g.world,id as i64))}

// ---------------------------------------------------------- Military Academy
#[unsafe(no_mangle)]
pub extern "C" fn military_academy_constant(index: u32) -> f64 { sim::military_academies::constant(index) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_academy_faction(handle: u32, faction: i32, level: f64, preference: u32) {
    with_sim(handle, |g| g.world.resource_mut::<sim::military_academies::MilitaryAcademies>().faction(faction, research::level(level) > 0.0, preference));
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_academy_status(handle: u32, faction: i32) -> u32 {
    with_sim(handle, |g| g.world.resource::<sim::military_academies::MilitaryAcademies>().status(faction))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_academy_type(handle: u32, faction: i32) -> u32 {
    with_sim(handle, |g| g.world.resource::<sim::military_academies::MilitaryAcademies>().chosen(faction))
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_academy_select(handle: u32, faction: i32, choice: u32) -> u32 {
    with_sim(handle, |g| g.world.resource_mut::<sim::military_academies::MilitaryAcademies>().select(faction, choice) as u32)
}
#[unsafe(no_mangle)]
pub extern "C" fn infantry_formation_offset(count: u32, choice: u32, index: u32, axis: u32) -> f64 {
    sim::military_academies::offset(count as usize, choice, index as usize, axis)
}
#[unsafe(no_mangle)]
pub extern "C" fn infantry_formation_modifier(choice: u32, kind: u32, effect: u32, in_ranks: u32, frontal: u32) -> f64 {
    sim::military_academies::modifier(choice, kind, effect, in_ranks != 0, frontal != 0)
}
#[unsafe(no_mangle)]
pub extern "C" fn infantry_formation_cooldown(choice: u32, kind: u32, active: u32, leader: u32, goal_distance: f64, cooldown: f64) -> f64 {
    let in_ranks = active != 0 && (leader != 0 || goal_distance.is_finite() && goal_distance <= 0.9);
    cooldown / sim::military_academies::modifier(choice, kind, 2, in_ranks, false)
}

#[unsafe(no_mangle)]
pub extern "C" fn sim_field_navigation(h:u32,faction:i32,engine:u32,grid:u32,blockers:u32,forbidden:u32,width:i32,height:i32,revision:f64){
    with_sim(h,|g|g.world.resource_mut::<sim::field_cannons::FieldCannons>().navigation(faction,sim::field_cannons::Navigation{engine,grid,blockers,forbidden,width,height,revision:revision as u64}));
}

#[unsafe(no_mangle)]
pub extern "C" fn sim_field_formation(h:u32,count:usize,x:f64,y:f64,heading:f64)->*const f64{
    with_sim(h,|g|g.world.resource_mut::<sim::field_cannons::FieldCannons>().formation(count,x,y,heading))
}

#[unsafe(no_mangle)]
pub extern "C" fn sim_structure_query_mask(handle: u32, faction: f64, flags: u32, kinds: f64) -> *const f64 {
    with_sim(handle, |game| game.world.resource_scope(|world, mut index: bevy_ecs::prelude::Mut<sim::structures::StructureIndex>| index.query_mask(world, faction, flags, kinds as u64)))
}

#[unsafe(no_mangle)]
pub extern "C" fn sim_offensive_begin(handle: u32, faction: i32, leader: f64, rx: f64, ry: f64, ox: f64, oy: f64, unlocked: u32) -> u32 {
    with_sim(handle, |game| { let now = game.clock().time;
        game.world.resource_mut::<sim::offensive::Offensives>().begin(faction, leader as i64, [rx, ry], [ox, oy], unlocked != 0, now) as u32 })
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_offensive_cancel(handle: u32, faction: i32) { with_sim(handle, |g| g.world.resource_mut::<sim::offensive::Offensives>().cancel(faction)); }
#[unsafe(no_mangle)]
pub extern "C" fn sim_offensive_status(handle: u32, faction: i32) -> *const f64 { with_sim(handle, |g| g.world.resource_mut::<sim::offensive::Offensives>().status(faction)) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_offensive_input(handle: u32, members: usize, enemies: usize) -> *mut f64 { with_sim(handle, |g| g.world.resource_mut::<sim::offensive::Offensives>().prepare(members, enemies)) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_offensive_step(handle: u32, faction: i32, now: f64, members: usize, enemies: usize, expected: usize) -> *const f64 {
    with_sim(handle, |g| {
        let nav = g.world.resource::<sim::offensive::Offensives>().navigation;
        MOVEMENT.with_borrow(|engines| g.world.resource_mut::<sim::offensive::Offensives>().step(faction, now, members, enemies, expected,
            |x, y, tx, ty| nav.is_none_or(|n| engines.get(n.engine).sweep(n.grid, x, y, tx, ty, n.blockers, n.forbidden))))
    })
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_offensive_navigation(handle: u32, engine: u32, grid: u32, blockers: u32, forbidden: u32) {
    with_sim(handle, |g| g.world.resource_mut::<sim::offensive::Offensives>().navigation = (engine != 0).then_some(sim::offensive::Navigation { engine, grid, blockers, forbidden }));
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_offensive_reward(handle: u32, faction: i32, amount: f64) -> f64 { with_sim(handle, |g| g.world.resource::<sim::offensive::Offensives>().reward(faction, amount)) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_offensive_casualty(handle: u32, faction: i32) { with_sim(handle, |g| g.world.resource_mut::<sim::offensive::Offensives>().casualty(faction)); }
#[unsafe(no_mangle)]
pub extern "C" fn sim_offensive_growth(handle: u32, faction: i32, growth: f64) -> f64 { with_sim(handle, |g| growth * g.world.resource::<sim::offensive::Offensives>().growth(faction)) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_offensive_births(handle: u32, faction: i32, births: f64) { with_sim(handle, |g| g.world.resource_mut::<sim::offensive::Offensives>().births(faction, births)); }
#[unsafe(no_mangle)]
pub extern "C" fn sim_offensive_ai_due(handle: u32, faction: i32, now: f64) -> u32 { with_sim(handle, |g| g.world.resource_mut::<sim::offensive_ai::OffensiveAi>().due(faction, now) as u32) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_offensive_ai_input(handle: u32, members: usize, targets: usize) -> *mut f64 { with_sim(handle, |g| g.world.resource_mut::<sim::offensive_ai::OffensiveAi>().prepare(members, targets)) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_offensive_ai_select(handle: u32, faction: i32, now: f64, members: usize, targets: usize) -> *const f64 {
    with_sim(handle, |g| { let current = g.world.resource::<sim::offensive::Offensives>().view(faction);
        g.world.resource_mut::<sim::offensive_ai::OffensiveAi>().select(faction, now, members, targets, current) })
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_offensive_ai_path_input(handle: u32, count: usize) -> *mut f64 { with_sim(handle, |g| g.world.resource_mut::<sim::offensive_ai::OffensiveAi>().path_input(count)) }
#[unsafe(no_mangle)]
pub extern "C" fn sim_offensive_ai_route(handle: u32, faction: i32, now: f64, count: usize) -> *const f64 {
    with_sim(handle, |g| { let nav = g.world.resource::<sim::offensive::Offensives>().navigation;
        MOVEMENT.with_borrow(|engines| g.world.resource_mut::<sim::offensive_ai::OffensiveAi>().route(faction, now, count,
            |x, y, tx, ty| nav.is_some_and(|n| engines.get(n.engine).sweep(n.grid, x, y, tx, ty, n.blockers, n.forbidden)))) })
}
#[unsafe(no_mangle)]
pub extern "C" fn sim_offensive_ai_feedback(handle: u32, faction: i32, now: f64, launched: u32) { with_sim(handle, |g| g.world.resource_mut::<sim::offensive_ai::OffensiveAi>().feedback(faction, now, launched != 0)); }
#[unsafe(no_mangle)]
pub extern "C" fn sim_offensive_ai_status(handle: u32, faction: i32) -> *const f64 { with_sim(handle, |g| g.world.resource_mut::<sim::offensive_ai::OffensiveAi>().status(faction)) }
#[unsafe(no_mangle)]
pub extern "C" fn combat_record_kill_amount(kills: f64, amount: f64) -> f64 { combat::record_kill_amount(kills, amount) }
