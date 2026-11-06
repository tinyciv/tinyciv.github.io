import { entityStore } from '../../src/game/entity-store';
import type { GameState, Point, Unit } from '../../src/game/types';

export const STRESS_SCENARIOS = ['Single gate', 'Opposing corridor', 'Crowded crossing', 'Blocked goals', 'Large procession'] as const;
export type StressScenario = typeof STRESS_SCENARIOS[number];
export interface StressDriver {
  moveUnit(state: GameState, unit: Unit, goal: Point, dt: number, direct?: boolean, allowPartial?: boolean): void;
  updateFriendlyYield(state: GameState, unit: Unit, dt: number): boolean;
  beginNavigationFrame(state: GameState): void;
  endNavigationFrame(state: GameState): void;
  beginUnitFrame(state: GameState): void;
  refreshIndexedUnit(state: GameState, unit: Unit): void;
  endUnitFrame(state: GameState): void;
}
export function stressScenario(name: StressScenario): GameState {
  const width = 64, height = 40;
  const state: GameState = { world: { width, height, seed: name, source: 'Navigation stress fixture', revision: 1, spawns: [],
    tiles: Array.from({ length: width * height }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 0, production: 0, gold: 0, variation: .5 })) },
    units: [], buildings: [], factions: [], fields: [], time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [],
    selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: name, rngState: 42 };
  let id = 1;
  const add = (x: number, y: number, gx: number, gy: number): void => {
    entityStore(state).units.add({ id: id++, kind: 'warrior', faction: 0, x: x + .5, y: y + .5, destination: { x: gx + .5, y: gy + .5 },
      hp: 100, morale: 100, attack: 0, defense: 0, speed: 3.6, range: 1.1, order: 'follow', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 });
  };
  const block = (x: number, y: number): void => { state.world.tiles[y * width + x].terrain = 'lake'; };
  if (name === 'Single gate') {
    for (let y = 0; y < height; y++) entityStore(state).buildings.add({ id: 10000 + y, kind: 'wall', faction: 0, x: 28, y, hp: 100, maxHp: 100, capacity: 0 });
    entityStore(state).buildings.add({ id: 10099, kind: 'road', faction: 0, x: 28, y: 20, hp: 100, maxHp: 100, capacity: 0 });
    for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) add(16 + x, 17 + y, 36 + x, 17 + y);
  } else if (name === 'Opposing corridor') {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
      if (!(x >= 20 && x <= 43 ? y === 20 || x >= 30 && x <= 33 && y >= 18 && y <= 22 : y >= 14 && y <= 26)) block(x, y);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      add(13 + x, 18 + y, 47 + x, 18 + y);
      add(47 + x, 22 - y, 13 + x, 22 - y);
    }
  } else if (name === 'Crowded crossing') {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      add(10 + x, 8 + y, 45 + x, 25 + y);
      add(45 + x, 25 + y, 10 + x, 8 + y);
    }
  } else if (name === 'Blocked goals') {
    for (let y = 12; y <= 27; y++) for (let x = 38; x <= 53; x++) block(x, y);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) add(12 + x, 15 + y, 40 + x, 16 + y);
  } else {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) add(3 + x, 12 + y, 43 + x, 12 + y);
  }
  return state;
}
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
export function runStress(name: StressScenario, driver: StressDriver, seconds = 60, record = false) {
  const state = stressScenario(name), starts = state.units.map(unit => ({ x: unit.x, y: unit.y }));
  const stalls = new Map<number, number>(), lastMoved = new Map<number, number>();
  let overlapSamples = 0, stalledUnitSeconds = 0, maxStall = 0;
  const frames: { time: number; units: number[][] }[] = [];
  const begin = performance.now();
  for (let tick = 0; tick < seconds * 10; tick++) {
    state.time += .1;
    driver.beginNavigationFrame(state); driver.beginUnitFrame(state);
    for (const unit of state.units) {
      const before = { x: unit.x, y: unit.y };
      unit.moving = false;
      if (!driver.updateFriendlyYield(state, unit, .1)) driver.moveUnit(state, unit, unit.destination!, .1, false, name === 'Blocked goals');
      driver.refreshIndexedUnit(state, unit);
      const moved = distance(unit, before) > .001;
      if (moved) lastMoved.set(unit.id, state.time);
      const stall = moved || distance(unit, unit.destination!) < .2 ? 0 : (stalls.get(unit.id) ?? 0) + .1;
      stalls.set(unit.id, stall); maxStall = Math.max(maxStall, stall);
      if (stall > 1) stalledUnitSeconds += .1;
    }
    driver.endUnitFrame(state); driver.endNavigationFrame(state);
    const cells = new Set<number>();
    for (const unit of state.units) {
      const cell = Math.floor(unit.y) * state.world.width + Math.floor(unit.x);
      if (cells.has(cell)) overlapSamples++;
      cells.add(cell);
    }
    if (record && tick % 5 === 0) frames.push({ time: Math.round(state.time * 10) / 10, units: state.units.map(unit => [unit.id, +unit.x.toFixed(3), +unit.y.toFixed(3)]) });
  }
  const cpuMs = performance.now() - begin;
  return { name, units: state.units.length, seconds, cpuMs: +cpuMs.toFixed(1),
    arrived: state.units.filter(unit => distance(unit, unit.destination!) < .2).length,
    stalledUnitSeconds: +stalledUnitSeconds.toFixed(1), maxStall: +maxStall.toFixed(1), overlapSamples,
    meanProgress: +(state.units.reduce((sum, unit, index) => sum + distance(starts[index], unit.destination!) - distance(unit, unit.destination!), 0) / state.units.length).toFixed(2),
    stuck: state.units.filter(unit => state.time - (lastMoved.get(unit.id) ?? 0) > 5 && distance(unit, unit.destination!) >= .2)
      .map(unit => ({ id: unit.id, x: +unit.x.toFixed(2), y: +unit.y.toFixed(2), goal: unit.destination, idle: +(state.time - (lastMoved.get(unit.id) ?? 0)).toFixed(1) })),
    layout: { width: state.world.width, height: state.world.height, blocked: state.world.tiles.flatMap((tile, index) => tile.terrain === 'lake' ? [index] : []), buildings: state.buildings, goals: state.units.map(unit => unit.destination) }, frames };
}
