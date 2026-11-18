//! Recurring maintenance scheduler: resident clocks per work key, the FIFO
//! interactive budget and the immediate/deferred publication scopes.
//!
//! Work keys are interned process-wide (`WorkKeys`); the game's clocks live
//! in its `WorkScheduler` resource. Observation deadlines and elapsed-time
//! credit are the `cadence` rules; this module owns their state, admission
//! order and scope bookkeeping. Nothing here is saved: a load, a replaced
//! world or a clock rewind starts a fresh schedule.
use bevy_ecs::prelude::*;
use rustc_hash::FxHashMap;
use std::collections::VecDeque;

use crate::cadence;

/// Broad reconciliation passes that tolerate a half-second observation delay.
const BACKGROUND_INTERVAL: f64 = 0.5;

/// Known keys in stable ID order: (name, background cadence, budgeted).
/// Budgeted passes are the measured expensive ones; the interactive host
/// admits one of them per substep.
const KNOWN_KEYS: [(&str, bool, bool); 30] = [
    ("health-initialization", false, false),
    ("retinue-membership", false, false),
    ("tree-stumps", false, false),
    ("retinue-recruitment", false, false),
    ("construction-completion", false, false),
    ("sailboat-launches", false, false),
    ("wall-ownership", true, false),
    ("wall-stats", false, false),
    ("settlements", false, false),
    ("research", false, false),
    ("faction-defenses", false, false),
    ("resource-workers", false, false),
    ("forts", false, false),
    ("supply-depots", false, false),
    ("mass-levy", false, false),
    ("archery-training", false, false),
    ("harvests", false, true),
    ("wildlife", false, false),
    ("courier-wakeups", false, false),
    ("fog-raids", true, true),
    ("marauder-packs", false, false),
    ("guard-posts", false, false),
    ("faction-strategies", true, false),
    ("treasure-discovery", false, false),
    ("traffic-maintenance", false, false),
    ("dead-entities", true, false),
    ("defense-rebuilds", false, false),
    ("game-over", false, false),
    ("builders:staff", true, false),
    ("collectors:staff", true, true),
];
const FARMS_SYNC: (&str, bool, bool) = ("farms:sync", true, true);

#[derive(Clone, Debug)]
pub struct KeyInfo { pub name: String, pub phase: f64, pub interval: f64, pub budgeted: bool }

/// The FNV-1a phase the host derived from the key string (UTF-16 code units),
/// so independent tasks keep their original spread across frames.
pub fn phase_of(name: &str) -> f64 {
    let mut hash: u32 = 2_166_136_261;
    for unit in name.encode_utf16() { hash = (hash ^ unit as u32).wrapping_mul(16_777_619); }
    hash as f64 / 4_294_967_296.0
}

/// Process-wide key table. Unknown names (tools, fixtures) receive the next
/// ID with the ordinary 3 Hz, unbudgeted policy.
pub struct WorkKeys { keys: Vec<KeyInfo>, by_name: FxHashMap<String, u16>, input: Vec<f64> }
impl Default for WorkKeys {
    fn default() -> Self {
        let mut keys = Self { keys: Vec::new(), by_name: FxHashMap::default(), input: Vec::new() };
        for (name, background, budgeted) in KNOWN_KEYS.iter().chain(std::iter::once(&FARMS_SYNC)) {
            keys.register(name, if *background { BACKGROUND_INTERVAL } else { cadence::CHECK_INTERVAL }, *budgeted);
        }
        keys
    }
}
impl WorkKeys {
    fn register(&mut self, name: &str, interval: f64, budgeted: bool) -> u16 {
        let id = u16::try_from(self.keys.len()).expect("work key overflow");
        self.keys.push(KeyInfo { name: name.to_owned(), phase: phase_of(name), interval, budgeted });
        self.by_name.insert(name.to_owned(), id);
        id
    }
    pub fn intern(&mut self, name: &str) -> u16 {
        if let Some(id) = self.by_name.get(name) { return *id; }
        self.register(name, if name=="drainage" || name=="civic-buildings" { 1.0 } else { cadence::CHECK_INTERVAL }, false)
    }
    pub fn get(&self, id: u16) -> &KeyInfo { self.keys.get(id as usize).expect("unknown work key") }
    /// Host transport for a key name: UTF-16 code units as f64.
    pub fn input(&mut self, len: usize) -> *mut f64 { self.input.clear(); self.input.resize(len, 0.0); self.input.as_mut_ptr() }
    pub fn commit(&mut self, len: usize) -> u16 {
        let units: Vec<u16> = self.input[..len.min(self.input.len())].iter().map(|unit| *unit as u16).collect();
        let name = String::from_utf16_lossy(&units);
        self.intern(&name)
    }
}

#[derive(Clone, Copy, Debug)]
struct WorkClock { next_at: f64, observed_at: f64, elapsed: f64, initial: bool }

pub const SCOPE_BUDGET: u32 = 0;
pub const SCOPE_IMMEDIATE: u32 = 1;
pub const SCOPE_DEFERRED: u32 = 2;

