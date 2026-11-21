import { rustEngine } from './rust-engine';
import { SimSlot, simCore } from './sim-handle';
import { entityStore, BUILDING_KIND_CODES, type EntityObserver, type EntityStore } from './entity-store';
import { observeScalars, type ScalarObserver } from './scalar-observer';
import { buildingPresent, type Building, type BuildingKind, type GameState } from './types';

/** Host bridge to the resident Rust building index (rust/src/sim/structures.rs),
 * a resource over the building entities of the game's simulation World.
 *
 * Encoding and change publication only: which buildings are refuges, shelter,
 * arcing walls, solid footprints or a palace's defenses is decided in Rust.
 * A building is republished when the entity store adds, removes or reclassifies
 * it or when one of its indexed scalars changes, including the construction
 * flags that control whether the footprint is present. */

/** Row flags: hp > 0, buildingPresent and buildingReady. */
export const STRUCTURE_ALIVE = 1, STRUCTURE_PRESENT = 2, STRUCTURE_READY = 4;
export const FOUNTAIN_RADIUS = rustEngine.fountain_radius();
const CLASS_REFUGE = 0, CLASS_SHELTER = 1, CLASS_READY_PALACE = 2;
const OBSERVED = ['faction', 'hp', 'kind', 'x', 'y', 'roadPaved', 'construction'] as const;
const CONSTRUCTION_PRESENCE = ['waitingForBuilder', 'pausedAt', 'evacuating'] as const;

type Construction = NonNullable<Building['construction']>;
interface Row { faction: number; x: number; y: number; kind: number; flags: number; construction?: Construction }
const same = (a: number, b: number): boolean => a === b || Number.isNaN(a) && Number.isNaN(b);

export class StructureIndex implements ScalarObserver {
  private readonly handle: number;
  private store?: EntityStore;
  private collection?: EntityStore['buildings'];
  private entityObserver?: EntityObserver<Building>;
  private readonly rows = new Map<Building, Row>();
  private readonly dirty = new Set<Building>();
  private constructionOwners = new WeakMap<Construction, Set<Building>>();
  private readonly queries = new Map<string, { revision: number; buildings: readonly Building[] }>();
  private defenseRevision = -1;
  private readonly defenseLists = new Map<number, readonly Building[]>();
  /** Bumped whenever a row actually changes in the native index. */
  revision = 0;
  /** Bumped only when membership, position or kind changes (not health,
   * ownership or construction progress), for footprint-derived caches. */
  geometry = 0;

  constructor(private readonly state: GameState) {
    this.handle = simCore(state).handle;
  }

  changed(target: object, key: string, previous: unknown, value: unknown): void {
    if (key === 'hp' && (Number(previous) > 0) === (Number(value) > 0)) return;
    const owners = this.constructionOwners.get(target as Construction);
    if (owners) for (const building of owners) this.dirty.add(building);
    else if (this.rows.has(target as Building)) this.dirty.add(target as Building);
  }

  private bind(store: EntityStore): void {
    // Resolve the collection first: creating it may import the state into the
    // native tables, which also empties the native index.
    const collection = store.buildings;
    rustEngine.sim_structures_clear(this.handle, this.state.world.width);
    this.rows.clear(); this.dirty.clear(); this.queries.clear(); this.revision++; this.geometry++;
    this.constructionOwners = new WeakMap();
    this.store = store; this.collection = collection;
    this.entityObserver = {
      added: building => { if (this.collection === collection) this.track(building); },
      removed: building => {
        if (this.collection !== collection) return;
        const row = this.rows.get(building);
        if (!row) return;
        if (row.construction) this.constructionOwners.get(row.construction)?.delete(building);
        this.rows.delete(building);
        // Rust dropped the row together with the building entity.
        this.dirty.delete(building); this.revision++; this.geometry++;
      },
      changed: building => { if (this.collection === collection) this.dirty.add(building); },
    };
    collection.observe(this.entityObserver);
    for (const building of this.state.buildings) if (collection.get(building.id) === building) this.track(building);
  }
  private track(building: Building): void {
    observeScalars(building, OBSERVED, this);
    this.publish(building);
  }
  private publish(building: Building): void {
    const faction = building.faction ?? NaN, kind = BUILDING_KIND_CODES[building.kind] ?? 255;
    const construction = building.construction, row = this.rows.get(building);
    if (row?.construction !== construction) {
      if (row?.construction) this.constructionOwners.get(row.construction)?.delete(building);
      if (construction) {
        let owners = this.constructionOwners.get(construction);
        if (!owners) this.constructionOwners.set(construction, owners = new Set());
        owners.add(building);
        observeScalars(construction, CONSTRUCTION_PRESENCE, this);
      }
      if (row) row.construction = construction;
    }
    const flags = (building.hp > 0 ? STRUCTURE_ALIVE : 0) | (buildingPresent(building) ? STRUCTURE_PRESENT : 0)
      | (building.hp > 0 && !construction ? STRUCTURE_READY : 0) | (building.roadPaved ? 8 : 0);
    if (row) {
      if (same(row.faction, faction) && row.x === building.x && row.y === building.y && row.kind === kind && row.flags === flags) return;
      if (row.x !== building.x || row.y !== building.y || row.kind !== kind) this.geometry++;
      row.faction = faction; row.x = building.x; row.y = building.y; row.kind = kind; row.flags = flags;
    } else { this.rows.set(building, { faction, x: building.x, y: building.y, kind, flags, construction }); this.geometry++; }
    rustEngine.sim_structure_upsert(this.handle, building.id, faction, building.x, building.y, kind, flags);
    this.revision++;
  }
  /** Bring the native rows up to date; a no-op when nothing changed. */
  flush(): this {
    const store = entityStore(this.state);
    if (store !== this.store || store.buildings !== this.collection || this.rows.size !== this.state.buildings.length) this.bind(store);
    if (this.dirty.size) {
      for (const building of this.dirty) if (this.rows.has(building)) this.publish(building);
      this.dirty.clear();
    }
    return this;
  }

