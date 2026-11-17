//! Hidden renewable fish stocks and dock/post operated voyages in the Bevy World.
//! Geometry is revisioned; shared home flood fields are filled under a frame
//! budget. Stock, service and dispatch clocks run at one-second resolution.
use bevy_ecs::prelude::*;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::Arc;

const STOCK: f64 = 160.0;
const CATCH: f64 = 20.0;
const WHALE_GOLD: f64 = 250.0;
const RANGE: u16 = 48;
const WHALING_RANGE: u16 = 300;
const WHALE_COAST_BUFFER: u8 = 10;
const SITE_STRIDE: usize = 11;
const BOAT_STRIDE: usize = 18;
pub fn constant(i: u32) -> f64 { match i { 0 => CATCH, 1 => STOCK, 2 => WHALE_GOLD, 3 => 60.0, 4 => 1.05, 5 => 300.0, 6 => 400.0, 7 => WHALING_RANGE as f64, _ => 0.0 } }
pub fn speed(until: f64, now: f64, value: f64) -> f64 { value * if now < until { 1.05 } else { 1.0 } }
#[derive(Component, Clone)]
struct Fishery { id: i64, cells: Arc<[usize]>, stock: f64, capacity: f64, collapsed: bool }
#[derive(Component, Clone)]
struct Whale { id: i64, x: f64, y: f64, ready: f64 }
#[derive(Component, Clone)]
struct Vessel {
    id: i64, kind: u32, site: i64, city: i64, faction: i32, x: f64, y: f64,
    angle: f64, hp: f64, phase: u32, cargo: f64, until: f64,
    home: usize, target: i64, moving: bool, next_plan: f64, route: VecDeque<usize>,
}
#[derive(Clone)]
struct Site { id: i64, kind: u32, faction: i32, city: i64, ready: bool, tech: bool, home: (f64,f64), active: bool }
#[derive(Default)]
struct Field { previous: BTreeMap<usize,usize>, distance: BTreeMap<usize,u16>, queue: VecDeque<usize>, fish: BTreeMap<i64,(u16,usize)>, whales: BTreeMap<i64,(u16,usize)> }
#[derive(Resource, Default)]
pub struct Fisheries {
    input: Vec<f64>, output: Vec<f64>, width: usize, height: usize,
    edges: Vec<u8>, habitat: Vec<u8>, water: Vec<bool>, zone_at: Vec<i64>, whale_at: BTreeMap<usize,Vec<i64>>, zones: BTreeMap<i64,Entity>, whales: BTreeMap<i64,Entity>,
    boats: BTreeMap<i64,Entity>, sites: BTreeMap<i64,Site>, fields: BTreeMap<(usize,u32),Field>,
    replacements: BTreeMap<i64,f64>, buffs: BTreeMap<i32,f64>,
    blockers: BTreeMap<(i32,i32),Vec<[f64;5]>>, boat_buckets: BTreeMap<(i32,i32),Vec<usize>>, initialized: bool, next_tick: f64, geometry_output: bool,
    world_islands_applied: bool,
}
impl Fisheries {
    pub fn input(&mut self,n:usize)->*mut f64 { self.input.resize(n,0.0);self.input.as_mut_ptr() }
    pub fn len(&self)->usize {self.output.len()}
    fn cell(&self,x:f64,y:f64)->Option<usize>{let(x,y)=(x.floor()as i32,y.floor()as i32);if x<0||y<0||x>=self.width as i32||y>=self.height as i32{None}else{Some(y as usize*self.width+x as usize)}}
    fn point(&self,c:usize)->(f64,f64){((c%self.width)as f64+0.5,(c/self.width)as f64+0.5)}
    fn open(&self,c:usize)->bool {self.edges.get(c).copied().unwrap_or(0)!=0}
    fn neighbor(&self,c:usize,d:usize)->Option<usize>{
        if self.edges.get(c).copied().unwrap_or(0)&(1<<d)==0{return None;}
        let n=c as isize+[-(self.width as isize),1,self.width as isize,-1][d];
        (n>=0&&(n as usize)<self.edges.len()).then_some(n as usize)
    }
    fn pose(&self,x:f64,y:f64,a:f64,kind:u32)->bool {
        let half=if kind==0{0.98}else{1.48};let(c,s)=(a.cos(),a.sin());
        // Actual 1x2 / 1x3 rectangular footprint, not a point boat.
        for f in -4..=4 {for side in [-0.48,0.0,0.48] {
            let t=f as f64*half/4.0;
            if !self.cell(x+c*t-s*side,y+s*t+c*side).is_some_and(|cell|self.open(cell)){return false;}
        }}true
    }
    fn turnable(&self,c:usize,kind:u32)->bool {let(x,y)=self.point(c);(0..8).all(|i|self.pose(x,y,i as f64*std::f64::consts::FRAC_PI_4,kind))}
    fn field(&mut self,home:usize,kind:u32,budget:&mut usize){
        let range=if kind==1{WHALING_RANGE}else{RANGE};
        let key=(home,kind);let mut field=self.fields.remove(&key).unwrap_or_else(||{
            let mut f=Field::default();f.previous.insert(home,home);f.distance.insert(home,0);f.queue.push_back(home);f
        });
        while *budget>0 {let Some(c)=field.queue.pop_front()else{break;};*budget-=1;let dist=field.distance[&c];
            if dist>1{
                let zone=self.zone_at.get(c).copied().unwrap_or(-1);if zone>=0{field.fish.entry(zone).or_insert((dist,c));}
                if let Some(ids)=self.whale_at.get(&c){for id in ids{field.whales.entry(*id).or_insert((dist,c));}}
            }
            if dist>=range{continue;}
            for d in 0..4{let Some(n)=self.neighbor(c,d)else{continue;};if field.distance.contains_key(&n)||!self.turnable(n,kind){continue;}
                field.previous.insert(n,c);field.distance.insert(n,dist+1);field.queue.push_back(n);
            }
        }self.fields.insert(key,field);
    }
    fn path(&self,home:usize,kind:u32,end:usize,returning:bool)->VecDeque<usize>{
        let mut result=VecDeque::new();let Some(f)=self.fields.get(&(home,kind))else{return result;};if !f.previous.contains_key(&end){return result;}
        let mut c=end;while c!=home{result.push_back(c);c=f.previous[&c];}result.push_back(home);
        if !returning{result.make_contiguous().reverse();}result
    }
    fn index_boats(&mut self,boats:&[Vessel]) {
        self.boat_buckets.clear();for(i,b)in boats.iter().enumerate(){if b.hp>0.0{self.boat_buckets.entry(((b.x/8.0).floor()as i32,(b.y/8.0).floor()as i32)).or_default().push(i);}}
    }
    fn traffic(&self,x:f64,y:f64,a:f64,kind:u32,own:i64,boats:&[Vessel])->bool{
        let half=if kind==0{0.5}else{1.0};let radius=0.49;
        let intersects=|bx:f64,by:f64,ba:f64,bhalf:f64,br:f64| {
            if (x-bx).hypot(y-by)>half+bhalf+radius+br+0.15{return false;}
            for i in -2..=2{let t=half*i as f64/2.0;let(px,py)=(x+a.cos()*t,y+a.sin()*t);
                let u=((px-bx)*ba.cos()+(py-by)*ba.sin()).clamp(-bhalf,bhalf);
                if (px-bx-ba.cos()*u).hypot(py-by-ba.sin()*u)<radius+br+0.08{return true;}
            }false
        };
        let sector=((x/8.0).floor()as i32,(y/8.0).floor()as i32);
        for dy in -1..=1{for dx in -1..=1{
            if let Some(bucket)=self.boat_buckets.get(&(sector.0+dx,sector.1+dy)){
                if bucket.iter().filter_map(|i|boats.get(*i)).any(|b|b.id!=own&&b.hp>0.0&&intersects(b.x,b.y,b.angle,if b.kind==0{0.5}else{1.0},0.49)){return false;}
            }
            if let Some(bucket)=self.blockers.get(&(sector.0+dx,sector.1+dy)){
            if bucket.iter().any(|b|intersects(b[0],b[1],b[2],b[3],b[4])){return false;}
        }}}true
    }
    fn detour(&self,b:&Vessel,boats:&[Vessel],budget:&mut usize)->Option<VecDeque<usize>> {
        let start=self.cell(b.x,b.y)?;let targets:BTreeSet<usize>=b.route.iter().take(5).copied().filter(|c|*c!=start).collect();
        let mut queue=VecDeque::from([start]);let mut prev=BTreeMap::from([(start,start)]);let(sx,sy)=self.point(start);let mut work=0;
        while let Some(c)=queue.pop_front(){if *budget==0||work>=128{break;}*budget-=1;work+=1;
            if targets.contains(&c){let mut route=VecDeque::new();let mut p=c;while p!=start{route.push_front(p);p=prev[&p];}
                let offset=b.route.iter().position(|p|*p==c)?;route.extend(b.route.iter().skip(offset+1).copied());return Some(route);
            }
            for d in 0..4{let Some(p)=self.neighbor(c,d)else{continue;};if prev.contains_key(&p)||!self.turnable(p,b.kind){continue;}
                let(x,y)=self.point(p);if (x-sx).abs()>5.0||(y-sy).abs()>5.0{continue;}
                let angle=[-std::f64::consts::FRAC_PI_2,0.0,std::f64::consts::FRAC_PI_2,std::f64::consts::PI][d];
                if !self.traffic(x,y,angle,b.kind,b.id,boats){continue;}prev.insert(p,c);queue.push_back(p);
            }
        }None
    }
    pub fn placement(&self,x:f64,y:f64)->bool {
        (0..2).any(|i|[(x+i as f64+0.5,y-0.5),(x+i as f64+0.5,y+2.5),(x-0.5,y+i as f64+0.5),(x+2.5,y+i as f64+0.5)]
            .iter().any(|p|self.cell(p.0,p.1).is_some_and(|c|self.open(c))))
    }
}
/// Exact Schaefer logistic step with a frozen weak-depensation factor for
/// each <=1s interval. Recovery slows at low abundance; no negative biomass.
/// FAO a0212e14; "Allee effects and the Allee-effect zone in northwest Atlantic cod" (PMC8807053).
fn recover(z:&mut Fishery,dt:f64){
    if z.collapsed||z.stock<=0.0 {z.stock=0.0;z.collapsed=true;return;}
    let rate=0.065*z.stock/(z.stock+0.15*z.capacity);
    let e=(-rate*dt).exp();z.stock=z.capacity/(1.0+(z.capacity/z.stock-1.0)*e);
}
/// A capped, eight-neighbor distance transform of the terrain, independent of
/// navigation blockers. Treat every non-ocean tile as shore so islands, diagonal
/// coasts and river mouths all retain the buffer. The square buffer is
/// conservative for Euclidean distance and is built only during generation.
fn whale_ocean_clearance(n: &Fisheries) -> Vec<u8> {
    let mut distance: Vec<u8> = n.habitat.iter()
        .map(|habitat| if *habitat == 2 { WHALE_COAST_BUFFER } else { 0 }).collect();
    for y in 0..n.height {
        for x in 0..n.width {
            let cell = y * n.width + x;
            if x > 0 { distance[cell] = distance[cell].min(distance[cell - 1] + 1); }
            if y > 0 {
                for nx in x.saturating_sub(1)..=(x + 1).min(n.width - 1) {
                    distance[cell] = distance[cell].min(distance[(y - 1) * n.width + nx] + 1);
                }
            }
        }
    }
    for y in (0..n.height).rev() {
        for x in (0..n.width).rev() {
            let cell = y * n.width + x;
            if x + 1 < n.width { distance[cell] = distance[cell].min(distance[cell + 1] + 1); }
            if y + 1 < n.height {
                for nx in x.saturating_sub(1)..=(x + 1).min(n.width - 1) {
                    distance[cell] = distance[cell].min(distance[(y + 1) * n.width + nx] + 1);
                }
            }
        }
    }
    distance
}
fn generate(world:&mut World,n:&mut Fisheries,seed:u32){
    let whale_clearance = whale_ocean_clearance(n);
    let large_water = crate::ore::large_water_bodies(n.width, n.height, &n.water);
    let mut visited=vec![false;n.edges.len()];let mut groups=BTreeMap::<(usize,usize,usize),Vec<usize>>::new();let mut component=0;
    for start in 0..n.edges.len(){if visited[start]||!n.open(start){continue;}let mut queue=VecDeque::from([start]);visited[start]=true;
        while let Some(c)=queue.pop_front(){if n.habitat[c]>0 && large_water[c] {groups.entry((component,c%n.width/12,c/n.width/12)).or_default().push(c);}
            for d in 0..4{if let Some(next)=n.neighbor(c,d){if !visited[next]{visited[next]=true;queue.push_back(next);}}}
        }component+=1;
    }
    // Eligible water bodies split by district boundaries still receive a stock.
    let represented:BTreeSet<usize>=groups.iter().filter(|(_,cells)|cells.len()>=12).map(|(key,_)|key.0).collect();
    let mut small=BTreeMap::<usize,Vec<usize>>::new();
    for (key,cells) in &groups{if !represented.contains(&key.0){small.entry(key.0).or_default().extend(cells);}}
    groups.retain(|_,cells|cells.len()>=12);
    for (component,cells) in small{groups.insert((component,usize::MAX,usize::MAX),cells);}
    for (i,(_,cells)) in groups.into_iter().enumerate(){
        let id=i as i64+1;let mut whale_candidates=Vec::new();
        for &c in &cells{if whale_clearance[c]<WHALE_COAST_BUFFER{continue;}let(x,y)=n.point(c);
            // All four cells must be ocean and at least ten tiles offshore.
            if [(0.0,0.0),(1.0,0.0),(0.0,1.0),(1.0,1.0)].iter().all(|(dx,dy)|n.cell(x+dx,y+dy).is_some_and(|p|n.open(p)&&whale_clearance[p]>=WHALE_COAST_BUFFER)){whale_candidates.push(c);}
        }
        let score=(id as u32).wrapping_mul(2654435761)^seed;
        if !whale_candidates.is_empty()&&score%4==0 {
            let c=whale_candidates[(score as usize/4)%whale_candidates.len()];let(x,y)=n.point(c);
            let e=world.spawn(Whale{id,x:x+0.5,y:y+0.5,ready:0.0}).id();n.whales.insert(id,e);
        }
        let e=world.spawn(Fishery{id,cells:cells.into(),stock:STOCK,capacity:STOCK,collapsed:false}).id();n.zones.insert(id,e);
    }n.initialized=true;n.geometry_output=true;
}
fn index_resources(world:&World,n:&mut Fisheries){
    n.zone_at=vec![-1;n.edges.len()];n.whale_at.clear();
    for e in n.zones.values(){if let Some(z)=world.get::<Fishery>(*e){for &c in z.cells.iter(){if c<n.zone_at.len(){n.zone_at[c]=z.id;}}}}
    for e in n.whales.values(){if let Some(w)=world.get::<Whale>(*e){for dy in -2..=2{for dx in -2..=2{
        if let Some(c)=n.cell(w.x+dx as f64,w.y+dy as f64){n.whale_at.entry(c).or_default().push(w.id);}
    }}}}
}
pub fn commit(world:&mut World,mode:u32,count:usize,width:usize,height:usize,seed:u32,now:f64){
    world.resource_scope(|world,mut n:Mut<Fisheries>|{match mode {
        0=>{n.width=width;n.height=height;n.edges=n.input[..count].iter().map(|v|*v as u8).collect();n.habitat=n.input[count..count*2].iter().map(|v|*v as u8).collect();n.water=n.input[count*2..count*3].iter().map(|v|*v!=0.0).collect();n.fields.clear();if !n.initialized{generate(world,&mut n,seed);n.next_tick=now+1.0;}index_resources(world,&mut n);},
        1=>{let mut sites=BTreeMap::new();for r in n.input[..count*SITE_STRIDE].chunks_exact(SITE_STRIDE){let s=Site{id:r[0]as i64,kind:r[1]as u32,faction:r[2]as i32,city:r[3]as i64,ready:r[6]!=0.0,tech:r[7]!=0.0,home:(r[8],r[9]),active:r[10]!=0.0};sites.insert(s.id,s);}n.sites=sites;},
        2=>{restore(world,&mut n);},
        3=>{n.blockers.clear();let input=n.input[..count*5].to_vec();for r in input.chunks_exact(5){n.blockers.entry(((r[0]/8.0).floor()as i32,(r[1]/8.0).floor()as i32)).or_default().push([r[0],r[1],r[2],r[3],r[4]]);}},
        4=>{for r in n.input[..count*2].chunks_exact(2){if let Some(e)=n.boats.get(&(r[0]as i64)){if let Some(mut b)=world.get_mut::<Vessel>(*e){b.hp=r[1];}}}},
        5=>{
            if n.initialized && !n.world_islands_applied {
                // Feature kind is transported with geometry; native policy
                // gives coral atolls rich stock and volcanic shores medium stock.
                let islands:Vec<([f64;4],usize)>=n.input.chunks_exact(5).take(count).filter_map(|r| {
                    let multiplier=match r[4] {0.0=>4,4.0=>2,_=>return None};
                    Some(([r[0],r[1],r[2],r[3]],multiplier))
                }).collect();
                // A district takes only its highest applicable density, even
                // when different island annuli overlap the same original stock.
                refine_island_zones(world,&mut n,&islands);
                n.world_islands_applied=true;
            }
        },
        _=>{},
    }});
}
fn restore(world:&mut World,n:&mut Fisheries){
    for e in n.zones.values().chain(n.whales.values()).chain(n.boats.values()){world.despawn(*e);}
    n.zones.clear();n.whales.clear();n.boats.clear();n.buffs.clear();n.replacements.clear();n.fields.clear();
    let r=n.input.clone();if r.len()<8{return;}
    let(zones,boats,whales,buffs,replacements)=(r[1]as usize,r[2]as usize,r[3]as usize,r[5]as usize,r[6]as usize);n.next_tick=r[7];let mut p=8;
    for _ in 0..zones{let id=r[p]as i64;let length=r[p+4]as usize;let z=Fishery{id,stock:r[p+1],capacity:r[p+2],collapsed:r[p+3]!=0.0,cells:r[p+5..p+5+length].iter().map(|v|*v as usize).collect::<Vec<_>>().into()};p+=5+length;let e=world.spawn(z).id();n.zones.insert(id,e);}
    for _ in 0..whales{let id=r[p]as i64;let e=world.spawn(Whale{id,x:r[p+1],y:r[p+2],ready:r[p+3]}).id();n.whales.insert(id,e);p+=4;}
    for _ in 0..boats{let b=&r[p..p+BOAT_STRIDE];let id=b[0]as i64;let length=b[17]as usize;
        let v=Vessel{id,kind:b[1]as u32,site:b[2]as i64,city:b[3]as i64,faction:b[4]as i32,x:b[5],y:b[6],angle:b[7],hp:b[8],phase:b[9]as u32,cargo:b[10],until:b[11],home:b[12]as usize,target:b[13]as i64,moving:false,next_plan:b[15],route:r[p+BOAT_STRIDE..p+BOAT_STRIDE+length].iter().map(|v|*v as usize).collect()};
        p+=BOAT_STRIDE+length;let e=world.spawn(v).id();n.boats.insert(id,e);
    }
    for _ in 0..buffs{n.buffs.insert(r[p]as i32,r[p+1]);p+=2;}
    for _ in 0..replacements{n.replacements.insert(r[p]as i64,r[p+1]);p+=2;}
    n.initialized=true;n.world_islands_applied=true;n.geometry_output=true;index_resources(world,n);
}
fn maintain(world:&mut World,n:&mut Fisheries,now:f64,boats:&mut Vec<Vessel>){
    boats.retain(|b|{let valid=b.hp>0.0&&n.sites.get(&b.site).is_some_and(|s|s.ready&&s.active&&s.faction==b.faction&&s.city>=0);
        if !valid{if b.hp<=0.0{n.replacements.insert(b.site,now+30.0);}if let Some(e)=n.boats.remove(&b.id){world.despawn(e);}}valid});
    n.index_boats(boats);
    let existing:BTreeSet<i64>=boats.iter().map(|b|b.site).collect();
    for site in n.sites.values(){if !site.ready||!site.tech||!site.active||site.city<0||existing.contains(&site.id)||n.replacements.get(&site.id).is_some_and(|t|now<*t){continue;}
        let mut home=None;
        'search:for radius in 0_i32..=6{for dy in -radius..=radius{for dx in -radius..=radius{
            if dx.abs()!=radius&&dy.abs()!=radius{continue;}let(x,y)=(site.home.0+dx as f64,site.home.1+dy as f64);let Some(c)=n.cell(x,y)else{continue;};
            if !n.turnable(c,site.kind)||!n.traffic(x,y,-std::f64::consts::FRAC_PI_2,site.kind,-1,boats){continue;}
            // A vessel must launch in the water component touching this shore.
            let Some(shore)=n.cell(site.home.0,site.home.1)else{continue;};
            let mut seen=BTreeSet::from([shore]);let mut queue=VecDeque::from([shore]);let mut connected=false;
            while let Some(p)=queue.pop_front(){if p==c{connected=true;break;}if seen.len()>180{break;}for d in 0..4{if let Some(q)=n.neighbor(p,d){if seen.insert(q){queue.push_back(q);}}}}
            if connected{home=Some(c);break 'search;}
        }}}
        if let Some(home)=home{let(x,y)=n.point(home);let id=-(site.id+1);let b=Vessel{id,kind:site.kind,site:site.id,city:site.city,faction:site.faction,x,y,angle:-std::f64::consts::FRAC_PI_2,hp:if site.kind==0{80.0}else{150.0},phase:0,cargo:0.0,until:now,home,target:-1,moving:false,next_plan:now,route:VecDeque::new()};let e=world.spawn(b.clone()).id();n.boats.insert(id,e);boats.push(b);n.boat_buckets.entry(((x/8.0).floor()as i32,(y/8.0).floor()as i32)).or_default().push(boats.len()-1);}
    }
    for b in boats{if let Some(s)=n.sites.get(&b.site){b.city=s.city;}}
}
fn choose(n:&Fisheries,b:&Vessel,zones:&[Fishery],zone_index:&BTreeMap<i64,usize>,whales:&[Whale],whale_index:&BTreeMap<i64,usize>,now:f64)->Option<(i64,usize)>{
    let field=n.fields.get(&(b.home,b.kind))?;if !field.queue.is_empty(){return None;}
    let candidates=if b.kind==0{&field.fish}else{&field.whales};
    candidates.iter().filter(|(id,_)|if b.kind==0{
        zone_index.get(id).is_some_and(|i|!zones[*i].collapsed&&zones[*i].stock>0.0)
    }else{whale_index.get(id).is_some_and(|i|now>=whales[*i].ready)})
        .min_by_key(|(id,(distance,cell))|(*distance,**id,*cell)).map(|(id,(_,cell))|(*id,*cell))
}

