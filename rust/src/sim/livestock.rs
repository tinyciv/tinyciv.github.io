//! Native livestock habitat, grazing movement, and pasture planning.
use super::rng::Mulberry32;
use bevy_ecs::prelude::*;
use rustc_hash::FxHashSet;
use std::f64::consts::TAU;

const WALKABLE: u8 = 1;
const GRASSLAND: u8 = 2;
const PLAINS: u8 = 4;
const FENCEABLE: u8 = 8;
const SPECIES: usize = 3;
const HORSE: usize = 2;
const MAX_HERDS: usize = 12;
const MIN_MEMBERS: usize = 4;
const MAX_MEMBERS: usize = 7;
const HERD_SPACING: i32 = 9;
const HERD_RADIUS: f64 = 4.0;
const GRAZING_RADIUS: f64 = HERD_RADIUS / 2.0;
const APPROACH: f64 = 3.0;
const FENCE_BUFFER: i32 = 2;
const CARDINAL: [(i32, i32, u8); 4] = [(0, -1, 1), (1, 0, 4), (0, 1, 6), (-1, 0, 3)];

/// Per species: movement speed, food per animal per economy tick, gold, HP.
pub fn stat(species: usize, index: usize) -> f64 {
    const VALUES: [[f64; 4]; SPECIES] = [
        [0.43, 2.0, 1.0, 20.0],
        [0.36, 1.0, 2.0, 14.0],
        [0.56, 1.0, 1.0, 24.0],
    ];
    VALUES.get(species).and_then(|row| row.get(index)).copied().unwrap_or(0.0)
}

pub fn step(species: usize, remaining: f64, elapsed: f64) -> f64 {
    remaining.max(0.0).min(elapsed.max(0.0) * stat(species, 0))
}

/// Zero allows fencing. One and two identify the missing technology.
pub fn missing_fence_research(species: usize, animal_husbandry: f64, horseback_riding: f64) -> u32 {
    let (level, requirement) = if species == HORSE { (horseback_riding, 2) } else { (animal_husbandry, 1) };
    if crate::research::level(level) > 0.0 { 0 } else { requirement }
}

#[derive(Clone, Copy)]
struct Rect {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

impl Rect {
    fn contains(self, x: i32, y: i32) -> bool {
        x >= self.x && y >= self.y && x < self.x + self.width && y < self.y + self.height
    }
}

#[derive(Resource, Default)]
pub struct Livestock {
    width: usize,
    height: usize,
    terrain: Vec<u8>,
    sites: [Vec<usize>; SPECIES],
    excluded: Vec<u8>,
    starts: Vec<f64>,
    herd: Vec<f64>,
    member_cells: FxHashSet<usize>,
    output: Vec<f64>,
    pending_fence: Option<Rect>,
    occupied: Vec<u8>,
}

impl Livestock {
    pub fn prepare_terrain(&mut self, width: usize, height: usize) -> *mut u8 {
        self.width = width;
        self.height = height;
        self.terrain.resize(width * height * 2, 0);
        self.terrain.as_mut_ptr()
    }

    pub fn finish_terrain(&mut self) {
        self.sites.iter_mut().for_each(Vec::clear);
        for (cell, row) in self.terrain.chunks_exact(2).enumerate() {
            for species in 0..SPECIES {
                if Self::meadow(row[0], species) {
                    self.sites[species].push(cell);
                }
            }
        }
    }

    fn meadow(flags: u8, species: usize) -> bool {
        let habitat = if species == 0 { GRASSLAND } else { GRASSLAND | PLAINS };
        flags & (WALKABLE | FENCEABLE) == (WALKABLE | FENCEABLE) && flags & habitat != 0
    }

    fn cell(&self, x: i32, y: i32) -> Option<usize> {
        if x < 0 || y < 0 || x >= self.width as i32 || y >= self.height as i32 {
            return None;
        }
        Some(y as usize * self.width + x as usize)
    }

