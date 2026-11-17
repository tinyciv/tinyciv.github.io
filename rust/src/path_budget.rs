//! Ordered path admission is simulation state. A denied request is deferred,
//! never an unreachable route. No wall-clock timing determines fairness.
use bevy_ecs::prelude::*;
use std::collections::BTreeMap;

/// Path searches admitted per simulation step. Eight starved large battles:
/// re-plans toward moving targets queued for several steps (2026-11-13 experiments).
pub const REQUESTS_PER_UPDATE: usize = 32;

#[derive(Component)]
struct Request {
    token: i64,
    requested: u64,
    retry_window: u64,
    eligible: bool,
    granted: bool,
    expired: bool,
}
#[derive(Resource, Default)]
struct Order(Vec<Entity>);
#[derive(Resource, Default)]
struct Frame { number: u64, remaining: usize, active: bool }

fn admit(frame: Res<Frame>, order: Res<Order>, mut requests: Query<&mut Request>) {
    let mut remaining = frame.remaining;
    for entity in &order.0 {
        let Ok(mut request) = requests.get_mut(*entity) else { continue; };
        request.granted = false;
        request.expired = !request.eligible || request.requested + request.retry_window < frame.number;
        if !request.expired && remaining > 0 { request.granted = true; remaining -= 1; }
    }
}

pub struct PathScheduler {
    world: World,
    schedule: Schedule,
    entries: BTreeMap<i64, Entity>,
    input: Vec<f64>,
    removed: Vec<f64>,
}
impl Default for PathScheduler {
    fn default() -> Self {
        let mut world = World::new(); world.init_resource::<Frame>(); world.init_resource::<Order>();
        let mut schedule = Schedule::default(); schedule.add_systems(admit);
        Self { world, schedule, entries: BTreeMap::new(), input: Vec::new(), removed: Vec::new() }
    }
}
impl PathScheduler {
    /// Host writes live eligibility and cohort retry windows for queued actors.
    /// Only queued requests are visited, never all units in the world.
    pub fn input(&mut self) -> *mut f64 {
        self.world.resource_scope(|world, mut order: Mut<Order>| {
            order.0.retain(|entity| world.get::<Request>(*entity).is_some());
        });
        self.input.clear();
        for entity in &self.world.resource::<Order>().0 {
            let request = self.world.get::<Request>(*entity).expect("queued actor");
            self.input.extend_from_slice(&[request.token as f64, 1.0, request.retry_window as f64]);
        }
        self.input.as_mut_ptr()
    }
    pub fn count(&self) -> usize { self.entries.len() }
    pub fn begin(&mut self) -> *const f64 {
        for values in self.input.chunks_exact(3) {
            if let Some(entity) = self.entries.get(&(values[0] as i64)) {
                let mut request = self.world.get_mut::<Request>(*entity).expect("request metadata");
                request.eligible = values[1] != 0.0;
                request.retry_window = values[2] as u64;
            }
        }
        {
            let mut frame = self.world.resource_mut::<Frame>();
            frame.number += 1; frame.remaining = REQUESTS_PER_UPDATE; frame.active = true;
        }
        self.schedule.run(&mut self.world);
        self.removed.clear();
        let entries = &mut self.entries; let removed = &mut self.removed;
        let mut granted = 0;
        self.world.resource_scope(|world, mut order: Mut<Order>| {
            order.0.retain(|entity| {
                let Some(request) = world.get::<Request>(*entity) else { return false; };
                let token = request.token;
                if request.expired {
                    removed.push(token as f64); entries.remove(&token); world.despawn(*entity); false
                } else { if request.granted { granted += 1; } true }
            });
        });
        self.world.resource_mut::<Frame>().remaining -= granted;
        self.removed.as_ptr()
    }
    pub fn removed_count(&self) -> usize { self.removed.len() }
    pub fn end(&mut self) { self.world.resource_mut::<Frame>().active = false; }
    fn remove(&mut self, token: i64) {
        if let Some(entity) = self.entries.remove(&token) {
            // Compact tombstones once per admission batch, rather than
            // rescanning the entire FIFO for every consumed grant.
            self.world.despawn(entity);
        }
    }
    /// 0: deferred, 1: admitted and removed from pending, 2: scope bypass.
    pub fn request(&mut self, token: i64, immediate: bool) -> u32 {
        let frame = self.world.resource::<Frame>();
        if !frame.active || immediate { return 2; }
        if let Some(entity) = self.entries.get(&token) {
            if self.world.get::<Request>(*entity).expect("pending request").granted {
                self.remove(token); return 1;
            }
        }
        if frame.remaining > 0 {
            self.world.resource_mut::<Frame>().remaining -= 1;
            self.remove(token); return 1;
        }
        let number = self.world.resource::<Frame>().number;
        if let Some(entity) = self.entries.get(&token) {
            self.world.get_mut::<Request>(*entity).expect("pending actor").requested = number;
        } else {
            let entity = self.world.spawn(Request { token, requested: number, retry_window: 1,
                eligible: true, granted: false, expired: false }).id();
            self.entries.insert(token, entity); self.world.resource_mut::<Order>().0.push(entity);
        }
        0
    }
}

