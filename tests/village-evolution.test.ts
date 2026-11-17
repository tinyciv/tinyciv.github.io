import { describe, expect, it } from 'vitest';
import { constructionEdges } from '../src/game/builders';
import { hasStaticPath } from '../src/game/pathfinding';
import { isForbidden } from '../src/game/forbidden-zones';
import { initializeVillages, villageCamp } from '../src/game/villages';
import { settlementStep } from '../src/game/settlement-step';
import { SETTLEMENT_CONSTANTS, villageStage, villageTreasury } from '../src/game/settlement-bridge';
import { buildingHeight, buildingWidth, WATER, type GameState } from '../src/game/types';

/** Open grassland with one civilization; the village is founded through the
 * real initializeVillages path (Rust chooses its layout family). */
function fixture(seed = 'village-evolution'): GameState {
  return {
    world: { width: 72, height: 60, seed, source: 'test', revision: 0, spawns: [],
      tiles: Array.from({ length: 72 * 60 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 1, production: 0, gold: 0, variation: .5 })) },
    buildings: [{ id: 100, kind: 'palace', faction: 0, x: 8, y: 8, hp: 650, maxHp: 650, capacity: 0 }],
    units: [{ id: 1, kind: 'leader', faction: 0, x: 10.5, y: 12.5, hp: 100, attack: 20, defense: 4, speed: 3.6, morale: 100,
      range: 1.1, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Roma', color: '#ff0000', relation: 'self', population: 20, food: 500, gold: 5000, production: 0, culture: 0,
      yields: { food: 0, gold: 0, production: 0 }, defeated: false, nextRaid: Infinity }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: null, selectedType: null, buildMode: null,
    diplomacy: null, gameOver: false, victory: false, seed, rngState: 101,
  };
}
function founded(seed?: string) {
  const state = fixture(seed); initializeVillages(state);
  const village = state.villages![0];
  expect(village.layout).toBeDefined();
  return { state, village };
}
/** The scheduled pulse only: Rust evolution plus real host placement. */
function advance(state: GameState, until: number, each?: () => void): void {
  while (state.time < until) { state.time = Math.min(until, state.time + 1); settlementStep(state); each?.(); }
}
const owned = (state: GameState, villageId: number) => state.buildings.filter(b => b.villageId === villageId && b.hp > 0);

describe('village evolution', () => {
  it('holds stage 0 until the age and population gates, then grows on its own base income', () => {
    const { state, village } = founded();
    advance(state, 299);
    expect(villageStage(state, village)).toBe(0);
    advance(state, 1500);
    const stage = villageStage(state, village);
    expect(stage).toBeGreaterThanOrEqual(1); expect(stage).toBeLessThanOrEqual(2);
    expect(owned(state, village.id).length).toBeGreaterThan(3);
  });

  it('places buildings through the physical rules: dry, unforbidden, non-overlapping and reachable from the hub', () => {
    const { state, village } = founded();
    advance(state, 1500);
    const buildings = owned(state, village.id), cells = new Map<number, string>();
    for (const building of buildings) for (let dy = 0; dy < buildingHeight(building); dy++) for (let dx = 0; dx < buildingWidth(building); dx++) {
      const x = building.x + dx, y = building.y + dy, cell = y * state.world.width + x;
      expect(WATER.has(state.world.tiles[cell].terrain)).toBe(false);
      expect(isForbidden(state, x, y, village.faction)).toBe(false);
      // A well may share a house tile; nothing else stacks.
      const previous = cells.get(cell);
      if (previous) expect([previous, building.kind].sort().join()).toBe('house,well');
      cells.set(cell, building.kind);
    }
    expect(buildings.some(b => ['palace', 'wall', 'palisade', 'camp'].includes(b.kind))).toBe(false);
    const camp = villageCamp(state, village)!, origin = constructionEdges(state, camp, true)[0];
    for (const building of buildings.filter(b => b.kind !== 'road'))
      expect(constructionEdges(state, building, true).some(exit => hasStaticPath(state, origin, exit, village.faction, true))).toBe(true);
  });

  it('is deterministic for a seed', () => {
    const first = founded('evolution-determinism'), second = founded('evolution-determinism');
    advance(first.state, 1200); advance(second.state, 1200);
    const summary = (state: GameState) => owned(state, 1).map(b => `${b.kind}:${b.x},${b.y}:${b.houseLevel ?? 1}`).sort();
    expect(summary(first.state)).toEqual(summary(second.state));
    expect(villageTreasury(first.state, first.village)).toBe(villageTreasury(second.state, second.village));
  });

  it('never charges the treasury for sites with no usable land', () => {
    const { state, village } = founded();
    const keep = new Set(owned(state, village.id).map(b => b.y * state.world.width + b.x));
    const camp = villageCamp(state, village)!;
    for (const door of constructionEdges(state, camp, true)) keep.add(Math.floor(door.y) * state.world.width + Math.floor(door.x));
    state.world.tiles.forEach((tile, cell) => { if (!keep.has(cell)) tile.terrain = 'ocean'; });
    state.world.revision = 1;
    // Only placed buildings and recruits are charged; failed sites are refunded.
    settlementStep(state);
    const start = villageTreasury(state, village), from = state.time;
    const count = (kind: string) => kind === 'warrior' ? state.units.filter(u => u.villageId === village.id && u.kind === 'warrior').length
      : owned(state, village.id).filter(b => b.kind === kind).length;
    const guards = count('warrior');
    advance(state, 900);
    const roads = count('road'), charged = 40 * (count('warrior') - guards) + 3 * roads;
    const expected = start + SETTLEMENT_CONSTANTS.villageBaseIncome * (state.time - from) - charged;
    // At most one outstanding road run (4 cells) may still be reserved.
    expect(villageTreasury(state, village)).toBeGreaterThanOrEqual(expected - 12 - 1e-6);
    expect(villageTreasury(state, village)).toBeLessThanOrEqual(expected + 1e-6);
    expect(owned(state, village.id).filter(b => b.kind !== 'villageTent' && b.kind !== 'road')).toHaveLength(0);
  });
});
