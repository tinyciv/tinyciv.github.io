//! Settlement affiliation model: pure formulas and constants, no ECS state.
//! Every settlement holds a 0..100 affiliation toward each civilization
//! faction; loyalty is the affiliation toward the owner. The three drivers are
//! culture (alignment), delivered trade, and sensed military threat.

pub const SLOTS: usize = 16;
/// Exposure bookkeeping for marauders and other non-civilization armies.
pub const OTHER_SLOT: usize = 15;
pub const TARGET_SLOTS: usize = 15;

pub const SENSE_INTERVAL: f64 = 1.0;
pub const INTEGRATE_INTERVAL: f64 = 5.0;
pub const CITY_SENSE_RADIUS: f64 = 14.0;
pub const VILLAGE_SENSE_RADIUS: f64 = 12.0;
pub const CORE_RADIUS: f64 = 4.0;
pub const EXPOSURE_HALF_LIFE: f64 = 180.0;
pub const EXPOSURE_SCALE: f64 = 3.0;
pub const THREAT_MAX: f64 = 45.0;
pub const FEAR_MAX: f64 = 30.0;
pub const INTIMIDATION_WEIGHT: f64 = 0.25;
pub const CASUALTY_EXPOSURE: f64 = 1.5;
pub const PROTECTION_CAP: f64 = 0.6;
pub const PROTECTOR_HALF_LIFE: f64 = 300.0;
pub const PROTECTOR_MAX: f64 = 12.0;
pub const TRADE_HALF_LIFE: f64 = 240.0;
pub const TRADE_SCALE: f64 = 40.0;
pub const TRADE_MAX: f64 = 25.0;
pub const CULTURE_WEIGHT: f64 = 0.55;
pub const GOVERNANCE_BASE: f64 = 15.0;
pub const ALLIANCE_BONUS: f64 = 10.0;
pub const WAR_CAP: f64 = 20.0;
pub const SNUB: f64 = 5.0;
pub const SNUB_HALF_LIFE: f64 = 120.0;
pub const LOYALTY_START: f64 = 75.0;
pub const LOYALTY_GRACE: f64 = 120.0;
pub const ASSIMILATION_TIME: f64 = 1200.0;
pub const CONFEDERATION_MIN: f64 = 60.0;
pub const CONFEDERATION_MARGIN: f64 = 10.0;
pub const PETITION_MIN: f64 = 80.0;
pub const VILLAGE_TRADE_COST: f64 = 200.0;
pub const VILLAGE_ALLIANCE_COST: f64 = 3000.0;
pub const VILLAGE_ALLIANCE_MIN_COST: f64 = 500.0;
pub const CAPTURE_LOYALTY: f64 = 60.0;
pub const ALLIED_ALIGNMENT_TIME: f64 = 900.0;
pub const ALIGNMENT_RELAX_TIME: f64 = 2400.0;
pub const ALLIED_ALIGNMENT: f64 = 0.70;
pub const VILLAGE_TRADE_MIN: f64 = 15.0;
pub const VILLAGE_ALLIANCE_MIN: f64 = 45.0;
pub const REFUSAL_COOLDOWN: f64 = 90.0;
pub const PETITION_HOLD: f64 = 120.0;
pub const PETITION_INTERVAL: f64 = 600.0;

/// Exported in the documented table order (design section 4.10).
pub fn constant(index: u32) -> f64 {
    const TABLE: [f64; 31] = [SENSE_INTERVAL, INTEGRATE_INTERVAL, CITY_SENSE_RADIUS, VILLAGE_SENSE_RADIUS, CORE_RADIUS,
        EXPOSURE_HALF_LIFE, EXPOSURE_SCALE, THREAT_MAX, FEAR_MAX, INTIMIDATION_WEIGHT, CASUALTY_EXPOSURE, PROTECTION_CAP,
        PROTECTOR_HALF_LIFE, PROTECTOR_MAX, TRADE_HALF_LIFE, TRADE_SCALE, TRADE_MAX, CULTURE_WEIGHT, GOVERNANCE_BASE,
        ALLIANCE_BONUS, WAR_CAP, SNUB, LOYALTY_START, LOYALTY_GRACE, ASSIMILATION_TIME, CONFEDERATION_MIN,
        CONFEDERATION_MARGIN, PETITION_MIN, VILLAGE_TRADE_COST, VILLAGE_ALLIANCE_COST, VILLAGE_ALLIANCE_MIN_COST];
    TABLE.get(index as usize).copied().unwrap_or(f64::NAN)
}

