//! One-shot forest cover within the world's regional habitat field.
use crate::relief::{hash, noise};
use bevy_ecs::prelude::*;

#[derive(Resource, Default)]
struct Input(Vec<f64>);
#[derive(Resource, Default)]
struct Cover(Vec<u8>);
#[derive(Default)]
pub(crate) enum WoodlandLayout {
    #[default]
    Open,
    Dense,
    Ponds,
}

#[derive(Resource, Default)]
struct Settings {
    width: usize,
    height: usize,
    seed: u32,
    scale: f64,
    layout: WoodlandLayout,
}

fn generate(settings: Res<Settings>, input: Res<Input>, mut cover: ResMut<Cover>) {
    let (width, height, seed) = (settings.width, settings.height, settings.seed);
    let count = width * height;
    let trees = &mut cover.0;
    trees.clear();
    trees.resize(count, 0);
    if count == 0 || input.0.len() != count * 2 {
        return;
    }
    match settings.layout {
        WoodlandLayout::Dense => return grow_dense_forest(width, seed, settings.scale, &input.0, trees),
        WoodlandLayout::Ponds => return crate::forest_ponds::plan(width, height, seed, settings.scale, &input.0, trees),
        WoodlandLayout::Open => {}
    }

    // One field value is shared by nearby trees. A minor per-cell term keeps
    // the edges ragged, while the field's low areas form connected gaps.
    let spacing = 4.2 * settings.scale;
    let angle = hash(seed, 7, 113) * std::f64::consts::TAU;
    let (sin, cos) = angle.sin_cos();
    let mut priority = vec![0.0; count];
    for (cell, row) in input.0.chunks_exact(2).enumerate() {
        let suitability = row[0];
        if suitability <= 0.0 || row[1] == 0.0 {
            continue;
        }
        let x = (cell % width) as f64;
        let y = (cell / width) as f64;
        let grove = noise(
            seed,
            (x * cos + y * sin) / spacing,
            (y * cos - x * sin) / spacing,
        );
        let scatter = hash(seed ^ 0xa34e, x as i32, y as i32);
        let threshold = 0.44 - (suitability * 0.26).min(0.08);
        if grove * 0.85 + scatter * 0.15 < threshold {
            continue;
        }
        trees[cell] = 1;
        priority[cell] = hash(seed ^ 0x6413, x as i32, y as i32) + 0.15 * suitability;
    }

    for y in 0..height.saturating_sub(1) {
        for x in 0..width.saturating_sub(1) {
            let cell = y * width + x;
            let square = [cell, cell + 1, cell + width, cell + width + 1];
            if square.iter().all(|&next| trees[next] != 0) {
                let weakest = square
                    .into_iter()
                    .min_by(|&a, &b| priority[a].total_cmp(&priority[b]))
                    .unwrap();
                trees[weakest] = 0;
            }
        }
    }

    // Thinning only opens new ground. Visit weaker trees first to keep every
    // surviving tree next to a walkable opening, including beside cliffs.
    let mut candidates: Vec<_> = (0..count).filter(|&cell| trees[cell] != 0).collect();
    candidates
        .sort_unstable_by(|&a, &b| priority[a].total_cmp(&priority[b]).then_with(|| a.cmp(&b)));
    for cell in candidates {
        // Edge slots: east, west, south, north. The host packs only in-bounds
        // approaches across traversable terrain using the shared cliff rules.
        let edges = input.0[cell * 2 + 1] as u8;
        let has_opening = [1, -1, width as isize, -(width as isize)]
            .iter()
            .enumerate()
            .any(|(direction, &offset)| {
                edges & (1 << direction) != 0 && trees[(cell as isize + offset) as usize] == 0
            });
        if !has_opening {
            trees[cell] = 0;
        }
    }
}

const CLEARING: u8 = 1;
const DENSE_TREES: u8 = 2;
const FRINGE_TREES: u8 = 3;
const DENSE_HABITAT: u8 = 1 << 4;
const FRINGE_REACH: u8 = 11;

struct Grove {
    x: f64,
    y: f64,
    cos: f64,
    sin: f64,
    length: f64,
    breadth: f64,
    density: f64,
}

fn grove_grid(width: usize, height: usize, spacing: f64, seed: u32) -> (usize, Vec<Grove>) {
    let columns = (width as f64 / spacing).ceil() as usize + 4;
    let rows = (height as f64 / spacing).ceil() as usize + 4;
    let mut groves = Vec::with_capacity(columns * rows);
    for gy in -2..rows as i32 - 2 {
        for gx in -2..columns as i32 - 2 {
            let angle = hash(seed ^ 0x83d1, gx, gy) * std::f64::consts::PI;
            let (sin, cos) = angle.sin_cos();
            let length = spacing * (0.54 + hash(seed ^ 0x31ea, gx, gy) * 0.4);
            groves.push(Grove {
                x: (gx as f64 + 0.14 + hash(seed, gx, gy) * 0.72) * spacing,
                y: (gy as f64 + 0.14 + hash(seed ^ 0x185b, gx, gy) * 0.72) * spacing,
                cos,
                sin,
                length,
                breadth: length * (0.44 + hash(seed ^ 0x8399, gx, gy) * 0.43),
                density: 0.54 + hash(seed ^ 0x98f3, gx, gy) * 0.57,
            });
        }
    }
    (columns, groves)
}

