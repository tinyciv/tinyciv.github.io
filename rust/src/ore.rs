//! Rock ranges and mineral outcrops on exposed ground. Placement and mining
//! yields run in a Bevy world; the host mirrors footprints and renders sprites.
use bevy_ecs::prelude::*;
use std::collections::VecDeque;

const WALK: u32 = 1;
const ELIGIBLE: u32 = 2;
const TREE: u32 = 4;
const SPAWN: u32 = 8;
const MARBLE_SITE: u32 = 16;
const PEAT_SITE: u32 = 32;
const ROCK_SITE: u32 = 64;
const START_REGION_SHIFT: u32 = 7;
const INPUT_STRIDE: usize = 7;
const RIVER_WATER: u32 = 1;
const NARROW_CHANNEL: u32 = 2;
const FORD_ACCESS: u32 = 4;
const FJORD_SHORE: u32 = 8;
const FJORD_ROCK: u32 = 16;
// Resource fields, then one-based rock shape, host cell, ore-section cell,
// ground policy (0 unchanged, 1 solid footprint), and
// an arrangement (low nibble), decorative tree (bit 4), gap (bit 5), and
// one-based continental range identifier above the low six bits.
const OUTPUT_STRIDE: usize = 12;
const ARRANGEMENT_COLUMN: usize = 11;
const ROCK_TREE: u8 = 1 << 4;
const RANGE_GAP: f64 = 32.0;
const RANGE_ID_STRIDE: f64 = 64.0;
const ROCK_SHAPES: [(usize, usize); 6] = [(2, 1), (1, 1), (4, 2), (3, 2), (8, 3), (5, 3)];
const MARBLE_QUARRY: usize = 4;
const PEAT_BED: usize = 5;
const WILD_GRAPES: usize = 6;
const COAL_CUT: usize = 7;
const MARBLE_RESOURCE: u32 = 9;
const PEAT_RESOURCE: u32 = 10;
const GRAPES_RESOURCE: u32 = 11;
const COAL_RESOURCE: u32 = 12;
// Bit 1: solid for everyone; bit 2: restricted to the assigned salt crew.
pub fn ground_policy(resource: u32) -> u32 {
    match resource { 2..=5 | MARBLE_RESOURCE | PEAT_RESOURCE | GRAPES_RESOURCE | COAL_RESOURCE => 1, 6 => 2, _ => 0 }
}
pub fn peat_upkeep_multiplier(developed: bool) -> f64 { if developed { 0.70 } else { 1.0 } }
pub fn grape_trade_multiplier(developed: bool) -> f64 { if developed { 1.30 } else { 1.0 } }

fn deposit_climate(kind: usize, tile: &[f64]) -> bool {
    let temperate_ground = matches!(tile[2] as i32, 0 | 1);
    match kind {
        PEAT_BED => temperate_ground && tile[4] <= 0.72 && tile[5] >= 0.53,
        WILD_GRAPES => temperate_ground && tile[4] >= 0.48 && (0.22..=0.70).contains(&tile[5]),
        COAL_CUT => temperate_ground,
        _ => true,
    }
}
pub fn work_access(resource: u32, phase: u32, worker: bool) -> bool {
    worker && resource == 6 && (1..=3).contains(&phase)
}
pub fn prefer_marble_quarry(owned: u32, developed: u32, anchor: u32, current: u32, current_anchor: u32) -> bool {
    owned == 4 && developed > 0 && (developed > current || developed == current && anchor < current_anchor)
}
pub const MIN_FISH_WATER_BODY: usize = 40;
pub fn group_limit(resource: u32) -> u32 { if resource == 6 { 15 } else { 0 } }
pub fn large_water_bodies(w: usize, h: usize, water: &[bool]) -> Vec<bool> {
    let mut eligible = vec![false; w * h]; let mut seen = vec![false; w * h];
    let mut queue = VecDeque::new(); let mut members = Vec::new();
    for cell in 0..w * h {
        if !water[cell] || seen[cell] { continue; }
        queue.clear(); members.clear(); queue.push_back(cell); seen[cell] = true;
        while let Some(next) = queue.pop_front() {
            members.push(next);
            adjacent(next, w, h, |near| {
                if !seen[near] && water[near] { seen[near] = true; queue.push_back(near); }
            });
        }
        if members.len() > MIN_FISH_WATER_BODY { for &next in &members { eligible[next] = true; } }
    }
    eligible
}

/// Habitat codes: dry ground, tundra, inland/coastal water, ocean, protected
/// geothermal/glacier ground. Output: salt=1, fish=2, available dry ground=4.
/// Flood each water body once at world creation, not around every fish.
fn habitats(settings: Res<Settings>, input: Res<Input>, mut output: ResMut<Output>) {
    let (w, h) = (settings.width, settings.height); let n = w * h;
    output.0.clear(); output.0.resize(n, 0.0);
    if n == 0 || input.0.len() < n { return; }
    let water: Vec<bool> = input.0.iter().take(n).map(|value| matches!(*value as u32, 2 | 3)).collect();
    let fish = large_water_bodies(w, h, &water);
    for cell in 0..n {
        let terrain = input.0[cell] as u32;
        if terrain <= 1 { output.0[cell] = if terrain == 0 { 5.0 } else { 4.0 }; }
        if terrain == 2 && fish[cell] { output.0[cell] = 2.0; }
    }
}

#[cfg(test)]
mod access_tests {
    use super::*;
    #[test]
    fn salt_is_restricted_and_only_mining_trips_receive_access() {
        assert_eq!(ground_policy(6), 2);
        for ore in 2..=5 { assert_eq!(ground_policy(ore), 1); }
        assert!(!work_access(6, 0, true), "access-road crews stay outside the pans");
        for phase in 1..=3 { assert!(work_access(6, phase, true)); }
        assert!(!work_access(6, 2, false));
        assert!(!work_access(7, 2, true), "other resource jobs receive no salt access");
    }
}
pub const GOLD_PER_TILE: f64 = 2.0;
#[derive(Resource, Default)]
struct Input(Vec<f64>);
#[derive(Resource, Default)]
struct Output(Vec<f64>);
#[derive(Resource, Default)]
struct Settings { width: usize, height: usize, seed: u32, first_group: u32, tutorial:bool }
#[derive(Resource, Default)]
struct Mining { cells: usize, now: f64, due: f64, interval: f64, payout: [f64; 2] }
fn mine(mut mining: ResMut<Mining>) {
    let elapsed = mining.now - mining.due + 1e-8;
    if elapsed < 0.0 || mining.cells == 0 || !elapsed.is_finite() || mining.interval <= 0.0 { return; }
    // Keep the original cadence after a deferred update without banking extra payouts.
    mining.payout = [mining.due + (1.0 + (elapsed / mining.interval).floor()) * mining.interval,
        mining.cells as f64 * GOLD_PER_TILE];
}
fn hash(seed: u32, cell: usize, salt: u32) -> u32 {
    let mut n = seed ^ (cell as u32).wrapping_mul(0x1f123bb5) ^ salt.wrapping_mul(0x5f356495);
    n = (n ^ (n >> 16)).wrapping_mul(0x7feb352d); n = (n ^ (n >> 15)).wrapping_mul(0x846ca68b); n ^ (n >> 16)
}
fn adjacent(cell: usize, w: usize, h: usize, mut f: impl FnMut(usize)) {
    let x = cell % w; let y = cell / w;
    if x > 0 { f(cell - 1); } if x + 1 < w { f(cell + 1); }
    if y > 0 { f(cell - w); } if y + 1 < h { f(cell + w); }
}
fn connected(cells: &[usize], flags: &[u32], w: usize, h: usize) -> bool {
    if cells.is_empty() { return true; }
    let x0 = cells.iter().map(|c| c % w).min().unwrap().saturating_sub(3);
    let y0 = cells.iter().map(|c| c / w).min().unwrap().saturating_sub(3);
    let x1 = (cells.iter().map(|c| c % w).max().unwrap() + 3).min(w - 1);
    let y1 = (cells.iter().map(|c| c / w).max().unwrap() + 3).min(h - 1);
    let bw = x1 - x0 + 1;
    let area = bw * (y1 - y0 + 1);
    let local = |cell: usize| (cell / w - y0) * bw + cell % w - x0;
    let mut footprint = vec![false; area];
    for &cell in cells { footprint[local(cell)] = true; }
    let removed = |cell: usize| footprint[local(cell)];
    let tree_at = |cell: usize| flags[cell] & TREE != 0;
    let ground = |cell: usize| !removed(cell) && flags[cell] & WALK != 0;
    let mut approaches = Vec::new();
    let mut seen = vec![false; area];
    for &cell in cells { adjacent(cell, w, h, |next| {
        if ground(next) && !seen[local(next)] {
            seen[local(next)] = true;
            approaches.push(next);
        }
    }); }
    // Do not consume the last exposed clearing beside a forest tree.
    for &cell in cells {
        let mut okay = true;
        adjacent(cell, w, h, |tree| { if !removed(tree) && tree_at(tree) {
            let mut opening = false;
            adjacent(tree, w, h, |next| { opening |= ground(next) && !tree_at(next); });
            okay &= opening;
        }});
        if !okay { return false; }
    }
    if approaches.len() < 2 { return true; }
    seen.fill(false);
    let mut queue = VecDeque::from([approaches[0]]); seen[local(approaches[0])] = true;
    while let Some(cell) = queue.pop_front() { adjacent(cell, w, h, |next| {
        let x = next % w; let y = next / w;
        if x >= x0 && y >= y0 && x <= x1 && y <= y1 && ground(next) && !seen[local(next)] {
            seen[local(next)] = true; queue.push_back(next);
        }
    }); }
    approaches.iter().all(|cell| seen[local(*cell)])
}

#[derive(Clone, Copy)]
struct RockStamp {
    x: usize,
    y: usize,
    shape: usize,
}
impl RockStamp {
    fn new(x: isize, y: isize, shape: usize) -> Option<Self> {
        Some(Self { x: usize::try_from(x).ok()?, y: usize::try_from(y).ok()?, shape })
    }

