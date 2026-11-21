import { entityStore } from './entity-store';
import { cityOwnership } from './city-ownership';
import { factionCommittedBudget } from './faction-budget';
import { factionDevelopmentReserve } from './faction-development';
import { factionAIDecision } from './faction-ai-profile';
import { isHumanFaction } from './player-context';
import { isBuildingUnlocked } from './research';
import { factionHasDevelopedResource } from './resource-development';
import { FORT_UPKEEP } from './forts';
import { BUILDING_UPKEEP, townBuildTerms } from './maintenance';
import { constructionEdges } from './builders';
import { hasStaticPath } from './pathfinding';
import { atWar } from './relations';
import { nearbyUnits } from './spatial';
import { simCore } from './sim-handle';
import { rustEngine } from './rust-engine';
import { structuresOf, STRUCTURE_ALIVE } from './structure-index';
import { buildingReady, distance, unitMaxHp, type Building, type GameState, type Point, type Unit } from './types';

export type EmpireKind = 'palace' | 'fort' | 'ballista' | 'siegeCannon';
export interface EmpireOrders {
  cost(kind: EmpireKind, faction: number): number;
  validateSite(faction:number,kind:EmpireKind,x:number,y:number):{ok:boolean};
  build(faction:number,kind:EmpireKind,x:number,y:number):{ok:boolean};
  campaign(faction:number):number|undefined;
  visible(observer:Unit,target:Unit):boolean;
}
const center=(building:Building):Point=>({x:building.x+1,y:building.y+1});
const copy=(pointer:number):number[]=>Array.from(new Float64Array(rustEngine.memory.buffer,pointer,4));

/** Host observations and normal commands only. Native ECS state owns the
 * planning cadence, investment choice, candidate cursor and expedition goal. */
