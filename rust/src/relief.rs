//! Regional hill country and rocky mountain cores. Generation and terrain
//! policy live in a Bevy World; the host transports geology and mirrors rows.
use bevy_ecs::prelude::*;
use std::collections::VecDeque;
#[path = "relief_shapes.rs"]
mod shapes;

pub const STRIDE: usize = 8;
pub const WALK: u32 = 1;
pub const BUILD: u32 = 2;
pub const TREES: u32 = 4;
pub const MIN_HILL_CELLS: usize = 20;
pub const MIN_MOUNTAIN_CELLS: usize = 20;

pub fn policy(kind: u32) -> u32 { match kind { 1 => WALK | TREES, 2 => 0, _ => WALK | BUILD | TREES } }
/// Walls follow pathable ground, including hills; other buildings need a flat site.
/// Use the tile's effective flags so blocked foothills cannot regain permission.
pub fn construction_allowed(flags: u32, wall: bool) -> u32 {
    u32::from(flags & if wall { WALK } else { BUILD } != 0)
}
pub fn edge(mask: u32) -> u32 { u32::from(mask & 3 == 3 && (mask & 16 == 0 || mask & 12 == 12)) }
pub fn higher(source: u32, target: u32) -> u32 { u32::from(source > target) }

#[derive(Resource, Default)]
struct Input(Vec<f64>);
#[derive(Resource, Default)]
struct Generated(Vec<f64>);
#[derive(Resource)]
struct Settings {
    width: usize, height: usize, seed: u32, coverage: f64, mountains: f64,
    hill_size: f64, clustering: f64, spacing: f64, clumps: f64, strings: f64,
    length_min: f64, length_max: f64, breadth: f64, bend: f64,
}
impl Default for Settings {
    fn default() -> Self { Self { width: 0, height: 0, seed: 0, coverage: 0.09, mountains: 0.30, hill_size: 1.0, clustering: 0.85, spacing: 1.0, clumps: 0.27, strings: 0.21, length_min: 20.0, length_max: 56.0, breadth: 4.3, bend: 0.6 } }
}
fn hash(seed: u32, x: i32, y: i32) -> f64 {
    let mut n = seed ^ (x as u32).wrapping_mul(0x1f123bb5) ^ (y as u32).wrapping_mul(0x5f356495);
    n = (n ^ (n >> 16)).wrapping_mul(0x7feb352d); n = (n ^ (n >> 15)).wrapping_mul(0x846ca68b);
    ((n ^ (n >> 16)) as f64) / 4294967296.0
}
fn smooth(v: f64) -> f64 { let v = v.clamp(0.0,1.0); v * v * (3.0 - 2.0 * v) }
fn noise(seed: u32, x: f64, y: f64) -> f64 {
    let ix = x.floor() as i32; let iy = y.floor() as i32; let u = smooth(x - x.floor()); let v = smooth(y - y.floor());
    let a = hash(seed,ix,iy) * (1.0-u) + hash(seed,ix+1,iy)*u;
    let b = hash(seed,ix,iy+1) * (1.0-u) + hash(seed,ix+1,iy+1)*u;
    a*(1.0-v)+b*v
}
fn neighbors(cell: usize, width: usize, height: usize, mut visit: impl FnMut(usize)) {
    let x=cell%width; let y=cell/width;
    if x>0 { visit(cell-1); } if x+1<width { visit(cell+1); }
    if y>0 { visit(cell-width); } if y+1<height { visit(cell+width); }
}
/// Remove isolated rocky obstacles independently of their surrounding hill region.
/// The same native rule also cleans the offline scenario artifacts.
fn prune_small_mountains(kind: &mut [u8], width: usize, height: usize) -> Vec<usize> {
    let mut seen = vec![false; kind.len()];
    let mut queue = VecDeque::new();
    let mut removed = Vec::new();
    for start in 0..kind.len() {
        if kind[start] != 2 || seen[start] { continue; }
        seen[start] = true; queue.push_back(start);
        let mut members = Vec::new();
        while let Some(cell) = queue.pop_front() {
            members.push(cell);
            neighbors(cell, width, height, |next| {
                if kind[next] == 2 && !seen[next] { seen[next] = true; queue.push_back(next); }
            });
        }
        if members.len() < MIN_MOUNTAIN_CELLS {
            for cell in members { kind[cell] = 0; removed.push(cell); }
        }
    }
    removed
}
fn segment(settings: &Settings, scores: &mut [f64], mountains: &mut [f64], a: [f64;2], b: [f64;2], radius: f64, strength: f64, rocky: bool) {
    let reach=radius*2.1; let dx=b[0]-a[0]; let dy=b[1]-a[1]; let length=(dx*dx+dy*dy).max(0.001);
    let x0=((a[0].min(b[0])-reach).floor() as isize).max(0) as usize;
    let y0=((a[1].min(b[1])-reach).floor() as isize).max(0) as usize;
    let x1=((a[0].max(b[0])+reach).ceil() as isize).clamp(0,settings.width as isize-1) as usize;
    let y1=((a[1].max(b[1])+reach).ceil() as isize).clamp(0,settings.height as isize-1) as usize;
    for y in y0..=y1 { for x in x0..=x1 {
        let t=(((x as f64-a[0])*dx+(y as f64-a[1])*dy)/length).clamp(0.0,1.0);
        let distance=(x as f64-a[0]-dx*t).hypot(y as f64-a[1]-dy*t);
        if distance>reach { continue; }
        let irregular=noise(settings.seed^0x71c2,x as f64/5.5,y as f64/5.5)-0.5;
        let cell=y*settings.width+x;
        scores[cell]=scores[cell].max((1.0-distance/reach)*(0.72+strength*0.38)+irregular*0.14);
        if rocky { mountains[cell]=mountains[cell].max((1.0-distance/(radius*1.15)).max(0.0)*(0.8+strength*0.25)+irregular*0.12); }
    }}
}
fn massif(settings: &Settings, scores: &mut [f64], mountains: &mut [f64], cx: f64, cy: f64, radius: f64, salt: i32) {
    for lobe in 0..3 {
        let angle=hash(settings.seed,salt,lobe)*std::f64::consts::TAU;
        let offset=if lobe==0 {0.0} else {radius*0.60};
        let center=[cx+angle.cos()*offset,cy+angle.sin()*offset];
        segment(settings,scores,mountains,center,[center[0]+0.01,center[1]],radius*(0.72+hash(settings.seed,salt+3,lobe)*0.35),0.8,true);
    }
}

