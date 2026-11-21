//! Resident construction sites and their ordered lifecycle transitions.
//! Clearance and scenery changes are synchronous host effects between prepare
//! and finish commands. No host callbacks run inside the ECS schedule.
use bevy_ecs::prelude::*;
use bevy_ecs::schedule::SingleThreadedExecutor;
use std::collections::BTreeMap;

pub const INPUT_STRIDE: usize = 31;
pub const OUTPUT_STRIDE: usize = 12;
pub const INVALIDATE: u32 = 1;
pub const CLEARANCE: u32 = 2;
pub const COMPLETE: u32 = 4;
pub const SKIP: u32 = 8;
pub const MARBLE_CONSTRUCTION_MULTIPLIER: f64 = 0.90;

pub fn marble_construction_multiplier(developed: u32) -> f64 {
    if developed == 4 { MARBLE_CONSTRUCTION_MULTIPLIER } else { 1.0 }
}

pub fn duration(kind: u32) -> f64 {
    match kind {
        0 | 3 | 17 => 0.0,
        1 => 240.0,
        2 | 24 | 25 => 45.0,
        4 => 60.0,
        5 => 65.0,
        20 | 22 | 23 | 31 => 90.0,
        6 => 3.75,
        7 => 40.0 / 3.0,
        8 | 18 | 19 => 20.0,
        9 | 15 => 25.0,
        10 => 2.0,
        11 | 12 | 13 => 4.0,
        14 => 12.0,
        16 | 42 => 15.0,
        21 | 26 | 27 | 30 | 43 => 30.0,
        28 => 180.0,
        29 | 32 | 33 | 41 => 60.0,
        34 => 90.0,
        35 | 36 => 60.0,
        37 | 39 => 90.0,
        38 => 60.0,
        40 => 0.0,
        _ => panic!("unknown construction kind"),
    }
}

fn minimum(a: f64, b: f64) -> f64 { if a.is_nan() || b.is_nan() { f64::NAN } else { a.min(b) } }
fn maximum(a: f64, b: f64) -> f64 { if a.is_nan() || b.is_nan() { f64::NAN } else { a.max(b) } }

pub fn progress(start: f64, duration: f64, waiting: i32, paused: f64, now: f64) -> f64 {
    if waiting == 1 && paused.is_nan() { return 0.0; }
    let elapsed = if paused.is_nan() { now } else { paused } - start;
    if duration > 0.0 { maximum(0.0, minimum(1.0, elapsed / duration)) } else { 1.0 }
}

/// A new foundation needs positive health so it remains a live, attackable
/// entity before the first work interval. Every later point is earned by work.
pub fn health_fraction(maximum_hp: f64, progress: f64) -> f64 {
    if maximum_hp <= 0.0 { 0.0 } else { minimum(1.0, maximum(1.0 / maximum_hp, progress)) }
}

pub fn initial_hp(maximum_hp: f64) -> f64 { maximum(0.0, minimum(1.0, maximum_hp)) }

pub fn refund(paid: f64, start: f64, duration: f64, waiting: i32, paused: f64, now: f64) -> f64 {
    (maximum(0.0, paid) * (1.0 - progress(start, duration, waiting, paused, now)) * 100.0).round() / 100.0
}

pub fn repair_rate(maximum_hp: f64, kind: u32) -> f64 {
    // Faster founding leaves the established repair rate for towns and Keeps.
    let seconds = if kind == 5 { 90.0 } else { duration(kind) };
    maximum_hp / maximum(1.0, seconds)
}
pub fn repair(hp: f64, maximum_hp: f64, kind: u32, speed: f64, elapsed: f64) -> f64 {
    minimum(maximum_hp, hp + repair_rate(maximum_hp, kind) * speed * elapsed)
}

#[derive(Component, Clone, Copy)]
struct Site {
    id: i64,
    kind: u32,
    started: f64,
    duration: f64,
    waiting: i32,
    paused: f64,
    research_speed: f64,
    engineer: f64,
    builder: f64,
    cleared: i32,
    evacuating: i32,
    hp: f64,
    maximum_hp: f64,
    health_progress: f64,
    completed: bool,
}

#[derive(Component)]
struct WorkSample {
    speed: f64,
    forbidden: bool,
    engineer_flags: u32,
    clearance: bool,
    worker_flags: u32,
    worker_hp: f64,
    worker_site: f64,
    worker_x: f64,
    worker_y: f64,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    arriving_builder: f64,
    follows_clock: bool,
}

