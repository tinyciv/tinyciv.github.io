//! Bounded transient shell landings. Renderer age/frame choice stays on the
//! host; event identity, retention and expiry belong to this game's ECS.
use bevy_ecs::prelude::*;
use std::collections::VecDeque;
use super::SimClock;

pub const LIFETIME: f64 = 0.9;
const MAX_EFFECTS: usize = 256;

#[derive(Component, Clone, Copy)]
struct ShellImpact { id: u64, x: f64, y: f64, time: f64, render_depth: f64 }
#[derive(Resource)]
pub struct ShellImpacts {
    ordered: VecDeque<Entity>, next_id: u64, revision: u64, published: u64,
    observed_time: f64, output: Vec<f64>,
}
impl Default for ShellImpacts {
    fn default() -> Self { Self { ordered: VecDeque::new(), next_id: 1, revision: 1,
        published: 0, observed_time: 0.0, output: vec![0.0, 0.0] } }
}

/// Nothing is scanned until the oldest event actually expires. A clock rewind
/// drops runtime presentation hints instead of retaining future events.
pub fn expire(world: &mut World) {
    let now = world.resource::<SimClock>().time;
    world.resource_scope(|world, mut effects: Mut<ShellImpacts>| {
        if now < effects.observed_time {
            while let Some(entity) = effects.ordered.pop_front() { world.despawn(entity); effects.revision += 1; }
        }
        effects.observed_time = now;
        while let Some(entity) = effects.ordered.front().copied() {
            if now < world.get::<ShellImpact>(entity).unwrap().time + LIFETIME { break; }
            effects.ordered.pop_front(); world.despawn(entity); effects.revision += 1;
        }
    });
}

/// `at_target` distinguishes arrival at the canonical endpoint from a mountain
/// collision. Only a target building uses its front edge for render ordering.
pub fn record(world: &mut World, x: f64, y: f64, at_target: bool, building: bool, target_y: f64, height: f64) -> bool {
    let time = world.resource::<SimClock>().time;
    if !x.is_finite() || !y.is_finite() || !time.is_finite() { return false; }
    expire(world);
    let render_depth = if at_target && building && target_y.is_finite() && height.is_finite() && height > 0.0 {
        target_y + height + 0.001
    } else { y };
    world.resource_scope(|world, mut effects: Mut<ShellImpacts>| {
        if effects.ordered.len() == MAX_EFFECTS {
            let entity = effects.ordered.pop_front().unwrap(); world.despawn(entity);
        }
        let id = effects.next_id; effects.next_id += 1;
        effects.ordered.push_back(world.spawn(ShellImpact { id, x, y, time, render_depth }).id());
        effects.revision += 1;
    });
    true
}

/// Revisioned read-only mirror: [revision,count,(id,x,y,time,renderDepth)*].
/// This runtime queue is deliberately absent from native save sections.
pub fn view(world: &mut World) -> *const f64 {
    world.resource_scope(|world, mut effects: Mut<ShellImpacts>| {
        if effects.published != effects.revision {
            let mut output = std::mem::take(&mut effects.output);
            output.clear(); output.extend_from_slice(&[effects.revision as f64, effects.ordered.len() as f64]);
            for entity in &effects.ordered {
                let row = world.get::<ShellImpact>(*entity).unwrap();
                output.extend_from_slice(&[row.id as f64, row.x, row.y, row.time, row.render_depth]);
            }
            effects.output = output; effects.published = effects.revision;
        }
        effects.output.as_ptr()
    })
}
