//! Authoritative progression, construction prices, and purchase arithmetic.
//! The browser supplies small scalar inputs; game rules return canonical values
//! without serializing a world or calling JavaScript from the simulation.
use bevy_ecs::prelude::Component;

pub const XP_PER_LEVEL: f64 = 960.0;
pub const XP_PER_KILL: f64 = 20.0;
pub const COMMANDER_XP: f64 = XP_PER_LEVEL;
pub const RETINUE_XP_SHARE: f64 = 0.1;
pub const LEVEL_HP: f64 = 10.0;
pub const LEVEL_ATTACK: f64 = 0.25;
pub const SKILL_MAX_RANK: f64 = 10.0;
pub const FARM_GOLD: f64 = 9.75;
pub const HOUSE_GOLD: f64 = 42.25;
pub const KEEP_GOLD: f64 = 1000.0;
pub const KEEP_HOUSING_GOLD: f64 = 1000.0;
pub const POWER_ATTACK: f64 = 0.5;
pub const GUARD_DEFENSE: f64 = 1.0;
pub const DEATH_GOLD: f64 = 200.0;

pub fn opening_house_credit(orders: u32) -> f64 {
    f64::from(5_u32.saturating_sub(orders)) * 4.0
}

pub fn opening_harvest_seconds(seed: u32, x: i32, y: i32, cycle_seconds: f64) -> f64 {
    crate::relief::hash(seed ^ 0x35e8_61af, x, y) * cycle_seconds
}

/// Stable numeric rule IDs are shared by the thin browser presentation bridge.
pub fn constant(index: u32) -> f64 {
    match index {
        0 => XP_PER_LEVEL,
        1 => XP_PER_KILL,
        2 => COMMANDER_XP,
        3 => RETINUE_XP_SHARE,
        4 => LEVEL_HP,
        5 => LEVEL_ATTACK,
        6 => SKILL_MAX_RANK,
        7 => FARM_GOLD,
        8 => HOUSE_GOLD,
        9 => KEEP_GOLD,
        10 => KEEP_HOUSING_GOLD,
        11 => POWER_ATTACK,
        12 => GUARD_DEFENSE,
        13 => DEATH_GOLD,
        _ => f64::NAN,
    }
}

#[derive(Component, Debug, Clone, Copy, PartialEq)]
pub struct LeaderProgression {
    pub level: f64,
    pub xp: f64,
    pub points: f64,
}

impl LeaderProgression {
    fn award(&mut self, amount: f64) -> f64 {
        if !amount.is_finite() || amount <= 0.0 { return 0.0; }
        self.xp += amount;
        let mut levels = 0.0;
        while self.xp >= xp_required(self.level) {
            self.xp -= xp_required(self.level);
            self.level += 1.0;
            self.points += 1.0;
            levels += 1.0;
        }
        levels
    }
}

pub fn xp_required(level: f64) -> f64 {
    if level.is_nan() { f64::NAN } else { level.floor().max(1.0) * XP_PER_LEVEL }
}

/// Result layout: level, XP, available points, HP, maximum HP, attack, levels gained.
pub fn award(level: f64, xp: f64, points: f64, amount: f64, hp: f64, max_hp: f64, attack: f64, strength: f64) -> [f64; 7] {
    let mut progression = LeaderProgression { level, xp, points };
    let levels = progression.award(amount);
    let health = LEVEL_HP * levels * strength;
    [progression.level, progression.xp, progression.points,
        if levels > 0.0 { hp.min(max_hp) + health } else { hp },
        max_hp + health, attack + LEVEL_ATTACK * levels, levels]
}

/// Power, Guard, Command, Engineer, Brace, Discretion, in browser skill order.
pub fn skill_cap(skill: u32) -> f64 { if skill < 3 { SKILL_MAX_RANK } else if skill < 6 { 1.0 } else { 0.0 } }

/// Result layout: error (0 success, 1 technology, 2 cap, 3 points, 4 unknown),
/// new rank, available points, attack, defense.
pub fn learn(skill: u32, rank: f64, points: f64, attack: f64, defense: f64, unlocked: bool) -> [f64; 5] {
    let error = if skill >= 6 { 4.0 } else if !unlocked { 1.0 }
        else if rank >= skill_cap(skill) { 2.0 } else if points < 1.0 { 3.0 } else { 0.0 };
    if error != 0.0 { return [error, rank, points, attack, defense]; }
    [0.0, rank + 1.0, points - 1.0,
        attack + if skill == 0 { POWER_ATTACK } else { 0.0 },
        defense + if skill == 1 { GUARD_DEFENSE } else { 0.0 }]
}

