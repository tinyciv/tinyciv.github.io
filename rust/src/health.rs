//! Batched health systems. Eligibility and nearby healer discovery enter as
//! sampled inputs; the ECS owns damage clocks, healing integration and caps.
use bevy_ecs::prelude::*;
use bevy_ecs::schedule::SingleThreadedExecutor;
use std::collections::{BTreeMap, BTreeSet};

pub const INPUT_STRIDE: usize = 7;
pub const OUTPUT_STRIDE: usize = 3;
const REGEN_DELAY: f64 = 15.0;
const REGEN_PER_SECOND: f64 = 2.4;

pub fn constant(index: u32) -> f64 {
    match index { 0 => REGEN_DELAY, 1 => REGEN_PER_SECOND, _ => panic!("unknown health constant") }
}

#[derive(Component)]
struct Health { hp: f64, maximum: f64, damaged_at: f64, combat_at: f64, missing_damage_clock: bool }
#[derive(Component)]
struct Regeneration { eligible: bool, marauder_leader: bool, discretion: bool, multiplier: f64, status: u32 }
#[derive(Component)]
struct BatchRow(usize);
#[derive(Resource, Default)]
struct Step { now: f64, dt: f64, mode: u32 }

fn initialize_damage_times(step: Res<Step>, mut units: Query<(&mut Health, &mut Regeneration)>) {
    if step.mode != 0 { return; }
    for (mut health, mut regeneration) in &mut units {
        if !health.damaged_at.is_finite() {
            health.damaged_at = if health.combat_at.is_finite() { step.now.min(health.combat_at) } else { step.now };
            health.missing_damage_clock = false;
            regeneration.status |= 1;
        }
    }
}

// Match JavaScript Math.min/Math.max, which propagate NaN rather than select
// the other operand. Normal gameplay inputs are finite; fixtures can be partial.
fn minimum(a: f64, b: f64) -> f64 { if a.is_nan() || b.is_nan() { f64::NAN } else { a.min(b) } }
fn maximum(a: f64, b: f64) -> f64 { if a.is_nan() || b.is_nan() { f64::NAN } else { a.max(b) } }

fn regenerate_health(step: Res<Step>, mut units: Query<(&mut Health, &mut Regeneration)>) {
    if step.mode != 1 { return; }
    for (mut health, mut regeneration) in &mut units {
        if health.hp <= 0.0 || health.hp >= health.maximum {
            regeneration.status |= 2;
            continue;
        }
        if !regeneration.eligible { continue; }
        let mut quiet_since = if health.missing_damage_clock { step.now } else { health.damaged_at };
        if regeneration.marauder_leader { quiet_since = maximum(quiet_since, health.combat_at); }
        let delay = if regeneration.discretion { 0.0 } else { REGEN_DELAY };
        let healing_time = minimum(step.dt, maximum(0.0, step.now - quiet_since - delay));
        if healing_time > 0.0 {
            regeneration.status |= 8;
            health.hp = minimum(health.maximum, health.hp + healing_time * REGEN_PER_SECOND * regeneration.multiplier);
            if regeneration.multiplier > 1.0 { regeneration.status |= 4; }
            if health.hp >= health.maximum { regeneration.status |= 2; }
        }
    }
}

pub struct HealthEngine {
    world: World,
    schedule: Schedule,
    entities: BTreeMap<i64, Entity>,
    roster: Vec<i64>,
    rows: Vec<Entity>,
    input: Vec<f64>,
    output: Vec<f64>,
    output_query: QueryState<(&'static Health, &'static Regeneration, &'static BatchRow)>,
}

impl Default for HealthEngine {
    fn default() -> Self {
        let mut world = World::new();
        world.insert_resource(Step::default());
        let mut schedule = Schedule::default();
        schedule.set_executor(SingleThreadedExecutor::new());
        schedule.add_systems((initialize_damage_times, regenerate_health).chain());
        let output_query = world.query::<(&Health, &Regeneration, &BatchRow)>();
        Self { world, schedule, entities: BTreeMap::new(), roster: Vec::new(), rows: Vec::new(), input: Vec::new(), output: Vec::new(), output_query }
    }
}

impl HealthEngine {
    /// Grow the resident buffers only when the host's batch capacity increases.
    /// Input rows: [id, hp, maxHp, lastDamagedAt, lastCombat, flags, multiplier].
    /// Flags: 1=eligible, 2=marauder leader, 4=fleeing Discretion, 8=missing clock,
    /// 16=warship (hull repairs belong to the native naval system).
    pub fn prepare(&mut self, capacity: usize) -> *mut f64 {
        if self.input.len() < capacity * INPUT_STRIDE {
            self.input.resize(capacity * INPUT_STRIDE, 0.0);
            self.output.resize(capacity * OUTPUT_STRIDE, 0.0);
        }
        self.input.as_mut_ptr()
    }

