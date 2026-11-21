//! Scenario configuration over the ordinary generated landscape. Towns grow
//! through the normal game simulation; this resource selects founding sites
//! and scenario equipment. Compact starts use native founding layouts while
//! developed campaigns grow through the normal city simulation.
use bevy_ecs::prelude::*;
use super::kinds::building as b;
use std::collections::VecDeque;
pub fn civic_inner(kind:u32,x:f64,y:f64,cx:f64,cy:f64)->bool{
    matches!(kind,b::GRANARY|b::BARRACKS|b::FORUM|b::COLOSSEUM|b::LIBRARY|b::BLACKSMITH|b::ARCHERY_RANGE|b::SCOUT_LODGE|b::STABLE|b::HEALER_SHACK|b::FOUNDRY|b::SUPPLY_DEPOT)
        &&(x-cx).hypot(y-cy)<8.0
}
pub fn civic_sites(x:f64,y:f64,width:f64,height:f64)->Vec<f64>{
    let mut candidates=Vec::new();
    for dy in -14_i32..=14{for dx in -14_i32..=14{let d=(dx as f64).hypot(dy as f64);let(px,py)=(x+dx as f64,y+dy as f64);
        if (8.0..=14.0).contains(&d)&&px>=0.0&&py>=0.0&&px+3.0<=width&&py+3.0<=height{candidates.push(((d-11.0).abs(),px,py));}
    }}
    candidates.sort_by(|a,b|a.0.total_cmp(&b.0).then(a.2.total_cmp(&b.2)).then(a.1.total_cmp(&b.1)));
    candidates.into_iter().take(256).flat_map(|(_,x,y)|[x,y]).collect()
}

