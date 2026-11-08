import { entityStore } from './entity-store';
import { announceArmyMobilization } from './army-warnings';
import { findPath } from './pathfinding';
import { infantryFormationGoal, infantryFormationLeader } from './infantry-drill';
import { isRaiderEnemyFaction } from './raid-targeting';
import { marauderLeaderInDanger } from './marauder-leaders';
import { buildingReady, buildingWidth, buildingHeight, distance, isWallKind, type Building, type GameState, type Point, type Unit } from './types';

export const MARAUDER_FORMATION_MIN_SIZE = 10;
export const MARAUDER_FORTIFICATION_DAMAGE = 2;
const clocks = new WeakMap<GameState, number>();
const center = (building: Building): Point => ({ x: building.x + buildingWidth(building) / 2, y: building.y + buildingHeight(building) / 2 });
const eligible = (unit: Unit): boolean => unit.hp > 0 && !unit.inside && !unit.routed && unit.order !== 'flee';
function release(state: GameState, leader: Unit): void {
  if (!leader.infantryFormation?.active) return;
  leader.infantryFormation.active = false; leader.destination = undefined;
  for (const unit of state.units) if (unit.infantryDrillLeader === leader.id) unit.infantryDrillLeader = undefined;
}

/** One shared strategic route per large band. Only visible contacts can move
 * the goal away from the known city; hidden enemy positions never guide it.
 * Partial paths end at a reachable wall face so ranks can conduct a breach. */
export function updateMarauderFormations(state: GameState, visible: (observer: Unit, target: Unit | Building) => boolean): void {
  if (state.time < (clocks.get(state) ?? -Infinity)) return;
  clocks.set(state, state.time + 1);
  const members = new Map<number, Unit[]>();
  for (const unit of state.units) if (unit.marauderPack !== undefined && eligible(unit)) {
    const group = members.get(unit.marauderPack);
    if (group) group.push(unit); else members.set(unit.marauderPack, [unit]);
  }
  for (const pack of state.marauderPacks ?? []) {
    const leader = pack.leaderId === undefined ? undefined : entityStore(state).units.get(pack.leaderId);
    if (!leader?.marauderLeader) continue;
    const group = members.get(pack.id) ?? [];
    if (!eligible(leader) || !pack.raid || pack.returning || pack.campDefense || leader.marauderRetreating
      || pack.motivation === 'theft' || pack.motivation === 'harass' || pack.phase === 'muster'
      || group.length < (leader.infantryFormation?.active ? 6 : MARAUDER_FORMATION_MIN_SIZE)) { release(state, leader); continue; }
    // Low-health commanders retain their existing refuge behavior instead of
    // being held in the formation combat branch until they die.
    if (leader.hp < (leader.maxHp ?? 100) * .45 && state.time - (leader.lastDamagedAt ?? -Infinity) <= 3) {
      pack.returning = true; leader.marauderRetreating = true; release(state, leader); continue;
    }
    const contacts = state.units.filter(unit => unit.hp > 0 && !unit.inside && isRaiderEnemyFaction(state, unit.faction)
      && distance(unit, leader) <= 8 && visible(leader, unit)).sort((a, b) => distance(a, leader) - distance(b, leader) || a.id - b.id);
    if (marauderLeaderInDanger(state, leader, contacts)) {
      pack.returning = true; leader.marauderRetreating = true; release(state, leader); continue;
    }
    const target = pack.targetBuilding === undefined ? undefined : entityStore(state).buildings.get(pack.targetBuilding);
    let goal: Point = contacts[0] ?? (pack.motivation === 'siege' && pack.phase !== 'attack' ? pack.rally ?? pack.waypoint
      : target && buildingReady(target) ? center(target) : pack.waypoint);
    if (contacts[0]) {
      const gap = distance(leader, goal), advance = Math.max(0, gap - 1.4);
      goal = gap ? { x: leader.x + (goal.x - leader.x) * advance / gap, y: leader.y + (goal.y - leader.y) * advance / gap } : { x: leader.x, y: leader.y };
    }
    const route = findPath(state, leader, goal, leader.faction, true);
    // A partial search returns no steps once already at its closest reachable
    // cell. Keep the ranks at that wall face while the front line breaches it.
    const atFortification = leader.infantryFormation?.active && state.buildings.some(building => buildingReady(building)
      && isRaiderEnemyFaction(state, building.faction) && (isWallKind(building.kind) || ['tower', 'woodenTower', 'guardPost', 'fort'].includes(building.kind))
      && Math.hypot(Math.max(building.x - leader.x, 0, leader.x - building.x - buildingWidth(building)),
        Math.max(building.y - leader.y, 0, leader.y - building.y - buildingHeight(building))) <= 3 && visible(leader, building));
    const reachable = route.at(-1) ?? (atFortification ? { x: leader.x, y: leader.y } : undefined);
    if (!reachable) { release(state, leader); continue; }
    if (!leader.infantryFormation?.active) {
      leader.infantryFormation = { active: true, heading: Math.atan2(goal.y - leader.y, goal.x - leader.x), mode: 'rectangle', modeSince: state.time,
        slots: [], spine: [], lengths: [], progress: 0, goalDistance: 0, history: [{ x: leader.x, y: leader.y }], slow: false };
      for (const member of group) { member.target = undefined; member.path = undefined; member.pathGoal = undefined; member.destination = undefined; member.infantryDrillLeader = leader.id; }
      announceArmyMobilization(state, leader, 'formation');
    }
    leader.destination = { ...reachable };
  }
}

/** Applies to melee and projectile launch damage, and only to a member that
 * has physically joined its own band's ranks. Ordinary buildings get no bonus. */
export function marauderFortificationMultiplier(state: GameState, unit: Unit, target: Unit | Building): number {
  if (unit.faction !== -2 || !('capacity' in target) || !(isWallKind(target.kind)
    || ['tower', 'woodenTower', 'guardPost', 'fort'].includes(target.kind) || target.kind === 'palace' && target.palaceLevel === 2)) return 1;
  const leader = infantryFormationLeader(state, unit);
  const goal = infantryFormationGoal(state, unit);
  return leader?.marauderLeader && leader.marauderPack === unit.marauderPack
    && (unit === leader || !!goal && distance(unit, goal) <= .9) ? MARAUDER_FORTIFICATION_DAMAGE : 1;
}