    fn coords(&self, cell: usize) -> (i32, i32) {
        ((cell % self.width) as i32, (cell / self.width) as i32)
    }

    pub fn prepare_spawn(&mut self, count: usize) -> *mut u8 {
        self.excluded.resize(count, 0);
        self.excluded.fill(0);
        self.excluded.as_mut_ptr()
    }

    pub fn prepare_starts(&mut self, count: usize) -> *mut f64 {
        self.starts.resize(count * 2, 0.0);
        self.starts.as_mut_ptr()
    }

    /// Only visit a compact cardinally connected group. All animals start in
    /// the three-by-three neighborhood of the first member.
    fn spawn_cells(&self, species: usize, home: usize, size: usize, cells: &mut Vec<usize>) {
        cells.clear();
        if self.excluded[home] != 0 || !Self::meadow(self.terrain[home * 2], species) {
            return;
        }
        cells.push(home);
        let (hx, hy) = self.coords(home);
        let mut head = 0;
        while head < cells.len() && cells.len() < size {
            let cell = cells[head];
            head += 1;
            let (x, y) = self.coords(cell);
            for (dx, dy, edge) in CARDINAL {
                let (nx, ny) = (x + dx, y + dy);
                if nx.abs_diff(hx) > 1 || ny.abs_diff(hy) > 1 || self.terrain[cell * 2 + 1] & (1 << edge) == 0 {
                    continue;
                }
                let Some(next) = self.cell(nx, ny) else { continue };
                if self.excluded[next] == 0 && Self::meadow(self.terrain[next * 2], species) && !cells.contains(&next) {
                    cells.push(next);
                    if cells.len() == size {
                        break;
                    }
                }
            }
        }
    }

    fn spawnable(&self, species: usize, home: usize, size: usize, cells: &mut Vec<usize>) -> bool {
        self.spawn_cells(species, home, size, cells);
        cells.len() >= MIN_MEMBERS && self.fenceable(self.pasture_bounds(cells.iter().map(|&cell| self.coords(cell))))
    }

    fn reserve(&mut self, cell: usize) {
        let (x, y) = self.coords(cell);
        for dy in -HERD_SPACING..=HERD_SPACING {
            for dx in -HERD_SPACING..=HERD_SPACING {
                if dx * dx + dy * dy <= HERD_SPACING * HERD_SPACING {
                    if let Some(next) = self.cell(x + dx, y + dy) {
                        self.excluded[next] = 1;
                    }
                }
            }
        }
    }

    fn publish_group(&mut self, species: usize, id: usize, cells: &[usize], rng: &mut Mulberry32) {
        for &cell in cells {
            self.output.extend([id as f64, species as f64, cell as f64, TAU * rng.next_f64()]);
        }
        self.reserve(cells[0]);
    }

