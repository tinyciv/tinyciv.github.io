//! Officer-led offensives. Coarse observations supply the indexed retinue and
//! objective neighborhood; persistent orders, slots and recovery debt live here.
use bevy_ecs::prelude::*;
use rstar::{AABB, PointDistance, RTree, primitives::{GeomWithData, Rectangle}};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use super::kinds::unit as unit_kind;

pub const STRIDE: usize = 7;
const MEMBER: usize = 9;
pub const HEADER: usize = 8;
pub const RADIUS: f64 = 6.0;
const CONTACT_RADIUS: f64 = 5.5;
const IMMEDIATE_CONTACT_RADIUS: f64 = 2.0;
const START_COOLDOWN: f64 = 60.0;
const SLOT_TOLERANCE: f64 = 0.62;
type Enemy<'a> = GeomWithData<Rectangle<[f64; 2]>, &'a [f64]>;
type Point = [f64; 2];
type Cell = (i32, i32);

#[derive(Default, Clone)]
struct March {
    anchor: Point,
    route: Vec<Point>,
    next: usize,
    goals: BTreeMap<i64, Point>,
    needs_route: bool,
    approaches: BTreeMap<i64, Approach>,
}

impl March {
    fn new(anchor: Point) -> Self {
        Self { anchor, needs_route: true, ..Self::default() }
    }

    fn next_anchor(&mut self, objective: Point, step: f64) -> Point {
        while self.route.get(self.next).is_some_and(|&point| gap(self.anchor, point) < 1e-6) {
            self.next += 1;
        }
        // Native callers without a navigation route can still march on open ground.
        let next = self.route.get(self.next).copied().unwrap_or(if self.needs_route && self.route.is_empty() {
            objective
        } else {
            self.anchor
        });
        let distance = gap(self.anchor, next);
        if distance <= step { return next; }
        let fraction = step / distance;
        [self.anchor[0] + (next[0] - self.anchor[0]) * fraction, self.anchor[1] + (next[1] - self.anchor[1]) * fraction]
    }
}

