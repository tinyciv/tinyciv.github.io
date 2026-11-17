//! Small freshwater reclamation. Static habitat and farm ownership are indexed
//! on revisions; civilians reclaim each tile while working from its dry bank.
use bevy_ecs::prelude::*;
use std::collections::{BTreeMap, BTreeSet, VecDeque};

const WORK_SECONDS: f64 = 8.0;
const MAX_BODY: usize = 3;
#[derive(Clone, Copy)]
struct Worker { id: i64, faction: i32, home: i64, x: f64, y: f64, available: bool }
#[derive(Clone, Copy, Default)]
struct Job { faction: i32, worker: Option<i64>, progress: f64, retry_at: f64, farms: [usize;2] }

#[derive(Resource, Default)]
pub struct Drainage {
    input: Vec<f64>, output: Vec<f64>, width: usize, height: usize,
    water: Vec<u8>, soil_water: Vec<u8>, blocked: Vec<bool>, ground: Vec<u32>, farms: Vec<i32>, bodies: Vec<Vec<usize>>,
    enabled: BTreeSet<i32>, workers: BTreeMap<i64, Worker>, jobs: BTreeMap<usize, Job>, dirty: bool,
    rejected: BTreeMap<(usize,i64),f64>,
}
impl Drainage {
    pub fn input(&mut self, length: usize) -> *mut f64 { self.input.resize(length, 0.0); self.input.as_mut_ptr() }
    pub fn length(&self) -> usize { self.output.len() }
    /// 0 [water code, blocker, dry terrain, soil water] per cell (1 fresh, 2 salt); 1 farm owners per
    /// cell; 2 researched factions; 3 [id,faction,x,y,available,job,progress,home,farm0,farm1].
    pub fn commit(&mut self, mode: u32, width: usize, height: usize, count: usize) {
        match mode {
            0 => {
                self.width=width; self.height=height;
                self.water=self.input[..count*4].chunks_exact(4).map(|r|r[0] as u8).collect();
                self.blocked=self.input[..count*4].chunks_exact(4).map(|r|r[1]!=0.0).collect();
                self.ground=self.input[..count*4].chunks_exact(4).map(|r|r[2] as u32).collect();
                self.soil_water=self.input[..count*4].chunks_exact(4).map(|r|r[3] as u8).collect();
                self.index_bodies(); self.dirty=true;
            }
            1 => { self.farms=self.input[..count].iter().map(|v|*v as i32).collect(); self.dirty=true; }
            2 => {
                let enabled=self.input[..count].iter().map(|v|*v as i32).collect();
                if self.enabled!=enabled { self.enabled=enabled; self.dirty=true; }
            }
            3 => {
                self.refresh();
                self.workers.clear();
                for r in self.input[..count*10].chunks_exact(10) {
                    let id=r[0] as i64;
                    self.workers.insert(id,Worker{id,faction:r[1] as i32,home:r[7] as i64,x:r[2],y:r[3],available:r[4]!=0.0});
                    if r[5]>=0.0 {
                        let cell=r[5] as usize; let faction=r[1] as i32;
                        // Active resident mirrors retain the original two farm
                        // cells through a save made midway through a pond.
                        if !self.jobs.contains_key(&cell) && r[8]>=0.0 && r[9]>=0.0 && self.enabled.contains(&faction)
                            && [r[8] as usize,r[9] as usize].iter().all(|farm|self.farms.get(*farm)==Some(&faction)) {
                            if let Some(body)=self.bodies.iter().find(|body|body.contains(&cell)) {
                                for &next in body { self.jobs.entry(next).or_insert(Job{faction,farms:[r[8] as usize,r[9] as usize],..Default::default()}); }
                            }
                        }
                        if let Some(job)=self.jobs.get_mut(&(r[5] as usize)) {
                            if job.faction==r[1] as i32 && job.worker.is_none_or(|worker|worker==id) {
                                job.worker=Some(id); job.progress=r[6].max(0.0).min(WORK_SECONDS);
                            }
                        }
                    }
                }
                for job in self.jobs.values_mut() {
                    if job.worker.is_some_and(|worker| !self.workers.contains_key(&worker)) { job.worker=None; job.progress=0.0; }
                }
            }
            _=>{}
        }
    }
    fn index_bodies(&mut self) {
        self.bodies.clear();
        let mut seen=vec![false;self.water.len()]; let mut queue=VecDeque::new();
        for start in 0..self.water.len() {
            if self.water[start]==0 || seen[start] { continue; }
            seen[start]=true; queue.push_back(start);
            let mut members=Vec::new(); let mut count=0; let mut fresh=true;
            while let Some(cell)=queue.pop_front() {
                count+=1; fresh &= self.water[cell]==1 && !self.blocked[cell];
                if members.len()<=MAX_BODY { members.push(cell); }
                adjacent(cell,self.width,self.height,|next| {
                    if !seen[next] && self.water[next]!=0 { seen[next]=true; queue.push_back(next); }
                });
            }
            if fresh && count<=MAX_BODY { self.bodies.push(members); }
        }
    }
    fn refresh(&mut self) {
        if !self.dirty { return; }
        let mut next=BTreeMap::new();
        for body in &self.bodies {
            let mut borders=BTreeMap::<i32,BTreeSet<usize>>::new();
            for &cell in body { adjacent(cell,self.width,self.height,|near| {
                let faction=self.farms.get(near).copied().unwrap_or(-1);
                if self.enabled.contains(&faction) { borders.entry(faction).or_default().insert(near); }
            }); }
            // Finish the rest of a pond against the same two bordering farms
            // after its first worked tile becomes dry ground.
            let prior=body.iter().filter_map(|cell|self.jobs.get(cell)).find(|job|
                self.enabled.contains(&job.faction) && job.farms.iter().all(|cell|self.farms.get(*cell)==Some(&job.faction)));
            let choice=borders.iter().find(|(_,cells)|cells.len()>=2).map(|(&faction,cells)|{
                let mut farms=cells.iter(); (faction,[*farms.next().unwrap(),*farms.next().unwrap()])
            }).or_else(||prior.map(|job|(job.faction,job.farms)));
            let Some((faction,farms))=choice else { continue; };
            for &cell in body {
                let old=self.jobs.get(&cell).copied().filter(|job|job.faction==faction);
                next.insert(cell,old.unwrap_or(Job{faction,farms,..Default::default()}));
            }
        }
        self.jobs=next; self.dirty=false;
    }
    /// Dispatch at most one resident per observation, avoiding a burst of route
    /// searches when a technology or a farm reveals many eligible ponds.
    pub fn plan(&mut self, now: f64) -> *const f64 {
        self.refresh(); self.output.clear();
        self.rejected.retain(|(cell,_),until|self.jobs.contains_key(cell) && *until>now);
        let busy:BTreeSet<i64>=self.jobs.values().filter_map(|job|job.worker).collect();
        for (&cell,job) in &mut self.jobs {
            if job.worker.is_some() || now<job.retry_at { continue; }
            let x=(cell%self.width)as f64+0.5; let y=(cell/self.width)as f64+0.5;
            let worker=self.workers.values().filter(|w|w.available && w.faction==job.faction && !busy.contains(&w.id)
                && !self.rejected.contains_key(&(cell,w.home)))
                .min_by(|a,b|((a.x-x).powi(2)+(a.y-y).powi(2)).total_cmp(&((b.x-x).powi(2)+(b.y-y).powi(2))).then(a.id.cmp(&b.id)));
            let Some(worker)=worker else { continue; };
            job.worker=Some(worker.id); job.progress=0.0;
            self.output.extend([worker.id as f64,cell as f64,job.farms[0] as f64,job.farms[1] as f64]); break;
        }
        self.output.as_ptr()
    }
    pub fn release(&mut self, worker: i64, now: f64) {
        for (&cell,job) in &mut self.jobs { if job.worker==Some(worker) {
            if let Some(worker)=self.workers.get(&worker) { self.rejected.insert((cell,worker.home),now+30.0); }
            job.worker=None; job.progress=0.0; job.retry_at=now+3.0;
        } }
    }
    /// Tiny native candidate set; the ordinary land pathfinder chooses the
    /// reachable bank without granting workers access to the water itself.
    pub fn shores(&mut self, cell:usize)->*const f64 {
        self.output.clear();
        if cell<self.water.len() && self.water[cell]==1 {
            adjacent(cell,self.width,self.height,|near| {
                if self.water[near]==0 && self.ground[near]>0 && !self.blocked[near] { self.output.push(near as f64); }
            });
        }
        self.output.as_ptr()
    }
    /// Recompute only soils whose five-tile freshwater bonus can change.
    /// Same Manhattan-distance rule as ordinary generated soil; no world flood.
    pub fn soil_patch(&mut self, center:usize)->*const f64 {
        self.output.clear(); let cx=(center%self.width)as i32; let cy=(center/self.width)as i32;
        for dy in -5i32..=5 { for dx in -5i32..=5 {
            if dx.abs()+dy.abs()>5 { continue; }
            let x=cx+dx; let y=cy+dy;
            if x<0 || y<0 || x>=self.width as i32 || y>=self.height as i32 { continue; }
            let cell=y as usize*self.width+x as usize;
            let base=if self.soil_water[cell]!=0 { 0.0 } else { match self.ground[cell] {2=>0.75,3=>0.5,4=>0.25,_=>1.0} };
            let mut distance=6;
            if self.soil_water[cell]==0 {
                'search: for d in 1i32..=5 { for sx in -d..=d {
                    let sy=d-sx.abs();
                    for oy in [-sy,sy] {
                        let nx=x+sx; let ny=y+oy;
                        if nx>=0 && ny>=0 && nx<self.width as i32 && ny<self.height as i32 && self.soil_water[ny as usize*self.width+nx as usize]==1 {
                            distance=d; break 'search;
                        }
                    }
                }}
            }
            let bonus=if self.soil_water[cell]==0 { (0.25-((distance-1)as f64)*0.05).max(0.0) } else { 0.0 };
            self.output.extend([cell as f64,base+bonus]);
        }}
        self.output.as_ptr()
    }
    /// [state,progress,dry terrain]: 0 invalid/return, 1 travelling, 2 working, 3 filled.
    pub fn step(&mut self, worker: i64, cell: usize, bank: usize, faction: i32, x: f64, y: f64, active: bool, dt: f64) -> *const f64 {
        self.output.clear();
        let bank_valid=bank<self.water.len() && cell<self.water.len() && self.water[bank]==0
            && self.ground[bank]>0 && !self.blocked[bank]
            && (bank%self.width).abs_diff(cell%self.width)+(bank/self.width).abs_diff(cell/self.width)==1;
        let state=if let Some(job)=self.jobs.get_mut(&cell).filter(|job|job.worker==Some(worker) && job.faction==faction) {
            if !active || !bank_valid || !self.enabled.contains(&faction) { 0.0 }
            else if (x-((bank%self.width)as f64+0.5)).hypot(y-((bank/self.width)as f64+0.5))>0.15 { 1.0 }
            else { job.progress+=dt.max(0.0); if job.progress+1e-8>=WORK_SECONDS { 3.0 } else { 2.0 } }
        } else { 0.0 };
        let progress=self.jobs.get(&cell).map_or(0.0,|job|job.progress);
        let mut ground=0;
        if state==3.0 {
            adjacent(cell,self.width,self.height,|near| {
                if ground==0 && self.water[near]==0 && self.ground[near]>0 && self.farms.get(near)==Some(&faction) { ground=self.ground[near]; }
            });
            if ground==0 { ground=1; }
            self.jobs.remove(&cell); self.water[cell]=0; self.soil_water[cell]=0; self.ground[cell]=ground;
        }
        self.output.extend([state,progress,ground as f64]); self.output.as_ptr()
    }
}
fn adjacent(cell:usize,width:usize,height:usize,mut visit:impl FnMut(usize)) {
    let x=cell%width; let y=cell/width;
    if x>0 { visit(cell-1); } if x+1<width { visit(cell+1); }
    if y>0 { visit(cell-width); } if y+1<height { visit(cell+width); }
}
