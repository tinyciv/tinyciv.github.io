import { rustEngine } from '../../src/game/rust-engine';
import { simCore } from '../../src/game/sim-handle';
import { territory } from '../../src/game/borders';
import { territoryValue } from '../../src/game/territory-cells';
import { reliefBuildable } from '../../src/game/relief';
import { resourceBlocksGround } from '../../src/game/resource-terrain';
import { forbiddenCells } from '../../src/game/forbidden-zones';
import { buildAt } from '../../src/game/simulation';
import { withPlayerFaction } from '../../src/game/player-context';
import { fieldHarvestFood, invalidateScheduledHarvests, synchronizeFarms } from '../../src/game/farms';
import { buildingWidth, buildingHeight, buildingReady, isFarmKind, WATER, type GameState } from '../../src/game/types';

/** Existing simulation-grown cities keep their people, houses and farms.
 * Converted fields resume their ordinary wheat harvest lifecycle. */
export function removeScenarioOrchards(state: GameState): number {
  let removed=0;
  for (const farm of state.buildings) if (isFarmKind(farm.kind) && farm.orchard) {
    delete farm.orchard;farm.farmLastVisitedAt=state.time;farm.farmFallow=false;delete farm.farmAbandonedAt;removed++;
  }
  if (removed || state.fields?.some(field=>field.orchard)) {
    for (const field of state.fields??[]) delete field.orchard;
    state.farmVersion=(state.farmVersion??0)+1;
    invalidateScheduledHarvests(state);synchronizeFarms(state);
  }
  return removed;
}

/** Publish observed terrain/ownership/structures only. The native scenario
 * resource plans freshwater feeders and useful branches; real purchases then
 * enforce all siting rules and real builders complete their construction. */
export function orderScenarioIrrigation(state: GameState,faction: number,coverage=.9): number {
  const {world}=state, {width,height}=world, n=width*height, handle=simCore(state).handle;
  const borders=territory(state), forbidden=forbiddenCells(state,faction);
  const flags=new Float64Array(n),weights=new Float64Array(n);
  for (let cell=0;cell<n;cell++) {
    const tile=world.tiles[cell];
    flags[cell]=Number(!WATER.has(tile.terrain) && reliefBuildable(tile) && !resourceBlocksGround(tile)
      && territoryValue(borders,cell)===faction && !forbidden.has(cell))
      | Number(tile.terrain==='river'||tile.terrain==='lake')<<2;
  }
  for (const b of state.buildings) if (b.hp>0) {
    if (b.kind==='irrigation') {flags[b.y*width+b.x]|=2;continue;}
    if (b.faction===faction && (isFarmKind(b.kind)||b.kind==='road')) continue;
    for (let dy=0;dy<buildingHeight(b);dy++) for (let dx=0;dx<buildingWidth(b);dx++) {
      const x=b.x+dx,y=b.y+dy;if(x>=0&&y>=0&&x<width&&y<height) flags[y*width+x]&=~1;
    }
  }
  for (const hermit of state.hermits??[]) for(let dy=0;dy<(hermit.status==='gone'?1:2);dy++) for(let dx=0;dx<(hermit.status==='gone'?1:2);dx++) {
    const x=hermit.x+dx,y=hermit.y+dy;if(x>=0&&y>=0&&x<width&&y<height) flags[y*width+x]&=~1;
  }
  const farms=new Map(state.buildings.filter(b=>b.faction===faction && isFarmKind(b.kind) && buildingReady(b)
    && !b.farmSuppressed && !b.farmFallow).map(b=>[b.id,b]));
  for (const field of state.fields??[]) if (farms.has(field.camp)) weights[field.y*width+field.x]+=fieldHarvestFood(world,field.x,field.y);
  let added=0;
  for(let pass=0;pass<8;pass++) {
    const pointer=rustEngine.sim_scenario_input(handle,n*2,width,height);
    const input=new Float64Array(rustEngine.memory.buffer,pointer,n*2);
    for(let cell=0;cell<n;cell++){input[cell*2]=flags[cell];input[cell*2+1]=weights[cell];}
    const result=rustEngine.sim_scenario_irrigation(handle,coverage);
    const count=new Float64Array(rustEngine.memory.buffer,result,1)[0];
    const cells=Array.from(new Float64Array(rustEngine.memory.buffer,result+24,count));
    if (!count) break;
    let failed=false;
    for (const cell of cells) {
      const order=withPlayerFaction(state,faction,()=>buildAt(state,'irrigation',cell%width,Math.floor(cell/width),faction,undefined,undefined,true));
      if (order.ok) {flags[cell]|=2;added++;}
      else {flags[cell]&=~1;failed=true;break;}
    }
    if (!failed) break;
  }
  return added;
}
