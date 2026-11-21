//! Deduplicate tiles entered by outbound farm couriers during one movement pass.
use bevy_ecs::prelude::Resource;
use rustc_hash::FxHashSet;

use super::structures::StructureIndex;

#[derive(Resource, Default)]
pub struct FarmRoads {
    seen: FxHashSet<u32>,
    crossed: Vec<(u32, i32)>,
    output: Vec<f64>,
}

impl FarmRoads {
    pub fn record(&mut self, width: u32, height: u32, faction: i32, from: [f64; 2], to: [f64; 2]) {
        let bounds = [f64::from(width), f64::from(height)];
        if faction < 0 || [from, to].iter().any(|point| {
            (0..2).any(|axis| !point[axis].is_finite() || point[axis] < 0.0 || point[axis] >= bounds[axis])
        }) {
            return;
        }
        let mut cell = from.map(|value| value.floor() as i32);
        let end = to.map(|value| value.floor() as i32);
        if cell == end { return; }

        // At an exact corner only the diagonal tile is entered.
        let delta = [to[0] - from[0], to[1] - from[1]];
        let step = delta.map(|value| if value < 0.0 { -1 } else { 1 });
        loop {
            let key = cell[1] as u32 * width + cell[0] as u32;
            if self.seen.insert(key) { self.crossed.push((key, faction)); }
            if cell == end { break; }
            let crossing = [0, 1].map(|axis| {
                if cell[axis] == end[axis] { return f64::INFINITY; }
                let boundary = cell[axis] + i32::from(step[axis] > 0);
                (f64::from(boundary) - from[axis]) / delta[axis]
            });
            let next = crossing[0].min(crossing[1]);
            for axis in 0..2 {
                if crossing[axis] <= next { cell[axis] += step[axis]; }
            }
        }
    }

    pub fn pending(&self) -> bool { !self.crossed.is_empty() }

    pub fn take(&mut self, structures: &StructureIndex) -> *const f64 {
        let width = structures.width() as u32;
        self.output.clear();
        self.output.push(0.0);
        self.seen.clear();
        for (cell, faction) in self.crossed.drain(..) {
            if !structures.occupied_at(f64::from(cell % width), f64::from(cell / width)) {
                self.output.extend([f64::from(cell), f64::from(faction)]);
            }
        }
        self.output[0] = ((self.output.len() - 1) / 2) as f64;
        self.output.as_ptr()
    }
}
