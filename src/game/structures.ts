import { livingEngineer } from './leader-abilities';
import { buildingWorkForbidden } from './forbidden-work';
import { isForbidden } from './forbidden-zones';
import { type Building, type BuildingKind, type GameState, buildingWidth, buildingHeight } from './types';
import { invalidateNavigation } from './pathfinding';
import { clearConstructionSite } from './construction-clearance';
import { addPalaceRoadRing } from './palace-roads';
import { constructionSpeedMultiplier } from './research-bonuses';
import type { Faction } from './types';
import { entityStore } from './entity-store';
import { markWorldChanged } from './world-revisions';
import { FARM_BUILD_SECONDS } from './farm-config';
import { HOUSE_BUILD_SECONDS } from './housing-config';
import { removeBuildings } from './construction-cancellation';
import { HEALER_SHACK_BUILD_SECONDS } from './healer-shack';
import { BALLISTA_BUILD_SECONDS } from './ballista';
import { DOCK_BUILD_SECONDS } from './dock';
import { updateWallStats } from './wall-stats';

/** Game seconds; starting settlements are already complete. */
export const CONSTRUCTION_SECONDS: Record<BuildingKind, number> = {
  observationPost: 0, fort: 240, supplyDepot: 45, villageTent: 0, stable: 60,
  palace: 90, camp: FARM_BUILD_SECONDS, house: HOUSE_BUILD_SECONDS, shack: 20, cottage: 25, road: 2, wall: 4, irrigation: 4,
  palisade: 4, bridge: 12, tower: 25, woodenTower: 15, ruin: 0, well: 20, monument: 20, blacksmith: 90, guardPost: 30, archeryRange: 90, library: 90, scoutLodge: 45,
  healerShack: HEALER_SHACK_BUILD_SECONDS,
  ballista: BALLISTA_BUILD_SECONDS,
  dock: DOCK_BUILD_SECONDS,
};
/** Pass the owning state when restarting work on an existing entity. New
 * buildings acquire their construction membership when added to the store. */
export function startConstruction(building: Building, time: number, state?: GameState): void {
  const duration = CONSTRUCTION_SECONDS[building.kind];
  if (duration > 0) {
    building.construction = { startedAt: time, duration };
    if (state) {
      const buildings = entityStore(state).buildings;
      if (buildings.get(building.id) === building) buildings.updateRoles(building);
    }
  }
}
/** Reserve a footprint immediately, but work begins only when its peasant arrives. */
export function queueConstruction(building: Building, time: number, paidGold = 0, state?: GameState): void {
  startConstruction(building, time, state);
  if (building.construction) { building.construction.waitingForBuilder = building.kind !== 'ballista'; building.construction.paidGold = paidGold; }
  if (state && building.construction && (building.kind === 'road' || building.kind === 'bridge')) {
    const engineer = livingEngineer(state, building.faction);
    if (engineer) { building.construction.engineerId = engineer.id; building.construction.waitingForBuilder = false; }
  }
  // Stroke previews reserve an unattached object against shallow shared
  // structures. Only a live order may refresh existing entities' statistics.
  if (state && entityStore(state).buildings.get(building.id) === building
    && ['wall', 'palisade', 'road', 'tower', 'woodenTower'].includes(building.kind)) updateWallStats(state);
}
export function updateConstruction(state: GameState): boolean {
  // Public/editor callers may assign construction directly. The simulation's
  // tracked path below uses startConstruction/queueConstruction and entity adds.
  const buildings = entityStore(state).buildings;
  for (const building of state.buildings) buildings.updateRoles(building);
  return updateActiveConstruction(state);
}
/** Only unfinished sites require per-step builder/clearance checks. Completion
 * clocks remain exact, including live pauses and construction-speed changes. */
