//! Warships live in the game's Bevy World. The host transports terrain,
//! commands and serializable mirrors; navigation, costs and combat run here.
use bevy_ecs::prelude::*;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use super::vessel_navigation::{VesselGeometry, Search, Plan, Waypoint, direct_route};
use super::entities::EntityTables;
use crate::terrain_rays::MountainTerrain;

pub const STRIDE: usize = 68;
pub const FACTION_STRIDE: usize = 4;
const BUILD: f64 = 500.0;
const UPKEEP: f64 = 50.0;
const BOUNTY: f64 = 1000.0;
const MARINES: f64 = 800.0;
const GALLEY_SPEED: f64 = 2.7;
const CITY_POPULATION: f64 = 100.0;
const REPAIR_PER_SECOND: f64 = 2.4;
const HULL_SCALE: f64 = 0.94;
const HULL_RADIUS: f64 = HULL_SCALE;
const HULL_HALF_SPINE: f64 = 1.5 * HULL_SCALE;
const TURN_RATE: f64 = 0.48;
const REVERSE_SPEED: f64 = 0.65;
// Weapon IDs match NAVAL_WEAPONS in the host bridge; 0 is an empty mount.
const BALLISTA: u32 = 1;
const CANNON: u32 = 2;
const ARCHER: u32 = 0;
const MUSKETMAN: u32 = 1;
const SHORE_STRIDE: usize = 8;
const PLAN_SLICE: usize = 24;
const PLAN_SHIPS: usize = 4;
const MAX_ACTIVE_SEARCHES: usize = 4;
const MAX_ROUTE_WAYPOINTS: usize = 128;
const MIN_STARTING_WATER_AREA: usize = 96;
const COAST: u16 = 128;
const SEA: u16 = 256;
#[derive(Clone, Copy)]
struct ShoreTarget { id:i64, faction:i32, x:f64, y:f64, hp:f64, defense:f64, sight:u8 }
impl ShoreTarget {
    fn in_sight(&self, ship: &Ship, slot: usize) -> bool {
        self.sight & 1 != 0 || self.sight & 2 != 0 && slot < 4 && ship.weapons[slot] == CANNON
    }
}
pub fn fleet_upkeep(count:usize)->f64 {count as f64 * UPKEEP}
pub fn constant(index: u32, class: u32) -> f64 {
    match index { 0 => BUILD, 1 => UPKEEP, 2 => BOUNTY, 3 => CITY_POPULATION, 4 => 90.0, 5 => 30.0,
        6 => GALLEY_SPEED * 1.15_f64.powi(class.min(2) as i32), 7 => (class.min(2) + 2) as f64,
        8 => [900.0, 1100.0, 1400.0][class.min(2) as usize], 9 => MARINES,
        10 => 2.0 * (HULL_HALF_SPINE + HULL_RADIUS), 11 => 2.0 * HULL_RADIUS, _ => f64::NAN }
}
// Tech mask: sailing, lateen sails, naval engineering, siege engines,
// gunpowder, archery.
fn loadout_error(class: u32, marine: u32, weapons: &[u32; 4], tech: u32) -> u32 {
    if class > 2 || marine > MUSKETMAN { return 32; }
    if tech & 1 == 0 { return 25; }
    if class > 0 && tech & 2 == 0 { return 26; }
    if class > 1 && tech & 4 == 0 { return 27; }
    if marine == ARCHER && tech & 32 == 0 { return 30; }
    if marine == MUSKETMAN && tech & 16 == 0 { return 29; }
    for (i,w) in weapons.iter().enumerate() {
        if i >= class as usize + 2 && *w != 0 { return 33; }
        if *w > CANNON { return 32; }
        if (*w == BALLISTA || *w == CANNON) && tech & 8 == 0 { return 28; }
        if *w == CANNON && tech & 16 == 0 { return 29; }
    }
    0
}
#[derive(Clone, Copy)]
struct Gunner { target: Option<i64>, angle: f64, fired: f64, next: f64 }
impl Default for Gunner {
    fn default() -> Self { Self { target: None, angle: 0.0, fired: -1000.0, next: 0.0 } }
}
fn weapon_stats(kind: u32) -> Option<(f64, f64, f64)> {
    match kind { BALLISTA => Some((12.0,28.0,3.0)), CANNON => Some((14.0,80.0,5.0)), _ => None }
}
fn gun_origin(s: &Ship, slot: usize) -> (f64,f64) {
    let (side,forward) = if slot < 4 {
        match s.class {
            0 => (0.0, if slot == 0 {45.0/32.0} else {-45.0/32.0}),
            1 => (0.0, (1.0-slot as f64)*44.0/32.0),
            _ => (if slot%2==0 {-15.0/32.0} else {15.0/32.0}, if slot<2 {42.0/32.0} else {-40.0/32.0})
        }
    } else { let i=slot-4; (if i%2==0 {-0.65} else {0.65}, (i/2)as f64*0.7-1.05) };
    (s.x+s.angle.cos()*forward-s.angle.sin()*side, s.y+s.angle.sin()*forward+s.angle.cos()*side)
}
fn gun_stats(s:&Ship, slot:usize) -> Option<(f64,f64,f64)> {
    if slot<4 { return weapon_stats(s.weapons[slot]); }
    if slot-4 >= (s.crew/100.0).ceil()as usize { return None; }
    match s.marine { ARCHER => Some((6.0,3.0,1.8)), MUSKETMAN => Some((7.0,5.0,2.5)), _ => None }
}
// The outward contact normal identifies the reinforced prow, stern or broadside.
fn impact_exposure(angle:f64,nx:f64,ny:f64)->f64 {
    let forward=angle.cos()*nx+angle.sin()*ny;
    if forward>0.65 {0.30} else if forward< -0.65 {0.75} else {1.35}
}
#[derive(Component, Clone)]
struct Ship {
    id: i64, class: u32, faction: i32, x: f64, y: f64, angle: f64, hp: f64,
    speed: f64, kills: f64, marine: u32, crew: f64, anchored: bool, ready: f64,
    upkeep: f64, funded: bool, weapons: [u32; 4], yard: i64,
    goal: Option<(f64,f64)>, forward: f64, turn: f64, manual: bool,
    target: Option<i64>, next_plan: f64, next_target: f64,
    guns: [Gunner;12], collision: f64, last_attacker: i32, last_ship: i64, rewarded: bool,
    route: VecDeque<Waypoint>, ai: bool, ordered:Option<i64>,
    next_repair: f64, repairing: bool, healed: bool,
    lateral: bool,
}
impl Ship {
    fn import(r: &[f64], old: Option<&Self>) -> Self {
        let mut s = old.cloned().unwrap_or(Self { id:r[0] as i64,class:0,faction:0,x:0.0,y:0.0,angle:0.0,hp:0.0,speed:0.0,kills:0.0,marine:ARCHER,crew:MARINES,anchored:false,ready:0.0,upkeep:0.0,funded:true,weapons:[0;4],yard:0,goal:None,forward:0.0,turn:0.0,manual:false,target:None,next_plan:0.0,next_target:0.0,guns:[Gunner::default();12],collision:0.0,last_attacker:-1,last_ship:-1,rewarded:false,route:VecDeque::new(),ai:false,ordered:None,next_repair:0.0,repairing:false,healed:false,lateral:false });
        if old.is_none() { for i in 0..12 { let at=31+i*3; s.guns[i]=Gunner {
            target: if r[at]<0.0 {None} else {Some(r[at]as i64)}, angle:r[at+1], fired:r[at+2], next:r[at+2].max(0.0) };
        }}
        if s.anchored!=(r[11]!=0.0)||s.faction!=r[2]as i32 {s.next_repair=0.0;}
        s.class=r[1] as u32; s.faction=r[2] as i32; s.x=r[3];s.y=r[4];s.angle=r[5];s.hp=r[6];s.speed=r[7];s.kills=r[8];s.marine=r[9] as u32;s.crew=r[10];s.anchored=r[11]!=0.0;s.ready=r[12];s.upkeep=r[13];s.funded=r[14]!=0.0;
        for i in 0..4 {s.weapons[i]=r[15+i] as u32;}
        s.yard=r[19] as i64;
        let goal=if r[20].is_finite() && r[21].is_finite(){Some((r[20],r[21]))}else{None};
        if goal!=s.goal {s.route.clear();s.next_plan=0.0;}
        s.goal=goal;s.forward=r[22].clamp(-1.0,1.0);s.turn=r[23].clamp(-1.0,1.0);s.manual=r[24]!=0.0;
        s.last_ship=r[30]as i64;s.last_attacker=r[25] as i32;s.rewarded=r[26]!=0.0;s.ai=r[29]!=0.0;
        let ordered=if r[67]>=0.0{Some(r[67]as i64)}else{None};
        if ordered!=s.ordered{s.next_target=0.0;}s.ordered=ordered;
        if old.is_none() {for slot in 0..12 {if let Some((_,_,reload))=gun_stats(&s,slot) {s.guns[slot].next=(s.guns[slot].fired+reload).max(0.0);}}}
        s
    }
    fn row(&self)->[f64;STRIDE] {
        let mut r=[0.0;STRIDE];r[0]=self.id as f64;r[1]=self.class as f64;r[2]=self.faction as f64;r[3]=self.x;r[4]=self.y;r[5]=self.angle;r[6]=self.hp;r[7]=self.speed;r[8]=self.kills;r[9]=self.marine as f64;r[10]=self.crew;r[11]=self.anchored as u8 as f64;r[12]=self.ready;r[13]=self.upkeep;r[14]=self.funded as u8 as f64;
        for i in 0..4 {r[15+i]=self.weapons[i] as f64;}
        r[19]=self.yard as f64;r[20]=self.goal.map_or(f64::NAN,|g|g.0);r[21]=self.goal.map_or(f64::NAN,|g|g.1);r[25]=self.last_attacker as f64;r[26]=self.rewarded as u8 as f64;r[30]=self.last_ship as f64;
        for i in 0..12 {let at=31+i*3;r[at]=self.guns[i].target.map_or(-1.0,|id|id as f64);r[at+1]=self.guns[i].angle;r[at+2]=self.guns[i].fired;}
        // Steering fields are input-only; output slot 22 publishes repair activity.
        r[22]=self.healed as u8 as f64;r[67]=self.ordered.map_or(-1.0,|id|id as f64);
        r
    }
}
#[derive(Resource, Default)]
pub struct Warships { input:Vec<f64>, output:Vec<f64>, width:i32,height:i32,grid:Vec<u16>, ships:BTreeMap<i64,Entity>, plans:BTreeMap<i64,usize>, mountains: MountainTerrain, sinks:BTreeMap<i64,[f64;7]>, sink_revision:u64, effects:Vec<f64>, effects_revision:u64,
    geometry_revision:u64, searches:BTreeMap<i64,Search>, plan_after:i64,
    starting_water: Option<(u64, Vec<usize>)> }
