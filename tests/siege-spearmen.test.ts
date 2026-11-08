import { withDevelopedResources } from './helpers/developed-resources';
import { describe, expect, it } from 'vitest';
import { desiredRetinueSize, nextRecruitRole, retinueComposition, setArcherFraction, setSoldierRole, setSpearmanFraction } from '../src/game/archery';
import { ballistaAttack, BALLISTA_ATTACK, BALLISTA_COOLDOWN, BALLISTA_RANGE, updateBallistae } from '../src/game/ballista';
import { buildingWithinBorders } from '../src/game/border-placement';
import { buildingPlacementEffect } from '../src/game/building-aoe';
import { entityStore } from '../src/game/entity-store';
import { invalidateNavigation } from '../src/game/pathfinding';
import { healerShackHealingQuery } from '../src/game/healer-shack';
import { retinueSlotUpkeep } from '../src/game/retinue-purchases';
import { synchronizeRetinueSquads } from '../src/game/retinue-squads';
import { buildAt, cancelConstruction, updateGame } from '../src/game/simulation';
import { spearPiercingTargets, SPEAR_PIERCE_DAMAGE_MULTIPLIER } from '../src/game/spearmen';
import { beginUnitFrame, endUnitFrame } from '../src/game/spatial';
import { attackDamage, incomingUnitDamage, unitDamage, unitDefense } from '../src/game/veterancy';
import { updateWallOwnership } from '../src/game/wall-ownership';
import { type Building, type GameState, type Unit } from '../src/game/types';
import { CHECK_INTERVAL } from '../src/game/work-cadence';

const idle = { up: false, down: false, left: false, right: false };
const unit = (id: number, x: number, y: number, faction = 0): Unit => ({ id, x, y, faction, kind: 'warrior', hp: 100,
  maxHp: 100, attack: 0, defense: 0, morale: 100, speed: 0, range: 1.1, order: 'hold', cooldown: 0,
  lastCombat: -60, lastDamagedAt: -60, facing: 0, moving: false, attackTime: 0 });
const building = (id: number, kind: Building['kind'], x: number, y: number, faction = 0): Building => ({ id, kind, x, y,
  faction, hp: 1000, maxHp: 1000, capacity: 0, populationGrowth: -10000, governorPermissions: { farms: false, housing: false } });
function fixture(): GameState {
  return withDevelopedResources({ world: { width: 48, height: 32, seed: 'siege', source: 'test', spawns: [], revision: 0,
    tiles: Array.from({ length: 48 * 32 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
      moisture: .5, food: 2, production: 1, gold: 0, variation: .5 })) },
    buildings: [building(1, 'palace', 4, 10)], units: [{ ...unit(10, 11.5, 12.5), kind: 'leader' }],
    factions: [{ id: 0, name: 'Roma', color: '#f00', affinity: 100, relation: 'self', gold: 1000, food: 1000, production: 0,
      population: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, nextRetinueAt: Infinity, defeated: false,
      research: { focus: 'siegeEngines', levels: { siegeEngines: 1, militaryTactics: 1, archeryRange: 1 }, progress: {} } },
      { id: 1, name: 'Rival', color: '#00f', affinity: 0, relation: 'war', gold: 0, food: 0, population: 0, production: 0,
        yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, nextRetinueAt: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, seed: 'siege', rngState: 1, gameOver: false, victory: false,
    events: [], particles: [], fields: [], selected: null, selectedType: null, buildMode: null, diplomacy: null,
    marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 2 },
    wildlife: { herds: [], sequence: 0, nextRespawnAt: Infinity, targetHerds: 0 } }, ['iron', 'copper']);
}

