//! Bounded, resident city/fort/siege expeditions. The host supplies indexed
//! observations and normal placement results; Rust owns spending eligibility,
//! siting order, deadlines and the retained expedition goal.
use super::ai_policy::{Policy, FORTIFY_CITIES, FOUND_CITIES, OFFENSIVE_SIEGE};
use bevy_ecs::prelude::*;
use std::collections::BTreeMap;
use std::f64::consts::TAU;

pub const INPUT: usize = 37;
const CITY: usize = 1;
const SIEGE: usize = 2;
const FORT: usize = 3;
const CITY_RINGS: usize = 8;
const CITY_DIRECTIONS: usize = 32;
const APPROACH_TIMEOUT: f64 = 90.0;

#[derive(Default)]
struct SiteSearch {
    home: f64,
    target: f64,
    cursor: usize,
    heading: f64,
    site: Option<(f64, f64)>,
    approach: Option<(f64, f64)>,
    expires: f64,
}

impl SiteSearch {
    fn advance(&mut self) {
        self.cursor += 1;
        self.site = None;
        self.approach = None;
    }

    fn candidate(&self, kind: usize, x: f64, y: f64) -> (f64, f64) {
        let (direction, radius) = match kind {
            CITY => {
                let sweep = self.cursor / (CITY_RINGS * CITY_DIRECTIONS);
                let ring = self.cursor / CITY_DIRECTIONS % CITY_RINGS;
                let angle = self.cursor % CITY_DIRECTIONS;
                let offset = ((angle + 1) / 2) as f64 * if angle % 2 == 0 { -1.0 } else { 1.0 };
                let phase = (sweep % 4) as f64 / 4.0;
                (self.heading + (offset + phase) * TAU / CITY_DIRECTIONS as f64,
                    16.0 + 3.0 * ring as f64 + (sweep % 3) as f64)
            }
            _ => {
                let offset = [0., 1., -1., 2., -2., 3., -3., 4.][self.cursor % 8];
                let radii = if kind == SIEGE { [14., 16., 12.] } else { [6., 8., 4.] };
                (self.heading + offset * TAU / 8.0, radii[self.cursor / 8 % radii.len()])
            }
        };
        let (dy, dx) = direction.sin_cos();
        ((x + dx * radius).floor(), (y + dy * radius).floor())
    }
}

#[derive(Default)]
struct Expedition {
    next_at: f64,
    city_at: f64,
    kind: usize,
    sites: [SiteSearch; 3],
    siege_at: Option<f64>,
}

#[derive(Resource)]
pub struct Empire {
    plans: BTreeMap<i32, Expedition>,
    input: [f64; INPUT],
    output: [f64; 4],
}

impl Default for Empire {
    fn default() -> Self {
        Self { plans: BTreeMap::new(), input: [0.0; INPUT], output: [0.0; 4] }
    }
}

impl Empire {
    pub fn input(&mut self) -> *mut f64 { self.input.as_mut_ptr() }

    pub fn due(&mut self, faction: i32, now: f64, policy: Policy) -> bool {
        if policy.features & (FOUND_CITIES | FORTIFY_CITIES | OFFENSIVE_SIEGE) == 0 {
            self.plans.remove(&faction);
            return false;
        }
        let plan = self.plans.entry(faction).or_default();
        if now < plan.next_at { return false; }
        plan.next_at = now + 3.0;
        true
    }