impl Warships {
    pub fn record_sink(&mut self,id:i64,x:f64,y:f64,angle:f64,class:u32,faction:i32,now:f64) {
        if let std::collections::btree_map::Entry::Vacant(entry)=self.sinks.entry(id) {
            entry.insert([id as f64,x,y,angle,class as f64,faction as f64,now]);self.sink_revision+=1;
        }
    }
    pub fn sinking(&mut self,now:f64)->*const f64 {
        let before=self.sinks.len();self.sinks.retain(|_,s|now-s[6]<4.0);
        if before!=self.sinks.len() {self.sink_revision+=1;}
        if self.effects_revision==self.sink_revision&&!self.effects.is_empty() {return self.effects.as_ptr();}
        self.effects_revision=self.sink_revision;
        self.effects.clear();self.effects.extend([self.sink_revision as f64,self.sinks.len()as f64]);
        for row in self.sinks.values(){self.effects.extend_from_slice(row);}
        self.effects.as_ptr()
    }
    pub fn terrain(&mut self, terrain: MountainTerrain) {
        if !std::sync::Arc::ptr_eq(&self.mountains.0, &terrain.0) { self.mountains = terrain; }
    }
    pub fn input(&mut self,n:usize)->*mut f64 {self.input.resize(n,0.0);self.input.as_mut_ptr()}
    pub fn geometry(&mut self,w:i32,h:i32){self.width=w;self.height=h;self.grid=self.input.iter().take((w*h) as usize).map(|v|*v as u16).collect();self.geometry_revision+=1;self.searches.clear();}
    pub fn patch(&mut self,count:usize){
        let mut changed=false;
        for r in self.input[..count*2].chunks_exact(2){if let Some(cell)=self.grid.get_mut(r[0]as usize){
            let next=r[1]as u16;
            // Hull navigation reads water availability and its relief level.
            // Construction toggling dry land 0<->2, or a coastal label alone,
            // cannot change any pose and must not erase an in-progress search.
            let navigable=|value:u16|if value&3==1{value&127}else{0};
            if (*cell^next)&SEA!=0{self.starting_water=None;}
            changed|=navigable(*cell)!=navigable(next);*cell=next;
        }}
        if changed{self.geometry_revision+=1;self.searches.clear();}
    }
    fn cell_data(&self,x:f64,y:f64)->u16 {let (x,y)=(x.floor() as i32,y.floor() as i32);if x<0||y<0||x>=self.width||y>=self.height{0}else{self.grid.get((y*self.width+x)as usize).copied().unwrap_or(0)}}
    fn cell(&self,x:f64,y:f64)->u16 { self.cell_data(x,y) & 3 }
    fn level(&self,x:f64,y:f64)->u16 { (self.cell_data(x,y) >> 2)&31 }
    fn coastal(&self,x:f64,y:f64)->bool {self.cell(x,y)==1&&self.cell_data(x,y)&COAST!=0}
    fn pose(&self,x:f64,y:f64,a:f64)->bool {
        let(c,s)=(a.cos(),a.sin());
        let level = self.level(x, y);
        // Sub-cell samples follow the same smaller capsule used for other hulls.
        for f in -5..=5 {for side in -2..=2 {let forward=f as f64*0.49*HULL_SCALE;let sideways=side as f64*0.49*HULL_SCALE;
            if (forward.abs()-HULL_HALF_SPINE).max(0.0).powi(2)+sideways*sideways>HULL_RADIUS*HULL_RADIUS {continue;}
            let cell = self.cell_data(x+c*forward-s*sideways,y+s*forward+c*sideways);
            if cell&3 != 1 || (cell>>2)&31 != level {return false;}
        }}true
    }
    /// A water tile can still be too close to shore for the whole hull. Keep
    /// clicks local: resolve to the nearest clear half-tile pose within two
    /// tiles, or reject the order. Never accept an impossible exact endpoint.
    fn clear_destination(&self,s:&Ship,point:(f64,f64))->Option<(f64,f64)> {
        if !point.0.is_finite()||!point.1.is_finite(){return None;}
        let fits=|x:f64,y:f64|self.pose(x,y,s.angle)
            ||(0..8).any(|h|self.pose(x,y,h as f64*std::f64::consts::FRAC_PI_4));
        if fits(point.0,point.1){return Some(point);}
        let mut best=None;let mut score=(f64::INFINITY,f64::INFINITY);
        for radius in 1_i32..=4 {for dy in -radius..=radius {for dx in -radius..=radius {
            if dx.abs()!=radius&&dy.abs()!=radius{continue;}
            let candidate=(point.0+dx as f64*0.5,point.1+dy as f64*0.5);
            let distance=(dx*dx+dy*dy)as f64*0.25;
            if distance>4.0{continue;}
            let travel=(candidate.0-s.x).hypot(candidate.1-s.y);
            if (distance>score.0||distance==score.0&&travel>=score.1)||!fits(candidate.0,candidate.1){continue;}
            best=Some(candidate);score=(distance,travel);
        }}}
        best
    }
    fn shore(&self,s:&Ship,requested:Option<(f64,f64)>,known:Option<&[f64]>)->Option<(f64,f64)> {
        let mut best=None;let mut distance=f64::INFINITY;
        let mut consider=|p:(f64,f64)|{
            if requested.is_some_and(|r| (p.0-r.0).hypot(p.1-r.1)>0.1){return;}
            let gap=hull_distance(s,p.0,p.1);
            if gap<=2.0 && gap<distance {
                distance=gap;best=Some(p);
            }
        };
        if let Some(points)=known{for p in points.chunks_exact(2){consider((p[0],p[1]));}}
        else{for dy in -5..=5 {for dx in -5..=5 {let p=(s.x.floor()+dx as f64+0.5,s.y.floor()+dy as f64+0.5);
            if self.cell(p.0,p.1)==2{consider(p);}
        }}}
        best
    }
    fn yard_pose(&self,x:f64,y:f64)->bool {
        (0..3).all(|dy|(0..3).all(|dx|self.cell(x+dx as f64+0.5,y+dy as f64+0.5)==2)) &&
        (0..3).any(|i|[(x+i as f64+0.5,y-0.5),(x+i as f64+0.5,y+3.5),(x-0.5,y+i as f64+0.5),(x+3.5,y+i as f64+0.5)].iter().any(|p|self.coastal(p.0,p.1)))
    }
    fn yard_coast(&self,x:f64,y:f64)->bool {
        (0..3).any(|i|[(x+i as f64+0.5,y-0.5),(x+i as f64+0.5,y+3.5),(x-0.5,y+i as f64+0.5),(x+3.5,y+i as f64+0.5)].iter().any(|p|self.coastal(p.0,p.1)))
    }
    fn launch(&self,x:f64,y:f64,ships:&[Ship])->Option<(f64,f64,f64)> {
        for radius in 2_i32..=7 {for dy in -radius..=radius {for dx in -radius..=radius {
            if dx.abs()!=radius && dy.abs()!=radius {continue;}
            let (px,py)=(x+1.5+dx as f64,y+1.5+dy as f64);
            for h in 0..8 {let a=h as f64*std::f64::consts::FRAC_PI_4;
                if self.pose(px,py,a) && ships.iter().filter(|s|s.hp>0.0).all(|s|separation(s,px,py,a).0>0.3){return Some((px,py,a));}
            }
        }}}None
    }
    /// A centered 2×5 hull can turn through any heading in a flat 5×5
    /// square. Adjacent clear squares let it sail between centers at any
    /// heading. Label coastal and ocean regions once per geometry revision.
    fn starting_water_regions(&self) -> Vec<usize> {
        let width = self.width as usize;
        let height = self.height as usize;
        let mut clear = vec![false; self.grid.len()];
        for y in 2..height.saturating_sub(2) {
            for x in 2..width.saturating_sub(2) {
                let cell = y * width + x;
                let water = self.grid[cell] & !COAST;
                clear[cell] = water & (SEA | 3) == (SEA | 1) && (y - 2..=y + 2).all(|row| {
                    self.grid[row * width + x - 2..row * width + x + 3]
                        .iter().all(|value| value & !COAST == water)
                });
            }
        }
        let mut areas = vec![0; clear.len()];
        let mut region = Vec::new();
        for first in 0..clear.len() {
            if !clear[first] { continue; }
            clear[first] = false;
            region.push(first);
            let mut cursor = 0;
            while cursor < region.len() {
                let cell = region[cursor];
                for next in [cell - width, cell + width, cell - 1, cell + 1] {
                    if clear[next] {
                        clear[next] = false;
                        region.push(next);
                    }
                }
                cursor += 1;
            }
            let area = region.len();
            if area >= MIN_STARTING_WATER_AREA {
                for &cell in &region { areas[cell] = area; }
            }
            region.clear();
        }
        areas
    }
    fn scenario_berth(&self, x: f64, y: f64, ship: &Ship, ships: &[Ship]) -> Option<(f64,f64,f64,usize)> {
        let (_, areas) = self.starting_water.as_ref()?;
        let width = self.width as usize;
        let mut closest = None;
        let mut best_distance = f64::INFINITY;
        let (yard_x, yard_y) = (x + 1.5, y + 1.5);
        for (cell, &area) in areas.iter().enumerate() {
            if area == 0 { continue; }
            let (x, y) = ((cell % width) as f64 + 0.5, (cell / width) as f64 + 0.5);
            let (dx, dy) = (x - yard_x, y - yard_y);
            let distance = dx * dx + dy * dy;
            if distance >= best_distance { continue; }
            let angle = dy.atan2(dx);
            if ships.iter().any(|other| other.hp > 0.0 && other.id != ship.id && separation(other, x, y, angle).0 <= 0.3) { continue; }
            closest = Some((x, y, angle, area));
            best_distance = distance;
        }
        closest
    }
    fn attack_position(&self,s:&Ship,x:f64,y:f64,range:f64)->Option<(f64,f64)> {
        let mut best=None;let mut score=f64::INFINITY;
        for dy in -16..=16 {for dx in -16..=16 {
            let(px,py)=(x.floor()+dx as f64+0.5,y.floor()+dy as f64+0.5);
            let distance=(px-x).hypot(py-y);
            if distance>range-1.0||self.cell(px,py)!=1||!self.pose(px,py,s.angle)
                ||self.mountains.0.first_blocked(px,py,x,y,false).is_some(){continue;}
            let cost=(s.x-px).hypot(s.y-py);
            if cost<score {score=cost;best=Some((px,py));}
        }}best
    }
    /// Command input: actor, ship, yard, x,y,population,yards-in-city,
    /// ready,near,treasury,tech,class,marine,weapon[4],leader-x/y,shore-x/y.
    fn command(&mut self,mode:u32,ships:&[Ship],offset:usize)->*const f64 {
        if mode == 14 && self.starting_water.as_ref().is_none_or(|(revision, _)| *revision != self.geometry_revision) {
            self.starting_water = Some((self.geometry_revision, self.starting_water_regions()));
        }
        let r=&self.input[offset..];let mut out=[0.0,f64::NAN,f64::NAN,0.0,0.0];
        let actor=r[0] as i32;let ship=ships.iter().find(|s|s.id==r[1] as i64&&s.faction==actor&&(s.hp>0.0||mode==9));
        let shore_points=if (3..=6).contains(&mode)&&r.len()>=27{Some(&r[27..27+r[26]as usize*2])}
            else if mode==11&&r.len()>=32{Some(&r[32..32+r[31]as usize*2])}else{None};
        match mode {
            0=>{
                if r[5]<CITY_POPULATION{out[0]=1.0;}else if r[6]>0.0{out[0]=2.0;}
                else if !(0..3).all(|dy|(0..3).all(|dx|self.cell(r[3]+dx as f64+0.5,r[4]+dy as f64+0.5)==2)){out[0]=3.0;}
                else if !(0..3).any(|i|[(r[3]+i as f64+0.5,r[4]-0.5),(r[3]+i as f64+0.5,r[4]+3.5),(r[3]-0.5,r[4]+i as f64+0.5),(r[3]+3.5,r[4]+i as f64+0.5)].iter().any(|p|self.coastal(p.0,p.1))){out[0]=35.0;}
            },
            1|2=>{
                let weapons=[r[13]as u32,r[14]as u32,r[15]as u32,r[16]as u32];
                let invalid_loadout=loadout_error(r[11]as u32,r[12]as i32 as u32,&weapons,r[10]as u32);
                if r[7]==0.0{out[0]=34.0;}
                else if r[8]==0.0{out[0]=4.0;}
                else if invalid_loadout!=0{out[0]=invalid_loadout as f64;}
                else if mode==1&&ships.iter().any(|s|s.hp>0.0&&s.yard==r[2]as i64){out[0]=6.0;}
                else if mode==1&&r[9]<BUILD {out[0]=7.0;}
                else if mode==2&&ship.is_none(){out[0]=23.0;}
                else if mode==2&&ship.is_some_and(|s|s.yard!=r[2]as i64||(s.x-r[3]-1.5).hypot(s.y-r[4]-1.5)>9.0){out[0]=8.0;}
                else if mode==2&&ship.is_some_and(|s|s.class!=r[11]as u32){out[0]=24.0;}
                else if mode==1 {if let Some((x,y,a))=self.launch(r[3],r[4],ships){out[1]=x;out[2]=y;out[3]=a;out[4]=BUILD;}else{out[0]=9.0;}}
            },
            3|4|5|6=>{
                if let Some(s)=ship {
                    if r[25]<=0.0 {out[0]=12.0;}
                    else if (mode==3||mode==4)&&r[24]!=r[22] {out[0]=13.0;}
                    else if mode==5&&r[23]==s.id as f64 {out[0]=36.0;}
                    else if mode==5&&r[23]>=0.0 {out[0]=14.0;}
                    else if mode==5&&r[24]>=0.0 {out[0]=15.0;}
                    else if mode==5&&r[21]<s.ready {out[0]=16.0;}
                    else if mode==3&&s.anchored {out[1]=0.0;out[3]=0.0;}
                    else if mode==6 {
                        if !s.anchored {out[0]=17.0;}
                        else if r[23]!=s.id as f64&&self.shore(s,None,shore_points).is_none_or(|p|(r[17]-p.0).hypot(r[18]-p.1)>3.0){out[0]=19.0;}
                        else{out[3]=MARINES;}
                    }
                    else {
                        let shore=self.shore(s,if r[19].is_finite()&&r[20].is_finite(){Some((r[19],r[20]))}else{None},shore_points);
                        if let Some((x,y))=shore {
                            if mode==4&&!s.anchored {out[0]=17.0;}
                            else if mode==5&&((r[17]-x).hypot(r[18]-y)>0.8||hull_distance(s,r[17],r[18])>2.0){out[0]=11.0;}
                            else {out[1]=x;out[2]=y;if mode==3{out[3]=1.0;}}
                        }else{out[0]=10.0;}
                    }
                }else{out[0]=22.0;}
            },
            7=>{if let Some(s)=ship {
                if s.anchored {out[0]=20.0;}else if self.cell(r[19],r[20])!=1 {out[0]=21.0;}
                else if let Some((x,y))=self.clear_destination(s,(r[19],r[20])){out[1]=x;out[2]=y;}
                else{out[0]=21.0;}
            }else{out[0]=22.0;}},
            12=>{if let Some(s)=ship {
                let range=(0..12).filter_map(|slot|gun_stats(s,slot).map(|v|v.0)).fold(0.0,f64::max);
                if r[26]==0.0{out[0]=38.0;}else if r[21]<s.ready{out[0]=16.0;}else if range==0.0{out[0]=37.0;}
                else if (s.x-r[19]).hypot(s.y-r[20])<=range-1.0&&self.mountains.0.first_blocked(s.x,s.y,r[19],r[20],false).is_none(){out[1]=s.x;out[2]=s.y;out[3]=r[27];}
                else if s.anchored{out[0]=20.0;}
                else if let Some((x,y))=self.attack_position(s,r[19],r[20],range){out[1]=x;out[2]=y;out[3]=r[27];}
                else{out[0]=39.0;}
            }else{out[0]=22.0;}},
            13=>{out[0]=if self.yard_coast(r[3],r[4]){0.0}else{35.0};},
            14=>{
                if let Some((x, y, angle, area)) = ship.and_then(|s| self.scenario_berth(r[3], r[4], s, ships)) {
                    out = [0.0,x,y,angle,area as f64];
                } else { out[0] = 9.0; }
            },
            8=>{
                out[0]=1.0;
                if r[5]>=CITY_POPULATION&&r[6]==0.0&&r[9]>=1500.0&&r[10]as u32&1!=0 {
                    let start=*self.plans.get(&(r[2]as i64)).unwrap_or(&0);
                    // Search the city's working coast in bounded slices. A
                    // natural founding site may be over nine tiles inland.
                    for i in start..start+128 {let k=i%2401;let(x,y)=(r[3]+(k%49)as f64-24.0,r[4]+(k/49)as f64-24.0);
                        if self.yard_pose(x,y)&&self.launch(x,y,ships).is_some(){out[0]=0.0;out[1]=x;out[2]=y;self.plans.insert(r[2]as i64,i+1);break;}
                    }
                    if out[0]!=0.0{self.plans.insert(r[2]as i64,start+128);}
                }
            },
            10=>{
                let tech=r[10]as u32;
                if r[9]<1000.0||r[7]==0.0||tech&1==0||tech&48==0||ships.iter().any(|s|s.hp>0.0&&s.yard==r[2]as i64){out[0]=1.0;}
                else{out[1]=if tech&6==6{2.0}else if tech&2!=0{1.0}else{0.0};out[2]=if tech&16!=0{MUSKETMAN}else{ARCHER}as f64;out[3]=if tech&24==24{CANNON as f64}else if tech&8!=0{BALLISTA as f64}else{0.0};}
            },
            11=>{
                if let Some(s)=ship {
                    if !s.anchored||r[26]==0.0||r[23]!=s.id as f64||r[29]<=0.0||r[30]!=s.faction as f64{out[0]=10.0;}
                    else if let Some(p)=self.shore(s,None,shore_points){out[1]=p.0;out[2]=p.1;out[3]=u8::from((r[27]-p.0).hypot(r[28]-p.1)<=0.8&&hull_distance(s,r[27],r[28])<=2.0)as f64;}
                    else{out[0]=10.0;}
                }else{out[0]=8.0;}
            },
            9=>{if let Some(s)=ship {out[3]=1.0;if s.hp<=0.0&&!s.rewarded&&r[8]!=0.0{out[4]=BOUNTY;}}},
            _=>out[0]=8.0,
        }
        self.output=out.to_vec();self.output.as_ptr()
    }
}
impl VesselGeometry for Warships {
    fn in_bounds(&self,x:f64,y:f64)->bool{x>=0.0&&y>=0.0&&x<self.width as f64&&y<self.height as f64}
    fn pose(&self,x:f64,y:f64,angle:f64)->bool{Warships::pose(self,x,y,angle)}
}
fn hull_point(s:&Ship,x:f64,y:f64)->(f64,f64) {
    let(c,a)=(s.angle.cos(),s.angle.sin());let f=((x-s.x)*c+(y-s.y)*a).clamp(-HULL_HALF_SPINE,HULL_HALF_SPINE);
    let(px,py)=(s.x+c*f,s.y+a*f);let d=(x-px).hypot(y-py);let k=if d>HULL_RADIUS{HULL_RADIUS/d}else{1.0};(px+(x-px)*k,py+(y-py)*k)
}
fn hull_distance(s:&Ship,x:f64,y:f64)->f64 {let(p,q)=hull_point(s,x,y);(x-p).hypot(y-q)}
/// Boarding and landing use the same capsule as navigation and naval commands.
pub fn landing(x:f64,y:f64,angle:f64,px:f64,py:f64)->bool {
    let forward=((px-x)*angle.cos()+(py-y)*angle.sin()).clamp(-HULL_HALF_SPINE,HULL_HALF_SPINE);
    (px-x-angle.cos()*forward).hypot(py-y-angle.sin()*forward)<=HULL_RADIUS+2.0
}
fn yard_distance(s:&Ship,x:f64,y:f64)->f64 {
    // Capsule/rectangle closest points occur at a spine endpoint or yard corner.
    let mut distance=f64::INFINITY;
    for forward in [-HULL_HALF_SPINE,0.0,HULL_HALF_SPINE] {
        let(px,py)=(s.x+s.angle.cos()*forward,s.y+s.angle.sin()*forward);
        distance=distance.min(((px-px.clamp(x,x+3.0)).hypot(py-py.clamp(y,y+3.0))-HULL_RADIUS).max(0.0));
    }
    for(px,py)in [(x,y),(x+3.0,y),(x,y+3.0),(x+3.0,y+3.0)] {distance=distance.min(hull_distance(s,px,py));}
    distance
}
fn separation(a:&Ship,x:f64,y:f64,angle:f64)->(f64,f64,f64){
    let mut distance=f64::INFINITY;let mut normal=(1.0,0.0);
    // Closest spines sampled at roughly 0.28 tiles, only for nearby hulls.
    let (c, s) = (a.angle.cos(), a.angle.sin());
    let (other_c, other_s) = (angle.cos(), angle.sin());
    for i in -5..=5{let t=i as f64*(HULL_HALF_SPINE/5.0);let(px,py)=(x+other_c*t,y+other_s*t);
        let f=((px-a.x)*c+(py-a.y)*s).clamp(-HULL_HALF_SPINE,HULL_HALF_SPINE);
        let(dx,dy)=(px-a.x-c*f,py-a.y-s*f);let d=dx.hypot(dy);
        if d<distance{distance=d;normal=if d>0.001{(dx/d,dy/d)}else{(-s,c)};}
    }(distance-2.0*HULL_RADIUS,normal.0,normal.1)
}
fn delta(a:f64,b:f64)->f64{(b-a).sin().atan2((b-a).cos())}
fn nearby(grid:&BTreeMap<(i32,i32),Vec<usize>>,s:&Ship,r:i32)->Vec<usize>{
    let(x,y)=((s.x/8.0).floor()as i32,(s.y/8.0).floor()as i32);let mut ids=Vec::new();
    for dy in -r..=r{for dx in -r..=r{if let Some(bucket)=grid.get(&(x+dx,y+dy)){ids.extend(bucket);}}}ids
}
pub fn command(world:&mut World,mode:u32)->*const f64{
    world.resource_scope(|world,mut net:Mut<Warships>|{let ships:Vec<Ship>=net.ships.values().filter_map(|e|world.get::<Ship>(*e).cloned()).collect();net.command(mode,&ships,0)})
}
pub fn preview(world: &mut World, mode: u32) -> *const f64 {
    let mut net = world.resource_mut::<Warships>();
    let ship = Ship::import(&net.input[..STRIDE], None);
    net.command(mode, &[ship], STRIDE)
}
pub fn output_length(world:&World)->usize{world.resource::<Warships>().output.len()}
/// On-demand diagnostics; no observations or serialization in the frame loop.
pub fn path_status(world:&mut World,id:i64)->*const f64 {
    world.resource_scope(|world,mut net:Mut<Warships>|{
        let mut row=[f64::NAN;16];row[0]=net.geometry_revision as f64;
        if let Some(ship)=net.ships.get(&id).and_then(|entity|world.get::<Ship>(*entity)) {
            row[1]=ship.route.len()as f64;row[2]=ship.next_plan;row[10]=ship.x;row[11]=ship.y;
            row[12]=ship.angle;row[13]=ship.speed;row[14]=u8::from(net.pose(ship.x,ship.y,ship.angle))as f64;
            row[15]=u8::from(ship.manual)as f64;
            if let Some(search)=net.searches.get(&id) {
                let(nodes,frontier)=search.progress();row[3]=nodes as f64;row[4]=frontier as f64;
                row[5]=search.origin.0;row[6]=search.origin.1;row[7]=search.angle;row[8]=search.goal.0;row[9]=search.goal.1;
            }
        }
        net.output.clear();net.output.extend_from_slice(&row);net.output.as_ptr()
    })
}
pub fn step(world:&mut World,count:usize,factions:usize,targets:usize,now:f64,dt:f64,
    diplomacy_published: bool, village_hostility: Option<&dyn Fn(i32, i32) -> bool>)->*const f64{
    world.resource_scope(|world,mut net:Mut<Warships>|{
        let mut ships=Vec::with_capacity(count);let mut live=BTreeSet::new();
        for i in 0..count {
            let r=&net.input[i*STRIDE..(i+1)*STRIDE];let id=r[0]as i64;
            let Some((entity,_))=world.resource::<EntityTables>().units.locate(id)else{continue;};
            let s=Ship::import(r,world.get::<Ship>(entity));ships.push(s);live.insert(id);net.ships.insert(id,entity);
        }
        net.ships.retain(|id,_|live.contains(id));
        net.searches.retain(|id,_|live.contains(id));
        if dt <= 0.0 {
            net.output.clear(); net.output.extend_from_slice(&[ships.len() as f64, factions as f64]);
            for s in ships { net.output.extend_from_slice(&s.row()); if let Some(e)=net.ships.get(&s.id){world.entity_mut(*e).insert(s);} }
            for i in 0..factions { let id=net.input[count*STRIDE+i*FACTION_STRIDE]; net.output.extend_from_slice(&[id,0.0,0.0]); }
            net.output.push(0.0);
            return net.output.as_ptr();
        }
        let mut purses=BTreeMap::new();let mut spent=BTreeMap::<i32,f64>::new();let mut rewards=BTreeMap::<i32,f64>::new();
        let mut faction_info = BTreeMap::new();
        let start=count*STRIDE+factions*FACTION_STRIDE;
        for r in net.input[count*STRIDE..start].chunks_exact(FACTION_STRIDE) {
            purses.insert(r[0] as i32, r[1]);
            faction_info.insert(r[0] as i32, (r[2] as u32, r[3]));
        }
        let shore:BTreeMap<(i64,i64),ShoreTarget>=net.input[start..start+targets*SHORE_STRIDE].chunks_exact(SHORE_STRIDE)
            .map(|r|((r[0]as i64,r[1]as i64),ShoreTarget{id:r[1]as i64,x:r[2],y:r[3],faction:r[4]as i32,hp:r[5],defense:r[6],sight:r[7] as u8})).collect();
        // Completed shipyard observations follow targets. Bucket their centers
        // so anchored hulls sample only their neighboring coast once a second.
        let yard_start=start+targets*SHORE_STRIDE;
        let yard_count=net.input[yard_start] as usize;
        let village_start=yard_start+1+yard_count*3;
        let mut yards=BTreeMap::<(i32,i32),Vec<(i32,f64,f64)>>::new();
        for row in net.input[yard_start+1..village_start].chunks_exact(3) {
            yards.entry((((row[1]+1.5)/8.0).floor()as i32,((row[2]+1.5)/8.0).floor()as i32))
                .or_default().push((row[0]as i32,row[1],row[2]));
        }
        let villages: BTreeSet<i32> = net.input[village_start..].iter().map(|&id| id as i32).collect();
        let flags = |id| faction_info.get(&id).map_or(0, |row| row.0);
        let hostile = |a: i32, b: i32| {
            if a == b { return false; }
            if flags(a) & 2 != 0 && flags(b) & 2 != 0 { return true; }
            if diplomacy_published {
                if let Some(war) = super::diplomacy::war_between(world, a, b) { return war; }
            }
            if villages.contains(&a) || villages.contains(&b) {
                return village_hostility.is_some_and(|lookup| lookup(a, b));
            }
            if a == -2 || b == -2 { return a >= 0 || b >= 0; }
            if a < 0 || b < 0 { return false; }
            (a == 0 && flags(b) & 1 != 0) || (b == 0 && flags(a) & 1 != 0)
        };
        let mut buckets=BTreeMap::<(i32,i32),Vec<usize>>::new();
        for(i,s)in ships.iter().enumerate().filter(|(_,s)|s.hp>0.0){buckets.entry(((s.x/8.0).floor()as i32,(s.y/8.0).floor()as i32)).or_default().push(i);}
        // At most four hulls expand 24 navigation nodes each, at 10 Hz. Work
        // resumes next observation instead of discarding a budget-limited A*.
        // Stable round-robin grants prevent a large fleet starving later IDs.
        let mut waiting:Vec<i64>=ships.iter().filter(|s|s.hp>0.0&&!s.manual&&!s.anchored&&s.goal.is_some()
            &&s.route.is_empty()&&s.speed.abs()<=0.05&&now>=s.ready&&now>=s.next_plan
            &&(net.searches.contains_key(&s.id)||net.searches.len()<MAX_ACTIVE_SEARCHES)).map(|s|s.id).collect();
        waiting.sort_unstable();
        let offset=waiting.partition_point(|id|*id<=net.plan_after);
        let planning:BTreeSet<i64>=waiting[offset..].iter().chain(waiting[..offset].iter()).take(PLAN_SHIPS).copied().collect();
        if let Some(id)=waiting[offset..].iter().chain(waiting[..offset].iter()).take(PLAN_SHIPS).last(){net.plan_after=*id;}
        let before=ships.clone();
        for(i,s)in ships.iter_mut().enumerate(){s.healed=false;s.lateral=false;if s.hp<=0.0 {continue;}
            // Preserve every elapsed service interval, including large simulation steps.
            if now>=s.upkeep {let periods=((now-s.upkeep)/30.0).floor()+1.0;let due=periods*UPKEEP;let purse=purses.entry(s.faction).or_default();let paid=due.min(*purse);*purse-=paid;*spent.entry(s.faction).or_default()+=paid;s.funded=paid+0.001>=due;s.upkeep+=periods*30.0;}
            if now<s.ready {s.speed=0.0;continue;}
            if !s.anchored {s.repairing=false;}
            else if now>=s.next_repair {
                s.next_repair=now+1.0;s.repairing=false;
                let (bx,by)=((s.x/8.0).floor()as i32,(s.y/8.0).floor()as i32);
                'coast:for dy in -1..=1 {for dx in -1..=1 {
                    for &(faction,x,y) in yards.get(&(bx+dx,by+dy)).into_iter().flatten() {
                        if faction==s.faction&&yard_distance(s,x,y)<=3.0 {s.repairing=true;break 'coast;}
                    }
                }}
            }
            let maximum=constant(8,s.class);
            if s.repairing&&s.hp<maximum {
                s.hp=(s.hp+REPAIR_PER_SECOND*dt).min(maximum);s.healed=true;
            }
            let neighbors=nearby(&buckets,s,2);
            let traffic=nearby(&buckets,s,1);
            if now>=s.next_target {s.next_target=now+1.0;s.target=neighbors.iter().copied().filter(|j|*j!=i&&before[*j].hp>0.0&&now>=before[*j].ready&&hostile(s.faction,before[*j].faction))
                .filter(|j|(s.x-before[*j].x).hypot(s.y-before[*j].y)<=18.0)
                .filter(|j|net.mountains.0.first_blocked(s.x,s.y,before[*j].x,before[*j].y,false).is_none())
                .min_by(|a,b|{let a=&before[*a];let b=&before[*b];(Some(a.id)!=s.ordered).cmp(&(Some(b.id)!=s.ordered))
                    .then((s.x-a.x).hypot(s.y-a.y).total_cmp(&(s.x-b.x).hypot(s.y-b.y))).then(a.id.cmp(&b.id))}).map(|j|before[j].id);
                // Each mount and surviving ranged marine acquires independently.
                // Spread equal-priority targets across the battery once per second.
                let mut assigned=BTreeMap::<i64,usize>::new();
                for slot in 0..12 {
                    let Some((range,_,_))=gun_stats(s,slot) else {s.guns[slot].target=None;continue;};
                    let (x,y)=gun_origin(s,slot);
                    let sea=neighbors.iter().copied().filter(|j|*j!=i&&before[*j].hp>0.0&&now>=before[*j].ready&&hostile(s.faction,before[*j].faction))
                        .map(|j|(before[j].id,before[j].x,before[j].y));
                    let land=shore.range((s.id,i64::MIN)..=(s.id,i64::MAX)).map(|(_,t)|t)
                        .filter(|t|t.hp>0.0&&t.in_sight(s,slot)&&hostile(s.faction,t.faction)).map(|t|(t.id,t.x,t.y));
                    let chosen=sea.chain(land).filter(|t|(x-t.1).hypot(y-t.2)<=range)
                        .filter(|t|net.mountains.0.first_blocked(x,y,t.1,t.2,false).is_none())
                        .min_by(|a,b|(Some(a.0)!=s.ordered).cmp(&(Some(b.0)!=s.ordered))
                            .then(assigned.get(&a.0).copied().unwrap_or(0).cmp(&assigned.get(&b.0).copied().unwrap_or(0)))
                            .then((x-a.1).hypot(y-a.2).total_cmp(&(x-b.1).hypot(y-b.2))).then(a.0.cmp(&b.0)));
                    s.guns[slot].target=chosen.map(|t|t.0);
                    if let Some(t)=chosen {*assigned.entry(t.0).or_default()+=1;}
                }
                if s.ai&&!s.anchored {
                    // Strategic selection happens once a second; movement keeps
                    // following this order without rescanning enemies each frame.
                    let enemy=s.target.and_then(|id|before.iter().find(|s|s.id==id)).or_else(||before.iter().filter(|b|b.hp>0.0&&hostile(s.faction,b.faction))
                        .min_by(|a,b|(s.x-a.x).hypot(s.y-a.y).total_cmp(&(s.x-b.x).hypot(s.y-b.y)).then(a.id.cmp(&b.id))));
                    if let Some(enemy)=enemy {
                        let range=if s.weapons.iter().any(|w|*w==BALLISTA||*w==CANNON){8.0}else{gun_stats(s,4).map_or(4.0,|(range,_,_)|range-1.5)};
                        let d=(s.x-enemy.x).hypot(s.y-enemy.y).max(0.01);
                        let requested=(enemy.x+(s.x-enemy.x)/d*range,enemy.y+(s.y-enemy.y)/d*range);
                        if let Some(goal)=net.clear_destination(s,requested) {
                            if d>range+0.5&&s.goal.is_none_or(|g|(g.0-goal.0).hypot(g.1-goal.1)>2.0){s.goal=Some(goal);s.route.clear();}
                        }
                    }
                }
            }
            if s.manual{s.goal=None;s.route.clear();}
            if s.goal.is_none(){net.searches.remove(&s.id);}
            if planning.contains(&s.id) && s.goal.is_some() && !s.manual && s.route.is_empty() {
                let goal=s.goal.unwrap();let existing=net.searches.remove(&s.id);
                let existing=existing.filter(|search|search.goal==goal&&search.geometry==net.geometry_revision
                    &&(search.origin.0-s.x).hypot(search.origin.1-s.y)<0.1&&delta(search.angle,s.angle).abs()<0.02);
                if existing.is_none() {
                    if let Some(route)=direct_route(&*net,(s.x,s.y),s.angle,goal){s.route=route;s.next_plan=now+2.0;}
                }
                if s.route.is_empty() && (s.x-goal.0).hypot(s.y-goal.1)>=0.05
                    &&(existing.is_some()||net.searches.len()<MAX_ACTIVE_SEARCHES) {
                    let mut search=existing.unwrap_or_else(||{
                        let mut search=Search::new((s.x,s.y),s.angle,goal,net.geometry_revision);
                        let constrained=!net.turn_clear(s.x,s.y,s.angle,s.angle+std::f64::consts::FRAC_PI_2)
                            ||!net.turn_clear(s.x,s.y,s.angle,s.angle-std::f64::consts::FRAC_PI_2);
                        if constrained{search=search.with_lateral_radius(3.0);}
                        let berth=!net.turn_clear(goal.0,goal.1,s.angle,s.angle+std::f64::consts::FRAC_PI_2)
                            ||!net.turn_clear(goal.0,goal.1,s.angle,s.angle-std::f64::consts::FRAC_PI_2);
                        if berth{search=search.with_lateral_goal_radius(3.0);}
                        search
                    });
                    match search.advance(&*net,PLAN_SLICE) {
                        Plan::Pending=>{s.next_plan=now+0.1;net.searches.insert(s.id,search);},
                        // Retain only a bounded completed-route prefix. A very
                        // long maze continues from that endpoint on the next plan.
                        Plan::Found(mut route)=>{route.truncate(MAX_ROUTE_WAYPOINTS);s.route=route;s.next_plan=now+2.0;},
                        Plan::Failed=>{s.next_plan=now+2.0;},
                    }
                }
            }
            let until=faction_info.get(&s.faction).map_or(0.0, |row| row.1);
            let top=super::fisheries::speed(until,now,constant(6,s.class))*if s.funded{1.0}else{0.4};
            if s.anchored { s.speed=0.0; continue; }
            let mut remaining=dt;
            while remaining>0.000001{let elapsed=remaining.min(0.05);remaining-=elapsed;
                let(mut forward,mut turn)=(s.forward,s.turn);
                let mut stopping=f64::INFINITY;
                let mut lateral=None;
                if !s.manual {forward=0.0;turn=0.0;
                    while s.route.front().is_some_and(|g|if g.drive==0.0{delta(s.angle,g.angle).abs()<0.02&&s.speed.abs()<0.05}
                        else{(g.x-s.x).hypot(g.y-s.y)<0.1&&s.speed.abs()<0.15}){s.route.pop_front();}
                    if let Some(g)=s.route.front() {
                        let distance=(g.x-s.x).hypot(g.y-s.y);
                        let desired=if g.drive==0.0||g.drive==2.0{g.angle}else{(g.y-s.y).atan2(g.x-s.x)+if g.drive<0.0{std::f64::consts::PI}else{0.0}};
                        let change=delta(s.angle,desired);
                        if g.drive!=0.0||s.speed.abs()<0.05{turn=(change/(TURN_RATE*elapsed)).clamp(-1.0,1.0);}
                        if g.drive==2.0 {
                            if change.abs()<0.02&&distance>0.000001{lateral=Some(((g.x-s.x)/distance,(g.y-s.y)/distance));s.lateral=true;}
                        }else if g.drive!=0.0&&change.abs()<0.25{forward=g.drive;}
                        stopping=(2.0*2.8*(distance-0.04).max(0.0)).sqrt();
                    }
                    if s.route.is_empty()&&s.goal.is_some_and(|g|(g.0-s.x).hypot(g.1-s.y)<0.15){s.goal=None;net.searches.remove(&s.id);}
                }
                let mut safe=1.0_f64;
                let gear = if forward == 0.0 { s.speed.signum() } else { forward.signum() };
                let direction = lateral.unwrap_or((s.angle.cos()*gear,s.angle.sin()*gear));
                let look = (s.speed.abs()*0.65).max(0.30);
                let (lookx,looky)=(s.x+direction.0*look,s.y+direction.1*look);
                for j in traffic.iter().copied(){if j==i||before[j].hp<=0.0{continue;}let other=&before[j];
                    if s.manual && forward>0.0 && hostile(s.faction,other.faction) {continue;}
                    let ahead = separation(other,lookx,looky,s.angle).0;
                    if ahead < 0.28 && ahead < separation(other,s.x,s.y,s.angle).0 - 1e-6 {
                        safe=0.0;
                        if !s.manual && s.goal.is_some(){turn=if s.id<other.id{-1.0}else{1.0};}
                    }
                }
                let angle=s.angle+turn*TURN_RATE*elapsed;
                if net.pose(s.x,s.y,angle){s.angle=angle;}
                let desired=if lateral.is_some(){top.min(2.0)*0.25*safe}else{forward*top*if forward<0.0{REVERSE_SPEED}else{1.0}*safe};
                let desired=desired.clamp(-stopping,stopping);
                let accel=if desired*s.speed<0.0||desired.abs()<s.speed.abs(){2.8}else{1.05};
                s.speed+=(desired-s.speed).clamp(-accel*elapsed,accel*elapsed);
                let direction=lateral.unwrap_or((s.angle.cos(),s.angle.sin()));
                let(x,y)=(s.x+direction.0*s.speed*elapsed,s.y+direction.1*s.speed*elapsed);
                let hull_clear=lateral.is_none()||traffic.iter().copied().all(|j|j==i||before[j].hp<=0.0||separation(&before[j],x,y,s.angle).0>=0.05);
                if hull_clear&&net.segment_clear((s.x,s.y),(x,y),s.angle){s.x=x;s.y=y;}else{s.speed=0.0;s.route.clear();}
            }
        }
        // Stable unordered pairs: each impact and each sink is credited once.
        for i in 0..ships.len(){if ships[i].hp<=0.0{continue;}for j in nearby(&buckets,&before[i],1){if j<=i||ships[j].hp<=0.0{continue;}
            let(gap,nx,ny)=separation(&ships[i],ships[j].x,ships[j].y,ships[j].angle);
            if gap<0.0 {
                // Already touching hulls can back away even if one shore pins
                // them together and the first move is only a fraction of a tile.
                if gap > separation(&before[i],before[j].x,before[j].y,before[j].angle).0 + 1e-6 { continue; }
                // Harbor side movement contributes no ramming velocity. An
                // incoming ordinary ram still uses the other hull's motion.
                let speed_i=if before[i].lateral||ships[i].lateral{0.0}else{before[i].speed};
                let speed_j=if before[j].lateral||ships[j].lateral{0.0}else{before[j].speed};
                let impact=((before[i].angle.cos()*speed_i-before[j].angle.cos()*speed_j)*nx+(before[i].angle.sin()*speed_i-before[j].angle.sin()*speed_j)*ny).max(0.0);
                if now>=ships[i].collision.max(ships[j].collision)&&impact>0.15{let damage=impact*impact*35.0;let mass_i=constant(8,ships[i].class)/900.0;let mass_j=constant(8,ships[j].class)/900.0;ships[i].hp-=damage*mass_j*impact_exposure(ships[i].angle,nx,ny);ships[j].hp-=damage*mass_i*impact_exposure(ships[j].angle,-nx,-ny);ships[i].collision=now+0.75;ships[j].collision=now+0.75;if hostile(ships[i].faction,ships[j].faction){ships[i].last_attacker=ships[j].faction;ships[j].last_attacker=ships[i].faction;ships[i].last_ship=ships[j].id;ships[j].last_ship=ships[i].id;}}
                ships[i].speed=0.0;ships[j].speed=0.0;
                let push=(-gap+0.02)*0.5;for(k,sign)in[(i,-1.0),(j,1.0)]{let(x,y)=(ships[k].x+nx*push*sign,ships[k].y+ny*push*sign);if !ships[k].anchored&&net.pose(x,y,ships[k].angle){ships[k].x=x;ships[k].y=y;}}
            }
        }}
        let snapshot=ships.clone();let mut shots=Vec::new();
        let by_id: BTreeMap<_,_> = snapshot.iter().enumerate().map(|(i,ship)|(ship.id,i)).collect();
        for i in 0..ships.len() {
            let a=&snapshot[i];
            if a.hp<=0.0||now<a.ready||!a.funded {continue;}
            let veterancy=1.0+0.1*(a.kills/2.0).floor().min(5.0);
            for slot in 0..12 {
                let Some((range,damage,reload))=gun_stats(a,slot) else {continue;};
                let Some(target)=a.guns[slot].target else{continue;};
                let sea=by_id.get(&target).copied().filter(|&j|snapshot[j].hp>0.0&&hostile(a.faction,snapshot[j].faction));
                let land=shore.get(&(a.id,target)).filter(|t|t.hp>0.0&&t.in_sight(a,slot)&&hostile(a.faction,t.faction));
                let(tx,ty)=if let Some(j)=sea{(snapshot[j].x,snapshot[j].y)}else if let Some(t)=land{(t.x,t.y)}else{continue;};
                let(x,y)=gun_origin(a,slot);ships[i].guns[slot].angle=(ty-y).atan2(tx-x);
                if now<ships[i].guns[slot].next||(x-tx).hypot(y-ty)>range||net.mountains.0.first_blocked(x,y,tx,ty,false).is_some() {continue;}
                ships[i].guns[slot].next=now+reload;ships[i].guns[slot].fired=now;
                if let Some(j)=sea{
                    let damage = damage * veterancy;
                    if slot >= 4 && ships[j].crew > 0.0 {
                        ships[j].crew = (ships[j].crew - damage).max(0.0);
                    } else {
                        let multiplier = if slot < 4 && a.weapons[slot] == CANNON {
                            crate::combat::CANNON_UNIT_DAMAGE_MULTIPLIER
                        } else { 1.0 };
                        ships[j].hp -= damage * multiplier;
                    }
                    ships[j].last_attacker=a.faction;ships[j].last_ship=a.id;
                }else if let Some(t)=land{
                    shots.extend([a.id as f64,t.id as f64,slot as f64,crate::combat::attack_damage(damage*veterancy,t.defense)]);
                }
            }
        }
        // Reward after all simultaneous damage. A ship cannot pay twice after load.
        for i in 0..ships.len(){if ships[i].hp<=0.0&&!ships[i].rewarded{ships[i].hp=0.0;ships[i].rewarded=true;
            net.record_sink(ships[i].id,ships[i].x,ships[i].y,ships[i].angle,ships[i].class,ships[i].faction,now);
            let attacker=ships[i].last_attacker;
            if attacker>=0&&hostile(attacker,ships[i].faction){*rewards.entry(attacker).or_default()+=BOUNTY;
                if let Some(&k)=by_id.get(&ships[i].last_ship).filter(|&&k|ships[k].faction==attacker){ships[k].kills+=1.0;}}
        }}
        net.output.clear();net.output.extend_from_slice(&[ships.len()as f64,factions as f64]);
        for s in ships {net.output.extend_from_slice(&s.row());if let Some(e)=net.ships.get(&s.id){world.entity_mut(*e).insert(s);}}
        for i in 0..factions{let id=net.input[count*STRIDE+i*FACTION_STRIDE]as i32;net.output.extend_from_slice(&[id as f64,*spent.get(&id).unwrap_or(&0.0),*rewards.get(&id).unwrap_or(&0.0)]);}
        net.output.push((shots.len()/4)as f64);net.output.extend(shots);
        net.output.as_ptr()
    })
}

