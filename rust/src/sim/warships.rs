//! Warships live in the game's Bevy World. The host transports terrain,
//! commands and serializable mirrors; navigation, costs and combat run here.
use bevy_ecs::prelude::*;
use std::collections::{BTreeMap, BTreeSet, BinaryHeap};
use std::cmp::Ordering;
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
// Weapon IDs match NAVAL_WEAPONS in the host bridge; 0 is an empty mount.
const BALLISTA: u32 = 1;
const CANNON: u32 = 2;
const MARINE_SHOT: u32 = 3;
const SHORE_STRIDE: usize = 8;
#[derive(Clone, Copy)]
struct ShoreTarget { id:i64, faction:i32, x:f64, y:f64, hp:f64, defense:f64, eligible:bool }
pub fn fleet_upkeep(count:usize)->f64 {count as f64 * UPKEEP}
pub fn constant(index: u32, class: u32) -> f64 {
    match index { 0 => BUILD, 1 => UPKEEP, 2 => BOUNTY, 3 => CITY_POPULATION, 4 => 90.0, 5 => 30.0,
        6 => GALLEY_SPEED * 1.15_f64.powi(class.min(2) as i32), 7 => (class.min(2) + 2) as f64,
        8 => [900.0, 1100.0, 1400.0][class.min(2) as usize], 9 => MARINES, _ => f64::NAN }
}
// Tech mask: sailing, lateen sails, naval engineering, siege engines,
// gunpowder, archery, military tactics.
fn loadout_error(class: u32, marine: u32, weapons: &[u32; 4], tech: u32) -> u32 {
    if class > 2 || marine > 3 { return 32; }
    if tech & 1 == 0 { return 25; }
    if class > 0 && tech & 2 == 0 { return 26; }
    if class > 1 && tech & 4 == 0 { return 27; }
    if marine == 1 && tech & 64 == 0 { return 31; }
    if marine == 2 && tech & 32 == 0 { return 30; }
    if marine == 3 && tech & 16 == 0 { return 29; }
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
    match s.marine { 2 => Some((6.0,3.0,1.8)), 3 => Some((7.0,5.0,2.5)), _ => None }
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
    target: Option<i64>, boarding: Option<i64>, next_plan: f64, next_target: f64,
    cooldown: [f64; 5], guns: [Gunner;12], collision: f64, last_attacker: i32, last_ship: i64, rewarded: bool,
    route: Vec<(f64,f64)>, fired: u32, ai: bool, ordered:Option<i64>,
    next_repair: f64, repairing: bool, healed: bool,
}
impl Ship {
    fn import(r: &[f64], old: Option<&Self>) -> Self {
        let mut s = old.cloned().unwrap_or(Self { id:r[0] as i64,class:0,faction:0,x:0.0,y:0.0,angle:0.0,hp:0.0,speed:0.0,kills:0.0,marine:0,crew:MARINES,anchored:false,ready:0.0,upkeep:0.0,funded:true,weapons:[0;4],yard:0,goal:None,forward:0.0,turn:0.0,manual:false,target:None,boarding:None,next_plan:0.0,next_target:0.0,cooldown:[0.0;5],guns:[Gunner::default();12],collision:0.0,last_attacker:-1,last_ship:-1,rewarded:false,route:Vec::new(),fired:0,ai:false,ordered:None,next_repair:0.0,repairing:false,healed:false });
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
        r[19]=self.yard as f64;r[20]=self.goal.map_or(f64::NAN,|g|g.0);r[21]=self.goal.map_or(f64::NAN,|g|g.1);r[25]=self.last_attacker as f64;r[26]=self.rewarded as u8 as f64;r[27]=self.boarding.map_or(-1.0,|id|id as f64);r[28]=self.fired as f64;r[29]=self.target.map_or(-1.0,|id|id as f64);r[30]=self.last_ship as f64;
        for i in 0..12 {let at=31+i*3;r[at]=self.guns[i].target.map_or(-1.0,|id|id as f64);r[at+1]=self.guns[i].angle;r[at+2]=self.guns[i].fired;}
        // Steering fields are input-only; output slot 22 publishes repair activity.
        r[22]=self.healed as u8 as f64;r[67]=self.ordered.map_or(-1.0,|id|id as f64);
        r
    }
}
#[derive(Resource, Default)]
pub struct Warships { input:Vec<f64>, output:Vec<f64>, width:i32,height:i32,grid:Vec<u8>, ships:BTreeMap<i64,Entity>, plans:BTreeMap<i64,usize>, mountains: MountainTerrain, sinks:BTreeMap<i64,[f64;7]>, sink_revision:u64, effects:Vec<f64>, effects_revision:u64 }
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
    pub fn geometry(&mut self,w:i32,h:i32){self.width=w;self.height=h;self.grid=self.input.iter().take((w*h) as usize).map(|v|*v as u8).collect();}
    pub fn patch(&mut self,count:usize){for r in self.input[..count*2].chunks_exact(2){if let Some(cell)=self.grid.get_mut(r[0]as usize){*cell=r[1]as u8;}}}
    fn cell_data(&self,x:f64,y:f64)->u8 {let (x,y)=(x.floor() as i32,y.floor() as i32);if x<0||y<0||x>=self.width||y>=self.height{0}else{self.grid.get((y*self.width+x)as usize).copied().unwrap_or(0)}}
    fn cell(&self,x:f64,y:f64)->u8 { self.cell_data(x,y) & 3 }
    fn level(&self,x:f64,y:f64)->u8 { (self.cell_data(x,y) >> 2)&31 }
    fn coastal(&self,x:f64,y:f64)->bool {self.cell(x,y)==1&&self.cell_data(x,y)&128!=0}
    fn pose(&self,x:f64,y:f64,a:f64)->bool {
        let(c,s)=(a.cos(),a.sin());
        // Sub-cell sampling of the actual 2x5 capsule; no expensive world search.
        for f in -5..=5 {for side in -2..=2 {let forward=f as f64*0.49;let sideways=side as f64*0.49;
            if forward.abs()>1.5 && (forward.abs()-1.5).powi(2)+sideways*sideways>0.99 {continue;}
            if self.cell(x+c*forward-s*sideways,y+s*forward+c*sideways)!=1 || self.level(x+c*forward-s*sideways,y+s*forward+c*sideways)!=self.level(x,y){return false;}
        }}true
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
    fn command(&mut self,mode:u32,ships:&[Ship])->*const f64 {
        let r=&self.input;let mut out=[0.0,f64::NAN,f64::NAN,0.0,0.0];
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
                let invalid_loadout=loadout_error(r[11]as u32,r[12]as u32,&weapons,r[10]as u32);
                if r[7]==0.0{out[0]=34.0;}
                else if r[8]==0.0{out[0]=4.0;}
                else if invalid_loadout!=0{out[0]=invalid_loadout as f64;}
                else if mode==1&&ships.iter().any(|s|s.hp>0.0&&s.yard==r[2]as i64){out[0]=6.0;}
                else if mode==1&&r[9]<BUILD {out[0]=7.0;}
                else if mode==2&&ship.is_none(){out[0]=23.0;}
                else if mode==2&&ship.is_some_and(|s|s.yard!=r[2]as i64||(s.x-r[3]-1.5).hypot(s.y-r[4]-1.5)>9.0){out[0]=8.0;}
                else if mode==2&&ship.is_some_and(|s|s.class!=r[11]as u32){out[0]=24.0;}
                else if mode==2&&ship.is_some_and(|s|s.boarding.is_some()){out[0]=18.0;}
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
                        else if s.boarding.is_some() {out[0]=18.0;}
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
            7=>{if let Some(s)=ship { if s.anchored {out[0]=20.0;}else if self.cell(r[19],r[20])!=1 {out[0]=21.0;}else{out[1]=r[19];out[2]=r[20];} }else{out[0]=22.0;}},
            12=>{if let Some(s)=ship {
                let range=(0..12).filter_map(|slot|gun_stats(s,slot).map(|v|v.0)).fold(0.0,f64::max);
                if r[26]==0.0{out[0]=38.0;}else if r[21]<s.ready{out[0]=16.0;}else if range==0.0{out[0]=37.0;}
                else if (s.x-r[19]).hypot(s.y-r[20])<=range-1.0&&self.mountains.0.first_blocked(s.x,s.y,r[19],r[20],false).is_none(){out[1]=s.x;out[2]=s.y;out[3]=r[27];}
                else if s.anchored{out[0]=20.0;}
                else if let Some((x,y))=self.attack_position(s,r[19],r[20],range){out[1]=x;out[2]=y;out[3]=r[27];}
                else{out[0]=39.0;}
            }else{out[0]=22.0;}},
            13=>{out[0]=if self.yard_coast(r[3],r[4]){0.0}else{35.0};},
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
                if r[9]<1000.0||r[7]==0.0||ships.iter().any(|s|s.hp>0.0&&s.yard==r[2]as i64){out[0]=1.0;}
                else{out[1]=if tech&6==6{2.0}else if tech&2!=0{1.0}else{0.0};out[2]=if tech&64!=0{1.0}else{0.0};out[3]=if tech&24==24{CANNON as f64}else if tech&8!=0{BALLISTA as f64}else{0.0};}
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
fn hull_point(s:&Ship,x:f64,y:f64)->(f64,f64) {
    let(c,a)=(s.angle.cos(),s.angle.sin());let f=((x-s.x)*c+(y-s.y)*a).clamp(-1.5,1.5);
    let(px,py)=(s.x+c*f,s.y+a*f);let d=(x-px).hypot(y-py);let k=if d>1.0{1.0/d}else{1.0};(px+(x-px)*k,py+(y-py)*k)
}
fn hull_distance(s:&Ship,x:f64,y:f64)->f64 {let(p,q)=hull_point(s,x,y);(x-p).hypot(y-q)}
fn yard_distance(s:&Ship,x:f64,y:f64)->f64 {
    // Capsule/rectangle closest points occur at a spine endpoint or yard corner.
    let mut distance=f64::INFINITY;
    for forward in [-1.5,0.0,1.5] {
        let(px,py)=(s.x+s.angle.cos()*forward,s.y+s.angle.sin()*forward);
        distance=distance.min(((px-px.clamp(x,x+3.0)).hypot(py-py.clamp(y,y+3.0))-1.0).max(0.0));
    }
    for(px,py)in [(x,y),(x+3.0,y),(x,y+3.0),(x+3.0,y+3.0)] {distance=distance.min(hull_distance(s,px,py));}
    distance
}
fn separation(a:&Ship,x:f64,y:f64,angle:f64)->(f64,f64,f64){
    let mut distance=f64::INFINITY;let mut normal=(1.0,0.0);
    // Closest spines sampled at 0.3 tiles. Narrow phase only for nearby hulls.
    for i in -5..=5{let t=i as f64*0.3;let(px,py)=(x+angle.cos()*t,y+angle.sin()*t);
        let f=((px-a.x)*a.angle.cos()+(py-a.y)*a.angle.sin()).clamp(-1.5,1.5);
        let(dx,dy)=(px-a.x-a.angle.cos()*f,py-a.y-a.angle.sin()*f);let d=dx.hypot(dy);
        if d<distance{distance=d;normal=if d>0.001{(dx/d,dy/d)}else{(-a.angle.sin(),a.angle.cos())};}
    }(distance-2.0,normal.0,normal.1)
}
#[derive(Clone,Copy)]
struct Node {cell:i32,cost:f64,score:f64}
impl PartialEq for Node{fn eq(&self,o:&Self)->bool{self.cell==o.cell&&self.score==o.score}}
impl Eq for Node{}
impl Ord for Node{fn cmp(&self,o:&Self)->Ordering{o.score.total_cmp(&self.score).then(o.cell.cmp(&self.cell))}}
impl PartialOrd for Node{fn partial_cmp(&self,o:&Self)->Option<Ordering>{Some(self.cmp(o))}}
fn path(net:&Warships,s:&Ship,goal:(f64,f64),budget:&mut usize)->Vec<(f64,f64)>{
    let w=net.width;let start=s.y.floor()as i32*w+s.x.floor()as i32;let end=goal.1.floor()as i32*w+goal.0.floor()as i32;
    let mut queue=BinaryHeap::new();let mut costs=BTreeMap::new();let mut prev=BTreeMap::new();
    queue.push(Node{cell:start,cost:0.0,score:0.0});costs.insert(start,0.0);
    while let Some(n)=queue.pop(){if *budget==0{break;}*budget-=1;
        if n.cost>*costs.get(&n.cell).unwrap_or(&f64::INFINITY){continue;}
        let(x,y)=((n.cell%w)as f64+0.5,(n.cell/w)as f64+0.5);
        if n.cell==end {let mut route=vec![goal];let mut cell=n.cell;while cell!=start{route.push(((cell%w)as f64+0.5,(cell/w)as f64+0.5));cell=prev[&cell];}route.reverse();return route;}
        for(dy,dx)in[(-1,0),(0,1),(1,0),(0,-1),(-1,1),(1,1),(1,-1),(-1,-1)]{
            let(px,py)=(x+dx as f64,y+dy as f64);let a=(dy as f64).atan2(dx as f64);
            if !net.pose(px,py,a)||dx!=0&&dy!=0&&(!net.pose(x,py,a)||!net.pose(px,y,a)){continue;}
            let cell=(py.floor()as i32)*w+px.floor()as i32;let cost=n.cost+(dx as f64).hypot(dy as f64);
            if cost>=*costs.get(&cell).unwrap_or(&f64::INFINITY){continue;}
            costs.insert(cell,cost);prev.insert(cell,n.cell);queue.push(Node{cell,cost,score:cost+(goal.0-px).hypot(goal.1-py)*1.05});
        }
    }Vec::new()
}
fn delta(a:f64,b:f64)->f64{(b-a).sin().atan2((b-a).cos())}
fn nearby(grid:&BTreeMap<(i32,i32),Vec<usize>>,s:&Ship,r:i32)->Vec<usize>{
    let(x,y)=((s.x/8.0).floor()as i32,(s.y/8.0).floor()as i32);let mut ids=Vec::new();
    for dy in -r..=r{for dx in -r..=r{if let Some(bucket)=grid.get(&(x+dx,y+dy)){ids.extend(bucket);}}}ids
}
pub fn command(world:&mut World,mode:u32)->*const f64{
    world.resource_scope(|world,mut net:Mut<Warships>|{let ships:Vec<Ship>=net.ships.values().filter_map(|e|world.get::<Ship>(*e).cloned()).collect();net.command(mode,&ships)})
}
pub fn output_length(world:&World)->usize{world.resource::<Warships>().output.len()}
pub fn step(world:&mut World,count:usize,factions:usize,relations:usize,targets:usize,now:f64,dt:f64)->*const f64{
    world.resource_scope(|world,mut net:Mut<Warships>|{
        let mut ships=Vec::with_capacity(count);let mut live=BTreeSet::new();
        for i in 0..count {
            let r=&net.input[i*STRIDE..(i+1)*STRIDE];let id=r[0]as i64;
            let Some((entity,_))=world.resource::<EntityTables>().units.locate(id)else{continue;};
            let s=Ship::import(r,world.get::<Ship>(entity));ships.push(s);live.insert(id);net.ships.insert(id,entity);
        }
        net.ships.retain(|id,_|live.contains(id));
        if dt <= 0.0 {
            net.output.clear(); net.output.extend_from_slice(&[ships.len() as f64, factions as f64]);
            for s in ships { net.output.extend_from_slice(&s.row()); if let Some(e)=net.ships.get(&s.id){world.entity_mut(*e).insert(s);} }
            for i in 0..factions { let id=net.input[count*STRIDE+i*FACTION_STRIDE]; net.output.extend_from_slice(&[id,0.0,0.0]); }
            net.output.push(0.0);
            return net.output.as_ptr();
        }
        let mut purses=BTreeMap::new();let mut spent=BTreeMap::<i32,f64>::new();let mut rewards=BTreeMap::<i32,f64>::new();
        for i in 0..factions{let r=&net.input[count*STRIDE+i*FACTION_STRIDE..];purses.insert(r[0]as i32,r[1]);}
        let mut wars=BTreeSet::new();let start=count*STRIDE+factions*FACTION_STRIDE;
        for i in 0..relations {wars.insert((net.input[start+i*2]as i32,net.input[start+i*2+1]as i32));}
        let shore:BTreeMap<(i64,i64),ShoreTarget>=net.input[start+relations*2..start+relations*2+targets*SHORE_STRIDE].chunks_exact(SHORE_STRIDE)
            .map(|r|((r[0]as i64,r[1]as i64),ShoreTarget{id:r[1]as i64,x:r[2],y:r[3],faction:r[4]as i32,hp:r[5],defense:r[6],eligible:r[7]!=0.0})).collect();
        // Completed shipyard observations follow targets. Bucket their centers
        // so anchored hulls sample only their neighboring coast once a second.
        let yard_start=start+relations*2+targets*SHORE_STRIDE;
        let mut yards=BTreeMap::<(i32,i32),Vec<(i32,f64,f64)>>::new();
        for row in net.input.get(yard_start+1..).unwrap_or(&[]).chunks_exact(3)
            .take(net.input.get(yard_start).copied().unwrap_or(0.0)as usize) {
            yards.entry((((row[1]+1.5)/8.0).floor()as i32,((row[2]+1.5)/8.0).floor()as i32))
                .or_default().push((row[0]as i32,row[1],row[2]));
        }
        let hostile=|a:i32,b:i32|wars.contains(&(a,b));
        let mut buckets=BTreeMap::<(i32,i32),Vec<usize>>::new();
        for(i,s)in ships.iter().enumerate().filter(|(_,s)|s.hp>0.0){buckets.entry(((s.x/8.0).floor()as i32,(s.y/8.0).floor()as i32)).or_default().push(i);}
        let before=ships.clone();let mut budget=2400;
        for(i,s)in ships.iter_mut().enumerate(){s.fired=0;s.boarding=None;s.healed=false;if s.hp<=0.0 {continue;}
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
                        .filter(|t|t.hp>0.0&&t.eligible&&hostile(s.faction,t.faction)).map(|t|(t.id,t.x,t.y));
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
                        let range=if s.weapons.iter().any(|w|*w==BALLISTA||*w==CANNON){8.0}else{2.4};
                        let d=(s.x-enemy.x).hypot(s.y-enemy.y).max(0.01);
                        let goal=(enemy.x+(s.x-enemy.x)/d*range,enemy.y+(s.y-enemy.y)/d*range);
                        if d>range+0.5&&s.goal.is_none_or(|g|(g.0-goal.0).hypot(g.1-goal.1)>2.0){s.goal=Some(goal);s.route.clear();}
                    }
                }
            }
            if s.manual{s.goal=None;s.route.clear();}
            if s.goal.is_some() && !s.manual && now>=s.next_plan && s.route.is_empty(){s.next_plan=now+2.0;let g=s.goal.unwrap();s.route=path(&net,s,g,&mut budget);}
            let until=net.input[count*STRIDE..count*STRIDE+factions*FACTION_STRIDE].chunks_exact(FACTION_STRIDE).find(|r|r[0]as i32==s.faction).map_or(0.0,|r|r[3]);
            let top=super::fisheries::speed(until,now,constant(6,s.class))*if s.funded{1.0}else{0.4};
            let mut remaining=dt;
            while remaining>0.000001{let elapsed=remaining.min(0.05);remaining-=elapsed;
                let(mut forward,mut turn)=(s.forward,s.turn);
                if !s.manual {forward=0.0;turn=0.0;
                    while s.route.first().is_some_and(|g|(g.0-s.x).hypot(g.1-s.y)<0.25){s.route.remove(0);}
                    if let Some(g)=s.route.first(){let desired=(g.1-s.y).atan2(g.0-s.x);let change=delta(s.angle,desired);turn=(change/(0.32*elapsed)).clamp(-1.0,1.0);if change.abs()<0.45{forward=1.0;}}
                    if s.goal.is_some_and(|g|(g.0-s.x).hypot(g.1-s.y)<0.3){s.goal=None;s.route.clear();}
                }
                let mut safe=1.0_f64;
                for j in nearby(&buckets,&before[i],1){if j==i||before[j].hp<=0.0{continue;}let other=&before[j];
                    if s.manual && forward>0.0 && hostile(s.faction,other.faction) {continue;}
                    let lookx=s.x+s.angle.cos()*s.speed*0.8;let looky=s.y+s.angle.sin()*s.speed*0.8;
                    if separation(other,lookx,looky,s.angle).0<0.45 {safe=safe.min(0.0);if !s.manual && s.goal.is_some(){turn=if s.id<other.id{-1.0}else{1.0};}}
                }
                if s.anchored{forward=0.0;turn=0.0;s.speed=0.0;}
                let angle=s.angle+turn*0.32*elapsed;
                if net.pose(s.x,s.y,angle){s.angle=angle;}
                let desired=forward*top*if forward<0.0{0.45}else{1.0}*safe;
                let accel=if desired*s.speed<0.0||desired.abs()<s.speed.abs(){2.8}else{0.8};
                s.speed+=(desired-s.speed).clamp(-accel*elapsed,accel*elapsed);
                let(x,y)=(s.x+s.angle.cos()*s.speed*elapsed,s.y+s.angle.sin()*s.speed*elapsed);
                if net.pose(x,y,s.angle){s.x=x;s.y=y;}else{s.speed=0.0;s.route.clear();}
            }
        }
        // Stable unordered pairs: each impact and each sink is credited once.
        for i in 0..ships.len(){if ships[i].hp<=0.0{continue;}for j in nearby(&buckets,&before[i],1){if j<=i||ships[j].hp<=0.0{continue;}
            let(gap,nx,ny)=separation(&ships[i],ships[j].x,ships[j].y,ships[j].angle);
            if gap<0.0 {let impact=((before[i].angle.cos()*before[i].speed-before[j].angle.cos()*before[j].speed)*nx+(before[i].angle.sin()*before[i].speed-before[j].angle.sin()*before[j].speed)*ny).max(0.0);
                if now>=ships[i].collision.max(ships[j].collision)&&impact>0.15{let damage=impact*impact*35.0;let mass_i=constant(8,ships[i].class)/900.0;let mass_j=constant(8,ships[j].class)/900.0;ships[i].hp-=damage*mass_j*impact_exposure(ships[i].angle,nx,ny);ships[j].hp-=damage*mass_i*impact_exposure(ships[j].angle,-nx,-ny);ships[i].collision=now+0.75;ships[j].collision=now+0.75;if hostile(ships[i].faction,ships[j].faction){ships[i].last_attacker=ships[j].faction;ships[j].last_attacker=ships[i].faction;ships[i].last_ship=ships[j].id;ships[j].last_ship=ships[i].id;}}
                ships[i].speed=0.0;ships[j].speed=0.0;
                let push=(-gap+0.02)*0.5;for(k,sign)in[(i,-1.0),(j,1.0)]{let(x,y)=(ships[k].x+nx*push*sign,ships[k].y+ny*push*sign);if !ships[k].anchored&&net.pose(x,y,ships[k].angle){ships[k].x=x;ships[k].y=y;}}
            }
        }}
        let snapshot=ships.clone();let mut shots=Vec::new();
        for i in 0..ships.len() {
            let a=&snapshot[i];
            if a.hp<=0.0||now<a.ready||!a.funded {continue;}
            let veterancy=1.0+0.1*(a.kills/2.0).floor().min(5.0);
            if let Some(j)=a.target.and_then(|id|snapshot.iter().position(|s|s.id==id&&s.hp>0.0&&hostile(a.faction,s.faction))) {
                let b=&snapshot[j];let gap=separation(a,b.x,b.y,b.angle).0;
                if net.mountains.0.first_blocked(a.x,a.y,b.x,b.y,false).is_none() {
                    if gap<=0.7&&a.crew>0.0&&b.crew>0.0&&(a.marine<2||b.marine<2) {
                        ships[i].boarding=Some(b.id);ships[i].speed=0.0;
                        if now>=ships[i].cooldown[4] {ships[i].cooldown[4]=now+1.0;
                            let strength=match a.marine {1=>18.0,2|3=>3.0,_=>14.0}*(a.crew/100.0).ceil()*veterancy;
                            ships[j].crew=(ships[j].crew-strength).max(0.0);ships[j].last_attacker=a.faction;ships[j].last_ship=a.id;
                        }
                    } else if gap<=0.7&&a.crew>0.0&&b.crew<=0.0&&now>=ships[i].cooldown[4] {
                        ships[i].boarding=Some(b.id);ships[i].cooldown[4]=now+1.0;ships[j].hp-=30.0*veterancy;ships[j].last_attacker=a.faction;ships[j].last_ship=a.id;
                    }
                }
            }
            for slot in 0..12 {
                let Some((range,damage,reload))=gun_stats(a,slot) else {continue;};
                let Some(target)=a.guns[slot].target else{continue;};
                let sea=snapshot.iter().position(|s|s.id==target&&s.hp>0.0&&hostile(a.faction,s.faction));
                let land=shore.get(&(a.id,target)).filter(|t|t.hp>0.0&&t.eligible&&hostile(a.faction,t.faction));
                let(tx,ty)=if let Some(j)=sea{(snapshot[j].x,snapshot[j].y)}else if let Some(t)=land{(t.x,t.y)}else{continue;};
                let(x,y)=gun_origin(a,slot);ships[i].guns[slot].angle=(ty-y).atan2(tx-x);
                if now<ships[i].guns[slot].next||(x-tx).hypot(y-ty)>range||net.mountains.0.first_blocked(x,y,tx,ty,false).is_some() {continue;}
                ships[i].guns[slot].next=now+reload;ships[i].guns[slot].fired=now;
                if let Some(j)=sea{
                    if slot>=4&&ships[j].crew>0.0 {ships[j].crew=(ships[j].crew-damage*veterancy).max(0.0);} else {ships[j].hp-=damage*veterancy;}
                    ships[j].last_attacker=a.faction;ships[j].last_ship=a.id;
                }else if let Some(t)=land{
                    shots.extend([a.id as f64,t.id as f64,slot as f64,crate::combat::attack_damage(damage*veterancy,t.defense)]);
                }
                ships[i].fired=if slot<4 {a.weapons[slot]} else {MARINE_SHOT};
            }
        }
        // Reward after all simultaneous damage. A ship cannot pay twice after load.
        for i in 0..ships.len(){if ships[i].hp<=0.0&&!ships[i].rewarded{ships[i].hp=0.0;ships[i].rewarded=true;
            net.record_sink(ships[i].id,ships[i].x,ships[i].y,ships[i].angle,ships[i].class,ships[i].faction,now);
            let attacker=ships[i].last_attacker;
            if attacker>=0&&hostile(attacker,ships[i].faction){*rewards.entry(attacker).or_default()+=BOUNTY;
                if let Some(k)=ships.iter().position(|s|s.faction==attacker&&s.id==ships[i].last_ship){ships[k].kills+=1.0;}}
        }}
        net.output.clear();net.output.extend_from_slice(&[ships.len()as f64,factions as f64]);
        for s in ships {net.output.extend_from_slice(&s.row());if let Some(e)=net.ships.get(&s.id){world.entity_mut(*e).insert(s);}}
        for i in 0..factions{let id=net.input[count*STRIDE+i*FACTION_STRIDE]as i32;net.output.extend_from_slice(&[id as f64,*spent.get(&id).unwrap_or(&0.0),*rewards.get(&id).unwrap_or(&0.0)]);}
        net.output.push((shots.len()/4)as f64);net.output.extend(shots);
        net.output.as_ptr()
    })
}
