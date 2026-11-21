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
    if (rows.some(row => row.some(Boolean))) throw new Error('All nine ore tiles must block walking');
    const approaches = Array.from({ length: 5 }, (_, dx) => ({ x: x + dx - .5, y: y + 3.5 }))
      .filter(point => canWalk(state, point.x, point.y, 0));
    const escort = state.units.filter(unit => unit.faction === 0 && (unit.kind === 'leader' || isRetinueMember(unit)) && unit.hp > 0)
      .slice(0, Math.min(3, approaches.length));
    escort.forEach((unit, index) => {
      ({ x: unit.x, y: unit.y } = approaches[index]); unit.inside = undefined;
      unit.moving = false; unit.path = undefined; unit.pathGoal = undefined; unit.facing = 1;
    });
    setMapRevealed(state, true);
    const { renderer, host } = window.__buildingReview;
    renderer.camera = { x: x + 1.5, y: y + 1.5 };
    renderer.zoom = 4;
    host.querySelector('aside').textContent = 'Solid ore footprint';
    renderer.draw(state, 0);
    window.__oreReview = { state, time: state.time };
    return { x, y, rows, escort: escort.length, villages: state.villages?.length ?? 0 };
  });
  await page.screenshot({ path: 'output/startup/ore-footprint.png' });
  await page.evaluate(() => {
    for (const fixture of [window.__buildingReview, window.__oreReview])
      if (!fixture.state.paused || fixture.state.time !== fixture.time) throw new Error('Building previews must remain frozen');
    window.__buildingReview.host.remove();
  });
  console.log(`Building preview: ${JSON.stringify({ buildings, ore })}`);
}

