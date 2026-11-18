//! One archer per small galley. Acquisition is sampled at one-second cadence;
//! firing, reloads and damage are native, with ordinary projectile publication.
use bevy_ecs::prelude::*;
use std::collections::BTreeMap;
#[derive(Resource,Default)]
pub struct BarbarianGalleys {input:Vec<f64>,output:Vec<f64>,next:BTreeMap<i64,f64>}
pub fn constant(index:u32)->f64{match index{0=>1.0,1=>6.0,2=>1.8,3=>500.0,4=>4.5,_=>f64::NAN}}
pub fn fleet(army:usize)->usize{(army.div_ceil(20)+3).clamp(4,12)}
pub fn can_board(occupant:i64,person:i64)->bool{occupant<0||occupant==person}
impl BarbarianGalleys {
    pub fn input(&mut self,n:usize)->*mut f64{self.input.resize(n,0.0);self.input.as_mut_ptr()}
    /// Boat rows: id,archer,hullHP,crewHP,x,y,firedAt,attack,target.
    /// Target rows: boat,id,x,y,hp,defense,eligible.
    pub fn step(&mut self,boats:usize,targets:usize,now:f64)->*const f64{
        self.output.clear();self.output.push(boats as f64);
        let mut live=std::collections::BTreeSet::new();
        let mut by_boat = BTreeMap::<i64, Vec<&[f64]>>::new();
        for row in self.input[boats*9..boats*9+targets*7].chunks_exact(7) {
            by_boat.entry(row[0] as i64).or_default().push(row);
        }
        for r in self.input[..boats*9].chunks_exact(9){let id=r[0]as i64;live.insert(id);
            let mut target=r[8];let mut fired=r[6];let mut damage=0.0;let mut angle=f64::NAN;
            let candidates=by_boat.get(&id).map_or(&[][..], Vec::as_slice);
            let eligible=|t:&&[f64]|t[4]>0.0&&t[6]!=0.0&&(t[2]-r[4]).hypot(t[3]-r[5])<=constant(1);
            if r[2]>0.0&&r[3]>0.0&&r[1]>=0.0{
                let next=self.next.entry(id).or_default();
                if now>=*next{*next=now+1.0;
                    target=candidates.iter().copied().filter(eligible)
                        .min_by(|a,b|(a[2]-r[4]).hypot(a[3]-r[5]).total_cmp(&(b[2]-r[4]).hypot(b[3]-r[5])).then(a[1].total_cmp(&b[1])))
                        .map_or(-1.0,|t|t[1]);
                }
                if let Some(t)=candidates.iter().copied().filter(eligible).find(|t|t[1]==target){
                    angle=(t[3]-r[5]).atan2(t[2]-r[4]);
                    if now>=fired+constant(2){fired=now;damage=crate::combat::attack_damage(r[7],t[5]);}
                }
            }else{target=-1.0;}
            self.output.extend([id as f64,target,angle,fired,damage]);
        }
        self.next.retain(|id,_|live.contains(id));self.output.as_ptr()
    }
}
