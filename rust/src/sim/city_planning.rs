//! Local street extensions and topology-only enclosure observations.
use bevy_ecs::prelude::*;

const STREET_RADIUS: i32 = 7;
const STREET_WIDTH: i32 = 2 * STREET_RADIUS + 1;
const CARDINAL: [(i32, i32, u8); 4] = [(0, -1, 2), (1, 0, 16), (0, 1, 64), (-1, 0, 8)];
const ROAD: u8 = 1;
const READY: u8 = 2;
const BUILDABLE: u8 = 4;
const OPEN: u8 = 8;

#[derive(Resource, Default)]
pub struct CityPlanning {
    input: Vec<u8>,
    queue: Vec<usize>,
    street_output: [i32; 5],
}

impl CityPlanning {
    pub fn input(&mut self, cells: usize) -> *mut u8 {
        self.input.resize(cells, 0);
        self.input.as_mut_ptr()
    }

    /// A three- or four-tile spur when a new home approaches a road end or ring.
    /// Observations are [occupancy flags, terrain edges] in a 15x15 window
    /// centered on the proposed house. Output is [length, x, y, dx, dy].
    pub fn street(&mut self, palace_x: i32, palace_y: i32) -> *const i32 {
        self.street_output = [0; 5];
        let index = |x: i32, y: i32| -> Option<usize> {
            let x = x + STREET_RADIUS;
            let y = y + STREET_RADIUS;
            ((0..STREET_WIDTH).contains(&x) && (0..STREET_WIDTH).contains(&y))
                .then_some((y * STREET_WIDTH + x) as usize)
        };
        let flags = |x, y| index(x, y).map_or(0, |cell| self.input[cell * 2]);
        let edges = |x, y| index(x, y).map_or(0, |cell| self.input[cell * 2 + 1]);
        let leads_out = |x, y, dx, dy| dx * (2 * (x - palace_x) - 1) + dy * (2 * (y - palace_y) - 1) > 0;
        let mut best = None;
        for y in -2_i32..=2 {
            for x in -2_i32..=2 {
                let distance = x.abs() + y.abs();
                if distance > 2 || flags(x, y) & READY == 0 {
                    continue;
                }
                let degree = CARDINAL.iter().filter(|&&(dx, dy, edge)| {
                    edges(x, y) & edge != 0 && flags(x + dx, y + dy) & ROAD != 0
                }).count();
                if degree == 0 {
                    continue;
                }
                let (rx, ry) = (x - palace_x, y - palace_y);
                for (dx, dy, edge) in CARDINAL {
                    if !leads_out(x, y, dx, dy) {
                        continue;
                    }
                    let ring = (-1..=2).contains(&rx) && (-1..=2).contains(&ry)
                        && (!(-1..=2).contains(&(rx + dx)) || !(-1..=2).contains(&(ry + dy)));
                    if degree != 1 && !ring {
                        continue;
                    }
                    // Each side of the ring needs at most one outlet.
                    if ring && (-2..=2).any(|offset| {
                        flags(x + dx - offset * dy, y + dy + offset * dx) & ROAD != 0
                    }) {
                        continue;
                    }
                    let straight = flags(x - dx, y - dy) & ROAD != 0;
                    for step in 1..=4 {
                        let (nx, ny) = (x + dx * step, y + dy * step);
                        if flags(nx, ny) & BUILDABLE == 0 || edges(nx - dx, ny - dy) & edge == 0
                            || CARDINAL.iter().any(|&(ax, ay, _)| {
                                (nx + ax, ny + ay) != (x, y) && flags(nx + ax, ny + ay) & ROAD != 0
                            })
                        {
                            break;
                        }
                        // Leave access to an outward walking tile beyond the spur.
                        let has_outlet = CARDINAL.iter().any(|&(ax, ay, next_edge)| {
                            leads_out(nx, ny, ax, ay) && edges(nx, ny) & next_edge != 0
                                && flags(nx + ax, ny + ay) & OPEN != 0
                        });
                        let score = (step, straight, -distance);
                        if step >= 3 && has_outlet && best.is_none_or(|previous| score > previous) {
                            best = Some(score);
                            self.street_output = [step, x + dx, y + dy, dx, dy];
                        }
                    }
                }
            }
        }
        self.street_output.as_ptr()
    }

    /// Label the exterior of completed stone walls. Terrain and other kinds
    /// remain open, so neither water nor palisades can close the stone ring.
    pub fn stone_exterior(&mut self, width: usize, height: usize) -> *const u8 {
        self.queue.clear();
        let add = |cell: usize, input: &mut [u8], queue: &mut Vec<usize>| {
            if input[cell] == 0 { input[cell] = 2; queue.push(cell); }
        };
        for x in 0..width {
            add(x, &mut self.input, &mut self.queue);
            add((height - 1) * width + x, &mut self.input, &mut self.queue);
        }
        for y in 0..height {
            add(y * width, &mut self.input, &mut self.queue);
            add(y * width + width - 1, &mut self.input, &mut self.queue);
        }
        let mut head = 0;
        while head < self.queue.len() {
            let cell = self.queue[head];
            head += 1;
            let (x, y) = (cell % width, cell / width);
            for ny in y.saturating_sub(1)..=(y + 1).min(height - 1) {
                for nx in x.saturating_sub(1)..=(x + 1).min(width - 1) {
                    add(ny * width + nx, &mut self.input, &mut self.queue);
                }
            }
        }
        self.input.as_ptr()
    }
}
