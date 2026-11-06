import { entityStore, type EntityStore } from './entity-store';
import { simulationReadsActive, structureChangeRevision } from './simulation-reads';
import { buildingReady, isFarmKind, type Building, type GameState } from './types';
import { worldStructureRevision } from './world-revisions';

interface RepairJobs {
  store: EntityStore; membership: number; structure: number; worldStructure: number;
  factions: Map<number, Set<Building>>; owners: Map<Building, number>;
}
const repairs = new WeakMap<GameState, RepairJobs>();
function damaged(building: Building): boolean {
  return buildingReady(building) && !isFarmKind(building.kind) && building.kind !== 'ruin' && building.hp < building.maxHp;
}
function refresh(jobs: RepairJobs, building: Building): void {
  const owner = jobs.owners.get(building);
  if (owner !== undefined) { jobs.factions.get(owner)?.delete(building); jobs.owners.delete(building); }
  if (!damaged(building) || jobs.store.buildings.get(building.id) !== building) return;
  let faction = jobs.factions.get(building.faction);
  if (!faction) { faction = new Set(); jobs.factions.set(building.faction, faction); }
  faction.add(building); jobs.owners.set(building, building.faction);
}

/** Damage, repair and health-stat changes maintain the job board immediately.
 * The quiet-period clock and exclusive worker claim remain live dispatch gates. */
export function notifyRepairJobChanged(state: GameState, building: Building): void {
  const jobs = repairs.get(state);
  if (jobs) refresh(jobs, building);
}

/** Structural changes reconcile once; individual idle workers only inspect
 * damaged buildings belonging to their faction. Public fixture/editor calls
 * retain direct-mutation semantics outside the simulation read boundary. */
export function repairJobCandidates(state: GameState, faction: number): readonly Building[] {
  if (!simulationReadsActive(state)) return state.buildings.filter(building => building.faction === faction && damaged(building));
  const store = entityStore(state), structure = structureChangeRevision(state), worldStructure = worldStructureRevision(state.world);
  let jobs = repairs.get(state);
  if (!jobs || jobs.store !== store || jobs.membership !== store.buildings.revision || jobs.structure !== structure || jobs.worldStructure !== worldStructure) {
    jobs = { store, membership: store.buildings.revision, structure, worldStructure, factions: new Map(), owners: new Map() };
    for (const building of state.buildings) refresh(jobs, building);
    repairs.set(state, jobs);
  }
  return Array.from(jobs.factions.get(faction) ?? []);
}
