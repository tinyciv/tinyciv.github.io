//! Initial hermit placement shares the terrain's movement edges. Wilderness
//! homes must be road-reachable and favor an existing local raider camp.
use std::collections::{BTreeMap, VecDeque};
#[derive(Default)]
pub struct Planner { pub input:Vec<f64>, pub output:Vec<f64> }
fn rank(seed:u32,cell:usize)->u32{let mut v=seed^(cell as u32).wrapping_mul(374761393);v=(v^(v>>13)).wrapping_mul(1274126177);v^(v>>16)}
impl Planner{
    pub fn prepare(&mut self,length:usize)->*mut f64{self.input.resize(length,0.0);self.input.as_mut_ptr()}
    /// Header: width,height,seed,buildingCount,capitalX,capitalY.
    /// Tiles: obstacleBits (cover/ridge/stair/river/palm),owner,movementEdges,walkable.
    /// Buildings: x,y,width,height,camp,bridge.
    pub fn run(&mut self)->*const f64{
        self.output.clear();self.output.push(0.0);if self.input.len()<6{return self.output.as_ptr();}
        let w=self.input[0]as usize;let h=self.input[1]as usize;let seed=self.input[2]as u32;let nb=self.input[3]as usize;let n=w*h;
        if w==0||h==0||self.input.len()!=6+n*4+nb*6{return self.output.as_ptr();}
        let tiles:Vec<_>=self.input[6..6+n*4].chunks_exact(4).collect();let buildings:Vec<_>=self.input[6+n*4..].chunks_exact(6).collect();
        let mut buckets:BTreeMap<(i32,i32),Vec<usize>>=BTreeMap::new();let mut bridges=vec![false;n];
        for(i,b)in buildings.iter().enumerate(){buckets.entry(((b[0]/24.0).floor()as i32,(b[1]/24.0).floor()as i32)).or_default().push(i);
            if b[5]!=0.0&&b[0]>=0.0&&b[1]>=0.0&&(b[0]as usize)<w&&(b[1]as usize)<h{bridges[b[1]as usize*w+b[0]as usize]=true;}}
        let mut reachable=vec![false;n];let mut queue=VecDeque::new();let cx=self.input[4]as usize;let cy=self.input[5]as usize;
        if cx<w&&cy<h{let i=cy*w+cx;reachable[i]=true;queue.push_back(i);}
        while let Some(i)=queue.pop_front(){let x=(i%w)as i32;let y=(i/w)as i32;let mut direction=0;
            for dy in -1..=1{for dx in -1..=1{if dx==0&&dy==0{continue;}
                if tiles[i][2]as u16&(1<<direction)!=0&&x+dx>=0&&y+dy>=0&&x+dx<w as i32&&y+dy<h as i32{
                    let next=(y+dy)as usize*w+(x+dx)as usize;if !reachable[next]&&(tiles[next][3]!=0.0||bridges[next]){reachable[next]=true;queue.push_back(next);}}
                direction+=1;
            }}
        }
        let mut claimed=vec![u16::MAX;n];
        for(i,t)in tiles.iter().enumerate(){if t[1]>=0.0{claimed[i]=0;queue.push_back(i);}}
        while let Some(i)=queue.pop_front(){if claimed[i]>=12{continue;}let x=i%w;let y=i/w;
            for ny in y.saturating_sub(1)..=(y+1).min(h-1){for nx in x.saturating_sub(1)..=(x+1).min(w-1){let next=ny*w+nx;
                if claimed[next]>claimed[i]+1{claimed[next]=claimed[i]+1;queue.push_back(next);}}}
        }
        let camps:Vec<_>=buildings.iter().filter(|b|b[4]!=0.0).map(|b|(b[0]+b[2]/2.0,b[1]+b[3]/2.0)).collect();
        let mut candidates=Vec::new();
        for i in 0..n{let x=i%w;let y=i/w;if x<2||y<2||x+3>=w||y+3>=h||!reachable[i]||claimed[i]<6||tiles[i][0]!=0.0||tiles[i][3]==0.0{continue;}
            if(y-1..=y+1).any(|ny|(x-1..=x+1).any(|nx|{let tile=tiles[ny*w+nx];tile[0]!=0.0||tile[1]>=0.0||tile[3]==0.0})){continue;}
            let mut nearest=f64::INFINITY;let(bx,by)=((x/24)as i32,(y/24)as i32);
            for by in by-1..=by+1{for bx in bx-1..=bx+1{for &index in buckets.get(&(bx,by)).into_iter().flatten(){let b=buildings[index];
                let dx=(b[0]-x as f64).max(0.0).max(x as f64-b[0]-b[2]);let dy=(b[1]-y as f64).max(0.0).max(y as f64-b[1]-b[3]);nearest=nearest.min(dx.hypot(dy));}}}
            if nearest<16.0{continue;}let camp=camps.iter().map(|&(cx,cy)|(cx-x as f64).hypot(cy-y as f64)).fold(f64::INFINITY,f64::min);
            let preferred=claimed[i]>=12&&nearest>=24.0;let local=(24.0..=70.0).contains(&camp);
            candidates.push((i,preferred,local,rank(seed,i)));
        }
        candidates.sort_by_key(|&(i,preferred,local,tie)|(!local,!preferred,tie,i));
        let wanted=(n/12000).clamp(1,8).max(if w.min(h)>=128{2}else{1});let mut selected:Vec<(f64,f64)>=Vec::new();
        for(cell,_,_,_)in candidates{let x=(cell%w)as f64;let y=(cell/w)as f64;
            if selected.iter().any(|&(px,py)|(px-x).hypot(py-y)<25.0){continue;}
            selected.push((x,y));if selected.len()>=wanted{break;}}
        self.output[0]=selected.len()as f64;for(x,y)in selected{self.output.extend_from_slice(&[x,y]);}self.output.as_ptr()
    }
}
