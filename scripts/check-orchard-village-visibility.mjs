import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const output='scratch/2026-11-03-orchard-village-visibility';mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page=await browser.newPage({viewport:{width:1440,height:900}}),checks=[],errors=[];
page.on('pageerror',error=>errors.push(String(error)));await page.routeWebSocket('**',socket=>socket.close());
await page.addInitScript(()=>performance.setResourceTimingBufferSize(10000));
const check=(name,pass,data)=>{checks.push({name,pass:!!pass,data});console.log(name,!!pass,JSON.stringify(data));assert.ok(pass,name);};
try{
  await page.goto(process.env.GAME_URL||'http://127.0.0.1:5177/',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__game&&document.documentElement.dataset.assets==='ready');
  await page.evaluate(async()=>{
    window.__observedImport=async path=>{const r=[...performance.getEntriesByType('resource')].reverse().find(r=>new URL(r.name).pathname===path);return import(r?.name??path);};
    const width=64,height=40,world={width,height,seed:'orchard-village-visibility',source:'isolated visual QA',spawns:[],revision:1,
      tiles:Array.from({length:width*height},(_,i)=>({terrain:'grassland',overlay:'none',elevation:.3,moisture:.5,food:2,production:0,gold:0,variation:i%11/11}))};
    const faction=(id)=>({id,name:id?'Sabine Grove':'Romans',color:id?'#ffffff':'#c94c4c',affinity:100,relation:id?'peace':'self',population:id?3:20,
      food:200,gold:2000,production:0,culture:0,yields:{food:0,production:0,gold:0},nextRaid:1e9,nextRetinueAt:1e9,defeated:false,...(id?{villageId:1}:{})});
    const building=(id,kind,x,y,faction=0,extra={})=>({id,kind,x,y,faction,hp:500,maxHp:500,capacity:0,...extra});
    const orchard={startedAt:0,readyAt:120},fields=Array.from({length:18},(_,i)=>({id:500+i,camp:20+i,faction:0,x:11+i%6,y:18+Math.floor(i/6),planted:true,food:0,nextHarvest:180,orchard}));
    const buildings=[building(1,'palace',6,18,0,{cityName:'Roma',capacity:20,unhousedResidents:20,governorPermissions:{farms:false,housing:false}}),
      ...fields.map(f=>building(f.camp,'camp',f.x,f.y,0,{orchard,farmLastVisitedAt:145})),
      ...[[-2,-1],[2,-1],[0,2]].map(([dx,dy],i)=>building(100+i,'villageTent',34+dx,20+dy,1,{villageId:1}))];
    const s={world,buildings,fields,units:[{id:10,kind:'leader',faction:0,x:13.5,y:23.5,hp:100,maxHp:100,morale:100,attack:0,defense:4,speed:3.6,range:4,order:'hold',cooldown:0,lastCombat:-60,moving:false,facing:0,attackTime:0}],
      factions:[faction(0),faction(1)],villages:[{id:1,faction:1,campId:100,name:'Sabine Grove',identity:'growers',relation:'neutral',x:34,y:20,nextGrowthAt:1e9,nextThinkAt:1e9,nextRecruitAt:1e9}],
      time:145,tick:0,paused:true,speed:1,events:[],particles:[],projectiles:[],bloodEffects:[],treasures:[],raiderCamps:[],marauderPacks:[],treeClearings:[],
      wildlife:{herds:[],sequence:0,nextRespawnAt:1e9,targetHerds:0},banditIntensity:0,fogRaids:{nextAt:1e9,waves:0,pressureVersion:2},
      selected:10,selectedType:'unit',buildMode:null,diplomacy:null,gameOver:false,victory:false,victoryContinued:true,seed:world.seed,rngState:1,retinueStance:'hold',movementMode:'travel',traffic:{}};
    __game.replaceState(s);__game.renderer.prepare(s);__game.renderer.follow=false;__game.renderer.camera={x:13.5,y:19.5};__game.renderer.zoom=2.3;
    window.__borderDraw=()=>{const r=__game.renderer,art=r.gpu.art,original=art.paint,keys=[];art.paint=function(key,...args){if(key.startsWith('border:'))keys.push(key);return original.call(this,key,...args);};try{r.draw(s,0);}finally{art.paint=original;}return {white:keys.filter(k=>k.includes('village-white')).length,normal:keys.filter(k=>!k.includes('village-white')).length,villageOwner:r.minimapClaims.owners[20*64+34]};};
  });
  const orchard=await page.evaluate(async()=>{const s=__game.state,{orchardAppearance}=await __observedImport('/src/game/farm-art.ts');return {fruit:s.fields.filter(f=>orchardAppearance(f,s.time).fruit).length,trees:s.fields.length,food:s.fields.reduce((sum,f)=>sum+f.food,0),next:[...new Set(s.fields.map(f=>f.nextHarvest))]};});
  check('unharvestable orchard has mixed fruit and leaf canopies 35 seconds before harvest',orchard.fruit>0&&orchard.fruit<orchard.trees&&orchard.food===0&&orchard.next[0]===180,orchard);
  await page.waitForTimeout(150);await page.screenshot({path:`${output}/mixed-orchard-before-harvest.png`});
  await page.evaluate(()=>{__game.renderer.camera={x:34.5,y:20.5};__game.renderer.zoom=1.8;});
  const hidden=await page.evaluate(()=>__borderDraw());
  check('unexplored village has no white world border or minimap claim',hidden.white===0&&hidden.villageOwner===-2147483648,hidden);
  await page.screenshot({path:`${output}/village-unexplored.png`});
  const remembered=await page.evaluate(async()=>{const s=__game.state,{updateFog}=await __observedImport('/src/game/fog.ts'),leader=s.units[0],old={x:leader.x,y:leader.y};
    leader.x=34.5;leader.y=20.5;s.time+=.1;updateFog(s);__game.renderer.draw(s,.1);
    Object.assign(leader,old);
    for(let i=0;i<80;i++){s.time+=.1;__game.renderer.draw(s,.1);}return __borderDraw();});
  check('discovered village borders and minimap claims remain visible in light fog',remembered.white>0&&remembered.villageOwner===1,remembered);
  await page.screenshot({path:`${output}/village-explored-light-fog.png`});
  check('no browser errors',errors.length===0,errors);
}finally{writeFileSync(`${output}/checks.json`,JSON.stringify({checks,errors},null,2));await browser.close();}
