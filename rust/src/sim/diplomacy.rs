//! Sparse diplomacy commands and staggered strategic decisions. Accounts and
//! faction-pair relationships are resident ECS components; the host only
//! supplies observations and applies the resulting world/economy events.
use bevy_ecs::prelude::*;
use std::collections::{BTreeMap, BTreeSet};

pub const PEACE: u32 = 1;
pub const PACT: u32 = 2;
pub const TRADE: u32 = 4;
pub const ACCESS: u32 = 8;
pub const ALLIANCE: u32 = 16;
pub const SUPPORT: u32 = 32;
pub const TERMS: usize = 13;
pub const PAIR: usize = 36;
pub const OFFER: usize = 6 + TERMS;
pub const FACTION: usize = 12;
// Errors are stable UI identifiers, not translated simulation prose.
pub const INVALID: u32 = 1;
pub const CONTACT: u32 = 2;
pub const GOLD: u32 = 3;
pub const TECH: u32 = 4;
pub const PREREQUISITE: u32 = 5;
pub const LIBRARY: u32 = 6;
pub const RESALE: u32 = 7;
pub const WAR: u32 = 8;
pub const ROUTE: u32 = 9;
pub const EXPIRED: u32 = 10;
pub const REFUSED: u32 = 11;
pub const CONFIRM: u32 = 12;
pub const TRUST: u32 = 13;
pub const AFFILIATION: u32 = 14;
pub const ALLIED: u32 = 15;
pub const CITY: u32 = 16;
pub const EMPTY: u32 = 17;
pub const CONTRACT: u32 = 18;

#[derive(Clone, Default)]
struct Technology { cost: f64, prerequisites: u64, military: bool }
#[derive(Component, Clone, Default)]
struct Account {
    id: i32, human: bool, active: bool, gold: f64, personality: u8,
    cities: f64, power: f64, library: bool, known: u64, initial_war: bool,
    remaining: Vec<f64>, acquired: Vec<f64>, fatigue: f64, aid_city: i64, aid_ally: i32, aid_until: f64,
}
#[derive(Component, Clone)]
struct Relationship {
    a: i32, b: i32, contact: bool, war: bool, since: f64,
    truce: f64, pact: f64, trade: f64, access: f64, alliance: f64,
    withdrawal: f64, trust: [f64; 2], grievance: [f64; 2], interest: [f64; 2],
    affiliation: [f64; 2], observed_power: [f64; 2], observed_cities: [f64; 2],
    intel_at: [f64; 2], next_ai: f64, next_offer: f64, last_tick: f64,
    origin: i64, destination: i64, give_rate: f64, get_rate: f64,
    payment_at: f64, payment_end: f64, arrears: [f64; 2], default_at: [f64; 2],
    honored: f64,
}
impl Relationship {
    fn new(a: i32, b: i32, war: bool, now: f64) -> Self {
        Self { a, b, contact: war, war, since: now, truce: 0.0, pact: 0.0, trade: 0.0, access: 0.0, alliance: 0.0,
            withdrawal: 0.0, trust: [50.0; 2], grievance: [0.0; 2], interest: [0.0; 2], affiliation: [0.0; 2],
            observed_power: [0.0; 2], observed_cities: [0.0; 2], intel_at: [-1.0; 2],
            next_ai: now + 8.0 + ((a * 3 + b * 7) % 8) as f64, next_offer: now + 30.0,
            last_tick: now, origin: -1, destination: -1, give_rate: 0.0, get_rate: 0.0,
            payment_at: 0.0, payment_end: 0.0, arrears: [0.0; 2], default_at: [0.0; 2], honored: 0.0 }
    }
    fn side(&self, id: i32) -> usize { usize::from(id == self.b) }
    fn flags(&self, now: f64) -> u32 {
        u32::from(self.truce > now) | (u32::from(self.pact > now) << 1)
            | (u32::from(self.trade > now) << 2) | (u32::from(self.access > now || self.withdrawal > now) << 3)
            | (u32::from(self.alliance > now) << 4)
    }
    fn write(&self, out: &mut Vec<f64>) {
        out.extend_from_slice(&[self.a as f64, self.b as f64, f64::from(self.contact), f64::from(self.war), self.since,
            self.truce, self.pact, self.trade, self.access, self.alliance, self.withdrawal,
            self.trust[0], self.trust[1], self.grievance[0], self.grievance[1], self.interest[0], self.interest[1],
            self.affiliation[0], self.affiliation[1], self.observed_power[0], self.observed_power[1],
            self.observed_cities[0], self.observed_cities[1], self.origin as f64, self.destination as f64,
            self.give_rate, self.get_rate, self.payment_at, self.payment_end, self.arrears[0], self.arrears[1],
            self.default_at[0], self.default_at[1], self.honored, self.next_ai, self.next_offer]);
    }
}
#[derive(Clone, Default)]
struct Terms {
    flags: u32, give: f64, get: f64, give_rate: f64, get_rate: f64, duration: f64,
    give_tech: u64, get_tech: u64, give_city: i64, get_city: i64, enemy: i32,
    origin: i64, destination: i64,
}
impl Terms {
    fn read(v: &[f64]) -> Option<Self> {
        if v.len() != TERMS || v.iter().any(|x| !x.is_finite() || x.fract() != 0.0)
            || v[..5].iter().any(|&x| x < 0.0) || v[0] > 63.0 || !(60.0..=600.0).contains(&v[5])
            || v[5] % 30.0 != 0.0 || v[6..8].iter().any(|&x| !(0.0..=9_007_199_254_740_991.0).contains(&x))
            || v[1..5].iter().any(|&x| x > 1_000_000.0) { return None; }
        Some(Self { flags: v[0] as u32, give: v[1], get: v[2], give_rate: v[3], get_rate: v[4], duration: v[5],
            give_tech: v[6] as u64, get_tech: v[7] as u64, give_city: v[8] as i64, get_city: v[9] as i64,
            enemy: v[10] as i32, origin: v[11] as i64, destination: v[12] as i64 })
    }
    fn write(&self, out: &mut Vec<f64>) { out.extend_from_slice(&[self.flags as f64, self.give, self.get, self.give_rate, self.get_rate,
        self.duration, self.give_tech as f64, self.get_tech as f64, self.give_city as f64, self.get_city as f64,
        self.enemy as f64, self.origin as f64, self.destination as f64]); }
    fn reverse(&self) -> Self { Self { give: self.get, get: self.give, give_rate: self.get_rate, get_rate: self.give_rate,
        give_tech: self.get_tech, get_tech: self.give_tech, give_city: self.get_city, get_city: self.give_city,
        origin: self.destination, destination: self.origin, ..self.clone() } }
}
#[derive(Clone)]
struct Offer { id: u32, from: i32, to: i32, expires: f64, call: bool, score: f64, terms: Terms }
#[derive(Clone, Copy, Default)]
struct City { owner: i32, previous: i32, population: f64, x: f64, y: f64, attacked: f64 }
#[derive(Clone, Copy, Default)]
struct Evaluation { error: u32, score: f64, reasons: u32, counter: f64 }

