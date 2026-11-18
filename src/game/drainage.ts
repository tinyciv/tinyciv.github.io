import { rustEngine } from './rust-engine';
import { SimSlot, simCore } from './sim-handle';
import { entityStore } from './entity-store';
import { worldRevisions, worldStructureRevision, markWorldChanged } from './world-revisions';
import { researchLevel } from './research';
import { peasantDispatchQuery } from './peasant-capacity';
import { constructionEdges, updateBuilder } from './builders';
import { workNavigationState, findShortestPathBetween, invalidateNavigation } from './pathfinding';
import { unitPositionBlocked } from './civilian-movement';
import { isForbidden, forbiddenRevision } from './forbidden-zones';
import { invalidateFog } from './fog';
import { invalidateIrrigation } from './irrigation';
import { invalidateSettlementDecisions } from './settlement-decisions';
import { invalidateCitySummarySnapshot } from './cities';
import { terrainYields } from '../world/generator';
import { farmFieldIndex } from './farm-index';
import { buildingReady, buildingWidth, buildingHeight, isFarmKind, WATER, type GameState, type Point, type Terrain, type Unit } from './types';

interface Observations {
  world: GameState['world']; geometry: number; structures: number; buildings: number;
  fieldIndex?: ReturnType<typeof farmFieldIndex>; enabled: string; forbidden: string;
  waterBlockers: string;
}
const observations = new SimSlot<Observations>();
const DRY: readonly Terrain[] = ['grassland', 'grassland', 'plains', 'desert', 'tundra'];
const GROUND_CODES: Partial<Record<Terrain,number>> = {grassland:1,plains:2,desert:3,tundra:4};
type Move = (state: GameState, unit: Unit, goal: Point, dt: number, direct?: boolean, allowPartial?: boolean, avoidForbidden?: boolean) => void;
const clearJourney = (unit: Unit) => { unit.path=undefined; unit.pathGoal=undefined; unit.destination=undefined; unit.repathAt=0; unit.moving=false; };

function publish(state: GameState, mode: number, rows: ArrayLike<number>, count=rows.length): void {
  const handle=simCore(state).handle, pointer=rustEngine.sim_drainage_input(handle,rows.length);
  new Float64Array(rustEngine.memory.buffer,pointer,rows.length).set(rows);
  rustEngine.sim_drainage_commit(handle,mode,state.world.width,state.world.height,count);
}

/** Observe topology and ownership only when their explicit revisions change.
 * Rust owns water components, farm adjacency, technology and job selection. */
