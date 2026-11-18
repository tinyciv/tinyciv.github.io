import { type GameState, type Projectile, type ResourceWorkKind, type Unit, unitMaxHp } from './types';

/** These jobs can stay on the staffing roster while their worker is at home. */
export function isIdleWorkerSlot(unit: Unit): boolean {
  if (unit.kind !== 'worker' || !unit.inside || unit.home === undefined || !(unit.hp > 0 && unit.hp >= unitMaxHp(unit))
    || unit.order !== 'work' || unit.engineer || unit.explorationRefugee || unit.levy || unit.embarkedOn !== undefined
    || unit.villageId !== undefined || unit.seaInvasion !== undefined || unit.training || unit.garrison
    || unit.resourceWork || unit.drainageWork || unit.civilianPanic || unit.routed || unit.casualtyShock
    || unit.cargo || unit.cargoBatches?.length || unit.moving || !(unit.cooldown <= 0 && unit.attackTime <= 0)
    || unit.target !== undefined || unit.destination || unit.path?.length) return false;
  if (unit.builder && !unit.collector) return (!unit.buildPhase || unit.buildPhase === 'idle') && unit.buildSite === undefined
    && unit.repairSite === undefined && !unit.clearTree && !unit.builderRetiring;
  return !!unit.collector && !unit.builder && unit.collectorCamp !== undefined
    && (!unit.collectPhase || unit.collectPhase === 'idle') && unit.field === undefined && !unit.cultivating;
}

export function isMineResource(resource: ResourceWorkKind): boolean {
  return resource === 'copper' || resource === 'iron' || resource === 'gold';
}

/** A hidden miner still owns its shift and takes up one resident work slot. */
export function isUndergroundWorkerSlot(unit: Unit): boolean {
  return unit.kind === 'worker' && !!unit.inside && unit.order === 'hold' && unit.hp > 0 && unit.hp >= unitMaxHp(unit)
    && unit.resourceWork?.phase === 'working' && isMineResource(unit.resourceWork.resource)
    && unit.villageId === undefined && unit.embarkedOn === undefined && !unit.levy && !unit.engineer
    && !unit.civilianPanic && !unit.routed && !unit.casualtyShock && !unit.moving && unit.target === undefined;
}

interface ProjectileTargets { source: Projectile[]; count: number; ids: Set<number> }
const projectileTargets = new WeakMap<GameState, ProjectileTargets>();

/** Projectiles are appended on launch and their array is replaced after impact
 * or cancellation. Share the target index across all worker returns. */
export function workerHasLiveReference(state: GameState, unit: Unit): boolean {
  if (state.selectedType === 'unit' && state.selected === unit.id) return true;
  const projectiles = state.projectiles;
  if (!projectiles?.length) return false;
  let index = projectileTargets.get(state);
  if (!index) {
    index = { source: projectiles, count: 0, ids: new Set() };
    projectileTargets.set(state, index);
  } else if (index.source !== projectiles || index.count > projectiles.length) {
    index.source = projectiles;
    index.count = 0;
    index.ids.clear();
  }
  for (; index.count < projectiles.length; index.count++) index.ids.add(projectiles[index.count].target);
  return index.ids.has(unit.id);
}
