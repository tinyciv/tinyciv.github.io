//! Landscape construction sites. Geometry is indexed once; presentation samples
//! and authoritative commands share the same footprint and approach policy.
use bevy_ecs::prelude::*;
use std::collections::BTreeMap;
use super::structures::StructureIndex;
use super::kinds::building::THERMAL_BATH;

const APPROACH: f64 = 3.0;
const SAMPLE_INTERVAL: f64 = 1.0 / 3.0;

#[derive(Component, Clone, Copy)]
struct Site { id: usize, x: f64, y: f64, kind: u32 }
impl Site {
    fn distance(self, x: f64, y: f64) -> f64 {
        (self.x - x).max(0.0).max(x - self.x - 2.0).hypot((self.y - y).max(0.0).max(y - self.y - 2.0))
    }
    fn occupied(self, index: &StructureIndex) -> bool {
        (0..4).any(|i| index.solid_at(self.x + (i % 2) as f64, self.y + (i / 2) as f64))
    }
}

#[derive(Resource, Default)]
pub struct Sites {
    input: Vec<f64>, output: Vec<f64>,
    rows: BTreeMap<usize, (Entity, Site)>,
    next_sample: BTreeMap<i32, f64>,
}
impl Sites {
    pub fn input(&mut self, count: usize) -> *mut f64 { self.input.resize(count * 2, 0.0); self.input.as_mut_ptr() }
    pub fn due(&mut self, actor: i32, now: f64) -> bool {
        let next = self.next_sample.entry(actor).or_insert(f64::NEG_INFINITY);
        if now < *next { return false; }
        *next = now + SAMPLE_INTERVAL; true
    }
    pub fn target(&self, index: &StructureIndex, id: usize, x: f64, y: f64, flags: u32) -> i32 {
        let Some((_, site)) = self.rows.get(&id) else { return -1; };
        if flags & 31 != 3 || !x.is_finite() || !y.is_finite() || site.distance(x, y) > APPROACH || site.occupied(index) { return -1; }
        match site.kind { 1 => THERMAL_BATH as i32, _ => -1 }
    }
    /// Count followed by [id, kind, x, y, width, height, approach flags]. Flags:
    /// 1 Leader within interaction range; 2 no building occupies this site.
    pub fn sample(&mut self, index: &StructureIndex, x: f64, y: f64, leader_flags: u32) -> *const f64 {
        self.output.clear(); self.output.push(0.0);
        for (_, site) in self.rows.values() {
            let distance = if leader_flags & 31 == 3 && x.is_finite() && y.is_finite() { site.distance(x,y) } else { f64::INFINITY };
            let flags = u32::from(distance <= APPROACH) | u32::from(!site.occupied(index)) << 1;
            self.output.extend_from_slice(&[site.id as f64, site.kind as f64, site.x, site.y, 2.0, 2.0, flags as f64]);
        }
        self.output[0] = ((self.output.len() - 1) / 7) as f64;
        self.output.as_ptr()
    }
}

pub fn geometry(world: &mut World, width: usize, height: usize, count: usize) {
    world.resource_scope(|world, mut sites: Mut<Sites>| {
        for (entity, _) in sites.rows.values() { let _ = world.despawn(*entity); }
        sites.rows.clear(); sites.next_sample.clear();
        if width == 0 || height == 0 || sites.input.len() < count * 2 { return; }
        for i in 0..count {
            let id = sites.input[i * 2] as usize;
            let feature = sites.input[i * 2 + 1] as u32;
            // Thermal bath is the first Site kind. Volcanoes are not sites.
            if !(4..=6).contains(&feature) || id >= width * height || id % width + 2 > width || id / width + 2 > height { continue; }
            let site = Site { id, x: (id % width) as f64, y: (id / width) as f64, kind: 1 };
            let entity = world.spawn(site).id(); sites.rows.insert(id, (entity, site));
        }
    });
}
