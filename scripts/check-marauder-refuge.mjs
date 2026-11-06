import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const folder='scratch/2026-11-05-marauder-refuge';
await mkdir(folder,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page=await browser.newPage({viewport:{width:1100,height:800},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));

try {
  await page.goto(process.env.GAME_URL||'http://127.0.0.1:5188/',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.documentElement.dataset.assets==='ready',null,{timeout:60000});
  const result=await page.evaluate(async()=>{
    const [{Renderer},{initializeRaiderCamps},{createGame},navigation]=await Promise.all([
      import('/src/game/renderer.ts'),import('/src/game/raider-camps.ts'),import('/src/game/simulation.ts'),import('/src/game/pathfinding.ts')]);
    const world={width:112,height:96,seed:'refuge-visual',source:'test',spawns:[{x:48,y:40}],tiles:Array.from({length:112*96},(_,i)=>({terrain:'grassland',overlay:'none',elevation:.3,moisture:.5,food:1,production:0,gold:0,variation:(i*29%997)/997}))};
    const state=createGame(world);initializeRaiderCamps(state);state.paused=true;state.selected=null;
    const canvas=document.createElement('canvas'),mini=document.createElement('canvas');canvas.style.cssText='width:1100px;height:800px';mini.width=mini.height=160;
    canvas.style.position='fixed';canvas.style.inset='0';canvas.style.zIndex='999999';document.body.append(canvas);const renderer=new Renderer(canvas,mini);await renderer.initialize();renderer.follow=false;
    const prepare=renderer.prepareFog.bind(renderer);renderer.prepareFog=fog=>{fog.visible.fill(1);fog.explored.fill(1);fog.buildings=state.buildings;fog.fields=state.fields??[];prepare(fog);};renderer.gpu.drawFog=()=>{};
    const pictures={},checks=[];
    for(const camp of state.raiderCamps){
      renderer.camera={x:camp.x+camp.width/2,y:camp.y+camp.height/2};renderer.zoom=1.1;renderer.draw(state,0);
      pictures[camp.size]=renderer.snapshot().toDataURL();
      const outside={x:camp.x-1.5,y:camp.y-1.5};
      checks.push({size:camp.size,coreTowers:camp.coreTowers.length,tents:camp.houses.length,
        friendlyRefugePath:navigation.findPath(state,outside,camp.refuge,-2).length>0,
        hostileRefugePath:navigation.findPath(state,outside,camp.refuge,0).some(p=>Math.hypot(p.x-camp.refuge.x,p.y-camp.refuge.y)<.5)});
    }
    renderer.destroy();return {pictures,checks};
  });
  for(const [name,data] of Object.entries(result.pictures))await writeFile(`${folder}/${name}.png`,Buffer.from(data.split(',')[1],'base64'));
  assert.ok(result.checks.length>=2);assert.ok(result.checks.every(c=>c.coreTowers===4&&c.friendlyRefugePath&&!c.hostileRefugePath));
  assert.deepEqual(errors,[]);await writeFile(`${folder}/checks.json`,JSON.stringify({checks:result.checks,errors},null,2));console.log(JSON.stringify(result.checks,null,2));
} catch(error) { console.error(JSON.stringify({errors,state:await page.evaluate(()=>({assets:document.documentElement.dataset.assets,text:document.body.innerText.slice(0,500)}))}));throw error; } finally {await browser.close();}
