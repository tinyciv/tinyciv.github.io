import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { updateGame } from '../src/game/simulation';
import { updateWoodenTowers } from '../src/game/tower-combat';
import type { Building, GameState, Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const unit = (id: number, kind: Unit['kind'], x: number, y: number, faction = -2): Unit => ({
  id, kind, x, y, faction, hp: 100, morale: 100, attack: 0, defense: 4, speed: 0,
  range: kind === 'leader' ? 4 : 1.1, order: 'hold', cooldown: 0, lastCombat: -60,
  moving: false, facing: 0, attackTime: 0,
});
const building = (id: number, kind: Building['kind'], x: number, y: number): Building => ({
  id, kind, x, y, faction: 0, hp: 650, maxHp: 650, capacity: 0,
});
function fixture(): GameState {
  return { world: { width: 32, height: 24, seed: 'tower-combat', source: 'test', spawns: [],
    tiles: Array.from({ length: 32 * 24 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .6, food: 3, production: 1, gold: 0, variation: .5 })) },
    units: [unit(10, 'leader', 3.5, 18.5, 0)], buildings: [building(1, 'palace', 3, 10), building(2, 'woodenTower', 12, 12)],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 500,
      production: 500, population: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1000, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'tower-combat', rngState: 1, fields: [],
    marauderPacks: [], fogRaids: { nextAt: 1000, waves: 0, pressureVersion: 1 } };
}

