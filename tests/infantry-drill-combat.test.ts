import { describe, expect, it } from 'vitest';
import { scoutRealm } from './helpers/scouts';
import { entityStore } from '../src/game/entity-store';
import { toggleInfantryFormation } from '../src/game/infantry-drill';
import { updateGame } from '../src/game/simulation';
import { unitDamage, unitDefense } from '../src/game/veterancy';
import type { Building, GameState, Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
function fixture() {
  const state = scoutRealm(), leader = state.units[0];
  Object.assign(leader, { x: 20.5, y: 18.5, facing: 0, attack: 20, range: 4 });
  const enemy: Unit = { ...state.units[1], id: 300, faction: -2, x: 23.5, y: 18.5,
    hp: 1000, maxHp: 1000, speed: 0, attack: 0, defense: 4, order: 'hold', cooldown: 1000 };
  // Keep the required eight living retinue members away from the isolated
  // contact being measured; they join the ranks without attacking this target.
  const retinue: Unit[] = Array.from({ length: 8 }, (_, index) => ({ ...state.units[1],
    id: 400 + index, x: 4.5 + index % 4, y: 4.5 + Math.floor(index / 4),
    attack: 0, range: 0, hp: 10000, maxHp: 10000 }));
  entityStore(state).units.replace([leader, enemy, ...retinue]);
  entityStore(state).buildings.replace([{ id: 100, kind: 'palace', faction: 0, x: 2, y: 2,
    hp: 650, maxHp: 650, capacity: 4, governorPermissions: { farms: false, housing: false } }]);
  state.factions[0].research!.levels.infantryDrill = 1;
  expect(toggleInfantryFormation(state).ok).toBe(true);
  return { state, leader, enemy };
}
function advance(state: GameState, seconds: number): void {
  for (let elapsed = 0; elapsed < seconds - 1e-7; elapsed += .05) updateGame(state, .05, idle);
}
function buildingCombat(kind: Unit['kind'] = 'leader', buildingKind: Building['kind'] = 'house') {
  const { state, leader, enemy } = fixture();
  enemy.x = 40.5;
  let attacker = leader;
  if (kind !== 'leader') {
    leader.attack = 0;
    attacker = { ...enemy, id: 2, kind, faction: 0, x: leader.x - .72, y: leader.y,
      hp: 100, maxHp: 100, speed: 3.96, range: kind === 'archer' ? 4 : 1.1,
      attack: 20, cooldown: 0, order: 'follow' };
    entityStore(state).units.add(attacker);
  }
  advance(state, 2);
  const building: Building = { id: 200, kind: buildingKind, faction: -2,
    x: Math.floor(attacker.x) - (attacker.range > 2 ? 3 : 1), y: Math.floor(attacker.y),
    hp: 1000, maxHp: 1000, capacity: 0, attackCooldown: 1000 };
  entityStore(state).buildings.add(building);
  return { state, leader, enemy, attacker, building };
}

describe('Infantry Drill combat integration', () => {
  it('immediately routs the remaining formation when a combat casualty leaves four retinue soldiers', () => {
    const { state, leader, enemy } = fixture();
    const retinue = state.units.filter(unit => unit.id >= 400);
    retinue.slice(0, 3).forEach(unit => { unit.hp = 0; });
    updateGame(state, .05, idle);
    expect(leader.infantryFormation!.active).toBe(true);
    const victim = retinue[3];
    state.projectiles = [{ kind: 'arrow', attacker: enemy.id, faction: enemy.faction,
      target: victim.id, damage: 20000, x: victim.x + .4, y: victim.y,
      start: { x: victim.x + .4, y: victim.y }, end: { x: victim.x, y: victim.y }, elapsed: 0, duration: .01 }];
    updateGame(state, .05, idle);
    expect(victim.hp).toBe(0);
    expect(leader.infantryFormation!.active).toBe(false);
    for (const unit of [leader, ...retinue.slice(4)]) {
      expect(unit.order).toBe('flee'); expect(unit.routed).toBe(true);
      expect(unit.morale).toBeLessThan(1);
      expect(unit.infantryDrillLeader).toBeUndefined();
    }
  });


  it.each(['leader', 'warrior', 'archer', 'spearman', 'horseman'] as const)(
    'lets a formed %s automatically attack a building in reach without leaving its slot', kind => {
      const { state, attacker, building } = buildingCombat(kind);
      const position = { x: attacker.x, y: attacker.y };
      if (kind === 'warrior') {
        // Its near face is in reach even though its center is not.
        expect(Math.hypot(attacker.x - building.x - .5, attacker.y - building.y - .5)).toBeGreaterThan(attacker.range);
      }
      advance(state, .8); // Allow the next target sample and ranged projectile flight.
      expect(building.hp).toBeLessThan(building.maxHp);
      expect(attacker.x).toBeCloseTo(position.x, 6);
      expect(attacker.y).toBeCloseTo(position.y, 6);
      expect(attacker.facing).toBeCloseTo(0, 8);
    });

  it.each(['wall', 'woodenTower', 'library'] as const)('automatically attacks an exposed hostile %s', kind => {
    const { state, building } = buildingCombat('leader', kind);
    // An abandoned wall becomes neutral; retain an enemy settlement nearby,
    // outside the formation's attack range.
    if (kind === 'wall') entityStore(state).buildings.add({ ...building, id: 201, kind: 'house', x: 12 });
    advance(state, .5);
    expect(building.faction).toBe(-2);
    expect(building.hp).toBeLessThan(building.maxHp);
  });

  it('prioritizes nearby hostile soldiers over buildings', () => {
    const { state, leader, enemy, building } = buildingCombat();
    enemy.x = leader.x; enemy.y = leader.y + 2;
    advance(state, .5);
    expect(enemy.hp).toBeLessThan(1000);
    expect(building.hp).toBe(building.maxHp);
  });

  it('does not pursue a distant building or attack friendly and neutral buildings', () => {
    const { state, leader, building } = buildingCombat();
    building.x = 13;
    const friendly: Building = { ...building, id: 201, x: 18, faction: 0 };
    const neutral: Building = { ...building, id: 202, x: 20, y: 16, faction: -1 };
    entityStore(state).buildings.add(friendly, neutral);
    const position = { x: leader.x, y: leader.y };
    advance(state, 2);
    for (const target of [building, friendly, neutral]) expect(target.hp).toBe(target.maxHp);
    expect(leader.x).toBe(position.x); expect(leader.y).toBe(position.y);
    expect(state.projectiles ?? []).toHaveLength(0);
  });

  it('does not attack through another building despite being in range', () => {
    const { state, building } = buildingCombat();
    entityStore(state).buildings.add({ ...building, id: 201, kind: 'house', x: 19, faction: 0 });
    advance(state, 1);
    expect(building.hp).toBe(building.maxHp);
    expect(state.projectiles ?? []).toHaveLength(0);
  });

  it.each(['warrior', 'archer'] as const)('adds 25% to a formed %s’s actual frontal hit without leaving its slot', kind => {
    const { state, leader, enemy } = fixture();
    leader.attack = 0; enemy.x = 40.5;
    const member: Unit = { ...enemy, id: 2, faction: 0, kind, x: leader.x - 1, y: leader.y,
      hp: 100, maxHp: 100, speed: 3.96, range: kind === 'archer' ? 4 : 1.1,
      attack: 20, cooldown: 0, order: 'follow' };
    entityStore(state).units.add(member);
    advance(state, 2);
    const position = { x: member.x, y: member.y };
    enemy.x = member.x + (kind === 'archer' ? 2.5 : .85); enemy.y = member.y;
    // Newly arriving threats are acquired on the next staggered sensing tick.
    for (let elapsed = 0; elapsed < .6 && member.cooldown <= 0; elapsed += .05) updateGame(state, .05, idle);
    expect(member.cooldown).toBeGreaterThan(0);
    const expected = unitDamage(member, unitDefense(enemy), state.factions[0]) * 1.25;
    if (kind === 'archer') {
      expect(state.projectiles?.find(shot => shot.attacker === member.id)?.damage).toBeCloseTo(expected, 8);
      member.cooldown = 1000;
      advance(state, .3);
    }
    expect(1000 - enemy.hp).toBeCloseTo(expected, 8);
    expect(member.x).toBeCloseTo(position.x, 3);
    expect(member.y).toBeCloseTo(position.y, 3);
    expect(member.facing).toBeCloseTo(0, 8);
  });

  it.each(['front', 'flank', 'rear'] as const)('snapshots the correct outgoing bonus for a %s projectile', side => {
    const { state, leader, enemy } = fixture();
    if (side === 'flank') { enemy.x = leader.x; enemy.y = leader.y + 3; }
    if (side === 'rear') enemy.x = leader.x - 3;
    updateGame(state, .05, idle);
    // Marauder equipment scales with game time before combat each step.
    const expected = unitDamage(leader, unitDefense(enemy), state.factions[0]) * (side === 'front' ? 1.25 : 1);
    const shot = state.projectiles?.find(projectile => projectile.attacker === leader.id);
    expect(shot).toBeDefined();
    expect(shot!.damage).toBeCloseTo(expected, 8);
    expect(leader.facing).toBeCloseTo(0, 8);
    toggleInfantryFormation(state);
    leader.cooldown = 1000;
    advance(state, .4);
    expect(1000 - enemy.hp).toBeCloseTo(expected, 8);
  });

  it.each(['front', 'flank', 'rear'] as const)('uses the launch point, not the shooter’s current position, for incoming %s shots', side => {
    const { state, leader, enemy } = fixture();
    leader.attack = 0;
    enemy.x = leader.x - 4;
    const start = side === 'front' ? { x: leader.x + 3, y: leader.y }
      : side === 'flank' ? { x: leader.x, y: leader.y + 3 }
        : { x: leader.x - 3, y: leader.y };
    state.projectiles = [{ ...start, start, end: { x: leader.x, y: leader.y }, kind: 'arrow',
      attacker: enemy.id, faction: enemy.faction, target: leader.id, damage: 20, elapsed: 0, duration: .01 }];
    const hp = leader.hp;
    updateGame(state, .05, idle);
    expect(hp - leader.hp).toBeCloseTo(side === 'front' ? 20 / 1.5 : 20, 8);
  });

  it.each(['front', 'flank', 'rear'] as const)('applies directional defense to actual %s melee hits', side => {
    const { state, leader, enemy } = fixture();
    leader.attack = 0;
    enemy.attack = 20; enemy.cooldown = 0; enemy.range = 1.1;
    enemy.x = leader.x + (side === 'front' ? .85 : side === 'rear' ? -.85 : 0);
    enemy.y = leader.y + (side === 'flank' ? .85 : 0);
    const hp = leader.hp;
    updateGame(state, .05, idle);
    const expected = unitDamage(enemy, unitDefense(leader)) / (side === 'front' ? 1.5 : 1);
    expect(hp - leader.hp).toBeCloseTo(expected, 8);
  });
});
