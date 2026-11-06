import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { applyDefenseResearch, updateDefenseResearch } from '../src/game/defense-research';
import { queueConstruction, startConstruction, updateConstruction, updateConstructionResearch } from '../src/game/structures';
import { repairRate, updateBuilder } from '../src/game/builders';
import { setSoldierRole } from '../src/game/archery';
import { unitAttack, unitDamage } from '../src/game/veterancy';
import { buildAt, updateGame } from '../src/game/simulation';
import type { Building, GameState, ResearchBranchId, Unit } from '../src/game/types';

const building = (id: number, kind: Building['kind'], x: number, y: number, maxHp = 160): Building =>
  ({ id, kind, faction: 0, x, y, hp: maxHp, maxHp, capacity: 0 });
const person = (id: number, kind: Unit['kind'], x: number, y: number): Unit => ({ id, kind, faction: 0, x, y,
  hp: 100, maxHp: 100, morale: 100, attack: 17, defense: 4, speed: 3, range: 1.1,
  order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 });
function fixture(): GameState {
  return { world: { width: 28, height: 22, seed: 'military-research', source: 'test', spawns: [],
    tiles: Array.from({ length: 28 * 22 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5,
      food: 3, production: 1, gold: 0, variation: .3 })) },
    buildings: [{ ...building(1, 'palace', 6, 8, 650), governorPermissions: { farms: false, housing: false } }, building(2, 'library', 10, 8, 250)],
    units: [{ ...person(10, 'leader', 10.5, 10.5), range: 4 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 1000, gold: 2000, production: 0,
      population: 5, culture: 1000, yields: { food: 0, production: 0, gold: 0 }, nextRaid: Infinity, nextRetinueAt: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'military-research', rngState: 1,
    marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 1 },
  };
}
function learn(state: GameState, ...branches: ResearchBranchId[]): void {
  const research = state.factions[0].research ??= { focus: 'wall', levels: {}, progress: {} };
  for (const branch of branches) research.levels[branch] = 1;
}

describe('Reinforced Defenses', () => {
  it('updates existing defenses once, preserving wounds, authored base health, and owner changes', () => {
    const state = fixture(); learn(state, 'reinforcedDefenses');
    const wall = { ...building(20, 'wall', 12, 8, 450), hp: 225 };
    const tower = { ...building(21, 'woodenTower', 13, 8, 600), hp: 150 };
    const house = building(22, 'house', 14, 8);
    entityStore(state).buildings.add(wall, tower, house);
    updateDefenseResearch(state); updateDefenseResearch(state);
    expect(wall).toMatchObject({ defenseBaseMaxHp: 450, maxHp: 5850, hp: 2925 });
    expect(tower).toMatchObject({ defenseBaseMaxHp: 600, maxHp: 780, hp: 195 });
    expect(house).toMatchObject({ maxHp: 160, hp: 160 });
    const restored: Building = JSON.parse(JSON.stringify(tower));
    applyDefenseResearch(restored, state.factions[0]);
    expect(restored).toEqual(tower);
    applyDefenseResearch(wall, undefined);
    expect(wall).toMatchObject({ maxHp: 4500, hp: 2250 });
    applyDefenseResearch(wall, state.factions[0]);
    expect(wall.hp / wall.maxHp).toBe(.5);
  });

  it('gives newly ordered walls and towers the researched maximum immediately', () => {
    const state = fixture(); learn(state, 'wall', 'woodenTower', 'reinforcedDefenses');
    expect(buildAt(state, 'wall', 12, 10).ok).toBe(true);
    expect(buildAt(state, 'woodenTower', 13, 10).ok).toBe(true);
    const wall = state.buildings.find(b => b.kind === 'wall')!, tower = state.buildings.find(b => b.kind === 'woodenTower')!;
    expect(wall).toMatchObject({ maxHp: 2925, hp: 2925, defenseBaseMaxHp: 225 });
    expect(tower).toMatchObject({ maxHp: 780, hp: 780, defenseBaseMaxHp: 600 });
  });
});

