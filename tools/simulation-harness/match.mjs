import { createHash } from 'node:crypto';

export const MATCH_SCENARIOS = ['field-battle', 'siege-war'];
const IDLE = { up:false,down:false,left:false,right:false };
const rounded = value => Number(value.toFixed(6));

/** Matched starting fixtures, not substitute gameplay. Both contestants use
 * ordinary nonhuman controllers, the real simulation and native diplomacy. */
function fixture(engine, trial) {
  const width=96,height=64,cy=31;
  const world={width,height,seed:trial.seed,source:'mirrored AI round robin',revision:0,
    spawns:[{x:48,y:3},{x:17,y:31},{x:79,y:31}],
    tiles:Array.from({length:width*height},()=>({terrain:'grassland',overlay:'none',elevation:.3,moisture:.5,
      food:3,production:1,gold:0,variation:.5}))};
  const state=engine.createGame(world,undefined,{banditIntensity:0}),store=engine.entityStore(state);
  const capitals=[0,1,2].map(faction=>state.buildings.find(building=>building.faction===faction&&building.kind==='palace'));
  store.buildings.replace(capitals);store.units.replace([]);
  state.factions=state.factions.filter(faction=>faction.villageId===undefined);
  state.villages=[];state.raiderCamps=[];state.marauderPacks=[];state.treasureChests=[];state.fields=[];
  state.fogRaids={nextAt:1e9,waves:0,pressureVersion:1};state.roamingMaraudersVersion=1;
  const siege=trial.scenario==='siege-war';
  let next=Math.max(...capitals.map(capital=>capital.id))+1000;
  const addBuilding=(kind,faction,x,y,extra={})=>{
    const building={id:next++,kind,faction,x,y,hp:100,maxHp:100,capacity:0,...extra};store.buildings.add(building);return building;
  };
  const addUnit=(kind,faction,x,y,extra={})=>{
    const leader=kind==='leader',ranged=kind==='archer';
    const unit={id:next++,kind,faction,x,y,hp:leader?150:100,maxHp:leader?150:100,
      attack:leader?25:ranged?14:17,defense:leader?6:4,morale:100,speed:leader?3.6:3.96,
      range:leader||ranged?4:1.1,order:'follow',cooldown:0,lastCombat:-60,moving:false,
      facing:faction===1?0:Math.PI,attackTime:0,...extra};store.units.add(unit);return unit;
  };
  for(const faction of state.factions) {
    faction.relation=faction.id===0?'self':'peace';faction.gold=siege?1800:0;faction.food=siege?3000:1000;
    faction.population=siege?40:20;faction.nextRaid=faction.id?0:1e9;faction.nextRetinueAt=1e9;
    faction.research={focus:'infantryDrill',allocation:0,progress:{},levels:{infantryDrill:1,militaryTactics:1,archeryRange:1,
      ...(siege?{woodenTower:1,wall:1,blacksmith:1,siegeEngines:1,massLevy:1}: {})}};
    if(!siege)faction.constructionPauseUntil={palace:1e9,fort:1e9,woodenTower:1e9,guardPost:1e9,library:1e9};
  }
  Object.assign(capitals[0],{x:47,y:2,hp:650,maxHp:650,capacity:20,unhousedResidents:20,governorPermissions:{farms:false,housing:false}});
  addUnit('leader',0,48,5,{order:'hold',speed:0,home:capitals[0].id});
  const jitter=(engine.simRandom(state)-.5)*3;
  const armies={},leaders={};
  for(const faction of [1,2]) {
    const mirror=x=>faction===1?x:width-x;
    const tileMirror=x=>faction===1?x:width-x-1;
    const palace=capitals[faction];
    Object.assign(palace,{x:faction===1?16:78,y:30,hp:siege?6500:650,maxHp:siege?6500:650,
      capacity:20,unhousedResidents:siege?8:20,palaceLevel:siege?2:1,
      governorPermissions:{farms:siege,housing:siege}});
    leaders[faction]=addUnit('leader',faction,mirror(siege?27:40),cy+jitter,{home:palace.id});
    armies[faction]=Array.from({length:12},(_,i)=>addUnit(i>=9?'archer':'warrior',faction,
      mirror((siege?23.5:36.5)+i%3),cy-2+Math.floor(i/3)+jitter));
    if(!siege)continue;
    for(const [x,y] of [[13,29],[13,30],[13,31],[13,32],[17,27],[17,34],[19,29],[19,32]])
      addBuilding('house',faction,tileMirror(x),y,{houseLevel:2,capacity:4,residents:4,hp:200,maxHp:200});
    for(const y of [25,37]) {
      const x=tileMirror(22);
      addBuilding('woodenTower',faction,x,y,{hp:600,maxHp:600,armor:6});
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(dx||dy)
        addBuilding('palisade',faction,x+dx,y+dy,{hp:56.25,maxHp:56.25,armor:2});
      addBuilding('road',faction,x+(faction===1?-1:1),y);
    }
    const ironX=tileMirror(15);
    Object.assign(world.tiles[31*width+ironX],{resource:'iron',resourceDeveloped:true,resourceGroup:100+faction});
    const occupied=new Set(state.buildings.filter(building=>building.hp>0).flatMap(building=>{
      const size=['palace','fort'].includes(building.kind)?2:1;
      return Array.from({length:size*size},(_,i)=>`${building.x+i%size},${building.y+Math.floor(i/size)}`);
    }));
    let farms=0;
    for(let y=23;y<=39&&farms<24;y++)for(let x=9;x<=24&&farms<24;x++) {
      const tx=tileMirror(x);
      if(occupied.has(`${tx},${y}`)||world.tiles[y*width+tx].resource)continue;
      addBuilding('camp',faction,tx,y);farms++;
    }
  }
  engine.markWorldChanged(world);
  engine.configureAIMatch(state,1,2);
  return {state,leaders,armies};
}

