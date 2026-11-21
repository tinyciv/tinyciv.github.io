//! Indexed NPC defense planning. Bounded local placement searches preserve
//! civilian routes through cities and use the ordinary construction queue.
use super::kinds::building as b;
use bevy_ecs::prelude::*;
use rstar::{PointDistance, RTree, RTreeObject, AABB};
use rustc_hash::{FxHashMap, FxHashSet};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

const DEFENSE_REACH: i32 = 11;
const CITY_TOWERS: usize = 4;
const CITY_WALLS: usize = 7;
const WALL_RADIUS: i32 = 8;
const TOWER_ORDER: u32 = 1;
const PALISADE_ORDER: u32 = 2;
const WALL_ORDER: u32 = 4;
const CARDINAL: [(i32, i32); 4] = [(0, -1), (0, 1), (-1, 0), (1, 0)];
pub const SCOUT_SEARCH_RADIUS: i32 = 16;
const DIRS: [(i32, i32); 8] = [
    (-1, -1),
    (0, -1),
    (1, -1),
    (-1, 0),
    (1, 0),
    (-1, 1),
    (0, 1),
    (1, 1),
];
const RING: [(i32, i32); 8] = [
    (-1, -1),
    (0, -1),
    (1, -1),
    (1, 0),
    (1, 1),
    (0, 1),
    (-1, 1),
    (-1, 0),
];
const SECTORS: [(i32, i32); 4] = [(-4, -4), (5, 5), (5, -4), (-4, 5)];

