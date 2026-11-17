//! Seeded river geometry. Generation is a single native job; no runtime scans.
use std::collections::{BTreeSet, VecDeque};

#[derive(Default)]
pub struct Rivers { pub input: Vec<f64>, pub output: Vec<f64> }
fn hash(seed: u32, x: i32, y: i32) -> f64 {
    let mut n = seed ^ (x as u32).wrapping_mul(374761393) ^ (y as u32).wrapping_mul(668265263);
    n = (n ^ (n >> 13)).wrapping_mul(1274126177);
    (n ^ (n >> 16)) as f64 / u32::MAX as f64
}
fn noise(seed: u32, x: f64, y: f64) -> f64 {
    let ix = x.floor() as i32; let iy = y.floor() as i32;
    let sx = x - x.floor(); let sy = y - y.floor();
    let sx = sx * sx * (3.0 - 2.0 * sx); let sy = sy * sy * (3.0 - 2.0 * sy);
    let a = hash(seed, ix, iy); let b = hash(seed, ix + 1, iy);
    let c = hash(seed, ix, iy + 1); let d = hash(seed, ix + 1, iy + 1);
    (a + (b - a) * sx) * (1.0 - sy) + (c + (d - c) * sx) * sy
}
fn accumulate(directions: &[i32], runoff: &[f64]) -> Option<(Vec<f64>, Vec<usize>)> {
    let mut incoming = vec![0u32; directions.len()];
    for &next in directions { if next >= 0 { incoming[next as usize] += 1; } }
    let mut order: Vec<usize> = incoming.iter().enumerate().filter_map(|(i, &n)| (n == 0).then_some(i)).collect();
    let mut flow = runoff.to_vec();
    let mut cursor = 0;
    while cursor < order.len() {
        let cell = order[cursor]; cursor += 1; let next = directions[cell];
        if next >= 0 { let next = next as usize; flow[next] += flow[cell]; incoming[next] -= 1; if incoming[next] == 0 { order.push(next); } }
    }
    (order.len() == directions.len()).then_some((flow, order))
}
fn distance(a: usize, b: usize, width: usize) -> f64 {
    ((a % width) as f64 - (b % width) as f64).hypot((a / width) as f64 - (b / width) as f64)
}
fn raster(points: &[(f64, f64)], width: usize, height: usize) -> Option<Vec<usize>> {
    let mut cells = Vec::new();
    for pair in points.windows(2) {
        let (mut x, mut y) = (pair[0].0.round() as i32, pair[0].1.round() as i32);
        let (tx, ty) = (pair[1].0.round() as i32, pair[1].1.round() as i32);
        loop {
            if x < 2 || y < 2 || x >= width as i32 - 2 || y >= height as i32 - 2 { return None; }
            let cell = y as usize * width + x as usize;
            if cells.last() != Some(&cell) { cells.push(cell); }
            if x == tx && y == ty { break; }
            if (tx - x).abs() >= (ty - y).abs() { x += (tx - x).signum(); } else { y += (ty - y).signum(); }
        }
    }
    Some(cells)
}
impl Rivers {
    pub fn prepare(&mut self, count: usize) -> *mut f64 { self.input.resize(count * 5, 0.0); self.input.as_mut_ptr() }
    /// Regional resistance varies from almost straight to tightly winding.
    pub fn resistance(&mut self, width: usize, height: usize, seed: u32, meander: f64) -> *const f64 {
        self.output.clear(); self.output.reserve(width * height);
        for y in 0..height { for x in 0..width {
            let (x, y) = (x as f64, y as f64);
            let regional = 0.35 + noise(seed ^ 71, x / 33.0, y / 33.0) * 1.85;
            let wave = (x / 8.0 + noise(seed ^ 19, x / 24.0, y / 24.0) * 7.0).sin();
            let wx = x + wave * 4.0 * regional;
            let wy = y + (x / 10.0 + y / 29.0).sin() * 5.0 * regional;
            let n = noise(seed ^ 1237, wx / 7.0, wy / 7.0) * 2.0 - 1.0;
            self.output.push(0.22 + (n * 3.8 * regional * meander).exp());
        } }
        self.output.as_ptr()
    }
    /// Input rows: receiver, discharge, real elevation, rainfall, terrain
    /// (0 ground, 1 lake, 2 sea). Output: catchments, then receiver/flow/channel/
    /// cutoff-lake per cell. Existing catchments are retained before adding long ones.
    pub fn plan(&mut self, width: usize, height: usize, target: usize, seed: u32) -> *const f64 {
        let count = width * height;
        if self.input.len() < count * 5 { self.output = vec![0.0]; return self.output.as_ptr(); }
        let rows: Vec<_> = self.input.chunks_exact(5).collect();
        let mut directions: Vec<i32> = rows.iter().map(|r| r[0] as i32).collect();
        let mut flow: Vec<f64> = rows.iter().map(|r| r[1]).collect();
        let terrain: Vec<u8> = rows.iter().map(|r| r[4] as u8).collect();
        let runoff: Vec<f64> = rows.iter().map(|r| if r[4] == 2.0 { 0.0 } else { 0.15 + r[3] * 0.85 }).collect();
        let mut parents = vec![Vec::new(); count];
        for (cell, &next) in directions.iter().enumerate() { if next >= 0 { parents[next as usize].push(cell); } }
        let mut candidates: Vec<_> = (0..count).filter(|&cell| terrain[cell] != 2 && directions[cell] >= 0
            && terrain[directions[cell] as usize] == 2 && flow[cell] >= 24.0).collect();
        candidates.sort_by(|&a, &b| flow[b].total_cmp(&flow[a]).then(a.cmp(&b)));
        let mut roots = Vec::new();
        for &cell in &candidates {
            if roots.len() >= target { break; }
            if roots.len() > 1 && roots.iter().any(|&other| distance(cell, other, width) < 9.0) { continue; }
            roots.push(cell);
        }
        let (_, order) = accumulate(&directions, &runoff).expect("acyclic drainage input");
        let mut longest = vec![0.0f64; count];
        for &cell in &order { if directions[cell] >= 0 { let next = directions[cell] as usize;
            longest[next] = longest[next].max(longest[cell] + distance(cell, next, width));
        } }
        candidates.sort_by(|&a, &b| (longest[b] * flow[b].sqrt()).total_cmp(&(longest[a] * flow[a].sqrt())).then(a.cmp(&b)));
        let extra = if width.min(height) >= 128 { 3 } else { 1 };
        for &cell in &candidates {
            if roots.len() >= target + extra { break; }
            if roots.iter().any(|&other| distance(cell, other, width) < 5.0) { continue; }
            roots.push(cell);
        }
        let mut selected = vec![false; count]; let mut threshold = vec![36.0; count];
        for (index, &root) in roots.iter().enumerate() {
            // Long trunks retain fine upstream reaches; other watersheds have
            // independently varied source lengths rather than one global cutoff.
            let limit = if index < 2 { 9.0 + hash(seed, root as i32, 1) * 7.0 }
                else { 16.0 + hash(seed, root as i32, 2) * 20.0 };
            let mut queue = VecDeque::from([root]);
            while let Some(cell) = queue.pop_front() { selected[cell] = true; threshold[cell] = limit;
                for &parent in &parents[cell] { queue.push_back(parent); }
            }
        }
        let mut channel: Vec<bool> = (0..count).map(|i| selected[i] && flow[i] >= threshold[i] && terrain[i] != 2).collect();
        // A few small, connected horseshoe reaches lengthen real centerlines.
        // Redirect the receiver tree, then verify the entire graph before commit.
        let mut bends: Vec<_> = (0..count).filter(|&i| channel[i] && terrain[i] == 0 && flow[i] >= 100.0 && rows[i][2] < 0.38).collect();
        bends.sort_by(|&a, &b| hash(seed ^ 193, a as i32, 0).total_cmp(&hash(seed ^ 193, b as i32, 0)));
        let mut used = Vec::new();
        for &start in &bends {
            if used.len() >= extra + 3 { break; }
            if used.iter().any(|&cell| distance(cell, start, width) < 15.0) { continue; }
            let mut old = vec![start];
            for _ in 0..5 { let next = directions[*old.last().unwrap()]; if next < 0 { break; } old.push(next as usize); }
            let end = *old.last().unwrap(); let length = distance(start, end, width);
            if old.len() != 6 || !(3.0..=6.0).contains(&length) || old.iter().any(|&i| terrain[i] != 0
                || parents[i].iter().filter(|&&p| channel[p]).count() > 1) { continue; }
            let (ax, ay) = ((start % width) as f64, (start / width) as f64);
            let (bx, by) = ((end % width) as f64, (end / width) as f64);
            let side = if hash(seed, start as i32, 5) < 0.5 { -1.0 } else { 1.0 };
            let (nx, ny) = (-(by - ay) / length * side, (bx - ax) / length * side);
            let bulge = 2.0 + hash(seed, start as i32, 7) * 2.0;
            let points: Vec<_> = (0..=16).map(|n| { let t = n as f64 / 16.0; let offset = (t * std::f64::consts::PI).sin() * bulge;
                (ax + (bx - ax) * t + nx * offset, ay + (by - ay) * t + ny * offset) }).collect();
            let Some(arc) = raster(&points, width, height) else { continue; };
            let distinct: BTreeSet<_> = arc.iter().copied().collect();
            if distinct.len() != arc.len() || arc.len() < old.len() + 3 || arc.iter().skip(1).take(arc.len() - 2).any(|&i|
                terrain[i] != 0 || channel[i] || (rows[i][2] - rows[start][2]).abs() > 0.09) { continue; }
            let backup: Vec<_> = arc.iter().map(|&i| (i, directions[i])).collect();
            for pair in arc.windows(2) { directions[pair[0]] = pair[1] as i32; }
            if let Some((next_flow, _)) = accumulate(&directions, &runoff) {
                flow = next_flow; for &i in &arc { selected[i] = true; threshold[i] = threshold[start]; }
                for i in 0..count { channel[i] = selected[i] && flow[i] >= threshold[i] && terrain[i] != 2; }
                used.push(start);
            } else { for (i, previous) in backup { directions[i] = previous; } }
        }
        // Small detached crescent lakes are separated from the active channel
        // by a dry neck. They never enter the visible river receiver graph.
        let mut cutoff = vec![false; count]; let mut oxbows = Vec::new();
        for &start in &bends {
            if oxbows.len() >= extra + 2 { break; }
            if oxbows.iter().any(|&cell| distance(cell, start, width) < 16.0) { continue; }
            let next = directions[start]; if next < 0 { continue; }
            let angle = hash(seed, start as i32, 31) * std::f64::consts::TAU;
            let cx = (start % width) as f64 + angle.cos() * 6.0;
            let cy = (start / width) as f64 + angle.sin() * 6.0;
            let radius = 1.6 + hash(seed, start as i32, 32) * 0.9;
            let points: Vec<_> = (0..=12).map(|n| { let a = angle + n as f64 / 12.0 * std::f64::consts::PI * 1.35;
                (cx + a.cos() * radius, cy + a.sin() * radius) }).collect();
            let Some(arc) = raster(&points, width, height) else { continue; };
            if arc.iter().any(|&cell| terrain[cell] != 0 || (rows[cell][2] - rows[start][2]).abs() > 0.07
                || (-2..=2).any(|dy| (-2..=2).any(|dx| { let x = (cell % width) as i32 + dx; let y = (cell / width) as i32 + dy;
                    x < 0 || y < 0 || x >= width as i32 || y >= height as i32 || {
                        let n = y as usize * width + x as usize; channel[n] || terrain[n] != 0 || cutoff[n]
                    } }))) { continue; }
            for cell in arc { cutoff[cell] = true; } oxbows.push(start);
        }
        self.output.clear(); self.output.push(roots.len() as f64);
        for i in 0..count { self.output.extend_from_slice(&[directions[i] as f64, flow[i], channel[i] as u8 as f64, cutoff[i] as u8 as f64]); }
        self.output.as_ptr()
    }
}
pub fn channel_width(flow: f64, scale: f64, near_lake: bool) -> f64 {
    if near_lake || flow < 200.0 { 1.0 } else { (2.2 * (flow / 200.0).sqrt() * scale).clamp(2.0, 5.0) }
}