describe('ballista siege engine', () => {
  it('assembles outside borders without a civilian and remains owned inside enemy territory', () => {
    const state = fixture(); state.units[0].x = 18.5;
    expect(buildingWithinBorders(state, 'house', 18, 12)).toBe(false);
    expect(buildAt(state, 'ballista', 18, 12)).toMatchObject({ ok: true });
    const engine = state.buildings.find(value => value.kind === 'ballista')!;
    expect(engine).toMatchObject({ hp: 200, construction: { duration: 30, paidGold: 300, waitingForBuilder: false } });
    expect(state.factions[0].gold).toBe(700);
    for (let step = 0; step < 299; step++) updateGame(state, .1, idle);
    expect(engine.construction).toBeDefined();
    updateGame(state, .1, idle);
    updateGame(state, CHECK_INTERVAL, idle); expect(engine.construction).toBeUndefined();
    expect(state.units.some(value => value.kind === 'worker')).toBe(false);
    entityStore(state).buildings.add(building(500, 'monument', 19, 13, 1));
    updateWallOwnership(state); expect(engine.faction).toBe(0);
    expect(buildingPlacementEffect('ballista')).toEqual({ radius: 18, beneficial: false });
  });

  it('requires Siege Engines and refunds only unfinished assembly work', () => {
    const state = fixture(); delete state.factions[0].research!.levels.siegeEngines;
    expect(buildAt(state, 'ballista', 12, 12).ok).toBe(false);
    expect(state.factions[0].gold).toBe(1000);
    state.factions[0].research!.levels.siegeEngines = 1;
    expect(buildAt(state, 'ballista', 12, 12).ok).toBe(true);
    const engine = state.buildings.find(value => value.kind === 'ballista')!;
    updateGame(state, 15, idle);
    expect(cancelConstruction(state, engine.id)).toEqual({ ok: true, refund: 150 });
    expect(state.factions[0].gold).toBe(850);
  });

  it('matches archer raw sustained DPS while firing slowly and prefers defenses over nearby units', () => {
    const state = fixture(), archer = { ...unit(20, 1, 1), attack: 17, defense: 4 };
    setSoldierRole(archer, 'archer');
    expect(attackDamage(BALLISTA_ATTACK, 0) / BALLISTA_COOLDOWN).toBeCloseTo(unitDamage(archer, 0) / .95);
    state.factions[0].weaponLevel = 3; state.factions[0].research!.levels.fletching = 1; archer.weaponLevel = 3;
    expect(attackDamage(ballistaAttack(state.factions[0]), 0) / BALLISTA_COOLDOWN)
      .toBeCloseTo(unitDamage(archer, 0, state.factions[0]) / .95);
    const engine = building(2, 'ballista', 10, 12);
    entityStore(state).buildings.add(engine, building(3, 'wall', 15, 12, 1), building(4, 'guardPost', 17, 13, 1), building(5, 'woodenTower', 21, 12, 1));
    entityStore(state).units.add(unit(21, 12.5, 12.5, 1));
    const shots: number[] = [], combat = { hostile: (a: number, b: number) => a !== b,
      clearShot: () => true, shoot: (_engine: Building, _from: unknown, target: Building | Unit) => { shots.push(target.id); } };
    updateBallistae(state, .1, combat); expect(shots).toEqual([5]);
    updateBallistae(state, 3.9, combat); expect(shots).toHaveLength(1);
    updateBallistae(state, .1, combat); expect(shots).toEqual([5, 5]);
    expect(BALLISTA_RANGE).toBe(18);
  });

  it('deals projectile damage to a defense at eighteen tiles but cannot shoot through a nearer wall', () => {
    const state = fixture(), engine = building(2, 'ballista', 10, 12), tower = building(3, 'woodenTower', 28, 12, 1);
    entityStore(state).buildings.add(engine, tower);
    updateGame(state, .1, idle);
    expect(state.projectiles).toHaveLength(1); expect(state.projectiles![0]).toMatchObject({ kind: 'ballistaBolt', target: tower.id });
    updateGame(state, 1.51, idle);
    expect(tower.hp).toBeCloseTo(1000 - attackDamage(BALLISTA_ATTACK, 2));
    const wall = building(4, 'wall', 22, 12, 1); entityStore(state).buildings.add(wall); invalidateNavigation(state);
    engine.attackCooldown = 0; updateGame(state, .1, idle);
    expect(state.projectiles!.at(-1)?.target).toBe(wall.id);
  });

  it.each([0, 1])('faction %s can acquire an unassisted target at eighteen tiles but not beyond', faction => {
    const state = fixture(), engine = building(2, 'ballista', 10, 12, faction);
    const target = { ...unit(20, 28.5, 12.5, 1 - faction), hp: 1000, maxHp: 1000 };
    entityStore(state).units.replace([target, { ...unit(10, 43.5, 29.5), kind: 'leader' }]);
    entityStore(state).buildings.add(engine); updateGame(state, .1, idle);
    expect(state.projectiles).toHaveLength(1); expect(state.projectiles![0].target).toBe(target.id);
    expect(engine.siegeFacing).toBe(0);
    state.projectiles = []; engine.attackCooldown = 0; target.x = 28.501;
    // Remove unrelated fallback targets so only the exact range edge is tested.
    entityStore(state).buildings.replace([engine]); updateGame(state, .1, idle);
    expect(state.projectiles).toHaveLength(0);
  });

  it.each([[0, -10, -Math.PI / 2], [10, 0, 0], [0, 10, Math.PI / 2], [-10, 0, Math.PI]])
    ('aims toward the target before emitting a bolt (%s,%s)', (dx, dy, angle) => {
      const state = fixture(), engine = building(2, 'ballista', 22, 18), target = unit(20, 22.5 + dx, 18.5 + dy, 1);
      entityStore(state).buildings.replace([engine]); entityStore(state).units.replace([target]);
      updateBallistae(state, .1, { hostile: (a, b) => a !== b, clearShot: () => true,
        shoot: source => { expect(source.siegeFacing).toBe(angle); expect(source.siegeShotAt).toBe(state.time); } });
      expect(engine.siegeFacing).toBe(angle);
    });
});