pub fn clamp(value: f64, low: f64, high: f64) -> f64 { value.max(low).min(high) }
pub fn half_life(value: f64, elapsed: f64, half: f64) -> f64 { value * 2f64.powf(-elapsed.max(0.0) / half) }

/// Civilization families in `CIVILIZATIONS` order: Aegean–Italic, Levant–Punic,
/// Nile, Mesopotamia, Anatolia–Iran.
pub fn family(civ: i8) -> i8 {
    match civ { 0 | 2 => 0, 6 | 7 => 1, 1 | 10 => 2, 4 | 5 | 9 => 3, 3 | 8 => 4, _ => -1 }
}
fn adjacent_families(a: i8, b: i8) -> bool {
    let (low, high) = (a.min(b), a.max(b));
    matches!((low, high), (0, 1) | (0, 4) | (1, 2) | (1, 3) | (3, 4))
}
/// Base cultural alignment between two peoples, symmetric.
pub fn base_alignment(a: i8, b: i8) -> f64 {
    if a < 0 || b < 0 { return 0.30; }
    if a == b { return 1.0; }
    let (fa, fb) = (family(a), family(b));
    if fa >= 0 && fa == fb { 0.60 } else if fa >= 0 && fb >= 0 && adjacent_families(fa, fb) { 0.45 } else { 0.30 }
}
/// A village's initial alignment toward a civilization, given its kin civ.
pub fn village_alignment(kin: i8, civ: i8) -> f64 {
    if kin >= 0 && kin == civ { 0.55 } else if kin >= 0 && family(kin) >= 0 && family(kin) == family(civ) { 0.45 } else { 0.35 }
}

/// Military weight of a movement kind code (5..=16). Scouts and civilians are
/// not counted by the military census and therefore weigh nothing here.
pub fn kind_weight(kind: u32) -> f64 {
    match kind { 5 => 2.0, 11 | 12 | 13 => 1.25, 6..=10 | 14..=16 => 1.0, _ => 0.0 }
}
pub fn proximity(distance: f64, radius: f64) -> f64 { clamp((radius - distance) / (radius - CORE_RADIUS), 0.0, 1.0) }

pub fn decay_exposure(exposure: f64, elapsed: f64) -> f64 { half_life(exposure, elapsed, EXPOSURE_HALF_LIFE) }
pub fn accumulate_exposure(exposure: f64, weighted_presence: f64, elapsed: f64) -> f64 {
    decay_exposure(exposure, elapsed) + weighted_presence * elapsed / 60.0
}
pub fn casualty_exposure(population: f64) -> f64 { CASUALTY_EXPOSURE * 20.0 / population.max(20.0) }
pub fn saturate(exposure: f64) -> f64 { 1.0 - (-exposure.max(0.0) / EXPOSURE_SCALE).exp() }
pub fn protection(guard_posts: f64, towers: f64, forts: f64, friendly: f64) -> f64 {
    (0.10 * guard_posts + 0.05 * towers + 0.15 * forts + 0.04 * friendly.min(5.0)).min(PROTECTION_CAP)
}
pub fn threat(hostile_exposure: f64, protection: f64) -> f64 { THREAT_MAX * saturate(hostile_exposure) * (1.0 - protection) }
pub fn fear(exposure: f64) -> f64 { FEAR_MAX * saturate(exposure) }
pub fn accumulate_protector(credit: f64, presence: f64, hostile_presence: f64, elapsed: f64) -> f64 {
    half_life(credit, elapsed, PROTECTOR_HALF_LIFE) + presence.min(hostile_presence) * elapsed / 60.0
}
pub fn protector(credit: f64) -> f64 { PROTECTOR_MAX * (1.0 - (-credit.max(0.0) / 2.0).exp()) }
pub fn trade(volume: f64) -> f64 { TRADE_MAX * (1.0 - (-volume.max(0.0) / TRADE_SCALE).exp()) }
pub fn culture(alignment: f64) -> f64 { 100.0 * alignment }

