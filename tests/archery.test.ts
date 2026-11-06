import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { ARCHER_RANGE, evadeMelee, updateArcheryTraining, nextRecruitRole, retinueComposition, setArcherFraction, setSoldierRole } from '../src/game/archery';
import { arrowLineClear } from '../src/game/arrows';
import { retinueFormation } from '../src/game/formation';
import { buildAt, updateGame } from '../src/game/simulation';
import { citySummaries } from '../src/game/cities';
import { unitAttack, unitDefense } from '../src/game/veterancy';
import { canWalk } from '../src/game/pathfinding';
import { WOODEN_TOWER_RANGE } from '../src/game/tower-combat';
import { buildingHeight, buildingWidth, distance, type Building, type GameState, type Unit } from '../src/game/types';
const idle = { up: false, down: false, left: false, right: false };
const soldier = (id: number, x: number, y: number, faction = 0): Unit => ({ id, kind: 'warrior', faction, x, y,
  hp: 100, maxHp: 100, morale: 100, attack: 17, defense: 4, speed: 3.96, range: 1.1, order: 'follow', cooldown: 0,
  lastCombat: -60, facing: 0, moving: false, attackTime: 0 });
const structure = (id: number, kind: Building['kind'], x: number, y: number): Building => ({ id, kind, faction: 0, x, y, hp: 500, maxHp: 500, capacity: 0 });
function fixture(): GameState {
  return { world: { width: 40, height: 30, seed: 'archery', source: 'test', spawns: [], tiles: Array.from({ length: 1200 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, variation: .5, food: 2, production: 1, gold: 0 })) },
    buildings: [{ ...structure(1, 'palace', 8, 8), populationGrowth: -10000, governorPermissions: { farms: false, housing: false } }, structure(2, 'archeryRange', 12, 10)],
    units: [{ ...soldier(10, 11.5, 12.5), kind: 'leader', range: 4, attack: 0 }, soldier(11, 11.5, 14.5), soldier(12, 12.5, 15.5), soldier(13, 13.5, 15.5), soldier(14, 14.5, 15.5)],
    factions: [{ id: 0, name: 'Roma', color: '#f34f59', affinity: 100, relation: 'self', food: 1000, gold: 1000, production: 0, population: 20, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, nextRetinueAt: Infinity, defeated: false, research: { focus: 'archeryRange', levels: { archeryRange: 1 }, progress: {} } }],
    time: 0, tick: 0, paused: false, speed: 1, selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'archery', rngState: 1,
    events: [], particles: [], fields: [], marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 1 }, wildlife: { herds: [], sequence: 0, nextRespawnAt: Infinity, targetHerds: 0 } };
}
describe('archery ranges and retinues', () => {
  it('uses two horizontal cells, costs 400 gold, and rejects a blocked second cell', () => {
    const state = fixture(); entityStore(state).buildings.replace(state.buildings.slice(0, -1));
    entityStore(state).buildings.add(structure(3, 'house', 13, 10));
    expect(buildAt(state, 'archeryRange', 12, 10).ok).toBe(false);
    entityStore(state).buildings.replace(state.buildings.slice(0, -1));
    expect(buildAt(state, 'archeryRange', 12, 10).ok).toBe(true);
    const range = state.buildings.find(b => b.kind === 'archeryRange')!;
    expect([buildingWidth(range), buildingHeight(range)]).toEqual([2, 1]);
    expect(state.factions[0].gold).toBe(600);
    delete range.construction;
    expect(canWalk(state, 13.5, 10.5, 0)).toBe(false);
    expect(canWalk(state, 13.5, 11.5, 0)).toBe(true);
  });
  it('preserves health fraction and veterancy while applying role stats without cumulative shrinkage', () => {
    const unit: Unit = { ...soldier(1, 1, 1), hp: 60, kills: 25, armorLevel: 2, weaponLevel: 1 };
    setSoldierRole(unit, 'archer');
    expect(unit.hp).toBeCloseTo(40); expect(unit.maxHp).toBeCloseTo(200 / 3);
    expect(unit.attack).toBeCloseTo(13.6); expect(unit.defense).toBe(2); expect(unit.range).toBe(4);
    setSoldierRole(unit, 'warrior'); expect(unit.hp).toBeCloseTo(60); expect(unit.maxHp).toBe(100);
    expect(unit.attack).toBe(17); expect(unit.kills).toBe(25); expect(unit.armorLevel).toBe(2);
    expect(WOODEN_TOWER_RANGE).toBe(ARCHER_RANGE + 2);
  });
  it.each([
    { kills: 250, archerAttack: 26.88, archerDefense: 15 },
    { kills: 500, archerAttack: 32.844, archerDefense: 3 },
  ])('preserves the full rank benefit when retraining at $kills kills', ({ kills, archerAttack, archerDefense }) => {
    const unit: Unit = { ...soldier(1, 1, 1), kills, weaponLevel: 3, armorLevel: 3 };
    const warriorAttack = unitAttack(unit), warriorDefense = unitDefense(unit);
    for (let conversion = 0; conversion < 3; conversion++) {
      setSoldierRole(unit, 'archer');
      expect(unitAttack(unit)).toBeCloseTo(archerAttack);
      expect(unitDefense(unit)).toBeCloseTo(archerDefense);
      expect(unit.kills).toBe(kills);
      setSoldierRole(unit, 'warrior');
      expect(unitAttack(unit)).toBeCloseTo(warriorAttack);
      expect(unitDefense(unit)).toBeCloseTo(warriorDefense);
    }
  });
  it('evacuates multiple trainees into separate safe cells when their range is lost', () => {
    const state = fixture(); entityStore(state).buildings.replace(state.buildings.slice(0, -1));
    const trainees = state.units.slice(1);
    for (const unit of trainees) Object.assign(unit, { x: 13, y: 10.5, inside: true, training: { range: 2, role: 'archer', enteredAt: 0 } });
    for (const unit of trainees) updateArcheryTraining(state, unit, .1, () => { throw new Error('Evacuation must not issue a training move'); });
    expect(trainees.every(unit => !unit.inside && !unit.training)).toBe(true);
    expect(new Set(trainees.map(unit => `${Math.floor(unit.x)},${Math.floor(unit.y)}`)).size).toBe(4);
    expect(trainees.every(unit => canWalk(state, unit.x, unit.y, 0))).toBe(true);
  });
  it('physically enters and exits a range before changing role in either direction', () => {
    const state = fixture(), range = state.buildings[1], original = state.units.filter(u => u.kind === 'warrior');
    expect(setArcherFraction(state, range, .5)).toBe(true);
    expect(original.every(u => u.kind === 'warrior')).toBe(true);
    let sawInside = false;
    for (let i = 0; i < 150; i++) { updateGame(state, .1, idle); sawInside ||= original.some(u => u.inside && u.training); }
    expect(sawInside).toBe(true); expect(original.filter(u => u.kind === 'archer')).toHaveLength(2);
    expect(original.every(u => !u.inside && !u.training)).toBe(true);
    expect(retinueComposition(state, 0)).toMatchObject({ total: 5, archers: 3, warriors: 2 });
    expect(nextRecruitRole(state, state.factions[0])).toBe('archer');
    expect(setArcherFraction(state, range, 0)).toBe(true);
    for (let i = 0; i < 150; i++) updateGame(state, .1, idle);
    expect(original.every(u => u.kind === 'warrior')).toBe(true);
  });
  it('lets defensive soldiers leave their post to retrain, preserving their stance', () => {
    const state = fixture(), unit = state.units[1]; entityStore(state).units.replace([state.units[0], unit]);
    Object.assign(unit, { x: 23.5, y: 18.5, retinueStance: 'defensive', defensiveAnchor: { x: 23.5, y: 18.5 } });
    expect(setArcherFraction(state, state.buildings[1], 1)).toBe(true);
    for (let i = 0; i < 250; i++) updateGame(state, .1, idle);
    expect(unit.kind).toBe('archer'); expect(unit.training).toBeUndefined(); expect(unit.inside).toBe(false);
    expect(unit.retinueStance).toBe('defensive'); expect(distance(unit, state.units[0])).toBeLessThan(4);
  });
  it('allows melee evasion beyond a defensive patrol boundary', () => {
    const state = fixture(), unit = state.units[1]; state.factions[0].archerFraction = 1;
    setSoldierRole(unit, 'archer');
    Object.assign(unit, { x: 23.5, y: 20.5, retinueStance: 'defensive', defensiveAnchor: { x: 20.5, y: 20.5 } });
    entityStore(state).units.replace([state.units[0], unit, { ...soldier(90, 22.5, 20.5, -2), attack: 0, speed: 0, order: 'hold' }]);
    updateGame(state, .1, idle);
    expect(unit.x).toBeGreaterThan(23.5); expect(unit.retinueStance).toBe('defensive');
  });
  it('charges each archer half a gold more than a warrior each economy interval', () => {
    const state = fixture(), before = citySummaries(state)[0].gold;
    setSoldierRole(state.units[1], 'archer');
    expect(citySummaries(state)[0].gold).toBeCloseTo(before - .5);
  });
  it('shoots past buildings but cannot shoot through a wall or its diagonal corner', () => {
    const state = fixture(), from = { x: 18.5, y: 20.5 }, to = { x: 22.5, y: 20.5 };
    entityStore(state).buildings.add(structure(50, 'house', 20, 20));
    expect(arrowLineClear(state, from, to)).toBe(true);
    entityStore(state).buildings.add(structure(51, 'wall', 20, 20));
    expect(arrowLineClear(state, from, to)).toBe(false);
    expect(arrowLineClear(state, from, { x: 20.5, y: 20.5 }, 51)).toBe(true);
    entityStore(state).buildings.replace([structure(52, 'wall', 19, 20)]);
    expect(arrowLineClear(state, { x: 18.5, y: 20.5 }, { x: 20.5, y: 22.5 })).toBe(false);
  });
  it('launches arrows with warrior cooldown and earns the role-specific bounty', () => {
    for (const role of ['warrior', 'archer'] as const) {
      const state = fixture(), archer = state.units[1];
      entityStore(state).units.replace([state.units[0], archer]); Object.assign(archer, { x: 20.5, y: 20.5, order: 'hold' }); setSoldierRole(archer, 'archer');
      const enemy = { ...soldier(80, 23.5, 20.5, -2), hp: 1, speed: 0, attack: 0, order: 'hold' as const }; setSoldierRole(enemy, role); entityStore(state).units.add(enemy);
      state.factions[0].archerFraction = 1;
      const gold = state.factions[0].gold;
      updateGame(state, .1, idle);
      expect(state.projectiles?.some(p => p.kind === 'arrow')).toBe(true); expect(archer.cooldown).toBeGreaterThan(.8);
      for (let i = 0; i < 10; i++) updateGame(state, .1, idle);
      expect(enemy.hp).toBe(0); expect(state.factions[0].gold - gold).toBe(role === 'warrior' ? 6 : 8);
    }
  });
  it('backs away from melee unless all escape directions are blocked', () => {
    const state = fixture(), archer = state.units[1]; Object.assign(archer, { x: 20.5, y: 20.5 }); setSoldierRole(archer, 'archer');
    const enemy = soldier(90, 21.5, 20.5, -2); entityStore(state).units.replace([archer, enemy]);
    let goal: { x: number; y: number } | undefined;
    const move = (_state: GameState, _unit: Unit, point: { x: number; y: number }) => { goal = point; };
    expect(evadeMelee(state, archer, .1, move, (a, b) => a !== b, () => true)).toBe(true);
    expect(distance(goal!, enemy)).toBeGreaterThan(distance(archer, enemy));
    for (const tile of state.world.tiles) tile.terrain = 'river'; state.world.revision = 1; goal = undefined;
    expect(evadeMelee(state, archer, .1, move, (a, b) => a !== b, () => true)).toBe(false); expect(goal).toBeUndefined();
  });
  it.each(['formation', 'travel'] as const)('assigns archers behind warriors when moving in %s mode', mode => {
    const state = fixture(), leader = state.units[0]; state.movementMode = mode;
    setSoldierRole(state.units[1], 'archer'); setSoldierRole(state.units[3], 'archer');
    Object.assign(leader, { x: 22, y: 20 }); retinueFormation(state, leader);
    state.time = .5; leader.x = 23;
    const formation = retinueFormation(state, leader);
    const x = (kind: string) => state.units.filter(u => u.kind === kind).map(u => formation.goals.get(u.id)!.x);
    expect(Math.max(...x('archer'))).toBeLessThan(Math.min(...x('warrior')));
  });
});
