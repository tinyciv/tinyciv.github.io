//! Place low ledge shelves with one traversable stair and a matching dry apron.
use super::{BUILD, Generated, Input, TREES, WALK, hash};
use bevy_ecs::prelude::*;
use std::collections::VecDeque;

const RADIUS: i32 = 9;
const SIDE: usize = (2 * RADIUS + 1) as usize;
const CARDINAL: [(i32, i32); 4] = [(0, -1), (1, 0), (0, 1), (-1, 0)];

#[derive(Resource, Default)]
pub(super) struct LedgeSettings {
    pub width: usize,
    pub height: usize,
    pub seed: u32,
    pub coverage: f64,
}

/// Each input cell carries an eligible dry terrain code and elevation. Zero
/// means unavailable. Output rows carry shelf identity, stair direction and policy.
pub(super) fn generate_ledges(
    settings: Res<LedgeSettings>,
    input: Res<Input>,
    mut output: ResMut<Generated>,
) {
    let LedgeSettings { width, height, seed, coverage } = *settings;
    let count = width * height;
    output.0.clear();
    output.0.resize(count * 3, 0.0);
    if input.0.len() != count * 2 || coverage <= 0.0 {
        return;
    }

    let mut terrain: Vec<_> = input.0.chunks_exact(2).map(|tile| tile[0] as u8).collect();
    let target = (terrain.iter().filter(|&&kind| kind != 0).count() as f64 * coverage).round() as usize;
    let mut candidates = Vec::new();
    let margin = RADIUS as usize + 2;
    for y in (margin..height.saturating_sub(margin)).step_by(2) {
        for x in (margin..width.saturating_sub(margin)).step_by(2) {
            let cell = y * width + x;
            if terrain[cell] != 0 {
                let score = input.0[cell * 2 + 1] * 0.4 + hash(seed, x as i32, y as i32);
                candidates.push((score, x as i32, y as i32));
            }
        }
    }
    candidates.sort_unstable_by(|a, b| {
        b.0.total_cmp(&a.0).then_with(|| (a.2, a.1).cmp(&(b.2, b.1)))
    });
    let at = |x: i32, y: i32| y as usize * width + x as usize;
    let slot = |x: i32, y: i32| (y + RADIUS) as usize * SIDE + (x + RADIUS) as usize;
    let mut raised = 0;
    let mut id = 0;
    for (_, cx, cy) in candidates {
        if raised >= target {
            break;
        }
        let kind = terrain[at(cx, cy)];
        if kind == 0 {
            continue;
        }
        let rx = 4.1 + 3.2 * hash(seed ^ 61, cx, cy);
        let ry = 3.0 + 1.8 * hash(seed ^ 73, cx, cy);
        let angle = hash(seed ^ 37, cx, cy) * std::f64::consts::PI;
        let (sin, cos) = angle.sin_cos();
        let mut shape = [false; SIDE * SIDE];
        let mut cells = Vec::new();
        let mut fits = true;
        'footprint: for y in -RADIUS + 1..RADIUS {
            for x in -RADIUS + 1..RADIUS {
                let u = (x as f64 * cos + y as f64 * sin) / rx;
                let v = (y as f64 * cos - x as f64 * sin) / ry;
                if u.powi(4) + v.powi(4) > 1.0 {
                    continue;
                }
                // An uninterrupted matching apron keeps the stair landing and
                // the visible shelf edges on the same ground palette.
                if !(-2..=2).all(|dy| (-2..=2).all(|dx| terrain[at(cx + x + dx, cy + y + dy)] == kind)) {
                    fits = false;
                    break 'footprint;
                }
                shape[slot(x, y)] = true;
                cells.push((x, y));
            }
        }
        if !fits {
            continue;
        }

        let mut floor = [false; SIDE * SIDE];
        for &(x, y) in &cells {
            floor[slot(x, y)] = (-1..=1).all(|dy| (-1..=1).all(|dx| shape[slot(x + dx, y + dy)]));
        }
        let mut entrance = None;
        let mut rank = f64::NEG_INFINITY;
        for &(x, y) in &cells {
            if floor[slot(x, y)] {
                continue;
            }
            for (direction, &(dx, dy)) in CARDINAL.iter().enumerate() {
                if !floor[slot(x + dx, y + dy)] || shape[slot(x - dx, y - dy)]
                    || !shape[slot(x + dy, y - dx)] || !shape[slot(x - dy, y + dx)] {
                    continue;
                }
                let score = hash(seed ^ 97, cx + x, cy + y);
                if score > rank {
                    rank = score;
                    entrance = Some((x, y, direction, dx, dy));
                }
            }
        }
        let Some((sx, sy, direction, dx, dy)) = entrance else {
            continue;
        };

        // The stair must reach every walkable tile on the summit.
        let mut remaining = floor;
        let mut summit = VecDeque::from([(sx + dx, sy + dy)]);
        remaining[slot(sx + dx, sy + dy)] = false;
        while let Some((x, y)) = summit.pop_front() {
            for (dx, dy) in CARDINAL {
                let next = slot(x + dx, y + dy);
                if remaining[next] {
                    remaining[next] = false;
                    summit.push_back((x + dx, y + dy));
                }
            }
        }
        if remaining.contains(&true) {
            continue;
        }

        id += 1;
        raised += cells.len();
        for (x, y) in cells {
            let cell = at(cx + x, cy + y);
            let stair = (x, y) == (sx, sy);
            let flags = if floor[slot(x, y)] || stair { WALK | BUILD | TREES } else { 0 };
            output.0[cell * 3..cell * 3 + 3].copy_from_slice(&[
                id as f64,
                if stair { (direction + 1) as f64 } else { 0.0 },
                flags as f64,
            ]);
            terrain[cell] = 0;
        }
        for step in -1..=1 {
            let cell = at(cx + sx + dx * step, cy + sy + dy * step);
            output.0[cell * 3 + 2] = (WALK | BUILD) as f64;
        }
    }
}
