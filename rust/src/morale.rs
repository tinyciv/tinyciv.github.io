//! Indexed casualty history and persistent morale actors. Host code publishes
//! presentation fields and supplies only indexed nearby survivors/hostility
//! facts. Casualties enter and leave each native spatial bucket exactly once.
use bevy_ecs::prelude::*;
use bevy_ecs::schedule::SingleThreadedExecutor;
use std::collections::BTreeMap;

pub const RADIUS: f64 = 8.0;
pub const WINDOW: f64 = 20.0;
pub const LOSS_RATIO: f64 = 5.0;
pub const FLOOR: f64 = 6.0;
pub const MORALE_DRAIN: f64 = 50.0;
pub const SHOCK_SECONDS: f64 = 4.0;
pub const LEADER_RADIUS: f64 = 6.0;
pub const LEADER_LOSS: f64 = 40.0;
pub const CONTAGION: f64 = 18.0;
pub const MIN_ROUT: f64 = 15.0;
const MARAUDER_MAX_MORALE: f64 = 80.0;
const HISTORY_LIMIT: usize = 2048;
const FLEE: u32 = 5;
const RETINUE: u32 = 4;
const LEADER: u32 = 8;
const EXCLUDED_RETINUE: u32 = 16 | 32 | 64 | 128;
const INSIDE: u32 = 256;

pub fn constant(index: u32) -> f64 {
    match index { 0 => RADIUS, 1 => WINDOW, 2 => LOSS_RATIO, 3 => FLOOR, 4 => MORALE_DRAIN,
        5 => SHOCK_SECONDS, 6 => LEADER_RADIUS, 7 => LEADER_LOSS, 8 => CONTAGION, 9 => MIN_ROUT,
        10 => HISTORY_LIMIT as f64, 11 => MARAUDER_MAX_MORALE, _ => f64::NAN }
}
fn minimum(a: f64, b: f64) -> f64 { if a.is_nan() || b.is_nan() { f64::NAN } else { a.min(b) } }
fn maximum(a: f64, b: f64) -> f64 { if a.is_nan() || b.is_nan() { f64::NAN } else { a.max(b) } }
pub fn casualty_allowed(hp: f64, flags: u32) -> bool { !(hp > 0.0) && flags & 1 != 0 }
pub fn begin_rout(now: f64, faction: f64, order: u32, until: f64) -> [f64; 2] {
    if order == FLEE { [0.0, until] } else { [1.0, if faction == -2.0 { now + MIN_ROUT } else { until }] }
}
pub fn leader_rout(flags: u32, faction: f64, hp: f64, order: u32) -> bool {
    flags & LEADER != 0 && !(faction < 0.0) && !(hp <= 0.0) && order == FLEE
}
pub fn retinue_member(flags: u32, faction: f64, hp: f64, order: u32, leader_faction: f64) -> u32 {
    if faction != leader_faction || hp <= 0.0 || flags & RETINUE == 0 || flags & EXCLUDED_RETINUE != 0 { 0 }
    else if order == FLEE { 1 } else { 3 }
}
pub fn can_rally(now: f64, faction: f64, until: f64) -> bool { faction != -2.0 || now >= until }
pub fn contagion(routing: f64, standing: f64, near_leader: bool) -> f64 {
    CONTAGION * minimum(1.0, routing / maximum(1.0, standing)) * if near_leader { 0.5 } else { 1.0 }
}

#[derive(Component, Clone, Copy)]
struct Casualty { unit: i64, faction: i64, x: f64, y: f64, time: f64, sequence: u64 }
#[derive(Resource, Default)]
struct History {
    events: Vec<Entity>, head: usize, sequence: u64,
    buckets: BTreeMap<(i64, i64), BTreeMap<u64, Entity>>,
    compacted: usize,
}
#[derive(Resource, Default)]
struct Now(f64);
#[derive(Resource, Default)]
struct Pressure {
    now: f64, x: f64, y: f64, faction: i64, shock_until: f64,
    losses: f64, total_losses: f64, foreign: Vec<f64>,
}
#[derive(Component)]
struct MoraleActor { input: [f64; 16], output: [f64; 8] }
#[derive(Resource, Default)]
struct ActorStep { entity: Option<Entity>, now: f64, dt: f64 }