  /** Native row journal shared by independent derived navigation caches. */
  changesSince(since?: number): { revision: number; full: boolean; ids: readonly number[] } {
    const pointer = rustEngine.sim_structure_changes(this.handle, since ?? NaN);
    const header = new Float64Array(rustEngine.memory.buffer, pointer, 3);
    return { revision: header[0], full: !!header[1], ids: Array.from(new Float64Array(rustEngine.memory.buffer, pointer + 24, header[2])) };
  }

  private ids(pointer: number): Building[] {
    const count = new Float64Array(rustEngine.memory.buffer, pointer, 1)[0];
    const values = new Float64Array(rustEngine.memory.buffer, pointer + 8, count), result: Building[] = [];
    for (let i = 0; i < count; i++) { const building = this.collection!.get(values[i]); if (building) result.push(building); }
    return result;
  }
  nearest(faction: number, x: number, y: number, classCode: number, skip: number): Building | undefined {
    const id = rustEngine.sim_structure_nearest(this.handle, faction ?? NaN, x, y, classCode, skip);
    return Number.isNaN(id) ? undefined : this.collection!.get(id);
  }
  near(faction: number, x: number, y: number, radius: number, classCode: number): boolean {
    return !!rustEngine.sim_structure_near(this.handle, faction ?? NaN, x, y, radius, classCode);
  }
  fountainCovers(house: Pick<Building, 'faction' | 'x' | 'y'>): boolean {
    return !!rustEngine.sim_fountain_covers(this.handle, house.faction, house.x, house.y);
  }
  civicCount(palace: Pick<Building, 'faction' | 'id'>): number {
    return rustEngine.sim_structure_civic_count(this.handle, palace.faction, palace.id);
  }
  query(faction: number | undefined, flags: number, kinds: readonly BuildingKind[]): readonly Building[] {
    const key = `${faction}|${flags}|${kinds.join(',')}`, cached = this.queries.get(key);
    if (cached && cached.revision === this.revision) return cached.buildings;
    const mask = [...new Set(kinds.map(kind => BUILDING_KIND_CODES[kind]))].reduce((value, kind) => value + 2 ** kind, 0);
    const buildings = this.ids(rustEngine.sim_structure_query_mask(this.handle, faction === undefined ? NaN : faction, flags, mask));
    this.queries.set(key, { revision: this.revision, buildings });
    return buildings;
  }
  arcCell(cell: number): boolean { return !!rustEngine.sim_structure_arc_cell(this.handle, cell); }
  takeClearance(): Set<number> {
    const pointer = rustEngine.sim_structure_clearance(this.handle);
    const count = new Float64Array(rustEngine.memory.buffer, pointer, 1)[0];
    return new Set(new Float64Array(rustEngine.memory.buffer, pointer + 8, count));
  }
  solidAt(x: number, y: number): boolean { return !!rustEngine.sim_structure_solid_at(this.handle, x, y); }
  completesRoadSquare(x: number, y: number): boolean {
    return !!rustEngine.sim_structure_road_square(this.handle, x, y, this.state.world.height);
  }
  fallenCityClaims(palace: Building): readonly Building[] {
    return this.ids(rustEngine.sim_structure_fallen_city_claims(this.handle, palace.faction, palace.id, palace.x, palace.y));
  }
  /** Reuse the defensive partition until the indexed structures change. */
  defenses(palace: number): readonly Building[] {
    if (this.defenseRevision !== this.revision) {
      this.defenseRevision = this.revision; this.defenseLists.clear();
      rustEngine.sim_structure_refresh_defenses(this.handle);
    }
    let list = this.defenseLists.get(palace);
    if (!list) { list = this.ids(rustEngine.sim_structure_defenses(this.handle, palace)); this.defenseLists.set(palace, list); }
    return list;
  }
}

const slot = new SimSlot<StructureIndex>();
/** The game's building index, synchronized with every change made so far. */
export function structureIndex(state: GameState): StructureIndex {
  return (slot.get(state) ?? slot.set(state, new StructureIndex(state))).flush();
}

/** The `skip`-th nearest present building of `faction` that can shelter a
 * fleeing unit (no farms, irrigation, routes or walls), by footprint distance. */
export function nearestRefuge(state: GameState, faction: number, x: number, y: number, skip = 0): Building | undefined {
  return structureIndex(state).nearest(faction, x, y, CLASS_REFUGE, skip);
}
/** Nearest completed palace by center distance, with the lower ID winning a tie. */
export function nearestReadyPalace(state: GameState, faction: number, x: number, y: number): Building | undefined {
  return structureIndex(state).nearest(faction, x, y, CLASS_READY_PALACE, 0);
}
/** Whether a present non-farm, non-route building of `faction` stands within `radius`. */
export function shelterNear(state: GameState, faction: number, x: number, y: number, radius: number): boolean {
  return structureIndex(state).near(faction, x, y, radius, CLASS_SHELTER);
}
/** Buildings in array order whose flags include `flags`, optionally limited to
 * one owner (`undefined`: any) and any requested kinds (none: any). Shared and
 * immutable; copy before sorting. */
export function structuresOf(state: GameState, faction: number | undefined, flags: number, ...kinds: BuildingKind[]): readonly Building[] {
  return structureIndex(state).query(faction, flags, kinds);
}
/** A living building other than a farm or irrigation covers this tile. */
export function solidBuildingAt(state: GameState, x: number, y: number): boolean {
  return structureIndex(state).solidAt(x, y);
}