describe('Metal Tools', () => {
  it('speeds only remaining construction work and preserves progress on repeated refresh', () => {
    const state = fixture(), site = building(20, 'house', 13, 11);
    entityStore(state).buildings.add(site); startConstruction(site, 0);
    state.time = 10; learn(state, 'metalTools');
    updateConstructionResearch(state);
    expect(site.construction).toMatchObject({ startedAt: 2, duration: (40 / 3) / 1.25, researchSpeed: 1.25 });
    expect((state.time - site.construction!.startedAt) / site.construction!.duration).toBeCloseTo(.75);
    updateConstructionResearch(state);
    expect(site.construction!.startedAt).toBe(2);
    state.time = 2 + (40 / 3) / 1.25 - .01; updateConstruction(state); expect(site.construction).toBeDefined();
    state.time = 2 + (40 / 3) / 1.25; updateConstruction(state); expect(site.construction).toBeUndefined();
  });

  it('does not advance queued or paused work, including when its owner loses the bonus', () => {
    const state = fixture(), queued = building(20, 'house', 13, 11), paused = building(21, 'house', 14, 11);
    queueConstruction(queued, 4); queueConstruction(paused, 0);
    paused.construction!.pausedAt = 5;
    entityStore(state).buildings.add(queued, paused);
    state.time = 12; learn(state, 'metalTools'); updateConstructionResearch(state);
    expect(queued.construction).toMatchObject({ startedAt: 4, duration: (40 / 3) / 1.25, waitingForBuilder: true });
    expect(paused.construction).toMatchObject({ startedAt: 1, duration: (40 / 3) / 1.25, pausedAt: 5 });
    state.time = 30; updateConstruction(state);
    expect(paused.construction!.startedAt).toBe(1);
    delete state.factions[0].research!.levels.metalTools;
    updateConstructionResearch(state);
    expect(queued.construction).toMatchObject({ startedAt: 4 });
    expect(queued.construction!.duration).toBeCloseTo(40 / 3);
    expect(paused.construction).toMatchObject({ startedAt: 0, pausedAt: 5 });
    expect(paused.construction!.duration).toBeCloseTo(40 / 3);
  });

  it('makes an assigned builder repair 25% faster without changing its travel speed', () => {
    const state = fixture(), house = { ...building(20, 'house', 12, 12), hp: 80, repairerId: 30 };
    const worker: Unit = { ...person(30, 'worker', 11.5, 12.5), attack: 0, home: 1, builder: true, repairSite: 20, buildPhase: 'repairing' };
    entityStore(state).buildings.add(house); entityStore(state).units.add(worker);
    const speed = worker.speed; state.time = 20; learn(state, 'metalTools');
    updateBuilder(state, worker, 1, () => { throw new Error('An adjacent repairer must not move.'); });
    expect(house.hp).toBeCloseTo(80 + repairRate(house) * 1.25);
    expect(worker.speed).toBe(speed);
  });
});

describe('Fletching', () => {
  it('adds 15% to archer damage after armor and preserves equipment, veterancy, and role conversion', () => {
    const state = fixture(), unit = { ...person(20, 'warrior', 13.5, 14.5), kills: 300, weaponLevel: 3 as const };
    learn(state, 'fletching');
    setSoldierRole(unit, 'archer');
    const baseAttack = unit.attack, baseDamage = unitDamage(unit, 12);
    expect(unitDamage(unit, 12, state.factions[0])).toBeCloseTo(baseDamage * 1.15);
    expect(unitAttack(unit, state.factions[0])).toBeCloseTo(unitAttack(unit) * 1.15);
    for (let i = 0; i < 4; i++) { setSoldierRole(unit, 'warrior'); setSoldierRole(unit, 'archer'); }
    expect(unit.attack).toBe(baseAttack);
    expect(unitDamage(unit, 12, state.factions[0])).toBeCloseTo(baseDamage * 1.15);
    setSoldierRole(unit, 'warrior');
    expect(unitDamage(unit, 12, state.factions[0])).toBe(unitDamage(unit, 12));
    setSoldierRole(unit, 'scout');
    expect(unitDamage(unit, 0, state.factions[0])).toBe(0);
  });

  it('uses the bonus in the actual arrow projectile damage', () => {
    const state = fixture(), archer = person(20, 'warrior', 12.5, 14.5);
    setSoldierRole(archer, 'archer');
    const enemy = { ...person(21, 'warrior', 15.5, 14.5), faction: -2, hp: 1000, maxHp: 1000, attack: 0, speed: 0 };
    learn(state, 'archeryRange', 'fletching'); state.factions[0].archerFraction = 1;
    entityStore(state).units.add(archer, enemy);
    updateGame(state, .05, { up: false, down: false, left: false, right: false });
    const arrow = state.projectiles?.find(p => p.attacker === archer.id && p.kind === 'arrow');
    expect(arrow).toBeDefined();
    expect(arrow!.damage).toBeCloseTo(unitDamage(archer, enemy.defense) * 1.15);
  });
});