export function updateActiveConstruction(state: GameState): boolean {
  const store = entityStore(state), sites = store.buildings.query('construction');
  if (!sites.length) return false;
  let changed = false;
  const factions = new Map(state.factions.map(faction => [faction.id, faction]));
  for (const building of sites) {
    applyConstructionSpeed(building, state.time, factions.get(building.faction));
    const site = building.construction;
    if (!site) { store.buildings.updateRoles(building); continue; }
    if (buildingWorkForbidden(state, building)) {
      if (!site.waitingForBuilder) { site.pausedAt = state.time; invalidateNavigation(state); }
      site.waitingForBuilder = true; site.cleared = false;
      continue;
    }
    if (site.engineerId !== undefined) {
      const engineer = store.units.get(site.engineerId);
      if (!engineer || engineer.hp <= 0 || !engineer.engineer || engineer.faction !== building.faction) {
        delete site.engineerId; site.waitingForBuilder = true; site.pausedAt = state.time;
      } else {
        if (site.pausedAt !== undefined) { site.startedAt += state.time - site.pausedAt; delete site.pausedAt; }
        site.waitingForBuilder = false;
      }
    }
    // Queued or paused orders are open ground. Clearance happens only when a
    // builder arrives to activate the footprint.
    if (building.kind === 'ballista') {
      if (site.pausedAt !== undefined) { site.startedAt += state.time - site.pausedAt; delete site.pausedAt; }
      site.waitingForBuilder = false;
    }
    if (site && !site.waitingForBuilder && !clearConstructionSite(state, building)) {
      if (building.kind === 'ballista' || site.engineerId !== undefined) site.pausedAt ??= state.time;
      continue;
    }
    if (site?.waitingForBuilder === false && building.kind !== 'ballista' && site.engineerId === undefined) {
      const assigned = site.builderId === undefined ? undefined : store.units.get(site.builderId);
      const worker = assigned && assigned.hp > 0 && assigned.builder && assigned.buildSite === building.id
        && assigned.buildPhase === 'working' && !assigned.inside && assigned.order !== 'flee'
        && !isForbidden(state, assigned.x, assigned.y, assigned.faction) ? assigned : undefined;
      const adjacent = worker && Math.hypot(Math.max(building.x - worker.x, 0, worker.x - building.x - buildingWidth(building)),
        Math.max(building.y - worker.y, 0, worker.y - building.y - buildingHeight(building))) <= .7;
      if (!adjacent) {
        site.waitingForBuilder = true; site.pausedAt = state.time; site.cleared = false;
        invalidateNavigation(state);
        if (!worker) delete site.builderId;
      }
    }
    if (site && !site.waitingForBuilder && building.hp > 0 && state.time + 1e-7 >= site.startedAt + site.duration) {
      const palisade = site.replacesPalisade === undefined ? undefined : store.buildings.get(site.replacesPalisade);
      delete building.construction;
      store.buildings.updateRoles(building);
      if (palisade?.kind === 'palisade' && palisade.x === building.x && palisade.y === building.y)
        removeBuildings(state, new Set([palisade.id]));
      if (building.kind === 'palace') {
        // Establish the cultural baseline when this city actually starts
        // claiming territory, rather than while its footprint is still queued.
        building.cultureAtFounding = Math.max(0, state.factions.find(faction => faction.id === building.faction)?.culture ?? 0);
        addPalaceRoadRing(state, building);
      }
      invalidateNavigation(state);
      changed = true;
    }
  }
  if (changed) { markWorldChanged(state.world); updateWallStats(state); }
  return changed;
}

/** Changing tools changes the remaining work rate, not progress already made.
 * Queued footprints keep their order timestamp until their builder arrives. */
function applyConstructionSpeed(building: Building, time: number, faction: Pick<Faction, 'research'> | undefined): void {
  const site = building.construction;
  if (!site) return;
  const previous = site.researchSpeed ?? 1, speed = constructionSpeedMultiplier(faction);
  if (speed === previous) return;
  const queued = site.waitingForBuilder && site.pausedAt === undefined;
  const clock = site.pausedAt ?? time;
  const progress = queued ? 0 : Math.max(0, Math.min(1, (clock - site.startedAt) / site.duration));
  site.duration *= previous / speed;
  if (!queued) site.startedAt = clock - progress * site.duration;
  site.researchSpeed = speed;
}

export function updateConstructionResearch(state: GameState, tracked = false): void {
  const buildings = entityStore(state).buildings;
  if (!tracked) for (const building of state.buildings) buildings.updateRoles(building);
  const factions = new Map(state.factions.map(faction => [faction.id, faction]));
  for (const building of buildings.query('construction'))
    applyConstructionSpeed(building, state.time, factions.get(building.faction));
}
