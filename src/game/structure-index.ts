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
 * it or when one of its indexed scalars changes; open construction sites are
 * rechecked before each query because their lifecycle fields are nested.
 * Queries therefore never rescan `state.buildings`. */

/** Row flags: hp > 0, buildingPresent and buildingReady. */
export const STRUCTURE_ALIVE = 1, STRUCTURE_PRESENT = 2, STRUCTURE_READY = 4;
const CLASS_REFUGE = 0, CLASS_SHELTER = 1;
const OBSERVED = ['faction', 'hp', 'kind', 'x', 'y'] as const;

interface Row { faction: number; x: number; y: number; kind: number; flags: number }
const same = (a: number, b: number): boolean => a === b || Number.isNaN(a) && Number.isNaN(b);

export class StructureIndex implements ScalarObserver {
  private readonly handle: number;
  private store?: EntityStore;
  private collection?: EntityStore['buildings'];
  private entityObserver?: EntityObserver<Building>;
  private readonly rows = new Map<Building, Row>();
  private readonly dirty = new Set<Building>();
  private readonly queries = new Map<string, { revision: number; buildings: readonly Building[] }>();
  private defenseKey = NaN;
  private readonly defenseLists = new Map<number, readonly Building[]>();
  /** Bumped whenever a row actually changes in the native index. */
  revision = 0;
  /** Bumped only when membership, position or kind changes (not health,
   * ownership or construction progress), for footprint-derived caches. */
  geometry = 0;

  constructor(private readonly state: GameState) {
    this.handle = simCore(state).handle;
  }

  changed(target: object): void { this.dirty.add(target as Building); }

  private bind(store: EntityStore): void {
    // Resolve the collection first: creating it may import the state into the
    // native tables, which also empties the native index.
    const collection = store.buildings;
    rustEngine.sim_structures_clear(this.handle, this.state.world.width);
    this.rows.clear(); this.dirty.clear(); this.queries.clear(); this.defenseKey = NaN; this.revision++; this.geometry++;
    this.store = store; this.collection = collection;
    this.entityObserver = {
      added: building => { if (this.collection === collection) this.track(building); },
      removed: building => {
        if (this.collection !== collection || !this.rows.delete(building)) return;
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
    const flags = (building.hp > 0 ? STRUCTURE_ALIVE : 0) | (buildingPresent(building) ? STRUCTURE_PRESENT : 0)
      | (building.hp > 0 && !building.construction ? STRUCTURE_READY : 0);
    const row = this.rows.get(building);
    if (row) {
      if (same(row.faction, faction) && row.x === building.x && row.y === building.y && row.kind === kind && row.flags === flags) return;
      if (row.x !== building.x || row.y !== building.y || row.kind !== kind) this.geometry++;
      row.faction = faction; row.x = building.x; row.y = building.y; row.kind = kind; row.flags = flags;
    } else { this.rows.set(building, { faction, x: building.x, y: building.y, kind, flags }); this.geometry++; }
    rustEngine.sim_structure_upsert(this.handle, building.id, faction, building.x, building.y, kind, flags);
    this.revision++;
  }
  /** Bring the native rows up to date; a no-op when nothing changed. */
  flush(): this {
    const store = entityStore(this.state);
    if (store !== this.store || store.buildings !== this.collection || this.rows.size !== this.state.buildings.length) this.bind(store);
    const collection = this.collection!;
    for (const site of collection.query('construction')) this.publish(site);
    if (this.dirty.size) {
      for (const building of this.dirty) if (this.rows.has(building)) this.publish(building);
      this.dirty.clear();
    }
    return this;
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
  /** `key` names the snapshot the caller wants (a new one per time, topology
   * or offer change). The caller flushes when it starts a snapshot. */
  defenses(palace: number, key: number): readonly Building[] {
    if (key !== this.defenseKey) { this.defenseKey = key; this.defenseLists.clear(); rustEngine.sim_structure_refresh_defenses(this.handle); }
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