#[derive(Clone, Copy, PartialEq)]
struct Row {
    id: i64,
    faction: i32,
    kind: u32,
    x: i32,
    y: i32,
    flags: u32,
    attacked_at: f64,
}
#[derive(Clone, PartialEq)]
struct Palace {
    id: i64,
    point: [f64; 2],
}
impl RTreeObject for Palace {
    type Envelope = AABB<[f64; 2]>;
    fn envelope(&self) -> Self::Envelope {
        AABB::from_point(self.point)
    }
}
impl PointDistance for Palace {
    fn distance_2(&self, p: &[f64; 2]) -> f64 {
        (self.point[0] - p[0]).powi(2) + (self.point[1] - p[1]).powi(2)
    }
}
#[derive(Default)]
struct CityPlan {
    revision: u64,
    layout_revision: u64,
    cursor: usize,
    candidates: Vec<(i32, i32)>,
    reachable: Vec<bool>,
    host_rejected: bool,
    retry_at: f64,
    exhausted_revision: u64,
    runtime: bool,
    rejected_walls: BTreeMap<(i32, i32), f64>,
}
#[derive(Default)]
struct FactionDefense {
    productive: usize,
    pending: usize,
    attacks: BTreeSet<(u64, i64)>,
}
#[derive(Resource, Default)]
pub struct DefensePlacement {
    width: i32,
    height: i32,
    terrain: Vec<u8>,
    edges: Vec<u8>,
    occupied: Vec<u32>,
    solid: Vec<u32>,
    bridges: Vec<u32>,
    rows: BTreeMap<i64, Row>,
    factions: BTreeMap<i32, FactionDefense>,
    palaces: BTreeMap<i32, RTree<Palace>>,
    cities: BTreeMap<i32, BTreeSet<i64>>,
    towers: FxHashMap<usize, BTreeSet<i64>>,
    walls: FxHashMap<usize, BTreeSet<i64>>,
    revision: u64,
    terrain_revision: u64,
    palace_revision: u64,
    chunks: FxHashMap<(i32, i32), u64>,
    tower_chunks: FxHashMap<(i32, i32), u64>,
    plans: BTreeMap<i64, CityPlan>,
    due: BTreeMap<i32, f64>,
    admitted_at: f64,
    observed_at: f64,
    pending: VecDeque<i32>,
    queued: FxHashSet<i32>,
    seen_at: FxHashMap<i32, f64>,
    city_cursor: BTreeMap<i32, i64>,
    input: Vec<f64>,
    output: Vec<f64>,
}
impl DefensePlacement {
    pub fn input(&mut self, length: usize) -> *mut f64 {
        self.input.resize(length, 0.0);
        self.input.as_mut_ptr()
    }
    pub fn reset(&mut self) {
        *self = Self::default();
    }
    pub fn geometry(&mut self, width: i32, height: i32) {
        let size = (width.max(0) as usize).saturating_mul(height.max(0) as usize);
        assert!(self.input.len() >= size * 2);
        self.width = width;
        self.height = height;
        self.terrain.resize(size, 0);
        self.edges.resize(size, 0);
        for cell in 0..size {
            self.terrain[cell] = self.input[cell * 2] as u8;
            self.edges[cell] = self.input[cell * 2 + 1] as u8;
        }
        self.occupied = vec![0; size];
        self.solid = vec![0; size];
        self.bridges = vec![0; size];
        self.towers.clear();
        self.walls.clear();
        let rows: Vec<_> = self.rows.values().copied().collect();
        for row in rows {
            self.cells(row, true);
        }
        self.revision += 1;
        self.terrain_revision = self.revision;
    }
    pub fn patch(&mut self) {
        for patch in self.input.chunks_exact(3) {
            let (cell, terrain, edges) = (patch[0] as usize, patch[1] as u8, patch[2] as u8);
            if self.terrain[cell] == terrain && self.edges[cell] == edges {
                continue;
            }
            self.terrain[cell] = terrain;
            self.edges[cell] = edges;
            self.revision += 1;
            let x = cell as i32 % self.width;
            let y = cell as i32 / self.width;
            self.chunks.insert((x / 16, y / 16), self.revision);
        }
    }
    fn cell(&self, x: i32, y: i32) -> Option<usize> {
        (x >= 0 && y >= 0 && x < self.width && y < self.height)
            .then_some((y as i64 * self.width as i64 + x as i64) as usize)
    }
    fn cells(&mut self, row: Row, add: bool) {
        if row.flags & 1 == 0 {
            return;
        }
        for dy in 0..b::height(row.kind) as i32 {
            for dx in 0..b::width(row.kind) as i32 {
                let Some(cell) = self.cell(row.x + dx, row.y + dy) else {
                    continue;
                };
                let change = |v: &mut u32| {
                    if add {
                        *v += 1;
                    } else {
                        *v = v.saturating_sub(1);
                    }
                };
                change(&mut self.occupied[cell]);
                if !b::farm(row.kind)
                    && !b::route(row.kind)
                    && row.kind != b::IRRIGATION
                    && row.kind != b::RUIN
                {
                    change(&mut self.solid[cell]);
                }
                if row.kind == b::BRIDGE {
                    change(&mut self.bridges[cell]);
                }
            }
        }
        let sites = match row.kind {
            b::WOODEN_TOWER | b::TOWER => &mut self.towers,
            b::PALISADE | b::WALL => &mut self.walls,
            _ => return,
        };
        if row.x >= 0 && row.y >= 0 && row.x < self.width && row.y < self.height {
            let cell = row.y as usize * self.width as usize + row.x as usize;
            if add {
                sites.entry(cell).or_default().insert(row.id);
            } else if let Some(ids) = sites.get_mut(&cell) {
                ids.remove(&row.id);
                if ids.is_empty() {
                    sites.remove(&cell);
                }
            }
        }
    }
    fn update_faction(&mut self, row: Row, add: bool) {
        if row.flags & 1 == 0 {
            return;
        }
        let faction = self.factions.entry(row.faction).or_default();
        if row.flags & 2 == 0 {
            let count = match row.kind {
                b::CAMP | b::HOUSE | b::WELL | b::MONUMENT | b::LIBRARY => Some(&mut faction.productive),
                b::WALL | b::PALISADE | b::WOODEN_TOWER => Some(&mut faction.pending),
                _ => None,
            };
            if let Some(count) = count {
                if add { *count += 1; } else { *count -= 1; }
            }
        }
        if row.attacked_at.is_finite() && row.attacked_at >= 0.0 {
            let attack = (row.attacked_at.to_bits(), row.id);
            if add { faction.attacks.insert(attack); } else { faction.attacks.remove(&attack); }
        }
    }
    fn role(&mut self, row: Row, add: bool) {
        if row.flags & 1 == 0 {
            return;
        }
        if row.kind == b::PALACE {
            let tree = self.palaces.entry(row.faction).or_default();
            let point = Palace {
                id: row.id,
                point: [row.x as f64, row.y as f64],
            };
            if add {
                tree.insert(point);
                if row.flags & 6 == 2 {
                    self.cities.entry(row.faction).or_default().insert(row.id);
                }
            } else {
                tree.remove(&point);
                if let Some(ids) = self.cities.get_mut(&row.faction) {
                    ids.remove(&row.id);
                }
            }
        }
    }
    fn mark_chunks(&mut self, row: Row) {
        if row.flags & 1 == 0 {
            return;
        }
        for cy in row.y.div_euclid(16)..=(row.y + b::height(row.kind) as i32 - 1).div_euclid(16) {
            for cx in row.x.div_euclid(16)..=(row.x + b::width(row.kind) as i32 - 1).div_euclid(16)
            {
                self.chunks.insert((cx, cy), self.revision);
                if matches!(row.kind, b::WOODEN_TOWER | b::TOWER) {
                    self.tower_chunks.insert((cx, cy), self.revision);
                }
            }
        }
    }
    fn city_revision(&self, city: Row, layout: bool) -> u64 {
        let chunks = if layout {
            &self.tower_chunks
        } else {
            &self.chunks
        };
        let mut revision = self.palace_revision;
        if !layout {
            revision = revision.max(self.terrain_revision);
        }
        for cy in (city.y - 13).div_euclid(16)..=(city.y + 13).div_euclid(16) {
            for cx in (city.x - 13).div_euclid(16)..=(city.x + 13).div_euclid(16) {
                revision = revision.max(chunks.get(&(cx, cy)).copied().unwrap_or(0));
            }
        }
        revision
    }
    pub fn site(&mut self, id: i64, faction: i32, kind: u32, x: i32, y: i32, flags: u32, attacked_at: f64) {
        let next = Row {
            id,
            faction,
            kind,
            x,
            y,
            flags,
            attacked_at,
        };
        let old = self.rows.get(&id).copied();
        if old == Some(next) {
            return;
        }
        if let Some(old) = old {
            self.update_faction(old, false);
            if old.flags == flags && old.x == x && old.y == y && old.faction == faction && old.kind == kind {
                self.update_faction(next, true);
                self.rows.insert(id, next);
                return;
            }
            self.cells(old, false);
            self.role(old, false);
            if old.x != x || old.y != y || old.faction != faction || old.kind != kind {
                self.plans.remove(&id);
            }
        }
        self.cells(next, true);
        self.role(next, true);
        self.update_faction(next, true);
        if flags & 1 != 0 {
            self.rows.insert(id, next);
        } else {
            self.rows.remove(&id);
            self.plans.remove(&id);
        }
        // Readiness affects city selection, but not a local walking graph.
        if old.is_none_or(|r| {
            r.x != x
                || r.y != y
                || r.kind != kind
                || r.faction != faction
                || (r.flags & 1) != (flags & 1)
        }) {
            self.revision += 1;
            if let Some(previous) = old {
                self.mark_chunks(previous);
            }
            self.mark_chunks(next);
            if kind == b::PALACE || old.is_some_and(|r| r.kind == b::PALACE) {
                self.palace_revision = self.revision;
            }
        }
    }
    pub fn due(&mut self, faction: i32, now: f64, interval: f64) -> bool {
        if now < self.observed_at {
            self.due.clear();
            self.pending.clear();
            self.queued.clear();
            self.seen_at.clear();
            self.admitted_at = now - crate::cadence::CHECK_INTERVAL;
        }
        self.observed_at = now;
        self.seen_at.insert(faction, now);
        // A defeated/removed realm stops asking. It must not leave an orphaned
        // queue head blocking the remaining realms indefinitely.
        while self
            .pending
            .front()
            .is_some_and(|id| self.seen_at.get(id).is_none_or(|seen| now - seen > 1.0))
        {
            if let Some(id) = self.pending.pop_front() {
                self.queued.remove(&id);
            }
        }
        let at = *self.due.entry(faction).or_insert(6.0 + faction as f64);
        if now < at {
            return false;
        }
        if self.queued.insert(faction) {
            self.pending.push_back(faction);
        }
        if now < self.admitted_at + crate::cadence::CHECK_INTERVAL
            || self.pending.front() != Some(&faction)
        {
            return false;
        }
        self.pending.pop_front();
        self.queued.remove(&faction);
        self.due.insert(faction, now + interval.max(0.1));
        self.admitted_at = now;
        true
    }
    fn attack(&self, faction: i32, now: f64) -> Option<Row> {
        let &(time, id) = self.factions.get(&faction)?.attacks.last()?;
        (now - f64::from_bits(time) < 16.0).then(|| self.rows[&id])
    }
    pub fn facts(&mut self, faction: i32, now: f64) -> *const f64 {
        let under_attack = self.attack(faction, now).is_some();
        self.output.clear();
        let (productive, pending) = self.factions.get(&faction)
            .map_or((0, 0), |f| (f.productive, f.pending));
        self.output.extend([productive as f64, pending as f64, u8::from(under_attack) as f64]);
        self.output.as_ptr()
    }
    /// One city per due faction plan, in stable ID order, including full cities
    /// in the rotation so a large realm never makes one unbounded planning call.
    pub fn next_city(&mut self, faction: i32) -> f64 {
        let Some(ids) = self.cities.get(&faction) else {
            return -1.0;
        };
        let previous = self.city_cursor.get(&faction).copied().unwrap_or(i64::MIN);
        let next = ids
            .range((
                std::ops::Bound::Excluded(previous),
                std::ops::Bound::Unbounded,
            ))
            .next()
            .or_else(|| ids.first())
            .copied();
        if let Some(id) = next {
            self.city_cursor.insert(faction, id);
            let row = self.rows[&id];
            if row.flags & 6 == 2 {
                return id as f64;
            }
        }
        -1.0
    }
    fn owner(&self, faction: i32, x: i32, y: i32) -> Option<i64> {
        let tree = self.palaces.get(&faction)?;
        let p = [x as f64, y as f64];
        let mut best = None;
        let mut distance = f64::INFINITY;
        for city in tree.nearest_neighbor_iter(p) {
            let d = city.distance_2(&p);
            if d > distance {
                break;
            }
            if d < distance || best.is_none_or(|id| city.id < id) {
                distance = d;
                best = Some(city.id);
            }
        }
        best
    }
    fn city_towers(&self, city: Row) -> Vec<i64> {
        let mut ids = Vec::new();
        for dy in -12..=12 {
            for dx in -12..=12 {
                if let Some(cell) = self.cell(city.x + dx, city.y + dy) {
                    if let Some(towers) = self.towers.get(&cell) {
                        for id in towers {
                            let t = self.rows[id];
                            if t.faction == city.faction
                                && self.owner(city.faction, t.x, t.y) == Some(city.id)
                            {
                                ids.push(*id);
                            }
                        }
                    }
                }
            }
        }
        ids.sort_unstable();
        ids
    }
    pub fn towers(&mut self, id: i64) -> *const f64 {
        let ids = self
            .rows
            .get(&id)
            .copied()
            .map(|row| self.city_towers(row))
            .unwrap_or_default();
        self.output.clear();
        self.output.push(ids.len() as f64);
        self.output.extend(ids.iter().map(|id| *id as f64));
        self.output.as_ptr()
    }
    fn walk(&self, x: i32, y: i32) -> bool {
        self.cell(x, y).is_some_and(|i| {
            self.solid[i] == 0
                && (self.terrain[i] & 1 != 0 || self.bridges[i] > 0 && self.terrain[i] & 2 != 0)
        })
    }
    fn edge(&self, x: i32, y: i32, nx: i32, ny: i32) -> bool {
        let Some(i) = self.cell(x, y) else {
            return false;
        };
        let Some(d) = DIRS
            .iter()
            .position(|&(dx, dy)| x + dx == nx && y + dy == ny)
        else {
            return false;
        };
        self.edges[i] & (1 << d) != 0
    }
    fn local_cell(city: Row, x: i32, y: i32, radius: i32) -> Option<usize> {
        let (dx, dy) = (x - city.x + radius, y - city.y + radius);
        let side = radius * 2 + 2;
        (dx >= 0 && dy >= 0 && dx < side && dy < side).then_some((dy * side + dx) as usize)
    }
    fn flood(&self, city: Row, radius: i32) -> Vec<bool> {
        let mut seen = vec![false; ((radius * 2 + 2) as usize).pow(2)];
        let mut queue = VecDeque::new();
        let local = |x, y| Self::local_cell(city, x, y, radius);
        for y in city.y - 1..=city.y + b::height(city.kind) as i32 {
            for x in city.x - 1..=city.x + b::width(city.kind) as i32 {
                if self.walk(x, y) {
                    if let Some(i) = local(x, y) {
                        if !seen[i] {
                            seen[i] = true;
                            queue.push_back((x, y));
                        }
                    }
                }
            }
        }
        while let Some((x, y)) = queue.pop_front() {
            for (dx, dy) in DIRS {
                let (nx, ny) = (x + dx, y + dy);
                let Some(i) = local(nx, ny) else {
                    continue;
                };
                if seen[i] || !self.walk(nx, ny) || !self.edge(x, y, nx, ny) {
                    continue;
                }
                if dx != 0 && dy != 0 && (!self.walk(x + dx, y) || !self.walk(x, y + dy)) {
                    continue;
                }
                seen[i] = true;
                queue.push_back((nx, ny));
            }
        }
        seen
    }
    fn candidates(&self, city: Row, runtime: bool) -> Vec<(i32, i32)> {
        let towers = self.city_towers(city);
        let mut sectors = SECTORS;
        sectors.sort_by_key(|(dx, dy)| {
            towers.iter().any(|id| {
                let t = self.rows[id];
                ((t.x as f64) < city.x as f64 + 0.5) == (*dx < 0)
                    && ((t.y as f64) < city.y as f64 + 0.5) == (*dy < 0)
            })
        });
        let mut result = Vec::with_capacity(400);
        for (mut dx, mut dy) in sectors {
            if runtime {
                // New towns have smaller claims than founding capitals.
                dx -= dx.signum();
                dy -= dy.signum();
            }
            let mut points = Vec::new();
            for y in city.y - 9..=city.y + 10 {
                for x in city.x - 9..=city.x + 10 {
                    if ((x as f64) < city.x as f64 + 0.5) != (dx < 0)
                        || ((y as f64) < city.y as f64 + 0.5) != (dy < 0)
                        || (x - city.x).abs().max((y - city.y).abs()) < 3
                    {
                        continue;
                    }
                    points.push((x, y));
                }
            }
            points
                .sort_by_key(|&(x, y)| ((x - city.x - dx).pow(2) + (y - city.y - dy).pow(2), y, x));
            result.extend(points);
        }
        result
    }
    fn clear(&self, city: Row, x: i32, y: i32, reachable: &[bool], runtime: bool) -> bool {
        let Some(cell) = self.cell(x, y) else {
            return false;
        };
        let terrain_mask = if runtime { 9 } else { 5 };
        if self.occupied[cell] != 0
            || self.terrain[cell] & terrain_mask != terrain_mask
            || self.owner(city.faction, x, y) != Some(city.id)
        {
            return false;
        }
        if !self.connected_ring(city, x, y, reachable, DEFENSE_REACH) {
            return false;
        }
        for dy in -3..=3 {
            for dx in -3..=3 {
                if self
                    .cell(x + dx, y + dy)
                    .is_some_and(|i| self.towers.contains_key(&i))
                {
                    return false;
                }
            }
        }
        true
    }
    /// Removing the site must leave its usable neighbors connected. Cardinal
    /// detours also replace diagonal steps whose corner would become solid.
    /// Reserved buildings already count as solid, so successive wall orders
    /// cannot jointly seal an approach.
    fn wall_preserves_routes(&self, x: i32, y: i32) -> bool {
        let mut neighbors = 0_u64;
        const RADIUS: i32 = 3;
        const SIDE: i32 = RADIUS * 2 + 1;
        let bit = |dx: i32, dy: i32| 1_u64 << ((dy + RADIUS) * SIDE + dx + RADIUS);
        for (dx, dy) in DIRS {
            let (nx, ny) = (x + dx, y + dy);
            if self.walk(nx, ny)
                && (self.edge(x, y, nx, ny) || self.edge(nx, ny, x, y))
                && (dx == 0 || dy == 0 || self.walk(x + dx, y) && self.walk(x, y + dy))
            {
                neighbors |= bit(dx, dy);
            }
        }
        if neighbors.count_ones() < 2 {
            return false;
        }

        let start = neighbors.trailing_zeros() as i32;
        let mut seen = 1_u64 << start;
        let mut queue = [(0, 0); (SIDE * SIDE) as usize];
        queue[0] = (start % SIDE - RADIUS, start / SIDE - RADIUS);
        let (mut head, mut tail) = (0, 1);
        while head < tail && neighbors & !seen != 0 {
            let (dx, dy) = queue[head];
            head += 1;
            for (sx, sy) in CARDINAL {
                let (nx, ny) = (dx + sx, dy + sy);
                if nx.abs().max(ny.abs()) > RADIUS || (nx, ny) == (0, 0) {
                    continue;
                }
                let next = bit(nx, ny);
                if seen & next == 0 && self.walk(x + nx, y + ny)
                    && self.edge(x + dx, y + dy, x + nx, y + ny)
                    && self.edge(x + nx, y + ny, x + dx, y + dy)
                {
                    seen |= next;
                    queue[tail] = (nx, ny);
                    tail += 1;
                }
            }
        }
        neighbors & !seen == 0
    }

