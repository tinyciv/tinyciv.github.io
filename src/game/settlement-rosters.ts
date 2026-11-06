import { entityStore, type EntityStore } from './entity-store';
import { simulationReadsActive, structureChangeRevision } from './simulation-reads';
import { worldStructureRevision } from './world-revisions';
import { buildingReady, isFarmKind, type Building, type GameState, type Unit } from './types';
import { workerHomeCity } from './civilian-population';

export interface SettlementBuildings {
  farms: Building[]; houses: Building[]; wells: Building[]; posts: Building[];
  housesByFaction: Map<number, Building[]>; palacesByFaction: Map<number, Building[]>;
}
interface BuildingRoster extends SettlementBuildings {
  store: EntityStore; membership: number; structure: number; worldStructure: number;
}
const buildingRosters = new WeakMap<GameState, BuildingRoster>();
function add<T>(map: Map<number, T[]>, id: number, value: T): void {
  let values = map.get(id); if (!values) { values = []; map.set(id, values); } values.push(value);
}

/** Stable structural memberships are shared by housing, farming and staffing.
 * Resident counts, health, work claims and crop state remain live objects. */
export function settlementBuildings(state: GameState): SettlementBuildings {
  const trusted = simulationReadsActive(state), store = entityStore(state), structure = structureChangeRevision(state);
  const worldStructure = trusted ? worldStructureRevision(state.world) : 0;
  let result = buildingRosters.get(state);
  if (trusted && result?.store === store && result.membership === store.buildings.revision
    && result.structure === structure && result.worldStructure === worldStructure) return result;
  result = { store, membership: store.buildings.revision, structure, worldStructure,
    farms: [], houses: [], wells: [], posts: [], housesByFaction: new Map(), palacesByFaction: new Map() };
  for (const building of state.buildings) {
    if (building.hp <= 0) continue;
    if (isFarmKind(building.kind)) result.farms.push(building);
    if (building.kind === 'house') { result.houses.push(building); add(result.housesByFaction, building.faction, building); }
    if (!buildingReady(building)) continue;
    if (building.kind === 'palace') add(result.palacesByFaction, building.faction, building);
    else if (building.kind === 'well') result.wells.push(building);
    else if (building.kind === 'guardPost') result.posts.push(building);
  }
  if (trusted) buildingRosters.set(state, result);
  return result;
}

export interface SettlementWorkers {
  workers: readonly Unit[]; collectors: readonly Unit[];
  cities: Map<Unit, Building | undefined>; byCity: Map<number, Unit[]>; buildersByCity: Map<number, Unit[]>;
}
interface WorkerRoster extends SettlementWorkers {
  store: EntityStore; builders: readonly Unit[]; collectorRoles: readonly Unit[];
  structure: number; worldStructure: number; buildings: number;
}
const workerRosters = new WeakMap<GameState, WorkerRoster>();

/** Reassignment changes only the owning city's roster; membership additions and
 * role changes are already represented by the ECS query identities. */
export function invalidateWorkerHomes(state: GameState): void { workerRosters.delete(state); }

export function settlementWorkers(state: GameState): SettlementWorkers {
  const trusted = simulationReadsActive(state), store = entityStore(state);
  const workers = trusted ? store.units.query('worker') : state.units.filter(unit => unit.kind === 'worker');
  const builders = trusted ? store.units.query('builder') : state.units.filter(unit => unit.builder);
  const collectorRoles = trusted ? store.units.query('collector') : state.units.filter(unit => unit.collector);
  const structure = structureChangeRevision(state), worldStructure = trusted ? worldStructureRevision(state.world) : 0;
  let result = workerRosters.get(state);
  if (trusted && result?.store === store && result.workers === workers && result.builders === builders
    && result.collectorRoles === collectorRoles && result.structure === structure && result.worldStructure === worldStructure
    && result.buildings === store.buildings.revision) return result;
  result = { store, workers, builders, collectorRoles, structure, worldStructure, buildings: store.buildings.revision,
    collectors: workers.filter(unit => unit.collector && !unit.builder), cities: new Map(), byCity: new Map(), buildersByCity: new Map() };
  let spatialHome = false;
  for (const unit of workers) {
    const city = workerHomeCity(state, unit); result.cities.set(unit, city);
    const home = store.buildings.get(unit.home ?? -1);
    // An orphan can choose a different nearest city while walking. Such rare
    // rosters remain uncached until ordinary staffing assigns a stable home.
    if (!home || home.faction !== unit.faction || !buildingReady(home)) spatialHome = true;
    if (city) { add(result.byCity, city.id, unit); if (unit.builder) add(result.buildersByCity, city.id, unit); }
  }
  if (trusted && !spatialHome) workerRosters.set(state, result);
  else workerRosters.delete(state);
  return result;
}
