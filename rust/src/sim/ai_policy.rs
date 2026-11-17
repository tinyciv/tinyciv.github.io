//! Policy configuration and decisions belong to this game's ECS. The host
//! registers immutable parameter rows, selects a policy per faction, and
//! submits already-observed facts at the existing strategy planning cadence.
use bevy_ecs::prelude::*;
use std::collections::BTreeMap;

pub const PARAMETERS: usize = 25;
pub const ROW: usize = PARAMETERS + 1;
pub const FEATURES: u32 = FORMATIONS | PURCHASES | TOWER_GARRISON | TOWER_AWARENESS | INTERCEPT
    | DEFENSIVE_LEVY | CAMPAIGN_LEVY | SAFE_CAMPAIGNS | FORMATION_APPROACH | PROACTIVE_HOUSING | FOUND_CITIES | FORTIFY_CITIES | OFFENSIVE_SIEGE | TERRITORIAL_WARS;
pub const FORMATIONS: u32 = 1;
pub const PURCHASES: u32 = 2;
pub const TOWER_GARRISON: u32 = 4;
pub const TOWER_AWARENESS: u32 = 8;
pub const INTERCEPT: u32 = 16;
pub const DEFENSIVE_LEVY: u32 = 32;
pub const CAMPAIGN_LEVY: u32 = 64;
pub const SAFE_CAMPAIGNS: u32 = 128;
pub const FORMATION_APPROACH: u32 = 256;
pub const PROACTIVE_HOUSING: u32 = 512;
pub const FOUND_CITIES: u32 = 1024;
pub const FORTIFY_CITIES: u32 = 2048;
pub const OFFENSIVE_SIEGE: u32 = 4096;
pub const TERRITORIAL_WARS: u32 = 8192;
pub const DEFAULT: u32 = 3;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Policy { pub features: u32, pub parameters: [f64; PARAMETERS] }

