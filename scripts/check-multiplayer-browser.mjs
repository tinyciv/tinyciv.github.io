import { ClientStateReplica } from './multiplayer-wire.mjs';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
const out='output/multiplayer-browser',checks=[],errors=[],diagnostics=[],states=new Map(),replicas=new Map(),sequences=new Map(),resyncing=new Set(),wireCounts=new Map(),roomName=`Browser UI QA ${Date.now()}`;
await mkdir(out,{recursive:true});
const endpoint=process.env.GAME_URL||'https://d120onxzjgx6ss.cloudfront.net';
const executablePath=process.env.CHROME_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined);
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader'],...(executablePath?{executablePath}:{})});
const contextA=await browser.newContext({viewport:{width:1440,height:900}}),contextB=await browser.newContext({viewport:{width:390,height:700}}),a=await contextA.newPage(),b=await contextB.newPage();
const check=(name,pass,detail)=>{checks.push({name,pass,detail});console.log(`${pass?'PASS':'FAIL'} ${name}`);assert.ok(pass,`${name}: ${JSON.stringify(detail)}`);};
const game=async page=>{const s=states.get(page);const l=s?.units.find(u=>u.kind==='leader'&&u.faction===s.playerFaction);return {faction:s?.playerFaction,x:l?.x,y:l?.y,stance:s?.retinueStance,time:s?.time,paused:s?.paused};};
const until=async(test,message,timeout=90000)=>{const start=Date.now();while(!await test()){if(Date.now()-start>timeout)throw Error(`${message}; ${JSON.stringify({errors,wireCounts:Object.fromEntries(wireCounts),diagnostics:diagnostics.slice(-20)})}`);await new Promise(resolve=>setTimeout(resolve,100));}};
try{
 for(const page of [a,b]){
  const peer=page===a?'desktop':'mobile',counts={snapshot:0,frame:0,gaps:0,stale:0};wireCounts.set(peer,counts);
  page.on('pageerror',e=>errors.push(`${peer}: ${e}`));
  page.on('response',response=>{if(response.status()>=400)diagnostics.push({peer,status:response.status(),url:response.url()});});
  page.on('requestfailed',request=>diagnostics.push({peer,requestFailed:request.url(),reason:request.failure()?.errorText}));
  page.on('framenavigated',frame=>{if(frame===page.mainFrame())diagnostics.push({peer,navigation:frame.url()});});
  page.on('console',message=>{if(message.type()==='error'||message.text().includes('[vite]'))diagnostics.push({peer,console:message.text()});});
  page.on('websocket',socket=>{if(!socket.url().includes('/api/ws'))return;socket.on('framereceived',event=>{
    let message;
    try{message=JSON.parse(String(event.payload));}catch(error){errors.push(`${peer} wire parse: ${error}`);return;}
    try{
      if(message.type==='snapshot'){counts.snapshot++;states.set(page,message.state);replicas.set(page,new ClientStateReplica(message.state));sequences.set(page,message.sequence);resyncing.delete(page);sequences.set(page,message.sequence);diagnostics.push({peer,type:'snapshot',sequence:message.sequence,time:message.state.time,bytes:String(event.payload).length});}
      else if(message.type==='frame'&&states.has(page)){counts.frame++;if(message.sequence<=sequences.get(page)){counts.stale++;return;}if(message.sequence!==sequences.get(page)+1){counts.gaps++;return;}const state=states.get(page);for(const [index,tile]of message.tiles||[])state.world.tiles[index]=tile;if(message.worldRevision!==undefined)state.world.revision=message.worldRevision;replicas.get(page).apply(message.delta);sequences.set(page,message.sequence);}
      else if(message.type==='error'||message.type==='room')diagnostics.push({peer,type:message.type,message:message.message,phase:message.room?.phase});
    }catch(error){errors.push(`${peer} ${message.type} ${message.sequence}: ${String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'[wire-bundle]')}`);}
  });});
  // Block the development HMR socket at any local port, while leaving the
  // game's socket available even when a production proxy shares that origin.
  await page.routeWebSocket(url=>url.origin.replace(/^ws/,'http')===new URL(endpoint).origin&&url.pathname!=='/api/ws',()=>{});
  await page.addInitScript(multiplayerUrl=>{const Original=window.WebSocket;window.__qaSockets=[];window.WebSocket=class extends Original{constructor(...args){if(multiplayerUrl&&new URL(String(args[0]),location.href).pathname==='/api/ws'){const target=new URL(multiplayerUrl);target.protocol=target.protocol==='https:'?'wss:':'ws:';target.pathname='/api/ws';target.search='';target.hash='';args[0]=target.href;}super(...args);window.__qaSockets.push(this);}};},process.env.MULTIPLAYER_URL||null);await page.goto(endpoint,{waitUntil:'networkidle'});await page.waitForFunction(()=>document.documentElement.dataset.assets==='ready',null,{timeout:120000});await page.locator('[data-frontend-action="multiplayer"]').click();await page.locator('[data-form="server"]').waitFor();}
 await a.locator('[name="player-name"]').fill('Blue Commander');await a.locator('[name="room-name"]').fill(roomName);await a.getByText('World options',{exact:true}).click();await a.locator('[name="seed"]').fill('BTV-E2E-1V1');await a.locator('[name="style"]').selectOption('pangaea');await a.locator('[data-form="server"] button[type="submit"]').click();await a.locator('.lobby-players').waitFor();
 await b.locator('[data-frontend-action="refresh"]').click();await b.getByRole('button',{name:roomName,exact:true}).waitFor();await b.locator('[name="player-name"]').fill('Red Commander');await b.locator('[name="player-color"]').selectOption('#df6262');await b.getByRole('button',{name:roomName,exact:true}).click();check('Browser row selection preserves profile draft',await b.locator('[name="player-name"]').inputValue()==='Red Commander');await b.locator('[data-frontend-action="join"]').click();await b.locator('.lobby-players').waitFor();await a.getByText('Red Commander',{exact:true}).waitFor();
 check('Both players appear in lobby',await a.locator('.lobby-player').count()===2&&await b.getByText('Blue Commander',{exact:true}).isVisible());
 await a.screenshot({path:`${out}/production-lobby-1440.png`});await b.screenshot({path:`${out}/production-lobby-390.png`});
 check('Mobile lobby contained',await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await a.locator('[name="ready"]').check();await b.locator('[name="ready"]').check();await a.locator('[data-frontend-action="start"]:enabled').waitFor();await a.locator('[data-frontend-action="start"]').click();
 await Promise.all([a,b].map(page=>until(async()=>states.get(page)?.multiplayer&&await page.locator('#frontend').isHidden(),'Match did not start')));
 const beforeA=await game(a),beforeB=await game(b);check('Each client controls its own faction',beforeA.faction===0&&beforeB.faction===1,{beforeA,beforeB});
 check('Online pause and speed disabled',await a.locator('#pause').isDisabled()&&await a.locator('#speed').isDisabled());
 await a.keyboard.down('d');await a.waitForTimeout(1000);await a.keyboard.up('d');await b.keyboard.down('a');await b.waitForTimeout(1000);await b.keyboard.up('a');await a.waitForTimeout(500);
 const afterA=await game(a),afterB=await game(b);check('Both players move through authoritative input',Math.hypot(afterA.x-beforeA.x,afterA.y-beforeA.y)>.1&&Math.hypot(afterB.x-beforeB.x,afterB.y-beforeB.y)>.1,{beforeA,beforeB,afterA,afterB});
 await a.locator('[data-hotbar-action="stance"]').click();await until(async()=>(await game(a)).stance!==beforeA.stance,'Authoritative stance change did not arrive',15000);const stanceA=await game(a),stanceB=await game(b);check('Stance is faction-specific',stanceA.stance!==beforeA.stance&&stanceB.stance===beforeB.stance,{beforeA,beforeB,stanceA,stanceB});
 await a.keyboard.press('Escape');await a.locator('[data-frontend-action="resume"]').waitFor();const t=(await game(a)).time;await a.waitForTimeout(650);check('Online menu does not pause the match',(await game(a)).time>t&&!(await game(a)).paused);await a.locator('[data-frontend-action="resume"]').click();
 await a.screenshot({path:`${out}/production-online-1440.png`});await b.screenshot({path:`${out}/production-online-390.png`});
 await a.evaluate(()=>window.__qaSockets.find(s=>s.url.includes('/api/ws')&&s.readyState===WebSocket.OPEN).close());await a.locator('#network-status').waitFor({state:'visible'});check('Disconnect is visible over gameplay',/Reconnect|lost/i.test(await a.locator('#network-status').innerText()));await a.screenshot({path:`${out}/production-reconnecting-1440.png`});
 await a.waitForFunction(()=>window.__qaSockets.filter(s=>s.url.includes('/api/ws')&&s.readyState===WebSocket.OPEN).length===1);await a.waitForTimeout(650);check('Reconnect stays in the match',await a.locator('#frontend').isHidden()&&(await game(a)).faction===0);
 await a.keyboard.press('Escape');await a.locator('[data-frontend-action="leave"]').click();await a.locator('[data-form="server"]').waitFor();await b.locator('#leave-match').waitFor();check('Opponent departure shows Victory',await b.locator('#dialog-title').innerText()==='Victory');await b.locator('#leave-match').click();await b.locator('[data-form="server"]').waitFor();
 check('Both players can leave to browser',await a.locator('[data-form="server"]').isVisible()&&await b.locator('[data-form="server"]').isVisible());
 check('No browser runtime errors',errors.length===0,errors);
}catch(error){checks.push({name:'fatal',pass:false,detail:String(error)});await Promise.allSettled([a.screenshot({path:`${out}/production-failure-a.png`,timeout:10000}),b.screenshot({path:`${out}/production-failure-b.png`,timeout:10000})]);throw error;}finally{await Promise.allSettled([a,b].map(page=>page.evaluate(()=>{for(const socket of window.__qaSockets||[])if(socket.url.includes('/api/ws')&&socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'leave'}));})));await writeFile(`${out}/production-browser-report.json`,JSON.stringify({checks,errors,wireCounts:Object.fromEntries(wireCounts),diagnostics},null,2));await browser.close();console.log(JSON.stringify({checks:checks.length,errors},null,2));}