fn generate(settings: Res<Settings>, input: Res<Input>, mut generated: ResMut<Generated>) {
    let s=&*settings; let n=s.width*s.height; let data=&input.0;
    generated.0.clear(); generated.0.resize(n*STRIDE,0.0);
    if n==0 || data.len()<3+n*8 { return; }
    let cells=&data[3..3+n*8]; let mut wet_distance=vec![u16::MAX;n]; let mut queue=VecDeque::new();
    let mut land=0;
    for cell in 0..n { if cells[cell*8+1]!=0.0 { wet_distance[cell]=0; queue.push_back(cell); } else { land+=1; } }
    while let Some(cell)=queue.pop_front() {
        let next_distance=wet_distance[cell].saturating_add(1);
        if next_distance>5 {continue;}
        neighbors(cell,s.width,s.height,|next| { if wet_distance[next]>next_distance {wet_distance[next]=next_distance;queue.push_back(next);} });
    }
    let eligible: Vec<bool>=(0..n).map(|cell| {
        let x=cell%s.width;let y=cell/s.width;
        cells[cell*8+1]==0.0 && cells[cell*8+5]==0.0 && wet_distance[cell]>=3 && x>=3 && y>=3 && x+3<s.width && y+3<s.height
    }).collect();
    let mut scores=vec![0.0;n]; let mut mountain_score=vec![0.0;n];
    for cell in 0..n {
        let x=(cell%s.width) as f64;let y=(cell/s.width) as f64;
        let broad=noise(s.seed^0x721a,x/(14.0*s.hill_size),y/(14.0*s.hill_size));
        let detail=noise(s.seed^0x31a1,x/(6.0*s.hill_size),y/(6.0*s.hill_size));
        scores[cell]=cells[cell*8]*0.24+broad*(0.25+s.clustering*0.18)+detail*0.055;
    }
    let mut offset=3+n*8;let ridge_count=data[1].max(0.0) as usize;
    for _ in 0..ridge_count {
        if offset+4>data.len(){break;}
        let rocky=data[offset]!=0.0;let width=data[offset+1];let prominence=data[offset+2];let count=data[offset+3].max(0.0) as usize;offset+=4;
        if offset+count*2>data.len(){break;}
        let points=&data[offset..offset+count*2];offset+=count*2;
        for i in 1..count { segment(s,&mut scores,&mut mountain_score,[points[(i-1)*2],points[(i-1)*2+1]],[points[i*2],points[i*2+1]],(width*0.55*s.breadth/4.2879).max(2.2),prominence,rocky); }
        if rocky&&count>2&&hash(s.seed,count as i32,offset as i32)<s.clumps {
            let mid=count/2;massif(s,&mut scores,&mut mountain_score,points[mid*2],points[mid*2+1],(width*s.breadth/4.2879).clamp(3.0,9.0),offset as i32);
        }
    }
    let provinces=data[2].max(0.0) as usize;
    for i in 0..provinces {
        if offset+6>data.len(){break;}
        let p=&data[offset..offset+6];offset+=6;let kind=p[0] as u32;let rx=p[3].max(1.0);let ry=p[4].max(1.0);let angle=p[5];
        let reach=rx.max(ry);let x0=((p[1]-reach).floor() as isize).max(0) as usize;let y0=((p[2]-reach).floor() as isize).max(0) as usize;
        let x1=((p[1]+reach).ceil() as isize).clamp(0,s.width as isize-1) as usize;let y1=((p[2]+reach).ceil() as isize).clamp(0,s.height as isize-1) as usize;
        for y in y0..=y1 {for x in x0..=x1 {
            let dx=x as f64-p[1];let dy=y as f64-p[2];let u=dx*angle.cos()+dy*angle.sin();let v=-dx*angle.sin()+dy*angle.cos();let radial=(u/rx).hypot(v/ry);
            if radial>1.0 {continue;}
            let patch=noise(s.seed.wrapping_add(i as u32*113),u/(10.0*s.hill_size),v/(10.0*s.hill_size));
            let strength=match kind {2=>0.78,5=>0.64,0=>if radial>0.6{0.48}else{0.16},_=>0.40};
            let cell=y*s.width+x;scores[cell]=scores[cell].max(strength+patch*0.30-radial*0.23);
        }}
    }
    // Compact maps have no geological ridge graph. Their native belts and
    // rounded massifs use the same seed, coverage budget, and water exclusions.
    if ridge_count==0 {
        let sites:Vec<usize>=(0..n).filter(|c|eligible[*c]).collect();
        let count=((land as f64*s.coverage/180.0).round() as usize).clamp(2,32);
        for i in 0..count {
            if sites.is_empty(){break;}
            let cell=sites[(hash(s.seed,i as i32,901)*sites.len() as f64) as usize % sites.len()];let cx=(cell%s.width) as f64;let cy=(cell/s.width) as f64;
            if hash(s.seed,i as i32,902)<s.clumps {massif(s,&mut scores,&mut mountain_score,cx,cy,3.0+s.breadth*0.6,i as i32);continue;}
            let angle=hash(s.seed,i as i32,903)*std::f64::consts::PI;
            let length=s.length_min*(s.length_max/s.length_min.max(1.0)).powf(hash(s.seed,i as i32,904));
            let mut previous=[cx-angle.cos()*length*0.5,cy-angle.sin()*length*0.5];
            for step in 1..=12 {
                let t=step as f64/12.0;let bend=(t*std::f64::consts::PI*1.8).sin()*s.bend*3.5;
                let point=[cx+angle.cos()*(t-0.5)*length-angle.sin()*bend,cy+angle.sin()*(t-0.5)*length+angle.cos()*bend];
                let rocky=hash(s.seed,i as i32,905)>s.strings||step%4!=0;
                segment(s,&mut scores,&mut mountain_score,previous,point,s.breadth*0.62,0.8,rocky);previous=point;
            }
        }
    }
    let mut ranked:Vec<usize>=(0..n).filter(|c|eligible[*c]).collect();
    ranked.sort_unstable_by(|a,b|scores[*b].total_cmp(&scores[*a]).then_with(||a.cmp(b)));
    let budget=((land as f64*s.coverage/s.spacing.sqrt()).round() as usize).min(ranked.len());
    let mut kind=vec![0u8;n];for &cell in ranked.iter().take(budget){kind[cell]=1;}
    let mut peaks:Vec<usize>=ranked.into_iter().take(budget).filter(|c|mountain_score[*c]>0.16).collect();
    peaks.sort_unstable_by(|a,b|mountain_score[*b].total_cmp(&mountain_score[*a]).then_with(||a.cmp(b)));
    let mut proposed=vec![false;n];for &cell in peaks.iter().take((budget as f64*s.mountains).round() as usize){proposed[cell]=true;}
    for &cell in &peaks {if proposed[cell]{let mut adjacent=0;neighbors(cell,s.width,s.height,|next|{adjacent+=u32::from(proposed[next]);});if adjacent>=2{kind[cell]=2;}}}
    prune_small_mountains(&mut kind, s.width, s.height);
    // IDs group related terrain for cached art, never create movement walls.
    let mut owner=vec![0u32;n];let mut id=0u32;
    for start in 0..n {
        if kind[start]==0||owner[start]!=0{continue;}id+=1;queue.clear();queue.push_back(start);owner[start]=id;let mut members=Vec::new();
        while let Some(cell)=queue.pop_front(){members.push(cell);neighbors(cell,s.width,s.height,|next|{if kind[next]!=0&&owner[next]==0{owner[next]=id;queue.push_back(next);}});}
        if members.len()<6 {for cell in members{kind[cell]=0;owner[cell]=0;}}
    }
    // Count hills independently: a few hill cells beside rocky terrain must
    // not survive merely because their combined relief region is large enough.
    // Keep surviving region IDs stable so their existing art style is retained.
    let mut seen_hills=vec![false;n];
    for start in 0..n {
        if kind[start]!=1||seen_hills[start]{continue;}
        queue.clear();queue.push_back(start);seen_hills[start]=true;
        let mut hills=Vec::new();
        while let Some(cell)=queue.pop_front(){
            hills.push(cell);
            neighbors(cell,s.width,s.height,|next|{
                if kind[next]==1&&!seen_hills[next]{seen_hills[next]=true;queue.push_back(next);}
            });
        }
        if hills.len()<MIN_HILL_CELLS {for cell in hills{kind[cell]=0;owner[cell]=0;}}
    }
    for cell in 0..n {
        let k=kind[cell] as u32;let x=(cell%s.width) as i32;let y=(cell/s.width) as i32;let at=cell*STRIDE;
        let rough=noise(s.seed^0x43fa,x as f64/4.0,y as f64/4.0);
        generated.0[at]=k as f64;generated.0[at+1]=owner[cell] as f64;generated.0[at+2]=if k==2{2.0}else if k==1{1.0}else{0.0};
        generated.0[at+3]=policy(k) as f64;generated.0[at+4]=if k==1{0.82}else if k==2{0.65}else{1.0};generated.0[at+5]=rough;
        generated.0[at+6]=if k==0{cells[cell*8]}else{cells[cell*8].max(if k==2{0.70+rough*0.15}else{0.40+rough*0.15})};
        generated.0[at+7]=(hash(s.seed,owner[cell] as i32,7)*3.0).floor();
    }
}

