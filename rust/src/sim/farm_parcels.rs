use bevy_ecs::prelude::Resource;
use rustc_hash::{FxHashMap, FxHashSet};

#[derive(Default, Resource)]
pub struct FarmParcels {
    cells: Vec<u32>,
    scores: Vec<f64>,
}

#[derive(Clone, Copy)]
struct Band {
    start: i32,
    span: i32,
}

fn bands(length: i32, origin: i32, salt: i32) -> Vec<Option<Band>> {
    let mut result = vec![None; length as usize];
    let span = |index: i32| {
        let hash = (index ^ salt).wrapping_mul(0x45d9f3b) as u32;
        3 + ((hash ^ (hash >> 16)) & 1) as i32
    };
    let mut fill = |start: i32, span: i32| {
        result[start.clamp(0, length) as usize..(start + span).clamp(0, length) as usize]
            .fill(Some(Band { start, span }));
    };
    let (mut start, mut index) = (origin, 0);
    while start < length {
        let size = span(index);
        fill(start, size);
        start += size + 1;
        index += 1;
    }
    let (mut end, mut index) = (origin - 1, -1);
    while end > 0 {
        let size = span(index);
        fill(end - size, size);
        end -= size + 1;
        index -= 1;
    }
    result
}

const SHAPES: [(i32, i32); 7] = [(4, 4), (4, 3), (3, 4), (3, 3), (3, 2), (2, 3), (2, 2)];
const CARDINAL: [(i32, i32); 4] = [(-1, 0), (1, 0), (0, -1), (0, 1)];
const DIAGONAL: [(i32, i32); 4] = [(-1, -1), (1, -1), (-1, 1), (1, 1)];

#[derive(Clone, Copy)]
struct Parcel {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    planted: i32,
    nearby: bool,
}

struct Plots {
    width: i32,
    height: i32,
    available: FxHashMap<u32, usize>,
    owned: FxHashSet<u32>,
    foreign: FxHashSet<u32>,
}

impl Plots {
    fn cell(&self, x: i32, y: i32) -> u32 { (y * self.width + x) as u32 }

    fn point(&self, cell: u32) -> (i32, i32) {
        (cell as i32 % self.width, cell as i32 / self.width)
    }

    fn owned_at(&self, x: i32, y: i32) -> bool {
        x >= 0 && x < self.width && y >= 0 && y < self.height && self.owned.contains(&self.cell(x, y))
    }

    fn compactness(&self, x: i32, y: i32) -> f64 {
        let cardinal = CARDINAL.iter().filter(|&&(dx, dy)| self.owned_at(x + dx, y + dy)).count();
        let diagonal = DIAGONAL.iter().filter(|&&(dx, dy)| self.owned_at(x + dx, y + dy)).count();
        let edge = if cardinal > 0 { 12 + cardinal } else { 0 };
        (edge as f64 + diagonal as f64 * 0.5) / 18.0
    }

    fn viable(&self, x: i32, y: i32, width: i32, height: i32) -> Option<Parcel> {
        let (right, bottom) = (x + width, y + height);
        if x < 0 || y < 0 || right > self.width || bottom > self.height { return None; }
        let mut planted = 0;
        for py in y..bottom {
            for px in x..right {
                let cell = self.cell(px, py);
                if self.owned.contains(&cell) { planted += 1; }
                else if self.foreign.contains(&cell) || !self.available.contains_key(&cell) { return None; }
            }
        }
        let mut nearby = false;
        for py in (y - 2).max(0)..(bottom + 2).min(self.height) {
            for px in (x - 2).max(0)..(right + 2).min(self.width) {
                let gap = (x - px).max(px - right + 1).max(y - py).max(py - bottom + 1);
                if gap <= 0 { continue; }
                let cell = self.cell(px, py);
                if !self.owned.contains(&cell) && !self.foreign.contains(&cell) { continue; }
                if gap == 1 { return None; }
                nearby = true;
            }
        }
        Some(Parcel { x, y, width, height, planted, nearby })
    }

    fn score(&self, parcel: Parcel, start_weight: f64, scores: &mut [f64]) -> bool {
        let mut completing = false;
        for y in parcel.y..parcel.y + parcel.height {
            for x in parcel.x..parcel.x + parcel.width {
                let cell = self.cell(x, y);
                if self.owned.contains(&cell) { continue; }
                let index = self.available[&cell];
                let score = if parcel.planted > 0 {
                    if !CARDINAL.iter().any(|&(dx, dy)| self.owned_at(x + dx, y + dy)) { continue; }
                    completing = true;
                    0.9 + 0.06 * f64::from(parcel.planted) / f64::from(parcel.width * parcel.height)
                        + 0.04 * self.compactness(x, y)
                } else {
                    (if parcel.nearby { 0.3 } else { 0.2 }) * start_weight
                };
                scores[index] = scores[index].max(score);
            }
        }
        completing
    }
}