#[derive(Resource, Default)]
pub struct WorkScheduler {
    /// Game time of the last observation; a rewind restarts the schedule.
    observed_at: Option<f64>,
    clocks: FxHashMap<u16, WorkClock>,
    /// Overdue budgeted work in first-requested order.
    pending: VecDeque<u16>,
    /// Admissions left in the active interactive budget scope.
    budget: Option<u32>,
    /// Keys already published inside the active immediate scope.
    immediate: Option<Vec<u16>>,
    deferred: bool,
}
impl WorkScheduler {
    /// A new store/world import: forget every clock and queued admission.
    pub fn reset(&mut self) { self.observed_at = None; self.clocks.clear(); self.pending.clear(); }

    /// Opens a scope; false when it was already open (the caller then must not close it).
    pub fn enter(&mut self, scope: u32) -> bool {
        match scope {
            SCOPE_BUDGET => { if self.budget.is_some() { return false; } self.budget = Some(1); }
            SCOPE_IMMEDIATE => { if self.immediate.is_some() { return false; } self.immediate = Some(Vec::new()); }
            _ => { if self.deferred { return false; } self.deferred = true; }
        }
        true
    }
    pub fn exit(&mut self, scope: u32) {
        match scope { SCOPE_BUDGET => self.budget = None, SCOPE_IMMEDIATE => self.immediate = None, _ => self.deferred = false }
    }

    fn admit(&mut self, key: u16, budgeted: bool, immediate: bool) -> bool {
        let position = self.pending.iter().position(|pending| *pending == key);
        let Some(remaining) = self.budget.filter(|_| !immediate && budgeted) else {
            if let Some(position) = position { self.pending.remove(position); }
            return true;
        };
        // An already queued key keeps its place: a late task cannot be
        // overtaken by a frequently requested earlier callback.
        if position.is_none() { self.pending.push_back(key); }
        if remaining == 0 || self.pending.front() != Some(&key) { return false; }
        self.pending.pop_front();
        self.budget = Some(remaining - 1);
        true
    }

