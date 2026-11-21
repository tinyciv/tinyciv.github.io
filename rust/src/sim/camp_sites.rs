use bevy_ecs::prelude::Resource;

const START_CLEARANCE: f32 = 60.0;
const CAMP_SEPARATION: f32 = 20.0;
const PREFERRED_DISTANCE: f32 = 76.0;
const PREFERRED_TRAVEL: f32 = 42.0;
pub const MAX_TRAVEL_SECONDS: f64 = 120.0;
const LOCAL_SIZE: usize = 9;
const LOCAL_CELLS: usize = LOCAL_SIZE * LOCAL_SIZE;

/// Scratch data for the bounded placement pass. The host supplies live roads,
/// doors and buildability. The native planner owns spacing, access priority and
/// compact camp geometry.
#[derive(Resource, Default)]
pub struct CampSites {
    travel: Vec<f32>,
    points: Vec<f32>,
    clearance: Vec<f32>,
    allowed: Vec<u8>,
    candidates: Vec<Vec<u32>>,
    output: Vec<u32>,
    local: Vec<u8>,
}

impl CampSites {
    pub fn input(&mut self, count: usize, realms: usize) -> *mut f32 {
        self.travel.resize(count * realms, f32::INFINITY);
        self.travel.as_mut_ptr()
    }

    pub fn points(&mut self, count: usize) -> *mut f32 {
        self.points.resize(count * 2, 0.0);
        self.points.as_mut_ptr()
    }

    pub fn population(realms: usize) -> usize {
        realms.saturating_mul(2).clamp(4, 8)
    }

    pub fn next_size(large: usize, small: usize, unavailable: u32) -> u32 {
        let preferred = u32::from(small < large);
        [preferred, 1 - preferred].into_iter()
            .find(|size| unavailable & (1 << size) == 0).unwrap_or(2)
    }

    pub fn capacity(compact: bool, supply: f64) -> f64 {
        let max = if compact { 24.0 } else { 90.0 };
        (5.0 + (max - 5.0) * supply.clamp(0.0, 1.0)).round()
    }

    pub fn party(compact: bool, supply: f64, wanted: f64) -> f64 {
        let budget = if compact { wanted.min(12.0) } else { wanted };
        (1.0 + (budget - 1.0) * supply.clamp(0.0, 1.0)).round().min(budget).max(1.0)
    }

    pub fn prepare(&mut self, width: usize, height: usize, realms: usize) -> *const u8 {
        let cells = width * height;
        self.clearance.resize(cells, f32::INFINITY);
        self.allowed.resize(cells, 0);
        for (cell, allowed) in self.allowed.iter_mut().enumerate() {
            let (x, y) = ((cell % width) as f32 + 0.5, (cell / width) as f32 + 0.5);
            // Distance to the entire tile footprint, including its nearest edge.
            let distance = self.points.chunks_exact(2).fold(f32::INFINITY, |best, start| {
                let dx = ((x - start[0]).abs() - 0.5).max(0.0);
                let dy = ((y - start[1]).abs() - 0.5).max(0.0);
                best.min(dx * dx + dy * dy)
            });
            self.clearance[cell] = distance.sqrt();
            *allowed = u8::from(distance >= START_CLEARANCE * START_CLEARANCE);
        }
        self.candidates.resize_with(realms, Vec::new);
        for (realm, choices) in self.candidates.iter_mut().enumerate() {
            choices.clear();
            let travel = &self.travel[realm * cells..(realm + 1) * cells];
            for y in (3..height.saturating_sub(3)).step_by(3) {
                for x in (3..width.saturating_sub(3)).step_by(3) {
                    let cell = y * width + x;
                    if self.allowed[cell] != 0 && travel[cell].is_finite() {
                        choices.push(cell as u32);
                    }
                }
            }
            let score = |cell: u32| {
                let i = cell as usize;
                (self.clearance[i] - PREFERRED_DISTANCE).abs()
                    + (travel[i] - PREFERRED_TRAVEL).abs() * 0.65
            };
            choices.sort_unstable_by(|&a, &b| score(a).total_cmp(&score(b)).then_with(|| a.cmp(&b)));
        }
        self.allowed.as_ptr()
    }