fn expire_history(world: &mut World) {
    let now = world.resource::<Now>().0;
    world.resource_scope(|world, mut history: Mut<History>| {
        history.compacted = 0;
        while history.head < history.events.len() {
            let entity = history.events[history.head];
            let casualty = *world.get::<Casualty>(entity).expect("active casualty");
            if !(casualty.time < now - WINDOW || history.events.len() - history.head > HISTORY_LIMIT) { break; }
            history.head += 1;
            let key = ((casualty.y / RADIUS).floor() as i64, (casualty.x / RADIUS).floor() as i64);
            if let Some(bucket) = history.buckets.get_mut(&key) {
                bucket.remove(&casualty.sequence);
                if bucket.is_empty() { history.buckets.remove(&key); }
            }
            world.despawn(entity);
        }
        if history.head != 0 && (history.head >= 1024 || history.head * 2 >= history.events.len()) {
            history.compacted = history.head;
            let head = history.head; history.events.drain(..head); history.head = 0;
        }
    });
}

fn measure_pressure(history: Res<History>, deaths: Query<&Casualty>, mut pressure: ResMut<Pressure>) {
    pressure.losses = 0.0; pressure.total_losses = 0.0; pressure.foreign.clear();
    let bx = (pressure.x / RADIUS).floor() as i64; let by = (pressure.y / RADIUS).floor() as i64;
    for y in by - 1..=by + 1 { for x in bx - 1..=bx + 1 {
        let Some(bucket) = history.buckets.get(&(y, x)) else { continue; };
        for entity in bucket.values() {
            let death = deaths.get(*entity).expect("indexed casualty");
            if death.time < pressure.now - WINDOW || (death.x - pressure.x).hypot(death.y - pressure.y) > RADIUS { continue; }
            if death.faction == pressure.faction {
                pressure.total_losses += 1.0;
                if death.time > pressure.shock_until { pressure.losses += 1.0; }
            } else {
                // The original host callback runs once per foreign death in
                // y/x bucket order and within-bucket insertion order.
                pressure.foreign.push(death.faction as f64);
            }
        }
    } }
}

fn integrate_morale(step: Res<ActorStep>, mut actors: Query<&mut MoraleActor>) {
    let Some(entity) = step.entity else { return; };
    let mut actor = actors.get_mut(entity).expect("morale actor");
    let values = actor.input;
    let flags = values[7] as u32;
    let hostile = flags & 1 != 0; let near_leader = flags & 2 != 0; let shelter = flags & 4 != 0;
    let collapsing = flags & 8 != 0; let unfavorable = flags & 16 != 0; let leader = flags & 32 != 0;
    let defeated = flags & 64 != 0; let retinue = flags & 128 != 0; let garrison = flags & 256 != 0;
    let leader_fleeing = flags & 512 != 0; let pack = flags & 1024 != 0;
    let hp = values[1];
    let enemies = values[3]; let allies = values[4]; let routing = values[5]; let fighting_until = values[6];
    let mut shock_until = values[8]; let mut shock_tag = values[9]; let mut shock_routed = values[10];
    let faction = values[11]; let mut rout_until = values[12]; let mut order = values[13] as u32;
    let (mut morale, maximum_morale) = if faction == -2.0 {
        let limit = minimum(values[2], MARAUDER_MAX_MORALE);
        (minimum(values[0], limit), limit)
    } else { (values[0], values[2]) };
    let previous_order = values[14]; let mut routed = values[15]; let mut actions = 0_u32;
    let standing = if hostile { maximum(1.0, allies - routing) } else { allies };
    let mut change = if enemies == 0.0 { 6.0 } else if near_leader { 2.0 } else { 0.5 };
    if step.now < fighting_until { change += 1.5; }
    if hp < 30.0 && enemies != 0.0 { change -= 35.0 + (30.0 - hp) * 2.5; }
    if enemies > standing * 1.5 { change -= (enemies - standing) * 2.5; }
    if hostile && order != FLEE && (enemies > 0.0 || step.now < fighting_until) {
        change -= contagion(routing, standing, near_leader);
    }
    if order == FLEE && shelter && enemies == 0.0 { change += 8.0; }
    if collapsing && step.now >= if shock_tag != 0.0 { shock_until } else { f64::NEG_INFINITY } {
        shock_tag = 1.0; shock_until = step.now + SHOCK_SECONDS; shock_routed = 0.0; actions |= 4;
    }
    let casualty_collapse = shock_tag != 0.0 && step.now < shock_until && unfavorable;
    let shock_caused_drain = casualty_collapse && change > -MORALE_DRAIN;
    if casualty_collapse { change = minimum(change, -MORALE_DRAIN); }
    change = crate::sim::achievements::morale_recovery((flags >> 11) & crate::sim::achievements::OWNED_MASK,
        change, enemies, near_leader, order == FLEE, flags & (1 << 30) != 0);
    morale = maximum(0.0, minimum(maximum_morale, morale + change * step.dt));
    if shock_routed == 2.0 && step.now >= shock_until {
        shock_routed = 1.0;
        if !leader && order == FLEE && !defeated { morale = maximum(50.0, morale); }
    }
    if morale <= 0.0 && order != FLEE {
        if shock_caused_drain { shock_routed = 2.0; }
        order = FLEE; routed = 2.0;
        if faction == -2.0 { rout_until = step.now + MIN_ROUT; }
        actions |= 1;
    }
    if !leader && order == FLEE && morale > 48.0 && (!retinue || garrison || !leader_fleeing)
        && can_rally(step.now, faction, rout_until) && !defeated {
        order = if previous_order >= 0.0 && previous_order != FLEE as f64 { previous_order as u32 }
            else if pack { 4 } else { 0 };
        routed = 1.0; rout_until = f64::NAN; actions |= 2;
    }
    actor.output = [morale, shock_tag, shock_until, shock_routed, actions as f64, order as f64, rout_until, routed];
}

