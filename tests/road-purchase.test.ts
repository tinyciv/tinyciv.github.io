import { describe, expect, it } from 'vitest';
import { buildStroke, constructionLine } from '../src/game/construction';
import { createRoadPurchase } from '../src/game/road-purchase';
import { advanceConstructionReconciliation } from '../src/game/simulation';
import { entityStore } from '../src/game/entity-store';
import { ensureBuilders } from '../src/game/builders';
import { ensureCollectors, synchronizeFarms } from '../src/game/farms';
import { withSimulationReads } from '../src/game/simulation-reads';
import { denseConstructionFixture } from './helpers/construction-preview';
import type { GameState } from '../src/game/types';

function drain(state: GameState): number {
  let phases = 0;
  while (advanceConstructionReconciliation(state)) {
    if (++phases > 12) throw new Error('Construction reconciliation did not drain');
  }
  return phases;
}
const layout = (state: GameState) => ({
  gold: state.factions[0].gold,
  buildings: state.buildings.map(building => [building.id, building.kind, building.x, building.y]),
  fields: state.fields!.map(field => [field.camp, field.x, field.y]),
});

describe('incremental road purchases', () => {
  it('starts a new road one tile at a time and matches an immediate stroke', () => {
    const state = denseConstructionFixture(), immediate = structuredClone(state);
    // Draw from clear ground toward the existing road.
    const points = constructionLine({ x: 87, y: 69 }, { x: 83, y: 69 });
    const expected = buildStroke(immediate, 'road', points), job = createRoadPurchase(state, points);
    let steps = 0;
    while (!job.result.done) {
      const before = job.result.placed;
      expect(job.step().placed - before).toBeLessThanOrEqual(1);
      if (++steps > points.length) throw new Error('Road job did not complete');
    }
    expect(job.result).toMatchObject(expected);
    expect(steps).toBe(4);
    expect(drain(state)).toBe(3);
    drain(immediate);
    expect(layout(state)).toEqual(layout(immediate));
    const after = layout(state);
    expect(job.step().done).toBe(true); expect(layout(state)).toEqual(after);
  });

  it('finishes staffing and crop maintenance while paused after a warmed clock', () => {
    const state = denseConstructionFixture();
    withSimulationReads(state, () => { synchronizeFarms(state); ensureCollectors(state); ensureBuilders(state); });
    entityStore(state).units.retain(unit => !unit.builder);
    const time = state.time, gold = state.factions[0].gold;
    const job = createRoadPurchase(state, [{ x: 83, y: 69 }, { x: 84, y: 69 }]);
    expect(job.step()).toMatchObject({ done: true, placed: 1, skipped: 0 });
    expect(state.units.some(unit => unit.builder)).toBe(false);
    expect(drain(state)).toBe(3);
    expect(state.units.some(unit => unit.builder)).toBe(true);
    expect(state.factions[0].gold).toBe(gold - 10);
    expect(state.fields!.some(field => field.x === 84 && field.y === 69)).toBe(false);
    expect(state.time).toBe(time); expect(state.paused).toBe(true);
  });

  it('reserves the full road against crop relocation and never seeds a disconnected remainder', () => {
    const state = denseConstructionFixture(), field = { ...state.fields![0], camp: 10, x: 2, y: 2, id: 14 };
    state.world = { ...state.world, width: 6, height: 5, tiles: Array.from({ length: 30 }, () =>
      ({ terrain: 'lake', overlay: 'none', elevation: .3, moisture: .5, food: 2, production: 0, gold: 0, variation: .5 })) };
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1], [1, 2], [2, 2], [3, 2]]) state.world.tiles[y * 6 + x].terrain = 'grassland';
    state.world.tiles[14].farm = 0;
    entityStore(state).units.replace([{ ...state.units[0], x: 1.5, y: 2.5 }]);
    entityStore(state).buildings.replace([
      { ...state.buildings[0], x: 0, y: 0 },
      { id: 10, kind: 'camp', faction: 0, x: 2, y: 2, hp: 100, maxHp: 100, capacity: 0 },
      { id: 11, kind: 'road', faction: 0, x: 1, y: 2, hp: 100, maxHp: 100, capacity: 0 },
    ]);
    state.fields = [field];
    const gold = state.factions[0].gold, job = createRoadPurchase(state, constructionLine({ x: 1, y: 2 }, { x: 3, y: 2 }));
    expect(job.step()).toMatchObject({ done: false, placed: 0, skipped: 1 });
    expect(job.step()).toMatchObject({ done: true, ok: false, placed: 0, skipped: 2 });
    expect(state.factions[0].gold).toBe(gold);
    expect(state.buildings.find(building => building.id === 10)).toMatchObject({ x: 2, y: 2 });
    expect(state.fields[0]).toMatchObject({ x: 2, y: 2 });
    expect(state.buildings.filter(building => building.kind === 'road')).toHaveLength(1);
  });

  it('rechecks live affordability between cells', () => {
    const state = denseConstructionFixture(), job = createRoadPurchase(state, constructionLine({ x: 83, y: 69 }, { x: 85, y: 69 }));
    expect(job.step()).toMatchObject({ done: false, placed: 1 });
    state.factions[0].gold = 0;
    expect(job.step()).toMatchObject({ done: true, placed: 1, skipped: 1 });
    expect(state.factions[0].gold).toBe(0);
    expect(state.buildings.some(building => building.kind === 'road' && building.x === 85 && building.y === 69)).toBe(false);
  });

  it.each(['state', 'world', 'leader'] as const)('abandons unpurchased cells after %s replacement', change => {
    const state = denseConstructionFixture(), job = createRoadPurchase(state, constructionLine({ x: 83, y: 69 }, { x: 85, y: 69 }));
    expect(job.step()).toMatchObject({ done: false, placed: 1 });
    const gold = state.factions[0].gold;
    if (change === 'world') state.world = { ...state.world };
    if (change === 'leader') state.units[0].hp = 0;
    expect(job.step(change === 'state' ? structuredClone(state) : state)).toMatchObject({ done: true, placed: 1, skipped: 1 });
    expect(state.factions[0].gold).toBe(gold);
  });
});
