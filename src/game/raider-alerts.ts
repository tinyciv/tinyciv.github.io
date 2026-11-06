import { canRallyFromRout } from './battle-morale';
import { entityStore } from './entity-store';
import { isRaiderEnemyFaction } from './raid-targeting';
import { releaseRaiderReserve } from './raider-activity';
import { buildingWidth, buildingHeight, distance, type Building, type GameState, type Point, type Unit } from './types';

/** A battle is audible well beyond an individual soldier's 5.5-tile search. */
export const RAIDER_ALARM_RADIUS = 14;
export const RAIDER_ALARM_SECONDS = 18;
const ALARM_INTERVAL = .5;
interface Alarm { goal: Point; faction: number; target?: number; until: number }
interface AlarmState { alerts: WeakMap<Unit, Alarm>; nextByGroup: Map<string, number> }
const alarms = new WeakMap<GameState, AlarmState>();
const center = (entity: Unit | Building): Point => 'capacity' in entity
  ? { x: entity.x + buildingWidth(entity) / 2, y: entity.y + buildingHeight(entity) / 2 } : entity;

/** Called only after real damage. One bounded broadcast per nearby group,
 * with no route searches or every-frame scans. Distant allies learn the last
 * attack position, not the hidden attacker's continuing movements. */
export function notifyRaiderAttack(state: GameState, victim: Unit | Building,
  attacker: Point & { faction: number; id?: number }): number {
  if (victim.faction !== -2 || !isRaiderEnemyFaction(state, attacker.faction)) return 0;
  let frame = alarms.get(state);
  if (!frame) { frame = { alerts: new WeakMap(), nextByGroup: new Map() }; alarms.set(state, frame); }
  const pack = 'marauderPack' in victim ? state.marauderPacks?.find(pack => pack.id === victim.marauderPack) : undefined;
  const camp = 'capacity' in victim ? victim.raiderCamp : pack?.raiderCamp;
  const key = camp !== undefined ? `camp:${camp}` : `pack:${pack?.id ?? victim.id}`;
  if (state.time < (frame.nextByGroup.get(key) ?? -Infinity)) return 0;
  frame.nextByGroup.set(key, state.time + ALARM_INTERVAL);
  const heardAt = center(victim);
  const source = attacker.id === undefined ? undefined : entityStore(state).units.get(attacker.id) ?? entityStore(state).buildings.get(attacker.id);
  const goal = source ? center(source) : attacker;
  let responding = 0;
  for (const unit of state.units) {
    if (unit.hp <= 0 || unit.faction !== -2 || unit.marauderPack === undefined || unit.order === 'flee' || unit.routed
      || !canRallyFromRout(state, unit) || unit.marauderRetreating || distance(unit, heardAt) > RAIDER_ALARM_RADIUS
      || unit.marauderLeader && unit.hp <= (unit.maxHp ?? 100) * .45) continue;
    if (unit.inside && !releaseRaiderReserve(state, unit)) continue;
    const old = frame.alerts.get(unit);
    if (unit.target === undefined && (!old || old.target !== attacker.id || distance(old.goal, goal) > 2)) {
      unit.target = undefined; unit.destination = undefined; unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
    }
    frame.alerts.set(unit, { goal: { x: goal.x, y: goal.y }, faction: attacker.faction, target: attacker.id, until: state.time + RAIDER_ALARM_SECONDS });
    responding++;
  }
  return responding;
}

export function updateRaiderAlert(state: GameState, unit: Unit, dt: number, orders: {
  move: (goal: Point, dt: number) => void;
  attack: (target: Unit | Building, dt: number) => void;
  visible: (target: Unit | Building) => boolean;
  localEnemy?: () => Unit | Building | undefined;
}): boolean {
  const frame = alarms.get(state), alert = frame?.alerts.get(unit);
  if (!alert) return false;
  if (unit.hp <= 0 || unit.inside || unit.order === 'flee' || unit.routed || unit.marauderRetreating || state.time >= alert.until) {
    frame!.alerts.delete(unit); return false;
  }
  // The alarm brings distant allies to the fight; normal combat selection
  // distributes arriving troops among reachable contact positions. Forcing
  // everyone onto the latest attacker crowds one target and idles rear ranks.
  if (orders.localEnemy?.()) { frame!.alerts.delete(unit); return false; }
  const target = alert.target === undefined ? undefined : entityStore(state).units.get(alert.target) ?? entityStore(state).buildings.get(alert.target);
  if (target && target.hp > 0 && target.faction === alert.faction && isRaiderEnemyFaction(state, target.faction)
    && ('capacity' in target || !target.inside) && orders.visible(target)) {
    const point = center(target); alert.goal = { x: point.x, y: point.y };
    orders.attack(target, dt); return true;
  }
  if (target && (target.hp <= 0 || target.faction !== alert.faction) || distance(unit, alert.goal) <= .8) {
    frame!.alerts.delete(unit); return false;
  }
  unit.target = undefined;
  orders.move(alert.goal, dt); return true;
}
