//! Military Academy ownership and drill choices. Structure lifecycle events
//! maintain faction counts; combat reads never scan buildings or retinues.
use bevy_ecs::prelude::*;
use std::collections::BTreeMap;
use super::kinds::{building::MILITARY_ACADEMY, unit};

pub const WIDE: u32 = 0;
pub const STANDARD: u32 = 1;
pub const DEEP: u32 = 2;
pub const SPACING: f64 = 0.72;
pub fn constant(index: u32) -> f64 { match index { 0 => 600.0, 1 => 750.0, _ => f64::NAN } }

#[derive(Component, Clone, Copy)]
pub struct Academy;

#[derive(Clone, Copy, Default)]
struct Faction { unlocked: bool, preference: u32 }

#[derive(Resource, Default)]
pub struct MilitaryAcademies {
    sites: BTreeMap<i64, i32>, counts: BTreeMap<i32, usize>, factions: BTreeMap<i32, Faction>,
}
impl MilitaryAcademies {
    pub fn clear_sites(&mut self) { self.sites.clear(); self.counts.clear(); }
    pub fn remove(&mut self, id: i64) {
        if let Some(faction) = self.sites.remove(&id) {
            if let Some(count) = self.counts.get_mut(&faction) { *count -= 1; if *count == 0 { self.counts.remove(&faction); } }
        }
    }
    pub fn site(&mut self, id: i64, kind: u32, faction: f64, flags: u32) {
        let next = (kind == MILITARY_ACADEMY && faction.is_finite() && flags & 5 == 5).then_some(faction as i32);
        if self.sites.get(&id).copied() == next { return; }
        self.remove(id);
        if let Some(owner) = next { self.sites.insert(id, owner); *self.counts.entry(owner).or_default() += 1; }
    }
    pub fn faction(&mut self, faction: i32, unlocked: bool, preference: u32) {
        self.factions.insert(faction, Faction { unlocked, preference: normalize(preference) });
    }
    pub fn available(&self, faction: i32) -> bool {
        self.factions.get(&faction).is_some_and(|f| f.unlocked) && self.counts.get(&faction).copied().unwrap_or(0) > 0
    }
    pub fn status(&self, faction: i32) -> u32 {
        u32::from(self.factions.get(&faction).is_some_and(|f| f.unlocked))
            | (u32::from(self.counts.get(&faction).copied().unwrap_or(0) > 0) << 1)
    }
    pub fn chosen(&self, faction: i32) -> u32 {
        if self.available(faction) { self.factions.get(&faction).map_or(STANDARD, |f| f.preference) } else { STANDARD }
    }
    pub fn select(&mut self, faction: i32, choice: u32) -> bool {
        if choice > DEEP || !self.available(faction) { return false; }
        self.factions.get_mut(&faction).unwrap().preference = choice;
        true
    }
}

pub fn normalize(choice: u32) -> u32 { if choice <= DEEP { choice } else { STANDARD } }
pub fn depth(choice: u32) -> usize { match normalize(choice) { WIDE => 2, DEEP => 4, _ => 3 } }

/// Exact two/three/four-rank rectangles. A central slot is reserved for the
/// Leader in odd-depth layouts. Count changes only when membership changes.
pub fn offset(count: usize, choice: u32, index: usize, axis: u32) -> f64 {
    if count == 0 || index >= count { return f64::NAN; }
    let rows = depth(choice).min(count);
    let reserve = rows % 2 == 1;
    let total = count + usize::from(reserve);
    let base = total / rows;
    let extra = total % rows;
    // Allocate extras to the center ranks first, keeping the wings even.
    let priority: &[usize] = match rows { 1 => &[0], 2 => &[0, 1], 3 => &[1, 0, 2], _ => &[1, 2, 0, 3] };
    let row_count = |row: usize| base + usize::from(priority[..extra].contains(&row));
    let middle = rows / 2;
    let mut target = index;
    for row in 0..rows {
        let columns = row_count(row);
        let occupied = columns - usize::from(reserve && row == middle);
        if target >= occupied { target -= occupied; continue; }
        let skip = reserve && row == middle && target >= columns / 2;
        let column = target + usize::from(skip);
        return if axis == 0 { (row as f64 - (rows - 1) as f64 / 2.0) * SPACING }
            else { (column as f64 - (columns - 1) as f64 / 2.0) * SPACING };
    }
    f64::NAN
}

pub fn modifier(choice: u32, kind: u32, effect: u32, in_ranks: bool, frontal: bool) -> f64 {
    if !in_ranks { return 1.0; }
    match effect {
        0 if frontal => 1.25,
        1 if frontal && normalize(choice) != WIDE => 1.5,
        2 if normalize(choice) == WIDE && matches!(kind, unit::SLINGER | unit::SKIRMISHER | unit::LEADER | unit::ARCHER | unit::HORSE_ARCHER | unit::MUSKETMAN | unit::FIELD_CANNON) => 1.3,
        _ => 1.0,
    }
}
