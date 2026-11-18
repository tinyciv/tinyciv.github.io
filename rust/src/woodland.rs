//! One-shot forest cover within the world's regional habitat field.
use crate::relief::{hash, noise};
use bevy_ecs::prelude::*;

#[derive(Resource, Default)]
struct Input(Vec<f64>);
#[derive(Resource, Default)]
struct Cover(Vec<u8>);
#[derive(Resource, Default)]
struct Settings {
    width: usize,
    height: usize,
    seed: u32,
    patch_scale: f64,
}

fn generate(settings: Res<Settings>, input: Res<Input>, mut cover: ResMut<Cover>) {
    let (width, height, seed) = (settings.width, settings.height, settings.seed);
    let count = width * height;
    let trees = &mut cover.0;
    trees.clear();
    trees.resize(count, 0);
    if input.0.len() != count * 2 {
        return;
    }

    // One field value is shared by nearby trees. A minor per-cell term keeps
    // the edges ragged, while the field's low areas form connected gaps.
    let spacing = 4.2 * settings.patch_scale;
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
        patch_scale: f64,
    ) -> *const u8 {
        self.world.insert_resource(Settings {
            width,
            height,
            seed,
            patch_scale,
        });
        self.schedule.run(&mut self.world);
        self.world.resource::<Cover>().0.as_ptr()
    }
}