export function updateFactionEmpires(state:GameState,orders:EmpireOrders):void {
  const handle=simCore(state).handle;
  const activeOffensives = new Set(state.offensives?.filter(order => order.phase !== 'captured').map(order => order.faction));
  for(const faction of state.factions) {
    if(faction.id<=0||isHumanFaction(state,faction.id)||faction.villageId!==undefined||faction.defeated||faction.relation==='confederated') continue;
    if(!rustEngine.sim_ai_empire_due(handle,faction.id,state.time)) continue;
    const store=entityStore(state),leader=store.units.queryFaction('leader',faction.id).find(unit=>unit.hp>0);
    const owned=structuresOf(state,faction.id,STRUCTURE_ALIVE);
    const cities=owned.filter(building=>building.kind==='palace'),ready=cities.filter(buildingReady);
    if(!leader||leader.inside||leader.embarkedOn!==undefined||leader.order==='hold'||leader.forcedAttack||!ready.length) {
      rustEngine.sim_ai_empire_feedback(handle,faction.id,state.time,0,0,0);continue;
    }
    const ownership=cityOwnership(state),fortCounts=new Map<number,number>();
    for(const fort of owned.filter(building=>building.kind==='fort')) {
      const city=ownership.building(fort);if(city)fortCounts.set(city.id,(fortCounts.get(city.id)??0)+1);
    }
    const home=ready.slice().sort((a,b)=>(fortCounts.get(a.id)??0)-(fortCounts.get(b.id)??0)||distance(a,leader)-distance(b,leader)||a.id-b.id)[0];
    // Anchor city searches at the newest settled frontier. Patrol movements
    // and the distribution of pending forts cannot change these candidates.
    const expansionHome = ready.reduce((frontier, city) => city.id > frontier.id ? city : frontier);
    const targetId=orders.campaign(faction.id);
    const target=targetId===undefined?undefined:store.buildings.get(targetId);
    const enemy=target&&buildingReady(target)&&atWar(state,faction.id,target.faction)?target:undefined;
    const facing=enemy??store.buildings.query('palace').filter(building=>buildingReady(building)&&atWar(state,faction.id,building.faction))
      .slice().sort((a,b)=>distance(a,home)-distance(b,home)||a.id-b.id)[0]??home;
    const budget=factionCommittedBudget(state,faction),reserve=factionDevelopmentReserve(state,faction);
    const cannon=isBuildingUnlocked(faction,'siegeCannon')&&factionHasDevelopedResource(state,faction.id,'iron')
      &&!!factionAIDecision(state,faction.id,'chooseCannon',budget.surplus,faction.gold,reserve);
    const siegeKind=cannon?'siegeCannon':'ballista';
    const artillery=enemy?owned.filter(building=>(building.kind==='ballista'||building.kind==='siegeCannon')&&distance(center(building),center(enemy))<=18):[];
    const threatened=owned.some(building=>state.time-(building.lastAttacked??-Infinity)<8)
      ||nearbyUnits(state,leader,7).some(unit=>unit.hp>0&&!unit.inside&&atWar(state,faction.id,unit.faction)&&orders.visible(leader,unit));
    const extraCityUpkeep = townBuildTerms(state, faction).upkeep;
    const values=[faction.gold,reserve,budget.surplus,faction.population,faction.food,cities.length,cities.length-ready.length,
      orders.cost('palace', faction.id),extraCityUpkeep,artillery.length,
      Number(isBuildingUnlocked(faction,siegeKind)&&(!cannon||factionHasDevelopedResource(state,faction.id,'iron'))),
      orders.cost(siegeKind, faction.id),cannon?BUILDING_UPKEEP.siegeCannon!:0,fortCounts.get(home.id)??0,orders.cost('fort', faction.id),FORT_UPKEEP,
      leader.x,leader.y,home.x,home.y,home.id,center(facing).x,center(facing).y,enemy?.id??-1,Number(!!enemy),Number(threatened),
      state.world.width,state.world.height,leader.hp/unitMaxHp(leader),budget.upkeep,Number(isBuildingUnlocked(faction,'fort')),
      store.units.queryFaction('soldier',faction.id).filter(unit=>unit.hp>0&&!unit.inside&&unit.order!=='hold'&&unit.order!=='flee').length,
      owned.filter(building=>building.construction&&['house','camp','well','library'].includes(building.kind)
        &&ownership.building(building)?.id===home.id).length,
      expansionHome.x,expansionHome.y,expansionHome.id,Number(activeOffensives.has(faction.id))];
    const pointer=rustEngine.sim_ai_empire_input(handle);
    new Float64Array(rustEngine.memory.buffer,pointer,values.length).set(values);
    // A sample rejected for terrain or spacing can move the city's cursor
    // forward in the same turn. Stop after a real order or approach probe.
    for (let attempt = 0; attempt < 4; attempt++) {
      const [action,x,y,retained]=copy(rustEngine.sim_ai_empire_plan(handle,faction.id,state.time));
      if(!action) break;
      const kind:EmpireKind=action===1?'palace':action===2?siegeKind:'fort';
      const feedback=(result:number, goal?: Point)=>rustEngine.sim_ai_empire_feedback(handle,faction.id,state.time,result,goal?.x??0,goal?.y??0);
      if (retained && kind !== 'fort' && distance(leader, { x: x + .5, y: y + .5 }) > 10) break;
      if((faction.constructionPauseUntil?.[kind]??0)>state.time
        ||action===1&&!factionAIDecision(state,faction.id,'citySpacing',Math.min(...cities.map(city=>distance(city,{x,y}))))
        ||!orders.validateSite(faction.id,kind,x,y).ok) {feedback(0);if (action === 1) continue;break;}
      if(orders.build(faction.id,kind,x,y).ok) {feedback(2);break;}
      // A failed local fort order cannot be made legal by moving the Leader.
      // Traveling orders retain one actual reachable building entrance.
      if (kind === 'fort' || retained || distance(leader, { x: x + .5, y: y + .5 }) <= 10) {feedback(0);break;}
      const proposed:Building={id:-1,kind,faction:faction.id,x,y,hp:1,maxHp:1,capacity:0};
      const approach = constructionEdges(state,proposed).sort((a,b)=>distance(a,leader)-distance(b,leader))
        .find(goal=>hasStaticPath(state,leader,goal,faction.id));
      feedback(approach ? 1 : 0, approach);
      break;
    }
  }
}

export function factionEmpireGoal(state:GameState,faction:number):{kind:number;point:Point}|undefined {
  const [kind,x,y]=copy(rustEngine.sim_ai_empire_goal(simCore(state).handle,faction,state.time));
  return kind?{kind,point:{x,y}}:undefined;
}
/** Own engines are known. Enemy defenses supplied here must have been seen by
 * the planner; the native policy decides when the army should wait for a breach. */
export function factionSiegeGoal(state:GameState,faction:number,target:Building,observedDefenses:number):Point|undefined {
  const engine=entityStore(state).buildings.query('ballista').filter(building=>building.faction===faction&&building.hp>0
    &&distance(center(building),center(target))<=18).slice().sort((a,b)=>distance(a,target)-distance(b,target)||a.id-b.id)[0];
  if(!engine||!factionAIDecision(state,faction,'siegeHold',1,observedDefenses,target.hp/target.maxHp,
    engine.siegeShotAt??engine.construction?.startedAt??-Infinity))return;
  return {x:engine.x-.5,y:engine.y+.5};
}
