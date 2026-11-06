import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const output = 'scratch/2026-11-03-formation'; mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), checks = [], errors = [];
page.on('pageerror', error => errors.push(String(error)));
const check = (label, value, data) => { checks.push({ label, pass: !!value, data }); console.log(label, !!value, JSON.stringify(data)); assert.ok(value, label); };
const inputPose = async (seconds = 0) => page.evaluate(seconds => {
  if (seconds) formationLab.step(seconds);
  const lab = formationLab.lab;
  return { x: lab.leader.x, y: lab.leader.y, heading: lab.heading, slotError: lab.slotError,
    units: lab.troops.map(unit => ({ x: unit.x, y: unit.y, facing: unit.facing })) };
}, seconds);
const inputMotion = (before, after) => ({
  dx: after.x - before.x, dy: after.y - before.y,
  angle: Math.abs(Math.atan2(Math.sin(after.heading - before.heading), Math.cos(after.heading - before.heading))),
  offsetDrift: Math.max(...after.units.map((unit, i) => Math.hypot((unit.x - after.x) - (before.units[i].x - before.x),
    (unit.y - after.y) - (before.units[i].y - before.y)))),
  facingDrift: Math.max(...after.units.map((unit, i) => Math.abs(Math.atan2(Math.sin(unit.facing - before.units[i].facing), Math.cos(unit.facing - before.units[i].facing))))),
  slotError: after.slotError,
});
try {
  await page.goto(pathToFileURL(resolve(output, 'index.html')).href);
  await page.waitForFunction(() => !!window.formationLab); await page.evaluate(() => formationLab.pause());
  check('embedded native artwork and Pixel Operator load offline', await page.evaluate(() => document.fonts.check('18px "Pixel Operator"') && document.querySelector('#loading').hidden));
  await page.keyboard.press('3'); check('keyboard3 releases formation', !(await page.evaluate(() => formationLab.snapshot().formation)));
  await page.locator('#formation').click(); check('action3 restores formation', await page.evaluate(() => formationLab.snapshot().formation));
  for (const scenario of ['field', 'gate', 'winding', 'urban']) for (const count of [6, 12, 24]) {
    const result = await page.evaluate(({scenario,count}) => {
      formationLab.reset(scenario,count); formationLab.pause(); const lab=formationLab.lab; formationLab.moveTo(lab.world.goal.x,lab.world.goal.y);
      const started=performance.now(); let frames=0,maxStep=0;
      while(frames<2400) { const before=performance.now(); lab.step(.025); maxStep=Math.max(maxStep,performance.now()-before);frames++;if(lab.settled&&lab.goalDistance-lab.progress<.01)break; }
      const arrived=lab.snapshot(),units=lab.troops.map(u=>({x:u.x,y:u.y}));formationLab.step(8);
      const drift=Math.max(...lab.troops.map((u,i)=>Math.hypot(u.x-units[i].x,u.y-units[i].y)));
      return {...arrived,units:undefined,drift,totalCpuMs:performance.now()-started,maxStepMs:maxStep,frames};
    }, {scenario,count});
    check(`${scenario}/${count}: arrival, reformation, idle stability and terrain clearance`, result.remaining<.01 && result.settled && result.mode==='rectangle' && result.slotError<.01 && result.clipping===0 && result.drift<.0001 && result.maxCatchupRatio<=1.25001 && (scenario==='field'||result.compressed>0),result);
  }
  const straight=await page.evaluate(()=>{
    formationLab.reset('field',12);formationLab.pause();const lab=formationLab.lab,start={x:lab.leader.x,y:lab.leader.y};
    formationLab.moveTo(lab.world.goal.x,lab.world.goal.y);formationLab.step(3);
    return {distance:Math.hypot(lab.leader.x-start.x,lab.leader.y-start.y),expected:3*3.4*.7,slotError:lab.slotError};
  });
  check('straight marching stays in lockstep at70% normal speed',Math.abs(straight.distance-straight.expected)<.001&&straight.slotError<.001,straight);
  const wheel=await page.evaluate(()=>{formationLab.reset('field',24);formationLab.pause();formationLab.lab.turn(Math.PI/2);const result=formationLab.step(10);
    const centroid=formationLab.lab.troops.reduce((p,u)=>({x:p.x+u.x/24,y:p.y+u.y/24}),{x:0,y:0});return {...result,units:undefined,centerError:Math.hypot(centroid.x-result.leader.x,centroid.y-result.leader.y)};});
  check('wheeling preserves the centered Leader and125% catch-up ceiling',wheel.settled&&wheel.slotError<.01&&wheel.centerError<.001&&Math.abs(wheel.heading-Math.PI/2)<.01&&wheel.maxCatchupRatio<=1.25001,wheel);

  // Real key events feed the same keyboard-aware simulation step as RAF;
  // paused rendering prevents wall-clock scheduling from changing distances.
  await page.evaluate(() => { formationLab.reset('field', 12); formationLab.pause(); document.activeElement?.blur(); });
  let before = await inputPose();
  await page.keyboard.down('a'); let after = await inputPose(1); await page.keyboard.up('a');
  let movement = inputMotion(before, after);
  check('holding A strafes north while east-facing ranks and facing stay fixed', Math.abs(movement.dx) < .001
    && Math.abs(movement.dy + 2.38) < .001 && movement.angle < .0001 && movement.offsetDrift < .001 && movement.facingDrift < .0001, movement);
  before = after; after = await inputPose(.75); movement = inputMotion(before, after);
  check('releasing A stops lateral motion without idle rank drift', Math.hypot(movement.dx, movement.dy) < .001
    && movement.angle < .0001 && movement.offsetDrift < .001, movement);
  before = after;
  await page.keyboard.down('d'); after = await inputPose(1); await page.keyboard.up('d'); movement = inputMotion(before, after);
  check('holding D strafes south while preserving the same ranks and facing', Math.abs(movement.dx) < .001
    && Math.abs(movement.dy - 2.38) < .001 && movement.angle < .0001 && movement.offsetDrift < .001 && movement.facingDrift < .0001, movement);

  await page.keyboard.press('e'); after = await inputPose(5);
  check('actual E key still rotates the formation clockwise', Math.abs(after.heading - Math.PI / 2) < .001 && after.slotError < .01,
    { heading: after.heading, slotError: after.slotError });
  before = after;
  await page.keyboard.down('a'); after = await inputPose(1); await page.keyboard.up('a'); movement = inputMotion(before, after);
  check('A uses local left after rotating south, moving east without turning', Math.abs(movement.dx - 2.38) < .001
    && Math.abs(movement.dy) < .001 && movement.angle < .0001 && movement.offsetDrift < .001 && movement.facingDrift < .0001, movement);
  before = after;
  await page.keyboard.down('d'); after = await inputPose(1); await page.keyboard.up('d'); movement = inputMotion(before, after);
  check('D uses local right after rotating south, moving west without turning', Math.abs(movement.dx + 2.38) < .001
    && Math.abs(movement.dy) < .001 && movement.angle < .0001 && movement.offsetDrift < .001 && movement.facingDrift < .0001, movement);
  await page.keyboard.press('q'); after = await inputPose(5);
  check('actual Q key still rotates the formation counterclockwise', Math.abs(after.heading) < .001 && after.slotError < .01,
    { heading: after.heading, slotError: after.slotError });

  before = after;
  await page.keyboard.down('a'); await page.keyboard.down('a'); after = await inputPose(.5); await page.keyboard.up('a'); movement = inputMotion(before, after);
  check('repeated A keydown does not multiply strafing speed or rotate ranks', Math.abs(movement.dy + 1.19) < .001
    && Math.abs(movement.dx) < .001 && movement.angle < .0001 && movement.offsetDrift < .001, movement);
  await page.keyboard.down('d'); await inputPose(.25);
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); before = await inputPose(); after = await inputPose(1); await page.keyboard.up('d'); movement = inputMotion(before, after);
  check('losing window focus releases held strafe input', Math.hypot(movement.dx, movement.dy) < .001
    && movement.angle < .0001 && movement.offsetDrift < .001, movement);

  await page.evaluate(() => { formationLab.reset('gate', 24); formationLab.pause(); document.activeElement?.blur(); });
  await page.keyboard.press('e'); await inputPose(5); await page.keyboard.down('a');
  const sidewaysPassage = await page.evaluate(() => {
    let maxFacingChange = 0, steps = 0;
    while (formationLab.lab.leader.x < 35.5 && steps++ < 1600) {
      formationLab.step(.05);
      maxFacingChange = Math.max(maxFacingChange, Math.abs(formationLab.lab.heading - Math.PI / 2));
    }
    return { ...formationLab.snapshot(), units: undefined, maxFacingChange, steps };
  });
  await page.keyboard.up('a'); const sidewaysSettled = await page.evaluate(() => formationLab.step(8));
  check('sideways A march crosses a narrow gate, compresses and reforms without changing facing', sidewaysPassage.leader.x >= 35.5
    && sidewaysPassage.maxFacingChange < .001 && sidewaysPassage.compressed > 0 && sidewaysSettled.clipping === 0
    && sidewaysSettled.mode === 'rectangle' && sidewaysSettled.settled && sidewaysSettled.slotError < .01,
    { passage: sidewaysPassage, settled: { ...sidewaysSettled, units: undefined } });

  const redirect=await page.evaluate(()=>{formationLab.reset('urban',24);formationLab.pause();const lab=formationLab.lab;
    formationLab.moveTo(lab.world.goal.x,lab.world.goal.y);formationLab.step(7);formationLab.moveTo(8.5,21.5);return formationLab.step(50);});
  check('changing orders mid-corridor returns safely without stuck units',redirect.remaining<.01&&redirect.settled&&redirect.clipping===0,{...redirect,units:undefined});
  const front=await page.evaluate(()=>{formationLab.reset('field',12);formationLab.pause();formationLab.lab.spawnAttack('front');return formationLab.step(6);});
  check('front attack produces real boosted hits and health loss',front.frontalHits>0&&front.damageDealt>0&&front.damageTaken>0,{...front,units:undefined});
  await page.screenshot({path:`${output}/front-combat.png`});
  const flank=await page.evaluate(()=>{formationLab.reset('field',12);formationLab.pause();formationLab.lab.spawnAttack('flank');return formationLab.step(6);});
  check('flank attack uses normal combat and incurs damage',flank.flankHits>0&&flank.damageTaken>0,{...flank,units:undefined});
  const multipliers=await page.evaluate(()=>{const f=formationLab.frontMultiplier,p={x:0,y:0};return {front:f(true,0,p,{x:1,y:0}),flank:f(true,0,p,{x:0,y:1}),rear:f(true,0,p,{x:-1,y:0}),loose:f(false,0,p,{x:1,y:0})};});
  check('directional multipliers are exactly2×front and1×flank/rear/loose',multipliers.front===2&&multipliers.flank===1&&multipliers.rear===1&&multipliers.loose===1,multipliers);
  await page.screenshot({path:`${output}/flank-combat.png`});
  await page.evaluate(()=>{formationLab.reset('gate',24);formationLab.pause();const lab=formationLab.lab;formationLab.moveTo(lab.world.goal.x,lab.world.goal.y);
    for(let i=0;i<1200&&lab.leader.x<21;i++)lab.step(.025);formationLab.renderer.debug=true;formationLab.step(.025);});
  await page.screenshot({path:`${output}/gate-column.png`});
  await page.evaluate(()=>{formationLab.reset('field',24);formationLab.pause();formationLab.renderer.debug=false;formationLab.step(.025);});
  await page.screenshot({path:`${output}/formation-overview.png`});
  await page.locator('[data-icon="1"]').click(); check('icon alternatives are interactive',await page.locator('[data-icon="1"]').getAttribute('aria-pressed')==='true');
  await page.locator('[data-icon="0"]').click();
  const destination=await page.evaluate(()=>formationLab.renderer.screen({x:24.5,y:18.5})),box=await page.locator('#battle').boundingBox();
  await page.mouse.click(box.x+destination.x,box.y+destination.y);const clicked=await page.evaluate(()=>formationLab.snapshot().goal);
  check('clicking the battlefield issues an actual move order',Math.hypot(clicked.x-24.5,clicked.y-18.5)<.01,clicked);
  await page.setViewportSize({width:1000,height:720});await page.waitForTimeout(100);
  const fit=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,canvas:document.querySelector('#battle').getBoundingClientRect().height}));
  check('compact layout keeps battlefield and controls visible',!fit.overflow&&fit.canvas>300,fit);
  await page.screenshot({path:`${output}/compact-layout.png`});
  check('no browser runtime errors',errors.length===0,errors);
}catch(error){await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw error;}
finally{writeFileSync(`${output}/checks.json`,JSON.stringify({checks,errors},null,2));await browser.close();}