#[derive(Resource, Default)]
pub struct Scenarios { input:Vec<f64>, output:Vec<f64>, claim:Vec<f64>, width:i32, height:i32, starts:Vec<(usize,i32,i32)> }
impl Scenarios {
    pub fn configure(&mut self,width:i32,height:i32) {self.width=width;self.height=height;}
    pub fn input(&mut self,n:usize)->*mut f64 {self.input.resize(n,0.0);self.input.as_mut_ptr()}
    fn flags(&self,x:i32,y:i32)->u32 {if x<0||y<0||x>=self.width||y>=self.height {0} else {self.input[((y*self.width+x)*2)as usize]as u32}}
    pub fn channel(&mut self, channel_width:f64)->*const f64 {
        // Preserve the generator's coast and terrain. Only the requested sea
        // passage is reserved, with a broad natural bend and a four-cell core.
        for y in 0..self.height {
            let center=self.width as f64*0.5+(y as f64/self.height as f64*std::f64::consts::TAU).sin()*1.25;
            let left=(center-channel_width*0.5).round()as i32;
            for x in left..left+channel_width.round()as i32 {if x>=0&&x<self.width {self.input[(y*self.width+x)as usize]=0.0;}}
        }
        self.input.as_ptr()
    }
    fn fertile(&self,x:i32,y:i32)->f64 {self.input[((y*self.width+x)*2+1)as usize]}
    fn town(&self,x:i32,y:i32)->bool {
        (0..=1).all(|dy|(0..=1).all(|dx|self.flags(x+dx,y+dy)&64!=0))
        && (-3..=4).all(|dy|(-3..=4).all(|dx|self.flags(x+dx,y+dy)&2!=0))
        && (0..4).all(|corner|(0..6).all(|step|{
            let(dx,dy)=super::battle_support::road_arm(corner,step);
            self.flags(x+dx as i32,y+dy as i32)&2!=0
        }))
    }
    /// Mirror one ordinary generated half-landscape. The host only copies the
    /// selected source tiles and these transformed links/footprint anchors.
    /// Input rows carry drainage and channel links, both footprint anchors,
    /// ore width and resource group. Output adds the source cell and x direction.
    pub fn symmetry(&mut self)->*const f64 {
        const INPUT_STRIDE: usize = 6;
        self.output.clear();
        let reflect=|cell:i32,span:i32| if cell<0 {-1} else {(cell/self.width)*self.width+self.width-cell%self.width-span};
        for y in 0..self.height {for x in 0..self.width {
            let mirrored=x>=self.width/2;let source=y*self.width+if mirrored {self.width-1-x}else{x};
            let start = source as usize * INPUT_STRIDE;
            let row = &self.input[start .. start + INPUT_STRIDE];
            let link=|value:f64| {let c=value as i32;if c<0||c%self.width>=self.width/2 {-1.0}else if mirrored {reflect(c,1)as f64}else{value}};
            let anchor=|value:f64,span:i32| {let c=value as i32;if c<0||c%self.width+span>self.width/2 {-1.0}else if mirrored {reflect(c,span)as f64}else{value}};
            let group = if row[5] < 0.0 { -1.0 } else { row[5] + if mirrored { 100000.0 } else { 0.0 } };
            self.output.extend([source as f64, link(row[0]), link(row[1]), anchor(row[2], row[3] as i32),
                anchor(row[4], 2), group, if mirrored { -1.0 } else { 1.0 }]);
        }}
        self.output.as_ptr()
    }
    /// Apply ordinary source-side farm plans equally to both competitors.
    pub fn symmetric_sites(&mut self,count:usize)->*const f64 {
        self.output=vec![0.0];
        for row in self.input[..count*3].chunks_exact(3) {
            let(kind,x,y)=(row[0]as u32,row[1]as i32,row[2]as i32);
            if x<0||x+b::width(kind)as i32>self.width*38/100 {continue;}
            for faction in 0..2 {self.output.extend([faction as f64,kind as f64,
                if faction==0{x}else{self.width-x-b::width(kind)as i32}as f64,y as f64]);}
        }
        self.output[0]=((self.output.len()-1)/4)as f64;self.output.as_ptr()
    }
}
/// Native founding layout for a fully equipped compact city. Houses follow
/// available clearings with walking gaps; streets use actual ground paths.
fn musket_city(net:&Scenarios,cx:i32,cy:i32,occupied:&mut [bool])->Option<Vec<(u32,i32,i32,f64,f64)>> {
    let w=net.width;let h=net.height;let key=|x:i32,y:i32|(y*w+x)as usize;
    let mut rows=Vec::new();let mut roads=vec![false;occupied.len()];
    for y in cy..cy+2 {for x in cx..cx+2 {occupied[key(x,y)]=true;}}
    for dy in -1..=2 {for dx in -1..=2 {if dx==-1||dx==2||dy==-1||dy==2 {roads[key(cx+dx,cy+dy)]=true;}}}
    let mut candidates=Vec::new();
    for y in 2..h-2 {for x in 2..w*38/100 {
        let d=(x-cx).pow(2)+(y-cy).pow(2);if d>13*13 {continue;}
        let hash=((x as u32).wrapping_mul(73856093)^(y as u32).wrapping_mul(19349663))%17;
        candidates.push((d as f64+hash as f64*0.2,x,y));
    }}
    candidates.sort_by(|a,b|a.0.total_cmp(&b.0).then(a.2.cmp(&b.2)).then(a.1.cmp(&b.1)));
    for kind in [b::BARRACKS,b::FOUNDRY,b::MILITARY_ACADEMY,b::WELL,b::GRANARY] {
        let(sw,sh)=(b::width(kind)as i32,b::height(kind)as i32);
        let &(_,x,y)=candidates.iter().find(|&&(_,x,y)|{
            let d=(x-cx).pow(2)+(y-cy).pow(2);
            d>=16&&x+sw<=w*38/100&&y+sh<h-1&&(-1..=sh).all(|dy|(-1..=sw).all(|dx|
                net.flags(x+dx,y+dy)&2!=0&&!occupied[key(x+dx,y+dy)]&&!roads[key(x+dx,y+dy)]))
        })?;
        for dy in 0..sh {for dx in 0..sw {occupied[key(x+dx,y+dy)]=true;}}
        rows.push((kind,x,y,0.0,0.0));
    }
    let civic=occupied.to_vec();let mut homes=std::collections::HashSet::new();
    let mut residents:f64=150.0;
    for &(_,x,y) in &candidates {
        if residents<=0.0 {break;}
        if occupied[key(x,y)]||roads[key(x,y)]||net.flags(x,y)&2==0
            ||!(-1..=1).all(|dy|(-1..=1).all(|dx|!civic[key(x+dx,y+dy)])){continue;}
        let open=|px:i32,py:i32|[(1,0),(-1,0),(0,1),(0,-1)].into_iter()
            .filter(|(dx,dy)|net.flags(px+dx,py+dy)&2!=0&&!occupied[key(px+dx,py+dy)]).count();
        if open(x,y)<2||[(1,0),(-1,0),(0,1),(0,-1)].into_iter()
            .any(|(dx,dy)|homes.contains(&(x+dx,y+dy))&&open(x+dx,y+dy)<2){continue;}
        // Preserve the actual cardinal walking region while filling a compact
        // neighborhood, including tiny pockets between natural shore cells.
        let adjacent:Vec<_>=[(1,0),(-1,0),(0,1),(0,-1)].into_iter().map(|(dx,dy)|(x+dx,y+dy))
            .filter(|&(px,py)|net.flags(px,py)&1!=0&&!occupied[key(px,py)]).map(|(px,py)|key(px,py)).collect();
        let mut visited=vec![false;occupied.len()];let mut queue=VecDeque::new();
        if let Some(&first)=adjacent.first(){visited[first]=true;queue.push_back(first);}
        while let Some(cell)=queue.pop_front(){let(px,py)=(cell as i32%w,cell as i32/w);
            for(dx,dy)in[(1,0),(-1,0),(0,1),(0,-1)] {let(nx,ny)=(px+dx,py+dy);
                if nx<0||ny<0||nx>=w||ny>=h||(nx==x&&ny==y)||net.flags(nx,ny)&1==0{continue;}
                let next=key(nx,ny);if occupied[next]||visited[next]{continue;}visited[next]=true;queue.push_back(next);
            }
        }
        if adjacent.iter().any(|cell|!visited[*cell]){continue;}
        let people=residents.min(4.0);residents-=people;occupied[key(x,y)]=true;
        homes.insert((x,y));
        rows.push((b::HOUSE,x,y,people,2.0));
    }
    if residents>0.0{return None;}
    // Each front door connects to the shared network. Bounded founding work
    // runs once offline, with no recurring path searches in the live game.
    for &(kind,x,y,_,_) in &rows {
        let(sw,sh)=(b::width(kind)as i32,b::height(kind)as i32);let mut parent=vec![usize::MAX;occupied.len()];let mut queue=VecDeque::new();
        for cell in 0..roads.len(){if roads[cell]{parent[cell]=cell;queue.push_back(cell);}}
        let mut found=None;
        while let Some(cell)=queue.pop_front(){let(px,py)=(cell as i32%w,cell as i32/w);
            if (px==x-1||px==x+sw)&&(y..y+sh).contains(&py)||(py==y-1||py==y+sh)&&(x..x+sw).contains(&px){found=Some(cell);break;}
            for(dx,dy)in[(1,0),(0,1),(-1,0),(0,-1)] {let(nx,ny)=(px+dx,py+dy);
                if nx<1||ny<1||nx>=w/2-1||ny>=h-1{continue;}let next=key(nx,ny);
                if parent[next]!=usize::MAX||occupied[next]||net.flags(nx,ny)&2==0{continue;}
                parent[next]=cell;queue.push_back(next);
            }
        }
        let mut cell=found?;while !roads[cell]{roads[cell]=true;cell=parent[cell];}
    }
    for &(kind,x,y,_,_) in &rows {if kind==b::FOUNDRY {
        let(sw,sh)=(b::width(kind)as i32,b::height(kind)as i32);
        for dy in -1..=sh {for dx in -1..=sw {if dx==-1||dx==sw||dy==-1||dy==sh {
            let cell=key(x+dx,y+dy);if !occupied[cell]&&net.flags(x+dx,y+dy)&2!=0{roads[cell]=true;}
        }}}
    }}
    for cell in 0..roads.len(){if roads[cell]{rows.push((b::ROAD,cell as i32%w,cell as i32/w,0.0,0.0));}}
    Some(rows)
}
pub fn prepare(world:&mut World,scenario:u32,width:i32,height:i32)->*const f64 {
    let mut net=world.resource_mut::<Scenarios>();net.width=width;net.height=height;net.starts.clear();
    let n=(width*height)as usize;
    let mut coast=vec![i32::MAX;n];let mut queue=VecDeque::new();
    for i in 0..n {if net.input[i*2]as u32&4!=0 {coast[i]=0;queue.push_back(i);}}
    while let Some(i)=queue.pop_front(){let(x,y)=(i as i32%width,i as i32/width);for(dx,dy)in[(1,0),(-1,0),(0,1),(0,-1)] {
        let(nx,ny)=(x+dx,y+dy);if nx<0||ny<0||nx>=width||ny>=height {continue;}let j=(ny*width+nx)as usize;
        if coast[j]>coast[i]+1 {coast[j]=coast[i]+1;queue.push_back(j);}
    }}
    // Irrigation needs a real freshwater feeder through buildable dry ground.
    // Coastal ocean alone cannot sustain the scenario's compact grain farms.
    let mut freshwater=vec![i32::MAX;n];
    for i in 0..n{if net.input[i*2]as u32&8!=0{freshwater[i]=0;queue.push_back(i);}}
    while let Some(i)=queue.pop_front(){let(x,y)=(i as i32%width,i as i32/width);for(dx,dy)in[(1,0),(-1,0),(0,1),(0,-1)]{
        let(nx,ny)=(x+dx,y+dy);if nx<0||ny<0||nx>=width||ny>=height{continue;}let j=(ny*width+nx)as usize;
        if net.input[j*2]as u32&2!=0&&freshwater[j]>freshwater[i]+1{freshwater[j]=freshwater[i]+1;queue.push_back(j);}
    }}
    let mut components=vec![usize::MAX;n];let mut sizes=Vec::new();
    for start in 0..n {if components[start]!=usize::MAX||net.input[start*2]as u32&1==0 {continue;}
        let label=sizes.len();components[start]=label;let mut cells=vec![start];
        for head in 0..n {if head>=cells.len(){break;}let i=cells[head];let(x,y)=(i as i32%width,i as i32/width);
            for(dx,dy)in[(1,0),(-1,0),(0,1),(0,-1)]{let(nx,ny)=(x+dx,y+dy);if nx<0||ny<0||nx>=width||ny>=height{continue;}let j=(ny*width+nx)as usize;
                if components[j]==usize::MAX&&net.input[j*2]as u32&1!=0 {components[j]=label;cells.push(j);}
            }
        }sizes.push(cells.len());
    }
    let mut sites=Vec::new();
    for y in 7..height-7 {for x in 7..width-7 {let i=(y*width+x)as usize;
        if !net.town(x,y)||components[i]==usize::MAX||scenario<2&&freshwater[i]>12 {continue;}
        let quality=net.fertile(x,y)+(-6..=6).step_by(3).map(|dy|(-6..=6).step_by(3).map(|dx|net.fertile(x+dx,y+dy)).sum::<f64>()).sum::<f64>()/25.0;
        sites.push((x,y,components[i],quality));
    }}
    if scenario==0 {
        let mut islands:Vec<_>=(0..sizes.len()).filter(|i|sizes[*i]>=1500).collect();islands.sort_by_key(|i|std::cmp::Reverse(sizes[*i]));
        // Favor separate naturally generated islands; fall back to separated
        // coastal regions only if geography supplies fewer large islands.
        for label in islands {if net.starts.len()==4 {break;}
            let choice=sites.iter().filter(|s|s.2==label&&coast[(s.1*width+s.0)as usize]>=7&&coast[(s.1*width+s.0)as usize]<=14)
                .max_by(|a,b|(a.3-(coast[(a.1*width+a.0)as usize]as f64-9.0).abs()*0.3).total_cmp(&(b.3-(coast[(b.1*width+b.0)as usize]as f64-9.0).abs()*0.3)));
            if let Some(s)=choice {let faction=net.starts.len();net.starts.push((faction,s.0,s.1));}
        }
        while net.starts.len()<4 {
            let choice=sites.iter().filter(|s|coast[(s.1*width+s.0)as usize]>=7&&coast[(s.1*width+s.0)as usize]<=14&&net.starts.iter().all(|p|(p.1-s.0).pow(2)+(p.2-s.1).pow(2)>=40*40))
                .max_by(|a,b|a.3.total_cmp(&b.3));
            if let Some(s)=choice {let faction=net.starts.len();net.starts.push((faction,s.0,s.1));} else {break;}
        }
    } else if scenario==5 {
        // Select two genuine founding clearings on one connected landmass.
        // The generated half is mirrored before planning, so their opponents
        // receive exactly matching terrain, resources and expansion room.
        let mut left=Vec::new();
        for target in [width as f64*0.12,width as f64*0.28] {
            let choice=sites.iter().filter(|s|s.0<=width*30/100&&sizes[s.2]>=n/3
                &&left.iter().all(|p:&(i32,i32,usize)|p.2==s.2&&(p.0-s.0).pow(2)+(p.1-s.1).pow(2)>=23*23)
                &&components[(s.1*width+width-2-s.0)as usize]==s.2)
                .max_by(|a,b|(a.3-((a.0 as f64-target).hypot(a.1 as f64-height as f64*0.5))*0.15)
                    .total_cmp(&(b.3-((b.0 as f64-target).hypot(b.1 as f64-height as f64*0.5))*0.15)));
            if let Some(s)=choice {left.push((s.0,s.1,s.2));}
        }
        for faction in 0..2 {for &(x,y,_)in &left {net.starts.push((faction,if faction==0{x}else{width-2-x},y));}}
    } else if scenario==4 {
        // Sandbox reuses the tutorial's natural island geography with room to
        // expand. A single ordinary founding town leaves the rest unclaimed.
        let choice=sites.iter().filter(|s|sizes[s.2]>=n/3&&freshwater[(s.1*width+s.0)as usize]<=12)
            .max_by(|a,b|(a.3-((a.0 as f64-width as f64*0.5).hypot(a.1 as f64-height as f64*0.5))*0.08)
                .total_cmp(&(b.3-((b.0 as f64-width as f64*0.5).hypot(b.1 as f64-height as f64*0.5))*0.08)));
        if let Some(s)=choice {net.starts.push((0,s.0,s.1));}
    } else if scenario==3 {
        // Each north-coast town belongs to a different procedural island. Keep
        // the southern half free for a second city and choose a usable harbor.
        for faction in 0..2 {
            let target_x=width as f64*if faction==0 {0.35} else {0.65};
            let choice=sites.iter().filter(|s|s.1<=height*2/5
                &&(if faction==0 {s.0<width/2-6} else {s.0>width/2+6})
                &&(7..=14).contains(&coast[(s.1*width+s.0)as usize])
                &&net.starts.first().is_none_or(|p|components[(p.2*width+p.1)as usize]!=s.2))
                .max_by(|a,b|(a.3-((a.0 as f64-target_x).hypot(a.1 as f64-height as f64*0.28))*0.18)
                    .total_cmp(&(b.3-((b.0 as f64-target_x).hypot(b.1 as f64-height as f64*0.28))*0.18)));
            if let Some(s)=choice {net.starts.push((faction,s.0,s.1));}
        }
    } else if scenario==2 {
        // Two compact founding towns on the same natural landmass. A well
        // supplies each city; no river requirement can squeeze out a 30-row map.
        for faction in 0..2 {
            let target_x=width as f64*if faction==0 {0.25} else {0.75};
            let choice=sites.iter().filter(|s|(if faction==0 {s.0<width/2-10} else {s.0>width/2+10})
                &&net.starts.first().is_none_or(|p|components[(p.2*width+p.1)as usize]==s.2))
                .max_by(|a,b|(a.3-((a.0 as f64-target_x).hypot(a.1 as f64-height as f64*0.5))*0.12)
                    .total_cmp(&(b.3-((b.0 as f64-target_x).hypot(b.1 as f64-height as f64*0.5))*0.12)));
            if let Some(s)=choice {net.starts.push((faction,s.0,s.1));}
        }
    } else {
        for faction in 0..2 {for band in 0..3 {
            let target_x=if faction==0 {width as f64*0.28} else {width as f64*0.72};let target_y=(band as f64+0.5)*height as f64/3.0;
            let margin=10.min(height/20);
            let choice=sites.iter().filter(|s|s.1>=band*height/3+margin&&s.1<(band+1)*height/3-margin
                &&net.starts.first().is_none_or(|p|components[(p.2*width+p.1)as usize]==s.2)
                &&if faction==0 {s.0<width/2-24} else {s.0>width/2+24})
                .max_by(|a,b|(a.3-((a.0 as f64-target_x).hypot(a.1 as f64-target_y))*0.08).total_cmp(&(b.3-((b.0 as f64-target_x).hypot(b.1 as f64-target_y))*0.08)));
            if let Some(s)=choice {net.starts.push((faction,s.0,s.1));}
        }}
    }
    if scenario==1 {net.starts.sort_by_key(|p|(p.0,(p.2-height/2).abs()));}
    let factions=if scenario==0 {4} else if scenario==4 {1} else {2};let required=if scenario==0||scenario==5 {4} else if scenario==4 {1} else if scenario>=2 {2} else {6};
    if net.starts.len()!=required {net.output=vec![0.0];return net.output.as_ptr();}
    let starts=net.starts.clone();
    let tutorial=matches!(scenario,2|3);let sandbox=scenario==4;let musket=scenario==5;
    net.output=vec![width as f64,height as f64,factions as f64,(starts.len()*if tutorial {5} else {1})as f64,0.0,
        if sandbox {500.0} else if tutorial {1000.0} else {15000.0},if tutorial||sandbox {500.0} else {12000.0},if sandbox {20.0} else if tutorial {30.0} else if musket {150.0} else {200.0},if tutorial||sandbox {0.0} else {1.0},0.0];
    for faction in 0..factions {let p=starts.iter().find(|p|p.0==faction).unwrap();net.output.extend([p.1 as f64,p.2 as f64]);}
    if musket {
        let mut occupied=vec![false;n];let mut cities=Vec::new();
        for &(_,x,y) in starts.iter().filter(|p|p.0==0) {
            let Some(rows)=musket_city(&net,x,y,&mut occupied)else{net.output=vec![0.0];return net.output.as_ptr();};cities.push(rows);
        }
        for(faction,x,y)in starts {let city=net.starts.iter().filter(|p|p.0==faction).position(|p|p.1==x&&p.2==y).unwrap();
            net.output.extend([b::PALACE as f64,faction as f64,x as f64,y as f64,0.0,2.0,if city==0{1.0}else{0.0}]);
            for &(kind,bx,by,residents,level) in &cities[city] {
                let px=if faction==0{bx}else{width-bx-b::width(kind)as i32};
                net.output.extend([kind as f64,faction as f64,px as f64,by as f64,residents,level,(city+1)as f64]);
            }
        }
        net.output[3]=((net.output.len()-10-factions*2)/7)as f64;
        // Native starting composition and artillery count, followed by an
        // authored-layout flag consumed only by the founding transport.
        net.output.extend([1.0,2.0,1.0]);
        return net.output.as_ptr();
    }
    for(faction,x,y)in starts {let capital=net.starts.iter().find(|p|p.0==faction).is_some_and(|p|p.1==x&&p.2==y);
        net.output.extend([b::PALACE as f64,faction as f64,x as f64,y as f64,0.0,if tutorial {2.0} else {0.0},capital as u8 as f64]);
        if tutorial {
            // A shared house/well tile and a rear tower leave all four ordinary
            // starting streets and the palace's entrances open.
            net.output.extend([b::WELL as f64,faction as f64,x as f64,(y-2)as f64,0.0,0.0,0.0]);
            net.output.extend([b::WOODEN_TOWER as f64,faction as f64,(x+4)as f64,(y-2)as f64,0.0,0.0,0.0]);
            // Two homes on the side lanes finish the thirty-person village;
            // existing founding homes inherit the palace row's house tier.
            for hy in [y,y+3] {net.output.extend([b::HOUSE as f64,faction as f64,(x+4)as f64,hy as f64,3.0,2.0,0.0]);}
        }
    }
    if scenario==3 {
        let mut placed=Vec::new();let mut ships=Vec::new();
        for &(faction,cx,cy) in &net.starts {
            // Reserve the founding village and its ordinary streets. Civic and
            // harbor sites follow the actual buildable coast outside that core.
            let mut occupied=vec![false;n];
            for y in cy-6..=cy+6 {for x in cx-6..=cx+6 {if x>=0&&y>=0&&x<width&&y<height {occupied[(y*width+x)as usize]=true;}}}
            let own_component=components[(cy*width+cx)as usize];
            for(kind,w,h,shore)in[(b::SHIPYARD,3,3,true),(b::WHALING_POST,2,2,true),(b::DOCK,1,1,true),(b::LIBRARY,2,2,false),(b::BLACKSMITH,1,1,false),(b::MONUMENT,1,1,false)] {
                let mut candidates=Vec::new();
                for y in 2..height-h-2 {for x in 2..width-w-2 {
                    if components[(y*width+x)as usize]!=own_component || (x-cx).pow(2)+(y-cy).pow(2)>24*24 {continue;}
                    if !(0..h).all(|dy|(0..w).all(|dx|net.flags(x+dx,y+dy)&2!=0&&!occupied[((y+dy)*width+x+dx)as usize])){continue;}
                    let near_water=(0..w).any(|dx|net.flags(x+dx,y-1)&4!=0||net.flags(x+dx,y+h)&4!=0)
                        ||(0..h).any(|dy|net.flags(x-1,y+dy)&4!=0||net.flags(x+w,y+dy)&4!=0);
                    if shore&&!near_water{continue;}
                    let score=(x-cx).pow(2)+(y-cy).pow(2)+(y-cy).max(0)*3;
                    candidates.push((score,x,y));
                }}
                candidates.sort();
                let mut chosen=None;
                for(_,x,y)in candidates {
                    let mut launch=None;
                    if kind==b::SHIPYARD {
                        'launch:for r in 3_i32..=7 {for dy in -r..=r {for dx in -r..=r {
                            let(px,py)=(x+1+dx,y+1+dy);
                            // Galleys launch along the shore on a true 2×5
                            // water footprint, and can leave the harbor.
                            for vertical in [true,false] {
                                let(sw,sh)=if vertical{(2,5)}else{(5,2)};
                                if (0..sh).all(|oy|(0..sw).all(|ox|net.flags(px+ox,py+oy)&4!=0)) {
                                    launch=Some((px as f64+sw as f64*0.5,py as f64+sh as f64*0.5,if vertical {std::f64::consts::FRAC_PI_2}else{0.0}));break 'launch;
                                }
                            }
                        }}}
                        if launch.is_none(){continue;}
                    }
                    chosen=Some((x,y,launch));break;
                }
                let Some((x,y,launch))=chosen else {net.output=vec![0.0];return net.output.as_ptr();};
                placed.extend([kind as f64,faction as f64,x as f64,y as f64,0.0,0.0,0.0]);
                // One open tile around civic works keeps walks and entrances.
                for dy in -1..=h {for dx in -1..=w {let(px,py)=(x+dx,y+dy);if px>=0&&py>=0&&px<width&&py<height{occupied[(py*width+px)as usize]=true;}}}
                if let Some((sx,sy,angle))=launch {ships.extend([faction as f64,sx,sy,x as f64,y as f64,0.0,0.0,1.0,angle]);}
            }
        }
        net.output[3]+=(placed.len()/7)as f64;net.output[4]=(ships.len()/9)as f64;net.output.extend(placed);net.output.extend(ships);
    }
    net.output.as_ptr()
}
/// Earned tutorial gold doubles before research diversion. Stocks, refunds and
/// faction transfers are transported separately and never receive this bonus.
pub fn gold_income(scenario:u32,amount:f64,earned:bool)->f64 {
    if matches!(scenario,2|3)&&earned {amount*2.0} else {amount}
}
/// Campaign population is an incrementally maintained, saved ECS counter, so
/// the objective never needs an entity scan or a second population accumulator.
pub fn goal(world:&World,scenario:u32,faction:i32)->bool {
    scenario==4&&world.resource::<super::campaign::Campaign>().population_goal(faction,2000.0)
}
pub fn length(world:&World)->usize {world.resource::<Scenarios>().output.len()}
/// Retain a few small stands from the procedural woodland, without inventing
/// tree locations or flattening the underlying landscape.
pub fn woodland(world:&mut World)->*const f64 {
    let mut net=world.resource_mut::<Scenarios>();let mut kept=std::collections::BTreeSet::new();
    let trees:Vec<_>=(0..net.width*net.height).filter(|i|net.input[(*i*2)as usize]as u32&16!=0
        &&net.starts.iter().all(|p|(p.1-i%net.width).pow(2)+(p.2-i/net.width).pow(2)>64)).collect();
    for side in 0..2 {for stand in 0..2 {
        let mut candidates:Vec<_>=trees.iter().copied().filter(|i|(i%net.width>=net.width/2)as i32==side&&!kept.contains(i)).collect();
        candidates.sort_by_key(|i|{
            let mut h=(*i as u32).wrapping_mul(0x7feb352d).wrapping_add((stand as u32+1)*617);
            h=(h^(h>>16)).wrapping_mul(0x846ca68b);h^(h>>16)
        });
        let Some(anchor)=candidates.first().copied()else{continue;};
        candidates.sort_by_key(|i|((i%net.width-anchor%net.width).pow(2)+(i/net.width-anchor/net.width).pow(2),*i));
        kept.extend(candidates.into_iter().take(6));
    }}
    let removed:Vec<_>=(0..net.width*net.height).filter(|i|net.input[(*i*2)as usize]as u32&16!=0&&!kept.contains(i)).collect();
    net.output=vec![removed.len()as f64];net.output.extend(removed.into_iter().map(|i|i as f64));net.output.as_ptr()
}
/// Offline irrigation follows actual freshwater, ownership and occupied-cell
/// observations. Select useful coverage, then emit each feeder ditch before its
/// branches so ordinary construction validation can purchase the whole network.
/// Input pairs: flags (1 buildable, 2 existing ditch, 4 freshwater), farm weight.
pub fn irrigation(world:&mut World,coverage:f64)->*const f64 {
    let mut net=world.resource_mut::<Scenarios>();
    let (width,height)=(net.width as usize,net.height as usize);let n=width*height;
    let flags:Vec<_>=(0..n).map(|i|net.input[i*2]as u32).collect();
    let weights:Vec<_>=(0..n).map(|i|net.input[i*2+1].max(0.0)).collect();
    let adjacent=|i:usize|[(i.wrapping_sub(width),i>=width),(i.wrapping_sub(1),i%width>0),
        (i+1,i%width+1<width),(i+width,i+width<n)].into_iter().filter(|(_,valid)|*valid).map(|(j,_)|j);
    let offsets:Vec<_>=(-2_i32..=2).flat_map(|y|(-2_i32..=2).filter_map(move|x|if x*x+y*y<=4{Some((x,y))}else{None})).collect();
    let around=|i:usize|offsets.iter().filter_map(move|&(dx,dy)|{
        let(x,y)=((i%width)as i32+dx,(i/width)as i32+dy);
        if x>=0&&y>=0&&x<width as i32&&y<height as i32{Some(y as usize*width+x as usize)}else{None}
    });
    let mut network:Vec<_>=flags.iter().map(|f|f&6!=0).collect();
    let mut covered=vec![false;n];
    for i in 0..n{if flags[i]&2!=0{for j in around(i){covered[j]=true;}}}
    let total: f64=weights.iter().sum();let target=total*coverage.clamp(0.0,1.0);
    let mut covered_weight:f64=(0..n).filter(|i|covered[*i]).map(|i|weights[i]).sum();
    let mut distance=vec![usize::MAX;n];let mut parent=vec![usize::MAX;n];let mut queue=Vec::with_capacity(n);let mut orders=Vec::new();
    while covered_weight+1e-7<target&&orders.len()<2048 {
        distance.fill(usize::MAX);parent.fill(usize::MAX);queue.clear();
        for i in 0..n{if network[i]{distance[i]=0;queue.push(i);}}
        let mut head=0;
        while head<queue.len(){let i=queue[head];head+=1;
            for j in adjacent(i){if flags[j]&1!=0&&distance[j]==usize::MAX{distance[j]=distance[i]+1;parent[j]=i;queue.push(j);}}
        }
        let mut best=None;let mut score=0.0;
        for i in 0..n{if flags[i]&1==0||network[i]||distance[i]==usize::MAX{continue;}
            let gain:f64=around(i).filter(|j|!covered[*j]).map(|j|weights[j]).sum();
            let value=gain/(distance[i]as f64).powf(0.65);
            if value>score+1e-9{score=value;best=Some(i);}
        }
        let Some(mut cell)=best else{break;};let mut branch=Vec::new();
        while !network[cell]{branch.push(cell);cell=parent[cell];}
        for cell in branch.into_iter().rev(){network[cell]=true;orders.push(cell);
            for j in around(cell){if !covered[j]{covered[j]=true;covered_weight+=weights[j];}}
        }
    }
    net.output=vec![orders.len()as f64,covered_weight,total];
    net.output.extend(orders.into_iter().map(|i|i as f64));net.output.as_ptr()
}
/// The normal simulation advances every builder, courier, governor and birth
/// clock during preparation. Rust decides when all founding towns are ready.
pub fn progress(world:&mut World,elapsed:f64,population:f64,housing:f64,food:f64)->u32 {
    let _=world.resource::<Scenarios>();
    if population>=200.0&&housing>=200.0&&food>=0.0 {1} else if elapsed>=7200.0 {2} else {0}
}
/// Frontier equipment follows actual buildable terrain, not an artificial
/// grass rectangle. Foundations are completed by ordinary builders.
pub fn equipment(world:&mut World)->*const f64 {
    let mut net=world.resource_mut::<Scenarios>();let mut rows=Vec::new();
    let tower_spacing = (crate::combat::WOODEN_TOWER_RANGE * 2.5).ceil() as i32;
    for faction in 0..2 {let wall=net.width/2+if faction==0 {-11} else {10};
        let direction = if faction == 0 { -1 } else { 1 };
        let (tower_x, first, last) = frontier_tower_line(&net, wall, direction, tower_spacing);
        for y in 1..net.height-1 {if net.flags(wall,y)&2==0 {continue;}
            rows.extend([b::WALL as f64,faction as f64,wall as f64,y as f64,0.0,0.0,0.0]);
            let rear=wall+3*direction;
            if y%tower_spacing==(first+tower_spacing/2)%tower_spacing&&net.flags(rear,y)&2!=0 {
                rows.extend([b::BALLISTA as f64,faction as f64,rear as f64,y as f64,0.0,0.0,0.0]);
            }
        }
        if first > 0 {
            for y in (first..=last).step_by(tower_spacing as usize) {
                rows.extend([b::WOODEN_TOWER as f64, faction as f64, tower_x as f64, y as f64, 0.0, 0.0, 0.0]);
            }
        }
    }
    net.output=vec![(rows.len()/7)as f64];net.output.extend(rows);net.output.as_ptr()
}

