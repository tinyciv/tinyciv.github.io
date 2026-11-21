//! One-shot exploration encounters. The host transports observations and applies
//! emitted entity patches; placement, rolls, routes and reward amounts live here.
use super::{Rng, rng::Mulberry32};
use bevy_ecs::prelude::*;
use std::collections::{BTreeMap, BTreeSet, VecDeque};

const RUINS: u8 = 0;
const HUT: u8 = 1;
const FOSSIL: u8 = 2;
const DESERT_TILE: u32 = 1 << 6;
const FOSSIL_DISCOVERY: u8 = 9;
const FOSSIL_SCIENCE: f64 = 25.0;
const SITE_SPACING: usize = 14;
const RUINS_AMBUSH_CHANCE: f64 = 0.05;
const RUINS_SETTLEMENT_CHANCE: f64 = 0.12;

#[derive(Component, Clone, Copy)]
struct Encounter {
    id: usize,
    kind: u8,
    x: usize,
    y: usize,
    status: u8,
    actor: i32,
    outcome: u8,
    variant: u8,
}

fn footprint(kind: u8) -> usize {
    if kind == HUT { 1 } else { 2 }
}

fn variant_count(kind: u8) -> u8 {
    if kind == HUT { 2 } else { 3 }
}

#[derive(Clone, Copy)]
struct Tile {
    flags: u32,
    edges: u16,
    owner: i32,
    seen: bool,
}
#[derive(Resource, Default)]
pub struct Exploration {
    input: Vec<f64>,
    output: Vec<f64>,
    sites: BTreeMap<usize, (Entity, Encounter)>,
    cells: BTreeMap<usize, usize>,
    width: usize,
    height: usize,
    tiles: Vec<Tile>,
    retry_at: BTreeMap<usize, f64>,
    observations: BTreeMap<i32, (f64, f64)>,
}
impl Exploration {
    pub fn prepare(&mut self, length: usize) -> *mut f64 {
        self.input.resize(length, 0.0);
        self.input.as_mut_ptr()
    }
    pub fn reward_due(&mut self, id: usize, now: f64) -> bool {
        let next = self.retry_at.entry(id).or_insert(f64::NEG_INFINITY);
        if now < *next {
            return false;
        }
        *next = now + 2.0;
        true
    }
    pub fn geometry(&mut self, width: usize, height: usize) {
        if self.input.len() != width * height * 4 {
            return;
        }
        self.width = width;
        self.height = height;
        self.tiles = self
            .input
            .chunks_exact(4)
            .map(|r| Tile {
                flags: r[0] as u32,
                edges: r[1] as u16,
                owner: r[2] as i32,
                seen: r[3] != 0.0,
            })
            .collect();
    }
    fn insert(&mut self, world: &mut World, site: Encounter) {
        let size = footprint(site.kind);
        for dy in 0..size {
            for dx in 0..size {
                self.cells
                    .insert((site.y + dy) * self.width + site.x + dx, site.id);
            }
        }
        let entity = world.spawn(site).id();
        self.sites.insert(site.id, (entity, site));
    }
    fn replace(&mut self, world: &mut World, site: Encounter) {
        if let Some((entity, current)) = self.sites.get_mut(&site.id) {
            *current = site;
            world.entity_mut(*entity).insert(site);
        }
    }
    fn clear(&mut self, world: &mut World) {
        for (entity, _) in self.sites.values() {
            let _ = world.despawn(*entity);
        }
        self.sites.clear();
        self.cells.clear();
        self.observations.clear();
        self.retry_at.clear();
    }
    pub fn initialize(&mut self, world: &mut World, seed: u32, restore: bool) -> *const f64 {
        self.clear(world);
        if restore {
            let rows = self.input.clone();
            for r in rows.chunks_exact(8) {
                let kind = r[1] as u8;
                let site = Encounter {
                    id: r[0] as usize,
                    kind,
                    x: r[2] as usize,
                    y: r[3] as usize,
                    status: r[4] as u8,
                    actor: r[5] as i32,
                    outcome: r[6] as u8,
                    // Ship the existing baked scenario with the current art set.
                    variant: (r[7] as u8) % variant_count(kind),
                };
                let size = footprint(kind);
                if site.x.saturating_add(size) <= self.width
                    && site.y.saturating_add(size) <= self.height
                {
                    self.insert(world, site);
                }
            }
        } else if self.width > 4 && self.height > 4 {
            let mut rng = Mulberry32::new(seed);
            let mut reachable = vec![false; self.tiles.len()];
            let mut queue = VecDeque::new();
            for (c, t) in self.tiles.iter().enumerate() {
                if t.flags & 16 != 0 {
                    reachable[c] = true;
                    queue.push_back(c);
                }
            }
            while let Some(c) = queue.pop_front() {
                for next in self.neighbors(c) {
                    if !reachable[next] {
                        reachable[next] = true;
                        queue.push_back(next);
                    }
                }
            }
            let mut candidates: Vec<_> = (0..self.tiles.len())
                .filter(|&c| {
                    reachable[c]
                        && self.tiles[c].flags & 6 == 6
                        && !self.tiles[c].seen
                        && self.tiles[c].owner < 0
                })
                .collect();
            for i in (1..candidates.len()).rev() {
                let j = (rng.next_f64() * (i + 1) as f64) as usize;
                candidates.swap(i, j);
            }
            let wanted = (self.tiles.len() / 5000).clamp(2, 24);
            let desert_area = candidates
                .iter()
                .filter(|&&c| self.tiles[c].flags & DESERT_TILE != 0)
                .count();
            let fossil_wanted = (desert_area / 1200).clamp(1, 12);
            let mut too_close = vec![false; self.tiles.len()];
            for (kind, wanted) in [(RUINS, wanted), (HUT, wanted), (FOSSIL, fossil_wanted)] {
                let size = footprint(kind);
                let mut placed = 0;
                for &cell in &candidates {
                    let x = cell % self.width;
                    let y = cell / self.width;
                    if too_close[cell] || x < 2 || y < 2 || x + size + 2 >= self.width || y + size + 2 >= self.height {
                        continue;
                    }
                    if kind == FOSSIL && (y..y + size).any(|ny| {
                        (x..x + size).any(|nx| {
                            let c = ny * self.width + nx;
                            !reachable[c] || self.tiles[c].flags & DESERT_TILE == 0
                        })
                    }) {
                        continue;
                    }
                    if (y - 2..y + size + 2).any(|ny| {
                        (x - 2..x + size + 2).any(|nx| {
                            let t = self.tiles[ny * self.width + nx];
                            t.flags & 6 != 6
                                || kind == RUINS && t.flags & 8 == 0
                                || t.owner >= 0
                                || t.seen
                        })
                    }) {
                        continue;
                    }
                    let site = Encounter {
                        id: self.sites.len() + 1,
                        kind,
                        x,
                        y,
                        status: 0,
                        actor: -1,
                        outcome: 0,
                        variant: (rng.next_u32() % u32::from(variant_count(kind))) as u8,
                    };
                    self.insert(world, site);
                    for ny in y.saturating_sub(SITE_SPACING)..=(y + SITE_SPACING).min(self.height - 1) {
                        for nx in x.saturating_sub(SITE_SPACING)..=(x + SITE_SPACING).min(self.width - 1) {
                            if x.abs_diff(nx).pow(2) + y.abs_diff(ny).pow(2) < SITE_SPACING.pow(2) {
                                too_close[ny * self.width + nx] = true;
                            }
                        }
                    }
                    placed += 1;
                    if placed >= wanted {
                        break;
                    }
                }
            }
        }
        self.views()
    }
    fn views(&mut self) -> *const f64 {
        self.output.clear();
        self.output.push(self.sites.len() as f64);
        for (_, s) in self.sites.values() {
            self.output.extend_from_slice(&[
                s.id as f64,
                s.kind as f64,
                s.x as f64,
                s.y as f64,
                s.status as f64,
                s.actor as f64,
                s.outcome as f64,
                s.variant as f64,
            ]);
        }
        self.output.as_ptr()
    }
    /// Grid traversal covers footprints crossed between three-Hz samples.
    /// Work scales with distance moved, not the world or encounter count.
    fn crossed(&self, from: (f64, f64), to: (f64, f64)) -> Option<usize> {
        let (mut x, mut y) = (from.0.floor() as i32, from.1.floor() as i32);
        let (end_x, end_y) = (to.0.floor() as i32, to.1.floor() as i32);
        let (dx, dy) = (to.0 - from.0, to.1 - from.1);
        let (sx, sy) = (dx.signum() as i32, dy.signum() as i32);
        let mut tx = if dx > 0.0 {
            (x as f64 + 1.0 - from.0) / dx
        } else if dx < 0.0 {
            (x as f64 - from.0) / dx
        } else {
            f64::INFINITY
        };
        let mut ty = if dy > 0.0 {
            (y as f64 + 1.0 - from.1) / dy
        } else if dy < 0.0 {
            (y as f64 - from.1) / dy
        } else {
            f64::INFINITY
        };
        for _ in 0..64 {
            if x >= 0 && y >= 0 && x < self.width as i32 && y < self.height as i32 {
                if let Some(&id) = self.cells.get(&(y as usize * self.width + x as usize)) {
                    if self.sites[&id].1.status == 0 {
                        return Some(id);
                    }
                }
            }
            if x == end_x && y == end_y {
                break;
            }
            if tx < ty {
                x += sx;
                tx += 1.0 / dx.abs();
            } else if ty < tx {
                y += sy;
                ty += 1.0 / dy.abs();
            } else {
                x += sx;
                y += sy;
                tx += 1.0 / dx.abs();
                ty += 1.0 / dy.abs();
            }
        }
        None
    }
    /// Contact output: site ID, outcome. No RNG is consumed without a valid contact.
    pub fn contact(
        &mut self,
        world: &mut World,
        actor: i32,
        x: f64,
        y: f64,
        flags: u32,
    ) -> *const f64 {
        self.output = vec![0.0, 0.0];
        if flags != 1
            || !x.is_finite()
            || !y.is_finite()
            || x < 0.0
            || y < 0.0
            || x >= self.width as f64
            || y >= self.height as f64
        {
            self.observations.remove(&actor);
            return self.output.as_ptr();
        }
        let current = (x, y);
        let previous = self
            .observations
            .insert(actor, current)
            .filter(|p| (p.0 - x).hypot(p.1 - y) <= 16.0)
            .unwrap_or(current);
        let Some(id) = self.crossed(previous, current) else {
            return self.output.as_ptr();
        };
        let mut site = self.sites[&id].1;
        site.outcome = if site.kind == FOSSIL {
            FOSSIL_DISCOVERY
        } else {
            let roll = world.resource_mut::<Rng>().0.next_f64();
            if site.kind == RUINS {
                let rare_chance = RUINS_AMBUSH_CHANCE + RUINS_SETTLEMENT_CHANCE;
                if roll < RUINS_AMBUSH_CHANCE {
                    3
                } else if roll < rare_chance {
                    2
                } else {
                    [0, 1, 4][(((roll - rare_chance) / (1.0 - rare_chance)) * 3.0).floor() as usize]
                }
            } else if roll < 0.05 {
                8
            } else {
                [5, 6, 7][(((roll - 0.05) / 0.95) * 3.0).floor() as usize]
            }
        };
        site.actor = actor;
        site.status = 1;
        self.replace(world, site);
        self.output = vec![site.id as f64, site.outcome as f64];
        self.output.as_ptr()
    }
    fn neighbors(&self, cell: usize) -> impl Iterator<Item = usize> + '_ {
        self.neighbors_mask(cell, 1)
    }
    fn neighbors_mask(&self, cell: usize, mask: u32) -> impl Iterator<Item = usize> + '_ {
        let x = (cell % self.width) as i32;
        let y = (cell / self.width) as i32;
        (-1..=1)
            .flat_map(move |dy| (-1..=1).map(move |dx| (dx, dy)))
            .filter(|&(dx, dy)| dx != 0 || dy != 0)
            .enumerate()
            .filter_map(move |(direction, (dx, dy))| {
                let nx = x + dx;
                let ny = y + dy;
                if self.tiles[cell].edges & (1 << direction) != 0
                    && nx >= 0
                    && ny >= 0
                    && nx < self.width as i32
                    && ny < self.height as i32
                {
                    let next = ny as usize * self.width + nx as usize;
                    if self.tiles[next].flags & mask != 0 {
                        return Some(next);
                    }
                }
                None
            })
    }
    fn routes(&self, start: usize) -> Vec<usize> {
        self.routes_mask(start, 1)
    }
    fn routes_mask(&self, start: usize, mask: u32) -> Vec<usize> {
        let mut parent = vec![usize::MAX; self.tiles.len()];
        if start >= parent.len() {
            return parent;
        }
        let mut queue = VecDeque::from([start]);
        parent[start] = start;
        while let Some(cell) = queue.pop_front() {
            for next in self.neighbors_mask(cell, mask) {
                if parent[next] == usize::MAX {
                    parent[next] = cell;
                    queue.push_back(next);
                }
            }
        }
        parent
    }
    fn free(&self, cell: usize, actor: i32) -> bool {
        let t = self.tiles[cell];
        t.flags & 6 == 6 && (t.owner < 0 || t.owner == actor)
    }
    fn plots(
        &self,
        origin: usize,
        actor: i32,
        excluded: &BTreeSet<usize>,
        count: usize,
    ) -> Vec<usize> {
        let parents = self.routes(origin);
        let x = (origin % self.width) as f64;
        let y = (origin / self.width) as f64;
        let mut candidates: Vec<_> = (0..self.tiles.len())
            .filter(|&c| {
                parents[c] != usize::MAX
                    && self.free(c, actor)
                    && !excluded.contains(&c)
                    && ((c % self.width) as f64 - x).hypot((c / self.width) as f64 - y) <= 12.0
            })
            .collect();
        candidates.sort_by(|&a, &b| {
            let d = |c: usize| ((c % self.width) as f64 - x).hypot((c / self.width) as f64 - y);
            d(a).total_cmp(&d(b)).then(a.cmp(&b))
        });
        candidates.truncate(count);
        candidates
    }
    /// Effect header: outcome,amount,technologyIndex,success. Then fixed 4-wide
    /// operations: 1 town,2 house,3 farm,4 refugee,5 marauder,6 revealed cell.
    /// Input: retinue,level,xp,bonusResearch,nTech,nTargets,capitalId,capitalCell,
    /// reserved,reserved,houseCapacity,farmPeople; tech rows cost,level,prerequisite mask; target rows approachCell,known,id,friendlyTown.
    pub fn reward(&mut self, world: &mut World, id: usize, actor: i32, choice: i32) -> *const f64 {
        self.output = vec![0.0, 0.0, -1.0, 0.0];
        let Some((_, mut site)) = self.sites.get(&id).copied() else {
            return self.output.as_ptr();
        };
        if site.actor != actor || site.status != 1 {
            return self.output.as_ptr();
        }
        if site.outcome == FOSSIL_DISCOVERY {
            if choice == 0 {
                site.status = 2;
                self.replace(world, site);
                self.output = vec![f64::from(FOSSIL_DISCOVERY), FOSSIL_SCIENCE, -1.0, 1.0];
            }
            return self.output.as_ptr();
        }
        if self.input.len() < 12 {
            return self.output.as_ptr();
        }
        if site.status == 1 && site.outcome == 2 && choice < 0 {
            site.status = 2;
            self.replace(world, site);
            self.output[3] = 1.0;
            return self.output.as_ptr();
        }
        let data = self.input.clone();
        let n = data[4] as usize;
        let targets = data[5] as usize;
        if data.len() != 12 + n * 3 + targets * 4 {
            return self.output.as_ptr();
        }
        let origin = site.y * self.width + site.x;
        let mut outcome = site.outcome;
        if (outcome == 2 && choice == 0) || (outcome != 2 && choice != 0) {
            return self.output.as_ptr();
        }
        let mut amount = 0.0;
        let mut tech = -1.0;
        let mut ops = Vec::new();
        if outcome == 1 {
            let mut learned = 0u64;
            for (i, r) in data[12..12 + n * 3].chunks_exact(3).enumerate() {
                if r[1] > 0.0 {
                    learned |= 1 << i;
                }
            }
            let mut best = 0.0;
            for (i, r) in data[12..12 + n * 3].chunks_exact(3).enumerate() {
                let prereq = r[2] as u64;
                if r[1] == 0.0 && prereq & learned == prereq && r[0] > best {
                    best = r[0];
                    tech = i as f64;
                }
            }
            if tech < 0.0 {
                outcome = 0;
            }
        }
        if outcome == 0 {
            amount = 100.0 + 10.0 * (world.resource_mut::<Rng>().0.next_f64() * 21.0).floor();
        }
        if outcome == 8 {
            amount = 25.0;
        }
        if outcome == 7 {
            amount = crate::progression::xp_required(data[1]) - data[2];
        }
        if outcome == 6 {
            amount = 1.0;
            let plots = self.plots(origin, actor, &BTreeSet::from([origin]), 1);
            let Some(&c) = plots.first() else {
                return self.output.as_ptr();
            };
            ops.extend_from_slice(&[
                7.0,
                (c % self.width) as f64 + 0.5,
                (c / self.width) as f64 + 0.5,
                0.0,
            ]);
        }
        if outcome == 2 {
            let footprint: BTreeSet<_> = [
                origin,
                origin + 1,
                origin + self.width,
                origin + self.width + 1,
            ]
            .into_iter()
            .collect();
            if footprint.iter().any(|&c| {
                c >= self.tiles.len() || !self.free(c, actor) || self.tiles[c].flags & 8 == 0
            }) {
                return self.output.as_ptr();
            }
            // A restored town has exactly ten beds and ten residents immediately.
            ops.extend_from_slice(&[1.0, site.x as f64, site.y as f64, 10.0]);
            amount = 180.0;
            // The host completes the town with the same free perimeter road
            // as other palaces. Keep reward farms outside that entire ring.
            let mut reserved = footprint;
            for y in site.y.saturating_sub(1)..=(site.y + 2).min(self.height - 1) {
                for x in site.x.saturating_sub(1)..=(site.x + 2).min(self.width - 1) {
                    reserved.insert(y * self.width + x);
                }
            }
            let plots = self.plots(
                origin,
                actor,
                &reserved,
                (10.0 / data[11].max(0.1)).ceil() as usize,
            );
            if plots.len() < (10.0 / data[11].max(0.1)).ceil() as usize {
                return self.output.as_ptr();
            }
            for c in plots {
                ops.extend_from_slice(&[
                    3.0,
                    (c % self.width) as f64,
                    (c / self.width) as f64,
                    0.0,
                ]);
            }
        }
        if outcome == 3 {
            amount = data[0].max(0.0).floor() + 3.0;
            let mut plots = self.plots(origin, -2, &BTreeSet::new(), usize::MAX);
            plots.retain(|&c| {
                ((c % self.width) as f64 - site.x as f64)
                    .hypot((c / self.width) as f64 - site.y as f64)
                    >= 2.0
            });
            // A large army may require multiple ranks on one walkable spawn cell.
            if plots.is_empty() {
                return self.output.as_ptr();
            }
            for i in 0..amount as usize {
                let c = plots[i % plots.len()];
                ops.extend_from_slice(&[
                    5.0,
                    (c % self.width) as f64 + 0.5,
                    (c / self.width) as f64 + 0.5,
                    data[6],
                ]);
            }
        }
        if outcome == 4 {
            let parents = self.routes(origin);
            let destination = data[12 + n * 3..]
                .chunks_exact(4)
                .filter(|r| {
                    r[3] != 0.0
                        && (r[0] as usize) < parents.len()
                        && parents[r[0] as usize] != usize::MAX
                })
                .min_by(|a, b| {
                    let d = |r: &[f64]| {
                        ((r[0] as usize % self.width) as f64 - site.x as f64)
                            .hypot((r[0] as usize / self.width) as f64 - site.y as f64)
                    };
                    d(a).total_cmp(&d(b))
                });
            let Some(target) = destination else {
                return self.output.as_ptr();
            };
            let destination = target[0] as usize;
            let destination_id = target[2];
            let homes = (10.0 / data[10].max(1.0)).ceil() as usize;
            let farms = (10.0 / data[11].max(0.1)).ceil() as usize;
            let mut corridor = BTreeSet::from([destination]);
            let mut step = destination;
            while step != origin {
                step = parents[step];
                corridor.insert(step);
            }
            let candidates = self.plots(destination, actor, &corridor, usize::MAX);
            // Spaced houses preserve connected lanes. Farms remain walkable.
            let house_cells: Vec<_> = candidates
                .iter()
                .copied()
                .filter(|&c| c % self.width % 2 == 0 && c / self.width % 2 == 0)
                .take(homes)
                .collect();
            let used: BTreeSet<_> = house_cells.iter().copied().collect();
            let farm_cells: Vec<_> = candidates
                .iter()
                .copied()
                .filter(|c| !used.contains(c))
                .take(farms)
                .collect();
            if house_cells.len() < homes || farm_cells.len() < farms {
                return self.output.as_ptr();
            }
            for c in house_cells {
                ops.extend_from_slice(&[
                    2.0,
                    (c % self.width) as f64,
                    (c / self.width) as f64,
                    data[10],
                ]);
            }
            for c in farm_cells {
                ops.extend_from_slice(&[
                    3.0,
                    (c % self.width) as f64,
                    (c / self.width) as f64,
                    0.0,
                ]);
            }
            // Ten distinct people start at the ruins; their normal movement
            // brings them to the receiving city and its free housing.
            for _ in 0..10 {
                ops.extend_from_slice(&[
                    4.0,
                    site.x as f64 + 0.5,
                    site.y as f64 + 0.5,
                    destination_id,
                ]);
            }
            ops.extend_from_slice(&[
                8.0,
                (destination % self.width) as f64 + 0.5,
                (destination / self.width) as f64 + 0.5,
                destination_id,
            ]);
            amount = 10.0;
        }
        if outcome == 5 {
            // A map describes terrain through fortifications; it does not grant
            // refugees or combatants permission to walk through those walls.
            let parents = self.routes_mask(origin, 32);
            let mut destinations: BTreeMap<i64, Vec<usize>> = BTreeMap::new();
            for row in data[12 + n * 3..].chunks_exact(4) {
                let target = row[0] as usize;
                if target >= parents.len() || parents[target] == usize::MAX || row[1] != 0.0 {
                    continue;
                }
                let mut path = vec![target];
                let mut cell = target;
                while cell != origin {
                    cell = parents[cell];
                    path.push(cell);
                }
                path.reverse();
                let id = row[2] as i64;
                if destinations
                    .get(&id)
                    .is_none_or(|previous| path.len() < previous.len())
                {
                    destinations.insert(id, path);
                }
            }
            let mut paths: Vec<_> = destinations.into_values().collect();
            paths.sort_by_key(Vec::len);
            paths.truncate(3);
            let mut revealed = BTreeSet::new();
            // Round-robin along paths so the closest city does not consume the
            // entire 300-cell budget. Widen corridors only after their spines.
            let longest = paths.iter().map(Vec::len).max().unwrap_or(0);
            for step in 0..longest {
                for path in &paths {
                    if let Some(&c) = path.get(step) {
                        if !self.tiles[c].seen && revealed.len() < 300 {
                            revealed.insert(c);
                        }
                    }
                }
            }
            let spines: Vec<_> = revealed.iter().copied().collect();
            for c in spines {
                let x = c % self.width;
                let y = c / self.width;
                for ny in y.saturating_sub(1)..=(y + 1).min(self.height - 1) {
                    for nx in x.saturating_sub(1)..=(x + 1).min(self.width - 1) {
                        let next = ny * self.width + nx;
                        if !self.tiles[next].seen && revealed.len() < 300 {
                            revealed.insert(next);
                        }
                    }
                }
            }
            amount = revealed.len() as f64;
            for c in revealed {
                ops.extend_from_slice(&[6.0, c as f64, 0.0, 0.0]);
            }
        }
        site.status = 2;
        site.outcome = outcome;
        self.replace(world, site);
        self.output = vec![outcome as f64, amount, tech, 1.0];
        self.output.extend(ops);
        self.output.as_ptr()
    }
    pub fn length(&self) -> usize {
        self.output.len()
    }
}

