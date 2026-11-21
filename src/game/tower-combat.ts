import { hostileFactionPresent } from './hostile-presence';
import { simulationReadsActive } from './simulation-reads';
import { decisionDue, type DecisionClock } from './decision-schedule';
import { entityStore } from './entity-store';
import { downhillRangeBonus, HIGH_GROUND_RANGE_BONUS } from './combat-range';
import { buildingReady, buildingWidth, buildingHeight, type Building, type Faction, type GameState, type Point, type Unit } from './types';
import { buildingTargetable } from './building-targeting';
import { nearbyBuildings, nearbyUnits } from './spatial';
import { recordTowerShot } from './tower-threats';
import { buildingWeaponMultiplier } from './defense-equipment';
import { isKeep } from './settlement-upgrades';
import { battleSupport } from './battle-support-native';
import { rustEngine } from './rust-engine';

export const WOODEN_TOWER_RANGE = rustEngine.combat_constant(16);
export const WOODEN_TOWER_ATTACK = 12.5;
export const WOODEN_TOWER_COOLDOWN = .75;
export const woodenTowerAttack = (tower: Building, owner: Pick<Faction, 'armorLevel' | 'weaponLevel'> | undefined): number =>
  WOODEN_TOWER_ATTACK * buildingWeaponMultiplier(tower, owner);
export const towerDamage = (attack: number, defense: number): number => rustEngine.combat_tower_damage(attack, defense);

const targetClocks = new WeakMap<Building, DecisionClock>();

interface TowerCombat {
  hostile: (a: number, b: number) => boolean;
  clearShot: (tower: Building, from: Point, target: Unit | Building) => boolean;
  shoot: (tower: Building, from: Point, target: Unit | Building, attack: number) => void;
}

/** Indexed observations are sampled only on a due shot. Native combat ranks
 * military threats, civilians and hostile buildings, with nearest targets first. */
export function updateWoodenTowers(state: GameState, dt: number, combat: TowerCombat): void {
  for (const tower of entityStore(state).buildings.query('towerWeapon')) {
    if (tower.kind !== 'woodenTower' && tower.kind !== 'tower' && tower.kind !== 'fort' && !isKeep(tower) || !buildingReady(tower)
      || tower.kind === 'fort' && tower.fort?.funded === false) continue;
    tower.attackCooldown = rustEngine.tower_cooldown(tower.attackCooldown ?? 0, dt, 0);
    if (tower.attackCooldown > 1e-8) continue;
    let clock = targetClocks.get(tower);
    if (!clock) { clock = {}; targetClocks.set(tower, clock); }
    if (simulationReadsActive(state) && !decisionDue(clock, state.time, tower.id)) continue;
    // Only hostile candidates are ranked for a shot.
    if (!hostileFactionPresent(state, tower.faction)) continue;
    const from = { x: tower.x + buildingWidth(tower) / 2, y: tower.y + buildingHeight(tower) / 2 };
    const candidates: (Unit | Building)[] = [
      ...nearbyUnits(state, from, WOODEN_TOWER_RANGE + HIGH_GROUND_RANGE_BONUS).filter(unit => unit.hp > 0 && !unit.inside),
      ...nearbyBuildings(state, from, WOODEN_TOWER_RANGE + HIGH_GROUND_RANGE_BONUS).filter(building => buildingTargetable(building)),
    ];
    const ranked = battleSupport(state, 4, from, tower.faction, tower.id, candidates.map(target => ({ target,
      hostile: combat.hostile(tower.faction, target.faction), range: WOODEN_TOWER_RANGE + downhillRangeBonus(state.world, from, target) })));
    const byId = new Map(candidates.map(target => [target.id, target]));
    const attack = woodenTowerAttack(tower, state.factions.find(faction => faction.id === tower.faction));
    let fired = 0;
    for (let row = 0; row < ranked.length; row += 3) {
      const target = byId.get(ranked[row]);
      if (!target || !combat.clearShot(tower, from, target)) continue;
      combat.shoot(tower, from, target, attack);
      recordTowerShot(state, tower, target);
      if (++fired >= (tower.kind === 'fort' ? 2 : 1)) break;
    }
    if (fired) tower.attackCooldown = rustEngine.tower_cooldown(0, 0, 1);
  }
}
