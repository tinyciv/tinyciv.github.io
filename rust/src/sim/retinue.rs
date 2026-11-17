//! Command-time allocation of the finite retinue. The role being edited takes
//! priority; unused warrior slots are consumed before trimming other roles.
use bevy_ecs::prelude::*;

// Bridge order: knight, horse archer, horseman, swordsman, archer, spearman,
// pikeman, musketman, field cannon, warrior. Earlier roles retain priority when another role grows.
pub const ROLE_COUNT: usize = 10;
const ARCHER: usize = 4;
const CANNON: usize = 8;
const WARRIOR: usize = 9;

#[derive(Resource, Default)]
pub struct RetinueComposition(pub [f64; ROLE_COUNT], pub [f64; ROLE_COUNT * 2], pub [f64; ROLE_COUNT]);

impl RetinueComposition {
    /// Quotas include outbound trainees. Copper only gates new spear issues;
    /// a lost mine leaves the requested spear quota intact.
    pub fn recruit(&self, schools: u64, spears_available: bool) -> usize {
        for role in [CANNON, 0, 1, 2, 4, 5, 6, 7, 3] {
            if self.2[role] >= self.1[ROLE_COUNT + role] || role == 5 && !spears_available { continue; }
            if school_available(role, schools) { return role; }
        }
        WARRIOR
    }
    /// Effective quotas and whole-slot targets share one ordered allocation.
    /// Called on composition/recruitment decisions, never per animation frame.
    pub fn plan(&mut self, total: f64, unlocked: u32) -> *const f64 {
        let mut remaining = 1.0;
        let mut slots = total.max(0.0).floor();
        for role in 0..ROLE_COUNT {
            let fraction = if role == WARRIOR { remaining }
                else if unlocked & (1 << role) == 0 || !self.0[role].is_finite() { 0.0 }
                else { self.0[role].clamp(0.0, 1.0).min(remaining) };
            let target = if role == WARRIOR { slots } else { (total * fraction).round().min(slots) };
            self.1[role] = fraction;
            self.1[ROLE_COUNT + role] = target;
            remaining = (remaining - fraction).max(0.0);
            slots -= target;
        }
        self.1.as_ptr()
    }
    pub fn set_fraction(&mut self, role: usize, fraction: f64, schools: u64, unlocked: u32) -> bool {
        if role >= ROLE_COUNT || !fraction.is_finite() || !(0.0..=1.0).contains(&fraction) {
            return false;
        }
        let available = |role: usize| role == WARRIOR || unlocked & (1 << role) != 0 && school_available(role, schools);
        if fraction > 0.0 && !available(role) { return false; }
        // Work in whole percentage points so repeated edits cannot accumulate
        // floating-point oversubscription or hide a one-percent allocation.
        let mut shares = [0_i32; ROLE_COUNT];
        let mut remaining = 100;
        for (index, value) in self.0[..WARRIOR].iter().enumerate() {
            let value = if value.is_finite() { (value.clamp(0.0, 1.0) * 100.0).round() as i32 } else { 0 };
            shares[index] = value.min(remaining);
            remaining -= shares[index];
        }
        shares[WARRIOR] = remaining;
        let requested = (fraction * 100.0).round() as i32;
        // Warriors are the baseline role, so returning specialists never
        // requires Archery research. Reducing warriors needs a real school
        // for the receiving specialty instead of creating an unusable quota.
        if role == WARRIOR && requested < shares[WARRIOR] {
            let receiver = [ARCHER, 0, 1, 2, 3, 5, 6, 7, CANNON].into_iter().find(|&index| available(index));
            let Some(receiver) = receiver else { return false; };
            shares[receiver] += shares[WARRIOR] - requested;
        }
        shares[role] = requested;
        let mut overflow = (shares.iter().sum::<i32>() - 100).max(0);
        for index in (0..ROLE_COUNT).rev() {
            if index == role { continue; }
            let removed = shares[index].min(overflow);
            shares[index] -= removed;
            overflow -= removed;
        }
        shares[WARRIOR] += 100 - shares.iter().sum::<i32>();
        for (value, share) in self.0.iter_mut().zip(shares) { *value = share as f64 / 100.0; }
        true
    }
}

