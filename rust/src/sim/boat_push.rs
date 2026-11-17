//! Bounded local hull separation. The host supplies indexed nearby vessels and
//! a revision-cached water patch; all push decisions and swept hull checks run here.
use bevy_ecs::prelude::*;

pub const STRIDE: usize = 7;
const EPS: f64 = 1e-8;
const MAX_ATTEMPTS: usize = 64;
type Point = (f64, f64);
#[derive(Clone, Copy)]
struct Hull { x: f64, y: f64, facing: f64, spine: f64, radius: f64, pushable: bool }
impl Hull {
    fn ends(self) -> (Point, Point) {
        let (dx, dy) = (self.facing.cos() * self.spine, self.facing.sin() * self.spine);
        ((self.x - dx, self.y - dy), (self.x + dx, self.y + dy))
    }
    fn translated(self, dx: f64, dy: f64) -> Self { Self { x: self.x + dx, y: self.y + dy, ..self } }
}
fn closest(a: Point, b: Point, p: Point) -> Point {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let length = dx * dx + dy * dy;
    let t = if length < EPS { 0.0 } else { (((p.0 - a.0) * dx + (p.1 - a.1) * dy) / length).clamp(0.0, 1.0) };
    (a.0 + t * dx, a.1 + t * dy)
}
fn distance(a: Point, b: Point) -> f64 { (a.0 - b.0).hypot(a.1 - b.1) }
fn segment_distance(a: Point, b: Point, c: Point, d: Point) -> f64 {
    let cross = (b.0 - a.0) * (d.1 - c.1) - (b.1 - a.1) * (d.0 - c.0);
    if cross.abs() > EPS {
        let t = ((c.0 - a.0) * (d.1 - c.1) - (c.1 - a.1) * (d.0 - c.0)) / cross;
        let u = ((c.0 - a.0) * (b.1 - a.1) - (c.1 - a.1) * (b.0 - a.0)) / cross;
        if (0.0..=1.0).contains(&t) && (0.0..=1.0).contains(&u) { return 0.0; }
    }
    distance(a, closest(c, d, a)).min(distance(b, closest(c, d, b)))
        .min(distance(c, closest(a, b, c))).min(distance(d, closest(a, b, d)))
}
fn overlap(a: Hull, b: Hull) -> bool {
    let (a0, a1) = a.ends(); let (b0, b1) = b.ends();
    segment_distance(a0, a1, b0, b1) < a.radius + b.radius - EPS
}
fn overlaps_cell(hull: Hull, x: i32, y: i32) -> bool {
    let (a, b) = hull.ends(); let (x, y) = (x as f64, y as f64);
    let inside = |p: Point| p.0 >= x && p.0 <= x + 1.0 && p.1 >= y && p.1 <= y + 1.0;
    if inside(a) || inside(b) { return true; }
    let corners = [(x, y), (x + 1.0, y), (x + 1.0, y + 1.0), (x, y + 1.0)];
    (0..4).any(|i| segment_distance(a, b, corners[i], corners[(i + 1) % 4]) < hull.radius - EPS)
}

