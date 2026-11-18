//! Sparse support/combat commands over indexed host observations. Buffers and
//! weapon clocks belong to the game's Bevy World; presentation only mirrors results.
use bevy_ecs::prelude::*;
use super::kinds::{building, unit};
use crate::combat;
use std::collections::BTreeSet;

pub const STRIDE: usize = 12;
pub const RESULT: usize = 3;
const BUILDING: u32 = 1;
const TARGETABLE: u32 = 2;
const HOSTILE: u32 = 4;
const EXPOSED: u32 = 8;
const KEEP: u32 = 16;

#[derive(Resource, Default)]
pub struct BattleSupport {
    pub input: Vec<f64>,
    pub output: Vec<f64>,
    ranked: Vec<(u32, f64, f64)>,
    pub placing_factions: BTreeSet<i64>,
}

impl BattleSupport {
    pub fn prepare(&mut self, count: usize) -> *mut f64 {
        self.input.resize(count * STRIDE, 0.0);
        self.output.resize(1 + count * RESULT, 0.0);
        self.input.as_mut_ptr()
    }
    /// mode 1: local supply delivery; 2: ordered siege targets; 3: splash hits;
    /// 4: tower targets; 5: building objectives; 6: in-place infantry targets.
    /// Rows: [id,x,y,hp,maxHP,faction,kind,flags,range,kills,defense,damage].
    /// Outbox: [count, ...[id,nextHP,healed-or-impact-flags]].
    /// Impact flags: dead=1, eligible for hostile-kill rewards=2.
    pub fn run(&mut self, count: usize, mode: u32, x: f64, y: f64, faction: f64, skip: f64) -> *const f64 {
        self.ranked.clear();
        let mut n = 0;
        for row in 0..count {
            let v = &self.input[row * STRIDE..(row + 1) * STRIDE];
            let flags = v[7] as u32;
            if v[0] == skip || v[3] <= 0.0 { continue; }
            let kind = v[6] as u32;
            let distance = if matches!(mode, 5 | 6) && flags & BUILDING != 0 {
                ((v[1] - x).abs() - building::width(kind) * 0.5).max(0.0)
                    .hypot(((v[2] - y).abs() - building::height(kind) * 0.5).max(0.0))
            } else { (v[1] - x).hypot(v[2] - y) };
            if matches!(mode, 2 | 4 | 5 | 6) {
                if flags & TARGETABLE == 0 || flags & HOSTILE == 0 || distance > v[8] { continue; }
                if matches!(mode, 4 | 5 | 6) && (flags & EXPOSED == 0 || flags & BUILDING != 0
                    && (building::farm(kind) || building::route(kind) || matches!(kind, building::IRRIGATION | building::RUIN))) { continue; }
                let priority = if mode == 5 {
                    if flags & BUILDING == 0 { continue; }
                    building_priority(kind, flags & KEEP != 0)
                } else if mode == 6 {
                    if flags & BUILDING != 0 { 2 + building_priority(kind, flags & KEEP != 0) }
                    else if unit::soldier(kind) || matches!(kind, unit::LEADER | unit::MILITIA) { 0 } else { 1 }
                } else if mode == 4 {
                    if flags & BUILDING != 0 { 2 }
                    else if unit::soldier(kind) || matches!(kind, unit::LEADER | unit::MILITIA) { 0 } else { 1 }
                } else if flags & BUILDING == 0 { 4 }
                    else if matches!(kind, building::TOWER | building::WOODEN_TOWER | building::BALLISTA | building::SIEGE_CANNON) { 0 }
                    else if kind == building::GUARD_POST || flags & KEEP != 0 { 1 }
                    else if building::wall(kind) { 2 } else { 3 };
                self.ranked.push((priority, distance, v[0]));
            } else if mode == 1 {
                if v[5] != faction || distance > 8.0 { continue; }
                let next = v[4].min(v[3] + 10.0).max(v[3]);
                if next <= v[3] { continue; }
                self.output[1 + n * RESULT..1 + (n + 1) * RESULT].copy_from_slice(&[v[0], next, next - v[3]]);
                n += 1;
            } else if mode == 3 {
                // Splash affects both sides and placed construction sites;
                // hidden passengers and roads cannot be hit. Skip the direct target once.
                if distance > 2.0 || flags & TARGETABLE == 0 || flags & EXPOSED == 0
                    || flags & BUILDING != 0 && building::route(kind) { continue; }
                let damage = v[11] * 0.5;
                let damage = if flags & BUILDING != 0 { damage }
                    else { combat::incoming_damage(v[9], damage * combat::CANNON_UNIT_DAMAGE_MULTIPLIER) / v[10].max(0.01) };
                let next = (v[3] - damage).max(0.0);
                let result = (next <= 0.0) as u32 | if flags & HOSTILE != 0 { 2 } else { 0 };
                self.output[1 + n * RESULT..1 + (n + 1) * RESULT].copy_from_slice(&[v[0], next, result as f64]);
                n += 1;
            }
        }
        if matches!(mode, 2 | 4 | 5 | 6) {
            self.ranked.sort_by(|a,b| a.0.cmp(&b.0).then(a.1.total_cmp(&b.1)).then(a.2.total_cmp(&b.2)));
            for &(_,_,id) in &self.ranked { self.output[1 + n * RESULT..1 + (n + 1) * RESULT].copy_from_slice(&[id,0.0,0.0]); n += 1; }
        }
        self.output[0] = n as f64;
        self.output.as_ptr()
    }
}