#[derive(Default)]
pub struct Schedulers { next_handle: u32, values: BTreeMap<u32, PathScheduler> }
impl Schedulers {
    pub fn create(&mut self) -> u32 {
        self.next_handle = self.next_handle.checked_add(1).expect("path scheduler handle overflow");
        self.values.insert(self.next_handle, PathScheduler::default()); self.next_handle
    }
    pub fn drop_scheduler(&mut self, handle: u32) { self.values.remove(&handle); }
    pub fn get(&self, handle: u32) -> &PathScheduler { self.values.get(&handle).expect("path scheduler") }
    pub fn get_mut(&mut self, handle: u32) -> &mut PathScheduler { self.values.get_mut(&handle).expect("path scheduler") }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reserves_fifo_admissions_before_new_arrivals() {
        let mut scheduler = PathScheduler::default(); scheduler.input(); scheduler.begin();
        let n = REQUESTS_PER_UPDATE as i64;
        for token in 0..n { assert_eq!(scheduler.request(token, false), 1); }
        for token in n..2 * n + 4 { assert_eq!(scheduler.request(token, false), 0); }
        scheduler.end(); scheduler.input(); scheduler.begin();
        assert_eq!(scheduler.request(9_999, false), 0);
        for token in (n..2 * n).rev() { assert_eq!(scheduler.request(token, false), 1); }
        assert_eq!(scheduler.request(2 * n, false), 0);
        assert_eq!(scheduler.count(), 5);
    }
    #[test]
    fn hidden_cohort_reservations_survive_their_update_window() {
        let mut scheduler = PathScheduler::default(); scheduler.input(); scheduler.begin();
        for token in 0..REQUESTS_PER_UPDATE as i64 { scheduler.request(token, false); }
        scheduler.request(9_999, false); scheduler.end();
        for frame in 0..5 {
            scheduler.input(); scheduler.input[2] = 5.0; scheduler.begin();
            if frame == 4 { assert_eq!(scheduler.request(9_999, false), 1); }
            scheduler.end();
        }
        assert_eq!(scheduler.count(), 0);
    }
    #[test]
    fn dead_actors_expire_and_immediate_requests_do_not_spend_budget() {
        let mut scheduler = PathScheduler::default();
        assert_eq!(scheduler.request(1, false), 2);
        scheduler.input(); scheduler.begin();
        for _ in 0..20 { assert_eq!(scheduler.request(1, true), 2); }
        for token in 0..REQUESTS_PER_UPDATE as i64 { assert_eq!(scheduler.request(token, false), 1); }
        assert_eq!(scheduler.request(9_999, false), 0); scheduler.end();
        scheduler.input(); scheduler.input[1] = 0.0; scheduler.begin();
        assert_eq!(scheduler.removed, vec![9_999.0]); assert_eq!(scheduler.count(), 0);
        assert_eq!(scheduler.request(10_000, false), 1);
    }
}