/// Overlapping curved stands leave a mix of tight passages and broad gaps.
/// Each stand has its own bearing and canopy density. Noise roughens the
/// margin and breaks up the canopy in the more open stands.
fn dense_tree(seed: u32, x: f64, y: f64, spacing: f64, columns: usize, groves: &[Grove]) -> bool {
    let wx = x + (noise(seed ^ 0xb03c, x * 0.082, y * 0.082) - 0.5) * 7.0;
    let wy = y + (noise(seed ^ 0x780d, x * 0.082, y * 0.082) - 0.5) * 7.0;
    let gx = ((wx / spacing).floor() as isize + 2) as usize;
    let gy = ((wy / spacing).floor() as isize + 2) as usize;
    let roughness = noise(seed ^ 0xaabc, x * 0.19, y * 0.19) - 0.5;
    let pocket = (noise(seed ^ 0x4bd7, x * 0.115, y * 0.115) - 0.7).max(0.0);
    let limit = 1.03 + roughness * 0.54 - pocket * 2.0;
    let mut canopy: f64 = 0.0;
    for row in gy - 1..=gy + 1 {
        for column in gx - 1..=gx + 1 {
            let grove = &groves[row * columns + column];
            let (dx, dy) = (wx - grove.x, wy - grove.y);
            let u = (dx * grove.cos + dy * grove.sin) / grove.length;
            let v = (-dx * grove.sin + dy * grove.cos) / grove.breadth;
            let strength = ((limit - u * u - v * v) * 4.0).clamp(0.0, 1.0);
            canopy = canopy.max(strength * grove.density);
        }
    }
    // Correlated thinning keeps light groves in small clumps instead of
    // spreading independent empty tiles uniformly through the stands.
    let opening = hash(seed ^ 0xc136, x as i32, y as i32) * 0.58
        + noise(seed ^ 0xe82d, x * 0.33, y * 0.33) * 0.42;
    canopy > opening
}

fn linked_cells(input: &[f64], cell: usize, width: usize) -> impl Iterator<Item = usize> + '_ {
    let edges = input[cell * 2 + 1] as u8;
    [1, -1, width as isize, -(width as isize)]
        .into_iter()
        .enumerate()
        .filter(move |(direction, _)| edges & (1 << direction) != 0)
        .map(move |(_, offset)| (cell as isize + offset) as usize)
}

fn dense_habitat(input: &[f64], cell: usize) -> bool {
    input[cell * 2 + 1] as u8 & DENSE_HABITAT != 0
}

fn grow_dense_forest(width: usize, seed: u32, scale: f64, input: &[f64], cover: &mut [u8]) {
    let height = cover.len() / width;
    let spacing = 11.5 * scale;
    let (columns, groves) = grove_grid(width, height, spacing, seed);
    for cell in 0..cover.len() {
        if !dense_habitat(input, cell) {
            continue;
        }
        let habitat = input[cell * 2];
        let (x, y) = (cell % width, cell / width);
        // Smooth the existing regional habitat so the forest boundary encloses
        // complete stands. Sample only terrain that can host the forest biome.
        let mut sum = habitat * 2.0;
        let mut weight = 2.0;
        for (sx, sy) in [
            (x.saturating_sub(3), y),
            ((x + 3).min(width - 1), y),
            (x, y.saturating_sub(3)),
            (x, (y + 3).min(height - 1)),
        ] {
            let sample = sy * width + sx;
            if dense_habitat(input, sample) {
                sum += input[sample * 2];
                weight += 1.0;
            }
        }
        if sum / weight < 1.045 {
            continue;
        }
        cover[cell] = if dense_tree(seed, x as f64, y as f64, spacing, columns, &groves) {
            DENSE_TREES
        } else {
            CLEARING
        };
    }

    // Small habitat fragments read as ordinary woodland. Keep only regions
    // large enough for a stand and an opening.
    let mut visited = vec![false; cover.len()];
    let mut region = Vec::new();
    for start in 0..cover.len() {
        if cover[start] == 0 || visited[start] {
            continue;
        }
        region.clear();
        region.push(start);
        visited[start] = true;
        let mut trees = 0;
        let mut head = 0;
        while head < region.len() {
            let cell = region[head];
            head += 1;
            trees += usize::from(cover[cell] == DENSE_TREES);
            for next in linked_cells(input, cell, width) {
                if cover[next] != 0 && !visited[next] {
                    visited[next] = true;
                    region.push(next);
                }
            }
        }
        if region.len() < 24 || trees < 12 || region.len() - trees < 3 {
            for &cell in &region {
                cover[cell] = 0;
            }
        }
    }

    grow_forest_fringe(width, seed, input, cover, &mut region);
    reconnect_ground(width, input, cover, region);
}

