//! Complete mineral outcrops on exposed ground. Placement and mining yields run
//! in a Bevy world; the host mirrors footprints and renders approved sprites.
use bevy_ecs::prelude::*;
use std::collections::VecDeque;

const WALK: u32 = 1;
const ELIGIBLE: u32 = 2;
const TREE: u32 = 4;
const SPAWN: u32 = 8;
const MARBLE_SITE: u32 = 16;
const PEAT_SITE: u32 = 32;
const START_REGION_SHIFT: u32 = 6;
const INPUT_STRIDE: usize = 6;
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
/// Ore peaks overhang walkable ground north of the deposit's solid front row.
pub fn footprint_ground_policy(resource: u32, behind_front: bool) -> u32 {
    if behind_front && (2..=4).contains(&resource) { 0 }
    else { ground_policy(resource) }
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
    let removed = |cell: usize| cells.contains(&cell);
    let ground = |cell: usize| !removed(cell) && flags[cell] & WALK != 0;
    let mut approaches = Vec::new();
    for &cell in cells { adjacent(cell, w, h, |next| {
        if ground(next) && !approaches.contains(&next) { approaches.push(next); }
    }); }
    // Do not consume the last exposed clearing beside a forest tree.
    for &cell in cells {
        let mut okay = true;
        adjacent(cell, w, h, |tree| { if !removed(tree) && flags[tree] & TREE != 0 {
            let mut opening = false;
            adjacent(tree, w, h, |next| { opening |= ground(next) && flags[next] & TREE == 0; });
            okay &= opening;
        }});
        if !okay { return false; }
    }
    if approaches.len() < 2 { return true; }
    let x0 = cells.iter().map(|c| c % w).min().unwrap().saturating_sub(3);
    let y0 = cells.iter().map(|c| c / w).min().unwrap().saturating_sub(3);
    let x1 = (cells.iter().map(|c| c % w).max().unwrap() + 3).min(w - 1);
    let y1 = (cells.iter().map(|c| c / w).max().unwrap() + 3).min(h - 1);
    let bw = x1 - x0 + 1;
    let mut seen = vec![false; bw * (y1 - y0 + 1)];
    let local = |cell: usize| (cell / w - y0) * bw + cell % w - x0;
    let mut queue = VecDeque::from([approaches[0]]); seen[local(approaches[0])] = true;
    while let Some(cell) = queue.pop_front() { adjacent(cell, w, h, |next| {
        let x = next % w; let y = next / w;
        if x >= x0 && y >= y0 && x <= x1 && y <= y1 && ground(next) && !seen[local(next)] {
            seen[local(next)] = true; queue.push_back(next);
        }
    }); }
    approaches.iter().all(|cell| seen[local(*cell)])
}
fn generate(settings: Res<Settings>, input: Res<Input>, mut output: ResMut<Output>) {
    let s = &*settings; let w = s.width; let h = s.height; let n = w * h;
    output.0.clear(); output.0.resize(n * 8, 0.0);
    if n == 0 || input.0.len() < n * INPUT_STRIDE { return; }
    let data = &input.0;
    let tiles = |cell: usize| &data[cell * INPUT_STRIDE..(cell + 1) * INPUT_STRIDE];
    let mut flags: Vec<u32> = (0..n).map(|c| tiles(c)[0] as u32).collect();
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
            let front = y + height - 1;
            let blocking: Vec<_> = cells.iter().copied().filter(|cell| footprint_ground_policy(
                policy, cell / w < front) != 0).collect();
            if !connected(&blocking, &flags, w, h) { continue; }
            let variant = (hash(s.seed, start, 43) & 1) as f64;
            for &cell in &cells {
                let at = cell * 8;
                output.0[at..at + 8].copy_from_slice(&[kind as f64, group as f64, start as f64, family as f64,
                    variant, width as f64, height as f64, 0.0]);
                flags[cell] &= !(ELIGIBLE | PEAT_SITE | TREE);
                if footprint_ground_policy(policy, cell / w < front) != 0 {
                    flags[cell] &= !WALK;
                }
                let cx = cell % w;
                let cy = cell / w;
                let spacing = if s.tutorial { 5 } else { 10 };
                for yy in cy.saturating_sub(spacing)..=(cy + spacing).min(h - 1) {
                    for xx in cx.saturating_sub(spacing)..=(cx + spacing).min(w - 1) {
                        if xx.abs_diff(cx).pow(2) + yy.abs_diff(cy).pow(2) < spacing * spacing {
                            excluded[yy * w + xx] = true;
                        }
                    }
                }
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
