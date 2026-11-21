//! Deterministic fertility patches authored once from the completed terrain.
use crate::relief::noise;
use bevy_ecs::prelude::*;

const ELIGIBLE: u8 = 1;
const FRESHWATER: u8 = 2;
const FRESHWATER_REACH: u8 = 7;
const SCORE_BUCKETS: usize = 4096;
const MAX_DENSITY: u8 = 3;

#[derive(Resource, Default)]
struct TerrainFlags(Vec<u8>);

#[derive(Resource, Default)]
struct Density(Vec<u8>);

#[derive(Resource, Default)]
struct Settings {
    width: usize,
    height: usize,
    seed: u32,
    mirror: bool,
}

/// Two sweeps give the closest Manhattan distance without a queue or a search
/// per eligible cell. Distances outside the useful range saturate.
fn freshwater_distances(flags: &[u8], width: usize, height: usize) -> Vec<u8> {
    let mut distance: Vec<_> = flags
        .iter()
        .map(|flags| if flags & FRESHWATER != 0 { 0 } else { FRESHWATER_REACH })
        .collect();
    for y in 0..height {
        for x in 0..width {
            let cell = y * width + x;
            if x > 0 {
                distance[cell] = distance[cell].min(distance[cell - 1] + 1);
            }
            if y > 0 {
                distance[cell] = distance[cell].min(distance[cell - width] + 1);
            }
        }
    }
    for y in (0..height).rev() {
        for x in (0..width).rev() {
            let cell = y * width + x;
            if x + 1 < width {
                distance[cell] = distance[cell].min(distance[cell + 1] + 1);
            }
            if y + 1 < height {
                distance[cell] = distance[cell].min(distance[cell + width] + 1);
            }
        }
    }
    distance
}

fn generate(settings: Res<Settings>, terrain: Res<TerrainFlags>, mut density: ResMut<Density>) {
    let Settings { width, height, seed, mirror } = *settings;
    let count = width * height;
    let patches = &mut density.0;
    patches.clear();
    patches.resize(count, 0);
    let flags = &terrain.0;
    if count == 0 || count != flags.len() {
        return;
    }

    // Mirrored maps select paired cells as one candidate, so both sides get
    // the same density and coverage rounds to the nearest available pair.
    let mirrored = mirror && width % 2 == 0 && flags.chunks_exact(width).all(|row| {
        (0..width / 2).all(|x| (row[x] ^ row[width - 1 - x]) & ELIGIBLE == 0)
    });
    let columns = if mirrored { width / 2 } else { width };
    let distance = freshwater_distances(flags, width, height);
    let mut scores = vec![0_u16; columns * height];
    let mut ranks = vec![0_usize; SCORE_BUCKETS];
    let mut eligible = 0;
    for (candidate, score) in scores.iter_mut().enumerate() {
        let (x, y) = (candidate % columns, candidate / columns);
        let cell = y * width + x;
        if flags[cell] & ELIGIBLE == 0 {
            continue;
        }
        let other = if mirrored { y * width + width - 1 - x } else { cell };
        let freshwater = 1.0 - f64::from(distance[cell] + distance[other]) / f64::from(2 * FRESHWATER_REACH);
        let (x, y) = (x as f64, y as f64);
        // Broad pockets define the main shape and a smaller field gives the
        // margins some variation. Freshwater favors nearby soil.
        let strength = 0.55 * noise(seed, x / 12.0, y / 12.0)
            + 0.23 * noise(seed ^ 0x84ac_5103, x / 4.5, y / 4.5)
            + 0.14 * freshwater;
        let bucket = 1 + (strength * (SCORE_BUCKETS - 2) as f64) as u16;
        *score = bucket;
        ranks[bucket as usize] += 1;
        eligible += 1;
    }

    let selected = (eligible * 15 + 50) / 100;
    if selected == 0 {
        return;
    }
    let dense = ((selected + 2) / 5).max(1);
    let medium_or_dense = ((selected * 55 + 50) / 100).max(dense);
    // Convert counts to rank offsets in linear time. Row order breaks ties
    // inside a narrow score bucket, including at a density boundary.
    let mut offset = 0;
    for rank in ranks.iter_mut().rev() {
        let count = *rank;
        *rank = offset;
        offset += count;
    }
    for (candidate, score) in scores.into_iter().enumerate() {
        if score == 0 {
            continue;
        }
        let rank = &mut ranks[score as usize];
        if *rank < selected {
            let level = if *rank < dense { MAX_DENSITY } else if *rank < medium_or_dense { 2 } else { 1 };
            let (x, y) = (candidate % columns, candidate / columns);
            patches[y * width + x] = level;
            if mirrored {
                patches[y * width + width - 1 - x] = level;
            }
        }
        *rank += 1;
    }
}

pub fn soil_with_grass(base: f64, density: u8) -> f64 {
    base * (1.0 + f64::from(density.min(MAX_DENSITY)))
}

pub struct FertilityGrass {
    world: World,
    schedule: Schedule,
}

impl Default for FertilityGrass {
    fn default() -> Self {
        let mut world = World::new();
        world.init_resource::<TerrainFlags>();
        world.init_resource::<Density>();
        world.init_resource::<Settings>();
        let mut schedule = Schedule::default();
        schedule.add_systems(generate);
        Self { world, schedule }
    }
}

impl FertilityGrass {
    pub fn prepare(&mut self, count: usize) -> *mut u8 {
        let mut input = self.world.resource_mut::<TerrainFlags>();
        input.0.clear();
        input.0.resize(count, 0);
        input.0.as_mut_ptr()
    }

    pub fn generate(&mut self, width: usize, height: usize, seed: u32, mirror: bool) -> *const u8 {
        self.world.insert_resource(Settings { width, height, seed, mirror });
        self.schedule.run(&mut self.world);
        self.world.resource::<Density>().0.as_ptr()
    }
}
