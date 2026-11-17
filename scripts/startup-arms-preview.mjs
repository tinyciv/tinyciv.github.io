import { mkdir } from 'node:fs/promises';

/** Photograph the real renderer and controls on a separate frozen state. */
export async function captureArmsPreview(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(async () => {
    await import('/src/style.css');
    const { createScenarioGame } = await import('/src/game/scenario-loader.ts');
    const { Renderer } = await import('/src/game/renderer.ts');
    const { BuildingActivityPopup } = await import('/src/ui/building-activity.ts');
    const { constructionEdges } = await import('/src/game/builders.ts');
    const { setMapRevealed } = await import('/src/game/fog.ts');
    const { retinueComposition, setRetinueFraction } = await import('/src/game/archery.ts');
    const state = await createScenarioGame('musketry-deathmatch');
    state.paused = true; setMapRevealed(state, true);
    const foundry = state.buildings.find(building => building.faction === 0 && building.kind === 'foundry');
    const leader = state.units.find(unit => unit.faction === 0 && unit.kind === 'leader');
    if (!foundry || !leader) throw new Error('Arms preview requires a foundry and Leader');
    const host = document.createElement('div');
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '99999', background: '#20261c' });
    host.innerHTML = '<canvas style="width:100%;height:100%;display:block"></canvas><canvas hidden></canvas><section class="building-activity" role="dialog" aria-labelledby="building-activity-title" hidden></section>';
    document.body.append(host);
    const [canvas, minimap] = host.querySelectorAll('canvas');
    const renderer = new Renderer(canvas, minimap); await renderer.initialize();
    renderer.follow = false;
    const edge = constructionEdges(state, foundry).sort((a, b) => b.y - a.y || a.x - b.x)[0];
    if (!edge) throw new Error('Foundry preview requires an accessible entrance');
    leader.x = edge.x; leader.y = edge.y; leader.inside = undefined; leader.facing = 0;
    const slots = retinueComposition(state, 0).total;
    const cannons = state.units.filter(unit => unit.faction === 0 && unit.kind === 'fieldCannon' && unit.hp > 0).length;
    if (!setRetinueFraction(state, foundry, 'fieldCannon', cannons / slots))
      throw new Error('Foundry cannon quota command was rejected');
    renderer.camera = { x: foundry.x + 1, y: foundry.y + 2 }; renderer.zoom = 2;
    renderer.draw(state, 0);
    const popup = new BuildingActivityPopup(host.querySelector('section'), () => state,
      point => renderer.screenPoint(point), () => ({ width: renderer.width, height: renderer.height }), () => {}, () => {});
    popup.toggle(foundry);
    if (!popup.isOpen || host.querySelector('section').hidden) throw new Error('Foundry controls did not open');
    if (host.querySelectorAll('.activity-composition input[type="range"]').length !== 10)
      throw new Error('Foundry must show all ten unit composition sliders');
    if (host.querySelector('[name="field-cannons"]').disabled)
      throw new Error('Completed foundry must enable the researched cannon slider');
    await Promise.all([...host.querySelectorAll('img')].filter(image => image.getAttribute('src')).map(image => image.decode()));
    window.__armsReview = { state, renderer, host, popup, leader, foundry };
  });
  await mkdir('output/startup', { recursive: true });
  await page.screenshot({ path: 'output/startup/foundry-sliders.png' });
  await page.evaluate(() => {
    const { state, renderer, host, leader } = window.__armsReview;
    host.querySelector('section').hidden = true;
    renderer.camera = { x: leader.x + 1, y: leader.y }; renderer.zoom = 5;
    renderer.draw(state, 0);
  });
  await page.screenshot({ path: 'output/startup/leader-firearm.png' });
  await page.evaluate(() => {
    const { state, renderer } = window.__armsReview;
    const cannon = state.units.find(unit => unit.faction === 0 && unit.kind === 'fieldCannon' && unit.hp > 0);
    if (!cannon) throw new Error('Arms preview requires a field cannon');
    renderer.camera = { x: cannon.x + .5, y: cannon.y + .5 }; renderer.zoom = 5;
    renderer.draw(state, 0);
  });
  await page.screenshot({ path: 'output/startup/field-cannon.png' });
  const frozen = await page.evaluate(() => window.__armsReview.state.paused && window.__armsReview.state.time === 0);
  if (!frozen) throw new Error('Arms preview must remain frozen at time zero');
}
