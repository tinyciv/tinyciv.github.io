//! Hidden-marauder update clocks. Only real simulation steps advance the
//! frame counter. Marauders nobody can see run their sensing and planning on
//! one frame in five (phased by ID, without consuming randomness) and then
//! integrate the time that accumulated meanwhile once. The host supplies
//! visibility; phases, pending time and the frame counter live here.
use bevy_ecs::prelude::*;
use rustc_hash::FxHashMap;
use std::collections::BTreeSet;

const OPENING_SECONDS: f64 = 300.0;
const OPENING_RATE: f64 = 0.8;

pub fn population_cap(intensity: f64, now: f64, base: f64) -> f64 {
    let rate = if intensity >= 1.0 && now < OPENING_SECONDS { OPENING_RATE } else { 1.0 };
    (base * intensity * rate).floor()
}

pub fn spawn_delay(intensity: f64, now: f64, seconds: f64) -> f64 {
    let delay = seconds / intensity;
    if intensity < 1.0 || now >= OPENING_SECONDS { return delay; }
    let opening = OPENING_SECONDS - now;
    let slowed = delay / OPENING_RATE;
    slowed.min(opening) + (delay - opening * OPENING_RATE).max(0.0)
}

pub fn retime_spawn(previous: f64, next: f64, origin: f64, now: f64, deadline: f64) -> f64 {
    let remaining = (deadline - origin).max(0.0);
    let opening = if previous >= 1.0 { remaining.min((OPENING_SECONDS - origin).max(0.0)) } else { 0.0 };
    let work = (remaining - opening * (1.0 - OPENING_RATE)) * previous;
    now + spawn_delay(next, now, work)
}

/// Camp-specific retaliation is authoritative and survives a paused save.
#[derive(Resource, Default)]
pub struct RaiderAggression { provoked: BTreeSet<(i64, i32)> }
impl RaiderAggression {
    pub fn provoke(&mut self, camp: i64, faction: i32) {
        if camp >= 0 && faction >= 0 { self.provoked.insert((camp, faction)); }
    }
    pub fn may_attack(&self, intensity: f64, camp: i64, faction: i32) -> bool {
        intensity > 0.0 && (intensity >= 1.0 || self.provoked.contains(&(camp, faction)))
    }
    pub fn snapshot(&self) -> Vec<f64> {
        self.provoked.iter().flat_map(|&(camp, faction)| [camp as f64, faction as f64]).collect()
    }
    pub fn restore(data: &[f64]) -> Option<Self> {
        if data.len() % 2 != 0 || data.iter().any(|v| !v.is_finite() || *v < 0.0 || v.fract() != 0.0) { return None; }
        Some(Self { provoked: data.chunks_exact(2).map(|row| (row[0] as i64, row[1] as i32)).collect() })
    }
}

pub const HIDDEN_UPDATE_DIVISOR: i64 = 5;
/// `charge` results.
pub const NOT_DUE: u32 = 0;
pub const PHASE_DUE: u32 = 1;
/// No simulation step has begun a marauder frame for this game yet.
pub const NO_SCHEDULE: u32 = 2;

pub const UNIT_CLOCK: u32 = 0;
pub const FORMATION_CLOCK: u32 = 1;

#[derive(Clone, Copy)]
struct Clock { pending: f64, frame: u64 }

/// ID phase on the five-frame cycle (negative IDs wrap like the host's
/// double remainder).
pub fn phase_due(frame: u64, id: i64) -> bool {
    (frame % HIDDEN_UPDATE_DIVISOR as u64) as i64 == id.rem_euclid(HIDDEN_UPDATE_DIVISOR)
}
/// Formations mix their sequential leader IDs so equal-sized spawned packs do
/// not all share a phase: Math.imul(id ^ (id >>> 16), 0x9e3779b1) >>> 0.
pub fn formation_phase(leader: i64) -> i64 {
    let id = leader as i32 as u32;
    (id ^ (id >> 16)).wrapping_mul(0x9e37_79b1) as i64
}

