import { entityStore } from '../src/game/entity-store';
import { unlockBuildingResearch } from './helpers/research';
import { describe, expect, it } from 'vitest';
import { canPlaceHouseAt, nearestHouseSite, planHouseSite } from '../src/game/housing';
import { palaceReachability, palaceSpacingAllowed } from '../src/game/placement';
import { buildingSize, type Building, type GameState, type Point, type Unit } from '../src/game/types';
import { canReachConstruction } from '../src/game/builders';
import { synchronizeFarms } from '../src/game/farms';
import { updateGame, validateBuildAt } from '../src/game/simulation';

function building(id: number, kind: Building['kind'], x: number, y: number): Building {
  return { id, kind, faction: 0, x, y, hp: 160, maxHp: 160, capacity: kind === 'house' || kind === 'camp' ? 4 : 0 };
}
function fixture(): GameState {
  return {
    world: { width: 30, height: 24, seed: 'housing', source: 'test', spawns: [], tiles: Array.from({ length: 720 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 2, production: 1, gold: 0, variation: .2 })) },
    buildings: [building(1, 'palace', 6, 10)], units: [], fields: [], factions: [],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'housing', rngState: 1,
  };
}
function restrictCandidates(state: GameState, points: Point[]): void {
  for (const tile of state.world.tiles) tile.overlay = 'forest';
  for (const point of points) state.world.tiles[point.y * state.world.width + point.x].overlay = 'none';
}
function populate(state: GameState): void {
  state.factions.push({ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 500,
    production: 500, population: 4, culture: 10000, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1000, defeated: false });
  state.buildings.find(building => building.kind === 'palace' && building.faction === 0)!.populationGrowth = 1;
  unlockBuildingResearch(state.factions[0]);
  entityStore(state).units.add({ id: 500, kind: 'leader', faction: 0, x: 13.5, y: 12.5, hp: 100, morale: 100, attack: 25, defense: 4,
    speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 });
}

