//! Local flock steering at 2 Hz. Each flock has at most eight birds, so the
//! neighbor work is bounded independently of the size of the world/army.
use bevy_ecs::prelude::*;
use std::collections::BTreeMap;

pub fn speed(fleeing: bool) -> f64 { if fleeing { 2.6 * 0.7 } else { 0.75 * 0.7 } }
pub fn turn(from: f64, to: f64, dt: f64, fleeing: bool) -> f64 {
    let delta = (to - from).sin().atan2((to - from).cos());
    from + delta.clamp(-dt.max(0.0) * if fleeing { 4.0 } else { 2.2 }, dt.max(0.0) * if fleeing { 4.0 } else { 2.2 })
}
fn noise(id: i64, salt: u32) -> f64 {
    let mut n = (id as u32).wrapping_mul(0x9e3779b9) ^ salt.wrapping_mul(0x85ebca6b);
    n = (n ^ n >> 16).wrapping_mul(0x7feb352d); n = (n ^ n >> 15).wrapping_mul(0x846ca68b);
    (n ^ n >> 16) as f64 / u32::MAX as f64
}
fn unit(x: f64, y: f64) -> (f64, f64) { let d=x.hypot(y); if d>0.0001 {(x/d,y/d)} else {(0.0,0.0)} }
#[derive(Default)]
struct Mind { forage_epoch: i64, forage_x: f64, forage_y: f64, goal_x: f64, goal_y: f64, observed: f64 }
#[derive(Resource, Default)]
pub struct BirdFlocks { input: Vec<f64>, output: Vec<f64>, minds: BTreeMap<i64, Mind> }
impl BirdFlocks {
    pub fn prepare(&mut self, count: usize) -> *mut f64 { self.input.resize(count * 5,0.0); self.input.as_mut_ptr() }
    /// Input bird rows [id,x,y,heading,moving]. Output [id,goalX,goalY,speed,active].
    pub fn plan(&mut self, count: usize, now: f64, gx: f64, gy: f64, wandering: bool,
        fleeing: bool, threat_x: f64, threat_y: f64) -> *const f64 {
        self.output.clear();
        let birds=&self.input[..(count*5).min(self.input.len())];
        let count=birds.len()/5;
        if count==0 { return self.output.as_ptr(); }
        let cx=birds.chunks_exact(5).map(|b|b[1]).sum::<f64>()/count as f64;
        let cy=birds.chunks_exact(5).map(|b|b[2]).sum::<f64>()/count as f64;
        for bird in birds.chunks_exact(5) {
            let (id,x,y)=(bird[0] as i64,bird[1],bird[2]);
            let mut sx=0.0;let mut sy=0.0;let mut ax=0.0;let mut ay=0.0;let mut neighbors=0.0;
            for other in birds.chunks_exact(5) {
                if other[0]==bird[0] {continue;}
                let dx=x-other[1];let dy=y-other[2];let d=dx.hypot(dy);
                if d<1.1 {
                    // Stable pair direction also separates initially overlapping birds.
                    let (px,py)=if d>0.001 {(dx/d,dy/d)} else {
                        let a=noise(id.min(other[0] as i64),13)*std::f64::consts::TAU;
                        let sign=if id<other[0] as i64 {1.0}else{-1.0};(a.cos()*sign,a.sin()*sign)
                    };
                    let weight=(1.1-d)/1.1;sx+=px*weight;sy+=py*weight;
                }
                if d<4.0 && other[4]!=0.0 { ax+=other[3].cos();ay+=other[3].sin();neighbors+=1.0; }
            }
            let spread=(x-cx).hypot(y-cy);
            let cycle=9.0+noise(id,2)*7.0;
            let offset=noise(id,3)*cycle;
            let epoch=((now+offset)/cycle).floor() as i64;
            let forage=(now+offset).rem_euclid(cycle)<2.5;
            let mind=self.minds.entry(id).or_insert_with(||Mind { forage_epoch:i64::MIN,goal_x:x,goal_y:y,..Default::default() });
            if mind.forage_epoch!=epoch {
                mind.forage_epoch=epoch;
                let angle=noise(id,epoch as u32+31)*std::f64::consts::TAU;
                mind.forage_x=x+angle.cos()*0.8;mind.forage_y=y+angle.sin()*0.8;
            }
            let active=fleeing||wandering||forage||spread>3.2||sx.hypot(sy)>0.3;
            let (tx,ty)=if wandering||fleeing {(gx,gy)}else{(mind.forage_x,mind.forage_y)};
            let (wx,wy)=unit(tx-x,ty-y);
            let (cohx,cohy)=unit(cx-x,cy-y);
            let (alignx,aligny)=if neighbors>0.0 {unit(ax,ay)}else{(0.0,0.0)};
            let cohesion=if spread>1.4 {((spread-1.4)*0.45).min(1.5)}else{0.0};
            let (fx,fy)=if fleeing {unit(x-threat_x,y-threat_y)}else{(0.0,0.0)};
            // Shared direction, local alignment, loose cohesion and strong personal space.
            let (vx,vy)=unit(wx*0.9+cohx*cohesion+alignx*0.35+sx*2.0+fx*1.8,
                wy*0.9+cohy*cohesion+aligny*0.35+sy*2.0+fy*1.8);
            if active {
                let reach=if fleeing {2.4}else if wandering||spread>3.2 {1.3}else{0.65};
                let desired_x=x+vx*reach;let desired_y=y+vy*reach;
                // Avoid rebuilding local routes for tiny flock corrections.
                if (mind.goal_x-x).hypot(mind.goal_y-y)<0.3 || (desired_x-mind.goal_x).hypot(desired_y-mind.goal_y)>0.55 {
                    mind.goal_x=desired_x;mind.goal_y=desired_y;
                }
            }
            mind.observed=now;
            self.output.extend([bird[0],mind.goal_x,mind.goal_y,speed(fleeing),active as u8 as f64]);
        }
        // Deaths never leave permanent steering history; bounded to the small wildlife population.
        self.minds.retain(|_,mind|now-mind.observed<30.0);
        self.output.as_ptr()
    }
}
