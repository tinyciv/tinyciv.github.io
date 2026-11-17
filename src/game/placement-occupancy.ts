import { dockBerth } from './dock';
import { entityStore, type EntityStore } from './entity-store';
import { simulationReadsActive, structureChangeRevision } from './simulation-reads';
import { buildingHeight, buildingWidth, type Building, type GameState } from './types';
import { worldStructureRevision } from './world-revisions';

export interface PlacementOccupancy {
  at(x: number, y: number): readonly Building[];
  berthBlocked(x: number, y: number, width: number, height: number): boolean;
  permanentFortOverlaps(x: number, y: number, width: number, height: number): boolean;
}
interface CachedOccupancy {
  world: GameState['world']; buildings: GameState['buildings']; store: EntityStore;
  entities: number; structures: number; geometry: number; query: PlacementOccupancy;
}
const caches = new WeakMap<GameState, CachedOccupancy>();
const EMPTY: readonly Building[] = Object.freeze([]);
const contains = (building: Building, x: number, y: number): boolean => x >= building.x && y >= building.y
  && x < building.x + buildingWidth(building) && y < building.y + buildingHeight(building);

/** Keep all layers and dead structures: callers decide which overlaps are
 * permitted, and destroyed Fort foundations remain reserved. Runtime mutation
 * revisions make repeated placement probes local; standalone queries stay live. */
export function placementOccupancy(state: GameState): PlacementOccupancy {
  if (!simulationReadsActive(state)) return {
    at: (x, y) => state.buildings.filter(building => contains(building, x, y)),
    berthBlocked: (x, y, width, height) => berthBlocked(state.buildings, x, y, width, height),
    permanentFortOverlaps: (x, y, width, height) => fortOverlaps(state.buildings, x, y, width, height),
  };
  const store = entityStore(state), entities = store.buildings.revision;
  const structures = structureChangeRevision(state), geometry = worldStructureRevision(state.world);
  const cached = caches.get(state);
  if (cached && cached.world === state.world && cached.buildings === state.buildings && cached.store === store
    && cached.entities === entities && cached.structures === structures && cached.geometry === geometry) return cached.query;
  const cells = new Map<number, Building[]>(), docks: Building[] = [], forts: Building[] = [];
  const { width, height } = state.world;
  for (const building of state.buildings) {
    if (building.kind === 'dock') docks.push(building);
    if (building.kind === 'fort') forts.push(building);
    // Integer placement anchors use the same half-open bounds as contains().
    const endX = Math.min(width, building.x + buildingWidth(building));
    const endY = Math.min(height, building.y + buildingHeight(building));
    for (let y = Math.max(0, Math.ceil(building.y)); y < endY; y++)
      for (let x = Math.max(0, Math.ceil(building.x)); x < endX; x++) {
        const key = y * width + x, occupants = cells.get(key);
        if (occupants) occupants.push(building); else cells.set(key, [building]);
      }
  }
  const query: PlacementOccupancy = {
    at: (x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height
      ? cells.get(y * width + x) ?? EMPTY : state.buildings.filter(building => contains(building, x, y)),
    berthBlocked: (x, y, w, h) => berthBlocked(docks, x, y, w, h),
    permanentFortOverlaps: (x, y, w, h) => fortOverlaps(forts, x, y, w, h),
  };
  caches.set(state, { world: state.world, buildings: state.buildings, store, entities, structures, geometry, query });
  return query;
}

function berthBlocked(buildings: readonly Building[], x: number, y: number, width: number, height: number): boolean {
  return buildings.some(building => {
    if (building.kind !== 'dock' || building.hp <= 0) return false;
    const berth = dockBerth(building);
    return berth.x >= x && berth.y >= y && berth.x < x + width && berth.y < y + height;
  });
}

function fortOverlaps(buildings: readonly Building[], x: number, y: number, width: number, height: number): boolean {
  return buildings.some(fort => fort.kind === 'fort' && fort.fort?.destroyed
    && x < fort.x + buildingWidth(fort) && x + width > fort.x && y < fort.y + buildingHeight(fort) && y + height > fort.y);
}