function synchronize(state: GameState): void {
  const store=entityStore(state), world=state.world, geometry=worldRevisions(world).geometry;
  const structures=worldStructureRevision(world), fields=farmFieldIndex(state);
  const enabled=state.factions.filter(f=>!f.defeated && researchLevel(f,'drainage')>0).map(f=>f.id);
  const key=enabled.join(','), forbidden=enabled.map(f=>`${f}:${forbiddenRevision(state,f)}`).join(',');
  let old=observations.get(state);
  const fresh=!old || old.world!==world;
  let waterBlockers=old?.waterBlockers??'';
  if (fresh || old?.geometry!==geometry || old?.structures!==structures || old?.buildings!==store.buildings.revision) {
    const blocked=new Set<number>();
    for (const building of state.buildings) if (building.hp>0 && !['bridge','road','irrigation'].includes(building.kind))
      for (let y=building.y;y<building.y+buildingHeight(building);y++) for (let x=building.x;x<building.x+buildingWidth(building);x++) {
        const cell=y*world.width+x, tile=world.tiles[cell];
        if (tile && (WATER.has(tile.terrain)||tile.creek)) blocked.add(cell);
      }
    waterBlockers=[...blocked].sort((a,b)=>a-b).join(',');
    if (fresh || old?.geometry!==geometry || old?.waterBlockers!==waterBlockers) {
      const rows=new Float64Array(world.tiles.length*4);
      world.tiles.forEach((tile,cell)=> {
        const ground=WATER.has(tile.terrain)?tile.creekGround??tile.terrain:tile.terrain;
        rows[cell*4]=tile.terrain==='ocean'||tile.terrain==='coast'?2:WATER.has(tile.terrain)||tile.creek?1:0;
        rows[cell*4+1]=Number(blocked.has(cell)||!!tile.waterfall);
        rows[cell*4+2]=GROUND_CODES[ground]??0;
        rows[cell*4+3]=tile.terrain==='river'||tile.terrain==='lake'?1:WATER.has(tile.terrain)?2:0;
      });
      publish(state,0,rows,world.tiles.length);
    }
  }
  if (fresh || old?.structures!==structures || old?.buildings!==store.buildings.revision || old?.fieldIndex!==fields || old?.forbidden!==forbidden) {
    const owners=new Float64Array(world.tiles.length).fill(-1);
    for (const building of state.buildings) if (isFarmKind(building.kind) && buildingReady(building))
      for (let y=building.y;y<building.y+buildingHeight(building);y++) for (let x=building.x;x<building.x+buildingWidth(building);x++)
        if (!isForbidden(state,x,y,building.faction)) owners[y*world.width+x]=building.faction;
    for (const field of fields.source) {
      const camp=store.buildings.get(field.camp);
      if (camp && buildingReady(camp) && !isForbidden(state,field.x,field.y,camp.faction)) owners[field.y*world.width+field.x]=camp.faction;
    }
    publish(state,1,owners);
  }
  if (fresh || old?.enabled!==key) publish(state,2,enabled);
  old={world,geometry,structures,buildings:store.buildings.revision,fieldIndex:fields,enabled:key,forbidden,waterBlockers}; observations.set(state,old);
  const workers:number[]=[], dispatchable=peasantDispatchQuery(state);
  for (const worker of store.units.query('builder')) if (worker.kind==='worker' && worker.hp>0) {
    const available=worker.inside && !worker.builderRetiring && !worker.drainageWork && (!worker.buildPhase || worker.buildPhase==='idle')
      && worker.buildSite===undefined && worker.repairSite===undefined && !worker.clearTree && dispatchable(worker);
    workers.push(worker.id,worker.faction,worker.x,worker.y,Number(available),worker.drainageWork?.cell??-1,worker.drainageWork?.progress??0,
      worker.home??-1,worker.drainageWork?.farms[0]??-1,worker.drainageWork?.farms[1]??-1);
  }
  publish(state,3,workers,workers.length/10);
}

/** One native dispatch per second uses the ordinary city's resident builders. */
export function updateDrainage(state: GameState): void {
  if (state.paused || state.gameOver) return;
  synchronize(state);
  const handle=simCore(state).handle, pointer=rustEngine.sim_drainage_plan(handle,state.time);
  if (!rustEngine.sim_drainage_length(handle)) return;
  const [workerId,cell,farm0,farm1]=new Float64Array(rustEngine.memory.buffer,pointer,4).slice();
  const store=entityStore(state), worker=store.units.get(workerId), palace=store.buildings.get(worker?.home??-1);
  if (!worker || !palace || !buildingReady(palace)) { rustEngine.sim_drainage_release(handle,workerId,state.time); return; }
  if (isForbidden(state,cell%state.world.width,Math.floor(cell/state.world.width),worker.faction)) {
    rustEngine.sim_drainage_release(handle,workerId,state.time); return;
  }
  const navigation=workNavigationState(state,true,-1,undefined,false);
  const shorePointer=rustEngine.sim_drainage_shores(handle,cell);
  const shores=new Float64Array(rustEngine.memory.buffer,shorePointer,rustEngine.sim_drainage_length(handle)).slice();
  const goals=Array.from(shores,bank=>({x:bank%state.world.width+.5,y:Math.floor(bank/state.world.width)+.5}))
    .filter(point=>!isForbidden(state,point.x,point.y,worker.faction)&&!unitPositionBlocked(state,worker,point));
  const exits=constructionEdges(navigation,palace,true).filter(exit=>!unitPositionBlocked(state,worker,exit));
  const journey=findShortestPathBetween(navigation,exits,goals,worker.faction,true);
  if (!journey) { rustEngine.sim_drainage_release(handle,workerId,state.time); return; }
  const goal=journey.to, workCell=Math.floor(goal.y)*state.world.width+Math.floor(goal.x);
  worker.x=journey.from.x; worker.y=journey.from.y; worker.inside=false; worker.order='hold'; worker.buildPhase='outbound';
  worker.aboardRowboat=false;
  worker.path=journey.path; worker.pathGoal={...goal}; worker.destination=goal; worker.repathAt=0;
  worker.drainageWork={cell,workCell,progress:0,farms:[farm0,farm1]};
  store.setWorkerDormant(worker, false);
}