    fn dimensions(self) -> (usize, usize) { ROCK_SHAPES[self.shape] }

    fn overlaps(self, other: Self) -> bool {
        let (w, h) = self.dimensions();
        let (ow, oh) = other.dimensions();
        self.x < other.x + ow && other.x < self.x + w && self.y < other.y + oh && other.y < self.y + h
    }

    fn adjoining(self, other: Self) -> bool {
        let (w, h) = self.dimensions();
        let (ow, oh) = other.dimensions();
        let horizontal_edge = self.x + w == other.x || other.x + ow == self.x;
        let vertical_edge = self.y + h == other.y || other.y + oh == self.y;
        horizontal_edge && self.y < other.y + oh && other.y < self.y + h
            || vertical_edge && self.x < other.x + ow && other.x < self.x + w
    }

    fn cells(self, world_width: usize) -> impl Iterator<Item = (usize, usize, usize)> {
        let (width, height) = self.dimensions();
        (0..height).flat_map(move |dy| (0..width).map(move |dx| {
            ((self.y + dy) * world_width + self.x + dx, dx, dy)
        }))
    }

    /// The two-cell mine face is centered on the front of the outcrop.
    fn ore(self) -> (usize, usize) {
        let (width, height) = self.dimensions();
        ((width - 2) / 2, height - 2)
    }

    fn record(self, world_width: usize, flags: &mut [u32], output: &mut [f64],
        deposit: Option<(usize, u32, f64)>) {
        let anchor = self.y * world_width + self.x;
        output[anchor * OUTPUT_STRIDE + 7] = (self.shape + 1) as f64;
        let section = deposit.map(|_| self.ore());
        if let Some((ox, oy)) = section {
            output[anchor * OUTPUT_STRIDE + 9] = ((self.y + oy) * world_width + self.x + ox + 1) as f64;
        }
        for (cell, dx, dy) in self.cells(world_width) {
            let at = cell * OUTPUT_STRIDE;
            output[at + 8] = (anchor + 1) as f64;
            output[at + 10] = 1.0;
            flags[cell] &= !(ELIGIBLE | PEAT_SITE | TREE | ROCK_SITE | WALK);
            if let (Some((kind, group, variant)), Some((ox, oy))) = (deposit, section) {
                if (ox..ox + 2).contains(&dx) && dy >= oy {
                    let start = (self.y + oy) * world_width + self.x + ox;
                    output[at..at + 7].copy_from_slice(&[
                        kind as f64, group as f64, start as f64, 0.0, variant, 2.0, 2.0,
                    ]);
                }
            }
        }
    }
}

struct RockGround<'a> {
    width: usize,
    height: usize,
    input: &'a [f64],
}
impl RockGround<'_> {
    fn tile(&self, cell: usize) -> &[f64] {
        &self.input[cell * INPUT_STRIDE..(cell + 1) * INPUT_STRIDE]
    }

    fn open(&self, stamp: RockStamp, flags: &[u32]) -> bool {
        let (sw, sh) = stamp.dimensions();
        if stamp.x + sw > self.width || stamp.y + sh > self.height { return false; }
        let climate = self.palette(stamp.y * self.width + stamp.x);
        stamp.cells(self.width).all(|(cell, _, _)| {
            flags[cell] & ROCK_SITE != 0 && self.palette(cell) == climate
        })
    }

    fn palette(&self, cell: usize) -> usize {
        self.tile(cell)[2] as usize
    }

    fn channel(&self, cell: usize) -> u32 {
        self.tile(cell)[6] as u32
    }

    fn same_province(&self, a: usize, b: usize) -> bool {
        let (a, b) = (self.palette(a), self.palette(b));
        a == b || a <= 1 && b <= 1
    }

    fn cell(&self, x: isize, y: isize) -> Option<usize> {
        (x >= 0 && y >= 0 && x < self.width as isize && y < self.height as isize)
            .then(|| y as usize * self.width + x as usize)
    }

    fn connected(&self, stamp: RockStamp, flags: &[u32]) -> bool {
        let cells: Vec<_> = stamp.cells(self.width).map(|(cell, _, _)| cell).collect();
        connected(&cells, flags, self.width, self.height)
    }

    fn try_bare(&self, x: isize, y: isize, shape: usize, flags: &mut [u32],
        output: &mut [f64], excluded: &[bool]) -> Option<RockStamp> {
        let stamp = RockStamp::new(x, y, shape)?;
        if !self.open(stamp, flags) || stamp.cells(self.width).any(|(cell, _, _)| excluded[cell])
            || !self.connected(stamp, flags) { return None; }
        stamp.record(self.width, flags, output, None);
        Some(stamp)
    }
}

#[derive(Clone, Copy)]
#[repr(u8)]
enum RockArrangement { Horizontal, Vertical, Diagonal }

const RANGE_AXES: [RockArrangement; 3] = [RockArrangement::Horizontal, RockArrangement::Vertical, RockArrangement::Diagonal];

#[derive(Clone, Copy)]
#[repr(u8)]
enum RangeLength { Short, Medium, Long }

const RANGE_LENGTHS: [RangeLength; 3] = [RangeLength::Long, RangeLength::Medium, RangeLength::Short];

struct RockRange {
    arrangement: RockArrangement,
    length: RangeLength,
    focus: usize,
    stamps: Vec<RockStamp>,
}
impl RockRange {
    fn new(arrangement: RockArrangement, length: RangeLength, focus: usize) -> Self {
        Self { arrangement, length, focus, stamps: Vec::new() }
    }

    fn accepts(&self, stamp: RockStamp, ground: &RockGround, flags: &[u32]) -> bool {
        ground.open(stamp, flags) && ground.same_province(stamp.y * ground.width + stamp.x, self.focus)
            && self.stamps.iter().all(|other| !stamp.overlaps(*other))
    }

    fn connected(&self, ground: &RockGround, flags: &[u32]) -> bool {
        let cells: Vec<_> = self.stamps.iter().flat_map(|stamp| stamp.cells(ground.width).map(|(cell, _, _)| cell)).collect();
        connected(&cells, flags, ground.width, ground.height)
    }

    fn outside_apron(&self, ground: &RockGround, excluded: &[bool]) -> bool {
        self.stamps.iter().all(|stamp| stamp.cells(ground.width).all(|(cell, _, _)| !excluded[cell]))
    }

    fn fill_pockets(&mut self, ground: &RockGround, flags: &[u32]) -> bool {
        let [west, north, east, south] = rock_bounds(&self.stamps);
        let width = east - west + 2;
        let height = south - north + 2;
        let mut footprint = vec![0u8; width * height];
        for stamp in &self.stamps {
            let (sw, sh) = stamp.dimensions();
            let left = stamp.x - west + 1;
            for y in stamp.y - north + 1..stamp.y - north + sh + 1 {
                footprint[y * width + left..y * width + left + sw].fill(1);
            }
        }
        // A padded exterior flood distinguishes enclosed holes from natural
        // terrain notches in the perimeter. This box is bounded by the stamps.
        let mut queue = VecDeque::from([0]);
        footprint[0] = 2;
        while let Some(cell) = queue.pop_front() {
            adjacent(cell, width, height, |next| {
                if footprint[next] == 0 {
                    footprint[next] = 2;
                    queue.push_back(next);
                }
            });
        }
        for y in 1..height - 1 {
            for x in 1..width - 1 {
                let cell = y * width + x;
                if footprint[cell] != 0 { continue; }
                let (wx, wy) = (west + x - 1, north + y - 1);
                if !ground.same_province(wy * ground.width + wx, self.focus) { return false; }
                let single = RockStamp { x: wx, y: wy, shape: 1 };
                let pair = RockStamp { shape: 0, ..single };
                let stamp = if footprint[cell + 1] == 0 && ground.open(pair, flags) {
                    footprint[cell + 1] = 1;
                    pair
                } else if ground.open(single, flags) {
                    single
                } else {
                    return false;
                };
                footprint[cell] = 1;
                self.stamps.push(stamp);
            }
        }
        true
    }

    fn decorative_trees(&self, ground: &RockGround, flags: &[u32], seed: u32) -> Vec<usize> {
        if ground.palette(self.focus) == 2 { return Vec::new(); }
        let variation = hash(seed, self.focus, 193);
        let target = match self.length {
            RangeLength::Short => (variation % 3 == 0) as usize,
            RangeLength::Medium => 1 + (variation % 5 == 0) as usize,
            RangeLength::Long => 2 + (variation % 3 == 0) as usize,
        };
        if target == 0 { return Vec::new(); }
        let mut shelves: Vec<_> = self.stamps.iter().filter_map(|stamp| {
            let (sw, sh) = stamp.dimensions();
            if sh < 2 { return None; }
            let cell = (stamp.y + sh - 2) * ground.width + stamp.x + sw / 2;
            Some((flags[cell] & TREE == 0, hash(seed, cell, 197), cell))
        }).collect();
        shelves.sort_unstable();
        let mut trees: Vec<usize> = Vec::with_capacity(target);
        for (_, _, cell) in shelves {
            if trees.iter().all(|&tree| (tree % ground.width).abs_diff(cell % ground.width)
                + (tree / ground.width).abs_diff(cell / ground.width) >= 4) {
                trees.push(cell);
            }
            if trees.len() == target { break; }
        }
        trees
    }

    fn record(self, ground: &RockGround, flags: &mut [u32], output: &mut [f64], excluded: &mut [bool], seed: u32) {
        let trees = self.decorative_trees(ground, flags, seed);
        reserve_rock_apron(&self.stamps, ground, excluded, 4);
        for stamp in self.stamps { stamp.record(ground.width, flags, output, None); }
        let marker = 1 + self.length as u8 * 3 + self.arrangement as u8;
        output[self.focus * OUTPUT_STRIDE + ARRANGEMENT_COLUMN] = f64::from(marker);
        for cell in trees {
            output[cell * OUTPUT_STRIDE + ARRANGEMENT_COLUMN] += f64::from(ROCK_TREE);
        }
    }
}