    /// [gold,reserve,surplus,pop,food,cities,pendingCities,cityCost,extraCityUpkeep,
    /// siegeCount,siegeUnlocked,siegeCost,siegeUpkeep,localForts,fortCost,fortUpkeep,
    /// leaderX,Y,homeX,Y,homeId,targetX,Y,targetId,campaign,threatened,width,height,
    /// leaderHealthFraction,currentUpkeep,fortUnlocked,availableEscortCount,productiveJobs,
    /// expansionHomeX,Y,expansionHomeId,activeOffensive].
    pub fn plan(&mut self, faction: i32, now: f64, policy: Policy) -> *const f64 {
        let v = self.input;
        let p = policy.parameters;
        let plan = self.plans.entry(faction).or_default();
        let reserve = v[1] + v[29] * (p[21] - 1.0);
        let affordable = |cost: f64, upkeep: f64| {
            v[0] >= cost + reserve + upkeep * p[21] && v[2] >= upkeep + 3.0
                || v[0] >= cost + reserve + (upkeep - v[2]).max(upkeep) * p[21] * 3.0
        };
        let safe = v[25] == 0.0 && v[28] >= p[0];
        let allowed = [
            safe && policy.has(FOUND_CITIES) && v[36] == 0.0 && v[6] == 0.0 && v[5] < p[19]
                && v[31] >= 2.0 && v[32] < 4.0 && v[3] >= v[5] * p[20]
                && v[4] >= v[3] * 2.0 && now >= plan.city_at && affordable(v[7], v[8]),
            safe && policy.has(OFFENSIVE_SIEGE) && v[24] != 0.0 && v[23] >= 0.0 && v[10] != 0.0
                && v[9] < p[23] && affordable(v[11], v[12]),
            safe && policy.has(FORTIFY_CITIES) && v[30] != 0.0 && v[13] < p[24]
                && v[32] < 2.0 && affordable(v[14], v[15]),
        ];

        for (site, allowed) in plan.sites.iter_mut().zip(allowed) {
            if site.approach.is_some() && (!allowed || now >= site.expires) {
                site.advance();
            }
        }
        let retained = plan.kind > 0 && plan.sites[plan.kind - 1].approach.is_some();
        if !retained {
            plan.kind = [CITY, SIEGE, FORT].into_iter().find(|&kind| allowed[kind - 1]).unwrap_or(0);
        }
        let kind = plan.kind;
        self.output = [0.0; 4];
        if kind == 0 { return self.output.as_ptr(); }
        let site = &mut plan.sites[kind - 1];

        let (x, y, home, target, dx, dy) = match kind {
            CITY => (v[33], v[34], v[35], -1.0, v[33] + 1.0 - v[21], v[34] + 1.0 - v[22]),
            SIEGE => (v[21], v[22], -1.0, v[23], v[16] - v[21], v[17] - v[22]),
            _ => (v[18], v[19], v[20], -1.0, v[21] - v[18], v[22] - v[19]),
        };
        if site.home != home || site.target != target {
            *site = SiteSearch { home, target, heading: dy.atan2(dx), ..Default::default() };
        }
        if let Some((x, y)) = site.site.filter(|_| site.approach.is_some()) {
            self.output = [kind as f64, x, y, 1.0];
        } else {
            let (x, y) = site.candidate(kind, x, y);
            let extent = if kind == FORT { 3.0 } else { 2.0 };
            if x >= 1.0 && y >= 1.0 && x + extent < v[26] && y + extent < v[27] {
                site.site = Some((x, y));
                self.output = [kind as f64, x, y, 0.0];
            } else {
                site.advance();
            }
        }
        self.output.as_ptr()
    }

    pub fn feedback(&mut self, faction: i32, now: f64, result: u32, x: f64, y: f64) {
        let Some(plan) = self.plans.get_mut(&faction) else { return; };
        if plan.kind == 0 { return; }
        let site = &mut plan.sites[plan.kind - 1];
        match result {
            1 => {
                site.approach = Some((x, y));
                site.expires = now + APPROACH_TIMEOUT;
            }
            2 => {
                if plan.kind == CITY { plan.city_at = now + 120.0; }
                if plan.kind == SIEGE { plan.siege_at = Some(now); }
                *site = SiteSearch::default();
                plan.kind = 0;
                plan.next_at = now + 6.0;
            }
            _ => {
                site.advance();
                plan.kind = 0;
            }
        }
    }

