//! Resident forest habitat and bounded deer herd placement and steering.
use super::rng::Mulberry32;
use bevy_ecs::prelude::*;
use std::f64::consts::TAU;

const WALKABLE: u8 = 1;
const FOREST: u8 = 2;
const WOODED: u8 = 4;
const HABITAT_REACH: u8 = 3;
const HERD_SPACING: i32 = 9;
const MAX_HERDS: usize = 16;
const MAX_HERD_SIZE: usize = 5;
const SPAWN_ATTEMPTS_PER_HERD: usize = 640;
const CARDINAL: [(i32, i32, u8); 4] = [(0, -1, 1), (1, 0, 4), (0, 1, 6), (-1, 0, 3)];

pub fn stat(index: u32) -> f64 {
    match index {
        0 => 14.0,
        1 => 10.0,
        2 => 4.5,
        3 => 14.0,
        4 => 26.0,
        5 => 6.0,
        6 => 0.85,
        7 => 3.8,
        _ => 0.0,
    }
}

#[derive(Resource, Default)]
pub struct DeerHerds {
    width: usize,
    height: usize,
    terrain: Vec<u8>,
    forest_distance: Vec<u8>,
    habitat_queue: Vec<usize>,
    sites: Vec<usize>,
    excluded: Vec<u8>,
    output: Vec<f64>,
}

impl DeerHerds {
    /// One pair of bytes per cell: habitat flags and native navigation edges.
    pub fn prepare_terrain(&mut self, width: usize, height: usize) -> *mut u8 {
        self.width = width;
        self.height = height;
        self.terrain.resize(width * height * 2, 0);
        self.terrain.as_mut_ptr()
    }

    fn at(&self, x: i32, y: i32) -> Option<usize> {
        if x >= 0 && y >= 0 && x < self.width as i32 && y < self.height as i32 {
            Some(y as usize * self.width + x as usize)
        } else {
            None
        }
    }

    fn coords(&self, cell: usize) -> (i32, i32) {
        ((cell % self.width) as i32, (cell / self.width) as i32)
    }

    fn walkable(&self, cell: usize) -> bool {
        self.terrain[cell * 2] & WALKABLE != 0
    }

    fn habitat(&self, cell: usize) -> bool {
        let flags = self.terrain[cell * 2];
        flags & WALKABLE != 0
            && (self.forest_distance[cell] <= 1
                || (flags & WOODED != 0 && self.forest_distance[cell] <= HABITAT_REACH))
    }

    pub fn finish_terrain(&mut self) -> usize {
        self.habitat_queue.clear();
        self.sites.clear();
        self.forest_distance.resize(self.width * self.height, u8::MAX);
        self.forest_distance.fill(u8::MAX);
        for (cell, row) in self.terrain.chunks_exact(2).enumerate() {
            if row[0] & FOREST != 0 {
                self.forest_distance[cell] = 0;
                self.habitat_queue.push(cell);
            }
        }
        let mut head = 0;
        while head < self.habitat_queue.len() {
            let cell = self.habitat_queue[head];
            let distance = self.forest_distance[cell];
            head += 1;
            if distance == HABITAT_REACH {
                continue;
            }
            let (x, y) = self.coords(cell);
            for (dx, dy, _) in CARDINAL {
                let Some(next) = self.at(x + dx, y + dy) else { continue };
                if self.forest_distance[next] == u8::MAX && self.walkable(next) {
                    self.forest_distance[next] = distance + 1;
                    self.habitat_queue.push(next);
                }
            }
        }
        for cell in 0..self.forest_distance.len() {
            if self.habitat(cell) {
                self.sites.push(cell);
            }
        }
        self.capacity()
    }

    fn capacity(&self) -> usize {
        if self.sites.len() < 16 {
            0
        } else {
            (self.sites.len() / 650).clamp(1, MAX_HERDS)
        }
    }

    /// Host observations are packed once for the entire spawn batch.
    pub fn prepare_spawn(&mut self, count: usize) -> *mut u8 {
        self.excluded.resize(count, 0);
        self.excluded.fill(0);
        self.excluded.as_mut_ptr()
    }

    pub fn exclude_herd(&mut self, x: f64, y: f64) {
        if self.excluded.len() != self.width * self.height || !x.is_finite() || !y.is_finite() {
            return;
        }
        let (cx, cy) = (x.floor() as i32, y.floor() as i32);
        if self.at(cx, cy).is_none() {
            return;
        }
        for dy in -HERD_SPACING..=HERD_SPACING {
            for dx in -HERD_SPACING..=HERD_SPACING {
                if dx * dx + dy * dy <= HERD_SPACING * HERD_SPACING {
                    if let Some(cell) = self.at(cx + dx, cy + dy) {
                        self.excluded[cell] = 1;
                    }
                }
            }
        }
    }