#[cfg(test)]
mod navigation_tests {
    use super::*;
    fn water(width:i32,height:i32,open:impl Fn(i32,i32)->bool)->Warships {
        let mut net=Warships{width,height,..Default::default()};
        for y in 0..height{for x in 0..width{net.grid.push(u16::from(open(x,y)));}}
        net
    }
    fn verify(net:&Warships,start:(f64,f64),angle:f64,route:&VecDeque<Waypoint>){
        let(mut position,mut facing)=(start,angle);
        for point in route {
            assert!(net.turn_clear(position.0,position.1,facing,point.angle),"blocked rotation at {position:?}");
            assert!(net.segment_clear(position,(point.x,point.y),point.angle),"blocked translation to {point:?}");
            position=(point.x,point.y);facing=point.angle;
        }
    }
    #[test]
    fn integer_launch_row_keeps_its_clear_forward_exit(){
        let net=water(40,12,|_,y|(2..4).contains(&y));
        let route=direct_route(&net,(10.5,3.0),0.0,(18.5,3.0)).unwrap();
        assert_eq!(route.len(),1);assert_eq!(route[0].drive,1.0);assert_eq!(route[0].y,3.0);
        verify(&net,(10.5,3.0),0.0,&route);
        // Moving to the old cell-center row requires an impossible hull pose.
        assert!(!net.pose(11.5,3.5,0.0));
    }
    #[test]
    fn shallow_water_click_resolves_to_the_nearest_clear_hull_pose(){
        let net=water(40,12,|_,y|(2..4).contains(&y));
        let mut row=[0.0;STRIDE];row[0]=1.0;row[3]=10.5;row[4]=3.0;row[6]=900.0;row[67]=-1.0;
        let ship=Ship::import(&row,None);
        assert_eq!(net.cell(18.5,3.5),1);
        assert_eq!(net.clear_destination(&ship,(18.5,3.5)),Some((18.5,3.0)));
        assert!(net.clear_destination(&ship,(18.5,8.5)).is_none());
    }
    #[test]
    fn unrelated_dry_building_changes_preserve_the_pending_ship_search(){
        let mut net=water(40,12,|_,y|(2..4).contains(&y));
        net.searches.insert(1,Search::new((10.5,3.0),0.0,(18.5,3.0),0));
        net.input=vec![0.0,2.0];net.patch(1);
        assert_eq!(net.geometry_revision,0);assert_eq!(net.searches.len(),1);
        net.input=vec![(2*40+5)as f64,0.0];net.patch(1);
        assert_eq!(net.geometry_revision,1);assert!(net.searches.is_empty());
    }
    #[test]
    fn a_narrow_berth_reverses_into_room_before_turning(){
        let net=water(30,14,|x,y|(3..26).contains(&x)&&(2..4).contains(&y)
            ||(3..11).contains(&x)&&(1..12).contains(&y));
        let start=(20.5,3.0);let goal=(6.0,8.0);
        assert!(net.pose(start.0,start.1,0.0));
        assert!(!net.turn_clear(start.0,start.1,0.0,std::f64::consts::FRAC_PI_2));
        let mut search=Search::new(start,0.0,goal,0);let mut result=None;let mut deferred=false;
        for _ in 0..MAX_SEARCH_NODES_FOR_TEST {
            match search.advance(&net,1){Plan::Pending=>deferred=true,Plan::Found(route)=>{result=Some(route);break;},Plan::Failed=>break,}
        }
        let route=result.expect("the hull can back out into the connected turning basin");
        assert!(deferred);assert!(route.iter().any(|point|point.drive<0.0));
        assert_eq!((route.back().unwrap().x,route.back().unwrap().y),goal);
        verify(&net,start,0.0,&route);
    }
    const MAX_SEARCH_NODES_FOR_TEST:usize=16_384;
    #[test]
    fn clear_end_orientations_do_not_allow_clipping_a_turn(){
        let net=water(30,10,|_,y|(2..4).contains(&y));
        assert!(net.pose(12.5,3.0,0.0));assert!(net.pose(12.5,3.0,std::f64::consts::PI));
        assert!(!net.turn_clear(12.5,3.0,0.0,std::f64::consts::PI));
        let route=direct_route(&net,(12.5,3.0),0.0,(7.5,3.0)).unwrap();
        assert_eq!(route[0].drive,-1.0);verify(&net,(12.5,3.0),0.0,&route);
    }
    #[test]
    fn bounded_harbor_side_movement_leaves_a_fitted_pocket_without_clipping(){
        let net=water(30,12,|x,y|(1..4).contains(&y)||(8..13).contains(&x)&&y==4);
        let start=(10.5,4.0);let goal=(4.5,3.0);
        assert!(net.pose(start.0,start.1,0.0));
        assert!(!net.segment_clear(start,(11.0,4.0),0.0));
        assert!(!net.segment_clear(start,(10.0,4.0),0.0));
        assert!(!net.turn_clear(start.0,start.1,0.0,std::f64::consts::FRAC_PI_4));
        let mut ordinary=Search::new(start,0.0,goal,0);
        assert!(matches!(ordinary.advance(&net,24),Plan::Failed));
        let mut search=Search::new(start,0.0,goal,0).with_lateral_radius(3.0);let mut result=None;
        for _ in 0..1024 {match search.advance(&net,24){
            Plan::Pending=>{},Plan::Found(route)=>{result=Some(route);break;},Plan::Failed=>break,
        }}
        let route=result.expect("crew can move the hull sideways into its connected sailing lane");
        assert!(route.iter().any(|point|point.drive==2.0));
        assert!(route.iter().filter(|point|point.drive==2.0).all(|point|(point.x-start.0).hypot(point.y-start.1)<=3.000001));
        verify(&net,start,0.0,&route);
    }
    #[test]
    fn final_berthing_aligns_an_off_lattice_water_goal_only_near_its_shore(){
        let net=water(40,12,|_,y|(0..4).contains(&y));
        let start=(6.5,2.0);let goal=(24.5,2.9);
        assert!(net.pose(goal.0,goal.1,0.0));
        let mut search=Search::new(start,0.0,goal,0).with_lateral_goal_radius(3.0);let mut result=None;
        for _ in 0..1024 {match search.advance(&net,24){
            Plan::Pending=>{},Plan::Found(route)=>{result=Some(route);break;},Plan::Failed=>break,
        }}
        let route=result.expect("the last side alignment reaches the exact clear water point");
        assert_eq!((route.back().unwrap().x,route.back().unwrap().y),goal);
        assert!(route.iter().any(|point|point.drive==2.0));
        assert!(route.iter().filter(|point|point.drive==2.0).all(|point|(point.x-goal.0).hypot(point.y-goal.1)<=3.000001));
        verify(&net,start,0.0,&route);
    }
    #[test]
    fn a_clear_water_destination_does_not_allow_crossing_a_land_barrier(){
        let net=water(35,20,|x,_|!(14..16).contains(&x));
        assert!(net.pose(10.0,10.0,0.0));assert!(net.pose(21.0,10.0,0.0));
        assert!(direct_route(&net,(10.0,10.0),0.0,(21.0,10.0)).is_none());
    }
    #[test]
    fn warship_boarding_uses_the_whole_hull_at_the_island_shore(){
        assert!(landing(36.5,3.0,0.0,34.5,5.5));
        assert!(!super::super::galleys::landing(36.5,3.0,0.0,34.5,5.5));
        assert!(!landing(36.5,3.0,0.0,34.5,7.5));
    }
}
