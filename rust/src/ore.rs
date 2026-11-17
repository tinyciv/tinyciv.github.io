//! Complete mineral outcrops beside relief. Placement and mining yields run
//! in a Bevy world; the host mirrors footprints and renders approved sprites.
use bevy_ecs::prelude::*;
use std::collections::VecDeque;

const WALK: u32 = 1;
const ELIGIBLE: u32 = 2;
const TREE: u32 = 4;
// Resource codes: none, clay, copper, iron, gold, stone, salt, olives, fish.
// Bit 1: solid for everyone; bit 2: restricted to the assigned salt crew.
pub fn ground_policy(resource: u32) -> u32 {
    match resource { 2..=5 => 1, 6 => 2, _ => 0 }
}
/// The tall three-wide outcrop reserves its artwork, but only its front row
/// is solid. Soldiers can pass behind the peaks using the ordinary walk graph.
pub fn footprint_ground_policy(resource: u32, width: u32, height: u32, row: u32) -> u32 {
    if (2..=4).contains(&resource) && width == 3 && height == 3 && row < 2 { 0 }
    else { ground_policy(resource) }
}
pub fn work_access(resource: u32, phase: u32, worker: bool) -> bool {
    worker && resource == 6 && (1..=3).contains(&phase)
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
struct Visit { kind: u32, cells: usize, gold: f64 }
fn work(mut visit: ResMut<Visit>) { visit.gold = if visit.kind == 3 { visit.cells as f64 * GOLD_PER_TILE } else { 0.0 }; }
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
    if n == 0 || input.0.len() < n * 4 { return; }
    let data = &input.0;
    let mut flags: Vec<u32> = (0..n).map(|c| data[c * 4] as u32).collect();
    let relief: Vec<bool> = (0..n).map(|c| data[c * 4 + 1] != 0.0).collect();
    // Tutorial outcrops must be reachable from a founding city, rather than
    // occupying an attractive but inaccessible offshore island.
    let mut reachable=vec![!s.tutorial;n];let mut access=VecDeque::new();
    if s.tutorial {
        for cell in 0..n {if flags[cell]&8!=0 {reachable[cell]=true;access.push_back(cell);}}
        while let Some(cell)=access.pop_front(){adjacent(cell,w,h,|next|{
            if !reachable[next]&&flags[next]&WALK!=0 {reachable[next]=true;access.push_back(next);}
        });}
    }
    let mut distance = vec![u8::MAX; n]; let mut queue = VecDeque::new();
    for cell in 0..n { if relief[cell] { distance[cell] = 0; queue.push_back(cell); } }
    while let Some(cell) = queue.pop_front() {
        let d = distance[cell] + 1; if d > 5 { continue; }
        adjacent(cell, w, h, |next| { if distance[next] > d { distance[next] = d; queue.push_back(next); } });
    }
    let mut candidates: Vec<usize> = (0..n).filter(|c| reachable[*c]&&flags[*c] & ELIGIBLE != 0 && (s.tutorial||distance[*c] <= 3)).collect();
    candidates.sort_unstable_by_key(|c| (if s.tutorial {distance[*c].min(12)} else {0},hash(s.seed, *c, 17)));
    let dry = (0..n).filter(|c| data[c * 4 + 3] != 0.0).count();
    let desired = if s.tutorial {[2,2,0]} else {[(dry / 1600).max(1), (dry / 1900).max(1), (dry / 2800).max(1)]};
    let mut counts = [0usize; 3];
    let mut excluded = vec![false; n]; let mut group = s.first_group;
    for round in 0..*desired.iter().max().unwrap() { for kind in 1..=3 {
        let k = kind - 1; if counts[k] >= desired[k] { continue; }
        let wanted = (round + kind - 1) % 3;
        // Search suitable sites for the requested family before accepting a
        // smaller fallback. Narrow shoulders must not suppress every wide rib.
        'families: for family in if s.tutorial {vec![0]} else {vec![wanted,(wanted+1)%3,(wanted+2)%3]} {
            let (width, height) = match family { 0 => (2, 2), 1 => (3, 3), _ => (5, 3) };
            for &start in &candidates {
                if excluded[start] || flags[start] & ELIGIBLE == 0 { continue; }
                let x = start % w; let y = start / w;
                if s.tutorial&&((x>=w/2)as usize!=round||x+width>=w/2&&round==0) {continue;}
                if x + width >= w || y + height >= h { continue; }
                let mut cells = Vec::with_capacity(width * height); let mut touches = false; let mut okay = true;
                for dy in 0..height { for dx in 0..width {
                    let cell = (y + dy) * w + x + dx; cells.push(cell);
                    okay &= reachable[cell]&&!excluded[cell] && flags[cell] & ELIGIBLE != 0 && (s.tutorial||distance[cell] <= width.max(height) as u8)
                        && data[cell * 4 + 2] == data[start * 4 + 2];
                    touches |= distance[cell] == 1;
                }}
                // Keep a flat southern approach for mine roads and workers.
                for dx in 0..width { let front = (y + height) * w + x + dx; okay &= flags[front] & ELIGIBLE != 0; }
                let blocking: Vec<_> = cells.iter().copied().filter(|cell| footprint_ground_policy(
                    kind as u32 + 1, width as u32, height as u32, (cell / w - y) as u32) != 0).collect();
                if !okay || !s.tutorial&&!touches || !connected(&blocking, &flags, w, h) { continue; }
                for &cell in &cells {
                    let at = cell * 8;
                    output.0[at..at + 8].copy_from_slice(&[kind as f64, group as f64, start as f64, family as f64,
                        (hash(s.seed, start, 43) & 1) as f64, width as f64, height as f64, 0.0]);
                    flags[cell] &= !(ELIGIBLE | TREE);
                    if footprint_ground_policy(kind as u32 + 1, width as u32, height as u32, (cell / w - y) as u32) != 0 {
                        flags[cell] &= !WALK;
                    }
                    let cx = cell % w; let cy = cell / w;
                    let spacing=if s.tutorial {5} else {10};
                    for yy in cy.saturating_sub(spacing)..=(cy + spacing).min(h - 1) { for xx in cx.saturating_sub(spacing)..=(cx + spacing).min(w - 1) {
                        if (xx as isize - cx as isize).pow(2) + (yy as isize - cy as isize).pow(2) < (spacing*spacing)as isize { excluded[yy * w + xx] = true; }
                    }}
                }
                group += 1; counts[k] += 1; break 'families;
            }
        }
    }}
}

pub struct Ores { world: World, generation: Schedule, habitat: Schedule, work: Schedule }
impl Default for Ores {
    fn default() -> Self {
        let mut world = World::new(); world.init_resource::<Input>(); world.init_resource::<Output>(); world.init_resource::<Settings>(); world.init_resource::<Visit>();
        let mut generation = Schedule::default(); generation.add_systems(generate);
        let mut habitat = Schedule::default(); habitat.add_systems(habitats);
        let mut work_schedule = Schedule::default(); work_schedule.add_systems(work);
        Self { world, generation, habitat, work: work_schedule }
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
    pub fn work_yield(&mut self, kind: u32, cells: usize) -> f64 {
        self.world.insert_resource(Visit { kind, cells, gold: 0.0 }); self.work.run(&mut self.world); self.world.resource::<Visit>().gold
    }
}