fn publish(n:&mut Fisheries,zones:&[Fishery],whales:&[Whale],boats:&[Vessel],events:&[[f64;5]])->*const f64{
    n.output.clear();n.output.extend_from_slice(&[0.0,zones.len()as f64,boats.len()as f64,whales.len()as f64,events.len()as f64,n.buffs.len()as f64,n.replacements.len()as f64,n.next_tick]);
    for z in zones{n.output.extend_from_slice(&[z.id as f64,z.stock,z.capacity,z.collapsed as u8 as f64,if n.geometry_output{z.cells.len()as f64}else{0.0}]);if n.geometry_output{n.output.extend(z.cells.iter().map(|c|*c as f64));}}
    for w in whales{n.output.extend_from_slice(&[w.id as f64,w.x,w.y,w.ready]);}
    for b in boats{n.output.extend_from_slice(&[b.id as f64,b.kind as f64,b.site as f64,b.city as f64,b.faction as f64,b.x,b.y,b.angle,b.hp,b.phase as f64,b.cargo,b.until,b.home as f64,b.target as f64,b.moving as u8 as f64,b.next_plan,0.0,b.route.len()as f64]);n.output.extend(b.route.iter().map(|c|*c as f64));}
    for(f,t)in &n.buffs{n.output.extend_from_slice(&[*f as f64,*t]);}
    for(id,t)in &n.replacements{n.output.extend_from_slice(&[*id as f64,*t]);}
    for event in events{n.output.extend_from_slice(event);}n.output[0]=n.output.len()as f64;n.geometry_output=false;n.output.as_ptr()
}
pub fn step(world:&mut World,now:f64,dt:f64)->*const f64{
    world.resource_scope(|world,mut n:Mut<Fisheries>|{
        let mut zones:Vec<Fishery>=n.zones.values().filter_map(|e|world.get::<Fishery>(*e).cloned()).collect();
        let mut whales:Vec<Whale>=n.whales.values().filter_map(|e|world.get::<Whale>(*e).cloned()).collect();
        let mut boats:Vec<Vessel>=n.boats.values().filter_map(|e|world.get::<Vessel>(*e).cloned()).collect();let mut events=Vec::new();n.index_boats(&boats);
        let zone_index:BTreeMap<_,_>=zones.iter().enumerate().map(|(i,z)|(z.id,i)).collect();
        let whale_index:BTreeMap<_,_>=whales.iter().enumerate().map(|(i,w)|(w.id,i)).collect();
        if dt>0.0 {
            let mut clock=now-dt;let mut budget=4096;
            while clock<now-0.000001 {
                let elapsed=(now-clock).min(0.1);clock+=elapsed;
                if clock+0.000001>=n.next_tick {
                    for z in &mut zones{recover(z,1.0);}n.next_tick+=1.0;
                    maintain(world,&mut n,clock,&mut boats);
                }
                // Shared fields retain partially filled queues, so large oceans
                // never cause an unbounded flood fill on a dispatch frame.
                let keys:BTreeSet<_>=boats.iter().map(|b|(b.home,b.kind)).collect();for(home,kind)in keys{n.field(home,kind,&mut budget);}
                for i in 0..boats.len(){let mut b=boats[i].clone();b.moving=false;if b.hp<=0.0{boats[i].moving=false;continue;}
                    if b.phase==0&&clock>=b.next_plan&&n.sites.get(&b.site).is_some_and(|s|s.tech){
                        b.next_plan=clock+1.0;if let Some((target,end))=choose(&n,&b,&zones,&zone_index,&whales,&whale_index,clock){b.target=target;b.route=n.path(b.home,b.kind,end,false);b.phase=1;}
                    }
                    if matches!(b.phase,1|3){
                        if let Some(&goal)=b.route.front(){let(gx,gy)=n.point(goal);let gap=(gx-b.x).hypot(gy-b.y);
                            if gap<0.025{b.x=gx;b.y=gy;b.route.pop_front();}
                            else{let desired=(gy-b.y).atan2(gx-b.x);let delta=(desired-b.angle).sin().atan2((desired-b.angle).cos());let a=b.angle+delta.clamp(-1.6*elapsed,1.6*elapsed);
                                if n.pose(b.x,b.y,a,b.kind)&&n.traffic(b.x,b.y,a,b.kind,b.id,&boats){b.angle=a;}
                                else if clock>=b.next_plan{b.next_plan=clock+1.0;if let Some(route)=n.detour(&b,&boats,&mut budget){b.route=route;}}
                                if delta.abs()<0.06{let top=speed(*n.buffs.get(&b.faction).unwrap_or(&0.0),clock,if b.kind==0{3.3}else{2.7});let step=(top*elapsed).min(gap);let(x,y)=(b.x+(gx-b.x)/gap*step,b.y+(gy-b.y)/gap*step);
                                    let edge_ok=n.cell(b.x,b.y).zip(n.cell(x,y)).is_some_and(|(a,c)|a==c||(0..4).any(|d|n.neighbor(a,d)==Some(c)));
                                    if edge_ok&&n.pose(x,y,b.angle,b.kind)&&n.traffic(x,y,b.angle,b.kind,b.id,&boats){b.x=x;b.y=y;b.moving=true;}
                                    else if clock>=b.next_plan{b.next_plan=clock+1.0;if let Some(route)=n.detour(&b,&boats,&mut budget){b.route=route;}}
                                }
                            }
                        }else if b.phase==3&&(n.point(b.home).0-b.x).hypot(n.point(b.home).1-b.y)>0.05{
                            if clock>=b.next_plan{b.next_plan=clock+1.0;if let Some(c)=n.cell(b.x,b.y){b.route=n.path(b.home,b.kind,c,true);}}
                        }else{b.phase=if b.phase==1{2}else{4};b.until=clock+if b.phase==2{if b.kind==0{6.0}else{8.0}}else{3.0};}
                    }
                    if b.phase==2&&clock>=b.until{
                        if b.kind==0{if let Some(z)=zone_index.get(&b.target).and_then(|i|zones.get_mut(*i)){if !z.collapsed{b.cargo=CATCH.min(z.stock);z.stock=(z.stock-b.cargo).max(0.0);if z.stock<=0.000001{z.stock=0.0;z.collapsed=true;}}}}
                        else if let Some(w)=whale_index.get(&b.target).and_then(|i|whales.get_mut(*i)){if clock>=w.ready{b.cargo=WHALE_GOLD;w.ready=clock+15.0;}}
                        if let Some(c)=n.cell(b.x,b.y){b.route=n.path(b.home,b.kind,c,true);}b.phase=3;
                    }
                    if b.phase==4&&clock>=b.until {
                        if b.cargo>0.0&&n.sites.get(&b.site).is_some_and(|s|s.ready&&s.active&&s.faction==b.faction&&s.city==b.city){
                            events.push([b.city as f64,b.faction as f64,b.kind as f64,b.cargo,clock]);
                            if b.kind==1{n.buffs.insert(b.faction,clock+60.0);}
                        }b.cargo=0.0;b.phase=0;b.next_plan=clock+1.0;
                    }
                    let old=((boats[i].x/8.0).floor()as i32,(boats[i].y/8.0).floor()as i32);let new=((b.x/8.0).floor()as i32,(b.y/8.0).floor()as i32);
                    if old!=new{if let Some(bucket)=n.boat_buckets.get_mut(&old){bucket.retain(|j|*j!=i);}n.boat_buckets.entry(new).or_default().push(i);}
                    boats[i]=b;
                }
            }
        }
        for z in &zones{if let Some(e)=n.zones.get(&z.id){world.entity_mut(*e).insert(z.clone());}}
        for w in &whales{if let Some(e)=n.whales.get(&w.id){world.entity_mut(*e).insert(w.clone());}}
        for b in &boats{if let Some(e)=n.boats.get(&b.id){world.entity_mut(*e).insert(b.clone());}}
        publish(&mut n,&zones,&whales,&boats,&events)
    })
}

