//! One-time, per-human quests. The host supplies indexed observations; this
//! resource owns offers, targets, prerequisites, progress, commands and rewards.
//! Broad observations run once per game second. Topology work is revision cached.
use bevy_ecs::prelude::*;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use super::kinds::building as b;

const OFFER: u8 = 0; const ACTIVE: u8 = 1; const READY: u8 = 2; const COMPLETE: u8 = 3; const FAILED: u8 = 4;
const POST: u8 = 0; const ROAD: u8 = 1; const CAMP: u8 = 2; const VOYAGE: u8 = 3;
const PALISADE: u8 = 4; const SETTLEMENT: u8 = 5; const FARMS: u8 = 6; const COLONY: u8 = 7;
pub const GOLD: [f64; 8] = [600.0, 1200.0, 1800.0, 1000.0, 900.0, 1200.0, 700.0, 2400.0];
pub const FOOD: [f64; 8] = [0.0, 0.0, 300.0, 200.0, 200.0, 400.0, 500.0, 1000.0];
pub const RELATIONS: [f64; 8] = [35.0, 0.0, 0.0, 35.0, 45.0, 40.0, 35.0, 55.0];

#[derive(Clone, Default)]
struct Tile { kind: u8, walk: bool, edges: u16, owner: i32 }
#[derive(Clone, Default)]
struct Building { id: i64, kind: u32, faction: i32, x: i32, y: i32, ready: bool, camp: i32, population: f64, village: i32, seen: u32 }
#[derive(Clone, Default)]
struct Village { id: i32, faction: i32, camp: i64, unit: i64, x: f64, y: f64, ux: f64, uy: f64, seen: u32, useen: u32, hostile: u32, friendly: u32 }
#[derive(Clone, Default)]
struct Hermit { id: i64, x: f64, y: f64, home: bool, seen: u32 }
#[derive(Clone, Default)]
struct Leader { x: f64, y: f64, alive: bool, ashore: bool, embarked: bool }
#[derive(Clone)]
struct Field { id: i64, camp: i64, faction: i32, x: i32, y: i32 }
#[derive(Clone)]
struct Post { id: i64, faction: i32, x: i32, y: i32, active: bool }
#[derive(Component, Clone)]
pub struct Quest {
    actor: i32, kind: u8, state: u8, giver_kind: u8, giver: i64, village: i32, giver_faction: i32,
    gx: f64, gy: f64, discovered: bool, x: f64, y: f64, radius: f64,
    target: i64, capital: i64, land: i32, minimum: i64, since: f64, post: i64,
    progress: f64, needed: f64, reason: u8, accepted: f64, area: Vec<usize>, baseline: Vec<i64>, targets: Vec<i64>,
}
impl Quest {
    fn base(actor: i32, kind: u8, giver_kind: u8, giver: i64, village: i32, faction: i32, gx: f64, gy: f64) -> Self {
        Self { actor, kind, state: OFFER, giver_kind, giver, village, giver_faction: faction, gx, gy,
            discovered: false, x: gx, y: gy, radius: 0.0, target: -1, capital: -1, land: -1,
            minimum: 0, since: -1.0, post: -1, progress: 0.0, needed: 1.0, reason: 0, accepted: -1.0,
            area: Vec::new(), baseline: Vec::new(), targets: Vec::new() }
    }
}
#[derive(Resource, Default)]
pub struct Quests {
    pub input: Vec<f64>, output: Vec<f64>, records: BTreeMap<(i32, u8), Entity>,
    width: usize, height: usize, tiles: Vec<Tile>, lands: Vec<i32>, land_sizes: BTreeMap<i32, usize>,
    villages: Vec<Village>, hermits: Vec<Hermit>, buildings: BTreeMap<i64, Building>, fields: Vec<Field>, posts: Vec<Post>,
    leaders: BTreeMap<i32, Leader>, humans: BTreeMap<i32, (u32, bool)>, combatants: Vec<(i32, f64, f64)>,
    capitals: BTreeMap<i32, i64>, visited: BTreeMap<i32, BTreeSet<i32>>, deaths: BTreeMap<i64, i32>,
    now: f64, next_id: i64, topology: u64, next_check: f64, enclosure_cache: BTreeMap<(i32, i32), (u64, bool, BTreeSet<usize>)>,
    route_cache: BTreeMap<(i32, i64), (u64, bool, Vec<i64>)>, occupied: BTreeSet<usize>,
    access: BTreeSet<(i32,i32)>,
}
fn bit(actor: i32) -> u32 { if (0..31).contains(&actor) { 1 << actor } else { 0 } }
fn house(kind: u32) -> bool { matches!(kind, b::HOUSE | b::VILLAGE_TENT | b::SHACK | b::COTTAGE) }
fn camp_target(kind: u32) -> bool { house(kind) || matches!(kind, b::WOODEN_TOWER | b::TOWER) }
impl Quests {
    pub fn prepare(&mut self, length: usize) -> *mut f64 { self.input.resize(length, 0.0); self.input.as_mut_ptr() }
    pub fn due(&mut self, now: f64) -> bool {
        if now < self.next_check && !self.tiles.is_empty() { return false; }
        self.next_check = now + 1.0; true
    }
    pub fn geometry(&mut self, width: usize, height: usize) {
        if self.input.len() != width * height * 4 { return; }
        let land_changed=self.width!=width||self.height!=height||self.tiles.len()!=width*height||self.input.chunks_exact(4).zip(&self.tiles).any(|(row,tile)|row[0]as u8!=tile.kind);
        self.width = width; self.height = height;
        self.tiles = self.input.chunks_exact(4).map(|r| Tile { kind: r[0] as u8, walk: r[1] != 0.0, edges: r[2] as u16, owner: r[3] as i32 }).collect();
        self.topology=self.topology.wrapping_add(1);self.route_cache.clear();self.enclosure_cache.clear();
        if !land_changed{return;}
        self.lands = vec![-1; self.tiles.len()]; self.land_sizes.clear();
        for start in 0..self.tiles.len() {
            if self.tiles[start].kind == 3 || self.lands[start] >= 0 { continue; }
            let id = start as i32; let mut queue = VecDeque::from([start]); self.lands[start] = id; let mut size = 0;
            while let Some(cell) = queue.pop_front() {
                if self.tiles[cell].kind == 0 { size += 1; }
                for next in self.cardinal(cell) { if self.tiles[next].kind != 3 && self.lands[next] < 0 {
                    self.lands[next] = id; queue.push_back(next);
                } }
            }
            self.land_sizes.insert(id, size);
        }
        self.topology = self.topology.wrapping_add(1); self.route_cache.clear(); self.enclosure_cache.clear();
    }
    fn cell(&self, x: f64, y: f64) -> Option<usize> {
        if !x.is_finite() || !y.is_finite() || x < 0.0 || y < 0.0 || x >= self.width as f64 || y >= self.height as f64 { None }
        else { Some(y.floor() as usize * self.width + x.floor() as usize) }
    }
    fn point(&self, cell: usize) -> (f64, f64) { ((cell % self.width) as f64 + 0.5, (cell / self.width) as f64 + 0.5) }
    fn cardinal(&self, cell: usize) -> Vec<usize> {
        let x = cell % self.width; let y = cell / self.width; let mut n = Vec::with_capacity(4);
        if x > 0 { n.push(cell - 1); } if x + 1 < self.width { n.push(cell + 1); }
        if y > 0 { n.push(cell - self.width); } if y + 1 < self.height { n.push(cell + self.width); } n
    }
    fn neighbors(&self, cell: usize) -> Vec<usize> {
        let x = (cell % self.width) as i32; let y = (cell / self.width) as i32;
        let mut result = Vec::with_capacity(8); let mut direction = 0;
        for dy in -1..=1 { for dx in -1..=1 {
            if dx == 0 && dy == 0 { continue; }
            if self.tiles[cell].edges & (1 << direction) != 0 && x + dx >= 0 && y + dy >= 0
                && x + dx < self.width as i32 && y + dy < self.height as i32 {
                result.push((y + dy) as usize * self.width + (x + dx) as usize);
            }
            direction += 1;
        } } result
    }
    fn circle(&self, x: f64, y: f64, radius: f64) -> Vec<usize> {
        let mut cells = Vec::new();
        for ty in ((y - radius).floor() as i32).max(0)..=((y + radius).ceil() as i32).min(self.height as i32 - 1) {
            for tx in ((x - radius).floor() as i32).max(0)..=((x + radius).ceil() as i32).min(self.width as i32 - 1) {
                if (tx as f64 + 0.5 - x).hypot(ty as f64 + 0.5 - y) <= radius { cells.push(ty as usize * self.width + tx as usize); }
            }
        } cells
    }
    /// Header now,nextId,nHumans,nVillages,nHermits,nBuildings,nFields,nPosts,nLeaders,nCombatants.
    /// Snapshot rows are transport; no host-selected targets or completion flags.
    pub fn sync(&mut self) {
        if self.input.len() < 10 || self.tiles.is_empty() { return; }
        let data = std::mem::take(&mut self.input); self.now = data[0]; self.next_id = data[1] as i64;
        let counts: Vec<usize> = data[2..10].iter().map(|n| *n as usize).collect();
        let strides = [3, 12, 5, 10, 5, 5, 7, 3];
        if 10 + counts.iter().zip(strides).map(|(n, s)| n * s).sum::<usize>() != data.len() { self.input = data; return; }
        let mut at = 10; self.humans.clear(); self.villages.clear(); self.hermits.clear(); self.posts.clear(); self.fields.clear(); self.leaders.clear(); self.combatants.clear();
        for _ in 0..counts[0] { let r = &data[at..at+3]; at += 3; self.humans.insert(r[0] as i32, (r[1] as u32, r[2] != 0.0)); }
        for _ in 0..counts[1] { let r = &data[at..at+12]; at += 12; self.villages.push(Village { id:r[0] as i32,faction:r[1] as i32,camp:r[2] as i64,unit:r[3] as i64,
            x:r[4],y:r[5],ux:r[6],uy:r[7],seen:r[8] as u32,useen:r[9] as u32,hostile:r[10] as u32,friendly:r[11] as u32 }); }
        for _ in 0..counts[2] { let r = &data[at..at+5]; at += 5; self.hermits.push(Hermit { id:r[0] as i64,x:r[1],y:r[2],home:r[3] != 0.0,seen:r[4] as u32 }); }
        let mut structures = BTreeMap::new(); let mut signature = 17u64;
        for village in &self.villages { signature=signature.wrapping_mul(31).wrapping_add(village.friendly as u64).wrapping_add(village.hostile as u64); }
        self.occupied.clear();
        for _ in 0..counts[3] { let r = &data[at..at+10]; at += 10;
            let building = Building { id:r[0] as i64,kind:r[1] as u32,faction:r[2] as i32,x:r[3] as i32,y:r[4] as i32,ready:r[5] != 0.0,camp:r[6] as i32,population:r[7],village:r[8] as i32,seen:r[9] as u32 };
            for value in [building.id, building.kind as i64, building.faction as i64, building.x as i64, building.y as i64, building.ready as i64] {
                signature = signature.wrapping_mul(31).wrapping_add(value as u64);
            }
            if !b::route(building.kind) && !b::wall(building.kind) && building.kind != b::IRRIGATION {
                for dy in 0..b::height(building.kind) as i32 { for dx in 0..b::width(building.kind) as i32 {
                    if let Some(cell) = self.cell((building.x + dx) as f64, (building.y + dy) as f64) { self.occupied.insert(cell); }
                } }
            }
            structures.insert(building.id, building);
        }
        if signature != self.topology { self.route_cache.clear(); self.enclosure_cache.clear(); self.topology = signature; }
        self.buildings = structures;
        for _ in 0..counts[4] { let r = &data[at..at+5]; at += 5; self.fields.push(Field { id:r[0] as i64,camp:r[1] as i64,faction:r[2] as i32,x:r[3] as i32,y:r[4] as i32 }); }
        for _ in 0..counts[5] { let r = &data[at..at+5]; at += 5; self.posts.push(Post { id:r[0] as i64,faction:r[1] as i32,x:r[2].floor() as i32,y:r[3].floor() as i32,active:r[4] != 0.0 }); }
        for _ in 0..counts[6] { let r = &data[at..at+7]; at += 7; self.leaders.insert(r[0] as i32, Leader { x:r[1],y:r[2],alive:r[3] > 0.0,ashore:r[4] == 0.0 && r[5] == 0.0,embarked:r[5]!=0.0 }); }
        for _ in 0..counts[7] { let r = &data[at..at+3]; at += 3; self.combatants.push((r[0] as i32, r[1], r[2])); }
        for &actor in self.humans.keys() {
            if !self.capitals.contains_key(&actor) { if let Some(capital) = self.buildings.values().find(|b| b.faction == actor && b.kind == b::PALACE && b.ready) {
                self.capitals.insert(actor, capital.id);
                if let Some(cell)=self.cell(capital.x as f64,capital.y as f64){if self.lands[cell]>=0{self.visited.entry(actor).or_default().insert(self.lands[cell]);}}
            } }
            if let Some(leader) = self.leaders.get(&actor) { if leader.alive && leader.ashore { if let Some(cell) = self.cell(leader.x, leader.y) {
                let land = self.lands[cell]; if land >= 0 && self.tiles[cell].kind == 0 { self.visited.entry(actor).or_default().insert(land); }
            } } }
        }
        self.input = data;
    }
    fn giver(&self, quest: &Quest) -> Option<(f64, f64, bool)> {
        if quest.giver_kind >= 2 { let h = self.hermits.iter().find(|h| h.id == quest.giver && h.home)?;
            return Some((h.x, h.y, h.seen & bit(quest.actor) != 0)); }
        let v = self.villages.iter().find(|v| v.id == quest.village && v.hostile & bit(quest.actor) == 0)?;
        if !self.buildings.contains_key(&v.camp) { return None; }
        if quest.giver_kind == 0 && v.camp == quest.giver { Some((v.x, v.y, v.seen & bit(quest.actor) != 0)) }
        else if quest.giver_kind == 1 && v.unit == quest.giver { Some((v.ux, v.uy, v.useen & bit(quest.actor) != 0)) } else { None }
    }
    fn foreign_land(&self, actor: i32, x: f64, y: f64) -> Option<(i32, usize)> {
        let minimum = ((self.width * self.height) / 140).max(120);
        self.land_sizes.iter().filter(|(land, size)| **size >= minimum && !self.visited.get(&actor).is_some_and(|v| v.contains(land)))
            .filter_map(|(&land, _)| self.lands.iter().enumerate().filter(|(i, l)| **l == land && self.tiles[*i].walk && self.tiles[*i].kind == 0)
                .min_by(|(a,_),(b,_)| { let pa=self.point(*a);let pb=self.point(*b); (pa.0-x).hypot(pa.1-y).total_cmp(&(pb.0-x).hypot(pb.1-y)) }).map(|(i,_)|(land,i)))
            .min_by(|(_,a),(_,b)| { let pa=self.point(*a);let pb=self.point(*b); (pa.0-x).hypot(pa.1-y).total_cmp(&(pb.0-x).hypot(pb.1-y)) })
    }
    fn usable(&self, cell: usize, actor: i32, village: i32) -> bool {
        let t = &self.tiles[cell]; t.walk && t.kind == 0 && (t.owner < 0 || t.owner == actor || t.owner == village) && !self.occupied.contains(&cell)
    }
    fn reachable_ground(&self,x:f64,y:f64)->BTreeSet<usize>{
        let bridges:BTreeSet<_>=self.buildings.values().filter(|b|b.ready&&b.kind==b::BRIDGE).filter_map(|b|self.cell(b.x as f64,b.y as f64)).collect();
        let Some(start)=self.cell(x,y)else{return BTreeSet::new();};
        let mut visited=BTreeSet::from([start]);let mut queue=VecDeque::from([start]);
        while let Some(cell)=queue.pop_front(){for next in self.neighbors(cell){if(self.tiles[next].walk||bridges.contains(&next))&&visited.insert(next){queue.push_back(next);}}}visited
    }
    fn target_for(&self, q: &mut Quest) -> bool {
        let (vx, vy) = self.villages.iter().find(|v| v.id == q.village).map_or((q.gx, q.gy), |v| (v.x, v.y));
        match q.kind {
            POST => {
                let accessible=self.reachable_ground(vx,vy);
                let mut cells = self.circle(vx,vy,14.0);
                cells.sort_by(|&a,&b| { let pa=self.point(a);let pb=self.point(b); (pa.0-q.gx).hypot(pa.1-q.gy).total_cmp(&(pb.0-q.gx).hypot(pb.1-q.gy)).then(a.cmp(&b)) });
                for cell in cells { let (x,y)=self.point(cell);
                    if (x-vx).hypot(y-vy) < 7.0 || !accessible.contains(&cell)||!self.usable(cell,q.actor,q.giver_faction) || self.tiles[cell].owner >= 0 { continue; }
                    let area: Vec<_> = self.circle(x,y,1.8).into_iter().filter(|&i| accessible.contains(&i)&&self.usable(i,q.actor,q.giver_faction) && self.tiles[i].owner < 0).collect();
                    if area.len() < 3 { continue; }
                    q.area=area;q.x=x;q.y=y;q.radius=1.8;q.needed=180.0;return true;
                } false
            }
            FARMS => {
                for cell in self.circle(vx,vy,16.0) {
                    if !self.usable(cell,q.actor,q.giver_faction) || !self.cardinal(cell).iter().any(|&i|self.tiles[i].kind==1) { continue; }
                    let (x,y)=self.point(cell); let area:Vec<_>=self.circle(x,y,3.5).into_iter().filter(|&i|self.usable(i,q.actor,q.giver_faction)).collect();
                    let new = area.iter().filter(|&&i| !self.fields.iter().any(|f|self.cell(f.x as f64,f.y as f64)==Some(i))).count();
                    if new < 12 {continue;} q.area=area;q.x=x;q.y=y;q.radius=3.5;q.needed=10.0;return true;
                } false
            }
            SETTLEMENT => {
                q.area=self.circle(vx,vy,8.0);q.x=vx;q.y=vy;q.radius=8.0;
                q.area.iter().any(|&i| self.usable(i,q.actor,q.giver_faction) && self.cardinal(i).iter().filter(|&&n|self.usable(n,q.actor,q.giver_faction)).count()>=3)
            }
            PALISADE => { q.area=self.circle(vx,vy,12.0);q.x=vx;q.y=vy;q.radius=12.0;true }
            VOYAGE => { if let Some((land,cell))=self.foreign_land(q.actor,q.gx,q.gy) { q.land=land;(q.x,q.y)=self.point(cell);true } else {false} }
            ROAD => { let Some(&capital)=self.capitals.get(&q.actor) else{return false;};
                if !self.buildings.get(&capital).is_some_and(|b|b.faction==q.actor&&b.ready){return false;}
                q.capital=capital;q.radius=2.0;true }
            CAMP => {
                let camp = self.buildings.values().filter(|b|b.camp>=0 && camp_target(b.kind) && b.ready)
                    .filter(|b|(b.x as f64-q.gx).hypot(b.y as f64-q.gy)<=75.0)
                    .min_by(|a,b|(a.x as f64-q.gx).hypot(a.y as f64-q.gy).total_cmp(&(b.x as f64-q.gx).hypot(b.y as f64-q.gy)));
                if let Some(camp)=camp {q.target=camp.camp as i64;q.x=camp.x as f64+0.5;q.y=camp.y as f64+0.5;q.radius=10.0;true}else{false}
            }
            _ => false,
        }
    }
    fn route(&mut self, q: &Quest) -> (bool,Vec<i64>) {
        let key=(q.actor,q.giver);
        if let Some((revision,ok,path))=self.route_cache.get(&key) {if *revision==self.topology{return(*ok,path.clone());}}
        let Some(capital)=self.buildings.get(&q.capital) else{return(false,Vec::new());};
        let mut roads=BTreeMap::new();
        for b in self.buildings.values().filter(|b|b.ready&&b::route(b.kind)&&(b.faction==q.actor||b.faction<0)) {
            if let Some(cell)=self.cell(b.x as f64,b.y as f64){roads.insert(cell,b.id);}
        }
        // Existing fords bridge natural gaps without pretending dry ground is road.
        for (cell,tile) in self.tiles.iter().enumerate(){if tile.kind==1&&tile.walk{roads.entry(cell).or_insert(-1);}}
        let mut parent=BTreeMap::new();let mut queue=VecDeque::new();
        for &cell in roads.keys(){let p=self.point(cell);let dx=(capital.x as f64-p.0).max(0.0).max(p.0-capital.x as f64-2.0);
            let dy=(capital.y as f64-p.1).max(0.0).max(p.1-capital.y as f64-2.0);if dx.hypot(dy)<=1.0{queue.push_back(cell);parent.insert(cell,cell);}}
        let mut end=None;
        while let Some(cell)=queue.pop_front(){let p=self.point(cell);if(p.0-q.x).hypot(p.1-q.y)<=2.0{end=Some(cell);break;}
            for next in self.cardinal(cell){if roads.contains_key(&next)&&!parent.contains_key(&next){parent.insert(next,cell);queue.push_back(next);}}
        }
        let mut path=Vec::new();if let Some(mut cell)=end{loop{if let Some(&id)=roads.get(&cell){if id>=q.minimum{path.push(id);}}
            let previous=parent[&cell];if previous==cell{break;}cell=previous;}}
        let ok=end.is_some()&&!path.is_empty();self.route_cache.insert(key,(self.topology,ok,path.clone()));(ok,path)
    }
    fn enclosed(&mut self, q:&Quest)->bool{
        let key=(q.actor,q.village);
        if !self.enclosure_cache.get(&key).is_some_and(|(revision,_,_)|*revision==self.topology) {
            if !self.buildings.values().any(|b|b.ready&&b::wall(b.kind)&&(b.faction==q.actor||b.faction==q.giver_faction)){
                self.enclosure_cache.insert(key,(self.topology,false,BTreeSet::new()));return false;
            }
            let region=self.region(q);let ok=self.enclosure_geometry(q,&region);
            self.enclosure_cache.insert(key,(self.topology,ok,region));
        }
        let (_,ok,region)=&self.enclosure_cache[&key];if !ok{return false;}
        // Hostile occupancy invalidates security immediately at the sampled cadence.
        !self.combatants.iter().any(|&(f,x,y)| !self.friendly(q,f)&&self.cell(x,y).is_some_and(|i|region.contains(&i)))
    }
    fn friendly(&self,q:&Quest,faction:i32)->bool{faction==q.actor||faction==q.giver_faction||self.villages.iter().find(|v|v.id==q.village).is_some_and(|v|v.friendly&bit(faction)!=0)}
    fn region(&self,q:&Quest)->BTreeSet<usize>{
        let walls:BTreeSet<_>=self.buildings.values().filter(|b|b.ready&&b::wall(b.kind)&&self.friendly(q,b.faction))
            .filter_map(|b|self.cell(b.x as f64,b.y as f64)).collect();
        let bridges:BTreeSet<_>=self.buildings.values().filter(|b|b.ready&&b.kind==b::BRIDGE).filter_map(|b|self.cell(b.x as f64,b.y as f64)).collect();
        let Some(start)=self.cell(q.x,q.y)else{return BTreeSet::new();};let mut visited=BTreeSet::from([start]);let mut queue=VecDeque::from([start]);
        while let Some(cell)=queue.pop_front(){if cell%self.width==0||cell%self.width+1==self.width||cell/self.width==0||cell/self.width+1==self.height{break;}
            for next in self.neighbors(cell){if !walls.contains(&next)&&(self.tiles[next].walk||bridges.contains(&next))&&visited.insert(next){queue.push_back(next);}}}
        visited
    }
    fn enclosure_geometry(&self,q:&Quest,region:&BTreeSet<usize>)->bool{
        let walls:BTreeSet<_>=self.buildings.values().filter(|b|b.ready&&b::wall(b.kind)&&self.friendly(q,b.faction))
            .filter_map(|b|self.cell(b.x as f64,b.y as f64)).collect();
        if walls.is_empty(){return false;}
        if region.iter().any(|&i|i%self.width==0||i%self.width+1==self.width||i/self.width==0||i/self.width+1==self.height){return false;}
        for building in self.buildings.values().filter(|b|b.ready){
            let Some(cell)=self.cell(building.x as f64,building.y as f64)else{continue;};
            if building.village==q.village&&house(building.kind)&&!region.contains(&cell){return false;}
            if region.contains(&cell)&&(building.camp>=0||building.kind==b::PALACE&&!self.friendly(q,building.faction)){return false;}
        }
        // A real outer wall must separate interior ground from exterior ground;
        // a decorative wall on a naturally isolated island cannot enclose it.
        let own:BTreeSet<_>=self.buildings.values().filter(|b|b.ready&&b::wall(b.kind)&&(b.faction==q.actor||b.faction==q.giver_faction)).filter_map(|b|self.cell(b.x as f64,b.y as f64)).collect();
        let (mut minx,mut miny,mut maxx,mut maxy)=(self.width,self.height,0,0);
        for &i in region{minx=minx.min(i%self.width);miny=miny.min(i/self.width);maxx=maxx.max(i%self.width);maxy=maxy.max(i/self.width);}
        minx=minx.saturating_sub(1);miny=miny.saturating_sub(1);maxx=(maxx+1).min(self.width-1);maxy=(maxy+1).min(self.height-1);
        let mut outside=BTreeSet::new();let mut queue=VecDeque::new();
        for y in miny..=maxy{for x in minx..=maxx{if x!=minx&&x!=maxx&&y!=miny&&y!=maxy{continue;}
            let cell=y*self.width+x;if !region.contains(&cell)&&outside.insert(cell){queue.push_back(cell);}}}
        let mut examined=BTreeSet::new();
        while let Some(wall)=queue.pop_front(){
            if own.contains(&wall)&&!examined.contains(&wall)&&self.neighbors(wall).iter().any(|i|region.contains(i)){
                let mut cluster=VecDeque::from([wall]);examined.insert(wall);
                while let Some(cell)=cluster.pop_front(){for next in self.neighbors(cell){
                    if walls.contains(&next){if examined.insert(next){cluster.push_back(next);}}
                    else if self.tiles[next].walk&&!region.contains(&next){return true;}
                }}
            }
            let x=wall%self.width;let y=wall/self.width;
            for ny in y.saturating_sub(1).max(miny)..=(y+1).min(maxy){for nx in x.saturating_sub(1).max(minx)..=(x+1).min(maxx){
                let next=ny*self.width+nx;if !region.contains(&next)&&outside.insert(next){queue.push_back(next);}
            }}
        }false
    }
    fn progress(&mut self,q:&mut Quest){
        if q.state!=ACTIVE&&q.state!=READY{return;}
        let mut complete=false;
        match q.kind{
            POST=>{let candidate=self.posts.iter().find(|p|p.id==q.post&&p.active&&p.faction==q.actor&&self.cell(p.x as f64,p.y as f64).is_some_and(|i|q.area.contains(&i)))
                .or_else(||self.posts.iter().find(|p|p.id>=q.minimum&&p.active&&p.faction==q.actor&&self.cell(p.x as f64,p.y as f64).is_some_and(|i|q.area.contains(&i))));
                if let Some(p)=candidate{if p.id!=q.post{q.post=p.id;q.since=self.now;}q.progress=(self.now-q.since).clamp(0.0,180.0);complete=q.progress>=180.0;}
                else{q.post=-1;q.since=-1.0;q.progress=0.0;}}
            ROAD=>{if !self.buildings.get(&q.capital).is_some_and(|b|b.faction==q.actor&&b.ready){q.state=FAILED;q.reason=2;return;}
                complete=self.route(q).0;q.progress=complete as u8 as f64;}
            CAMP=>{if self.buildings.values().any(|b|b.camp==q.target as i32&&b.seen&bit(q.actor)!=0){q.radius=0.0;}
                if q.targets.iter().any(|id|self.deaths.get(id).is_some_and(|&actor|actor!=q.actor)){q.state=FAILED;q.reason=3;return;}
                let remaining=self.buildings.values().filter(|b|b.camp==q.target as i32&&camp_target(b.kind)).count();
                q.progress=q.targets.iter().filter(|id|self.deaths.get(id)==Some(&q.actor)).count()as f64;
                complete=remaining==0&&!q.targets.is_empty()&&q.progress>=q.needed;
                if remaining==0&&!complete{q.state=FAILED;q.reason=3;return;}}
            VOYAGE=>{if let Some(l)=self.leaders.get(&q.actor){if l.embarked{q.post=1;}if q.post>=0&&l.alive&&l.ashore&&self.cell(l.x,l.y).is_some_and(|i|self.lands[i]==q.land&&self.tiles[i].kind==0){q.progress=1.0;}}
                complete=q.progress>=1.0;}
            PALISADE=>{complete=self.enclosed(q)&&self.buildings.values().any(|b|b.id>=q.minimum&&b.faction==q.actor&&b.ready&&b::wall(b.kind)&&self.cell(b.x as f64,b.y as f64).is_some_and(|i|q.area.contains(&i)));
                q.progress=complete as u8 as f64;}
            SETTLEMENT=>{let found=self.buildings.values().find(|b|b.id>=q.minimum&&b.kind==b::PALACE&&b.faction==q.actor&&b.ready&&(b.x as f64+1.0-q.x).hypot(b.y as f64+1.0-q.y)<=8.0);
                complete=found.is_some();q.progress=complete as u8 as f64;q.target=found.map_or(-1,|b|b.id);}
            FARMS=>{q.progress=self.fields.iter().filter(|f|f.faction==q.actor&&!q.baseline.contains(&f.id)&&self.cell(f.x as f64,f.y as f64).is_some_and(|i|q.area.contains(&i))).count()as f64;
                complete=q.progress>=10.0;}
            COLONY=>{let city=self.buildings.values().filter(|b|b.faction==q.actor&&b.kind==b::PALACE&&b.ready&&b.id>=q.minimum&&self.cell(b.x as f64,b.y as f64).is_some_and(|i|self.lands[i]==q.land))
                .max_by(|a,b|a.population.total_cmp(&b.population));q.progress=city.map_or(0.0,|b|b.population);q.target=city.map_or(-1,|b|b.id);complete=q.progress>=40.0;}
            _=>{}
        }
        q.state=if complete{READY}else{ACTIVE};
    }
    pub fn death(&mut self,id:i64,actor:i32){if self.buildings.get(&id).is_some_and(|b|b.camp>=0&&camp_target(b.kind)){self.deaths.insert(id,actor);}}
    pub fn holds_hermit(&self,world:&World,id:i64)->bool{self.records.values().any(|&e|world.get::<Quest>(e).is_some_and(|q|q.giver_kind>=2&&q.giver==id&&(q.state==ACTIVE||q.state==READY)))}
    pub fn permits(&self,world:&World,actor:i32,kind:u32,x:i32,y:i32)->bool{
        self.records.values().any(|&e|{let Some(q)=world.get::<Quest>(e)else{return false;};
            if q.actor!=actor||q.state!=ACTIVE&&q.state!=READY{return false;}
            let allowed=match q.kind{POST=>kind==b::OBSERVATION_POST,PALISADE=>b::wall(kind)||b::route(kind),SETTLEMENT=>kind==b::PALACE,FARMS=>b::farm(kind)||b::route(kind)||kind==b::IRRIGATION,_=>false};
            let settlement_center=q.kind==SETTLEMENT&&(x as f64+b::width(kind)/2.0-q.x).hypot(y as f64+b::height(kind)/2.0-q.y)<=8.0;
            allowed&&(0..b::height(kind)as i32).all(|dy|(0..b::width(kind)as i32).all(|dx|self.cell((x+dx)as f64,(y+dy)as f64).is_some_and(|i|
                (if q.kind==SETTLEMENT{settlement_center}else{q.area.contains(&i)})&&self.tiles.get(i).is_none_or(|t|t.owner<0||t.owner==actor||t.owner==q.giver_faction))))
        })
    }
    pub fn reserved(&self,world:&World,id:i64,actor:i32,kind:u32,x:i32,y:i32)->bool{
        self.records.values().any(|&e|world.get::<Quest>(e).is_some_and(|q|q.actor==actor&&id>=q.minimum
            &&(q.state==ACTIVE||q.state==READY)&&(q.kind==PALISADE&&(b::wall(kind)||b::route(kind))||q.kind==FARMS&&b::farm(kind))
            &&self.cell(x as f64,y as f64).is_some_and(|cell|q.area.contains(&cell))))&&self.permits(world,actor,kind,x,y)
    }
    pub fn authoritative(&self)->bool{!self.tiles.is_empty()}
    pub fn access(&self,a:i32,b:i32)->bool{self.access.contains(&(a,b))}
}
fn refresh_access(world:&World,engine:&mut Quests){
    engine.access.clear();for &e in engine.records.values(){let Some(q)=world.get::<Quest>(e)else{continue;};
        if q.village>=0&&(ACTIVE..=COMPLETE).contains(&q.state)&&engine.villages.iter().find(|v|v.id==q.village).is_none_or(|v|v.hostile&bit(q.actor)==0){
            engine.access.insert((q.actor,q.giver_faction));engine.access.insert((q.giver_faction,q.actor));
        }
    }
}