    /// Output rows: [hp, lastDamagedAt, status]. Status bits: 1=clock initialized,
    /// 2=refresh wounded role (dead/full), 4=healer effect active, 8=HP integrated.
    /// Mode 0 runs before attacks; mode 1 runs after every impact on this step.
    pub fn run(&mut self, count: usize, now: f64, dt: f64, mode: u32) -> *const f64 {
        assert!(count * INPUT_STRIDE <= self.input.len(), "health batch exceeds capacity");
        let changed = self.roster.len() != count || self.roster.iter().enumerate()
            .any(|(row, &id)| self.input[row * INPUT_STRIDE] as i64 != id);
        if changed {
            let ids: BTreeSet<i64> = (0..count).map(|row| self.input[row * INPUT_STRIDE] as i64).collect();
            assert_eq!(ids.len(), count, "duplicate health entity ID");
            let world = &mut self.world;
            self.entities.retain(|id, entity| {
                if ids.contains(id) { true } else { world.despawn(*entity); false }
            });
            self.roster.clear(); self.rows.clear();
            for row in 0..count {
                let id = self.input[row * INPUT_STRIDE] as i64;
                let entity = *self.entities.entry(id).or_insert_with(|| world.spawn_empty().id());
                self.roster.push(id); self.rows.push(entity);
            }
        }
        for row in 0..count {
            let index = row * INPUT_STRIDE;
            let flags = self.input[index + 5] as u32;
            self.world.entity_mut(self.rows[row]).insert((
                Health { hp: self.input[index + 1], maximum: self.input[index + 2], damaged_at: self.input[index + 3],
                    combat_at: self.input[index + 4], missing_damage_clock: flags & 8 != 0 },
                Regeneration { eligible: flags & 1 != 0 && flags & 16 == 0, marauder_leader: flags & 2 != 0,
                    discretion: flags & 4 != 0, multiplier: self.input[index + 6], status: 0 },
                BatchRow(row),
            ));
        }
        *self.world.resource_mut::<Step>() = Step { now, dt, mode };
        self.schedule.run(&mut self.world);
        for (health, regeneration, row) in self.output_query.iter(&self.world) {
            let index = row.0 * OUTPUT_STRIDE;
            self.output[index] = health.hp; self.output[index + 1] = health.damaged_at;
            self.output[index + 2] = regeneration.status as f64;
        }
        self.output.as_ptr()
    }
}

#[derive(Default)]
pub struct Engines { next_handle: u32, engines: BTreeMap<u32, HealthEngine> }
impl Engines {
    pub fn create(&mut self) -> u32 {
        self.next_handle = self.next_handle.checked_add(1).expect("health handle overflow");
        self.engines.insert(self.next_handle, HealthEngine::default());
        self.next_handle
    }
    pub fn drop_engine(&mut self, handle: u32) { self.engines.remove(&handle); }
    pub fn get_mut(&mut self, handle: u32) -> &mut HealthEngine { self.engines.get_mut(&handle).expect("unknown health engine") }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn batch(engine: &mut HealthEngine, rows: &[[f64; INPUT_STRIDE]], now: f64, dt: f64, mode: u32) -> Vec<[f64; OUTPUT_STRIDE]> {
        engine.prepare(rows.len());
        for (row, values) in rows.iter().enumerate() {
            engine.input[row * INPUT_STRIDE..(row + 1) * INPUT_STRIDE].copy_from_slice(values);
        }
        engine.run(rows.len(), now, dt, mode);
        engine.output[..rows.len() * OUTPUT_STRIDE].chunks_exact(OUTPUT_STRIDE)
            .map(|values| [values[0], values[1], values[2]]).collect()
    }