/// Shift the line and its starting row to find consecutive dry, vacant
/// stations while keeping the actual distance between them fixed.
fn frontier_tower_line(net: &Scenarios, wall: i32, rear: i32, spacing: i32) -> (i32, i32, i32) {
    let mut best = (0, i32::MIN, i32::MIN);
    let mut line = (wall + 3 * rear, 0, 0);
    let mut lengths = vec![0; net.height as usize];
    for setback in 2_i32..=9 {
        lengths.fill(0);
        let x = wall + setback * rear;
        for y in 1..net.height - 1 {
            if net.flags(x, y) & (2 | 32) != 2 { continue; }
            let length = 1 + if y > spacing { lengths[(y - spacing) as usize] } else { 0 };
            lengths[y as usize] = length;
            let first = y - (length - 1) * spacing;
            let score = (length, -(setback - 3).abs(), -(first + y - net.height).abs());
            if score > best {
                best = score;
                line = (x, first, y);
            }
        }
    }
    line
}
pub fn city_claim(world:&mut World,scenario:u32,x:i32,y:i32,radius:f64,width:i32,height:i32)->*const f64 {
    let mut claim=vec![0.0;5];
    if scenario==1 {let(left,right)=if x<width/2 {(0,width/2-11)} else {(width/2+10,width-1)};
        let band=(y*3/height).clamp(0,2);let(top,bottom)=(band*height/3,(band+1)*height/3-1);
        claim=vec![((right-left+1)*(bottom-top+1))as f64,left as f64,top as f64,right as f64,bottom as f64];
        for cy in top..=bottom {for cx in left..=right {claim.extend([(cy*width+cx)as f64,radius]);}}
    }
    let mut resource=world.resource_mut::<Scenarios>();resource.claim=claim;resource.claim.as_ptr()
}