/// Role multipliers relative to an ordinary warrior; scout is the last row.
/// Musketmen have 80 HP, 25.5 attack, 3 defense, normal foot speed and 6.5-tile range.
pub fn stat(role: usize, field: usize) -> f64 {
    const STATS: [[f64; 5]; 11] = [
        [1.8, 2.5, 2.5, 1.45, 1.3], [0.8, 0.8, 0.5, 1.65, 4.5],
        [1.0, 1.5, 0.75, 1.65, 1.4], [1.0, 2.0, 1.0, 1.0, 1.1],
        [2.0 / 3.0, 0.8, 0.5, 1.0, 4.0], [1.0, 1.0, 1.5, 1.0, 1.4],
        [1.0, 1.0, 2.25, 1.0, 1.75], [0.8, 1.5, 0.75, 1.0, 6.5],
        [2.0, 0.8 * 4.0 / 0.95 * 5.0, 0.75, 0.5, super::field_cannons::RANGE],
        [1.0, 1.0, 1.0, 1.0, 1.1], [1.0, 0.0, 1.0, 1.2, 0.0],
    ];
    STATS.get(role).and_then(|row| row.get(field)).copied().unwrap_or(f64::NAN)
}

pub fn upkeep(kind: u32) -> f64 {
    use super::kinds::unit::*;
    match kind { FIELD_CANNON => super::field_cannons::UPKEEP, KNIGHT | MUSKETMAN => 2.0, HORSE_ARCHER => 1.5, HORSEMAN | ARCHER => 1.0, _ => 0.5 }
}

pub fn attack_timing(kind: u32, animation: bool) -> f64 {
    use super::kinds::unit::*;
    if kind == FIELD_CANNON { return if animation { 0.74 } else { 4.0 }; }
    if animation { if kind == MUSKETMAN { 7.0 / 12.0 } else { 0.28 } }
    else { match kind { MUSKETMAN => 2.5, LEADER => 0.75, _ => 0.95 } }
}

pub fn training_school(role: usize, building: u32) -> bool {
    use super::kinds::building::*;
    match role { 0..=2 => building == STABLE, 3 | 5 => building == BLACKSMITH,
        4 => building == ARCHERY_RANGE, 6 | 7 => building == BARRACKS,
        CANNON => building == FOUNDRY,
        WARRIOR => matches!(building, STABLE | BLACKSMITH | ARCHERY_RANGE | BARRACKS | FOUNDRY), _ => false }
}

pub fn school_available(role: usize, schools: u64) -> bool {
    role == WARRIOR || (0..64).any(|kind| schools & (1_u64 << kind) != 0 && training_school(role, kind))
}

pub fn fraction(raw: f64, remaining: f64, unlocked: bool) -> f64 {
    if !unlocked || !raw.is_finite() { 0.0 } else { raw.clamp(0.0, 1.0).min(remaining.max(0.0)) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sim::kinds::building::{ARCHERY_RANGE, BLACKSMITH};

    #[test]
    fn specialists_need_their_completed_school_for_commands_and_recruits() {
        let mut composition = RetinueComposition::default();
        assert!(!composition.set_fraction(ARCHER, 1.0, 1 << BLACKSMITH, u32::MAX));
        assert!(composition.set_fraction(ARCHER, 1.0, 1 << ARCHERY_RANGE, u32::MAX));
        composition.plan(4.0, u32::MAX);
        assert_eq!(composition.recruit(1 << BLACKSMITH, true), WARRIOR);
        assert_eq!(composition.recruit(1 << ARCHERY_RANGE, true), ARCHER);
    }

    #[test]
    fn archers_can_return_to_warriors_without_archery_research() {
        let mut composition = RetinueComposition::default();
        composition.0[ARCHER] = 1.0;
        assert!(composition.set_fraction(WARRIOR, 1.0, 1 << BLACKSMITH, 1 << WARRIOR));
        assert_eq!(composition.0[ARCHER], 0.0);
        assert_eq!(composition.0[WARRIOR], 1.0);
        composition.plan(4.0, 1 << WARRIOR);
        assert_eq!(composition.1[ROLE_COUNT + WARRIOR], 4.0);
    }

    #[test]
    fn reducing_warriors_uses_a_trainable_specialty_and_cannot_create_a_locked_quota() {
        let mut composition = RetinueComposition::default();
        assert!(!composition.set_fraction(WARRIOR, 0.0, 1 << BLACKSMITH, 1 << WARRIOR));
        assert!(composition.set_fraction(WARRIOR, 0.5, 1 << BLACKSMITH, (1 << WARRIOR) | (1 << 3)));
        assert_eq!(composition.0[3], 0.5);
        assert_eq!(composition.0[WARRIOR], 0.5);
    }
}

/// Weapon choice follows faction research without changing unit identity.
pub fn uses_firearm(kind: u32, gunpowder: bool) -> bool {
    use super::kinds::unit::*;
    kind == MUSKETMAN || kind == LEADER && gunpowder
}
