import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { createIrrigationConnectionQuery, irrigationConnects } from '../src/game/irrigation';
import { recordStructureChange, withSimulationReads } from '../src/game/simulation-reads';
import type { Building, GameState } from '../src/game/types';

function fixture(): GameState {
  return { world: { width: 16, height: 16, tiles: Array.from({ length: 256 }, () => ({ terrain: 'grassland' })) },
    buildings: [], units: [] } as unknown as GameState;
}
const ditch = (id: number, x: number, y: number): Building => ({ id, kind: 'irrigation', x, y, faction: 9, hp: 100, maxHp: 100, capacity: 0 });

describe('indexed irrigation connectivity', () => {
  it('combines live water, any-owner pending ditches and accepted reservations without mutating the source', () => {
    const state = fixture(), anchor = ditch(1, 5, 5);
    anchor.construction = { startedAt: 0, duration: 4, waitingForBuilder: true };
    entityStore(state).buildings.add(anchor);
    const connects = createIrrigationConnectionQuery(state), reserved = new Set([5 * 16 + 6]);
    expect(connects(6, 5)).toBe(true); expect(connects(7, 5)).toBe(false); expect(connects(7, 5, reserved)).toBe(true);
    expect(state.buildings).toHaveLength(1);
    anchor.hp = 0; expect(connects(6, 5)).toBe(false);
    state.world.tiles[4 * 16 + 6].terrain = 'lake'; expect(connects(6, 5)).toBe(true);
    state.world.tiles[4 * 16 + 6].terrain = 'ocean'; expect(connects(6, 5)).toBe(false);
    expect(connects(15, 4, new Set([5 * 16]))).toBe(false); // No wrapping past the right edge.
  });

  it('shares a trusted index, while additions, moves, removals and standalone scalar edits stay live', () => {
    const state = fixture(), anchor = ditch(1, 5, 5);
    entityStore(state).buildings.add(anchor);
    withSimulationReads(state, () => {
      expect(irrigationConnects(state, 6, 5)).toBe(true);
      anchor.x = 10; recordStructureChange(state);
      expect(irrigationConnects(state, 6, 5)).toBe(false); expect(irrigationConnects(state, 9, 5)).toBe(true);
      entityStore(state).buildings.add(ditch(2, 5, 5)); expect(irrigationConnects(state, 6, 5)).toBe(true);
      entityStore(state).buildings.retain(building => building.id !== 2); expect(irrigationConnects(state, 6, 5)).toBe(false);
    });
    anchor.x = 5;
    expect(irrigationConnects(state, 6, 5)).toBe(true);
  });

  it('does not rescan unrelated buildings for repeated indexed probes', () => {
    const state = fixture(), unrelated = { ...ditch(1, 1, 1), kind: 'road' as const };
    entityStore(state).buildings.add(unrelated, ditch(2, 5, 5));
    let reads = 0;
    Object.defineProperty(unrelated, 'kind', { get: () => { reads++; return 'road'; } });
    withSimulationReads(state, () => {
      expect(irrigationConnects(state, 6, 5)).toBe(true);
      const initialReads = reads;
      for (let i = 0; i < 100; i++) expect(irrigationConnects(state, 6, 5)).toBe(true);
      expect(reads).toBe(initialReads);
    });
  });
});