#[derive(Clone)]
struct Approach { x: f64, y: f64, goal: [f64; 2], gap: f64, at: f64 }
#[derive(Clone)]
struct Offensive {
    leader: i64, phase: u32, rally: [f64; 2], objective: [f64; 2],
    slots: BTreeMap<i64, usize>, columns: usize, started: f64, goals: BTreeMap<i64, [f64; 2]>, routing: BTreeSet<i64>,
    approaches: BTreeMap<i64, Approach>, assembling: BTreeSet<i64>,
    regrouping: bool,
    march: March,
}
#[derive(Clone, Copy)]
pub struct Navigation { pub engine: u32, pub grid: u32, pub blockers: u32, pub forbidden: u32 }
#[derive(Resource, Default)]
pub struct Offensives {
    orders: BTreeMap<i32, Offensive>, recovery: BTreeMap<i32, f64>, ready_at: BTreeMap<i32, f64>,
    input: Vec<f64>, output: Vec<f64>,
    pub navigation: Option<Navigation>,
}
impl Offensives {
    pub fn begin(&mut self, faction: i32, leader: i64, rally: [f64; 2], objective: [f64; 2], unlocked: bool, now: f64) -> bool {
        if !unlocked || faction < 0 || !rally.into_iter().chain(objective).all(f64::is_finite)
            || self.active(faction) || self.ready_at.get(&faction).is_some_and(|&ready| now < ready) { return false; }
        self.ready_at.insert(faction, now + START_COOLDOWN);
        self.orders.insert(faction, Offensive { leader, phase: 1, rally, objective, slots: BTreeMap::new(), columns: 1, started: now, goals: BTreeMap::new(), routing: BTreeSet::new(), approaches: BTreeMap::new(), assembling: BTreeSet::new(), regrouping: false, march: March::new(rally) });
        true
    }
    pub fn cancel(&mut self, faction: i32) { self.orders.remove(&faction); }
    pub fn clear(&mut self) { self.orders.clear(); self.recovery.clear(); self.ready_at.clear(); }
    pub fn active(&self, faction: i32) -> bool { self.orders.get(&faction).is_some_and(|o| o.phase != 3) }
    pub fn view(&self, faction: i32) -> Option<(u32, [f64; 2], [f64; 2])> { self.orders.get(&faction).map(|o| (o.phase, o.rally, o.objective)) }
    pub fn reward(&self, faction: i32, amount: f64) -> f64 { amount * if self.active(faction) { 0.25 } else { 1.0 } }
    pub fn casualty(&mut self, faction: i32) { if self.active(faction) { *self.recovery.entry(faction).or_default() += 1.0; } }
    pub fn growth(&self, faction: i32) -> f64 { if self.recovery.get(&faction).copied().unwrap_or(0.0) > 0.0 { 2.0 } else { 1.0 } }
    pub fn births(&mut self, faction: i32, births: f64) {
        if let Some(debt) = self.recovery.get_mut(&faction) { *debt = (*debt - births.max(0.0)).max(0.0); }
    }
    pub fn prepare(&mut self, members: usize, enemies: usize) -> *mut f64 {
        self.input.resize(members * MEMBER + enemies * STRIDE, 0.0); self.input.as_mut_ptr()
    }
    pub fn route_start(&self, faction: i32) -> *const f64 {
        self.orders.get(&faction).filter(|o| o.march.needs_route)
            .map_or(std::ptr::null(), |o| o.march.anchor.as_ptr())
    }
    pub fn prepare_route(&mut self, points: usize) -> *mut f64 {
        self.input.resize(points * 2, 0.0);
        self.input.as_mut_ptr()
    }
    pub fn set_route(&mut self, faction: i32, points: usize) {
        if let Some(order) = self.orders.get_mut(&faction) {
            order.march.route.clear();
            order.march.route.extend(self.input[..points * 2].chunks_exact(2)
                .map(|point| [point[0], point[1]]));
            if points == 0 { order.march.route.push(order.march.anchor); }
            order.march.next = 0;
            order.march.needs_route = false;
        }
    }
    pub fn status(&mut self, faction: i32) -> *const f64 {
        self.output.resize(HEADER, 0.0); self.output.fill(0.0);
        if let Some(o) = self.orders.get(&faction) {
            self.output[..HEADER].copy_from_slice(&[o.phase as f64, o.rally[0], o.rally[1], o.objective[0], o.objective[1], 0.0, 0.0, o.leader as f64]);
        }
        self.output[6] = self.ready_at.get(&faction).copied().unwrap_or(0.0);
        self.output.as_ptr()
    }
    /// Member input: id,x,y,hp,routing,morale,eligible,kind,speed. Enemy input:
    /// id,x,y,hp,footprint(0 actor/1 site/2 solid structure),width,height. Output header is status, followed by
    /// id,mode(1 rally/2 advance/3 fight/4 hold/5 regroup),x,y,target,recoverRout,marchSpeed.
    /// A rally directive can carry a contact target while retaining the rally goal.
    pub fn step(&mut self, faction: i32, now: f64, members: usize, enemies: usize, army_capacity: usize,
        mut clear: impl FnMut(f64, f64, f64, f64) -> bool,
        mut cannon_clear: impl FnMut(f64, f64, f64, f64) -> bool) -> *const f64 {
        assert!(members * MEMBER + enemies * STRIDE <= self.input.len());
        let Some(o) = self.orders.get_mut(&faction) else { return self.status(faction); };
        let roster: Vec<&[f64]> = self.input[..members * MEMBER].chunks_exact(MEMBER).filter(|r| r[3] > 0.0 && r[6] != 0.0).collect();
        let alive: BTreeSet<i64> = roster.iter().map(|r| r[0] as i64).collect();
        let supporting_count = roster.iter().filter(|r| field_cannon(r) && !o.march.goals.contains_key(&(r[0] as i64))).count();
        let withdrawal_minimum = (army_capacity.saturating_sub(supporting_count) * 3).div_ceil(10).max(1);
        let active = roster.iter().filter(|r| {
            let id = r[0] as i64;
            r[4] == 0.0 && !o.routing.contains(&id) && !o.assembling.contains(&id)
        }).count();
        if o.phase == 2 && (active < withdrawal_minimum || o.march.goals.is_empty()) {
            o.phase = 1;
            o.regrouping = true;
            o.started = now;
            o.slots.clear();
            o.goals.clear();
            o.approaches.clear();
            o.march = March::new(o.rally);
        }
        o.slots.retain(|id, _| alive.contains(id));
        o.assembling.retain(|id| alive.contains(id));
        if o.slots.is_empty() { o.columns = ((roster.len() as f64).sqrt().ceil() as usize).max(1); }
        let by_id: BTreeMap<i64, &[f64]> = roster.iter().map(|r| (r[0] as i64, *r)).collect();
        let mut new_ids: Vec<i64> = alive.iter().filter(|id| !o.slots.contains_key(*id)).copied().collect();
        new_ids.sort_by_key(|id| (by_id[id][7] as u32 != unit_kind::FIELD_CANNON, *id));
        let taken: BTreeSet<usize> = o.slots.values().copied().collect();
        let mut slot = 0;
        for id in new_ids {
            while taken.contains(&slot) { slot += 1; }
            o.slots.insert(id, slot);
            slot += 1;
            o.assembling.insert(id);
        }
        let departure = o.march.route.iter().take(4).copied().find(|&point| gap(o.rally, point) > 0.75)
            .unwrap_or(o.objective);
        let dx = departure[0] - o.rally[0]; let dy = departure[1] - o.rally[1];
        let heading = dy.atan2(dx);
        let rows = o.slots.values().copied().max().map_or(1, |slot| slot / o.columns + 1);
        let columns = o.columns;
        let slot_point = |slot: usize, anchor: Point, facing: f64| rank_point(slot, columns, rows, anchor, facing);
        let radius = ((roster.len() as f64).sqrt().ceil() as i32 + 3).clamp(6, 12);
        // Share a bounded flood so each slot is on connected ground.
        o.goals.retain(|id, _| alive.contains(id));
        o.approaches.retain(|id, _| alive.contains(id));
        let needs_rally = o.phase == 1 || roster.iter().any(|r| r[4] != 0.0 || o.routing.contains(&(r[0] as i64)));
        if needs_rally {
            let connected = connected_ground(o.rally, radius, &mut clear);
            let mut occupied = BTreeSet::new();
            for (&id, &slot) in &o.slots {
                let member = by_id[&id];
                let mut stalled = false;
                if let Some(goal) = o.goals.get(&id) {
                    let cell = (goal[0].floor() as i32, goal[1].floor() as i32);
                    let gap = (member[1] - goal[0]).hypot(member[2] - goal[1]);
                    let approach = o.approaches.entry(id).or_insert(Approach { x: member[1], y: member[2], goal: *goal, gap, at: now });
                    if approach.goal == *goal && gap < approach.gap - 0.15 || (member[1] - approach.x).hypot(member[2] - approach.y) > 0.6 || now < approach.at {
                        *approach = Approach { x: member[1], y: member[2], goal: *goal, gap, at: now };
                    }
                    stalled = (gap > 0.75 || !connected.contains(&(member[1].floor() as i32, member[2].floor() as i32))) && now - approach.at >= 4.0;
                    if connected.contains(&cell) && !stalled && occupied.insert(cell) { continue; }
                }
                let current = (member[1].floor() as i32, member[2].floor() as i32);
                let ideal = slot_point(slot, o.rally, heading);
                let ideal = if stalled && connected.contains(&current) && gap([member[1], member[2]], ideal) <= 1.5 {
                    [member[1], member[2]]
                } else {
                    ideal
                };
                let position = [member[1], member[2]];
                let goal = reserve_slot(&connected, &mut occupied, ideal, member,
                    |point| !field_cannon(member) || segment_clear(position, point, &mut cannon_clear));
                let Some(goal) = goal else {
                    o.goals.remove(&id);
                    continue;
                };
                let (x, y, at) = o.approaches.get(&id).map_or((member[1], member[2], now), |approach| (approach.x, approach.y, approach.at));
                o.goals.insert(id, goal);
                o.approaches.insert(id, Approach { x, y, goal, gap: (member[1] - goal[0]).hypot(member[2] - goal[1]), at });
            }
        }
        let enemies = self.input[members * MEMBER..members * MEMBER + enemies * STRIDE].chunks_exact(STRIDE)
            .filter(|r| r[3] > 0.0).map(|r| {
                let (origin, end) = enemy_bounds(r);
                Enemy::new(Rectangle::from_corners(origin, end), r)
            }).collect::<Vec<_>>();
        // Share footprint lookups across the roster on each coarse observation.
        let threats = RTree::bulk_load(enemies.iter().copied().filter(|enemy| enemy.distance_2(&o.objective) <= RADIUS * RADIUS).collect());
        let nearby = RTree::bulk_load(enemies);
        for id in roster.iter().filter(|r| r[4] != 0.0).map(|r| r[0] as i64) {
            o.routing.insert(id);
            o.assembling.insert(id);
        }
        // Morale may recover en route. Keep that soldier's return assignment
        // until it physically reaches its rally slot before rejoining an attack.
        o.routing.retain(|id| by_id.get(id).is_some_and(|r| {
            r[4] != 0.0 || o.goals.get(id).is_none_or(|&goal| gap([r[1], r[2]], goal) > SLOT_TOLERANCE)
        }));
        let ready_ids: BTreeSet<i64> = roster.iter().filter(|r| {
            let id = r[0] as i64;
            let goal = if o.phase == 1 { o.goals.get(&id) } else { o.march.goals.get(&id) };
            r[4] == 0.0 && !o.routing.contains(&id)
                && goal.is_some_and(|&goal| gap([r[1], r[2]], goal) <= SLOT_TOLERANCE)
        }).map(|r| r[0] as i64).collect();
        o.assembling.retain(|id| !ready_ids.contains(id));
        if o.phase == 1 {
            let supporting = roster.iter().filter(|r| field_cannon(r) && !o.goals.contains_key(&(r[0] as i64))).count();
            let fit = roster.iter().filter(|r| {
                let id = r[0] as i64;
                !o.routing.contains(&id) && (!field_cannon(r) || o.goals.contains_key(&id))
            }).count();
            let muster_minimum = army_capacity.saturating_sub(supporting).div_ceil(2).max(1);
            if fit >= muster_minimum && ready_ids.len() == fit && now - o.started >= 1.0 {
                o.phase = 2;
                o.regrouping = false;
                o.march.goals.clone_from(&o.goals);
            }
        }
        o.march.goals.retain(|id, _| alive.contains(id));
        o.march.approaches.retain(|id, _| alive.contains(id));
        let supporting: BTreeSet<i64> = roster.iter().filter(|r| field_cannon(r))
            .map(|r| r[0] as i64).filter(|id| !o.march.goals.contains_key(id)).collect();
        let still_rallying = |r: &[f64]| {
            let id = r[0] as i64;
            r[4] != 0.0 || o.routing.contains(&id) || o.assembling.contains(&id) || supporting.contains(&id)
        };
        let advancing = || roster.iter().enumerate().filter(|(_, r)| !still_rallying(r));
        let flag_runner = advancing().min_by_key(|(_, r)| {
            let slot = o.slots[&(r[0] as i64)];
            (r[7] as u32 == unit_kind::FIELD_CANNON, std::cmp::Reverse(slot / o.columns),
                (slot % o.columns).abs_diff(o.columns / 2))
        }).map(|(index, _)| index);
        let march_speed = advancing().map(|(_, r)| r).filter(|r| r[7] as u32 != unit_kind::FIELD_CANNON && r[8] > 0.0)
            .map(|r| r[8]).min_by(f64::total_cmp).unwrap_or(0.0);
        let contact = |r: &[f64]| nearest_enemy(&nearby, [r[1], r[2]], CONTACT_RADIUS);
        let mut next = o.march.anchor;
        let mut facing = heading;
        let mut breach = None;
        if o.phase == 2 {
            next = o.march.next_anchor(o.objective, (march_speed * 0.5).clamp(0.75, 1.5));
            let ahead = o.march.route.get(o.march.next + 2).copied().unwrap_or(next);
            if ahead != o.march.anchor {
                facing = (ahead[1] - o.march.anchor[1]).atan2(ahead[0] - o.march.anchor[0]);
            }
            breach = blocking_enemy(&nearby, o.march.anchor, next, &mut clear);
            if breach.is_none() {
                breach = advancing().find_map(|(_, r)| {
                    let id = r[0] as i64;
                    let post = *o.march.goals.get(&id)?;
                    let ideal = center(cell(slot_point(o.slots[&id], next, facing)));
                    blocking_enemy(&nearby, [r[1], r[2]], post, &mut clear)
                        .or_else(|| blocking_enemy(&nearby, post, ideal, &mut clear))
                });
            }
        }
        if o.phase == 2 && breach.is_none() {
            let mut ground = None;
            let mut occupied: BTreeSet<Cell> = o.march.goals.values().copied().map(cell).collect();
            for (_, r) in advancing() {
                let id = r[0] as i64;
                let Some(&goal) = o.march.goals.get(&id) else { continue; };
                let position = [r[1], r[2]];
                let distance = gap(position, goal);
                let approach = o.march.approaches.entry(id).or_insert(Approach { x: r[1], y: r[2], goal, gap: distance, at: now });
                if approach.goal != goal || distance < approach.gap - 0.15
                    || gap(position, [approach.x, approach.y]) > 0.6 || now < approach.at {
                    *approach = Approach { x: r[1], y: r[2], goal, gap: distance, at: now };
                }
                if distance <= SLOT_TOLERANCE || now - approach.at < 5.0 { continue; }
                let patch = ground.get_or_insert_with(|| connected_ground(o.march.anchor, radius, &mut clear));
                let replacement = patch.iter().copied().filter(|slot| !occupied.contains(slot) && gap(center(*slot), goal) <= 2.0
                    && if field_cannon(r) { segment_clear(position, center(*slot), &mut cannon_clear) }
                    else { segment_clear(position, center(*slot), &mut clear) })
                    .min_by(|&a, &b| gap(center(a), goal).total_cmp(&gap(center(b), goal)).then(a.cmp(&b)));
                if let Some(slot) = replacement {
                    occupied.remove(&cell(goal));
                    occupied.insert(slot);
                    o.march.goals.insert(id, center(slot));
                } else if field_cannon(r) {
                    occupied.remove(&cell(goal));
                    o.march.goals.remove(&id);
                }
                approach.at = now;
            }
        }
        // Breach from the current ranks and reform there before the next advance.
        if o.phase == 2 && breach.is_none() && advancing().all(|(_, r)| {
            let id = r[0] as i64;
            o.march.goals.get(&id).is_some_and(|&goal| gap([r[1], r[2]], goal) <= SLOT_TOLERANCE)
        }) {
            if next != o.march.anchor || roster.iter().any(|r| !field_cannon(r) && !o.march.goals.contains_key(&(r[0] as i64))) {
                if segment_clear(o.march.anchor, next, &mut clear) {
                    let mut ground = None;
                    let mut taken = BTreeSet::new();
                    let mut goals = BTreeMap::new();
                    for (&id, &slot) in &o.slots {
                        let member = by_id[&id];
                        let position = [member[1], member[2]];
                        let ideal = slot_point(slot, next, facing);
                        let primary = cell(ideal);
                        let joining = still_rallying(member);
                        let direct = segment_clear(next, center(primary), &mut clear) && if field_cannon(member) {
                            segment_clear(position, center(primary), &mut cannon_clear)
                        } else { joining || segment_clear(position, center(primary), &mut clear) };
                        let goal = if direct && taken.insert(primary) {
                            Some(center(primary))
                        } else {
                            let ground = ground.get_or_insert_with(|| connected_ground(next, radius, &mut clear));
                            reserve_slot(ground, &mut taken, ideal, member, |point| {
                                if field_cannon(member) { segment_clear(position, point, &mut cannon_clear) }
                                else { joining || segment_clear(position, point, &mut clear) }
                            })
                        };
                        if let Some(goal) = goal {
                            goals.insert(id, goal);
                        }
                    }
                    if roster.iter().all(|r| field_cannon(r) || goals.contains_key(&(r[0] as i64))) {
                        o.march.anchor = next;
                        o.march.goals = goals;
                    }
                } else {
                    o.march.needs_route = true;
                }
            } else if gap(o.march.anchor, o.objective) > 1.0 {
                o.march.needs_route = true;
            }
        }
        let at_objective = gap(o.march.anchor, o.objective) <= 1.0;
        let at_route_end = o.march.route.last().is_some_and(|&last| gap(o.march.anchor, last) < 1e-6);
        let breacher = breach.and_then(|enemy| advancing().filter(|(_, r)| r[7] as u32 != unit_kind::FIELD_CANNON)
            .min_by(|(_, a), (_, b)| {
                enemy_distance(enemy, [a[1], a[2]]).total_cmp(&enemy_distance(enemy, [b[1], b[2]]))
                    .then_with(|| a[0].total_cmp(&b[0]))
            })
            .map(|(index, _)| index));
        let flag_taken = advancing().any(|(_, r)| gap([r[1], r[2]], o.objective) <= 1.0);
        if o.phase == 2 && at_objective && threats.size() == 0 && flag_taken { o.phase = 3; }
        self.output.resize(HEADER + roster.len() * STRIDE, 0.0);
        self.output[..HEADER].copy_from_slice(&[o.phase as f64, o.rally[0], o.rally[1], o.objective[0], o.objective[1], roster.len() as f64,
            self.ready_at.get(&faction).copied().unwrap_or(0.0), o.leader as f64]);
        for (index, r) in roster.iter().enumerate() {
            let id = r[0] as i64;
            let position = [r[1], r[2]];
            let rally = o.goals.get(&id).copied().unwrap_or(position);
            let post = o.march.goals.get(&id).copied().unwrap_or(rally);
            let recover = r[4] != 0.0 && r[5] >= 49.0 && (r[1] - rally[0]).hypot(r[2] - rally[1]) <= 1.5;
            let (mode, goal, target) = if o.regrouping {
                (5.0, rally, -1.0)
            } else if o.phase == 1 || still_rallying(r) {
                // Artillery already fires opportunistically with its own range
                // and firing clock. Retreating soldiers keep their rally route.
                let target = if r[4] == 0.0 && !o.routing.contains(&id) && r[7] as u32 != unit_kind::FIELD_CANNON {
                    nearest_enemy(&nearby, position, CONTACT_RADIUS)
                } else { None };
                let goal = if o.phase == 2 && r[4] == 0.0 && !o.routing.contains(&id) {
                    o.march.goals.get(&id).copied().unwrap_or(position)
                } else { rally };
                (1.0, goal, target.map_or(-1.0, |enemy| enemy[0]))
            }
            else {
                let goal = if at_objective && Some(index) == flag_runner { o.objective } else { post };
                let assault = breach.filter(|enemy| Some(index) == breacher || enemy_distance(enemy, position) <= CONTACT_RADIUS)
                    .or_else(|| {
                        if (at_route_end || at_objective) && gap(position, goal) <= 1.5 {
                            nearest_enemy(&threats, position, f64::INFINITY)
                        } else { None }
                    })
                    .or_else(|| nearest_enemy(&nearby, position, IMMEDIATE_CONTACT_RADIUS).filter(|enemy| enemy[4] == 0.0));
                if o.phase == 3 { (4.0, post, -1.0) }
                else if let Some(enemy) = assault.filter(|_| r[7] as u32 != unit_kind::FIELD_CANNON) {
                    (3.0, [enemy[1], enemy[2]], enemy[0])
                } else { (2.0, goal, assault.or_else(|| contact(r)).map_or(-1.0, |enemy| enemy[0])) }
            };
            let offset = HEADER + index * STRIDE;
            self.output[offset..offset + STRIDE].copy_from_slice(&[r[0], mode, goal[0], goal[1], target, recover as u8 as f64,
                if mode == 2.0 { march_speed } else { 0.0 }]);
        }
        self.output.as_ptr()
    }
    pub fn snapshot(&self) -> Vec<f64> {
        let mut data = vec![self.orders.len() as f64];
        for (&faction, o) in &self.orders {
            let phase = if o.regrouping { 4 } else { o.phase };
            data.extend_from_slice(&[faction as f64, o.leader as f64, phase as f64, o.rally[0], o.rally[1], o.objective[0], o.objective[1], o.columns as f64, o.started, o.slots.len() as f64]);
            for (&id, &slot) in &o.slots { data.extend_from_slice(&[id as f64, slot as f64]); }
            data.push(o.routing.len() as f64);
            data.extend(o.routing.iter().map(|&id| id as f64));
            data.push(o.assembling.len() as f64);
            data.extend(o.assembling.iter().map(|&id| id as f64));
        }
        data.push(self.recovery.len() as f64);
        for (&faction, &count) in &self.recovery { data.extend_from_slice(&[faction as f64, count]); }
        let marching = self.orders.iter().filter(|(_, o)| o.phase == 2).count();
        if !self.ready_at.is_empty() || marching > 0 {
            data.push(self.ready_at.len() as f64);
            for (&faction, &ready) in &self.ready_at { data.extend_from_slice(&[faction as f64, ready]); }
        }
        if marching > 0 {
            data.push(marching as f64);
            for (&faction, o) in self.orders.iter().filter(|(_, o)| o.phase == 2) {
                data.extend_from_slice(&[faction as f64, o.march.anchor[0], o.march.anchor[1], o.march.goals.len() as f64]);
                for (&id, &[x, y]) in &o.march.goals { data.extend_from_slice(&[id as f64, x, y]); }
            }
        }
        data
    }
    pub fn restore(data: &[f64]) -> Option<Self> {
        let mut value = Self::default(); let mut cursor = 0;
        let read = |cursor: &mut usize| { let n = *data.get(*cursor)?; *cursor += 1; n.is_finite().then_some(n) };
        let count = read(&mut cursor)? as usize;
        for _ in 0..count {
            let faction = read(&mut cursor)? as i32; let leader = read(&mut cursor)? as i64; let phase = read(&mut cursor)? as u32;
            let rally = [read(&mut cursor)?, read(&mut cursor)?]; let objective = [read(&mut cursor)?, read(&mut cursor)?];
            let columns = read(&mut cursor)? as usize; let started = read(&mut cursor)?;
            if columns == 0 || !(1..=4).contains(&phase) { return None; }
            let regrouping = phase == 4;
            let phase = if regrouping { 1 } else { phase };
            let count = read(&mut cursor)? as usize; let mut slots = BTreeMap::new();
            for _ in 0..count { slots.insert(read(&mut cursor)? as i64, read(&mut cursor)? as usize); }
            let count = read(&mut cursor)? as usize; let mut routing = BTreeSet::new();
            for _ in 0..count { routing.insert(read(&mut cursor)? as i64); }
            let count = read(&mut cursor)? as usize; let mut assembling = BTreeSet::new();
            for _ in 0..count { assembling.insert(read(&mut cursor)? as i64); }
            value.orders.insert(faction, Offensive { leader, phase, rally, objective, columns, started, slots, goals: BTreeMap::new(), routing, approaches: BTreeMap::new(), assembling, regrouping, march: March::new(rally) });
        }
        let count = read(&mut cursor)? as usize;
        for _ in 0..count { value.recovery.insert(read(&mut cursor)? as i32, read(&mut cursor)?.max(0.0)); }
        // New scenarios have no offensive cooldowns to persist.
        let count = if cursor < data.len() { read(&mut cursor)? as usize } else { 0 };
        for _ in 0..count { value.ready_at.insert(read(&mut cursor)? as i32, read(&mut cursor)?); }
        let count = if cursor < data.len() { read(&mut cursor)? as usize } else { 0 };
        for _ in 0..count {
            let order = value.orders.get_mut(&(read(&mut cursor)? as i32))?;
            order.march.anchor = [read(&mut cursor)?, read(&mut cursor)?];
            for _ in 0..read(&mut cursor)? as usize {
                order.march.goals.insert(read(&mut cursor)? as i64, [read(&mut cursor)?, read(&mut cursor)?]);
            }
        }
        (cursor == data.len()).then_some(value)
    }
}

