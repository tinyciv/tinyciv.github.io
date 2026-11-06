import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
const output = 'scratch/2026-10-27-ford-stones/qa';
mkdirSync(output, { recursive: true });
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
  const report = await page.evaluate(async () => {
    const { drawOverlay } = await import('/src/game/sprites.ts');
    const { fordCrossingAxis, fordStoneLayout } = await import('/src/game/ford-art.ts');
    const { punyWorldImage } = await import('/src/game/puny-world.ts');
    const { drawAnimatedWater, paintTerrain } = await import('/src/game/terrain.ts');
    const { canWalk, movementMultiplier } = await import('/src/game/pathfinding.ts');
    const { Renderer } = await import('/src/game/renderer.ts');
    window.__game.state.paused = true;
    const check = (ok, why) => { if (!ok) throw new Error(why); };
    const make = (width, height = width) => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; canvas.getContext('2d').imageSmoothingEnabled = false; return canvas; };
    const pixels = canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const different = (a,b) => { let n=0; for(let i=0;i<a.length;i++) if(a[i]!==b[i]) n++; return n; };
    const atlas = punyWorldImage();
    const palette = new Map([[0x646b41,0x67512a],[0x787f4f,0x807c5a],[0xa6ae78,0x938f69],[0xb2ba82,0xd8bf8e]]);
    const expectedOverlay=(axis,variation=0)=>{
      const canvas=make(16),c=canvas.getContext('2d');
      for(const {rect,x,y,tan} of fordStoneLayout(axis,variation)){
        const stone=make(rect[2],rect[3]),sc=stone.getContext('2d');sc.drawImage(atlas,...rect,0,0,rect[2],rect[3]);
        if(tan){
          const pixels=sc.getImageData(0,0,stone.width,stone.height);
          for(let i=0;i<pixels.data.length;i+=4)if(pixels.data[i+3]){
            const color=palette.get(pixels.data[i]*65536+pixels.data[i+1]*256+pixels.data[i+2]);
            check(color!==undefined,'Stone crop contains an unexpected source color');
            pixels.data[i]=color>>>16;pixels.data[i+1]=(color>>>8)&255;pixels.data[i+2]=color&255;
          }
          sc.putImageData(pixels,0,0);
        }
        c.drawImage(stone,x,y);
      }
      const enlarged=make(32);enlarged.getContext('2d').drawImage(canvas,0,0,32,32);return enlarged;
    };
    const result={pixels:[],scenes:[],images:[]};
    for(const axis of ['vertical','horizontal'])for(const variation of[0,.4,.99]){
      const actual=make(32),expected=expectedOverlay(axis,variation);
      drawOverlay(actual.getContext('2d'),'ford',0,0,32,0,variation,axis);
      const a=pixels(actual),e=pixels(expected),diff=different(a,e);
      check(diff===0,`${axis} production must be exact native crop at 2x with the chosen tan palette`);
      let opaque=0,transparent=0,partial=0;
      for(let i=3;i<a.length;i+=4){if(a[i]===255)opaque++;else if(a[i]===0)transparent++;else partial++;}
      check(opaque>0&&transparent>512&&partial===0,'Ford must retain open water gaps with no blended edge pixels');
      result.pixels.push({axis,variation,differentBytes:diff,opaque,transparent,partial,opaqueAt64:opaque*4});
    }
    const fixture=axis=>{
      const state=structuredClone(window.__game.state);
      state.world={width:24,height:24,seed:'ford-qa-'+axis,source:'QA',spawns:[],revision:1,tiles:Array.from({length:576},(_,i)=>{
        const x=i%24,y=Math.floor(i/24),river=axis==='vertical'?y===12:x===12;
        return {terrain:river?'river':'grassland',overlay:x===12&&y===12?'ford':'none',elevation:.3,moisture:.5,food:0,production:0,gold:0,variation:0};
      })};
      const base=window.__game.state.units.find(u=>u.kind==='leader'&&u.faction===0);
      window.__game.entities(state).units.replace([{...base,id:910,kind:'warrior',x:axis==='vertical'?10.5:10.5,y:axis==='vertical'?11:11.5,moving:false,attackTime:0,order:'hold',inside:false,selected:false},{...base,id:911,kind:'worker',x:axis==='vertical'?14.5:14.5,y:axis==='vertical'?14:13.5,moving:false,attackTime:0,order:'hold',inside:false,selected:false}]);
      window.__game.entities(state).buildings.replace([]);state.fields=[];state.fog=undefined;state.particles=[];state.projectiles=[];state.bloodEffects=[];state.treeClearings=[];state.marauderPacks=[];state.raiderCamps=[];state.treasures=[];state.selected=null;state.selectedType=null;state.buildMode=null;state.time=0;state.paused=true;return state;
    };
    for(const axis of ['vertical','horizontal']){
      const state=fixture(axis),world=state.world;
      check(fordCrossingAxis(world,12,12)===axis,'Ford layout must cross the actual opposite banks');
      check(canWalk(state,12.5,12.5,0),'Ford must stay walkable');
      check(movementMultiplier(state,12.5,12.5)===.45,'Ford must use its 0.45x movement multiplier');
      const adjacent=axis==='vertical'?{x:11.5,y:12.5}:{x:12.5,y:11.5};
      check(!canWalk(state,adjacent.x,adjacent.y,0),'River outside the ford remains impassable');
      const canvas=document.createElement('canvas'),mini=make(32);canvas.width=384;canvas.height=224;canvas.style.width='384px';canvas.style.height='224px';mini.style.width=mini.style.height='32px';document.body.append(canvas,mini);
      const renderer=new Renderer(canvas,mini); await renderer.initialize();renderer.follow=false;renderer.zoom=1;renderer.camera={x:12.5,y:12.5};
      const frames=[],bases=[],stones=pixels(expectedOverlay(axis));let uncoveredChanged=0,coveredChanged=0;
      for(let frame=0;frame<4;frame++){
        state.time=frame/3+.001;renderer.draw(state,0);
        const raw=(await renderer.snapshot()).getContext('2d').getImageData(176,96,32,32).data;
        const base=make(32);drawAnimatedWater(base.getContext('2d'),world,12,12,0,0,32,state.time);
        const bp=pixels(base),expected=make(32);expected.getContext('2d').drawImage(base,0,0);expected.getContext('2d').drawImage(expectedOverlay(axis),0,0);
        const fullDiff=different(raw,pixels(expected));check(fullDiff===0,'Real Renderer must use bank-aware overlay over unchanged animated water');
        frames.push(new Uint8ClampedArray(raw));bases.push(bp);
        if(frame===0){result.images.push({name:`production-${axis}.png`,data:canvas.toDataURL()});const enlarged=make(768,448);enlarged.getContext('2d').drawImage(canvas,0,0,768,448);result.images.push({name:`production-${axis}-2x.png`,data:enlarged.toDataURL()});}
      }
      for(let i=0;i<stones.length;i+=4){
        const changes=frames.slice(1).some(frame=>frame[i]!==frames[0][i]||frame[i+1]!==frames[0][i+1]||frame[i+2]!==frames[0][i+2]);
        if(stones[i+3])coveredChanged+=Number(changes);else{
          uncoveredChanged+=Number(changes);
          for(let f=0;f<4;f++)check(frames[f][i]===bases[f][i]&&frames[f][i+1]===bases[f][i+1]&&frames[f][i+2]===bases[f][i+2],'Transparent stone gaps must preserve every terrain pixel');
        }
      }
      check(uncoveredChanged>0&&coveredChanged===0,'Water should animate at 3fps while the stone surfaces stay still');
      result.scenes.push({axis,fordWalkable:true,riverBlocked:true,movementMultiplier:.45,uncoveredAnimatedPixels:uncoveredChanged,stoneAnimatedPixels:coveredChanged,rendererMatchesNativeComposition:true});
      window.__game.entities(state).buildings.replace([{id:930,kind:'bridge',faction:0,x:12,y:12,hp:100,maxHp:100,capacity:0}]);
      state.time=0;renderer.draw(state,0);const bridgePixels=new Uint8ClampedArray(pixels(await renderer.snapshot()));
      result.images.push({name:`bridge-${axis}.png`,data:canvas.toDataURL()});
      world.tiles[12*24+12].overlay='none';world.revision++;renderer.draw(state,0);
      const bridgeFordDifference=different(bridgePixels,pixels(await renderer.snapshot()));
      result.scenes[result.scenes.length-1].bridgeFordDifference=bridgeFordDifference;
      check(bridgeFordDifference===0,'Completed bridges must cover ford stones instead of drawing stones over the planks');
      check(movementMultiplier(state,12.5,12.5)===1,'Bridge should remove the ford movement penalty');
      for(const waitingForBuilder of [true,false]){
        state.buildings[0].construction={startedAt:0,duration:20,waitingForBuilder};
        world.tiles[12*24+12].overlay='ford';world.revision++;renderer.draw(state,0);
        const pendingBridgeFord=new Uint8ClampedArray(pixels(await renderer.snapshot()));
        world.tiles[12*24+12].overlay='none';world.revision++;renderer.draw(state,0);
        const pendingBridgeFordDifference=different(pendingBridgeFord,pixels(await renderer.snapshot()));
        check(pendingBridgeFordDifference>0,'Queued and active bridges should retain the visible ford until completion');
        result.scenes[result.scenes.length-1][waitingForBuilder?'queuedBridgeKeepsFord':'activeBridgeKeepsFord']=true;
      }
      renderer.destroy();canvas.remove();mini.remove();
    }
    return result;
  });
  for(const image of report.images)writeFileSync(`${output}/${image.name}`,Buffer.from(image.data.split(',')[1],'base64'));
  report.images=report.images.map(({name})=>name);report.errors=errors;report.pass=true;assert.deepEqual(errors,[]);
  writeFileSync(`${output}/ford-art-report.json`,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
