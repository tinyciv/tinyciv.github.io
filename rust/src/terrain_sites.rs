//! Cached terrain placement masks. Settlements keep eight clear tiles between
//! their occupied ground and mountain cells; hills never support placement.
use bevy_ecs::prelude::*;
pub const MOUNTAIN_GAP: i32 = 8;
const RESOURCE_CLEARANCE: u8 = 8;
const RESOURCE_RADIUS: usize = 2;
#[derive(Resource, Default)]
struct Cells(Vec<f64>);
#[derive(Resource, Default)]
struct Mask(Vec<u8>);
#[derive(Resource, Default)]
struct Dimensions { width: usize, height: usize }
fn calculate(size: Res<Dimensions>, cells: Res<Cells>, mut mask: ResMut<Mask>) {
    let w = size.width; let h = size.height; let n = w * h;
    mask.0.clear(); mask.0.resize(n, 0);
    if cells.0.len() < n { return; }
    for cell in 0..n {
        let flags = cells.0[cell] as u32;
        // Bit 1: flat, dry ground. Bit 2: mountain clearance.
        mask.0[cell] = 2 | RESOURCE_CLEARANCE | u8::from(flags & 3 == 0 && flags & 4 == 0);
    }
    for cell in 0..n {
        let flags = cells.0[cell] as u32;
        if flags & 8 != 0 {
            let x = cell % w;
            let y = cell / w;
            // All other tile centers less than three tiles away fit in this square.
            let left = x.saturating_sub(RESOURCE_RADIUS);
            let right = (x + RESOURCE_RADIUS + 1).min(w);
            for row in y.saturating_sub(RESOURCE_RADIUS)..(y + RESOURCE_RADIUS + 1).min(h) {
                for nearby in &mut mask.0[row * w + left..row * w + right] {
                    *nearby &= !RESOURCE_CLEARANCE;
                }
            }
        }
        if flags & 3 != 2 { continue; }
        let x = (cell % w) as i32; let y = (cell / w) as i32;
        for dy in -MOUNTAIN_GAP..=MOUNTAIN_GAP { for dx in -MOUNTAIN_GAP..=MOUNTAIN_GAP {
            let nx = x + dx; let ny = y + dy;
            if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 { continue; }
            // Distance between the closest edges of the two tile squares.
            let ex = (dx.abs() - 1).max(0); let ey = (dy.abs() - 1).max(0);
            if ex * ex + ey * ey < MOUNTAIN_GAP * MOUNTAIN_GAP { mask.0[ny as usize * w + nx as usize] &= !2; }
        }}
    }
    // Initial figures need a flat collar so their upper-body sprites do not
    // overlap a neighboring hill or mountain even when their feet are clear.
    for y in 1..h.saturating_sub(1) { for x in 1..w.saturating_sub(1) {
        let clear = (-1isize..=1).all(|dy| (-1isize..=1).all(|dx|
            mask.0[(y as isize + dy) as usize * w + (x as isize + dx) as usize] & 1 != 0));
        if clear { mask.0[y * w + x] |= 4; }
    }}
}
pub struct TerrainSites { world: World, schedule: Schedule }
impl Default for TerrainSites {
    fn default() -> Self {
        let mut world = World::new(); world.init_resource::<Cells>(); world.init_resource::<Mask>(); world.init_resource::<Dimensions>();
        let mut schedule = Schedule::default(); schedule.add_systems(calculate); Self { world, schedule }
    }
}
impl TerrainSites {
    pub fn prepare(&mut self, count: usize) -> *mut f64 {
        let mut cells = self.world.resource_mut::<Cells>(); cells.0.clear(); cells.0.resize(count, 0.0); cells.0.as_mut_ptr()
    }
    pub fn calculate(&mut self, width: usize, height: usize) -> *const u8 {
        self.world.insert_resource(Dimensions { width, height }); self.schedule.run(&mut self.world); self.world.resource::<Mask>().0.as_ptr()
    }

    /// The local grid contains vacant building sites (1) and the planned town
    /// streets (2). Keep a completed library beside a street with a clear door.
    pub fn opening_library(&self, span: i32, origin: i32) -> i32 {
        let cells = &self.world.resource::<Cells>().0;
        let cell = |x, y| {
            if x >= 0 && y >= 0 && x < span && y < span {
                cells.get((y * span + x) as usize).copied().unwrap_or_default() as u8
            } else {
                0
            }
        };
        let mut best = (-1, i32::MAX);
        for dy in -5_i32..=5 {
            for dx in -5_i32..=5 {
                let distance_squared = dx * dx + dy * dy;
                if !(9..=25).contains(&distance_squared) { continue; }
                let x = origin + dx;
                let y = origin + dy;
                if !(0..2).all(|row| (0..2).all(|column| cell(x + column, y + row) == 1)) {
                    continue;
                }
                let street_access = (0..2).any(|offset| {
                    [cell(x - 1, y + offset), cell(x + 2, y + offset),
                        cell(x + offset, y - 1), cell(x + offset, y + 2)].contains(&2)
                });
                let score = (distance_squared - 16).abs();
                if street_access && score < best.1 {
                    best = (y * span + x, score);
                }
            }
        }
        best.0
    }
}
