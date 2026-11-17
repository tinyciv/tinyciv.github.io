//! Field artillery. Conversion, shared weighted route fields, movement, weapon
//! clocks and upkeep execute in the game's Bevy World; the host mirrors rows.
use bevy_ecs::prelude::*;
use std::cmp::Reverse;
use std::collections::{BTreeMap, HashMap, HashSet, BinaryHeap};
use super::{entities::EntityTables, kinds::{building as b, unit as u}};

pub const ROW: usize = 24;
pub const TARGET: usize = 12;
pub const RANGE: f64 = 18.0;
pub const UPKEEP: f64 = 200.0;
pub const PERIOD: f64 = 30.0;
pub const SPEED: f64 = 3.6 * 1.1 * 0.5;
type Cell = (i32,i32);
fn cell(x:f64,y:f64)->Cell{(x.floor() as i32,y.floor() as i32)}
fn neighbors(c:Cell)->[Cell;8]{[(c.0,c.1-1),(c.0+1,c.1),(c.0,c.1+1),(c.0-1,c.1),
    (c.0-1,c.1-1),(c.0+1,c.1-1),(c.0-1,c.1+1),(c.0+1,c.1+1)]}
const EXPLICIT:u32=1;
const ATTACK_GOAL:u32=2;
const RALLY_GOAL:u32=4;

#[derive(Clone,Copy,PartialEq)]
struct Site { kind:u32, faction:i32, x:i32, y:i32, flags:u32 }
#[derive(Default)]
struct Field { last_used:f64, revision:u64, navigation:Option<Navigation>, distance:HashMap<Cell,u32>, settled:HashSet<Cell>, frontier:BinaryHeap<Reverse<(u32,Cell)>> }
#[derive(Clone,Copy,PartialEq)]
pub struct Navigation { pub engine:u32, pub grid:u32, pub blockers:u32, pub forbidden:u32, pub width:i32, pub height:i32, pub revision:u64 }
#[derive(Component,Default,Clone)]
pub struct Cannon { next_think:f64, next_plan:f64, hold_until:f64, goal:Option<Cell>, waypoint:Option<Cell>, revision:u64,
    requested:Option<(Cell,u32)>, navigation:Option<Navigation>, rejected:Vec<Cell> }
