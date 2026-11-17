//! Officer-led offensives. Coarse observations supply the indexed retinue and
//! objective neighborhood; persistent orders, slots and recovery debt live here.
use bevy_ecs::prelude::*;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use super::kinds::unit as unit_kind;

pub const STRIDE: usize = 7;
const MEMBER: usize = 8;
pub const HEADER: usize = 8;
pub const RADIUS: f64 = 6.0;

#[derive(Clone)]
struct Approach { x: f64, y: f64, goal: [f64; 2], gap: f64, at: f64 }
#[derive(Clone)]
struct Offensive {
    leader: i64, phase: u32, rally: [f64; 2], objective: [f64; 2],
    slots: BTreeMap<i64, usize>, columns: usize, started: f64, goals: BTreeMap<i64, [f64; 2]>, routing: BTreeSet<i64>,
    approaches: BTreeMap<i64, Approach>, assembling: BTreeSet<i64>,
}
#[derive(Clone, Copy)]
pub struct Navigation { pub engine: u32, pub grid: u32, pub blockers: u32, pub forbidden: u32 }
#[derive(Resource, Default)]
pub struct Offensives {
    orders: BTreeMap<i32, Offensive>, recovery: BTreeMap<i32, f64>,
    input: Vec<f64>, output: Vec<f64>,
    pub navigation: Option<Navigation>,
}
impl Offensives {
    pub fn begin(&mut self, faction: i32, leader: i64, rally: [f64; 2], objective: [f64; 2], unlocked: bool, now: f64) -> bool {
        if !unlocked || faction < 0 || !rally.into_iter().chain(objective).all(f64::is_finite) { return false; }
        self.orders.insert(faction, Offensive { leader, phase: 1, rally, objective, slots: BTreeMap::new(), columns: 1, started: now, goals: BTreeMap::new(), routing: BTreeSet::new(), approaches: BTreeMap::new(), assembling: BTreeSet::new() });
        true
    }
    pub fn cancel(&mut self, faction: i32) { self.orders.remove(&faction); }
    pub fn clear(&mut self) { self.orders.clear(); self.recovery.clear(); }
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
    pub fn status(&mut self, faction: i32) -> *const f64 {
        self.output.resize(HEADER, 0.0); self.output.fill(0.0);
        if let Some(o) = self.orders.get(&faction) {
            self.output[..HEADER].copy_from_slice(&[o.phase as f64, o.rally[0], o.rally[1], o.objective[0], o.objective[1], 0.0, (o.phase == 3) as u8 as f64, o.leader as f64]);
        }
        self.output.as_ptr()
    }
    /// Member input: id,x,y,hp,routing,morale,eligible,kind. Enemy input:
    /// id,x,y,hp,isBuilding,width,height. Output header is status, followed by
    /// id,mode(1 rally/2 advance/3 fight/4 hold),x,y,target,recoverRout,0.
    pub fn step(&mut self, faction: i32, now: f64, members: usize, enemies: usize, expected: usize, mut clear: impl FnMut(f64, f64, f64, f64) -> bool) -> *const f64 {
        assert!(members * MEMBER + enemies * STRIDE <= self.input.len());
        let Some(o) = self.orders.get_mut(&faction) else { return self.status(faction); };
        let roster: Vec<&[f64]> = self.input[..members * MEMBER].chunks_exact(MEMBER).filter(|r| r[3] > 0.0 && r[6] != 0.0).collect();
        let alive: BTreeSet<i64> = roster.iter().map(|r| r[0] as i64).collect();
        o.slots.retain(|id, _| alive.contains(id));
        o.assembling.retain(|id| alive.contains(id));
        if o.slots.is_empty() { o.columns = ((expected.max(roster.len()) as f64).sqrt().ceil() as usize).max(1); }
        let by_id: BTreeMap<i64, &[f64]> = roster.iter().map(|r| (r[0] as i64, *r)).collect();
        let mut new_ids: Vec<i64> = alive.iter().filter(|id| !o.slots.contains_key(*id)).copied().collect();
        new_ids.sort_by_key(|id| (by_id[id][7] as u32 != unit_kind::FIELD_CANNON, *id));
        let mut taken: BTreeSet<usize> = o.slots.values().copied().collect();
        for id in new_ids {
            let slot = (0..).find(|s| !taken.contains(s)).unwrap(); taken.insert(slot); o.slots.insert(id, slot);
            o.assembling.insert(id);
        }
        let dx = o.objective[0] - o.rally[0]; let dy = o.objective[1] - o.rally[1];
        let heading = dy.atan2(dx); let (sin, cos) = heading.sin_cos();
        let rows = expected.max(roster.len()).div_ceil(o.columns).max(1);
        let slot_point = |slot: usize, anchor: [f64; 2]| {
            let side = (slot % o.columns) as f64 - (o.columns - 1) as f64 / 2.0;
            let forward = (slot / o.columns) as f64 - (rows - 1) as f64 / 2.0;
            [anchor[0] + (forward * cos - side * sin) * 0.9, anchor[1] + (forward * sin + side * cos) * 0.9]
        };
        // Clear tiles can be isolated behind a wall, ledge or water. Flood a
        // bounded local patch once per observation, so the whole formation
        // uses connected ground instead of independently snapping its posts.
        let origin = (o.rally[0].floor() as i32, o.rally[1].floor() as i32);
        let radius = ((expected.max(roster.len()) as f64).sqrt().ceil() as i32 + 3).clamp(6, 12);
        let mut connected = BTreeSet::new();
        let mut frontier = VecDeque::new();
        if clear(o.rally[0], o.rally[1], o.rally[0], o.rally[1]) { connected.insert(origin); frontier.push_back(origin); }
        while let Some((x, y)) = frontier.pop_front() {
            for (dx, dy) in [(0, -1), (1, 0), (0, 1), (-1, 0)] {
                let next = (x + dx, y + dy);
                if (next.0 - origin.0).abs() > radius || (next.1 - origin.1).abs() > radius || connected.contains(&next) { continue; }
                if clear(x as f64 + 0.5, y as f64 + 0.5, next.0 as f64 + 0.5, next.1 as f64 + 0.5) {
                    connected.insert(next); frontier.push_back(next);
                }
            }
        }
        o.goals.retain(|id, _| alive.contains(id));
        o.approaches.retain(|id, _| alive.contains(id));
        let mut occupied = BTreeSet::new();
        let mut stalled_ids = BTreeSet::new();
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
                if stalled { stalled_ids.insert(id); }
                if connected.contains(&cell) && !stalled && occupied.insert(cell) { continue; }
            }
            let current = (member[1].floor() as i32, member[2].floor() as i32);
            let ideal = if stalled && connected.contains(&current) { [member[1], member[2]] } else { slot_point(slot, o.rally) };
            let score = |cell: &&(i32, i32)| {
                let x = cell.0 as f64 + 0.5; let y = cell.1 as f64 + 0.5;
                (x - ideal[0]).powi(2) + (y - ideal[1]).powi(2)
                    + (x - member[1]).hypot(y - member[2]) * if member[7] as u32 == unit_kind::FIELD_CANNON { 0.15 } else { 0.02 }
            };
            let cell = connected.iter().filter(|cell| !occupied.contains(*cell)).min_by(|a, b| score(a).total_cmp(&score(b)).then(a.cmp(b)))
                .or_else(|| connected.iter().min_by(|a, b| score(a).total_cmp(&score(b)).then(a.cmp(b))));
            let goal = cell.map_or([member[1], member[2]], |cell| { occupied.insert(*cell); [cell.0 as f64 + 0.5, cell.1 as f64 + 0.5] });
            let (x, y, at) = o.approaches.get(&id).map_or((member[1], member[2], now), |approach| (approach.x, approach.y, approach.at));
            o.goals.insert(id, goal);
            o.approaches.insert(id, Approach { x, y, goal, gap: (member[1] - goal[0]).hypot(member[2] - goal[1]), at });
        }
        let nearby: Vec<&[f64]> = self.input[members * MEMBER..members * MEMBER + enemies * STRIDE].chunks_exact(STRIDE).filter(|r| r[3] > 0.0).collect();
        let threats: Vec<&[f64]> = nearby.iter().copied().filter(|r| {
            let (x, y) = if r[4] != 0.0 { (o.objective[0].clamp(r[1], r[1] + r[5]), o.objective[1].clamp(r[2], r[2] + r[6])) } else { (r[1], r[2]) };
            (x - o.objective[0]).hypot(y - o.objective[1]) <= RADIUS
        }).collect();
        // One broken contingent causes a coordinated withdrawal. Every survivor
        // has to return, apart from the explicit two-soldier missing tolerance.
        let routing: BTreeSet<i64> = roster.iter().filter(|r| r[4] != 0.0).map(|r| r[0] as i64).collect();
        if o.phase == 2 && routing.iter().any(|id| !o.routing.contains(id)) { o.phase = 1; o.started = now; }
        o.routing.extend(routing);
        // Morale may recover en route. Keep that soldier's return assignment
        // until it physically reaches its rally slot before rejoining an attack.
        o.routing.retain(|id| roster.iter().any(|r| {
            if r[0] as i64 != *id { return false; }
            let goal = o.goals[id];
            r[4] != 0.0 || (r[1] - goal[0]).hypot(r[2] - goal[1]) > 1.5
        }));
        let ready_ids: BTreeSet<i64> = roster.iter().filter(|r| {
            let goal = o.goals[&(r[0] as i64)];
            connected.contains(&(r[1].floor() as i32, r[2].floor() as i32))
                && (r[1] - goal[0]).hypot(r[2] - goal[1]) <= 1.35 && (r[4] == 0.0 || r[5] >= 49.0)
        }).map(|r| r[0] as i64).collect();
        o.assembling.retain(|id| !ready_ids.contains(id));
        let full = expected.max(roster.len()).max(1);
        let required = full.saturating_sub(2).max(1);
        // Slow artillery still approaching must not consume the allowance for
        // genuinely missing soldiers. Give stalled posts time to be reassigned,
        // then permit at most two exceptions. Late arrivals keep their rally
        // assignment until they have physically joined the formation once.
        let missing_stalled = now - o.started >= 8.0 && roster.iter().all(|r| {
            let id = r[0] as i64;
            ready_ids.contains(&id) || stalled_ids.contains(&id)
        });
        if o.phase == 1 && now - o.started >= 1.0 && (ready_ids.len() >= full || ready_ids.len() >= required && missing_stalled) { o.phase = 2; }
        let flag_taken = roster.iter().any(|r| r[4] == 0.0 && (r[1] - o.objective[0]).hypot(r[2] - o.objective[1]) <= 1.0);
        if o.phase == 2 && threats.is_empty() && flag_taken { o.phase = 3; }
        self.output.resize(HEADER + roster.len() * STRIDE, 0.0);
        self.output[..HEADER].copy_from_slice(&[o.phase as f64, o.rally[0], o.rally[1], o.objective[0], o.objective[1], roster.len() as f64, (o.phase == 3) as u8 as f64, o.leader as f64]);
        for (index, r) in roster.iter().enumerate() {
            let rally = o.goals[&(r[0] as i64)];
            let recover = r[4] != 0.0 && r[5] >= 49.0 && (r[1] - rally[0]).hypot(r[2] - rally[1]) <= 1.5;
            let (mode, goal, target) = if o.phase == 1 || r[4] != 0.0 || o.routing.contains(&(r[0] as i64)) || o.assembling.contains(&(r[0] as i64)) { (1.0, rally, -1.0) }
            else if o.phase == 3 { (4.0, slot_point(o.slots[&(r[0] as i64)], o.objective), -1.0) }
            else if let Some(target) = nearby.iter().filter(|t| target_distance(r[1], r[2], t) <= 5.5).min_by(|a, b| {
                target_distance(r[1], r[2], a).total_cmp(&target_distance(r[1], r[2], b)).then_with(|| a[0].total_cmp(&b[0]))
            }).or_else(|| threats.iter().min_by(|a, b| {
                target_distance(r[1], r[2], a).total_cmp(&target_distance(r[1], r[2], b)).then_with(|| a[0].total_cmp(&b[0]))
            })) { (3.0, [target[1], target[2]], target[0]) }
            else {
                // One soldier takes the flag; the remaining ranks keep their
                // distinct slots rather than all walking onto the same point.
                let goal = if index == 0 { o.objective } else { slot_point(o.slots[&(r[0] as i64)], o.objective) };
                (2.0, goal, -1.0)
            };
            let offset = HEADER + index * STRIDE;
            self.output[offset..offset + STRIDE].copy_from_slice(&[r[0], mode, goal[0], goal[1], target, recover as u8 as f64, 0.0]);
        }
        self.output.as_ptr()
    }
    pub fn snapshot(&self) -> Vec<f64> {
        let mut data = vec![self.orders.len() as f64];
        for (&faction, o) in &self.orders {
            data.extend_from_slice(&[faction as f64, o.leader as f64, o.phase as f64, o.rally[0], o.rally[1], o.objective[0], o.objective[1], o.columns as f64, o.started, o.slots.len() as f64]);
            for (&id, &slot) in &o.slots { data.extend_from_slice(&[id as f64, slot as f64]); }
            data.push(o.routing.len() as f64);
            data.extend(o.routing.iter().map(|&id| id as f64));
            data.push(o.assembling.len() as f64);
            data.extend(o.assembling.iter().map(|&id| id as f64));
        }
        data.push(self.recovery.len() as f64);
        for (&faction, &count) in &self.recovery { data.extend_from_slice(&[faction as f64, count]); }
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
            if columns == 0 || !(1..=3).contains(&phase) { return None; }
            let count = read(&mut cursor)? as usize; let mut slots = BTreeMap::new();
            for _ in 0..count { slots.insert(read(&mut cursor)? as i64, read(&mut cursor)? as usize); }
            let count = read(&mut cursor)? as usize; let mut routing = BTreeSet::new();
            for _ in 0..count { routing.insert(read(&mut cursor)? as i64); }
            let count = read(&mut cursor)? as usize; let mut assembling = BTreeSet::new();
            for _ in 0..count { assembling.insert(read(&mut cursor)? as i64); }
            value.orders.insert(faction, Offensive { leader, phase, rally, objective, columns, started, slots, goals: BTreeMap::new(), routing, approaches: BTreeMap::new(), assembling });
        }
        let count = read(&mut cursor)? as usize;
        for _ in 0..count { value.recovery.insert(read(&mut cursor)? as i32, read(&mut cursor)?.max(0.0)); }
        (cursor == data.len()).then_some(value)
    }
}

fn target_distance(x: f64, y: f64, target: &[f64]) -> f64 {
    let (tx, ty) = if target[4] != 0.0 { (x.clamp(target[1], target[1] + target[5]), y.clamp(target[2], target[2] + target[6])) }
        else { (target[1], target[2]) };
    (x - tx).hypot(y - ty)
}