#[derive(Resource, Default)]
pub struct MarauderSchedule {
    started: bool,
    frame: u64,
    time: f64,
    clocks: [FxHashMap<i64, Clock>; 2],
}
impl MarauderSchedule {
    /// Start of a simulation step. A clock rewind (or a fresh game) restarts
    /// the schedule.
    pub fn begin(&mut self, time: f64) {
        if !self.started || time < self.time { *self = Self { started: true, time, ..Self::default() }; }
        self.frame += 1;
        self.time = time;
    }
    /// Adds this step's time to a unit or formation clock and reports whether
    /// its phase is due. Time spent inactive (a skipped frame, e.g. inside a
    /// camp) is not charged to a newly released unit.
    pub fn charge(&mut self, kind: u32, id: i64, dt: f64) -> u32 {
        if !self.started { return NO_SCHEDULE; }
        let frame = self.frame;
        let clock = self.clocks[kind as usize & 1].entry(id).or_insert(Clock { pending: 0.0, frame: frame.wrapping_sub(1) });
        if clock.frame != frame.wrapping_sub(1) { clock.pending = 0.0; }
        clock.pending += dt;
        clock.frame = frame;
        let phase = if kind == FORMATION_CLOCK { formation_phase(id) } else { id };
        if phase_due(frame, phase) { PHASE_DUE } else { NOT_DUE }
    }
    /// The accumulated time, consumed once.
    pub fn take(&mut self, kind: u32, id: i64) -> f64 {
        self.clocks[kind as usize & 1].get_mut(&id).map_or(0.0, |clock| std::mem::take(&mut clock.pending))
    }
    /// Shared pack objectives use the pack ID phase.
    pub fn pack_due(&self, pack: i64) -> bool { phase_due(self.frame, pack) }
    pub fn forget(&mut self, id: i64) { for clocks in &mut self.clocks { clocks.remove(&id); } }
    /// A new host store imported the state: its units start with fresh clocks.
    pub fn clear_clocks(&mut self) { for clocks in &mut self.clocks { clocks.clear(); } }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hidden_units_run_one_frame_in_five_and_integrate_the_accumulated_time_once() {
        let mut schedule = MarauderSchedule::default();
        assert_eq!(schedule.charge(UNIT_CLOCK, 7, 0.1), NO_SCHEDULE);
        let mut elapsed = Vec::new();
        for step in 1..=10 {
            schedule.begin(step as f64 * 0.1);
            if schedule.charge(UNIT_CLOCK, 7, 0.1) == PHASE_DUE { elapsed.push(schedule.take(UNIT_CLOCK, 7)); }
        }
        // Frames 2 and 7 match 7 % 5.
        assert_eq!(elapsed.len(), 2);
        assert!((elapsed[0] - 0.2).abs() < 1e-12 && (elapsed[1] - 0.5).abs() < 1e-12, "{elapsed:?}");
        // Frames 8-10 are still pending; taking them consumes the credit once.
        assert!((schedule.take(UNIT_CLOCK, 7) - 0.3).abs() < 1e-12);
        assert_eq!(schedule.take(UNIT_CLOCK, 7), 0.0);
    }

    #[test]
    fn inactive_frames_are_not_charged_and_a_rewind_restarts_the_schedule() {
        let mut schedule = MarauderSchedule::default();
        schedule.begin(0.1); schedule.charge(UNIT_CLOCK, 3, 0.1);
        schedule.begin(0.2); schedule.begin(0.3);
        // The unit skipped frame 2: its earlier pending time is dropped.
        schedule.charge(UNIT_CLOCK, 3, 0.1);
        assert!((schedule.take(UNIT_CLOCK, 3) - 0.1).abs() < 1e-12);
        schedule.charge(FORMATION_CLOCK, 3, 0.25);
        assert_eq!(schedule.take(UNIT_CLOCK, 3), 0.0, "unit and formation clocks are independent");
        assert!((schedule.take(FORMATION_CLOCK, 3) - 0.25).abs() < 1e-12);
        schedule.begin(0.05);
        assert_eq!(schedule.take(FORMATION_CLOCK, 3), 0.0);
        assert!(schedule.pack_due(1) && !schedule.pack_due(2), "frame 1 after the restart");
    }

    #[test]
    fn phases_match_the_host_arithmetic() {
        assert!(phase_due(4, -1) && phase_due(0, -5) && phase_due(3, 13) && !phase_due(3, 12));
        // Math.imul(70000 ^ (70000 >>> 16), 0x9e3779b1) >>> 0
        let id: u32 = 70000;
        assert_eq!(formation_phase(70000), (id ^ (id >> 16)).wrapping_mul(0x9e37_79b1) as i64);
        assert!(formation_phase(-3) >= 0);
        schedule_forgets();
    }
    fn schedule_forgets() {
        let mut schedule = MarauderSchedule::default();
        schedule.begin(1.0); schedule.charge(UNIT_CLOCK, 9, 0.4); schedule.forget(9);
        assert_eq!(schedule.take(UNIT_CLOCK, 9), 0.0);
    }
}
