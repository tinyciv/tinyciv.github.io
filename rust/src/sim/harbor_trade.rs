//! Neutral harbor commerce. One shared, incremental water search per village
//! dock finds the nearest reachable dock of each realm, without a range cap.
//! The host supplies geometry/relations and applies delivery events; all
//! route selection, movement, voyage clocks and gold amounts live here.
use bevy_ecs::prelude::*;
use std::collections::{BTreeMap, BTreeSet, VecDeque};

const SPEED: f64 = 1.6;
const TURN_SPEED: f64 = 0.65;
const PORT_WAIT: f64 = 12.0;
const GOLD_PER_TILE: f64 = 0.05;
const SEARCH_BUDGET: usize = 2048;
type Key = (i64, i32); // village, recipient faction

#[derive(Clone, Debug, PartialEq, Eq)]
struct Dock { id: i64, faction: i32, village: i64, cell: usize }
#[derive(Clone, Debug)]
struct Voyage {
    source: i64, target: i64, path: Vec<usize>, position: f64,
    returning: bool, ready_at: f64, facing: f64,
    pushed: Option<(f64, f64)>,
}
struct Search {
    source: Dock, queue: Vec<usize>, head: usize, previous: Vec<usize>,
    found: BTreeSet<i32>, wanted: BTreeSet<i32>, targets: BTreeMap<usize, Vec<Dock>>,
}

#[derive(Resource, Default)]
pub struct HarborTrade {
    input: Vec<f64>, output: Vec<f64>, width: usize, edges: Vec<u8>,
    docks: Vec<Dock>, relations: BTreeMap<Key, (bool, bool)>,
    voyages: BTreeMap<Key, Voyage>, pending: VecDeque<i64>, search: Option<Search>,
    search_previous: Vec<usize>, search_queue: Vec<usize>,
    buffs: BTreeMap<i32,f64>, next_sync: f64, initialized: bool, geometry_changed: bool,
}

impl HarborTrade {
    pub fn prepare(&mut self, len: usize) -> *mut f64 {
        self.input.resize(len, 0.0); self.input.as_mut_ptr()
    }
    pub fn sync_due(&self, now: f64) -> bool { !self.initialized || now >= self.next_sync }
    /// Modes: 0 water edge masks; 1 dock rows [id,faction,village,cell];
    /// 2 relation rows [village,faction,peace,trading], ending a 1 Hz sync.
    pub fn commit(&mut self, mode: u32, len: usize, width: usize, now: f64) {
        let data = &self.input[..len.min(self.input.len())];
        match mode {
            0 => {
                let edges: Vec<u8> = data.iter().map(|v| *v as u8).collect();
                self.geometry_changed |= self.width != width || self.edges != edges;
                self.width = width; self.edges = edges;
            }
            1 => {
                let docks: Vec<Dock> = data.chunks_exact(4).filter(|r| r[3] >= 0.0 && (r[3] as usize) < self.edges.len())
                    .map(|r| Dock { id: r[0] as i64, faction: r[1] as i32, village: r[2] as i64, cell: r[3] as usize }).collect();
                self.geometry_changed |= self.docks != docks;
                self.docks = docks;
            }
            2 => {
                let relations: BTreeMap<Key, (bool, bool)> = data.chunks_exact(4)
                    .map(|r| ((r[0] as i64, r[1] as i32), (r[2] != 0.0, r[3] != 0.0))).collect();
                let peace_changed = self.relations.keys().ne(relations.keys()) || self.relations.iter()
                    .any(|(k, v)| relations.get(k).is_none_or(|other| other.0 != v.0));
                self.relations = relations;
                if self.geometry_changed || peace_changed || !self.initialized {
                    // Retain valid in-flight voyages and their elapsed progress
                    // through a load, construction or diplomacy refresh.
                    let docks = &self.docks; let edges = &self.edges; let width = self.width;
                    let relations = &self.relations;
                    self.voyages.retain(|&(village, faction), voyage| {
                        relations.get(&(village, faction)).is_some_and(|r| r.0)
                            && docks.iter().any(|d| d.id == voyage.source && d.village == village && voyage.path.first() == Some(&d.cell))
                            && docks.iter().any(|d| d.id == voyage.target && d.faction == faction && d.village < 0 && voyage.path.last() == Some(&d.cell))
                            && voyage.path.windows(2).all(|p| edge_clear(edges, width, p[0], p[1]))
                    });
                    self.pending = self.docks.iter().filter(|d| d.village >= 0).map(|d| d.id).collect::<BTreeSet<_>>().into_iter().collect();
                    self.finish_search();
                }
                self.geometry_changed = false; self.initialized = true; self.next_sync = now + 1.0;
            }
            3 => { self.buffs = data.chunks_exact(2).map(|r|(r[0]as i32,r[1])).collect(); }
            _ => {}
        }
    }

