import { describe, expect, it } from 'vitest';
import { buildStroke, constructionLine } from '../src/game/construction';
import { entityStore } from '../src/game/entity-store';
import { ensureBuilders } from '../src/game/builders';
import { ensureCollectors, synchronizeFarms } from '../src/game/farms';
import { irrigationYieldMultiplier } from '../src/game/irrigation';
import { invalidateNavigation } from '../src/game/pathfinding';
import { createLinearPurchase } from '../src/game/road-purchase';
import { advanceConstructionReconciliation } from '../src/game/simulation';
import { withSimulationReads } from '../src/game/simulation-reads';
import type { Building, GameState } from '../src/game/types';

function fixture(): GameState {
  const state: GameState = {
    world: { width: 24, height: 24, revision: 0, seed: 'linear-purchase', source: 'fixture', spawns: [], tiles: Array.from({ length: 576 }, () =>
      ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [
      { id: 1, kind: 'palace', faction: 0, x: 2, y: 10, hp: 650, maxHp: 650, capacity: 30, unhousedResidents: 10 },
      { id: 2, kind: 'camp', faction: 0, x: 9, y: 10, hp: 100, maxHp: 100, capacity: 0 },
      { id: 3, kind: 'road', faction: 0, x: 10, y: 10, hp: 100, maxHp: 100, capacity: 0 },
    ],
    units: [{ id: 4, kind: 'leader', faction: 0, x: 10.5, y: 10.5, hp: 100, morale: 100, attack: 25, defense: 5,
      speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 2000, production: 0,
      population: 10, culture: 1000, yields: { food: 0, production: 0, gold: 0 }, nextRaid: Infinity, defeated: false,
      research: { focus: 'irrigation', levels: { irrigation: 1 }, progress: {} } }],
    time: 0, tick: 0, paused: true, speed: 1, events: [], particles: [], fields: [], selected: 4, selectedType: 'unit',
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'linear-purchase', rngState: 1,
  };
  state.world.tiles[10 * 24 + 7].terrain = 'lake';
  synchronizeFarms(state); ensureCollectors(state);
  return state;
}
const line = () => constructionLine({ x: 12, y: 10 }, { x: 7, y: 10 });
const layout = (state: GameState) => ({ gold: state.factions[0].gold,
  buildings: state.buildings.map(({ id, kind, x, y }) => [id, kind, x, y]), fields: state.fields });
function add(state: GameState, kind: Building['kind'], x: number, changes: Partial<Building> = {}) {
  return entityStore(state).buildings.add({ id: 100 + x, kind, faction: 0, x, y: 10, hp: 100, maxHp: 100, capacity: 0, ...changes });
}
function drain(state: GameState): number {
  let phases = 0;
  while (advanceConstructionReconciliation(state)) if (++phases > 8) throw new Error('Cleanup did not finish');
  return phases;
}

describe('incremental irrigation purchases', () => {
  it('grows a reverse stroke from water, preserves farm/road layers and matches the synchronous purchase', () => {
    const state = fixture(), immediate = structuredClone(state), points = line();
    const expected = buildStroke(immediate, 'irrigation', points), job = createLinearPurchase(state, 'irrigation', points);
    const crops = structuredClone(state.fields), initialRemaining = job.remaining;
    expect(job.kind).toBe('irrigation'); expect(job.total).toBe(6);
    expect(Object.isFrozen(initialRemaining)).toBe(true); expect(Object.isFrozen(initialRemaining[0])).toBe(true);
    const built: number[] = [];
    while (!job.result.done) {
      const before = job.result.placed;
      expect(job.step().placed - before).toBe(1);
      built.push(state.buildings.at(-1)!.x);
    }
    expect(built).toEqual([8, 9, 10, 11, 12]);
    expect(job.remaining).toEqual([]); expect(initialRemaining).toHaveLength(6);
    expect(job.result).toMatchObject(expected);
    expect(drain(state)).toBe(2);
    expect(layout(state)).toEqual(layout(immediate)); expect(state.fields).toEqual(crops);
    expect(irrigationYieldMultiplier(state, 9, 10)).toBe(1); // Unfinished ditches give no premature bonus.
    const again = createLinearPurchase(state, 'irrigation', points);
    expect(again.step()).toMatchObject({ done: true, placed: 0, skipped: 0 });
    expect(state.factions[0].gold).toBe(2000 - 5 * 35);
  });

  it('uses pending living ditch anchors of another owner', () => {
    const state = fixture(); state.world.tiles[10 * 24 + 7].terrain = 'grassland';
    add(state, 'irrigation', 7, { faction: 9, construction: { startedAt: 0, duration: 4, waitingForBuilder: true } });
    const job = createLinearPurchase(state, 'irrigation', [{ x: 9, y: 10 }, { x: 8, y: 10 }]);
    expect(job.step()).toMatchObject({ placed: 1, done: false });
    expect(state.buildings.at(-1)!.x).toBe(8);
    expect(job.step()).toMatchObject({ placed: 2, done: true });
  });

  it('never jumps a rejected gap or charges for disconnected cells', () => {
    const state = fixture(); add(state, 'house', 10);
    const job = createLinearPurchase(state, 'irrigation', line());
    while (!job.result.done) job.step();
    expect(job.result).toMatchObject({ placed: 2, skipped: 3 });
    expect(state.buildings.filter(b => b.kind === 'irrigation').map(b => b.x)).toEqual([8, 9]);
    expect(state.factions[0].gold).toBe(1930);
  });

  it('rechecks treasury, leader range and removed anchors between cells', () => {
    for (const change of ['treasury', 'range', 'anchor'] as const) {
      const state = fixture(), job = createLinearPurchase(state, 'irrigation', [{ x: 8, y: 10 }, { x: 9, y: 10 }]);
      expect(job.step()).toMatchObject({ placed: 1 });
      if (change === 'treasury') state.factions[0].gold = 0;
      if (change === 'range') state.units[0].x = 23.5;
      if (change === 'anchor') state.buildings.at(-1)!.hp = 0;
      const gold = state.factions[0].gold;
      expect(job.step()).toMatchObject({ done: true, placed: 1, skipped: 1 });
      expect(state.factions[0].gold).toBe(gold);
    }
  });

  it('discovers a new external anchor and preserves stable gesture priority', () => {
    const state = fixture(), job = createLinearPurchase(state, 'irrigation', line());
    expect(job.step()).toMatchObject({ placed: 1 });
    state.buildings.at(-1)!.hp = 0; invalidateNavigation(state);
    add(state, 'irrigation', 13, { faction: 9 });
    expect(job.step()).toMatchObject({ placed: 2 });
    expect(state.buildings.at(-1)!.x).toBe(12);
  });

  it('cancels the remainder without refunding accepted cells and finishes cleanup while paused', () => {
    const state = fixture();
    withSimulationReads(state, () => { ensureBuilders(state); synchronizeFarms(state); ensureCollectors(state); });
    entityStore(state).units.retain(unit => !unit.builder);
    const job = createLinearPurchase(state, 'irrigation', line());
    expect(job.step()).toMatchObject({ placed: 1 });
    expect(state.units.some(unit => unit.builder)).toBe(false);
    expect(job.finish()).toMatchObject({ done: true, placed: 1, skipped: 4 });
    expect(job.remaining).toEqual([]); expect(job.step()).toEqual(job.result);
    expect(drain(state)).toBe(2);
    expect(state.units.some(unit => unit.builder)).toBe(true);
    expect(state.factions[0].gold).toBe(1965); expect(state.time).toBe(0); expect(state.paused).toBe(true);
  });

  it.each(['tiles', 'dimensions', 'faction', 'leader'] as const)('abandons unpurchased irrigation after %s changes', change => {
    const state = fixture(), job = createLinearPurchase(state, 'irrigation', line());
    expect(job.step()).toMatchObject({ placed: 1 });
    if (change === 'tiles') state.world.tiles = [...state.world.tiles];
    if (change === 'dimensions') state.world.width++;
    if (change === 'faction') state.playerFaction = 9;
    if (change === 'leader') state.units[0].hp = 0;
    expect(job.step()).toMatchObject({ done: true, placed: 1, skipped: 4 });
    expect(state.factions[0].gold).toBe(1965);
  });
});
