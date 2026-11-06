import { entityStore, type EntityStore } from './entity-store';
import { buildingHeight, buildingReady, buildingWidth, type Building, type GameState, type Point } from './types';

interface PalaceSnapshot {
  palace: Building; id: number; faction: number; x: number; y: number; ready: boolean;
}
interface Membership {
  generation: number; x: number; y: number; faction: number; kind: Building['kind']; palace?: Building;
}
export interface CityOwnership {
  readonly palaces: readonly Building[];
  nearest(point: Point, faction: number): Building | undefined;
  building(building: Building): Building | undefined;
}
interface OwnershipCache {
  world: GameState['world']; store: EntityStore; source: readonly Building[];
  snapshots: PalaceSnapshot[]; generation: number; byFaction: Map<number, Building[]>;
  memberships: WeakMap<Building, Membership>; query: CityOwnership;
  rebuilds: number; hits: number; misses: number;
}
const caches = new WeakMap<GameState, OwnershipCache>();

/** Only palace geometry/ownership affects nearest-city membership. Validate
 * that small maintained group so same-step captures, deaths and completions
 * are visible without rescanning all buildings for every ownership lookup. */
export function cityOwnership(state: GameState): CityOwnership {
  const store = entityStore(state), source = store.buildings.query('palace');
  let cache = caches.get(state);
  if (!cache || cache.world !== state.world || cache.store !== store) {
    cache = { world: state.world, store, source: [], snapshots: [], generation: 0,
      byFaction: new Map(), memberships: new WeakMap(), query: undefined!, rebuilds: 0, hits: 0, misses: 0 };
    const current = cache;
    const nearest = (point: Point, faction: number): Building | undefined => {
      let best: Building | undefined, distance = Infinity;
      for (const palace of current.byFaction.get(faction) ?? []) {
        const candidate = (point.x - palace.x - 1) ** 2 + (point.y - palace.y - 1) ** 2;
        if (candidate < distance || candidate === distance && palace.id < best!.id) { best = palace; distance = candidate; }
      }
      return best;
    };
    current.query = {
      get palaces() { return current.source; },
      nearest,
      building(building) {
        const old = current.memberships.get(building);
        if (old && old.generation === current.generation && old.x === building.x && old.y === building.y
          && old.faction === building.faction && old.kind === building.kind) { current.hits++; return old.palace; }
        const palace = nearest({ x: building.x + buildingWidth(building) / 2,
          y: building.y + buildingHeight(building) / 2 }, building.faction);
        current.memberships.set(building, { generation: current.generation, x: building.x, y: building.y,
          faction: building.faction, kind: building.kind, palace });
        current.misses++;
        return palace;
      },
    };
    caches.set(state, current);
  }
  if (cache.source !== source || source.some((palace, index) => {
    const old = cache!.snapshots[index];
    return !old || old.palace !== palace || old.id !== palace.id || old.faction !== palace.faction
      || old.x !== palace.x || old.y !== palace.y || old.ready !== buildingReady(palace);
  })) {
    cache.source = source;
    cache.snapshots = source.map(palace => ({ palace, id: palace.id, faction: palace.faction,
      x: palace.x, y: palace.y, ready: buildingReady(palace) }));
    cache.byFaction.clear();
    for (const palace of source) if (buildingReady(palace)) {
      const group = cache.byFaction.get(palace.faction) ?? [];
      group.push(palace); cache.byFaction.set(palace.faction, group);
    }
    cache.generation++; cache.rebuilds++;
  }
  return cache.query;
}

export function cityOwnershipStats(state: GameState): { rebuilds: number; hits: number; misses: number } {
  const cache = caches.get(state);
  return { rebuilds: cache?.rebuilds ?? 0, hits: cache?.hits ?? 0, misses: cache?.misses ?? 0 };
}
