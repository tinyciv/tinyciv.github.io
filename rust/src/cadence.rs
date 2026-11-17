//! Deterministic game-time scheduling. Host code owns task identity and FIFO
//! admission; these rules own observation deadlines and elapsed-time credit.
//! Queries never read wall-clock time or consume the gameplay RNG.

pub const CHECK_INTERVAL: f64 = 1.0 / 3.0;
const EPSILON: f64 = 1e-9;

/// Preserve the original phase after a late observation. Missed periods are
/// coalesced into one execution instead of replayed in a catch-up burst.
pub fn next_deadline(deadline: f64, now: f64, interval: f64) -> f64 {
    let periods = ((now - deadline + EPSILON) / interval).floor() + 1.0;
    // f64::max ignores a NaN operand; JavaScript Math.max propagates it.
    let periods = if periods.is_nan() { periods } else { periods.max(1.0) };
    deadline + interval * periods
}

/// `[due, next_at, sampled_at, interval]`. A NaN sampled_at represents a host
/// clock which has never been sampled. Only a due result should be published.
/// Units in or near combat re-decide at 8 Hz; quiet units at 3 Hz.
pub const COMBAT_DECISION_INTERVAL: f64 = 1.0 / 8.0;

/// `[due, next_at, sampled_at, interval]`. Units `active` in combat decide at
/// 8 Hz, others at 3 Hz. An `urgent` event (damage, a lost target, a new order)
/// or entering combat bypasses the pending deadline. Deadlines sit on a fixed
/// per-key phase grid so a crowd stays spread across steps after any hitch.
pub fn decision_due(now: f64, key: i32, next_at: f64, sampled_at: f64, previous_interval: f64, active: bool, urgent: bool) -> [f64; 4] {
    if !now.is_finite() {
        return [0.0, next_at, sampled_at, previous_interval];
    }
    let interval = if active { COMBAT_DECISION_INTERVAL } else { CHECK_INTERVAL };
    let first = sampled_at.is_nan();
    let rewind = !first && now < sampled_at;
    // An unsampled interval (NaN) counts as slower than combat, like JS `?? Infinity`.
    let entering = active && !(previous_interval <= interval);
    if !first && !rewind && !urgent && !entering && now + EPSILON < next_at {
        return [0.0, next_at, sampled_at, previous_interval];
    }
    // Match Math.imul(key | 0, 0x9e3779b1) >>> 0, including negative keys.
    let phase = (key as u32).wrapping_mul(0x9e37_79b1) as f64 / 4_294_967_296.0;
    let next = ((now / interval - phase + EPSILON).floor() + 1.0 + phase) * interval;
    [1.0, next, now, interval]
}

/// `[eligible, next_at, observed_at, elapsed, initial]`. An absent host clock
/// passes NaN for both timestamps. Observing twice at the same game time never
/// adds dt twice; a denied admission retains the complete elapsed credit.
pub fn observe_work(now: f64, dt: f64, phase: f64, interval: f64,
    mut next_at: f64, mut observed_at: f64, mut elapsed: f64, mut initial: bool,
    immediate: bool) -> [f64; 5] {
    if !now.is_finite() || !dt.is_finite() || dt < 0.0 {
        return [0.0, next_at, observed_at, elapsed, u32::from(initial) as f64];
    }
    if observed_at.is_nan() || now < observed_at {
        next_at = now + interval * (1.0 + phase);
        observed_at = now;
        elapsed = dt;
        initial = true;
    } else if observed_at != now {
        elapsed += dt;
        observed_at = now;
    }
    let eligible = initial || immediate || !(now + EPSILON < next_at);
    [u32::from(eligible) as f64, next_at, observed_at, elapsed, u32::from(initial) as f64]
}

