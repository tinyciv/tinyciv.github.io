//! Resident movement geometry and dynamic occupancy. Position/policy changes
//! publish explicit actor events; queries never rebuild an all-world cell map.
use bevy_ecs::prelude::*;
use fixedbitset::FixedBitSet;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

const ENGINEER: u32 = 1;
const LEVY_ASSEMBLING: u32 = 2;
const WALL_PATROL: u32 = 4;
const INSIDE: u32 = 8;
const HUMAN_CONTROLLED: u32 = 16;
const VESSEL_OR_PASSENGER: u32 = 32;
const DIRECTIONS: [(i32, i32); 8] = [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)];

// Kind codes: other/wildlife=0, worker=1, scout=2, merchant=3, supplyCart=4,
// leader=5, militia=6, warrior=7, swordsman=8, spearman=9, archer=10,
// horseman=11, horseArcher=12, knight=13, levyInfantry=14, slinger=15,
// skirmisher=16, marshBird=17. The host only encodes enum names; rules live here.
fn military(kind: u32) -> bool { (5..=16).contains(&kind) || kind == 18 }
fn same_faction(a: f64, b: f64) -> bool { a == b || a.is_nan() && b.is_nan() }
pub fn civilian(kind: u32, flags: u32) -> bool { flags & ENGINEER == 0 && (1..=4).contains(&kind) }
pub fn collision_radius(kind: u32) -> f64 {
    match kind { 1 => 0.14, 2 | 17 => 0.18, 3 | 4 => 0.22, _ => 0.5 }
}

pub fn collides(a_kind: u32, a_faction: f64, a_flags: u32, a_drill: f64,
    b_kind: u32, b_faction: f64, b_flags: u32, b_drill: f64) -> bool {
    if (a_flags | b_flags) & WALL_PATROL != 0 { return false; }
    let friendly = same_faction(a_faction, b_faction);
    if friendly && (a_flags | b_flags) & LEVY_ASSEMBLING != 0 { return false; }
    if (a_flags | b_flags) & ENGINEER != 0 {
        if friendly && (a_kind == 5 || b_kind == 5) { return false; }
        return military(a_kind) || military(b_kind) || a_flags & ENGINEER != 0 && b_flags & ENGINEER != 0;
    }
    if a_kind == 14 || a_kind == 15 || b_kind == 14 || b_kind == 15 {
        return !civilian(a_kind, a_flags) && !civilian(b_kind, b_flags);
    }
    if !a_drill.is_nan() && a_drill == b_drill && friendly { return false; }
    (military(a_kind) || military(b_kind)) && !civilian(a_kind, a_flags) && !civilian(b_kind, b_flags)
}

pub fn obstructs(a_id: i64, a_kind: u32, a_faction: f64, a_flags: u32, a_drill: f64,
    b_id: i64, b_kind: u32, b_faction: f64, b_flags: u32, b_drill: f64, b_hp: f64) -> bool {
    b_id != a_id && b_hp > 0.0 && b_flags & INSIDE == 0
        && !(a_kind == 5 && (a_faction == 0.0 || a_flags & HUMAN_CONTROLLED != 0) && same_faction(a_faction, b_faction))
        && collides(a_kind, a_faction, a_flags, a_drill, b_kind, b_faction, b_flags, b_drill)
}

#[derive(Component, Clone, Copy)]
struct Actor {
    id: i64, x: f64, y: f64, kind: u32, faction: f64, hp: f64, flags: u32, drill: f64,
    order: i64, bucket_order: f64, priority_epoch: u64, indexed_cell: Option<i64>, overlay: bool,
}

struct Geometry {
    width: i32, height: i32, open: Vec<u8>, edges: Vec<u8>, costs: Vec<f64>, trace: Vec<f64>,
}
impl Geometry {
    fn new(width: i32, height: i32) -> Self {
        assert!(width > 0 && height > 0);
        // Raw editor/preview traces need only dimensions and a short output
        // buffer. Allocate world-sized topology only upon its first import.
        Self { width, height, open: Vec::new(), edges: Vec::new(), costs: Vec::new(),
            trace: vec![0.0; width as usize + height as usize + 4] }
    }
    fn cell(&self, x: i32, y: i32) -> Option<usize> {
        if x >= 0 && y >= 0 && x < self.width && y < self.height { Some((y * self.width + x) as usize) } else { None }
    }
    fn sweep(&self, from_x: f64, from_y: f64, to_x: f64, to_y: f64,
        blocked: impl Fn(i64) -> bool, mut visit: impl FnMut(usize)) -> bool {
        if ![from_x, from_y, to_x, to_y].iter().all(|value| value.is_finite()) { return false; }
        let mut x = from_x.floor() as i32; let mut y = from_y.floor() as i32;
        let goal_x = to_x.floor() as i32; let goal_y = to_y.floor() as i32;
        let Some(start) = self.cell(x, y) else { return false; };
        let Some(goal) = self.cell(goal_x, goal_y) else { return false; };
        let open = |cell: usize| (self.open.is_empty() || self.open[cell] != 0) && !blocked(cell as i64);
        if !open(start) || !open(goal) { return false; }
        visit(start);
        let dx = to_x - from_x; let dy = to_y - from_y;
        let sx = dx.signum() as i32; let sy = dy.signum() as i32;
        let delta_x = if dx != 0.0 { 1.0 / dx.abs() } else { f64::INFINITY };
        let delta_y = if dy != 0.0 { 1.0 / dy.abs() } else { f64::INFINITY };
        let mut cross_x = if dx != 0.0 { ((if sx > 0 { x + 1 } else { x }) as f64 - from_x) / dx } else { f64::INFINITY };
        let mut cross_y = if dy != 0.0 { ((if sy > 0 { y + 1 } else { y }) as f64 - from_y) / dy } else { f64::INFINITY };
        while x != goal_x || y != goal_y {
            let previous = self.cell(x, y).unwrap();
            let (step_x, step_y);
            // Exact cell corners have zero area. Match the existing diagonal
            // policy instead of imposing a wider swept body on ordinary units.
            if (cross_x - cross_y).abs() < 1e-8 {
                x += sx; y += sy; cross_x += delta_x; cross_y += delta_y; step_x = sx; step_y = sy;
            } else if cross_x < cross_y {
                x += sx; cross_x += delta_x; step_x = sx; step_y = 0;
            } else {
                y += sy; cross_y += delta_y; step_x = 0; step_y = sy;
            }
            let Some(cell) = self.cell(x, y) else { return false; };
            let direction = DIRECTIONS.iter().position(|&(dx, dy)| dx == step_x && dy == step_y).unwrap();
            if !open(cell) || !self.edges.is_empty() && self.edges[previous] & (1 << direction) == 0 { return false; }
            visit(cell);
        }
        true
    }
    fn trace(&mut self, from_x: f64, from_y: f64, to_x: f64, to_y: f64) -> *const f64 {
        // Borrow the already resident output independently from geometry so the
        // sweep can write visits without allocating a temporary route vector.
        let mut output = std::mem::take(&mut self.trace);
        let mut count = 0;
        let valid = self.sweep(from_x, from_y, to_x, to_y, |_| false, |cell| {
            output[count + 2] = cell as f64; count += 1;
        });
        output[0] = u32::from(valid) as f64; output[1] = count as f64;
        self.trace = output;
        self.trace.as_ptr()
    }
}

