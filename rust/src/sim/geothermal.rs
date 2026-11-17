//! One-time landscape placement in the game's ECS. The host mirrors the four
//! occupied cells into its existing impassable volcanic terrain layer.
use bevy_ecs::prelude::*;
use super::rng::Mulberry32;

#[derive(Resource, Default)]
pub struct Geothermal {
    input: Vec<f64>,
    output: Vec<f64>,
}

impl Geothermal {
    /// Input: one [terrain, exclusions] pair per cell, then [x, y] per start.
    pub fn prepare(&mut self, cells: usize, starts: usize) -> *mut f64 {
        self.input.resize((cells + starts) * 2, 0.0);
        self.input.fill(0.0);
        self.input.as_mut_ptr()
    }

    /// Output: count, then [top-left cell, artwork 1..6] for each 2x2 feature.
    pub fn generate(&mut self, width: usize, height: usize, starts: usize, seed: u32) -> *const f64 {
        self.output.clear(); self.output.push(0.0);
        let cells = width.saturating_mul(height);
        if width < 64 || height < 64 || cells > 512 * 512 || self.input.len() != (cells + starts) * 2 {
            return self.output.as_ptr();
        }
        let open = |cell: usize| self.input[cell * 2] > 0.0 && self.input[cell * 2 + 1] == 0.0;
        let dry = (0..cells).filter(|&cell| open(cell)).count();
        let target = (dry / 3000).clamp(6, 30);
        let mut random = Mulberry32::new(seed ^ 0x9e3779b9);
        let mut frequency_random = Mulberry32::new(seed ^ 0x85ebca6b);
        let mut candidates: Vec<(usize, usize)> = Vec::with_capacity(target);
        for _ in 0..target * 800 {
            if candidates.len() == target { break; }
            let x = 2 + random.next_u32() as usize % (width - 5);
            let y = 2 + random.next_u32() as usize % (height - 5);
            // Separate complete footprints, not just their anchor cells.
            if candidates.iter().any(|&(px, py)| x.abs_diff(px).pow(2) + y.abs_diff(py).pow(2) < 16 * 16) { continue; }
            if (0..starts).any(|i| {
                let dx = x as f64 + 1.0 - self.input[(cells + i) * 2];
                let dy = y as f64 + 1.0 - self.input[(cells + i) * 2 + 1];
                dx * dx + dy * dy < 22.0 * 22.0
            }) { continue; }
            // A two-cell ring of ordinary walkable land protects waterways,
            // deposits and ledges, and leaves a complete local bypass. Forest
            // is walkable; only trees inside the actual footprint are replaced.
            if !(y - 2..=y + 3).all(|ny| (x - 2..=x + 3).all(|nx| open(ny * width + nx))) { continue; }
            let variant = candidates.len() % 6 + 1;
            // Thin the original candidate layout independently: volcanoes keep
            // one fifth of their frequency; thermal-bath mud pools keep half.
            // Count skipped candidates so later artwork slots do not shift.
            let keep_chance = if variant <= 3 { 0.2 } else { 0.5 };
            if frequency_random.next_f64() < keep_chance {
                self.output.extend_from_slice(&[(y * width + x) as f64, variant as f64]);
            }
            candidates.push((x, y));
        }
        self.output[0] = ((self.output.len() - 1) / 2) as f64;
        self.output.as_ptr()
    }
}