fn gap(from: Point, to: Point) -> f64 { (from[0] - to[0]).hypot(from[1] - to[1]) }
fn cell(point: Point) -> Cell { (point[0].floor() as i32, point[1].floor() as i32) }
fn center(cell: Cell) -> Point { [cell.0 as f64 + 0.5, cell.1 as f64 + 0.5] }
fn field_cannon(member: &[f64]) -> bool { member[7] as u32 == unit_kind::FIELD_CANNON }

fn segment_clear(from: Point, to: Point, clear: &mut impl FnMut(f64, f64, f64, f64) -> bool) -> bool {
    clear(from[0], from[1], to[0], to[1])
}

fn rank_point(slot: usize, columns: usize, rows: usize, anchor: Point, facing: f64) -> Point {
    let (sin, cos) = facing.sin_cos();
    let side = (slot % columns) as f64 - (columns - 1) as f64 / 2.0;
    let forward = (slot / columns) as f64 - (rows - 1) as f64 / 2.0;
    [anchor[0] + (forward * cos - side * sin) * 1.05, anchor[1] + (forward * sin + side * cos) * 1.05]
}

fn connected_ground(anchor: Point, radius: i32, clear: &mut impl FnMut(f64, f64, f64, f64) -> bool) -> BTreeSet<Cell> {
    let origin = cell(anchor);
    let mut ground = BTreeSet::new();
    let mut frontier = VecDeque::new();
    if segment_clear(anchor, anchor, clear) {
        ground.insert(origin);
        frontier.push_back(origin);
    }
    while let Some((x, y)) = frontier.pop_front() {
        for (dx, dy) in [(0, -1), (1, 0), (0, 1), (-1, 0)] {
            let next = (x + dx, y + dy);
            if (next.0 - origin.0).abs() > radius || (next.1 - origin.1).abs() > radius || ground.contains(&next) { continue; }
            if segment_clear(center((x, y)), center(next), clear) {
                ground.insert(next);
                frontier.push_back(next);
            }
        }
    }
    ground
}