/** Frozen renders of ordinary procedural raider camps. */
export async function captureBarbarianLairPreview(page) {
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 1100, height: 800 });
  const layout = await page.evaluate(async () => {
    const { generateWorld } = await import('/src/world/generator.ts');
    const { createGame } = await import('/src/game/simulation.ts');
    const { Renderer } = await import('/src/game/renderer.ts');
    const { setMapRevealed } = await import('/src/game/fog.ts');
    const { canWalk, findPath, travelTimeMapFrom, wallBreachingNavigation } = await import('/src/game/pathfinding.ts');
    const { constructionEdges } = await import('/src/game/builders.ts');
    const { buildingWidth, buildingHeight, TILE_SIZE } = await import('/src/game/types.ts');
    const { RAIDER_FACTION } = await import('/src/game/raider-camps.ts');
    const { campTravelLimit } = await import('/src/game/camp-sites-native.ts');
    const state = createGame(generateWorld('advanced-infantry-drill', undefined, undefined, { style: 'pangaea' }));
    state.paused = true;
    const camp = state.raiderCamps.find(camp => camp.size === 'large');
    const compact = state.raiderCamps.find(camp => camp.size === 'small');
    if (!camp || !compact) throw new Error('Expected both fortified and small camps on the procedural map');
    const planning = wallBreachingNavigation(state, { kind: 'raider' });
    const capital = state.buildings.find(building => building.faction === 0 && building.kind === 'palace');
    const access = travelTimeMapFrom(planning, constructionEdges(planning, capital), RAIDER_FACTION, 2.35, campTravelLimit());
    const nearby = state.raiderCamps.filter(({ gate }) => Number.isFinite(access[gate.y * state.world.width + gate.x]));
    if (nearby.length < 2) throw new Error('The Quick Start capital needs at least two camp approaches on this fixture');
    if (state.buildings.some(building => building.raiderCamp !== undefined && building.kind === 'palisade'))
      throw new Error('Raider camps must have freestanding outer towers');
    const { width } = state.world;
    const campRoads = new Map();
    for (const building of state.buildings) {
      if (building.kind !== 'road' || building.raiderCamp === undefined) continue;
      const roads = campRoads.get(building.raiderCamp) ?? new Set();
      roads.add(building.y * width + building.x);
      campRoads.set(building.raiderCamp, roads);
    }
    for (const { id, gate } of state.raiderCamps) {
      const roads = campRoads.get(id);
      if (!roads?.has(gate.y * width + gate.x)) throw new Error('Raider camp needs a trail at the muster point');
      for (const cell of roads) {
        if (cell % width < width - 1 && [cell + 1, cell + width, cell + width + 1].every(neighbor => roads.has(neighbor)))
          throw new Error('Raider camp trails must leave an opening in every 2×2 square');
      }
    }
    const buildings = state.buildings.filter(building => building.raiderCamp === camp.id);
    const roads = campRoads.get(camp.id);
    for (const tent of buildings.filter(building => building.kind === 'villageTent')) {
      const door = (tent.y + 1) * width + tent.x;
      if (!roads.has(door) && !(tent.x > 0 && roads.has(door - 1))
        && !(tent.x + 1 < width && roads.has(door + 1)) && !roads.has(door + width))
        throw new Error(`Tent at ${tent.x},${tent.y} has no trail at its entrance`);
    }
    const lair = buildings.find(building => building.kind === 'barbarianLair');
    if (!lair) throw new Error('Expected a lair in a procedurally placed camp');
    const walls = buildings.filter(building => building.kind === 'wall');
    const coreTowers = new Set(camp.coreTowers);
    const outerTowers = buildings.filter(building => building.kind === 'woodenTower' && !coreTowers.has(building.id));
    if (coreTowers.size !== 4 || outerTowers.length !== 3)
      throw new Error('The fortified camp must have four core towers and three outer towers');
    const { x, y } = lair;
    const distanceFromCenter = (px, py) => Math.max(Math.abs(px - x - 1), Math.abs(py - y - 1));
    if (buildingWidth(lair) !== 3 || buildingHeight(lair) !== 3 || walls.length !== 32
      || walls.some(wall => distanceFromCenter(wall.x, wall.y) !== 4))
      throw new Error('The 3×3 lair must be centered in a 9×9 stone enclosure');
    for (let py = y - 1; py <= y + 3; py++) for (let px = x - 1; px <= x + 3; px++) {
      const open = distanceFromCenter(px, py) === 2;
      if (canWalk(state, px + .5, py + .5, RAIDER_FACTION) !== open)
        throw new Error('The lair must block its footprint and leave an open aisle');
    }
    const gate = { x: camp.gate.x + .5, y: camp.gate.y + .5 };
    if (!findPath(state, gate, camp.refuge, RAIDER_FACTION).length)
      throw new Error('Returning raiders must be able to reach the refuge beside the lair');
    const outsideGate = { x: gate.x + Math.sign(gate.x - x - 1.5), y: gate.y + Math.sign(gate.y - y - 1.5) };
    if (outerTowers.some(tower => !constructionEdges(state, tower).some(edge =>
      canWalk(state, edge.x, edge.y, 0) && (edge.x === outsideGate.x && edge.y === outsideGate.y
        || findPath(state, outsideGate, edge, 0).length))))
      throw new Error('Outer towers must be reachable from outside the stone gate');

    const compactBuildings = state.buildings.filter(building => building.raiderCamp === compact.id && building.kind !== 'road');
    const tents = compactBuildings.filter(building => building.kind === 'villageTent');
    const tower = compactBuildings.find(building => building.kind === 'woodenTower');
    if (compactBuildings.length !== 4 || tents.length !== 3 || !tower || compact.coreTowers[0] !== tower.id)
      throw new Error('The small camp must have three tents and one watchtower');
    for (const site of state.raiderCamps) for (const start of state.world.spawns) {
      const dx = Math.max(site.x - start.x, start.x - site.x - site.width, 0);
      const dy = Math.max(site.y - start.y, start.y - site.y - site.height, 0);
      if (Math.hypot(dx, dy) < 60) throw new Error('Raider camp footprint is within 60 tiles of a start');
    }

    const host = document.createElement('div');
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '99999' });
    host.innerHTML = '<canvas style="width:100%;height:100%;display:block"></canvas><canvas hidden></canvas>';
    document.body.append(host);
    const [canvas, minimap] = host.querySelectorAll('canvas');
    const renderer = new Renderer(canvas, minimap);
    await renderer.initialize();
    setMapRevealed(state, true);
    renderer.follow = false;
    renderer.camera = { x: x + 1.5, y: y + 1.5 };
    renderer.zoom = 2.25;
    renderer.draw(state, 0);
    window.__barbarianLairReview = { host, renderer, state, camp, compact, tileSize: TILE_SIZE };
    return { camps: state.raiderCamps.length, nearby: nearby.length, x, y, walls: walls.length,
      outerTowers: outerTowers.length, roads: campRoads.get(camp.id).size };
  });
  await mkdir('output/startup', { recursive: true });
  await page.screenshot({ path: 'output/startup/barbarian-lair.png' });
  await page.evaluate(() => {
    const { host, renderer, state, camp, tileSize } = window.__barbarianLairReview;
    renderer.camera = { x: camp.x + camp.width / 2, y: camp.y + camp.height / 2 };
    renderer.zoom = Math.min(host.clientWidth / ((camp.width + 3) * tileSize),
      host.clientHeight / ((camp.height + 3) * tileSize));
    renderer.draw(state, 0);
  });
  await page.screenshot({ path: 'output/startup/barbarian-camp.png' });
  await page.setViewportSize({ width: 680, height: 540 });
  await page.evaluate(() => {
    const { renderer, state, compact } = window.__barbarianLairReview;
    renderer.camera = { x: compact.x + compact.width / 2, y: compact.y + compact.height / 2 - .5 };
    renderer.zoom = 2.2;
    renderer.draw(state, 0);
  });
  await page.screenshot({ path: 'output/startup/barbarian-small-camp.png' });
  await page.evaluate(() => {
    const { host, renderer } = window.__barbarianLairReview;
    renderer.destroy();
    host.remove();
    delete window.__barbarianLairReview;
  });
  if (viewport) await page.setViewportSize(viewport);
  console.log(`Barbarian lair preview: ${JSON.stringify(layout)}`);
}