    #[test]
    fn initializes_damage_clocks_before_attacks_without_changing_health() {
        let mut engine = HealthEngine::default();
        let output = batch(&mut engine, &[
            [1.0, 40.0, 100.0, f64::NAN, -7.0, 8.0, 1.0],
            [2.0, 50.0, 100.0, f64::NAN, 50.0, 8.0, 1.0],
            [3.0, 60.0, 100.0, f64::INFINITY, f64::NAN, 0.0, 1.0],
            [4.0, 70.0, 100.0, 3.0, 0.0, 0.0, 1.0],
        ], 10.0, 1.0, 0);
        assert_eq!(output, vec![[40.0, -7.0, 1.0], [50.0, 10.0, 1.0], [60.0, 10.0, 1.0], [70.0, 3.0, 0.0]]);
    }

    #[test]
    fn integrates_only_the_post_delay_fraction_and_never_resurrects_dead_units() {
        let mut engine = HealthEngine::default();
        let output = batch(&mut engine, &[
            [1.0, 50.0, 100.0, 0.0, 0.0, 1.0, 1.0],
            [2.0, 0.0, 100.0, 0.0, 0.0, 1.0, 2.0],
            [3.0, 50.0, 100.0, 0.0, 0.0, 0.0, 2.0],
            [4.0, 120.0, 100.0, 0.0, 0.0, 1.0, 1.0],
        ], 15.25, 0.5, 1);
        assert!((output[0][0] - 50.6).abs() < 1e-9);
        assert_eq!(output[1], [0.0, 0.0, 2.0]);
        assert_eq!(output[2], [50.0, 0.0, 0.0]);
        assert_eq!(output[3], [120.0, 0.0, 2.0]);
    }

    #[test]
    fn discretion_heals_while_fleeing_but_marauder_leaders_must_also_leave_combat() {
        let mut engine = HealthEngine::default();
        let output = batch(&mut engine, &[
            [1.0, 50.0, 100.0, 19.9, 20.0, 5.0, 1.0],
            [2.0, 50.0, 100.0, 0.0, 9.0, 3.0, 1.0],
        ], 20.0, 0.5, 1);
        assert!((output[0][0] - 50.24).abs() < 1e-9);
        assert_eq!(output[1][0], 50.0);
        let later = batch(&mut engine, &[[2.0, 50.0, 100.0, 0.0, 9.0, 3.0, 1.0]], 24.25, 0.5, 1);
        assert!((later[0][0] - 50.6).abs() < 1e-9);
    }

    #[test]
    fn healer_bonus_caps_health_and_reports_presentation_and_role_changes() {
        let mut engine = HealthEngine::default();
        let output = batch(&mut engine, &[[1.0, 99.9, 100.0, 0.0, 0.0, 1.0, 2.0]], 16.0, 0.5, 1);
        assert_eq!(output[0], [100.0, 0.0, 14.0]);
        let same_step_hit = batch(&mut engine, &[[1.0, 40.0, 100.0, 16.0, 0.0, 1.0, 2.0]], 16.0, 0.5, 1);
        assert_eq!(same_step_hit[0], [40.0, 16.0, 0.0]);
    }

    #[test]
    fn stable_rosters_keep_entities_and_reordered_batches_keep_output_order() {
        let mut engine = HealthEngine::default();
        batch(&mut engine, &[[9.0, 50.0, 100.0, 0.0, 0.0, 1.0, 1.0], [2.0, 25.0, 100.0, 0.0, 0.0, 1.0, 1.0]], 16.0, 0.1, 1);
        let original = engine.entities[&9];
        let output = batch(&mut engine, &[[2.0, 30.0, 100.0, 0.0, 0.0, 1.0, 1.0], [9.0, 40.0, 100.0, 0.0, 0.0, 1.0, 1.0]], 17.0, 0.1, 1);
        assert_eq!(engine.entities[&9], original);
        assert!((output[0][0] - 30.24).abs() < 1e-9);
        assert!((output[1][0] - 40.24).abs() < 1e-9);
        batch(&mut engine, &[[9.0, 40.0, 100.0, 0.0, 0.0, 1.0, 1.0]], 18.0, 0.1, 1);
        assert_eq!(engine.entities.len(), 1);
        batch(&mut engine, &[], 19.0, 0.1, 1);
        assert!(engine.entities.is_empty());
    }
}