#[derive(Component, Default)]
struct Events(u32);
#[derive(Resource, Default)]
struct Command { now: f64, mode: u32, entities: Vec<Entity> }

fn advance_health(site: &mut Site, now: f64) {
    // Damage never moves the work clock or changes credited construction.
    // Dead sites must not be resurrected by time passing before cleanup.
    if site.hp <= 0.0 { return; }
    let earned = health_fraction(site.maximum_hp, progress(site.started, site.duration, site.waiting, site.paused, now));
    if earned > site.health_progress {
        let damage = maximum(0.0, site.maximum_hp * site.health_progress - site.hp);
        site.hp = site.maximum_hp * earned - damage;
        site.health_progress = earned;
    }
}

fn retime(site: &mut Site, now: f64, speed: f64) {
    let previous = if site.research_speed.is_nan() { 1.0 } else { site.research_speed };
    if speed == previous { return; }
    let queued = site.waiting == 1 && site.paused.is_nan();
    let clock = if site.paused.is_nan() { now } else { site.paused };
    let progress = if queued { 0.0 } else { maximum(0.0, minimum(1.0, (clock - site.started) / site.duration)) };
    site.duration *= previous / speed;
    if !queued { site.started = clock - progress * site.duration; }
    site.research_speed = speed;
}

fn pause(site: &mut Site, now: f64) {
    if site.waiting != 1 { site.paused = now; }
    site.waiting = 1; site.cleared = 0;
}

fn resume(site: &mut Site, now: f64) {
    if !site.paused.is_nan() { site.started += now - site.paused; site.paused = f64::NAN; }
    site.waiting = 0;
}

fn worker_present(site: &Site, work: &WorkSample) -> bool {
    work.worker_flags == 63 && work.worker_hp > 0.0 && work.worker_site == site.id as f64
}

fn worker_adjacent(work: &WorkSample) -> bool {
    let dx = maximum(maximum(work.x - work.worker_x, 0.0), work.worker_x - work.x - work.width);
    let dy = maximum(maximum(work.y - work.worker_y, 0.0), work.worker_y - work.y - work.height);
    dx.max(dy) <= 0.7
}

fn advance_sites(command: Res<Command>, mut sites: Query<(&mut Site, &WorkSample, &mut Events)>) {
    let mut clock = None;
    for entity in &command.entities {
        let (mut site, work, mut events) = sites.get_mut(*entity).expect("imported construction site");
        advance_health(&mut site, command.now);
        if work.follows_clock {
            let shared: Site = clock.expect("bridge construction head");
            // The deck keeps separate damage and occupancy, but the entire
            // bridge runs one work clock and receives one builder assignment.
            *site = Site { id: site.id, hp: site.hp, maximum_hp: site.maximum_hp,
                health_progress: site.health_progress, ..shared };
        } else {
            advance_site(&mut site, work, &mut events, &command);
            clock = Some(*site);
        }
    }
}

fn advance_site(site: &mut Site, work: &WorkSample, events: &mut Events, command: &Command) {
    if site.hp <= 0.0 { events.0 = SKIP; return; }
    match command.mode {
        // Before actor evacuation: refresh work rates and automatic crews.
        0 => {
            retime(site, command.now, work.speed);
            if work.forbidden {
                if site.waiting != 1 { events.0 |= INVALIDATE; }
                pause(site, command.now); events.0 |= SKIP;
                return;
            }
            if !site.engineer.is_nan() {
                if work.engineer_flags != 15 {
                    site.engineer = f64::NAN; site.waiting = 1; site.paused = command.now;
                } else { resume(site, command.now); }
            }
            if site.kind == 1 { resume(site, command.now); }
            if site.waiting != 1 { events.0 |= CLEARANCE; }
        }
        // Actor positions have now been updated by ordered clearance.
        1 => {
            if !work.clearance {
                if (site.kind == 1 || !site.engineer.is_nan()) && site.paused.is_nan() { site.paused = command.now; }
                events.0 |= SKIP; return;
            }
            if site.waiting == 0 && site.kind != 1 && site.engineer.is_nan() {
                let worker = worker_present(site, work);
                if !worker || !worker_adjacent(work) {
                    site.waiting = 1; site.paused = command.now; site.cleared = 0;
                    events.0 |= INVALIDATE;
                    if !worker { site.builder = f64::NAN; }
                }
            }
            if site.waiting != 1 && site.hp > 0.0 && command.now + 1e-7 >= site.started + site.duration {
                site.completed = true;
            }
        }
        // Research refreshes do not acquire workers, evacuate or complete.
        2 => retime(site, command.now, work.speed),
        3 => { pause(site, command.now); events.0 |= INVALIDATE; }
        // A real builder arrival starts new work or resumes banked work.
        4 => {
            if site.waiting == 1 {
                site.started = if site.paused.is_nan() { command.now } else { site.started + command.now - site.paused };
                site.paused = f64::NAN; site.waiting = 0; events.0 |= INVALIDATE;
            }
            site.builder = work.arriving_builder;
        }
        // One uninterrupted work order, with the same amount of work per tile.
        5 => site.duration *= command.entities.len() as f64,
        _ => panic!("unknown construction operation"),
    }
}

