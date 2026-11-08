import { nearbyUnits } from './spatial';
import { buildingHeight, buildingWidth, distance, type Building, type GameState, type Point, type Unit } from './types';

export const CAVALRY_CHARGE_DISTANCE = 3;
export const CAVALRY_CHARGE_COOLDOWN = 8;
export const CAVALRY_CHARGE_DAMAGE_MULTIPLIER = 2;
export const CAVALRY_CHARGE_SPLASH_MULTIPLIER = .6;
export const CAVALRY_CHARGE_RADIUS = 1.5;
export const CAVALRY_CHARGE_GRACE = .35;
const ALIGNMENT = Math.cos(Math.PI / 4);

/** Stored on the soldier so a save cannot reset an already spent charge. */
export interface CavalryMomentum { distance: number; dx: number; dy: number; lastMoveAt: number; readyAt: number }
type CavalryUnit = Unit & { cavalryCharge?: CavalryMomentum };
export interface CavalryCombat {
  hostile: (a: number, b: number) => boolean;
  clear: (target: Unit) => boolean;
  /** The normal hit pipeline retains armor, veterancy, kills and casualty effects. */
  hit: (target: Unit | Building, multiplier: number) => void;
}
const building = (target: Unit | Building): target is Building => 'capacity' in target;
const center = (target: Unit | Building): Point => building(target)
  ? { x: target.x + buildingWidth(target) / 2, y: target.y + buildingHeight(target) / 2 } : target;

/** Account for distance actually moved, never an order or a blocked path.
 * Sharp turns, waiting and teleports cannot manufacture a running charge. */
export function recordCavalryMovement(state: GameState, unit: Unit, from: Point, dt: number): void {
  const rider = unit as CavalryUnit;
  if ((unit.kind !== 'horseman' && unit.kind !== 'knight')) { delete rider.cavalryCharge; return; }
  const momentum = rider.cavalryCharge ??= { distance: 0, dx: 0, dy: 0, lastMoveAt: -Infinity, readyAt: 0 };
  const dx = unit.x - from.x, dy = unit.y - from.y, length = Math.hypot(dx, dy);
  if (unit.hp <= 0 || unit.inside || unit.order === 'flee' || dt <= 0 || !Number.isFinite(length)
    || length > unit.speed * dt * 1.6 + .15 || state.time < momentum.readyAt) {
    momentum.distance = 0; return;
  }
  if (length < .001) {
    if (state.time - momentum.lastMoveAt > CAVALRY_CHARGE_GRACE) momentum.distance = 0;
    return;
  }
  const ux = dx / length, uy = dy / length;
  if (state.time - momentum.lastMoveAt > CAVALRY_CHARGE_GRACE
    || ux * momentum.dx + uy * momentum.dy < ALIGNMENT) momentum.distance = 0;
  momentum.distance = Math.min(CAVALRY_CHARGE_DISTANCE, momentum.distance + length);
  momentum.dx = ux; momentum.dy = uy; momentum.lastMoveAt = state.time;
}

/** Called only after the ordinary attack range/contact checks. A charge is one
 * melee hit, not an extra bypass around the authoritative damage pipeline. */
export function tryCavalryCharge(state: GameState, attacker: Unit, primary: Unit | Building, combat: CavalryCombat): boolean {
  const momentum = (attacker as CavalryUnit).cavalryCharge;
  if ((attacker.kind !== 'horseman' && attacker.kind !== 'knight') || attacker.hp <= 0 || attacker.inside || attacker.order === 'flee' || !momentum
    || momentum.distance + 1e-7 < CAVALRY_CHARGE_DISTANCE || state.time < momentum.readyAt
    || state.time - momentum.lastMoveAt > CAVALRY_CHARGE_GRACE || primary.hp <= 0 || !combat.hostile(attacker.faction, primary.faction)) return false;
  const impact = center(primary), dx = impact.x - attacker.x, dy = impact.y - attacker.y, length = Math.hypot(dx, dy);
  if (length < .001 || (dx * momentum.dx + dy * momentum.dy) / length < ALIGNMENT) return false;
  // Snapshot all victims before applying a hit: death callbacks may change
  // allegiance, current targets or spatial membership during this loop.
  const secondary = nearbyUnits(state, impact, CAVALRY_CHARGE_RADIUS).filter(victim => victim.id !== primary.id
    && victim.id !== attacker.id && victim.hp > 0 && !victim.inside && combat.hostile(attacker.faction, victim.faction)
    && distance(impact, victim) <= CAVALRY_CHARGE_RADIUS && combat.clear(victim));
  momentum.distance = 0; momentum.readyAt = state.time + CAVALRY_CHARGE_COOLDOWN;
  combat.hit(primary, CAVALRY_CHARGE_DAMAGE_MULTIPLIER);
  for (const victim of secondary) if (victim.hp > 0 && !victim.inside && combat.hostile(attacker.faction, victim.faction))
    combat.hit(victim, CAVALRY_CHARGE_SPLASH_MULTIPLIER);
  return true;
}