    fn next_wall(&self, city: Row, towers: &[i64], attacked: Option<Row>, allowed: u32,
        rejected: &BTreeMap<(i32, i32), f64>, reachable: &[bool]) -> Option<(u32, i32, i32)> {
        let owned = |x, y| {
            self.cell(x, y).and_then(|cell| self.walls.get(&cell))
                .filter(|ids| ids.iter().any(|id| self.rows[id].faction == city.faction))
        };
        let mut wall_count = 0;
        for dy in -WALL_RADIUS..=WALL_RADIUS + 1 {
            for dx in -WALL_RADIUS..=WALL_RADIUS + 1 {
                let (x, y) = (city.x + dx, city.y + dy);
                if owned(x, y).is_some() && self.owner(city.faction, x, y) == Some(city.id) {
                    wall_count += 1;
                }
            }
        }
        let mut candidates = Vec::new();
        for (sx, sy) in CARDINAL {
            let (cx, cy) = (city.x + i32::from(sx > 0), city.y + i32::from(sy > 0));
            let facing = attacked.map_or(0, |hit| (hit.x - city.x) * sx + (hit.y - city.y) * sy);
            for depth in [5, 6, 7] {
                for offset in -3_i32..=4 {
                    let (x, y) = (cx + sx * depth + sy * offset, cy + sy * depth + sx * offset);
                    let Some(cell) = self.cell(x, y) else { continue };
                    if rejected.contains_key(&(x, y)) {
                        continue;
                    }
                    let upgrade = owned(x, y).is_some_and(|ids| {
                        ids.iter().any(|id| {
                            let wall = self.rows[id];
                            wall.kind == b::PALISADE && wall.faction == city.faction && wall.flags & 2 != 0
                        }) && ids.iter().all(|id| self.rows[id].kind != b::WALL)
                    });
                    let kind = if upgrade {
                        if allowed & WALL_ORDER == 0 { continue; }
                        b::WALL
                    } else {
                        if wall_count >= CITY_WALLS || self.occupied[cell] != 0 || self.terrain[cell] & 9 != 9
                            || !Self::local_cell(city, x, y, DEFENSE_REACH).is_some_and(|at| reachable[at])
                        {
                            continue;
                        }
                        if allowed & WALL_ORDER != 0 { b::WALL } else { b::PALISADE }
                    };
                    if self.owner(city.faction, x, y) != Some(city.id) {
                        continue;
                    }
                    let connects = owned(x + sy, y + sx).is_some() || owned(x - sy, y - sx).is_some();
                    let tower_distance = towers.iter().map(|id| {
                        let tower = self.rows[id];
                        (tower.x - x).pow(2) + (tower.y - y).pow(2)
                    }).min().unwrap_or(0);
                    candidates.push((!upgrade, !connects, -facing, tower_distance, depth != 6,
                        (2 * offset - 1).abs(), y, x, kind));
                }
            }
        }
        candidates.sort_unstable();
        candidates.into_iter().find_map(|(new, _, _, _, _, _, y, x, kind)| {
            (!new || self.wall_preserves_routes(x, y)).then_some((kind, x, y))
        })
    }

