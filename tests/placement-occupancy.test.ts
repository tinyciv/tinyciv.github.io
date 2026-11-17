import { describe, expect, it } from 'vitest';
import { dockBerthOccupiedByFootprint } from '../src/game/dock';
import { entityStore, resetEntities } from '../src/game/entity-store';
import { invalidateNavigation } from '../src/game/pathfinding';
import { placementOccupancy } from '../src/game/placement-occupancy';
import { withSimulationReads } from '../src/game/simulation-reads';
import { buildingHeight, buildingWidth, type Building } from '../src/game/types';
import { markWorldChanged } from '../src/game/world-revisions';
import { denseConstructionFixture } from './helpers/construction-preview';

const structure = (id: number, kind: Building['kind'], x: number, y: number): Building =>
  ({ id, kind, x, y, faction: 0, hp: 100, maxHp: 100, capacity: 0 });

function fixture() {
  const state = denseConstructionFixture();
  entityStore(state).buildings.retain(() => false);
  return state;
}

describe('placement occupancy', () => {
  it('preserves the exhaustive query order, overlap layers, fractional and off-map footprints', () => {
    const state = fixture();
    const extras = [structure(900001, 'wall', 5, 5), structure(900002, 'road', 5, 5),
      structure(900003, 'woodenTower', 5, 5), structure(900004, 'library', 6.5, 7.5),
      structure(900005, 'palace', -1, -1), structure(900006, 'dock', 9, 9),
      { ...structure(900007, 'fort', 11.5, 11.5), hp: 0, fort: { destroyed: true } } as Building];
    entityStore(state).buildings.add(...extras);
    withSimulationReads(state, () => {
      const query = placementOccupancy(state);
      for (let y = -2; y < 16; y += .5) for (let x = -2; x < 16; x += .5) {
        expect(query.at(x, y)).toEqual(state.buildings.filter(building => x >= building.x && y >= building.y
          && x < building.x + buildingWidth(building) && y < building.y + buildingHeight(building)));
        expect(query.berthBlocked(x, y, 2, 1)).toBe(dockBerthOccupiedByFootprint(state, x, y, 2, 1));
        expect(query.permanentFortOverlaps(x, y, 2, 1)).toBe(state.buildings.some(fort => fort.kind === 'fort'
          && fort.fort?.destroyed && x < fort.x + 2 && x + 2 > fort.x && y < fort.y + 2 && y + 1 > fort.y));
      }
      expect(query.at(5, 5).map(building => building.kind)).toEqual(['wall', 'road', 'woodenTower']);
    });
  });

  it('reuses unchanged views and refreshes same-step additions, removals, relocation and imports', () => {
    const state = fixture(), store = entityStore(state);
    const building = store.buildings.add(structure(900001, 'house', 5, 5));
    withSimulationReads(state, () => {
      const first = placementOccupancy(state);
      expect(first.at(5, 5)).toEqual([building]);
      expect(placementOccupancy(state)).toBe(first);
      markWorldChanged(state.world, 'appearance');
      expect(placementOccupancy(state)).toBe(first);
      const road = store.buildings.add(structure(900002, 'road', 5, 5));
      expect(placementOccupancy(state).at(5, 5)).toEqual([building, road]);
      building.x = 6; invalidateNavigation(state);
      expect(placementOccupancy(state).at(5, 5)).toEqual([road]);
      expect(placementOccupancy(state).at(6, 5)).toEqual([building]);
      store.buildings.retain(value => value !== road);
      expect(placementOccupancy(state).at(5, 5)).toEqual([]);
      building.x = 7; markWorldChanged(state.world, 'structure');
      expect(placementOccupancy(state).at(7, 5)).toEqual([building]);
      building.x = 8; resetEntities(state);
      expect(placementOccupancy(state).at(8, 5)).toEqual([building]);
    });
  });

  it('keeps direct editor queries live even after untracked scalar and array edits', () => {
    const state = fixture(), building = structure(900001, 'dock', 5, 5);
    entityStore(state).buildings.add(building);
    const query = placementOccupancy(state);
    expect(query.at(5, 5)).toEqual([building]);
    building.x = 6; building.dockFacing = 1;
    expect(query.at(5, 5)).toEqual([]);
    expect(query.at(6, 5)).toEqual([building]);
    expect(query.berthBlocked(7, 5, 1, 1)).toBe(true);
    building.hp = 0;
    expect(query.berthBlocked(7, 5, 1, 1)).toBe(false);
    (state as unknown as { buildings: Building[] }).buildings = [];
    expect(query.at(6, 5)).toEqual([]);
  });
});
