//! Authoritative combat arithmetic shared by browser, multiplayer and native
//! simulation builds. Callers supply research effects, never precomputed hits.

const DAMAGE_MULTIPLIER: f64 = 0.7;
const ELITE_DAMAGE_MULTIPLIER: f64 = 2.3;
const ELITE_DAMAGE_TAKEN_MULTIPLIER: f64 = 0.15;
const RAIDER_ATTACK_MULTIPLIER: f64 = 0.85;
const VETERANCY_KILLS: [f64; 4] = [10.0, 100.0, 250.0, 500.0];
const EQUIPMENT_MULTIPLIERS: [f64; 7] = [1.0, 1.15, 1.3, 1.5, 1.7, 1.9, 2.1];
const ATTACK_BONUSES: [f64; 5] = [0.0, 3.0, 7.0, 12.0, 0.0];
const DEFENSE_BONUSES: [f64; 5] = [0.0, 2.0, 5.0, 8.0, 0.0];

/// Stable metadata ABI, read once by the presentation layer. 0..=2: damage
/// factors, 3..=6: rank thresholds, 7..=13: equipment multipliers,
/// 14: maximum equipment tier, 15: marauder damage factor.
pub fn constant(index: u32) -> f64 {
    match index {
        0 => DAMAGE_MULTIPLIER,
        1 => ELITE_DAMAGE_MULTIPLIER,
        2 => ELITE_DAMAGE_TAKEN_MULTIPLIER,
        3..=6 => VETERANCY_KILLS[(index - 3) as usize],
        7..=13 => EQUIPMENT_MULTIPLIERS[(index - 7) as usize],
        14 => (EQUIPMENT_MULTIPLIERS.len() - 1) as f64,
        15 => RAIDER_ATTACK_MULTIPLIER,
        _ => f64::NAN,
    }
}

pub fn veterancy(kills: f64) -> u32 {
    // Elite replaces additive bonuses instead of stacking with them.
    if kills >= VETERANCY_KILLS[3] { 4 }
    else if kills >= VETERANCY_KILLS[2] { 3 }
    else if kills >= VETERANCY_KILLS[1] { 2 }
    else if kills >= VETERANCY_KILLS[0] { 1 }
    else { 0 }
}

pub fn equipment_multiplier(level: u32) -> f64 {
    EQUIPMENT_MULTIPLIERS.get(level as usize).copied().unwrap_or(f64::NAN)
}

pub fn dealt_multiplier(kills: f64) -> f64 {
    if veterancy(kills) == 4 { ELITE_DAMAGE_MULTIPLIER } else { 1.0 }
}

pub fn taken_multiplier(kills: f64) -> f64 {
    if veterancy(kills) == 4 { ELITE_DAMAGE_TAKEN_MULTIPLIER } else { 1.0 }
}

// f64::max ignores a NaN argument, unlike the previous Math.max rule. Keep
// invalid combat values visible instead of silently turning them into hits.
fn maximum(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { f64::NAN } else { a.max(b) }
}

pub fn incoming_damage(kills: f64, damage: f64) -> f64 {
    maximum(0.0, damage) * taken_multiplier(kills)
}

pub fn attack_damage(attack: f64, defense: f64) -> f64 {
    maximum(4.0, attack - defense) * DAMAGE_MULTIPLIER
}

fn raw_attack(scout: u32, attack: f64, kills: f64, weapon: u32, equipment: f64) -> f64 {
    if scout != 0 { 0.0 }
    else { (attack + ATTACK_BONUSES[veterancy(kills) as usize]) * equipment_multiplier(weapon) * equipment }
}

