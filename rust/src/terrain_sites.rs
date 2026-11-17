//! Cached terrain placement masks. Settlements keep eight clear tiles between
//! their occupied ground and mountain cells; hills never support placement.
use bevy_ecs::prelude::*;
pub const MOUNTAIN_GAP: i32 = 8;
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
        mask.0[cell] = 2 | u8::from(flags & 3 == 0 && flags & 4 == 0);
    }
    for cell in 0..n {
        if cells.0[cell] as u32 & 3 != 2 { continue; }
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
}