    fn finish_search(&mut self) {
        if let Some(search) = self.search.take() {
            self.search_previous = search.previous; self.search_queue = search.queue;
        }
    }

    fn begin_search(&mut self) -> bool {
        while let Some(id) = self.pending.pop_front() {
            let Some(source) = self.docks.iter().find(|d| d.id == id).cloned() else { continue; };
            let mut targets: BTreeMap<usize, Vec<Dock>> = BTreeMap::new();
            let found: BTreeSet<i32> = self.voyages.keys().filter(|k| k.0 == source.village).map(|k| k.1).collect();
            let mut wanted = BTreeSet::new();
            for dock in self.docks.iter().filter(|d| d.village < 0 && !found.contains(&d.faction) && self.relations.get(&(source.village, d.faction)).is_some_and(|r| r.0)) {
                wanted.insert(dock.faction);
                targets.entry(dock.cell).or_default().push(dock.clone());
            }
            if targets.is_empty() { continue; }
            // Reuse one flood buffer. Reset only cells visited by the previous
            // source instead of clearing the entire ocean for every village.
            let mut previous = std::mem::take(&mut self.search_previous);
            let mut queue = std::mem::take(&mut self.search_queue);
            for &cell in &queue { if let Some(value) = previous.get_mut(cell) { *value = usize::MAX; } }
            previous.resize(self.edges.len(), usize::MAX); queue.clear();
            for dock in self.docks.iter().filter(|d| d.id == id && self.edges[d.cell] != 0) {
                if previous[dock.cell] != usize::MAX { continue; }
                previous[dock.cell] = dock.cell; queue.push(dock.cell);
            }
            self.search = Some(Search { source, queue, head: 0, previous, found, wanted, targets });
            return true;
        }
        false
    }
    fn plan(&mut self, now: f64) {
        let mut budget = SEARCH_BUDGET;
        while budget > 0 {
            if self.search.is_none() && !self.begin_search() { break; }
            let search = self.search.as_mut().unwrap();
            let Some(&cell) = search.queue.get(search.head) else { self.finish_search(); continue; };
            search.head += 1;
            budget -= 1;
            if let Some(targets) = search.targets.get(&cell) {
                for target in targets {
                    if !search.found.insert(target.faction) { continue; }
                    let mut path = vec![cell]; let mut step = cell;
                    while search.previous[step] != step { step = search.previous[step]; path.push(step); }
                    path.reverse();
                    let (x, y) = point(path[0], self.width);
                    let (nx, ny) = point(path[1.min(path.len() - 1)], self.width);
                    self.voyages.insert((search.source.village, target.faction), Voyage {
                        source: search.source.id, target: target.id, path, position: 0.0, returning: false,
                        ready_at: now, facing: (ny - y).atan2(nx - x), pushed: None,
                    });
                    search.wanted.remove(&target.faction);
                }
            }
            if search.wanted.is_empty() { self.finish_search(); continue; }
            for side in 0..4 {
                if self.edges[cell] & (1 << side) == 0 { continue; }
                let Some(next) = neighbor(cell, side, self.width, self.edges.len()) else { continue; };
                if search.previous[next] != usize::MAX { continue; }
                search.previous[next] = cell; search.queue.push(next);
            }
        }
    }

