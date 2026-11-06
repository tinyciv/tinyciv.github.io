import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
const dir='scratch/2026-10-31-forged-hud-implementation/irrigation';
await fs.mkdir(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],checks=[];
page.on('pageerror',error=>errors.push(String(error)));
const check=(name,passed,detail)=>{checks.push({name,passed,detail});console.log(`${passed?'PASS':'FAIL'} ${name}`)};
const settle=()=>page.waitForTimeout(220);
const mouse=async(x,y,action='move')=>{const p=await page.evaluate(point=>window.__game.renderer.screenPoint(point),{x,y});await page.mouse[action](p.x,p.y);return p};
try{
 await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173/',{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.__game&&document.documentElement.dataset.assets==='ready');
 if(await page.locator('#dialog').isVisible())await page.keyboard.press('Escape');
 await page.evaluate(async()=>{
  const {synchronizeFarms}=await import('/src/game/farms.ts');
  const {updateFog}=await import('/src/game/fog.ts');
  const {invalidateNavigation}=await import('/src/game/pathfinding.ts');
  const game=window.__game,width=40,height=30;
  const world={width,height,seed:'irrigation-browser-check',source:'fixture',revision:0,spawns:[],tiles:Array.from({length:width*height},(_,i)=>({terrain:i%width>=12&&i%width<=13?'river':i%width>=22?'desert':'grassland',overlay:'none',variation:((i*17)%97)/97,elevation:.3,moisture:.5,food:3,production:1,gold:0}))};
  const leader={id:2,kind:'leader',faction:0,x:18.5,y:14.5,hp:100,maxHp:100,morale:100,attack:25,defense:5,speed:3.6,range:4,order:'hold',cooldown:0,lastCombat:-60,moving:false,facing:0,attackTime:0};
  const structure=(id,kind,x,y,extras={})=>({id,kind,x,y,faction:0,hp:100,maxHp:100,capacity:0,...extras});
  const buildings=[structure(1,'palace',16,18,{hp:650,maxHp:650,cityName:'Irrigation test'}),structure(3,'house',18,18,{capacity:9,residents:9,houseLevel:3}),structure(4,'camp',19,12),structure(5,'camp',19,15)];
  let id=100;for(let x=14;x<=25;x++)buildings.push(structure(id++,'road',x,15));
  for(let x=14;x<=18;x++)buildings.push(structure(id++,'irrigation',x,12));
  for(let y=13;y<=16;y++)buildings.push(structure(id++,'irrigation',18,y));
  for(let y=14;y<=17;y++)buildings.push(structure(id++,'irrigation',20,y));
  game.replaceState({ ...game.state, world,buildings,units:[leader],factions:[{id:0,name:'Player',color:'#3988ff',affinity:100,relation:'self',food:500,gold:1000,production:0,population:9,culture:0,growth:0,yields:{food:0,gold:0,production:0},nextRaid:1e9,defeated:false,research:{focus:'irrigation',levels:{irrigation:1},progress:{}}}],time:5,tick:0,paused:true,speed:1,gameOver:false,victory:false,events:[],particles:[],projectiles:[],fields:[],treasures:[],raiderCamps:[],marauderPacks:[],treeClearings:[],roamingMaraudersVersion:1,selected:2,selectedType:'unit',buildMode:null,diplomacy:null,seed:world.seed,rngState:1,fog:undefined,retinueStance:'aggressive',movementMode:'travel',traffic:{},campRoads:{},nextId:500 });
  synchronizeFarms(game.state);for(const field of game.state.fields){field.food=1;field.nextHarvest=35;field.planted=true}
  invalidateNavigation(game.state);updateFog(game.state);game.renderer.prepare(game.state);game.renderer.follow=false;game.renderer.camera={x:19,y:14};game.renderer.zoom=1.6;
 });
 await settle();await page.screenshot({path:`${dir}/in-game.png`});
 await page.keyboard.press('b');await page.keyboard.press('u');await mouse(22.5,12.5);await settle();
 check('B then U selects irrigation',await page.evaluate(()=>window.__game.state.buildMode==='irrigation'));
 check('build cost and benefit visible',(await page.locator('#build-status').textContent()).includes('2× farmland yield within 3 tiles'),await page.locator('#build-status').textContent());
 await page.screenshot({path:`${dir}/placement-preview.png`});
 await mouse(19.5,12.5);await page.mouse.down();const end=await page.evaluate(()=>window.__game.renderer.screenPoint({x:23.5,y:12.5}));await page.mouse.move(end.x,end.y,{steps:10});await settle();
 await page.screenshot({path:`${dir}/drag-preview.png`});await page.mouse.up();await settle();
 const order=await page.evaluate(()=>({gold:window.__game.state.factions[0].gold,sites:window.__game.state.buildings.filter(b=>b.kind==='irrigation'&&b.construction).map(b=>({x:b.x,y:b.y,paid:b.construction.paidGold}))}));
 check('five-tile drag costs 250 gold',order.gold===750&&order.sites.length===5,order);
 await page.keyboard.press('Escape');await page.evaluate(async()=>{
  const {invalidateNavigation}=await import('/src/game/pathfinding.ts');const state=window.__game.state;
  for(const b of state.buildings)if(b.kind==='irrigation')delete b.construction;
  state.world.revision++;invalidateNavigation(state);window.__game.renderer.prepare(state);
 });await mouse(2,2);await settle();await page.screenshot({path:`${dir}/completed-ditches.png`});
 const mechanics=await page.evaluate(async()=>{
  const {irrigationYieldMultiplier}=await import('/src/game/irrigation.ts');const{movementMultiplier}=await import('/src/game/pathfinding.ts');const state=window.__game.state;
  return{near:irrigationYieldMultiplier(state,21,13),far:irrigationYieldMultiplier(state,28,20),unbridged:movementMultiplier(state,18.5,14.5),bridged:movementMultiplier(state,20.5,15.5)};
 });check('yield and crossing rules agree in runtime',mechanics.near===2&&mechanics.far===1&&mechanics.unbridged===.5&&mechanics.bridged===1.5,mechanics);
 await mouse(20.5,15.05,'click');await settle();
 const selected=await page.evaluate(()=>{const s=window.__game.state,b=s.buildings.find(b=>b.id===s.selected);return{kind:b?.kind,label:document.querySelector('#selection-name').textContent}});
 check('exposed ditch can be selected over farm and road',selected.kind==='irrigation'&&selected.label==='Irrigation',selected);
 // Entity-specific removal remains a simulation operation; the unified Clear
 // control deliberately applies to every eligible layer in the chosen tile.
 const independent=await page.evaluate(async()=>{
  const {demolishIrrigationAt}=await import('/src/game/area-tools.ts');
  const s=structuredClone(window.__game.state),before=s.factions[0].gold,result=demolishIrrigationAt(s,20,15);
  return{removed:result.count,ditch:s.buildings.some(b=>b.kind==='irrigation'&&b.x===20&&b.y===15),road:s.buildings.some(b=>b.kind==='road'&&b.x===20&&b.y===15),farm:s.buildings.some(b=>b.id===5),field:s.fields.some(f=>f.x===20&&f.y===15),goldUnchanged:s.factions[0].gold===before};
 });
 check('ditch-only simulation removal preserves the shared road and farmland without refund',independent.removed===1&&!independent.ditch&&independent.road&&independent.farm&&independent.field&&independent.goldUnchanged,independent);
 await page.keyboard.press('c');await settle();
 check('C activates unified Clear',await page.locator('[data-action="clear"]').getAttribute('aria-pressed')==='true');
 await mouse(20.5,15.5,'click');await settle();
 const clearing=await page.evaluate(()=>{const s=window.__game.state;return{ditch:s.buildings.some(b=>b.kind==='irrigation'&&b.x===20&&b.y===15),road:s.buildings.some(b=>b.kind==='road'&&b.x===20&&b.y===15),farm:s.buildings.some(b=>b.id===5),fields:s.fields.some(f=>f.x>=19&&f.x<=20&&f.y>=15&&f.y<=16),neighborRoad:s.buildings.some(b=>b.kind==='road'&&b.x===19&&b.y===15),otherFarm:s.buildings.some(b=>b.id===4),gold:s.factions[0].gold}});
 check('unified Clear removes all shared layers in its tile without refund',!clearing.ditch&&!clearing.road&&!clearing.farm&&!clearing.fields&&clearing.neighborRoad&&clearing.otherFarm&&clearing.gold===750,clearing);
 await page.screenshot({path:`${dir}/cleared-shared-tile.png`});
 check('no browser errors',errors.length===0,errors);
 const report={passed:checks.every(c=>c.passed),checks,errors};await fs.writeFile(`${dir}/browser-report.json`,JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
}finally{await browser.close()}