fn rock_bounds(stamps: &[RockStamp]) -> [usize; 4] {
    let mut bounds = [usize::MAX, usize::MAX, 0, 0];
    for stamp in stamps {
        let (w, h) = stamp.dimensions();
        bounds[0] = bounds[0].min(stamp.x);
        bounds[1] = bounds[1].min(stamp.y);
        bounds[2] = bounds[2].max(stamp.x + w);
        bounds[3] = bounds[3].max(stamp.y + h);
    }
    bounds
}

fn reserve_rock_apron(stamps: &[RockStamp], ground: &RockGround, excluded: &mut [bool], padding: usize) {
    let [west, north, east, south] = rock_bounds(stamps);
    for y in north.saturating_sub(padding)..(south + padding).min(ground.height) {
        let start = y * ground.width + west.saturating_sub(padding);
        let end = y * ground.width + (east + padding).min(ground.width);
        excluded[start..end].fill(true);
    }
}

fn range_member(previous: RockStamp, axis: RockArrangement, hand: isize, rise: isize, shape: usize,
    offset: isize) -> Option<RockStamp> {
    let (x, y) = (previous.x as isize, previous.y as isize);
    let (pw, ph) = previous.dimensions();
    let (sw, sh) = ROCK_SHAPES[shape];
    match axis {
        RockArrangement::Horizontal => {
            let end = if hand < 0 { x - sw as isize } else { x + pw as isize };
            RockStamp::new(end, y + rise * hand + offset, shape)
        }
        RockArrangement::Vertical | RockArrangement::Diagonal => {
            let end = if hand < 0 { y - sh as isize } else { y + ph as isize };
            let across = if matches!(axis, RockArrangement::Diagonal) { 2 } else { 1 };
            RockStamp::new(x + pw as isize / 2 - sw as isize / 2 + across * rise * hand + offset, end, shape)
        }
    }
}

fn range_shoulder(parent: RockStamp, axis: RockArrangement, hand: isize, shape: usize,
    drift: isize) -> Option<RockStamp> {
    let (x, y) = (parent.x as isize, parent.y as isize);
    let (pw, ph) = parent.dimensions();
    let (sw, sh) = ROCK_SHAPES[shape];
    if matches!(axis, RockArrangement::Horizontal) {
        let edge = if hand < 0 { y - sh as isize } else { y + ph as isize };
        RockStamp::new(x + pw as isize / 2 - sw as isize / 2 + drift, edge, shape)
    } else {
        let edge = if hand < 0 { x - sw as isize } else { x + pw as isize };
        RockStamp::new(edge, y + ph as isize / 2 - sh as isize / 2 + drift, shape)
    }
}

fn add_shoulder(range: &mut RockRange, parent: RockStamp, side: isize, shapes: [usize; 3],
    drift: isize, ground: &RockGround, flags: &[u32]) -> Option<RockStamp> {
    let shoulder = shapes.into_iter().find_map(|shape| {
        [drift, 0, -drift, 2 * drift, -2 * drift].into_iter().find_map(|offset| {
            let stamp = range_shoulder(parent, range.arrangement, side, shape, offset)?;
            (parent.adjoining(stamp) && range.accepts(stamp, ground, flags)).then_some(stamp)
        })
    })?;
    range.stamps.push(shoulder);
    Some(shoulder)
}

fn widen_range(range: &mut RockRange, ground: &RockGround, seed: u32, flags: &[u32], backbone: usize) -> bool {
    let center = range.stamps[0];
    let horizontal = matches!(range.arrangement, RockArrangement::Horizontal);
    let along = |stamp: RockStamp| if horizontal {
        stamp.x.abs_diff(center.x)
    } else {
        stamp.y.abs_diff(center.y)
    };
    let mut inner: Vec<_> = range.stamps[1..backbone].iter().copied().filter(|s| s.shape >= 2).collect();
    inner.sort_by_key(|stamp| along(*stamp));
    let (minimum, flank_limit, terrace_limit): (usize, usize, usize) = match range.length {
        RangeLength::Short => (4, 2, 1),
        RangeLength::Medium => (6, 4, 2),
        RangeLength::Long => (9, 6, 3),
    };
    let profile = hash(seed, range.focus, 167);
    let broad_side = if profile & 1 == 0 { -1 } else { 1 };
    let shoulder = |side| if side == broad_side {
        if horizontal { [4, 5, 3] } else { [5, 3, 4] }
    } else {
        [3, 2, 5]
    };
    // A center shoulder on each side is mandatory. They cannot be removed
    // when thinning outer terraces to preserve a route around the range.
    let Some(west) = add_shoulder(range, center, -1, shoulder(-1), 1, ground, flags) else { return false; };
    let Some(east) = add_shoulder(range, center, 1, shoulder(1), -1, ground, flags) else { return false; };
    if !range.connected(ground, flags) { return false; }
    let sides = if broad_side < 0 { [(-1, west), (1, east)] } else { [(1, east), (-1, west)] };
    for (side, core) in sides {
        let broad = side == broad_side;
        let mut flank = Vec::from([core]);
        let goal = if broad { flank_limit + 1 } else { flank_limit.saturating_sub(1).max(2) };
        let shift = if broad { 0 } else { 1 + (profile >> 1 & 1) as usize };
        for (index, &parent) in inner.iter().cycle().skip(shift).take(inner.len()).enumerate() {
            if flank.len() >= goal { break; }
            let variation = hash(seed, parent.y * ground.width + parent.x, 172);
            let drift = if variation & 1 == 0 { side } else { -side };
            let shapes = if broad && index < 2 { shoulder(side) }
                else if index + 2 >= inner.len() { [2, 0, 3] }
                else if variation & 2 == 0 { [3, 2, 5] }
                else { [2, 3, 5] };
            if let Some(shoulder) = add_shoulder(range, parent, side, shapes, drift, ground, flags) {
                flank.push(shoulder);
            }
        }
        // Stagger a second row outward from the inner flanks so the widened
        // area reads as one uneven body with shorter foothills.
        let mut terraces = 0;
        let goal = if broad && flank.len() > 2 { terrace_limit + 1 } else { terrace_limit };
        for shoulder in flank {
            if terraces == goal { break; }
            let shapes = if broad && terraces == 0 { [3, 2, 0] } else { [0, 2, 1] };
            let drift = if terraces & 1 == 0 { side } else { -side };
            if add_shoulder(range, shoulder, side, shapes, drift, ground, flags).is_some() {
                terraces += 1;
            }
        }
    }
    while range.stamps.len() >= backbone + minimum {
        if range.connected(ground, flags) { return true; }
        range.stamps.pop();
    }
    false
}

fn long_range(ground: &RockGround, axis: RockArrangement, length: RangeLength,
    cell: usize, seed: u32, flags: &[u32]) -> Option<RockRange> {
    let (x, y) = ((cell % ground.width) as isize, (cell / ground.width) as isize);
    let rolling = hash(seed, cell, 83);
    let rise = if rolling & 1 == 0 { 1 } else { -1 };
    let mut range = RockRange::new(axis, length, cell);
    let main_shapes = match axis {
        RockArrangement::Horizontal => [4, 5],
        _ => [5, 3],
    };
    let main = main_shapes.into_iter().find_map(|shape| {
        let (sw, sh) = ROCK_SHAPES[shape];
        let stamp = RockStamp::new(x - sw as isize / 2, y - sh as isize / 2, shape)?;
        range.accepts(stamp, ground, flags).then_some(stamp)
    })?;
    range.stamps.push(main);
    let horizontal = matches!(axis, RockArrangement::Horizontal);
    let (steps, minimum) = match (horizontal, length) {
        (true, RangeLength::Long) => (5, 39), (false, RangeLength::Long) => (7, 29),
        (true, RangeLength::Medium) => (4, 25), (false, RangeLength::Medium) => (5, 17),
        (true, RangeLength::Short) => (2, 12), (false, RangeLength::Short) => (2, 7),
    };
    for (side, hand) in [-1, 1].into_iter().enumerate() {
        let mut previous = main;
        for index in 0..steps {
            let middle = 2 + (rolling >> (1 + side * steps + index) & 1) as usize;
            let shapes = if index + 1 == steps { [middle - 2, 1, 0] }
                else if !matches!(length, RangeLength::Short) && horizontal && index < 2 { [4 + index, middle, 5 - middle] }
                else if !horizontal && index % 2 == 0 { [5, middle, 3] }
                else { [middle, 5 - middle, 5] };
            let step_rise = if index % 2 == 1 && !matches!(axis, RockArrangement::Diagonal) { -rise } else { rise };
            let branch = shapes.into_iter().find_map(|shape| {
                [0, -1, 1].into_iter().find_map(|offset| {
                    let stamp = range_member(previous, axis, hand, step_rise, shape, offset)?;
                    (previous.adjoining(stamp) && range.accepts(stamp, ground, flags)).then_some(stamp)
                })
            });
            let Some(branch) = branch else { break; };
            range.stamps.push(branch);
            previous = branch;
        }
    }
    if range.stamps.len() < 4 { return None; }
    let backbone = range.stamps.len();
    let [west, north, east, south] = rock_bounds(&range.stamps);
    let length = if horizontal { east - west } else { south - north };
    if length < minimum || !widen_range(&mut range, ground, seed, flags, backbone) { return None; }
    let before = range.stamps.len();
    if !range.fill_pockets(ground, flags) || range.stamps.len() > before && !range.connected(ground, flags) {
        return None;
    }
    Some(range)
}