export function runMatch(engine,trial,config) {
  const setupStarted=performance.now(),{state,leaders,armies}=fixture(engine,trial);
  const initialStateHash=createHash('sha256').update(JSON.stringify(state)).digest('hex');
  engine.registerFactionAIPolicies(state,config.policyDefinitions);
  engine.setFactionAIProfile(state,1,trial.left);engine.setFactionAIProfile(state,2,trial.right);
  const catalog=engine.listFactionAIPolicies(state);
  const policyDefinitions=[trial.left,trial.right].map(id=>catalog.find(policy=>policy.id===id));
  const setupSeconds=(performance.now()-setupStarted)/1000;
  const started=performance.now();let steps=0,winnerFaction=null,stopReason='duration';
  while(state.time<config.seconds-1e-8) {
    const before=state.time;
    engine.updateGame(state,Math.min(config.dt,config.seconds-before),IDLE,{wallNow:1_800_000_000_000+Math.round(before*1000)});
    steps++;
    if(state.time<=before)throw new Error(`Match ${trial.id} stalled at ${before}s`);
    const left=state.factions.find(faction=>faction.id===1),right=state.factions.find(faction=>faction.id===2);
    if(left.defeated||right.defeated) {
      winnerFaction=left.defeated===right.defeated?null:left.defeated?2:1;stopReason='faction-defeated';break;
    }
    if(state.gameOver||state.palaceCaptures?.length||state.paused)throw new Error(`Unexpected match stop in ${trial.id}: ${JSON.stringify({time:state.time,gameOver:state.gameOver,paused:state.paused,captures:state.palaceCaptures,
      factions:state.factions.map(({id,defeated})=>({id,defeated})),leaders:state.units.filter(unit=>unit.kind==='leader').map(({faction,hp})=>({faction,hp}))})}`);
  }
  const wallSeconds=(performance.now()-started)/1000;
  const factions=[1,2].map(id=>{
    const faction=state.factions.find(faction=>faction.id===id),owned=state.buildings.filter(building=>building.faction===id&&building.hp>0);
    return {faction:id,policy:id===1?trial.left:trial.right,defeated:faction.defeated,
      leaderAlive:state.units.includes(leaders[id])&&leaders[id].hp>0,
      initialRetinueSurvivors:armies[id].filter(unit=>state.units.includes(unit)&&unit.hp>0).length,
      survivingArmyHP:state.units.filter(unit=>unit.faction===id&&unit.hp>0&&unit.attack>0).reduce((sum,unit)=>sum+unit.hp,0),
      cities:owned.filter(building=>building.kind==='palace'&&!building.construction).length,
      cityHP:owned.filter(building=>building.kind==='palace'&&!building.construction).reduce((sum,building)=>sum+building.hp,0),
      forts:owned.filter(building=>building.kind==='fort').length,siegeEngines:owned.filter(building=>['ballista','siegeCannon'].includes(building.kind)).length,
      population:faction.population,gold:faction.gold,food:faction.food};
  });
  return {...trial,initialStateHash,policyDefinitions,logicFaults:Object.fromEntries(policyDefinitions.map(policy=>[policy.id,engine.factionAILogicFaults(state,policy.code)])),simulatedSeconds:rounded(state.time),steps,
    setupSeconds:rounded(setupSeconds),wallSeconds:rounded(wallSeconds),speedup:rounded(state.time/Math.max(wallSeconds,1e-9)),
    winnerFaction,winner:winnerFaction===1?trial.left:winnerFaction===2?trial.right:null,stopReason,factions};
}