    pub fn plan_order(&mut self, id: i64, now: f64, population: f64, allowed: u32, fortify: bool) -> *const f64 {
        let Some(city) = self.rows.get(&id).copied().filter(|row| row.kind == b::PALACE && row.flags == 3) else {
            self.output.clear();
            self.output.resize(4, 0.0);
            return self.output.as_ptr();
        };
        let towers = self.city_towers(city);
        let revision = self.city_revision(city, false);
        let mut plan = self.plans.remove(&id).unwrap_or_default();
        let tower = (allowed & TOWER_ORDER != 0 && towers.len() < CITY_TOWERS)
            .then(|| self.next_tower(city, now, 64, true, &mut plan)).flatten()
            .map(|(x, y)| (b::WOODEN_TOWER, x, y));
        let order = tower.or_else(|| {
            if !fortify || allowed & (WALL_ORDER | PALISADE_ORDER) == 0 {
                return None;
            }
            let attacked = self.attack(city.faction, now).filter(|hit| self.owner(city.faction, hit.x, hit.y) == Some(city.id));
            // Give new settlements time to establish their food and housing.
            if attacked.is_none() && (now < 90.0 || population < 14.0) {
                return None;
            }
            if plan.reachable.is_empty() || plan.revision != revision {
                plan.reachable = self.flood(city, DEFENSE_REACH);
                plan.revision = revision;
            }
            plan.rejected_walls.retain(|_, retry| now < *retry);
            self.next_wall(city, &towers, attacked, allowed, &plan.rejected_walls, &plan.reachable)
        });
        self.plans.insert(id, plan);
        self.output.clear();
        self.output.resize(4, 0.0);
        if let Some((kind, x, y)) = order {
            self.output[..3].copy_from_slice(&[kind as f64, x as f64, y as f64]);
        }
        self.output.as_ptr()
    }