pub struct MoraleEngine {
    world: World, expiry: Schedule, pressure_schedule: Schedule, integration: Schedule,
    actors: BTreeMap<i64, Entity>, input: Vec<f64>, output: Vec<f64>,
}
impl Default for MoraleEngine {
    fn default() -> Self {
        let mut world = World::new(); world.init_resource::<History>(); world.init_resource::<Now>();
        world.init_resource::<Pressure>(); world.init_resource::<ActorStep>();
        let mut expiry = Schedule::default(); expiry.set_executor(SingleThreadedExecutor::new()); expiry.add_systems(expire_history);
        let mut pressure_schedule = Schedule::default(); pressure_schedule.set_executor(SingleThreadedExecutor::new()); pressure_schedule.add_systems(measure_pressure);
        let mut integration = Schedule::default(); integration.set_executor(SingleThreadedExecutor::new()); integration.add_systems(integrate_morale);
        Self { world, expiry, pressure_schedule, integration, actors: BTreeMap::new(), input: Vec::new(), output: vec![0.0; 8] }
    }
}
impl MoraleEngine {
    pub fn prepare(&mut self, capacity: usize) -> *mut f64 {
        if self.input.len() < capacity { self.input.resize(capacity, 0.0); }
        self.input.as_mut_ptr()
    }
    /// Only serialized casualty replacement/import rebuilds history. Routine
    /// deaths call record() and never iterate earlier events in the host.
    pub fn reset(&mut self, count: usize) {
        assert!(count * 5 <= self.input.len());
        let previous = std::mem::take(&mut *self.world.resource_mut::<History>());
        for entity in &previous.events[previous.head..] { self.world.despawn(*entity); }
        for row in 0..count {
            let values = &self.input[row * 5..];
            let event = (values[0] as i64, values[1] as i64, values[2], values[3], values[4]);
            self.record(event.0, event.1, event.2, event.3, event.4);
        }
    }
    pub fn record(&mut self, unit: i64, faction: i64, x: f64, y: f64, time: f64) {
        let sequence = self.world.resource::<History>().sequence;
        let entity = self.world.spawn(Casualty { unit, faction, x, y, time, sequence }).id();
        let mut history = self.world.resource_mut::<History>(); history.sequence += 1; history.events.push(entity);
        history.buckets.entry(((y / RADIUS).floor() as i64, (x / RADIUS).floor() as i64)).or_default().insert(sequence, entity);
    }
    pub fn prune(&mut self, now: f64) -> *const f64 {
        self.world.resource_mut::<Now>().0 = now; self.expiry.run(&mut self.world);
        let history = self.world.resource::<History>();
        self.output[..3].copy_from_slice(&[history.compacted as f64, history.events.len() as f64, (history.events.len() - history.head) as f64]);
        self.output.as_ptr()
    }
    /// Input is read only at finish(). This stage exposes nearby foreign
    /// factions in original callback order, including repeated faction IDs.
    pub fn pressure(&mut self, now: f64, x: f64, y: f64, faction: i64, shock_until: f64) -> *const f64 {
        { let mut value = self.world.resource_mut::<Pressure>();
            value.now = now; value.x = x; value.y = y; value.faction = faction; value.shock_until = shock_until; }
        self.pressure_schedule.run(&mut self.world);
        let pressure = self.world.resource::<Pressure>();
        self.output[..2].copy_from_slice(&[pressure.losses, if pressure.losses >= FLOOR { 1.0 } else { 0.0 }]);
        self.output.as_ptr()
    }
    pub fn factions(&self) -> *const f64 { self.world.resource::<Pressure>().foreign.as_ptr() }
    pub fn faction_count(&self) -> usize { self.world.resource::<Pressure>().foreign.len() }
    pub fn finish(&mut self, living: f64) -> *const f64 {
        let pressure = self.world.resource::<Pressure>(); let count = pressure.foreign.len();
        assert!(count <= self.input.len());
        let enemy_losses = self.input[..count].iter().filter(|&&hostile| hostile != 0.0).count() as f64;
        let threshold = maximum(FLOOR, ((living + pressure.losses) / 2.0).ceil());
        let unfavorable = pressure.total_losses >= LOSS_RATIO * enemy_losses;
        self.output[..6].copy_from_slice(&[pressure.losses, threshold, (enemy_losses > 0.0) as u32 as f64,
            enemy_losses, unfavorable as u32 as f64, (pressure.losses >= threshold && unfavorable) as u32 as f64]);
        self.output.as_ptr()
    }
    /// Indexed nearby candidates: [faction,hp,kindFlags,morale,x,y,order].
    /// Output: [affected,newMorale]. Host publishes rout events at zero morale.
    pub fn commander_shock(&mut self, x: f64, y: f64, count: usize) -> *const f64 {
        assert!(count * 7 <= self.input.len()); self.output.resize(maximum(8.0, (count * 2) as f64) as usize, 0.0);
        for row in 0..count {
            let value = &self.input[row * 7..]; let flags = value[2] as u32;
            let affected = value[0] == -2.0 && !(value[1] <= 0.0) && flags & INSIDE == 0 && flags & 2 != 0
                && (x - value[4]).hypot(y - value[5]) <= LEADER_RADIUS;
            let morale = if affected { maximum(0.0, value[3] - LEADER_LOSS) } else { value[3] };
            self.output[row * 2] = if affected { if morale == 0.0 && value[6] as u32 != FLEE { 3.0 } else { 1.0 } } else { 0.0 };
            self.output[row * 2 + 1] = morale;
        }
        self.output.as_ptr()
    }
    /// Indexed local survivors: [faction,hp,kindFlags,x,y]. No world-wide actor
    /// snapshots are imported for an individual pressure observation.
    pub fn living(&self, faction: i64, x: f64, y: f64, count: usize) -> f64 {
        assert!(count * 5 <= self.input.len());
        self.input[..count * 5].chunks_exact(5).filter(|value| {
            let flags = value[2] as u32;
            value[0] as i64 == faction && value[1] > 0.0 && flags & INSIDE == 0 && flags & 1 != 0
                && (x - value[3]).hypot(y - value[4]) <= RADIUS
        }).count() as f64
    }
    /// Input16: morale,hp,maxMorale,enemies,allies,routingAllies,fightingUntil,
    /// flags,shockUntil,shockTag,shockRoutedTag,faction,routUntil,order,routOrder,routedTag.
    /// Tags: 0 absent,1 false/present,2 true. Output8: morale,shockTag,shockUntil,
    /// shockRoutedTag,actions(1 beginRout/2 rally/4 newShock),order,routUntil,routedTag.
    pub fn integrate(&mut self, id: i64, now: f64, dt: f64) -> *const f64 {
        assert!(self.input.len() >= 16);
        let entity = *self.actors.entry(id).or_insert_with(|| self.world.spawn_empty().id());
        let mut input = [0.0; 16]; input.copy_from_slice(&self.input[..16]);
        self.world.entity_mut(entity).insert(MoraleActor { input, output: [0.0; 8] });
        *self.world.resource_mut::<ActorStep>() = ActorStep { entity: Some(entity), now, dt };
        self.integration.run(&mut self.world);
        self.output[..8].copy_from_slice(&self.world.get::<MoraleActor>(entity).expect("integrated actor").output);
        self.output.as_ptr()
    }
    pub fn remove_actor(&mut self, id: i64) { if let Some(entity) = self.actors.remove(&id) { self.world.despawn(entity); } }
}