struct RangeDraft<'a> {
    flags: &'a mut [u32],
    changed: Vec<(usize, u32)>,
}
impl RangeDraft<'_> {
    fn clear(&mut self, cell: usize, bits: u32) {
        self.changed.push((cell, self.flags[cell]));
        self.flags[cell] &= !bits;
    }

    fn stage(&mut self, stamp: RockStamp, width: usize) {
        // Completed legs become the spatial occupancy index for later
        // probes. Only the short leg currently being drafted tests stamps.
        for (cell, _, _) in stamp.cells(width) {
            self.clear(cell, ROCK_SITE | ELIGIBLE | PEAT_SITE | TREE | WALK);
        }
    }

    fn restore(&mut self, checkpoint: usize) {
        while self.changed.len() > checkpoint {
            let (cell, previous) = self.changed.pop().unwrap();
            self.flags[cell] = previous;
        }
    }
}
impl Drop for RangeDraft<'_> {
    fn drop(&mut self) { self.restore(0); }
}

struct ContinentalRange {
    axis: RockArrangement,
    focus: usize,
    stamps: Vec<RockStamp>,
    gaps: Vec<usize>,
    trees: Vec<usize>,
    river_passes: usize,
    dry_passes: usize,
    canyon_frontage: usize,
}
impl ContinentalRange {
    fn span(&self) -> usize {
        let [west, north, east, south] = rock_bounds(&self.stamps);
        if matches!(self.axis, RockArrangement::Horizontal) { east - west } else { south - north }
    }

    fn record(self, ground: &RockGround, flags: &mut [u32], output: &mut [f64], excluded: &mut [bool]) {
        let id = (self.focus + 1) as f64 * RANGE_ID_STRIDE;
        for stamp in self.stamps {
            reserve_rock_apron(std::slice::from_ref(&stamp), ground, excluded, 4);
            stamp.record(ground.width, flags, output, None);
            let anchor = stamp.y * ground.width + stamp.x;
            output[anchor * OUTPUT_STRIDE + ARRANGEMENT_COLUMN] = id;
        }
        for cell in self.gaps {
            excluded[cell] = true;
            flags[cell] &= !(ELIGIBLE | PEAT_SITE | ROCK_SITE);
            output[cell * OUTPUT_STRIDE + ARRANGEMENT_COLUMN] = id + RANGE_GAP;
        }
        output[self.focus * OUTPUT_STRIDE + ARRANGEMENT_COLUMN] = id + f64::from(10 + self.axis as u8);
        for cell in self.trees {
            output[cell * OUTPUT_STRIDE + ARRANGEMENT_COLUMN] += f64::from(ROCK_TREE);
        }
    }
}

fn along(stamp: RockStamp, axis: RockArrangement, hand: isize) -> isize {
    let (w, h) = stamp.dimensions();
    if matches!(axis, RockArrangement::Horizontal) {
        (stamp.x + if hand > 0 { w } else { 0 }) as isize
    } else {
        (stamp.y + if hand > 0 { h } else { 0 }) as isize
    }
}

fn across(stamp: RockStamp, axis: RockArrangement, hand: isize) -> isize {
    let (w, h) = stamp.dimensions();
    if matches!(axis, RockArrangement::Horizontal) {
        (stamp.y + if hand > 0 { h } else { 0 }) as isize
    } else {
        (stamp.x + if hand > 0 { w } else { 0 }) as isize
    }
}

fn trace_cell(ground: &RockGround, axis: RockArrangement, axial: isize, lane: isize) -> Option<usize> {
    if matches!(axis, RockArrangement::Horizontal) { ground.cell(axial, lane) }
    else { ground.cell(lane, axial) }
}

fn continental_step(range: &RockRange, ground: &RockGround, flags: &[u32],
    tip: RockStamp, hand: isize, rise: isize, gap: usize, lane: Option<isize>, seed: u32) -> Option<RockStamp> {
    let horizontal = matches!(range.arrangement, RockArrangement::Horizontal);
    let variation = hash(seed, tip.y * ground.width + tip.x, 223);
    let phase = (hash(seed, range.focus, 227) % 29) as isize;
    let wave = (along(tip, range.arrangement, hand) + phase).div_euclid(14).rem_euclid(6);
    let bend = if matches!(range.arrangement, RockArrangement::Diagonal) { rise }
        else if gap > 0 { if variation & 3 != 0 { rise } else { -rise } }
        else { match wave { 0 | 1 => rise, 3 | 4 => -rise, _ => 0 } };
    let sides = if variation & 2 == 0 { [1, -1] } else { [-1, 1] };
    let offsets = if gap > 0 { [0, 1, -1, 2, -2, 3, -3] }
        else if !matches!(range.arrangement, RockArrangement::Diagonal) && bend != 0 && variation & 8 != 0 {
            [bend * hand, 0, -bend * hand, 2, -2, 3, -3]
        } else { [0, sides[0], sides[1], 2 * sides[0], 2 * sides[1], 3, -3] };
    let shapes = if gap == 0 && horizontal && tip.shape == 4 {
        match variation % 3 {
            0 => [5, 3, 2, 4, 0, 1],
            1 => [2, 5, 3, 4, 0, 1],
            _ => [3, 5, 2, 4, 0, 1],
        }
    } else if gap == 0 && !horizontal && tip.shape == 5 { [3, 2, 5, 4, 1, 0] }
    else if horizontal && variation & 1 == 0 { [4, 5, 2, 3, 0, 1] }
    else if horizontal { [5, 2, 4, 3, 0, 1] }
    else { [5, 3, 2, 4, 1, 0] };
    shapes.into_iter().find_map(|shape| {
        offsets.into_iter().find_map(|offset| {
            let stamp = range_member(tip, range.arrangement, hand, bend, shape, offset)?;
            let jump = gap as isize * hand;
            let stamp = RockStamp::new(stamp.x as isize + if horizontal { jump } else { 0 },
                stamp.y as isize + if horizontal { 0 } else { jump }, shape)?;
            let landing = lane.is_none_or(|lane| {
                (across(stamp, range.arrangement, -1)..across(stamp, range.arrangement, 1)).contains(&lane)
                    && stamp.dimensions().1 >= 2
            });
            (landing && (gap > 0 || tip.adjoining(stamp)) && range.accepts(stamp, ground, flags)).then_some(stamp)
        })
    })
}

/// Reserve a dry passage or cross an existing narrow reach. Water cells are
/// tagged for display only, and require a dry landing on each side.
fn continental_gap(range: &RockRange, ground: &RockGround, flags: &[u32], tip: RockStamp,
    hand: isize, rise: isize, river: bool, seed: u32) -> Option<(RockStamp, Vec<usize>, isize)> {
    let horizontal = matches!(range.arrangement, RockArrangement::Horizontal);
    let (tw, th) = tip.dimensions();
    let cross = (if horizontal { tip.y + th / 2 } else { tip.x + tw / 2 }) as isize;
    let boundary = along(tip, range.arrangement, hand) - (hand < 0) as isize;
    let width = if river { 5 } else { 4 };
    let first_span = if river { 1 } else { 2 };
    let at = |step: usize, cross: isize| {
        let axial = boundary + step as isize * hand;
        trace_cell(ground, range.arrangement, axial, cross)
    };
    for span in first_span..=width {
        if !river {
            let Some(next) = continental_step(range, ground, flags, tip, hand, rise, span, None, seed)
                .filter(|stamp| stamp.dimensions().1 >= 2) else { continue; };
            // Reserve a complete level cross-section beyond the rock's edges.
            let flank = if horizontal { 6 } else { 8 };
            let cells: Option<Vec<_>> = (0..span).flat_map(|step| {
                (cross - flank..=cross + flank).map(move |side| at(step, side))
            }).map(|cell| cell.filter(|&cell| flags[cell] & ROCK_SITE != 0)).collect();
            if let Some(cells) = cells { return Some((next, cells, cross)); }
            continue;
        }
        for drift in [0, -1, 1] {
            let lane = cross + drift;
            if !(across(tip, range.arrangement, -1)..across(tip, range.arrangement, 1)).contains(&lane) { continue; }
            let cells: Option<Vec<_>> = (0..span).map(|step| at(step, lane)).collect();
            let Some(cells) = cells else { continue; };
            if cells.iter().any(|&cell| ground.channel(cell) & RIVER_WATER == 0 && flags[cell] & ROCK_SITE == 0) {
                continue;
            }
            let wet: Vec<_> = cells.iter().copied().enumerate()
                .filter(|&(_, cell)| ground.channel(cell) & RIVER_WATER != 0).collect();
            let Some(&(last, _)) = wet.last() else { continue; };
            if wet.len() > 3 || wet[0].0 > 1 || span - last - 1 > 1 || last - wet[0].0 + 1 != wet.len() { continue; }
            let narrow = wet.iter().any(|&(_, cell)| {
                let mut near = ground.channel(cell) & NARROW_CHANNEL != 0;
                adjacent(cell, ground.width, ground.height, |neighbor| {
                    near |= ground.channel(neighbor) & NARROW_CHANNEL != 0;
                });
                near
            });
            if !narrow { continue; }
            if let Some(next) = continental_step(range, ground, flags, tip, hand, rise, span, Some(lane), seed) {
                return Some((next, wet.into_iter().map(|(_, cell)| cell).collect(), lane));
            }
        }
    }
    None
}

fn river_frontage(ground: &RockGround, flags: &[u32], axis: RockArrangement,
    stamp: RockStamp, facing: isize, lane: isize) -> u8 {
    let edge = along(stamp, axis, facing) - (facing < 0) as isize;
    let covered = across(stamp, axis, -1)..across(stamp, axis, 1);
    let mut bits = 0;
    for offset in -3..=3 {
        let cross = lane + offset;
        if !covered.contains(&cross) { continue; }
        let Some(bank) = trace_cell(ground, axis, edge, cross) else { continue; };
        let wet = ground.channel(bank) & RIVER_WATER != 0;
        let next_wet = flags[bank] & WALK != 0
            && trace_cell(ground, axis, edge + facing, cross).is_some_and(|cell| ground.channel(cell) & RIVER_WATER != 0);
        if wet || next_wet { bits |= 1 << (offset + 3); }
    }
    bits
}