/** Render the combat HUD from a reported hit while the world is frozen. */
export async function captureCombatEdgePreview(page) {
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 960, height: 620 });
  await page.evaluate(async () => {
    const { announceCombatDamage } = await import('/src/game/army-warnings.ts');
    const { setMapRevealed } = await import('/src/game/fog.ts');
    const { Renderer } = await import('/src/game/renderer.ts');
    const { TILE_SIZE, buildingWidth, buildingHeight } = await import('/src/game/types.ts');
    const { ArmyWarnings } = await import('/src/ui/army-warnings.ts');
    const state = { ...window.__game.state, paused: true, armyWarnings: [], nextArmyWarningId: 0 };
    const town = state.buildings.find(building => building.faction === 0 && building.kind === 'palace');
    if (!town) throw new Error('Combat alert preview requires a player city');
    const center = { x: town.x + buildingWidth(town) / 2, y: town.y + buildingHeight(town) / 2 };
    const host = document.createElement('div');
    host.id = 'combat-edge-preview';
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '99999' });
    host.innerHTML = '<canvas style="width:100%;height:100%;display:block"></canvas><canvas hidden></canvas>';
    document.body.append(host);
    const [canvas, minimap] = host.querySelectorAll('canvas');
    const renderer = new Renderer(canvas, minimap);
    await renderer.initialize();
    setMapRevealed(state, true);
    renderer.follow = false;
    renderer.zoom = 1.5;
    const direction = center.x < state.world.width / 2 ? 1 : -1;
    renderer.camera = { x: center.x + direction * (renderer.width / (2 * TILE_SIZE * renderer.zoom) + 2), y: center.y + 1.5 };
    renderer.draw(state, 0);
    const warnings = new ArmyWarnings(host, () => state, point => renderer.screenPoint(point));
    announceCombatDamage(state, town);
    warnings.update(performance.now());
    const marker = host.querySelector('[data-kind="attack"][data-edge="true"]');
    if (!marker || getComputedStyle(marker).animationName !== 'army-warning-flash')
      throw new Error('An off-screen hit must show a flashing combat warning');
    const [flash] = marker.getAnimations();
    flash.pause(); flash.currentTime = 0;
    window.__combatEdgePreview = { host, renderer, warnings, center, marker };
  });
  await mkdir('output/startup', { recursive: true });
  await page.locator('#combat-edge-preview').screenshot({ path: 'output/startup/offscreen-combat.png' });
  await page.evaluate(() => {
    const { host, renderer, warnings, center, marker } = window.__combatEdgePreview;
    renderer.camera = center;
    warnings.update(performance.now());
    if (marker.isConnected) throw new Error('The combat warning must clear when the city is on screen');
    renderer.destroy(); host.remove(); delete window.__combatEdgePreview;
  });
  if (viewport) await page.setViewportSize(viewport);
}