describe('automatic house placement', () => {
  it('deterministically finds a reachable one-cell home near the palace', () => {
    const state = fixture(), palace = state.buildings[0], before = JSON.stringify(state);
    const site = nearestHouseSite(state, palace)!;
    expect(site).toBeDefined();
    expect(nearestHouseSite(state, palace)).toEqual(site);
    expect(palaceSpacingAllowed(state, 'house', site.x, site.y)).toBe(true);
    expect(Math.hypot(site.x + .5 - palace.x - 1, site.y + .5 - palace.y - 1)).toBeLessThanOrEqual(10);
    const house = building(2, 'house', site.x, site.y);
    expect(buildingSize(house)).toBe(1);
    expect(canReachConstruction(state, palace, house)).toBe(true);
    expect(JSON.stringify(state)).toBe(before);
  });

  it.each(['road', 'field', 'future field', 'water', 'overlay', 'building'] as const)('keeps houses off %s tiles', obstacle => {
    const state = fixture(), rejected = { x: 6, y: 6 }, fallback = { x: 12, y: 10 };
    restrictCandidates(state, [rejected, fallback]);
    const tile = state.world.tiles[rejected.y * state.world.width + rejected.x];
    if (obstacle === 'road') entityStore(state).buildings.add(building(2, 'road', rejected.x, rejected.y));
    if (obstacle === 'field') state.fields!.push({ id: 3, camp: 50, faction: 0, ...rejected, planted: false, food: 0, nextHarvest: 30 });
    if (obstacle === 'future field') entityStore(state).buildings.add({ ...building(2, 'camp', rejected.x, rejected.y), construction: { startedAt: 0, duration: 15, waitingForBuilder: true } });
    if (obstacle === 'water') tile.terrain = 'lake';
    if (obstacle === 'overlay') tile.overlay = 'swamp';
    if (obstacle === 'building') entityStore(state).buildings.add(building(2, 'tower', rejected.x, rejected.y));
    expect(nearestHouseSite(state, state.buildings[0])).toEqual(fallback);
  });

  it('ignores passing peasants when planning the nearest house', () => {
    const state = fixture(), palace = state.buildings[0], site = nearestHouseSite(state, palace)!;
    entityStore(state).units.add({ id: 2, kind: 'worker', faction: 0, x: site.x + .5, y: site.y + .5, hp: 50 } as Unit);
    expect(nearestHouseSite(state, palace)).toEqual(site);
  });

  it('chooses the nearest free parcel even directly beside farmland', () => {
    const state = fixture(), fallback = { x: 15, y: 10 };
    entityStore(state).buildings.add(building(2, 'house', 12, 10), building(3, 'camp', 6, 5));
    restrictCandidates(state, [{ x: 12, y: 11 }, { x: 8, y: 6 }, fallback]);
    expect(nearestHouseSite(state, state.buildings[0])).toEqual({ x: 8, y: 6 });
  });

  it('chooses a closer isolated parcel before extending a farther block', () => {
    const state = fixture();
    entityStore(state).buildings.add(building(2, 'house', 12, 10));
    restrictCandidates(state, [{ x: 12, y: 11 }, { x: 6, y: 6 }]);
    expect(planHouseSite(state, state.buildings[0])).toEqual({ point: { x: 6, y: 6 } });
  });

  it.each([false, true])('fills compact 2×4 blocks with a complete walking lane between them (rotated=%s)', rotated => {
    const state = fixture(), palace = state.buildings[0];
    const points: Point[] = [];
    for (let block = 0; block < 2; block++) for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++)
      points.push(rotated ? { x: 12 + y + block * 3, y: 8 + x } : { x: 11 + x, y: 6 + y + block * 3 });
    restrictCandidates(state, points);
    for (let count = 0; count < 16; count++) {
      const site = planHouseSite(state, palace);
      expect(site, `house ${count + 1}`).toBeDefined();
      expect(site?.replaceCampId).toBeUndefined();
      entityStore(state).buildings.add(building(count + 2, 'house', site!.point.x, site!.point.y));
    }
    expect(planHouseSite(state, palace)).toBeUndefined();
    const actual = state.buildings.filter(home => home.kind === 'house').map(({ x, y }) => ({ x, y }));
    expect(actual).toEqual(expect.arrayContaining(points));
    for (const home of state.buildings.filter(home => home.kind === 'house')) expect(canReachConstruction(state, palace, home)).toBe(true);
  });

  it.each([
    { homes: [[11, 6], [12, 6], [13, 6], [14, 6]], rejected: { x: 15, y: 6 } },
    { homes: [[11, 6], [12, 6], [13, 6], [11, 7], [12, 7], [13, 7]], rejected: { x: 12, y: 8 } },
    { homes: [[11, 6], [12, 6], [14, 6], [15, 6]], rejected: { x: 13, y: 6 } },
    { homes: [[11, 6]], rejected: { x: 12, y: 7 } },
  ])('allows extending, joining and diagonally touching arbitrary housing shapes: $rejected', ({ homes, rejected }) => {
    const state = fixture(), fallback = { x: 15, y: 12 };
    entityStore(state).buildings.add(...homes.map(([x, y], index) => building(index + 2, 'house', x, y)));
    restrictCandidates(state, [rejected]);
    expect(canPlaceHouseAt(state, state.buildings[0], rejected)).toBe(true);
    // Automatic growth may keep a short through-route; manual placement may
    // use the longer proven route around the joined row.
    const automatic = planHouseSite(state, state.buildings[0]);
    if (automatic) expect(automatic).toEqual({ point: rejected });
  });

  it.each(['tower', 'palace', 'water', 'volcano', 'enemy house', 'farm plot', 'pending house'] as const)('permits a reachable home directly beside %s', obstacle => {
    const state = fixture(), rejected = { x: 12, y: 10 }, fallback = { x: 6, y: 5 };
    restrictCandidates(state, [rejected, fallback]);
    if (obstacle === 'tower' || obstacle === 'palace') entityStore(state).buildings.add(building(2, obstacle, 13, 10));
    if (obstacle === 'water') state.world.tiles[10 * 30 + 13].terrain = 'lake';
    if (obstacle === 'volcano') state.world.tiles[10 * 30 + 13].overlay = 'volcano';
    if (obstacle === 'enemy house') entityStore(state).buildings.add({ ...building(2, 'house', 13, 10), faction: 1 });
    if (obstacle === 'farm plot') state.fields!.push({ id: 3, camp: 50, faction: 0, x: 13, y: 10, planted: false, food: 0, nextHarvest: 30 });
    if (obstacle === 'pending house') {
      // Three pending homes already reserve a vertical block; a third column
      // cannot attach at its corner even before the workers finish building.
      for (let y = 9; y <= 11; y++) for (let x = 13; x <= 14; x++)
        entityStore(state).buildings.add({ ...building(y * 30 + x, 'house', x, y), construction: { startedAt: 0, duration: 20 } });
    }
    expect(canPlaceHouseAt(state, state.buildings[0], rejected)).toBe(true);
  });

  it('allows roads in the walking lane without building over them', () => {
    const state = fixture(), site = { x: 12, y: 10 };
    restrictCandidates(state, [site]);
    entityStore(state).buildings.add(building(2, 'road', 13, 10));
    expect(planHouseSite(state, state.buildings[0])).toEqual({ point: site });
  });

  it('replaces the closest completed farm only when there is no closer suitable open cell', () => {
    const state = fixture(), camp = building(2, 'camp', 6, 5), farther = { x: 14, y: 10 };
    entityStore(state).buildings.add(camp); restrictCandidates(state, [camp, farther]);
    {
      const x = camp.x, y = camp.y;
      state.fields!.push({ id: y * 30 + x, camp: camp.id, faction: 0, x, y, planted: true, food: 3, nextHarvest: 30 });
      const tile = state.world.tiles[y * 30 + x]; tile.farm = 0; tile.overlay = 'none';
    }
    const before = JSON.stringify(state);
    expect(planHouseSite(state, state.buildings[0])).toMatchObject({ point: { x: camp.x, y: camp.y }, replaceCampId: camp.id, farmMove: { camp: camp.id } });
    expect(JSON.stringify(state)).toBe(before);
    // The caller can explicitly reserve a farm from redevelopment.
    expect(planHouseSite(state, state.buildings[0], () => false)).toEqual({ point: farther });
    state.world.tiles[10 * 30 + 10].overlay = 'none';
    expect(planHouseSite(state, state.buildings[0])).toEqual({ point: { x: 10, y: 10 } });
  });

  it.each(['enemy', 'pending', 'suppressed', 'blocked builder'] as const)('does not replace a %s farm', condition => {
    const state = fixture(), camp = building(2, 'camp', 6, 5), farther = { x: 14, y: 10 };
    entityStore(state).buildings.add(camp); restrictCandidates(state, [camp, farther]);
    if (condition === 'enemy') camp.faction = 1;
    if (condition === 'pending') camp.construction = { startedAt: 0, duration: 20 };
    if (condition === 'suppressed') camp.farmSuppressed = true;
    if (condition === 'blocked builder') {
      for (let y = 3; y <= 7; y++) for (let x = 4; x <= 8; x++) if (x === 4 || x === 8 || y === 3 || y === 7)
        state.world.tiles[y * 30 + x].terrain = 'lake';
    }
    expect(planHouseSite(state, state.buildings[0])).toEqual({ point: farther });
  });

  it('does not close the sole route through a narrow river crossing to fields and the far bank', () => {
    const state = fixture(), palace = state.buildings[0];
    for (const tile of state.world.tiles) { tile.terrain = 'lake'; tile.overlay = 'none'; }
    // Palace shore, a one-cell crossing, then a larger farming shore.
    for (let y = 8; y <= 13; y++) for (let x = 4; x <= 8; x++) state.world.tiles[y * 30 + x].terrain = 'grassland';
    for (let x = 9; x <= 13; x++) state.world.tiles[10 * 30 + x].terrain = 'grassland';
    for (let y = 8; y <= 13; y++) for (let x = 14; x <= 18; x++) state.world.tiles[y * 30 + x].terrain = 'grassland';
    state.fields!.push({ id: 1, camp: 50, faction: 0, x: 17, y: 12, planted: true, food: 3, nextHarvest: 30 });
    const before = palaceReachability(state, palace), site = nearestHouseSite(state, palace)!;
    expect(site).toBeDefined();
    const house = building(2, 'house', site.x, site.y);
    const planned = { ...state, buildings: [...state.buildings, house] }, after = palaceReachability(planned, palace);
    for (let index = 0; index < before.length; index++) if (index !== site.y * 30 + site.x && before[index]) expect(after[index]).toBe(1);
    expect(after[12 * 30 + 17]).toBe(1);
    expect(canReachConstruction(state, palace, house)).toBe(true);
  });

  it('waits when every otherwise valid site would obstruct a narrow corridor', () => {
    const state = fixture();
    for (const tile of state.world.tiles) { tile.terrain = 'lake'; tile.overlay = 'none'; }
    for (let y = 9; y <= 12; y++) for (let x = 5; x <= 8; x++) state.world.tiles[y * 30 + x].terrain = 'grassland';
    for (let x = 9; x <= 22; x++) state.world.tiles[10 * 30 + x].terrain = 'grassland';
    restrictCandidates(state, Array.from({ length: 13 }, (_, i) => ({ x: 9 + i, y: 10 })));
    expect(nearestHouseSite(state, state.buildings[0])).toBeUndefined();
    // The player may deliberately occupy that same corridor.
    expect(canPlaceHouseAt(state, state.buildings[0], { x: 12, y: 10 })).toBe(true);
  });
});

