import { provisionScenarioWhales } from '../../src/game/fishing';
import { createGame, updateGame } from '../../src/game/simulation';
import { scenarioPlan, scenarioEquipment } from '../../src/game/scenarios-native';
import { prepareScenarioFleet } from '../../src/game/warships-native';
import { citySummaries } from '../../src/game/cities';
import { simCore } from '../../src/game/sim-handle';
import { rustEngine } from '../../src/game/rust-engine';
import { factionHasDevelopedResource, developResourceGroup, resourceDevelopmentStatus } from '../../src/game/resource-development';
import { refreshDiplomacy, negotiateDiplomacy } from '../../src/game/diplomacy';
import { revealExplorationCells } from '../../src/game/fog';
import type { ScenarioId } from '../../src/game/scenario-content';
import type { GameState } from '../../src/game/types';
import type { BuildingKind } from '../../src/game/types';
import { nativeInstitutionPlan } from '../../src/game/institution-native';
import { cityGranary } from '../../src/game/granaries-native';
import { farmCityQuery } from '../../src/game/farm-travel';
import { planHouseSite } from '../../src/game/housing';
import { governingPalace } from '../../src/game/governor';
import { withPlayerFaction } from '../../src/game/player-context';
import { canReachConstruction, constructionEdges } from '../../src/game/builders';
import { planAutomaticFarmSite } from '../../src/game/farm-siting';
import { demolishBuildingsInArea } from '../../src/game/area-tools';
import { buildingWidth, buildingHeight } from '../../src/game/types';
import { finalizePreparedScenario } from './finalize';
import { orderScenarioIrrigation, removeScenarioOrchards } from './irrigation';
import { irrigatePreparedScenario } from './agriculture';
import { purchaseScenarioBuilding as purchase,retireScenarioBuilding as retireShipyard } from './orders';
import { polishScenarioLayout } from './layout';
import { convertFieldCannon } from '../../src/game/field-cannons-native';
import { updateQuests } from '../../src/game/quests';
import { initializeVillages } from '../../src/game/villages';
import { initializeVillageTrails } from '../../src/game/village-trails';
import { grantExplorationTechnology, RESEARCH_BRANCHES, researchLevel } from '../../src/game/research';
import { repairPreparedStreets } from './streets';
const NO_INPUT = {up:false,down:false,left:false,right:false};
/** Offline authoring issues ordinary purchases at the chosen site, as a
 * player standing there would. Native placement and builder routes still apply;
 * no structures or residents are stamped into the finished city. */
function atSite(state: GameState, x: number, y: number, faction: number, command: () => boolean): boolean {
  const leader = state.units.find(unit => unit.kind === 'leader' && unit.faction === faction);
  if (!leader) return false;
  const previous = { x: leader.x, y: leader.y };
  leader.x = x + .5; leader.y = y + .5;
  try { return withPlayerFaction(state, faction, command); }
  finally { leader.x = previous.x; leader.y = previous.y; }
}

/** Reuse production siting for the offline author's civic works. Ordinary
 * governors still lay out farms, roads and homes, and builders finish orders. */
function civicWorks(state: GameState): void {
  for (const faction of state.factions) orderScenarioIrrigation(state,faction.id);
  for (const city of citySummaries(state).filter(city => city.palace.scenarioCity && city.population < 200)) {
    const palace = city.palace;
    // Repair an old checkpoint whose former planner filled every palace exit.
    // The normal demolition command reopens one occupied edge, and the native
    // access check now prevents subsequent civic orders from sealing it again.
    if (!constructionEdges(state,palace).length) {
      const edges = state.buildings.filter(b => b.faction === palace.faction && b.hp > 0 && b.id !== palace.id
        && !['camp','road','bridge','house','palace'].includes(b.kind)
        && b.x <= palace.x+2 && b.x+buildingWidth(b) >= palace.x
        && b.y <= palace.y+2 && b.y+buildingHeight(b) >= palace.y);
      for (const b of edges) {
        atSite(state,b.x,b.y,palace.faction,()=>demolishBuildingsInArea(state,b,b,palace.faction).ok);
        if (constructionEdges(state,palace).length) break;
      }
    }
    if (!cityGranary(state, palace) && city.population >= 60) {
      const owner = farmCityQuery(state, palace.faction);
      const farms = state.buildings.filter(b => b.kind === 'camp' && b.faction === palace.faction
        && b.hp > 0 && !b.construction && owner(b)?.id === palace.id);
      const sites = nativeInstitutionPlan(state, palace.faction, 5, [palace.x, palace.y, state.world.width, state.world.height,
        ...farms.slice(0,256).flatMap(farm => [farm.x+.5,farm.y+.5])]);
      for (let i = 0; i < sites.length; i += 2) {
        if (governingPalace(state,{x:sites[i]+1,y:sites[i+1]+1},palace.faction)?.id === palace.id
          && purchase(state,'granary',sites[i],sites[i+1],palace.faction)) break;
      }
    }
    if (city.population >= 90 && city.food < Math.max(10,city.population*.15)) {
      for (let plot=0;plot<4;plot++) {
        const site = planAutomaticFarmSite(state,palace);
        if (!site || !purchase(state,'camp',site.point.x,site.point.y,palace.faction)) break;
      }
    }
    if (city.housing < 208 && city.housing <= city.population + 8
      && state.buildings.filter(b => b.kind === 'house' && b.construction && governingPalace(state,b,b.faction)?.id === palace.id).length < 4) {
      const home = planHouseSite(state,palace,()=>false,point=>governingPalace(state,point,palace.faction)?.id === palace.id);
      if (home) purchase(state,'house',home.point.x,home.point.y,palace.faction);
      else if (city.food > 10) {
        // A coastal town can exhaust replacement farmland. Issue the same
        // manual redevelopment a player can buy, keeping its builder route.
        const owner = farmCityQuery(state,palace.faction);
        const farms = state.buildings.filter(b => b.kind === 'camp' && b.faction === palace.faction
          && b.hp > 0 && !b.construction && owner(b)?.id === palace.id)
          .sort((a,b)=>Math.hypot(a.x-palace.x,a.y-palace.y)-Math.hypot(b.x-palace.x,b.y-palace.y)||a.id-b.id);
        for (const farm of farms) {
          if (canReachConstruction(state,palace,{...farm,id:-1,kind:'house'})
            && purchase(state,'house',farm.x,farm.y,palace.faction)) break;
        }
      }
    }
  }
}

