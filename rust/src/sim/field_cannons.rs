//! Field artillery. Conversion, shared weighted route fields, movement, weapon
//! clocks and upkeep execute in the game's Bevy World; the host mirrors rows.
use bevy_ecs::prelude::*;
use smallvec::SmallVec;
use std::cmp::Reverse;
use std::collections::{BTreeMap, HashMap, HashSet, BinaryHeap};
use super::{entities::EntityTables, kinds::{building as b, unit as u}};

pub const ROW: usize = 24;
pub const TARGET: usize = 12;
pub const RANGE: f64 = super::battle_support::CANNON_RANGE;
pub const UPKEEP: f64 = 120.0;
pub const PERIOD: f64 = 30.0;
pub const SPEED_MULTIPLIER: f64 = 1.125;
pub const SPEED: f64 = 3.6 * 1.1 * SPEED_MULTIPLIER;
const ACCELERATION_TIME: f64 = 2.5;
const BRAKING_TIME: f64 = 0.65;
type Cell = (i32,i32);
type Detour = SmallVec<[Cell; 12]>;
fn cell(x:f64,y:f64)->Cell{(x.floor() as i32,y.floor() as i32)}
fn center(c: Cell) -> (f64, f64) { (c.0 as f64 + 0.5, c.1 as f64 + 0.5) }
fn neighbors(c:Cell)->[Cell;8]{[(c.0,c.1-1),(c.0+1,c.1),(c.0,c.1+1),(c.0-1,c.1),
    (c.0-1,c.1-1),(c.0+1,c.1-1),(c.0-1,c.1+1),(c.0+1,c.1+1)]}
const EXPLICIT:u32=1;
const ATTACK_GOAL:u32=2;
const RALLY_GOAL:u32=4;
const IN_FORMATION:u32=16;
const OFFENSIVE_SLOT:u32=32;
const TRAFFIC_YIELD_DELAY: f64 = 4.0;
const TRAFFIC_PASS_TIME: f64 = 6.0;

/// Integrate a straight segment, returning distance, time used and exit speed.
/// Give any unused time back to the next segment when reaching a waypoint.
fn translation(speed: f64, limit: f64, acceleration: f64, distance: f64, dt: f64) -> (f64, f64, f64) {
    let ramp_time = ((limit - speed) / acceleration).min(dt);
    let ramp_distance = (speed + 0.5 * acceleration * ramp_time) * ramp_time;
    let (step, elapsed) = if distance <= ramp_distance {
        let exit_speed = (speed * speed + 2.0 * acceleration * distance).sqrt();
        (distance, 2.0 * distance / (speed + exit_speed))
    } else {
        let cruise_time = ((distance - ramp_distance) / limit).min(dt - ramp_time);
        (distance.min(ramp_distance + limit * cruise_time), ramp_time + cruise_time)
    };
    (step, elapsed, (speed + acceleration * elapsed).min(limit))
}
#[derive(Clone, Copy)]
struct TrafficBlock { blocker: i64, position: (f64, f64), since: f64 }

#[derive(Clone,Copy,PartialEq)]
struct Site { kind:u32, faction:i32, x:i32, y:i32, flags:u32 }
#[derive(Default)]
struct Field { last_used:f64, revision:u64, navigation:Option<Navigation>, distance:HashMap<Cell,u32>, settled:HashSet<Cell>, frontier:BinaryHeap<Reverse<(u32,Cell)>> }
#[derive(Clone,Copy,PartialEq)]
pub struct Navigation { pub engine:u32, pub grid:u32, pub blockers:u32, pub forbidden:u32, pub width:i32, pub height:i32, pub revision:u64 }
#[derive(Component,Default,Clone)]
pub struct Cannon { next_think:f64, next_plan:f64, hold_until:f64, goal:Option<Cell>, waypoint:Option<Cell>, revision:u64,
    requested:Option<(Cell,u32)>, navigation:Option<Navigation>, rejected:Vec<Cell>, next_detour:f64, detour:Detour,
    traffic_block: Option<TrafficBlock>, yielding: bool, traffic_wait_until: f64,
    velocity: [f64; 2] }