fn damage_factor(kills: f64, archer_multiplier: f64, raider: u32, strength: f64) -> f64 {
    dealt_multiplier(kills) * archer_multiplier * (if raider != 0 { RAIDER_ATTACK_MULTIPLIER } else { 1.0 }) * strength
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub fn unit_attack(scout: u32, attack: f64, kills: f64, weapon: u32, equipment: f64,
    archer_multiplier: f64, raider: u32, strength: f64, technology_bonus: f64, raider_bonus: f64) -> f64 {
    unit_attack_cultural(scout, attack, kills, weapon, equipment, archer_multiplier, raider, strength,
        technology_bonus, raider_bonus, 0, 0, 0)
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub fn unit_damage(scout: u32, attack: f64, kills: f64, weapon: u32, equipment: f64,
    archer_multiplier: f64, raider: u32, strength: f64, technology_bonus: f64, raider_bonus: f64, defense: f64) -> f64 {
    unit_damage_cultural(scout, attack, kills, weapon, equipment, archer_multiplier, raider, strength,
        technology_bonus, raider_bonus, defense, 0, 0, 0)
}

fn cultural_raw_attack(scout: u32, attack: f64, kills: f64, weapon: u32, equipment: f64, culture: u32, context: u32, quests: u32) -> f64 {
    if scout != 0 { return 0.0; }
    raw_attack(scout, crate::sim::quests::effect(quests, 2, attack), kills, weapon, equipment)
        + (attack + ATTACK_BONUSES[veterancy(kills) as usize]) * crate::sim::achievements::combat_bonus(culture, context, true)
}

#[allow(clippy::too_many_arguments)]
pub fn unit_attack_cultural(scout: u32, attack: f64, kills: f64, weapon: u32, equipment: f64,
    archer_multiplier: f64, raider: u32, strength: f64, technology_bonus: f64, raider_bonus: f64,
    culture: u32, context: u32, quests: u32) -> f64 {
    let factor = crate::sim::achievements::defense_damage_multiplier(culture, context,
        damage_factor(kills, archer_multiplier, raider, strength));
    cultural_raw_attack(scout, attack, kills, weapon, equipment, culture, context, quests) * DAMAGE_MULTIPLIER * factor
        + technology_bonus + raider_bonus
}

#[allow(clippy::too_many_arguments)]
pub fn unit_damage_cultural(scout: u32, attack: f64, kills: f64, weapon: u32, equipment: f64,
    archer_multiplier: f64, raider: u32, strength: f64, technology_bonus: f64, raider_bonus: f64, defense: f64,
    culture: u32, context: u32, quests: u32) -> f64 {
    if scout != 0 { return 0.0; }
    let factor = crate::sim::achievements::defense_damage_multiplier(culture, context,
        damage_factor(kills, archer_multiplier, raider, strength));
    let bonus = technology_bonus + raider_bonus;
    attack_damage(cultural_raw_attack(scout, attack, kills, weapon, equipment, culture, context, quests)
        + bonus / maximum(0.001, DAMAGE_MULTIPLIER * factor), defense) * factor
}

pub fn unit_defense(defense: f64, kills: f64, armor: u32, equipment: f64,
    brace: f64, technology_bonus: f64, raider_bonus: f64) -> f64 {
    (defense + DEFENSE_BONUSES[veterancy(kills) as usize]) * equipment_multiplier(armor) * equipment
        + brace + technology_bonus + raider_bonus
}

#[allow(clippy::too_many_arguments)]
pub fn unit_defense_cultural(defense: f64, kills: f64, armor: u32, equipment: f64,
    brace: f64, technology_bonus: f64, raider_bonus: f64, culture: u32, context: u32) -> f64 {
    unit_defense(defense, kills, armor, equipment, brace, technology_bonus, raider_bonus)
        + (defense + DEFENSE_BONUSES[veterancy(kills) as usize]) * crate::sim::achievements::combat_bonus(culture, context, false)
}

pub fn record_kill(kills: f64) -> f64 { maximum(0.0, kills) + 1.0 }
pub fn record_kill_amount(kills: f64, amount: f64) -> f64 { maximum(0.0, kills) + maximum(0.0, amount) }

#[cfg(test)]
mod tests {
    use super::*;

    fn close(actual: f64, expected: f64) {
        assert!((actual - expected).abs() < 1e-10, "{actual} != {expected}");
    }

    #[test]
    fn promotes_only_at_each_exact_rank_threshold() {
        for (kills, rank) in [(-1.0, 0), (0.0, 0), (9.0, 0), (10.0, 1), (99.0, 1),
            (100.0, 2), (249.0, 2), (250.0, 3), (499.0, 3), (500.0, 4)] {
            assert_eq!(veterancy(kills), rank);
        }
    }

    #[test]
    fn elite_multiplies_the_equipped_untrained_hit_without_additive_rank_bonuses() {
        for equipment in 0..=6 {
            let ordinary = unit_damage(0, 17.0, 0.0, equipment, 1.6, 1.15, 1, 1.5, 2.0, 3.0, 12.0);
            let elite = unit_damage(0, 17.0, 500.0, equipment, 1.6, 1.15, 1, 1.5, 0.0, 0.0, 12.0);
            let baseline = unit_damage(0, 17.0, 0.0, equipment, 1.6, 1.15, 1, 1.5, 0.0, 0.0, 12.0);
            close(elite, baseline * ELITE_DAMAGE_MULTIPLIER);
            assert!(ordinary >= baseline);
            close(unit_defense(4.0, 500.0, equipment, 1.6, 6.0, 2.0, 3.0),
                4.0 * equipment_multiplier(equipment) * 1.6 + 11.0);
        }
    }

    #[test]
    fn scales_minimum_hits_after_armor_and_prevents_scout_damage() {
        close(attack_damage(1.0, 1000.0), 2.8);
        close(unit_damage(0, 1.0, 500.0, 0, 1.0, 1.15, 1, 1.5, 0.0, 0.0, 1000.0),
            4.0 * 0.7 * 2.3 * 1.15 * 0.85 * 1.5);
        assert_eq!(unit_damage(1, 100.0, 500.0, 6, 1.6, 1.15, 1, 3.0, 10.0, 10.0, 0.0), 0.0);
        close(incoming_damage(500.0, 20.0), 3.0);
        assert_eq!(incoming_damage(500.0, -20.0), 0.0);
    }

    #[test]
    fn keeps_effective_bonuses_subject_to_armor() {
        close(unit_attack(0, 17.0, 100.0, 3, 1.2, 1.15, 1, 1.5, 2.0, 3.0),
            (17.0 + 7.0) * 1.5 * 1.2 * 0.7 * 1.15 * 0.85 * 1.5 + 5.0);
        close(unit_damage(0, 17.0, 0.0, 0, 1.0, 1.0, 0, 1.0, 2.0, 3.0, 4.0),
            (17.0 + 5.0 / 0.7 - 4.0) * 0.7);
    }

    #[test]
    fn retains_invalid_numeric_values_and_clamps_negative_kill_counts() {
        assert!(incoming_damage(0.0, f64::NAN).is_nan());
        assert!(attack_damage(f64::NAN, 1.0).is_nan());
        assert_eq!(veterancy(f64::NAN), 0);
        assert_eq!(record_kill(-20.0), 1.0);
        assert!(record_kill(f64::NAN).is_nan());
    }
}