impl Policy {
    pub fn builtin(id: u32) -> Option<Self> {
        let mut policy = Self { features: 511, parameters: [
            0.72, 1.15, 1.4, 0.25, 2.0, 3200.0, 6400.0, 1600.0,
            0.8, 40.0, 40.0, 0.9, 75.0, 0.6, 1.0, 8.0, 6.0,
            2.0, 6.0, 0.0, 45.0, 2.0, 40.0, 0.0, 1.0,
        ] };
        match id {
            0 => { policy.features = 0; policy.parameters[0] = 0.65;
                policy.parameters[1] = 1.45; policy.parameters[2] = 1.25; }
            1 => { policy.features = FORMATIONS | PURCHASES; policy.parameters[0] = 0.35;
                policy.parameters[1] = 2.0; policy.parameters[2] = 0.8; }
            2 => {}
            3 => {
                policy.features = FEATURES;
                policy.parameters[0] = 0.55; policy.parameters[1] = 1.55;
                policy.parameters[2] = 1.1; policy.parameters[3] = 0.15;
                policy.parameters[8] = 1.05; policy.parameters[9] = 20.0;
                policy.parameters[17..].copy_from_slice(&[6.0,4.0,6.0,35.0,1.5,20.0,2.0,2.0]);
            }
            _ => return None,
        }
        Some(policy)
    }
    pub fn decode(row: &[f64]) -> Option<Self> {
        if row.len() != ROW || !row.iter().all(|v| v.is_finite()) { return None; }
        let flags = row[0];
        if flags < 0.0 || flags.fract() != 0.0 || flags > FEATURES as f64 { return None; }
        let mut parameters = [0.0; PARAMETERS];
        parameters.copy_from_slice(&row[1..]);
        let p = &parameters;
        if !(0.0..=1.0).contains(&p[0]) || !(0.01..=10.0).contains(&p[1])
            || !(0.01..=10.0).contains(&p[2]) || !(0.0..=1.0).contains(&p[3])
            || !(1.0..=100.0).contains(&p[4]) || p[4].fract() != 0.0
            || p[5..=7].iter().any(|v| !(0.0..=1_000_000.0).contains(v))
            || !(0.01..=10.0).contains(&p[8]) || !(0.0..=1000.0).contains(&p[9])
            || !(0.0..=100.0).contains(&p[10]) || !(p[0]..=1.0).contains(&p[11])
            || !(p[10]..=100.0).contains(&p[12]) || !(0.0..=10.0).contains(&p[13])
            || !(0.5..=10.0).contains(&p[14])
            || !(1.0..=1000.0).contains(&p[15]) || p[15].fract() != 0.0
            || !(1.0..=p[15]).contains(&p[16]) || p[16].fract() != 0.0
            || !(0.2..=12.0).contains(&p[17]) || !(2.0..=30.0).contains(&p[18])
            || !(0.0..=12.0).contains(&p[19]) || p[19].fract() != 0.0
            || !(20.0..=200.0).contains(&p[20]) || !(1.0..=5.0).contains(&p[21])
            || !(10.0..=120.0).contains(&p[22])
            || !(0.0..=4.0).contains(&p[23]) || p[23].fract() != 0.0
            || !(0.0..=3.0).contains(&p[24]) || p[24].fract() != 0.0 { return None; }
        Some(Self { features: flags as u32, parameters })
    }
    fn encode(self, out: &mut Vec<f64>) {
        out.push(self.features as f64); out.extend_from_slice(&self.parameters);
    }
    pub fn has(self, feature: u32) -> bool { self.features & feature != 0 }
    /// 0 garrison, 1 retreat, 2 recovered, 3 hunt eligibility, 4 campaign
    /// eligibility, 5 campaign rank, 6 formation eligibility, 7 emergency,
    /// 8 required levy, 9 hostile tower support, 10 friendly tower support.
    pub fn decide(self, mode: u32, v: [f64; 6]) -> f64 {
        let p = self.parameters;
        let yes = |value: bool| f64::from(value as u8);
        match mode {
            0 => v[0].min(if self.has(TOWER_GARRISON) && v[2] >= p[4] { 0.0 }
                else { 1.0_f64.max((v[1] * p[3]).ceil()) }),
            1 => yes(v[0] < v[1] * p[0] || v[2] < p[10] || v[3] > v[4] * p[1]),
            2 => yes(v[0] >= v[1] * p[11] && v[2] >= p[12] && v[3] <= v[4] * p[13] && v[5] <= 6.0),
            3 => yes(v[2] == 0.0 && v[0] >= v[1] * p[2]),
            4 => yes(!self.has(SAFE_CAMPAIGNS) || v[0] <= v[1] * p[8]),
            5 => v[0] + if self.has(SAFE_CAMPAIGNS) { v[1] / v[2].max(1.0) * p[9] } else { 0.0 },
            6 => yes(self.has(FORMATIONS) && v[0] != 0.0 && v[1] != 0.0
                && v[2] >= (if v[3] != 0.0 { p[16] } else { p[15] }) && v[4] >= v[5]),
            7 => yes(v[0] < v[1] * p[0] || v[2] < p[10]),
            8 => if v[2] > 0.0 { ((v[0] / p[8] - v[1]) / v[2]).ceil().max(0.0) } else { 0.0 },
            9 => v[0] + if self.has(TOWER_AWARENESS) { v[1] * p[5] + v[2] * p[6] } else { 0.0 },
            10 => v[0] + if self.has(TOWER_AWARENESS) { v[1] * p[7] } else { 0.0 },
            11 => yes(self.has(PROACTIVE_HOUSING) && v[0] - v[1] <= 6.0_f64.max(v[1]*0.2)
                && v[2] > v[1] + 2.0 && v[3] >= v[1]*2.0),
            12 => {
                let proactive = self.has(PROACTIVE_HOUSING);
                let rate = if v[2] != 0.0 { if proactive { 1.0 } else { 0.2 } } else { p[17] };
                (v[0]+rate*v[1]/30.0).min(if v[2] != 0.0 { 1.0 } else if proactive { 4.0 } else { 2.0 })
            }
            13 => if self.has(PROACTIVE_HOUSING) { 4.0 } else { 2.0 },
            14 => yes(self.has(PROACTIVE_HOUSING) && v[0] - v[1] <= v[0]*0.5 && v[2] > v[1]),
            15 => if self.has(PROACTIVE_HOUSING) { 4.0 } else { 2.0 },
            16 => if self.has(PROACTIVE_HOUSING) { 2.0 } else { 3.0 },
            17 => if self.has(FORTIFY_CITIES) { if v[0] > 0.0 { 2.0 } else { (v[1]/5.0).floor().clamp(4.0,8.0) } }
                else if v[0] > 0.0 { 1.0 } else { (v[1]/5.0).floor().clamp(2.0,4.0) },
            18 => yes(self.has(FORTIFY_CITIES) && v[0] != 0.0),
            19 => if !self.has(FORTIFY_CITIES) { 0.0 }
                else if v[4] == 0.0 && v[0] >= v[1]+v[2]+v[3] { 1.0 }
                else if v[4] != 0.0 && v[5] == 0.0 && v[0] >= v[1]+v[3] { 2.0 } else { 0.0 },
            21 => yes(self.has(OFFENSIVE_SIEGE) && v[0] > 0.0 && (v[1] > 0.0 || v[2] > 0.35)),
            22 => if self.has(FORTIFY_CITIES) { match v[0] as u32 { 0=>1.0,1=>4.0,2=>2.0,3=>5.0,4=>6.0,5=>3.0,6=>0.0,_=>9.0 } } else { v[0] },
            23 => yes(v[0] >= 14.0),
            24 => yes(self.has(OFFENSIVE_SIEGE) && v[0] >= 103.0 && v[1] >= v[2]+500.0+100.0*p[21]),
            26 => yes(v[2]-v[4]>=3.0_f64.max(v[5]*0.1)
                || self.has(FORTIFY_CITIES) && v[0]>=v[3]+v[1]*p[21]+(v[4]-v[2]).max(v[4])*p[21]*3.0),
            27 => yes(self.has(FORTIFY_CITIES) && v[3]<2.0 && v[0]>=v[1]+v[2]),
            28 => if self.has(OFFENSIVE_SIEGE) {180.0+v[0]*4.0}else{90.0+v[0]*3.0},
            29 => v[0] / (5.0 + v[1] + v[2]/v[3].max(1.0)*6.0) + if v[4]!=0.0 {2.0} else {0.0} + v[5],
            _ => f64::NAN,
        }
    }
}

