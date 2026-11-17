import { describe, expect, it, vi } from 'vitest';
import { territory, type Territory } from '../src/game/borders';
import { entityStore } from '../src/game/entity-store';
import * as sight from '../src/game/territory-sight';
import { markWorldChanged } from '../src/game/world-revisions';
import type { Building, GameState } from '../src/game/types';

const building = (id: number, kind: Building['kind'], faction: number, x: number, y: number): Building =>
  ({ id, kind, faction, x, y, hp: 100, maxHp: 100, capacity: 4 });
function fixture(): GameState {
  return { world: { width: 80, height: 40, revision: 0, seed: 'claim-footprints', source: 'test', spawns: [],
    tiles: Array.from({ length: 3200 }, (_, cell) => ({ terrain: 'grassland',
      overlay: cell % 80 === 9 || cell % 80 === 61 ? 'forest' : 'none',
      elevation: .4, moisture: .5, food: 2, production: 1, gold: 0, variation: .3 })) },
    units: [], buildings: [building(1, 'palace', 0, 8, 8), building(2, 'house', 0, 12, 8),
      building(3, 'palace', 1, 60, 20), building(4, 'house', 1, 56, 20)],
    factions: [0, 1].map(id => ({ id, name: `Faction ${id}`, color: '#f00', affinity: 0, relation: id ? 'war' : 'self',
      food: 50, gold: 50, production: 0, population: 10, culture: 0,
      yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1000, defeated: false })),
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'claim-footprints', rngState: 1 };
}
const publicView = (view: Territory) => ({ owners: view.owners, sources: view.sourceIds, alternateOwners: view.alternateOwners,
  alternateSources: view.alternateSourceIds, radii: [...view.sourceRadii], edges: view.edges, paths: view.paths });
const expectFresh = (state: GameState) => expect(publicView(territory(state))).toEqual(publicView(territory(structuredClone(state))));

describe('independent territory footprints', () => {
  it('reuses old woodland rays when adding a new source and preserves exact ownership', () => {
    const state = fixture(); territory(state);
    const rays = vi.spyOn(sight, 'territorySightCosts');
    try {
      entityStore(state).buildings.add(building(5, 'house', 0, 35, 34));
      territory(state);
      expect(rays).not.toHaveBeenCalled();
      expectFresh(state);
    } finally { rays.mockRestore(); }
  });

  it('recomputes only the affected sight bounds after a located cover edit', () => {
    const state = fixture(); territory(state);
    const rays = vi.spyOn(sight, 'territorySightCosts');
    try {
      state.world.tiles[8 * 80 + 9].overlay = 'none';
      markWorldChanged(state.world, 'sight', [8 * 80 + 9]);
      territory(state);
      expect(rays).toHaveBeenCalled();
      expect(rays.mock.calls.every(call => call[1].x < 30)).toBe(true);
      expectFresh(state);
    } finally { rays.mockRestore(); }
  });

  it('retains distant footprint identities after cosmetic edits followed by a local sight edit', () => {
    const state = fixture();
    const before = territory(state) as Territory & { footprints: ReadonlyMap<number, unknown> };
    const rays = vi.spyOn(sight, 'territorySightCosts');
    try {
      // Harvests can overflow the general journal while no ownership read is
      // needed. They do not make a later tree clearing affect every settlement.
      for (let i = 0; i < 1100; i++) markWorldChanged(state.world, 'appearance', [20 * 80 + 61]);
      state.world.tiles[8 * 80 + 9].overlay = 'none';
      markWorldChanged(state.world, 'sight', [8 * 80 + 9]);
      const after = territory(state) as typeof before;
      expect(after.footprints.get(1)).not.toBe(before.footprints.get(1));
      expect(after.footprints.get(3)).toBe(before.footprints.get(3));
      expect(after.footprints.get(4)).toBe(before.footprints.get(4));
      expect(rays).toHaveBeenCalled();
      expect(rays.mock.calls.every(call => call[1].x < 30)).toBe(true);
      expectFresh(state);
    } finally { rays.mockRestore(); }
  });

  it('matches fresh fields across source ownership, position, radius, terrain, removal and unknown edits', () => {
    const state = fixture(); territory(state);
    state.buildings[1].faction = 1; expectFresh(state);
    state.buildings[1].x += 3; expectFresh(state);
    state.factions[0].culture = 300; expectFresh(state);
    entityStore(state).buildings.add(building(5, 'fort', 0, 20, 10)); expectFresh(state);
    entityStore(state).buildings.retain(source => source.id !== 2); expectFresh(state);
    state.world.tiles[34 * 80 + 35].overlay = 'forest';
    markWorldChanged(state.world, 'sight', [34 * 80 + 35]); expectFresh(state);
    state.world.tiles[20 * 80 + 62].terrain = 'lake';
    markWorldChanged(state.world, 'geometry', [20 * 80 + 62]); expectFresh(state);
    state.world.tiles[20 * 80 + 61].overlay = 'jungle'; state.world.revision!++; expectFresh(state);
    state.world.tiles[20 * 80 + 60].overlay = 'jungle';
    markWorldChanged(state.world, 'sight', []); expectFresh(state);
    state.world.tiles = state.world.tiles.map(tile => ({ ...tile })); expectFresh(state);
  });
});