#[derive(Resource, Default)]
pub struct BoatPush {
    pub input: Vec<f64>, pub geometry: Vec<f64>, output: Vec<f64>,
    origin_x: i32, origin_y: i32, width: usize,
}
impl BoatPush {
    pub fn prepare(&mut self, count: usize) -> *mut f64 {
        self.input.resize(count * STRIDE, 0.0); self.input.as_mut_ptr()
    }
    pub fn prepare_geometry(&mut self, x: i32, y: i32, width: usize) -> *mut f64 {
        self.origin_x = x; self.origin_y = y; self.width = width;
        self.geometry.resize(width * width, 0.0); self.geometry.as_mut_ptr()
    }
    fn level(&self, x: i32, y: i32) -> f64 {
        let (x, y) = (x - self.origin_x, y - self.origin_y);
        if x < 0 || y < 0 || x as usize >= self.width || y as usize >= self.width { return 0.0; }
        self.geometry[y as usize * self.width + x as usize]
    }
    fn clear(&self, hull: Hull, level: f64) -> bool {
        let (a, b) = hull.ends();
        for y in ((a.1.min(b.1) - hull.radius + EPS).floor() as i32)..((a.1.max(b.1) + hull.radius - EPS).ceil() as i32) {
            for x in ((a.0.min(b.0) - hull.radius + EPS).floor() as i32)..((a.0.max(b.0) + hull.radius - EPS).ceil() as i32) {
                if self.level(x, y) != level && overlaps_cell(hull, x, y) { return false; }
            }
        }
        level > 0.0
    }
    fn sweep(&self, from: Hull, to: Hull) -> bool {
        let level = self.level(from.x.floor() as i32, from.y.floor() as i32);
        let steps = (distance((from.x, from.y), (to.x, to.y)) / 0.1).ceil().max(1.0) as usize;
        (0..=steps).all(|i| self.clear(from.translated((to.x - from.x) * i as f64 / steps as f64,
            (to.y - from.y) * i as f64 / steps as f64), level))
    }
    /// Resolve a contact, including a short chain of friendly vessels. Every
    /// alternative is atomic; a failed push leaves the entire fleet in place.
    fn displace(&self, index: usize, obstacle: Hull, leader: Hull, vessels: &mut [Hull],
        locked: &mut [bool], attempts: &mut usize, depth: usize) -> bool {
        if !overlap(obstacle, vessels[index]) { return true; }
        if !vessels[index].pushable || locked[index] || depth > 6 { return false; }
        let original = vessels.to_vec();
        let hull = vessels[index];
        let (a, b) = obstacle.ends(); let near = closest(a, b, (hull.x, hull.y));
        let (dx, dy) = (hull.x - near.0, hull.y - near.1);
        let angle = if dx.hypot(dy) < EPS { obstacle.facing + std::f64::consts::FRAC_PI_2 } else { dy.atan2(dx) };
        locked[index] = true;
        for turn in [0.0, 1.0, -1.0, 2.0, -2.0, 3.0, -3.0, 4.0] {
            if *attempts >= MAX_ATTEMPTS { break; }
            *attempts += 1;
            vessels.copy_from_slice(&original);
            let heading = angle + turn * std::f64::consts::FRAC_PI_4;
            let (dx, dy) = (heading.cos(), heading.sin());
            let mut offset = 0.025;
            while offset <= 0.665 && overlap(obstacle, hull.translated(dx * offset, dy * offset)) { offset += 0.04; }
            if offset > 0.665 { continue; }
            let next = hull.translated(dx * offset, dy * offset);
            if overlap(leader, next) || !self.sweep(hull, next) { continue; }
            vessels[index] = next;
            let mut clear = true;
            for other in 0..vessels.len() {
                if other != index && overlap(next, vessels[other])
                    && !self.displace(other, next, leader, vessels, locked, attempts, depth + 1) { clear = false; break; }
            }
            if clear { locked[index] = false; return true; }
        }
        vessels.copy_from_slice(&original); locked[index] = false; false
    }
    /// Mode 0 detects contacts without requesting terrain. Mode 1 resolves them
    /// against the cached patch. Output [status,count,(input-row,x,y)*].
    pub fn run(&mut self, count: usize, mode: u32, x: f64, y: f64, facing: f64) -> *const f64 {
        self.output.clear(); self.output.extend_from_slice(&[1.0, 0.0]);
        if count > 128 { self.output[0] = 0.0; return self.output.as_ptr(); }
        let half = 0.5 * super::galleys::LEADER_SCALE;
        let leader = Hull { x, y, facing, spine: half, radius: half, pushable: false };
        let original: Vec<Hull> = self.input[..count * STRIDE].chunks_exact(STRIDE).map(|v|
            Hull { x: v[1], y: v[2], facing: v[3], spine: v[4], radius: v[5], pushable: v[6] != 0.0 }).collect();
        if !original.iter().any(|hull| overlap(leader, *hull)) { return self.output.as_ptr(); }
        if mode == 0 { self.output[0] = 2.0; return self.output.as_ptr(); }
        let mut vessels = original.clone(); let mut locked = vec![false; count]; let mut attempts = 0;
        for index in 0..count {
            if !self.displace(index, leader, leader, &mut vessels, &mut locked, &mut attempts, 0) {
                self.output[0] = 0.0; return self.output.as_ptr();
            }
        }
        for (index, hull) in vessels.iter().enumerate() {
            if hull.x != original[index].x || hull.y != original[index].y {
                self.output.extend_from_slice(&[self.input[index * STRIDE], hull.x, hull.y]);
            }
        }
        self.output[1] = ((self.output.len() - 2) / 3) as f64;
        self.output.as_ptr()
    }
}
