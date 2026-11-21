import { mkdir } from 'node:fs/promises';

/** View the academy and native drill geometry in a detached, paused state. */
export async function captureMilitaryPreview(page) {
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.evaluate(async () => {
    await import('/src/style.css');
    const { createScenarioGame } = await import('/src/game/scenario-loader.ts');
    const { Renderer } = await import('/src/game/renderer.ts');
    const { BuildingActivityPopup } = await import('/src/ui/building-activity.ts');
    const { constructionEdges } = await import('/src/game/builders.ts');
    const { setMapRevealed } = await import('/src/game/fog.ts');
    const { selectMilitaryFormation } = await import('/src/game/military-academy.ts');
    if (window.__game) window.__game.state.paused = true;
    const state = await createScenarioGame('musketry-deathmatch');
    state.paused = true; setMapRevealed(state, true);
    const academy = state.buildings.find(building => building.faction === 0 && building.kind === 'militaryAcademy');
    const leader = state.units.find(unit => unit.faction === 0 && unit.kind === 'leader');
    if (!academy || !leader) throw new Error('Military scenario lacks its academy or Leader');

    const host = document.createElement('div');
    host.className = 'game-area';
    host.dataset.militaryPreview = '';
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '99999', background: '#20261c' });
    host.innerHTML = '<canvas style="width:100%;height:520px;display:block"></canvas><canvas hidden></canvas><section class="building-activity" role="dialog" aria-labelledby="building-activity-title" hidden></section>';
    document.body.append(host);
    const [canvas, minimap] = host.querySelectorAll('canvas');
    const renderer = new Renderer(canvas, minimap);
    await renderer.initialize();
    renderer.follow = false;
    renderer.camera = { x: state.world.width / 2, y: state.world.height / 2 };
    renderer.zoom = Math.min(1400 / (state.world.width * 32), 900 / (state.world.height * 32));
    renderer.draw(state, 0);
    window.__militaryReview = { state, renderer, host, academy, leader, BuildingActivityPopup, constructionEdges, selectMilitaryFormation };
  });
  await mkdir('output/startup', { recursive: true });
  await page.screenshot({ path: 'output/startup/musketry-deathmatch.png', clip: { x: 0, y: 0, width: 1440, height: 520 } });
  await page.evaluate(() => {
    const { state, renderer, host, academy, leader, BuildingActivityPopup, constructionEdges, selectMilitaryFormation } = window.__militaryReview;
    host.querySelector('canvas').style.height = '100%'; renderer.resize();
    const edge = constructionEdges(state, academy)[0];
    if (!edge) throw new Error('Military Academy has no accessible entrance');
    leader.x = edge.x; leader.y = edge.y; leader.inside = undefined;
    leader.facing = 0;
    const result = selectMilitaryFormation(state, 'loose');
    if (!result.ok) throw new Error(result.message);
    renderer.camera = { x: academy.x + 2, y: academy.y + 2.5 }; renderer.zoom = 2;
    renderer.draw(state, 0);
    const popup = new BuildingActivityPopup(host.querySelector('section'), () => state,
      point => renderer.screenPoint(point), () => ({ width: renderer.width, height: renderer.height }), () => {}, () => {});
    popup.toggle(academy);
    if (host.querySelector('section').hidden || host.querySelector('[name="militaryFormation"]').value !== 'loose')
      throw new Error('Academy did not show Loose order');
  });
  await page.locator('[data-military-preview]').screenshot({ path: 'output/startup/military-academy.png' });
  await page.evaluate(async () => {
    const { infantryPointClear, infantryRectangleOffsets } = await import('/src/game/infantry-drill.ts');
    const { state, renderer, host, leader, academy } = window.__militaryReview;
    const members = state.units.filter(unit => unit.faction === 0 && unit.kind === 'musketman' && !unit.inside).slice(0, 8);
    if (members.length !== 8) throw new Error('Loose order preview needs eight musketmen');
    const soldiers = infantryRectangleOffsets(members.length, 'loose');
    const ranks = [-.5, .5].map(x => soldiers.filter(slot => slot.x === x).map(slot => slot.y).sort((a, b) => a - b));
    if (ranks.some(rank => rank.length !== members.length / 2 || rank.some((y, i) => i > 0 && y - rank[i - 1] !== 1)))
      throw new Error('Loose order must have two centered ranks, with one tile between ranks and between soldiers');
    const offsets = [{ x: 0, y: 0 }, ...soldiers];
    const position = (center, slot) => ({ x: center.x + slot.y, y: center.y - slot.x });

    // Choose the nearest open section of the existing battlefield with room
    // for all nine positions, facing north so the spacing reads across screen.
    let center, nearest = Infinity;
    for (let y = 3.5; y < state.world.height - 3; y++) {
      for (let x = 3.5; x < state.world.width / 2 - 3; x++) {
        const d = Math.hypot(x - academy.x - 14, y - academy.y);
        if (d >= nearest || !offsets.every(slot => infantryPointClear(state, position({ x, y }, slot), leader.faction))) continue;
        center = { x, y }; nearest = d;
      }
    }
    if (!center) throw new Error('Military scenario has no open ground for Loose order');
    for (const [i, unit] of [leader, ...members].entries()) {
      Object.assign(unit, position(center, offsets[i]));
      unit.facing = -Math.PI / 2; unit.moving = false;
    }
    host.querySelector('section').hidden = true;
    renderer.camera = center; renderer.zoom = 3;
    renderer.draw(state, 0);
  });
  await page.screenshot({ path: 'output/startup/loose-order.png', clip: { x: 240, y: 190, width: 960, height: 580 } });
  await page.evaluate(() => {
    const { host, renderer } = window.__militaryReview;
    renderer.destroy(); host.remove(); delete window.__militaryReview;
  });
  await page.setViewportSize(viewport);
}
