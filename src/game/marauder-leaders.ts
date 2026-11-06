import { setSoldierRole } from './archery';
import { nearbyUnits } from './spatial';
import { distance, type GameState, type MarauderPack, type Point, type Unit } from './types';

export const MARAUDER_SPEED = 2.35;
export const MARAUDER_LEADER_SPEED = MARAUDER_SPEED * 1.25 * 1.2;
export const MARAUDER_LEADER_HP_MULTIPLIER = 1.2;

/** Promote one existing band member, retaining wave size, wound percentage, and identity.
 * A dead leader ID is retained so reloading cannot generate another bounty. */
export function ensureMarauderLeaders(state: GameState): void {
  const byId = new Map(state.units.map(unit => [unit.id, unit]));
  const membersByPack = new Map<number, Unit[]>();
  for (const unit of state.units) if (unit.hp > 0 && unit.marauderPack !== undefined) {
    const members = membersByPack.get(unit.marauderPack);
    if (members) members.push(unit); else membersByPack.set(unit.marauderPack, [unit]);
  }
  for (const pack of state.marauderPacks ?? []) {
    if (pack.campDefense) continue;
    if (pack.leaderId !== undefined) {
      const existing = byId.get(pack.leaderId);
      if (existing?.marauderLeader && existing.marauderPack === pack.id) { if (existing.kind === 'archer') setSoldierRole(existing, 'warrior'); existing.speed = MARAUDER_LEADER_SPEED; existing.range = 1.1; }
      continue;
    }
    const members = membersByPack.get(pack.id) ?? [];
    const leader = members.find(unit => unit.marauderLeader) ?? members[0];
    if (!leader) continue;
    if (leader.kind === 'archer') setSoldierRole(leader, 'warrior');
    pack.leaderId = leader.id; pack.startingTroops = members.length - 1;
    if (!leader.marauderLeader) {
      leader.attack = Math.round(leader.attack * 1.4);
      leader.maxHp = (leader.maxHp ?? 100) * MARAUDER_LEADER_HP_MULTIPLIER;
      leader.hp *= MARAUDER_LEADER_HP_MULTIPLIER;
      delete leader.warriorStats;
    }
    leader.marauderLeader = true; leader.range = 1.1; leader.speed = MARAUDER_LEADER_SPEED;
  }
}

export function marauderLeaderInDanger(state: GameState, leader: Unit, enemies: readonly Unit[], towers: readonly Point[] = []): boolean {
  const nearbyEnemies = enemies.filter(unit => unit.hp > 0 && unit.attack > 0 && distance(unit, leader) < 4);
  const underFire = towers.some(tower => distance(tower, leader) < 6) || state.time - (leader.lastDamagedAt ?? -Infinity) <= 2;
  if (leader.hp <= (leader.maxHp ?? 100) * .45 && (nearbyEnemies.length > 0 || underFire)) return true;
  if (!nearbyEnemies.length) return false;
  const allies = nearbyUnits(state, leader, 4).filter(unit => unit.hp > 0 && unit.marauderPack === leader.marauderPack && distance(unit, leader) < 4);
  return nearbyEnemies.length > allies.length * 1.5;
}

export function marauderBandDepleted(state: GameState, pack: MarauderPack, members: readonly Unit[] = state.units): boolean {
  const troops = members.filter(unit => unit.hp > 0 && unit.marauderPack === pack.id && !unit.marauderLeader).length;
  const starting = pack.startingTroops ?? troops;
  return starting > 0 && troops <= Math.floor(starting * .3);
}