function provisionIron(state: GameState): void {
  for (const faction of state.factions) {
    if (factionHasDevelopedResource(state, faction.id, 'iron')) continue;
    const cell = state.world.tiles.findIndex((tile, i) => tile.resource === 'iron'
      && resourceDevelopmentStatus(state, i % state.world.width, Math.floor(i / state.world.width), faction.id).ok);
    if (cell >= 0) developResourceGroup(state, cell % state.world.width, Math.floor(cell / state.world.width), faction.id);
    if (!factionHasDevelopedResource(state, faction.id, 'iron')) throw new Error(`No usable iron supply for ${faction.name}; choose another bake seed.`);
  }
}

/** Run the ordinary simulation once while producing the reusable artifact. */
export async function prepareScenario(id: ScenarioId, progress?: (population: number, state: GameState) => void, seed?: string, resume?: GameState): Promise<GameState> {
  const scenario = resume ? { world: resume.world, population: id==='sandbox'?20:200,
    gold: id==='sandbox'?500:15000, food: id==='sandbox'?500:12000 } : scenarioPlan(id, seed);
  const state = resume ?? createGame(scenario.world, undefined, { scenario: scenario as ReturnType<typeof scenarioPlan>, banditIntensity: 0 });
  if(id==='sandbox') {
    if(!state.villages?.length)delete state.villages;
    initializeVillages(state);
    initializeVillageTrails(state);
  }
  if(id==='tutorial'||id==='island-deathmatch'||id==='sandbox'||id==='musketry-deathmatch') {
    // The production founding layout already supplies homes, farms, streets,
    // workers and escorts. This small start needs no simulated city-growth bake.
    if (id==='island-deathmatch' && provisionScenarioWhales(state)!==2) throw new Error('Both island harbors need reachable whale resources.');
    if (id==='musketry-deathmatch') {
      // Resumed authoring keeps the prepared world while bringing its all-tech
      // start up to the current research content, using native completions.
      for (const faction of state.factions) for (const branch of RESEARCH_BRANCHES)
        if (!researchLevel(faction, branch.id)) grantExplorationTechnology(state, faction, branch.id);
      if (state.factions.some(faction => RESEARCH_BRANCHES.some(branch => !researchLevel(faction, branch.id))))
        throw new Error('Musketry Deathmatch requires every current technology, including Officer Corps.');
    }
    if (id==='musketry-deathmatch' && !resume) {
      for (const faction of state.factions) {
        const foundry=state.buildings.find(building=>building.faction===faction.id&&building.kind==='foundry');
        if(!foundry)throw new Error('Each army needs its starting foundry.');
        const soldiers=state.units.filter(unit=>unit.faction===faction.id&&unit.kind==='musketman');
        for (const soldier of soldiers.slice(0,(scenario as ReturnType<typeof scenarioPlan>).startingCannons)) {
          soldier.x=foundry.x+1;soldier.y=foundry.y+1;
          let message='';
          const converted=atSite(state,foundry.x,foundry.y,faction.id,()=>{
            const result=convertFieldCannon(state,foundry,soldier);message=result.message;return result.ok;
          });
          if(!converted)throw new Error(message);
        }
      }
      const access=finalizePreparedScenario(state);
      const cities=citySummaries(state);
      if(cities.length!==4||cities.some(city=>city.population!==150))throw new Error('Musketry Deathmatch needs four cities of exactly 150 people: '+JSON.stringify({cities:cities.map(city=>({id:city.palace.id,population:city.population,housing:city.housing,unhoused:city.palace.unhousedResidents})),removed:access.removed}));
    }
    state.scenarioPreparing=false;
    for(const faction of state.factions) {
      if(faction.villageId!==undefined)continue;
      faction.gold=scenario.gold;faction.food=scenario.food;
      faction.relation=faction.id===0?'self':'war';
    }
    state.diplomacyState=undefined;refreshDiplomacy(state);
    if(id==='musketry-deathmatch') {
      if(!state.diplomacyState?.relationships.some(pair=>pair.a===0&&pair.b===1&&pair.war))negotiateDiplomacy(state,1,'war');
      if(!state.diplomacyState?.relationships.some(pair=>pair.a===0&&pair.b===1&&pair.war))
        throw new Error('Musketry Deathmatch factions must begin at war.');
    }
    if(id!=='sandbox')revealExplorationCells(state,0,Array.from({length:state.world.tiles.length},(_,i)=>i));
    state.events=[];
    rustEngine.sim_campaign_reset(simCore(state).handle);
    for (const faction of state.factions) rustEngine.sim_campaign_population(simCore(state).handle,faction.id,faction.population);
    if(id==='sandbox') {
      const resources=new Set(state.world.tiles.map(tile=>tile.resource));
      if((['clay','copper','iron','gold','stone','salt','olives','fish'] as const).some(resource=>!resources.has(resource)))
        throw new Error('Sandbox needs every regional resource after founding.');
      if(!state.fishing?.whales.length)throw new Error('Sandbox needs an ordinary offshore whale; choose another bake seed.');
      if(state.factions.filter(faction=>faction.villageId===undefined).length!==1||state.units.some(unit=>unit.faction===-2)||(state.raiderCamps?.length??0)||(state.marauderPacks?.length??0))
        throw new Error('Sandbox must have no enemies or marauders.');
      if((state.villages?.length??0)<2)throw new Error('Sandbox needs several reachable neutral villages.');
      updateQuests(state,true);
    }
    repairPreparedStreets(state);
    progress?.(1,state);
    return state;
  }
  state.scenarioPreparing = true;
  removeScenarioOrchards(state);
  for (const faction of state.factions) faction.relation = faction.id === 0 ? 'self' : 'peace';
  state.diplomacyState = undefined;
  refreshDiplomacy(state);
  // Funding belongs to artifact production only, and is reset in the final
  // start. Actual purchases, construction, harvesting and births still run
  // through the production systems; resource development cannot exhaust it.
  for (const faction of state.factions) faction.gold = 1000000000;
  const core = simCore(state), started = state.time;
  let yielded = performance.now(), phase = 0;
  const advance = async (seconds: number): Promise<void> => {
    const until = state.time + seconds;
    while (state.time + 1e-6 < until) {
      updateGame(state, Math.min(.1, until - state.time), NO_INPUT);
      if (state.gameOver) throw new Error('Scenario settlement preparation could not finish. Try generating it again.');
      if (performance.now() - yielded > 12) { await new Promise<void>(resolve => setTimeout(resolve, 0)); yielded = performance.now(); }
    }
  };
  while (phase === 0) {
    civicWorks(state);
    await advance(30);
    const cities = citySummaries(state).filter(city => city.palace.scenarioCity);
    const population = Math.min(...cities.map(city => city.population));
    phase = rustEngine.sim_scenario_progress(core.handle, state.time - started, population,
      Math.min(...cities.map(city => city.housing)), Math.min(...cities.map(city => city.food)));
    progress?.(Math.min(1, population / scenario.population), state);
  }
  if (phase !== 1) throw new Error('These natural city sites could not support the scenario population. Try generating it again.');
  if (id === 'no-mans-land') provisionIron(state);
  if (id === 'no-mans-land') {
    for (const entry of scenarioEquipment(core.handle, state.world)) purchase(state, entry.kind, entry.x, entry.y, entry.faction);
    await advance(360);
    progress?.(1,state);
  } else {
    for (let interval = 0; interval < 96; interval++) {
      const ready = prepareScenarioFleet(state,(faction,x,y)=>purchase(state,'shipyard',x,y,faction),yard=>retireShipyard(state,yard));
      if (ready) break;
      await advance(30);
      progress?.(1,state);
      if (interval === 95) throw new Error('The natural shores could not support every starter shipyard. Try generating it again.');
    }
  }
  await irrigatePreparedScenario(state);
  await polishScenarioLayout(state);
  state.scenarioPreparing = false;
  for (const faction of state.factions) { faction.gold = scenario.gold; faction.food = scenario.food; faction.relation = faction.id === 0 ? 'self' : id === 'no-mans-land' ? 'war' : 'peace'; }
  // Recreate diplomacy from the finished scenario's starting relationships.
  state.diplomacyState = undefined;
  refreshDiplomacy(state);
  state.events = [];
  state.particles = []; state.projectiles = []; state.shipSinkings = [];
  finalizePreparedScenario(state);
  repairPreparedStreets(state);
  rustEngine.sim_campaign_reset(simCore(state).handle);
  for (const faction of state.factions) rustEngine.sim_campaign_population(simCore(state).handle,faction.id,faction.population);
  return state;
}