pub fn push(world:&mut World,id:i64,x:f64,y:f64){
    world.resource_scope(|world,n:Mut<Fisheries>|{
        if let Some(e)=n.boats.get(&id){if let Some(mut b)=world.get_mut::<Vessel>(*e){b.x=x;b.y=y;b.route.clear();b.phase=3;b.next_plan=0.0;}}
    });
}

/// Offline authoring only: split ordinary water districts around an atoll.
/// Returns the number of original districts refined. Each replacement owns a
/// disjoint spatial partition and normal stock.
pub fn atoll_fisheries(world: &mut World, cx: f64, cy: f64, rx: f64, ry: f64, multiplier: u32) -> u32 {
    world.resource_scope(|world, mut n: Mut<Fisheries>|
        refine_island_zones(world,&mut n,&[([cx,cy,rx,ry],multiplier as usize)]))
}

fn refine_island_zones(world: &mut World, n: &mut Fisheries, islands: &[([f64;4],usize)]) -> u32 {
    if !n.initialized || n.width == 0 { return 0; }
    let islands:Vec<_>=islands.iter().filter(|(r,multiplier)|
        r.iter().all(|value|value.is_finite())&&r[2]>0.0&&r[3]>0.0&&(2..=8).contains(multiplier)).collect();
    if islands.is_empty() { return 0; }
    // Snapshot original districts before replacing any. Each disjoint replacement
    // has ordinary capacity, so splitting doubles/quadruples the stock per area.
    let selected: Vec<(Fishery,usize)> = n.zones.values().filter_map(|entity| world.get::<Fishery>(*entity))
        .filter(|zone|zone.cells.len()>=12).filter_map(|zone| {
            let multiplier=islands.iter().filter(|(r,_)|zone.cells.iter().any(|&cell| {
                let (x,y)=n.point(cell);
                let radius_squared=((x-r[0])/r[2]).powi(2)+((y-r[1])/r[3]).powi(2);
                (1.05_f64.powi(2)..=1.8_f64.powi(2)).contains(&radius_squared)
            })).map(|(_,multiplier)|*multiplier).max()?;
            Some((zone.clone(),multiplier))
        }).collect();
    let mut next_id = n.zones.keys().chain(n.whales.keys()).copied().max().unwrap_or(0) + 1;
    let mut refined = 0;
    for (zone,multiplier) in selected {
        let mut partitions = Vec::with_capacity(multiplier);
        partition_fishery(zone.cells.to_vec(), n.width, multiplier, &mut partitions);
        let Some(entity) = n.zones.remove(&zone.id) else { continue; };
        world.despawn(entity);
        for cells in partitions {
            let id = next_id; next_id += 1;
            let entity = world.spawn(Fishery { id, cells: cells.into(), stock: STOCK, capacity: STOCK, collapsed: false }).id();
            n.zones.insert(id, entity);
        }
        refined += 1;
    }
    if refined > 0 {
        n.fields.clear();
        index_resources(world,n);
        n.geometry_output=true;
    }
    refined
}

