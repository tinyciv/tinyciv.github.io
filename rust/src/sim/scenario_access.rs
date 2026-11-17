//! Scenario construction preserves the cardinal walking graph. Terrain and
//! structure observations are revisioned by the host; all connectivity,
//! placement decisions and offline corridor repair plans stay in this ECS.
use bevy_ecs::prelude::*;
use std::collections::{BTreeMap, BTreeSet, BinaryHeap};
use std::cmp::Reverse;
use super::kinds::building as b;

#[derive(Clone, Copy, PartialEq)]
struct Site { kind:u32, x:i32, y:i32, w:i32, h:i32, ready:bool }
fn solid(kind:u32)->bool { !matches!(kind,b::CAMP|b::SHACK|b::COTTAGE|b::ROAD|b::BRIDGE|b::IRRIGATION|b::RUIN) }
fn removal_cost(kind:u32)->u64 { match kind { b::PALACE|b::SHIPYARD=>1_000_000, b::WALL|b::PALISADE=>1,
    b::TOWER|b::WOODEN_TOWER=>8,b::HOUSE=>40,b::FORT=>1000,_=>120 } }
#[derive(Resource, Default)]
pub struct ScenarioAccess {
    input:Vec<f64>, output:Vec<f64>, width:i32, height:i32, terrain:Vec<u8>, edges:Vec<u8>,
    sites:BTreeMap<i64,Site>, owners:Vec<Vec<i64>>, base:Vec<bool>, bridges:Vec<bool>, open:Vec<bool>, labels:Vec<usize>, rings:Vec<bool>,
    dirty:bool, checks:BTreeMap<(i32,i32,i32,i32),bool>,
}
impl ScenarioAccess {
    pub fn reset(&mut self){*self=Self::default();}
    pub fn input(&mut self,n:usize)->*mut f64 {self.input.resize(n,0.0);self.input.as_mut_ptr()}
    pub fn geometry(&mut self,w:i32,h:i32) {
        self.width=w;self.height=h;let n=(w*h)as usize;
        self.terrain=(0..n).map(|i|self.input[i*2]as u8).collect();
        self.edges=(0..n).map(|i|self.input[i*2+1]as u8).collect();self.dirty=true;
    }
    pub fn site(&mut self,id:i64,kind:u32,x:i32,y:i32,w:i32,h:i32,flags:u32) {
        let next=Site{kind,x,y,w,h,ready:flags&2!=0};
        if flags&1==0||(!solid(kind)&&kind!=b::BRIDGE) {if self.sites.remove(&id).is_some(){self.dirty=true;}}
        else if self.sites.get(&id)!=Some(&next){self.sites.insert(id,next);self.dirty=true;}
    }
    fn cells(&self,s:Site)->Vec<usize> {(s.y.max(0)..(s.y+s.h).min(self.height)).flat_map(|y|
        (s.x.max(0)..(s.x+s.w).min(self.width)).map(move|x|(y*self.width+x)as usize)).collect()}
    fn adjacent(&self,i:usize)->impl Iterator<Item=usize>+'_ {
        [(1,-self.width, i as i32>=self.width),(3,-1,i as i32%self.width>0),
         (4,1,i as i32%self.width+1<self.width),(6,self.width,i as i32+self.width<self.width*self.height)]
        .into_iter().filter(move|(bit,d,inside)|*inside&&{
            let next=(i as i32+*d)as usize;
            self.edges[i]&(1<<bit)!=0||(self.bridges[i]||self.bridges[next])&&self.base[i]&&self.base[next]
        }).map(move|(_,d,_)|(i as i32+d)as usize)
    }
    fn components(&self,open:&[bool])->(Vec<usize>,Vec<usize>) {
        let mut labels=vec![0;open.len()];let mut roots=Vec::new();let mut queue=Vec::new();
        for start in 0..open.len(){if !open[start]||labels[start]!=0{continue;}roots.push(start);let label=roots.len();
            queue.clear();queue.push(start);labels[start]=label;
            for head in 0..open.len(){if head>=queue.len(){break;}for next in self.adjacent(queue[head]){
                if open[next]&&labels[next]==0{labels[next]=label;queue.push(next);}
            }}
        }(labels,roots)
    }
    fn reconcile(&mut self) {
        if !self.dirty{return;}let n=self.terrain.len();self.base=self.terrain.iter().map(|v|v&1!=0).collect();
        self.owners=vec![Vec::new();n];self.bridges=vec![false;n];
        for(&id,&s)in &self.sites {for cell in self.cells(s){
            if s.kind==b::BRIDGE&&s.ready&&self.terrain[cell]&2!=0{self.base[cell]=true;self.bridges[cell]=true;}
            if solid(s.kind){self.owners[cell].push(id);}
        }}
        self.open=(0..n).map(|i|self.base[i]&&self.owners[i].is_empty()).collect();
        self.rings=vec![false;n];
        let rings:Vec<_>=self.sites.values().filter(|s|s.kind==b::PALACE&&s.ready).flat_map(|s|self.ring(*s)).collect();
        for cell in rings{self.rings[cell]=true;}
        self.labels=self.components(&self.open).0;self.checks.clear();self.dirty=false;
    }
    /// A local ring proves most placements safe without a world flood. Only
    /// narrow passages fall back to a search, stopping at the last boundary.
    pub fn placement(&mut self,kind:u32,x:i32,y:i32,w:i32,h:i32)->bool {
        if !solid(kind){return true;}self.reconcile();let key=(x,y,w,h);
        let footprint=self.cells(Site{kind,x,y,w,h,ready:true});
        if !matches!(kind,b::WALL|b::PALISADE)&&footprint.iter().any(|i|self.rings[*i]){return false;}
        if let Some(&allowed)=self.checks.get(&key){return allowed;}
        let removed:BTreeSet<_>=footprint.into_iter().filter(|i|self.open[*i]).collect();
        let affected:BTreeSet<_>=removed.iter().flat_map(|i|self.adjacent(*i)).flat_map(|i|self.owners[i].iter().copied()).collect();
        let entrances=affected.into_iter().all(|id|{
            let site=self.sites[&id];if matches!(site.kind,b::WALL|b::PALISADE){return true;}
            let exits:BTreeSet<_>=self.cells(site).into_iter().flat_map(|i|self.adjacent(i)).filter(|i|self.open[*i]).collect();
            exits.is_empty()||exits.iter().any(|i|!removed.contains(i))
        });
        let connected=entrances&&self.connected_after(&removed,x,y,w,h);
        if self.checks.len()>4096{self.checks.clear();}self.checks.insert(key,connected);connected
    }
    pub fn batch(&mut self,count:usize)->bool {
        self.reconcile();let mut removed=BTreeSet::new();let(mut left,mut top,mut right,mut bottom)=(self.width,self.height,0,0);
        for r in self.input[..count*5].chunks_exact(5){let kind=r[0]as u32;if !solid(kind){continue;}
            let s=Site{kind,x:r[1]as i32,y:r[2]as i32,w:r[3]as i32,h:r[4]as i32,ready:true};
            if !matches!(kind,b::WALL|b::PALISADE)&&self.cells(s).iter().any(|i|self.rings[*i]){return false;}
            left=left.min(s.x);top=top.min(s.y);right=right.max(s.x+s.w);bottom=bottom.max(s.y+s.h);
            removed.extend(self.cells(s).into_iter().filter(|i|self.open[*i]));
        }
        self.connected_after(&removed,left,top,right-left,bottom-top)
    }
    fn connected_after(&self,removed:&BTreeSet<usize>,x:i32,y:i32,w:i32,h:i32)->bool {
        let mut groups=BTreeMap::<usize,BTreeSet<usize>>::new();
        for &cell in removed{for next in self.adjacent(cell){if self.open[next]&&!removed.contains(&next){groups.entry(self.labels[next]).or_default().insert(next);}}}
        groups.values().all(|boundary| {
            if boundary.len()<2{return true;}let start=*boundary.first().unwrap();
            for local in [true,false] {
                let mut waiting=boundary.clone();waiting.remove(&start);let mut seen=vec![false;self.open.len()];seen[start]=true;let mut queue=vec![start];
                for head in 0..self.open.len(){if head>=queue.len()||waiting.is_empty(){break;}
                    for next in self.adjacent(queue[head]){let(nx,ny)=(next as i32%self.width,next as i32/self.width);
                        if self.open[next]&&!seen[next]&&!removed.contains(&next)&&(!local||(nx>=x-3&&nx<x+w+3&&ny>=y-3&&ny<y+h+3)){seen[next]=true;waiting.remove(&next);queue.push(next);}
                    }
                }
                if waiting.is_empty(){return true;}
            }false
        })
    }
    /// Plan the cheapest corridors joining every surviving piece of each
    /// natural landmass. Buildings are removed as complete objects, never by
    /// painting terrain. Palace/shipyard removal is reported but heavily avoided.
    pub fn audit(&mut self,starts:usize)->*const f64 {
        self.reconcile();let n=self.base.len();let (land,land_roots)=self.components(&self.base);
        let (_,pockets)=self.components(&self.open);let mut roots=land_roots.clone();
        let mut start_cells=Vec::new();
        for r in self.input[..starts*2].chunks_exact(2){let(x,y)=(r[0],r[1]);
            let cell=(0..n).filter(|i|self.base[*i]).min_by(|a,b|{
                let score=|i:usize|(i as f64%self.width as f64+0.5-x).hypot((i/self.width as usize)as f64+0.5-y);
                score(*a).total_cmp(&score(*b))
            });
            if let Some(cell)=cell{roots[land[cell]-1]=cell;start_cells.push(cell);}
        }
        let cost:Vec<_>=self.owners.iter().map(|ids|ids.iter().map(|id|removal_cost(self.sites[id].kind)).sum::<u64>()).collect();
        let mut distances=vec![u64::MAX;n];let mut parent=vec![usize::MAX;n];let mut heap=BinaryHeap::new();
        for &root in &roots {distances[root]=cost[root];heap.push(Reverse((cost[root],root)));}
        while let Some(Reverse((distance,cell)))=heap.pop(){if distances[cell]!=distance{continue;}
            for next in self.adjacent(cell){if !self.base[next]{continue;}let proposed=distance.saturating_add(cost[next]);
                if proposed<distances[next]{distances[next]=proposed;parent[next]=cell;heap.push(Reverse((proposed,next)));}
            }
        }
        let mut removed=BTreeSet::new();let mut traced=vec![false;n];let mut unreachable=0;
        for target in pockets.iter().chain(start_cells.iter()) {
            if distances[*target]==u64::MAX{unreachable+=1;continue;}let mut cell=*target;
            while !traced[cell]{traced[cell]=true;removed.extend(self.owners[cell].iter().copied());
                if parent[cell]==usize::MAX{break;}cell=parent[cell];
            }
        }
        let after:Vec<_>=(0..n).map(|i|self.base[i]&&self.owners[i].iter().all(|id|removed.contains(id))).collect();
        let remaining=self.components(&after).1.len();
        self.output=vec![removed.len()as f64,land_roots.len()as f64,pockets.len()as f64,remaining as f64,unreachable as f64,start_cells.len()as f64];
        self.output.extend(removed.into_iter().map(|id|id as f64));
        for cell in start_cells{self.output.extend([(cell as i32%self.width)as f64+0.5,(cell as i32/self.width)as f64+0.5]);}
        self.output.as_ptr()
    }
    pub fn length(&self)->usize{self.output.len()}
    fn ring(&self,site:Site)->Vec<usize>{
        (site.y-1..=site.y+site.h).flat_map(|y|(site.x-1..=site.x+site.w).filter_map(move|x|{
            (x>=0&&y>=0&&x<self.width&&y<self.height&&(x==site.x-1||x==site.x+site.w||y==site.y-1||y==site.y+site.h))
                .then_some((y*self.width+x)as usize)
        })).collect()
    }
    fn street_view(&self,targets:&BTreeSet<i64>,roads:&BTreeSet<usize>)->Vec<bool>{
        (0..self.open.len()).map(|i|self.open[i]||self.base[i]&&roads.contains(&i)
            &&self.owners[i].iter().all(|id|targets.contains(id)&&matches!(self.sites[id].kind,b::WALL|b::PALISADE))).collect()
    }
    /// Offline streets audit. Rings and existing roads are reservations: a
    /// building covering either is relocated rather than leaving a road gap.
    /// Output: blockers, blocked road cells, missing ring cells, unserved civic
    /// IDs; each section is prefixed by its length in the four-value header.
    pub fn street_audit(&mut self,targets:usize,roads:usize)->*const f64{
        self.reconcile();let n=self.open.len();
        let existing:BTreeSet<_>=self.input[targets..targets+roads].iter().map(|v|*v as usize).filter(|i|*i<n).collect();
        let targets_set=self.input[..targets].iter().map(|v|*v as i64).collect();
        let open=self.street_view(&targets_set,&existing);let labels=self.components(&open).0;
        let mut blockers=BTreeSet::new();let mut blocked=BTreeSet::new();let mut missing=BTreeSet::new();let mut unserved=Vec::new();
        for &cell in &existing{if !open[cell]||self.terrain[cell]&4==0{blocked.insert(cell);blockers.extend(self.owners[cell].iter().copied());}}
        for value in &self.input[..targets]{let id=*value as i64;let Some(&site)=self.sites.get(&id)else{continue;};
            if site.kind==b::PALACE{for cell in self.ring(site){
                if !existing.contains(&cell)||!open[cell]{missing.insert(cell);}
                if !open[cell]{blockers.extend(self.owners[cell].iter().copied());}
            }}
            if !matches!(site.kind,b::HOUSE|b::VILLAGE_TENT|b::WALL|b::PALISADE|b::TOWER|b::WOODEN_TOWER)
                &&!self.cells(site).into_iter().flat_map(|i|self.adjacent(i)).any(|i|open[i]&&existing.contains(&i)){unserved.push(id);}
        }
        let road_open:Vec<_>=(0..n).map(|i|existing.contains(&i)&&open[i]&&self.terrain[i]&4!=0).collect();
        let road_regions=self.components(&road_open).1.len();
        let land_regions:BTreeSet<_>=existing.iter().filter(|i|road_open[**i]).map(|i|labels[*i]).collect();
        self.output=vec![blockers.len()as f64,blocked.len()as f64,missing.len()as f64,unserved.len()as f64,road_regions as f64,land_regions.len()as f64];
        self.output.extend(blockers.into_iter().map(|i|i as f64));self.output.extend(blocked.into_iter().map(|i|i as f64));
        self.output.extend(missing.into_iter().map(|i|i as f64));self.output.extend(unserved.into_iter().map(|i|i as f64));self.output.as_ptr()
    }
    /// Nearby relocation choices preserve every existing road and town ring.
    /// The host uses normal footprint/resource checks before committing a move.
    pub fn street_sites(&mut self,id:i64,roads:usize)->*const f64{
        self.reconcile();let Some(&site)=self.sites.get(&id)else{self.output=vec![0.0];return self.output.as_ptr();};
        let mut reserved:BTreeSet<usize>=self.input[..roads].iter().map(|v|*v as usize).collect();
        for &s in self.sites.values(){if s.kind==b::PALACE{reserved.extend(self.ring(s));}}
        let sharing:Vec<_>=self.sites.iter().filter(|&(&other,&s)|other==id||s.x==site.x&&s.y==site.y
            &&matches!((site.kind,s.kind),(b::HOUSE,b::WELL)|(b::WELL,b::HOUSE))).map(|(&id,&s)|(id,s)).collect();
        for &(id,_) in &sharing{self.sites.remove(&id);}self.dirty=true;self.reconcile();
        let mut candidates=Vec::new();
        for dy in -12_i32..=12{for dx in -12_i32..=12{if dx==0&&dy==0{continue;}
            let(x,y)=(site.x+dx,site.y+dy);if x<1||y<1||x+site.w>=self.width||y+site.h>=self.height{continue;}
            let next=Site{x,y,..site};let cells=self.cells(next);
            if cells.iter().any(|i|!self.open[*i]||self.terrain[*i]&4==0||reserved.contains(i)){continue;}
            if !self.placement(site.kind,x,y,site.w,site.h){continue;}
            candidates.push((dx*dx+dy*dy,y,x));
        }}
        candidates.sort();self.output=vec![candidates.len().min(192)as f64];
        for &(_,y,x) in candidates.iter().take(192){self.output.extend([x as f64,y as f64]);}
        for (id,s) in sharing{self.sites.insert(id,s);}self.dirty=true;self.output.as_ptr()
    }
    /// Connect real building entrances to existing streets through the shared
    /// walking graph. Input: target building IDs, then existing road cell IDs.
    /// Parent-first output lets normal road purchases extend the network.
    pub fn roads(&mut self,targets:usize,roads:usize)->*const f64{
        self.reconcile();let n=self.open.len();let mut distance=vec![u64::MAX;n];let mut parent=vec![usize::MAX;n];
        let raw_roads:BTreeSet<_>=self.input[targets..targets+roads].iter().map(|v|*v as usize).filter(|i|*i<n).collect();
        let targets_set=self.input[..targets].iter().map(|v|*v as i64).collect();
        let open=self.street_view(&targets_set,&raw_roads);let labels=self.components(&open).0;
        let existing:BTreeSet<_>=raw_roads.into_iter().filter(|i|open[*i]&&self.terrain[*i]&4!=0).collect();
        let mut network=vec![false;n];let mut roots=BTreeMap::new();let mut goals=BTreeSet::new();
        // One root per walking component, rather than every disconnected road
        // fragment being treated as an already-connected source.
        for &cell in &existing{roots.entry(labels[cell]).or_insert(cell);goals.insert(cell);}
        let mut target_sites=Vec::new();
        for value in &self.input[..targets]{if let Some(&site)=self.sites.get(&(*value as i64)){
            if site.kind==b::PALACE{for cell in self.ring(site){if open[cell]&&self.terrain[cell]&4!=0{
                roots.entry(labels[cell]).or_insert(cell);goals.insert(cell);
            }}}
            target_sites.push(site);
        }}
        for &site in &target_sites{if let Some(cell)=self.cells(site).into_iter().flat_map(|i|self.adjacent(i)).find(|i|open[*i]&&self.terrain[*i]&4!=0){
            roots.entry(labels[cell]).or_insert(cell);
        }}
        let mut heap=BinaryHeap::new();
        for &root in roots.values(){network[root]=true;distance[root]=0;heap.push(Reverse((0_u64,root)));}
        while let Some(Reverse((cost,cell)))=heap.pop(){if distance[cell]!=cost{continue;}
            for next in self.adjacent(cell){if !open[next]||self.terrain[next]&4==0{continue;}
                let next_cost=cost+if existing.contains(&next){1}else{6};
                if next_cost<distance[next]{distance[next]=next_cost;parent[next]=cell;heap.push(Reverse((next_cost,next)));}
            }
        }
        for site in target_sites{
            if self.cells(site).into_iter().flat_map(|i|self.adjacent(i)).any(|i|open[i]&&existing.contains(&i)){continue;}
            let edge=self.cells(site).into_iter().flat_map(|i|self.adjacent(i)).filter(|i|open[*i]&&distance[*i]!=u64::MAX)
                .min_by_key(|i|(distance[*i],*i));
            if let Some(cell)=edge{goals.insert(cell);}
        }
        let mut orders:Vec<_>=roots.values().copied().filter(|cell|!existing.contains(cell)).collect();
        // Trace near goals first, retaining shared trunks and parent-first
        // purchase order without rebuilding the native search for each street.
        let mut goals:Vec<_>=goals.into_iter().collect();goals.sort_by_key(|i|(distance[*i],*i));
        for mut cell in goals{let mut branch=Vec::new();
            while !network[cell]&&parent[cell]!=usize::MAX{branch.push(cell);cell=parent[cell];}
            for cell in branch.into_iter().rev(){network[cell]=true;if !existing.contains(&cell){orders.push(cell);}}
        }
        self.output=vec![orders.len()as f64];self.output.extend(orders.into_iter().map(|i|i as f64));self.output.as_ptr()
    }
}
