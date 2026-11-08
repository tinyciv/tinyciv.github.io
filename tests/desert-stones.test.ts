import { expect, it } from 'vitest';
import { scatterDesertStones } from '../src/world/desert-stones';
import { clearDesertStones } from '../src/game/desert-stones';
import { entityStore } from '../src/game/entity-store';
import { worldChangesSince } from '../src/game/world-revisions';
import { scenario } from '../dev/navigation-lab/scenarios';
import type { World, Building } from '../src/game/types';

const world = (): World => ({ width: 60, height: 40, seed: 'ochre', source: 'test', spawns: [],
  tiles: Array.from({ length: 2400 }, (_, i) => ({ terrain: i % 60 < 30 ? 'desert' : 'grassland', overlay: 'none',
    elevation: .5, moisture: .1, food: 1, production: 1, gold: 0, variation: (i % 17) / 17 })) });
it('scatters deterministic, sparse desert-only decoration without changing gameplay fields', () => {
  const a = world(), before = structuredClone(a), b = world();
  scatterDesertStones(a); scatterDesertStones(b); expect(a).toEqual(b);
  const placed = a.tiles.filter(t => t.desertStone !== undefined);
  expect(placed.length).toBeGreaterThan(40); expect(placed.length).toBeLessThan(110);
  expect(placed.every(t => t.terrain === 'desert' && t.desertStone! < 24)).toBe(true);
  for (const tile of a.tiles) delete tile.desertStone;
  expect(a).toEqual(before);
});
it('avoids resources, roads, water features and ledges', () => {
  const a = world();
  for (const t of a.tiles) t.resource = 'copper';
  scatterDesertStones(a); expect(a.tiles.some(t => t.desertStone !== undefined)).toBe(false);
});
it('clears the whole building footprint permanently, including roads and farms', () => {
  for (const kind of ['palace', 'road', 'farm', 'irrigation'] as const) {
    const a = world(); for (const t of a.tiles) t.desertStone = 0;
    const b = { kind, x: 5, y: 5 } as Building;
    clearDesertStones(a, b);
    expect(a.tiles[5 * 60 + 5].desertStone).toBeUndefined();
    expect(a.tiles[0].desertStone).toBe(0);
    if (kind === 'palace') expect(a.tiles[6 * 60 + 6].desertStone).toBeUndefined();
  }
});
it('clears when structures are actually registered, not just in rendering', () => {
  const state = scenario('Open melee');
  state.world.tiles[5 * state.world.width + 5].desertStone = 2;
  const building = { id: 99999, kind: 'road', x: 5, y: 5, faction: 0, hp: 100, maxHp: 100 } as Building;
  entityStore(state).buildings.add(building);
  expect(state.world.tiles[5 * state.world.width + 5].desertStone).toBeUndefined();
  entityStore(state).buildings.retain(b => b !== building);
  expect(state.world.tiles[5 * state.world.width + 5].desertStone).toBeUndefined();
});
it('replicates decoration removal even when the terrain revision stays unchanged', () => {
  const a = world(); a.revision = 0;
  a.tiles[5 * a.width + 5].desertStone = 2;
  const cursor = worldChangesSince(a).revision;
  clearDesertStones(a, { kind: 'road', x: 5, y: 5 } as Building);
  expect(a.revision).toBe(0);
  expect(worldChangesSince(a, cursor)).toMatchObject({ full: false, cells: [5 * a.width + 5] });
});