    /// Output header [ships,receipts], ships [village,faction,source,target,x,y,
    /// facing,moving,returning], receipts [faction,target,gold,village].
    pub fn step(&mut self, now: f64, dt: f64) -> *const f64 {
        self.plan(now);
        let mut receipts = Vec::new();
        self.output.clear(); self.output.extend_from_slice(&[0.0, 0.0]);
        let width = self.width;
        for (&key, voyage) in &mut self.voyages {
            let Some(&(peace, trading)) = self.relations.get(&key) else { continue; };
            if !peace || voyage.path.is_empty() { continue; }
            // Each cardinal water-path edge is one sailed tile. This includes
            // island detours, costs O(1), and survives save/load with the path.
            let end = (voyage.path.len() - 1) as f64;
            let mut elapsed = dt.max(0.0); let mut at = now - elapsed;
            let top = super::fisheries::speed(*self.buffs.get(&key.1).unwrap_or(&0.0), now, SPEED);
            let before = voyage.position;
            let pushed_before = voyage.pushed;
            let facing_before = voyage.facing;
            if let Some((x, y)) = voyage.pushed {
                let (tx, ty) = voyage_point(voyage, width);
                let step = steer((x, y), (tx, ty), voyage.facing, elapsed, top);
                voyage.facing = step.facing;
                if water_segment_clear(&self.edges, width, (x, y), step.point) {
                    voyage.pushed = if step.arrived { None } else { Some(step.point) };
                    at += elapsed - step.remaining; elapsed = step.remaining;
                }
                if voyage.pushed.is_some() { elapsed = 0.0; }
            }
            // Consume turns, forward travel and port waits chronologically.
            // Work scales with crossed waypoints, without per-frame path searches.
            while elapsed > 1e-9 {
                if at < voyage.ready_at {
                    let wait = (voyage.ready_at - at).min(elapsed); at += wait; elapsed -= wait;
                    if elapsed <= 1e-9 { break; }
                }
                let goal = if voyage.returning { 0.0 } else { end };
                if (goal - voyage.position).abs() > 1e-9 {
                    let next = if voyage.returning { (voyage.position.ceil() - 1.0).max(0.0) }
                        else { (voyage.position.floor() + 1.0).min(end) };
                    let target = point(voyage.path[next as usize], width);
                    let step = steer(voyage_point(voyage, width), target, voyage.facing, elapsed, top);
                    voyage.facing = step.facing;
                    at += elapsed - step.remaining; elapsed = step.remaining;
                    voyage.position = if step.arrived { next } else {
                        voyage.position + if voyage.returning { -step.travelled } else { step.travelled }
                    };
                    if !step.arrived { break; }
                    if (goal - voyage.position).abs() > 1e-9 { continue; }
                }
                if !voyage.returning && end > 0.0 { receipts.extend_from_slice(&[key.1 as f64, voyage.target as f64,
                    end * GOLD_PER_TILE * if trading { 8.0 } else { 1.0 }, key.0 as f64]); }
                voyage.returning = !voyage.returning; voyage.ready_at = at + PORT_WAIT;
            }
            let (x, y) = voyage.pushed.unwrap_or_else(|| voyage_point(voyage, width));
            self.output.extend_from_slice(&[key.0 as f64, key.1 as f64, voyage.source as f64, voyage.target as f64,
                x, y, voyage.facing, (before != voyage.position || pushed_before != voyage.pushed
                    || facing_before != voyage.facing) as u8 as f64, voyage.returning as u8 as f64]);
            self.output[0] += 1.0;
        }
        self.output[1] = (receipts.len() / 4) as f64; self.output.extend(receipts);
        self.output.as_ptr()
    }

    pub fn snapshot(&self) -> Vec<f64> {
        let mut out = vec![self.voyages.len() as f64];
        for (&(village, faction), v) in &self.voyages {
            out.extend_from_slice(&[village as f64, faction as f64, v.source as f64, v.target as f64,
                v.position, v.returning as u8 as f64, v.ready_at, v.path.len() as f64,
                v.pushed.is_some() as u8 as f64, v.pushed.map_or(0.0, |p| p.0), v.pushed.map_or(0.0, |p| p.1), v.facing]);
            out.extend(v.path.iter().map(|c| *c as f64));
        }
        out
    }
    pub fn restore(data: &[f64]) -> Option<Self> {
        if data.is_empty() || data.iter().any(|v| !v.is_finite()) { return None; }
        let mut state = Self::default(); let mut cursor = 1;
        for _ in 0..data[0] as usize {
            let row = data.get(cursor..cursor + 12)?; cursor += 12;
            let count = row[7] as usize;
            if count == 0 || row[4] < 0.0 || row[4] > (count - 1) as f64 { return None; }
            let path = data.get(cursor..cursor.checked_add(count)?)?;
            if path.iter().any(|c| *c < 0.0 || c.fract() != 0.0) { return None; }
            state.voyages.insert((row[0] as i64, row[1] as i32), Voyage { source: row[2] as i64, target: row[3] as i64,
                position: row[4], returning: row[5] != 0.0, ready_at: row[6], path: path.iter().map(|c| *c as usize).collect(),
                pushed: (row[8] != 0.0).then_some((row[9], row[10])), facing: row[11] });
            cursor += count;
        }
        (cursor == data.len()).then_some(state)
    }
    pub fn push(&mut self, village: i64, faction: i32, x: f64, y: f64) {
        if let Some(voyage) = self.voyages.get_mut(&(village, faction)) { voyage.pushed = Some((x, y)); }
    }

