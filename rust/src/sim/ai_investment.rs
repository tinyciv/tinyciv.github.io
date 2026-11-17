//! Infrequent investment decisions. The host supplies indexed observations and
//! executes ordinary commands; eligibility, recruitment mixes and site ranking
//! stay native. Scratch buffers are bounded and owned by this game's ECS.
use bevy_ecs::prelude::*;
use super::{achievements, ai_policy::{Policy, PURCHASES}, granaries};

pub const MAX_FARMS: usize = 256;
pub const MAX_SITES: usize = 256;
const MAX_INPUT: usize = 4 + MAX_FARMS * 2;
/// 0 granary, 1 barracks, 2 forum. Shared by construction and maintenance.
pub fn constant(kind: u32, upkeep: bool) -> f64 {
    match (kind, upkeep) {
        (0, false) => granaries::GOLD, (0, true) => granaries::UPKEEP,
        (1, false) => 300.0, (1, true) => 30.0,
        (2, false) => 300.0, (2, true) => 3.0, _ => f64::NAN,
    }
}
pub fn achievement(culture: f64, owned: u32) -> i32 {
    // Both prerequisite trees remain live. No balance or prerequisite bypass:
    // the same status function also validates the actual purchase command.
    const ORDER: [usize; 19] = [4, 0, 2, 3, 1, 5, 6, 7, 10, 8, 11, 9, 12, 13, 14, 15, 16, 17, 18];
    ORDER.into_iter().find(|&id| achievements::status(owned, culture, id) == 0).map_or(-1, |id| id as i32)
}
#[derive(Resource, Default)]
pub struct Investments { input: Vec<f64>, output: Vec<f64> }
impl Investments {
    pub fn input(&mut self, len: usize) -> *mut f64 {
        if len > MAX_INPUT { return std::ptr::null_mut(); }
        self.input.resize(len, 0.0); self.input.as_mut_ptr()
    }
    fn publish(&mut self, values: &[f64]) {
        self.output.clear(); self.output.push(values.len() as f64); self.output.extend_from_slice(values);
    }
    /// Mode 0: kind,gold,reserve,surplus,cityPopulation,farmCount,culture,owned,leaderDistance.
    /// Mode 1: ready-tech flags,gold,reserve,surplus,projectedMusketCount,soldierCount,cannonShare.
    /// Mode 2: city top-left x,y,width,height, then farm center x,y pairs.
    /// Mode 3: culture,owned -> one eligible achievement ID, or -1.
    pub fn plan(&mut self, mode: u32, policy: Policy) -> *const f64 {
        self.output.clear(); self.output.push(0.0);
        if !self.input.iter().all(|v| v.is_finite()) { return self.output.as_ptr(); }
        match mode {
            0 if self.input.len() == 9 => {
                let v = &self.input;
                let kind = v[0] as u32;
                let cost = constant(kind, false); let upkeep = constant(kind, true);
                let useful = match kind {
                    0 => v[5] >= 4.0,
                    1 => policy.has(PURCHASES) && v[4] >= 24.0,
                    2 => policy.has(PURCHASES) && v[4] >= 12.0 && v[8] <= 12.0
                        && achievement(v[6], v[7] as u32) >= 0,
                    _ => false,
                };
                let affordable = v[1] >= cost + v[2] + upkeep * 2.0 && v[3] >= upkeep + 3.0;
                self.publish(&[f64::from((useful && affordable) as u8)]);
            }
            1 if self.input.len() == 6 || self.input.len() == 7 => {
                let v = &self.input; let flags = v[0] as u32;
                let has = |bit: u32| flags & (1_u32 << bit) != 0;
                let pikes = policy.has(PURCHASES) && has(5);
                // Budget a whole target squad's extra wages before preferring
                // muskets. A treasury runway prevents immediate oscillation
                // when the first newly trained soldiers enter the wage ledger.
                let extra = ((v[5] * 0.25).ceil() - v[4]).max(0.0)
                    * super::retinue::upkeep(super::kinds::unit::MUSKETMAN);
                let muskets = policy.has(PURCHASES) && has(6)
                    && v[1] >= v[2] + extra * 3.0 && v[3] >= extra + 3.0;
                let knight = if has(3) {0.25} else {0.0};
                let horse = if has(1) && !has(3) {0.25} else {0.0};
                let horse_archer = if has(2) {0.15} else {0.0};
                let swords = if has(4) && !pikes {0.25} else {0.0};
                let archer = if has(0) && !muskets {0.25} else {0.0};
                let cannon = v.get(6).copied().unwrap_or(0.0).clamp(0.0,1.0);
                let mut mix = [knight, horse_archer, horse, swords, archer, 0.0,
                    if pikes {0.30} else {0.0}, if muskets {0.25} else {0.0}, cannon];
                let total = mix[..8].iter().sum::<f64>();
                if total > 1.0-cannon {for share in &mut mix[..8]{*share *= (1.0-cannon)/total;}}
                self.publish(&mix);
            }
            2|5 if self.input.len() >= 4 && self.input.len() % 2 == 0 => self.granary_sites(mode==5),
            4 if self.input.len()==4=>{let v=&self.input;let sites=super::scenarios::civic_sites(v[0],v[1],v[2],v[3]);self.publish(&sites);},
            3 if self.input.len() == 2 => {
                let id = if policy.has(PURCHASES) {achievement(self.input[0], self.input[1] as u32)} else {-1};
                self.publish(&[id as f64]);
            }
            _ => {},
        }
        self.output.as_ptr()
    }
    fn granary_sites(&mut self,outskirts:bool) {
        let v = &self.input; let farms = &v[4..]; let count = farms.len() / 2;
        if count < 4 || v[2] < 2.0 || v[3] < 2.0 { return; }
        let city = (v[0] + 1.0, v[1] + 1.0);
        let mean = (farms.chunks_exact(2).map(|p|p[0]).sum::<f64>() / count as f64,
            farms.chunks_exact(2).map(|p|p[1]).sum::<f64>() / count as f64);
        // A fixed 16x16 neighborhood about the farm cluster. No map/path scans.
        let distances: Vec<_> = farms.chunks_exact(2).map(|p| (p[0], p[1], (p[0]-city.0).hypot(p[1]-city.1))).collect();
        let mut sites = Vec::with_capacity(MAX_SITES);
        let radius=if outskirts{14}else{8};
        for dy in -radius..radius { for dx in -radius..radius {
            let x = if outskirts {city.0.floor()}else{mean.0.floor()} + dx as f64; let y = if outskirts{city.1.floor()}else{mean.1.floor()} + dy as f64;
            if x < 0.0 || y < 0.0 || x + 2.0 > v[2] || y + 2.0 > v[3] {continue;}
            let (cx, cy) = (x + 1.0, y + 1.0); let mut covered = 0; let mut saved = 0.0; let mut displaced = 0;
            if outskirts&&(cx-city.0).hypot(cy-city.1)<8.0{continue;}
            for &(fx, fy, home_distance) in &distances {
                let distance = (fx-cx).hypot(fy-cy);
                if distance <= granaries::RADIUS {covered += 1;}
                if fx >= x && fx < x+2.0 && fy >= y && fy < y+2.0 {displaced += 1;}
                saved += (home_distance-distance).max(0.0);
            }
            if covered - displaced < 4 {continue;}
            let score = covered as f64 * 12.0 + saved * 0.5 - displaced as f64 * 18.0
                - (cx-city.0).hypot(cy-city.1)*0.25;
            sites.push((score,x,y));
        }}
        sites.sort_by(|a,b| b.0.total_cmp(&a.0).then(a.2.total_cmp(&b.2)).then(a.1.total_cmp(&b.1)));
        sites.truncate(MAX_SITES);
        self.output.clear(); self.output.push((sites.len()*2) as f64);
        for (_,x,y) in sites {self.output.extend_from_slice(&[x,y]);}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn investments_need_real_income_and_reserve_productive_gold() {
        let mut planner = Investments::default(); let policy = Policy::builtin(3).unwrap();
        for kind in 0..3 {
            planner.input = vec![kind as f64, 1000.0, 100.0, 40.0, 30.0, 8.0, 500.0, 0.0, 2.0];
            planner.plan(0, policy); assert_eq!(planner.output, vec![1.0, 1.0]);
            planner.input[1] = constant(kind, false) + 99.0;
            planner.plan(0, policy); assert_eq!(planner.output, vec![1.0, 0.0]);
        }
        planner.input = vec![1.0, 1000.0, 100.0, 32.0, 30.0, 8.0, 500.0, 0.0, 2.0];
        planner.plan(0, policy); assert_eq!(planner.output[1], 0.0);
        planner.input = vec![2.0, 1000.0, 100.0, 40.0, 30.0, 8.0, 500.0, 0.0, 20.0];
        planner.plan(0, policy); assert_eq!(planner.output[1], 0.0);
    }
    #[test]
    fn infantry_mix_is_bounded_and_retains_funded_trained_muskets() {
        let mut planner = Investments::default(); let policy = Policy::builtin(3).unwrap();
        planner.input = vec![127.0, 1000.0, 100.0, 100.0, 0.0, 16.0];
        planner.plan(1, policy);
        assert!(planner.output[1..].iter().sum::<f64>() <= 1.0);
        assert_eq!(planner.output[7], 0.30); assert_eq!(planner.output[8], 0.25);
        assert_eq!(planner.output[4], 0.0); assert_eq!(planner.output[5], 0.0);
        planner.input[3] = 3.0; planner.input[4] = 4.0;
        planner.plan(1, policy); assert_eq!(planner.output[8], 0.25);
        planner.input[4] = 0.0;
        planner.plan(1, policy); assert_eq!(planner.output[8], 0.0); assert_eq!(planner.output[5], 0.25);
    }
    #[test]
    fn achievement_choice_honors_every_prerequisite_and_stops_when_complete() {
        let mut owned = 0; let mut culture = 10_000.0;
        for _ in 0..achievements::COSTS.len() {
            let id = achievement(culture, owned); assert!(id >= 0);
            assert_eq!(achievements::status(owned, culture, id as usize), 0);
            culture -= achievements::COSTS[id as usize]; owned |= 1 << id;
        }
        assert_eq!(owned, achievements::OWNED_MASK); assert_eq!(achievement(culture, owned), -1);
        assert_eq!(achievement(0.0, 0), -1);
    }
    #[test]
    fn granary_sites_are_bounded_and_keep_at_least_four_existing_farms() {
        let mut planner = Investments::default();
        planner.input = vec![10.0, 10.0, 64.0, 64.0];
        for y in 10..14 {for x in 17..21 {planner.input.extend_from_slice(&[x as f64+0.5,y as f64+0.5]);}}
        planner.plan(2, Policy::builtin(3).unwrap());
        assert!(planner.output[0] > 0.0); assert!(planner.output.len() <= 1+MAX_SITES*2);
        let x = planner.output[1]; let y = planner.output[2];
        let surviving = planner.input[4..].chunks_exact(2).filter(|farm|
            (farm[0]-x-1.0).hypot(farm[1]-y-1.0)<=granaries::RADIUS
            && !(farm[0]>=x&&farm[0]<x+2.0&&farm[1]>=y&&farm[1]<y+2.0)).count();
        assert!(surviving >= 4);
        assert!(planner.input(MAX_INPUT+1).is_null());
    }
}