    /// Initial placement uses one set of spawn observations. For each type,
    /// first seek pasture near towns, then sample the resident habitat index.
    pub fn spawn(&mut self, seed: u32) -> *const f64 {
        self.output.clear();
        self.output.push(0.0);
        if self.excluded.len() != self.width * self.height {
            return self.output.as_ptr();
        }
        let mut rng = Mulberry32::new(seed);
        let mut cells = Vec::with_capacity(MAX_MEMBERS);
        let mut id = 0;
        for species in 0..SPECIES {
            let sites = self.sites[species].len();
            if sites < MIN_MEMBERS {
                continue;
            }
            let target = (sites / 3_600).max(if sites >= 256 { 2 } else { 1 }).min(MAX_HERDS);
            let mut size = MIN_MEMBERS + rng.next_u32() as usize % (MAX_MEMBERS - MIN_MEMBERS + 1);
            let mut placed = 0;
            for start in 0..(self.starts.len() / 2).min(target) {
                let x = self.starts[start * 2].floor() as i32;
                let y = self.starts[start * 2 + 1].floor() as i32;
                for _ in 0..128 {
                    let dx = (rng.next_u32() % 37) as i32 - 18;
                    let dy = (rng.next_u32() % 37) as i32 - 18;
                    if !(64..=324).contains(&(dx * dx + dy * dy)) {
                        continue;
                    }
                    let Some(home) = self.cell(x + dx, y + dy) else { continue };
                    if self.spawnable(species, home, size, &mut cells) {
                        self.publish_group(species, id, &cells, &mut rng);
                        id += 1;
                        placed += 1;
                        size = MIN_MEMBERS + rng.next_u32() as usize % (MAX_MEMBERS - MIN_MEMBERS + 1);
                        break;
                    }
                }
            }
            // Bounded probes prevent placement in a crowded world from
            // turning into a scan of the map for each requested group.
            for _ in 0..(target - placed) * 420 {
                if placed == target {
                    break;
                }
                let home = self.sites[species][rng.next_u32() as usize % sites];
                if self.spawnable(species, home, size, &mut cells) {
                    self.publish_group(species, id, &cells, &mut rng);
                    id += 1;
                    placed += 1;
                    size = MIN_MEMBERS + rng.next_u32() as usize % (MAX_MEMBERS - MIN_MEMBERS + 1);
                }
            }
        }
        self.output[0] = ((self.output.len() - 1) / 4) as f64;
        self.output.as_ptr()
    }

    pub fn prepare_herd(&mut self, count: usize) -> *mut f64 {
        self.herd.resize(count * 3, 0.0);
        self.pending_fence = None;
        self.herd.as_mut_ptr()
    }

    fn herd_is_valid(&self) -> bool {
        let count = self.herd.len() / 3;
        if count == 0 || count > MAX_MEMBERS {
            return false;
        }
        let mut cx = 0.0;
        let mut cy = 0.0;
        for animal in self.herd.chunks_exact(3) {
            if !animal[0].is_finite() || !animal[1].is_finite() {
                return false;
            }
            cx += animal[0];
            cy += animal[1];
        }
        cx /= count as f64;
        cy /= count as f64;
        self.herd.chunks_exact(3).all(|animal| {
            (animal[0] - cx).powi(2) + (animal[1] - cy).powi(2) <= HERD_RADIUS.powi(2) + 1e-9
        })
    }

    /// Shuffle the open neighboring tiles of individual animals. The home
    /// never moves, and a finished fence adds a second boundary.
    pub fn goals(&mut self, seed: u32, home: (f64, f64), bounds: (i32, i32, i32, i32)) -> *const f64 {
        self.output.clear();
        let mut rng = Mulberry32::new(seed);
        self.output.extend([0.0, 2.0 + 3.0 * rng.next_f64()]);
        if !self.herd_is_valid() {
            return self.output.as_ptr();
        }
        let (x, y, width, height) = bounds;
        let pen = (width > 0 && height > 0).then_some(Rect { x, y, width, height });
        self.member_cells.clear();
        for animal in self.herd.chunks_exact(3) {
            if let Some(cell) = self.cell(animal[0].floor() as i32, animal[1].floor() as i32) {
                self.member_cells.insert(cell);
            }
        }
        let mut candidates = [(0, 0, 0); MAX_MEMBERS * CARDINAL.len()];
        let mut count = 0;
        for (member, animal) in self.herd.chunks_exact(3).enumerate() {
            let (x, y) = (animal[0].floor() as i32, animal[1].floor() as i32);
            let Some(from) = self.cell(x, y) else { continue };
            for (dx, dy, edge) in CARDINAL {
                let (nx, ny) = (x + dx, y + dy);
                let Some(to) = self.cell(nx, ny) else { continue };
                if self.terrain[to * 2] & WALKABLE == 0
                    || self.terrain[from * 2 + 1] & (1 << edge) == 0
                    || self.member_cells.contains(&to)
                    || pen.is_some_and(|rect| !rect.contains(nx, ny))
                    || (animal[0] + f64::from(dx) - home.0).powi(2)
                        + (animal[1] + f64::from(dy) - home.1).powi(2) > GRAZING_RADIUS.powi(2) {
                    continue;
                }
                candidates[count] = (member, dx, dy);
                count += 1;
            }
        }
        self.output[0] = count as f64;
        for i in 0..count {
            candidates.swap(i, i + rng.next_u32() as usize % (count - i));
            let (member, dx, dy) = candidates[i];
            self.output.extend([member as f64, f64::from(dx), f64::from(dy)]);
        }
        self.output.as_ptr()
    }