/// `[published_elapsed, next_at, remaining_elapsed]`. Call only after the host
/// admits eligible work. Explicit paused publications restart their phased
/// deadline; ordinary observations retain it, even after budget deferral.
pub fn commit_work(now: f64, phase: f64, interval: f64, next_at: f64,
    elapsed: f64, initial: bool, immediate: bool) -> [f64; 3] {
    let next = if immediate {
        now + interval * (1.0 + phase)
    } else if !initial || now + EPSILON >= next_at {
        next_deadline(next_at, now, interval)
    } else {
        next_at
    };
    [elapsed, next, 0.0]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn near(actual: f64, expected: f64) {
        assert!((actual - expected).abs() < 1e-9, "{actual} != {expected}");
    }

    fn quiet(now: f64, key: i32, clock: [f64; 4]) -> [f64; 4] { decision_due(now, key, clock[1], clock[2], clock[3], false, false) }
    const UNSAMPLED: [f64; 4] = [0.0, f64::NAN, f64::NAN, f64::NAN];

    #[test]
    fn decisions_initialize_immediately_pause_and_restart_on_rewind() {
        let first = quiet(0.0, 7, UNSAMPLED);
        assert_eq!(first[0], 1.0);
        assert!(first[1] > 0.0 && first[1] <= CHECK_INTERVAL + EPSILON);
        for _ in 0..120 { assert_eq!(quiet(0.0, 7, first)[0], 0.0); }
        let late = quiet(100.0, 7, first);
        assert_eq!(late[0], 1.0);
        assert!(late[1] > 100.0 && late[1] <= 100.0 + CHECK_INTERVAL + EPSILON);
        assert_eq!(quiet(100.0, 7, late)[0], 0.0);
        assert_eq!(quiet(0.1, 7, late)[0], 1.0);
        assert_eq!(quiet(f64::NAN, 7, late)[0], 0.0);
        assert_eq!(quiet(f64::INFINITY, 7, late)[0], 0.0);
    }

    #[test]
    fn combat_decides_at_eight_hertz_and_urgent_events_bypass_the_deadline() {
        let quiet_clock = quiet(0.0, 3, UNSAMPLED);
        // Entering combat is due at once and then follows the 8 Hz grid.
        let combat = decision_due(0.01, 3, quiet_clock[1], quiet_clock[2], quiet_clock[3], true, false);
        assert_eq!(combat[0], 1.0);
        near(combat[3], COMBAT_DECISION_INTERVAL);
        assert!(combat[1] - 0.01 <= COMBAT_DECISION_INTERVAL + EPSILON);
        assert_eq!(decision_due(0.02, 3, combat[1], combat[2], combat[3], true, false)[0], 0.0);
        assert_eq!(decision_due(0.02, 3, combat[1], combat[2], combat[3], true, true)[0], 1.0);
        assert_eq!(decision_due(combat[1], 3, combat[1], combat[2], combat[3], true, false)[0], 1.0);
    }

    #[test]
    fn decisions_keep_crowd_phases_after_variable_frames_and_a_long_hitch() {
        let mut clocks: Vec<[f64; 4]> = (1..=120).map(|id| quiet(0.0, id, UNSAMPLED)).collect();
        for (index, clock) in clocks.iter_mut().enumerate() { *clock = quiet(100.0, index as i32 + 1, *clock); }
        let mut maximum = 0;
        for frame in 1..=20 {
            let now = 100.0 + frame as f64 / 60.0;
            let mut count = 0;
            for (index, clock) in clocks.iter_mut().enumerate() {
                let result = quiet(now, index as i32 + 1, *clock);
                if result[0] != 0.0 { count += 1; *clock = result; }
            }
            maximum = maximum.max(count);
        }
        assert!(maximum < 12, "crowd merged into a {maximum}-unit cohort");
    }

    #[test]
    fn pending_work_preserves_all_elapsed_credit_and_same_time_calls_are_idempotent() {
        let first = observe_work(0.0, 0.1, 0.0, 0.5, f64::NAN, f64::NAN, 0.0, true, false);
        assert_eq!(first, [1.0, 0.5, 0.0, 0.1, 1.0]);
        // Deny first admission, then accumulate one later increment. No clock
        // state is consumed until the queue actually admits this task.
        let later = observe_work(0.1, 0.1, 0.0, 0.5, first[1], first[2], first[3], first[4] != 0.0, false);
        near(later[3], 0.2);
        let duplicate = observe_work(0.1, 0.1, 0.0, 0.5, later[1], later[2], later[3], later[4] != 0.0, false);
        assert_eq!(duplicate, later);
        let published = commit_work(0.1, 0.0, 0.5, later[1], later[3], true, false);
        assert_eq!(published, [0.2, 0.5, 0.0]);
        let repeated = observe_work(0.1, 0.1, 0.0, 0.5, published[1], later[2], published[2], false, false);
        assert_eq!(repeated[0], 0.0);
        assert_eq!(repeated[3], 0.0);
        let overdue = observe_work(10.0, 9.9, 0.0, 0.5, repeated[1], repeated[2], repeated[3], false, false);
        assert_eq!(overdue[0], 1.0);
        let flushed = commit_work(10.0, 0.0, 0.5, overdue[1], overdue[3], false, false);
        near(flushed[0], 9.9);
        assert_eq!(flushed[1], 10.5);
    }

    #[test]
    fn paused_immediate_publications_spend_existing_credit_and_restart_their_phase() {
        let observed = observe_work(0.2, 0.0, 0.25, 0.5, 0.625, 0.2, 0.2, false, true);
        assert_eq!(observed[0], 1.0);
        let published = commit_work(0.2, 0.25, 0.5, observed[1], observed[3], false, true);
        near(published[0], 0.2);
        near(published[1], 0.825);
        let normal = observe_work(0.2, 0.0, 0.25, 0.5, published[1], observed[2], published[2], false, false);
        assert_eq!(normal[0], 0.0);
        assert_eq!(normal[3], 0.0);
    }

    #[test]
    fn work_rewinds_reset_and_invalid_observations_leave_the_clock_untouched() {
        let rewound = observe_work(0.0, 0.1, 0.5, CHECK_INTERVAL, 20.0, 19.0, 0.8, false, false);
        assert_eq!(rewound, [1.0, 0.5, 0.0, 0.1, 1.0]);
        for (now, dt) in [(f64::NAN, 0.1), (0.0, f64::INFINITY), (0.0, -0.1)] {
            assert_eq!(observe_work(now, dt, 0.5, 0.5, 20.0, 19.0, 0.8, false, false),
                [0.0, 20.0, 19.0, 0.8, 0.0]);
        }
    }

    #[test]
    fn deadline_tolerance_coalesces_without_phase_drift() {
        near(next_deadline(1.0, 1.0 - 0.5e-9, 0.5), 1.5);
        near(next_deadline(0.125, 100.0, 0.5), 100.125);
        assert!(next_deadline(f64::NAN, 1.0, 0.5).is_nan());
    }
}
