import { describe, expect, it } from 'vitest';
import { scoutRealm } from './helpers/scouts';
import { entityStore } from '../src/game/entity-store';
import { applyGameCommand } from '../src/multiplayer/commands';
import { areSwordsmenUnlocked, RESEARCH_BRANCHES } from '../src/game/research';
import { nextRecruitRole, retinueComposition, setArcherFraction, setHorsemanFraction, setSoldierRole, setSwordsmanFraction, updateArcheryTraining } from '../src/game/archery';
import { moveUnit } from '../src/game/simulation';
import { isRetinueMember, isSoldier } from '../src/game/types';
import { equipUnitFromFaction } from '../src/game/blacksmith';
import { unitRespectsForbidden } from '../src/game/forbidden-zones';

function realm() {
  const state = scoutRealm(), faction = state.factions[0];
  const smithy = { ...state.buildings[0], id: 102, kind: 'blacksmith' as const, x: 14 };
  entityStore(state).buildings.add(smithy);
  return { state, faction, smithy };
}
describe('Metal Casting swordsmen', () => {
  it('requires late research and an owned, finished, nearby blacksmith, including multiplayer', () => {
    const {state,faction,smithy}=realm();
    expect(areSwordsmenUnlocked(faction)).toBe(false);
    expect(setSwordsmanFraction(state,smithy,.5)).toBe(false);
    expect(applyGameCommand(state,0,{type:'swordsmen',buildingId:smithy.id,fraction:.5}).ok).toBe(false);
    faction.research!.levels.metalCasting=1;
    expect(RESEARCH_BRANCHES.find(b=>b.id==='metalCasting')!.prerequisites).toEqual(['reinforcedDefenses','infantryDrill']);
    expect(setSwordsmanFraction(state,state.buildings[0],.5)).toBe(false);
    expect(setSwordsmanFraction(state,smithy,NaN)).toBe(false);
    smithy.construction={startedAt:0,duration:20}; expect(setSwordsmanFraction(state,smithy,.5)).toBe(false);delete smithy.construction;
    expect(applyGameCommand(state,1,{type:'swordsmen',buildingId:smithy.id,fraction:.5}).ok).toBe(false);
    expect(applyGameCommand(state,0,{type:'swordsmen',buildingId:smithy.id,fraction:.5}).ok).toBe(true);
    expect(state.units.filter(u=>u.training?.role==='swordsman')).toHaveLength(2);
  });
  it('trains by visiting the smithy, preserves wounds/upgrades, and can retrain back without stat inflation', () => {
    const {state,faction,smithy}=realm();faction.research!.levels.metalCasting=1;
    setSwordsmanFraction(state,smithy,.25);
    const unit=state.units.find(u=>u.training?.role==='swordsman')!;unit.hp=60;unit.kills=9;unit.weaponLevel=2;unit.armorLevel=3;
    entityStore(state).units.retain(other => other === unit || other.kind === 'leader');
    state.units.find(other => other.kind === 'leader')!.x=20;
    for(let i=0;i<250 && unit.kind!=='swordsman';i++){state.time+=.1;updateArcheryTraining(state,unit,.1,moveUnit);}
    expect(unit).toMatchObject({kind:'swordsman',attack:34,defense:4,hp:60,kills:9,weaponLevel:2,armorLevel:3,inside:false});
    expect(isRetinueMember(unit)).toBe(true);expect(isSoldier(unit)).toBe(true);expect(unitRespectsForbidden(state,unit)).toBe(false);
    const spear={...unit,warriorStats:undefined};setSoldierRole(spear,'spearman');expect(spear.attack).toBe(17);expect(spear.defense).toBe(6);
    setSoldierRole(unit,'warrior');expect(unit.attack).toBe(17);expect(unit.defense).toBe(4);
    setSoldierRole(unit,'swordsman');expect(unit.attack).toBe(34);expect(unit.hp).toBe(60);
    equipUnitFromFaction(unit,{armorLevel:4,weaponLevel:5});expect(unit.armorLevel).toBe(4);expect(unit.weaponLevel).toBe(5);
  });
  it('shares finite retinue slots and caps other allocations without adding soldiers', () => {
    const {state,faction,smithy}=realm();faction.research!.levels.metalCasting=1;
    setArcherFraction(state,state.buildings[0],.75);setSwordsmanFraction(state,smithy,.5);
    expect(retinueComposition(state,0)).toMatchObject({total:4,swordsmen:2,archers:2,warriors:0});
    expect(state.units.filter(isRetinueMember)).toHaveLength(4);
    setArcherFraction(state,state.buildings[0],1);expect(faction.archerFraction).toBe(.5);
    const stable={...smithy,id:103,kind:'stable' as const};entityStore(state).buildings.add(stable);faction.research!.levels.horsebackRiding=1;
    setHorsemanFraction(state,stable,.75);
    expect(retinueComposition(state,0)).toMatchObject({horsemen:3,swordsmen:1,archers:0,warriors:0});
  });
  it('requires a living smithy for replacements and safely exits lost training buildings', () => {
    const {state,faction,smithy}=realm();faction.research!.levels.metalCasting=1;setSwordsmanFraction(state,smithy,1);
    const unit=state.units.find(u=>u.training)!;entityStore(state).units.retain(u=>!u.training || u===unit);
    expect(nextRecruitRole(state,faction)).toBe('swordsman');
    unit.training!.enteredAt=0;unit.inside=true;unit.x=smithy.x+.5;unit.y=smithy.y+.5;smithy.hp=0;state.time=5;
    expect(nextRecruitRole(state,faction)).toBe('warrior');updateArcheryTraining(state,unit,.1,()=>{});
    expect(unit.training).toBeUndefined();expect(unit.inside).toBe(false);expect(unit.kind).toBe('warrior');
  });
});
