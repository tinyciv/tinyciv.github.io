//! A quiet escort accepts its current nearby place instead of repeatedly
//! exchanging precise parade slots or asking another resting escort to yield.
use bevy_ecs::prelude::*;
use std::collections::BTreeMap;
use super::{DecisionRevision, SimClock};

#[derive(Default)]
struct LeaderMotion { x: f64, y: f64, moved_at: f64, seen_at: f64 }
#[derive(Default)]
struct Rest { leader: i64, x: f64, y: f64, leader_x: f64, leader_y: f64, seen_at: f64, revision: f64, settled: bool }
#[derive(Resource, Default)]
pub struct RetinueSettling {
    leaders: BTreeMap<i64, LeaderMotion>,
    members: BTreeMap<i64, Rest>,
    cleaned_at: f64,
}

// Bridge flags describe observations, not host-selected settling rules.
const TRAVELING: u32 = 1;
const TARGET: u32 = 2;
const JOINING: u32 = 4;
const RECALL: u32 = 8;
const FORCED_ATTACK: u32 = 16;
const NOT_FOLLOWING: u32 = 32;
const NOT_RETINUE: u32 = 64;
const INELIGIBLE: u32 = TARGET | JOINING | RECALL | FORCED_ATTACK | NOT_FOLLOWING | NOT_RETINUE;

#[allow(clippy::too_many_arguments)]
pub fn settle(world: &mut World, leader: i64, unit: i64, x: f64, y: f64,
    goal_x: f64, goal_y: f64, leader_x: f64, leader_y: f64, flags: u32, stuck_for: f64) -> bool {
    let now = world.resource::<SimClock>().time;
    let revision = world.resource::<DecisionRevision>().0;
    let mut state = world.resource_mut::<RetinueSettling>();
    // Bounded housekeeping outside the fast movement decision. Entries are
    // short-lived runtime hints, so dead escorts cannot accumulate forever.
    if now < state.cleaned_at || now - state.cleaned_at >= 30.0 {
        state.members.retain(|_, rest| now >= rest.seen_at && now - rest.seen_at <= 30.0);
        state.leaders.retain(|_, motion| now >= motion.seen_at && now - motion.seen_at <= 30.0);
        state.cleaned_at = now;
    }
    let motion = state.leaders.entry(leader).or_insert_with(|| LeaderMotion {
        x: leader_x, y: leader_y, moved_at: now, seen_at: now,
    });
    if now < motion.seen_at || (leader_x - motion.x).hypot(leader_y - motion.y) >= 0.035 {
        motion.x = leader_x; motion.y = leader_y; motion.moved_at = now;
    }
    motion.seen_at = now;
    let quiet = now - motion.moved_at;
    let rest = state.members.entry(unit).or_default();
    let leader_distance = (leader_x - x).hypot(leader_y - y);
    let goal_distance = (goal_x - x).hypot(goal_y - y);
    let radius = (4.25_f64).max((goal_x - leader_x).hypot(goal_y - leader_y) + 0.75).min(9.0);
    let allowed = flags & (TRAVELING | INELIGIBLE) == 0 && quiet >= 0.65 && leader_distance <= radius;
    if !allowed || rest.leader != leader || rest.revision != revision
        || (leader_x - rest.leader_x).hypot(leader_y - rest.leader_y) >= 0.8
        || (x - rest.x).hypot(y - rest.y) >= 1.5 { rest.settled = false; }
    if allowed && !rest.settled && (goal_distance <= 1.15 || leader_distance <= 3.25
        || stuck_for >= 0.45 || quiet >= 2.0) {
        rest.settled = true;
        rest.x = x; rest.y = y;
        rest.leader_x = leader_x; rest.leader_y = leader_y;
    }
    rest.leader = leader; rest.revision = revision; rest.seen_at = now;
    rest.settled
}

/// A newcomer outside the resting group, a worker or the Leader can still
/// request passage. Nearby resting escorts do not start reciprocal sidesteps.
pub fn yield_allowed(world: &World, requester: i64, blocker: i64, x: f64, y: f64, flags: u32) -> bool {
    if flags & INELIGIBLE != 0 { return true; }
    let now = world.resource::<SimClock>().time;
    let state = world.resource::<RetinueSettling>();
    let Some(rest) = state.members.get(&blocker) else { return true; };
    let Some(motion) = state.leaders.get(&rest.leader) else { return true; };
    if !rest.settled || now < rest.seen_at || now - rest.seen_at > 0.75
        || now - motion.moved_at < 0.65 || (x - motion.x).hypot(y - motion.y) > 4.25 { return true; }
    // If requester already has a rest record, it must belong to this company.
    !state.members.get(&requester).is_some_and(|other| other.leader == rest.leader)
}