/// Median cuts along the longest cell extent keep each partition compact and
/// its population within one cell of its peers, including partial shore zones.
fn partition_fishery(mut cells: Vec<usize>, width: usize, parts: usize, result: &mut Vec<Vec<usize>>) {
    if parts == 1 { result.push(cells); return; }
    let (mut x0, mut y0, mut x1, mut y1) = (usize::MAX, usize::MAX, 0, 0);
    for &cell in &cells {
        let (x, y) = (cell % width, cell / width);
        x0 = x0.min(x); y0 = y0.min(y); x1 = x1.max(x); y1 = y1.max(y);
    }
    if x1 - x0 >= y1 - y0 { cells.sort_unstable_by_key(|&cell| (cell % width, cell / width)); }
    else { cells.sort_unstable_by_key(|&cell| (cell / width, cell % width)); }
    let left_parts = parts / 2;
    let right = cells.split_off(cells.len() * left_parts / parts);
    partition_fishery(cells, width, left_parts, result);
    partition_fishery(right, width, parts - left_parts, result);
}

/// Offline curated starts get one reachable whale per whaling post. Selection
/// follows the same water graph and full turning footprint used by voyages;
/// no terrain or artificial ocean habitat is painted into the world.
pub fn scenario_whales(world:&mut World)->u32 {
    world.resource_scope(|world,mut n:Mut<Fisheries>|{
        let sites:Vec<_>=n.sites.values().filter(|s|s.kind==1&&s.ready&&s.tech).cloned().collect();
        let mut selected=Vec::new();
        for site in sites {
            let Some(shore)=n.cell(site.home.0,site.home.1)else{continue;};
            let mut seen=BTreeSet::from([shore]);let mut queue=VecDeque::from([(shore,0_u16)]);let mut candidates=Vec::new();
            while let Some((cell,distance))=queue.pop_front(){
                let(x,y)=n.point(cell);
                if distance>=8&&n.turnable(cell,1)&&selected.iter().all(|p:&(f64,f64)|(p.0-x).hypot(p.1-y)>=8.0) {
                    candidates.push(((distance as i32-18).abs(),cell));
                }
                if distance>=40{continue;}
                for d in 0..4 {if let Some(next)=n.neighbor(cell,d) {if seen.insert(next)&&(distance<3||n.turnable(next,1)) {queue.push_back((next,distance+1));}}}
            }
            candidates.sort();
            if let Some((_,cell))=candidates.first(){let(x,y)=n.point(*cell);selected.push((x,y));}
        }
        // Replacing the ordinary random whales keeps each tiny scenario's
        // resource markers legible and ensures both sides have their own.
        for(_,entity)in std::mem::take(&mut n.whales){world.despawn(entity);}
        for(i,(x,y))in selected.iter().copied().enumerate(){let id=i as i64+1;let entity=world.spawn(Whale{id,x,y,ready:0.0}).id();n.whales.insert(id,entity);}
        n.fields.clear();index_resources(world,&mut n);selected.len()as u32
    })
}
