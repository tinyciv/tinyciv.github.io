import { mkdir } from 'node:fs/promises';

/** Production sprites on a detached frozen world; no input or simulation step. */
export async function captureCannonFirePreview(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(async () => {
    const { createScenarioGame } = await import('/src/game/scenario-loader.ts');
    const { Renderer } = await import('/src/game/renderer.ts');
    const { NativeArt, unitKey } = await import('/src/game/native-art.ts');
    const { cannonFireFrame, loadCannonFireArt } = await import('/src/game/cannon-fire-art.ts');
    const { setMapRevealed } = await import('/src/game/fog.ts');
    if (window.__game) window.__game.state.paused = true;
    const state = await createScenarioGame('musketry-deathmatch');
    state.paused = true;
    const time = state.time;
    const cannon = state.units.find(unit => unit.faction === 0 && unit.kind === 'fieldCannon' && unit.hp > 0);
    if (!cannon) throw new Error('Firing preview requires a real field cannon');
    await loadCannonFireArt();
    cannon.inside = undefined; cannon.moving = false; cannon.facing = -Math.PI / 2;
    cannon.fieldCannon = { ...cannon.fieldCannon, shotAt: time - .09 };
    const key = unitKey(cannon, time, '#e4bd56');
    const art = new NativeArt(), flash = art.unit(cannon, time, '#e4bd56');
    const plume = flash.overlays?.[0];
    if (cannonFireFrame(cannon.fieldCannon.shotAt, time) !== 1 || !plume || plume.y >= 0 || plume.width !== 64)
      throw new Error('Field cannon plume must have a separate unclipped native frame');
    const siege = { id: -1, kind: 'siegeCannon', faction: 0, x: 0, y: 0, hp: 1, maxHp: 1, capacity: 0,
      siegeFacing: 0, siegeShotAt: time - .09 };
    if (!art.building(siege, time, '#e4bd56').overlays?.length) throw new Error('Siege cannon must share the selected plume');
    cannon.fieldCannon.shotAt = time - .45;
    if (unitKey(cannon, time, '#e4bd56') === key || cannonFireFrame(cannon.fieldCannon.shotAt, time) !== 5)
      throw new Error('Cannon firing presentation must advance through distinct cached frames');
    cannon.fieldCannon.shotAt = time - .09;
    const host = document.createElement('div');
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '99999', background: '#20261c' });
    host.innerHTML = '<canvas style="width:100%;height:100%;display:block"></canvas><canvas hidden></canvas>';
    document.body.append(host);
    const [canvas, minimap] = host.querySelectorAll('canvas');
    const renderer = new Renderer(canvas, minimap); await renderer.initialize();
    setMapRevealed(state, true);
    renderer.follow = false; renderer.zoom = 5;
    renderer.camera = { x: cannon.x + .25, y: cannon.y - .5 };
    renderer.draw(state, 0);
    window.__cannonFireReview = { state, renderer, host, cannon, time };
  });
  await mkdir('output/startup', { recursive: true });
  await page.screenshot({ path: 'output/startup/cannon-black-powder-flash.png' });
  await page.evaluate(() => {
    const { state, renderer, cannon, time } = window.__cannonFireReview;
    cannon.fieldCannon.shotAt = time - .45;
    renderer.draw(state, 0);
  });
  await page.screenshot({ path: 'output/startup/cannon-black-powder-smoke.png' });
  await page.evaluate(() => {
    const { state, renderer, cannon, time } = window.__cannonFireReview;
    cannon.facing = 0; cannon.fieldCannon.shotAt = time - .27;
    renderer.draw(state, 0);
  });
  await page.screenshot({ path: 'output/startup/cannon-black-powder-east.png' });
  const frozen = await page.evaluate(async () => {
    const { state, renderer, cannon, time } = window.__cannonFireReview;
    const { selectionSummary } = await import('/src/ui/selection-summary.ts');
    state.selected = cannon.id; state.selectedType = 'unit';
    cannon.fieldCannon = { ...cannon.fieldCannon, funded: true, shotAt: undefined };
    const paid = selectionSummary(state);
    cannon.fieldCannon.funded = false;
    const unpaid = selectionSummary(state);
    if (!paid || !unpaid || unpaid.attack !== paid.attack / 2 || unpaid.defense !== paid.defense / 2)
      throw new Error('Unpaid field cannons must show half attack and defense');
    renderer.draw(state, 0);
    return state.paused && state.time === time;
  });
  if (!frozen) throw new Error('Cannon firing preview must remain frozen');
  await page.screenshot({ path: 'output/startup/field-cannon-unpaid-upkeep.png' });
}