impl FarmParcels {
    pub fn input(&mut self, length: usize) -> *mut u32 {
        self.cells.resize(length, 0);
        self.cells.as_mut_ptr()
    }

    /// Complete viable rectangular parcels with a one-cell gap. Index by cell
    /// once per siting pass so each existing block looks up its grid target
    /// directly, then tests only a fixed number of nearby fallback rectangles.
    pub fn plan(&mut self, width: i32, height: i32, city_x: i32, city_y: i32, city: i32,
        sites: usize, owned: usize) -> *const f64 {
        let (candidates, farms) = self.cells.split_at(sites);
        let (friendly, foreign) = farms.split_at(owned);
        let plots = Plots { width, height, available: candidates.iter().copied().zip(0..).collect(),
            owned: friendly.iter().copied().collect(), foreign: foreign.iter().copied().collect() };
        self.scores.clear();
        self.scores.resize(sites, 0.0);
        let scores = &mut self.scores;
        let columns = bands(width, city_x, city.wrapping_mul(31).wrapping_add(17));
        let rows = bands(height, city_y, city.wrapping_mul(47).wrapping_add(59));
        let mut grid = FxHashMap::default();
        for &cell in candidates {
            let (x, y) = plots.point(cell);
            let (Some(column), Some(row)) = (columns[x as usize], rows[y as usize]) else { continue; };
            grid.entry((column.start, row.start))
                .or_insert_with(|| plots.viable(column.start, row.start, column.span, row.span));
        }

        let mut completing = false;
        let mut visited = FxHashSet::default();
        let mut block = Vec::new();
        for &first in friendly {
            if !visited.insert(first) { continue; }
            let (x, y) = plots.point(first);
            let (mut left, mut right, mut top, mut bottom) = (x, x, y, y);
            block.clear();
            block.push(first);
            let mut index = 0;
            while index < block.len() {
                let (x, y) = plots.point(block[index]);
                index += 1;
                left = left.min(x); right = right.max(x);
                top = top.min(y); bottom = bottom.max(y);
                for (dx, dy) in CARDINAL {
                    let cell = plots.cell(x + dx, y + dy);
                    if plots.owned_at(x + dx, y + dy) && visited.insert(cell) { block.push(cell); }
                }
            }
            let (span_x, span_y) = (right - left + 1, bottom - top + 1);
            if let (Some(column), Some(row)) = (columns[left as usize], rows[top as usize])
                && right < column.start + column.span && bottom < row.start + row.span
                && let Some(parcel) = grid.entry((column.start, row.start))
                    .or_insert_with(|| plots.viable(column.start, row.start, column.span, row.span))
            {
                completing |= plots.score(*parcel, 1.0, scores);
                continue;
            }
            let mut best = None;
            let mut best_key = (i32::MAX, i64::MAX);
            for (width, height) in SHAPES {
                let area = width * height;
                if -area > best_key.0 { break; }
                if width < span_x || height < span_y || area == block.len() as i32 { continue; }
                for y in bottom - height + 1..=top {
                    for x in right - width + 1..=left {
                        if let Some(parcel) = plots.viable(x, y, width, height) {
                            let dx = i64::from(2 * (x - city_x - 1) + width);
                            let dy = i64::from(2 * (y - city_y - 1) + height);
                            let key = (-area, dx * dx + dy * dy);
                            if key < best_key { best = Some(parcel); best_key = key; }
                        }
                    }
                }
            }
            if let Some(parcel) = best { completing |= plots.score(parcel, 1.0, scores); }
        }

        let mut has_parcel = completing;
        for parcel in grid.into_values().flatten().filter(|parcel| parcel.planted == 0) {
            plots.score(parcel, if completing { 0.02 } else { 1.0 }, scores);
            has_parcel = true;
        }
        // The regular grid may miss the only buildable rectangle on constrained ground.
        if !has_parcel {
            let mut best_area = 0;
            for (width, height) in SHAPES {
                let area = width * height;
                if area < best_area { break; }
                for &cell in candidates {
                    let (x, y) = plots.point(cell);
                    if let Some(parcel) = plots.viable(x, y, width, height).filter(|parcel| parcel.planted == 0) {
                        plots.score(parcel, 1.0, scores);
                        best_area = area;
                    }
                }
            }
            has_parcel = best_area > 0;
        }
        if !completing {
            for (index, &cell) in candidates.iter().enumerate() {
                let (x, y) = plots.point(cell);
                if scores[index] == 0.0 { scores[index] = plots.compactness(x, y) * if has_parcel { 0.05 } else { 1.0 }; }
            }
        }
        scores.as_ptr()
    }
}
