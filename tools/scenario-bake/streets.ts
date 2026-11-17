import { auditScenarioStreets, scenarioRoadPlan, scenarioStreetRelocationSites } from '../../src/game/scenario-access-native';
import { explorationHost } from '../../src/game/exploration-host';
import { entityStore } from '../../src/game/entity-store';
import { canWalk, invalidateNavigation } from '../../src/game/pathfinding';
import { markWorldChanged } from '../../src/game/world-revisions';
import { refreshAfterBuildingRemoval, validateBuildAt } from '../../src/game/simulation';
import { planRoadFarmRelocation, relocateFarm, farmAt } from '../../src/game/farm-relocation';
import { removeBuildings } from '../../src/game/construction-cancellation';
import { sharedHouseForWell, sharedWellForHouse } from '../../src/game/house-wells';
import { buildingHeight, buildingWidth, isFarmKind, type GameState } from '../../src/game/types';

const cellOf=(state:GameState,b:{x:number;y:number})=>b.y*state.world.width+b.x;
const streetFactions=(state:GameState)=>state.factions.filter(f=>!f.defeated);
export function scenarioStreetsSummary(state:GameState){
  return streetFactions(state).map(f=>({faction:f.id,...auditScenarioStreets(state,f.id)}));
}

/** Offline authoring only. Rust selects reservations, relocation choices and
 * complete street paths. Existing constructors/farm commands publish them as
 * prepared starting infrastructure without advancing the campaign clock. */
export function repairPreparedStreets(state:GameState,progress?:(value:unknown)=>void){
  const before=scenarioStreetsSummary(state),preparing=state.scenarioPreparing;
  const clock=state.time,stocks=state.factions.map(f=>({f,gold:f.gold,food:f.food,population:f.population,research:JSON.stringify(f.research)}));
  const moved:{id:number;kind:string;from:{x:number;y:number};to:{x:number;y:number}}[]=[];
  const removedRoads:number[]=[],farmsMoved:number[]=[],farmsCleared:number[]=[];
  const changedFactions=new Set<number>();let roadsAdded=0;
  const relocated=new Set<number>();
  state.scenarioPreparing=true;
  try{
    // Preserve the actual buildings and their residents/garrisons. Only objects
    // identified by the native audit as covering a road reservation move.
    for(let pass=0;pass<4;pass++){
      const blockers=new Set(scenarioStreetsSummary(state).flatMap(r=>r.blockers));
      if(!blockers.size)break;
      let changes=0;
      for(const id of blockers){
        const building=entityStore(state).buildings.get(id);if(!building||building.hp<=0||relocated.has(id))continue;
        if(building.kind==='palace'||building.kind==='shipyard'||building.kind==='fort')
          throw new Error(`A protected ${building.kind} ${id} overlaps a scenario street.`);
        // Roads under defensive walls are gates. The generic walking audit
        // treats walls as solid, but their ordinary faction gate rule applies.
        if((building.kind==='wall'||building.kind==='palisade')
          &&canWalk(state,building.x+.5,building.y+.5,building.faction))continue;
        const attached=sharedHouseForWell(building,state.buildings)??sharedWellForHouse(building,state.buildings);
        const group=attached?[building,attached]:[building],ids=new Set(group.map(b=>b.id));
        const preview={...state,buildings:state.buildings.filter(b=>!ids.has(b.id))};
        let placed=false;
        for(const point of scenarioStreetRelocationSites(state,building)){
          const cells=new Set<number>();
          for(let dy=0;dy<buildingHeight(building);dy++)for(let dx=0;dx<buildingWidth(building);dx++)cells.add((point.y+dy)*state.world.width+point.x+dx);
          if(state.fields?.some(f=>cells.has(cellOf(state,f)))||state.buildings.some(b=>b.hp>0&&isFarmKind(b.kind)&&cells.has(cellOf(state,b))))continue;
          if(!validateBuildAt(preview,building.kind,point.x,point.y,building.faction,undefined,false,true).ok)continue;
          for(const b of group){const from={x:b.x,y:b.y};b.x=point.x;b.y=point.y;
            moved.push({id:b.id,kind:b.kind,from,to:{...point}});changedFactions.add(b.faction);relocated.add(b.id);}
          markWorldChanged(state.world);invalidateNavigation(state);placed=true;changes++;break;
        }
        if(!placed)throw new Error(`No nearby clear relocation for blocking ${building.kind} ${id}.`);
      }
      if(!changes)break;
    }
    // Remove obsolete painted road fragments on impassable natural cells.
    // Native street paths reconnect their surviving ends around the obstacle.
    const bad=new Set(scenarioStreetsSummary(state).flatMap(r=>r.blockedRoads));
    const roads=state.buildings.filter(b=>b.kind==='road'&&b.hp>0&&bad.has(cellOf(state,b)));
    if(roads.length){removeBuildings(state,new Set(roads.map(b=>b.id)));removedRoads.push(...roads.map(b=>b.id));}
    for(const faction of streetFactions(state)){
      const plan=scenarioRoadPlan(state,faction.id),reserved=new Set(plan.map(p=>cellOf(state,p)));
      for(const point of plan){
        if(state.buildings.some(b=>b.hp>0&&(b.kind==='road'||b.kind==='bridge')&&b.x===point.x&&b.y===point.y))continue;
        const farm=farmAt(state,point,faction.id);
        if(farm){const relocation=planRoadFarmRelocation(state,point,faction.id,reserved);
          if(relocation&&relocateFarm(state,relocation,point,{wall:true,road:true,reservedTiles:reserved}))farmsMoved.push(farm.id);
          else {removeBuildings(state,new Set([farm.id]));farmsCleared.push(farm.id);refreshAfterBuildingRemoval(state,faction.id);}}
        explorationHost().building(state,'road',faction.id,point);roadsAdded++;changedFactions.add(faction.id);
      }
      progress?.({faction:faction.id,roadsAdded,moved:moved.length,farmsMoved:farmsMoved.length,farmsCleared:farmsCleared.length});
    }
    markWorldChanged(state.world);invalidateNavigation(state);
    for(const faction of changedFactions)explorationHost().changed(state,faction);
    const after=scenarioStreetsSummary(state);
    const errors=after.filter(r=>r.missingRing.length||r.unserved.length||r.roadRegions!==r.expectedRoadRegions||r.blockedRoads.length);
    if(errors.length)throw new Error('Scenario streets remain incomplete: '+JSON.stringify(errors));
    if(state.time!==clock||stocks.some(({f,gold,food,population,research})=>f.gold!==gold||f.food!==food||f.population!==population||JSON.stringify(f.research)!==research))
      throw new Error('Street preparation must preserve campaign clocks, population, stocks and research.');
    return {before,after,moved,removedRoads,roadsAdded,farmsMoved,farmsCleared};
  }finally{state.scenarioPreparing=preparing;}
}
