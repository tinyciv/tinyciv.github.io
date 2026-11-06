import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const out='scratch/2026-10-31-forged-hud-implementation/house-wells';
mkdirSync(out,{recursive:true});
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||(existsSync(chrome)?chrome:undefined)});
const errors=[];
try{
 const page=await browser.newPage({viewport:{width:1280,height:960},deviceScaleFactor:1});
 page.on('pageerror',error=>errors.push(String(error)));
 await page.goto(process.env.GAME_URL||'http://127.0.0.1:5173/',{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.__game&&document.documentElement.dataset.assets==='ready');
 if(await page.locator('#dialog').isVisible())await page.keyboard.press('Escape');
 const report=await page.evaluate(async()=>{
  const {buildAt,validateBuildAt,cancelConstruction,moveUnit,BUILD_COSTS,selectAt}=await import('/src/game/simulation.ts');
  const {ensureBuilders,updateBuilder}=await import('/src/game/builders.ts');
  const {updateConstruction}=await import('/src/game/structures.ts');
  const {updateWellUpgrades}=await import('/src/game/wells.ts');
  const {canWalk}=await import('/src/game/pathfinding.ts');
  const {removeBuildings}=await import('/src/game/construction-cancellation.ts');
  const {updateFog}=await import('/src/game/fog.ts');
  const {buildingAtPoint}=await import('/src/game/hit-testing.ts');
  const {drawBuilding}=await import('/src/game/sprites.ts');
  const {drawPunyBuildingRegion,NATIVE_BUILDINGS}=await import('/src/game/puny-building-art.ts');
  const {Renderer}=await import('/src/game/renderer.ts');
  const {buildingIconUrl}=await import('/src/ui/icons.ts');
  window.__game.state.paused=true;
  const check=(ok,message)=>{if(!ok)throw new Error(message);};
  const fixture=()=>{
   const state={
    world:{width:32,height:24,seed:'house-well-integration',source:'QA',spawns:[],revision:0,tiles:Array.from({length:768},(_,i)=>({terrain:'grassland',overlay:'none',elevation:.3,moisture:.5,food:3,production:1,gold:0,variation:((i*13)%100)/100}))},
    buildings:[{id:1,kind:'palace',faction:0,x:6,y:10,hp:650,maxHp:650,capacity:0}],
    units:[{id:2,kind:'leader',faction:0,x:14.5,y:12.5,hp:100,maxHp:100,morale:100,attack:25,defense:5,speed:3.6,range:4,order:'hold',cooldown:0,lastCombat:-60,moving:false,facing:0,attackTime:0}],
    factions:[{id:0,name:'Blue',color:'#3988ff',affinity:100,relation:'self',food:500,gold:2000,production:0,population:30,culture:10000,growth:0,yields:{food:0,production:0,gold:0},nextRaid:10000,defeated:false}],
    time:0,tick:0,paused:true,speed:1,events:[],particles:[],projectiles:[],bloodEffects:[],fields:[],treeClearings:[],selected:null,selectedType:null,buildMode:null,diplomacy:null,gameOver:false,victory:false,seed:'house-well-integration',rngState:1,marauderPacks:[],raiderCamps:[],roamingMaraudersVersion:1,fogRaids:{nextAt:10000,waves:0,pressureVersion:1},treasures:[]};
   updateFog(state);return state;
  };
  const advance=(state,predicate,seconds=90)=>{
   for(let step=0;step<seconds*10&&!predicate();step++){
    state.time+=.1;updateConstruction(state);ensureBuilders(state);
    for(const unit of state.units)if(unit.builder&&unit.hp>0)updateBuilder(state,unit,.1,moveUnit);
   }
   check(predicate(),'Builder did not complete independent shared-tile orders');
   updateWellUpgrades(state);
  };
  const newOrder=(state,kind)=>{
   const previous=new Set(state.buildings.map(b=>b.id)),result=buildAt(state,kind,12,8);
   check(result.ok,`${kind} at shared tile rejected: ${result.message}`);
   return state.buildings.find(b=>!previous.has(b.id)&&b.kind===kind);
  };
  const result={orders:[],cancellations:[],independence:[],selection:[],art:[],renderOrder:[],preview:[],renders:[]};
  for(const kinds of[['house','well'],['well','house']])for(const simultaneous of[false,true]){
   const state=fixture(),first=newOrder(state,kinds[0]);
   if(!simultaneous)advance(state,()=>!first.construction);
   const second=newOrder(state,kinds[1]);
   check(state.factions[0].gold===2000-BUILD_COSTS.house.gold-BUILD_COSTS.well.gold,'Each order must charge its normal cost once');
   check(!validateBuildAt(state,'house',12,8).ok&&!validateBuildAt(state,'well',12,8).ok,'Duplicate house/well must be rejected');
   advance(state,()=>!first.construction&&!second.construction);
   const home=state.buildings.find(b=>b.kind==='house'),well=state.buildings.find(b=>b.kind==='well');
   check(home.houseLevel===2&&home.capacity===6,'Completed co-located well must upgrade the completed home');
   check(!canWalk(state,12.5,8.5,0),'Shared footprint must block movement');
   result.orders.push({order:kinds.join(' → '),simultaneous,houseId:home.id,wellId:well.id,houseLevel:home.houseLevel,capacity:home.capacity,seconds:state.time});
   for(const kindsToRemove of[['well','house'],['house','well']]){
    const copy={...state,buildings:state.buildings.map(b=>({...b})),units:[],world:{...state.world}};
    const removed=copy.buildings.find(b=>b.kind===kindsToRemove[0]),survivor=copy.buildings.find(b=>b.kind===kindsToRemove[1]);
    removed.hp=0;
    check(!canWalk(copy,12.5,8.5,0),'Destroying one layer must not unblock the surviving layer');
    check(survivor.hp>0,'Other building must survive damage');
    removeBuildings(copy,new Set([removed.id]));
    check(copy.buildings.includes(survivor)&&!canWalk(copy,12.5,8.5,0),'Removing one layer must preserve the other solid entity');
    result.independence.push({removed:kindsToRemove[0],survivor:kindsToRemove[1],solid:true});
   }
  }
  for(const order of[['house','well'],['well','house']]){
   const state=fixture(),first=newOrder(state,order[0]);advance(state,()=>!first.construction);
   const second=newOrder(state,order[1]),before=state.factions[0].gold,canceled=cancelConstruction(state,second.id);
   check(canceled.ok&&canceled.refund===BUILD_COSTS[second.kind].gold,'Queued shared layer must refund independently');
   check(state.buildings.includes(first)&&!state.buildings.includes(second)&&!canWalk(state,12.5,8.5,0),'Cancellation must preserve completed host');
   result.cancellations.push({kept:first.kind,canceled:second.kind,refund:canceled.refund,gold:state.factions[0].gold-before});
  }
  for(const kind of['house','well']){
   const state=fixture();window.__game.entities(state).buildings.add({id:20,kind,faction:1,x:12,y:8,hp:100,maxHp:100,capacity:0});
   check(!validateBuildAt(state,kind==='house'?'well':'house',12,8).ok,'Cannot share with enemy structure');
  }
  for(const host of['wall','woodenTower','monument']){
   const state=fixture();window.__game.entities(state).buildings.add({id:20,kind:host,faction:0,x:12,y:8,hp:100,maxHp:100,capacity:0});
   check(!validateBuildAt(state,'well',12,8).ok&&!validateBuildAt(state,'house',12,8).ok,'Other structures cannot share this tile');
  }
  const make=(w,h=w)=>{const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;canvas.getContext('2d').imageSmoothingEnabled=false;return canvas;};
  const pixels=canvas=>canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
  const diff=(a,b)=>{let n=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])n++;return n;};
  const building=(kind,x,y,id,extra={})=>({kind,x,y,id,faction:0,hp:100,maxHp:100,capacity:kind==='house'?4:0,...extra});
  for(const color of['#3988ff','#f34f59','#7f46c9'])for(const tier of[1,2,3]){
   const a=make(64,64),e=make(64,64),ac=a.getContext('2d'),ec=e.getContext('2d');
   drawBuilding(ac,building('house',0,0,10,{houseLevel:tier}),20,12,32,0,color);
   drawBuilding(ac,building('well',0,0,11),20,12,32,0,color,undefined,undefined,true);
   drawPunyBuildingRegion(ec,NATIVE_BUILDINGS.houses[tier].rect,20,12,32,32,color);
   drawPunyBuildingRegion(ec,[80,480,16,16],8,18,32,32,color);
   const different=diff(pixels(a),pixels(e));check(different===0,`Production pair must match option2A for tier${tier}/${color}`);
   result.art.push({tier,color,differentBytes:different});
  }
  for(const color of['#3988ff','#f34f59','#7f46c9']){
   const a=make(32),e=make(32);drawBuilding(a.getContext('2d'),building('well',0,0,11),0,0,32,0,color);
   drawPunyBuildingRegion(e.getContext('2d'),[80,480,16,16],0,0,32,32,color);
   const different=diff(pixels(a),pixels(e));check(different===0,'Standalone well must use native narrow art');result.art.push({standalone:true,color,differentBytes:different});
  }
  const render=async(state,{width=512,height=256,zoom=2,camera={x:13.5,y:9},preview=null}={})=>{
   const canvas=document.createElement('canvas'),mini=make(32);canvas.width=width;canvas.height=height;canvas.style.width=width+'px';canvas.style.height=height+'px';mini.style.width=mini.style.height='32px';document.body.append(canvas,mini);
   const renderer=new Renderer(canvas,mini); await renderer.initialize();renderer.follow=false;renderer.zoom=zoom;renderer.camera=camera;renderer.hover=preview;renderer.buildPreview=preview?[preview]:[];
   renderer.draw(state,0);const snapshot=await renderer.snapshot();renderer.destroy();canvas.remove();mini.remove();return snapshot;
  };
  const visual=fixture();window.__game.entities(visual).units.replace([]);window.__game.entities(visual).buildings.replace([building('palace',6,10,1),building('tower',10,6,99)]);
  for(let tier=1;tier<=3;tier++)window.__game.entities(visual).buildings.add(building('well',9+tier*3,8,20+tier),building('house',9+tier*3,8,10+tier,{houseLevel:tier}));
  window.__game.entities(visual).buildings.add(building('well',21,8,30));visual.fog=undefined;updateFog(visual);
  const production=await render(visual,{width:768,height:280,zoom:2,camera:{x:17,y:9.3}});
  result.renders.push({name:'completed-pairs.png',data:production.toDataURL()});
  const reversed=await render({...visual,buildings:[...visual.buildings].reverse()},{width:768,height:280,zoom:2,camera:{x:17,y:9.3}});
  const orderDiff=diff(pixels(production),pixels(reversed));check(orderDiff===0,'Creation order must not alter house/well compositing');result.renderOrder.push({differentBytes:orderDiff});
  for(const reverse of[false,true]){
   const state=fixture();window.__game.entities(state).units.replace([]);const house=building('house',12,8,10,{houseLevel:2}),well=building('well',12,8,11);window.__game.entities(state).buildings.add(...(reverse?[well,house]:[house,well]));state.fog=undefined;updateFog(state);
   for(const [x,y,kind]of[[11.95,8.85,'well'],[12.1,8.55,'well'],[12.65,8.5,'house']]){
    const picked=buildingAtPoint(state,{x,y});check(picked?.kind===kind,`Select${kind} at${x},${y} independent of creation order`);
    selectAt(state,x,y);check(state.selected===picked.id&&state.selectedType==='building','Pointer selection must select the picked layer');result.selection.push({reverse,x,y,selected:kind});
   }
   for(const pendingKind of['house','well']){
    const pending=state.buildings.find(b=>b.kind===pendingKind);
    pending.construction={startedAt:0,duration:20,waitingForBuilder:true};
    check(buildingAtPoint(state,{x:11.95,y:8.85})?.id===well.id,'Attached well remains separately selectable during either construction order');
    check(buildingAtPoint(state,{x:12.65,y:8.5})?.id===house.id,'House remains separately selectable during either construction order');
    result.selection.push({reverse,pending:pendingKind,wellAndHouseSelectable:true});delete pending.construction;
   }
  }
  for(const [hostKind,previewKind]of[['house','well'],['well','house']]){
   const state=fixture();window.__game.entities(state).units.replace([]);window.__game.entities(state).buildings.add(building(hostKind,12,8,20,{houseLevel:2}));
   // Keep a real leader for placement validation while moving its picture off this crop.
   window.__game.entities(state).units.replace([{...fixture().units[0],x:14.5,y:12.5}]);state.buildMode=previewKind;state.fog=undefined;updateFog(state);
   check(validateBuildAt(state,previewKind,12,8).ok,'Preview should be legal for shared tile');
   const preview=await render(state,{preview:{x:12,y:8},camera:{x:12.7,y:9},width:320,height:224,zoom:2});
   result.renders.push({name:`preview-${previewKind}-on-${hostKind}.png`,data:preview.toDataURL()});result.preview.push({host:hostKind,preview:previewKind,valid:true});
  }
  const sites=fixture();window.__game.entities(sites).units.replace([]);window.__game.entities(sites).buildings.replace([building('palace',6,10,1),building('tower',10,6,99)]);
  window.__game.entities(sites).buildings.add(building('house',12,8,10,{houseLevel:2}),building('well',12,8,11,{construction:{startedAt:0,duration:100}}),building('well',15,8,12),building('house',15,8,13,{construction:{startedAt:0,duration:100}}));
  sites.time=50;sites.fog=undefined;updateFog(sites);
  result.renders.push({name:'construction-layers.png',data:(await render(sites,{camera:{x:14,y:9},width:512,height:280,zoom:2})).toDataURL()});
  const icon=new Image();icon.src=buildingIconUrl('well','#3988ff');await icon.decode();result.icon={width:icon.naturalWidth,height:icon.naturalHeight,ready:icon.naturalWidth>0};
  const live=fixture();window.__game.entities(live).buildings.add(building('house',12,8,10,{houseLevel:2}),building('well',12,8,11));
  window.__game.replaceState(live);const gameRenderer=window.__game.renderer;
  gameRenderer.follow=false;gameRenderer.zoom=3;gameRenderer.camera={x:12.5,y:8.8};gameRenderer.hover=null;gameRenderer.buildPreview=[];
  selectAt(window.__game.state,12.65,8.5);
  return result;
 });
 await page.waitForFunction(()=>document.querySelector('#selection-name').textContent.includes('House'));
 await page.screenshot({path:`${out}/selection-house.png`});
 await page.evaluate(async()=>{const {selectAt}=await import('/src/game/simulation.ts');selectAt(window.__game.state,11.95,8.85);});
 await page.waitForFunction(()=>document.querySelector('#selection-name').textContent==='Well');
 await page.screenshot({path:`${out}/selection-well.png`});
 await page.evaluate(()=>{const well=window.__game.state.buildings.find(b=>b.kind==='well');well.construction={startedAt:0,duration:20,waitingForBuilder:true,paidGold:50};});
 await page.waitForFunction(()=>document.querySelector('#selection-panel').title.includes('Awaiting builder'));
 await page.screenshot({path:`${out}/selection-pending-well.png`});
 const beforeClear=await page.evaluate(()=>window.__game.state.factions[0].gold);
 await page.keyboard.press('c');
 assert.equal(await page.locator('[data-action="clear"]').getAttribute('aria-pressed'),'true');
 const target=await page.evaluate(()=>window.__game.renderer.screenPoint({x:12.5,y:8.5}));
 assert.equal(await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.id,target),'world');
 await page.mouse.click(target.x,target.y);
 const cleared=await page.evaluate(()=>({wellPresent:window.__game.state.buildings.some(b=>b.kind==='well'),housePresent:window.__game.state.buildings.some(b=>b.kind==='house'),gold:window.__game.state.factions[0].gold}));
 assert.deepEqual(cleared,{wellPresent:false,housePresent:false,gold:beforeClear+50});
 report.hud={houseSelected:true,wellSelected:true,unifiedClearRemovesBothLayers:true,pendingWellRefund:cleared.gold-beforeClear,cleared};
 await page.screenshot({path:`${out}/cleared-shared-tile.png`});
 for(const render of report.renders)writeFileSync(`${out}/${render.name}`,Buffer.from(render.data.split(',')[1],'base64'));
 report.renders=report.renders.map(({name})=>name);report.errors=errors;assert.deepEqual(errors,[]);report.pass=true;
 writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');
 console.log('PASS house/well shared placement in both build orders, real builder completion, cancellation, independent occupancy, native art, selection, previews, and unified Clear across the shared tile.');
}finally{await browser.close();}
