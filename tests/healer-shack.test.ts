import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { healerShackHealingQuery, HEALER_SHACK_BUILD_SECONDS, HEALER_SHACK_COST, HEALER_SHACK_HP, HEALER_SHACK_RADIUS } from '../src/game/healer-shack';
import { canWalk } from '../src/game/pathfinding';
import { BUILD_COSTS, buildAt, updateGame, validateBuildAt } from '../src/game/simulation';
import { CONSTRUCTION_SECONDS } from '../src/game/structures';
import { regenerateUnits } from '../src/game/unit-health';
import { buildingWidth, buildingHeight, type Building, type GameState, type Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const person = (id: number, kind: Unit['kind'], faction = 0): Unit => ({ id, kind, faction, x: 11.5, y: 10.5,
  hp: 40, maxHp: 100, morale: 100, attack: 0, defense: 0, speed: 0, range: 1.1, order: 'hold', cooldown: 0,
  lastCombat: -60, lastDamagedAt: 0, moving: false, facing: 0, attackTime: 0 });
const healer = (id = 2, faction = 0): Building => ({ id, kind: 'healerShack', faction, x: 10, y: 10,
  hp: HEALER_SHACK_HP, maxHp: HEALER_SHACK_HP, capacity: 0 });
function fixture(): GameState {
  return {
    world: { width: 40, height: 28, seed: 'healer', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: 40 * 28 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 9, y: 7, hp: 650, maxHp: 650, capacity: 0,
      governorPermissions: { farms: false, housing: false }, populationGrowth: -10000 }],
    units: [person(100, 'leader')], fields: [],
    factions: [{ id: 0, name: 'Roma', color: '#f00', affinity: 100, relation: 'self', food: 1000, gold: 1000,
      production: 0, population: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity,
      nextRetinueAt: Infinity, defeated: false }],
    time: 20, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'healer', rngState: 1,
    marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 2 },
    wildlife: { herds: [], sequence: 0, nextRespawnAt: Infinity, targetHerds: 0 },
  };
}