fn frontage_length(bits: u8) -> usize {
    if bits & (1 << 3) == 0 { return 0; }
    let left = (0..3).rev().take_while(|&lane| bits & (1 << lane) != 0).count();
    let right = (4..7).take_while(|&lane| bits & (1 << lane) != 0).count();
    1 + left + right
}

fn extend_canyon_bank(range: &mut RockRange, ground: &RockGround, flags: &[u32],
    root: RockStamp, facing: isize, lane: isize, opposite: u8, avoid: &[RockStamp]) -> u8 {
    let axis = range.arrangement;
    let mut frontage = river_frontage(ground, flags, axis, root, facing, lane);
    let mut tips = [root; 2];
    for _ in 0..4 {
        if frontage_length(frontage & opposite) >= 5 { break; }
        let mut best: Option<((usize, usize), usize, RockStamp, u8)> = None;
        for (flank, hand) in [-1, 1].into_iter().enumerate() {
            let tip = tips[flank];
            for shape in [5, 3, 2, 0, 1] {
                for drift in [0, -1, 1, -2, 2] {
                    let Some(stamp) = range_shoulder(tip, axis, hand, shape, drift) else { continue; };
                    if !tip.adjoining(stamp) || !range.accepts(stamp, ground, flags)
                        || avoid.iter().any(|&other| stamp.overlaps(other)) { continue; }
                    let next = frontage | river_frontage(ground, flags, axis, stamp, facing, lane);
                    let both = frontage_length(next & opposite);
                    let whole = frontage_length(next);
                    if whole <= frontage_length(frontage) { continue; }
                    let score = (both, whole);
                    if best.as_ref().is_none_or(|&(previous, ..)| score > previous) {
                        best = Some((score, flank, stamp, next));
                    }
                }
            }
        }
        let Some((_, flank, stamp, next)) = best else { break; };
        range.stamps.push(stamp);
        tips[flank] = stamp;
        frontage = next;
    }
    frontage
}

/// Stage the near rock face before checking the opposite face's bypasses.
/// A failed canyon leaves its river crossing usable as an ordinary break.
fn canyon_walls(range: &mut RockRange, draft: &mut RangeDraft, ground: &RockGround,
    near_root: RockStamp, far_root: RockStamp, hand: isize, lane: isize) -> Option<(Vec<RockStamp>, usize)> {
    let mut near = RockRange::new(range.arrangement, RangeLength::Short, range.focus);
    let near_front = extend_canyon_bank(&mut near, ground, draft.flags, near_root, hand, lane, 0x7f, &range.stamps);
    if frontage_length(near_front) < 3 || !near.connected(ground, draft.flags) { return None; }
    let checkpoint = draft.changed.len();
    for &stamp in &near.stamps { draft.stage(stamp, ground.width); }
    let backbone = range.stamps.len();
    let far_front = extend_canyon_bank(range, ground, draft.flags, far_root, -hand, lane, near_front, &[]);
    let frontage = frontage_length(near_front & far_front);
    if frontage < 3 || !range.fill_pockets(ground, draft.flags)
        || !range.connected(ground, draft.flags) {
        range.stamps.truncate(backbone);
        draft.restore(checkpoint);
        return None;
    }
    Some((near.stamps, frontage))
}

fn extend_rock_belt(range: &mut RockRange, ground: &RockGround, flags: &[u32],
    core: RockStamp, spine: usize, side: isize, low: isize, high: isize) {
    let axis = range.arrangement;
    for direction in [-1, 1] {
        let mut edge = core;
        for _ in 0..2 {
            let next = [5, 2, 3, 0].into_iter().find_map(|shape| {
                [0, -side, side, -2 * side, 2 * side].into_iter().find_map(|offset| {
                    let stamp = range_member(edge, axis, direction, 0, shape, offset)?;
                    (along(stamp, axis, -1) > low && along(stamp, axis, 1) < high
                        && edge.adjoining(stamp) && range.stamps[..spine].iter().any(|parent| parent.adjoining(stamp))
                        && range.accepts(stamp, ground, flags)).then_some(stamp)
                })
            });
            let Some(next) = next else { break; };
            range.stamps.push(next);
            edge = next;
        }
    }
}

fn continental_leg(range: &mut RockRange, ground: &RockGround, flags: &[u32], first: RockStamp,
    hand: isize, rise: isize, remaining: usize, seed: u32) -> Option<RockStamp> {
    let mut tip = first;
    let start = along(first, range.arrangement, -hand);
    range.stamps.push(first);
    for _ in 1..9 {
        if along(tip, range.arrangement, hand).abs_diff(start) >= remaining.min(22) { break; }
        let Some(next) = continental_step(range, ground, flags, tip, hand, rise, 0, None, seed) else { break; };
        range.stamps.push(next);
        tip = next;
    }
    let spine = range.stamps.len();
    if spine < 2 { return None; }
    let low = start.min(along(tip, range.arrangement, hand));
    let high = start.max(along(tip, range.arrangement, hand));
    // Keep foothills inside the leg ends, so an adjoining leg shares only a
    // spine edge and a pass cannot be closed by a protruding shoulder.
    let axis = range.arrangement;
    let horizontal = matches!(axis, RockArrangement::Horizontal);
    let profile = hash(seed, first.y * ground.width + first.x, 235);
    let focus = if horizontal { range.focus % ground.width } else { range.focus / ground.width };
    let near_center = (focus as isize).abs_diff(start) <= 40;
    let belt = remaining > 14 && (near_center || profile & 7 == 0);
    let side_preference = if near_center { hash(seed, range.focus, 242) } else { profile };
    let broad_side = if side_preference & 1 == 0 { 1 } else { -1 };
    let knot = (profile >> 1) as usize % spine;
    let counter = (knot + 1 + (profile >> 9) as usize % (spine - 1)) % spine;
    let shoulder = |range: &mut RockRange, parent: RockStamp, side: isize, shapes: [usize; 3], drift: isize| {
        let placed = shapes.into_iter().find_map(|shape| {
            [drift, drift.signum(), 0, -drift.signum(), -drift].into_iter().find_map(|offset| {
                let stamp = range_shoulder(parent, axis, side, shape, offset)?;
                (along(stamp, axis, -1) > low && along(stamp, axis, 1) < high
                    && parent.adjoining(stamp) && range.accepts(stamp, ground, flags)).then_some(stamp)
            })
        })?;
        range.stamps.push(placed);
        Some(placed)
    };
    let mut core = None;
    let mut core_limit = spine;
    // One flank grows into the broad knot and trails off along the spine.
    // The opposite shoulder starts at another point along the leg.
    for index in std::iter::once(knot).chain((0..spine).filter(|&index| index != knot)) {
        let parent = range.stamps[index];
        if parent.shape < 2 { continue; }
        let variation = hash(seed, parent.y * ground.width + parent.x, 236);
        let on_counter = index == counter
            || (spine >= 6 && index.abs_diff(counter) == 1 && index.abs_diff(knot) > 1);
        let side = if on_counter { -broad_side } else { broad_side };
        let drift = if variation & 1 == 0 { 2 * hand } else { -2 * hand };
        if side != broad_side {
            let shapes = if spine >= 6 && index == counter { [5, 3, 2] } else { [3, 2, 0] };
            let _ = shoulder(range, parent, side, shapes, drift);
        } else if core.is_none() {
            let shapes = if horizontal { [4, 5, 3] } else { [5, 3, 2] };
            core = shoulder(range, parent, side, shapes, drift);
            if let Some(stamp) = core {
                core_limit = range.stamps.len();
                if belt {
                    extend_rock_belt(range, ground, flags, stamp, spine, broad_side, low, high);
                }
            }
        } else if index.abs_diff(knot) <= 1 {
            let _ = shoulder(range, parent, side, [2, 3, 0], drift);
        } else if variation & 3 != 0 {
            let shapes = if variation & 4 == 0 { [2, 0, 1] } else { [0, 2, 1] };
            let _ = shoulder(range, parent, side, shapes, drift);
        }
    }
    if let Some(stamp) = core {
        if (spine >= 6 || profile & 4 != 0) && remaining > 12 {
            let _ = shoulder(range, stamp, broad_side, [3, 0, 2], hand);
        }
    }
    let widened = range.stamps.len();
    let mut previous = usize::MAX;
    for keep in [widened, widened.saturating_sub(2).max(core_limit),
        widened.saturating_sub(4).max(core_limit), core_limit, spine] {
        if keep == previous { continue; }
        previous = keep;
        range.stamps.truncate(keep);
        if range.fill_pockets(ground, flags) && range.connected(ground, flags) { return Some(tip); }
    }
    None
}

fn grow_continental(result: &mut ContinentalRange, draft: &mut RangeDraft, ground: &RockGround,
    roots: [RockStamp; 2], seed: u32) {
    let (axis, focus) = (result.axis, result.focus);
    let mut range = RockRange::new(axis, RangeLength::Medium, focus);
    let variation = hash(seed, focus, 241);
    let rise = if variation & 1 == 0 { 1 } else { -1 };
    let reach = 57 + (variation % 12) as usize;
    let mut water_jumps = result.river_passes;
    for (hand, root) in [-1, 1].into_iter().zip(roots) {
        let origin = along(root, axis, hand);
        let mut tip = root;
        let mut dry = false;
        for index in 0..8 {
            let distance = along(tip, axis, hand).abs_diff(origin);
            if distance >= reach { break; }
            range.stamps.clear();
            let mut gap = Vec::new();
            let mut river_lane = None;
            let mut start = None;
            if !dry && index >= 1 && distance >= 14 && result.dry_passes < 2 {
                if let Some((stamp, cells, _)) = continental_gap(&range, ground, draft.flags, tip, hand, rise, false, seed) {
                    start = Some(stamp);
                    gap = cells;
                }
            }
            if start.is_none() { start = continental_step(&range, ground, draft.flags, tip, hand, rise, 0, None, seed); }
            if start.is_none() && water_jumps < 3 {
                if let Some((stamp, cells, lane)) = continental_gap(&range, ground, draft.flags, tip, hand, rise, true, seed) {
                    start = Some(stamp);
                    gap = cells;
                    river_lane = Some(lane);
                }
            }
            let Some(start) = start else { break; };
            let Some(end) = continental_leg(&mut range, ground, draft.flags, start, hand, rise, reach - distance, seed) else { break; };
            if let Some(lane) = river_lane {
                water_jumps += 1;
                if result.river_passes == 0 {
                    if let Some((walls, frontage)) = canyon_walls(&mut range, draft, ground, tip, start, hand, lane) {
                        result.stamps.extend(walls);
                        result.gaps.extend(gap);
                        result.river_passes = 1;
                        result.canyon_frontage = frontage;
                    }
                }
            } else if !gap.is_empty() {
                result.dry_passes += 1;
                dry = true;
                for &cell in &gap { draft.clear(cell, ROCK_SITE | ELIGIBLE | PEAT_SITE); }
                result.gaps.extend(gap);
            }
            result.trees.extend(range.decorative_trees(ground, draft.flags, seed));
            for &stamp in &range.stamps {
                draft.stage(stamp, ground.width);
                result.stamps.push(stamp);
            }
            tip = end;
        }
    }
}