pub struct Relief { world: World, schedule: Schedule }
impl Default for Relief {
    fn default()->Self{let mut world=World::new();world.init_resource::<Input>();world.init_resource::<Generated>();world.init_resource::<Settings>();let mut schedule=Schedule::default();schedule.add_systems(generate);Self{world,schedule}}
}
impl Relief {
    pub fn prepare(&mut self,length:usize)->*mut f64{let mut input=self.world.resource_mut::<Input>();input.0.clear();input.0.resize(length,0.0);input.0.as_mut_ptr()}
    /// Art supplies its chosen rectangles; native policy blocks only the
    /// smallest grid cells enclosing those visible silhouettes. Region IDs
    /// continue to describe geology, without becoming invisible movement walls.
    pub fn footprints(&mut self, width: usize, height: usize, count: usize) -> *const f64 {
        let input = self.world.resource::<Input>(); let mut flags = vec![policy(0); width * height];
        for stamp in input.0.chunks_exact(7).take(count) {
            let allowed = policy(stamp[4] as u32);
            let Some(shape) = shapes::SHAPES.get(stamp[5] as usize * 16 + stamp[6] as usize) else { continue; };
            for (row, &occupied) in shape.rows.iter().enumerate() {
                let y0 = (stamp[1] + row as f64 / shape.height as f64 * stamp[3]).floor().max(0.0) as usize;
                let y1 = (stamp[1] + (row + 1) as f64 / shape.height as f64 * stamp[3] - 0.000001).ceil().clamp(0.0, height as f64) as usize;
                let mut bits = occupied;
                while bits != 0 {
                    let start = bits.trailing_zeros(); let length = (bits >> start).trailing_ones();
                    let end = start + length;
                    let x0 = (stamp[0] + start as f64 / shape.width as f64 * stamp[2]).floor().max(0.0) as usize;
                    let x1 = (stamp[0] + end as f64 / shape.width as f64 * stamp[2] - 0.000001).ceil().clamp(0.0, width as f64) as usize;
                    for y in y0..y1 { for x in x0..x1 { flags[y * width + x] &= allowed; } }
                    bits = if end == 64 { 0 } else { bits & (u64::MAX << end) };
                }
            }
        }
        let mut output = self.world.resource_mut::<Generated>();
        output.0.clear();
        for flag in flags {
            let level = if flag & BUILD != 0 { 0.0 } else if flag & WALK != 0 { 1.0 } else { 2.0 };
            let speed = if level == 0.0 { 1.0 } else if level == 1.0 { 0.82 } else { 0.65 };
            output.0.extend([flag as f64, level, speed]);
        }
        output.0.as_ptr()
    }
    pub fn prune_mountains(&mut self, width: usize, height: usize) -> *const f64 {
        let input = self.world.resource::<Input>();
        let mut kind: Vec<u8> = input.0.iter().take(width * height).map(|value| *value as u8).collect();
        let removed = if kind.len() == width * height { prune_small_mountains(&mut kind, width, height) } else { Vec::new() };
        let mut output = self.world.resource_mut::<Generated>();
        output.0.clear(); output.0.push(removed.len() as f64);
        output.0.extend(removed.into_iter().map(|cell| cell as f64));
        output.0.as_ptr()
    }
    #[allow(clippy::too_many_arguments)]
    pub fn generate(&mut self,width:usize,height:usize,seed:u32,coverage:f64,mountains:f64,hill_size:f64,clustering:f64,spacing:f64,clumps:f64,strings:f64,length_min:f64,length_max:f64,breadth:f64,bend:f64)->*const f64{
        self.world.insert_resource(Settings{width,height,seed,coverage:coverage.clamp(0.0,0.5),mountains:mountains.clamp(0.0,1.0),hill_size:hill_size.clamp(0.4,3.0),clustering:clustering.clamp(0.0,1.0),spacing:spacing.clamp(0.4,3.0),clumps:clumps.clamp(0.0,1.0),strings:strings.clamp(0.0,1.0),length_min:length_min.max(4.0),length_max:length_max.max(length_min),breadth:breadth.clamp(2.0,12.0),bend:bend.clamp(0.0,3.0)});
        self.schedule.run(&mut self.world);self.world.resource::<Generated>().0.as_ptr()
    }
}
