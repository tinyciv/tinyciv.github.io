import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildAt, validateBuildAt } from '../src/game/simulation';
import { canMove, canWalk, findPath, hasStaticPath, traversable } from '../src/game/pathfinding';
import { unitNavigationState } from '../src/game/unit-navigation';
import { withSimulationReads } from '../src/game/simulation-reads';
import { installNavigationWasm, setNavigationWasmEnabled } from '../src/game/navigation-wasm';
import { markWorldChanged } from '../src/game/world-revisions';
import { resourceBlocksGround, resourceFootprintBlocked } from '../src/game/resource-terrain';
import { reliefFootprintAllowed } from '../src/game/relief';
import { planAutomaticFarmSite } from '../src/game/farm-siting';
import { planHouseAt } from '../src/game/housing';
import { recordMerchantRoad } from '../src/game/trade';
import { canPlaceRoad } from '../src/game/traffic';
import { tileAt, type GameState, type RegionalResource } from '../src/game/types';

beforeAll(async () => installNavigationWasm(Uint8Array.from(readFileSync('public/wasm/simulation.wasm'))));
function fixture(): GameState {
  return {
    world: { width: 30, height: 24, seed: 'solid-resources', source: 'test', spawns: [], revision: 1,
      tiles: Array.from({ length: 720 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 10, y: 10, hp: 650, maxHp: 650, capacity: 20,
      unhousedResidents: 20, initialCity: true }],
    units: [{ id: 2, kind: 'leader', faction: 0, x: 12.5, y: 12.5, hp: 100, maxHp: 100, morale: 100,
      attack: 25, defense: 5, speed: 3.6, range: 4, order: 'hold', cooldown: 0,
      lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Home', color: '#d94d4d', affinity: 100, relation: 'self', population: 20,
      food: 100, gold: 1000, production: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: null,
    selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'solid-resources', rngState: 1,
  };
}

describe('solid stone and ore deposits', () => {
  it.each(['stone', 'copper', 'iron', 'salt'] as const)('routes both navigation backends around %s, developed or undeveloped', resource => {
    const state = fixture(), from = { x: 3.5, y: 4.5 }, to = { x: 9.5, y: 4.5 };
    for (let y = 2; y <= 6; y++) state.world.tiles[y * 30 + 6].resource = resource;
    markWorldChanged(state.world, 'appearance');
    for (const developed of [false, true]) for (const wasm of [false, true]) {
      state.world.tiles[4 * 30 + 6].resourceDeveloped = developed;
      setNavigationWasmEnabled(wasm);
      expect(traversable(state.world, 6, 4)).toBe(false); expect(canWalk(state, 6.5, 4.5, 0)).toBe(false);
      expect(canMove(state, from, to, 0)).toBe(false);
      const path = findPath(state, from, to, 0);
      expect(path.at(-1)).toEqual(to);
      expect(path.every(point => !resourceBlocksGround(tileAt(state.world, point.x, point.y)))).toBe(true);
      let previous = from;
      for (const point of path) { expect(canMove(state, previous, point, 0)).toBe(true); previous = point; }
    }
  });

  it.each([[2, 2], [3, 3], [5, 3]])('keeps the back rows of a %i×%i ore deposit open for travel and building', (oreWidth, oreHeight) => {
    const state = fixture(), { world } = state, oreAnchor = 3 * world.width + 6;
    for (let y = 0; y < oreHeight; y++) for (let x = 0; x < oreWidth; x++)
      Object.assign(world.tiles[oreAnchor + y * world.width + x], { resource: 'gold', oreAnchor, oreWidth, oreHeight });
    markWorldChanged(world, 'appearance');
    const from = { x: 4.5, y: 3.5 }, behind = { x: 7.5, y: 3.5 }, front = { x: 7.5, y: 3.5 + oreHeight - 1 };
    expect(resourceFootprintBlocked(world, behind.x, behind.y)).toBe(false);
    expect(reliefFootprintAllowed(world, behind.x, behind.y)).toBe(true);
    expect(resourceFootprintBlocked(world, front.x, front.y)).toBe(true);
    expect(reliefFootprintAllowed(world, front.x, front.y)).toBe(false);
    const check = () => {
      expect(canMove(state, from, behind, 0)).toBe(true);
      expect(findPath(state, from, behind, 0).at(-1)).toEqual(behind);
      expect(canWalk(state, front.x, front.y, 0)).toBe(false);
    };
    check();
    withSimulationReads(state, check);
  });

  it('refreshes cached reachability when deposits appear or disappear', () => {
    const state = fixture(), from = { x: 3.5, y: 4.5 }, to = { x: 9.5, y: 4.5 };
    expect(hasStaticPath(state, from, to, 0)).toBe(true);
    for (let y = 0; y < 24; y++) state.world.tiles[y * 30 + 6].resource = 'stone';
    markWorldChanged(state.world, 'appearance');
    expect(hasStaticPath(state, from, to, 0)).toBe(false); expect(findPath(state, from, to, 0)).toEqual([]);
    delete state.world.tiles[4 * 30 + 6].resource; markWorldChanged(state.world, 'appearance');
    expect(hasStaticPath(state, from, to, 0)).toBe(true);
    expect(findPath(state, from, to, 0).at(-1)).toEqual(to);
  });

  it.each(['house', 'library', 'camp', 'road', 'palisade', 'irrigation', 'palace'] as const)('rejects a %s footprint over a deposit without spending', kind => {
    const state = fixture(); state.world.tiles[13 * 30 + 13].resource = 'copper';
    markWorldChanged(state.world, 'appearance');
    const gold = state.factions[0].gold, buildings = state.buildings.length;
    expect(validateBuildAt(state, kind, 13, 13)).toMatchObject({ ok: false, message: 'Stone and ore deposits block construction.' });
    expect(buildAt(state, kind, 13, 13).ok).toBe(false);
    expect(state.factions[0].gold).toBe(gold); expect(state.buildings).toHaveLength(buildings);
    expect(planHouseAt(state, state.buildings[0], { x: 13, y: 13 })).toBeUndefined();
  });

  it('checks every cell of a large footprint and prevents automatic roads', () => {
    const state = fixture(); state.world.tiles[14 * 30 + 14].resource = 'iron';
    markWorldChanged(state.world, 'appearance');
    expect(validateBuildAt(state, 'library', 13, 13).ok).toBe(false);
    const merchant = { ...state.units[0], id: 3, kind: 'merchant' as const, x: 14.5, y: 14.5, tradeRoute: 1 };
    expect(recordMerchantRoad(state, merchant)).toBe(false);
    expect(canPlaceRoad(state, 14, 14)).toBe(false);
  });

  it('moves the governor farm choice off a rocky deposit', () => {
    const state = fixture(), city = state.buildings[0], initial = planAutomaticFarmSite(state, city)!;
    expect(initial).toBeDefined();
    state.world.tiles[initial.point.y * 30 + initial.point.x].resource = 'stone';
    markWorldChanged(state.world, 'appearance');
    const alternate = planAutomaticFarmSite(state, city)!;
    expect(alternate).toBeDefined(); expect(alternate.point).not.toEqual(initial.point);
    expect(resourceBlocksGround(tileAt(state.world, alternate.point.x, alternate.point.y))).toBe(false);
  });

  it('limits salt access to the assigned mining footprint, including the return trip', () => {
    const state = fixture(), cells = [4 * 30 + 6, 5 * 30 + 6], other = 4 * 30 + 9;
    for (const cell of [...cells, other]) Object.assign(state.world.tiles[cell], { resource: 'salt', resourceDeveloped: true });
    markWorldChanged(state.world, 'appearance');
    const worker = { ...state.units[0], id: 3, kind: 'worker' as const, x: 5.5, y: 4.5,
      resourceWork: { site: 1, revision: 0, resource: 'salt' as const, cells, phase: 'outbound' as 'outbound' | 'returning' | 'road',
        goal: { x: 6.5, y: 4.5 }, approach: { x: 6.5, y: 6.5 } } };
    for (const phase of ['outbound', 'returning'] as const) {
      worker.resourceWork.phase = phase;
      const navigation = unitNavigationState(state, worker), goal = worker.resourceWork.goal;
      const check = () => {
        expect(canWalk(navigation, goal.x, goal.y, 0)).toBe(true);
        expect(canMove(navigation, worker, goal, 0)).toBe(true);
        expect(findPath(navigation, worker, goal, 0).at(-1)).toEqual(goal);
        expect(canWalk(navigation, 9.5, 4.5, 0)).toBe(false);
        expect(canMove(navigation, { x: 8.5, y: 4.5 }, { x: 9.5, y: 4.5 }, 0)).toBe(false);
        expect(canWalk(state, goal.x, goal.y, 0)).toBe(false);
      };
      check(); withSimulationReads(state, check);
    }
    worker.resourceWork.phase = 'road';
    expect(canWalk(unitNavigationState(state, worker), 6.5, 4.5, 0)).toBe(false);
    const builder = { ...worker, builder: true, resourceWork: undefined };
    expect(canWalk(unitNavigationState(state, builder), 6.5, 4.5, 0)).toBe(false);
  });

  it.each([false, true])('rejects purchased and merchant roads over salt pans (developed: %s)', resourceDeveloped => {
    const state = fixture(); Object.assign(state.world.tiles[13 * 30 + 13], { resource: 'salt', resourceDeveloped });
    markWorldChanged(state.world, 'appearance');
    const gold = state.factions[0].gold, buildings = state.buildings.length;
    expect(validateBuildAt(state, 'road', 13, 13)).toMatchObject({ ok: false, message: 'Salt pans block construction.' });
    expect(buildAt(state, 'road', 13, 13).ok).toBe(false);
    expect(canPlaceRoad(state, 13, 13)).toBe(false);
    expect(recordMerchantRoad(state, { ...state.units[0], id: 3, kind: 'merchant', x: 13.5, y: 13.5, tradeRoute: 1 })).toBe(false);
    expect(state.factions[0].gold).toBe(gold); expect(state.buildings).toHaveLength(buildings);
  });

  it.each(['clay', 'olives', 'fish'] as RegionalResource[])('retains ordinary traversal of non-rock resource %s', resource => {
    const state = fixture(); state.world.tiles[4 * 30 + 6].resource = resource;
    expect(canWalk(state, 6.5, 4.5, 0)).toBe(true);
  });
});
