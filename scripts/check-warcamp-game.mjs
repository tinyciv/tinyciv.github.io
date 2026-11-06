import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const folder = 'scratch/2026-11-01-warcamp-sizes';
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
const errors = [], failedRequests = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('requestfailed', request => failedRequests.push(request.url()));
await page.addInitScript(() => { requestAnimationFrame = () => 0; });
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5197/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => ['ready', 'error'].includes(document.documentElement.dataset.assets), null, { polling: 50, timeout: 30000 });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.assets), 'ready', JSON.stringify({ errors, failedRequests }));
  const result = await page.evaluate(async seeds => {
    const [{ Renderer }, { generateWorld }, { createGame }, camps, navigation, { WATER }, { drawBuilding }] = await Promise.all([
      import('/src/game/renderer.ts'), import('/src/world/generator.ts'), import('/src/game/simulation.ts'),
      import('/src/game/raider-camps.ts'), import('/src/game/pathfinding.ts'), import('/src/game/types.ts'), import('/src/game/sprites.ts'),
    ]);
    const checks = [], pictures = {}, timings = [];
    window.__warcampQA = { checks, pictures, timings };
    const check = (name, pass, detail) => { checks.push({ name, pass, detail }); if (!pass) throw new Error(`${name}: ${JSON.stringify(detail)}`); };
    const target = document.createElement('canvas'), minimap = document.createElement('canvas');
    target.style.cssText = 'width:1200px;height:800px;display:block'; minimap.width = minimap.height = 160;
    document.body.replaceChildren(target, minimap);
    const renderer = new Renderer(target, minimap); await renderer.initialize(); renderer.follow = false; renderer.zoom = 1;
    const drawFog = renderer.gpu.drawFog.bind(renderer.gpu); renderer.gpu.drawFog = () => {};
    let inspectionMode = true, frameState;
    const prepareFog = renderer.prepareFog.bind(renderer);
    renderer.prepareFog = fog => {
      if (inspectionMode) {
        fog.visible.fill(1); fog.explored.fill(1);
        fog.buildings = frameState.buildings; fog.fields = frameState.fields ?? [];
      }
      prepareFog(fog);
    };
    const frame = state => {
      frameState = state; renderer.draw(state, 0);
      return renderer.snapshot();
    };
    const explore = world => ({ width: world.width, height: world.height, seed: world.seed, explored: Array(world.tiles.length).fill(1), buildings: [], fields: [] });
    const auditWards = (game, camp, gates, tents) => navigation.withNavigationFrame(game, () => {
      const { width, height } = game.world, gateCells = new Set(gates.map(g => g.y * width + g.x));
      const flood = (faction, fromGate = false) => {
        const costs = new Float64Array(width * height).fill(Infinity), queue = [];
        if (fromGate) { const cell=camp.gate.y*width+camp.gate.x;costs[cell]=0;queue.push(cell); }
        else for (let y = camp.y - 1; y <= camp.y + camp.height; y++) for (let x = camp.x - 1; x <= camp.x + camp.width; x++) {
          if (x !== camp.x - 1 && x !== camp.x + camp.width && y !== camp.y - 1 && y !== camp.y + camp.height) continue;
          if (navigation.canWalk(game, x + .5, y + .5, faction)) { const k = y * width + x; costs[k] = 0; queue.push(k); }
        }
        for (let head = 0; head < queue.length; head++) {
          const k = queue[head], x = k % width, y = Math.floor(k / width);
          for (const [dx,dy] of [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]]) {
            const nx=x+dx,ny=y+dy,next=ny*width+nx;
            if(nx<0||ny<0||nx>=width||ny>=height||!navigation.canMove(game,{x:x+.5,y:y+.5},{x:nx+.5,y:ny+.5},faction))continue;
            const value=costs[k]+Number(gateCells.has(next));if(value<costs[next]){costs[next]=value;queue.push(next);}
          }
        }
        return costs;
      };
      const friendly=flood(-2),hostile=flood(0),connected=flood(-2,true), depths=tents.map(t=>friendly[(t.y+1)*width+t.x]);
      const stranded=game.buildings.filter(b=>b.raiderCamp===camp.id&&(b.kind==='palisade'||b.kind==='woodenTower'))
        .filter(b=>!Number.isFinite(connected[b.y*width+b.x])&&![[0,-1],[1,0],[0,1],[-1,0],[-1,-1],[1,-1],[1,1],[-1,1]]
          .some(([dx,dy])=>Number.isFinite(connected[(b.y+dy)*width+b.x+dx])&&navigation.canTraverseEdge(game.world,b,{x:b.x+dx,y:b.y+dy})))
        .map(b=>({kind:b.kind,x:b.x,y:b.y}));
      return { reachable:depths.every(Number.isFinite), depths:[...new Set(depths)].sort(), hostileBypass:tents.some(t=>Number.isFinite(hostile[(t.y+1)*width+t.x])), stranded };
    });
    const atlas = document.createElement('canvas'); atlas.width = 1024; atlas.height = 544;
    const art = atlas.getContext('2d'); art.fillStyle = '#24351e'; art.fillRect(0, 0, atlas.width, atlas.height);
    const links = mask => ({ north: !!(mask & 1), east: !!(mask & 2), south: !!(mask & 4), west: !!(mask & 8) });
    for (let sample = 0; sample < 32; sample++) {
      const mask = sample % 16, x = sample % 8 * 128, y = Math.floor(sample / 8) * 136;
      const b = { id: sample, kind: 'palisade', x: 0, y: 0, faction: -2, hp: 50, maxHp: 50, capacity: 0 };
      art.fillStyle = '#8aa940'; art.fillRect(x + 8, y + 30, 112, 98);
      art.fillStyle = '#e9e4ce'; art.font = '14px system-ui'; art.fillText(`${sample < 16 ? 'Wall' : 'Gate'} ${mask.toString(2).padStart(4, '0')}`, x + 10, y + 20);
      drawBuilding(art, b, x + 32, y + 47, 64, 0, '#8e6950', sample < 16 ? links(mask) : links(10), sample < 16 ? undefined : links(mask));
    }
    pictures['palisade-connections'] = atlas.toDataURL();
    const sizes = {
      small: { tiers: 1, tents: [3,5], towers: [2,2] },
      medium: { tiers: 2, tents: [6,9], towers: [4,4] },
      large: { tiers: 3, tents: [10,18], towers: [6,8] },
    };
    for (const [index, seed] of seeds.entries()) {
      const world = generateWorld(seed), start = performance.now(), game = createGame(world);
      timings.push({ seed, createGameMs: performance.now() - start, camps: game.raiderCamps.map(camp=>({size:camp.size,width:camp.width,height:camp.height,tents:camp.houses.length})) });
      check(`${seed}: generated games contain one camp of each size`, JSON.stringify(game.raiderCamps.map(camp=>camp.size).sort())==='["large","medium","small"]', timings.at(-1));
      game.fog = explore(world); game.selected = null; game.buildMode = null; game.paused = true;
      const comparison=document.createElement('canvas');comparison.width=2208;comparison.height=858;
      const composite=comparison.getContext('2d');composite.fillStyle='#14201a';composite.fillRect(0,0,2208,858);
      composite.fillStyle='#eee8d3';composite.font='30px system-ui';composite.fillText('Small, medium, and large marauder camps',24,43);
      composite.fillStyle='#b8c4ac';composite.font='18px system-ui';composite.fillText(`Generated game world ${seed} · identical 32-pixel tile scale`,24,73);
      for(const [column,size] of ['small','medium','large'].entries()) {
      const camp = game.raiderCamps.find(camp=>camp.size===size), profile=sizes[size], buildings = game.buildings.filter(b => b.raiderCamp === camp.id);
      const label=`${seed} ${size}`;
      const palisades = buildings.filter(b => b.kind === 'palisade'), tents = buildings.filter(b => b.kind === 'villageTent'), towers = buildings.filter(b => b.kind === 'woodenTower');
      const roadCells = new Set(buildings.filter(b => b.kind === 'road').map(b => `${b.x},${b.y}`));
      const gates = palisades.filter(b => roadCells.has(`${b.x},${b.y}`));
      check(`${label}: tents, towers, and physical gates match the size class`, tents.length >= profile.tents[0] && tents.length <= profile.tents[1]
        && towers.length >= profile.towers[0] && towers.length <= profile.towers[1] && gates.length === profile.tiers
        && !buildings.some(b => b.kind === 'wall' || b.kind === 'house'), { tents: tents.length, towers: towers.length, gates: gates.length });
      check(`${label}: actual camp structures remain off water`, buildings.every(b => !WATER.has(world.tiles[b.y * world.width + b.x].terrain)));
      check(`${label}: real gate collision admits only the camp faction`, gates.every(g => navigation.canWalk(game, g.x + .5, g.y + .5, -2) && !navigation.canWalk(game, g.x + .5, g.y + .5, 0)));
      const wards=auditWards(game,camp,gates,tents);
      check(`${label}: all tent doors have the required defensive depth and no hostile bypass`,wards.reachable&&!wards.hostileBypass
        &&JSON.stringify(wards.depths)===JSON.stringify(Array.from({length:profile.tiers},(_,i)=>i+1)),wards);
      check(`${label}: every physical wall and tower is accessible from the main camp`,wards.stranded.length===0,wards.stranded);
      renderer.camera = camps.raiderCampCenter(camp); renderer.zoom = 1;
      const snapshot=frame(game);pictures[`warcamp-${seed}-${size}`] = snapshot.toDataURL();
      composite.fillStyle='#eee8d3';composite.font='22px system-ui';
      composite.fillText(`${size[0].toUpperCase()+size.slice(1)} · ${profile.tiers} ${profile.tiers===1?'ward':'wards'} · ${tents.length} tents · ${towers.length} towers`,24+column*728,115);
      composite.drawImage(snapshot,248,48,704,704,24+column*728,130,704,704);
      frame(game); frame(game);
      check(`${label}: steady game frames reuse cached camp art`, renderer.renderStats.rasterized === 0 && renderer.renderStats.textureUploads === 0, renderer.renderStats);
      if (index === 0 && size==='large') {
        const signs = camp.signs;
        if (signs?.length) {
          const original = frame(game).toDataURL(); camp.signs = [];
          const without = frame(game).toDataURL(); camp.signs = signs;
          check('decorative camp signs appear in the real compositor', original !== without, { signs: signs.length });
        } else check('camp retains decorative direction signs', false, signs);
        // Inspect a normal sight-limited frame using the unchanged fog compositor.
        const leader = game.units.find(unit => unit.kind === 'leader' && unit.faction === 0);
        leader.x = camp.gate.x + .5; leader.y = camp.gate.y + .5;
        game.fog = undefined; game.time += 1; renderer.gpu.drawFog = drawFog; inspectionMode = false;
        pictures['warcamp-with-fog'] = frame(game).toDataURL(); renderer.gpu.drawFog = () => {}; inspectionMode = true;
      }
      }
      pictures[`camp-size-comparison-${seed}`]=comparison.toDataURL();
    }
    renderer.destroy(); return { checks, pictures, timings };
  }, process.env.ART_ONLY === '1' ? [] : process.env.GAME_SEEDS?.split(',') ?? ['BTV-847', 'willow-raid', 'coastal-raid']);
  for (const [name, uri] of Object.entries(result.pictures)) await writeFile(`${folder}/${name}.png`, Buffer.from(uri.split(',')[1], 'base64'));
  delete result.pictures;
  assert.deepEqual(errors, []); assert.deepEqual(failedRequests, []);
  await writeFile(`${folder}/browser-checks.json`, JSON.stringify({ ...result, errors, failedRequests }, null, 2));
  console.log(JSON.stringify({ passed: result.checks.length, timings: result.timings }, null, 2));
} catch (error) {
  const partial = await page.evaluate(() => window.__warcampQA).catch(() => null);
  if (partial) {
    for (const [name, uri] of Object.entries(partial.pictures)) await writeFile(`${folder}/${name}.png`, Buffer.from(uri.split(',')[1], 'base64'));
    delete partial.pictures;
    await writeFile(`${folder}/browser-checks.json`, JSON.stringify({ ...partial, errors, failedRequests }, null, 2));
  }
  console.error(JSON.stringify({ errors, failedRequests }, null, 2)); throw error;
} finally { await browser.close(); }