fn continental_range(ground: &RockGround, flags: &mut [u32], axis: RockArrangement,
    focus: usize, seed: u32) -> Option<ContinentalRange> {
    let mut draft = RangeDraft { flags, changed: Vec::new() };
    let mut range = RockRange::new(axis, RangeLength::Medium, focus);
    let (x, y) = ((focus % ground.width) as isize, (focus / ground.width) as isize);
    let main = [4, 5, 2, 3].into_iter().find_map(|shape| {
        let (w, h) = ROCK_SHAPES[shape];
        let stamp = RockStamp::new(x - w as isize / 2, y - h as isize / 2, shape)?;
        (range.accepts(stamp, ground, draft.flags) && ground.connected(stamp, draft.flags)).then_some(stamp)
    })?;
    range.stamps.push(main);
    let low = along(main, axis, -1);
    let high = along(main, axis, 1);
    let side = if hash(seed, focus, 242) & 1 == 0 { 1 } else { -1 };
    for (flank, shapes) in [(side, [5, 2, 3]), (-side, [3, 2, 0])] {
        let shoulder = shapes.into_iter().find_map(|shape| {
            [flank, 0, -flank].into_iter().find_map(|drift| {
                let stamp = range_shoulder(main, axis, flank, shape, drift)?;
                (along(stamp, axis, -1) >= low && along(stamp, axis, 1) <= high
                    && main.adjoining(stamp) && range.accepts(stamp, ground, draft.flags)).then_some(stamp)
            })
        });
        if let Some(stamp) = shoulder { range.stamps.push(stamp); }
    }
    if !range.fill_pockets(ground, draft.flags) || !range.connected(ground, draft.flags) {
        range.stamps.truncate(1);
    }
    let mut result = ContinentalRange { axis, focus, stamps: range.stamps, gaps: Vec::new(), trees: Vec::new(),
        river_passes: 0, dry_passes: 0, canyon_frontage: 0 };
    for &stamp in &result.stamps { draft.stage(stamp, ground.width); }
    grow_continental(&mut result, &mut draft, ground, [main; 2], seed);
    (result.span() >= 90).then_some(result)
}

#[derive(Clone, Copy)]
struct CanyonSite {
    cell: usize,
    axis: RockArrangement,
    lane: isize,
    start: isize,
    end: isize,
}

fn canyon_site(ground: &RockGround, cell: usize, axis: RockArrangement) -> Option<CanyonSite> {
    let (x, y) = ((cell % ground.width) as isize, (cell / ground.width) as isize);
    let (major, lane) = if matches!(axis, RockArrangement::Horizontal) { (x, y) } else { (y, x) };
    let river = |major| trace_cell(ground, axis, major, lane).is_some_and(|cell| ground.channel(cell) & RIVER_WATER != 0);
    let (mut start, mut end) = (major, major + 1);
    while river(start - 1) {
        start -= 1;
        if end - start > 3 { return None; }
    }
    while river(end) {
        end += 1;
        if end - start > 3 { return None; }
    }
    Some(CanyonSite { cell, axis, lane, start, end })
}

fn bank_root(ground: &RockGround, flags: &[u32], site: CanyonSite,
    hand: isize, province: Option<usize>) -> Option<RockStamp> {
    let horizontal = matches!(site.axis, RockArrangement::Horizontal);
    let mut best = None;
    for shape in [5, 4, 3, 2] {
        let (w, h) = ROCK_SHAPES[shape];
        let (depth, cross) = if horizontal { (w, h) } else { (h, w) };
        for setback in 0..=1 {
            let major = if hand < 0 { site.start - depth as isize - setback } else { site.end + setback };
            for offset in [0, -1, 1] {
                let lane = site.lane - cross as isize / 2 + offset;
                let (x, y) = if horizontal { (major, lane) } else { (lane, major) };
                let Some(stamp) = RockStamp::new(x, y, shape) else { continue; };
                if !ground.open(stamp, flags) || province.is_some_and(|focus| {
                    !ground.same_province(stamp.y * ground.width + stamp.x, focus)
                }) { continue; }
                let frontage = frontage_length(river_frontage(ground, flags, site.axis, stamp, -hand, site.lane));
                let score = (frontage, 1 - setback, w * h);
                if frontage > 0 && best.as_ref().is_none_or(|(value, _)| score > *value)
                    && ground.connected(stamp, flags) {
                    best = Some((score, stamp));
                }
            }
        }
    }
    best.map(|(_, stamp)| stamp)
}

fn canyon_first(ground: &RockGround, flags: &mut [u32], site: CanyonSite, seed: u32) -> Option<ContinentalRange> {
    let near = bank_root(ground, flags, site, -1, None)?;
    let (w, h) = near.dimensions();
    let focus = (near.y + h / 2) * ground.width + near.x + w / 2;
    let far = bank_root(ground, flags, site, 1, Some(focus))?;
    let mut draft = RangeDraft { flags, changed: Vec::new() };
    draft.stage(near, ground.width);
    let mut far_leg = RockRange::new(site.axis, RangeLength::Short, focus);
    far_leg.stamps.push(far);
    let (walls, frontage) = canyon_walls(&mut far_leg, &mut draft, ground, near, far, 1, site.lane)?;
    for &stamp in &far_leg.stamps { draft.stage(stamp, ground.width); }
    let mut stamps = vec![near];
    stamps.extend(walls);
    stamps.extend(far_leg.stamps);
    let gaps = (site.start..site.end).filter_map(|major| trace_cell(ground, site.axis, major, site.lane)).collect();
    let mut result = ContinentalRange { axis: site.axis, focus, stamps, gaps, trees: Vec::new(),
        river_passes: 1, dry_passes: 0, canyon_frontage: frontage };
    grow_continental(&mut result, &mut draft, ground, [near, far], seed);
    (result.span() >= 90).then_some(result)
}

fn canyon_clearance(ground: &RockGround, flags: &[u32], site: CanyonSite) -> Option<(usize, bool)> {
    let banks = [trace_cell(ground, site.axis, site.start - 1, site.lane)?,
        trace_cell(ground, site.axis, site.end, site.lane)?];
    if banks.iter().any(|&cell| flags[cell] & ROCK_SITE == 0) { return None; }
    if !ground.same_province(banks[0], banks[1]) { return None; }
    let mut room = 0;
    for (hand, edge) in [(-1, site.start - 1), (1, site.end)] {
        for radius in [5, 12, 20, 28, 38, 48, 58] {
            let axial = edge + hand * radius;
            if [0, -4, 4, -8, 8].into_iter().any(|offset| {
                trace_cell(ground, site.axis, axial, site.lane + offset).is_some_and(|cell| {
                    flags[cell] & ROCK_SITE != 0 && ground.same_province(cell, banks[0])
                })
            }) {
                room += 1;
            }
        }
    }
    (room >= 8).then_some((room, ground.palette(banks[0]) <= 1))
}

fn choose_continental(ground: &RockGround, seed: u32, flags: &mut [u32],
    candidates: &[Vec<(f64, usize)>; 4], palette_order: &[usize; 4]) -> Option<ContinentalRange> {
    if ground.width.min(ground.height) < 200 { return None; }
    use std::cmp::Reverse;
    // Choose portals before growing the range so the long arms do not have
    // to discover and align to the same river by accident.
    let mut portals = Vec::new();
    for cell in 0..flags.len() {
        if ground.channel(cell) & (RIVER_WATER | NARROW_CHANNEL | FORD_ACCESS) != RIVER_WATER | NARROW_CHANNEL { continue; }
        for axis in [RockArrangement::Horizontal, RockArrangement::Vertical] {
            let Some(site) = canyon_site(ground, cell, axis) else { continue; };
            if let Some((room, temperate)) = canyon_clearance(ground, flags, site) {
                portals.push((Reverse(room), Reverse(temperate), hash(seed, cell, 253 + axis as u32), site));
            }
        }
    }
    portals.sort_unstable_by_key(|&(room, temperate, priority, site)| (room, temperate, priority, site.cell, site.axis as u8));
    let mut best: Option<(usize, ContinentalRange)> = None;
    for (_, _, _, site) in portals.into_iter().take(120) {
        let Some(range) = canyon_first(ground, flags, site, seed) else { continue; };
        if range.dry_passes > 0 && range.canyon_frontage >= 5 && ground.palette(range.focus) <= 1 {
            return Some(range);
        }
        let score = range.span() + 60 + 18 * range.canyon_frontage + 16 * range.dry_passes
            + 10 * (ground.palette(range.focus) <= 1) as usize + 300 * (range.dry_passes > 0) as usize;
        if best.as_ref().is_none_or(|(previous, _)| score > *previous) { best = Some((score, range)); }
    }
    if best.as_ref().is_some_and(|(_, range)| range.dry_passes > 0) {
        return best.map(|(_, range)| range);
    }

    // Fall back to the original bank-biased and dry searches on maps whose
    // known river portals do not leave enough terrain for continental arms.
    let mut banks = Vec::new();
    for river in 0..flags.len() {
        if ground.channel(river) & (RIVER_WATER | NARROW_CHANNEL) != RIVER_WATER | NARROW_CHANNEL { continue; }
        let (x, y) = ((river % ground.width) as isize, (river / ground.width) as isize);
        for distance in [-16, -10, -5, 5, 10, 16] {
            for (axis, point) in [(0, ground.cell(x + distance, y)), (1, ground.cell(x, y + distance))] {
                if let Some(focus) = point.filter(|&focus| flags[focus] & ROCK_SITE != 0) {
                    banks.push((hash(seed, focus, 249 + axis as u32), focus, axis));
                }
            }
        }
    }
    banks.sort_unstable();
    banks.dedup();
    let dry = palette_order.iter().flat_map(|&palette| {
        candidates[palette].iter().step_by(9).take(48).flat_map(|&(_, focus)| {
            let axis = hash(seed, focus, 251) as usize % RANGE_AXES.len();
            [(0, focus, axis), (0, focus, (axis + 1) % RANGE_AXES.len())]
        })
    });
    for (_, focus, axis) in banks.into_iter().take(280).chain(dry) {
        let Some(range) = continental_range(ground, flags, RANGE_AXES[axis], focus, seed) else { continue; };
        if range.river_passes > 0 && range.dry_passes > 0 { return Some(range); }
        let score = range.span() + 36 * range.river_passes + 12 * range.dry_passes
            + 18 * range.canyon_frontage;
        if best.as_ref().is_none_or(|(previous, _)| score > *previous) { best = Some((score, range)); }
    }
    best.map(|(_, range)| range)
}

