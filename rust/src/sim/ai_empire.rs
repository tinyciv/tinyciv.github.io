//! Bounded, resident city/fort/siege expeditions. The host supplies indexed
//! observations and normal placement results; Rust owns spending eligibility,
//! siting order, deadlines and the retained expedition goal.
use bevy_ecs::prelude::*;
use std::collections::BTreeMap;
use super::ai_policy::{Policy, FOUND_CITIES, FORTIFY_CITIES, OFFENSIVE_SIEGE};

pub const INPUT: usize = 33;
#[derive(Default)]
struct Expedition { next_at: f64, city_at: f64, kind: u32, home: f64, target: f64,
    cursor: usize, site: Option<(f64,f64)>, expires: f64, siege_at: Option<f64> }
#[derive(Resource)]
pub struct Empire { plans: BTreeMap<i32, Expedition>, input: [f64; INPUT], output: [f64; 4] }
impl Default for Empire { fn default() -> Self { Self { plans:BTreeMap::new(),input:[0.0;INPUT],output:[0.0;4] } } }
impl Empire {
    pub fn input(&mut self) -> *mut f64 { self.input.as_mut_ptr() }
    pub fn due(&mut self, faction:i32, now:f64, policy:Policy) -> bool {
        if policy.features & (FOUND_CITIES|FORTIFY_CITIES|OFFENSIVE_SIEGE) == 0 { self.plans.remove(&faction);return false; }
        let plan=self.plans.entry(faction).or_default();
        if now < plan.next_at { return false; }
        plan.next_at=now+3.0; true
    }
    /// [gold,reserve,surplus,pop,food,cities,pendingCities,cityCost,extraCityUpkeep,
    /// siegeCount,siegeUnlocked,siegeCost,siegeUpkeep,localForts,fortCost,fortUpkeep,
    /// leaderX,Y,homeX,Y,homeId,targetX,Y,targetId,campaign,threatened,width,height,
    /// leaderHealthFraction,currentUpkeep,fortUnlocked,availableEscortCount,productiveJobs].
    pub fn plan(&mut self,faction:i32,now:f64,policy:Policy)->*const f64 {
        let v=self.input; let p=policy.parameters;
        let plan=self.plans.entry(faction).or_default();
        let reserve=v[1]+v[29]*(p[21]-1.0);
        let affordable=|cost:f64,upkeep:f64| v[0]>=cost+reserve+upkeep*p[21] && v[2]>=upkeep+3.0
            || v[0]>=cost+reserve+(upkeep-v[2]).max(upkeep)*p[21]*3.0;
        let siege=policy.has(OFFENSIVE_SIEGE)&&v[24]!=0.0&&v[23]>=0.0&&v[10]!=0.0
            &&v[9]<p[23]&&affordable(v[11],v[12]);
        let fort=policy.has(FORTIFY_CITIES)&&v[30]!=0.0&&v[13]<p[24]&&v[32]<2.0&&affordable(v[14],v[15]);
        let city=policy.has(FOUND_CITIES)&&v[24]==0.0&&v[6]==0.0&&v[5]<p[19]
            &&v[31]>=2.0&&v[32]<4.0&&v[3]>=v[5]*p[20]&&v[4]>=v[3]*2.0&&now>=plan.city_at&&affordable(v[7],v[8]);
        let kind=if v[25]!=0.0||v[28]<p[0]{0}else if siege{2}else if fort&&v[13]<1.0{3}else if city{1}else if fort{3}else{0};
        if kind==0 { plan.kind=0;plan.site=None;self.output=[0.0;4];return self.output.as_ptr(); }
        let target=if kind==2{v[23]}else{-1.0};
        if plan.kind!=kind||plan.home!=v[20]||plan.target!=target||now>=plan.expires {
            plan.kind=kind;plan.home=v[20];plan.target=target;plan.site=None;plan.expires=now+150.0;
        }
        if let Some((x,y))=plan.site { self.output=[kind as f64,x,y,1.0];return self.output.as_ptr(); }
        const DIR:[(f64,f64);8]=[(1.0,0.0),(0.7071067811865476,0.7071067811865476),(0.0,1.0),(-0.7071067811865476,0.7071067811865476),
            (-1.0,0.0),(-0.7071067811865476,-0.7071067811865476),(0.0,-1.0),(0.7071067811865476,-0.7071067811865476)];
        let (cx,cy,dx,dy)=if kind==2{(v[21],v[22],v[16]-v[21],v[17]-v[22])}else{(v[18],v[19],v[21]-v[18],v[22]-v[19])};
        let base=(0..8).max_by(|&a,&b|(DIR[a].0*dx+DIR[a].1*dy).total_cmp(&(DIR[b].0*dx+DIR[b].1*dy))).unwrap_or(0);
        let offset=[0,1,7,2,6,3,5,4][plan.cursor%8];
        let radius=match kind {1=>[16.0,20.0,24.0][plan.cursor/8%3],2=>[14.0,16.0,12.0][plan.cursor/8%3],_=>[6.0,8.0,4.0][plan.cursor/8%3]};
        let d=DIR[(base+offset)%8];let x=(cx+d.0*radius).floor();let y=(cy+d.1*radius).floor();
        if x<1.0||y<1.0||x+2.0>=v[26]||y+2.0>=v[27] {plan.cursor+=1;self.output=[0.0;4];}
        else {self.output=[kind as f64,x,y,0.0];}
        self.output.as_ptr()
    }
    pub fn feedback(&mut self,faction:i32,now:f64,result:u32,x:f64,y:f64) {
        let plan=self.plans.entry(faction).or_default();
        match result {
            1=>plan.site=Some((x,y)),
            2=>{if plan.kind==1{plan.city_at=now+120.0;}if plan.kind==2{plan.siege_at=Some(now);}plan.kind=0;plan.site=None;plan.cursor=0;plan.next_at=now+6.0;},
            _=>{plan.cursor+=1;plan.site=None;plan.kind=0;}
        }
    }
    pub fn siege_waiting(&self,faction:i32,now:f64,last_shot:f64)->bool {
        let deployed=self.plans.get(&faction).and_then(|plan|plan.siege_at).unwrap_or(f64::NEG_INFINITY);
        now-last_shot.max(deployed)<=75.0
    }
    pub fn goal(&mut self,faction:i32,now:f64)->*const f64 {
        self.output=[0.0;4];
        if let Some(plan)=self.plans.get(&faction) {if now<plan.expires {if let Some((x,y))=plan.site {
            self.output=[plan.kind as f64,x+1.0,y+1.0,0.0];
        }}}
        self.output.as_ptr()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn inputs()->[f64;INPUT] {let mut v=[0.0;INPUT];v[..9].copy_from_slice(&[2000.0,150.0,100.0,50.0,500.0,1.0,0.0,100.0,25.0]);
        v[14]=500.0;v[15]=30.0;v[16]=40.0;v[17]=40.0;v[18]=40.0;v[19]=40.0;v[20]=10.0;v[21]=80.0;v[22]=40.0;v[23]=20.0;v[26]=120.0;v[27]=90.0;v[28]=1.0;v[31]=4.0;v}
    #[test] fn founding_is_funded_throttled_and_retains_a_real_expedition() {
        let mut e=Empire::default();let p=Policy::builtin(3).unwrap();e.input=inputs();
        assert!(e.due(1,0.0,p));assert!(!e.due(1,0.1,p));e.plan(1,0.0,p);assert_eq!(e.output[0],1.0);
        let (x,y)=(e.output[1],e.output[2]);e.feedback(1,0.0,1,x,y);e.goal(1,1.0);assert_eq!(e.output[0],1.0);
        e.feedback(1,1.0,2,x,y);e.plan(1,2.0,p);assert_eq!(e.output[0],0.0);
        e.input[0]=99.0;e.plan(1,200.0,p);assert_eq!(e.output[0],0.0);
    }
    #[test] fn siege_is_campaign_scoped_and_stays_in_weapon_range() {
        let mut e=Empire::default();let p=Policy::builtin(3).unwrap();e.input=inputs();
        e.input[24]=1.0;e.input[10]=1.0;e.input[11]=300.0;e.plan(1,0.0,p);
        assert_eq!(e.output[0],2.0);assert!((e.output[1]-80.0).hypot(e.output[2]-40.0)<18.0);
        e.input[9]=2.0;e.plan(1,3.0,p);assert_eq!(e.output[0],0.0);
        e.input[9]=0.0;e.input[25]=1.0;e.plan(1,6.0,p);assert_eq!(e.output[0],0.0);
    }
}