fn building_priority(kind: u32, keep: bool) -> u32 {
    if building::defensive(kind) || matches!(kind, building::BALLISTA | building::SIEGE_CANNON) { 0 }
    else if keep { 1 }
    else if building::wall(kind) { 3 }
    else { 2 }
}

/// A Keep is an armed objective itself, so its neighboring defenses must not
/// hide it from acquisition or redirect an explicit attack onto another building.
pub fn city_defended(kind: u32, level: u32) -> bool { kind == building::PALACE && level != 2 }

/// A ready musket can fire before movement/yield/evasion consumes its update.
/// Explicit recall and attack orders retain their own command handling.
pub fn ready_shot(kind: u32, cooldown: f64, attack: f64, recall: bool, forced: bool) -> bool {
    kind == unit::MUSKETMAN && cooldown <= 0.0 && attack > 0.0 && !recall && !forced
}

pub fn farm_site(stair: u32) -> bool { stair == 0 }
pub fn governor_purchase(faction: f64, placing_faction: f64, placing: bool, kind: u32) -> bool {
    !(placing && faction == placing_faction && matches!(kind, building::CAMP | building::HOUSE))
}
pub fn siege_attack(cannon: bool, attack: f64) -> f64 { attack * if cannon { 5.0 } else { 1.0 } }
pub fn siege_cooldown(cooldown: f64, dt: f64, fired: bool) -> f64 {
    if fired { 4.0 } else { (cooldown - dt).max(0.0) }
}
pub fn tower_cooldown(cooldown: f64, dt: f64, fired: bool) -> f64 {
    if fired { 0.75 } else { (cooldown - dt).max(0.0) }
}

/// Four six-tile orthogonal arms from the perimeter's corners, proceeding
/// clockwise. They avoid the eight existing house sites and remain walkable.
pub fn road_arm(corner: u32, step: u32) -> (f64, f64) {
    let d = step as f64 + 1.0;
    match corner { 0 => (-1.0, -1.0-d), 1 => (2.0+d, -1.0), 2 => (2.0, 2.0+d), _ => (-1.0-d, 2.0) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn structure(id: f64, kind: u32, x: f64, extra: u32) -> [f64; STRIDE] {
        [id, x, 0.0, 100.0, 100.0, 1.0, kind as f64,
            (BUILDING | TARGETABLE | HOSTILE | EXPOSED | extra) as f64, 10.0, 0.0, 1.0, 100.0]
    }

    #[test]
    fn nearby_keep_precedes_closer_civilian_property_but_defenses_still_lead() {
        let mut support = BattleSupport::default();
        let rows = [structure(1.0, building::HOUSE, 1.0, 0),
            structure(2.0, building::PALACE, 5.0, KEEP),
            structure(3.0, building::TOWER, 7.0, 0)];
        support.prepare(rows.len());
        for (index, row) in rows.iter().enumerate() { support.input[index * STRIDE..(index + 1) * STRIDE].copy_from_slice(row); }
        support.run(rows.len(), 5, 0.0, 0.0, 0.0, -1.0);
        assert_eq!(support.output[0], 3.0);
        assert_eq!([support.output[1], support.output[4], support.output[7]], [3.0, 2.0, 1.0]);
        assert!(city_defended(building::PALACE, 1));
        assert!(!city_defended(building::PALACE, 2));
    }

    #[test]
    fn cannon_splash_halves_damage_to_units_and_preserves_road_and_bridge_immunity() {
        let mut support = BattleSupport::default();
        let soldier = [4.0, 0.5, 0.0, 100.0, 100.0, 0.0, unit::WARRIOR as f64,
            (TARGETABLE | EXPOSED) as f64, 10.0, 0.0, 1.0, 100.0];
        let rows = [structure(1.0, building::ROAD, 0.5, 0),
            structure(2.0, building::BRIDGE, 0.5, 0), structure(3.0, building::HOUSE, 0.5, 0), soldier];
        support.prepare(rows.len());
        for (index, row) in rows.iter().enumerate() { support.input[index * STRIDE..(index + 1) * STRIDE].copy_from_slice(row); }
        support.run(rows.len(), 3, 0.0, 0.0, 0.0, -1.0);
        assert_eq!(support.output[..7], [2.0, 3.0, 50.0, 2.0, 4.0, 75.0, 0.0]);
    }
}
