import { entityStore } from '../src/game/entity-store';
import { describe, expect, it, vi } from 'vitest';
import { forEachEnclosureShimmerSpan, houseBirthProgress, isHouseEnclosed, palaceEnclosures } from '../src/game/enclosures';
import { updateFog } from '../src/game/fog';
import { synchronizeFarms } from '../src/game/farms';
import { updateGame } from '../src/game/simulation';
import { type Building, type GameState } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const building = (id: number, kind: Building['kind'], x: number, y: number, faction = 0): Building => ({
  id, kind, faction, x, y, hp: 100, maxHp: 100, capacity: kind === 'house' ? 2 : 0,
});
function fixture(): GameState {
  return { world: { width: 32, height: 26, seed: 'enclosure', source: 'test', spawns: [], revision: 0,
    tiles: Array.from({ length: 32 * 26 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .5, food: 2, production: 0, gold: 0, variation: .5 })) },
    units: [{ id: 1, kind: 'leader', faction: 0, x: 11.5, y: 12.5, hp: 100, maxHp: 100, attack: 0, defense: 0, morale: 100,
      speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    buildings: [building(10, 'palace', 10, 10), building(11, 'house', 8, 10), building(12, 'house', 8, 11),
      building(13, 'house', 13, 10), building(14, 'house', 13, 11),
      building(15, 'house', 8, 12), building(16, 'house', 8, 13), building(17, 'house', 13, 12), building(18, 'house', 13, 13)],
    factions: [{ id: 0, name: 'Test', color: '#38f', affinity: 100, relation: 'self', food: 1000, gold: 0, production: 0,
      population: 1, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, speed: 1, paused: false, gameOver: false, victory: false, events: [], particles: [], projectiles: [], fields: [],
    marauderPacks: [], raiderCamps: [], selected: null, selectedType: null, buildMode: null, diplomacy: null, seed: 'enclosure', rngState: 1 };
}
function ring(state: GameState, x0 = 6, y0 = 7, x1 = 15, y1 = 15): Building[] {
  const walls: Building[] = [];
  let id = Math.max(...state.buildings.map(building => building.id)) + 1;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (x === x0 || y === y0 || x === x1 || y === y1) {
    const wall = building(id++, 'wall', x, y); walls.push(wall); entityStore(state).buildings.add(wall);
  }
  return walls;
}
function economy(state: GameState): void {
  state.time = (state.tick + 1) * 30 - .05;
  updateGame(state, .05, idle);
}
function farms(state: GameState): void {
  // Isolate enclosure growth with established irrigated orchards and stored
  // food; courier-distance balancing is covered by the farm simulations.
  for (let i = 0; i < 12; i++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const id = i * 4 + dy * 2 + dx;
    const farm = building(500 + id, 'camp', 18 + (i % 6) * 2 + dx, 18 + Math.floor(i / 6) * 2 + dy);
    farm.orchard = { startedAt: -120, readyAt: 0 };
    entityStore(state).buildings.add(farm, building(600 + id, 'irrigation', farm.x, farm.y));
  }
  synchronizeFarms(state);
}

describe('palace enclosures', () => {
  it('finds only the palace interior and caches unchanged topology', () => {
    const state = fixture(); ring(state);
    const enclosed = palaceEnclosures(state);
    expect(enclosed.regions).toHaveLength(1); expect(enclosed.regions[0].palaces).toEqual([10]);
    expect(isHouseEnclosed(state, state.buildings[1])).toBe(true);
    expect(isHouseEnclosed(state, building(600, 'house', 16, 10))).toBe(false);
    expect(enclosed.cells).not.toContain(7 * state.world.width + 6);
    expect(palaceEnclosures(state)).toBe(enclosed);
  });

  it('invalidates immediately for destroyed, unfinished and restored wall sections', () => {
    const state = fixture(), wall = ring(state).find(wall => wall.x === 6 && wall.y === 11)!;
    const ready = palaceEnclosures(state); expect(ready.regions).toHaveLength(1);
    wall.hp = 0; expect(palaceEnclosures(state).regions).toHaveLength(0);
    wall.hp = 100; wall.construction = { startedAt: 0, duration: 10, waitingForBuilder: false };
    expect(palaceEnclosures(state).regions).toHaveLength(0);
    delete wall.construction; expect(palaceEnclosures(state).regions).toHaveLength(1);
    wall.faction = 1; expect(palaceEnclosures(state).regions).toHaveLength(0);
  });

  it('counts an owned gate as defended and permits allied wall sections only alongside an owned wall', () => {
    const state = fixture(), walls = ring(state);
    entityStore(state).buildings.add(building(700, 'road', 6, 11));
    expect(palaceEnclosures(state).regions).toHaveLength(1);
    state.factions.push({ ...state.factions[0], id: 1, relation: 'confederated' });
    for (const wall of walls.slice(1)) wall.faction = 1;
    expect(palaceEnclosures(state).regions).toHaveLength(1);
    walls[0].faction = 1; expect(palaceEnclosures(state).regions).toHaveLength(0);
  });

  it('leaks through diagonal gaps, ordinary structures and open map edges', () => {
    const state = fixture(), walls = ring(state), corner = walls[0];
    corner.hp = 0; expect(palaceEnclosures(state).regions).toHaveLength(0);
    corner.hp = 100; entityStore(state).setBuildingKind(corner, 'woodenTower'); expect(palaceEnclosures(state).regions).toHaveLength(0);
    entityStore(state).setBuildingKind(corner, 'wall');
    for (const wall of walls) if (wall.x === 6) wall.hp = 0;
    for (let x = 0; x < 6; x++) entityStore(state).buildings.add(building(800 + x, 'wall', x, 7), building(900 + x, 'wall', x, 15));
    expect(palaceEnclosures(state).regions).toHaveLength(0);
  });

  it('uses impassable water but treats fords and completed bridges as openings', () => {
    const state = fixture();
    for (const wall of ring(state)) if (wall.x !== 15) {
      wall.hp = 0; state.world.tiles[wall.y * 32 + wall.x].terrain = 'river';
    }
    state.world.revision!++;
    expect(palaceEnclosures(state).regions).toHaveLength(1);
    const crossing = state.world.tiles[7 * 32 + 10]; crossing.overlay = 'ford'; state.world.revision!++;
    expect(palaceEnclosures(state).regions).toHaveLength(0);
    crossing.overlay = 'none'; state.world.revision!++;
    const bridge = building(1000, 'bridge', 10, 7); bridge.construction = { startedAt: 0, duration: 10 };
    entityStore(state).buildings.add(bridge); expect(palaceEnclosures(state).regions).toHaveLength(1);
    delete bridge.construction; expect(palaceEnclosures(state).regions).toHaveLength(0);
    entityStore(state).buildings.add(building(1001, 'wall', 10, 7), building(1002, 'road', 10, 7));
    expect(palaceEnclosures(state).regions).toHaveLength(1);
  });

  it('does not award a natural island or an isolated wall inside it', () => {
    const state = fixture();
    for (const wall of ring(state)) { wall.hp = 0; state.world.tiles[wall.y * 32 + wall.x].terrain = 'lake'; }
    state.world.revision!++;
    expect(palaceEnclosures(state).regions).toHaveLength(0);
    entityStore(state).buildings.add(building(1100, 'wall', 12, 13));
    expect(palaceEnclosures(state).regions).toHaveLength(0);
  });

  it('requires a completed own palace and does not stack multiple palaces in one enclosure', () => {
    const state = fixture(); ring(state);
    entityStore(state).buildings.add(building(1200, 'palace', 11, 13));
    const enclosed = palaceEnclosures(state);
    expect(enclosed.regions).toHaveLength(1); expect(enclosed.regions[0].palaces).toEqual([10, 1200]);
    expect(houseBirthProgress(state, state.buildings[1])).toBeCloseTo(1 / 1.3);
    for (const palace of state.buildings.filter(building => building.kind === 'palace')) palace.construction = { startedAt: 0, duration: 10 };
    expect(palaceEnclosures(state).regions).toHaveLength(0);
  });
});

describe('enclosed housing growth', () => {
  it('produces exactly thirty percent more birth progress when all available housing is inside', () => {
    const state = fixture(); ring(state); farms(state);
    const faction = state.factions[0], before = faction.population;
    economy(state);
    expect(faction.population - before).toBe(9);
    expect(faction.population - before + state.buildings[0].populationGrowth! * 1.3).toBeCloseTo(7.2 * 1.3);
  });

  it('does not apply an enclosed full house’s bonus to outdoor housing', () => {
    const state = fixture(); ring(state);
    const homes = state.buildings.filter(building => building.kind === 'house');
    for (const home of homes.slice(1)) home.x += 10;
    state.factions[0].population = 2; farms(state);
    const before = state.factions[0].population; economy(state);
    expect(homes.slice(0, 5).map(home => home.residents)).toEqual([2, 2, 2, 2, 1]);
    expect(state.factions[0].population - before + state.buildings[0].populationGrowth!).toBeCloseTo(7.2);
  });

  it('rechecks the destination at each birth when a protected house fills', () => {
    const state = fixture(); ring(state);
    const homes = state.buildings.filter(building => building.kind === 'house');
    for (const home of homes.slice(1)) home.x += 10;
    state.factions[0].population = 1; farms(state); economy(state);
    expect(homes.slice(0, 4).map(home => home.residents)).toEqual([2, 2, 2, 2]);
    expect(state.buildings[0].populationGrowth).toBeCloseTo(7.2 - 1 / 1.3 - 6);
  });

  it('stops the bonus on a breach without losing ordinary saved growth', () => {
    const state = fixture(), wall = ring(state)[0]; farms(state);
    state.buildings[0].populationGrowth = .4; wall.hp = 0; economy(state);
    expect(state.factions[0].population).toBe(8); expect(state.buildings[0].populationGrowth).toBeCloseTo(.6);
  });
});

it('draws the approved pixel glints only in currently visible enclosed cells', () => {
  const state = fixture(); ring(state); const fog = updateFog(state);
  const draw = vi.fn();
  fog.visible.fill(0); fog.explored.fill(1);
  forEachEnclosureShimmerSpan(state, fog, 0, 0, 32, 1, undefined, draw);
  expect(draw).not.toHaveBeenCalled();
  fog.visible[10 * 32 + 8] = 1;
  forEachEnclosureShimmerSpan(state, fog, 0, 0, 32, 1, undefined, draw);
  expect(draw).toHaveBeenCalled();
  for (const call of draw.mock.calls) {
    expect(call.slice(0, 4).every(Number.isInteger)).toBe(true); expect(call[0]).toBeGreaterThanOrEqual(8 * 32); expect(call[0]).toBeLessThan(9 * 32);
    expect(call[1]).toBeGreaterThanOrEqual(10 * 32); expect(call[1]).toBeLessThan(11 * 32);
    expect(call[4]).toBeGreaterThan(0); expect(call[4]).toBeLessThanOrEqual(Math.round(.78 * 255) / 255);
  }
});

it('moves the pixel-glint light front southwest to northeast and stops immediately after a breach', () => {
  const state = fixture(), walls = ring(state), fog = updateFog(state);
  const capture = (time: number) => {
    let weight = 0, x = 0, y = 0;
    forEachEnclosureShimmerSpan(state, fog, 0, 0, 32, time, undefined,
      (px, py, width, height, alpha) => {
        const w = width * height * alpha;
        weight += w; x += (px + width / 2) * w; y += (py + height / 2) * w;
      });
    return { weight, x: x / weight, y: y / weight };
  };
  const early = capture(0), later = capture(1);
  expect(early.weight).toBeGreaterThan(0); expect(later.weight).toBeGreaterThan(0);
  expect(later.x).toBeGreaterThan(early.x); expect(later.y).toBeLessThan(early.y);
  walls[0].hp = 0;
  expect(capture(1).weight).toBe(0);
});


it('retains enclosure geometry through economic terrain edits but refreshes changed defensive terrain', () => {
  const state = fixture(); ring(state);
  const enclosed = palaceEnclosures(state);
  entityStore(state).buildings.add(building(1500, 'road', 10, 12), building(1501, 'house', 12, 12));
  state.world.tiles[12 * 32 + 10].overlay = 'forest'; state.world.revision!++;
  expect(palaceEnclosures(state)).toBe(enclosed);
  state.world.tiles[12 * 32 + 10].overlay = 'none'; state.world.revision!++;
  expect(palaceEnclosures(state)).toBe(enclosed);
  state.world.tiles[12 * 32 + 10].terrain = 'river'; state.world.revision!++;
  const changed = palaceEnclosures(state);
  expect(changed).not.toBe(enclosed);
  expect(changed.cells).not.toContain(12 * 32 + 10);
});
