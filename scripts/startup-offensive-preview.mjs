import { mkdir } from 'node:fs/promises';

/** Render a detached, frozen procedural world with the production flag overlay. */
export async function captureOffensivePreview(page) {
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.evaluate(async () => {
    const { MIN_ZOOM, Renderer } = await import('/src/game/renderer.ts');
    const { beginOffensive, offensiveDirective, updateOffensives } = await import('/src/game/offensive-native.ts');
    const { updateOffensiveButton } = await import('/src/ui/offensive-controls.ts');
    const { entityStore, UNIT_KIND_CODES } = await import('/src/game/entity-store.ts');
    const { canWalk, findPath, withNavigationFrame } = await import('/src/game/pathfinding.ts');
    const { setMapRevealed } = await import('/src/game/fog.ts');
    const { createScenarioGame } = await import('/src/game/scenario-loader.ts');
    const { researchLevel } = await import('/src/game/research.ts');
    const { refreshIndexedUnit } = await import('/src/game/spatial.ts');
    const { rustEngine } = await import('/src/game/rust-engine.ts');
    const { withSimulationReads } = await import('/src/game/simulation-reads.ts');

    // Exercise decisions on fixed observations without advancing a game.
    const handle = rustEngine.sim_create(1);
    try {
      const begin = () => rustEngine.sim_offensive_begin(handle, 0, 99, 12.5, 12.5, 32.5, 12.5, 1);
      const army = [1, 2, 3, 4, 5].map(id => [id, 12.5, 12.5, 100, 0, 100, 1, UNIT_KIND_CODES.musketman, id === 4 ? 2 : 3]);
      function orders(time) {
        const size = army.length * 9 + 7;
        const inputPointer = rustEngine.sim_offensive_input(handle, army.length, 1);
        const input = new Float64Array(rustEngine.memory.buffer, inputPointer, size);
        input.set(army.flat());
        input.set([100, 32.5, 12.5, 100, 0, 0, 0], size - 7);
        const pointer = rustEngine.sim_offensive_step(handle, 0, time, army.length, 1, 10);
        const header = new Float64Array(rustEngine.memory.buffer, pointer, 8);
        const output = new Float64Array(rustEngine.memory.buffer, pointer + 8 * 8, header[5] * 7);
        const directives = new Map();
        for (let row = 0; row < output.length; row += 7) directives.set(output[row], [...output.subarray(row + 1, row + 7)]);
        return { phase: header[0], directives };
      }
      function placeAtRally({ directives }) {
        for (const unit of army) {
          const order = directives.get(unit[0]);
          if (order) [unit[1], unit[2]] = [order[1], order[2]];
        }
      }
      rustEngine.sim_clock_set(handle, 100, 0);
      if (!begin()) throw new Error('An available offensive should start immediately');
      placeAtRally(orders(100));
      const advance = orders(101);
      if (advance.phase !== 2 || [...advance.directives.values()].some(([mode, , , target, , speed]) => mode !== 2 || target >= 0 || speed !== 2))
        throw new Error('The assembled army should march at a shared pace before reaching the enemy');
      for (const unit of army.filter(unit => unit[0] !== 4)) [, unit[1], unit[2]] = advance.directives.get(unit[0]);
      const waiting = orders(101.25);
      if (army.some(([id]) => advance.directives.get(id).slice(1, 3).some((value, axis) => value !== waiting.directives.get(id)[axis + 1])))
        throw new Error('The advancing ranks must wait for the soldier still moving into their checkpoint');
      placeAtRally(waiting);
      const nextRank = orders(101.5);
      if (army.some(([id]) => {
        const [, x, y] = waiting.directives.get(id), [, nextX, nextY] = nextRank.directives.get(id);
        return nextX !== x + 1 || nextY !== y;
      })) throw new Error('The army must advance its slots together once the ranks catch up');
      const [x, y] = army[3].slice(1, 3);
      [army[3][1], army[3][2]] = [30.5, 12.5];
      const contact = orders(101.75).directives.get(4);
      if (contact[0] !== 3 || contact[3] !== 100) throw new Error('The formation should attack at contact');
      [army[3][1], army[3][2]] = [x, y];
      army[0][4] = 1;
      army[0][5] = 0;
      army[1][4] = 1;
      army[1][5] = 0;
      const reduced = orders(102);
      if (reduced.phase !== 2 || [1, 2].some(id => reduced.directives.get(id)[0] !== 1))
        throw new Error('An offensive at 30% strength should continue while its routed soldiers return');
      army[2][3] = 0;
      const withdrawal = orders(103);
      if (withdrawal.phase !== 1 || [...withdrawal.directives.values()].some(([mode, , , target]) => mode !== 5 || target >= 0))
        throw new Error('An offensive below 30% strength should return to the rally flag');
      placeAtRally(withdrawal);
      if (orders(113).phase !== 1) throw new Error('The army must wait for reinforcements at the rally flag');
      for (const id of [6, 7, 8]) army.push([id, 12.5, 12.5, 100, 0, 100, 1, UNIT_KIND_CODES.musketman, 3]);
      placeAtRally(orders(114));
      orders(115);
      if (orders(123).phase !== 2) throw new Error('The reinforced formation should resume its offensive');
      rustEngine.sim_offensive_cancel(handle, 0);
      const ended = new Float64Array(rustEngine.memory.buffer, rustEngine.sim_offensive_status(handle, 0), 8);
      if (ended[0] || ended[6] !== 160) throw new Error('Ending an offensive should be immediate and preserve its cooldown');
      rustEngine.sim_clock_set(handle, 159.99, 0);
      if (begin()) throw new Error('The offensive must wait a full minute before restarting');
      rustEngine.sim_clock_set(handle, 160, 0);
      if (!begin()) throw new Error('The offensive should be ready after one minute');
    } finally {
      rustEngine.sim_drop(handle);
    }
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
        const x = Math.floor(leader.x) + 6 + dx, y = Math.floor(leader.y) + dy;
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
    withSimulationReads(state, () => withNavigationFrame(state, () => updateOffensives(state)));
    const slots = new Set();
    const facing = Math.atan2(objective.y - rally.y, objective.x - rally.x);
    for (const unit of entityStore(state).units.queryFaction('retinue', faction.id)) {
      const directive = offensiveDirective(state, unit);
      if (directive?.mode !== 1) continue;
      const { x, y } = directive.goal;
      slots.add(`${x},${y}`);
      Object.assign(unit, { x, y, facing, moving: false });
      refreshIndexedUnit(state, unit);
    }
    if (slots.size < 8) throw new Error('The offensive army needs distinct rally positions');
    const host = document.createElement('div');
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '99999', background: '#20261c' });
    host.innerHTML = '<canvas style="width:100%;height:100%;display:block"></canvas><canvas hidden></canvas>';
    document.body.append(host);
    const [canvas, minimap] = host.querySelectorAll('canvas');
    const renderer = new Renderer(canvas, minimap); await renderer.initialize();
    renderer.zoom = MIN_ZOOM;
    renderer.camera = { x: state.world.width / 2, y: state.world.height / 2 };
    const rect = canvas.getBoundingClientRect();
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const right = { x: rect.right - 1, y: center.y };
    const before = renderer.camera.x;
    renderer.panCameraAtEdge(center, state.world, 1 / 60);
    if (renderer.camera.x !== before) throw new Error('The viewport center must leave the camera still');
    const hover = renderer.worldPoint(right.x, right.y);
    renderer.panCameraAtEdge(right, state.world, 1 / 60);
    if (renderer.camera.x <= before || renderer.worldPoint(right.x, right.y).x <= hover.x)
      throw new Error('The right edge must scroll the camera and update the ground under the cursor');
    const panned = renderer.camera.x;
    renderer.panCameraAtEdge({ x: rect.right + 1, y: center.y }, state.world, 1 / 60);
    if (renderer.camera.x !== panned) throw new Error('The camera must stop scrolling outside the viewport');
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
    window.__offensiveReview = { host, renderer, state, time, factionId: faction.id, facing };
  });
  await mkdir('output/startup', { recursive: true });
  await page.screenshot({ path: 'output/startup/offensive.png' });
  const marched = await page.evaluate(async () => {
    const { renderer, state, time, factionId, facing } = window.__offensiveReview;
    const { entityStore } = await import('/src/game/entity-store.ts');
    const { offensiveDirective, updateOffensives } = await import('/src/game/offensive-native.ts');
    const { withNavigationFrame } = await import('/src/game/pathfinding.ts');
    const { patchSimulationClock } = await import('/src/game/sim-handle.ts');
    const { withSimulationReads } = await import('/src/game/simulation-reads.ts');
    const { refreshIndexedUnit } = await import('/src/game/spatial.ts');
    const members = entityStore(state).units.queryFaction('retinue', factionId);
    let marched = false;
    // Feed position observations to the formation planner in a detached
    // paused scene. No time-driven world systems run in this preview.
    for (const at of [1.05, 1.6, 2.15]) {
      patchSimulationClock(state, time + at);
      withSimulationReads(state, () => withNavigationFrame(state, () => updateOffensives(state)));
      for (const unit of members) {
        const directive = offensiveDirective(state, unit);
        if (directive?.mode !== 1 && directive?.mode !== 2) continue;
        marched ||= directive.mode === 2;
        Object.assign(unit, { ...directive.goal, facing, moving: directive.mode === 2 });
        refreshIndexedUnit(state, unit);
      }
    }
    patchSimulationClock(state, time);
    renderer.draw(state, 0);
    return marched;
  });
  if (marched) await page.screenshot({ path: 'output/startup/offensive-march.png' });
  await page.evaluate(() => {
    const { host, renderer } = window.__offensiveReview;
    renderer.destroy(); host.remove(); delete window.__offensiveReview;
  });
  await page.setViewportSize(viewport);
}