#[derive(Clone,Copy)]
struct Post { point:Cell, seen:f64 }
#[derive(Resource,Default)]
pub struct FieldCannons {
    pub input:Vec<f64>, output:[f64;ROW], sites:HashMap<i64,Site>,
    roads:HashMap<Cell,u32>, paved:HashMap<Cell,u32>, bridges:HashMap<Cell,u32>, blocked:HashMap<Cell,u32>, fields:BTreeMap<(i32,Cell),Field>, navigation:HashMap<i32,Navigation>, revision:u64, work_at:f64, work_left:usize, prune_at:f64,
    posts:HashMap<i64,Post>, posts_prune_at:f64,
    post_cells:HashMap<Cell,i64>,
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
        if let Some(n)=navigation {engines.get(n.engine).sweep(n.grid,a.0 as f64+0.5,a.1 as f64+0.5,z.0 as f64+0.5,z.1 as f64+0.5,n.blockers,n.forbidden)}else{self.road_move(a.0 as f64+0.5,a.1 as f64+0.5,z.0 as f64+0.5,z.1 as f64+0.5)}
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
        let mut best:Option<(f64,Cell)>=None;
        for dy in -radius..=radius{for dx in -radius..=radius{
            if flags&RALLY_GOAL!=0 && dx*dx+dy*dy>1 {continue;}
            let c=(origin.0+dx,origin.1+dy);
            if !self.post_open(id,c,navigation,engines) {continue;}
            // A completed reverse field is also a cached connected component.
            // Skip that whole component after proving this gun cannot enter it.
            if cannon.rejected.iter().any(|goal| self.fields.get(&(faction,*goal))
                .is_some_and(|field|field.frontier.is_empty()&&field.distance.contains_key(&c))) {continue;}
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
        ((500.0/self.multiplier(a)+500.0/self.multiplier(z))*diagonal).round() as u32
    }
    /// Shared Dijkstra fields prefer fast roads, while allowing legal off-road
    /// links. All artillery shares a bounded work allowance for this step.
    fn advance_field(&mut self,faction:i32,goal:Cell,needed:Cell,now:f64,engines:&crate::movement::Engines){
        if self.work_at!=now {self.work_at=now;self.work_left=2048;}
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
    /// Row: id,faction,x,y,hp,speed,goalX,goalY,facing,cooldown,shotAt,
    /// upkeepAt,funded,attackTime,goalFlags,forcedTarget,rawAttack,gold,
    /// strength,whaleBonus,moved,shotTarget,damage,reachedGoal.
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
        if !self.output[11].is_finite(){self.output[11]=now+PERIOD;}
        if now>=self.output[11]{
            let periods=((now-self.output[11])/PERIOD).floor()+1.0;let bill=UPKEEP*periods;
            self.output[12]=if self.output[17]>=bill{self.output[17]-=bill;1.0}else{0.0};
            self.output[11]+=PERIOD*periods;
        }
        if self.input[23]==0.0&&self.output[15]>=0.0{self.output[15]=-1.0;cannon.goal=None;cannon.waypoint=None;cannon.next_plan=0.0;return;}
        self.output[9]=(self.output[9]-dt).max(0.0);self.output[13]=(self.output[13]-dt).max(0.0);
        if self.output[12]==0.0{cannon.next_think=now+1.0;return;}
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
                self.output[22]=super::battle_support::siege_attack(true,crate::combat::attack_damage(self.output[16]*v[5],v[4])*self.output[18]*if v[9]!=0.0{2.0}else{1.0});
            }
        }
        if !self.output[6].is_finite()||self.output[13]>0.0||(flags&EXPLICIT==0||flags&ATTACK_GOAL!=0)&&now<cannon.hold_until{return;}
        let faction=self.output[1] as i32;let navigation=self.navigation.get(&faction).copied();
        let requested=Some((cell(self.output[6],self.output[7]),flags&!EXPLICIT));
        if now>=cannon.next_plan||cannon.requested!=requested||cannon.revision!=self.revision||cannon.navigation!=navigation{
            cannon.next_plan=now+1.0;
            let changed=cannon.requested!=requested||cannon.navigation!=navigation||cannon.revision!=self.revision;
            if changed {cannon.rejected.clear();}
            let keep=!changed && cannon.goal.is_some_and(|goal|self.post_open(id,goal,navigation,engines));
            if !keep {cannon.goal=self.choose_post(id,faction,cannon,self.output[6],self.output[7],flags,navigation,engines);}
            // Keep an in-flight segment across ordinary order publications and
            // distant edits. Returning to the current cell center every half
            // second made slow off-road artillery reverse forever.
            if let Some(next)=cannon.waypoint {
                if !self.open(next,navigation,engines)||navigation.is_some_and(|n|!engines.get(n.engine).sweep(n.grid,self.output[2],self.output[3],next.0 as f64+0.5,next.1 as f64+0.5,n.blockers,n.forbidden)){cannon.waypoint=None;}
            }
            cannon.requested=requested;cannon.revision=self.revision;cannon.navigation=navigation;
            self.reserve_post(id,cannon.goal,now);
        }
        let Some(goal)=cannon.goal else{return;};self.advance_field(faction,goal,cell(self.output[2],self.output[3]),now,engines);
        let current=cell(self.output[2],self.output[3]);
        let field=&self.fields[&(faction,goal)];
        if field.frontier.is_empty()&&!field.settled.contains(&current){
            if !cannon.rejected.contains(&goal){cannon.rejected.push(goal);}
            cannon.goal=None;cannon.next_plan=0.0;self.reserve_post(id,None,now);return;
        }
        let mut remaining=dt;
        for _ in 0..16{
            if remaining<=1e-9{break;}
            if cannon.waypoint.is_none(){
                let c=cell(self.output[2],self.output[3]);let center=(c.0 as f64+0.5,c.1 as f64+0.5);
                if (center.0-self.output[2]).hypot(center.1-self.output[3])>0.001{cannon.waypoint=Some(c);}
                else if c==goal{self.output[23]=1.0;break;}
                else{let field=&self.fields[&(faction,goal)];if !field.settled.contains(&c){break;}let Some(&distance)=field.distance.get(&c) else{break;};
                    cannon.waypoint=neighbors(c).into_iter().filter(|n|field.distance.get(n).is_some_and(|d|*d<distance)&&self.edge(c,*n,navigation,engines))
                        .min_by_key(|n|(field.distance[n].saturating_add(self.edge_cost(c,*n)),*n));
                }
            }
            let Some(next)=cannon.waypoint else{break;};if !self.open(next,navigation,engines){cannon.waypoint=None;break;}
            let dx=next.0 as f64+0.5-self.output[2];let dy=next.1 as f64+0.5-self.output[3];let length=dx.hypot(dy);
            if length<1e-8{cannon.waypoint=None;continue;}
            let current=cell(self.output[2],self.output[3]);
            let speed=SPEED*self.output[19]*self.multiplier(current).min(self.multiplier(next));
            let step=length.min(speed*remaining);let nx=self.output[2]+dx/length*step;let ny=self.output[3]+dy/length*step;
            if let Some(n)=navigation{if !engines.get(n.engine).sweep(n.grid,self.output[2],self.output[3],nx,ny,n.blockers,n.forbidden){cannon.waypoint=None;break;}}
            if let Some(n)=navigation{if !engines.get(n.engine).artillery_step_clear(id,self.output[2],self.output[3],nx,ny){break;}}
            self.output[2]=nx;self.output[3]=ny;self.output[8]=dy.atan2(dx);self.output[20]=1.0;remaining-=step/speed;
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