/// Read-only multiplayer clients import the published quest rows for native
/// placement previews. Their mirrors never run authoritative quest commands.
pub fn mirrors(world:&mut World,width:usize,height:usize){
    world.resource_scope(|world,mut engine:Mut<Quests>|{
        if engine.authoritative()||engine.input.is_empty(){return;}
        let rows=engine.input.clone();let mut at=1;let mut parsed=Vec::new();
        for _ in 0..rows[0]as usize{
            let Some(r)=rows.get(at..at+23)else{return;};at+=23;
            let Some(area)=rows.get(at..at+r[22]as usize)else{return;};at+=r[22]as usize;
            if !(0.0..8.0).contains(&r[1]){return;}
            let mut q=Quest::base(r[0]as i32,r[1]as u8,r[3]as u8,r[4]as i64,r[5]as i32,r[6]as i32,r[7],r[8]);
            q.state=r[2]as u8;q.discovered=r[9]!=0.0;q.x=r[10];q.y=r[11];q.radius=r[12];q.area=area.iter().map(|n|*n as usize).collect();parsed.push(q);
        }
        let old:Vec<_>=engine.records.values().copied().collect();for entity in old{world.despawn(entity);}engine.records.clear();engine.width=width;engine.height=height;
        for q in parsed{let key=(q.actor,q.kind);let e=world.spawn(q).id();engine.records.insert(key,e);}refresh_access(world,&mut engine);
    });
}
/// Boarding/landing are sparse events so a fast landing is never missed by
/// the one-second broad observation cadence.
pub fn voyage_event(world:&mut World,actor:i32,x:f64,y:f64,aboard:bool){
    world.resource_scope(|world,mut engine:Mut<Quests>|{
        let land=engine.cell(x,y).filter(|&i|engine.tiles.get(i).is_some_and(|t|t.kind==0)).map(|i|engine.lands[i]);
        if !aboard{if let Some(land)=land{engine.visited.entry(actor).or_default().insert(land);}}
        if let Some(&e)=engine.records.get(&(actor,VOYAGE)){let mut q=world.get_mut::<Quest>(e).unwrap();
            if q.state==ACTIVE||q.state==READY{if aboard{q.post=1;}else if q.post>=0&&land==Some(q.land){q.progress=1.0;q.state=READY;}}
        }
    });
}
pub fn transfer_posts(world:&mut World,village:i32)->*const f64{
    world.resource_scope(|world,mut engine:Mut<Quests>|{
        let posts:BTreeSet<_>=engine.records.values().filter_map(|&e|world.get::<Quest>(e))
            .filter(|q|q.kind==POST&&q.state==COMPLETE&&q.village==village).map(|q|q.post).collect();
        engine.output.clear();engine.output.push(posts.len()as f64);engine.output.extend(posts.iter().map(|&id|id as f64));engine.output.as_ptr()
    })
}