describe('wooden guard tower combat', () => {
  it('fires Keep arrows from the center of its footprint over walls with watchtower damage and cadence', () => {
    const state = fixture(), keep = state.buildings[0];
    entityStore(state).buildings.retain(building => building === keep);
    Object.assign(keep, { palaceLevel: 2, capacity: 10, hp: 6500, maxHp: 6500 });
    const victim = unit(20, 'warrior', 9.5, 11);
    entityStore(state).units.add(victim);
    entityStore(state).buildings.add(building(30, 'wall', 6, 11));
    updateGame(state, .1, idle);
    expect(state.projectiles).toHaveLength(1);
    expect(state.projectiles![0]).toMatchObject({ attacker: keep.id, target: victim.id, kind: 'arrow', towerArrow: true,
      start: { x: 4, y: 11 }, startHeight: 1.2 });
    expect(state.projectiles![0].damage).toBeCloseTo(5.95);
    updateGame(state, .5, idle);
    expect(victim.hp).toBeCloseTo(94.05);
    expect(state.projectiles).toHaveLength(0);
    updateGame(state, .25, idle);
    expect(state.projectiles).toHaveLength(1);
    expect(state.projectiles![0].kind).toBe('arrow');
  });

  it.each(['ordinary', 'unfinished', 'destroyed'] as const)('does not arm an %s settlement', condition => {
    const state = fixture(), keep = state.buildings[0]; entityStore(state).buildings.retain(building => building === keep);
    if (condition !== 'ordinary') keep.palaceLevel = 2;
    if (condition === 'unfinished') keep.construction = { startedAt: 0, duration: 90 };
    if (condition === 'destroyed') keep.hp = 0;
    entityStore(state).units.add(unit(20, 'warrior', 9, 11));
    const shots: number[] = [];
    updateWoodenTowers(state, .1, { hostile: (a, b) => a !== b, clearShot: () => true, shoot: tower => { shots.push(tower.id); } });
    expect(shots).toEqual([]);
  });

  it('throws a javelin at range four for half Leader base damage, with armor applied on impact', () => {
    const state = fixture(), victim = unit(20, 'warrior', 16.5, 12.5);
    entityStore(state).units.add(victim);
    updateGame(state, .1, idle);
    expect(state.projectiles).toHaveLength(1);
    expect(state.projectiles![0]).toMatchObject({ attacker: 2, target: 20, startHeight: 1.2 });
    expect(state.projectiles![0].damage).toBeCloseTo(5.95);
    expect(victim.hp).toBe(100);
    updateGame(state, .4, idle);
    expect(victim.hp).toBeCloseTo(94.05);
    expect(state.bloodEffects).toHaveLength(1);
    expect(state.units[0].lastCombat).toBe(-60);
  });

  it('keeps the Leader cadence and never fires outside range', () => {
    const state = fixture(), victim = unit(20, 'warrior', 18.51, 12.5), fired: number[] = [];
    entityStore(state).units.add(victim);
    const hooks = { hostile: (a: number, b: number) => a !== b, clearShot: () => true,
      shoot: (_tower: Building, _from: { x: number; y: number }, target: Unit) => { fired.push(target.id); } };
    updateWoodenTowers(state, .01, hooks);
    expect(fired).toEqual([]);
    victim.x = 18.5;
    updateWoodenTowers(state, .01, hooks);
    updateWoodenTowers(state, .74, hooks);
    expect(fired).toEqual([20]);
    updateWoodenTowers(state, .01, hooks);
    expect(fired).toEqual([20, 20]);
  });

  it('prefers military over civilians, then nearest military without fixing on Leaders', () => {
    const state = fixture();
    entityStore(state).units.add(unit(20, 'worker', 12.5, 13.5), unit(21, 'warrior', 12.5, 14.5), unit(22, 'leader', 15.5, 12.5));
    updateGame(state, .1, idle);
    expect(state.projectiles![0].target).toBe(21);
    state.buildings[1].attackCooldown = 0;
    state.units.find(u => u.id === 22)!.x = 13.5;
    // The new acquisition may also impact during the sensing wait.
    const previousHp = state.units.find(u => u.id === 22)!.hp;
    updateGame(state, .7, idle);
    expect(state.units.find(u => u.id === 22)!.hp).toBeLessThan(previousHp);
  });

  it('does not arm stone towers, construction sites, or destroyed towers', () => {
    const state = fixture();
    entityStore(state).units.add(unit(20, 'warrior', 14.5, 12.5));
    state.buildings[1].construction = { startedAt: 0, duration: 20, waitingForBuilder: true };
    entityStore(state).buildings.add(building(3, 'tower', 13, 13), { ...building(4, 'woodenTower', 13, 11), hp: 0 });
    updateGame(state, .5, idle);
    expect(state.projectiles ?? []).toHaveLength(0);
    expect(state.units.find(u => u.id === 20)!.hp).toBe(100);
  });

  it('ignores friendly, peaceful, dead, and sheltered units', () => {
    const state = fixture();
    entityStore(state).units.add(unit(20, 'warrior', 14.5, 12.5, 0), unit(21, 'warrior', 12.5, 14.5, 1),
      { ...unit(22, 'warrior', 11.5, 12.5), hp: 0 }, { ...unit(23, 'worker', 12.5, 11.5), inside: true });
    updateGame(state, .1, idle);
    expect(state.projectiles ?? []).toHaveLength(0);
  });

  it('shoots across water but blocks shots through other buildings', () => {
    const state = fixture(), blocked = unit(20, 'warrior', 16.5, 12.5), exposed = unit(21, 'worker', 12.5, 15.5);
    entityStore(state).units.add(blocked, exposed);
    entityStore(state).buildings.add(building(3, 'house', 14, 12));
    state.world.tiles[14 * state.world.width + 12].terrain = 'river';
    updateGame(state, .1, idle);
    expect(state.projectiles![0].target).toBe(21);
    updateGame(state, .3, idle);
    expect(exposed.hp).toBeCloseTo(94.05);
    expect(blocked.hp).toBe(100);
  });

  it.each(['wall', 'palisade'] as const)('arcs javelins over a %s without opening a movement route', kind => {
    const state = fixture(), victim = unit(20, 'warrior', 16.5, 12.5);
    entityStore(state).units.add(victim);
    entityStore(state).buildings.add(building(3, kind, 14, 12));
    updateGame(state, .5, idle);
    expect(victim.hp).toBeCloseTo(94.05);
    expect(state.bloodEffects).toHaveLength(1);
  });

  it('rechecks obstructions at impact and drops blocked javelins without blood', () => {
    const state = fixture(), victim = unit(20, 'warrior', 16.5, 12.5);
    entityStore(state).units.add(victim);
    updateGame(state, .1, idle);
    entityStore(state).buildings.add(building(3, 'house', 14, 12));
    updateGame(state, .4, idle);
    expect(victim.hp).toBe(100);
    expect(state.bloodEffects ?? []).toHaveLength(0);
  });

  it('awards tower kills and keeps an airborne javelin lethal after its tower is destroyed', () => {
    const state = fixture(), victim = unit(20, 'warrior', 15.5, 12.5);
    victim.hp = 5; victim.lastDamagedAt = state.time; entityStore(state).units.add(victim);
    updateGame(state, .1, idle);
    state.buildings[1].hp = 0;
    updateGame(state, .3, idle);
    expect(victim.hp).toBe(0);
    expect(state.factions[0].gold).toBe(506);
    expect(state.bloodEffects).toHaveLength(1);
    expect(state.particles.filter(particle => particle.kind !== 'damage')).toHaveLength(1);
    expect(state.particles.some(particle => particle.kind === 'damage')).toBe(true);
    updateGame(state, 1 / 3, idle); // Death removal uses the capped maintenance scan.
    expect(state.units).not.toContain(victim);
  });
});
