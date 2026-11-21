//! Shared, immutable terrain ray field. Mountain silhouettes stop sight.
//! Individual rock formations shorten sight and stop projectiles.
use bevy_ecs::prelude::*;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

const MOUNTAIN: u8 = 1;
const ROCK: u8 = 3;
const ROCK_SIGHT_PENALTY: f64 = 0.5;

#[derive(Default)]
pub struct MountainGrid {
    width: usize,
    height: usize,
    obstructions: Vec<u8>,
    /// Hill-only groups of at least 20 edge-connected cells adjoining mountains.
    foothills: Vec<u8>,
    prefix: Vec<u32>,
}

#[derive(Resource, Clone, Default)]
pub struct MountainTerrain(pub Arc<MountainGrid>);

impl MountainGrid {
    fn new(width: usize, height: usize, input: &[f64]) -> Self {
        // Transport encoding: flat 0, mountain 1, hill 2, solid rock 3.
        let kinds: Vec<u8> = input.iter().take(width * height).map(|v| *v as u8).collect();
        let obstructions: Vec<u8> = kinds.iter().map(|&kind| if matches!(kind, MOUNTAIN | ROCK) { kind } else { 0 }).collect();
        let mut foothills = vec![0; kinds.len()];
        let mut seen = vec![false; kinds.len()];
        let mut group = Vec::new();
        // Build eligibility once per terrain commit, never during horizon rays.
        for start in 0..kinds.len() {
            if kinds[start] != 2 || seen[start] { continue; }
            group.clear(); group.push(start); seen[start] = true;
            let mut head = 0;
            let mut mountain = false;
            while head < group.len() {
                let cell = group[head]; head += 1;
                let (x, y) = (cell % width, cell / width);
                let mut visit = |next: usize| {
                    if matches!(kinds[next], MOUNTAIN | ROCK) { mountain = true; }
                    if kinds[next] == 2 && !seen[next] { seen[next] = true; group.push(next); }
                };
                if x > 0 { visit(cell - 1); }
                if x + 1 < width { visit(cell + 1); }
                if y > 0 { visit(cell - width); }
                if y + 1 < height { visit(cell + width); }
            }
            if mountain && group.len() >= crate::relief::MIN_HILL_CELLS {
                for &cell in &group { foothills[cell] = 1; }
            }
        }
        let stride = width + 1;
        let mut prefix = vec![0; stride * (height + 1)];
        for y in 0..height {
            let mut row = 0;
            for x in 0..width {
                row += u32::from(obstructions[y * width + x] != 0);
                prefix[(y + 1) * stride + x + 1] = prefix[y * stride + x + 1] + row;
            }
        }
        Self { width, height, obstructions, foothills, prefix }
    }

    fn obstruction(&self, x: i32, y: i32) -> u8 {
        if x < 0 || y < 0 || x as usize >= self.width || y as usize >= self.height { return 0; }
        self.obstructions[y as usize * self.width + x as usize]
    }

    fn contains_obstructions(&self, left: i32, top: i32, right: i32, bottom: i32) -> bool {
        if self.width == 0 || self.height == 0 { return false; }
        let x0 = left.clamp(0, self.width as i32) as usize;
        let y0 = top.clamp(0, self.height as i32) as usize;
        let x1 = right.saturating_add(1).clamp(0, self.width as i32) as usize;
        let y1 = bottom.saturating_add(1).clamp(0, self.height as i32) as usize;
        if x0 >= x1 || y0 >= y1 { return false; }
        let stride = self.width + 1;
        self.prefix[y1 * stride + x1] + self.prefix[y0 * stride + x0]
            > self.prefix[y0 * stride + x1] + self.prefix[y1 * stride + x0]
    }

    pub fn nearby(&self, x: f64, y: f64, radius: f64) -> bool {
        self.contains_obstructions((x - radius).floor() as i32, (y - radius).floor() as i32,
            (x + radius).floor() as i32, (y + radius).floor() as i32)
    }

    /// Entry parameter of the first obstacle on the segment, including both
    /// cells touched at a diagonal corner. A visible target exempts only its
    /// own mountain tile, never a mountain before it or beside that corner.
    pub fn first_blocked(&self, sx: f64, sy: f64, tx: f64, ty: f64, visible_target: bool) -> Option<f64> {
        self.trace(sx, sy, tx, ty, visible_target).err()
    }

    /// Extra distance consumed by solid rock along a sight ray.
    pub fn sight_penalty(&self, sx: f64, sy: f64, tx: f64, ty: f64) -> f64 {
        self.trace(sx, sy, tx, ty, true).unwrap_or(f64::INFINITY)
    }