    pub fn order(&mut self, width: usize, height: usize) -> *const u32 {
        let cells = width * height;
        let mut realms: Vec<_> = self.candidates.iter().enumerate().map(|(realm, _)| {
            let travel = &self.travel[realm * cells..(realm + 1) * cells];
            let coverage = self.points.chunks_exact(2).filter(|camp| {
                travel[width * camp[1] as usize + camp[0] as usize].is_finite()
            }).count();
            (coverage, realm)
        }).collect();
        realms.sort_unstable();
        self.output.clear();
        for (_, realm) in realms {
            let length = self.output.len();
            self.output.push(0);
            self.output.push(realm as u32);
            self.output.extend(self.candidates[realm].iter().copied().filter(|&cell| {
                let (x, y) = ((cell as usize % width) as f32, (cell as usize / width) as f32);
                self.points.chunks_exact(2).all(|camp| {
                    (x - camp[0]).powi(2) + (y - camp[1]).powi(2) >= CAMP_SEPARATION.powi(2)
                })
            }));
            self.output[length] = (self.output.len() - length - 2) as u32;
        }
        self.output.as_ptr()
    }

    pub fn output_len(&self) -> usize {
        self.output.len()
    }

    pub fn compact_input(&mut self) -> *mut u8 {
        self.local.resize(LOCAL_CELLS, 0);
        self.local.as_mut_ptr()
    }

    /// Returns three tents, their tower, and a short trail leading to the muster
    /// square. Footpaths connect the tent doors and the tower's south edge.
    pub fn compact(&mut self, variant: usize) -> *const u32 {
        self.output.clear();
        let cell = |x: i32, y: i32| (y as usize) * LOCAL_SIZE + x as usize;
        let variants = [
            [(-2, 0), (2, 1), (-1, 3)],
            [(-2, 1), (2, 0), (1, 3)],
            [(-3, 1), (1, 0), (2, 3)],
            [(-1, 0), (3, 1), (-2, 3)],
        ];
        for offset in 0..variants.len() {
            let (x, y) = (4, 1);
            let tower = cell(x, y);
            let gate = cell(x, y + 5);
            let tents = variants[(variant + offset) % variants.len()].map(|(dx, dy)| cell(x + dx, y + dy));
            let mut paths = vec![gate];
            paths.extend((y + 1..y + 5).map(|row| cell(x, row)));
            for (dx, dy) in variants[(variant + offset) % variants.len()] {
                let range = if dx < 0 { dx..0 } else { 1..dx + 1 };
                paths.extend(range.map(|column| cell(x + column, y + dy + 1)));
            }
            if self.local[gate] & 2 == 0
                || [tower].into_iter().chain(tents).chain(paths.iter().copied()).any(|i| self.local[i] & 1 == 0)
                || paths.iter().any(|i| tents.contains(i))
            {
                continue;
            }
            // Terrain height and cliffs can split a level-looking footprint.
            // Every trail segment must connect to the muster square.
            let mut reached = [false; LOCAL_CELLS];
            reached[gate] = true;
            let mut queue = vec![gate];
            let mut head = 0;
            while head < queue.len() {
                let current = queue[head];
                head += 1;
                for (delta, direction) in [(-1, 2), (1, 3), (-(LOCAL_SIZE as i32), 0), (LOCAL_SIZE as i32, 1)] {
                    let next = (current as i32 + delta) as usize;
                    if self.local[current] & (1 << (direction + 2)) != 0
                        && paths.contains(&next) && !reached[next] {
                        reached[next] = true;
                        queue.push(next);
                    }
                }
            }
            if paths.iter().any(|&i| !reached[i]) {
                continue;
            }
            self.output.extend([gate, tower].into_iter().chain(tents).chain(paths).map(|i| i as u32));
            break;
        }
        self.output.as_ptr()
    }
}