    /// River merchants use the same native steering as harbor vessels.
    pub fn steer_merchant(&mut self, x: f64, y: f64, facing: f64, tx: f64, ty: f64, dt: f64, top: f64) -> *const f64 {
        let step = steer((x, y), (tx, ty), facing, dt.max(0.0), top);
        self.output.clear();
        self.output.extend_from_slice(&[step.point.0, step.point.1, step.facing,
            (step.travelled > 0.0 || step.facing != facing) as u8 as f64]);
        self.output.as_ptr()
    }
}

struct SteeringStep { point: (f64, f64), facing: f64, travelled: f64, remaining: f64, arrived: bool }

/// Turn in place, then sail along the bow. A corner or reversal consumes real
/// simulated time; no sideways displacement or instantaneous heading change.
fn steer(from: (f64, f64), to: (f64, f64), facing: f64, dt: f64, top: f64) -> SteeringStep {
    let (dx, dy) = (to.0 - from.0, to.1 - from.1);
    let gap = dx.hypot(dy);
    if gap < 1e-9 {
        return SteeringStep { point: from, facing, travelled: 0.0, remaining: dt, arrived: true };
    }
    let desired = dy.atan2(dx);
    let change = (desired - facing).sin().atan2((desired - facing).cos());
    let turn_time = change.abs() / TURN_SPEED;
    if dt < turn_time {
        let heading = facing + change.signum() * TURN_SPEED * dt;
        return SteeringStep { point: from, facing: heading.sin().atan2(heading.cos()),
            travelled: 0.0, remaining: 0.0, arrived: false };
    }
    let available = dt - turn_time;
    let travelled = gap.min(top * available);
    let arrived = travelled >= gap;
    let point = if arrived { to } else { (from.0 + desired.cos() * travelled, from.1 + desired.sin() * travelled) };
    SteeringStep { point, facing: desired, travelled, remaining: (available - travelled / top).max(0.0), arrived }
}

fn voyage_point(v: &Voyage, width: usize) -> (f64, f64) {
    let index = (v.position.floor() as usize).min(v.path.len() - 1);
    let (x, y) = point(v.path[index], width);
    let (nx, ny) = point(v.path[(index + 1).min(v.path.len() - 1)], width);
    let amount = v.position - index as f64;
    (x + (nx - x) * amount, y + (ny - y) * amount)
}
fn water_segment_clear(edges: &[u8], width: usize, from: (f64, f64), to: (f64, f64)) -> bool {
    let steps = ((to.0 - from.0).hypot(to.1 - from.1) / 0.1).ceil().max(1.0) as usize;
    (0..=steps).all(|step| {
        let (x, y) = (from.0 + (to.0 - from.0) * step as f64 / steps as f64, from.1 + (to.1 - from.1) * step as f64 / steps as f64);
        [(-0.3, -0.3), (0.3, -0.3), (-0.3, 0.3), (0.3, 0.3)].iter().all(|(dx, dy)| {
            let (cx, cy) = ((x + dx).floor() as i32, (y + dy).floor() as i32);
            cx >= 0 && cy >= 0 && (cx as usize) < width && edges.get(cy as usize * width + cx as usize).is_some_and(|e| *e != 0)
        })
    })
}

fn point(cell: usize, width: usize) -> (f64, f64) { ((cell % width) as f64 + 0.5, (cell / width) as f64 + 0.5) }
fn neighbor(cell: usize, side: usize, width: usize, len: usize) -> Option<usize> {
    if width == 0 { return None; }
    match side {
        0 => cell.checked_sub(width),
        1 => (cell % width + 1 < width && cell + 1 < len).then_some(cell + 1),
        2 => (cell + width < len).then_some(cell + width),
        _ => (cell % width > 0).then(|| cell - 1),
    }
}
fn edge_clear(edges: &[u8], width: usize, a: usize, b: usize) -> bool {
    a < edges.len() && b < edges.len() && (0..4).any(|side| edges[a] & (1 << side) != 0 && neighbor(a, side, width, edges.len()) == Some(b))
}