struct Mask { input: Vec<f64>, cells: FixedBitSet, active: Vec<usize> }

pub struct Engine {
    width: i32,
    height: i32,
    world: World,
    actors: FxHashMap<i64, Entity>,
    indexed: FxHashMap<i64, SmallVec<[i64; 4]>>,
    overlays: FxHashMap<i64, SmallVec<[i64; 4]>>,
    candidate_output: Vec<f64>,
    next_grid: u32, grids: FxHashMap<u32, Geometry>,
    next_mask: u32, masks: FxHashMap<u32, Mask>,
    patch_input: Vec<f64>,
    epoch: u64,
    census: crate::census::SectorCensus,
}
impl Engine {
    fn new(width: i32, height: i32) -> Self {
        Self { width, height, world: World::new(), actors: FxHashMap::default(), indexed: FxHashMap::default(), overlays: FxHashMap::default(),
            candidate_output: Vec::new(), next_grid: 0, grids: FxHashMap::default(), next_mask: 0, masks: FxHashMap::default(), patch_input: Vec::new(), epoch: 0,
            census: crate::census::SectorCensus::new(width) }
    }
    /// Settlement sensing: armed, living, outside actors inside a rectangle.
    pub fn military_in_rect(&self, x0: f64, y0: f64, x1: f64, y1: f64, visit: impl FnMut(&crate::census::Member)) {
        self.census.for_each_in_rect(x0, y0, x1, y1, visit);
    }
    fn cell(&self, actor: &Actor) -> i64 { actor.y.floor() as i64 * self.width as i64 + actor.x.floor() as i64 }
    fn remove_cell(map: &mut FxHashMap<i64, SmallVec<[i64; 4]>>, cell: i64, id: i64) {
        if let Some(ids) = map.get_mut(&cell) {
            if let Some(index) = ids.iter().position(|&candidate| candidate == id) { ids.swap_remove(index); }
            if ids.is_empty() { map.remove(&cell); }
        }
    }
    pub fn begin(&mut self) {
        // Reset insertion priority lazily. Stationary armies do not need an
        // extra native roster pass just because another frame has started.
        self.epoch = self.epoch.wrapping_add(1);
    }
    pub fn actor(&mut self, id: i64, x: f64, y: f64, kind: u32, faction: f64, hp: f64,
        flags: u32, drill: f64, order: i64, bucket_order: f64, indexed_cell: Option<i64>, overlay: bool) {
        let next = Actor { id, x, y, kind, faction, hp, flags, drill, order, bucket_order, priority_epoch: self.epoch, indexed_cell, overlay };
        self.census.update(crate::census::Member { id, x, y, kind, faction }, crate::census::counted(kind, hp, flags & INSIDE != 0));
        let entity = self.actors.get(&id).copied();
        let previous = entity.map(|entity| *self.world.get::<Actor>(entity).unwrap());
        if previous.and_then(|actor| actor.indexed_cell) != indexed_cell {
            if let Some(cell) = previous.and_then(|actor| actor.indexed_cell) { Self::remove_cell(&mut self.indexed, cell, id); }
            if let Some(cell) = indexed_cell { self.indexed.entry(cell).or_default().push(id); }
        }
        let old_overlay = previous.filter(|actor| actor.overlay).map(|actor| self.cell(&actor));
        let new_overlay = overlay.then(|| self.cell(&next));
        if old_overlay != new_overlay {
            if let Some(cell) = old_overlay { Self::remove_cell(&mut self.overlays, cell, id); }
            if let Some(cell) = new_overlay { self.overlays.entry(cell).or_default().push(id); }
        }
        if let Some(entity) = entity { *self.world.get_mut::<Actor>(entity).unwrap() = next; }
        else { let entity = self.world.spawn(next).id(); self.actors.insert(id, entity); }
    }
    pub fn remove(&mut self, id: i64) {
        self.census.remove(id);
        if let Some(entity) = self.actors.remove(&id) {
            let previous = *self.world.get::<Actor>(entity).unwrap();
            if let Some(cell) = previous.indexed_cell { Self::remove_cell(&mut self.indexed, cell, id); }
            if previous.overlay { let cell = self.cell(&previous); Self::remove_cell(&mut self.overlays, cell, id); }
            self.world.despawn(entity);
        }
    }
    pub fn candidates(&mut self, cell: i64, overlay: bool) -> *const f64 {
        self.candidate_output.clear(); self.candidate_output.push(0.0);
        if let Some(ids) = self.indexed.get(&cell) { self.candidate_output.extend(ids.iter().map(|&id| id as f64)); }
        if overlay { if let Some(ids) = self.overlays.get(&cell) { self.candidate_output.extend(ids.iter().map(|&id| id as f64)); } }
        self.candidate_output[0] = (self.candidate_output.len() - 1) as f64;
        self.candidate_output.as_ptr()
    }
    pub fn occupant(&self, cell: i64, observer_id: i64, kind: u32, faction: f64, flags: u32, drill: f64, mode: u32) -> f64 {
        if mode == 0 && civilian(kind, flags) { return f64::NAN; }
        let mut chosen = f64::NAN;
        let mut priority = if mode == 0 { f64::INFINITY } else { -1.0 };
        let mut consider = |id: i64| {
            let Some(&entity) = self.actors.get(&id) else { return; };
            let actor = self.world.get::<Actor>(entity).unwrap();
            if self.cell(actor) != cell || !(actor.hp > 0.0) || actor.flags & INSIDE != 0 { return; }
            if mode == 0 {
                let bucket_order = if actor.indexed_cell.is_some() && actor.priority_epoch != self.epoch { actor.order as f64 } else { actor.bucket_order };
                if bucket_order < priority && obstructs(observer_id, kind, faction, flags, drill,
                    actor.id, actor.kind, actor.faction, actor.flags, actor.drill, actor.hp) {
                    priority = bucket_order; chosen = id as f64;
                }
            } else if actor.order as f64 > priority && collides(kind, faction, flags, drill,
                actor.kind, actor.faction, actor.flags, actor.drill) {
                priority = actor.order as f64; chosen = id as f64;
            }
        };
        // An actor can already have moved inside an atomic movement command
        // before its ordinary spatial refresh. Last-collision probes include it.
        if mode == 1 { consider(observer_id); }
        if let Some(ids) = self.indexed.get(&cell) { for &id in ids { consider(id); } }
        if mode == 1 { if let Some(ids) = self.overlays.get(&cell) { for &id in ids { consider(id); } } }
        chosen
    }
    fn bounded_cell(&self, x: f64, y: f64) -> Option<i64> {
        let (cx, cy) = (x.floor(), y.floor());
        (x.is_finite() && y.is_finite() && cx >= 0.0 && cy >= 0.0 && cx < self.width as f64 && cy < self.height as f64)
            .then(|| cy as i64 * self.width as i64 + cx as i64)
    }
    fn resident(&self, id: i64) -> Option<Actor> { self.actors.get(&id).map(|&entity| *self.world.get::<Actor>(entity).unwrap()) }
    /// Artillery has its own path follower. Query only its local gun neighbors
    /// here so two pieces never reserve or enter the same resting position.
    pub fn artillery_position_clear(&self, id: i64, x: f64, y: f64) -> bool {
        self.artillery_clear(id, x, y, x, y, false)
    }
    pub fn artillery_step_clear(&self, id: i64, x: f64, y: f64, nx: f64, ny: f64) -> bool {
        self.artillery_clear(id, x, y, nx, ny, true)
    }
    fn artillery_clear(&self, id: i64, x: f64, y: f64, nx: f64, ny: f64, leaving: bool) -> bool {
        let (cx, cy) = (nx.floor() as i32, ny.floor() as i32);
        for dy in -1..=1 { for dx in -1..=1 {
            let (tx, ty) = (cx + dx, cy + dy);
            if tx < 0 || ty < 0 || tx >= self.width || ty >= self.height { continue; }
            if let Some(ids) = self.indexed.get(&((ty * self.width + tx) as i64)) {
                for &other in ids {
                    let Some(actor) = self.resident(other) else { continue; };
                    if actor.id == id || actor.kind != 18 || actor.hp <= 0.0 || actor.flags & INSIDE != 0 { continue; }
                    let distance = (actor.x - nx).hypot(actor.y - ny);
                    if distance >= 0.9 { continue; }
                    // Loaded overlapping guns may leave their overlap, but a
                    // following piece must wait instead of stacking onto it.
                    if !leaving || distance <= (actor.x - x).hypot(actor.y - y) + 1e-7 { return false; }
                }
            }
        } }
        true
    }
    /// Mode-0 occupancy at a point: civilians and out-of-world points are never
    /// blocked by units (terrain sweeps reject the latter independently).
    fn position_blocked(&self, observer: &Actor, x: f64, y: f64) -> bool {
        self.bounded_cell(x, y).is_some_and(|cell| !self.occupant(cell, observer.id, observer.kind, observer.faction,
            observer.flags, observer.drill, 0).is_nan())
    }
    /// Raw occupancy view lookup. The cell index is not bounds checked, exactly
    /// like the host's per-unit occupancy view used to classify traffic.
    fn cell_occupied(&self, observer: &Actor, cell: i64) -> bool {
        !self.occupant(cell, observer.id, observer.kind, observer.faction, observer.flags, observer.drill, 0).is_nan()
    }
    /// The resident transform is authoritative. Overlay membership follows the
    /// position; the indexed tile changes only when the spatial index refreshes.
    fn move_actor(&mut self, id: i64, x: f64, y: f64, reindex: bool) {
        let Some(&entity) = self.actors.get(&id) else { return; };
        let previous = *self.world.get::<Actor>(entity).unwrap();
        let mut next = previous; next.x = x; next.y = y;
        self.census.moved(id, x, y);
        if previous.overlay {
            let (from, to) = (self.cell(&previous), self.cell(&next));
            if from != to { Self::remove_cell(&mut self.overlays, from, id); self.overlays.entry(to).or_default().push(id); }
        }
        if reindex && previous.indexed_cell.is_some() {
            let to = self.cell(&next);
            if previous.indexed_cell != Some(to) {
                Self::remove_cell(&mut self.indexed, previous.indexed_cell.unwrap(), id);
                self.indexed.entry(to).or_default().push(id); next.indexed_cell = Some(to);
            }
        }
        *self.world.get_mut::<Actor>(entity).unwrap() = next;
    }
    pub fn grid_create(&mut self, width: i32, height: i32) -> u32 {
        self.next_grid = self.next_grid.checked_add(1).expect("movement grid overflow");
        self.grids.insert(self.next_grid, Geometry::new(width, height)); self.next_grid
    }
    pub fn grid_input(&mut self, capacity: usize) -> *mut f64 {
        if self.patch_input.len() < capacity * 4 { self.patch_input.resize(capacity * 4, 0.0); }
        self.patch_input.as_mut_ptr()
    }
    pub fn grid_patch(&mut self, grid: u32, count: usize) {
        assert!(count * 4 <= self.patch_input.len());
        let grid = self.grids.get_mut(&grid).expect("unknown movement grid");
        if grid.open.is_empty() {
            let cells = grid.width as usize * grid.height as usize;
            grid.open.resize(cells, 0); grid.edges.resize(cells, 0); grid.costs.resize(cells, 1.0);
        }
        for row in self.patch_input[..count * 4].chunks_exact(4) {
            let cell = row[0] as usize;
            grid.open[cell] = u8::from(row[1] != 0.0); grid.edges[cell] = row[2] as u8; grid.costs[cell] = row[3];
        }
    }
    pub fn mask_create(&mut self, count: usize) -> u32 {
        self.next_mask = self.next_mask.checked_add(1).expect("movement mask overflow");
        self.masks.insert(self.next_mask, Mask { input: vec![0.0; count], cells: FixedBitSet::with_capacity(self.width as usize * self.height as usize), active: Vec::with_capacity(count) }); self.next_mask
    }
    pub fn mask_input(&mut self, mask: u32) -> *mut f64 { self.masks.get_mut(&mask).expect("unknown movement mask").input.as_mut_ptr() }
    pub fn mask_commit(&mut self, mask: u32) {
        let mask = self.masks.get_mut(&mask).expect("unknown movement mask");
        // Clear only previously occupied cells, rather than every tile in the world.
        for cell in mask.active.drain(..) { mask.cells.set(cell, false); }
        for &value in &mask.input {
            let cell = value as i64;
            if cell >= 0 && (cell as usize) < mask.cells.len() && !mask.cells.contains(cell as usize) {
                mask.cells.insert(cell as usize); mask.active.push(cell as usize);
            }
        }
    }
    pub fn mask_drop(&mut self, mask: u32) { self.masks.remove(&mask); }
    pub fn sweep(&self, grid: u32, from_x: f64, from_y: f64, to_x: f64, to_y: f64, mask_a: u32, mask_b: u32) -> bool {
        let a = self.masks.get(&mask_a).map(|mask| &mask.cells); let b = self.masks.get(&mask_b).map(|mask| &mask.cells);
        self.grids.get(&grid).expect("unknown movement grid").sweep(from_x, from_y, to_x, to_y,
            |cell| a.is_some_and(|mask| mask.contains(cell as usize)) || b.is_some_and(|mask| mask.contains(cell as usize)), |_| {})
    }
    pub fn trace(&mut self, grid: u32, from_x: f64, from_y: f64, to_x: f64, to_y: f64) -> *const f64 {
        self.grids.get_mut(&grid).expect("unknown movement grid").trace(from_x, from_y, to_x, to_y)
    }
}