pub fn update(world:&mut World)->*const f64{
    world.resource_scope(|world,mut engine:Mut<Quests>|{
        let entities:Vec<_>=engine.records.values().copied().collect();
        for entity in entities{let mut q=world.get::<Quest>(entity).unwrap().clone();
            if q.state<=READY{
                if engine.humans.get(&q.actor).is_some_and(|(_,dead)|*dead){q.state=FAILED;q.reason=4;}
                else if let Some((x,y,seen))=engine.giver(&q){if seen{q.gx=x;q.gy=y;q.discovered=true;}
                    if q.state==OFFER&&q.kind==CAMP&&!engine.buildings.values().any(|b|b.camp==q.target as i32&&camp_target(b.kind)){q.state=FAILED;q.reason=3;}
                    else if q.state==OFFER&&q.kind==ROAD&&!engine.buildings.get(&q.capital).is_some_and(|b|b.faction==q.actor&&b.ready){q.state=FAILED;q.reason=2;}
                    else{engine.progress(&mut q);}}
                else{q.state=FAILED;q.reason=1;}
            }
            world.entity_mut(entity).insert(q);
        }
        let actors:Vec<_>=engine.humans.iter().map(|(&id,&v)|(id,v)).collect();
        for(actor,(tech,dead))in actors{if dead{continue;}
            for kind in [SETTLEMENT,FARMS,PALISADE,POST,VOYAGE,ROAD,CAMP]{
                if engine.records.contains_key(&(actor,kind))||kind==POST&&tech&1==0||kind==VOYAGE&&tech&2==0{continue;}
                let mut offers=Vec::new();
                if kind==ROAD||kind==CAMP{
                    for h in &engine.hermits{if !h.home||h.seen&bit(actor)==0{continue;}
                        // A cabin and its resident are one giver, across quest kinds.
                        if engine.records.values().any(|&e|world.get::<Quest>(e).is_some_and(|q|q.actor==actor&&q.giver_kind>=2&&q.giver==h.id)){continue;}
                        offers.push(Quest::base(actor,kind,2,h.id,-1,-1,h.x,h.y));}
                }else{for v in &engine.villages{if v.hostile&bit(actor)!=0{continue;}
                    // The village building and its resident share one request.
                    if engine.records.values().any(|&e|world.get::<Quest>(e).is_some_and(|q|q.actor==actor&&q.village==v.id)){continue;}
                    for(giver_kind,id,x,y,seen)in[(0,v.camp,v.x,v.y,v.seen),(1,v.unit,v.ux,v.uy,v.useen)]{
                        if id<0||seen&bit(actor)==0||engine.records.values().any(|&e|world.get::<Quest>(e).is_some_and(|q|q.actor==actor&&q.giver_kind==giver_kind&&q.giver==id)){continue;}
                        offers.push(Quest::base(actor,kind,giver_kind,id,v.id,v.faction,x,y));
                    }
                }}
                if let Some(leader)=engine.leaders.get(&actor){offers.sort_by(|a,b|(a.gx-leader.x).hypot(a.gy-leader.y).total_cmp(&(b.gx-leader.x).hypot(b.gy-leader.y)));}
                for mut q in offers{if !engine.target_for(&mut q){continue;}
                    // Already enclosed/connected places do not create trivial requests.
                    if kind==PALISADE&&engine.enclosed(&q){continue;}
                    if kind==ROAD&&engine.route(&q).0{continue;}
                    q.discovered=true;let entity=world.spawn(q).id();engine.records.insert((actor,kind),entity);break;}
            }
        }
        refresh_access(world,&mut engine);publish(world,&mut engine)
    })
}
fn publish(world:&World,engine:&mut Quests)->*const f64{
    engine.output.clear();engine.output.push(engine.records.len()as f64);
    for &entity in engine.records.values(){let q=world.get::<Quest>(entity).unwrap();
        let mask=engine.records.values().filter_map(|&e|world.get::<Quest>(e)).filter(|other|other.actor==q.actor&&other.state==COMPLETE).fold(0u32,|mask,q|mask|1<<q.kind);
        let(x,y)=if q.kind==CAMP&&q.radius>0.0{((q.x/16.0).floor()*16.0+8.0,(q.y/16.0).floor()*16.0+8.0)}else{(q.x,q.y)};
        engine.output.extend_from_slice(&[q.actor as f64,q.kind as f64,q.state as f64,q.giver_kind as f64,q.giver as f64,q.village as f64,q.giver_faction as f64,q.gx,q.gy,
            q.discovered as u8 as f64,x,y,q.radius,q.target as f64,q.progress,q.needed,q.reason as f64,q.land as f64,GOLD[q.kind as usize],FOOD[q.kind as usize],RELATIONS[q.kind as usize],mask as f64,q.area.len()as f64]);
        engine.output.extend(q.area.iter().map(|&i|i as f64));
    }engine.output.as_ptr()
}
/// Result: error,gold,food,affiliation,benefitMask,village,campId,giftCount;
/// gift rows: table (building/field/post), id, owner, village.
pub fn command(world:&mut World,actor:i32,kind:u8,mode:u32)->*const f64{
    world.resource_scope(|world,mut engine:Mut<Quests>|{
        let mut output=vec![1.0,0.0,0.0,0.0,0.0,-1.0,-1.0,0.0];
        let Some(&entity)=engine.records.get(&(actor,kind))else{engine.output=output;return engine.output.as_ptr();};
        let mut q=world.get::<Quest>(entity).unwrap().clone();
        let live_giver=engine.giver(&q);
        if live_giver.is_none(){output[0]=5.0;engine.output=output;return engine.output.as_ptr();}
        let near=engine.leaders.get(&actor).is_some_and(|l|l.alive&&l.ashore&&live_giver.is_some_and(|(x,y,_)|(l.x-x).hypot(l.y-y)<=4.0));
        if !near{output[0]=2.0;engine.output=output;return engine.output.as_ptr();}
        if mode==1&&q.state==OFFER{
            q.minimum=engine.next_id;q.accepted=engine.now;
            if kind==FARMS{q.baseline=engine.fields.iter().filter(|f|engine.cell(f.x as f64,f.y as f64).is_some_and(|i|q.area.contains(&i))).map(|f|f.id).collect();}
            if kind==VOYAGE&&engine.visited.get(&actor).is_some_and(|v|v.contains(&q.land))&&!engine.target_for(&mut q){output[0]=4.0;engine.output=output;return engine.output.as_ptr();}
            if kind==CAMP{q.targets=engine.buildings.values().filter(|b|b.camp==q.target as i32&&camp_target(b.kind)).map(|b|b.id).collect();q.needed=q.targets.len()as f64;}
            q.state=ACTIVE;output[0]=0.0;engine.route_cache.clear();
        }else if mode==2{
            engine.progress(&mut q);
            if q.state!=READY{output[0]=3.0;}else{
                q.state=COMPLETE;output[0]=0.0;output[1]=GOLD[kind as usize];output[2]=FOOD[kind as usize];output[3]=RELATIONS[kind as usize];
                output[4]=(1u32<<kind)as f64;output[5]=q.village as f64;output[6]=engine.villages.iter().find(|v|v.id==q.village).map_or(-1.0,|v|v.camp as f64);
                let mut gifts=Vec::new();
                if kind==POST{gifts.push([2.0,q.post as f64,q.giver_faction as f64,q.village as f64]);}
                if kind==ROAD{for id in engine.route(&q).1{gifts.push([0.0,id as f64,-1.0,-1.0]);}}
                if kind==PALISADE{for b in engine.buildings.values().filter(|b|b.id>=q.minimum&&b.faction==actor&&b.ready&&(b::wall(b.kind)||b::route(b.kind))){
                    if engine.cell(b.x as f64,b.y as f64).is_some_and(|i|q.area.contains(&i)){gifts.push([0.0,b.id as f64,q.giver_faction as f64,q.village as f64]);}}}
                if kind==FARMS{for f in engine.fields.iter().filter(|f|f.faction==actor&&!q.baseline.contains(&f.id)){
                    if engine.cell(f.x as f64,f.y as f64).is_some_and(|i|q.area.contains(&i)){
                        gifts.push([0.0,f.camp as f64,q.giver_faction as f64,q.village as f64]);
                        gifts.push([1.0,f.id as f64,q.giver_faction as f64,q.village as f64]);}}}
                output[7]=gifts.len()as f64;for gift in gifts{output.extend_from_slice(&gift);}
                if kind==VOYAGE{
                    let mut follow=q.clone();follow.kind=COLONY;follow.state=OFFER;follow.minimum=0;follow.progress=0.0;follow.needed=40.0;follow.area.clear();follow.radius=0.0;
                    let e=world.spawn(follow).id();engine.records.insert((actor,COLONY),e);
                }
            }
        }
        world.entity_mut(entity).insert(q);refresh_access(world,&mut engine);engine.output=output;engine.output.as_ptr()
    })
}
pub fn effect(mask:u32,kind:u32,value:f64)->f64{
    match kind{
        0 if mask&(1<<POST)!=0=>value*0.75, // watchtower upkeep
        1 if mask&(1<<ROAD)!=0=>value*1.20, // construction and repair
        2 if mask&(1<<CAMP)!=0=>value*1.10, // soldier attack
        3 if mask&(1<<VOYAGE)!=0=>value*1.20, // trade
        4 if mask&(1<<PALISADE)!=0=>value*1.25, // defensive health
        5 if mask&(1<<SETTLEMENT)!=0=>value+1.0, // beds per house
        6 if mask&(1<<FARMS)!=0=>value*1.20, // harvests
        7 if mask&(1<<COLONY)!=0=>value*1.25, // science
        _=>value,
    }
}
pub fn snapshot(world:&World)->Vec<f64>{
    let engine=world.resource::<Quests>();let mut out=vec![engine.capitals.len()as f64];
    for(&a,&id)in &engine.capitals{out.extend_from_slice(&[a as f64,id as f64]);}
    out.push(engine.visited.len()as f64);for(&a,lands)in &engine.visited{out.extend_from_slice(&[a as f64,lands.len()as f64]);out.extend(lands.iter().map(|&i|i as f64));}
    out.push(engine.deaths.len()as f64);for(&id,&a)in &engine.deaths{out.extend_from_slice(&[id as f64,a as f64]);}
    out.push(engine.records.len()as f64);for &e in engine.records.values(){let q=world.get::<Quest>(e).unwrap();out.extend_from_slice(&[
        q.actor as f64,q.kind as f64,q.state as f64,q.giver_kind as f64,q.giver as f64,q.village as f64,q.giver_faction as f64,q.gx,q.gy,q.discovered as u8 as f64,
        q.x,q.y,q.radius,q.target as f64,q.capital as f64,q.land as f64,q.minimum as f64,q.since,q.post as f64,q.progress,q.needed,q.reason as f64,q.accepted]);
        for list in [&q.area.iter().map(|&i|i as i64).collect::<Vec<_>>(),&q.baseline,&q.targets]{out.push(list.len()as f64);out.extend(list.iter().map(|&i|i as f64));}
    }out
}
pub fn restore(world:&mut World,data:&[f64])->bool{
    fn take<'a>(data:&'a[f64],at:&mut usize,n:usize)->Option<&'a[f64]>{let next=at.checked_add(n)?;let row=data.get(*at..next)?;*at=next;Some(row)}
    fn count(data:&[f64],at:&mut usize)->Option<usize>{let v=take(data,at,1)?[0];(v.is_finite()&&v>=0.0&&v.fract()==0.0&&v<1_000_000.0).then_some(v as usize)}
    let parsed=(||->Option<(Quests,Vec<Quest>)>{let mut at=0;let mut engine=Quests::default();
        for _ in 0..count(data,&mut at)?{let r=take(data,&mut at,2)?;engine.capitals.insert(r[0]as i32,r[1]as i64);}
        for _ in 0..count(data,&mut at)?{let actor=take(data,&mut at,1)?[0]as i32;let n=count(data,&mut at)?;engine.visited.insert(actor,take(data,&mut at,n)?.iter().map(|v|*v as i32).collect());}
        for _ in 0..count(data,&mut at)?{let r=take(data,&mut at,2)?;engine.deaths.insert(r[0]as i64,r[1]as i32);}
        let mut quests=Vec::new();for _ in 0..count(data,&mut at)?{let r=take(data,&mut at,23)?;if r[1]<0.0||r[1]>7.0||r[2]>4.0{return None;}
            let mut lists=Vec::new();for _ in 0..3{let n=count(data,&mut at)?;lists.push(take(data,&mut at,n)?.iter().map(|v|*v as i64).collect::<Vec<_>>());}
            quests.push(Quest{actor:r[0]as i32,kind:r[1]as u8,state:r[2]as u8,giver_kind:r[3]as u8,giver:r[4]as i64,village:r[5]as i32,giver_faction:r[6]as i32,
                gx:r[7],gy:r[8],discovered:r[9]!=0.0,x:r[10],y:r[11],radius:r[12],target:r[13]as i64,capital:r[14]as i64,land:r[15]as i32,minimum:r[16]as i64,
                since:r[17],post:r[18]as i64,progress:r[19],needed:r[20],reason:r[21]as u8,accepted:r[22],area:lists[0].iter().map(|&i|i as usize).collect(),baseline:lists[1].clone(),targets:lists[2].clone()});
        }(at==data.len()).then_some((engine,quests))})();
    let Some((mut engine,quests))=parsed else{return false;};
    let old:Vec<_>=world.resource::<Quests>().records.values().copied().collect();for e in old{world.despawn(e);}
    for q in quests{let key=(q.actor,q.kind);let e=world.spawn(q).id();engine.records.insert(key,e);}world.insert_resource(engine);true
}