#[derive(Component, Clone, Copy)]
pub struct FactionPolicy(pub u32);

#[derive(Resource)]
pub struct Policies {
    definitions: Vec<Policy>,
    programs: Vec<BTreeMap<u32, super::ai_logic::Program>>,
    logic_input: Vec<f64>,
    logic_view: Vec<f64>,
    faults: Vec<u32>,
    factions: BTreeMap<i32, Entity>,
    input: [f64; ROW],
    view: Vec<f64>,
}
impl Default for Policies {
    fn default() -> Self { Self { definitions: (0..4).map(|id| Policy::builtin(id).unwrap()).collect(),
        programs: vec![BTreeMap::new();4], logic_input: Vec::new(), logic_view: Vec::new(), faults: vec![0;4],
        factions: BTreeMap::new(), input: [0.0; ROW], view: Vec::with_capacity(ROW + 1) } }
}
impl Policies {
    pub fn input(&mut self) -> *mut f64 { self.input.as_mut_ptr() }
    pub fn valid_input(&self) -> bool { Policy::decode(&self.input).is_some() }
    pub fn register(&mut self) -> u32 {
        if self.definitions.len() >= 100_000 { return u32::MAX; }
        let Some(policy) = Policy::decode(&self.input) else { return u32::MAX; };
        let id = self.definitions.len() as u32;
        self.definitions.push(policy); self.programs.push(BTreeMap::new()); self.faults.push(0); id
    }
}