    pub fn reject_order(&mut self, id: i64, kind: u32, x: i32, y: i32, now: f64) {
        if kind == b::WOODEN_TOWER {
            self.rejected(id);
        } else if let Some(plan) = self.plans.get_mut(&id) {
            plan.rejected_walls.insert((x, y), now + 24.0);
        }
    }

    // An open ring stays connected after the center turns solid.
    fn connected_ring(&self, city: Row, x: i32, y: i32, reachable: &[bool], radius: i32) -> bool {
        for (index, &(dx, dy)) in RING.iter().enumerate() {
            let (nx, ny) = (x + dx, y + dy);
            let (next_x, next_y) = (x + RING[(index + 1) % 8].0, y + RING[(index + 1) % 8].1);
            if !self.walk(nx, ny) || !self.edge(nx, ny, next_x, next_y) {
                return false;
            }
            if !Self::local_cell(city, nx, ny, radius).is_some_and(|local| reachable[local]) {
                return false;
            }
        }
        true
    }
    /// One reachable lookout per quadrant, as close as possible to the
    /// diagonal ten-tile ring. Reuse the indexed footprint and terrain layers.
    pub fn scout_sites(&mut self, id: i64, blocked: usize) -> *const f64 {
        self.output.clear();
        self.output.push(0.0);
        if let Some(city) = self.rows.get(&id).copied().filter(|row| row.kind == b::PALACE) {
            let reachable = self.flood(city, SCOUT_SEARCH_RADIUS);
            let blocked: FxHashSet<usize> = self.input.iter().take(blocked).map(|&cell| cell as usize).collect();
            let mut candidates = Vec::new();
            for dy in 1 - SCOUT_SEARCH_RADIUS..=SCOUT_SEARCH_RADIUS {
                for dx in 1 - SCOUT_SEARCH_RADIUS..=SCOUT_SEARCH_RADIUS {
                    // Doubled tile-center displacement from a 2×2 palace.
                    let (rx, ry) = (2 * dx - 1, 2 * dy - 1);
                    let distance = rx * rx + ry * ry;
                    if !(4 * 6 * 6..=4 * 17 * 17).contains(&distance) {
                        continue;
                    }
                    let (x, y) = (city.x + dx, city.y + dy);
                    let Some(cell) = self.cell(x, y) else { continue };
                    if self.occupied[cell] != 0 || self.terrain[cell] & 9 != 9
                        || blocked.contains(&cell)
                        || !self.connected_ring(city, x, y, &reachable, SCOUT_SEARCH_RADIUS)
                    {
                        continue;
                    }
                    let score = (distance - 400).abs() + 4 * (rx.abs() - ry.abs()).abs();
                    let quadrant = usize::from(dx > 0) + 2 * usize::from(dy > 0);
                    let preferred = (4 * 7 * 7..=4 * 12 * 12).contains(&distance);
                    candidates.push((score, y, x, quadrant, preferred));
                }
            }
            let spaced = |sites: &[(i32, i32)], x: i32, y: i32| {
                sites.iter().all(|&(sx, sy)| (sx - x).pow(2) + (sy - y).pow(2) >= 16)
            };
            let mut sites = Vec::with_capacity(4);
            let mut placed = [false; 4];
            candidates.sort_unstable();
            for &(_, y, x, quadrant, preferred) in &candidates {
                if preferred && !placed[quadrant] && spaced(&sites, x, y) {
                    sites.push((x, y));
                    placed[quadrant] = true;
                }
            }
            if sites.len() < 3 {
                for (_, y, x, _, _) in candidates {
                    if spaced(&sites, x, y) {
                        sites.push((x, y));
                        if sites.len() == 3 {
                            break;
                        }
                    }
                }
            }
            for (x, y) in sites {
                self.output.extend([x as f64, y as f64]);
            }
        }
        self.output[0] = ((self.output.len() - 1) / 2) as f64;
        self.output.as_ptr()
    }
    /// A rejected authoritative order can be transient (a walking worker).
    /// Retry it after a cooldown; pure geometry failures stay cached until edits.
    pub fn rejected(&mut self, id: i64) {
        if let Some(plan) = self.plans.get_mut(&id) {
            plan.host_rejected = true;
        }
    }
    pub fn next(&mut self, id: i64, now: f64, budget: usize) -> *const f64 {
        self.output.clear();
        self.output.resize(4, 0.0);
        let Some(city) = self.rows.get(&id).copied() else {
            return self.output.as_ptr();
        };
        if city.kind != b::PALACE || city.flags & 1 == 0 {
            return self.output.as_ptr();
        }
        let mut plan = self.plans.remove(&id).unwrap_or_default();
        if let Some((x, y)) = self.next_tower(city, now, budget, false, &mut plan) {
            self.output[..3].copy_from_slice(&[1.0, x as f64, y as f64]);
        }
        self.plans.insert(id, plan);
        self.output.as_ptr()
    }
    fn next_tower(&mut self, city: Row, now: f64, budget: usize, runtime: bool, plan: &mut CityPlan) -> Option<(i32, i32)> {
        let revision = self.city_revision(city, false);
        let layout_revision = self.city_revision(city, true);
        if plan.candidates.is_empty()
            || plan.runtime != runtime
            || plan.layout_revision != layout_revision
            || plan.cursor >= plan.candidates.len()
                && (plan.exhausted_revision != revision
                    || plan.host_rejected && now >= plan.retry_at)
        {
            plan.candidates = self.candidates(city, runtime);
            plan.runtime = runtime;
            plan.layout_revision = layout_revision;
            plan.cursor = 0;
            plan.host_rejected = false;
            plan.reachable.clear();
        }
        let mut selected = None;
        if plan.cursor < plan.candidates.len() {
            if plan.reachable.is_empty() || plan.revision != revision {
                plan.reachable = self.flood(city, DEFENSE_REACH);
                plan.revision = revision;
            }
            for _ in 0..budget.min(400) {
                let Some(&(x, y)) = plan.candidates.get(plan.cursor) else {
                    break;
                };
                plan.cursor += 1;
                if !runtime { self.output[3] += 1.0; }
                if self.clear(city, x, y, &plan.reachable, runtime) {
                    selected = Some((x, y));
                    break;
                }
            }
            if plan.cursor >= plan.candidates.len() {
                plan.exhausted_revision = revision;
                plan.retry_at = now + 30.0;
            }
        }
        selected
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn plain() -> DefensePlacement {
        let mut p = DefensePlacement::default();
        p.input(48 * 48 * 2);
        for r in p.input.chunks_exact_mut(2) {
            r[0] = 13.0;
            r[1] = 255.0;
        }
        p.geometry(48, 48);
        p.site(1, 1, b::PALACE, 20, 20, 3, f64::NEG_INFINITY);
        p
    }
    #[test]
    fn standalone_tower_keeps_ring_and_bounded_cursor() {
        let mut p = plain();
        p.next(1, 0.0, 1);
        assert_eq!(p.output[3], 1.0);
        assert_eq!(p.output[0], 1.0);
        let (x, y) = (p.output[1] as i32, p.output[2] as i32);
        p.site(2, 1, b::WOODEN_TOWER, x, y, 1, f64::NEG_INFINITY);
        assert_eq!(p.city_towers(p.rows[&1]), vec![2]);
        p.next(1, 1.0, 400);
        assert_eq!(p.output[0], 1.0);
        assert!(
            (p.output[1] as i32 - x)
                .abs()
                .max((p.output[2] as i32 - y).abs())
                >= 4
        );
    }
    #[test]
    fn rejects_chokes_without_building_temporary_worlds() {
        let mut p = plain();
        for y in 0..48 {
            for x in 0..48 {
                p.terrain[y * 48 + x] = if y == 20 { 5 } else { 0 };
            }
        }
        p.revision += 1;
        p.terrain_revision = p.revision;
        p.next(1, 0.0, 400);
        assert_eq!(p.output[0], 0.0);
        p.next(1, 1.0, 400);
        assert_eq!(p.output[3], 0.0);
    }
    #[test]
    fn geometry_revision_reopens_exhausted_city() {
        let mut p = plain();
        p.terrain.fill(0);
        p.revision += 1;
        p.terrain_revision = p.revision;
        p.next(1, 0.0, 400);
        assert_eq!(p.output[0], 0.0);
        p.terrain.fill(5);
        p.revision += 1;
        p.terrain_revision = p.revision;
        p.next(1, 1.0, 400);
        assert_eq!(p.output[0], 1.0);
    }
    #[test]
    fn overdue_factions_are_fair_even_above_cadence_capacity() {
        let mut p = plain();
        let mut admitted = Vec::new();
        for step in 0..30 {
            for faction in 1..=20 {
                if p.due(faction, 1000.0 + step as f64 * 0.34, 4.0) {
                    admitted.push(faction);
                }
            }
        }
        assert_eq!(&admitted[..20], &(1..=20).collect::<Vec<_>>());
    }
    #[test]
    fn distant_edits_preserve_local_search_revision() {
        let mut p = plain();
        p.site(1, 1, b::PALACE, 8, 8, 3, f64::NEG_INFINITY);
        let local = p.city_revision(p.rows[&1], false);
        p.site(9, 2, b::HOUSE, 47, 47, 1, f64::NEG_INFINITY);
        assert_eq!(local, p.city_revision(p.rows[&1], false));
        p.site(10, 1, b::HOUSE, 10, 11, 1, f64::NEG_INFINITY);
        assert!(local < p.city_revision(p.rows[&1], false));
    }
    #[test]
    fn owner_changes_and_removal_update_index() {
        let mut p = plain();
        p.site(2, 1, b::WOODEN_TOWER, 16, 16, 1, f64::NEG_INFINITY);
        assert_eq!(p.city_towers(p.rows[&1]), vec![2]);
        p.site(2, 2, b::WOODEN_TOWER, 16, 16, 1, f64::NEG_INFINITY);
        assert!(p.city_towers(p.rows[&1]).is_empty());
        p.site(2, 2, b::WOODEN_TOWER, 16, 16, 0, f64::NEG_INFINITY);
        assert!(!p.towers.values().any(|ids| ids.contains(&2)));
    }

    #[test]
    fn reserved_walls_leave_civilian_escape_route() {
        let mut p = plain();
        assert!(p.wall_preserves_routes(24, 20));
        for y in 17..=23 {
            if y != 20 {
                p.site(y as i64, 1, b::PALISADE, 24, y, 1, f64::NEG_INFINITY);
            }
        }
        assert!(!p.wall_preserves_routes(24, 20));
    }
}
