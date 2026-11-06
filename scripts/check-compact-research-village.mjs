import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const output='scratch/2026-10-31-compact-research-villages'; mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],checks=[];
page.on('pageerror',e=>errors.push(String(e))); await page.routeWebSocket('**',socket=>socket.close());
const settle=()=>page.waitForTimeout(160), popup=page.locator('#building-activity');
const check=(name,ok,data)=>{checks.push({name,ok,data});assert.ok(ok,`${name}: ${JSON.stringify(data)}`)};
async function clickPoint(x,y,button='left') { const p=await page.evaluate(({x,y})=>window.__game.renderer.screenPoint({x,y}),{x,y});await page.mouse.click(p.x,p.y,{button});await settle(); }
async function camera(x,y){await page.evaluate(({x,y})=>{const {state,renderer}=window.__game;Object.assign(state.units[0],{x,y});renderer.camera={x,y};renderer.follow=false;}, {x,y});await settle();}
try{
 await page.goto(process.env.GAME_URL||'http://127.0.0.1:5192/',{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.__game&&document.documentElement.dataset.assets==='ready');await page.keyboard.press('Escape');
 await page.evaluate(async()=>{
  const world={width:60,height:40,seed:'compact-ui',source:'QA',spawns:[],revision:0,tiles:Array.from({length:2400},()=>({terrain:'grassland',overlay:'none',elevation:.3,moisture:.5,food:2,production:1,gold:0,variation:.5}))};
  const b=(id,kind,x,y,faction=0)=>({id,kind,x,y,faction,hp:500,maxHp:500,capacity:0,...(faction===3?{villageId:1}:{})});
  const u=(id,kind,x,y,faction=0)=>({id,kind,x,y,faction,hp:100,maxHp:100,morale:100,attack:20,defense:4,speed:3.6,range:4,order:'hold',cooldown:0,lastCombat:-60,moving:false,facing:0,attackTime:0,...(faction===3?{villageId:1}:{})});
  const f=(id)=>({id,name:id?'Willow':'Roma',color:id?'#fff':'#c94c4c',relation:id?'peace':'self',affinity:100,food:500,gold:5000,population:20,culture:0,production:0,defeated:false,yields:{food:0,gold:0,production:0},nextRaid:Infinity,nextRetinueAt:Infinity,...(id===3?{villageId:1}:{})});
  const state={world,buildings:[b(1,'palace',17,18),b(2,'library',22,18),b(3,'camp',22,23),b(4,'road',22,22),b(10,'villageTent',34,18,3),b(11,'villageTent',32,16,3),b(12,'house',36,18,3)],units:[u(100,'leader',22.5,21),u(101,'worker',33.5,20.5,3)],factions:[f(0),f(3)],villages:[{id:1,faction:3,campId:10,x:34,y:18,name:'Willow',identity:'growers',relation:'neutral',nextGrowthAt:Infinity,nextThinkAt:Infinity,nextRecruitAt:Infinity}],time:1,tick:0,paused:true,speed:1,events:[],particles:[],fields:[],selected:100,selectedType:'unit',buildMode:null,diplomacy:null,gameOver:false,victory:false,victoryContinued:true,seed:'compact-ui',rngState:1,raiderCamps:[],marauderPacks:[],treeClearings:[],treasures:[],projectiles:[],bloodEffects:[],roamingMaraudersVersion:1,fogRaids:{nextAt:Infinity,waves:0,pressureVersion:2},retinueStance:'hold',movementMode:'travel'};
  const {synchronizeFarms}=await import('/src/game/farms.ts');synchronizeFarms(state);
  window.__game.replaceState(state);const{renderer}=window.__game;renderer.follow=false;renderer.camera={x:22,y:21};renderer.zoom=1.6;
 });await settle();await clickPoint(22.5,18.5);await popup.waitFor({state:'visible'});
 for(const viewport of [{width:1440,height:900},{width:960,height:640},{width:750,height:500},{width:390,height:700}]){
  await page.setViewportSize(viewport);await settle();
  const ids=await popup.locator('button[data-research]').evaluateAll(nodes=>nodes.map(n=>n.dataset.research));
  for(const id of ids){await popup.locator(`button[data-research="${id}"]`).click();await settle();
   const m=await popup.evaluate(el=>{const box=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,sh:n.scrollHeight,ch:n.clientHeight,sw:n.scrollWidth,cw:n.clientWidth}};return{panel:box(el),tree:box(el.querySelector('.research-tree-scroll')),detail:box(el.querySelector('.research-detail')),nodes:[...el.querySelectorAll('.research-node')].map(box),start:box(el.querySelector('.research-start'))}});
   check(`research ${id} fits ${viewport.width}x${viewport.height} without scrolling`,m.panel.x>=0&&m.panel.y>=0&&m.panel.right<=viewport.width&&m.panel.bottom<=viewport.height&&m.panel.sh<=m.panel.ch+1&&m.tree.sh<=m.tree.ch+1&&m.tree.sw<=m.tree.cw+1&&m.detail.sh<=m.detail.ch+1&&m.nodes.every(n=>n.x>=m.panel.x&&n.y>=m.panel.y&&n.right<=m.panel.right&&n.bottom<=m.panel.bottom),m);
  }
  await page.screenshot({path:`${output}/research-${viewport.width}.png`});
 }
 await page.setViewportSize({width:1440,height:900});await page.keyboard.press('Escape');await camera(22.5,22);await page.keyboard.press('b');await page.keyboard.press('r');await clickPoint(22.5,23.5);
 check('road construction on a field never opens the farm panel',!(await popup.isVisible())&&await page.evaluate(()=>window.__game.state.buildMode==='road'));
 await page.keyboard.press('Escape');await camera(30.5,19.5);
 for(const [label,x,y,button] of [['tent',32.5,16.5,'left'],['house',36.5,18.5,'left'],['camp',34.5,18.5,'left'],['villager',33.5,20.15,'left'],['villager right-click',33.5,20.15,'right']]){
  await clickPoint(x,y,button);check(`${label} opens diplomacy`,await page.locator('#dialog').isVisible()&&(await page.locator('#village-trade').textContent()).includes('250'));await page.keyboard.press('Escape');await settle();
 }
 const goldBeforeTrade=await page.evaluate(()=>window.__game.state.factions[0].gold);await clickPoint(33.5,20.15);await page.locator('#village-trade').click();await settle();check('villager trade costs250',await page.evaluate(gold=>window.__game.state.factions[0].gold===gold-250,goldBeforeTrade));
 await clickPoint(32.5,16.5);check('undiscounted alliance starts at3000 gold',(await page.locator('#village-ally').textContent()).includes('3000'));await page.keyboard.press('Escape');
 await page.evaluate(()=>{window.__game.state.villages[0].tradeGoldByFaction={0:5000}});await clickPoint(32.5,16.5);check('completed trade discounts alliance to2500 gold',(await page.locator('#village-ally').textContent()).includes('2500'));await page.locator('#village-ally').click();await settle();await page.evaluate(async()=>{const{updateFog}=await import('/src/game/fog.ts');updateFog(window.__game.state)});await settle();
 check('allied camp exposes the floating alliance marker',await page.evaluate(async()=>{const{alliedVillageCamps}=await import('/src/game/village-marker.ts');return alliedVillageCamps(window.__game.state).map(b=>b.id).join(',')==='10'}));
 await page.evaluate(()=>{window.__game.state.paused=false});await page.waitForTimeout(800);await page.evaluate(()=>{window.__game.state.paused=true});await settle();
 await page.screenshot({path:`${output}/allied-marker.png`});check('no runtime errors',!errors.length,errors);
 writeFileSync(`${output}/results.json`,JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({pass:true,checks:checks.length,errors}));
} catch(e){writeFileSync(`${output}/results.json`,JSON.stringify({checks,errors,error:String(e)},null,2));await page.screenshot({path:`${output}/failure.png`});throw e}finally{await browser.close()}
