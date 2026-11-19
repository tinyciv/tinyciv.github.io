//! Compact water landforms for ordinary procedural worlds. This one-shot Bevy
//! resource owns placement, climate eligibility, protected terrain and topology.
use bevy_ecs::prelude::*;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::f64::consts::TAU;

const STRIDE: usize = 20;
const BEACH: u32 = 1;
const PALM: u32 = 2;
const MARSH: u32 = 4;
const OXBOW: u32 = 8;
const ATOLL_RX: f64 = 6.0;
const ATOLL_RY: f64 = 4.0;
const VOLCANIC_RX: f64 = 5.5;
const VOLCANIC_RY: f64 = 4.5;
const VOLCANIC_LAND_CELLS: usize = 60;

#[derive(Clone)]
struct Cell { row: [f64; STRIDE] }
impl Cell {
    fn terrain(&self) -> u8 { self.row[0] as u8 }
    fn overlay(&self) -> u8 { self.row[1] as u8 }
    fn flags(&self) -> u32 { self.row[11] as u32 }
    fn sea(&self) -> bool { self.terrain() <= 1 }
    fn water(&self) -> bool { self.terrain() < 4 }
    fn dry(&self) -> bool { self.terrain() >= 4 }
    fn walkable(&self) -> bool {
        (self.dry() || self.terrain() == 2 && self.overlay() == 6)
            && self.row[19] as u32 & 1 != 0 && !matches!(self.overlay(), 4 | 5)
    }
    fn land(&self, terrain: u8) -> Self {
        let mut c = self.clone();
        c.row[0] = terrain as f64; c.row[1] = 0.0;
        c.row[2] = c.row[2].clamp(0.08, 0.38); c.row[3] = 0.56;
        c.row[6] = 0.0; c.row[7] = 0.0; c.row[8] = 0.0;
        c.row[9] = match terrain { 6 => 6.0, 7 => 2.0, 5 => 5.0, _ => 0.0 };
        c.row[10] = 0.0; c.row[11] = 0.0; c.row[12] = 0.0;
        c.row[14] = match terrain { 6 => 0.5, 5 => 0.75, _ => 1.0 };
        c.row[16] = 0.0; c.row[17] = 0.0; c.row[18] = 0.0; c.row[19] = 7.0;
        c
    }
    fn wet(&self, terrain: u8) -> Self {
        let mut c = self.land(4);
        c.row[0] = terrain as f64; c.row[2] = 0.04; c.row[3] = 0.9; c.row[14] = 0.0;
        c
    }
}