/// Rotate independent length and orientation targets around the world.
/// Only accepted layouts alter the world or reserve their surrounding apron.
fn rock_ranges(ground: &RockGround, seed: u32, flags: &mut [u32], output: &mut [f64], fjord_stamps: &[RockStamp]) {
    let (w, h) = (ground.width, ground.height);
    let mut excluded = vec![false; w * h];
    if !fjord_stamps.is_empty() {
        for stamp in fjord_stamps { reserve_rock_apron(std::slice::from_ref(stamp), ground, &mut excluded, 2); }
        // The continental range planner reads the terrain flags directly.
        for (cell, &protected) in excluded.iter().enumerate() {
            if protected { flags[cell] &= !ROCK_SITE; }
        }
    }
    let mut candidates: [Vec<(f64, usize)>; 4] = Default::default();
    for cell in 0..w * h {
        if flags[cell] & ROCK_SITE == 0 { continue; }
        let tile = ground.tile(cell);
        let noise = f64::from(hash(seed, cell, 59)) / 4294967296.0;
        let (x, y) = ((cell % w) as isize, (cell / w) as isize);
        let room = [(-4, -4), (0, -4), (4, -4), (-4, 0), (4, 0), (-4, 4), (0, 4), (4, 4)]
            .into_iter().filter(|&(dx, dy)| ground.cell(x + dx, y + dy).is_some_and(|other| {
                flags[other] & ROCK_SITE != 0 && ground.same_province(other, cell)
            })).count();
        candidates[ground.palette(cell)].push((noise * 0.35 - tile[1].clamp(0.0, 1.0) - room as f64 * 0.025, cell));
    }
    for sites in &mut candidates { sites.sort_unstable_by(|a, b| a.0.total_cmp(&b.0).then_with(|| a.1.cmp(&b.1))); }
    let mut palette_order = [0, 1, 2, 3];
    palette_order.sort_by_key(|palette| std::cmp::Reverse(candidates[*palette].len()));
    if let Some(range) = choose_continental(ground, seed, flags, &candidates, &palette_order) {
        range.record(ground, flags, output, &mut excluded);
    }
    let mut placed = [0; 4];
    let eligible = candidates.iter().map(Vec::len).sum::<usize>();
    let target = (eligible / 1350).clamp(3, 9);
    let mut count = 0;
    let mut formed_axis = [false; 3];
    let mut formed_length = [false; 3];
    let start_axis = seed as usize % RANGE_AXES.len();
    for index in 0..9 {
        let axis = RANGE_AXES[(start_axis + index % 3 + index / 3) % 3];
        let length = RANGE_LENGTHS[index % 3];
        if count >= target && formed_axis[axis as usize] && formed_length[length as usize] { continue; }
        let found = palette_order.iter().find_map(|&palette| {
            candidates[palette].iter().filter(|&&(_, cell)| !excluded[cell]).take(1200).find_map(|&(_, cell)| {
                let range = long_range(ground, axis, length, cell, seed, flags)?;
                range.outside_apron(ground, &excluded).then_some((palette, range))
            })
        });
        if let Some((palette, range)) = found {
            range.record(ground, flags, output, &mut excluded, seed);
            placed[palette] += 1;
            count += 1;
            formed_axis[axis as usize] = true;
            formed_length[length as usize] = true;
        }
    }
    for (palette, sites) in candidates.iter().enumerate() {
        let land = sites.len();
        if land < 40 { continue; }
        let ranges = (land / 1200).max(1);
        for &(_, cell) in sites {
            if placed[palette] >= ranges { break; }
            if excluded[cell] { continue; }
            let (x, y) = ((cell % w) as isize, (cell / w) as isize);
            let jitter = hash(seed, cell, 83);
            let axis = RANGE_AXES[jitter as usize % RANGE_AXES.len()];
            if let Some(range) = long_range(ground, axis, RangeLength::Short, cell, seed, flags)
                .filter(|range| range.outside_apron(ground, &excluded)) {
                range.record(ground, flags, output, &mut excluded, seed);
                placed[palette] += 1;
                continue;
            }
            let order = if jitter & 1 == 0 { [4, 5, 2, 3] } else { [5, 4, 3, 2] };
            let Some(main) = order.into_iter().find_map(|shape| ground.try_bare(x, y, shape, flags, output, &excluded))
                else { continue; };
            reserve_rock_apron(&[main], ground, &mut excluded, 7);
            placed[palette] += 1;
        }
        let mut accents = 0;
        for &(_, cell) in sites {
            if accents == (land / 490).max(2) { break; }
            if excluded[cell] { continue; }
            let (x, y) = (cell % w, cell / w);
            let shape = (hash(seed, cell, 121) % 4) as usize;
            let Some(stamp) = ground.try_bare(x as isize, y as isize, shape, flags, output, &excluded) else { continue; };
            accents += 1;
            reserve_rock_apron(&[stamp], ground, &mut excluded, 4);
        }
    }
}

fn fjord_rock_open(stamp: RockStamp, ground: &RockGround, flags: &[u32]) -> bool {
    let (width, height) = stamp.dimensions();
    if stamp.x + width > ground.width || stamp.y + height > ground.height { return false; }
    let anchor = stamp.y * ground.width + stamp.x;
    stamp.cells(ground.width).all(|(cell, _, _)| flags[cell] & ROCK_SITE != 0
        && ground.channel(cell) & FJORD_ROCK != 0 && ground.same_province(cell, anchor))
}

/// Pack large rock formations along the dry headlands before mineral and
/// generic range placement. Small pieces fill the seams of larger masses.
/// Each footprint tests only its own bounded neighborhood for walkable detours.
fn fjord_rocks(ground: &RockGround, seed: u32, flags: &mut [u32], output: &mut [f64]) -> Vec<RockStamp> {
    let (w, h) = (ground.width, ground.height);
    let sites = (0..w * h).filter(|&cell| flags[cell] & ROCK_SITE != 0 && ground.channel(cell) & FJORD_ROCK != 0);
    let mut candidates = Vec::new();
    for cell in sites {
        for (shape, (width, height)) in ROCK_SHAPES.into_iter().enumerate() {
            let stamp = RockStamp { x: cell % w, y: cell / w, shape };
            if !fjord_rock_open(stamp, ground, flags) { continue; }
            let jitter = hash(seed, cell, 401 + shape as u32) % 384;
            let score = (width * height) as u32 * 100 + jitter;
            candidates.push((std::cmp::Reverse(score), cell, shape, stamp));
        }
    }
    candidates.sort_unstable_by_key(|&(score, cell, shape, _)| (score, cell, shape));
    let mut placed = Vec::new();
    for (_, cell, shape, stamp) in candidates {
        if !fjord_rock_open(stamp, ground, flags) { continue; }
        if shape <= 1 {
            let joins = stamp.cells(w).any(|(member, _, _)| {
                let mut joins = false;
                adjacent(member, w, h, |next| { joins |= output[next * OUTPUT_STRIDE + 8] != 0.0; });
                joins
            });
            let variation = hash(seed, cell, 419) % 100;
            if (!joins && variation >= 11) || (shape == 1 && variation >= 47) { continue; }
        }
        if !ground.connected(stamp, flags) { continue; }
        stamp.record(w, flags, output, None);
        placed.push(stamp);
    }
    placed
}

fn reserve_deposit(cell: usize, w: usize, h: usize, spacing: usize, excluded: &mut [bool]) {
    let (cx, cy) = (cell % w, cell / w);
    for yy in cy.saturating_sub(spacing)..=(cy + spacing).min(h - 1) {
        for xx in cx.saturating_sub(spacing)..=(cx + spacing).min(w - 1) {
            if xx.abs_diff(cx).pow(2) + yy.abs_diff(cy).pow(2) < spacing * spacing {
                excluded[yy * w + xx] = true;
            }
        }
    }
}