describe('healer shack regeneration', () => {
  it('triples actual engine healing from 2.4 to 7.2 HP per second without accelerating the damage delay', () => {
    const ordinary = fixture(), boosted = fixture();
    entityStore(boosted).buildings.add(healer());
    updateGame(ordinary, 1, idle); updateGame(boosted, 1, idle);
    expect(ordinary.units[0].hp).toBeCloseTo(42.4);
    expect(boosted.units[0].hp).toBeCloseTo(47.2);
    boosted.units[0].hp = 40; boosted.units[0].lastDamagedAt = 10; boosted.time = 24.95;
    updateGame(boosted, .1, idle);
    expect(boosted.units[0].hp).toBeCloseTo(40.36);
    boosted.units[0].lastDamagedAt = boosted.time;
    updateGame(boosted, 1, idle);
    expect(boosted.units[0].hp).toBeCloseTo(40.36);
  });

  it.each(['leader', 'warrior', 'archer', 'scout', 'militia', 'worker', 'merchant'] as const)
  ('accelerates friendly %s healing in owned territory', kind => {
    const state = fixture(), unit = person(200, kind);
    entityStore(state).units.add(unit); entityStore(state).buildings.add(healer());
    regenerateUnits(state, 1);
    expect(unit.hp).toBeCloseTo(47.2);
  });

  it('uses the inclusive four-tile center radius and does not stack overlapping shacks', () => {
    const state = fixture(); entityStore(state).buildings.add(healer(), { ...healer(3), x: 11 });
    const query = healerShackHealingQuery(state), unit = person(200, 'warrior');
    unit.x = 6.5; expect(query(unit)).toBe(3);
    unit.x = 6.499; expect(query(unit)).toBe(1);
    unit.x = 11.5; expect(query(unit)).toBe(3);
    entityStore(state).units.add(unit); regenerateUnits(state, 1);
    expect(unit.hp).toBeCloseTo(47.2);
    expect(HEALER_SHACK_RADIUS).toBe(4);
  });

  it('ignores unfinished, destroyed, foreign and raider shacks and excludes animals', () => {
    const state = fixture(), building = healer(), unit = person(200, 'warrior');
    entityStore(state).buildings.add(building);
    building.construction = { startedAt: 0, duration: 45 };
    expect(healerShackHealingQuery(state)(unit)).toBe(1);
    delete building.construction; building.hp = 0;
    expect(healerShackHealingQuery(state)(unit)).toBe(1);
    building.hp = HEALER_SHACK_HP; building.faction = 1;
    expect(healerShackHealingQuery(state)(unit)).toBe(1);
    unit.faction = 1; expect(healerShackHealingQuery(state)(unit)).toBe(3);
    unit.faction = building.faction = -2; unit.marauderLeader = true;
    expect(healerShackHealingQuery(state)(unit)).toBe(1);
    unit.faction = building.faction = 0;
    for (const kind of ['boar', 'deer', 'buffalo', 'elephant', 'ostrich', 'marshBird'] as const) {
      unit.kind = kind; expect(healerShackHealingQuery(state)(unit)).toBe(1);
    }
  });

  it('retains border eligibility, maximum health and death restrictions', () => {
    const state = fixture(), building = healer();
    const outside = { ...person(200, 'warrior'), x: 30.5, y: 20.5 };
    const capped = { ...person(201, 'worker'), hp: 49, maxHp: 50 };
    const dead = { ...person(202, 'warrior'), hp: 0 };
    entityStore(state).buildings.add(building, { ...healer(3), x: 30, y: 21 });
    entityStore(state).units.add(outside, capped, dead);
    expect(healerShackHealingQuery(state)(outside)).toBe(3);
    regenerateUnits(state, 1);
    expect(outside.hp).toBe(40); expect(capped.hp).toBe(50); expect(dead.hp).toBe(0);
    expect(building.hp).toBe(HEALER_SHACK_HP);
  });

  it('notices completion, ownership changes and demolition on the next healing pass', () => {
    const state = fixture(), unit = state.units[0], building = healer();
    building.construction = { startedAt: 0, duration: 45 };
    entityStore(state).buildings.add(building);
    regenerateUnits(state, 1); expect(unit.hp).toBeCloseTo(42.4);
    delete building.construction;
    regenerateUnits(state, 1); expect(unit.hp).toBeCloseTo(49.6);
    building.faction = 1;
    regenerateUnits(state, 1); expect(unit.hp).toBeCloseTo(52);
    building.faction = 0; building.hp = 0;
    regenerateUnits(state, 1); expect(unit.hp).toBeCloseTo(54.4);
  });

  it('builds a solid single-tile shack for 200 gold and 45 seconds after research', () => {
    const state = fixture(), faction = state.factions[0];
    faction.research = { focus: 'traditionalMedicine', levels: { traditionalMedicine: 1 }, progress: {} };
    expect(validateBuildAt(state, 'healerShack', 10, 10)).toMatchObject({ ok: true });
    expect(buildAt(state, 'healerShack', 10, 10).ok).toBe(true);
    const building = state.buildings.find(building => building.kind === 'healerShack')!;
    expect(building).toMatchObject({ hp: 160, maxHp: 160, capacity: 0, construction: { duration: 45, paidGold: 200 } });
    expect([buildingWidth(building), buildingHeight(building)]).toEqual([1, 1]);
    expect(faction.gold).toBe(800);
    expect(BUILD_COSTS.healerShack.gold).toBe(HEALER_SHACK_COST);
    expect(CONSTRUCTION_SECONDS.healerShack).toBe(HEALER_SHACK_BUILD_SECONDS);
    delete building.construction;
    expect(canWalk(state, 10.5, 10.5, 0)).toBe(false);
  });
});
