use std::collections::VecDeque;

pub const COLD_LAND: u8 = 1;
const SNOW_GROUND: u8 = 2;
const OPEN_SEA: u8 = 4;
const COLD_SEA: u8 = 8;
const SEA_ICE: u16 = 1 << 15;
pub const SNOW_SPEED: f64 = 0.7;
pub const POLAR_SEA_LANE_WIDTH: usize = 5;

const COAST_RANGE: u8 = 11;

struct Shape {
    width: usize,
    height: usize,
    cells: Vec<(usize, usize)>,
    first_frame: u16,
}

fn shapes() -> Vec<Shape> {
    // The art packer reads the same footprints and packs occupied cells in row order.
    let mut first_frame = 1;
    include_str!("frost-shapes.txt").trim().split("\n\n").map(|shape| {
        let rows: Vec<_> = shape.lines().collect();
        let cells: Vec<_> = rows.iter().enumerate().flat_map(|(y, row)| {
            row.bytes().enumerate().filter(|&(_, value)| value == b'#').map(move |(x, _)| (x, y))
        }).collect();
        let result = Shape { width: rows[0].len(), height: rows.len(), cells, first_frame };
        first_frame += result.cells.len() as u16;
        result
    }).collect()
}

#[derive(Default)]
pub struct WinterTerrain {
    terrain: Vec<u8>,
    art: Vec<u16>,
}

impl WinterTerrain {
    pub fn input(&mut self, count: usize) -> *mut u8 {
        self.terrain.resize(count, 0);
        self.terrain.as_mut_ptr()
    }

    pub fn generate(&mut self, width: usize, height: usize, seed: u32) -> *const u16 {
        self.art.clear();
        self.art.resize(width * height, 0);
        let coast = cold_coast(&self.terrain, width, height);
        let shapes = shapes();
        self.scatter_ice(width, height, seed ^ 0xe558_1dcd, &coast, &shapes);
        self.snow_bands(width, height, seed);
        self.art.as_ptr()
    }

    fn scatter_ice(&mut self, width: usize, height: usize, seed: u32, coast: &[u8], shapes: &[Shape]) {
        let spacing = 14;
        let separation = 4;
        for top in (0..height).step_by(spacing) {
            for left in (0..width).step_by(spacing) {
                let columns = spacing.min(width - left);
                let rows = spacing.min(height - top);
                let slot = mix(seed ^ (top * width + left) as u32);
                for step in 0..columns * rows {
                    let index = (step + slot as usize % (columns * rows)) % (columns * rows);
                    let x = left + index % columns;
                    let y = top + index / columns;
                    let cell = y * width + x;
                    let eligible = |cell: usize| (2..=COAST_RANGE).contains(&coast[cell]);
                    if !eligible(cell) { continue; }

                    let variant = mix(slot ^ cell as u32) as usize % shapes.len();
                    let shape = &shapes[variant];
                    let (w, h) = (shape.width, shape.height);
                    if x == 0 || x + w >= width || y < POLAR_SEA_LANE_WIDTH || y + h > height.saturating_sub(POLAR_SEA_LANE_WIDTH) { continue; }
                    if !shape.cells.iter().all(|&(dx, dy)| eligible((y + dy) * width + x + dx)) { continue; }
                    // Keep at least one clear marine cell on every side. A
                    // floe must not seal a river mouth or a narrow inlet.
                    if !(y - 1..=y + h).all(|ny| (x - 1..=x + w)
                        .all(|nx| self.terrain[ny * width + nx] & OPEN_SEA != 0)) { continue; }
                    if (y.saturating_sub(separation)..(y + h + separation).min(height)).any(|ny|
                        (x.saturating_sub(separation)..(x + w + separation).min(width))
                            .any(|nx| self.art[ny * width + nx] != 0)) { continue; }

                    for (offset, &(dx, dy)) in shape.cells.iter().enumerate() {
                        self.art[(y + dy) * width + x + dx] = SEA_ICE | (shape.first_frame + offset as u16);
                    }
                    break;
                }
            }
        }
    }