function finish(state: GameState, unit: Unit): void {
  rustEngine.sim_drainage_release(simCore(state).handle,unit.id,state.time);
  delete unit.drainageWork; clearJourney(unit); unit.buildPhase=unit.inside?'idle':'returning'; unit.order='work';
}

/** Apply a native terrain event through the standard revision/publication path. */
function fill(state: GameState, cell: number, terrainCode: number): void {
  const tile=state.world.tiles[cell]; if (!tile) return;
  tile.terrain=DRY[terrainCode]??'grassland'; tile.overlay='none';
  tile.biome=tile.terrain==='tundra'?'tundra':tile.terrain==='desert'?'desert':tile.terrain==='plains'?'steppe':'temperate';
  Object.assign(tile,terrainYields(tile.terrain,tile.overlay));
  delete tile.resource; delete tile.resourceGroup; delete tile.resourceDeveloped;
  delete tile.creek; delete tile.creekGround; delete tile.channel; delete tile.channelWidth; delete tile.channelNext;
  delete tile.riverArt; delete tile.oxbow; delete tile.waterfall; delete tile.lakeShape; delete tile.fordAxis;
  delete tile.marsh; delete tile.beach; tile.drainage=-1; tile.flow=0;
  const handle=simCore(state).handle, pointer=rustEngine.sim_drainage_soil(handle,cell);
  const soils=new Float64Array(rustEngine.memory.buffer,pointer,rustEngine.sim_drainage_length(handle)).slice(), changed:number[]=[];
  for (let i=0;i<soils.length;i+=2) { state.world.tiles[soils[i]].fertility=soils[i+1]; changed.push(soils[i]); }
  markWorldChanged(state.world,'geometry',changed); invalidateNavigation(state); invalidateFog(state); invalidateIrrigation(state);
  invalidateSettlementDecisions(state); invalidateCitySummarySnapshot(state);
}

/** The native job advances only while this resident works on its dry bank. */
export function updateDrainageWorker(state: GameState, unit: Unit, dt: number, move: Move): void {
  const job=unit.drainageWork; if (!job) return;
  const active=!unit.inside && !unit.builderRetiring && unit.hp>0 && unit.order!=='flee' && !isForbidden(state,unit.x,unit.y,unit.faction)
    && !isForbidden(state,job.cell%state.world.width,Math.floor(job.cell/state.world.width),unit.faction);
  const pointer=rustEngine.sim_drainage_step(simCore(state).handle,unit.id,job.cell,job.workCell,unit.faction,unit.x,unit.y,Number(active),dt);
  const [phase,progress,terrain]=new Float64Array(rustEngine.memory.buffer,pointer,3).slice(); job.progress=progress;
  if (phase===0 || phase===3) {
    if (phase===3) fill(state,job.cell,terrain);
    finish(state,unit); updateBuilder(state,unit,dt,move); return;
  }
  if (phase===2) {
    unit.order='work'; unit.buildPhase='working'; unit.aboardRowboat=false; unit.attackTime=0; clearJourney(unit);
    unit.facing=Math.atan2(Math.floor(job.cell/state.world.width)+.5-unit.y,job.cell%state.world.width+.5-unit.x);
    return;
  }
  unit.order='hold'; unit.buildPhase='outbound';
  const goal={x:job.workCell%state.world.width+.5,y:Math.floor(job.workCell/state.world.width)+.5};
  move(state,unit,goal,dt,false,false,true);
  if ((unit.stuckFor??0)>5) { finish(state,unit); updateBuilder(state,unit,dt,move); }
}