#[derive(Clone, Copy)]
struct Frame { x: f64, y: f64, ax: f64, ay: f64 }
impl Frame {
    fn point(self, across: f64, along: f64) -> [f64; 2] {
        [self.x - self.ay * across + self.ax * along, self.y + self.ax * across + self.ay * along]
    }
    fn local(self, x: f64, y: f64) -> [f64; 2] {
        let dx = x - self.x; let dy = y - self.y;
        [-dx * self.ay + dy * self.ax, dx * self.ax + dy * self.ay]
    }
}
#[derive(Clone)]
struct Feature { kind: u8, id: u32, x: f64, y: f64, rx: f64, ry: f64 }
type Patch = BTreeMap<usize, Cell>;
struct Terrain {
    width: usize, height: usize, seed: u32, cells: Vec<Cell>,
    protected: Vec<bool>, occupied: Vec<bool>, starts: Vec<usize>, baseline: Vec<usize>,
    equator: f64, equator_width: f64, features: Vec<Feature>, topology_checks: usize,
}
impl Terrain {
    fn index(&self, x: i32, y: i32) -> Option<usize> {
        if x < 0 || y < 0 || x >= self.width as i32 || y >= self.height as i32 { None }
        else { Some(y as usize * self.width + x as usize) }
    }
    fn point(&self, cell: usize) -> [f64; 2] { [(cell % self.width) as f64, (cell / self.width) as f64] }
    fn palm_climate(&self, x: i32, y: i32) -> bool {
        let Some(cell) = self.index(x, y) else { return false; };
        self.cells[cell].row[4] >= 0.60 &&
            ((y as f64 / self.height.saturating_sub(1).max(1) as f64 - self.equator).abs()
                / (self.equator_width * 2.0)) <= 0.43
    }
    fn free(&self, cell: usize) -> bool { !self.protected[cell] && !self.occupied[cell] }
    fn separated(&self, center: [f64; 2], radius: f64) -> bool {
        self.features.iter().all(|f| (f.x - center[0]).hypot(f.y - center[1]) >=
            if f.kind == 0 { 24.0_f64.max(radius + f.rx.max(f.ry) + 8.0) }
            else { radius + f.rx.max(f.ry) + 8.0 })
    }
    fn bounds(&self, center: [f64; 2], rx: f64, ry: f64) -> (i32, i32, i32, i32) {
        ((center[0] - rx).floor().max(1.0) as i32, (center[1] - ry).floor().max(1.0) as i32,
            (center[0] + rx).ceil().min(self.width as f64 - 2.0) as i32,
            (center[1] + ry).ceil().min(self.height as f64 - 2.0) as i32)
    }
    fn components(&self) -> Vec<usize> {
        let mut label = vec![usize::MAX; self.cells.len()]; let mut queue = VecDeque::new(); let mut next = 0;
        for start in 0..self.cells.len() {
            if label[start] != usize::MAX || !self.cells[start].walkable() { continue; }
            label[start] = next; queue.push_back(start);
            while let Some(cell) = queue.pop_front() {
                let x = (cell % self.width) as i32; let y = (cell / self.width) as i32;
                for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                    let Some(near) = self.index(x + dx, y + dy) else { continue; };
                    if label[near] == usize::MAX && self.cells[near].walkable() { label[near] = next; queue.push_back(near); }
                }
            }
            next += 1;
        }
        label
    }
    fn start_connections_preserved(&self) -> bool {
        if self.starts.len() < 2 { return true; }
        let after = self.components();
        for (a, &start) in self.starts.iter().enumerate() {
            if self.baseline[start] == usize::MAX { continue; }
            for &other in &self.starts[a + 1..] {
                if self.baseline[start] == self.baseline[other]
                    && (after[start] == usize::MAX || after[start] != after[other]) { return false; }
            }
        }
        true
    }
    fn accept(&mut self, kind: u8, center: [f64; 2], radii: [f64; 2], mut patch: Patch) -> bool {
        if patch.is_empty() || patch.keys().any(|&cell| !self.free(cell)) { return false; }
        let id = self.features.len() as u32 + 1;
        let previous: Vec<_> = patch.keys().map(|&cell| (cell, self.cells[cell].clone())).collect();
        let removes_ground = patch.iter().any(|(&cell, next)| self.cells[cell].walkable() && !next.walkable());
        let needs_topology = removes_ground && self.starts.iter().enumerate().any(|(a, &start)|
            self.baseline[start] != usize::MAX && self.starts[a + 1..].iter()
                .any(|&other| self.baseline[start] == self.baseline[other]));
        // At most64 full floods over an entire generation, even for a coastline
        // containing many unsuitable cuts. No periodic gameplay check exists.
        if needs_topology && self.topology_checks >= 64 { return false; }
        for (&cell, next) in &mut patch { next.row[15] = id as f64; self.cells[cell] = next.clone(); }
        if needs_topology { self.topology_checks += 1; }
        if needs_topology && !self.start_connections_preserved() {
            for (cell, previous) in previous { self.cells[cell] = previous; }
            return false;
        }
        for &cell in patch.keys() {
            let x = (cell % self.width) as i32; let y = (cell / self.width) as i32;
            for dy in -3i32..=3 { for dx in -3i32..=3 {
                if dx * dx + dy * dy > 9 { continue; }
                if let Some(next) = self.index(x + dx, y + dy) { self.occupied[next] = true; }
            }}
        }
        self.features.push(Feature { kind, id, x: center[0], y: center[1], rx: radii[0], ry: radii[1] });
        true
    }
    fn protect(&mut self, starts: &[[f64; 2]]) {
        for (cell, tile) in self.cells.iter().enumerate() {
            let y = cell / self.width;
            let lane = crate::frost::POLAR_SEA_LANE_WIDTH;
            self.protected[cell] = y < lane || y >= self.height.saturating_sub(lane)
                || tile.row[6] != 0.0 || tile.dry() && tile.row[19] as u32 & 2 == 0 || matches!(tile.overlay(), 3 | 4 | 5 | 6)
                || tile.flags() & MARSH != 0 || tile.row[16] != 0.0 || tile.row[17] != 0.0 || tile.row[18] != 0.0;
        }
        let freshwater: Vec<_> = self.cells.iter().enumerate().filter_map(|(i, c)|
            (matches!(c.terrain(), 2 | 3) || c.row[16] != 0.0 || c.row[17] != 0.0).then_some(i)).collect();
        // The receiving coastal elbow at a river mouth is part of its protected
        // water corridor even when it carries no visible channel metadata.
        for cell in freshwater {
            let p = self.point(cell);
            for dy in -1..=1 { for dx in -1..=1 {
                if let Some(next) = self.index(p[0] as i32 + dx, p[1] as i32 + dy) { self.protected[next] = true; }
            }}
        }
        for &[x, y] in starts {
            if let Some(cell) = self.index(x.floor() as i32, y.floor() as i32) { self.starts.push(cell); }
            let (x0, y0, x1, y1) = self.bounds([x + 0.5, y + 0.5], 20.0, 20.0);
            for py in y0..=y1 { for px in x0..=x1 {
                let dx = ((px as f64 - x - 0.5).abs() - 1.5).max(0.0);
                let dy = ((py as f64 - y - 0.5).abs() - 1.5).max(0.0);
                if dx * dx + dy * dy <= 18.0 * 18.0 {
                    if let Some(cell) = self.index(px, py) { self.protected[cell] = true; }
                }
            }}
        }
        self.baseline = self.components();
    }
}
fn hash(seed: u32, x: i32, y: i32) -> f64 {
    let mut n = seed ^ (x as u32).wrapping_mul(0x1f123bb5) ^ (y as u32).wrapping_mul(0x5f356495);
    n = (n ^ (n >> 16)).wrapping_mul(0x7feb352d); n = (n ^ (n >> 15)).wrapping_mul(0x846ca68b);
    (n ^ (n >> 16)) as f64 / 4294967296.0
}
fn noise(seed: u32, x: f64, y: f64) -> f64 {
    let ix = x.floor() as i32; let iy = y.floor() as i32;
    let u = x - x.floor(); let v = y - y.floor();
    let u = u * u * (3.0 - 2.0 * u); let v = v * v * (3.0 - 2.0 * v);
    let a = hash(seed, ix, iy) * (1.0 - u) + hash(seed, ix + 1, iy) * u;
    let b = hash(seed, ix, iy + 1) * (1.0 - u) + hash(seed, ix + 1, iy + 1) * u;
    a * (1.0 - v) + b * v
}
fn distance_field(world: &Terrain, source: impl Fn(&Cell) -> bool) -> Vec<f64> {
    let w = world.width; let h = world.height;
    let mut result: Vec<f64> = world.cells.iter().map(|c| if source(c) { 0.0 } else { f64::INFINITY }).collect();
    let diagonal = std::f64::consts::SQRT_2;
    for y in 0..h { for x in 0..w {
        let i = y * w + x;
        if x > 0 { result[i] = result[i].min(result[i - 1] + 1.0); }
        if y > 0 {
            result[i] = result[i].min(result[i - w] + 1.0);
            if x > 0 { result[i] = result[i].min(result[i - w - 1] + diagonal); }
            if x + 1 < w { result[i] = result[i].min(result[i - w + 1] + diagonal); }
        }
    }}
    for y in (0..h).rev() { for x in (0..w).rev() {
        let i = y * w + x;
        if x + 1 < w { result[i] = result[i].min(result[i + 1] + 1.0); }
        if y + 1 < h {
            result[i] = result[i].min(result[i + w] + 1.0);
            if x > 0 { result[i] = result[i].min(result[i + w - 1] + diagonal); }
            if x + 1 < w { result[i] = result[i].min(result[i + w + 1] + diagonal); }
        }
    }}
    result
}
fn rank(candidates: &mut Vec<(f64, usize)>) {
    candidates.sort_unstable_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)));
}
fn mainland(world: &Terrain) -> Vec<usize> {
    let mut seen = vec![false; world.cells.len()]; let mut largest = Vec::new(); let mut queue = VecDeque::new();
    for start in 0..world.cells.len() {
        if seen[start] || world.cells[start].sea() { continue; }
        let mut component = Vec::new(); seen[start] = true; queue.push_back(start);
        while let Some(cell) = queue.pop_front() {
            component.push(cell); let p = world.point(cell);
            for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let Some(next) = world.index(p[0] as i32 + dx, p[1] as i32 + dy) else { continue; };
                if !seen[next] && !world.cells[next].sea() { seen[next] = true; queue.push_back(next); }
            }
        }
        if component.len() > largest.len() { largest = component; }
    }
    largest.into_iter().filter(|&i| world.cells[i].dry()).collect()
}
fn atoll_ring(dx: f64, dy: f64) -> (f64, bool, bool) {
    let theta = (dy / ATOLL_RY).atan2(dx / ATOLL_RX);
    let warp = 1.0 + (theta * 3.0 + 0.8).sin() * 0.035 + (theta * 5.0 - 0.5).sin() * 0.015;
    let radius = (dx / ATOLL_RX).hypot(dy / ATOLL_RY) / warp;
    let pass = dx > ATOLL_RX * 0.45 && dy > 0.0 && dy < 2.2;
    (radius, pass, radius > 0.72 && radius < 1.0 && !pass)
}
fn atolls(world: &mut Terrain, cap: usize) {
    if world.width < 32 || world.height < 32 { return; }
    let land_distance = distance_field(world, Cell::dry);
    let original_land: Vec<_> = world.cells.iter().enumerate().filter_map(|(i, c)| c.dry().then_some(i)).collect();
    let mainland = mainland(world);
    if mainland.len() < 120 { return; }
    let mut candidates = Vec::new();
    for y in 13..world.height as i32 - 13 { for x in 13..world.width as i32 - 13 {
        let cell = y as usize * world.width + x as usize;
        if !world.cells[cell].sea() || !world.free(cell) || !world.palm_climate(x, y)
            || land_distance[cell] < 16.0 || land_distance[cell] > 27.0 { continue; }
        candidates.push((-(land_distance[cell] - 19.0).abs() + hash(world.seed ^ 0xa701, x, y) * 3.0, cell));
    }}
    rank(&mut candidates); let mut placed = 0;
    // Spatial candidates are cheap to screen. Exact offshore checks run only
    // for the bounded best subset, not against every sea cell in a large map.
    for (_, cell) in candidates.into_iter().take(384) {
        let center = world.point(cell);
        if !world.separated(center, 7.0) || world.features.iter().any(|f| f.kind == 0
            && (f.x - center[0]).hypot(f.y - center[1]) < 40.0) { continue; }
        // Separate atolls by forty tiles: their1.8-radius fishery annuli cannot
        // touch the same ordinary12x12 stock district and compound its4x boost.
        let squared = |i: &usize| { let p = world.point(*i); (p[0] - center[0]).powi(2) + (p[1] - center[1]).powi(2) };
        if original_land.iter().any(|i| squared(i) < 256.0) { continue; }
        if !mainland.iter().any(|i| squared(i) <= 625.0) { continue; }
        let mut patch = Patch::new(); let mut valid = true;
        for dy in -5..=5 { for dx in -7..=7 {
            let (radius, pass, reef) = atoll_ring(dx as f64, dy as f64);
            if radius > 1.15 { continue; }
            let Some(next) = world.index(center[0] as i32 + dx, center[1] as i32 + dy) else { valid = false; continue; };
            if !world.free(next) || !world.cells[next].sea() || !world.palm_climate(center[0] as i32 + dx, center[1] as i32 + dy) { valid = false; continue; }
            let inward = radius <= 0.72 && !pass && [(1, 0), (-1, 0), (0, 1), (0, -1)].iter()
                .any(|(ox, oy)| atoll_ring((dx + ox) as f64, (dy + oy) as f64).2);
            let mut c = if reef || inward { world.cells[next].land(4) } else { world.cells[next].wet(1) };
            if reef || inward {
                c.row[2] = 0.08; c.row[3] = 0.69; c.row[9] = 3.0; c.row[11] = BEACH as f64; c.row[14] = 1.05;
                if hash(world.seed ^ 0x8a1c, center[0] as i32 + dx, center[1] as i32 + dy) < 0.15 { c.row[11] += PALM as f64; }
            }
            patch.insert(next, c);
        }}
        if valid && world.accept(0, center, [ATOLL_RX, ATOLL_RY], patch) { placed += 1; if placed >= cap { break; } }
    }
}
fn volcanic_patch(world: &Terrain, origin: [i32; 2]) -> Option<Patch> {
    let center = [origin[0] as f64 + 0.5, origin[1] as f64 + 0.5];
    let phase = hash(world.seed ^ 0x701ca, origin[0], origin[1]) * TAU;
    let mut shape = Vec::new();
    for dy in -4..=5 { for dx in -5..=6 {
        let x = dx as f64 - 0.5; let y = dy as f64 - 0.5;
        if (x / VOLCANIC_RX).hypot(y / VOLCANIC_RY) > 1.0 { continue; }
        let theta = (y / 4.0).atan2(x / 5.0);
        let coast = 1.0 + (theta * 3.0 + phase).sin() * 0.10
            + (theta * 5.0 - phase * 0.7).sin() * 0.04;
        let score = (x / 5.0).hypot(y / 4.0) / coast;
        shape.push((score, dx, dy));
    }}
    shape.sort_unstable_by(|a, b| a.0.total_cmp(&b.0).then(a.2.cmp(&b.2)).then(a.1.cmp(&b.1)));
    // Seed the complete volcano and a dry collar, then grow one landmass.
    // Its walkable outer land also stays connected around the blocked core.
    let mut land = BTreeSet::new();
    for dy in -1..=2 { for dx in -1..=2 { land.insert((dx, dy)); }}
    while land.len() < VOLCANIC_LAND_CELLS {
        let &(_, dx, dy) = shape.iter().find(|(_, x, y)| !land.contains(&(*x, *y))
            && [(1, 0), (-1, 0), (0, 1), (0, -1)].iter()
                .any(|(ox, oy)| land.contains(&(*x + ox, *y + oy))))?;
        land.insert((dx, dy));
    }
    let anchor = world.index(origin[0], origin[1])?;
    let variant = 1 + (hash(world.seed ^ 0x1a7a, origin[0], origin[1]) * 3.0) as u8;
    let (x0, y0, x1, y1) = world.bounds(center, 8.0, 7.0);
    let mut patch = Patch::new();
    for y in y0..=y1 { for x in x0..=x1 {
        let local = (x - origin[0], y - origin[1]);
        let dx = x as f64 - center[0]; let dy = y as f64 - center[1];
        if !land.contains(&local) && (dx / VOLCANIC_RX).hypot(dy / VOLCANIC_RY) > 1.4 { continue; }
        let cell = world.index(x, y)?; let before = &world.cells[cell];
        if !world.free(cell) || !before.sea() { return None; }
        let mut next = if land.contains(&local) {
            let radius = (dx / VOLCANIC_RX).hypot(dy / VOLCANIC_RY);
            let cold = before.row[4] < 0.30;
            let mut c = before.land(if cold { 7 } else if radius < 0.48 { 5 } else { 4 });
            c.row[2] = 0.12 + (1.0 - radius).max(0.0) * 0.34;
            c.row[3] = if cold { 0.47 } else { 0.63 };
            c.row[9] = if cold { 2.0 } else if before.row[4] >= 0.60 { 3.0 } else { 0.0 };
            c.row[14] = if cold { 0.7 } else { 0.95 };
            let shore = [(1, 0), (-1, 0), (0, 1), (0, -1)].iter()
                .any(|(ox, oy)| !land.contains(&(local.0 + ox, local.1 + oy)));
            if shore && !cold {
                c.row[11] = BEACH as f64;
                if world.palm_climate(x, y) && hash(world.seed ^ 0x7a1a, x, y) < 0.12 {
                    c.row[11] += PALM as f64;
                }
            } else if radius > 0.55 && hash(world.seed ^ 0xf07e, x, y) < 0.18 { c.row[1] = 1.0; }
            c
        } else { before.wet(1) };
        if (0..=1).contains(&local.0) && (0..=1).contains(&local.1) {
            // Existing 2x2 geothermal art: transport mirrors the anchor and
            // variant from otherwise unused relief slots on these four cells.
            next.row[1] = 5.0; next.row[2] = 0.58; next.row[3] = 0.22;
            next.row[7] = anchor as f64; next.row[9] = 8.0;
            next.row[11] = 0.0; next.row[12] = variant as f64; next.row[14] = 0.0;
        }
        patch.insert(cell, next);
    }}
    Some(patch)
}
fn volcanic_islands(world: &mut Terrain, cap: usize) {
    if world.width < 40 || world.height < 40 { return; }
    let land_distance = distance_field(world, Cell::dry);
    let original_land: Vec<_> = world.cells.iter().enumerate().filter_map(|(i, c)| c.dry().then_some(i)).collect();
    let mainland = mainland(world);
    if mainland.len() < 120 { return; }
    let mut candidates = Vec::new();
    for y in 11..world.height as i32 - 11 { for x in 11..world.width as i32 - 11 {
        let cell = y as usize * world.width + x as usize;
        if !world.cells[cell].sea() || !world.free(cell)
            || land_distance[cell] < 16.0 || land_distance[cell] > 32.0 { continue; }
        candidates.push((-(land_distance[cell] - 21.0).abs() + hash(world.seed ^ 0x701c, x, y) * 4.0, cell));
    }}
    rank(&mut candidates); let mut placed = 0;
    for (_, cell) in candidates.into_iter().take(384) {
        let p = world.point(cell); let center = [p[0] + 0.5, p[1] + 0.5];
        if !world.separated(center, 8.0) || world.features.iter().any(|f| matches!(f.kind, 0 | 4)
            && (f.x - center[0]).hypot(f.y - center[1]) < 40.0) { continue; }
        let squared = |i: &usize| { let p = world.point(*i); (p[0] - center[0]).powi(2) + (p[1] - center[1]).powi(2) };
        if original_land.iter().any(|i| squared(i) < 256.0)
            || !mainland.iter().any(|i| squared(i) <= 900.0) { continue; }
        if let Some(patch) = volcanic_patch(world, [p[0] as i32, p[1] as i32]) {
            if world.accept(4, center, [VOLCANIC_RX, VOLCANIC_RY], patch) {
                placed += 1; if placed >= cap.min(2) { break; }
            }
        }
    }
}
fn harbor_patch(world: &Terrain, frame: Frame, ground: u8) -> Option<Patch> {
    let center = [frame.x, frame.y]; let (x0, y0, x1, y1) = world.bounds(center, 9.0, 9.0);
    let mut patch = Patch::new(); let mut dry_carved = 0;
    for y in y0..=y1 { for x in x0..=x1 {
        let [u, v] = frame.local(x as f64, y as f64);
        let irregular = (noise(world.seed ^ 0x37a1, x as f64 * 0.45, y as f64 * 0.45) - 0.5) * 0.55;
        let basin = (u / (3.75 + irregular)).powi(2) + ((v + 0.67) / 4.17).powi(2) < 1.0;
        let entrance = v > 0.33 && v < 8.0 && (u - (v * 0.48).sin() * 0.4).abs() < 1.4 + (v - 2.67).max(0.0) * 0.30;
        let left = ((u + 3.27) / 1.37).powi(2) + ((v - 2.0) / 1.90).powi(2);
        let right = ((u - 3.60) / 1.47).powi(2) + ((v - 1.40) / 1.67).powi(2);
        let headland = (left < 1.0 || right < 1.0) && u.abs() > 2.27;
        if !basin && !entrance && !headland { continue; }
        let cell = world.index(x, y)?;
        if !world.free(cell) || matches!(world.cells[cell].terrain(), 2 | 3) { return None; }
        let c = &world.cells[cell];
        if headland {
            let mut next = c.land(ground); next.row[2] = 0.16; next.row[3] = c.row[3].max(0.45);
            if hash(world.seed ^ 0x391e, x, y) < 0.15 { next.row[1] = 1.0; }
            patch.insert(cell, next);
        } else {
            dry_carved += usize::from(c.dry()); patch.insert(cell, c.wet(1));
        }
    }}
    if dry_carved < 10 { return None; }
    // Add only the immediate newly carved shoreline; existing terrain beyond
    // the small inlet remains exactly as generated, including all relief.
    let water: Vec<_> = patch.iter().filter_map(|(&cell, c)| c.sea().then_some(cell)).collect();
    for cell in water {
        let p = world.point(cell);
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let Some(next) = world.index(p[0] as i32 + dx, p[1] as i32 + dy) else { continue; };
            let c = patch.get(&next).unwrap_or(&world.cells[next]);
            if c.dry() && c.terrain() != 7 && world.free(next) {
                let mut beach = c.clone(); beach.row[11] = (beach.flags() | BEACH) as f64;
                patch.insert(next, beach);
            }
        }
    }
    Some(patch)
}
fn harbors(world: &mut Terrain, cap: usize) {
    let mut candidates = Vec::new();
    for y in 10..world.height as i32 - 10 { for x in 10..world.width as i32 - 10 {
        let cell = y as usize * world.width + x as usize; let c = &world.cells[cell];
        if !c.dry() || !world.free(cell) || c.row[2] > 0.40 { continue; }
        for (direction, (dx, dy)) in [(1, 0), (-1, 0), (0, 1), (0, -1)].into_iter().enumerate() {
            let Some(sea) = world.index(x + dx * 3, y + dy * 3) else { continue; };
            if !world.cells[sea].sea() { continue; }
            let f = Frame { x: x as f64, y: y as f64, ax: dx as f64, ay: dy as f64 };
            let mut land = 0; let mut open = 0;
            for across in [-6.0, -3.0, 0.0, 3.0, 6.0] {
                for along in [-7.0, -4.0] { let p = f.point(across, along); if world.index(p[0] as i32, p[1] as i32).is_some_and(|i| world.cells[i].dry()) { land += 1; } }
                for along in [4.0, 7.0] { let p = f.point(across, along); if world.index(p[0] as i32, p[1] as i32).is_some_and(|i| world.cells[i].sea()) { open += 1; } }
            }
            if land >= 8 && open >= 7 {
                let score = land as f64 + open as f64 + hash(world.seed ^ 0x391c, x, y) * 3.0;
                candidates.push((score, cell * 4 + direction));
            }
        }
    }}
    rank(&mut candidates); let mut placed = 0;
    for (_, packed) in candidates.into_iter().take(512) {
        let cell = packed / 4; let p = world.point(cell);
        let (dx, dy) = [(1.0, 0.0), (-1.0, 0.0), (0.0, 1.0), (0.0, -1.0)][packed % 4];
        let center = [p[0] - dx * 2.0, p[1] - dy * 2.0];
        if !world.separated(center, 8.0) { continue; }
        let frame = Frame { x: center[0], y: center[1], ax: dx, ay: dy };
        if let Some(patch) = harbor_patch(world, frame, world.cells[cell].terrain()) {
            let radii = if dx != 0.0 { [8.0, 5.0] } else { [5.0, 8.0] };
            if world.accept(1, center, radii, patch) { placed += 1; if placed >= cap { break; } }
        }
    }
}
fn oasis_patch(world: &Terrain, center: [f64; 2], water_distance: &[f64]) -> Option<Patch> {
    let (x0, y0, x1, y1) = world.bounds(center, 6.0, 4.0); let mut patch = Patch::new(); let mut water = 0;
    for y in y0..=y1 { for x in x0..=x1 {
        let dx = x as f64 - center[0]; let dy = y as f64 - center[1];
        let wobble = (noise(world.seed ^ 0x54d7, x as f64 * 0.66, y as f64 * 0.66) - 0.5) * 0.23;
        let basin = (dx / 2.1).hypot((dy - (dx * 0.72).sin() * 0.37) / 1.5);
        let margin = (dx / 4.4).hypot((dy + 0.13) / 3.1);
        if basin >= 1.0 + wobble && margin >= 1.0 + wobble * 0.5 { continue; }
        let cell = world.index(x, y)?; let c = &world.cells[cell];
        if !world.free(cell) || !matches!(c.terrain(), 5 | 6) || c.row[4] < 0.60 { return None; }
        let mut next;
        if basin < 1.0 + wobble { next = c.wet(3); next.row[2] = 0.13; water += 1; }
        else {
            next = c.land(if margin > 0.77 { 5 } else { 4 }); next.row[2] = 0.17 + margin * 0.05;
            next.row[3] = 0.90 - margin * 0.32; next.row[9] = 4.0; next.row[14] = 1.25 - margin * 0.2;
            if margin < 0.84 && world.palm_climate(x, y) && hash(world.seed ^ 0x81ce, x, y) < 0.22 { next.row[11] = PALM as f64; }
        }
        patch.insert(cell, next);
    }}
    let spring = [center[0] as i32 + 4, center[1] as i32 - 2];
    if let Some(cell) = world.index(spring[0], spring[1]) {
        let c = &world.cells[cell];
        if world.free(cell) && c.terrain() == 6 && water_distance[cell] > 3.0 { patch.insert(cell, c.wet(3)); }
    }
    (water >= 5).then_some(patch)
}
fn oases(world: &mut Terrain, cap: usize) {
    let water_distance = distance_field(world, Cell::water); let mut candidates = Vec::new();
    for y in 7..world.height as i32 - 7 { for x in 7..world.width as i32 - 7 {
        let cell = y as usize * world.width + x as usize; let c = &world.cells[cell];
        if c.terrain() != 6 || c.row[4] < 0.60 || !world.free(cell) || water_distance[cell] < 7.0 { continue; }
        let mut desert = 0;
        for dy in [-4, 0, 4] { for dx in [-5, 0, 5] { if world.index(x + dx, y + dy).is_some_and(|i| world.cells[i].terrain() == 6) { desert += 1; } }}
        if desert < 7 { continue; }
        candidates.push((desert as f64 + water_distance[cell].min(18.0) * 0.20 + hash(world.seed ^ 0xa515, x, y) * 5.0, cell));
    }}
    rank(&mut candidates); let mut placed = 0;
    for (_, cell) in candidates.into_iter().take(512) {
        let center = world.point(cell); if !world.separated(center, 6.0) { continue; }
        if let Some(patch) = oasis_patch(world, center, &water_distance) {
            if world.accept(2, center, [6.0, 4.0], patch) { placed += 1; if placed >= cap { break; } }
        }
    }
}
fn old_river_patch(world: &Terrain, frame: Frame, bank: f64, reach: f64) -> Option<(Patch, [f64; 2])> {
    let center = frame.point(bank * reach, 0.0); let mut patch = Patch::new();
    for step in 0..=70 {
        let theta = 1.0 + (TAU - 2.0) * step as f64 / 70.0;
        let p = frame.point(bank * (reach - theta.cos() * 1.65), theta.sin() * 2.67);
        for dy in -1i32..=1 { for dx in -1i32..=1 {
            let x = p[0].round() as i32 + dx; let y = p[1].round() as i32 + dy;
            if (x as f64 - p[0]).hypot(y as f64 - p[1]) > 0.8 { continue; }
            let cell = world.index(x, y)?;
            if !world.free(cell) || !matches!(world.cells[cell].terrain(), 4 | 5) { return None; }
            // A full dry collar keeps the crescent detached from every active
            // river, creek, lake and ford, including diagonal water corners.
            for sy in -1..=1 { for sx in -1..=1 {
                if world.index(x + sx, y + sy).is_some_and(|i| world.cells[i].water()) { return None; }
            }}
            let mut next = world.cells[cell].wet(3); next.row[2] = 0.11; next.row[11] = OXBOW as f64;
            patch.insert(cell, next);
        }}
    }
    if patch.len() < 7 { return None; }
    let (x0, y0, x1, y1) = world.bounds(center, 6.0, 6.0);
    for y in y0..=y1 { for x in x0..=x1 {
        let cell = world.index(x, y)?;
        if patch.contains_key(&cell) || !world.free(cell) || !matches!(world.cells[cell].terrain(), 4 | 5) { continue; }
        let [u, v] = frame.local(x as f64, y as f64);
        let abandoned = bank * (reach + 2.8 + (v * 0.6).sin() * 0.5);
        if (u - abandoned).abs() < 0.55 && v.abs() < 4.5 {
            let mut next = world.cells[cell].land(5); next.row[3] = 0.5; next.row[14] = 0.95;
            patch.insert(cell, next);
        } else if ((u - bank * (reach + 2.5)) / 1.2).powi(2) + ((v - 1.5) / 1.8).powi(2) < 1.0
            && hash(world.seed ^ 0xdee1, x, y) < 0.30 {
            let mut next = world.cells[cell].land(4); next.row[1] = 3.0; next.row[11] = MARSH as f64;
            patch.insert(cell, next);
        }
    }}
    Some((patch, center))
}
fn old_rivers(world: &mut Terrain, cap: usize) {
    let mut candidates = Vec::new();
    for (cell, c) in world.cells.iter().enumerate() {
        if c.terrain() != 2 || c.row[16] < 2.0 || c.row[18] != 0.0 || c.row[2] > 0.42 || c.row[4] < 0.30 { continue; }
        let p = world.point(cell);
        if p[0] < 12.0 || p[1] < 12.0 || p[0] + 12.0 >= world.width as f64 || p[1] + 12.0 >= world.height as f64 { continue; }
        candidates.push((hash(world.seed ^ 0xb0a, p[0] as i32, p[1] as i32) * 5.0 - c.row[2] * 4.0, cell));
    }
    rank(&mut candidates); let mut placed = 0;
    for (_, cell) in candidates.into_iter().take(256) {
        let p = world.point(cell); let mut xx = 0.0; let mut yy = 0.0; let mut xy = 0.0;
        for dy in -5..=5 { for dx in -5..=5 {
            if world.index(p[0] as i32 + dx, p[1] as i32 + dy).is_some_and(|i| world.cells[i].row[16] != 0.0) {
                xx += (dx * dx) as f64; yy += (dy * dy) as f64; xy += (dx * dy) as f64;
            }
        }}
        let angle = 0.5 * (2.0 * xy).atan2(xx - yy);
        let frame = Frame { x: p[0], y: p[1], ax: angle.cos(), ay: angle.sin() };
        let mut accepted = false;
        for bank in [-1.0, 1.0] { for reach in [6.0, 7.5, 9.0] {
            let center = frame.point(bank * reach, 0.0);
            if !world.separated(center, 6.0) { continue; }
            if let Some((patch, center)) = old_river_patch(world, frame, bank, reach) {
                if world.accept(3, center, [6.0, 6.0], patch) { accepted = true; break; }
            }
        } if accepted { break; } }
        if accepted { placed += 1; if placed >= cap { break; } }
    }
}