pub fn initialize(world: &mut World, seed: u32, restore: bool) -> *const f64 {
    world.resource_scope(|w, mut e: Mut<Exploration>| e.initialize(w, seed, restore))
}
pub fn contact(world: &mut World, actor: i32, x: f64, y: f64, flags: u32) -> *const f64 {
    world.resource_scope(|w, mut e: Mut<Exploration>| e.contact(w, actor, x, y, flags))
}
pub fn reward(world: &mut World, id: usize, actor: i32, choice: i32) -> *const f64 {
    world.resource_scope(|w, mut e: Mut<Exploration>| e.reward(w, id, actor, choice))
}

/// Ranger is an immutable archer specialty, sharing its renderer and combat
/// pipeline while retaining a separate permanent faction entitlement.
pub fn ranger(field: u32, value: f64, enabled: bool) -> f64 {
    if !enabled {
        return value;
    }
    match field {
        0 => value * 1.5,
        1 | 2 => value * 1.25,
        3 => 0.0,
        _ => value,
    }
}
pub fn ranger_recruit(entitled: f64, alive: f64) -> bool {
    entitled > alive
}

pub fn ambush_committed(was: bool, alive: bool, fleeing: bool, distance: f64) -> bool {
    was || !alive || fleeing || distance > 12.0
}
pub fn refugee_arrived(x: f64, y: f64, gx: f64, gy: f64) -> bool {
    (x - gx).hypot(y - gy) <= 0.75
}
pub fn treasure_target(width: usize, height: usize) -> usize {
    ((width * height + 325) / 650).clamp(1, 24)
}

