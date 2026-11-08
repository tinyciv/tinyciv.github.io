import { describe, expect, it } from 'vitest';
import { buildStroke, constructionLine } from '../src/game/construction';
import { commandMove, updateGame } from '../src/game/simulation';
import { canWalk, findPath } from '../src/game/pathfinding';
import { insideOwnBorders } from '../src/game/borders';
import { buildingReady, type GameState } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
function fixture(width: number, population: number): GameState {
  const state: GameState = {
    world: { width: 40, height: 28, seed: 'wide-unclaimed-bridge', source: 'integration fixture', spawns: [], revision: 0,
      tiles: Array.from({ length: 40 * 28 }, (_, i) => ({ terrain: i % 40 >= 18 && i % 40 < 18 + width ? 'river' : 'grassland',
        overlay: 'none', elevation: .2, moisture: .5, food: 2, production: 0, gold: 0, variation: .5 })) },
    units: [{ id: 2, kind: 'leader', faction: 0, x: 16.5, y: 13.5, hp: 100, maxHp: 100, morale: 100,
      attack: 0, defense: 5, speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false,
      facing: 0, attackTime: 0 }],
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 5, y: 12, hp: 650, maxHp: 650, capacity: 0 }],
    factions: [{ id: 0, name: 'Bridge realm', color: '#3988ff', affinity: 100, relation: 'self', food: 1000, gold: 1000,
      production: 0, population, culture: 0, yields: { food: 0, gold: 0, production: 0 },
      research: { focus: 'engineering', levels: { engineering: 1 }, progress: {} },
      nextRaid: Infinity, nextRetinueAt: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, gameOver: false, victory: false, events: [], particles: [],
    projectiles: [], fields: [], treasures: [], marauderPacks: [], raiderCamps: [],
    selected: 2, selectedType: 'unit', buildMode: null, diplomacy: null, seed: 'wide-unclaimed-bridge', rngState: 1,
    movementMode: 'travel', retinueStance: 'aggressive',
  };
  return state;
}

/** Every tick also checks that no builder has treated a queued bridge as dry ground. */
function advanceUntil(state: GameState, finished: () => boolean, timeout: number, observe?: () => void): void {
  const deadline = state.time + timeout;
  while (!finished() && state.time < deadline) {
    updateGame(state, .1, idle);
    observe?.();
    for (const unit of state.units) if (unit.hp > 0 && !unit.inside) {
      const tile = state.world.tiles[Math.floor(unit.y) * state.world.width + Math.floor(unit.x)];
      if (tile?.terrain === 'river') expect(state.buildings.some(building => building.kind === 'bridge'
        && buildingReady(building) && building.x === Math.floor(unit.x) && building.y === Math.floor(unit.y))).toBe(true);
    }
  }
  expect(finished(), JSON.stringify({ time: state.time, buildings: state.buildings.filter(b => b.kind !== 'palace').map(b => ({
    kind: b.kind, x: b.x, y: b.y, construction: b.construction })), workers: state.units.filter(u => u.builder).map(u => ({
    x: u.x, y: u.y, phase: u.buildPhase, site: u.buildSite, inside: u.inside, stuck: u.stuckFor })) })).toBe(true);
}

describe('building across a wide river beyond borders', () => {
  it.each([[4, 5, false], [5, 15, true]] as const)(
    'finishes a %i-cell crossing with population%i (reverse drag=%s), then carries construction traffic to the far bank',
    (width, population, reverse) => {
      const state = fixture(width, population), near = { x: 18, y: 13 }, far = { x: 17 + width, y: 13 };
      const line = constructionLine(reverse ? far : near, reverse ? near : far);
      expect(line.every(point => !insideOwnBorders(state, 0, point.x + .5, point.y + .5))).toBe(true);
      expect(findPath(state, state.units[0], { x: far.x + 3.5, y: 13.5 }, 0)).toEqual([]);
      const result = buildStroke(state, 'bridge', line);
      expect(result).toMatchObject({ ok: true, placed: width, skipped: 0 });
      const bridges = state.buildings.filter(building => building.kind === 'bridge').sort((a, b) => a.x - b.x);
      const finishedAt = new Map<number, number>(), workedBy = new Set<number>();
      advanceUntil(state, () => bridges.every(buildingReady), 220, () => {
        for (const bridge of bridges) {
          if (bridge.construction?.builderId !== undefined) workedBy.add(bridge.construction.builderId);
          if (buildingReady(bridge) && !finishedAt.has(bridge.x)) finishedAt.set(bridge.x, state.time);
        }
      });
      expect([...finishedAt.keys()]).toEqual(bridges.map(bridge => bridge.x));
      expect(workedBy.size).toBeGreaterThanOrEqual(population > 5 ? 2 : 1);
      expect(bridges.every(bridge => canWalk(state, bridge.x + .5, bridge.y + .5, 0))).toBe(true);
      expect(bridges.every(bridge => !insideOwnBorders(state, 0, bridge.x + .5, bridge.y + .5))).toBe(true);

      const roads = constructionLine({ x: far.x + 1, y: 13 }, { x: far.x + 3, y: 13 });
      expect(buildStroke(state, 'road', roads)).toMatchObject({ ok: true, placed: 3 });
      const orderedRoads = state.buildings.filter(building => building.kind === 'road');
      const leader = state.units.find(unit => unit.id === 2)!;
      expect(commandMove(state, far.x + 4.5, 13.5)).toBe(true);
      let builderCrossed = false;
      advanceUntil(state, () => orderedRoads.every(buildingReady)
        && Math.hypot(leader.x - (far.x + 4.5), leader.y - 13.5) < .3
        && state.units.filter(unit => unit.builder).every(unit => unit.inside), 220, () => {
        if (state.units.some(unit => unit.builder && !unit.inside && unit.x >= far.x + 1)) builderCrossed = true;
      });
      expect(builderCrossed).toBe(true);
      expect(state.gameOver).toBe(false);
      expect(orderedRoads).toHaveLength(3);
    }, 15000);
});
