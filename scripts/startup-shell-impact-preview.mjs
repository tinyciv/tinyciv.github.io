import { mkdir } from 'node:fs/promises';

/** Real production effect drawing on a detached, paused scenario. No steps or input. */
export async function captureShellImpactPreview(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(async () => {
    const { createScenarioGame } = await import('/src/game/scenario-loader.ts');
    const { Renderer } = await import('/src/game/renderer.ts');
    const { NativeArt } = await import('/src/game/native-art.ts');
    const { loadShellImpactArt, shellImpactImage, shellImpactFrame } = await import('/src/game/shell-impact-art.ts');
    const { advanceProjectiles } = await import('/src/game/projectile-native.ts');
    const { buildingWidth, buildingHeight } = await import('/src/game/types.ts');
    const { canWalk } = await import('/src/game/pathfinding.ts');
    const { setMapRevealed } = await import('/src/game/fog.ts');
    if (window.__game) window.__game.state.paused = true;
    const state = await createScenarioGame('musketry-deathmatch');
    state.paused = true;
    const time = state.time;
    const cannon = state.units.find(unit => unit.faction === 0 && unit.kind === 'fieldCannon' && unit.hp > 0);
    if (!cannon) throw new Error('Shell impact preview requires a field cannon');
    // Exercise the production native landing transport on this detached frozen
    // fixture. Block damage so no unit/building health or game clock changes.
    const target = state.buildings.find(building => building.kind === 'militaryAcademy' && building.faction === 0);
    if (!target) throw new Error('Shell landing verification requires an existing academy');
    const hp = target.hp, end = { x: target.x + buildingWidth(target) / 2, y: target.y + buildingHeight(target) / 2 };
    const start = { x: end.x - .25, y: end.y };
    const shot = { kind: 'cannonball', attacker: cannon.id, faction: 1, target: target.id, damage: 20,
      start, end, ...start, elapsed: 0, duration: .05 };
    const hooks = { target: id => id === target.id ? target : undefined,
      hostile: () => true, huntable: () => false, observable: () => true, protected: () => false,
      clear: () => false, defense: () => 1, hit: () => { throw new Error('Frozen landing verification must not deal damage'); } };
    state.projectiles = [{ ...shot }]; advanceProjectiles(state, .1, hooks);
    const landed = state.shellImpacts?.[0];
    if (state.projectiles.length || state.shellImpacts?.length !== 1 || !landed
      || landed.x !== end.x || landed.y !== end.y || landed.renderDepth !== target.y + buildingHeight(target) + .001)
      throw new Error('One real shell arrival must publish one centered native effect above its target building');
    advanceProjectiles(state, .1, hooks);
    state.projectiles = [{ ...shot, kind: 'arrow' }]; advanceProjectiles(state, .1, hooks);
    state.projectiles = [{ ...shot }]; advanceProjectiles(state, .1, { ...hooks, target: () => undefined });
    if (state.shellImpacts.length !== 1 || state.shellImpacts[0].id !== landed.id || target.hp !== hp || state.time !== time)
      throw new Error('Empty frames, arrows and canceled flights must not duplicate shell explosions or change health/time');
    let position;
    for (const [dx, dy] of [[3, 0], [2, 2], [0, 3], [-3, 0], [0, -3]]) {
      const x = Math.floor(cannon.x) + dx + .5, y = Math.floor(cannon.y) + dy + .5;
      if (canWalk(state, x, y, 0)) { position = { x, y }; break; }
    }
    if (!position) throw new Error('Shell impact preview requires nearby generated open terrain');
    await loadShellImpactArt();
    const sheet = shellImpactImage();
    if (!sheet || sheet.naturalWidth !== 288 || sheet.naturalHeight !== 32)
      throw new Error('Approved 1C nine-frame native32 impact sheet must load');
    const final = document.createElement('canvas'); final.width = final.height = 32;
    const context = final.getContext('2d'); context.drawImage(sheet, 256, 0, 32, 32, 0, 0, 32, 32);
    if (context.getImageData(0, 0, 32, 32).data.some((value, index) => index % 4 === 3 && value !== 0))
      throw new Error('Shell impact must fully dissipate in the final authored frame');
    const art = new NativeArt(), flash = art.shellImpact(1), smoke = art.shellImpact(5);
    if (!flash || !smoke || flash.texture === smoke.texture || flash.x !== -32 || flash.y !== -32 || flash.width !== 64 || flash.height !== 64)
      throw new Error('Shell impacts must use shared distinct native frames centered on the ground point');
    if (shellImpactFrame(time - .1, time) !== 1 || shellImpactFrame(time - .5, time) !== 5 || shellImpactFrame(time - .9, time) !== -1)
      throw new Error('Shell impact presentation must follow the approved nine100ms frames');
    cannon.moving = false; cannon.inside = undefined;
    cannon.facing = Math.atan2(position.y - cannon.y, position.x - cannon.x);
    cannon.fieldCannon = { ...cannon.fieldCannon, shotAt: time - .35 };
    state.shellImpacts = [{ id: -1, ...position, time: time - .1 }];
    const host = document.createElement('div');
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '99999', background: '#20261c' });
    host.innerHTML = '<canvas style="width:100%;height:100%;display:block"></canvas><canvas hidden></canvas>';
    document.body.append(host);
    const [canvas, minimap] = host.querySelectorAll('canvas');
    const renderer = new Renderer(canvas, minimap); await renderer.initialize();
    setMapRevealed(state, true);
    renderer.follow = false; renderer.zoom = 4;
    renderer.camera = { x: (position.x + cannon.x) / 2, y: (position.y + cannon.y) / 2 - .5 };
    renderer.draw(state, 0);
    window.__shellImpactReview = { state, renderer, host, cannon, time, position };
  });
  await mkdir('output/startup', { recursive: true });
  await page.screenshot({ path: 'output/startup/shell-impact-1c-flash.png' });
  await page.evaluate(() => {
    const { state, renderer, time } = window.__shellImpactReview;
    state.shellImpacts[0].time = time - .5;
    renderer.draw(state, 0);
  });
  await page.screenshot({ path: 'output/startup/shell-impact-1c-smoke.png' });
  await page.evaluate(async () => {
    const { state, renderer, time } = window.__shellImpactReview;
    const { buildingWidth, buildingHeight } = await import('/src/game/types.ts');
    const building = state.buildings.find(candidate => candidate.faction === 0 && candidate.kind === 'militaryAcademy' && candidate.hp > 0);
    if (!building) throw new Error('Building impact preview requires an existing military academy');
    const x = building.x + buildingWidth(building) / 2, y = building.y + buildingHeight(building) / 2;
    state.shellImpacts = [{ id: -2, x, y, time: time - .1, renderDepth: building.y + buildingHeight(building) + .001 }];
    renderer.camera = { x, y }; renderer.zoom = 4;
    renderer.draw(state, 0);
  });
  await page.screenshot({ path: 'output/startup/shell-impact-1c-building.png' });
  const frozen = await page.evaluate(() => {
    const { state, time } = window.__shellImpactReview;
    return state.paused && state.time === time;
  });
  if (!frozen) throw new Error('Shell impact preview must remain frozen');
}