/// Result layout: level, XP, available points, unscaled maximum HP, attack.
/// Skills and previously spent points survive death.
pub fn death(level: f64, xp: f64, points: f64, max_hp: f64, attack: f64, strength: f64) -> [f64; 5] {
    let lost_level = level > 1.0;
    let level = (level - 1.0).max(1.0);
    [level, xp.min(xp_required(level) - 1.0), if lost_level { (points - 1.0).max(0.0) } else { points },
        (max_hp / strength - if lost_level { LEVEL_HP } else { 0.0 }).max(1.0),
        attack - if lost_level { LEVEL_ATTACK } else { 0.0 }]
}

/// Purchases are all-or-nothing. A negative result rejects the transaction.
pub fn purchase(gold: f64, cost: f64) -> f64 {
    if !gold.is_finite() || !cost.is_finite() || cost < 0.0 || gold < cost { -1.0 } else { gold - cost }
}

/// Mandatory outlays consume only available gold, never creating debt.
/// Result layout: remaining treasury, actual payment.
pub fn charge(gold: f64, amount: f64) -> [f64; 2] {
    if !amount.is_finite() || amount <= 0.0 { return [gold, 0.0]; }
    if gold.is_nan() { return [f64::NAN, f64::NAN]; }
    let paid = amount.min(gold.max(0.0));
    [(gold - paid).max(0.0), paid]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_commander_death_cannot_skip_three_levels() {
        assert_eq!(award(1.0, 0.0, 0.0, COMMANDER_XP, 35.0, 100.0, 25.0, 1.0),
            [2.0, 0.0, 1.0, 45.0, 110.0, 25.25, 1.0]);
        assert_eq!(award(2.0, 0.0, 1.0, COMMANDER_XP, 110.0, 110.0, 25.25, 1.0),
            [2.0, 960.0, 1.0, 110.0, 110.0, 25.25, 0.0]);
    }

    #[test]
    fn awards_multiple_thresholds_without_reapplying_prior_stat_bonuses() {
        assert_eq!(award(2.0, 0.0, 1.0, 6528.0, 45.0, 110.0, 25.25, 1.0),
            [4.0, 1728.0, 3.0, 65.0, 130.0, 25.75, 2.0]);
        for amount in [0.0, -20.0, f64::NAN, f64::INFINITY] {
            assert_eq!(award(1.0, 0.0, 0.0, amount, 100.0, 100.0, 25.0, 1.0),
                [1.0, 0.0, 0.0, 100.0, 100.0, 25.0, 0.0]);
        }
    }

    #[test]
    fn skills_enforce_technology_cap_and_atomic_spending() {
        assert_eq!(learn(0, 0.0, 1.0, 25.0, 5.0, true), [0.0, 1.0, 0.0, 25.5, 5.0]);
        assert_eq!(learn(1, 0.0, 1.0, 25.0, 5.0, true), [0.0, 1.0, 0.0, 25.0, 6.0]);
        assert_eq!(learn(3, 0.0, 1.0, 25.0, 5.0, false), [1.0, 0.0, 1.0, 25.0, 5.0]);
        assert_eq!(learn(3, 1.0, 1.0, 25.0, 5.0, true), [2.0, 1.0, 1.0, 25.0, 5.0]);
        assert_eq!(learn(2, 0.0, 0.0, 25.0, 5.0, true), [3.0, 0.0, 0.0, 25.0, 5.0]);
    }

    #[test]
    fn death_removes_one_level_and_bonus_but_preserves_spent_skills() {
        assert_eq!(death(4.0, 3000.0, 2.0, 260.0, 25.75, 2.0), [3.0, 2879.0, 1.0, 120.0, 25.5]);
        assert_eq!(death(1.0, 15.0, 0.0, 100.0, 25.0, 1.0), [1.0, 15.0, 0.0, 100.0, 25.0]);
    }

    #[test]
    fn construction_prices_apply_thirty_percent_to_the_current_prices() {
        assert_eq!(FARM_GOLD, 7.5 * 1.3);
        assert_eq!(HOUSE_GOLD, 32.5 * 1.3);
        assert_eq!(KEEP_GOLD, 1000.0);
        assert_eq!(purchase(1250.0, KEEP_GOLD), 250.0);
        assert_eq!(purchase(1000.0, KEEP_GOLD), 0.0);
        for gold in [0.0, 999.99, f64::NAN, f64::INFINITY] { assert_eq!(purchase(gold, KEEP_GOLD), -1.0); }
    }

    #[test]
    fn mandatory_outlays_record_only_the_gold_available() {
        assert_eq!(charge(37.5, DEATH_GOLD), [0.0, 37.5]);
        assert_eq!(charge(0.0, DEATH_GOLD), [0.0, 0.0]);
        assert_eq!(charge(250.0, DEATH_GOLD), [50.0, 200.0]);
    }
}