fn reserve_slot(ground: &BTreeSet<Cell>, occupied: &mut BTreeSet<Cell>, ideal: Point, member: &[f64],
    mut reachable: impl FnMut(Point) -> bool) -> Option<Point> {
    let primary = cell(ideal);
    if ground.contains(&primary) && !occupied.contains(&primary) && reachable(center(primary)) {
        occupied.insert(primary);
        return Some(center(primary));
    }
    let position = [member[1], member[2]];
    let travel_weight = if member[7] as u32 == unit_kind::FIELD_CANNON { 0.15 } else { 0.02 };
    let mut best = None;
    for &slot in ground {
        if occupied.contains(&slot) || slot == primary { continue; }
        let point = center(slot);
        let score = gap(point, ideal).powi(2) + gap(point, position) * travel_weight;
        if best.is_none_or(|(best_score, _)| score < best_score) && reachable(point) {
            best = Some((score, slot));
        }
    }
    let (_, slot) = best?;
    occupied.insert(slot);
    Some(center(slot))
}

fn nearest_enemy<'a>(tree: &RTree<Enemy<'a>>, position: [f64; 2], radius: f64) -> Option<&'a [f64]> {
    let mut neighbors = tree.nearest_neighbor_iter_with_distance_2(position);
    let (first, distance) = neighbors.next()?;
    if distance > radius * radius { return None; }
    // Preserve the lower entity ID on distance ties.
    Some(neighbors.take_while(|(_, next)| *next == distance)
        .map(|(enemy, _)| enemy.data).chain(std::iter::once(first.data))
        .min_by(|a, b| a[0].total_cmp(&b[0])).unwrap_or(first.data))
}