    fn trace(&self, sx: f64, sy: f64, tx: f64, ty: f64, sight: bool) -> Result<f64, f64> {
        // An unattached field preserves standalone projectile-engine usage.
        if self.width == 0 || self.height == 0 { return Ok(0.0); }
        if ![sx, sy, tx, ty].iter().all(|v| v.is_finite()) { return Err(0.0); }
        let (mut x, mut y) = (sx.floor() as i32, sy.floor() as i32);
        let (end_x, end_y) = (tx.floor() as i32, ty.floor() as i32);
        if x < 0 || y < 0 || x as usize >= self.width || y as usize >= self.height
            || end_x < 0 || end_y < 0 || end_x as usize >= self.width || end_y as usize >= self.height {
            return Err(0.0);
        }
        let (dx, dy) = (tx - sx, ty - sy);
        let vertical_edge = dx == 0.0 && sx.fract() == 0.0;
        let horizontal_edge = dy == 0.0 && sy.fract() == 0.0;
        // Include every cell touched by either endpoint, as well as rays
        // lying along a grid line. The same segment must obstruct in either
        // direction, including one starting exactly on a mountain corner.
        if !self.contains_obstructions(x.min(end_x) - i32::from(sx.min(tx).fract() == 0.0),
            y.min(end_y) - i32::from(sy.min(ty).fract() == 0.0),
            x.max(end_x), y.max(end_y)) { return Ok(0.0); }
        let solid = |x, y| match self.obstruction(x, y) {
            MOUNTAIN => !(sight && x == end_x && y == end_y),
            ROCK => !sight,
            _ => false,
        };
        let endpoint_blocked = |px: f64, py: f64| {
            let (x, y) = (px.floor() as i32, py.floor() as i32);
            solid(x, y) || px.fract() == 0.0 && solid(x - 1, y)
                || py.fract() == 0.0 && solid(x, y - 1)
                || px.fract() == 0.0 && py.fract() == 0.0 && solid(x - 1, y - 1)
        };
        if endpoint_blocked(sx, sy) { return Err(0.0); }
        // A ray exactly along a tile edge touches both sides. In particular,
        // integer-centered towers cannot shoot along a mountain's boundary.
        let blocked = |x, y| solid(x, y)
            || vertical_edge && solid(x - 1, y)
            || horizontal_edge && solid(x, y - 1)
            || vertical_edge && horizontal_edge && solid(x - 1, y - 1);
        let step_x = if dx > 0.0 { 1 } else if dx < 0.0 { -1 } else { 0 };
        let step_y = if dy > 0.0 { 1 } else if dy < 0.0 { -1 } else { 0 };
        let delta_x = if step_x != 0 { 1.0 / dx.abs() } else { f64::INFINITY };
        let delta_y = if step_y != 0 { 1.0 / dy.abs() } else { f64::INFINITY };
        let mut cross_x = if step_x != 0 { ((if step_x > 0 { x + 1 } else { x }) as f64 - sx) / dx } else { f64::INFINITY };
        let mut cross_y = if step_y != 0 { ((if step_y > 0 { y + 1 } else { y }) as f64 - sy) / dy } else { f64::INFINITY };
        let mut entry = 0.0;
        let mut rock_fraction = 0.0;
        loop {
            if blocked(x, y) { return Err(entry); }
            let in_rock = sight && self.obstruction(x, y) == ROCK;
            if x == end_x && y == end_y {
                if endpoint_blocked(tx, ty) { return Err(1.0); }
                if in_rock { rock_fraction += 1.0 - entry; }
                return Ok(if rock_fraction > 0.0 { dx.hypot(dy) * rock_fraction * ROCK_SIGHT_PENALTY } else { 0.0 });
            }
            // Rounding at t=1 can otherwise cross past an already reached
            // endpoint axis, especially when traveling toward an integer
            // boundary in the negative direction. Every step must approach
            // the endpoint, so traversal is bounded by Manhattan tile span.
            if x == end_x { cross_x = f64::INFINITY; }
            if y == end_y { cross_y = f64::INFINITY; }
            let exit = cross_x.min(cross_y).clamp(0.0, 1.0);
            if in_rock { rock_fraction += exit - entry; }
            entry = exit;
            if (cross_x - cross_y).abs() < 1e-10 {
                if blocked(x + step_x, y) || blocked(x, y + step_y) { return Err(entry); }
            }
            if cross_x == cross_y {
                x += step_x; y += step_y; cross_x += delta_x; cross_y += delta_y;
            } else if cross_x < cross_y { x += step_x; cross_x += delta_x; }
            else { y += step_y; cross_y += delta_y; }
        }
    }
}