#[derive(Default)]
pub struct Engines { next_handle: u32, engines: BTreeMap<u32, MoraleEngine> }
impl Engines {
    pub fn create(&mut self) -> u32 {
        self.next_handle = self.next_handle.checked_add(1).expect("morale handle overflow");
        self.engines.insert(self.next_handle, MoraleEngine::default()); self.next_handle
    }
    pub fn drop_engine(&mut self, handle: u32) { self.engines.remove(&handle); }
    pub fn get_mut(&mut self, handle: u32) -> &mut MoraleEngine { self.engines.get_mut(&handle).expect("unknown morale engine") }
    pub fn get(&self, handle: u32) -> &MoraleEngine { self.engines.get(&handle).expect("unknown morale engine") }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn indexes_local_losses_and_preserves_strict_window_and_shock_boundaries() {
        let mut engine = MoraleEngine::default(); engine.prepare(16);
        for id in 0..6 { engine.record(id, 0, 10.0, 10.0, 0.0); }
        engine.record(99, -2, 10.0, 10.0, 0.0); engine.record(100, -2, 30.0, 10.0, 0.0);
        engine.prune(20.0); engine.pressure(20.0, 10.0, 10.0, 0, f64::NEG_INFINITY);
        assert_eq!(engine.output[..2], [6.0, 1.0]); assert_eq!(engine.faction_count(), 1);
        engine.input[0] = 1.0; engine.finish(1.0);
        assert_eq!(engine.output[..6], [6.0, 6.0, 1.0, 1.0, 1.0, 1.0]);
        engine.pressure(20.0, 10.0, 10.0, 0, 0.0); assert_eq!(engine.output[0], 0.0);
        engine.prune(20.001); assert_eq!(engine.output[..3], [8.0, 0.0, 0.0]);
    }
    #[test]
    fn exposes_hostility_callbacks_in_bucket_and_insertion_order_including_reused_ids() {
        let mut engine = MoraleEngine::default(); engine.prepare(4);
        engine.record(9, 1, 14.0, 10.0, 0.0); engine.record(9, 2, 14.0, 10.0, 0.0);
        engine.record(4, 3, 7.9, 10.0, 0.0); engine.prune(0.0);
        engine.pressure(0.0, 10.0, 10.0, 0, f64::NEG_INFINITY);
        assert_eq!(engine.world.resource::<Pressure>().foreign, vec![3.0, 1.0, 2.0]);
        engine.input[..3].copy_from_slice(&[1.0, 0.0, 1.0]); engine.finish(0.0);
        assert_eq!(engine.output[3], 2.0);
    }
    #[test]
    fn does_not_extend_marauder_rout_deadlines_and_scales_contagion_by_standing_support() {
        assert_eq!(begin_rout(3.0, -2.0, 1, f64::NEG_INFINITY), [1.0, 18.0]);
        assert_eq!(begin_rout(8.0, -2.0, 5, 18.0), [0.0, 18.0]);
        assert!(!can_rally(17.9, -2.0, 18.0)); assert!(can_rally(18.0, -2.0, 18.0));
        assert_eq!(contagion(2.0, 4.0, false), 9.0); assert_eq!(contagion(2.0, 4.0, true), 4.5);
    }
    #[test]
    fn integrates_a_coarse_shock_and_keeps_marauder_rally_deadline_after_it_expires() {
        let mut engine = MoraleEngine::default(); engine.prepare(16);
        engine.input[..16].copy_from_slice(&[100.0, 100.0, 100.0, 0.0, 1.0, 0.0, -60.0,
            (8 | 16) as f64, f64::NEG_INFINITY, 0.0, 0.0, -2.0, f64::NEG_INFINITY, 1.0, -1.0, 0.0]);
        engine.integrate(1, 0.0, 1.6);
        assert_eq!(engine.output[0], 0.0); assert_eq!(engine.output[2], 4.0); assert_eq!(engine.output[3], 2.0);
        assert_eq!(engine.output[4], 5.0); assert_eq!(engine.output[6], 15.0);
        engine.input[..16].copy_from_slice(&[0.0, 100.0, 100.0, 0.0, 1.0, 0.0, -60.0,
            0.0, 4.0, 1.0, 2.0, -2.0, 15.0, 5.0, 1.0, 2.0]);
        engine.integrate(1, 4.1, 0.1);
        assert_eq!(engine.output[0], 50.0); assert_eq!(engine.output[3], 1.0); assert_eq!(engine.output[4], 0.0);
    }
}
