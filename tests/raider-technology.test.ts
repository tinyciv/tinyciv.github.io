import {it,expect} from 'vitest';
import {scoutRealm} from './helpers/scouts';
import {entityStore} from '../src/game/entity-store';
import {updateRaiderTechnology,armyAverages} from '../src/game/raider-technology';
import {unitAttack,unitDefense} from '../src/game/veterancy';
it('matches two thirds of the nearest settlement army gap once a minute without compounding',()=>{
 const state=scoutRealm(),base=state.units[1];
 entityStore(state).buildings.replace([{id:500,kind:'palace',faction:0,x:20,y:20,hp:500,maxHp:500,capacity:4}]);
 const soldier={...base,id:10,attack:40,defense:20,weaponLevel:3 as const,armorLevel:3 as const};
 const raider={...base,id:11,faction:-2,marauderPack:1,attack:10,defense:2};
 entityStore(state).units.replace([{...state.units[0],attack:9999},soldier,raider]);
 const a=armyAverages(state,[soldier]),b=armyAverages(state,[raider]);updateRaiderTechnology(state);
 expect(unitAttack(raider)).toBeCloseTo(b.attack+(a.attack-b.attack)*2/3);
 expect(unitDefense(raider)).toBeCloseTo(b.defense+(a.defense-b.defense)*2/3);
 const before={...raider.technologyBonus};soldier.attack=80;state.time=59;updateRaiderTechnology(state);expect(raider.technologyBonus).toEqual(before);
 state.time=60;updateRaiderTechnology(state);const after={...raider.technologyBonus};state.time=120;updateRaiderTechnology(state);expect(raider.technologyBonus).toEqual(after);
});