pub struct ConstructionEngine {
    world: World,
    schedule: Schedule,
    entities: BTreeMap<i64, Entity>,
    rows: Vec<Entity>,
    input: Vec<f64>,
    output: Vec<f64>,
}

impl Default for ConstructionEngine {
    fn default() -> Self {
        let mut world = World::new(); world.init_resource::<Command>();
        let mut schedule = Schedule::default();
        schedule.set_executor(SingleThreadedExecutor::new());
        schedule.add_systems(advance_sites);
        Self { world, schedule, entities: BTreeMap::new(), rows: Vec::new(), input: Vec::new(), output: Vec::new() }
    }
}

impl ConstructionEngine {
    pub fn prepare(&mut self, capacity: usize) -> *mut f64 {
        if self.input.len() < capacity * INPUT_STRIDE { self.input.resize(capacity * INPUT_STRIDE, 0.0); }
        if self.output.len() < capacity * OUTPUT_STRIDE { self.output.resize(capacity * OUTPUT_STRIDE, 0.0); }
        self.input.as_mut_ptr()
    }

    pub fn remove(&mut self, id: i64) {
        if let Some(entity) = self.entities.remove(&id) { self.world.despawn(entity); }
    }

    pub fn run(&mut self, count: usize, now: f64, mode: u32) -> *const f64 {
        assert!(count * INPUT_STRIDE <= self.input.len(), "construction batch exceeds capacity");
        self.rows.clear();
        for row in 0..count {
            let values = &self.input[row * INPUT_STRIDE..];
            let id = values[0] as i64;
            let entity = *self.entities.entry(id).or_insert_with(|| self.world.spawn_empty().id());
            self.rows.push(entity);
            self.world.entity_mut(entity).insert((
                Site { id, kind: values[1] as u32, started: values[2], duration: values[3], waiting: values[4] as i32,
                    paused: values[5], research_speed: values[6], engineer: values[7], builder: values[8], cleared: values[9] as i32,
                    hp: values[11], maximum_hp: values[28],
                    health_progress: if values[29].is_nan() { health_fraction(values[28], 0.0) } else { values[29] },
                    evacuating: values[25] as i32, completed: false },
                WorkSample { speed: values[12], forbidden: values[13] != 0.0, engineer_flags: values[14] as u32,
                    clearance: values[15] != 0.0, worker_flags: values[16] as u32, worker_hp: values[17], worker_site: values[18],
                    worker_x: values[19], worker_y: values[20], x: values[21], y: values[22], width: values[23], height: values[24],
                    arriving_builder: values[27], follows_clock: values[30] != 0.0 }, Events::default(),
            ));
        }
        {
            let mut command = self.world.resource_mut::<Command>();
            command.now = now; command.mode = mode; command.entities.clear(); command.entities.extend_from_slice(&self.rows);
        }
        self.schedule.run(&mut self.world);
        for (row, entity) in self.rows.iter().enumerate() {
            let site = self.world.get::<Site>(*entity).expect("construction result");
            let events = self.world.get::<Events>(*entity).expect("construction events");
            self.output[row * OUTPUT_STRIDE..(row + 1) * OUTPUT_STRIDE].copy_from_slice(&[
                site.started, site.duration, site.waiting as f64, site.paused, site.research_speed,
                site.engineer, site.builder, site.cleared as f64, site.evacuating as f64,
                (events.0 | if site.completed { COMPLETE } else { 0 }) as f64,
                site.hp, site.health_progress,
            ]);
        }
        self.output.as_ptr()
    }
}