impl Policies {
    pub fn logic_input(&mut self,len:usize)->*mut f64 {
        if len>super::ai_logic::MAX_INSTRUCTIONS*2 {return std::ptr::null_mut();}
        self.logic_input.resize(len,0.0);self.logic_input.as_mut_ptr()
    }
    pub fn logic_valid(&self,mode:u32)->bool {super::ai_logic::Program::decode(mode,&self.logic_input).is_some()}
    pub fn logic_set(&mut self,code:u32,mode:u32)->bool {
        if code<4{return false;}
        let Some(program)=super::ai_logic::Program::decode(mode,&self.logic_input) else{return false;};
        let Some(programs)=self.programs.get_mut(code as usize) else{return false;};
        if programs.contains_key(&mode){return false;}programs.insert(mode,program);true
    }
    pub fn logic_view(&mut self,code:u32)->*const f64 {
        let Some(programs)=self.programs.get(code as usize) else{return std::ptr::null();};
        self.logic_view.clear();self.logic_view.push(0.0);self.logic_view.push(programs.len() as f64);
        for (mode,p) in programs {self.logic_view.extend_from_slice(&[*mode as f64,p.words.len() as f64]);self.logic_view.extend_from_slice(&p.words);}
        self.logic_view[0]=self.logic_view.len() as f64;self.logic_view.as_ptr()
    }
    pub fn faults(&self,code:u32)->u32 {self.faults.get(code as usize).copied().unwrap_or(0)}
}
pub fn decide(world:&mut World,faction:i32,mode:u32,facts:[f64;6])->f64 {
    let code=selected(world,faction) as usize;let mut policies=world.resource_mut::<Policies>();
    let policy=policies.definitions[code];let fallback=policy.decide(mode,facts);
    let Some(program)=policies.programs[code].get(&mode) else{return fallback;};
    // Unreachable travel estimates can legitimately be infinite.
    if !facts.iter().all(|v|v.is_finite()){return fallback;}
    if let Some(value)=program.evaluate(&facts,&policy.parameters) {super::ai_logic::normalize(mode,value,&facts)}
    else {policies.faults[code]=policies.faults[code].saturating_add(1);fallback}
}

pub fn selected(world: &World, faction: i32) -> u32 {
    world.resource::<Policies>().factions.get(&faction)
        .and_then(|entity| world.get::<FactionPolicy>(*entity)).map_or(DEFAULT, |policy| policy.0)
}
pub fn policy(world: &World, faction: i32) -> Policy { world.resource::<Policies>().definitions[selected(world, faction) as usize] }
pub fn assign(world: &mut World, faction: i32, id: u32) -> bool {
    if faction < 0 || id as usize >= world.resource::<Policies>().definitions.len() { return false; }
    if let Some(entity) = world.resource::<Policies>().factions.get(&faction).copied() {
        if world.get::<FactionPolicy>(entity).is_some_and(|policy| policy.0 == id) { return true; }
        world.entity_mut(entity).insert(FactionPolicy(id));
    } else {
        let entity = world.spawn(FactionPolicy(id)).id();
        world.resource_mut::<Policies>().factions.insert(faction, entity);
    }
    world.resource_mut::<super::DecisionRevision>().0 += 1.0;
    true
}
pub fn view(world: &mut World, mode: u32, index: i32) -> *const f64 {
    let id = if mode == 0 { index as u32 } else { selected(world, index) };
    let mut policies = world.resource_mut::<Policies>();
    let Some(policy) = policies.definitions.get(id as usize).copied() else { return std::ptr::null(); };
    policies.view.clear(); policies.view.push(id as f64); policy.encode(&mut policies.view);
    policies.view.as_ptr()
}

