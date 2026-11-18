//! Incremental hull-pose routes shared by naval and working vessels.
use std::cmp::Ordering;
use std::collections::{BTreeMap, BinaryHeap, VecDeque};

const MAX_SEARCH_NODES:usize=16_384;
pub fn delta(a:f64,b:f64)->f64{(b-a).sin().atan2((b-a).cos())}
/// Callers supply their indexed traffic, terrain and actual hull clearance.
/// Sweeps use the same geometry predicate as movement; no endpoint-only turns.
pub trait VesselGeometry {
    fn in_bounds(&self,x:f64,y:f64)->bool;
    fn pose(&self,x:f64,y:f64,angle:f64)->bool;
    fn turn_clear(&self,x:f64,y:f64,from:f64,to:f64)->bool {
        let change=delta(from,to);let steps=(change.abs()/0.08).ceil().max(1.0)as usize;
        (1..=steps).all(|i|self.pose(x,y,from+change*i as f64/steps as f64))
    }
    fn segment_clear(&self,from:(f64,f64),to:(f64,f64),angle:f64)->bool {
        let steps=((to.0-from.0).hypot(to.1-from.1)/0.2).ceil().max(1.0)as usize;
        (1..=steps).all(|i|{let t=i as f64/steps as f64;self.pose(from.0+(to.0-from.0)*t,from.1+(to.1-from.1)*t,angle)})
    }
}

#[derive(Clone,Copy,Debug)]
/// drive: 0 turns, +/-1 follows the hull axis; 2 is an optional working-boat
/// side translation with the hull angle held fixed.
pub struct Waypoint { pub x:f64, pub y:f64, pub angle:f64, pub drive:f64 }
type PoseKey=(i32,i32,u8);
#[derive(Clone,Copy)]
struct Node { key:PoseKey, cost:f64, score:f64 }
impl PartialEq for Node{fn eq(&self,o:&Self)->bool{self.key==o.key&&self.score==o.score}}
impl Eq for Node{}
impl Ord for Node{fn cmp(&self,o:&Self)->Ordering{o.score.total_cmp(&self.score).then(o.key.cmp(&self.key))}}
impl PartialOrd for Node{fn partial_cmp(&self,o:&Self)->Option<Ordering>{Some(self.cmp(o))}}