    fn herd_cells(&self, home: usize, size: usize, cells: &mut Vec<usize>) {
        let (hx, hy) = self.coords(home);
        cells.clear();
        cells.push(home);
        let mut head = 0;
        while head < cells.len() && cells.len() < size {
            let cell = cells[head];
            head += 1;
            let (x, y) = self.coords(cell);
            for (dx, dy, direction) in CARDINAL {
                let (nx, ny) = (x + dx, y + dy);
                if (nx - hx).abs() + (ny - hy).abs() > 3
                    || self.terrain[cell * 2 + 1] & (1 << direction) == 0
                {
                    continue;
                }
                let Some(next) = self.at(nx, ny) else { continue };
                if self.excluded[next] == 0 && self.habitat(next) && !cells.contains(&next) {
                    cells.push(next);
                    if cells.len() == size {
                        return;
                    }
                }
            }
        }
    }

    /// [animal count], followed by [batch group, cell, sex, heading].
    pub fn spawn(&mut self, seed: u32, groups: usize) -> *const f64 {
        self.output.clear();
        self.output.push(0.0);
        let groups = groups.min(self.capacity());
        if groups == 0 || self.excluded.len() != self.width * self.height {
            return self.output.as_ptr();
        }
        let mut rng = Mulberry32::new(seed);
        let count = self.sites.len();
        let mut next = rng.next_u32() as usize % count;
        let mut stride = 1 + rng.next_u32() as usize % (count - 1);
        // Visit distinct habitat sites without copying or reordering the
        // persistent index; a respawn can stop as soon as a home is found.
        while gcd(stride, count) != 1 {
            stride += 1;
        }
        let mut group = 0;
        let mut cells = Vec::with_capacity(MAX_HERD_SIZE);
        for _ in 0..count.min(groups * SPAWN_ATTEMPTS_PER_HERD) {
            let home = self.sites[next];
            next = (next + stride) % count;
            if self.excluded[home] != 0 {
                continue;
            }
            let wooded = self.terrain[home * 2] & WOODED != 0;
            if self.forest_distance[home] > 0 && rng.next_f64() < if wooded { 0.26 } else { 0.52 } {
                continue;
            }
            let size = 2 + rng.next_u32() as usize % (MAX_HERD_SIZE - 1);
            self.herd_cells(home, size, &mut cells);
            if cells.len() < 2 {
                continue;
            }
            let male = rng.next_u32() as usize % cells.len();
            for (index, &cell) in cells.iter().enumerate() {
                self.output.extend([group as f64, cell as f64, f64::from(u8::from(index == male)), rng.next_f64() * TAU]);
            }
            let (x, y) = self.coords(home);
            self.exclude_herd(f64::from(x), f64::from(y));
            group += 1;
            if group == groups {
                break;
            }
        }
        self.output[0] = ((self.output.len() - 1) / 4) as f64;
        self.output.as_ptr()
    }

    /// At most 24 sampled local targets plus the adjacent cells. The game
    /// checks the ranked candidates using its shared swept movement rules.
    pub fn waypoints(&mut self, origin: (f64, f64), home: (f64, f64), threat: Option<(f64, f64)>,
        seed: u32) -> *const f64 {
        self.output.clear();
        self.output.push(0.0);
        if self.at(origin.0.floor() as i32, origin.1.floor() as i32).is_none()
            || self.forest_distance.len() != self.width * self.height
        {
            return self.output.as_ptr();
        }
        let mut rng = Mulberry32::new(seed);
        let (x, y) = origin;
        let preferred = threat.map_or_else(|| rng.next_f64() * TAU, |(tx, ty)| (y - ty).atan2(x - tx));
        let mut candidates = Vec::with_capacity(32);
        let mut add = |cx: i32, cy: i32| {
            let Some(cell) = self.at(cx, cy) else { return };
            if !self.walkable(cell) || candidates.iter().any(|&(other, _)| other == cell) {
                return;
            }
            let (px, py) = (f64::from(cx) + 0.5, f64::from(cy) + 0.5);
            let length = (px - x).hypot(py - y);
            if length < 0.5 {
                return;
            }
            let cover = if self.habitat(cell) { 1.5 } else { 0.0 };
            let score = if let Some((tx, ty)) = threat {
                (px - tx).hypot(py - ty) - length * 0.18 + cover * 0.7
            } else {
                cover + length * 0.25 - (px - home.0).hypot(py - home.1) * 0.4
            };
            candidates.push((cell, score));
        };
        for sample in 0..24 {
            let angle = if sample == 0 { preferred } else { preferred + (rng.next_f64() - 0.5) * TAU };
            let reach = if threat.is_some() { 2.5 + rng.next_f64() * 4.5 } else { 1.2 + rng.next_f64() * 2.4 };
            add((x + angle.cos() * reach).floor() as i32, (y + angle.sin() * reach).floor() as i32);
        }
        let (cx, cy) = (x.floor() as i32, y.floor() as i32);
        for dy in -1..=1 {
            for dx in -1..=1 {
                if dx != 0 || dy != 0 {
                    add(cx + dx, cy + dy);
                }
            }
        }
        candidates.sort_unstable_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        self.output[0] = candidates.len() as f64;
        for (cell, _) in candidates {
            let (x, y) = self.coords(cell);
            self.output.extend([f64::from(x) + 0.5, f64::from(y) + 0.5]);
        }
        self.output.as_ptr()
    }
}

fn gcd(mut a: usize, mut b: usize) -> usize {
    while b != 0 {
        (a, b) = (b, a % b);
    }
    a
}
