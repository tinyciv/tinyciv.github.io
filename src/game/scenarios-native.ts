import { rustEngine } from './rust-engine';
import { BUILDING_KIND_CODES } from './entity-store';
import { generateWorld, terrainYields } from '../world/generator';
import { mirrorScenarioLandscape } from '../world/scenario-geography';
import { SHIP_CLASSES, MARINE_TYPES, NAVAL_WEAPONS } from './warships-native';
import { type ScenarioId, SCENARIOS } from './scenario-content';
import { reliefFootprintAllowed } from './relief';
import { settlementTerrainMask } from './terrain-sites';
import { traversable } from './pathfinding';
import { navigableWaterCell } from './water-navigation';
import { RESEARCH_BRANCHES } from './research';
import { assignOreDeposits } from '../world/ore-native';
import { buildingWidth, buildingHeight } from './types';
import type { BuildingKind, World, WarshipClass, MarineType, NavalWeapon, ResearchBranchId } from './types';

export interface ScenarioBuilding {
  kind: BuildingKind; faction: number; x: number; y: number; residents: number; houseLevel: number; initialCity: boolean;
  cityIndex?: number;
}
export interface ScenarioShip {
  faction: number; x: number; y: number; yardX: number; yardY: number;
  class: WarshipClass; marine: MarineType; weapon: NavalWeapon; facing: number;
}
export interface ScenarioPlan {
  world: World; buildings: ScenarioBuilding[]; ships: ScenarioShip[];
  gold: number; food: number; population: number; researchLevel: number; banditIntensity: number; startingResearch?: ResearchBranchId[];
  musketFraction?: number; startingCannons?: number;
  completeLayouts?: boolean;
}
const kinds = Object.fromEntries(Object.entries(BUILDING_KIND_CODES).map(([kind, code]) => [code, kind])) as Record<number, BuildingKind>;

/** Observation transport into the native scenario planner. Terrain is always
 * produced by the normal geography/climate/river/ecology generator. */