/// Support from the nearest other same-owner city; 0 for a sole city.
pub fn support(nearest: Option<f64>) -> f64 {
    nearest.map_or(0.0, |distance| clamp(12.0 - (distance - 20.0).max(0.0) * 0.6, -24.0, 12.0))
}
pub fn governance(support: f64, advanced: f64, monument: bool) -> f64 {
    GOVERNANCE_BASE + support + (4.0 * advanced).min(20.0) + if monument { 12.0 } else { 0.0 }
}
pub fn owner_target(alignment: f64, governance: f64, trade: f64, threat: f64, snub: f64) -> f64 {
    clamp(CULTURE_WEIGHT * culture(alignment) + governance + trade - threat - snub, -40.0, 100.0)
}
pub fn foreign_target(alignment: f64, trade: f64, allied: bool, protector: f64, fear: f64, snub: f64, war: bool) -> f64 {
    let target = clamp(CULTURE_WEIGHT * culture(alignment) + trade + if allied { ALLIANCE_BONUS } else { 0.0 }
        + protector - fear - snub, 0.0, 100.0);
    if war { target.min(WAR_CAP) } else { target }
}
pub fn owner_rate(target: f64, value: f64, grace: bool) -> f64 {
    let rate = clamp((target - value) / 180.0, -0.30, 0.20);
    if grace && rate < 0.0 { 0.0 } else { rate }
}
pub fn foreign_rate(target: f64, value: f64) -> f64 { clamp((target - value) / 240.0, -0.25, 0.25) }
pub fn advance(value: f64, rate: f64, elapsed: f64) -> f64 { clamp(value + rate * elapsed, 0.0, 100.0) }
pub fn warning(rate: f64, target: f64, value: f64) -> bool { rate < -0.01 && (target < 25.0 || value < 30.0) }

/// Owner assimilation, allied pull toward 0.70, otherwise relaxation to base.
pub fn drift_alignment(alignment: f64, base: f64, owner: bool, owner_value: f64, allied: bool, elapsed: f64) -> f64 {
    if owner && owner_value >= 50.0 { return alignment + (1.0 - alignment) * elapsed / ASSIMILATION_TIME; }
    if owner { return alignment; }
    if allied { return alignment + (ALLIED_ALIGNMENT.max(alignment) - alignment) * elapsed / ALLIED_ALIGNMENT_TIME; }
    alignment + (base - alignment) * elapsed / ALIGNMENT_RELAX_TIME
}

pub fn independence(stage: u8, guard_posts: f64, library: bool, monument: bool, threat: f64) -> f64 {
    clamp(70.0 + 3.0 * stage as f64 + 2.0 * guard_posts + if library { 5.0 } else { 0.0 }
        + if monument { 5.0 } else { 0.0 } - threat, 0.0, 100.0)
}
pub fn accept_threshold(independence: f64) -> f64 { CONFEDERATION_MIN.max(independence - CONFEDERATION_MARGIN) }
pub fn petition_threshold(independence: f64) -> f64 { PETITION_MIN.max(independence + 15.0) }
pub fn tribute(villagers: f64, stage: u8) -> f64 { 150.0 + 25.0 * villagers + 100.0 * stage as f64 }
/// Rounded like the original JavaScript ledger: 5 gold off per 50 traded.
pub fn alliance_cost(lifetime_trade: f64) -> f64 {
    VILLAGE_ALLIANCE_MIN_COST.max(VILLAGE_ALLIANCE_COST - (lifetime_trade.max(0.0) / 50.0 + 0.5).floor() * 5.0)
}
pub fn civ_confederate_chance(affiliation: f64, war: bool) -> f64 {
    clamp(0.10 + 0.008 * affiliation, 0.05, 0.90) * if war { 0.5 } else { 1.0 }
}
pub fn civ_refusal_war_chance(affiliation: f64) -> f64 { ((100.0 - affiliation) / 130.0).max(0.0) }

#[cfg(test)]
mod tests {
    use super::*;
    fn close(a: f64, b: f64, tolerance: f64) { assert!((a - b).abs() <= tolerance, "{a} differs from {b}"); }
    /// Integrates an owner row with 5-second chunks, like the engine.
    fn run_owner(mut value: f64, seconds: f64, grace_until: f64, target: impl Fn(f64) -> f64) -> (f64, f64) {
        let mut t = 0.0; let mut rate = 0.0;
        while t < seconds {
            let dt = INTEGRATE_INTERVAL.min(seconds - t); t += dt;
            let goal = target(t);
            rate = owner_rate(goal, value, t < grace_until);
            value = advance(value, rate, dt);
        }
        (value, rate)
    }