/// Static obstacle layers for one movement probe. The geometry may live in a
/// different engine from occupancy (work and trade navigation views).
#[derive(Clone, Copy, Debug)]
pub struct Probe { pub engine: u32, pub grid: u32, pub masks: [u32; 3], pub exempt_current: bool }

pub const STEER_BLOCKED: u32 = 1;
pub const STEER_TRAFFIC: u32 = 2;
pub const STEER_UNKNOWN: u32 = 4;
pub const SEPARATION_STRIDE: usize = 15;
const SEPARATION_MAX_CORRECTION: f64 = 0.08;
const SEPARATION_RESPONSE: f64 = 0.55;

#[derive(Default)]
pub struct Engines {
    next_handle: u32, engines: FxHashMap<u32, Engine>,
    separation_input: Vec<f64>, separation_output: Vec<f64>,
    separation_rows: FxHashMap<i64, usize>, neighbors: Vec<(i64, i64)>,
}
impl Engines {
    /// Placement can close the starting cell or seal a pocket entirely. Pick
    /// the nearest legal tile directly rather than pathfinding from that cell.
    /// Only obstacle events invoke this search; ordinary movement never does.
    pub fn evacuate(&mut self, handle: u32, id: i64, probe: Probe, footprint: u32) -> [f64; 2] {
        let engine = self.get(handle);
        let Some(actor) = engine.resident(id) else { return [f64::NAN; 2]; };
        let unchanged = [actor.x, actor.y];
        if actor.hp <= 0.0 || actor.flags & (INSIDE | WALL_PATROL | VESSEL_OR_PASSENGER) != 0 { return unchanged; }
        let Some(current) = engine.bounded_cell(actor.x, actor.y) else { return unchanged; };
        if !engine.masks.get(&footprint).is_some_and(|mask| mask.cells.contains(current as usize)) { return unchanged; }
        let geometry = self.get(probe.engine);
        let grid = geometry.grids.get(&probe.grid).expect("clearance geometry");
        let masks = probe.masks.map(|mask| geometry.masks.get(&mask));
        let open = |cell: usize| (grid.open.is_empty() || grid.open[cell] != 0)
            && !masks.iter().flatten().any(|mask| mask.cells.contains(cell));
        // A gate/road/farm may share an event's footprint and still be open.
        if (grid.open.is_empty() || grid.open[current as usize] != 0)
            && !masks[0].is_some_and(|mask| mask.cells.contains(current as usize)) { return unchanged; }
        let (cx, cy) = (actor.x.floor() as i32, actor.y.floor() as i32);
        let mut best: Option<(f64, f64, f64)> = None;
        // Bound exceptional work in a fully occupied or uninhabitable map.
        for radius in 1..=64.min(engine.width.max(engine.height)) {
            if best.is_some_and(|(distance, _, _)| (radius as f64 - 0.5).powi(2) > distance) { break; }
            for y in (cy - radius).max(0)..=(cy + radius).min(engine.height - 1) {
                for x in (cx - radius).max(0)..=(cx + radius).min(engine.width - 1) {
                    if (x - cx).abs().max((y - cy).abs()) != radius { continue; }
                    let cell = (y * engine.width + x) as usize;
                    if !open(cell) { continue; }
                    let (px, py) = (x as f64 + 0.5, y as f64 + 0.5);
                    let distance = (px - actor.x).powi(2) + (py - actor.y).powi(2);
                    if best.is_some_and(|(d, _, _)| distance >= d) { continue; }
                    let mut occupied = false;
                    for oy in -1..=1 { for ox in -1..=1 {
                        let (nx, ny) = (x + ox, y + oy);
                        if nx < 0 || ny < 0 || nx >= engine.width || ny >= engine.height { continue; }
                        if let Some(ids) = engine.indexed.get(&((ny * engine.width + nx) as i64)) {
                            for &other_id in ids {
                                let Some(other) = engine.resident(other_id) else { continue; };
                                if other.id == id || other.hp <= 0.0 || other.flags & INSIDE != 0 { continue; }
                                if (other.x - px).hypot(other.y - py) + 1e-8 < collision_radius(actor.kind) + collision_radius(other.kind) {
                                    occupied = true; break;
                                }
                            }
                        }
                    } }
                    if !occupied { best = Some((distance, px, py)); }
                }
            }
        }
        let Some((_, x, y)) = best else { return unchanged; };
        self.get_mut(handle).move_actor(id, x, y, true);
        [x, y]
    }