    fn snow_bands(&mut self, width: usize, height: usize, seed: u32) {
        let north = POLAR_SEA_LANE_WIDTH;
        let span = ((height - 1) as f64 * 0.12 - north as f64).max(1.0);
        let south = (north + span.ceil() as usize).min(height);
        for x in 0..width {
            // A broad northern cover gives way to a thinner, broken belt.
            // The two shorelines meander together over different distances.
            let bend = 0.17 * (smooth_noise(seed, x, 32) - 0.5);
            let detail = 0.14 * (smooth_noise(seed ^ 0x58fa_bec5, x, 9) - 0.5);
            let edge = 0.48 + bend + detail;
            let outer = 0.76 + bend - 0.5 * detail;
            let continuity = smooth_noise(seed ^ 0x7b1c_262d, x, 20);
            let half_width = 0.19 * (continuity - 0.25).max(0.0);
            for y in north..south {
                let cell = y * width + x;
                if self.terrain[cell] & SNOW_GROUND == 0 { continue; }
                let latitude = (y - north) as f64 / span;
                if latitude <= edge || (latitude - outer).abs() < half_width {
                    self.art[cell] = 1;
                }
            }
        }

        // The frame depends on the eight neighboring snow cells. All frames
        // are nonzero, so this pass can use the same buffer as the snow mask.
        const NEIGHBORS: [(isize, isize); 8] = [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)];
        for y in north..south {
            for x in 0..width {
                let cell = y * width + x;
                if !is_snow(self.art[cell]) { continue; }
                let mut mask = 0_u16;
                for (bit, (dx, dy)) in NEIGHBORS.into_iter().enumerate() {
                    let (Some(nx), Some(ny)) = (x.checked_add_signed(dx), y.checked_add_signed(dy)) else { continue; };
                    if nx < width && ny < height && is_snow(self.art[ny * width + nx]) {
                        mask |= 1 << bit;
                    }
                }
                self.art[cell] = if mask == 255 { snow_interior(seed, x, y) } else { mask + 1 };
            }
        }
    }
}

fn is_snow(frame: u16) -> bool { frame != 0 && frame & SEA_ICE == 0 }

fn smooth_noise(seed: u32, x: usize, spacing: usize) -> f64 {
    let index = (x / spacing) as u32;
    let fraction = (x % spacing) as f64 / spacing as f64;
    let weight = fraction * fraction * (3.0 - 2.0 * fraction);
    let a = mix(seed ^ index) as f64 / u32::MAX as f64;
    let b = mix(seed ^ (index + 1)) as f64 / u32::MAX as f64;
    a + (b - a) * weight
}

fn snow_interior(seed: u32, x: usize, y: usize) -> u16 {
    // Sample continuous parts of the two authored textures among plain snow.
    let block = (x / 8) as u32 ^ ((y / 6) as u32).wrapping_mul(0x9e37_79b9);
    let (x, y) = (x % 8, y % 6);
    match mix(seed ^ block) & 3 {
        0 if x < 5 && y < 4 => 257 + (y * 5 + x) as u16,
        1 if (2..5).contains(&x) && (1..4).contains(&y) => 277 + ((y - 1) * 3 + x - 2) as u16,
        _ => 256,
    }
}

fn cold_coast(terrain: &[u8], width: usize, height: usize) -> Vec<u8> {
    let mut distance = vec![u8::MAX; terrain.len()];
    let mut queue = VecDeque::new();
    for (cell, &flags) in terrain.iter().enumerate() {
        if flags & COLD_LAND != 0 {
            distance[cell] = 0;
            queue.push_back(cell);
        }
    }
    while let Some(cell) = queue.pop_front() {
        if distance[cell] == COAST_RANGE { continue; }
        let x = cell % width;
        let y = cell / width;
        let mut visit = |next: usize| {
            if distance[next] == u8::MAX && terrain[next] & (COLD_SEA | OPEN_SEA) == COLD_SEA | OPEN_SEA {
                distance[next] = distance[cell] + 1;
                queue.push_back(next);
            }
        };
        if x > 0 { visit(cell - 1); }
        if x + 1 < width { visit(cell + 1); }
        if y > 0 { visit(cell - width); }
        if y + 1 < height { visit(cell + width); }
    }
    distance
}

fn mix(mut value: u32) -> u32 {
    value ^= value >> 16;
    value = value.wrapping_mul(0x7feb_352d);
    value ^= value >> 15;
    value = value.wrapping_mul(0x846c_a68b);
    value ^ (value >> 16)
}