/** Show the actionable outline on a naturally placed mud pool in a frozen scene. */
export async function captureThermalBathPreview(page) {
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 640, height: 420 });
  await page.evaluate(async () => {
    const { createScenarioGame } = await import('/src/game/scenario-loader.ts');
    const { Renderer } = await import('/src/game/renderer.ts');
    const { setMapRevealed } = await import('/src/game/fog.ts');
    const { refreshIndexedUnit } = await import('/src/game/spatial.ts');
    const { canWalk } = await import('/src/game/pathfinding.ts');
    const { currentSiteViews } = await import('/src/game/sites-native.ts');
    const { unitMaxHp, isRetinueMember } = await import('/src/game/types.ts');
    const state = await createScenarioGame('age-of-exploration');
    state.paused = true;
    const leader = state.units.find(unit => unit.kind === 'leader' && unit.faction === 0 && unit.hp > 0);
    const escort = state.units.find(unit => isRetinueMember(unit) && unit.faction === 0 && !unit.inside && unit.hp > 0);
    let spot, site;
    for (const candidate of currentSiteViews(state)) {
      if (!candidate.available) continue;
      for (const [dx, dy] of [[-1.5, .5], [3.5, .5], [.5, -1.5], [.5, 3.5]]) {
        const point = { x: candidate.x + dx, y: candidate.y + dy };
        if (canWalk(state, point.x, point.y, 0) && canWalk(state, point.x, point.y + .7, 0)) {
          spot = point; site = candidate; break;
        }
      }
      if (spot) break;
    }
    if (!leader || !escort || !site || !spot) throw new Error('Thermal bath preview needs an open mud pool and escort');
    Object.assign(leader, spot, { moving: false });
    Object.assign(escort, { x: spot.x, y: spot.y + .7, moving: false, hp: unitMaxHp(escort) * .75 });
    refreshIndexedUnit(state, leader);
    refreshIndexedUnit(state, escort);
    if (!currentSiteViews(state).some(view => view.id === site.id && view.near && view.available))
      throw new Error('The mud pool must be actionable from the adjacent approach');

    const host = document.createElement('div');
    host.id = 'thermal-bath-preview';
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '99999' });
    host.innerHTML = '<canvas style="width:100%;height:100%;display:block"></canvas><canvas hidden></canvas>';
    document.body.append(host);
    const [canvas, minimap] = host.querySelectorAll('canvas');
    const renderer = new Renderer(canvas, minimap);
    await renderer.initialize();
    setMapRevealed(state, true);
    renderer.follow = false;
    renderer.zoom = 2.65;
    renderer.camera = { x: (spot.x + site.x + 1) / 2, y: (spot.y + site.y + 1.2) / 2 };
    renderer.draw(state, 0);
    window.__thermalBathPreview = { host, renderer };
  });
  await mkdir('output/startup', { recursive: true });
  await page.locator('#thermal-bath-preview').screenshot({ path: 'output/startup/thermal-bath-outline.png' });
  await page.evaluate(() => {
    const { host, renderer } = window.__thermalBathPreview;
    renderer.destroy(); host.remove(); delete window.__thermalBathPreview;
  });
  if (viewport) await page.setViewportSize(viewport);
}