#[derive(Default)]
pub struct Engines { next_handle: u32, engines: BTreeMap<u32, ConstructionEngine> }
impl Engines {
    pub fn create(&mut self) -> u32 {
        self.next_handle = self.next_handle.checked_add(1).expect("construction handle overflow");
        self.engines.insert(self.next_handle, ConstructionEngine::default()); self.next_handle
    }
    pub fn drop_engine(&mut self, handle: u32) { self.engines.remove(&handle); }
    pub fn get_mut(&mut self, handle: u32) -> &mut ConstructionEngine { self.engines.get_mut(&handle).expect("unknown construction engine") }
}

#[derive(Default)]
pub struct LineBuffer { output: Vec<f64> }
impl LineBuffer {
    /// Include corner work cells even when neither adjoining side is reachable.
    pub fn access(&mut self, x: f64, y: f64, width: i32, height: i32) -> *const f64 {
        self.output.clear(); self.output.push(0.0);
        for row in 0..height {
            self.output.extend_from_slice(&[x - 0.5, y + row as f64 + 0.5,
                x + width as f64 + 0.5, y + row as f64 + 0.5]);
        }
        for col in -1..=width {
            self.output.extend_from_slice(&[x + col as f64 + 0.5, y - 0.5,
                x + col as f64 + 0.5, y + height as f64 + 0.5]);
        }
        self.output[0] = ((self.output.len() - 1) / 2) as f64;
        self.output.as_ptr()
    }
    /// A cardinal-connected one-cell stroke with the original diagonal tie rule.
    /// Output: [point count, x0,y0,x1,y1,...]. Preview calls reuse this buffer.
    pub fn line(&mut self, from_x: f64, from_y: f64, to_x: f64, to_y: f64) -> *const f64 {
        self.output.clear(); self.output.push(0.0);
        if ![from_x, from_y, to_x, to_y].iter().all(|value| value.is_finite()) { return self.output.as_ptr(); }
        let mut x = from_x.floor(); let mut y = from_y.floor();
        let end_x = to_x.floor(); let end_y = to_y.floor();
        let dx = (end_x - x).abs(); let dy = (end_y - y).abs();
        let sx = (end_x - x).signum(); let sy = (end_y - y).signum();
        let mut moved_x = 0.0; let mut moved_y = 0.0;
        self.output.extend_from_slice(&[x, y]);
        while moved_x < dx || moved_y < dy {
            if moved_y == dy || (moved_x < dx && (moved_x + 0.5) * dy <= (moved_y + 0.5) * dx) {
                x += sx; moved_x += 1.0;
            } else { y += sy; moved_y += 1.0; }
            self.output.extend_from_slice(&[x, y]);
        }
        self.output[0] = ((self.output.len() - 1) / 2) as f64;
        self.output.as_ptr()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn row(id: f64) -> [f64; INPUT_STRIDE] {
        let mut row = [0.0; INPUT_STRIDE];
        row[0] = id; row[2] = 0.0; row[3] = 20.0; row[4] = 0.0;
        for index in [5, 6, 7, 8, 18, 26, 27] { row[index] = f64::NAN; }
        row[9] = 1.0; row[11] = 100.0; row[12] = 1.0; row[15] = 1.0;
        row[19] = 9.5; row[20] = 10.5; row[21] = 10.0; row[22] = 10.0; row[23] = 1.0; row[24] = 1.0; row[25] = -1.0;
        row[28] = 100.0; row[29] = health_fraction(row[28], 0.0);
        row
    }
    fn run(engine: &mut ConstructionEngine, input: [f64; INPUT_STRIDE], now: f64, mode: u32) -> Vec<f64> {
        engine.prepare(1); engine.input[..INPUT_STRIDE].copy_from_slice(&input); engine.run(1, now, mode);
        engine.output[..OUTPUT_STRIDE].to_vec()
    }
    fn publish(input: &mut [f64; INPUT_STRIDE], output: &[f64]) {
        for (target, source) in [(2,0),(3,1),(4,2),(5,3),(6,4),(7,5),(8,6),(9,7),(25,8),(11,10),(29,11)] { input[target] = output[source]; }
    }

    #[test]
    fn construction_earns_proportional_health_and_retains_damage_on_completion() {
        let mut engine = ConstructionEngine::default(); let mut input = row(1.0);
        input[1] = 1.0; input[11] = initial_hp(input[28]);
        assert_eq!(input[11], 1.0);
        let half = run(&mut engine, input, 10.0, 0);
        assert_eq!(half[10], 50.0); publish(&mut input, &half);
        input[11] -= 20.0;
        let wounded = run(&mut engine, input, 10.0, 1);
        assert_eq!(wounded[10], 30.0); assert_eq!(wounded[0], 0.0); assert_eq!(wounded[1], 20.0);
        publish(&mut input, &wounded);
        let done = run(&mut engine, input, 20.0, 1);
        assert_eq!(done[10], 80.0); assert_eq!(done[9] as u32, COMPLETE);
    }

    #[test]
    fn construction_health_pauses_with_work_and_never_revives_a_destroyed_site() {
        let mut engine = ConstructionEngine::default(); let mut input = row(2.0);
        input[11] = initial_hp(input[28]);
        let paused = run(&mut engine, input, 5.0, 3);
        assert_eq!(paused[10], 25.0); publish(&mut input, &paused);
        input[11] -= 10.0;
        let waiting = run(&mut engine, input, 40.0, 2);
        assert_eq!(waiting[10], 15.0); publish(&mut input, &waiting);
        input[11] = 0.0;
        let destroyed = run(&mut engine, input, 100.0, 4);
        assert_eq!(destroyed[10], 0.0); assert_eq!(destroyed[9] as u32, SKIP);
    }

    #[test]
    fn research_changes_remaining_work_without_advancing_queued_or_paused_sites() {
        let mut engine = ConstructionEngine::default();
        let mut input = row(1.0); input[3] = duration(7); input[4] = -1.0; input[12] = 1.25;
        let output = run(&mut engine, input, 10.0, 2);
        assert!((output[0] - 2.0).abs() < 1e-12); assert!((output[1] - (40.0 / 3.0) / 1.25).abs() < 1e-12);
        publish(&mut input, &output);
        for (actual, expected) in run(&mut engine, input, 10.0, 2).iter().zip(&output) {
            assert!(actual == expected || actual.is_nan() && expected.is_nan());
        }
        input = row(2.0); input[2] = 4.0; input[4] = 1.0; input[12] = 1.25;
        let queued = run(&mut engine, input, 12.0, 2); assert_eq!(queued[0], 4.0); assert_eq!(queued[1], 16.0);
        input[2] = 0.0; input[5] = 5.0;
        let paused = run(&mut engine, input, 12.0, 2); assert_eq!(paused[0], 1.0); assert_eq!(paused[3], 5.0);
    }

    #[test]
    fn blocked_automatic_sites_pause_and_resume_without_banked_blocked_time() {
        let mut engine = ConstructionEngine::default(); let mut input = row(-1.0); input[1] = 1.0;
        let prepared = run(&mut engine, input, 10.0, 0); assert_eq!(prepared[9] as u32, CLEARANCE);
        publish(&mut input, &prepared); input[15] = 0.0;
        let blocked = run(&mut engine, input, 10.0, 1); assert_eq!(blocked[3], 10.0); assert_eq!(blocked[9] as u32, SKIP);
        publish(&mut input, &blocked); input[15] = 1.0;
        let resumed = run(&mut engine, input, 30.0, 0); assert_eq!(resumed[0], 20.0); assert!(resumed[3].is_nan());
        publish(&mut input, &resumed); assert_eq!(run(&mut engine, input, 30.0, 1)[9] as u32, 0);
        assert_eq!(run(&mut engine, input, 40.0, 1)[9] as u32, COMPLETE);
    }

    #[test]
    fn real_worker_ownership_presence_and_adjacency_control_progress() {
        let mut engine = ConstructionEngine::default(); let mut input = row(9_007_199_254_740_991.0);
        input[8] = 7.0; input[16] = 63.0; input[17] = 50.0; input[18] = input[0];
        assert_eq!(run(&mut engine, input, 20.0, 1)[9] as u32, COMPLETE);
        input[19] = 8.5;
        let distant = run(&mut engine, input, 20.0, 1); assert_eq!(distant[2], 1.0); assert_eq!(distant[6], 7.0);
        input[18] = 0.0;
        let reassigned = run(&mut engine, input, 20.0, 1); assert!(reassigned[6].is_nan()); assert_eq!(reassigned[9] as u32, INVALIDATE);
    }

    #[test]
    fn forbidden_work_and_lost_engineers_preserve_pause_rules() {
        let mut engine = ConstructionEngine::default(); let mut input = row(10.0); input[13] = 1.0;
        let forbidden = run(&mut engine, input, 5.0, 0);
        assert_eq!(forbidden[2], 1.0); assert_eq!(forbidden[3], 5.0); assert_eq!(forbidden[7], 0.0);
        assert_eq!(forbidden[9] as u32, INVALIDATE | SKIP);
        publish(&mut input, &forbidden);
        let still_forbidden = run(&mut engine, input, 15.0, 0); assert_eq!(still_forbidden[3], 5.0); assert_eq!(still_forbidden[9] as u32, SKIP);
        input = row(11.0); input[7] = 50.0; input[14] = 7.0;
        let dead_engineer = run(&mut engine, input, 8.0, 0);
        assert!(dead_engineer[5].is_nan()); assert_eq!(dead_engineer[2], 1.0); assert_eq!(dead_engineer[3], 8.0);
    }

    #[test]
    fn builder_arrival_resumes_paused_work_without_resetting_earned_progress() {
        let mut engine = ConstructionEngine::default(); let mut input = row(12.0);
        input[2] = 2.0; input[4] = 1.0; input[5] = 7.0; input[27] = -100.0;
        let resumed = run(&mut engine, input, 30.0, 4);
        assert_eq!(resumed[0], 25.0); assert_eq!(resumed[2], 0.0); assert!(resumed[3].is_nan());
        assert_eq!(resumed[6], -100.0); assert_eq!(resumed[9] as u32, INVALIDATE);
        input[5] = f64::NAN; assert_eq!(run(&mut engine, input, 30.0, 4)[0], 30.0);
    }

    #[test]
    fn refunds_only_unfinished_paid_work_and_clamps_invalid_progress() {
        assert_eq!(refund(42.25, 10.0, duration(7), 0, f64::NAN, 15.0), 26.41);
        assert_eq!(refund(42.25, 10.0, duration(7), 1, 17.0, 100.0), 20.07);
        assert_eq!(refund(9.75, 10.0, duration(6), 1, f64::NAN, 100.0), 9.75);
        assert_eq!(refund(42.25, 10.0, duration(7), 0, f64::NAN, 5.0), 42.25);
        assert_eq!(refund(-20.0, 0.0, 10.0, 0, f64::NAN, 5.0), 0.0);
    }

    #[test]
    fn repair_integrates_real_work_and_caps_health() {
        assert_eq!(repair_rate(6500.0, 5), 6500.0 / 90.0);
        assert_eq!(repair(80.0, 100.0, 18, 1.25, 1.0), 86.25);
        assert_eq!(repair(99.0, 100.0, 18, 1.25, 1.0), 100.0);
    }

    #[test]
    fn site_entities_survive_other_commands_and_are_removed_on_completion_effects() {
        let mut engine = ConstructionEngine::default();
        run(&mut engine, row(1.0), 1.0, 2); let entity = engine.entities[&1];
        run(&mut engine, row(2.0), 1.0, 2); run(&mut engine, row(1.0), 2.0, 2);
        assert_eq!(engine.entities[&1], entity); assert_eq!(engine.entities.len(), 2);
        engine.remove(1); assert_eq!(engine.entities.len(), 1); assert!(engine.world.get::<Site>(entity).is_none());
    }

    #[test]
    fn strokes_keep_endpoints_and_cardinal_ties_without_reallocating_a_smaller_preview() {
        let mut buffer = LineBuffer::default();
        buffer.line(2.5, 4.5, 6.8, 4.2);
        assert_eq!(&buffer.output, &[5.0,2.0,4.0,3.0,4.0,4.0,4.0,5.0,4.0,6.0,4.0]);
        let capacity = buffer.output.capacity();
        buffer.line(4.3, 7.8, 4.9, 7.1); assert_eq!(&buffer.output, &[1.0,4.0,7.0]);
        assert_eq!(buffer.output.capacity(), capacity);
    }
}