    #[test]
    fn own_capital_targets_seventy() {
        let target = owner_target(1.0, governance(support(None), 0.0, false), 0.0, 0.0, 0.0);
        close(target, 70.0, 1e-9);
        let (value, _) = run_owner(LOYALTY_START, 3600.0, LOYALTY_GRACE, |_| target);
        close(value, 70.0, 1e-6);
        close(owner_target(1.0, governance(0.0, 2.0, true), 0.0, 0.0, 0.0), 90.0, 1e-9);
    }

    #[test]
    fn second_city_support() {
        close(support(Some(30.0)), 6.0, 1e-9);
        close(owner_target(1.0, governance(support(Some(30.0)), 0.0, false), 0.0, 0.0, 0.0), 76.0, 1e-9);
        close(owner_target(1.0, governance(support(Some(30.0)), 0.0, false), 20.0, 0.0, 0.0), 96.0, 1e-9);
        close(support(Some(60.0)), -12.0, 1e-9);
        close(support(Some(200.0)), -24.0, 1e-9);
    }

    #[test]
    fn isolated_raided_outpost_warns_and_falls_within_five_to_six_minutes() {
        let base = owner_target(1.0, governance(support(Some(60.0)), 0.0, false), 0.0, 0.0, 0.0);
        close(base, 58.0, 1e-9);
        let presence = 4.0 * kind_weight(7) * proximity(6.0, CITY_SENSE_RADIUS) * 1.25;
        close(presence, 4.0, 1e-9);
        let mut exposure = 0.0;
        for _ in 0..180 { exposure = accumulate_exposure(exposure, presence, 1.0); }
        close(exposure, 8.65, 0.03);
        let h = threat(exposure, 0.0);
        close(h, 42.5, 0.2);
        let target = base - h;
        close(target, 15.5, 0.2);
        let rate = owner_rate(target, LOYALTY_START, false);
        assert!(warning(rate, target, LOYALTY_START));
        close(rate, -0.30, 1e-9); // (15.5 - 75)/180 clamps at the -0.30 floor
        close(threat(exposure, protection(1.0, 1.0, 0.0, 0.0)), 36.1, 0.2);
        // Continuous camping keeps the threat saturated. An own-heritage
        // outpost settles at its (warning) target instead of seceding; a
        // conquered, culturally foreign outpost is driven to 0 and secedes.
        let camp = |alignment: f64| {
            let base = owner_target(alignment, governance(support(Some(60.0)), 0.0, false), 0.0, 0.0, 0.0);
            let mut exposure = 0.0; let mut value = LOYALTY_START; let mut t = 0.0; let mut fell_at = None;
            while t < 900.0 {
                for _ in 0..5 { exposure = accumulate_exposure(exposure, presence, 1.0); }
                t += 5.0;
                let goal = base - threat(exposure, 0.0);
                value = advance(value, owner_rate(goal, value, false), 5.0);
                if value <= 0.0 && fell_at.is_none() { fell_at = Some(t); }
            }
            (value, fell_at)
        };
        let (own, own_fell) = camp(1.0);
        assert!(own_fell.is_none());
        close(own, 13.5, 1.0); // threat saturates further past 3 minutes
        let (_, foreign_fell) = camp(0.45);
        let fell_at = foreign_fell.expect("the foreign outpost secedes");
        assert!((240.0..=480.0).contains(&fell_at), "fell at {fell_at}");
    }

    #[test]
    fn exposure_rewards_proximity_and_frequency() {
        let near = proximity(2.0, CITY_SENSE_RADIUS);
        let far = 4.0 * proximity(11.5, CITY_SENSE_RADIUS);
        close(near, far, 1e-9);
        let mut once = 0.0; once = accumulate_exposure(once, 1.0, 10.0);
        let mut repeated = 0.0;
        for _ in 0..3 { repeated = accumulate_exposure(repeated, 1.0, 10.0); repeated = decay_exposure(repeated, 20.0); }
        assert!(repeated > once);
        close(decay_exposure(8.0, EXPOSURE_HALF_LIFE), 4.0, 1e-12);
        let scout = accumulate_exposure(0.0, proximity(8.0, CITY_SENSE_RADIUS) * 0.3, 10.0);
        assert!(scout < 0.05);
    }

