import { simulationReadsActive } from './simulation-reads';
import { decisionDue, type DecisionClock } from './decision-schedule';
import { entityStore } from './entity-store';
import { downhillRangeBonus, HIGH_GROUND_RANGE_BONUS } from './combat-range';
import { isSoldier } from './types';
import { buildingReady, buildingWidth, buildingHeight, distance, type Building, type Faction, type GameState, type Point, type Unit } from './types';
import { nearbyUnits } from './spatial';
import { recordTowerShot } from './tower-threats';
import { buildingWeaponMultiplier } from './defense-equipment';
import { isKeep } from './settlement-upgrades';

export const WOODEN_TOWER_RANGE = 6;
export const WOODEN_TOWER_ATTACK = 12.5;
export const WOODEN_TOWER_COOLDOWN = .75;
export const woodenTowerAttack = (tower: Building, owner: Pick<Faction, 'armorLevel' | 'weaponLevel'> | undefined): number =>
  WOODEN_TOWER_ATTACK * buildingWeaponMultiplier(tower, owner);

const targetClocks = new WeakMap<Building, DecisionClock>();

interface TowerCombat {
  hostile: (a: number, b: number) => boolean;
  clearShot: (tower: Building, from: Point, target: Unit) => boolean;
  shoot: (tower: Building, from: Point, target: Unit, attack: number) => void;
}

/** Towers and Keeps cover their immediate surroundings. Military threats come first;
 * within each tier the closest exposed unit receives the shot. */
export function updateWoodenTowers(state: GameState, dt: number, combat: TowerCombat): void {
  for (const tower of entityStore(state).buildings.query('towerWeapon')) {
    if (tower.kind !== 'woodenTower' && tower.kind !== 'fort' && !isKeep(tower) || !buildingReady(tower)
      || tower.kind === 'fort' && tower.fort?.funded === false) continue;
    tower.attackCooldown = Math.max(0, (tower.attackCooldown ?? 0) - dt);
    if (tower.attackCooldown > 1e-8) continue;
    let clock = targetClocks.get(tower);
    if (!clock) { clock = {}; targetClocks.set(tower, clock); }
    if (simulationReadsActive(state) && !decisionDue(clock, state.time, tower.id)) continue;
    const from = { x: tower.x + buildingWidth(tower) / 2, y: tower.y + buildingHeight(tower) / 2 };
    const targets: { unit: Unit; tier: number; distance: number }[] = [];
    for (const unit of nearbyUnits(state, from, WOODEN_TOWER_RANGE + HIGH_GROUND_RANGE_BONUS)) {
      if (unit.hp <= 0 || unit.inside || !combat.hostile(tower.faction, unit.faction)) continue;
      const d = distance(from, unit);
      if (d > WOODEN_TOWER_RANGE + downhillRangeBonus(state.world, from, unit)) continue;
      const tier = unit.kind === 'leader' || isSoldier(unit) || unit.kind === 'militia' ? 0 : 1;
      targets.push({ unit, tier, distance: d });
    }
    if (!targets.length) continue;
    targets.sort((a, b) => a.tier - b.tier || a.distance - b.distance || a.unit.id - b.unit.id);
    const attack = woodenTowerAttack(tower, state.factions.find(faction => faction.id === tower.faction));
    let fired = 0;
    for (const { unit } of targets) {
      if (!combat.clearShot(tower, from, unit)) continue;
      combat.shoot(tower, from, unit, attack);
      recordTowerShot(state, tower, unit);
      if (++fired >= (tower.kind === 'fort' ? 2 : 1)) break;
    }
    if (fired) tower.attackCooldown = WOODEN_TOWER_COOLDOWN;
  }
}
