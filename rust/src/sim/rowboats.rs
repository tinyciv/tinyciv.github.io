//! Civilian amphibious travel. Navigation profiles are derived terrain caches;
//! only changed cells are submitted, and no per-unit water search is needed.
use bevy_ecs::prelude::*;
use super::kinds::unit;

const ROWBOAT_SPEED_MULTIPLIER: f64 = 0.2;

pub fn eligible(kind: u32, engineer: bool) -> bool { unit::civilian(kind, engineer) }

#[derive(Resource, Default)]
pub struct Rowboats { input: Vec<f64>, output: Vec<f64> }
impl Rowboats {
    /// [cell, land-open, land-cost, navigable-water].
    pub fn prepare(&mut self, count: usize) -> *mut f64 {
        self.input.resize(count * 4, 0.0); self.input.as_mut_ptr()
    }
    /// [cell, open, cost]. Movement and route selection share this travel cost:
    /// rowing takes five times as long as walking on clear ground.
    pub fn profile(&mut self, count: usize) -> *const f64 {
        self.output.clear();
        for row in self.input[..count * 4].chunks_exact(4) {
            let water = row[3] != 0.0 && row[1] == 0.0;
            self.output.extend_from_slice(&[row[0], u8::from(row[1] != 0.0 || water) as f64,
                if water { 1.0 / ROWBOAT_SPEED_MULTIPLIER } else { row[2] }]);
        }
        self.output.as_ptr()
    }
    pub fn aboard(&self, kind: u32, engineer: bool, land: bool, water: bool, bridge: bool) -> bool {
        eligible(kind, engineer) && !land && water && !bridge
    }
}