    /// Elapsed game time to integrate when this key's work runs now; `None`
    /// when it is not due, deferred, already published in the immediate scope
    /// or waiting for its budget admission (its elapsed credit is retained).
    pub fn elapsed(&mut self, key: u16, info: &KeyInfo, phase: f64, now: f64, dt: f64) -> Option<f64> {
        if self.deferred || !now.is_finite() || !dt.is_finite() || dt < 0.0 { return None; }
        let immediate = self.immediate.is_some();
        if let Some(published) = self.immediate.as_mut() {
            if published.contains(&key) { return None; }
            published.push(key);
        }
        if self.observed_at.is_some_and(|observed| now < observed) { self.reset(); }
        self.observed_at = Some(now);
        let previous = self.clocks.get(&key).copied();
        let observed = cadence::observe_work(now, dt, phase, info.interval,
            previous.map_or(f64::NAN, |clock| clock.next_at), previous.map_or(f64::NAN, |clock| clock.observed_at),
            previous.map_or(0.0, |clock| clock.elapsed), previous.is_none_or(|clock| clock.initial), immediate);
        let mut clock = WorkClock { next_at: observed[1], observed_at: observed[2], elapsed: observed[3], initial: observed[4] != 0.0 };
        self.clocks.insert(key, clock);
        if observed[0] == 0.0 || !self.admit(key, info.budgeted, immediate) { return None; }
        let published = cadence::commit_work(now, phase, info.interval, clock.next_at, clock.elapsed, clock.initial, immediate);
        clock.next_at = published[1]; clock.elapsed = published[2]; clock.initial = false;
        self.clocks.insert(key, clock);
        Some(published[0])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys() -> WorkKeys { WorkKeys::default() }
    fn run(scheduler: &mut WorkScheduler, keys: &WorkKeys, name: &str, now: f64, dt: f64) -> Option<f64> {
        let id = keys.by_name[name]; let info = keys.get(id);
        scheduler.elapsed(id, info, info.phase, now, dt)
    }

    #[test]
    fn known_keys_keep_their_policy_and_string_phase() {
        let mut keys = keys();
        assert_eq!(keys.get(keys.by_name["farms:sync"]).interval, 0.5);
        assert!(keys.get(keys.by_name["harvests"]).budgeted);
        assert_eq!(keys.get(keys.by_name["harvests"]).interval, cadence::CHECK_INTERVAL);
        assert!(!keys.get(keys.by_name["research"]).budgeted);
        // FNV-1a of "research" as the host computed it: 0x93c5fba5 / 2^32.
        let mut hash: u32 = 2_166_136_261;
        for byte in b"research" { hash = (hash ^ *byte as u32).wrapping_mul(16_777_619); }
        assert_eq!(keys.get(keys.by_name["research"]).phase, hash as f64 / 4_294_967_296.0);
        let fixture = keys.intern("fixture-key");
        assert_eq!(keys.intern("fixture-key"), fixture);
        assert_eq!(keys.get(fixture).interval, cadence::CHECK_INTERVAL);
        let pointer = keys.input(3);
        unsafe { for (index, unit) in "abc".encode_utf16().enumerate() { *pointer.add(index) = unit as f64; } }
        let transported = keys.commit(3);
        assert_eq!(keys.get(transported).name, "abc");
    }

    #[test]
    fn work_initializes_at_once_then_coalesces_elapsed_time_on_its_phase() {
        let keys = keys(); let mut scheduler = WorkScheduler::default();
        assert_eq!(run(&mut scheduler, &keys, "research", 0.0, 0.1), Some(0.1));
        // Twice in the same step is harmless and adds no time.
        assert_eq!(run(&mut scheduler, &keys, "research", 0.0, 0.1), None);
        let mut time = 0.0; let mut runs = Vec::new();
        for _ in 0..40 { time += 0.1; if let Some(elapsed) = run(&mut scheduler, &keys, "research", time, 0.1) { runs.push(elapsed); } }
        assert!(runs.len() >= 10 && runs.len() <= 13, "{runs:?}");
        let total: f64 = runs.iter().sum();
        assert!((total - 4.0).abs() < 0.35, "elapsed credit is preserved: {total}");
        // A rewind restarts the schedule.
        assert_eq!(run(&mut scheduler, &keys, "research", 1.0, 0.1), Some(0.1));
        assert_eq!(run(&mut scheduler, &keys, "research", f64::NAN, 0.1), None);
        assert_eq!(run(&mut scheduler, &keys, "research", 2.0, -1.0), None);
    }

    #[test]
    fn interactive_budget_admits_one_overdue_budgeted_key_per_scope_in_fifo_order() {
        let keys = keys(); let mut scheduler = WorkScheduler::default();
        let budgeted = ["farms:sync", "collectors:staff", "harvests", "fog-raids"];
        let mut order = Vec::new();
        for step in 0..4 {
            assert!(scheduler.enter(SCOPE_BUDGET));
            assert!(!scheduler.enter(SCOPE_BUDGET), "nested scopes share the budget");
            // Unbudgeted work is never queued.
            assert!(run(&mut scheduler, &keys, "research", step as f64 * 0.1, 0.1).is_some() || step > 0);
            for name in budgeted { if run(&mut scheduler, &keys, name, step as f64 * 0.1, 0.1).is_some() { order.push(name); } }
            scheduler.exit(SCOPE_BUDGET);
        }
        assert_eq!(order, budgeted, "first-use initialization joins the same queue");
        // Without a budget scope every due key runs.
        let mut direct = WorkScheduler::default();
        for name in budgeted { assert!(run(&mut direct, &keys, name, 0.0, 0.1).is_some()); }
    }

    #[test]
    fn denied_admission_keeps_the_elapsed_credit() {
        let keys = keys(); let mut scheduler = WorkScheduler::default();
        scheduler.enter(SCOPE_BUDGET);
        assert_eq!(run(&mut scheduler, &keys, "farms:sync", 0.0, 0.1), Some(0.1));
        assert_eq!(run(&mut scheduler, &keys, "harvests", 0.0, 0.1), None);
        scheduler.exit(SCOPE_BUDGET);
        scheduler.enter(SCOPE_BUDGET);
        let elapsed = run(&mut scheduler, &keys, "harvests", 0.1, 0.1).expect("admitted on the next substep");
        assert!((elapsed - 0.2).abs() < 1e-12);
        scheduler.exit(SCOPE_BUDGET);
    }

    #[test]
    fn immediate_scope_publishes_each_key_once_and_deferred_scope_spends_nothing() {
        let keys = keys(); let mut scheduler = WorkScheduler::default();
        assert_eq!(run(&mut scheduler, &keys, "builders:staff", 5.0, 0.1), Some(0.1));
        assert_eq!(run(&mut scheduler, &keys, "builders:staff", 5.05, 0.05), None);
        assert!(scheduler.enter(SCOPE_DEFERRED));
        assert_eq!(run(&mut scheduler, &keys, "builders:staff", 9.0, 0.1), None);
        scheduler.exit(SCOPE_DEFERRED);
        assert!(scheduler.enter(SCOPE_IMMEDIATE));
        // Paused publication: no time passes, yet the work runs once.
        assert_eq!(run(&mut scheduler, &keys, "builders:staff", 5.05, 0.0), Some(0.05));
        assert_eq!(run(&mut scheduler, &keys, "builders:staff", 5.05, 0.0), None);
        scheduler.exit(SCOPE_IMMEDIATE);
        // The restarted phased deadline prevents an immediate repeat.
        assert_eq!(run(&mut scheduler, &keys, "builders:staff", 5.15, 0.1), None);
        scheduler.reset();
        assert_eq!(run(&mut scheduler, &keys, "builders:staff", 5.15, 0.1), Some(0.1));
    }
}
