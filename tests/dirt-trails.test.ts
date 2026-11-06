import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { groundMovementMultiplier } from '../src/game/geography';
import { canTraverseEdge, hasStaticPath, movementMultiplier, travelTimeMap } from '../src/game/pathfinding';
import { initializeVillageTrails, removeVillageTrailAt, villageTrailLinks, VILLAGE_TRAIL_MAX_FORD_SPAN } from '../src/game/village-trails';
import { initializeVillages } from '../src/game/villages';
import { markWorldChanged } from '../src/game/world-revisions';
import { recordTraffic, ROAD_TRAFFIC_THRESHOLD } from '../src/game/traffic';
import { recordMerchantRoad } from '../src/game/trade';
import { buildAt, validateBuildAt } from '../src/game/simulation';
import { applyGameCommand } from '../src/multiplayer/commands';
import { buildSelectionForKey, BUILD_OPTIONS } from '../src/ui/build-controls';
import { generateWorld } from '../src/world/generator';
import { type GameState, type NeutralVillage, type Terrain, type Unit, type World, WATER } from '../src/game/types';

function fixture(width = 32, height = 24): GameState {
  return { world: { width, height, seed: 'village-trails', source: 'test', spawns: [], revision: 0,
    tiles: Array.from({ length: width * height }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
      moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) }, buildings: [], units: [], fields: [],
    factions: [{ id: 0, name: 'Test', color: '#d85842', affinity: 100, relation: 'self', population: 20, gold: 2000,
      food: 500, production: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'village-trails', rngState: 1 };
}
function villages(state: GameState, points = [{ x: 4, y: 12 }, { x: 27, y: 12 }]): void {
  state.villages = points.map((point, index): NeutralVillage => ({ ...point, id: index + 1, faction: index + 1, campId: 100 + index,
    name: `Village ${index}`, identity: 'growers', relation: 'neutral', nextGrowthAt: 90, nextThinkAt: 0, nextRecruitAt: 90 }));
}
function divide(state: GameState, terrain: Terrain, width = 3): void {
  for (let y = 0; y < state.world.height; y++) for (let x = 14; x < 14 + width; x++) state.world.tiles[y * state.world.width + x].terrain = terrain;
}
function trailGeometry(world: World): void {
  for (let cell = 0; cell < world.tiles.length; cell++) {
    const tile = world.tiles[cell]; if (!tile.villageTrail) continue;
    const x = cell % world.width, y = Math.floor(cell / world.width);
    if (!WATER.has(tile.terrain)) continue;
    expect(tile.terrain).toBe('river'); expect(tile.overlay).toBe('ford'); expect(tile.fordAxis).toBeDefined();
    const step = tile.fordAxis === 'horizontal' ? 1 : world.width;
    let total = 1;
    for (const sign of [-1, 1]) {
      let at = cell;
      while (world.tiles[at + step * sign]?.terrain === 'river') {
        const next = at + step * sign;
        expect(world.tiles[next].overlay).toBe('ford'); total++; at = next;
        expect(total).toBeLessThanOrEqual(VILLAGE_TRAIL_MAX_FORD_SPAN);
      }
      const bank = at + step * sign;
      expect(world.tiles[bank]).toBeDefined(); expect(WATER.has(world.tiles[bank].terrain)).toBe(false);
      expect(canTraverseEdge(world, { x: at % world.width, y: Math.floor(at / world.width) },
        { x: bank % world.width, y: Math.floor(bank / world.width) })).toBe(true);
    }
    expect(x).toBeGreaterThanOrEqual(0); expect(y).toBeGreaterThanOrEqual(0);
  }
}

describe('generated village dirt trails', () => {
  it('deterministically connects the villages through their clearings without adding road buildings or spending resources', () => {
    const state = fixture(); villages(state, [{ x: 4, y: 4 }, { x: 26, y: 4 }, { x: 4, y: 19 }, { x: 26, y: 19 }]);
    const other = structuredClone(state), before = { rng: state.rngState, gold: state.factions[0].gold };
    const result = initializeVillageTrails(state);
    expect(result).toMatchObject({ villages: 4, connectedVillages: 4, components: 1, routes: 3, fordTiles: 0 });
    expect(initializeVillageTrails(other)).toEqual(result); expect(other.world.tiles).toEqual(state.world.tiles);
    expect(state.buildings).toHaveLength(0); expect(state.rngState).toBe(before.rng); expect(state.factions[0].gold).toBe(before.gold);
    for (const village of state.villages!) expect(state.world.tiles[village.y * 32 + village.x].villageTrail).toBe(true);
  });

  it('crosses the complete river between legal banks rather than ending the ford in the water', () => {
    const state = fixture(); villages(state); divide(state, 'river');
    const result = initializeVillageTrails(state);
    expect(result).toMatchObject({ connectedVillages: 2, components: 1, fordTiles: 3 }); trailGeometry(state.world);
    expect(hasStaticPath(state, { x: 4.5, y: 12.5 }, { x: 27.5, y: 12.5 }, 0)).toBe(true);
  });

  it.each(['lake', 'coast', 'ocean'] as const)('does not turn %s into a bridge disguised as a ford', terrain => {
    const state = fixture(); villages(state); divide(state, terrain);
    expect(initializeVillageTrails(state)).toMatchObject({ connectedVillages: 0, components: 2, fordTiles: 0, trailTiles: 0 });
    expect(state.world.tiles.some(tile => tile.overlay === 'ford')).toBe(false);
  });

  it('rejects wide river spans and cliff banks', () => {
    const wide = fixture(); villages(wide); divide(wide, 'river', 5);
    expect(initializeVillageTrails(wide).routes).toBe(0);
    const cliff = fixture(); villages(cliff); divide(cliff, 'river', 2);
    for (let y = 0; y < 24; y++) cliff.world.tiles[y * 32 + 13].ridge = 1;
    expect(initializeVillageTrails(cliff).routes).toBe(0);
  });

  it('cannot cut diagonally between two impassable corners', () => {
    const state = fixture(8, 8); state.world.tiles.forEach(tile => { tile.terrain = 'ocean'; });
    state.world.tiles[3 * 8 + 3].terrain = state.world.tiles[4 * 8 + 4].terrain = 'grassland';
    villages(state, [{ x: 3, y: 3 }, { x: 4, y: 4 }]);
    expect(initializeVillageTrails(state).routes).toBe(0);
  });

  it('routes around occupied village houses and retains connections through normal-road replacements', () => {
    const state = fixture(); villages(state);
    entityStore(state).buildings.add({ id: 20, kind: 'villageTent', faction: 1, x: 15, y: 12, hp: 100, maxHp: 100, capacity: 0 });
    expect(initializeVillageTrails(state).connectedVillages).toBe(2);
    expect(state.world.tiles[12 * 32 + 15].villageTrail).toBeUndefined();
    const first = state.world.tiles.findIndex(tile => tile.villageTrail), x = first % 32, y = Math.floor(first / 32);
    const original = villageTrailLinks(state.world, x, y), neighbors = [first - 32, first + 1, first + 32, first - 1]
      .filter(cell => state.world.tiles[cell]?.villageTrail);
    if (neighbors.length) {
      const replaced = neighbors[0]; expect(removeVillageTrailAt(state.world, replaced % 32, Math.floor(replaced / 32))).toBe(true);
      expect(villageTrailLinks(state.world, x, y, new Set([replaced]))).toEqual(original);
    }
  });

  it.each(['none', 'forest', 'swamp', 'ford'] as const)('adds precisely five percent to %s terrain speed', overlay => {
    const state = fixture(), tile = state.world.tiles[8 * 32 + 8]; tile.overlay = overlay;
    if (overlay === 'ford') tile.terrain = 'river';
    const before = groundMovementMultiplier(tile); tile.villageTrail = true;
    expect(groundMovementMultiplier(tile) / before).toBeCloseTo(1.05, 12);
    expect(movementMultiplier(state, 8.5, 8.5)).toBeCloseTo(before * 1.05, 12);
  });

  it('charges the same five-percent benefit in cached route costs and removes it when paved', () => {
    const state = fixture(), origin = { x: 5.5, y: 5.5 }, target = 5 * 32 + 9;
    const ordinary = travelTimeMap(state, origin, 0, 1, 30)[target];
    for (let x = 5; x <= 9; x++) state.world.tiles[5 * 32 + x].villageTrail = true;
    markWorldChanged(state.world, 'appearance');
    expect(travelTimeMap(state, origin, 0, 1, 30)[target]).toBeCloseTo(ordinary / 1.05, 5);
    expect(removeVillageTrailAt(state.world, 9, 5)).toBe(true);
    entityStore(state).buildings.add({ id: 1, kind: 'road', faction: 0, x: 9, y: 5, hp: 100, maxHp: 100, capacity: 0 });
    markWorldChanged(state.world, 'appearance'); expect(movementMultiplier(state, 9.5, 5.5)).toBe(1.5);
  });

  it('has no manual menu entry, shortcut, or accepted multiplayer build command', () => {
    const state = fixture();
    expect(BUILD_OPTIONS.some(option => (option.kind as string) === 'trail')).toBe(false);
    expect(buildSelectionForKey('x', 'build')).toBeUndefined();
    expect(applyGameCommand(state, 0, { type: 'build', kind: 'trail', points: [{ x: 10, y: 8 }] }).ok).toBe(false);
  });

  it('allows ordinary buildings to occupy trails and removes them when a normal road is ordered', () => {
    const state = fixture();
    entityStore(state).buildings.add({ id: 1, kind: 'palace', faction: 0, x: 5, y: 8, hp: 650, maxHp: 650, capacity: 20 },
      { id: 2, kind: 'road', faction: 0, x: 10, y: 8, hp: 100, maxHp: 100, capacity: 0 });
    entityStore(state).units.add({ id: 3, kind: 'leader', faction: 0, x: 10.5, y: 10.5, hp: 100, morale: 100, attack: 25,
      defense: 5, speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 });
    state.world.tiles[8 * 32 + 9].villageTrail = true;
    expect(validateBuildAt(state, 'camp', 9, 8).ok).toBe(true);
    expect(buildAt(state, 'road', 9, 8).ok).toBe(true);
    expect(state.world.tiles[8 * 32 + 9].villageTrail).toBeUndefined();
  });

  it.each(['traffic', 'merchant'] as const)('removes the trail permanently when %s makes a normal road', source => {
    const state = fixture();
    entityStore(state).buildings.add({ id: 1, kind: 'palace', faction: 0, x: 5, y: 8, hp: 650, maxHp: 650, capacity: 20 },
      { id: 2, kind: 'road', faction: 0, x: 10, y: 8, hp: 100, maxHp: 100, capacity: 0 });
    const unit: Unit = { id: 3, kind: source === 'merchant' ? 'merchant' : 'worker', faction: 0, x: 9.5, y: 8.5,
      hp: 100, morale: 100, attack: 0, defense: 1, speed: 2, range: 0, order: 'wander', cooldown: 0,
      lastCombat: -60, moving: true, facing: 0, attackTime: 0, tradeRoute: source === 'merchant' ? 1 : undefined };
    entityStore(state).units.add(unit); state.world.tiles[8 * 32 + 9].villageTrail = true;
    if (source === 'merchant') expect(recordMerchantRoad(state, unit)).toBe(true);
    else for (let visit = 0; visit < ROAD_TRAFFIC_THRESHOLD; visit++) {
      state.time = visit;
      expect(recordTraffic(state, unit, { x: 10.5, y: 8.5 })).toBe(visit === ROAD_TRAFFIC_THRESHOLD - 1);
    }
    expect(state.world.tiles[8 * 32 + 9].villageTrail).toBeUndefined();
    expect(movementMultiplier(state, 9.5, 8.5)).toBe(1.5);
  });
});

describe('village trail generation across landscapes', () => {
  it.each(['fractal', 'continents', 'pangaea'] as const)('connects most reachable villages on %s', style => {
    const ratios: number[] = [];
    for (const seed of ['village-paths-a', 'village-paths-b', 'village-paths-c']) {
      const world = generateWorld(`${style}-${seed}`, 96, 72, { style }), state = fixture(); state.world = world;
      state.factions = world.spawns.map((_, id) => ({ ...state.factions[0], id }));
      for (let i = 0; i < world.spawns.length; i++) entityStore(state).buildings.add({ id: i + 1, kind: 'palace', faction: i,
        ...world.spawns[i], hp: 650, maxHp: 650, capacity: 20 });
      initializeVillages(state);
      const report = initializeVillageTrails(state);
      expect(report.villages).toBeGreaterThanOrEqual(3);
      expect(report.searchedPairs).toBeLessThanOrEqual(report.villages * 6);
      ratios.push(report.connectedVillages / report.villages);
      expect(state.world.tiles.filter(tile => tile.villageTrail).every(tile => !WATER.has(tile.terrain) || tile.overlay === 'ford')).toBe(true);
    }
    expect(ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length).toBeGreaterThanOrEqual(.75);
  }, 30_000);
});
