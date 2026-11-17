import { mkdir } from 'node:fs/promises';

/** Isolated renderer fixtures: no gameplay input, simulation steps or saves. */
export async function captureBuildingPreview(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  const buildings = await page.evaluate(async () => {
    const { createScenarioGame } = await import('/src/game/scenario-loader.ts');
    const { Renderer } = await import('/src/game/renderer.ts');
    const { setMapRevealed } = await import('/src/game/fog.ts');
    const { entityStore } = await import('/src/game/entity-store.ts');
    const { buildingImageAnchor } = await import('/src/game/sprites.ts');
    const state = await createScenarioGame('musketry-deathmatch');
    state.paused = true;
    const palace = state.buildings.find(b => b.kind === 'palace' && b.faction === 0);
    const byDistance = (a, b) => Math.hypot(a.x - palace.x, a.y - palace.y) - Math.hypot(b.x - palace.x, b.y - palace.y);
    const site = state.buildings.filter(b => b.kind === 'barracks' && b.faction === 0).sort(byDistance)[0];
    const well = state.buildings.filter(b => b.kind === 'well' && b.faction === 0).sort(byDistance)[0];
    if (!palace || !site || !well) throw new Error('Building preview needs a town, barracks and well');
    for (const b of state.buildings) if (b.faction === 0) b.hp = Math.ceil(b.maxHp * .62);
    for (const b of [site, well]) {
      b.construction = { startedAt: state.time - 20, duration: 60, healthProgress: 1 / 3, waitingForBuilder: false };
      entityStore(state).buildings.updateRoles(b);
    }
    const anchor = buildingImageAnchor(site);
    if (anchor.x !== 1 || anchor.y !== 0) throw new Error('Wide construction artwork must have a centered health bar');
    const host = document.createElement('div');
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '99999', background: '#20261c' });
    host.innerHTML = '<canvas style="width:100%;height:100%;display:block"></canvas><canvas hidden></canvas><aside style="position:absolute;left:24px;top:20px;color:#ffedc3;font:28px \'Pixel Operator\';text-shadow:0 2px #151b16">Buildings and construction</aside>';
    document.body.append(host);
    const [canvas, minimap] = host.querySelectorAll('canvas');
    const renderer = new Renderer(canvas, minimap);
    await renderer.initialize();
    setMapRevealed(state, true);
    renderer.follow = false;
    renderer.camera = { x: palace.x + .5, y: palace.y + .5 };
    renderer.zoom = 2.4;
    renderer.draw(state, 0);
    window.__buildingReview = { state, renderer, host, palace, site, well, time: state.time };
    return { time: state.time, site: site.id, well: well.id };
  });
  await mkdir('output/startup', { recursive: true });
  await page.screenshot({ path: 'output/startup/building-health-bars.png' });
  await page.evaluate(() => {
    const { state, renderer, host, site, well } = window.__buildingReview;
    renderer.camera = { x: (site.x + well.x) / 2 + .5, y: (site.y + well.y) / 2 + .5 };
    renderer.zoom = 5;
    host.querySelector('aside').textContent = 'Construction and well';
    renderer.draw(state, 0);
  });
  await page.screenshot({ path: 'output/startup/construction-and-well.png' });
  const ore = await page.evaluate(async () => {
    const { createScenarioGame } = await import('/src/game/scenario-loader.ts');
    const { setMapRevealed } = await import('/src/game/fog.ts');
    const { canWalk } = await import('/src/game/pathfinding.ts');
    const { isRetinueMember } = await import('/src/game/types.ts');
    const state = await createScenarioGame('sandbox');
    state.paused = true;
    const cell = state.world.tiles.findIndex((tile, index) => tile.oreAnchor === index && tile.oreWidth === 3 && tile.oreHeight === 3);
    if (cell < 0) throw new Error('Ore preview needs a naturally generated 3x3 deposit');
    const x = cell % state.world.width, y = Math.floor(cell / state.world.width);
    const rows = Array.from({ length: 3 }, (_, dy) => Array.from({ length: 3 }, (_, dx) =>
      canWalk(state, x + dx + .5, y + dy + .5, 0)));
    if (!rows[0].every(Boolean) || !rows[1].every(Boolean) || rows[2].some(Boolean))
      throw new Error('3x3 ore must expose two rear walking rows and one solid front row');
    const escort = state.units.filter(unit => unit.faction === 0 && (unit.kind === 'leader' || isRetinueMember(unit)) && unit.hp > 0).slice(0, 3);
    escort.forEach((unit, index) => {
      unit.x = x + .5 + index; unit.y = y + .5; unit.inside = undefined;
      unit.moving = false; unit.path = undefined; unit.pathGoal = undefined; unit.facing = 1;
    });
    setMapRevealed(state, true);
    const { renderer, host } = window.__buildingReview;
    renderer.camera = { x: x + 1.5, y: y + 1.5 };
    renderer.zoom = 4;
    host.querySelector('aside').textContent = 'Ore rear passage';
    renderer.draw(state, 0);
    window.__oreReview = { state, time: state.time };
    return { x, y, rows, escort: escort.length, villages: state.villages?.length ?? 0 };
  });
  await page.screenshot({ path: 'output/startup/ore-rear-passage.png' });
  await page.evaluate(() => {
    for (const fixture of [window.__buildingReview, window.__oreReview])
      if (!fixture.state.paused || fixture.state.time !== fixture.time) throw new Error('Building previews must remain frozen');
    window.__buildingReview.host.remove();
  });
  console.log(`Building preview: ${JSON.stringify({ buildings, ore })}`);
}