    /// Swept terrain/structure test. Mask 3 can exempt the mover's current cell
    /// (a player push may exit an already marked tile but never enter one).
    fn clear(&self, probe: &Probe, current: Option<i64>, from_x: f64, from_y: f64, to_x: f64, to_y: f64) -> bool {
        let Some(engine) = self.engines.get(&probe.engine) else { return false; };
        let Some(grid) = engine.grids.get(&probe.grid) else { return false; };
        let sets = probe.masks.map(|mask| engine.masks.get(&mask).map(|mask| &mask.cells));
        let exempt = if probe.exempt_current { current } else { None };
        grid.sweep(from_x, from_y, to_x, to_y, |cell| sets[0].is_some_and(|set| set.contains(cell as usize))
            || sets[1].is_some_and(|set| set.contains(cell as usize))
            || Some(cell) != exempt && sets[2].is_some_and(|set| set.contains(cell as usize)), |_| {})
    }

    /// One atomic ordered steering command: advance toward `next`, otherwise
    /// slide along one axis. A blocked step into a traversable occupied cell is
    /// reported as traffic (no slide) so the host can arbitrate a yield first.
    /// Output: [status, x, y, moving, facing, candidate x, candidate y].
    pub fn steer(&mut self, handle: u32, id: i64, probe: Probe, next_x: f64, next_y: f64, speed: f64, dt: f64,
        anchor_x: f64, anchor_y: f64, radius: f64) -> [f64; 7] {
        let engine = self.get(handle);
        let Some(actor) = engine.resident(id) else { return [STEER_UNKNOWN as f64, f64::NAN, f64::NAN, 0.0, f64::NAN, f64::NAN, f64::NAN]; };
        let (x, y) = (actor.x, actor.y);
        let (mut dx, mut dy) = (next_x - x, next_y - y);
        let length = dx.hypot(dy);
        let step = length.min(speed * dt);
        dx = dx / length * step; dy = dy / length * step;
        let current = engine.bounded_cell(x, y);
        let raw_current = engine.cell(&actor);
        let anchored = !anchor_x.is_nan();
        let anchor_far = anchored && (anchor_x - x).hypot(anchor_y - y) > radius + 1e-7;
        let clear = |px: f64, py: f64| -> bool {
            (!anchored || anchor_far || (anchor_x - px).hypot(anchor_y - py) <= radius + 1e-7)
                && ((py.floor() as i64 * engine.width as i64 + px.floor() as i64) == raw_current || !engine.position_blocked(&actor, px, py))
                && self.clear(&probe, current, x, y, px, py)
        };
        let mut status = 0;
        let (mut nx, mut ny) = (x, y);
        let (candidate_x, candidate_y) = (x + dx, y + dy);
        if clear(candidate_x, candidate_y) { nx = candidate_x; ny = candidate_y; }
        else {
            status |= STEER_BLOCKED;
            let candidate_cell = candidate_y.floor() as i64 * engine.width as i64 + candidate_x.floor() as i64;
            let traffic = engine.cell_occupied(&actor, candidate_cell) && self.clear(&probe, current, x, y, candidate_x, candidate_y);
            if traffic { status |= STEER_TRAFFIC; }
            else if clear(x + dx, y) { nx = x + dx; }
            else if clear(x, y + dy) { ny = y + dy; }
        }
        let moving = (nx - x).hypot(ny - y) > 0.001;
        let facing = if moving { (ny - y).atan2(nx - x) } else { f64::NAN };
        if nx != x || ny != y { self.get_mut(handle).move_actor(id, nx, ny, false); }
        [status as f64, nx, ny, f64::from(u8::from(moving)), facing, candidate_x, candidate_y]
    }