#[derive(Resource, Default)]
pub struct Diplomacy {
    pub input: Vec<f64>, pub output: Vec<f64>,
    accounts: BTreeMap<i32, Entity>, pairs: BTreeMap<(i32, i32), Entity>,
    wars: BTreeMap<i32, BTreeSet<i32>>,
    offers: BTreeMap<u32, Offer>, cities: BTreeMap<i64, City>, technologies: Vec<Technology>,
    events: Vec<[f64; 5]>, history: Vec<[f64; 6]>, next_id: u32, revision: u32, now: f64,
    /// Explicit headless combat fixture only; normal worlds leave this unset.
    match_pair: Option<(i32, i32)>,
}
fn key(a: i32, b: i32) -> (i32, i32) { (a.min(b), a.max(b)) }
fn amount(v: f64) -> f64 { if v.is_finite() { v.max(0.0) } else { 0.0 } }
impl Diplomacy {
    /// Offline authoring resets the resident relationships, rather than only
    /// the host's published snapshot. Ordinary loads never call this command.
    pub fn initialize_scenario(&mut self, world: &mut World, scenario: u32) -> bool {
        if scenario > 5 || self.accounts.is_empty() { return false; }
        let war = matches!(scenario, 1 | 2 | 3 | 5);
        let pairs: Vec<_> = self.pairs.keys().copied().filter(|&(a, b)|
            self.accounts.get(&a).and_then(|e| world.get::<Account>(*e)).is_some_and(|f| f.active)
            && self.accounts.get(&b).and_then(|e| world.get::<Account>(*e)).is_some_and(|f| f.active)).collect();
        if war && pairs.is_empty() { return false; }
        // Walk the existing pair index once; do not rebuild a cross product of
        // units, cities, or factions during finalization.
        for (a, b) in pairs { self.put(world, Relationship::new(a, b, war, self.now)); }
        for &entity in self.accounts.values() {
            let mut account = world.get_mut::<Account>(entity).unwrap();
            account.fatigue = 0.0;
            account.aid_city = -1; account.aid_ally = -1; account.aid_until = 0.0;
        }
        self.offers.clear(); self.events.clear(); self.history.clear(); self.match_pair = None;
        self.revision = self.revision.wrapping_add(1);
        true
    }
    pub fn configure_match(&mut self, world: &mut World, a: i32, b: i32) -> bool {
        if a == b || self.account(world,a).is_none_or(|f|f.human||!f.active)
            || self.account(world,b).is_none_or(|f|f.human||!f.active) { return false; }
        // Creation may already have initialized a rival-vs-observer war.
        // The controlled fixture has exactly one combat pair, with every
        // other actor neutral and no automated negotiations during the match.
        let others:Vec<_>=self.pairs.keys().copied().filter(|&pair|pair!=key(a,b)).collect();
        for (x,y) in others { self.put(world,Relationship::new(x,y,false,self.now)); }
        self.offers.clear();
        self.match_pair=Some(key(a,b));
        self.begin_war(world,a,b,false);
        true
    }
    pub fn prepare(&mut self, len: usize) -> *mut f64 { self.input.resize(len.min(200_000), 0.0); self.input.as_mut_ptr() }
    fn account(&self, world: &World, id: i32) -> Option<Account> { world.get::<Account>(*self.accounts.get(&id)?).cloned() }
    fn pair(&self, world: &World, a: i32, b: i32) -> Option<Relationship> { world.get::<Relationship>(*self.pairs.get(&key(a,b))?).cloned() }
    fn put(&mut self, world: &mut World, pair: Relationship) {
        let (a, b, war) = (pair.a, pair.b, pair.war);
        let was_at_war = if let Some(&entity) = self.pairs.get(&(a, b)) {
            let mut previous = world.get_mut::<Relationship>(entity).unwrap();
            let was_at_war = previous.war;
            *previous = pair;
            was_at_war
        } else {
            self.pairs.insert((a, b), world.spawn(pair).id());
            false
        };
        if war != was_at_war {
            for (faction, enemy) in [(a, b), (b, a)] {
                if war { self.wars.entry(faction).or_default().insert(enemy); }
                else if let Some(enemies) = self.wars.get_mut(&faction) { enemies.remove(&enemy); }
            }
        }
    }
    fn event(&mut self, kind: u32, a: i32, b: i32, value: f64, extra: f64) {
        self.events.push([kind as f64, a as f64, b as f64, value, extra]);
        if kind != 1 { self.history.push([self.now, kind as f64, a as f64, b as f64, value, extra]); }
        if self.history.len() > 80 { self.history.drain(..self.history.len()-80); }
        self.revision = self.revision.wrapping_add(1);
    }
    fn transfer(&mut self, world: &mut World, a: i32, b: i32, gold: f64) {
        if gold <= 0.0 { return; }
        let ae = self.accounts[&a]; let be = self.accounts[&b];
        world.get_mut::<Account>(ae).unwrap().gold -= gold;
        world.get_mut::<Account>(be).unwrap().gold += gold;
        self.event(1, a, b, gold, 0.0);
    }
    /// Input header: faction count, technology count, observation count, city count.
    /// Factions: 12 header words + remaining research per technology. Observations
    /// are bounded sight samples, never hidden enemy treasury or global military.
    pub fn sync(&mut self, world: &mut World, now: f64) {
        self.now = now;
        let v = std::mem::take(&mut self.input);
        if v.len() < 4 { self.input = v; return; }
        let (nf, nt, no, nc) = (v[0] as usize, v[1] as usize, v[2] as usize, v[3] as usize);
        if nf > 64 || nt > 53 || no > 4096 || nc > 10_000 || v.len() != 4 + nt*3 + nf*(FACTION+nt) + no*9 + nc*7 { self.input = v; return; }
        self.technologies = v[4..4+nt*3].chunks_exact(3).map(|r| Technology { cost: r[0], prerequisites: r[1] as u64, military: r[2] != 0.0 }).collect();
        let mut offset = 4 + nt*3;
        for _ in 0..nf {
            let r = &v[offset..offset+FACTION+nt]; offset += FACTION+nt;
            let id = r[0] as i32;
            let first = !self.accounts.contains_key(&id);
            let previous = self.account(world, id).unwrap_or_default();
            let personality = if first { ((world.resource::<super::Rng>().0.state ^ (id as u32).wrapping_mul(2_654_435_761)) % 4) as u8 } else { previous.personality };
            let fatigue = (previous.fatigue + (previous.cities-r[5]).max(0.0)*30.0 + (previous.power-r[6]).max(0.0)*0.04).min(100.0);
            let mut acquired = previous.acquired; acquired.resize(nt, 0.0);
            let row = Account { id, human: r[1] != 0.0, active: r[2] != 0.0, gold: amount(r[3]), personality,
                cities: amount(r[5]), power: amount(r[6]), library: r[7] != 0.0, known: r[8] as u64,
                initial_war: r[9] != 0.0, remaining: r[FACTION..].to_vec(), acquired, fatigue,
                aid_city: previous.aid_city, aid_ally: previous.aid_ally, aid_until: previous.aid_until };
            if let Some(&e) = self.accounts.get(&id) { *world.get_mut::<Account>(e).unwrap() = row; }
            else { self.accounts.insert(id, world.spawn(row).id()); }
        }
        let ids: Vec<i32> = self.accounts.keys().copied().collect();
        for (i,&a) in ids.iter().enumerate() { for &b in &ids[i+1..] {
            if !self.pairs.contains_key(&(a,b)) {
                let war = a == 0 && self.account(world,b).is_some_and(|f| f.initial_war);
                self.put(world, Relationship::new(a,b,war,now));
            }
        } }
        for _ in 0..no {
            let r = &v[offset..offset+9]; offset += 9;
            if let Some(mut pair) = self.pair(world,r[0] as i32,r[1] as i32) {
                let s = pair.side(r[0] as i32);
                if r[2] != 0.0 {
                    pair.contact = true;
                    if pair.intel_at[s] < 0.0 {pair.observed_power[s]=self.account(world,r[0] as i32).map_or(100.0,|f|f.power.max(100.0));}
                }
                if r[3] >= 0.0 { pair.observed_power[s] = pair.observed_power[s].max(r[3]); pair.observed_cities[s] = pair.observed_cities[s].max(r[4]); pair.intel_at[s] = now; }
                pair.affiliation[s] = r[5]; pair.interest[s] = r[6] * 20.0;
                if r[7] >= 0.0 { pair.origin = r[7] as i64; pair.destination = r[8] as i64; }
                self.put(world,pair);
            }
        }
        self.cities.clear();
        for _ in 0..nc { let r=&v[offset..offset+7]; offset+=7; self.cities.insert(r[0] as i64,City { owner:r[1] as i32,previous:r[2] as i32,population:r[3],x:r[4],y:r[5],attacked:r[6] }); }
        self.input = v;
    }
    fn technology_value(&self, recipient: &Account, mask: u64, rival: bool) -> f64 {
        self.technologies.iter().enumerate().filter(|(i,_)| mask & (1<<i) != 0).map(|(i,t)| {
            recipient.remaining.get(i).copied().unwrap_or(t.cost).max(0.0) * if t.military && rival { 1.8 } else { 1.1 }
        }).sum()
    }
    fn tech_error(&self, seller: &Account, buyer: &Account, mask: u64) -> u32 {
        if mask == 0 { return 0; }
        if !buyer.library { return LIBRARY; }
        if mask >> self.technologies.len() != 0 || mask & seller.known != mask || mask & buyer.known != 0 { return TECH; }
        for (i,t) in self.technologies.iter().enumerate() { if mask & (1<<i) != 0 {
            if t.prerequisites & buyer.known != t.prerequisites { return PREREQUISITE; }
            if seller.acquired.get(i).copied().unwrap_or(0.0) > self.now { return RESALE; }
        } }
        0
    }
    fn evaluate(&self, world: &World, a: i32, b: i32, terms: &Terms) -> Evaluation {
        let mut e = Evaluation::default();
        let Some(fa) = self.account(world,a) else { e.error=INVALID; return e; };
        let Some(fb) = self.account(world,b) else { e.error=INVALID; return e; };
        let Some(p) = self.pair(world,a,b) else { e.error=INVALID; return e; };
        let s = p.side(b);
        e.error = if (terms.give_rate > 0.0 || terms.get_rate > 0.0) && (p.payment_end > self.now || p.arrears.iter().any(|&n| n > 0.0)) { CONTRACT }
            else if a == b || !fa.active || !fb.active { INVALID }
            else if !p.contact { CONTACT }
            else if terms.flags & PEACE != 0 && !p.war { WAR }
            else if terms.flags & PEACE == 0 && ((terms.give_rate > 0.0 && p.trust[p.side(b)] < 30.0)
                || (terms.get_rate > 0.0 && p.trust[p.side(a)] < 30.0)) { TRUST }
            else if fa.gold < terms.give || fb.gold < terms.get { GOLD }
            else if p.war && terms.flags & PEACE == 0 { WAR }
            else if terms.flags & TRADE != 0 && (terms.origin < 0 || terms.destination < 0
                || self.cities.get(&terms.origin).is_none_or(|c| c.owner != a)
                || self.cities.get(&terms.destination).is_none_or(|c| c.owner != b)) { ROUTE }
            else if terms.give_city >= 0 && self.cities.get(&terms.give_city).is_none_or(|c| c.owner != a || c.previous != b) { CITY }
            else if terms.get_city >= 0 && self.cities.get(&terms.get_city).is_none_or(|c| c.owner != b || c.previous != a) { CITY }
            else if terms.flags & SUPPORT != 0 && (terms.enemy == a || terms.enemy == b
                || self.account(world,terms.enemy).is_none_or(|f| !f.active)
                || self.pair(world,b,terms.enemy).is_none_or(|r| !r.contact || r.truce > self.now || r.pact > self.now || r.alliance > self.now)) { INVALID }
            else { self.tech_error(&fa,&fb,terms.give_tech) };
        if e.error == 0 { e.error = self.tech_error(&fb,&fa,terms.get_tech); }
        if terms.flags == 0 && terms.give == 0.0 && terms.get == 0.0 && terms.give_rate == 0.0 && terms.get_rate == 0.0
            && terms.give_tech == 0 && terms.get_tech == 0 && terms.give_city < 0 && terms.get_city < 0 { e.error=EMPTY; }
        let personality = fb.personality;
        let installments = terms.duration / 30.0;
        let credit = (p.trust[s] / 100.0).clamp(0.1,0.9);
        e.score = (terms.give - terms.get) + (terms.give_rate*credit - terms.get_rate)*installments
            + self.technology_value(&fb,terms.give_tech,false) - self.technology_value(&fa,terms.get_tech,p.alliance <= self.now);
        if terms.give_city >= 0 { e.score += self.cities.get(&terms.give_city).map_or(0.0,|c| 500.0+c.population*10.0); }
        if terms.get_city >= 0 { e.score -= self.cities.get(&terms.get_city).map_or(0.0,|c| 500.0+c.population*10.0); }
        let politics = (p.trust[s]-50.0)*3.0 - p.grievance[s]*4.0 + p.interest[s]*2.0;
        if terms.flags != 0 { e.score += politics; }
        if terms.flags & PEACE != 0 && p.war {
            let advantage = (fb.power+50.0)/(p.observed_power[s]+50.0);
            e.score += fb.fatigue*7.0 + 100.0 - (advantage-1.0).clamp(-2.0,3.0)*180.0;
            if fb.fatigue > 20.0 { e.reasons |= 1; }
            if advantage > 1.3 { e.reasons |= 2; }
        }
        if personality == 3 { e.score += self.technology_value(&fb,terms.give_tech,false)*0.15; }
        if terms.flags & TRADE != 0 { e.score += if personality == 0 { 220.0 } else { 150.0 }; e.reasons |= 4; }
        if terms.flags & PACT != 0 { e.score += if personality == 1 { 80.0 } else { 20.0 }; }
        if terms.flags & ACCESS != 0 { e.score -= 60.0; }
        if terms.flags & ALLIANCE != 0 {
            if p.trust[s] < 60.0 { e.error = if e.error == 0 { TRUST } else { e.error }; }
            e.score += p.interest[s]*3.0 + (p.trust[s]-60.0)*8.0 - 150.0;
        }
        if terms.flags & SUPPORT != 0 { e.score -= 250.0 + fb.power*0.5; }
        if p.grievance[s] > 10.0 { e.reasons |= 8; }
        if p.trust[s] < 40.0 { e.reasons |= 16; }
        if p.interest[s] > 10.0 { e.reasons |= 32; }
        if terms.get_tech != 0 { e.reasons |= 64; }
        if terms.give_rate > 0.0 || terms.get_rate > 0.0 { e.reasons |= 128; }
        e.counter = (-e.score).max(0.0).ceil();
        e
    }
    fn offer(&mut self, from: i32, to: i32, terms: Terms, call: bool, score: f64) -> u32 {
        // One outstanding negotiation in each direction; calls cannot be overwritten.
        self.offers.retain(|_,o| o.from != from || o.to != to || o.call);
        self.next_id += 1;
        let id=self.next_id;
        self.offers.insert(id,Offer {id,from,to,expires:self.now+if call {45.0} else {90.0},call,score,terms});
        self.event(if call {8} else {7},from,to,id as f64,0.0); id
    }
    fn grant_tech(&mut self, world: &mut World, seller: i32, buyer: i32, mask: u64) {
        for i in 0..self.technologies.len() { if mask & (1<<i) != 0 {
            let mut f=world.get_mut::<Account>(self.accounts[&buyer]).unwrap(); f.known |= 1<<i; f.acquired[i]=self.now+180.0;
            self.event(2,seller,buyer,i as f64,0.0);
        } }
    }
    fn accept(&mut self, world: &mut World, a: i32, b: i32, t: &Terms) {
        self.transfer(world,a,b,t.give); self.transfer(world,b,a,t.get);
        self.grant_tech(world,a,b,t.give_tech); self.grant_tech(world,b,a,t.get_tech);
        let mut p=self.pair(world,a,b).unwrap();
        let new_commitment = (t.flags & (PACT|TRADE|ACCESS|ALLIANCE)) & !p.flags(self.now);
        let end=self.now+t.duration;
        if t.flags & PEACE != 0 && p.war {
            p.war=false; p.since=self.now; p.truce=self.now+180.0; p.withdrawal=self.now+30.0;
            self.event(3,a,b,0.0,0.0);
        }
        if t.flags & PACT != 0 { p.pact=p.pact.max(end); }
        if t.flags & TRADE != 0 { p.trade=p.trade.max(end); p.origin=if a==p.a {t.origin} else {t.destination}; p.destination=if a==p.a {t.destination} else {t.origin}; }
        if t.flags & ACCESS != 0 { p.access=p.access.max(end); }
        if t.flags & ALLIANCE != 0 { if p.alliance<=self.now {p.honored=0.0;} p.alliance=p.alliance.max(end); p.access=p.access.max(end); }
        if t.give_rate > 0.0 || t.get_rate > 0.0 {
            if a==p.a {p.give_rate=t.give_rate;p.get_rate=t.get_rate;} else {p.give_rate=t.get_rate;p.get_rate=t.give_rate;}
            p.payment_at=self.now+30.0;p.payment_end=end;p.arrears=[0.0;2];p.default_at=[0.0;2];
        }
        if new_commitment != 0 { for s in 0..2 { p.trust[s]=(p.trust[s]+3.0).min(100.0); } }
        self.put(world,p);
        if t.give_city>=0 { self.event(9,a,b,t.give_city as f64,0.0); if let Some(c)=self.cities.get_mut(&t.give_city){c.owner=b;} }
        if t.get_city>=0 { self.event(9,b,a,t.get_city as f64,0.0); if let Some(c)=self.cities.get_mut(&t.get_city){c.owner=a;} }
        self.offers.retain(|_,o| key(o.from,o.to)!=key(a,b));
        self.event(4,a,b,t.flags as f64,end);
        if t.flags & SUPPORT != 0 { self.begin_war(world,b,t.enemy,false); }
    }
    fn break_alliance(&mut self, world: &mut World, a:i32,b:i32) {
        if let Some(mut p)=self.pair(world,a,b) {
            let s=p.side(b);p.alliance=0.0;p.honored=0.0;p.access=self.now+30.0;p.trust[s]=(p.trust[s]-30.0).max(0.0);p.grievance[s]+=20.0;
            self.put(world,p);self.event(6,a,b,ALLIANCE as f64,0.0);
        }
    }
    fn begin_war(&mut self,world:&mut World,a:i32,b:i32,calls:bool) {
        let Some(mut p)=self.pair(world,a,b) else{return;};
        if p.war{return;}
        let broken=p.flags(self.now);let victim=p.side(b);
        p.trust[victim]=(p.trust[victim]-if broken!=0 {45.0}else{15.0}).max(0.0);p.grievance[victim]+=if broken!=0 {40.0}else{20.0};
        p.war=true;p.contact=true;p.since=self.now;p.truce=0.0;p.pact=0.0;p.trade=0.0;p.access=0.0;p.alliance=0.0;p.withdrawal=0.0;
        p.payment_end=0.0;p.honored=0.0;p.give_rate=0.0;p.get_rate=0.0;p.arrears=[0.0;2];
        self.put(world,p);self.offers.retain(|_,o|key(o.from,o.to)!=key(a,b));self.event(3,a,b,1.0,broken as f64);
        // Witnesses remember betrayal. Ordinary declarations do not globally
        // poison relations; direct calls only, never recursive alliance chains.
        if broken!=0 {
            let keys:Vec<_>=self.pairs.keys().copied().collect();
            for (x,y) in keys {if x==a||y==a {let mut r=self.pair(world,x,y).unwrap();if r.contact&&key(x,y)!=key(a,b){let s=1-r.side(a);r.trust[s]=(r.trust[s]-12.0).max(0.0);self.put(world,r);}}}
        }
        if !calls{return;}
        let allies:Vec<_>=self.pairs.keys().filter_map(|&(x,y)|{
            let r=self.pair(world,x,y)?;
            (r.alliance>self.now&&(x==b||y==b)).then_some(if x==b{y}else{x})
        }).filter(|&id|id!=a).collect();
        for ally in allies {
            let Some(f)=self.account(world,ally) else{continue;};
            if !f.active{continue;}
            let blocked=self.pair(world,ally,a).is_none_or(|r|r.truce>self.now||r.pact>self.now||r.alliance>self.now);
            if blocked {self.break_alliance(world,ally,b);continue;}
            if f.human {
                self.offer(b,ally,Terms {flags:SUPPORT,duration:180.0,enemy:a,give_city:-1,get_city:-1,origin:-1,destination:-1,..Terms::default()},true,0.0);
            } else if f.fatigue<80.0 {self.begin_war(world,ally,a,false);} else {self.break_alliance(world,ally,b);}
        }
    }
    pub fn command(&mut self,world:&mut World,mode:u32,a:i32,b:i32,offer_id:u32,confirmed:bool) {
        let mut e=Evaluation::default();
        if mode==2||mode==3 {
            if let Some(o)=self.offers.get(&offer_id).cloned().filter(|o|o.to==a&&o.from==b&&o.expires>self.now) {
                if mode==3 {self.offers.remove(&offer_id);if o.call{self.break_alliance(world,a,b);}self.event(10,a,b,offer_id as f64,0.0);}
                else if o.call {
                    if self.account(world,a).is_none_or(|f|!f.active)||self.account(world,o.terms.enemy).is_none_or(|f|!f.active){e.error=INVALID;}
                    else if self.pair(world,a,o.terms.enemy).is_some_and(|p|!p.war&&p.flags(self.now)!=0)&&!confirmed{e.error=CONFIRM;}
                    else {self.offers.remove(&offer_id);self.begin_war(world,a,o.terms.enemy,false);}
                } else {e=self.evaluate(world,o.from,o.to,&o.terms);if e.error==0{self.accept(world,o.from,o.to,&o.terms);}}
            } else {e.error=EXPIRED;}
        } else if mode==4 {
            if let Some(p)=self.pair(world,a,b) {
                if self.account(world,a).is_none_or(|f|!f.active)||self.account(world,b).is_none_or(|f|!f.active){e.error=INVALID;}
                else if !p.contact{e.error=CONTACT;}else if p.war{e.error=WAR;}else if p.flags(self.now)!=0&&!confirmed{e.error=CONFIRM;}
                else{self.begin_war(world,a,b,true);}
            }else{e.error=INVALID;}
        } else if mode==5 {
            if let Some(mut p)=self.pair(world,a,b) {
                let until=self.now+30.0;
                p.pact=p.pact.min(until);p.trade=p.trade.min(until);p.access=p.access.min(until);p.alliance=p.alliance.min(until);
                self.put(world,p);self.event(11,a,b,until,0.0);
            }else{e.error=INVALID;}
        } else if mode==7 {
            e.error = self.assign_aid(world, b, a, offer_id as i64, true);
        } else if mode==6 {
            if let Some(p)=self.pair(world,a,b) {
                let s=p.side(b);
                e.error=if p.war{WAR}else if p.alliance<=self.now||p.honored<180.0{ALLIED}else if p.trust[s]<75.0{TRUST}else if p.affiliation[s]<70.0{AFFILIATION}else{0};
                e.score=p.affiliation[s];
            }else{e.error=INVALID;}
        } else if let Some(t)=Terms::read(&self.input) {
            e=self.evaluate(world,a,b,&t);
            if mode==1&&e.error==0 {
                if self.account(world,b).is_some_and(|f|f.human){self.offer(a,b,t,false,e.score);}
                else if e.score>=0.0 {self.accept(world,a,b,&t);}
                else {
                    e.error=REFUSED;
                    // A concrete counteroffer, in the AI's offer orientation.
                    let mut counter=t.clone();counter.give+=e.counter;
                    if self.account(world,a).is_some_and(|f|f.gold>=counter.give)&&self.evaluate(world,a,b,&counter).error==0 {
                        self.offer(b,a,counter.reverse(),false,0.0);
                    }
                }
            }
        }else{e.error=INVALID;}
        self.publish(world,e);
    }
    fn assign_aid(&mut self, world: &mut World, helper: i32, ally: i32, city: i64, requested: bool) -> u32 {
        let Some(f) = self.account(world, helper) else { return INVALID; };
        let Some(c) = self.cities.get(&city) else { return CITY; };
        if !f.active || f.human || c.owner != ally { return INVALID; }
        if self.pair(world, helper, ally).is_none_or(|p| p.war || p.alliance <= self.now) { return ALLIED; }
        let common_war = self.wars.get(&helper).zip(self.wars.get(&ally)).is_some_and(|(own, allied)|
            own.intersection(allied).any(|enemy| self.accounts.contains_key(enemy)));
        let home_alarm = self.cities.values().any(|c|c.owner==helper&&c.attacked>self.now-15.0);
        let reachable_distance = self.cities.values().filter(|c|c.owner==helper)
            .map(|home|(home.x-c.x).hypot(home.y-c.y)).fold(f64::INFINITY,f64::min);
        if !common_war || home_alarm || f.fatigue >= 80.0 || reachable_distance > 60.0 { return REFUSED; }
        let mut account = world.get_mut::<Account>(self.accounts[&helper]).unwrap();
        account.aid_city=city; account.aid_ally=ally; account.aid_until=self.now+60.0;
        drop(account);
        if requested { self.event(17,helper,ally,city as f64,self.now+60.0); }
        0
    }
    /// Casualty events update only the affected pair, at the actual kill event.
    pub fn casualty(&mut self,world:&mut World,attacker:i32,victim:i32,city:bool) {
        if attacker==victim{return;}
        if let Some(mut p)=self.pair(world,attacker,victim) {
            let s=p.side(victim);p.grievance[s]=(p.grievance[s]+if city{12.0}else{0.5}).min(100.0);
            self.put(world,p);
        }
        if let Some(&e)=self.accounts.get(&victim){let mut f=world.get_mut::<Account>(e).unwrap();f.fatigue=(f.fatigue+if city{25.0}else{1.0}).min(100.0);}
    }
    pub fn step(&mut self,world:&mut World,now:f64) {
        self.now=now;
        let elapsed=self.pairs.values().next().and_then(|&entity|world.get::<Relationship>(entity)).map_or(0.0,|p|(now-p.last_tick).max(0.0));
        let expired:Vec<_>=self.offers.values().filter(|o|o.expires<=now).cloned().collect();
        for o in expired{self.offers.remove(&o.id);if o.call{self.break_alliance(world,o.to,o.from);}self.event(12,o.from,o.to,o.id as f64,0.0);}
        let keys:Vec<_>=self.pairs.keys().copied().collect();
        for (a,b) in keys {
            let mut p=self.pair(world,a,b).unwrap();
            let Some(fa)=self.accounts.get(&a).and_then(|&entity|world.get::<Account>(entity))else{continue;};
            let Some(fb)=self.accounts.get(&b).and_then(|&entity|world.get::<Account>(entity))else{continue;};
            let (a_active,b_active,a_human,b_human)=(fa.active,fb.active,fa.human,fb.human);
            if !a_active||!b_active {
                if p.war||p.flags(now)!=0||p.payment_end>0.0 {p.war=false;p.truce=0.0;p.pact=0.0;p.trade=0.0;p.access=0.0;p.alliance=0.0;p.payment_end=0.0;self.put(world,p);self.event(13,a,b,0.0,0.0);}
                self.offers.retain(|_,o|o.from!=a&&o.to!=a||a_active);self.offers.retain(|_,o|o.from!=b&&o.to!=b||b_active);continue;
            }
            let elapsed=(now-p.last_tick).max(0.0);p.last_tick=now;
            let mut expired_flags=0;
            for (flag,deadline) in [(PEACE,&mut p.truce),(PACT,&mut p.pact),(TRADE,&mut p.trade),(ACCESS,&mut p.access),(ALLIANCE,&mut p.alliance)] {
                if *deadline>0.0&&*deadline<=now {expired_flags|=flag;*deadline=0.0;}
            }
            if p.withdrawal>0.0&&p.withdrawal<=now{p.withdrawal=0.0;expired_flags|=ACCESS;}
            if expired_flags!=0{self.event(16,a,b,expired_flags as f64,0.0);}
            if !p.war {
                for s in 0..2 {p.grievance[s]=(p.grievance[s]-elapsed*0.015).max(0.0);if p.flags(now)&(TRADE|PACT|ALLIANCE)!=0{p.trust[s]=(p.trust[s]+elapsed*0.03).min(100.0);}}
                if p.alliance>now{p.honored+=elapsed;}
            }
            let mut default=false;
            // Preserve all due installments across deferred work. At most 20
            // are possible per contract because duration is bounded to 600 s.
            let first_due=p.payment_at;
            while p.payment_at>0.0&&p.payment_at<=now&&p.payment_at<=p.payment_end {
                p.arrears[0]+=p.give_rate;p.arrears[1]+=p.get_rate;p.payment_at+=30.0;
            }
            for s in 0..2 {
                if p.arrears[s]<=0.0{continue;}
                let (from,to)=if s==0{(a,b)}else{(b,a)};
                let cash=self.account(world,from).unwrap().gold;let paid=cash.min(p.arrears[s]);
                self.transfer(world,from,to,paid);p.arrears[s]-=paid;
                if p.arrears[s]>0.0 {
                    if p.default_at[s]==0.0{p.default_at[s]=if first_due>0.0{first_due+30.0}else{now+30.0};self.event(14,from,to,p.arrears[s],p.default_at[s]);}
                    if now>=p.default_at[s]{p.trust[1-s]=(p.trust[1-s]-25.0).max(0.0);p.grievance[1-s]+=20.0;default=true;self.event(15,from,to,p.arrears[s],0.0);}
                }else{p.default_at[s]=0.0;}
            }
            if default {p.trade=0.0;p.pact=0.0;p.alliance=0.0;p.access=now+30.0;p.payment_end=0.0;p.payment_at=0.0;p.give_rate=0.0;p.get_rate=0.0;p.arrears=[0.0;2];p.default_at=[0.0;2];}
            let due=now>=p.next_ai;p.next_ai=if due{now+8.0}else{p.next_ai};
            self.put(world,p.clone());
            if self.match_pair.is_none()&&due&&p.contact&&now>=p.next_offer&&!self.offers.values().any(|o|key(o.from,o.to)==(a,b)) {
                // Alternate initiative deterministically; human factions never
                // negotiate on behalf of their player.
                let (from,to)=if a_human{(b,a)}else if b_human||((now/8.0) as i64+a as i64)%2==0{(a,b)}else{(b,a)};
                if self.account(world,from).unwrap().human{continue;}
                let initiator=self.account(world,from).unwrap();let side=p.side(from);
                let expansionist=super::ai_policy::policy(world,from).has(super::ai_policy::TERRITORIAL_WARS);
                if !p.war&&p.flags(now)==0&&initiator.fatigue<30.0&&p.intel_at[side]>=0.0
                    &&initiator.power>(if expansionist{p.observed_power[side].max(p.observed_cities[side]*100.0)*1.2}else{p.observed_power[side]*1.5})
                    &&(expansionist||p.grievance[side]>35.0||initiator.personality==2&&p.trust[side]<55.0) {
                    self.begin_war(world,from,to,true);
                    let mut changed=self.pair(world,a,b).unwrap();changed.next_offer=now+90.0;self.put(world,changed);continue;
                }
                let mut t=Terms {duration:300.0,give_city:-1,get_city:-1,enemy:-1,origin:-1,destination:-1,..Terms::default()};
                if p.war {t.flags=PEACE;}
                else if p.trade<=now&&p.origin>=0 {t.flags=TRADE;t.origin=if from==a{p.origin}else{p.destination};t.destination=if from==a{p.destination}else{p.origin};}
                else if p.alliance<=now&&p.trust.iter().all(|&x|x>=65.0)&&p.interest.iter().any(|&x|x>10.0){t.flags=ALLIANCE;}
                else if p.pact<=now {t.flags=PACT;}
                else {
                    let seller=self.account(world,from).unwrap();let buyer=self.account(world,to).unwrap();
                    for i in 0..self.technologies.len(){let mask=1<<i;if self.tech_error(&seller,&buyer,mask)==0{t.give_tech=mask;t.get=self.technology_value(&buyer,mask,self.technologies[i].military).ceil();break;}}
                }
                let evaluation=self.evaluate(world,from,to,&t);let own=self.evaluate(world,to,from,&t.reverse());
                if evaluation.error==0&&own.error==0&&own.score>=0.0 {
                    if self.account(world,to).unwrap().human{self.offer(from,to,t,false,evaluation.score);}
                    else if evaluation.score>=0.0{self.accept(world,from,to,&t);}
                }
                p=self.pair(world,a,b).unwrap();p.next_offer=now+90.0;self.put(world,p);
            }
        }
        let helpers: Vec<_> = self.accounts.keys().copied().collect();
        for helper in helpers {
            let f=self.account(world,helper).unwrap();
            if self.wars.get(&helper).is_none_or(BTreeSet::is_empty) {
                world.get_mut::<Account>(self.accounts[&helper]).unwrap().fatigue=(f.fatigue-elapsed*0.05).max(0.0);
            }
            if f.human || !f.active {continue;}
            let valid=f.aid_until>now&&self.cities.get(&f.aid_city).is_some_and(|c|c.owner==f.aid_ally)
                &&self.pair(world,helper,f.aid_ally).is_some_and(|p|!p.war&&p.alliance>now);
            if valid {continue;}
            world.get_mut::<Account>(self.accounts[&helper]).unwrap().aid_until=0.0;
            let candidates:Vec<_>=self.cities.iter().filter(|(_,c)|c.owner!=helper&&c.attacked>now-20.0).map(|(&id,c)|(id,c.owner)).collect();
            for (city,ally) in candidates {if self.assign_aid(world,helper,ally,city,false)==0{break;}}
        }
        self.publish(world,Evaluation::default());
    }
    fn publish(&mut self,world:&World,e:Evaluation) {
        let mut out=vec![e.error as f64,e.score,e.reasons as f64,e.counter,self.revision as f64,self.pairs.len() as f64,self.offers.len() as f64,self.events.len() as f64,self.history.len() as f64,self.accounts.len() as f64];
        for &entity in self.pairs.values(){world.get::<Relationship>(entity).unwrap().write(&mut out);}
        for o in self.offers.values(){out.extend_from_slice(&[o.id as f64,o.from as f64,o.to as f64,o.expires,f64::from(o.call),o.score]);o.terms.write(&mut out);}
        for event in self.events.drain(..){out.extend_from_slice(&event);}
        for row in &self.history{out.extend_from_slice(row);}
        for &entity in self.accounts.values(){let f=world.get::<Account>(entity).unwrap();let mut transferable=f.known;for(i,&until)in f.acquired.iter().enumerate(){if until>self.now{transferable&=!(1<<i);}}out.extend_from_slice(&[f.id as f64,transferable as f64,f.aid_city as f64,f.aid_ally as f64,f.aid_until,f.personality as f64]);}
        self.output=out;
    }
    pub fn snapshot(&self,world:&World)->Vec<f64>{
        let mut out=vec![1.0,self.now,self.next_id as f64,self.revision as f64,self.pairs.len() as f64,self.offers.len() as f64,self.accounts.len() as f64,self.history.len() as f64];
        for &entity in self.pairs.values(){let p=world.get::<Relationship>(entity).unwrap();p.write(&mut out);out.extend_from_slice(&[p.last_tick,p.intel_at[0],p.intel_at[1]]);}
        for o in self.offers.values(){out.extend_from_slice(&[o.id as f64,o.from as f64,o.to as f64,o.expires,f64::from(o.call),o.score]);o.terms.write(&mut out);}
        for &entity in self.accounts.values(){let f=world.get::<Account>(entity).unwrap();out.extend_from_slice(&[f.id as f64,f.fatigue,f.acquired.len() as f64,f.aid_city as f64,f.aid_ally as f64,f.aid_until,f.personality as f64]);out.extend_from_slice(&f.acquired);}
        for row in &self.history{out.extend_from_slice(row);}out
    }
    pub fn restore(world:&mut World,v:&[f64])->bool{
        if v.len()<8||v[0]!=1.0||v.iter().any(|x|!x.is_finite()) {return false;}
        let(np,no,nf,nh)=(v[4] as usize,v[5] as usize,v[6] as usize,v[7] as usize);
        if np>4096||no>128||nf>64||nh>80{return false;}
        let mut d=Diplomacy{now:v[1],next_id:v[2] as u32,revision:v[3] as u32,..Diplomacy::default()};let mut o=8;
        let mut pairs=Vec::new();let mut accounts=Vec::new();
        for _ in 0..np {
            let Some(r)=v.get(o..o+PAIR+3)else{return false;};o+=PAIR+3;
            let mut p=Relationship::new(r[0] as i32,r[1] as i32,r[3]!=0.0,r[4]);p.contact=r[2]!=0.0;
            p.truce=r[5];p.pact=r[6];p.trade=r[7];p.access=r[8];p.alliance=r[9];p.withdrawal=r[10];
            p.trust=[r[11],r[12]];p.grievance=[r[13],r[14]];p.interest=[r[15],r[16]];p.affiliation=[r[17],r[18]];
            p.observed_power=[r[19],r[20]];p.observed_cities=[r[21],r[22]];p.origin=r[23] as i64;p.destination=r[24] as i64;
            p.give_rate=r[25];p.get_rate=r[26];p.payment_at=r[27];p.payment_end=r[28];p.arrears=[r[29],r[30]];p.default_at=[r[31],r[32]];
            p.honored=r[33];p.next_ai=r[34];p.next_offer=r[35];p.last_tick=r[36];p.intel_at=[r[37],r[38]];pairs.push(p);
        }
        for _ in 0..no {let Some(r)=v.get(o..o+OFFER)else{return false;};o+=OFFER;let Some(t)=Terms::read(&r[6..])else{return false;};let id=r[0] as u32;d.offers.insert(id,Offer{id,from:r[1] as i32,to:r[2] as i32,expires:r[3],call:r[4]!=0.0,score:r[5],terms:t});}
        for _ in 0..nf {let Some(r)=v.get(o..o+7)else{return false;};o+=7;let n=r[2] as usize;if n>53{return false;}let Some(acquired)=v.get(o..o+n)else{return false;};o+=n;accounts.push(Account{id:r[0] as i32,fatigue:r[1],personality:r[6] as u8,aid_city:r[3] as i64,aid_ally:r[4] as i32,aid_until:r[5],acquired:acquired.to_vec(),..Account::default()});}
        for _ in 0..nh {let Some(r)=v.get(o..o+6)else{return false;};o+=6;d.history.push(r.try_into().unwrap());}
        if o!=v.len(){return false;}
        let old=world.remove_resource::<Diplomacy>().unwrap_or_default();
        for e in old.pairs.values().chain(old.accounts.values()){world.despawn(*e);}
        for p in pairs{d.put(world,p);}for f in accounts{d.accounts.insert(f.id,world.spawn(f).id());}
        world.insert_resource(d);true
    }
}

pub fn war_between(world: &World, a: i32, b: i32) -> Option<bool> {
    let diplomacy = world.resource::<Diplomacy>();
    let entity = *diplomacy.pairs.get(&key(a, b))?;
    world.get::<Relationship>(entity).map(|relationship| relationship.war)
}

pub fn sync(world:&mut World,now:f64){world.resource_scope(|world,mut d:Mut<Diplomacy>|d.sync(world,now));}
pub fn step(world:&mut World,now:f64){world.resource_scope(|world,mut d:Mut<Diplomacy>|d.step(world,now));}
pub fn command(world:&mut World,mode:u32,a:i32,b:i32,offer:u32,confirmed:bool){world.resource_scope(|world,mut d:Mut<Diplomacy>|d.command(world,mode,a,b,offer,confirmed));}
pub fn casualty(world:&mut World,a:i32,b:i32,city:bool){world.resource_scope(|world,mut d:Mut<Diplomacy>|d.casualty(world,a,b,city));}
pub fn snapshot(world:&World)->Vec<f64>{world.resource::<Diplomacy>().snapshot(world)}
