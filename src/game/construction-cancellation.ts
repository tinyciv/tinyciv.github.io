import { playerFaction } from './player-context';
import { entityStore } from './entity-store';
import { markWorldChanged } from './world-revisions';
import { type Building, type GameState, buildingPresent, isWallKind } from './types';
import { invalidateNavigation } from './pathfinding';
import { releaseAttackSpot } from './engagement';
import { clearBuildingFootprint } from './construction-clearance';
import { updateWallStats } from './wall-stats';

/** A canceled road can turn an occupied gate into a solid wall. Clear its
 * occupants first, or leave the order and its gateway intact if they cannot exit. */
export function prepareConstructionCancellation(state: GameState, building: Building): boolean {
  if (building.kind !== 'road') return true;
  if (state.buildings.some(other => other.id !== building.id && other.kind === 'road' && other.hp > 0
    && other.x === building.x && other.y === building.y)) return true;
  const wall = state.buildings.find(other => isWallKind(other.kind) && buildingPresent(other)
    && other.x === building.x && other.y === building.y);
  return !wall || clearBuildingFootprint(state, wall);
}

export function constructionProgress(state: GameState, building: Building): number {
  const site = building.construction;
  if (!site) return 1;
  if (site.waitingForBuilder && site.pausedAt === undefined) return 0;
  const elapsed = (site.pausedAt ?? state.time) - site.startedAt;
  return site.duration > 0 ? Math.max(0, Math.min(1, elapsed / site.duration)) : 1;
}

/** Refund only the work not yet performed, using the price actually paid. */
export function cancellationRefund(state: GameState, building: Building): number {
  const paid = building.construction?.paidGold ?? 0;
  return Math.round(Math.max(0, paid) * (1 - constructionProgress(state, building)) * 100) / 100;
}

/** Shared by cancellation and road replacement; no completed building is
 * removed by the public cancel command. Workers must relinquish obsolete jobs. */
export function removeBuildings(state: GameState, ids: Set<number>): void {
  if (!state.buildings.some(building => ids.has(building.id))) return;
  entityStore(state).buildings.retain(building => !ids.has(building.id));
  state.projectiles = state.projectiles?.filter(projectile => !ids.has(projectile.target));
  for (const unit of state.units) {
    if (unit.forcedAttack && ids.has(unit.forcedAttack.target)) unit.forcedAttack = undefined;
    const abandonedJob = ids.has(unit.buildSite ?? -1) || ids.has(unit.repairSite ?? -1);
    if (abandonedJob) {
      unit.buildSite = undefined; unit.repairSite = undefined;
      unit.buildPhase = unit.inside ? 'idle' : 'returning';
    }
    if (abandonedJob || ids.has(unit.target ?? -1)) {
      unit.target = undefined; unit.destination = undefined; unit.path = undefined; unit.pathGoal = undefined;
      unit.repathAt = 0; unit.moving = false; unit.attackTime = 0;
      releaseAttackSpot(state, unit);
    }
  }
  if (state.selectedType === 'building' && ids.has(state.selected ?? -1)) {
    state.selected = state.units.find(unit => unit.kind === 'leader' && unit.faction === playerFaction(state) && unit.hp > 0)?.id ?? null;
    state.selectedType = state.selected === null ? null : 'unit';
  }
  markWorldChanged(state.world);
  updateWallStats(state);
  invalidateNavigation(state);
}