    pub fn separation_input(&mut self, count: usize) -> *mut f64 {
        let size = count * SEPARATION_STRIDE;
        if self.separation_input.len() < size { self.separation_input.resize(size, 0.0); }
        self.separation_input.as_mut_ptr()
    }

    /// Post-loop collision separation in the original active-actor order. Each
    /// moving actor is nudged away from earlier overlapping obstructors, within
    /// the correction limit, never off its traversable segment or post.
    /// Output: [count, (id, x, y)...] with final positions of moved actors.
    pub fn separate(&mut self, handle: u32, count: usize, radius: f64) -> *const f64 {
        let input = std::mem::take(&mut self.separation_input);
        let mut output = std::mem::take(&mut self.separation_output);
        let mut rows = std::mem::take(&mut self.separation_rows);
        let mut neighbors = std::mem::take(&mut self.neighbors);
        output.clear(); output.push(0.0); rows.clear();
        let rows_in = &input[..count * SEPARATION_STRIDE];
        for (index, row) in rows_in.chunks_exact(SEPARATION_STRIDE).enumerate() { rows.entry(row[0] as i64).or_insert(index); }
        let mut moved: FxHashMap<i64, (f64, f64)> = FxHashMap::default();
        for (index, row) in rows_in.chunks_exact(SEPARATION_STRIDE).enumerate() {
            if row[1] == 0.0 { continue; }
            let id = row[0] as i64;
            let (anchor_x, anchor_y, next_x, next_y, old_x, old_y) = (row[2], row[3], row[4], row[5], row[6], row[7]);
            let unit_probe = Probe { engine: row[8] as u32, grid: row[9] as u32, masks: [row[10] as u32, row[11] as u32, row[12] as u32], exempt_current: row[13] != 0.0 };
            let plain_probe = Probe { engine: row[8] as u32, grid: row[9] as u32, masks: [row[10] as u32, row[14] as u32, 0], exempt_current: false };
            let engine = self.get(handle);
            let Some(start) = engine.resident(id) else { continue; };
            neighbors.clear();
            let (cx, cy) = (start.x.floor() as i64, start.y.floor() as i64);
            for oy in -1..=1 { for ox in -1..=1 {
                let (tx, ty) = (cx + ox, cy + oy);
                if tx < 0 || ty < 0 || tx >= engine.width as i64 || ty >= engine.height as i64 { continue; }
                if let Some(ids) = engine.indexed.get(&(ty * engine.width as i64 + tx)) {
                    for &other in ids { if let Some(actor) = engine.resident(other) { neighbors.push((actor.order, other)); } }
                }
            } }
            neighbors.sort_unstable();
            for &(_, other_id) in neighbors.iter() {
                if rows.get(&other_id).is_some_and(|&other_row| other_row >= index) { continue; }
                let engine = self.get(handle);
                let (Some(unit), Some(other)) = (engine.resident(id), engine.resident(other_id)) else { continue; };
                let d = (unit.x - other.x).hypot(unit.y - other.y);
                let spacing = collision_radius(unit.kind) + collision_radius(other.kind);
                if d >= spacing || !obstructs(unit.id, unit.kind, unit.faction, unit.flags, unit.drill,
                    other.id, other.kind, other.faction, other.flags, other.drill, other.hp) { continue; }
                let angle = if d < 0.001 { unit.id as f64 * 2.4 } else { (unit.y - other.y).atan2(unit.x - other.x) };
                let correction = SEPARATION_MAX_CORRECTION.min((spacing - d) * SEPARATION_RESPONSE);
                let (x, y) = (unit.x + angle.cos() * correction, unit.y + angle.sin() * correction);
                if !anchor_x.is_nan() && (anchor_x - x).hypot(anchor_y - y) > radius.max((anchor_x - unit.x).hypot(anchor_y - unit.y)) { continue; }
                let current = engine.bounded_cell(unit.x, unit.y);
                // A cosmetic nudge must not move a traveler off a currently
                // traversable segment (diagonal corners need exact alignment).
                if !next_x.is_nan() && self.clear(&unit_probe, current, unit.x, unit.y, next_x, next_y)
                    && !self.clear(&plain_probe, None, x, y, next_x, next_y) { continue; }
                let (from_x, from_y) = if old_x.is_nan() { (unit.x, unit.y) } else { (old_x, old_y) };
                if !engine.position_blocked(&unit, x, y) && self.clear(&unit_probe, current, unit.x, unit.y, x, y)
                    && self.clear(&plain_probe, None, from_x, from_y, x, y) {
                    self.get_mut(handle).move_actor(id, x, y, true);
                    moved.insert(id, (x, y));
                }
            }
        }
        // Report in active order so the host refreshes its index deterministically.
        for row in rows_in.chunks_exact(SEPARATION_STRIDE) {
            let id = row[0] as i64;
            if let Some((x, y)) = moved.remove(&id) { output.extend_from_slice(&[id as f64, x, y]); }
        }
        output[0] = ((output.len() - 1) / 3) as f64;
        self.separation_input = input; self.separation_rows = rows; self.neighbors = neighbors;
        self.separation_output = output;
        self.separation_output.as_ptr()
    }