fn enemy_bounds(row: &[f64]) -> (Point, Point) {
    let (x, y) = (row[1], row[2]);
    if row[4] == 0.0 {
        ([x - 0.5, y - 0.5], [x + 0.5, y + 0.5])
    } else {
        ([x, y], [x + row[5], y + row[6]])
    }
}

fn enemy_distance(enemy: &[f64], position: Point) -> f64 {
    let (lo, hi) = enemy_bounds(enemy);
    Rectangle::from_corners(lo, hi).distance_2(&position).sqrt()
}

fn segment_entry(from: Point, to: Point, lo: Point, hi: Point) -> Option<f64> {
    let (mut entry, mut exit) = (0.0_f64, 1.0_f64);
    for axis in 0..2 {
        let movement = to[axis] - from[axis];
        if movement == 0.0 {
            if from[axis] < lo[axis] || from[axis] >= hi[axis] { return None; }
            continue;
        }
        let a = (lo[axis] - from[axis]) / movement;
        let b = (hi[axis] - from[axis]) / movement;
        entry = entry.max(a.min(b));
        exit = exit.min(a.max(b));
        if entry >= exit {
            let lands_inside = entry == 1.0 && exit == 1.0 && (0..2).all(|i| to[i] >= lo[i] && to[i] < hi[i]);
            return lands_inside.then_some(entry);
        }
    }
    Some(entry)
}

fn blocking_enemy<'a>(tree: &RTree<Enemy<'a>>, from: Point, to: Point,
    clear: &mut impl FnMut(f64, f64, f64, f64) -> bool) -> Option<&'a [f64]> {
    let mut static_blocked = None;
    tree.locate_in_envelope_intersecting(AABB::from_corners(from, to))
        .filter_map(|enemy| {
            let data = enemy.data;
            let (lo, hi) = enemy_bounds(data);
            let entry = segment_entry(from, to, lo, hi)?;
            let blocks = data[4] == 0.0
                || data[4] == 2.0 && *static_blocked.get_or_insert_with(|| !segment_clear(from, to, clear));
            blocks.then_some((entry, data))
        })
        .min_by(|(a, first), (b, second)| a.total_cmp(b).then_with(|| first[0].total_cmp(&second[0])))
        .map(|(_, enemy)| enemy)
}