    pub fn siege_waiting(&self, faction: i32, now: f64, last_shot: f64) -> bool {
        let deployed = self.plans.get(&faction).and_then(|plan| plan.siege_at).unwrap_or(f64::NEG_INFINITY);
        now - last_shot.max(deployed) <= 75.0
    }

    pub fn goal(&mut self, faction: i32, now: f64) -> *const f64 {
        self.output = [0.0; 4];
        if let Some(plan) = self.plans.get(&faction).filter(|plan| plan.kind > 0) {
            let site = &plan.sites[plan.kind - 1];
            if let Some((x, y)) = site.approach.filter(|_| now < site.expires) {
                self.output = [plan.kind as f64, x, y, 0.0];
            }
        }
        self.output.as_ptr()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inputs() -> [f64; INPUT] {
        let mut v = [0.0; INPUT];
        v[..9].copy_from_slice(&[2000.0, 150.0, 100.0, 50.0, 500.0, 1.0, 0.0, 100.0, 25.0]);
        v[14] = 500.0; v[15] = 30.0;
        v[16] = 40.0; v[17] = 40.0; v[18] = 40.0; v[19] = 40.0; v[20] = 10.0;
        v[21] = 80.0; v[22] = 40.0; v[23] = 20.0;
        v[26] = 120.0; v[27] = 90.0; v[28] = 1.0; v[31] = 4.0;
        v[33] = 40.0; v[34] = 40.0; v[35] = 10.0;
        v
    }

    #[test]
    fn founding_is_funded_throttled_and_retains_a_reachable_approach() {
        let mut e = Empire::default();
        let p = Policy::builtin(3).unwrap();
        e.input = inputs();
        e.input[24] = 1.0; // A prospective campaign no longer blocks founding.
        assert!(e.due(1, 0.0, p));
        assert!(!e.due(1, 0.1, p));
        e.plan(1, 0.0, p);
        assert_eq!(e.output[0], CITY as f64);
        let (x, y) = (e.output[1], e.output[2]);
        e.feedback(1, 0.0, 1, x - 0.5, y + 0.5);
        e.goal(1, 1.0);
        assert_eq!(e.output[..3], [CITY as f64, x - 0.5, y + 0.5]);
        e.feedback(1, 1.0, 2, x, y);
        e.plan(1, 2.0, p);
        assert_eq!(e.output[0], 0.0);
        e.input[0] = 99.0;
        e.plan(1, 200.0, p);
        assert_eq!(e.output[0], 0.0);
    }

    #[test]
    fn founding_sweeps_past_blocked_directions_on_the_same_ring() {
        let mut e = Empire::default();
        let p = Policy::builtin(3).unwrap();
        e.input = inputs();
        let mut points = std::collections::BTreeSet::new();
        for _ in 0..CITY_DIRECTIONS {
            e.plan(1, 0.0, p);
            assert_eq!(e.output[0], CITY as f64);
            points.insert((e.output[1] as i32, e.output[2] as i32));
            e.feedback(1, 0.0, 0, 0.0, 0.0);
        }
        assert_eq!(points.len(), CITY_DIRECTIONS);
    }

    #[test]
    fn siege_is_campaign_scoped_and_stays_in_weapon_range() {
        let mut e = Empire::default();
        let p = Policy::builtin(3).unwrap();
        e.input = inputs();
        e.input[24] = 1.0; e.input[36] = 1.0; e.input[10] = 1.0; e.input[11] = 300.0;
        e.plan(1, 0.0, p);
        assert_eq!(e.output[0], SIEGE as f64);
        assert!((e.output[1] - 80.0).hypot(e.output[2] - 40.0) < 18.0);
        e.input[9] = 2.0;
        e.plan(1, 3.0, p);
        assert_eq!(e.output[0], 0.0);
        e.input[9] = 0.0; e.input[25] = 1.0;
        e.plan(1, 6.0, p);
        assert_eq!(e.output[0], 0.0);
    }
}
