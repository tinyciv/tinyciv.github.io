import { entityStore } from './entity-store';
import { indexedLeader, nearbyUnits } from './spatial';
import { canWalk } from './pathfinding';
import { buildingReady, distance, type BuildingKind, type GameState, type Point, type Unit } from './types';

export const ENGINEER_RESPAWN_SECONDS = 60;
export const hasLeaderAbility = (leader: Unit | undefined, ability: 'engineer' | 'brace' | 'discretion'): boolean =>
  !!leader && leader.kind === 'leader' && leader.hp > 0 && (leader.leaderProgression?.skills[ability] ?? 0) > 0;

export function livingEngineer(state: GameState, faction: number): Unit | undefined {
  const leader = indexedLeader(state, faction);
  if (!hasLeaderAbility(leader, 'engineer')) return;
  return entityStore(state).units.query('worker').find(unit => unit.hp > 0 && unit.faction === faction && unit.engineer);
}
export const engineerBuildMultiplier = (state: GameState, kind: BuildingKind, faction: number): number =>
  (kind === 'road' || kind === 'bridge') && livingEngineer(state, faction) ? .5 : 1;
export const fleeingAbilityMultiplier = (unit: Unit): number => unit.order === 'flee' && hasLeaderAbility(unit, 'discretion') ? 1.5 : 1;

/** Compare positions, not orders: attacking while stationary still braces. */
export function updateLeaderBrace(leader: Unit, dt: number): void {
  if (!hasLeaderAbility(leader, 'brace') || leader.order === 'flee' || leader.embarkedOn !== undefined) { delete leader.brace; return; }
  const brace = leader.brace ??= { x: leader.x, y: leader.y, stillFor: 0, defense: 0 };
  if (Math.hypot(leader.x - brace.x, leader.y - brace.y) > .025) {
    brace.x = leader.x; brace.y = leader.y; brace.stillFor = 0; brace.defense = 0;
  } else { brace.stillFor += dt; brace.defense = Math.min(6, Math.max(0, brace.stillFor - 10) * 2); }
}

export function recordEngineerDeath(state: GameState, unit: Unit): void {
  if (!unit.engineer) return;
  const faction = state.factions.find(candidate => candidate.id === unit.faction);
  if (faction) faction.engineerRespawnAt ??= state.time + ENGINEER_RESPAWN_SECONDS;
}

/** A companion consumes neither a job slot nor resident population. */
export function synchronizeEngineers(state: GameState, spawn: (faction: number, point: Point, home: number) => Unit): void {
  const store = entityStore(state);
  for (const unit of store.units.query('worker')) if (unit.engineer && unit.hp <= 0) recordEngineerDeath(state, unit);
  for (const leader of store.units.query('leader')) {
    if (!hasLeaderAbility(leader, 'engineer')) continue;
    const faction = state.factions.find(candidate => candidate.id === leader.faction);
    if (!faction) continue;
    const existing = livingEngineer(state, leader.faction);
    if (existing) { existing.engineer!.leader = leader.id; continue; }
    if (state.time < (faction.engineerRespawnAt ?? 0)) continue;
    const city = state.buildings.filter(building => building.kind === 'palace' && building.faction === leader.faction && buildingReady(building))
      .sort((a, b) => distance(a, leader) - distance(b, leader))[0];
    if (!city) continue;
    const points: Point[] = [];
    for (let y = city.y - 1; y <= city.y + 2; y++) for (let x = city.x - 1; x <= city.x + 2; x++)
      if (canWalk(state, x + .5, y + .5, leader.faction)) points.push({ x: x + .5, y: y + .5 });
    const point = points.sort((a, b) => distance(a, leader) - distance(b, leader))[0];
    if (!point) continue;
    const engineer = spawn(leader.faction, point, city.id);
    Object.assign(engineer, { engineer: { leader: leader.id }, name: 'Engineer', hp: 100, maxHp: 100, speed: 4, defense: 4,
      attack: 0, range: 0, order: 'follow', civilianCasualtyRecorded: true });
    store.units.updateRoles(engineer); delete faction.engineerRespawnAt;
  }
}

/** Stay beside the Leader; choose the safe side instead of joining combat. */
export function updateEngineer(state: GameState, engineer: Unit, dt: number,
  move: (state: GameState, unit: Unit, goal: Point, dt: number) => void, hostile: (a: number, b: number) => boolean): void {
  const leader = indexedLeader(state, engineer.faction);
  engineer.target = undefined; engineer.attack = 0; engineer.order = 'follow'; engineer.morale = 100; engineer.inside = false;
  if (!leader || leader.embarkedOn !== undefined) { engineer.moving = false; return; }
  engineer.engineer!.leader = leader.id;
  const threats = nearbyUnits(state, leader, 5).filter(unit => unit.hp > 0 && !unit.inside && unit.attack > 0 && hostile(engineer.faction, unit.faction));
  let goal: Point | undefined, score = -Infinity;
  for (let i = 0; i < 8; i++) {
    const angle = leader.facing + Math.PI + i * Math.PI / 4;
    const candidate = { x: leader.x + Math.cos(angle) * .85, y: leader.y + Math.sin(angle) * .85 };
    if (!canWalk(state, candidate.x, candidate.y, engineer.faction)) continue;
    const safety = threats.length ? Math.min(...threats.map(threat => distance(candidate, threat))) : 5;
    const value = safety * 2 - distance(engineer, candidate) * .2 - i * .002;
    if (value > score) { score = value; goal = candidate; }
  }
  goal ??= { x: leader.x, y: leader.y };
  const nearThreat = threats.some(threat => distance(threat, engineer) < 2.5);
  if (distance(engineer, goal) > (leader.moving || nearThreat ? .2 : .65)) move(state, engineer, goal, dt);
  else { engineer.moving = false; engineer.path = undefined; }
  const working = state.buildings.some(building => building.construction?.engineerId === engineer.id && !building.construction.waitingForBuilder);
  engineer.attackTime = working && !engineer.moving ? .2 : 0;
}