export function summarizeMatches(rows,policies) {
  const fixtures=new Map();
  for(const row of rows) {
    const key=JSON.stringify([row.scenario,row.seed]);
    if(fixtures.has(key)&&fixtures.get(key)!==row.initialStateHash)throw new Error(`Unmatched round-robin fixture ${key}`);
    fixtures.set(key,row.initialStateHash);
  }
  const table=policies.map(policy=>{
    const matches=rows.filter(row=>row.left===policy||row.right===policy);
    const wins=matches.filter(row=>row.winner===policy).length,draws=matches.filter(row=>row.winner===null).length;
    return {policy,matches:matches.length,wins,draws,losses:matches.length-wins-draws,points:wins*3+draws,
      winRate:rounded(wins/matches.length),meanSurvivingArmyHP:rounded(matches.reduce((sum,row)=>sum+row.factions.find(side=>side.policy===policy).survivingArmyHP,0)/matches.length)};
  }).sort((a,b)=>b.points-a.points||b.wins-a.wins||policies.indexOf(a.policy)-policies.indexOf(b.policy));
  return {scoring:'3 points per actual faction-defeat win, 1 per duration draw; timeouts are never declared score wins.',
    table,uniqueLeader:table.length>1&&table[0].points>table[1].points?table[0].policy:null,
    byScenario:Object.fromEntries([...new Set(rows.map(row=>row.scenario))].map(scenario=>[scenario,
      policies.map(policy=>({policy,wins:rows.filter(row=>row.scenario===scenario&&row.winner===policy).length,
        draws:rows.filter(row=>row.scenario===scenario&&row.winner===null&&(row.left===policy||row.right===policy)).length,
        losses:rows.filter(row=>row.scenario===scenario&&row.winner!==null&&row.winner!==policy&&(row.left===policy||row.right===policy)).length}))]))};
}

export function inspectMatchPolicies(engine,definitions) {
  const {state}=fixture(engine,{seed:'policy-catalog',scenario:'field-battle'});
  engine.registerFactionAIPolicies(state,definitions);
  return engine.listFactionAIPolicies(state).map(({id,parameters,features,logic})=>({id,parameters,features,logic}));
}