/// The lattice is anchored at the actual hull pose, including its fractional
/// launch coordinates. A node retains heading: a clear destination alone does
/// not establish that a five-tile hull can rotate there. Reverse moves let a
/// ship leave a narrow berth before attempting its turn.
pub struct Search {
    pub origin:(f64,f64), pub angle:f64, pub goal:(f64,f64), pub geometry:u64,
    limit:usize, lateral:bool, lateral_radius:f64, lateral_goal_radius:f64,
    queue:BinaryHeap<Node>, costs:BTreeMap<PoseKey,f64>, previous:BTreeMap<PoseKey,(PoseKey,f64)>,
}
pub enum Plan { Pending, Found(VecDeque<Waypoint>), Failed }
fn append_waypoint(route:&mut VecDeque<Waypoint>,point:Waypoint) {
    if let Some(last)=route.back_mut() {
        if point.drive.abs()==1.0 && point.drive==last.drive && delta(last.angle,point.angle).abs()<0.001 {
            *last=point;return;
        }
    }
    route.push_back(point);
}
/// Try a swept direct leg in either gear. This also avoids running a search
/// for ordinary open-water orders and preserves exact shoreline launch rows.
pub fn direct_route(net:&impl VesselGeometry,from:(f64,f64),angle:f64,goal:(f64,f64))->Option<VecDeque<Waypoint>> {
    let distance=(goal.0-from.0).hypot(goal.1-from.1);
    if distance<0.000001{return Some(VecDeque::new());}
    let bearing=(goal.1-from.1).atan2(goal.0-from.0);
    let mut choices:[(f64,f64);2]=[(bearing,1.0),(bearing+std::f64::consts::PI,-1.0)];
    choices.sort_by(|a,b|delta(angle,a.0).abs().total_cmp(&delta(angle,b.0).abs()).then(b.1.total_cmp(&a.1)));
    for (heading,drive) in choices {
        if !net.turn_clear(from.0,from.1,angle,heading)||!net.segment_clear(from,goal,heading){continue;}
        let mut route=VecDeque::new();
        if delta(angle,heading).abs()>0.02{route.push_back(Waypoint{x:from.0,y:from.1,angle:heading,drive:0.0});}
        route.push_back(Waypoint{x:goal.0,y:goal.1,angle:heading,drive});return Some(route);
    }
    None
}
impl Search {
    pub fn new(origin:(f64,f64),angle:f64,goal:(f64,f64),geometry:u64)->Self {
        let key=(0,0,0);let mut queue=BinaryHeap::new();queue.push(Node{key,cost:0.0,score:(goal.0-origin.0).hypot(goal.1-origin.1)});
        Self{origin,angle,goal,geometry,limit:MAX_SEARCH_NODES,lateral:false,lateral_radius:0.0,lateral_goal_radius:0.0,queue,costs:BTreeMap::from([(key,0.0)]),previous:BTreeMap::new()}
    }
    pub fn with_limit(mut self,nodes:usize)->Self{self.limit=nodes.clamp(1,MAX_SEARCH_NODES);self}
    pub fn with_lateral(mut self)->Self{self.lateral=true;self.lateral_radius=f64::INFINITY;self}
    pub fn with_lateral_radius(mut self,radius:f64)->Self{self.lateral=true;self.lateral_radius=radius.max(0.0);self}
    pub fn with_lateral_goal_radius(mut self,radius:f64)->Self{self.lateral=true;self.lateral_goal_radius=radius.max(0.0);self}
    pub fn progress(&self)->(usize,usize){(self.costs.len(),self.queue.len())}
    fn lateral_at(&self,x:f64,y:f64)->bool{self.lateral&&((x-self.origin.0).hypot(y-self.origin.1)<=self.lateral_radius+0.000001
        ||(x-self.goal.0).hypot(y-self.goal.1)<=self.lateral_goal_radius+0.000001)}
    fn point(&self,key:PoseKey)->(f64,f64,f64) {
        let x=key.0 as f64*0.5;let y=key.1 as f64*0.5;let(c,s)=(self.angle.cos(),self.angle.sin());
        (self.origin.0+c*x-s*y,self.origin.1+s*x+c*y,self.angle+key.2 as f64*std::f64::consts::FRAC_PI_4)
    }
    fn route(&self,mut key:PoseKey,tail:VecDeque<Waypoint>)->VecDeque<Waypoint> {
        let mut backwards=Vec::new();
        while let Some(&(before,drive))=self.previous.get(&key) {
            let(x,y,angle)=self.point(key);backwards.push(Waypoint{x,y,angle,drive});key=before;
        }
        let mut route=VecDeque::new();
        for point in backwards.into_iter().rev().chain(tail){append_waypoint(&mut route,point);}
        route
    }
    pub fn advance(&mut self,net:&impl VesselGeometry,budget:usize)->Plan {
        const DIRECTIONS:[(i32,i32);8]=[(1,0),(1,1),(0,1),(-1,1),(-1,0),(-1,-1),(0,-1),(1,-1)];
        for _ in 0..budget {
            let Some(node)=self.queue.pop()else{return Plan::Failed;};
            if node.cost>*self.costs.get(&node.key).unwrap_or(&f64::INFINITY){continue;}
            let(x,y,angle)=self.point(node.key);let distance=(self.goal.0-x).hypot(self.goal.1-y);
            if distance<=1.0 {
                if let Some(tail)=direct_route(net,(x,y),angle,self.goal){return Plan::Found(self.route(node.key,tail));}
                if self.lateral_at(x,y)&&self.lateral_at(self.goal.0,self.goal.1)&&net.segment_clear((x,y),self.goal,angle) {
                    let tail=VecDeque::from([Waypoint{x:self.goal.0,y:self.goal.1,angle,drive:2.0}]);
                    return Plan::Found(self.route(node.key,tail));
                }
            }
            if self.costs.len()>=self.limit{return Plan::Failed;}
            let mut candidates=[((0,0,0),0.0,0.0);10];
            candidates[..4].copy_from_slice(&[
                ((node.key.0,node.key.1,(node.key.2+1)%8),0.0,1.25),
                ((node.key.0,node.key.1,(node.key.2+7)%8),0.0,1.25),
                {let(dx,dy)=DIRECTIONS[node.key.2 as usize];((node.key.0+dx,node.key.1+dy,node.key.2),1.0,0.5*(dx as f64).hypot(dy as f64))},
                {let(dx,dy)=DIRECTIONS[node.key.2 as usize];((node.key.0-dx,node.key.1-dy,node.key.2),-1.0,0.7*(dx as f64).hypot(dy as f64))},
            ]);
            let mut count=4;
            if self.lateral_at(x,y) {for heading in 0..8 {
                if heading==node.key.2 as usize||heading==(node.key.2 as usize+4)%8{continue;}
                let(dx,dy)=DIRECTIONS[heading];candidates[count]=((node.key.0+dx,node.key.1+dy,node.key.2),2.0,1.1*(dx as f64).hypot(dy as f64));count+=1;
            }}
            for &(next,drive,extra) in &candidates[..count] {
                let cost=node.cost+extra;if cost>=*self.costs.get(&next).unwrap_or(&f64::INFINITY){continue;}
                let(px,py,heading)=self.point(next);
                if !net.in_bounds(px,py){continue;}
                if drive==2.0&&!self.lateral_at(px,py){continue;}
                let clear=if drive==0.0{net.turn_clear(x,y,angle,heading)}else{net.segment_clear((x,y),(px,py),angle)};
                if !clear{continue;}
                if self.costs.len()>=self.limit&&!self.costs.contains_key(&next){continue;}
                self.costs.insert(next,cost);self.previous.insert(next,(node.key,drive));
                self.queue.push(Node{key:next,cost,score:cost+(self.goal.0-px).hypot(self.goal.1-py)});
            }
        }
        Plan::Pending
    }
}
