//! Lifetime campaign counters. Receipts and deaths are recorded at their
//! existing mutation sites; no entity scans or balance polling are needed.
use bevy_ecs::prelude::*;
use std::collections::{BTreeMap, BTreeSet};
use super::kinds::unit;

#[derive(Resource, Default)]
pub struct Campaign {
    rows: BTreeMap<i32, [f64; 5]>,
    deaths: BTreeSet<i64>,
    kills: BTreeSet<i64>,
    output: [f64; 5],
}
impl Campaign {
    /// Categories use the host ledger's declaration order. Refunds,
    /// transfers are cash flow rather than gathered gold. Other receipts
    /// include quest rewards and settlement development bonuses.
    pub fn income(&mut self, faction: i32, amount: f64, category: u32) {
        if amount.is_finite() && amount > 0.0 && (category < 5 || category == 7) {
            self.rows.entry(faction).or_default()[0] += amount;
        }
    }
    pub fn casualty(&mut self, id: i64, faction: i32, kind: u32, killer: i32, hostile: bool) {
        if matches!(kind, unit::BOAR | unit::MARSH_BIRD | unit::DEER | unit::BUFFALO | unit::ELEPHANT | unit::OSTRICH)
            || unit::livestock(kind) { return; }
        if self.deaths.insert(id) { self.rows.entry(faction).or_default()[2] += 1.0; }
        if hostile && killer != faction && self.kills.insert(id) {
            self.rows.entry(killer).or_default()[1] += 1.0;
        }
    }
    pub fn researched(&mut self, faction: i32) { self.rows.entry(faction).or_default()[3] += 1.0; }
    /// Deduplication lasts until normal entity cleanup. IDs allocated after a
    /// save restore may reuse a removed entity's number.
    pub fn forget(&mut self, id: i64) { self.deaths.remove(&id); self.kills.remove(&id); }
    pub fn population(&mut self, faction: i32, population: f64) {
        if population.is_finite() { let row = self.rows.entry(faction).or_default(); row[4] = row[4].max(population); }
    }
    pub fn population_goal(&self, faction: i32, goal: f64) -> bool {
        self.rows.get(&faction).is_some_and(|row| row[4] >= goal)
    }
    pub fn view(&mut self, faction: i32) -> *const f64 {
        self.output = self.rows.get(&faction).copied().unwrap_or_default(); self.output.as_ptr()
    }
    pub fn snapshot(&self) -> Vec<f64> {
        let mut out = vec![self.rows.len() as f64, self.deaths.len() as f64, self.kills.len() as f64];
        for (faction, row) in &self.rows { out.push(*faction as f64); out.extend(row); }
        out.extend(self.deaths.iter().map(|id| *id as f64));
        out.extend(self.kills.iter().map(|id| *id as f64)); out
    }
    pub fn restore(data: &[f64]) -> Option<Self> {
        if data.len() < 3 || data.iter().any(|value| !value.is_finite()) { return None; }
        let count = |value: f64| (value >= 0.0 && value.fract() == 0.0 && value < u32::MAX as f64).then_some(value as usize);
        let (rows, deaths, kills) = (count(data[0])?, count(data[1])?, count(data[2])?);
        if 3usize.checked_add(rows.checked_mul(6)?)?.checked_add(deaths)?.checked_add(kills)? != data.len() { return None; }
        let mut result = Self::default(); let mut cursor = 3;
        for _ in 0..rows {
            let faction = data[cursor] as i32; let mut row = [0.0; 5]; row.copy_from_slice(&data[cursor + 1..cursor + 6]);
            if row.iter().any(|value| *value < 0.0) { return None; }
            result.rows.insert(faction, row); cursor += 6;
        }
        result.deaths.extend(data[cursor..cursor + deaths].iter().map(|id| *id as i64)); cursor += deaths;
        result.kills.extend(data[cursor..].iter().map(|id| *id as i64)); Some(result)
    }
}