#[derive(Resource, Default)]
pub struct WorldFeatures { input: Vec<f64>, output: Vec<f64> }
impl WorldFeatures {
    pub fn input(&mut self, length: usize) -> *mut f64 {
        self.input.clear(); self.input.resize(length, 0.0); self.input.as_mut_ptr()
    }
    /// Input: 20 scalars per tile, then start pairs, then equator/width. Output:
    /// [feature count, changed count], complete tile rows, six scalars/feature.
    /// Slot15 is the accepted feature ID; zero means the tile is untouched.
    pub fn generate(&mut self, width: usize, height: usize, seed: u32, start_count: usize) -> *const f64 {
        self.output.clear(); let n = width.saturating_mul(height);
        self.output.extend([0.0, 0.0]);
        let expected = n.saturating_mul(STRIDE).saturating_add(start_count.saturating_mul(2)).saturating_add(2);
        if n == 0 || width > 512 || height > 512 || self.input.len() != expected { return self.output.as_ptr(); }
        let mut cells = Vec::with_capacity(n);
        for r in self.input[..n * STRIDE].chunks_exact(STRIDE) {
            let mut row = [0.0; STRIDE]; row.copy_from_slice(r); row[15] = 0.0; cells.push(Cell { row });
        }
        let starts: Vec<_> = self.input[n * STRIDE..n * STRIDE + start_count * 2].chunks_exact(2).map(|r| [r[0], r[1]]).collect();
        let equator = self.input[expected - 2]; let equator_width = self.input[expected - 1];
        if !equator.is_finite() || !equator_width.is_finite() || equator_width <= 0.0 {
            for cell in cells { self.output.extend(cell.row); } return self.output.as_ptr();
        }
        let mut world = Terrain { width, height, seed, cells, protected: vec![false; n], occupied: vec![false; n],
            starts: Vec::new(), baseline: Vec::new(), equator, equator_width, features: Vec::new(), topology_checks: 0 };
        world.protect(&starts);
        let cap = (n / 14000 + 1).min(3);
        if width >= 24 && height >= 24 {
            atolls(&mut world, cap); volcanic_islands(&mut world, cap);
            harbors(&mut world, cap); oases(&mut world, cap); old_rivers(&mut world, cap);
        }
        self.output[0] = world.features.len() as f64;
        self.output[1] = world.cells.iter().filter(|c| c.row[15] != 0.0).count() as f64;
        for cell in world.cells { self.output.extend(cell.row); }
        for f in world.features { self.output.extend([f.kind as f64, f.id as f64, f.x, f.y, f.rx, f.ry]); }
        self.output.as_ptr()
    }
}
