import {it,expect} from 'vitest';
import {scoutRealm} from './helpers/scouts';
import {entityStore} from '../src/game/entity-store';
import {updateGame} from '../src/game/simulation';
import {unitDamage} from '../src/game/veterancy';
import {buildingArmor} from '../src/game/defense-equipment';
it.each(['wall','palisade','woodenTower','guardPost','fort'] as const)('reduces actual Leader projectile damage against %s to ten percent',kind=>{
 const state=scoutRealm(),leader=state.units[0];leader.x=10.5;leader.y=10.5;leader.range=4;leader.attack=40;
 state.factions.push({...state.factions[0],id:1,relation:'war',population:0});
 const target={id:500,kind,faction:1,x:13,y:10,hp:1000,maxHp:1000,capacity:0};
 entityStore(state).buildings.replace([{...target,id:501,kind:'palace',faction:0,x:2,y:10},{...target,id:502,kind:'palace',x:18,y:10},target]);
 entityStore(state).units.replace([leader]);leader.target=target.id;
 const damage=unitDamage(leader,buildingArmor(target,state.factions[1]),state.factions[0])*.1;
 updateGame(state,.05,{up:false,down:false,left:false,right:false});
 expect(state.projectiles?.find(p=>p.attacker===leader.id)?.damage).toBeCloseTo(damage);
});