/// Measure distance to the forest margin on both sides. Open trails inside
/// the biome are not edges, and the fringe cannot jump water or cliffs.
fn grow_forest_fringe(width: usize, seed: u32, input: &[f64], cover: &mut [u8], queue: &mut Vec<usize>) {
    let mut distance = vec![u8::MAX; cover.len()];
    queue.clear();
    for (cell, &canopy) in cover.iter().enumerate() {
        if canopy != 0 && linked_cells(input, cell, width)
            .any(|next| cover[next] == 0 && input[next * 2] > 0.0)
        {
            distance[cell] = 0;
            queue.push(cell);
        }
    }
    let mut head = 0;
    while head < queue.len() {
        let cell = queue[head];
        head += 1;
        if distance[cell] == FRINGE_REACH {
            continue;
        }
        for next in linked_cells(input, cell, width) {
            if distance[next] == u8::MAX && input[next * 2] > 0.0 {
                distance[next] = distance[cell] + 1;
                queue.push(next);
            }
        }
    }
    for &cell in queue.iter() {
        let depth = distance[cell] as f64;
        let (x, y) = ((cell % width) as i32, (cell / width) as i32);
        let (fx, fy) = (f64::from(x), f64::from(y));
        let patch = noise(seed ^ 0x3d85, fx * 0.17, fy * 0.17);
        let scatter = hash(seed ^ 0x79a7, x, y);
        if cover[cell] == 0 {
            let width = 3.0 + 8.0 * noise(seed ^ 0x476e, fx * 0.062, fy * 0.062);
            let falloff = (1.0 - (depth - 1.0) / width).max(0.0);
            let habitat = ((input[cell * 2] - 0.61) * 1.32).clamp(0.03, 0.78);
            if scatter < falloff * habitat * (0.18 + 0.76 * patch) {
                cover[cell] = FRINGE_TREES;
            }
        } else if cover[cell] == DENSE_TREES && depth < 3.0 {
            let thinning = (1.0 - depth / 3.0) * (0.12 + 0.3 * patch);
            if scatter < thinning {
                cover[cell] = CLEARING;
            }
        }
    }
}

fn component_root(sets: &mut [(usize, usize)], mut component: usize) -> usize {
    while sets[component].0 != component {
        sets[component].0 = sets[sets[component].0].0;
        component = sets[component].0;
    }
    component
}

/// Flood open ground first, then expand those fronts through the canopy.
/// Where two disconnected fronts meet, clear their short connecting trail.
/// Each tree enters the queue and is cleared at most once.
fn reconnect_ground(width: usize, input: &[f64], cover: &mut [u8], mut queue: Vec<usize>) {
    let unclaimed = usize::MAX;
    let mut owner = vec![unclaimed; cover.len()];
    let mut parent = vec![0; cover.len()];
    let mut sets = Vec::new();
    queue.clear();
    let mut head = 0;
    for start in 0..cover.len() {
        if cover[start] == DENSE_TREES || owner[start] != unclaimed || input[start * 2 + 1] == 0.0 {
            continue;
        }
        let component = sets.len();
        sets.push((component, 1));
        queue.push(start);
        owner[start] = component;
        while head < queue.len() {
            let cell = queue[head];
            head += 1;
            for next in linked_cells(input, cell, width) {
                if cover[next] != DENSE_TREES && owner[next] == unclaimed {
                    owner[next] = component;
                    queue.push(next);
                }
            }
        }
    }

    head = 0;
    while head < queue.len() {
        let cell = queue[head];
        head += 1;
        for next in linked_cells(input, cell, width) {
            if owner[next] == unclaimed {
                owner[next] = owner[cell];
                parent[next] = cell;
                queue.push(next);
            } else if owner[cell] != owner[next] {
                let mut a = component_root(&mut sets, owner[cell]);
                let mut b = component_root(&mut sets, owner[next]);
                if a == b {
                    continue;
                }
                if sets[a].1 < sets[b].1 {
                    std::mem::swap(&mut a, &mut b);
                }
                sets[b].0 = a;
                sets[a].1 += sets[b].1;
                for mut endpoint in [cell, next] {
                    while cover[endpoint] == DENSE_TREES {
                        cover[endpoint] = CLEARING;
                        endpoint = parent[endpoint];
                    }
                }
            }
        }
    }
}

pub struct Woodland {
    world: World,
    schedule: Schedule,
}

impl Default for Woodland {
    fn default() -> Self {
        let mut world = World::new();
        world.init_resource::<Input>();
        world.init_resource::<Cover>();
        let mut schedule = Schedule::default();
        schedule.add_systems(generate);
        Self { world, schedule }
    }
}

impl Woodland {
    pub fn prepare(&mut self, count: usize) -> *mut f64 {
        let mut input = self.world.resource_mut::<Input>();
        input.0.clear();
        input.0.resize(count * 2, 0.0);
        input.0.as_mut_ptr()
    }

    pub fn generate(
        &mut self,
        width: usize,
        height: usize,
        seed: u32,
        scale: f64,
        layout: WoodlandLayout,
    ) -> *const u8 {
        self.world.insert_resource(Settings {
            width,
            height,
            seed,
            scale,
            layout,
        });
        self.schedule.run(&mut self.world);
        self.world.resource::<Cover>().0.as_ptr()
    }
}