    pub fn create(&mut self, width: i32, height: i32) -> u32 {
        self.next_handle = self.next_handle.checked_add(1).expect("movement handle overflow");
        self.engines.insert(self.next_handle, Engine::new(width, height)); self.next_handle
    }
    pub fn drop_engine(&mut self, handle: u32) { self.engines.remove(&handle); }
    pub fn get(&self, handle: u32) -> &Engine { self.engines.get(&handle).expect("unknown movement engine") }
    pub fn get_mut(&mut self, handle: u32) -> &mut Engine { self.engines.get_mut(&handle).expect("unknown movement engine") }
    pub fn drop_mask(&mut self, handle: u32, mask: u32) {
        if let Some(engine) = self.engines.get_mut(&handle) { engine.mask_drop(mask); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn actor(engine: &mut Engine, id: i64, x: f64, kind: u32, flags: u32, order: i64, bucket: f64, indexed: bool, overlay: bool) {
        engine.actor(id, x, 2.5, kind, 0.0, 100.0, flags, f64::NAN, order, bucket,
            indexed.then_some(2 * 12 + x.floor() as i64), overlay);
    }
    #[test]
    fn collision_policies_preserve_directional_and_special_role_exceptions() {
        assert!(!collides(1, 0.0, 0, f64::NAN, 7, 1.0, 0, f64::NAN));
        assert!(collides(1, 0.0, ENGINEER, f64::NAN, 7, 1.0, 0, f64::NAN));
        assert!(!collides(5, 0.0, 0, f64::NAN, 1, 0.0, ENGINEER, f64::NAN));
        assert!(!collides(7, 0.0, 0, 5.0, 10, 0.0, 0, 5.0));
        assert!(collides(14, 0.0, 0, 5.0, 10, 0.0, 0, 5.0));
        assert!(!collides(7, 0.0, LEVY_ASSEMBLING, f64::NAN, 7, 0.0, 0, f64::NAN));
        assert!(!collides(7, 0.0, WALL_PATROL, f64::NAN, 7, 1.0, 0, f64::NAN));
        assert!(!obstructs(1, 5, 0.0, 0, f64::NAN, 2, 7, 0.0, 0, f64::NAN, 100.0));
        assert!(obstructs(2, 7, 0.0, 0, f64::NAN, 1, 5, 0.0, 0, f64::NAN, 100.0));
    }
    #[test]
    fn resident_occupancy_keeps_first_bucket_and_last_array_order_distinct() {
        let mut engine = Engine::new(12, 8);
        actor(&mut engine, 1, 2.5, 7, 0, 0, 0.0, true, false);
        actor(&mut engine, 9, 4.5, 7, 0, 1, 5.0, true, false);
        actor(&mut engine, 2, 4.5, 7, 0, 2, 2.0, true, false);
        assert_eq!(engine.occupant(28, 1, 7, 0.0, 0, f64::NAN, 0), 2.0);
        actor(&mut engine, 9, 4.5, 7, 0, 1, 1.0, true, false);
        assert_eq!(engine.occupant(28, 1, 7, 0.0, 0, f64::NAN, 0), 9.0);
        assert_eq!(engine.occupant(28, 1, 7, 0.0, 0, f64::NAN, 1), 2.0);
        engine.remove(2);
        assert_eq!(engine.occupant(28, 1, 7, 0.0, 0, f64::NAN, 1), 9.0);
    }
    #[test]
    fn frame_epochs_reset_priority_without_republishing_stationary_actors() {
        let mut engine = Engine::new(12, 8);
        actor(&mut engine, 1, 2.5, 7, 0, 0, 0.0, true, false);
        actor(&mut engine, 9, 4.5, 7, 0, 1, 5.0, true, false);
        actor(&mut engine, 2, 4.5, 7, 0, 2, 2.0, true, false);
        assert_eq!(engine.occupant(28, 1, 7, 0.0, 0, f64::NAN, 0), 2.0);
        engine.begin();
        assert_eq!(engine.occupant(28, 1, 7, 0.0, 0, f64::NAN, 0), 9.0);
        actor(&mut engine, 9, 4.5, 7, 0, 1, 8.0, true, false);
        assert_eq!(engine.occupant(28, 1, 7, 0.0, 0, f64::NAN, 0), 2.0);
    }
    #[test]
    fn new_spawn_overlay_and_unpublished_requester_motion_do_not_reorder_sensing() {
        let mut engine = Engine::new(12, 8);
        actor(&mut engine, -1, 2.5, 7, 0, 0, 0.0, true, false);
        actor(&mut engine, 9_007_199_254_740_991, 4.5, 7, 0, 1, 1.0, false, true);
        assert!(engine.occupant(28, -1, 7, 0.0, 0, f64::NAN, 0).is_nan());
        assert_eq!(engine.occupant(28, -1, 7, 0.0, 0, f64::NAN, 1), 9_007_199_254_740_991.0);
        engine.actor(-1, 3.5, 2.5, 7, 0.0, 100.0, 0, f64::NAN, 0, 0.0, Some(26), false);
        assert_eq!(engine.occupant(27, -1, 7, 0.0, 0, f64::NAN, 1), -1.0);
        assert!(engine.occupant(26, 8, 7, 0.0, 0, f64::NAN, 0).is_nan());
    }
    #[test]
    fn live_hiding_and_death_clear_blockers_without_rebuilding_the_index() {
        let mut engine = Engine::new(12, 8);
        actor(&mut engine, 1, 2.5, 7, 0, 0, 0.0, true, false);
        actor(&mut engine, 2, 4.5, 7, 0, 1, 1.0, true, false);
        actor(&mut engine, 2, 4.5, 7, INSIDE, 1, 1.0, true, false);
        assert!(engine.occupant(28, 1, 7, 0.0, 0, f64::NAN, 0).is_nan());
        engine.actor(2, 4.5, 2.5, 7, 0.0, 0.0, 0, f64::NAN, 1, 1.0, Some(28), false);
        assert!(engine.occupant(28, 1, 7, 0.0, 0, f64::NAN, 0).is_nan());
    }
    fn open_grid(engine: &mut Engine) -> u32 {
        let grid = engine.grid_create(6, 6);
        engine.grid_input(36);
        for cell in 0..36 {
            let x = cell % 6; let y = cell / 6; let mut edges = 0;
            for (index, &(dx, dy)) in DIRECTIONS.iter().enumerate() {
                if x + dx >= 0 && x + dx < 6 && y + dy >= 0 && y + dy < 6 { edges |= 1 << index; }
            }
            engine.patch_input[cell as usize * 4..cell as usize * 4 + 4].copy_from_slice(&[cell as f64, 1.0, edges as f64, 1.0]);
        }
        engine.grid_patch(grid, 36); grid
    }
    #[test]
    fn swept_geometry_preserves_corner_contacts_and_rejects_off_center_clipping() {
        let mut engine = Engine::new(6, 6); let grid = open_grid(&mut engine);
        let mask = engine.mask_create(2);
        engine.masks.get_mut(&mask).unwrap().input.copy_from_slice(&[2.0 * 6.0 + 3.0, 3.0 * 6.0 + 2.0]);
        engine.mask_commit(mask);
        assert!(engine.sweep(grid, 2.5, 2.5, 3.5, 3.5, mask, 0));
        assert!(!engine.sweep(grid, 2.7, 2.3, 3.5, 3.5, mask, 0));
        assert!(!engine.sweep(grid, 2.5, 2.5, 4.5, 2.5, mask, 0));
        assert!(!engine.sweep(grid, f64::NAN, 2.5, 4.5, 2.5, 0, 0));
        assert!(!engine.sweep(grid, 2.5, 2.5, -0.1, 2.5, 0, 0));
    }
    #[test]
    fn geometry_patches_and_custom_traces_observe_same_step_topology_changes() {
        let mut engine = Engine::new(6, 6); let grid = open_grid(&mut engine);
        assert!(engine.sweep(grid, 1.5, 2.5, 4.5, 2.5, 0, 0));
        engine.patch_input[..4].copy_from_slice(&[15.0, 0.0, 255.0, 1.0]); engine.grid_patch(grid, 1);
        assert!(!engine.sweep(grid, 1.5, 2.5, 4.5, 2.5, 0, 0));
        engine.patch_input[..4].copy_from_slice(&[15.0, 1.0, 255.0, 1.0]); engine.grid_patch(grid, 1);
        engine.trace(grid, 1.5, 2.5, 4.5, 2.5);
        assert_eq!(&engine.grids[&grid].trace[..6], &[1.0, 4.0, 13.0, 14.0, 15.0, 16.0]);
    }
    fn engines_with_grid() -> (Engines, u32, u32) {
        let mut engines = Engines::default();
        let handle = engines.create(6, 6);
        let grid = open_grid(engines.get_mut(handle));
        (engines, handle, grid)
    }
    fn probe(handle: u32, grid: u32, masks: [u32; 3], exempt: bool) -> Probe { Probe { engine: handle, grid, masks, exempt_current: exempt } }
    fn soldier(engine: &mut Engine, id: i64, x: f64, y: f64, order: i64) {
        let cell = y.floor() as i64 * 6 + x.floor() as i64;
        engine.actor(id, x, y, 7, 0.0, 100.0, 0, f64::NAN, order, order as f64, Some(cell), false);
    }
    #[test]
    fn new_town_ejects_every_occupant_and_updates_occupancy_before_the_next_one() {
        let (mut engines, handle, grid) = engines_with_grid();
        let engine = engines.get_mut(handle);
        engine.actor(1, 2.5, 2.5, 5, 0.0, 100.0, HUMAN_CONTROLLED, f64::NAN, 0, 0.0, Some(14), false);
        // A civilian and a hostile soldier must also leave the new town.
        engine.actor(2, 2.5, 2.5, 1, 0.0, 100.0, 0, f64::NAN, 1, 1.0, Some(14), false);
        engine.actor(3, 3.5, 3.5, 7, 1.0, 100.0, 0, f64::NAN, 2, 2.0, Some(21), false);
        let mask = engine.mask_create(4);
        engine.masks.get_mut(&mask).unwrap().input.copy_from_slice(&[14.0, 15.0, 20.0, 21.0]);
        engine.mask_commit(mask);
        let probe = probe(handle, grid, [mask, 0, 0], false);
        let positions: Vec<_> = (1..=3).map(|id| engines.evacuate(handle, id, probe, mask)).collect();
        for (i, position) in positions.iter().enumerate() {
            let cell = position[1].floor() as usize * 6 + position[0].floor() as usize;
            assert!(![14, 15, 20, 21].contains(&cell));
            assert_eq!(engines.get(handle).resident(i as i64 + 1).unwrap().indexed_cell, Some(cell as i64));
            for other in &positions[..i] { assert!((position[0] - other[0]).hypot(position[1] - other[1]) >= 0.64); }
        }
        assert_eq!(engines.evacuate(handle, 1, probe, mask), positions[0]);
        let moved = engines.steer(handle, 1, probe, positions[0][0], positions[0][1] - 0.2, 1.0, 0.1, f64::NAN, f64::NAN, 5.0);
        assert_eq!(moved[0], 0.0, "the leader can move after the town appears");
    }
    #[test]
    fn pathable_additions_and_sheltered_units_stay_put() {
        let (mut engines, handle, grid) = engines_with_grid();
        let engine = engines.get_mut(handle);
        soldier(engine, 1, 2.5, 2.5, 0);
        engine.actor(2, 2.5, 2.5, 1, 0.0, 100.0, INSIDE, f64::NAN, 1, 1.0, Some(14), false);
        let mask = engine.mask_create(1);
        engine.masks.get_mut(&mask).unwrap().input[0] = 14.0; engine.mask_commit(mask);
        assert_eq!(engines.evacuate(handle, 1, probe(handle, grid, [0; 3], false), mask), [2.5, 2.5]);
        assert_eq!(engines.evacuate(handle, 2, probe(handle, grid, [mask, 0, 0], false), mask), [2.5, 2.5]);
    }
    #[test]
    fn steering_advances_and_writes_the_resident_transform() {
        let (mut engines, handle, grid) = engines_with_grid();
        soldier(engines.get_mut(handle), 1, 1.5, 1.5, 0);
        let result = engines.steer(handle, 1, probe(handle, grid, [0; 3], false), 3.5, 1.5, 2.0, 0.25, f64::NAN, f64::NAN, 5.0);
        assert_eq!(result[0], 0.0);
        assert!((result[1] - 2.0).abs() < 1e-12 && result[3] == 1.0 && result[4].abs() < 1e-12);
        assert_eq!(engines.get(handle).resident(1).unwrap().x, result[1]);
    }
    #[test]
    fn occupied_traversable_steps_report_traffic_without_sliding() {
        let (mut engines, handle, grid) = engines_with_grid();
        soldier(engines.get_mut(handle), 1, 1.5, 1.5, 0);
        soldier(engines.get_mut(handle), 2, 2.5, 2.5, 1);
        let result = engines.steer(handle, 1, probe(handle, grid, [0; 3], false), 2.5, 2.5, 4.0, 0.5, f64::NAN, f64::NAN, 5.0);
        assert_eq!(result[0] as u32, STEER_BLOCKED | STEER_TRAFFIC);
        assert_eq!((result[1], result[2], result[3]), (1.5, 1.5, 0.0));
    }
    #[test]
    fn static_obstructions_slide_along_one_axis_and_respect_masks() {
        let (mut engines, handle, grid) = engines_with_grid();
        soldier(engines.get_mut(handle), 1, 1.5, 1.5, 0);
        let mask = engines.get_mut(handle).mask_create(1);
        engines.get_mut(handle).masks.get_mut(&mask).unwrap().input[0] = 2.0 * 6.0 + 2.0;
        engines.get_mut(handle).mask_commit(mask);
        let result = engines.steer(handle, 1, probe(handle, grid, [mask, 0, 0], false), 2.5, 2.5, 4.0, 0.5, f64::NAN, f64::NAN, 5.0);
        assert_eq!(result[0] as u32, STEER_BLOCKED);
        assert!((result[1] - 2.5).abs() < 1e-12 && result[2] == 1.5);
    }
    #[test]
    fn player_push_may_leave_but_not_enter_a_marked_cell() {
        let (mut engines, handle, grid) = engines_with_grid();
        soldier(engines.get_mut(handle), 1, 1.5, 1.5, 0);
        let mask = engines.get_mut(handle).mask_create(2);
        engines.get_mut(handle).masks.get_mut(&mask).unwrap().input.copy_from_slice(&[7.0, 9.0]);
        engines.get_mut(handle).mask_commit(mask);
        let leave = engines.steer(handle, 1, probe(handle, grid, [0, 0, mask], true), 2.5, 1.5, 4.0, 0.25, f64::NAN, f64::NAN, 5.0);
        assert_eq!(leave[0], 0.0);
        soldier(engines.get_mut(handle), 1, 2.5, 1.5, 0);
        let enter = engines.steer(handle, 1, probe(handle, grid, [0, 0, mask], true), 3.5, 1.5, 4.0, 0.5, f64::NAN, f64::NAN, 5.0);
        assert_ne!(enter[0] as u32 & STEER_BLOCKED, 0);
        let without = engines.steer(handle, 1, probe(handle, grid, [0, 0, mask], false), 2.5, 1.5, 4.0, 0.25, f64::NAN, f64::NAN, 5.0);
        assert_ne!(without[0] as u32 & STEER_BLOCKED, 0);
    }
    #[test]
    fn defensive_anchor_bounds_steps_only_inside_the_post() {
        let (mut engines, handle, grid) = engines_with_grid();
        soldier(engines.get_mut(handle), 1, 1.5, 1.5, 0);
        let blocked = engines.steer(handle, 1, probe(handle, grid, [0; 3], false), 4.5, 1.5, 4.0, 0.5, 1.5, 1.5, 1.0);
        assert!((blocked[1] - 1.5).abs() < 1e-12);
        soldier(engines.get_mut(handle), 1, 4.5, 4.5, 0);
        let far = engines.steer(handle, 1, probe(handle, grid, [0; 3], false), 5.5, 4.5, 4.0, 0.25, 1.5, 1.5, 1.0);
        assert_eq!(far[0], 0.0);
    }
    #[test]
    fn work_views_probe_their_own_geometry_engine() {
        let (mut engines, handle, _) = engines_with_grid();
        soldier(engines.get_mut(handle), 1, 1.5, 1.5, 0);
        let view = engines.create(6, 6);
        let grid = open_grid(engines.get_mut(view));
        engines.get_mut(view).patch_input[..4].copy_from_slice(&[8.0, 0.0, 255.0, 1.0]);
        engines.get_mut(view).grid_patch(grid, 1);
        let result = engines.steer(handle, 1, probe(view, grid, [0; 3], false), 2.5, 1.5, 4.0, 0.5, f64::NAN, f64::NAN, 5.0);
        assert_ne!(result[0] as u32 & STEER_BLOCKED, 0);
        assert_eq!(engines.steer(handle, 99, probe(view, grid, [0; 3], false), 2.5, 1.5, 4.0, 0.5, f64::NAN, f64::NAN, 5.0)[0] as u32, STEER_UNKNOWN);
    }
    fn separation_row(engines: &mut Engines, row: usize, id: i64, eligible: bool, handle: u32, grid: u32) {
        let input = &mut engines.separation_input[row * SEPARATION_STRIDE..(row + 1) * SEPARATION_STRIDE];
        input.copy_from_slice(&[id as f64, f64::from(u8::from(eligible)), f64::NAN, f64::NAN, f64::NAN, f64::NAN,
            f64::NAN, f64::NAN, handle as f64, grid as f64, 0.0, 0.0, 0.0, 0.0, 0.0]);
    }
    #[test]
    fn separation_pushes_later_movers_from_earlier_overlaps_in_active_order() {
        let (mut engines, handle, grid) = engines_with_grid();
        soldier(engines.get_mut(handle), 1, 2.5, 2.5, 0);
        soldier(engines.get_mut(handle), 2, 3.05, 2.5, 1);
        engines.separation_input(2);
        separation_row(&mut engines, 0, 1, true, handle, grid);
        separation_row(&mut engines, 1, 2, true, handle, grid);
        let pointer = engines.separate(handle, 2, 5.0);
        let output = unsafe { std::slice::from_raw_parts(pointer, 4) };
        assert_eq!(output[0], 1.0);
        assert_eq!(output[1], 2.0);
        assert!((output[2] - 3.13).abs() < 1e-12 && (output[3] - 2.5).abs() < 1e-12);
        assert_eq!(engines.get(handle).resident(1).unwrap().x, 2.5);
    }
    #[test]
    fn separation_reindexes_tiles_and_never_enters_blocked_cells() {
        let (mut engines, handle, grid) = engines_with_grid();
        soldier(engines.get_mut(handle), 1, 2.95, 2.5, 0);
        soldier(engines.get_mut(handle), 2, 3.02, 2.5, 1);
        engines.separation_input(2);
        separation_row(&mut engines, 0, 1, false, handle, grid);
        separation_row(&mut engines, 1, 2, true, handle, grid);
        engines.separate(handle, 2, 5.0);
        let moved = engines.get(handle).resident(2).unwrap();
        assert_eq!(moved.indexed_cell, Some(15));
        assert!(engines.get(handle).indexed.get(&15).unwrap().contains(&2));
        let (mut engines, handle, grid) = engines_with_grid();
        soldier(engines.get_mut(handle), 1, 2.5, 2.5, 0);
        soldier(engines.get_mut(handle), 2, 3.05, 2.5, 1);
        let mask = engines.get_mut(handle).mask_create(1);
        engines.get_mut(handle).masks.get_mut(&mask).unwrap().input[0] = 2.0 * 6.0 + 3.0;
        engines.get_mut(handle).mask_commit(mask);
        engines.separation_input(2);
        separation_row(&mut engines, 0, 1, true, handle, grid);
        separation_row(&mut engines, 1, 2, true, handle, grid);
        engines.separation_input[SEPARATION_STRIDE + 10] = mask as f64;
        let pointer = engines.separate(handle, 2, 5.0);
        assert_eq!(unsafe { *pointer }, 0.0);
    }

}
