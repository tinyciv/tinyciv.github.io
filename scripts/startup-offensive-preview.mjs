import { mkdir } from 'node:fs/promises';

/** Render a detached, frozen procedural world with the production flag overlay. */
export async function captureOffensivePreview(page) {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.evaluate(async () => {
    const { Renderer } = await import('/src/game/renderer.ts');
    const { beginOffensive } = await import('/src/game/offensive-native.ts');
    const { updateOffensiveButton } = await import('/src/ui/offensive-controls.ts');
    const { canWalk, findPath } = await import('/src/game/pathfinding.ts');
    const { setMapRevealed } = await import('/src/game/fog.ts');
    const { createScenarioGame } = await import('/src/game/scenario-loader.ts');
    const { researchLevel } = await import('/src/game/research.ts');
    if (window.__game) window.__game.state.paused = true;
    const state = await createScenarioGame('musketry-deathmatch');
    state.paused = true; state.gameOver = false;
    const time = state.time;
    setMapRevealed(state, true);
    const leader = state.units.find(unit => unit.faction === 0 && unit.kind === 'leader' && unit.hp > 0);
    const faction = state.factions.find(faction => faction.id === 0);
    if (!leader || !faction) throw new Error('Offensive preview requires a Leader');
    const combatFactions = state.factions.filter(candidate => candidate.villageId === undefined);
    if (combatFactions.length !== 2 || combatFactions.some(candidate => researchLevel(candidate, 'officerCorps') !== 1))
      throw new Error('Both Musketry Deathmatch factions must start with Officer Corps researched');
    leader.inside = undefined; leader.embarkedOn = undefined; leader.boardingBoat = undefined; leader.order = 'follow';
    let rally, objective;
    for (let radius = 0; radius <= 6 && !rally; radius++) {
      for (let dy = -radius; dy <= radius && !rally; dy++) for (let dx = -radius; dx <= radius && !rally; dx++) {
        const x = Math.floor(leader.x) + dx, y = Math.floor(leader.y) + dy;
        if (canWalk(state, x, y, 0)) rally = { x: x + .5, y: y + .5 };
      }
    }
    if (!rally) throw new Error('Offensive preview has no rally ground');
    for (const [dx, dy] of [[11, 0], [9, 6], [0, 11], [-11, 0], [0, -11]]) {
      const candidate = { x: rally.x + dx, y: rally.y + dy };
      if (!canWalk(state, Math.floor(candidate.x), Math.floor(candidate.y), 0)) continue;
      const route = findPath(state, rally, candidate, 0);
      if (route.length && Math.hypot(route.at(-1).x - candidate.x, route.at(-1).y - candidate.y) < 1) {
        objective = candidate; break;
      }
    }
    if (!objective) throw new Error('Offensive preview has no connected objective ground');
    const result = beginOffensive(state, rally, objective);
    if (!result.ok) throw new Error(`Offensive preview rejected: ${result.message}`);
    const host = document.createElement('div');
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '99999', background: '#20261c' });
    host.innerHTML = '<canvas style="width:100%;height:100%;display:block"></canvas><canvas hidden></canvas>';
    document.body.append(host);
    const [canvas, minimap] = host.querySelectorAll('canvas');
    const renderer = new Renderer(canvas, minimap); await renderer.initialize();
    renderer.follow = false; renderer.zoom = 1.45;
    renderer.camera = { x: (rally.x + objective.x) / 2, y: (rally.y + objective.y) / 2 + 2 };
    renderer.draw(state, 0);
    const hotbar = document.querySelector('.hotbar')?.cloneNode(true);
    if (hotbar) {
      Object.assign(hotbar.style, { position: 'absolute', left: '10%', right: '10%', bottom: '24px', width: '80%' });
      host.append(hotbar);
      updateOffensiveButton(hotbar.querySelector('[data-hotbar-action="offensive"]'), state);
    }
    if (!state.paused || state.time !== time) throw new Error('Offensive preview must remain frozen');
    window.__offensiveReview = { host, renderer, state, time };
  });
  await mkdir('output/startup', { recursive: true });
  await page.screenshot({ path: 'output/startup/offensive.png' });
}