describe('construction beside housing', () => {
  it.each(['woodenTower', 'well', 'monument', 'palace', 'library', 'blacksmith'] as const)('allows %s directly beside pending and completed houses', kind => {
    const state = fixture(), house = building(2, 'house', 12, 10);
    entityStore(state).buildings.add(house); populate(state);
    state.factions[0].population = 30;
    state.factions[0].gold = 5000;
    for (const pending of [true, false]) {
      house.construction = pending ? { startedAt: 0, duration: 20, waitingForBuilder: true } : undefined;
      expect(validateBuildAt(state, kind, 13, 10), `${kind}, pending=${pending}`).toEqual({ ok: true, message: '' });
      expect(validateBuildAt(state, kind, 13, 11).ok).toBe(true);
      if (kind !== 'well') expect(validateBuildAt(state, kind, 12, 10)).toEqual({ ok: false, message: 'Tile occupied.' });
    }
  });

  it.each([false, true])('allows walls and towers beside a house while retaining route access (pending=%s)', pending => {
    const state = fixture(), house = building(2, 'house', 12, 10);
    if (pending) house.construction = { startedAt: 0, duration: 20, waitingForBuilder: true };
    entityStore(state).buildings.add(house); populate(state);
    expect(validateBuildAt(state, 'wall', 13, 10).ok).toBe(true);
    expect(validateBuildAt(state, 'woodenTower', 13, 10).ok).toBe(true);
    expect(validateBuildAt(state, 'woodenTower', 14, 10).ok).toBe(true);
    entityStore(state).buildings.add(building(3, 'road', 14, 10));
    expect(validateBuildAt(state, 'road', 13, 10).ok).toBe(true);
    state.world.tiles[10 * 30 + 13].terrain = 'river';
    expect(validateBuildAt(state, 'bridge', 13, 10).ok).toBe(true);
  });

  it('chooses the short walking route while keeping farm plots out of the house lane', () => {
    const state = fixture(); populate(state);
    state.factions[0].population = 28;
    const camp = building(2, 'camp', 6, 5), house = building(3, 'house', 16, 10);
    entityStore(state).buildings.add(camp, house);
    for (const tile of state.world.tiles) tile.terrain = 'lake';
    const clear = (x: number, y: number): void => { state.world.tiles[y * 30 + x].terrain = 'grassland'; };
    // Two crop cells connect to reserved road approaches. The nearby road
    // at x=15 stays clear beside the house.
    for (const center of [camp, { x: 14, y: 10 }, { x: 14, y: 17 }])
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) clear(center.x + dx, center.y + dy);
    for (let y = 7; y <= 11; y++) clear(6, y);
    for (let x = 6; x <= 16; x++) clear(x, 10);
    for (let y = 10; y <= 17; y++) clear(14, y);
    clear(7, 11); clear(13, 12);
    let roadId = 600;
    for (let y = 0; y < state.world.height; y++) for (let x = 0; x < state.world.width; x++) {
      if (state.world.tiles[y * 30 + x].terrain === 'lake' || x === 13 && y === 10 || x === 14 && y === 17) continue;
      if (state.buildings.some(building => x >= building.x && x < building.x + buildingSize(building)
        && y >= building.y && y < building.y + buildingSize(building))) continue;
      entityStore(state).buildings.add(building(roadId++, 'road', x, y));
    }
    synchronizeFarms(state);
    state.time = 59.9; state.tick = 1;
    state.buildings[0].governorNextPlanAt = 60;
    updateGame(state, .1, { up: false, down: false, left: false, right: false });
    const newCamps = state.buildings.filter(building => building.kind === 'camp' && building.id !== camp.id);
    expect(newCamps).toHaveLength(2);
    expect(newCamps[0]).toMatchObject({ x: 13, y: 10, construction: { waitingForBuilder: true } });
    expect(state.fields!.some(field => field.x === 15 && field.y === 10)).toBe(false);
  });
});


it('shares placement and navigation probes across candidate sites without hiding subsequent topology edits', () => {
  const state = fixture(), palace = state.buildings[0];
  for (let i = 0; i < 80; i++) entityStore(state).buildings.add(building(1000 + i, 'road', 20 + i % 8, 2 + Math.floor(i / 8)));
  let reads = 0;
  Object.defineProperty(palace, 'hp', { get: () => { reads++; return 650; }, enumerable: true });
  const before = JSON.stringify(state); reads = 0;
  const first = planHouseSite(state, palace)!;
  expect(first).toBeDefined();
  expect(reads).toBeLessThan(100);
  expect(JSON.stringify(state)).toBe(before);
  const home = building(2000, 'house', first.point.x, first.point.y);
  expect(canReachConstruction(state, palace, home)).toBe(true);
  entityStore(state).buildings.add(home);
  const second = planHouseSite(state, palace)!;
  expect(second).toBeDefined();
  expect(second.point).not.toEqual(first.point);
  expect(canReachConstruction(state, palace, building(2001, 'house', second.point.x, second.point.y))).toBe(true);
});
