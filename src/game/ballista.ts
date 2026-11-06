import { simulationReadsActive } from './simulation-reads';
import { decisionDue, type DecisionClock } from './decision-schedule';
import { downhillRangeBonus, HIGH_GROUND_RANGE_BONUS } from './combat-range';
import { entityStore } from './entity-store';
import { nearbyBuildings, nearbyUnits } from './spatial';
import { equipmentMultiplier } from './equipment';
import { archerDamageMultiplier } from './research-bonuses';
import { buildingPresent, buildingReady, buildingWidth, buildingHeight, distance, isFarmKind, isWallKind,
  type Building, type Faction, type GameState, type Point, type Unit } from './types';

export const BALLISTA_RANGE = 18;
export const BALLISTA_COOLDOWN = 4;
export const BALLISTA_COST = 300;
export const BALLISTA_BUILD_SECONDS = 30;
export const BALLISTA_HP = 200;
/** A standard archer has 17×0.8 attack and a .95s interval. Armor is applied
 * per hit, so the slower, heavier bolt is more effective against defenses. */
export const BALLISTA_ATTACK = 17 * .8 * BALLISTA_COOLDOWN / .95;
export const ballistaAttack = (owner: Faction | undefined): number => BALLISTA_ATTACK
  * equipmentMultiplier(owner?.weaponLevel) * archerDamageMultiplier(owner);

const targetClocks = new WeakMap<Building, DecisionClock>();

interface BallistaCombat {
  hostile: (a: number, b: number) => boolean;
  clearShot: (ballista: Building, from: Point, target: Building | Unit) => boolean;
  shoot: (ballista: Building, from: Point, target: Building | Unit, attack: number) => void;
}
const center = (target: Unit | Building): Point => 'capacity' in target
  ? { x: target.x + buildingWidth(target) / 2, y: target.y + buildingHeight(target) / 2 } : target;
const priority = (target: Unit | Building): number => !('capacity' in target) ? 3
  : target.kind === 'woodenTower' || target.kind === 'tower' || target.kind === 'ballista' ? 0
    : target.kind === 'guardPost' ? 1 : isWallKind(target.kind) ? 2 : 4;

/** Indexed candidates are considered only when the slow firing clock is due. */
export function updateBallistae(state: GameState, dt: number, combat: BallistaCombat): void {
  for (const ballista of entityStore(state).buildings.query('ballista')) {
    if (!buildingReady(ballista)) continue;
    ballista.attackCooldown = Math.max(0, (ballista.attackCooldown ?? 0) - dt);
    if (ballista.attackCooldown > 1e-8) continue;
    let clock = targetClocks.get(ballista);
    if (!clock) { clock = {}; targetClocks.set(ballista, clock); }
    if (simulationReadsActive(state) && !decisionDue(clock, state.time, ballista.id)) continue;
    const from = center(ballista);
    const candidates: (Building | Unit)[] = [
      ...nearbyBuildings(state, from, BALLISTA_RANGE + HIGH_GROUND_RANGE_BONUS).filter(building => buildingPresent(building)
        && !isFarmKind(building.kind) && !['road', 'bridge', 'irrigation', 'ruin'].includes(building.kind)),
      ...nearbyUnits(state, from, BALLISTA_RANGE + HIGH_GROUND_RANGE_BONUS).filter(unit => unit.hp > 0 && !unit.inside),
    ];
    const target = candidates.filter(target => combat.hostile(ballista.faction, target.faction)
      && distance(from, center(target)) <= BALLISTA_RANGE + downhillRangeBonus(state.world, from, target))
      .sort((a, b) => priority(a) - priority(b) || distance(from, center(a)) - distance(from, center(b)) || a.id - b.id)
      .find(target => combat.clearShot(ballista, from, target));
    if (!target) continue;
    const aim = center(target); ballista.siegeFacing = Math.atan2(aim.y - from.y, aim.x - from.x);
    ballista.siegeShotAt = state.time; ballista.attackCooldown = BALLISTA_COOLDOWN;
    combat.shoot(ballista, from, target, ballistaAttack(state.factions.find(faction => faction.id === ballista.faction)));
  }
}