const LANDMARK_BUCKET: f64 = 16.0;
#[derive(Resource, Default)]
struct LandmarkSight {
    observers: BTreeMap<(i32, i32), Vec<(f64, f64)>>,
    visible: BTreeMap<(usize, u32), bool>,
}

pub struct TerrainRays { world: World, input: Vec<f64>, observers: Vec<f64> }
impl Default for TerrainRays {
    fn default() -> Self {
        let mut world = World::new(); world.init_resource::<MountainTerrain>(); world.init_resource::<LandmarkSight>();
        Self { world, input: Vec::new(), observers: Vec::new() }
    }
}
impl TerrainRays {
    pub fn prepare(&mut self, count: usize) -> *mut f64 {
        self.input.resize(count, 0.0); self.input.as_mut_ptr()
    }
    pub fn commit(&mut self, width: usize, height: usize) {
        assert_eq!(width * height, self.input.len(), "mountain field dimensions");
        self.world.insert_resource(MountainTerrain(Arc::new(MountainGrid::new(width, height, &self.input))));
        self.world.resource_mut::<LandmarkSight>().visible.clear();
    }
    pub fn terrain(&self) -> &MountainTerrain { self.world.resource::<MountainTerrain>() }
    pub fn prepare_observers(&mut self, count: usize) -> *mut f64 {
        self.observers.resize(count * 2, 0.0); self.observers.as_mut_ptr()
    }
    /// Distant terrain never grants ground sight. Retain a spatial observer
    /// index and memoize only requested landmark cells between sight samples.
    pub fn observe(&mut self) {
        let mut sight = self.world.resource_mut::<LandmarkSight>();
        sight.observers.clear(); sight.visible.clear();
        let mut unique = BTreeSet::new();
        for row in self.observers.chunks_exact(2) {
            let (x, y) = (row[0], row[1]);
            if !x.is_finite() || !y.is_finite() || !unique.insert((x.to_bits(), y.to_bits())) { continue; }
            sight.observers.entry(((x / LANDMARK_BUCKET).floor() as i32, (y / LANDMARK_BUCKET).floor() as i32)).or_default().push((x, y));
        }
    }
    pub fn landmark_visible(&mut self, cell: usize, kind: u32) -> bool {
        self.world.resource_scope(|world, mut sight: Mut<LandmarkSight>| {
            let terrain = &world.resource::<MountainTerrain>().0;
            if terrain.width == 0 || cell >= terrain.width * terrain.height || !(1..=2).contains(&kind) { return false; }
            if kind == 1 && terrain.foothills[cell] == 0 { return false; }
            if let Some(&visible) = sight.visible.get(&(cell, kind)) { return visible; }
            // Elevated silhouettes can be recognized beyond ordinary ground
            // sight and woodland. Apply the same mountain and rock geometry.
            let radius = if kind == 2 { 36.0 } else { 12.0 };
            let (x, y) = ((cell % terrain.width) as f64 + 0.5, (cell / terrain.width) as f64 + 0.5);
            let mut visible = false;
            'buckets: for by in ((y - radius) / LANDMARK_BUCKET).floor() as i32..=((y + radius) / LANDMARK_BUCKET).floor() as i32 {
                for bx in ((x - radius) / LANDMARK_BUCKET).floor() as i32..=((x + radius) / LANDMARK_BUCKET).floor() as i32 {
                    for &(sx, sy) in sight.observers.get(&(bx, by)).into_iter().flatten() {
                        let distance_squared = (sx - x).powi(2) + (sy - y).powi(2);
                        if distance_squared <= radius * radius
                            && terrain.sight_penalty(sx, sy, x, y) <= radius - distance_squared.sqrt() {
                            visible = true; break 'buckets;
                        }
                    }
                }
            }
            sight.visible.insert((cell, kind), visible); visible
        })
    }
}

#[derive(Default)]
pub struct Terrains { next: u32, values: BTreeMap<u32, TerrainRays> }
impl Terrains {
    pub fn create(&mut self) -> u32 {
        self.next = self.next.checked_add(1).expect("mountain field handle overflow");
        self.values.insert(self.next, TerrainRays::default()); self.next
    }
    pub fn drop_field(&mut self, handle: u32) { self.values.remove(&handle); }
    pub fn get(&self, handle: u32) -> &TerrainRays { self.values.get(&handle).expect("unknown mountain field") }
    pub fn get_mut(&mut self, handle: u32) -> &mut TerrainRays { self.values.get_mut(&handle).expect("unknown mountain field") }
}
