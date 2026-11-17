import { buildAt, updateGame } from '../../src/game/simulation';
import { citySummaries, invalidateCitySummarySnapshot } from '../../src/game/cities';
import { refreshDiplomacy } from '../../src/game/diplomacy';
import { banditIntensity, setBanditIntensity } from '../../src/game/bandit-intensity';
import { irrigationYieldMultiplier } from '../../src/game/irrigation';
import { buildingReady, type GameState } from '../../src/game/types';
import { orderScenarioIrrigation, removeScenarioOrchards } from './irrigation';
import { planAutomaticFarmSite } from '../../src/game/farm-siting';
import { withPlayerFaction } from '../../src/game/player-context';

export function scenarioAgricultureSummary(state: GameState) {
  return {orchards:state.buildings.filter(b=>b.orchard).length,
    completedDitches:state.buildings.filter(b=>b.kind==='irrigation'&&buildingReady(b)).length,
    irrigatedFields:state.fields?.filter(f=>irrigationYieldMultiplier(state,f.x,f.y)>1).length??0,
    fields:state.fields?.length??0};
}

/** Refine an existing simulated start offline. No population is assigned:
 * ordinary builders dig every planned ditch while the normal simulation runs.
 * Scenario launch continues to load the finished artifact directly. */
export async function irrigatePreparedScenario(state: GameState,progress?: (value: unknown)=>void) {
  const started=state.time, preparing=state.scenarioPreparing, paused=state.paused, speed=state.speed;
  const bandits=banditIntensity(state);
  const factions=state.factions.map(f=>({faction:f,gold:f.gold,food:f.food,relation:f.relation}));
  const cities=state.buildings.filter(b=>b.kind==='palace'&&b.faction>=0)
    .map(palace=>({palace,permissions:palace.governorPermissions}));
  state.scenarioPreparing=true;state.paused=false;state.speed=1;
  setBanditIntensity(state,0);
  for (const {faction} of factions) {faction.gold=1e9;faction.food=1e9;faction.relation=faction.id===0?'self':'peace';}
  for (const {palace} of cities) palace.governorPermissions={farms:false,housing:false};
  state.diplomacyState=undefined;refreshDiplomacy(state);
  const orchardsRemoved=removeScenarioOrchards(state);
  let ditchesOrdered=0,farmsOrdered=0;
  const addedFarms=new Set<number>();
  try {
    for (const {faction} of factions) ditchesOrdered+=orderScenarioIrrigation(state,faction.id);
    progress?.({phase:'digging',orchardsRemoved,ditchesOrdered});
    let lastProgress=performance.now();
    const finishOrders=async(): Promise<void>=>{
      while (state.buildings.some(b=>b.hp>0&&(b.kind==='irrigation'||addedFarms.has(b.id))&&b.construction)) {
        if (state.time-started>1800) throw new Error('Scenario builders could not finish the irrigation and food farms.');
        updateGame(state,10,{up:false,down:false,left:false,right:false});
        if (performance.now()-lastProgress>10000) {
          const pending=state.buildings.filter(b=>b.hp>0&&b.kind==='irrigation'&&b.construction);
          progress?.({seconds:Math.round(state.time-started),pending:pending.length,
            ...(state.time-started>=90&&pending.length<=20?{sites:pending.map(b=>({id:b.id,x:b.x,y:b.y,faction:b.faction,builder:b.construction?.builderId}))}:{})});
          lastProgress=performance.now();
        }
        await new Promise<void>(resolve=>setTimeout(resolve,0));
      }
    };
    for (let pass=0;pass<=16;pass++) {
      await finishOrders();
      invalidateCitySummarySnapshot(state);
      const short=citySummaries(state).filter(city=>city.food<10);
      if (!short.length||pass===16) break;
      let placed=0;
      for (const city of short) for(let plot=0;plot<4;plot++) {
        const site=planAutomaticFarmSite(state,city.palace);if(!site)break;
        const order=withPlayerFaction(state,city.palace.faction,()=>buildAt(state,'camp',site.point.x,site.point.y,city.palace.faction,undefined,undefined,true));
        if(!order.ok)break;
        const farm=state.buildings.find(b=>b.kind==='camp'&&b.x===site.point.x&&b.y===site.point.y&&b.faction===city.palace.faction)!;
        addedFarms.add(farm.id);placed++;farmsOrdered++;
      }
      if (!placed) break;
      // Weight new plots only after their normal construction has completed.
      await finishOrders();
      for (const {faction} of factions) ditchesOrdered+=orderScenarioIrrigation(state,faction.id);
    }
    invalidateCitySummarySnapshot(state);
    const summaries=citySummaries(state);
    if (summaries.some(city=>city.population<200||city.food<0))
      throw new Error(`Irrigated scenario cities need at least 200 people and sustainable food: ${JSON.stringify(summaries.map(c=>({id:c.palace.id,pop:c.population,food:c.food})))}`);
    if (state.buildings.some(b=>b.orchard)||state.fields?.some(f=>f.orchard)) throw new Error('An orchard remains in a prepared scenario.');
    return {...scenarioAgricultureSummary(state),orchardsRemoved,ditchesOrdered,farmsOrdered,simulatedSeconds:state.time-started};
  } finally {
    state.scenarioPreparing=preparing;state.paused=paused;state.speed=speed;
    for (const {faction,gold,food,relation} of factions) Object.assign(faction,{gold,food,relation});
    for (const {palace,permissions} of cities) palace.governorPermissions=permissions;
    setBanditIntensity(state,bandits);
    state.diplomacyState=undefined;refreshDiplomacy(state);
    state.events=[];state.particles=[];state.projectiles=[];state.shipSinkings=[];
  }
}
