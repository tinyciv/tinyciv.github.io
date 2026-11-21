import { lifetimeCulture } from './achievement-effects';
import { livingEngineer } from './leader-abilities';
import { buildingWorkForbidden } from './forbidden-work';
import { bridgeConstructionMembers, constructionHead } from './bridge-construction';
import { isForbidden } from './forbidden-zones';
import { buildingHeight, buildingWidth, type Building, type BuildingKind, type GameState } from './types';
import { invalidateNavigation } from './pathfinding';
import { clearConstructionSite } from './construction-clearance';
import { addPalaceRoadRing } from './palace-roads';
import { announceTownFounded } from './army-warnings';
import { recordCampaignPopulation } from './campaign-stats';
import { rustEngine } from './rust-engine';
import { constructionSpeedMultiplier } from './research-bonuses';
import { entityStore } from './entity-store';
import { clearObservedScalar } from './scalar-observer';
import { markWorldChanged } from './world-revisions';
import { removeBuildings } from './construction-cancellation';
import { updateWallStats } from './wall-stats';
import { SETTLEMENT_UPKEEP_GRACE } from './maintenance';
import { restoreCityBorderClaims } from './borders';
import { CONSTRUCTION_KINDS, nativeConstructionDuration, runConstructionRule, retimeNativeConstruction, forgetNativeConstruction, initializeConstructionHealth,
  CONSTRUCTION_CLEARANCE, CONSTRUCTION_COMPLETE, CONSTRUCTION_INVALIDATE, CONSTRUCTION_SKIP } from './construction-native';

/** Game seconds; starting settlements are already complete. */
export const CONSTRUCTION_SECONDS = Object.fromEntries(CONSTRUCTION_KINDS.map(kind => [kind, nativeConstructionDuration(kind)])) as Record<BuildingKind, number>;
/** Pass the owning state when restarting work on an existing entity. New
 * buildings acquire their construction membership when added to the store. */
export function startConstruction(building: Building, time: number, state?: GameState): void {
  const duration = CONSTRUCTION_SECONDS[building.kind];
  if (duration > 0) {
    building.construction = { startedAt: time, duration };
    initializeConstructionHealth(building);
    if (state) {
      const buildings = entityStore(state).buildings;
      if (buildings.get(building.id) === building) buildings.updateRoles(building);
    }
  }
}
/** Reserve a footprint immediately, but work begins only when its peasant arrives. */
export function queueConstruction(building: Building, time: number, paidGold = 0, state?: GameState, rebuilding = false): void {
  startConstruction(building, time, state);
  if (building.construction) { building.construction.waitingForBuilder = building.kind !== 'ballista' && building.kind !== 'siegeCannon'; building.construction.paidGold = paidGold; }
  if (building.construction?.waitingForBuilder && (rebuilding || state?.buildingDestructions?.some(effect =>
    building.x < effect.x + effect.width && building.x + buildingWidth(building) > effect.x
    && building.y < effect.y + effect.height && building.y + buildingHeight(building) > effect.y))) {
    building.construction.hideUntilStarted = true;
  }
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
    const site = building.construction;
    if (!site) { store.buildings.updateRoles(building); continue; }
    if (constructionHead(state, building) !== building) continue;
    const prepared = runConstructionRule(state, building, 0, {
      speed: constructionSpeedMultiplier(factions.get(building.faction)), forbidden: buildingWorkForbidden(state, building),
      engineer: site.engineerId === undefined ? undefined : store.units.get(site.engineerId),
    });
    if (prepared & CONSTRUCTION_INVALIDATE) invalidateNavigation(state);
    if (prepared & CONSTRUCTION_SKIP || !(prepared & CONSTRUCTION_CLEARANCE)) continue;
    // Clearance moves real actors. Publish each native phase and completion's
    // scenery effects before examining the following site in creation order.
    const clearance = clearConstructionSite(state, building);
    const worker = clearance && site.waitingForBuilder === false && building.kind !== 'ballista' && building.kind !== 'siegeCannon' && site.engineerId === undefined
      && site.builderId !== undefined ? store.units.get(site.builderId) : undefined;
    const finished = runConstructionRule(state, building, 1, { clearance, worker,
      workerForbidden: worker && worker.hp > 0 && worker.builder && worker.buildSite === building.id
        && worker.buildPhase === 'working' && !worker.inside && worker.order !== 'flee'
        ? isForbidden(state, worker.x, worker.y, worker.faction) : false });
    if (finished & CONSTRUCTION_INVALIDATE) invalidateNavigation(state);
    if (finished & CONSTRUCTION_COMPLETE) {
      const palisade = site.replacesPalisade === undefined ? undefined : store.buildings.get(site.replacesPalisade);
      for (const part of bridgeConstructionMembers(state, building) ?? [building]) {
        if (part.kind === 'road' || part.kind === 'bridge') part.roadBuildGold = part.construction?.paidGold ?? 0;
        clearObservedScalar(part, 'construction');
        forgetNativeConstruction(state, part.id);
        store.buildings.updateRoles(part);
      }
      if (palisade?.kind === 'palisade' && palisade.x === building.x && palisade.y === building.y)
        removeBuildings(state, new Set([palisade.id]));
      if (building.kind === 'palace') {
        const faction = factions.get(building.faction);
        building.settlementUpkeepUntil = state.time + SETTLEMENT_UPKEEP_GRACE;
        if (faction?.firstTownFoundingAvailable) {
          const residents = rustEngine.town_founding_residents(1);
          delete faction.firstTownFoundingAvailable;
          building.unhousedResidents = residents;
          faction.population += residents;
          recordCampaignPopulation(state, faction);
        }
        // Establish the cultural baseline when this city actually starts
        // claiming territory, rather than while its footprint is still queued.
        building.cultureAtFounding = lifetimeCulture(faction);
        restoreCityBorderClaims(state, building);
        addPalaceRoadRing(state, building);
        announceTownFounded(state, building);
      }
      invalidateNavigation(state);
      changed = true;
    }
  }
  if (changed) { markWorldChanged(state.world); updateWallStats(state); }
  return changed;
}

export function updateConstructionResearch(state: GameState, tracked = false): void {
  const buildings = entityStore(state).buildings;
  if (!tracked) for (const building of state.buildings) buildings.updateRoles(building);
  const factions = new Map(state.factions.map(faction => [faction.id, faction]));
  const sites = buildings.query('construction');
  retimeNativeConstruction(state, sites, sites.map(building => constructionSpeedMultiplier(factions.get(building.faction))));
}