    /// 1 available, 2 too far, 3 outside the player's borders, 4 invalid.
    pub fn access(&self, leader_x: f64, leader_y: f64) -> u32 {
        if !self.herd_is_valid() {
            return 4;
        }
        if !self.herd.chunks_exact(3).any(|animal| {
            (animal[0] - leader_x).powi(2) + (animal[1] - leader_y).powi(2) <= APPROACH.powi(2)
        }) {
            return 2;
        }
        if !self.herd.chunks_exact(3).any(|animal| animal[2] != 0.0) {
            return 3;
        }
        1
    }

    fn pasture_bounds(&self, cells: impl Iterator<Item = (i32, i32)>) -> Rect {
        let (mut left, mut top) = (self.width as i32, self.height as i32);
        let (mut right, mut bottom) = (-1, -1);
        for (x, y) in cells {
            left = left.min(x);
            top = top.min(y);
            right = right.max(x);
            bottom = bottom.max(y);
        }
        Rect { x: left - FENCE_BUFFER, y: top - FENCE_BUFFER,
            width: right - left + 1 + FENCE_BUFFER * 2, height: bottom - top + 1 + FENCE_BUFFER * 2 }
    }

    fn fenceable(&self, rect: Rect) -> bool {
        let Some(_) = self.cell(rect.x, rect.y) else { return false };
        let Some(_) = self.cell(rect.x + rect.width - 1, rect.y + rect.height - 1) else { return false };
        (rect.y..rect.y + rect.height).all(|y| (rect.x..rect.x + rect.width).all(|x| {
            let cell = y as usize * self.width + x as usize;
            self.terrain[cell * 2] & FENCEABLE != 0
        }))
    }

    /// A two-cell belt around the occupied animal tiles. Art is on the
    /// rectangle's outside edges, keep the belt inside the finished fence.
    pub fn fence_plan(&mut self, leader_x: f64, leader_y: f64) -> *const f64 {
        self.output.clear();
        self.output.resize(5, 0.0);
        self.pending_fence = None;
        let access = self.access(leader_x, leader_y);
        self.output[0] = f64::from(access);
        if access == 1 {
            let rect = self.pasture_bounds(self.herd.chunks_exact(3)
                .map(|animal| (animal[0].floor() as i32, animal[1].floor() as i32)));
            if self.fenceable(rect) {
                self.output[1..].copy_from_slice(&[f64::from(rect.x), f64::from(rect.y),
                    f64::from(rect.width), f64::from(rect.height)]);
                self.pending_fence = Some(rect);
            } else {
                self.output[0] = 4.0;
            }
        }
        self.output.as_ptr()
    }

    /// The host samples temporary structures, claims, and other pastures only
    /// inside the small candidate rectangle before the native check.
    pub fn prepare_fence(&mut self, count: usize) -> *mut u8 {
        self.occupied.resize(count, 0);
        self.occupied.fill(0);
        self.occupied.as_mut_ptr()
    }

    pub fn finish_fence(&mut self) -> bool {
        self.pending_fence.take().is_some_and(|rect| {
            self.occupied.len() == (rect.width * rect.height) as usize
                && self.occupied.iter().all(|&blocked| blocked == 0)
        })
    }
}