fn generate(settings: Res<Settings>, input: Res<Input>, mut output: ResMut<Output>) {
    let s = &*settings; let w = s.width; let h = s.height; let n = w * h;
    output.0.clear(); output.0.resize(n * OUTPUT_STRIDE, 0.0);
    if n == 0 || input.0.len() < n * INPUT_STRIDE { return; }
    let data = &input.0;
    let rock_ground = RockGround { width: w, height: h, input: data };
    let tiles = |cell: usize| &data[cell * INPUT_STRIDE..(cell + 1) * INPUT_STRIDE];
    let mut flags: Vec<u32> = (0..n).map(|cell| {
        let flags = tiles(cell)[0] as u32;
        if rock_ground.channel(cell) & (FORD_ACCESS | FJORD_SHORE) == 0 { flags }
        else { flags & !(ROCK_SITE | ELIGIBLE | PEAT_SITE | MARBLE_SITE) }
    }).collect();
    let fjord_stamps = if s.tutorial { Vec::new() } else { fjord_rocks(&rock_ground, s.seed, &mut flags, &mut output.0) };
    // Tutorial outcrops must be reachable from a founding city, rather than
    // occupying an attractive but inaccessible offshore island.
    let mut reachable=vec![!s.tutorial;n];let mut access=VecDeque::new();
    if s.tutorial {
        for cell in 0..n {if flags[cell]&SPAWN!=0 {reachable[cell]=true;access.push_back(cell);}}
        while let Some(cell)=access.pop_front(){adjacent(cell,w,h,|next|{
            if !reachable[next]&&flags[next]&WALK!=0 {reachable[next]=true;access.push_back(next);}
        });}
    }
    let mut candidates: Vec<_> = (0..n).filter(|&cell| reachable[cell] && flags[cell] & (ELIGIBLE | PEAT_SITE) != 0)
        .map(|cell| {
            let random = f64::from(hash(s.seed, cell, 17)) / 4294967296.0;
            let elevation = tiles(cell)[1].clamp(0.0, 1.0);
            (random - elevation * 0.2, cell)
        }).collect();
    candidates.sort_unstable_by(|a, b| a.0.total_cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    let dry = (0..n).filter(|&c| tiles(c)[3] != 0.0).count();
    let starts: Vec<_> = flags.iter().enumerate()
        .filter_map(|(cell, flags)| (flags >> START_REGION_SHIFT).checked_sub(1).map(|region| (cell, region as usize)))
        .collect();
    let region_count = starts.iter().map(|(_, region)| region + 1).max().unwrap_or(1);
    let mut marble_regions = vec![false; region_count];
    let desired = if s.tutorial {[2,2,0]} else {[(dry / 1600).max(1), (dry / 1900).max(1), (dry / 2800).max(1)]};
    let mut counts = [0usize; 3];
    let mut excluded = vec![false; n]; let mut group = s.first_group;
    // All size classes reuse the same sorted terrain index. Each cursor
    // advances at most once per tile, and placement only checks local ground.
    let mut cursors = [0; 3];
    let mut place = |kind: usize, family: usize, cursor: &mut usize, tutorial_half: Option<usize>| {
        let (width, height) = [(2, 2), (3, 3), (5, 3)][family];
        let rock = kind <= 3;
        let spacing = if s.tutorial { 5 } else { 10 };
        let (required, policy) = match kind {
            MARBLE_QUARRY => (ELIGIBLE | MARBLE_SITE, MARBLE_RESOURCE),
            PEAT_BED => (PEAT_SITE, PEAT_RESOURCE),
            WILD_GRAPES => (ELIGIBLE, GRAPES_RESOURCE),
            COAL_CUT => (ELIGIBLE, COAL_RESOURCE),
            _ => (ELIGIBLE, kind as u32 + 1),
        };
        while let Some(&(_, start)) = candidates.get(*cursor) {
            *cursor += 1;
            if excluded[start] || flags[start] & required != required || !deposit_climate(kind, tiles(start)) { continue; }
            let x = start % w;
            let y = start / w;
            if rock {
                let variation = (hash(s.seed, start, 43) & 1) as usize;
                let shape = [[3, 2], [2, 5], [4, 5]][family][variation];
                let stamp = RockStamp { x, y, shape };
                let (sw, sh) = stamp.dimensions();
                if y + sh >= h || tutorial_half.is_some_and(|half| {
                    (x >= w / 2) as usize != half || half == 0 && x + sw >= w / 2
                }) || !rock_ground.open(stamp, &flags) { continue; }
                if !stamp.cells(w).all(|(cell, _, _)| {
                    reachable[cell] && !excluded[cell] && deposit_climate(kind, tiles(cell))
                }) { continue; }
                let (ox, oy) = stamp.ore();
                let approach = (y + sh) * w + x + ox;
                let section = (y + oy) * w + x + ox;
                let terrain = tiles(section)[2];
                if !(0..2).all(|dx| flags[approach + dx] & ELIGIBLE != 0
                    && tiles(section + dx)[2] == terrain && tiles(section + dx + w)[2] == terrain)
                    || !rock_ground.connected(stamp, &flags) { continue; }
                stamp.record(w, &mut flags, &mut output.0, Some((kind, group, variation as f64)));
                for dx in 0..2 { flags[approach + dx] &= !ROCK_SITE; }
                for (cell, _, _) in stamp.cells(w) {
                    reserve_deposit(cell, w, h, spacing, &mut excluded);
                }
                group += 1;
                return true;
            }
            if let Some(half) = tutorial_half {
                if (x >= w / 2) as usize != half || (half == 0 && x + width >= w / 2) { continue; }
            }
            if x + width >= w || y + height >= h { continue; }
            let mut cells = Vec::with_capacity(width * height);
            let mut okay = true;
            for dy in 0..height { for dx in 0..width {
                let cell = (y + dy) * w + x + dx;
                cells.push(cell);
                okay &= reachable[cell] && !excluded[cell] && flags[cell] & required == required
                    && tiles(cell)[2] == tiles(start)[2] && deposit_climate(kind, tiles(cell));
            }}
            // Keep a flat southern approach for mine roads and workers.
            for dx in 0..width {
                let approach = (y + height) * w + x + dx;
                okay &= flags[approach] & ELIGIBLE != 0;
            }
            if !okay { continue; }
            let marble_region = if kind == MARBLE_QUARRY {
                let region = starts.iter().min_by_key(|(cell, region)| {
                    let distance = (cell % w).abs_diff(x).pow(2) + (cell / w).abs_diff(y).pow(2);
                    (distance, *region)
                }).map_or(0, |(_, region)| *region);
                if marble_regions[region] { continue; }
                Some(region)
            } else { None };
            let solid = ground_policy(policy) != 0;
            if solid && !connected(&cells, &flags, w, h) { continue; }
            let variant = (hash(s.seed, start, 43) & 1) as f64;
            for &cell in &cells {
                let at = cell * OUTPUT_STRIDE;
                output.0[at..at + 7].copy_from_slice(&[kind as f64, group as f64, start as f64, family as f64,
                    variant, width as f64, height as f64]);
                flags[cell] &= !(ELIGIBLE | PEAT_SITE | TREE | ROCK_SITE);
                if solid {
                    flags[cell] &= !WALK;
                }
                reserve_deposit(cell, w, h, spacing, &mut excluded);
            }
            if let Some(region) = marble_region { marble_regions[region] = true; }
            group += 1;
            return true;
        }
        false
    };
    for round in 0..*desired.iter().max().unwrap() {
        for kind in 1..=3 {
            let k = kind - 1;
            if counts[k] >= desired[k] { continue; }
            let wanted = (round + kind - 1) % 3;
            let placed = if s.tutorial {
                place(kind, 0, &mut cursors[round], Some(round))
            } else {
                // If the preferred shape cannot fit, try both other size classes.
                [wanted, (wanted + 1) % 3, (wanted + 2) % 3]
                    .into_iter().any(|family| place(kind, family, &mut cursors[family], None))
            };
            counts[k] += usize::from(placed);
        }
    }
    if !s.tutorial {
        let mut cursor = 0;
        for _ in 0..(dry / 6500).max(1).min(region_count) {
            if !place(MARBLE_QUARRY, 0, &mut cursor, None) { break; }
        }
        for kind in [PEAT_BED, WILD_GRAPES] {
            let mut cursor = 0;
            for _ in 0..(dry / 7500).clamp(1, 3) {
                if !place(kind, 0, &mut cursor, None) { break; }
            }
        }
        let mut cursor = 0;
        for _ in 0..(dry / 6500).clamp(1, 3) {
            if !place(COAL_CUT, 1, &mut cursor, None) { break; }
        }
        rock_ranges(&rock_ground, s.seed, &mut flags, &mut output.0, &fjord_stamps);
    }
}

pub struct Ores { world: World, generation: Schedule, habitat: Schedule, mining: Schedule }
impl Default for Ores {
    fn default() -> Self {
        let mut world = World::new(); world.init_resource::<Input>(); world.init_resource::<Output>(); world.init_resource::<Settings>(); world.init_resource::<Mining>();
        let mut generation = Schedule::default(); generation.add_systems(generate);
        let mut habitat = Schedule::default(); habitat.add_systems(habitats);
        let mut mining = Schedule::default(); mining.add_systems(mine);
        Self { world, generation, habitat, mining }
    }
}
impl Ores {
    pub fn prepare(&mut self, length: usize) -> *mut f64 { let mut input = self.world.resource_mut::<Input>(); input.0.clear(); input.0.resize(length, 0.0); input.0.as_mut_ptr() }
    pub fn generate(&mut self, width: usize, height: usize, seed: u32, first_group: u32, tutorial:bool) -> *const f64 {
        self.world.insert_resource(Settings { width, height, seed, first_group, tutorial }); self.generation.run(&mut self.world); self.world.resource::<Output>().0.as_ptr()
    }
    pub fn habitats(&mut self, width: usize, height: usize) -> *const f64 {
        self.world.insert_resource(Settings { width, height, ..Default::default() });
        self.habitat.run(&mut self.world); self.world.resource::<Output>().0.as_ptr()
    }
    pub fn produce_gold(&mut self, cells: usize, now: f64, due: f64, interval: f64) -> *const f64 {
        *self.world.resource_mut::<Mining>() = Mining { cells, now, due, interval, payout: [due, 0.0] };
        self.mining.run(&mut self.world);
        self.world.resource::<Mining>().payout.as_ptr()
    }
}
