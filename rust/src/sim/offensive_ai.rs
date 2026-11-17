//! Faction Officer Corps policy. Indexed host observations and the existing
//! breach-capable route are inputs; readiness, targets and flags are native.
use bevy_ecs::prelude::*;
use std::collections::BTreeMap;
use super::kinds::building as b;

pub const HEADER: usize = 13;
pub const MEMBER: usize = 7;
pub const TARGET: usize = 8;
pub const OUTPUT: usize = 8;

#[derive(Default)]
struct Plan {
    next_at: f64, target: Option<i64>, objective: [f64; 2], rally: [f64; 2], support: [f64; 2], leader_goal: [f64; 2],
    expected: usize, launched: bool, captured: bool, launch_after: f64, bans: BTreeMap<i64, f64>,
}
#[derive(Resource, Default)]
pub struct OffensiveAi { plans: BTreeMap<i32, Plan>, input: Vec<f64>, path: Vec<f64>, output: [f64; OUTPUT] }
impl OffensiveAi {
    pub fn due(&mut self, faction: i32, now: f64) -> bool {
        let plan = self.plans.entry(faction).or_default();
        if now < plan.next_at { return false; }
        plan.next_at = now + 1.0; true
    }
    pub fn prepare(&mut self, members: usize, targets: usize) -> *mut f64 {
        self.input.resize(HEADER + members * MEMBER + targets * TARGET, 0.0); self.input.as_mut_ptr()
    }
    pub fn path_input(&mut self, count: usize) -> *mut f64 { self.path.resize(count * 2, 0.0); self.path.as_mut_ptr() }
    fn publish(&mut self, faction: i32, action: u32) -> *const f64 {
        self.output = [0.0; OUTPUT];
        if let Some(plan) = self.plans.get(&faction) {
            self.output = [action as f64, plan.target.map_or(-1.0, |id| id as f64), plan.objective[0], plan.objective[1],
                plan.rally[0], plan.rally[1], plan.leader_goal[0], plan.leader_goal[1]];
        }
        self.output.as_ptr()
    }
    pub fn status(&mut self, faction: i32) -> *const f64 {
        let action = if self.plans.get(&faction).is_some_and(|p| p.launched && !p.captured) { 2 } else { 0 };
        self.publish(faction, action)
    }
    /// Header: leaderId,x,y,hp,maxHp,morale,unavailable,expected,homeX,Y,
    /// eligibleFaction,unlocked,targetAllegiance(-1 missing/dead,0 friendly,1 hostile).
    /// Members: id,x,y,hp,maxHp,morale,unavailable.
    /// Targets: id,x,y,width,height,kind,hp,seen. Cities are strategic knowledge;
    /// a standalone military objective requires an actual observation.
    pub fn select(&mut self, faction: i32, now: f64, members: usize, targets: usize,
        current: Option<(u32, [f64; 2], [f64; 2])>) -> *const f64 {
        assert!(HEADER + members * MEMBER + targets * TARGET <= self.input.len());
        let v = &self.input;
        let plan = self.plans.entry(faction).or_default();
        if v[10] == 0.0 || v[11] == 0.0 || v[3] <= 0.0 {
            let cancel = plan.launched; plan.launched = false; plan.target = None;
            return self.publish(faction, if cancel { 4 } else { 0 });
        }
        let candidates = &v[HEADER + members * MEMBER..HEADER + members * MEMBER + targets * TARGET];
        if let Some((phase, rally, objective)) = current {
            if phase != 3 {
                if plan.target.is_some() && v[12] == 0.0 {
                    plan.launched = false; plan.target = None; plan.launch_after = now + 1.0;
                    return self.publish(faction, 4);
                }
                if !plan.launched { plan.support = rally; }
                plan.launched = true; plan.rally = rally; plan.objective = objective;
                // The Leader supports from behind the rally. Existing native
                // health/morale recovery remains free to take him back home.
                plan.leader_goal = if v[3] < v[4] * 0.4 || v[5] < 40.0 { [v[8], v[9]] } else { plan.support };
                return self.publish(faction, 2);
            }
            if !plan.captured { plan.captured = true; plan.launched = false; plan.launch_after = now + 1.0; }
        } else { plan.launched = false; }
        if now < plan.launch_after || v[6] != 0.0 || v[3] < v[4] * 0.55 || v[5] < 55.0 { return self.publish(faction, 0); }
        plan.expected = v[7].max(0.0) as usize;
        let ready = v[HEADER..HEADER + members * MEMBER].chunks_exact(MEMBER)
            .filter(|r| r[6] == 0.0 && r[3] >= r[4] * 0.55 && r[5] >= 55.0).count();
        if ready < plan.expected.saturating_sub(2).max(2) { return self.publish(faction, 0); }
        plan.bans.retain(|_, until| now < *until);
        let target = candidates.chunks_exact(TARGET).filter(|r| {
            r[6] > 0.0 && !plan.bans.contains_key(&(r[0] as i64)) && (r[5] as u32 == b::PALACE || r[7] != 0.0)
                && matches!(r[5] as u32, b::PALACE | b::FORT | b::WOODEN_TOWER | b::TOWER | b::BALLISTA | b::SIEGE_CANNON | b::GUARD_POST | b::MILITARY_ACADEMY)
        }).min_by(|a, b| {
            let score = |r: &[f64]| (r[1] + r[3] / 2.0 - v[1]).hypot(r[2] + r[4] / 2.0 - v[2])
                + match r[5] as u32 { b::PALACE => -40.0, b::FORT => -12.0, b::TOWER | b::WOODEN_TOWER => 2.0, _ => 10.0 };
            score(a).total_cmp(&score(b)).then_with(|| a[0].total_cmp(&b[0]))
        });
        if let Some(target) = target {
            plan.target = Some(target[0] as i64); plan.objective = [target[1] + target[3] / 2.0, target[2] + target[4] / 2.0];
            self.publish(faction, 1)
        } else { plan.target = None; self.publish(faction, 0) }
    }
    /// Choose a forward open rally along the supplied route, stopping before
    /// the first hostile wall. Clearance avoids putting ranks in tiny gaps.
    pub fn route(&mut self, faction: i32, now: f64, count: usize,
        mut clear: impl FnMut(f64, f64, f64, f64) -> bool) -> *const f64 {
        assert!(count * 2 <= self.path.len());
        let Some(plan) = self.plans.get_mut(&faction) else { return self.publish(faction, 0); };
        if plan.target.is_none() || count == 0 { self.feedback(faction, now, false); return self.publish(faction, 0); }
        let mut end = 0;
        for index in 1..count {
            let a = &self.path[(index - 1) * 2..]; let b = &self.path[index * 2..];
            if !clear(a[0], a[1], b[0], b[1]) { break; }
            end = index;
        }
        let desired = 9.0 + (plan.expected as f64).sqrt() * 0.6;
        let mut best = None;
        for index in (0..=end).step_by(2).chain(std::iter::once(end)) {
            let x = self.path[index * 2]; let y = self.path[index * 2 + 1];
            if !clear(x, y, x, y) { continue; }
            let mut space = 0;
            for dy in -2..=2 { for dx in -2..=2 {
                if clear(x + dx as f64, y + dy as f64, x + dx as f64, y + dy as f64) { space += 1; }
            } }
            let distance = (x - plan.objective[0]).hypot(y - plan.objective[1]);
            let score = (distance - desired).abs() * 2.0 + (25 - space) as f64 * 0.8 - index as f64 * 0.001;
            if best.is_none_or(|(s, _)| score < s) { best = Some((score, index)); }
        }
        let Some((_, index)) = best else { self.feedback(faction, now, false); return self.publish(faction, 0); };
        plan.rally = [self.path[index * 2], self.path[index * 2 + 1]];
        let support = index.saturating_sub(3);
        plan.support = [self.path[support * 2], self.path[support * 2 + 1]];
        plan.leader_goal = plan.support;
        self.publish(faction, 3)
    }
    pub fn feedback(&mut self, faction: i32, now: f64, launched: bool) {
        let plan = self.plans.entry(faction).or_default();
        plan.launched = launched; plan.captured = false;
        if !launched {
            if let Some(id) = plan.target { plan.bans.insert(id, now + 30.0); }
            plan.target = None; plan.launch_after = now + 1.0;
        }
    }
    pub fn snapshot(&self) -> Vec<f64> {
        let mut out = vec![self.plans.len() as f64];
        for (&faction, p) in &self.plans {
            out.extend_from_slice(&[faction as f64, p.next_at, p.target.map_or(-1.0, |id| id as f64), p.objective[0], p.objective[1],
                p.rally[0], p.rally[1], p.support[0], p.support[1], p.leader_goal[0], p.leader_goal[1], p.expected as f64, p.launched as u8 as f64, p.captured as u8 as f64, p.launch_after, p.bans.len() as f64]);
            for (&id, &until) in &p.bans { out.extend_from_slice(&[id as f64, until]); }
        }
        out
    }
    pub fn restore(data: &[f64]) -> Option<Self> {
        let mut value = Self::default(); let mut cursor = 0;
        let read = |cursor: &mut usize| { let n = *data.get(*cursor)?; *cursor += 1; n.is_finite().then_some(n) };
        let count = read(&mut cursor)? as usize;
        for _ in 0..count {
            let faction = read(&mut cursor)? as i32; let next_at = read(&mut cursor)?; let target = read(&mut cursor)?;
            let objective = [read(&mut cursor)?, read(&mut cursor)?]; let rally = [read(&mut cursor)?, read(&mut cursor)?];
            let support = [read(&mut cursor)?, read(&mut cursor)?]; let leader_goal = [read(&mut cursor)?, read(&mut cursor)?]; let expected = read(&mut cursor)? as usize;
            let launched = read(&mut cursor)? != 0.0; let captured = read(&mut cursor)? != 0.0; let launch_after = read(&mut cursor)?;
            let count = read(&mut cursor)? as usize; let mut bans = BTreeMap::new();
            for _ in 0..count { bans.insert(read(&mut cursor)? as i64, read(&mut cursor)?); }
            value.plans.insert(faction, Plan { next_at, target: (target >= 0.0).then_some(target as i64), objective, rally, support, leader_goal, expected, launched, captured, launch_after, bans });
        }
        (cursor == data.len()).then_some(value)
    }
}
