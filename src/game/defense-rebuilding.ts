import { territory, UNCLAIMED } from './borders';
import { playerFaction } from './player-context';
import { buildingReady, type Building, type Faction, type GameState, type Point } from './types';

export type RebuildDefenseKind = 'wall' | 'palisade' | 'woodenTower' | 'tower';
export interface DefenseRebuild extends Point { kind: RebuildDefenseKind; faction: number; sourceId: number; nextAttempt: number }
const kinds = new Set<string>(['wall', 'palisade', 'woodenTower', 'tower']);
const nextChecks = new WeakMap<GameState, number>();

export const automaticallyRebuildDefenses = (faction: Faction | undefined): boolean =>
  !!faction && faction.id >= 0 && faction.villageId === undefined && faction.autoRebuildDefenses !== false;

export function setAutomaticallyRebuildDefenses(state: GameState, enabled: boolean, factionId = playerFaction(state)): void {
  const faction = state.factions.find(candidate => candidate.id === factionId);
  if (!faction) return;
  faction.autoRebuildDefenses = enabled;
  if (!enabled) state.defenseRebuilds = state.defenseRebuilds?.filter(order => order.faction !== factionId);
  nextChecks.delete(state);
}

/** Called only by combat destruction. Demolition and canceled construction
 * never create a rebuilding obligation or spend more gold. */
export function recordDestroyedDefense(state: GameState, building: Building): void {
  const faction = state.factions.find(candidate => candidate.id === building.faction);
  if (!kinds.has(building.kind) || building.construction || !automaticallyRebuildDefenses(faction)) return;
  const orders = state.defenseRebuilds ??= [];
  if (orders.some(order => order.kind === building.kind && order.faction === building.faction && order.x === building.x && order.y === building.y)) return;
  orders.push({ kind: building.kind as RebuildDefenseKind, faction: building.faction,
    x: building.x, y: building.y, sourceId: building.id, nextAttempt: state.time + 1 });
  nextChecks.delete(state);
}

/** A bounded queue uses ordinary paid construction; surviving roads still make
 * gates, and builders wait for safe physical access just as with manual orders. */
export function updateDefenseRebuilds(state: GameState, build: (order: DefenseRebuild, minimumId: number) => boolean): void {
  if (!state.defenseRebuilds?.length || state.time < (nextChecks.get(state) ?? 0)) return;
  const borders = territory(state);
  const factions = new Map(state.factions.map(faction => [faction.id, faction]));
  const occupied = new Set<string>(), palaces = new Set<number>();
  const key = (point: Point, kind: string) => `${point.x},${point.y},${kind}`;
  for (const building of state.buildings) if (building.hp > 0) {
    occupied.add(key(building, building.kind));
    if (building.kind === 'palace' && buildingReady(building)) palaces.add(building.faction);
  }
  // Reserve every fallen identity together, including references that outlive
  // the dead entity. A replacement must never inherit another wall's arrows.
  let reservedId = state.selected ?? 0;
  for (const order of state.defenseRebuilds) reservedId = Math.max(reservedId, order.sourceId);
  for (const unit of state.units) for (const id of [unit.id, unit.target, unit.forcedAttack?.target, unit.forcedAttack?.previousTarget])
    if (id !== undefined) reservedId = Math.max(reservedId, id);
  for (const projectile of state.projectiles ?? []) reservedId = Math.max(reservedId, projectile.attacker, projectile.target);
  let attempts = 0, nextCheck = Infinity;
  state.defenseRebuilds = state.defenseRebuilds.filter(order => {
    const faction = factions.get(order.faction);
    if (!automaticallyRebuildDefenses(faction) || faction!.defeated) return false;
    const owner = borders.owners[order.y * state.world.width + order.x];
    // A captured neighborhood belongs to its new owner, not the old blueprint.
    if (owner !== undefined && owner !== UNCLAIMED && owner !== order.faction) return false;
    if (occupied.has(key(order, order.kind))) return false;
    if (state.time >= order.nextAttempt && attempts < 3) {
      attempts++; order.nextAttempt = state.time + 2;
      if (palaces.has(order.faction) && build(order, reservedId + 1)) {
        occupied.add(key(order, order.kind)); return false;
      }
    }
    nextCheck = Math.min(nextCheck, Math.max(state.time + .25, order.nextAttempt));
    return true;
  });
  nextChecks.set(state, nextCheck);
}
