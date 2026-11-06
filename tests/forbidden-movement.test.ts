import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { canMove, canWalk, createReachabilityQuery, findPath, hasStaticPath, staticReachabilityMask, travelTimeMapFrom } from '../src/game/pathfinding';
import { installNavigationWasm, setNavigationWasmEnabled } from '../src/game/navigation-wasm';
import { isForbidden, setForbiddenRectangle } from '../src/game/forbidden-zones';
import { moveUnit, updateForbiddenEvacuation, validateBuildAt } from '../src/game/simulation';
import { entityStore } from '../src/game/entity-store';
import { type GameState, type Point, type Unit, distance } from '../src/game/types';

function fixture(): GameState {
  return { world: { width: 18, height: 14, seed: 'forbid-routing', source: 'test', revision: 1, spawns: [],
    tiles: Array.from({ length: 18 * 14 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 1, production: 1, gold: 0, variation: .5 })) },
    units: [], buildings: [], factions: [{ id: 0, name: 'Roma', color: '#d22', relation: 'self', affinity: 100, population: 20,
      gold: 1000, food: 100, production: 0, yields: { gold: 0, food: 0, production: 0 }, nextRaid: 1e9, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null, buildMode: null,
    diplomacy: null, gameOver: false, victory: false, seed: 'forbid-routing', rngState: 1 };
}
function actor(state: GameState, kind: Unit['kind'], x = 2.5, y = 6.5, faction = 0): Unit {
  const unit: Unit = { id: state.units.length + 1, kind, x, y, faction, hp: 100, maxHp: 100, morale: 100,
    attack: 10, defense: 5, speed: 3, range: 1, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 };
  entityStore(state).units.add(unit); return unit;
}
const route = (state: GameState, from: Point, to: Point, faction = 0, cardinal = false) => findPath(state, from, to, faction, false, undefined, undefined, undefined, cardinal, true);
const advance = (state: GameState, unit: Unit, goal: Point, ticks = 100, direct = false) => {
  const positions: Point[] = [];
  for (let i = 0; i < ticks; i++) { state.time += .1; moveUnit(state, unit, goal, .1, direct); positions.push({ x: unit.x, y: unit.y }); }
  return positions;
};

beforeAll(async () => { await installNavigationWasm(Uint8Array.from(readFileSync('public/wasm/navigation.wasm'))); });
describe('forbidden navigation and unit activity', () => {
  it('keeps both A* backends out of a marked rectangle while leaving physical access intact', () => {
    const state = fixture(), from = { x: 2.5, y: 6.5 }, to = { x: 14.5, y: 6.5 };
    setForbiddenRectangle(state, { x: 6, y: 3 }, { x: 10, y: 9 }, true);
    expect(canMove(state, from, to, 0)).toBe(true);
    expect(canMove(state, from, to, 0, undefined, true)).toBe(false);
    expect(canWalk(state, 8, 6, 0, undefined, true)).toBe(false);
    for (const cardinal of [false, true]) {
      setNavigationWasmEnabled(false); const js = route(state, from, to, 0, cardinal);
      setNavigationWasmEnabled(true); const wasm = route(state, from, to, 0, cardinal);
      expect(wasm).toEqual(js);
      expect(js.reduce((length, point, index) => length + distance(index ? js[index - 1] : from, point), 0)).toBeGreaterThan(12);
      expect(js.every(point => !isForbidden(state, point.x, point.y))).toBe(true);
    }
  });

  it('uses forbidden topology consistently for connectivity, goals and travel-time maps, and restores it when erased', () => {
    const state = fixture(), from = { x: 2.5, y: 6.5 }, to = { x: 14.5, y: 6.5 }, target = 6 * 18 + 14;
    setForbiddenRectangle(state, { x: 8, y: 0 }, { x: 8, y: 13 }, true);
    expect(hasStaticPath(state, from, to, 0)).toBe(true);
    expect(hasStaticPath(state, from, to, 0, true)).toBe(false);
    expect(createReachabilityQuery(state, from, 0, undefined, true)(to)).toBe(false);
    expect(staticReachabilityMask(state, [from], 0, true)[target]).toBe(0);
    expect(travelTimeMapFrom(state, [from], 0, 3, 100, true)[target]).toBe(Infinity);
    expect(route(state, from, to)).toEqual([]);
    setForbiddenRectangle(state, { x: 8, y: 6 }, { x: 8, y: 6 }, false);
    expect(hasStaticPath(state, from, to, 0, true)).toBe(true);
    expect(travelTimeMapFrom(state, [from], 0, 3, 100, true)[target]).toBeLessThan(Infinity);
    expect(route(state, from, to).length).toBeGreaterThan(0);
  });

  it.each(['worker', 'merchant', 'militia', 'scout'] as const)('routes a friendly %s around the zone and rejects a destination within it', kind => {
    const state = fixture(), unit = actor(state, kind), goal = { x: 14.5, y: 6.5 };
    setForbiddenRectangle(state, { x: 6, y: 4 }, { x: 9, y: 8 }, true);
    const walked = advance(state, unit, goal);
    expect(walked.every(point => !isForbidden(state, point.x, point.y))).toBe(true);
    expect(distance(unit, goal)).toBeLessThan(.15);
    const before = { x: unit.x, y: unit.y };
    advance(state, unit, { x: 7.5, y: 6.5 }, 30);
    expect(distance(unit, before)).toBe(0);
  });

  it.each(['leader', 'warrior', 'archer'] as const)('allows the %s to cross a completely forbidden barrier', kind => {
    const state = fixture(), unit = actor(state, kind), goal = { x: 14.5, y: 6.5 };
    setForbiddenRectangle(state, { x: 8, y: 0 }, { x: 8, y: 13 }, true);
    expect(advance(state, unit, goal).some(point => isForbidden(state, point.x, point.y))).toBe(true);
    expect(distance(unit, goal)).toBeLessThan(.15);
  });

  it('keeps a dedicated scout behind a completely forbidden barrier', () => {
    const state = fixture(), unit = actor(state, 'scout'), goal = { x: 14.5, y: 6.5 };
    setForbiddenRectangle(state, { x: 8, y: 0 }, { x: 8, y: 13 }, true);
    const walked = advance(state, unit, goal);
    expect(walked.every(point => point.x < 8 && !isForbidden(state, point.x, point.y))).toBe(true);
    expect(distance(unit, goal)).toBeGreaterThan(1);
  });

  it('ignores marks for hostile civilians but applies them when a faction joins the player', () => {
    const state = fixture(), unit = actor(state, 'worker', 2.5, 6.5, 1), goal = { x: 14.5, y: 6.5 };
    state.factions.push({ ...state.factions[0], id: 1, relation: 'war' });
    setForbiddenRectangle(state, { x: 8, y: 0 }, { x: 8, y: 13 }, true);
    expect(route(state, unit, goal, 1).length).toBeGreaterThan(0);
    state.factions[1].relation = 'confederated';
    expect(route(state, unit, goal, 1)).toEqual([]);
    expect(advance(state, unit, goal, 20).every(point => point.x < 8)).toBe(true);
  });

  it('evacuates a worker painted over without teleporting or resuming work inside', () => {
    const state = fixture(), unit = actor(state, 'worker', 8.5, 6.5);
    setForbiddenRectangle(state, { x: 6, y: 4 }, { x: 10, y: 8 }, true);
    let left = false;
    for (let i = 0; i < 40; i++) {
      state.time += .1; const previous = { x: unit.x, y: unit.y };
      moveUnit(state, unit, { x: 8.5, y: 6.5 }, .1);
      expect(distance(previous, unit)).toBeLessThanOrEqual(.300001);
      const forbidden = isForbidden(state, unit.x, unit.y);
      if (left) expect(forbidden).toBe(false);
      left ||= !forbidden;
    }
    expect(left).toBe(true);
  });

  it('waits safely if the entire reachable area is forbidden, then exits after an opening is erased', () => {
    const state = fixture(), unit = actor(state, 'worker', 8.5, 6.5), before = { x: unit.x, y: unit.y };
    setForbiddenRectangle(state, { x: 0, y: 0 }, { x: 17, y: 13 }, true);
    expect(updateForbiddenEvacuation(state, unit, .1)).toBe(true);
    expect(distance(unit, before)).toBe(0);
    setForbiddenRectangle(state, { x: 10, y: 6 }, { x: 10, y: 6 }, false);
    advance(state, unit, { x: 10.5, y: 6.5 }, 15);
    expect(isForbidden(state, unit.x, unit.y)).toBe(false);
  });


  it('keeps many fully enclosed workers idle without periodic whole-map exit searches', () => {
    const state = fixture();
    state.world.width = 194; state.world.height = 153;
    state.world.tiles = Array.from({ length: 194 * 153 }, () => ({ ...state.world.tiles[0] }));
    const workers = Array.from({ length: 200 }, (_, i) => actor(state, 'worker', 20.5 + i % 20, 20.5 + Math.floor(i / 20)));
    setForbiddenRectangle(state, { x: 0, y: 0 }, { x: 193, y: 152 }, true);
    const started = performance.now();
    for (let i = 0; i < 200; i++) {
      state.time += .1;
      for (const worker of workers) expect(updateForbiddenEvacuation(state, worker, .1)).toBe(true);
    }
    console.info(`Forbidden full-map evacuation: 200 workers × 200 steps = ${(performance.now() - started).toFixed(1)} ms`);
    expect(workers.every(worker => !worker.moving && isForbidden(state, worker.x, worker.y))).toBe(true);
  });

  it('invalidates an already walking civilian route on designation without a terrain edit', () => {
    const state = fixture(), unit = actor(state, 'worker'), goal = { x: 14.5, y: 6.5 };
    advance(state, unit, goal, 3);
    expect(unit.path?.some(point => Math.floor(point.x) === 8 && Math.floor(point.y) === 6)).toBe(true);
    setForbiddenRectangle(state, { x: 7, y: 4 }, { x: 9, y: 8 }, true);
    expect(advance(state, unit, goal).every(point => !isForbidden(state, point.x, point.y))).toBe(true);
    expect(distance(unit, goal)).toBeLessThan(.15);
  });

  it('rejects construction if any footprint tile is forbidden', () => {
    const state = fixture(); actor(state, 'leader', 8.5, 6.5);
    setForbiddenRectangle(state, { x: 10, y: 7 }, { x: 10, y: 7 }, true);
    expect(validateBuildAt(state, 'palace', 9, 6)).toEqual({ ok: false, message: 'Remove the forbidden zone before building here.' });
  });
});