impl Cannon {
    fn waiting_for_traffic(&mut self, now: f64) -> bool {
        if self.yielding && self.waypoint.is_none() && self.detour.is_empty() {
            self.yielding = false;
            self.traffic_wait_until = now + TRAFFIC_PASS_TIME;
        }
        now < self.traffic_wait_until
    }
}
#[derive(Clone,Copy)]
struct Post { point:Cell, seen:f64 }
#[derive(Resource,Default)]
pub struct FieldCannons {
    pub input:Vec<f64>, output:[f64;ROW], sites:HashMap<i64,Site>,
    roads:HashMap<Cell,u32>, paved:HashMap<Cell,u32>, bridges:HashMap<Cell,u32>, blocked:HashMap<Cell,u32>, fields:BTreeMap<(i32,Cell),Field>, navigation:HashMap<i32,Navigation>, revision:u64, work_at:f64, work_left:usize, prune_at:f64,
    posts:HashMap<i64,Post>, posts_prune_at:f64,
    post_cells:HashMap<Cell,i64>,
    detours_left: usize, detour_frontier: BinaryHeap<Reverse<(u32, Cell)>>,
}
fn count(map:&mut HashMap<Cell,u32>,c:Cell,add:bool){
    if add {*map.entry(c).or_default()+=1;} else if let Some(n)=map.get_mut(&c){*n-=1;if *n==0{map.remove(&c);}}
}
impl FieldCannons {
    pub fn prepare(&mut self,n:usize)->*mut f64{self.input.resize(n,0.0);self.input.as_mut_ptr()}
    fn ready_road(&self,c:Cell)->bool{self.roads.contains_key(&c)&&!self.blocked.contains_key(&c)}
    pub fn road(&self,x:f64,y:f64)->bool{x.is_finite()&&y.is_finite()&&self.ready_road(cell(x,y))}
    pub fn road_move(&self,x:f64,y:f64,nx:f64,ny:f64)->bool{
        if !self.road(x,y)||!self.road(nx,ny){return false;}
        let a=cell(x,y);let z=cell(nx,ny);
        a.0==z.0||a.1==z.1||self.ready_road((a.0,z.1))&&self.ready_road((z.0,a.1))
    }
    fn contribute(&mut self,s:Site,add:bool){
        if b::route(s.kind) {if s.flags&4!=0 && s.flags&8!=0 {
            count(&mut self.roads,(s.x,s.y),add);
            if s.kind==b::BRIDGE{count(&mut self.bridges,(s.x,s.y),add);}
            if s.flags&16!=0{count(&mut self.paved,(s.x,s.y),add);}
        }}
        else if s.flags&2!=0 && !b::farm(s.kind) && !matches!(s.kind,b::IRRIGATION|b::RUIN){
            for y in 0..b::height(s.kind) as i32{for x in 0..b::width(s.kind) as i32{count(&mut self.blocked,(s.x+x,s.y+y),add);}}
        }
    }
    pub fn site(&mut self,id:i64,kind:u32,faction:i32,x:f64,y:f64,flags:u32){
        let next=Site{kind,faction,x:x as i32,y:y as i32,flags};
        if self.sites.get(&id)==Some(&next){return;}
        let key=|s:Site| {
            if b::route(s.kind)&&s.flags&12==12 {Some((1,s.x,s.y,u32::from(s.kind==b::BRIDGE)|((s.flags&16)>>3),0))}
            else if !b::route(s.kind)&&s.flags&2!=0&&!b::farm(s.kind)&&!matches!(s.kind,b::IRRIGATION|b::RUIN){Some((2,s.x,s.y,b::width(s.kind) as u32,b::height(s.kind) as u32))}else{None}
        };
        let old=self.sites.remove(&id);
        if let Some(old)=old{self.contribute(old,false);}
        if flags&1!=0{self.contribute(next,true);self.sites.insert(id,next);}
        if old.and_then(key)!=(flags&1!=0).then(||key(next)).flatten(){self.revision+=1;}
    }
    pub fn reset(&mut self){*self=Self::default();}
    /// Retain legal formation cells and swap artillery into the rearmost
    /// cells. Input rows are [id,kind,goalX,goalY]; the host mirrors positions.
    pub fn formation(&mut self,count:usize,x:f64,y:f64,heading:f64)->*const f64{
        let mut rear:Vec<usize>=(0..count).collect();let (fx,fy)=(heading.cos(),heading.sin());
        rear.sort_by(|a,b|{let a=&self.input[*a*4..*a*4+4];let b=&self.input[*b*4..*b*4+4];
            let ad=(a[2]-x)*fx+(a[3]-y)*fy;let bd=(b[2]-x)*fx+(b[3]-y)*fy;
            ad.total_cmp(&bd).then(a[0].total_cmp(&b[0]))});
        let cannons:Vec<usize>=(0..count).filter(|i|self.input[*i*4+1] as u32==u::FIELD_CANNON).collect();
        let reserved=&rear[..cannons.len()];
        let mut waiting=cannons.into_iter().filter(|i|!reserved.contains(i));
        for &slot in reserved {if self.input[slot*4+1] as u32==u::FIELD_CANNON{continue;}let Some(cannon)=waiting.next()else{break;};
            self.input.swap(slot*4+2,cannon*4+2);self.input.swap(slot*4+3,cannon*4+3);
        }
        self.input.as_ptr()
    }
    pub fn navigation(&mut self,faction:i32,navigation:Navigation){self.navigation.insert(faction,navigation);}
    fn open(&self,c:Cell,navigation:Option<Navigation>,engines:&crate::movement::Engines)->bool{
        if let Some(n)=navigation {
            c.0>=0&&c.1>=0&&c.0<n.width&&c.1<n.height&&engines.get(n.engine).sweep(n.grid,c.0 as f64+0.5,c.1 as f64+0.5,c.0 as f64+0.5,c.1 as f64+0.5,n.blockers,n.forbidden)
        }else{self.ready_road(c)}
    }
    fn edge(&self,a:Cell,z:Cell,navigation:Option<Navigation>,engines:&crate::movement::Engines)->bool{
        self.segment_clear(center(a), center(z), navigation, engines)
    }
    fn segment_clear(&self, from: (f64, f64), to: (f64, f64), navigation: Option<Navigation>, engines: &crate::movement::Engines) -> bool {
        if let Some(n) = navigation {
            engines.get(n.engine).sweep(n.grid, from.0, from.1, to.0, to.1, n.blockers, n.forbidden)
        } else {
            self.road_move(from.0, from.1, to.0, to.1)
        }
    }
    fn post_open(&self,id:i64,c:Cell,navigation:Option<Navigation>,engines:&crate::movement::Engines)->bool {
        self.open(c,navigation,engines) && self.post_cells.get(&c).is_none_or(|&other|other==id)
            && navigation.is_none_or(|n| engines.get(n.engine).artillery_position_clear(id,c.0 as f64+0.5,c.1 as f64+0.5))
    }
    fn reserve_post(&mut self,id:i64,point:Option<Cell>,now:f64){
        if let Some(old)=self.posts.remove(&id){if self.post_cells.get(&old.point)==Some(&id){self.post_cells.remove(&old.point);}}
        if let Some(point)=point{self.posts.insert(id,Post{point,seen:now});self.post_cells.insert(point,id);}
    }
    /// Preserve named gun posts. Only a changed destination, topology or a
    /// proven disconnected component can choose another nearby open position.
    fn choose_post(&self,id:i64,faction:i32,cannon:&Cannon,x:f64,y:f64,flags:u32,navigation:Option<Navigation>,engines:&crate::movement::Engines)->Option<Cell>{
        let origin=cell(x,y);let radius=if flags&RALLY_GOAL!=0{1}else{6};
        let available = |c| {
            // Skip components already proven disconnected from this gun.
            self.post_open(id,c,navigation,engines) && !cannon.rejected.iter().any(|goal| self.fields.get(&(faction,*goal))
                .is_some_and(|field|field.frontier.is_empty()&&field.distance.contains_key(&c)))
        };
        if flags & OFFENSIVE_SLOT != 0 && available(origin) { return Some(origin); }
        let mut best:Option<(f64,Cell)>=None;
        for dy in -radius..=radius{for dx in -radius..=radius{
            if flags&RALLY_GOAL!=0 && dx*dx+dy*dy>1 {continue;}
            let c=(origin.0+dx,origin.1+dy);
            if !available(c) {continue;}
            let d=(c.0 as f64+0.5-x).hypot(c.1 as f64+0.5-y);
            let score=d*d+if self.ready_road(c){0.0}else{0.25};
            if best.is_none_or(|(s,p)|score<s||score==s&&c<p){best=Some((score,c));}
        }}best.map(|(_,c)|c)
    }
    fn multiplier(&self,c:Cell)->f64{
        if !self.ready_road(c){0.2}else if self.bridges.contains_key(&c){1.0}else if self.paved.contains_key(&c){super::paved_roads::PAVED_SPEED}else{super::paved_roads::DIRT_SPEED}
    }
    fn edge_cost(&self,a:Cell,z:Cell)->u32 {
        let diagonal=if a.0!=z.0&&a.1!=z.1{std::f64::consts::SQRT_2}else{1.0};
        self.travel_cost(a, z, diagonal)
    }
    fn travel_cost(&self, from: Cell, to: Cell, distance: f64) -> u32 {
        ((500.0 / self.multiplier(from) + 500.0 / self.multiplier(to)) * distance).round() as u32
    }
    /// Search a bounded patch for a clear rejoin point. When none exists,
    /// choose a waiting pocket beside the lane or back out along the lane.
    fn detour(&mut self, id: i64, position: (f64, f64), blocked: Cell, route: (i32, Cell),
        navigation: Navigation, engine: &crate::movement::Engine, yield_direction: Option<(f64, f64)>) -> (Detour, bool) {
        const RADIUS: i32 = 6;
        const WIDTH: usize = (2 * RADIUS + 1) as usize;
        const SIZE: usize = WIDTH * WIDTH;
        let field = &self.fields[&route];
        let remaining_at_blocker = field.distance.get(&blocked).copied();
        let origin = cell(position.0, position.1);
        let index = |c: Cell| ((c.1 - origin.1 + RADIUS) as usize) * WIDTH + (c.0 - origin.0 + RADIUS) as usize;
        let can_move = |from: (f64, f64), to: (f64, f64)| {
            engine.sweep(navigation.grid, from.0, from.1, to.0, to.1, navigation.blockers, navigation.forbidden)
                && engine.artillery_step_clear(id, from.0, from.1, to.0, to.1)
        };
        let mut distances = [u32::MAX; SIZE];
        let mut previous = [None; SIZE];
        let mut frontier = std::mem::take(&mut self.detour_frontier);
        for candidate in std::iter::once(origin).chain(neighbors(origin)) {
            let destination = center(candidate);
            let length = (destination.0 - position.0).hypot(destination.1 - position.1);
            if length <= 1e-8 || !can_move(position, destination) { continue; }
            let cost = self.travel_cost(origin, candidate, length);
            distances[index(candidate)] = cost;
            frontier.push(Reverse((cost, candidate)));
        }
        let mut best: Option<(u32, Cell)> = None;
        let mut pocket: Option<(bool, u32, Cell)> = None;
        while let Some(Reverse((cost, current))) = frontier.pop() {
            if best.is_some_and(|(score, _)| cost > score) { break; }
            if distances[index(current)] != cost { continue; }
            if let Some(&remaining) = field.distance.get(&current) {
                let candidate = (cost.saturating_add(remaining), current);
                if remaining_at_blocker.is_some_and(|blocked| remaining <= blocked)
                    && best.is_none_or(|score| candidate < score) { best = Some(candidate); }
            }
            if let Some((dx, dy)) = yield_direction {
                let (x, y) = center(current);
                let (rx, ry) = (x - position.0, y - position.1);
                let beside = (dx * ry - dy * rx).abs() >= 1.0;
                let behind = dx * rx + dy * ry <= -1.0;
                if beside || behind {
                    let candidate = (!beside, cost, current);
                    if pocket.is_none_or(|score| candidate < score) { pocket = Some(candidate); }
                }
            }
            for next in neighbors(current) {
                if (next.0 - origin.0).abs() > RADIUS || (next.1 - origin.1).abs() > RADIUS { continue; }
                let next_index = index(next);
                let next_cost = cost.saturating_add(self.edge_cost(current, next));
                if next_cost >= distances[next_index] || !can_move(center(current), center(next)) { continue; }
                distances[next_index] = next_cost;
                previous[next_index] = Some(current);
                frontier.push(Reverse((next_cost, next)));
            }
        }
        frontier.clear();
        self.detour_frontier = frontier;
        let mut path = Detour::new();
        let yielding = best.is_none() && pocket.is_some();
        if let Some(mut current) = best.map(|(_, cell)| cell).or_else(|| pocket.map(|(_, _, cell)| cell)) {
            path.push(current);
            while let Some(parent) = previous[index(current)] {
                path.push(parent);
                current = parent;
            }
        }
        (path, yielding)
    }
    fn recover_route(&mut self, cannon: &mut Cannon, id: i64, position: (f64, f64), blocked: Cell, route: (i32, Cell),
        navigation: Navigation, engine: &crate::movement::Engine, now: f64) -> bool {
        if now < cannon.next_detour || self.detours_left == 0 { return false; }
        if now - cannon.next_detour > 2.0 { cannon.traffic_block = None; }
        cannon.next_detour = now + 1.0;
        self.detours_left -= 1;
        let direction = if let Some((blocker, point)) = engine.artillery_blocker(id, position, center(blocked)) {
            let block = cannon.traffic_block.get_or_insert(TrafficBlock { blocker, position: point, since: now });
            if block.blocker != blocker || (block.position.0 - point.0).hypot(block.position.1 - point.1) > 0.2 {
                *block = TrafficBlock { blocker, position: point, since: now };
            }
            let (dx, dy) = (point.0 - position.0, point.1 - position.1);
            let length = dx.hypot(dy);
            // A stable priority lets one gun make room first. If the higher
            // priority gun is blocked by a stationary cannon, it can yield too.
            if length > 1e-8 && (id > blocker || now - block.since >= TRAFFIC_YIELD_DELAY) {
                Some((dx / length, dy / length))
            } else { None }
        } else { None };
        let (mut detour, yielding) = self.detour(id, position, blocked, route, navigation, engine, direction);
        let Some(waypoint) = detour.pop() else { return false; };
        cannon.waypoint = Some(waypoint);
        cannon.detour = detour;
        cannon.yielding = yielding;
        true
    }
    /// Shared Dijkstra fields prefer fast roads, while allowing legal off-road
    /// links. All artillery shares a bounded work allowance for this step.
    fn advance_field(&mut self,faction:i32,goal:Cell,needed:Cell,now:f64,engines:&crate::movement::Engines){
        if self.work_at!=now {self.work_at=now;self.work_left=2048;self.detours_left=4;}
        let key=(faction,goal);let navigation=self.navigation.get(&faction).copied();
        if now>=self.prune_at{self.fields.retain(|_,field|now-field.last_used<3.0);self.prune_at=now+1.0;}
        let mut field=self.fields.remove(&key).unwrap_or_default();
        if field.revision!=self.revision||field.navigation!=navigation||field.distance.is_empty(){
            field=Field{revision:self.revision,navigation,..Field::default()};field.distance.insert(goal,0);field.frontier.push(Reverse((0,goal)));
        }
        field.last_used=now;
        let share=(2048/(self.fields.len()+1)).clamp(1,512);
        let budget=if field.settled.contains(&needed){0}else{share.min(self.work_left)};
        for _ in 0..budget{let Some(Reverse((distance,c)))=field.frontier.pop() else{break;};self.work_left-=1;
            if field.distance.get(&c)!=Some(&distance)||!field.settled.insert(c){continue;}
            for next in neighbors(c){if !self.open(next,navigation,engines)||!self.edge(next,c,navigation,engines){continue;}
                let cost=self.edge_cost(c,next);
                let d=distance.saturating_add(cost);
                if field.distance.get(&next).is_none_or(|old|d<*old){field.distance.insert(next,d);field.frontier.push(Reverse((d,next)));}
            }
            if c==needed{break;}
        }
        self.fields.insert(key,field);
    }
    /// input: [unitId,kind,faction,x,y,hp,maxHP,healthFraction,flags,now,
    /// foundryId,tech, ...occupied x/y pairs]. Output is a conversion command.
    pub fn convert(&mut self,occupied:usize)->*const f64{
        self.output.fill(0.0);let v=&self.input;
        let kind=v[1] as u32;let Some(site)=self.sites.get(&(v[10] as i64)).copied() else{self.output[0]=1.0;return self.output.as_ptr();};
        let eligible=u::retinue(kind);
        let error=if site.kind!=b::FOUNDRY||site.faction!=v[2] as i32||site.flags&4==0{1}
            else if v[11]==0.0{2}
            else if !eligible||kind==u::FIELD_CANNON||v[5]<=0.0||v[8]!=0.0{3}
            else if (site.x as f64-v[3]).max(0.0).max(v[3]-site.x as f64-2.0).hypot((site.y as f64-v[4]).max(0.0).max(v[4]-site.y as f64-2.0))>3.0{4}else{0};
        if error!=0{self.output[0]=error as f64;return self.output.as_ptr();}
        let mut exits=Vec::new();
        for dy in -1..=2{for dx in -1..=2{
            if !((dx==-1||dx==2)&&(0..=1).contains(&dy)||(dy==-1||dy==2)&&(0..=1).contains(&dx)){continue;}
            let c=(site.x+dx,site.y+dy);if !self.ready_road(c){continue;}
            let (x,y)=(c.0 as f64+0.5,c.1 as f64+0.5);
            if (0..occupied).any(|i|(v[12+i*2]-x).hypot(v[13+i*2]-y)<0.85){continue;}
            exits.push(((x-v[3]).hypot(y-v[4]),c));
        }}
        exits.sort_by(|a,b|a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
        let Some((_,exit))=exits.first() else{self.output[0]=5.0;return self.output.as_ptr();};
        self.output[1]=v[0];self.output[2]=exit.0 as f64+0.5;self.output[3]=exit.1 as f64+0.5;
        self.output[4]=200.0;self.output[5]=200.0*v[7].clamp(0.0,1.0);
        self.output[6]=super::battle_support::siege_attack(true,17.0*0.8*4.0/0.95);
        self.output[7]=3.0;self.output[8]=SPEED;self.output[9]=RANGE;self.output[10]=v[9]+PERIOD;
        self.output.as_ptr()
    }
    /// Row: id,faction,x,y,hp,marchSpeed,goalX,goalY,facing,cooldown,shotAt,
    /// upkeepAt,funded,attackTime,goalFlags,forcedTarget,rawAttack,gold,
    /// strength,whaleBonus,peatSupplied,shotTarget,damage,reachedGoal.
    /// Output slot 20 reports whether the cannon moved.
    /// Target rows: id,x,y,range,defense,edge,flags,priority,building,wall,0,0.
    fn step(&mut self,cannon:&mut Cannon,now:f64,dt:f64,targets:usize,engines:&crate::movement::Engines){
        self.output.copy_from_slice(&self.input[..ROW]);self.output[20]=0.0;self.output[21]=-1.0;self.output[23]=0.0;
        let id=self.output[0] as i64;
        let flags=self.output[14] as u32;
        if now>=self.posts_prune_at {
            let cells=&mut self.post_cells;
            self.posts.retain(|id,post|{let keep=now>=post.seen&&now-post.seen<3.0;
                if !keep&&cells.get(&post.point)==Some(id){cells.remove(&post.point);}keep});
            self.posts_prune_at=now+1.0;
        }
        if let Some(post)=self.posts.get_mut(&id){post.seen=now;}
        if self.output[4]<=0.0||dt<=0.0{return;}
        let mut momentum = std::mem::take(&mut cannon.velocity);
        if !self.output[11].is_finite(){self.output[11]=now+PERIOD;}
        if now>=self.output[11]{
            let periods = ((now - self.output[11]) / PERIOD).floor() + 1.0;
            let bill = UPKEEP * periods * crate::ore::peat_upkeep_multiplier(self.input[20] != 0.0);
            self.output[12]=if self.output[17]>=bill{self.output[17]-=bill;1.0}else{0.0};
            self.output[11]+=PERIOD*periods;
        }
        if self.input[23]==0.0&&self.output[15]>=0.0{self.output[15]=-1.0;cannon.goal=None;cannon.waypoint=None;cannon.detour.clear();cannon.next_plan=0.0;return;}
        self.output[9]=(self.output[9]-dt).max(0.0);self.output[13]=(self.output[13]-dt).max(0.0);
        if self.output[9]<=1e-8 && now>=cannon.next_think{
            cannon.next_think=now+1.0;
            let mut best:Option<(u32,f64,usize)>=None;
            for i in 0..targets{let v=&self.input[ROW+i*TARGET..ROW+(i+1)*TARGET];
                let d=(v[1]-self.output[2]).hypot(v[2]-self.output[3]);
                if v[6]==0.0||d>v[3]{continue;}
                let kind=v[10] as u32;
                let rank=if v[8]==0.0{0}else if matches!(kind,b::WOODEN_TOWER|b::TOWER|b::FORT|b::BALLISTA|b::SIEGE_CANNON)||v[11]!=0.0{1}else if kind==b::GUARD_POST{2}else if b::wall(kind){3}else{4};
                let priority=if self.output[15]==v[0]{0}else{1+rank};
                if best.is_none_or(|b|priority<b.0||priority==b.0&&(d<b.1||d==b.1&&v[0]<self.input[ROW+b.2*TARGET])){best=Some((priority,d,i));}
            }
            if let Some((_,_,i))=best{let v=&self.input[ROW+i*TARGET..ROW+(i+1)*TARGET];
                self.output[8]=(v[2]-self.output[3]).atan2(v[1]-self.output[2]);self.output[10]=now;self.output[9]=4.0;self.output[13]=0.74;self.output[21]=v[0];cannon.hold_until=now+4.0;
                let damage = crate::combat::attack_damage(self.output[16] * v[5], v[4]);
                let funded = crate::combat::upkeep_combat_multiplier(self.output[12] != 0.0);
                self.output[22]=super::battle_support::siege_attack(true,damage*funded*self.output[18]*if v[9]!=0.0{2.0}else{1.0});
            }
        }
        if !self.output[6].is_finite()||self.output[13]>0.0||(flags&EXPLICIT==0||flags&ATTACK_GOAL!=0)&&now<cannon.hold_until{return;}
        let faction=self.output[1] as i32;let navigation=self.navigation.get(&faction).copied();
        let marching = flags & OFFENSIVE_SLOT != 0 && flags & RALLY_GOAL == 0;
        let route_flags = flags & !(EXPLICIT | IN_FORMATION);
        let requested_cell = cell(self.output[6],self.output[7]);
        let requested=Some((requested_cell,route_flags));
        if now>=cannon.next_plan||cannon.requested!=requested||cannon.revision!=self.revision||cannon.navigation!=navigation{
            cannon.next_plan=now+1.0;
            let changed=cannon.requested!=requested||cannon.navigation!=navigation||cannon.revision!=self.revision;
            if changed {cannon.rejected.clear();}
            let order_changed = cannon.requested.is_some_and(|(_, mode)| mode != route_flags)
                || flags & EXPLICIT != 0 && cannon.requested != requested;
            // A fresh point order can redirect a gun even while it is yielding.
            let new_destination = flags & !IN_FORMATION == EXPLICIT && cannon.requested != requested;
            if new_destination || order_changed && (marching || !cannon.yielding && now >= cannon.traffic_wait_until) {
                cannon.waypoint = None;
                cannon.detour.clear();
                cannon.traffic_block = None;
                cannon.yielding = false;
                cannon.traffic_wait_until = 0.0;
            }
            let has_slot = flags & OFFENSIVE_SLOT == 0 || cannon.goal == Some(requested_cell);
            let keep=!changed && has_slot && cannon.goal.is_some_and(|goal|self.post_open(id,goal,navigation,engines));
            if marching {
                cannon.goal = Some(requested_cell);
            } else if !keep {
                cannon.goal = self.choose_post(id,faction,cannon,self.output[6],self.output[7],flags,navigation,engines);
            }
            // Follow-goal updates can keep an in-flight segment while it is open.
            if let Some(next)=cannon.waypoint {
                let position = (self.output[2], self.output[3]);
                if !self.segment_clear(position, center(next), navigation, engines) {
                    cannon.waypoint = None;
                    cannon.detour.clear();
                }
            }
            cannon.requested=requested;cannon.revision=self.revision;cannon.navigation=navigation;
            self.reserve_post(id,cannon.goal,now);
        }
        let Some(goal)=cannon.goal else{return;};
        if !marching {
            let current = cell(self.output[2], self.output[3]);
            self.advance_field(faction, goal, current, now, engines);
            let field = &self.fields[&(faction, goal)];
            if field.frontier.is_empty() && !field.settled.contains(&current) {
                if !cannon.rejected.contains(&goal) { cannon.rejected.push(goal); }
                cannon.goal = None;
                cannon.next_plan = 0.0;
                self.reserve_post(id, None, now);
                return;
            }
        }
        let march_speed = if self.input[5] > 0.0 { self.input[5] } else { f64::INFINITY };
        let mut remaining=dt;
        for _ in 0..16{
            if remaining<=1e-9{break;}
            cannon.velocity = [0.0; 2];
            if cannon.waiting_for_traffic(now) { break; }
            if cannon.waypoint.is_none() { cannon.waypoint = cannon.detour.pop(); }
            let position = (self.output[2], self.output[3]);
            let current = cell(position.0, position.1);
            if cannon.waypoint.is_none() {
                let middle = center(current);
                let off_center = (middle.0 - position.0).hypot(middle.1 - position.1) > 0.001;
                if current == goal && !off_center { self.output[23] = 1.0; break; }
                if marching {
                    if !self.segment_clear(position, center(goal), navigation, engines) { break; }
                    cannon.waypoint = Some(goal);
                } else {
                    let field = &self.fields[&(faction, goal)];
                    if !field.settled.contains(&current) { break; }
                    let distance = field.distance[&current];
                    // Start the next leg from the gun's actual position. This lets
                    // a redirected gun go sideways or back without recentering first.
                    cannon.waypoint = neighbors(current).into_iter().filter(|&next| {
                        field.distance.get(&next).is_some_and(|&next_distance| next_distance < distance)
                            && self.segment_clear(position, center(next), navigation, engines)
                    }).min_by_key(|&next| (field.distance[&next].saturating_add(self.edge_cost(current, next)), next))
                        .or_else(|| off_center.then_some(current));
                }
            }
            let Some(next) = cannon.waypoint else { break; };
            if !self.open(next, navigation, engines) { cannon.waypoint = None; cannon.detour.clear(); break; }
            let endpoint = center(next);
            let (dx, dy) = (endpoint.0 - position.0, endpoint.1 - position.1);
            let length = dx.hypot(dy);
            if length < 1e-8 { cannon.waypoint = None; continue; }
            let direction = [dx / length, dy / length];
            let formation_speed = if flags & IN_FORMATION != 0 { 1.25 } else { 1.0 };
            let travel_speed = SPEED * formation_speed * self.output[19] * self.multiplier(current).min(self.multiplier(next));
            let top_speed = travel_speed.min(march_speed);
            let limit = if (next == goal || cannon.yielding) && cannon.detour.is_empty() {
                top_speed.min((2.0 * top_speed * length / BRAKING_TIME).sqrt())
            } else { top_speed };
            // Carry momentum along the new heading. The sprite turns at once,
            // while a sharp turn takes time to regain speed.
            let entry_speed = (momentum[0] * direction[0] + momentum[1] * direction[1]).clamp(0.0, limit);
            let (step, elapsed, exit_speed) = translation(entry_speed, limit, travel_speed / ACCELERATION_TIME, length, remaining);
            let (nx, ny) = (position.0 + direction[0] * step, position.1 + direction[1] * step);
            if let Some(n)=navigation {
                let engine = engines.get(n.engine);
                if !engine.sweep(n.grid, position.0, position.1, nx, ny, n.blockers, n.forbidden) {
                    cannon.waypoint = None;
                    cannon.detour.clear();
                    break;
                }
                if !engine.artillery_step_clear(id, position.0, position.1, nx, ny) {
                    momentum = [0.0; 2];
                    if !marching && self.recover_route(cannon, id, position, next, (faction, goal), n, engine, now) { continue; }
                    break;
                }
            }
            momentum = [direction[0] * exit_speed, direction[1] * exit_speed];
            cannon.velocity = momentum;
            self.output[2] = nx; self.output[3] = ny; self.output[8] = dy.atan2(dx); self.output[20] = 1.0;
            remaining -= elapsed;
            if step>=length-1e-8{cannon.waypoint=None;}else{break;}
        }
    }
}
pub fn due(world:&World,id:i64,now:f64)->bool{
    world.resource::<EntityTables>().units.locate(id).and_then(|(e,_)|world.get::<Cannon>(e)).is_none_or(|c|now>=c.next_think)
}
pub fn order(world:&mut World,id:i64){
    let Some((entity,_))=world.resource::<EntityTables>().units.locate(id) else{return;};
    if let Some(mut c)=world.get_mut::<Cannon>(entity){c.next_think=0.0;}
}
/// Read-only runtime path observations for headless reports and debugging.
pub fn status(world:&mut World,id:i64)->*const f64{
    let cannon=world.resource::<EntityTables>().units.locate(id).and_then(|(e,_)|world.get::<Cannon>(e)).cloned();
    let mut state=world.resource_mut::<FieldCannons>();state.output.fill(f64::NAN);
    if let Some(c)=cannon{
        if let Some((p,flags))=c.requested{state.output[0]=p.0 as f64+0.5;state.output[1]=p.1 as f64+0.5;state.output[11]=flags as f64;}
        if let Some(p)=c.goal{state.output[2]=p.0 as f64+0.5;state.output[3]=p.1 as f64+0.5;}
        if let Some(p)=c.waypoint{state.output[4]=p.0 as f64+0.5;state.output[5]=p.1 as f64+0.5;}
        state.output[6]=c.next_plan;state.output[7]=c.next_think;state.output[8]=c.hold_until;
        state.output[9]=c.rejected.len() as f64;state.output[10]=c.revision as f64;
    }state.output.as_ptr()
}
pub fn step(world:&mut World,id:i64,now:f64,dt:f64,targets:usize,engines:&crate::movement::Engines)->*const f64{
    let Some((entity,_))=world.resource::<EntityTables>().units.locate(id) else{return std::ptr::null();};
    let mut c=world.get::<Cannon>(entity).cloned().unwrap_or_default();
    let pointer={let mut state=world.resource_mut::<FieldCannons>();state.step(&mut c,now,dt,targets,engines);state.output.as_ptr()};
    world.entity_mut(entity).insert(c);pointer
}
pub fn constant(i:u32)->f64{match i{0=>600.0,1=>750.0,2=>UPKEEP,3=>PERIOD,4=>SPEED,5=>RANGE,_=>f64::NAN}}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cannon_yields_into_a_side_pocket_without_losing_its_goal() {
        let mut engines = crate::movement::Engines::default();
        let (width, height) = (8, 4);
        let handle = engines.create(width, height);
        let engine = engines.get_mut(handle);
        let grid = engine.grid_create(width, height);
        let rows: Vec<_> = (0..width * height).flat_map(|index| {
            let (x, y) = (index % width, index / width);
            let open = y == 2 || (x, y) == (2, 1);
            [index as f64, u32::from(open) as f64, 255.0, 1.0]
        }).collect();
        let input = engine.grid_input(rows.len() / 4);
        unsafe { std::ptr::copy_nonoverlapping(rows.as_ptr(), input, rows.len()); }
        engine.grid_patch(grid, rows.len() / 4);
        engine.actor(1, 3.5, 2.5, crate::movement::FIELD_CANNON, 0.0, 200.0, 0, f64::NAN, 0, 0.0, Some(19), false);
        let navigation = Navigation { engine: handle, grid, blockers: 0, forbidden: 0, width, height, revision: 0 };
        let mut state = FieldCannons::default();
        state.navigation(0, navigation);
        let goal = (7, 2);
        state.advance_field(0, goal, (2, 2), 1.0, &engines);
        let mut cannon = Cannon { goal: Some(goal), ..Cannon::default() };
        assert!(state.recover_route(&mut cannon, 2, (2.5, 2.5), (3, 2), (0, goal),
            navigation, engines.get(handle), 1.0));
        assert_eq!(cannon.waypoint, Some((2, 1)));
        assert!(cannon.yielding);
        assert_eq!(cannon.goal, Some(goal));

        cannon.waypoint = None;
        assert!(cannon.waiting_for_traffic(2.0));
        assert!(cannon.waiting_for_traffic(7.9));
        assert!(!cannon.waiting_for_traffic(8.0));
        assert_eq!(cannon.goal, Some(goal));
    }
}