export function scenarioTerrain(handle: number, world: World): void {
  const mask = settlementTerrainMask(world), facts = new Float64Array(world.tiles.length * 2);
  for (let i = 0; i < world.tiles.length; i++) {
    const x=i%world.width,y=Math.floor(i/world.width),tile=world.tiles[i];
    facts[i*2] = Number(traversable(world,x,y)) | ((mask[i]&3)===3 && reliefFootprintAllowed(world,x,y) ? 2 : 0)
      | (navigableWaterCell(world,x,y) && (tile.terrain === 'ocean' || tile.terrain === 'coast') ? 4 : 0)
      | (tile.terrain==='river'||tile.terrain==='lake'?8:0);
    if(tile.overlay==='forest')facts[i*2]|=16;
    facts[i*2+1] = tile.food * (tile.fertility ?? 1);
  }
  const pointer = rustEngine.sim_scenario_input(handle, facts.length, world.width, world.height);
  new Float64Array(rustEngine.memory.buffer,pointer,facts.length).set(facts);
}
export function scenarioEquipment(handle:number, world:World): ScenarioBuilding[] {
  scenarioTerrain(handle,world);
  const pointer=rustEngine.sim_scenario_equipment(handle), count=new Float64Array(rustEngine.memory.buffer,pointer,1)[0];
  const rows=new Float64Array(rustEngine.memory.buffer,pointer+8,count*7).slice();
  return Array.from({length:count},(_,i)=>({kind:kinds[rows[i*7]],faction:rows[i*7+1],x:rows[i*7+2],y:rows[i*7+3],residents:0,houseLevel:0,initialCity:false}));
}
export function symmetricScenarioSites(handle:number,world:World,sites:readonly {kind:BuildingKind;x:number;y:number}[]): {kind:BuildingKind;faction:number;x:number;y:number}[] {
  const pointer=rustEngine.sim_scenario_input(handle,sites.length*3,world.width,world.height);
  new Float64Array(rustEngine.memory.buffer,pointer,sites.length*3).set(sites.flatMap(site=>[BUILDING_KIND_CODES[site.kind],site.x,site.y]));
  const output=rustEngine.sim_scenario_symmetric_sites(handle,sites.length),count=new Float64Array(rustEngine.memory.buffer,output,1)[0];
  const rows=new Float64Array(rustEngine.memory.buffer,output+8,count*4).slice();
  return Array.from({length:count},(_,i)=>({faction:rows[i*4],kind:kinds[rows[i*4+1]],x:rows[i*4+2],y:rows[i*4+3]}));
}
export function scenarioPlan(id: ScenarioId, seed: string = id): ScenarioPlan {
  const code = SCENARIOS.findIndex(scenario => scenario.id === id);
  if (code < 0) throw new Error('Unknown scenario.');
  const handle = rustEngine.sim_create(261116);
  try {
    for(let attempt=0;attempt<(id==='tutorial'||id==='island-deathmatch'||id==='sandbox'||id==='musketry-deathmatch'?128:12);attempt++) {
      const exploration=id==='age-of-exploration';
      const tutorial=id==='tutorial'||id==='island-deathmatch', island=id==='island-deathmatch', sandbox=id==='sandbox', musket=id==='musketry-deathmatch';
      const world=generateWorld(`Scenario:${id}:${seed}:${attempt}`,musket?160:island?110:tutorial||sandbox?80:exploration?320:240,musket?39:island?50:sandbox?60:tutorial?30:exploration?280:144,
        tutorial||sandbox||musket?{style:'pangaea',oceanChannelWidth:island?4:undefined,settlements:false,landformFamily:'rolling-uplands',parameters:{seaLevel:60,age:5,forestThreshold:.61,forestNorthBias:.06,riverCount:3,lakeDensity:.5}}
          :{style:exploration?'fractal':'pangaea',parameters:exploration?{islandDensity:1.8,islandSize:1.5}:undefined});
      if (musket) mirrorScenarioLandscape(world);
      // Select an ordinary generated landscape that contains every regional
      // resource; no resource or terrain cells are painted for Sandbox.
      if(sandbox) {
        const resources=new Set(world.tiles.map(tile=>tile.resource));
        if((['clay','copper','iron','gold','stone','salt','olives','fish'] as const).some(resource=>!resources.has(resource)))continue;
      }
      scenarioTerrain(handle,world);
      const pointer = rustEngine.sim_scenario_prepare(handle,code,world.width,world.height);
      if(new Float64Array(rustEngine.memory.buffer,pointer,1)[0]===0)continue;
      const values = new Float64Array(rustEngine.memory.buffer,pointer,rustEngine.sim_scenario_length(handle)).slice();
      const [, , factions, buildingCount, shipCount, gold, food, population, researchLevel, banditIntensity] = values;
      let cursor=10;
      world.spawns=Array.from({length:factions},()=>({x:values[cursor++],y:values[cursor++]}));world.secondarySpawns=[];world.scenario=id;
      // The scenario planner has already separated its towns. The random
      // world's multiplayer spawn spacing must not displace them again.
      world.minimumFactionStartDistance = undefined;
      if(tutorial||musket) {
        // The same native geology/access planner creates modest outcrops,
        // reserving every founding footprint rather than painting ore tiles.
        const cores=new Uint8Array(world.tiles.length);
        for(const spawn of world.spawns)for(let dy=-5;dy<=6;dy++)for(let dx=-5;dx<=6;dx++) {
          const x=spawn.x+dx,y=spawn.y+dy;
          if(x>=0&&y>=0&&x<world.width&&y<world.height)cores[y*world.width+x]=1;
        }
        // Reserve each authored civic/harbor footprint before the ordinary ore
        // planner places the small starter outcrops.
        for (let row=0;row<buildingCount;row++) {
          const offset=10+factions*2+row*7, kind=kinds[values[offset]], bx=values[offset+2], by=values[offset+3];
          for (let dy=-1;dy<=buildingHeight({kind});dy++) for (let dx=-1;dx<=buildingWidth({kind});dx++) {
            const x=bx+dx,y=by+dy;
            if(x>=0&&y>=0&&x<world.width&&y<world.height)cores[y*world.width+x]=1;
          }
        }
        assignOreDeposits(world,cores,true);
        if(musket)mirrorScenarioLandscape(world);
        if([0,1].some(side=>['copper','iron'].some(kind=>!world.tiles.some((tile,i)=>tile.resource===kind&&Number(i%world.width>=world.width/2)===side))))continue;
        if(tutorial) {
          scenarioTerrain(handle,world);
          const treesPointer=rustEngine.sim_scenario_woodland(handle),treeCount=new Float64Array(rustEngine.memory.buffer,treesPointer,1)[0];
          const cleared=new Float64Array(rustEngine.memory.buffer,treesPointer+8,treeCount).slice();
          for(const cell of cleared) {
            const tile=world.tiles[cell],before=terrainYields(tile.terrain,tile.overlay),after=terrainYields(tile.terrain,'none');
            tile.overlay='none';delete tile.treeClass;
            tile.food+=after.food-before.food;tile.production+=after.production-before.production;tile.gold+=after.gold-before.gold;
          }
        }
      }
      const buildings=Array.from({length:buildingCount},():ScenarioBuilding=>{
        const kind=kinds[values[cursor++]],faction=values[cursor++],x=values[cursor++],y=values[cursor++],residents=values[cursor++],houseLevel=values[cursor++],city=values[cursor++];
        return {kind,faction,x,y,residents,houseLevel,initialCity:kind==='palace'&&!!city,cityIndex:musket&&kind!=='palace'?city-1:undefined};
      });
      const ships=Array.from({length:shipCount},():ScenarioShip=>({faction:values[cursor++],x:values[cursor++],y:values[cursor++],yardX:values[cursor++],yardY:values[cursor++],class:SHIP_CLASSES[values[cursor++]],marine:MARINE_TYPES[values[cursor++]],weapon:NAVAL_WEAPONS[values[cursor++]],facing:values[cursor++]}));
      const startingResearch = new Set<ResearchBranchId>();
      const include = (id: ResearchBranchId): void => {
        if (startingResearch.has(id)) return;
        startingResearch.add(id);
        for (const prerequisite of RESEARCH_BRANCHES.find(branch => branch.id === id)!.prerequisites) include(prerequisite);
      };
      if (island) for (const tech of ['sailing','whaling','woodenTower','monument','blacksmith','archeryRange','siegeEngines'] as const) include(tech);
      return {world,buildings,ships,gold,food,population,researchLevel,banditIntensity,startingResearch:[...startingResearch],
        musketFraction:musket?values[cursor++]:undefined,startingCannons:musket?values[cursor++]:undefined,completeLayouts:musket?!!values[cursor++]:undefined};
    }
    throw new Error('This scenario could not find suitable natural founding sites. Try generating it again.');
  } finally {rustEngine.sim_drop(handle);}
}