    #[test]
    fn protection_caps_at_sixty_percent() {
        close(protection(10.0, 10.0, 10.0, 10.0), PROTECTION_CAP, 1e-12);
        close(protection(1.0, 1.0, 0.0, 0.0), 0.15, 1e-12);
    }

    #[test]
    fn guard_posts_only_matter_under_threat() {
        close(threat(0.0, protection(3.0, 0.0, 0.0, 0.0)), threat(0.0, 0.0), 1e-12);
        assert!(threat(6.0, protection(3.0, 0.0, 0.0, 0.0)) < threat(6.0, 0.0));
    }

    #[test]
    fn trade_saturates_and_decays_with_half_life() {
        assert!(trade(1e6) <= TRADE_MAX && trade(1e6) > TRADE_MAX - 1e-6);
        close(half_life(80.0, TRADE_HALF_LIFE, TRADE_HALF_LIFE), 40.0, 1e-12);
        assert!(trade(108.0) > 20.0);
    }

    #[test]
    fn snub_decays() { close(half_life(SNUB, SNUB_HALF_LIFE, SNUB_HALF_LIFE), SNUB / 2.0, 1e-12); }

    #[test]
    fn assimilation_requires_loyalty_fifty() {
        close(drift_alignment(0.6, 0.6, true, 49.0, false, 600.0), 0.6, 1e-12);
        close(drift_alignment(0.6, 0.6, true, 50.0, false, 600.0), 0.8, 1e-12);
    }

    #[test]
    fn allied_village_alignment_caps_at_seventy() {
        let mut alignment = 0.55;
        for _ in 0..2000 { alignment = drift_alignment(alignment, 0.55, false, 0.0, true, 5.0); }
        assert!(alignment <= ALLIED_ALIGNMENT + 1e-9 && alignment > 0.69);
        close(drift_alignment(0.9, 0.55, false, 0.0, true, 50.0), 0.9, 1e-12);
    }

    #[test]
    fn grace_blocks_only_negative_rates() {
        assert_eq!(owner_rate(0.0, 75.0, true), 0.0);
        assert!(owner_rate(100.0, 75.0, true) > 0.0);
    }

    #[test]
    fn family_alignment_table_is_symmetric() {
        for a in -1..12i8 { for b in -1..12i8 { assert_eq!(base_alignment(a, b), base_alignment(b, a)); } }
        assert_eq!(base_alignment(0, 2), 0.60);
        assert_eq!(base_alignment(0, 6), 0.45);
        assert_eq!(base_alignment(0, 1), 0.30);
        assert_eq!(base_alignment(3, 3), 1.0);
    }

    #[test]
    fn kin_village_example_requires_assimilated_alliance() {
        let target = foreign_target(0.55, 22.0, true, 0.0, 0.0, 0.0, false);
        close(target, 62.25, 1e-9);
        let independence = independence(2, 1.0, false, false, 0.0);
        close(independence, 78.0, 1e-9);
        assert!(target < accept_threshold(independence));
        let assimilated = foreign_target(0.70, 22.0, true, 0.0, 0.0, 0.0, false);
        assert!(assimilated >= accept_threshold(independence));
        let raided = super::independence(2, 1.0, false, false, 30.0);
        close(accept_threshold(raided), 60.0, 1e-9);
        assert_eq!(foreign_target(1.0, 25.0, true, 12.0, 0.0, 0.0, true), WAR_CAP);
    }

    #[test]
    fn village_costs_match_the_ledger() {
        assert_eq!(alliance_cost(0.0), 3000.0);
        assert_eq!(alliance_cost(500.0), 2950.0);
        assert_eq!(alliance_cost(1e9), 500.0);
        // Trade-discounted prices stay round and within [500, 3000].
        for total in [0.0, 12.2, 123.0, 1763.0, 24999.0, 100000.0] {
            let price = alliance_cost(total);
            assert_eq!(price % 5.0, 0.0);
            assert!((500.0..=3000.0).contains(&price));
        }
        assert_eq!(tribute(5.0, 3), 575.0);
        close(civ_confederate_chance(50.0, false), 0.5, 1e-12);
        close(civ_confederate_chance(0.0, true), 0.05, 1e-12);
    }
}