describe('spearman retinue', () => {
  it('has stronger base defense and retains health, upgrades and squad experience across role changes', () => {
    const soldier = { ...unit(20, 12, 12), attack: 17, defense: 4, hp: 40, kills: 100, armorLevel: 3 as const, retinueSquad: 2 };
    const oldDefense = unitDefense(soldier);
    setSoldierRole(soldier, 'spearman');
    expect(soldier).toMatchObject({ hp: 40, maxHp: 100, attack: 17, defense: 6, range: 1.4, kills: 100, armorLevel: 3, retinueSquad: 2 });
    expect(unitDefense(soldier)).toBeGreaterThan(oldDefense);
    setSoldierRole(soldier, 'archer'); setSoldierRole(soldier, 'spearman'); setSoldierRole(soldier, 'warrior');
    expect(soldier.hp).toBeCloseTo(40); expect(soldier.defense).toBe(4); expect(soldier.kills).toBe(100);
    const state = fixture(); entityStore(state).buildings.add(building(3, 'healerShack', 12, 12));
    soldier.kind = 'spearman'; expect(healerShackHealingQuery(state)(soldier)).toBe(3);
  });

  it('allocates, physically trains and recruits spearmen through the blacksmith without creating extra soldiers', () => {
    const state = fixture(), range = building(2, 'archeryRange', 12, 10), smithy = building(3, 'blacksmith', 10, 10);
    entityStore(state).buildings.add(range, smithy);
    entityStore(state).units.add(...Array.from({ length: 4 }, (_, i) => ({ ...unit(20 + i, 11.5 + i, 14.5), speed: 3.96, attack: 17, defense: 4, kills: 100 })));
    synchronizeRetinueSquads(state);
    delete state.factions[0].research!.levels.militaryTactics;
    expect(setSpearmanFraction(state, smithy, .5)).toBe(false);
    state.factions[0].research!.levels.militaryTactics = 1;
    expect(setSpearmanFraction(state, smithy, .5)).toBe(true);
    let entered = false;
    for (let step = 0; step < 200; step++) { updateGame(state, .1, idle); entered ||= state.units.some(value => value.training && value.inside); }
    expect(entered).toBe(true);
    expect(state.units.filter(value => value.kind === 'spearman')).toHaveLength(2);
    expect(state.units.filter(value => value.retinueSquad !== undefined)).toHaveLength(4);
    expect(state.units.filter(value => value.kind === 'spearman').every(value => value.kills === 100)).toBe(true);
    entityStore(state).units.replace(state.units.filter(value => value.kind !== 'spearman'));
    expect(nextRecruitRole(state, state.factions[0])).toBe('spearman');
    expect(setArcherFraction(state, range, .8)).toBe(true);
    expect(retinueComposition(state, 0)).toMatchObject({ total: 4, archers: 3, spearmen: 1, warriors: 0 });
  });

  it('pierces exactly two enemies behind the primary, applies armor/veterancy and ignores allies or lateral units', () => {
    const state = fixture(), attacker = { ...unit(20, 15.5, 12.5), attack: 17, defense: 4 };
    setSoldierRole(attacker, 'spearman');
    const targets = [unit(21, 16.5, 12.5, 1), { ...unit(22, 17.5, 12.5, 1), kills: 500 }, unit(23, 18.5, 12.5, 1), unit(24, 19, 12.5, 1), unit(25, 17.5, 13.2, 1), unit(26, 18, 12.4)];
    // Separate surviving squads keep the elite target's rank from being shared
    // with the untrained targets during ordinary squad reconciliation.
    state.retinueSquads = targets.filter(value => value.faction === 1).map(value => {
      value.retinueSquad = value.id; return { id: value.id, faction: 1, kills: value.kills ?? 0 };
    });
    attacker.forcedAttack = { target: 21 }; entityStore(state).units.add(attacker, ...targets);
    updateGame(state, .1, idle);
    expect(targets[0].hp).toBeCloseTo(100 - unitDamage(attacker, 0));
    expect(targets[1].hp).toBeCloseTo(100 - incomingUnitDamage(targets[1], unitDamage(attacker, 0) * SPEAR_PIERCE_DAMAGE_MULTIPLIER));
    expect(targets[2].hp).toBeCloseTo(100 - unitDamage(attacker, 0) * SPEAR_PIERCE_DAMAGE_MULTIPLIER);
    expect(targets.slice(3).map(value => value.hp)).toEqual([100, 100, 100]);
    expect(targets[1].lastDamagedAt).toBeCloseTo(.1);
    expect(attacker.cooldown).toBeCloseTo(.95);
  });

  it('records each secondary kill once for the squad', () => {
    const state = fixture(), attacker = { ...unit(20, 15.5, 12.5), attack: 17, defense: 4 };
    setSoldierRole(attacker, 'spearman');
    const primary = { ...unit(21, 16.5, 12.5, 1), hp: 1 }, secondary = { ...unit(22, 17.5, 12.5, 1), hp: 1 };
    entityStore(state).units.add(attacker, primary, secondary); attacker.forcedAttack = { target: primary.id };
    expect(spearPiercingTargets(state, attacker, primary, (a, b) => a !== b, () => false)).toEqual([]);
    synchronizeRetinueSquads(state); updateGame(state, .1, idle);
    expect(attacker.kills).toBe(2); expect(state.factions[0].gold).toBe(1012);
    updateGame(state, .1, idle); expect(attacker.kills).toBe(2);
  });

  it('damages enemies in both the newly longer and newly wider part of the thrust', () => {
    const state = fixture(), attacker = { ...unit(20, 15.5, 12.5), attack: 17, defense: 4 };
    setSoldierRole(attacker, 'spearman');
    const primary = unit(21, 16.5, 12.5, 1), farther = unit(22, 19, 12.5, 1), wider = unit(23, 17.5, 13.05, 1);
    entityStore(state).units.add(attacker, primary, farther, wider); attacker.forcedAttack = { target: primary.id };
    updateGame(state, .1, idle);
    expect(primary.hp).toBeCloseTo(100 - unitDamage(attacker, 0));
    for (const secondary of [farther, wider])
      expect(secondary.hp).toBeCloseTo(100 - unitDamage(attacker, 0) * .6);
    expect(attacker.range).toBe(1.4);
  });

  it('limits the expanded thrust to 2.6 tiles behind the target and 0.585 tiles to either side', () => {
    const state = fixture(), attacker = { ...unit(20, 15.5, 12.5), kind: 'spearman' as const };
    const primary = unit(21, 16.5, 12.5, 1);
    for (const [behind, lateral, hit] of [[2.599, 0, true], [2.601, 0, false], [1, .584, true], [1, .586, false], [1, -.584, true], [1, -.586, false]] as const) {
      const secondary = unit(22, primary.x + behind, primary.y + lateral, 1);
      entityStore(state).units.replace([attacker, primary, secondary]);
      expect(spearPiercingTargets(state, attacker, primary, (a, b) => a !== b, () => true).map(target => target.id),
        `behind=${behind}, lateral=${lateral}`).toEqual(hit ? [secondary.id] : []);
    }
  });

  it('includes a rotated far corner across a spatial-index bucket boundary', () => {
    const state = fixture(), attacker = { ...unit(20, 12.38, 12.5), kind: 'spearman' as const };
    const angle = Math.atan2(.585, 3.6), dx = Math.cos(angle), dy = Math.sin(angle);
    const primary = unit(21, attacker.x + dx, attacker.y + dy, 1);
    const secondary = unit(22, attacker.x + 3.599 * dx + .584 * dy, attacker.y + 3.599 * dy - .584 * dx, 1);
    entityStore(state).units.add(attacker, primary, secondary);
    // The far corner crosses x=16 although the thrust's centerline extent does not.
    expect(attacker.x + 3.6).toBeLessThan(16); expect(secondary.x).toBeGreaterThan(16);
    beginUnitFrame(state);
    try { expect(spearPiercingTargets(state, attacker, primary, (a, b) => a !== b, () => true)).toEqual([secondary]); }
    finally { endUnitFrame(state); }
  });

  it('stops a spear thrust at a solid wall behind the primary target', () => {
    const state = fixture(), attacker = { ...unit(20, 15.5, 12.5), attack: 17, defense: 4 };
    setSoldierRole(attacker, 'spearman');
    const primary = unit(21, 16.5, 12.5, 1), secondary = unit(22, 19, 12.5, 1);
    entityStore(state).units.add(attacker, primary, secondary);
    entityStore(state).buildings.add(building(30, 'wall', 17, 12, 1));
    attacker.forcedAttack = { target: primary.id };
    updateGame(state, .1, idle);
    expect(primary.hp).toBeLessThan(100); expect(secondary.hp).toBe(100);
  });

  it('adds a scenario slot independently of purchased capacity and its upkeep', () => {
    const faction = fixture().factions[0]; faction.population = 100; faction.bonusRetinueSlots = 1;
    expect(desiredRetinueSize(faction)).toBe(10); expect(retinueSlotUpkeep(faction)).toBe(0);
    faction.purchasedRetinueSlots = 2;
    expect(desiredRetinueSize(faction)).toBe(12); expect(retinueSlotUpkeep(faction)).toBe(10);
  });
});
