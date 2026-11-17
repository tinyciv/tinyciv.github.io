import { rustEngine } from './rust-engine';
import { SimSlot,simCore } from './sim-handle';
import { entityStore } from './entity-store';
import { nearbyUnits,refreshIndexedUnit } from './spatial';
import { refreshFogUnit } from './fog';
import { unitAttack } from './veterancy';
import type { GameState,Unit } from './types';
import type { NavalCombat } from './warships-native';

const sources=new SimSlot<{next:number;targets:{boat:number;target:number;eligible:boolean;defense:number}[]}>();
/** Spatial observations are sampled once per second. The native resource owns
 * acquisition, single-archer eligibility, reloads and outgoing damage. */
export function updateBarbarianGalleys(state:GameState,combat:NavalCombat):void {
  const store=entityStore(state),boats=store.units.query('vessel').filter(u=>u.barbarianGalley&&u.hp>0);
  if(!boats.length)return;
  const cached=sources.get(state)??sources.set(state,{next:-Infinity,targets:[]});
  if(state.time>=cached.next){cached.next=state.time+1;cached.targets=[];
    for(const boat of boats)for(const target of nearbyUnits(state,boat,8)) {
      if(target.id===boat.id||target.inside||target.hp<=0||target.faction===boat.faction)continue;
      cached.targets.push({boat:boat.id,target:target.id,...combat.observe(boat,target)});
    }
  }
  const values:number[]=[];
  for(const boat of boats){const archer=store.units.get(boat.sailboat?.passenger??-1),gun=boat.barbarianGalley!;
    values.push(boat.id,archer?.id??-1,boat.hp,archer?.embarkedOn===boat.id?archer.hp:0,boat.x,boat.y,gun.firedAt??-1000,archer?unitAttack(archer):0,gun.target??-1);
    if(archer?.embarkedOn===boat.id){archer.x=boat.x;archer.y=boat.y;refreshIndexedUnit(state,archer);refreshFogUnit(state,archer);}
  }
  let count=0;
  for(const item of cached.targets){const target=store.units.get(item.target);if(!target)continue;
    values.push(item.boat,target.id,target.x,target.y,target.hp,item.defense,Number(item.eligible&&!target.inside&&target.embarkedOn===undefined));count++;
  }
  const handle=simCore(state).handle,pointer=rustEngine.sim_barbarian_input(handle,values.length);
  new Float64Array(rustEngine.memory.buffer,pointer,values.length).set(values);
  const result=rustEngine.sim_barbarian_step(handle,boats.length,count,state.time);
  const rows=new Float64Array(rustEngine.memory.buffer,result,1+boats.length*5).slice();
  for(let i=0;i<rows[0];i++) {
    const r=rows.subarray(1+i*5),boat=store.units.get(r[0]);if(!boat?.barbarianGalley)continue;
    Object.assign(boat.barbarianGalley,{target:r[1]<0?undefined:r[1],aim:r[2],firedAt:r[3]});
    const archer=store.units.get(boat.sailboat?.passenger??-1),target=store.units.get(r[1]);
    if(archer&&Number.isFinite(r[2]))archer.facing=r[2];
    if(r[4]>0&&archer&&target)combat.shoot(boat,target,0,r[4]);
  }
}