pub fn ordinary_slots(total: f64, rangers: f64) -> f64 {
    (total - rangers).max(0.0)
}
pub fn build_allowed(world: &World, x: i32, y: i32, width: i32, height: i32) -> bool {
    let exploration = world.resource::<Exploration>();
    let right = x.saturating_add(width).min(exploration.width as i32);
    let bottom = y.saturating_add(height).min(exploration.height as i32);
    (y.max(0)..bottom).all(|ny| {
        (x.max(0)..right).all(|nx| {
            let cell = ny as usize * exploration.width + nx as usize;
            exploration.cells.get(&cell).is_none_or(|id| exploration.sites[id].1.status == 2)
        })
    })
}

pub fn ambush_active(finished: bool, standing: usize) -> bool {
    !finished && standing > 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restored_town_farms_leave_the_perimeter_road_ring_clear() {
        let mut world = World::new();
        let mut exploration = Exploration::default();
        exploration.width = 20;
        exploration.height = 20;
        exploration.tiles = vec![Tile { flags: 47, edges: 255, owner: -1, seen: false }; 400];
        exploration.insert(&mut world, Encounter {
            id: 1, kind: 0, x: 8, y: 8, status: 1, actor: 0, outcome: 2, variant: 0,
        });
        exploration.input = vec![0.0, 1.0, 0.0, 0.0, 0.0, 0.0, -1.0, -1.0, 0.0, 0.0, 4.0, 2.4];
        exploration.reward(&mut world, 1, 0, 1);
        assert_eq!(exploration.output[3], 1.0);
        assert_eq!(&exploration.output[4..8], &[1.0, 8.0, 8.0, 10.0]);
        let farms: Vec<_> = exploration.output[8..].chunks_exact(4).filter(|op| op[0] == 3.0).collect();
        assert_eq!(farms.len(), 5, "the ten new residents still receive all their farms");
        for farm in farms {
            assert!(farm[1] < 7.0 || farm[1] > 10.0 || farm[2] < 7.0 || farm[2] > 10.0,
                "reward farms must not occupy the town or its road ring");
        }
    }
}
