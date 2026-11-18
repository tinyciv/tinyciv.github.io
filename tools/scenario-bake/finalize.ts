import { auditScenarioAccess } from '../../src/game/scenario-access-native';
import { removeBuildings } from '../../src/game/construction-cancellation';
import { refreshAfterBuildingRemoval } from '../../src/game/simulation';
import { initializeRaiderCamps } from '../../src/game/raider-camps';
import { initializeRoamingMarauders } from '../../src/game/roaming-marauders';
import { setBanditIntensity } from '../../src/game/bandit-intensity';
import { entityStore } from '../../src/game/entity-store';
import { refreshIndexedUnit } from '../../src/game/spatial';
import { refreshFogUnit } from '../../src/game/fog';
import type { GameState } from '../../src/game/types';

/** Offline artifact authoring. Rust selects complete structures to remove;
 * ordinary removal reconciles ownership, residents, jobs and navigation. */
function openCorridors(state: GameState) {
  const leaders=state.units.filter(u=>u.kind==='leader'&&u.faction>=0&&u.hp>0&&u.embarkedOn===undefined);
  const removed: {id:number;kind:string;x:number;y:number}[]=[];
  let report=auditScenarioAccess(state,leaders), before={landmasses:report.landmasses,regions:report.regions};
  for (let pass=0;report.remove.length&&pass<4;pass++) {
    const owners=new Map<number,boolean>();
    for (const id of report.remove) {
      const b=entityStore(state).buildings.get(id);if(!b)continue;
      if (b.kind==='palace'||b.kind==='shipyard') throw new Error(`Relocate protected ${b.kind} ${id}; it blocks a natural land connection.`);
      removed.push({id,kind:b.kind,x:b.x,y:b.y});owners.set(b.faction,owners.get(b.faction)===true||b.kind==='house');
    }
    removeBuildings(state,new Set(report.remove));
    for (const [faction,housing] of owners) refreshAfterBuildingRemoval(state,faction,housing);
    report=auditScenarioAccess(state,leaders);
  }
  if (report.remove.length||report.unreachable||report.remaining!==report.landmasses)
    throw new Error('Scenario walking connections could not all be restored.');
  for (let i=0;i<leaders.length;i++) {
    const point=report.starts[i];if(!point)throw new Error('A scenario Leader has no open starting tile.');
    Object.assign(leaders[i],point);leaders[i].path=undefined;leaders[i].pathGoal=undefined;
    refreshIndexedUnit(state,leaders[i]);refreshFogUnit(state,leaders[i]);
  }
  return {before,landmasses:report.landmasses,walkingRegions:report.regions,removed};
}
export function finalizePreparedScenario(state: GameState) {
  const first=openCorridors(state);
  if (state.world.scenario==='age-of-exploration') {
    setBanditIntensity(state,1);
    if (!state.raiderCamps?.length) {state.raiderCamps=undefined;initializeRaiderCamps(state);}
    if ((state.raiderCamps?.length??0)<3) throw new Error('The scenario needs three safely placed marauder camps.');
    if (!state.units.some(u=>u.faction===-2&&u.hp>0)) {state.roamingMaraudersVersion=0;initializeRoamingMarauders(state);}
  }
  const final=openCorridors(state);
  return { ...final,removed:[...first.removed,...final.removed],before:first.before,
    camps:state.raiderCamps?.length??0,marauders:state.units.filter(u=>u.faction===-2&&u.hp>0).length };
}