/** An isolated sea-raid arrival and land attack command on generated coast. */
export async function captureBeachedGalleyPreview(page) {
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 720, height: 460 });
  const result = await page.evaluate(async () => {
    const { createScenarioGame } = await import('/src/game/scenario-loader.ts');
    const { Renderer } = await import('/src/game/renderer.ts');
    const { setMapRevealed } = await import('/src/game/fog.ts');
    const { beginSeaInvasion, updateSeaRaids } = await import('/src/game/sea-raids.ts');
    const { sailingNavigation } = await import('/src/game/sailing.ts');
    const { canMove, canWalk } = await import('/src/game/pathfinding.ts');
    const { commandAttackAt } = await import('/src/game/simulation.ts');
    const { unitAttackRange } = await import('/src/game/combat-range.ts');
    const { refreshIndexedUnit } = await import('/src/game/spatial.ts');
    const { WATER, tileAt } = await import('/src/game/types.ts');
    const state = await createScenarioGame('age-of-exploration');
    state.paused = true;
    const city = state.buildings.find(building => building.kind === 'palace' && building.faction === 0 && building.hp > 0);
    const warrior = state.units.find(unit => unit.kind === 'warrior' && unit.faction === 0 && unit.hp > 0 && !unit.inside);
    if (!city || !warrior) throw new Error('Beaching preview needs a city and its melee escort');
    const nav = sailingNavigation(state, undefined, false, true);
    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    let shore, origin;
    search: for (let y = 9; y < state.world.height - 9; y++) for (let x = 9; x < state.world.width - 9; x++) {
      if (WATER.has(tileAt(state.world, x, y).terrain) || !canWalk(state, x + .5, y + .5, 0)) continue;
      for (const [dx, dy] of directions) {
        const berth = { x: x + .5 + 2 * dx, y: y + .5 + 2 * dy };
        const offshore = { x: x + .5 + 8 * dx, y: y + .5 + 8 * dy };
        if (nav.position(berth, 0) && nav.position(berth, Math.PI / 2) && nav.position(offshore, 0)) {
          shore = { x: x + .5, y: y + .5 }; origin = offshore; break search;
        }
      }
    }
    if (!shore || !origin) throw new Error('Beaching preview needs a walkable natural coast');
    const invasion = beginSeaInvasion(state, city, shore, origin);
    invasion.remaining = 1;
    updateSeaRaids(state, 0);
    const transport = invasion.boats[0], boat = state.units.find(unit => unit.id === transport?.id);
    if (!boat?.destination) throw new Error('Expected a transport route to a shore');
    Object.assign(boat, transport.berth);
    updateSeaRaids(state, 2);
    transport.nextUnloadAt = state.time;
    updateSeaRaids(state, 0);
    if (!boat.barbarianGalley.beached || boat.destination || transport.cargo || WATER.has(tileAt(state.world, boat.x, boat.y).terrain))
      throw new Error('The transport must sail up onto the beach and unload');
    const range = unitAttackRange(state.world, warrior, boat);
    const approach = directions.map(([dx, dy]) => ({ x: boat.x + dx * Math.min(1, range), y: boat.y + dy * Math.min(1, range) }))
      .find(point => canMove(state, point, boat, warrior.faction)
        && !state.units.some(unit => unit !== warrior && unit !== boat && unit.hp > 0 && !unit.inside
          && Math.hypot(unit.x - point.x, unit.y - point.y) < .65));
    if (!approach) throw new Error('The beach needs a melee attack position for the escort');
    Object.assign(warrior, approach, { moving: false, facing: Math.atan2(boat.y - approach.y, boat.x - approach.x) });
    refreshIndexedUnit(state, warrior);
    setMapRevealed(state, true);
    if (!commandAttackAt(state, boat.x, boat.y) || warrior.forcedAttack?.target !== boat.id)
      throw new Error('Units on land must be able to order a melee attack on the galley');

    const host = document.createElement('div');
    host.id = 'beached-galley-preview';
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '99999' });
    host.innerHTML = '<canvas style="width:100%;height:100%;display:block"></canvas><canvas hidden></canvas>';
    document.body.append(host);
    const renderer = new Renderer(...host.querySelectorAll('canvas'));
    await renderer.initialize();
    renderer.follow = false;
    renderer.zoom = 2.45;
    renderer.camera = { x: boat.x, y: boat.y - .7 };
    renderer.draw(state, 0);
    window.__beachedGalleyPreview = { host, renderer };
    return { beached: boat.barbarianGalley.beached, meleeTarget: warrior.forcedAttack.target === boat.id };
  });
  await mkdir('output/startup', { recursive: true });
  await page.locator('#beached-galley-preview').screenshot({ path: 'output/startup/beached-galley.png' });
  await page.evaluate(() => {
    const { host, renderer } = window.__beachedGalleyPreview;
    renderer.destroy(); host.remove(); delete window.__beachedGalleyPreview;
  });
  if (viewport) await page.setViewportSize(viewport);
  console.log('Beached galley preview:', result);
}
