import { territoryValue } from './territory-cells';
import { territory, UNCLAIMED } from './borders';
import { playerFaction } from './player-context';
import { buildingHeight, buildingReady, buildingWidth, type Building, type BuildingKind, type Faction, type GameState, type Point } from './types';

export type RebuildDefenseKind = 'wall' | 'palisade' | 'woodenTower' | 'tower' | 'scoutTower';
export interface DefenseRebuild extends Point { kind: RebuildDefenseKind; faction: number; sourceId: number; nextAttempt: number | null }
const kinds = new Set<string>(['wall', 'palisade', 'woodenTower', 'tower', 'scoutTower']);
const nextChecks = new WeakMap<GameState, number>();
const footprints = new WeakMap<GameState, { orders: DefenseRebuild[]; count: number; width: number; cells: Map<number, DefenseRebuild[]> }>();

function indexOrder(cells: Map<number, DefenseRebuild[]>, width: number, order: DefenseRebuild): void {
  for (let dy = 0; dy < buildingHeight(order); dy++) for (let dx = 0; dx < buildingWidth(order); dx++) {
    const cell = (order.y + dy) * width + order.x + dx, occupants = cells.get(cell);
    if (occupants) occupants.push(order);
    else cells.set(cell, [order]);
  }
}

function defenseFootprints(state: GameState, orders: DefenseRebuild[]) {
  const { width } = state.world;
  let index = footprints.get(state);
  if (index?.orders !== orders || index.count !== orders.length || index.width !== width) {
    const cells = new Map<number, DefenseRebuild[]>();
    for (const order of orders) indexOrder(cells, width, order);
    index = { orders, count: orders.length, width, cells };
    footprints.set(state, index);
  }
  return index;
}

export function overlapsFallenDefense(state: GameState, kind: BuildingKind, x: number, y: number): boolean {
  const orders = state.defenseRebuilds;
  if (!orders?.length) return false;
  const { width, height } = state.world;
  const { cells } = defenseFootprints(state, orders);
  for (let cy = Math.max(0, y); cy < Math.min(height, y + buildingHeight({ kind })); cy++)
    for (let cx = Math.max(0, x); cx < Math.min(width, x + buildingWidth({ kind })); cx++)
      if (cells.has(cy * width + cx)) return true;
  return false;
}

export const automaticallyRebuildDefenses = (faction: Faction | undefined): boolean =>
  !!faction && faction.id >= 0 && faction.villageId === undefined && faction.autoRebuildDefenses !== false;

export function setAutomaticallyRebuildDefenses(state: GameState, enabled: boolean, factionId = playerFaction(state)): void {
  const faction = state.factions.find(candidate => candidate.id === factionId);
  if (!faction) return;
  faction.autoRebuildDefenses = enabled;
  if (!enabled) for (const order of state.defenseRebuilds ?? []) {
    if (order.faction === factionId && order.kind !== 'scoutTower') order.nextAttempt = null;
  }
  nextChecks.delete(state);
}

/** Called only by combat destruction. Demolition and canceled construction
 * never create a rebuilding obligation or spend more gold. */
export function recordDestroyedDefense(state: GameState, building: Building): void {
  const faction = state.factions.find(candidate => candidate.id === building.faction);
  if (!faction || faction.defeated || faction.id < 0 || faction.villageId !== undefined || !kinds.has(building.kind)) return;
  const orders = state.defenseRebuilds ??= [];
  const index = defenseFootprints(state, orders);
  if (index.cells.get(building.y * index.width + building.x)?.some(order => order.kind === building.kind
    && order.faction === building.faction && order.x === building.x && order.y === building.y)) return;
  const rebuild = building.kind === 'scoutTower' || automaticallyRebuildDefenses(faction) && !building.construction;
  const order: DefenseRebuild = { kind: building.kind as RebuildDefenseKind, faction: building.faction,
    x: building.x, y: building.y, sourceId: building.id, nextAttempt: rebuild ? state.time + 1 : null };
  orders.push(order);
  indexOrder(index.cells, index.width, order); index.count++;
  nextChecks.delete(state);
}

/** A bounded queue reserves the original footprint and uses ordinary builder
 * work. Scout tower blueprints survive a pause in automatic rebuilding. */
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
  const pending = state.defenseRebuilds;
  const retained = pending.filter(order => {
    const faction = factions.get(order.faction);
    if (!faction || faction.defeated) return false;
    const owner = territoryValue(borders, order.y * state.world.width + order.x);
    // A captured neighborhood belongs to its new owner, not the old blueprint.
    if (owner !== undefined && owner !== UNCLAIMED && owner !== order.faction) {
      if (order.kind !== 'scoutTower') return false;
      nextCheck = Math.min(nextCheck, state.time + 2);
      return true;
    }
    if (occupied.has(key(order, order.kind))) return false;
    if (order.nextAttempt === null || !automaticallyRebuildDefenses(faction)) return true;
    if (state.time >= order.nextAttempt && attempts < 3) {
      attempts++; order.nextAttempt = state.time + 2;
      if (palaces.has(order.faction) && build(order, reservedId + 1)) {
        occupied.add(key(order, order.kind)); return false;
      }
    }
    nextCheck = Math.min(nextCheck, Math.max(state.time + .25, order.nextAttempt));
    return true;
  });
  if (retained.length !== pending.length) state.defenseRebuilds = retained;
  nextChecks.set(state, nextCheck);
}