pub fn snapshot(world: &World) -> Vec<f64> {
    let policies = world.resource::<Policies>();
    let mut out = vec![policies.definitions.len() as f64, policies.factions.len() as f64];
    for definition in &policies.definitions { definition.encode(&mut out); }
    for (faction, entity) in &policies.factions {
        out.extend_from_slice(&[*faction as f64, world.get::<FactionPolicy>(*entity).unwrap().0 as f64]);
    }
    for programs in &policies.programs {
        out.push(programs.len() as f64);
        for (mode,program) in programs {out.extend_from_slice(&[*mode as f64,program.words.len() as f64]);out.extend_from_slice(&program.words);}
    }
    out
}
pub struct Snapshot { definitions: Vec<Policy>, assignments: Vec<(i32, u32)>, programs: Vec<BTreeMap<u32,super::ai_logic::Program>> }
pub fn decode(data: &[f64]) -> Option<Snapshot> {
    let count = *data.first()?;
    let factions = *data.get(1)?;
    if !count.is_finite() || count < 4.0 || count.fract() != 0.0 || count > 100_000.0
        || !factions.is_finite() || factions < 0.0 || factions.fract() != 0.0 || factions > 100_000.0 { return None; }
    if data.len() < 2 + count as usize * ROW + factions as usize * 2 { return None; }
    let definitions = data[2..2 + count as usize * ROW].chunks_exact(ROW).map(Policy::decode).collect::<Option<Vec<_>>>()?;
    let mut assignments = Vec::new();
    let mut previous = -1;
    for row in data[2 + count as usize * ROW..2 + count as usize * ROW + factions as usize * 2].chunks_exact(2) {
        if !row[0].is_finite() || row[0] <= previous as f64 || row[0] > i32::MAX as f64 || row[0].fract() != 0.0
            || !row[1].is_finite() || row[1] < 0.0 || row[1] >= count || row[1].fract() != 0.0 { return None; }
        previous = row[0] as i32; assignments.push((previous, row[1] as u32));
    }
    let mut cursor=2+count as usize*ROW+factions as usize*2;
    fn integer(data:&[f64],cursor:&mut usize,max:usize)->Option<usize>{let v=*data.get(*cursor)?;*cursor+=1;
        if !v.is_finite()||v<0.0||v.fract()!=0.0||v>max as f64{return None;}Some(v as usize)}
    let mut programs=Vec::new();
    for code in 0..count as usize {
        let n=integer(data,&mut cursor,30)?;if code<4&&n!=0{return None;}
        let mut entries=BTreeMap::new();
        for _ in 0..n {let mode=integer(data,&mut cursor,29)? as u32;let len=integer(data,&mut cursor,128)?;
            let program=super::ai_logic::Program::decode(mode,data.get(cursor..cursor+len)?)?;cursor+=len;
            if entries.insert(mode,program).is_some(){return None;}}
        programs.push(entries);
    }
    if cursor!=data.len(){return None;}
    Some(Snapshot { definitions, assignments, programs })
}
pub fn restore(world: &mut World, saved: Snapshot) {
    let old = std::mem::take(&mut world.resource_mut::<Policies>().factions);
    for entity in old.into_values() { world.despawn(entity); }
    let mut policies = Policies::default(); policies.definitions = saved.definitions; policies.programs=saved.programs; policies.faults=vec![0;policies.definitions.len()];
    world.insert_resource(policies);
    for (faction, id) in saved.assignments { assign(world, faction, id); }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sim::Sim;

    #[test]
    fn policy_rules_are_independent_and_change_actual_decisions() {
        let mut first = Sim::new(7); let second = Sim::new(7);
        assert!(assign(&mut first.world, 1, 1));
        assert_eq!(policy(&first.world, 1).decide(1, [50.0,100.0,100.0,0.0,100.0,0.0]), 0.0);
        assert_eq!(policy(&second.world, 1).decide(1, [50.0,100.0,100.0,0.0,100.0,0.0]), 1.0);
        assert_eq!(policy(&first.world, 1).decide(0, [12.0,12.0,2.0,0.0,0.0,0.0]), 3.0);
        assert_eq!(policy(&second.world, 1).decide(0, [12.0,12.0,2.0,0.0,0.0,0.0]), 0.0);
    }
    #[test]
    fn invalid_definitions_and_assignments_do_not_change_the_registry() {
        let mut game = Sim::new(1);
        let mut row = Vec::new(); Policy::builtin(2).unwrap().encode(&mut row);
        for (index, value) in [(1, f64::NAN), (1, 1.1), (15, 0.1), (17, 9.0), (0, 16384.0)] {
            let mut invalid = row.clone(); invalid[index] = value;
            assert!(Policy::decode(&invalid).is_none());
        }
        assert!(!assign(&mut game.world, 1, 9)); assert!(!assign(&mut game.world, -1, 0));
        assert_eq!(selected(&game.world, 1), DEFAULT);
    }
    #[test]
    fn custom_policy_survives_the_native_save_and_preserves_rng() {
        let mut game = Sim::new(123);
        let mut row = Vec::new(); let mut custom = Policy::builtin(2).unwrap();
        custom.parameters[0] = 0.8; custom.features &= !FORMATIONS; custom.encode(&mut row);
        game.world.resource_mut::<Policies>().input.copy_from_slice(&row);
        let id = game.world.resource_mut::<Policies>().register(); assert_eq!(id, 4);
        assign(&mut game.world, 2, id);
        let saved = game.export(None).to_vec(); let mut copy = Sim::new(0);
        assert!(copy.restore(&saved)); assert_eq!(policy(&copy.world, 2), custom);
        assert_eq!(copy.rng_state(), game.rng_state()); assert_eq!(selected(&copy.world, 1), DEFAULT);
        let mut corrupt = snapshot(&copy.world); *corrupt.last_mut().unwrap() = 99.0;
        assert!(decode(&corrupt).is_none());
    }
}
