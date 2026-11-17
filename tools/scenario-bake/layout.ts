import { updateGame,validateBuildAt } from '../../src/game/simulation';
import { entityStore,BUILDING_KIND_CODES } from '../../src/game/entity-store';
import { nativeInstitutionPlan } from '../../src/game/institution-native';
import { governingPalace } from '../../src/game/governor';
import { scenarioRoadPlan } from '../../src/game/scenario-access-native';
import { prepareScenarioFleet,shipyardOnCoast,shipyardWarship } from '../../src/game/warships-native';
import { rustEngine } from '../../src/game/rust-engine';
import { refreshDiplomacy } from '../../src/game/diplomacy';
import { banditIntensity,setBanditIntensity } from '../../src/game/bandit-intensity';
import { buildingReady,type GameState } from '../../src/game/types';
import { irrigatePreparedScenario } from './agriculture';
import { finalizePreparedScenario } from './finalize';
import { purchaseScenarioBuilding as purchase,retireScenarioBuilding as retire,scenarioDitches } from './orders';

/** Offline city redevelopment uses native site/street plans, real purchases,
 * real builders and the existing grown population. Terrain is never painted. */
export async function polishScenarioLayout(state:GameState,progress?:(value:unknown)=>void){
  const start=state.time,preparing=state.scenarioPreparing,paused=state.paused,speed=state.speed,bandits=banditIntensity(state);
  const stocks=state.factions.map(f=>({f,gold:f.gold,food:f.food,relation:f.relation}));
  const palaces=state.buildings.filter(b=>b.kind==='palace'&&b.faction>=0),permissions=palaces.map(p=>p.governorPermissions);
  state.scenarioPreparing=true;state.paused=false;state.speed=1;setBanditIntensity(state,0);
  for(const {f}of stocks){f.gold=1e9;f.food=1e9;f.relation=f.id===0?'self':'peace';}
  for(const palace of palaces)palace.governorPermissions={farms:false,housing:false};
  state.diplomacyState=undefined;refreshDiplomacy(state);
  const moved:{kind:string;from:{x:number;y:number};to:{x:number;y:number}}[]=[],unmoved:number[]=[],orders=new Set<number>();
  let roadsOrdered=0,yardsRebuilt=0,coastalClaims=0;
  const advance=async()=>{updateGame(state,10,{up:false,down:false,left:false,right:false});await new Promise<void>(r=>setTimeout(r,0));};
  try{
    finalizePreparedScenario(state);
    // The finalizer restores Exploration difficulty; keep authoring peaceful.
    setBanditIntensity(state,0);
    for(const building of [...state.buildings]){
      if(!buildingReady(building)||building.faction<0)continue;
      const city=governingPalace(state,building,building.faction);if(!city)continue;
      if(!rustEngine.scenario_civic_inner(BUILDING_KIND_CODES[building.kind],building.x,building.y,city.x,city.y))continue;
      const sites=nativeInstitutionPlan(state,building.faction,4,[city.x,city.y,state.world.width,state.world.height]);
      let placed=false;
      for(let i=0;i<sites.length;i+=2){const x=sites[i],y=sites[i+1];
        if(governingPalace(state,{x,y},building.faction)?.id!==city.id)continue;
        const ditches=scenarioDitches(state,building.kind,x,y,building.faction),ignored=new Set([building.id,...ditches.map(b=>b.id)]);
        const cleared={...state,buildings:state.buildings.filter(b=>!ignored.has(b.id))};
        if(!validateBuildAt(cleared,building.kind,x,y,building.faction,undefined,false,true).ok)continue;
        const from={x:building.x,y:building.y};retire(state,building);
        if(!purchase(state,building.kind,x,y,building.faction,true))throw new Error(`Could not rebuild ${building.kind} at its native outskirts site.`);
        const replacement=state.buildings.find(b=>b.kind===building.kind&&b.x===x&&b.y===y&&b.faction===building.faction)!;
        orders.add(replacement.id);moved.push({kind:building.kind,from,to:{x,y}});placed=true;break;
      }
      if(!placed)unmoved.push(building.id);
    }
    for(const yard of [...state.buildings].filter(b=>b.kind==='shipyard'&&b.hp>0))if(!shipyardOnCoast(state,yard)){
      const ship=shipyardWarship(state,yard);
      if(ship?.sailboat?.passenger!==undefined)throw new Error('A scenario shipyard cannot be relocated with a Leader aboard its ship.');
      if(ship)entityStore(state).units.retain(u=>u.id!==ship.id);
      retire(state,yard);yardsRebuilt++;
    }
    for(const {f}of stocks)for(const point of scenarioRoadPlan(state,f.id)){
      if(purchase(state,'road',point.x,point.y,f.id)){
        const road=state.buildings.find(b=>b.kind==='road'&&b.faction===f.id&&b.x===point.x&&b.y===point.y)!;orders.add(road.id);roadsOrdered++;
      }
    }
    progress?.({phase:'layout-construction',moved:moved.length,unmoved,roadsOrdered,yardsRebuilt});
    let last=performance.now(),nextClaim=state.time;
    for(;;){
      if(state.world.scenario==='age-of-exploration'&&state.time>=nextClaim){
        nextClaim=state.time+60;
        for(const city of palaces){
          if(state.buildings.some(b=>b.kind==='shipyard'&&b.hp>0&&b.faction===city.faction)
            ||state.buildings.some(b=>b.kind==='monument'&&b.faction===city.faction&&b.construction))continue;
          // A coastal port may lie beyond a compact town's current claim.
          // Native outskirts candidates and real monuments extend that claim.
          const sites=nativeInstitutionPlan(state,city.faction,4,[city.x,city.y,state.world.width,state.world.height]);
          for(let i=0;i<sites.length;i+=2)if(purchase(state,'monument',sites[i],sites[i+1],city.faction,true)){coastalClaims++;break;}
        }
      }
      const fleetReady=state.world.scenario!=='age-of-exploration'||prepareScenarioFleet(state,(f,x,y)=>purchase(state,'shipyard',x,y,f),yard=>retire(state,yard));
      const pending=state.buildings.filter(b=>orders.has(b.id)&&b.construction).length;
      if(fleetReady&&!pending)break;
      if(state.time-start>2400)throw new Error(`Scenario layout construction did not finish (${pending} civic/road orders remain).`);
      await advance();
      if(performance.now()-last>10000){progress?.({seconds:Math.round(state.time-start),pending,fleetReady});last=performance.now();}
    }
    // New ports and claim buildings receive the same street connections.
    for(const {f}of stocks)for(const point of scenarioRoadPlan(state,f.id))if(purchase(state,'road',point.x,point.y,f.id)){
      const road=state.buildings.find(b=>b.kind==='road'&&b.faction===f.id&&b.x===point.x&&b.y===point.y)!;orders.add(road.id);roadsOrdered++;
    }
    while(state.buildings.some(b=>orders.has(b.id)&&b.construction)){
      if(state.time-start>2400)throw new Error('Scenario streets could not finish construction.');await advance();
    }
    const agriculture=await irrigatePreparedScenario(state,progress);
    return {moved,unmoved,roadsOrdered,yardsRebuilt,coastalClaims,agriculture,simulatedSeconds:state.time-start};
  }finally{
    state.scenarioPreparing=preparing;state.paused=paused;state.speed=speed;
    for(const {f,gold,food,relation}of stocks)Object.assign(f,{gold,food,relation});
    for(let i=0;i<palaces.length;i++)palaces[i].governorPermissions=permissions[i];
    setBanditIntensity(state,bandits);state.diplomacyState=undefined;refreshDiplomacy(state);
    state.events=[];state.particles=[];state.projectiles=[];state.shipSinkings=[];
  }
}
