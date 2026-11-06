import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { buildAt, commandMove, createGame, getLeader, moveUnit, selectAt, updateFriendlyYield, updateGame, validateBuildAt } from '../src/game/simulation';
import { buildingSize, type Building, type GameState, type Unit } from '../src/game/types';
import { palaceSpacingAllowed } from '../src/game/placement';
import { movementMultiplier, travelTimeMap } from '../src/game/pathfinding';
import { movementCongestion } from '../src/game/engagement';
import { updateFog } from '../src/game/fog';
import { unlockBuildingResearch } from './helpers/research';

const idle = { up: false, down: false, left: false, right: false };
const unit = (id: number, kind: Unit['kind'], x: number, y: number, faction = 0): Unit => ({
  id, kind, faction, x, y, hp: 100, morale: 100, attack: kind === 'worker' ? 0 : 25, defense: 4,
  speed: 3.6, range: kind === 'leader' ? 4 : 1.1, order: 'hold', cooldown: 0, lastCombat: -60,
  moving: false, facing: 0, attackTime: 0,
});
const building = (id: number, kind: Building['kind'], x: number, y: number): Building => ({ id, kind, x, y, faction: 0, hp: 650, maxHp: 650, capacity: 0 });
function fixture(): GameState {
  return { world: { width: 32, height: 24, seed: 'revised-mechanics', source: 'test', spawns: [{ x: 3, y: 10 }],
    tiles: Array.from({ length: 32 * 24 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .6, food: 3, production: 1, gold: 0, variation: .5 })) },
    units: [unit(10, 'leader', 14.5, 12.5)], buildings: [building(1, 'palace', 3, 10)],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 500, production: 500, population: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1000, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'revised-mechanics', rngState: 1, fields: [], marauderPacks: [] };
}

describe('javelin combat and mouse orders', () => {
  it('throws at exactly four tiles and applies damage only when the javelin arrives', () => {
    const state = fixture(), leader = getLeader(state)!, enemy = unit(11, 'warrior', 18.5, 12.5, -2);
    entityStore(state).units.add(enemy);
    updateGame(state, .1, idle);
    expect(state.projectiles).toHaveLength(1); expect(enemy.hp).toBe(100);
    expect(state.projectiles![0]).toMatchObject({ attacker: leader.id, target: enemy.id, damage: 14.7 });
    updateGame(state, .2, idle);
    expect(enemy.hp).toBe(100); expect(state.projectiles![0].x).toBeGreaterThan(leader.x);
    updateGame(state, .2, idle);
    expect(enemy.hp).toBe(85.3); expect(state.projectiles).toHaveLength(0);
    expect(leader.x).toBe(14.5);
    enemy.x = 18.6; leader.cooldown = 0; updateGame(state, .1, idle);
    expect(state.projectiles).toHaveLength(0);
  });

  it('crosses a river, while a solid building blocks throwing and a dead thrower still deals the launched hit', () => {
    const state = fixture(), leader = getLeader(state)!, enemy = unit(11, 'warrior', 18.5, 12.5, -2);
    entityStore(state).units.add(enemy); state.world.tiles[12 * 32 + 16].terrain = 'river';
    entityStore(state).buildings.add(building(20, 'house', 16, 12));
    updateGame(state, .1, idle); expect(state.projectiles).toHaveLength(0);
    entityStore(state).buildings.replace(state.buildings.slice(0, -1));
    // Wait for target sensing after the obstruction changes, stopping before impact.
    for (let step = 0; step < 50 && !state.projectiles?.length; step++) updateGame(state, .02, idle);
    expect(state.projectiles).toHaveLength(1);
    // Keep the player's realm alive while testing the already-thrown weapon.
    const successor = unit(12, 'leader', 10.5, 20.5); entityStore(state).units.add(successor); leader.hp = 0;
    updateGame(state, .4, idle);
    expect(enemy.hp).toBe(85.3); expect(state.units.some(unit => unit.id === leader.id)).toBe(false);
  });

  it('left-selects an enemy without changing movement or starting an attack', () => {
    const state = fixture(), leader = getLeader(state)!, enemy = unit(11, 'warrior', 17.5, 12.5, -2);
    entityStore(state).units.add(enemy); leader.destination = { x: 14.5, y: 17.5 }; updateFog(state);
    selectAt(state, enemy.x, enemy.y - .3);
    expect(state.selected).toBe(enemy.id); expect(leader.target).toBeUndefined();
    expect(leader.destination).toEqual({ x: 14.5, y: 17.5 });
    selectAt(state, 13.5, 15.5);
    expect(leader.destination).toEqual({ x: 14.5, y: 17.5 });
  });

  it('right-orders approach to the nearest reachable cell of a blocked location', () => {
    const state = fixture(), leader = getLeader(state)!;
    entityStore(state).buildings.add(building(20, 'tower', 18, 12));
    expect(commandMove(state, 18.5, 12.5)).toBe(true);
    expect(leader.destination).toEqual({ x: 17.5, y: 12.5 });
    updateGame(state, 2, idle); expect(leader.x).toBeCloseTo(17.5);
    expect(leader.destination).toBeUndefined(); expect(commandMove(state, -1, 0)).toBe(false);
  });
});

describe('civilian traffic, bridges and palace clearances', () => {
  it.each(['leader', 'warrior'] as const)('lets peasants cross a held %s without repulsion or crowd cost', kind => {
    const state = fixture(), soldier = state.units[0]; entityStore(state).setUnitRole(soldier, { kind });
    const worker = unit(11, 'worker', 11.5, 12.5); entityStore(state).units.add(worker);
    expect(movementCongestion(state, worker).size).toBe(0);
    for (let i = 0; i < 30; i++) { state.time += .1; moveUnit(state, worker, { x: 17.5, y: 12.5 }, .1); }
    expect(worker.x).toBeCloseTo(17.5); expect(soldier.x).toBe(14.5);
  });

  it('lets peasants pass through one another without yielding or sidestepping', () => {
    const state = fixture(), first = unit(11, 'worker', 12.5, 16.5), second = unit(12, 'worker', 14.5, 16.5);
    entityStore(state).units.add(first, second);
    let overlapped = false;
    for (let i = 0; i < 50; i++) {
      state.time += .1;
      expect(updateFriendlyYield(state, second, .1)).toBe(false);
      moveUnit(state, first, { x: 17.5, y: 16.5 }, .1);
      overlapped ||= Math.abs(first.x - second.x) < .28;
      expect(first.y).toBe(16.5); expect(second.x).toBe(14.5);
    }
    expect(overlapped).toBe(true);
    expect(first.x).toBeCloseTo(17.5);
  });

  it('uses full normal speed over a completed ford bridge in both movement and route costs', () => {
    const state = fixture(), tile = state.world.tiles[12 * 32 + 16]; tile.terrain = 'river'; tile.overlay = 'ford';
    const bridge = building(20, 'bridge', 16, 12); bridge.construction = { startedAt: 0, duration: 12 }; entityStore(state).buildings.add(bridge);
    expect(movementMultiplier(state, 16.5, 12.5)).toBe(.45);
    delete bridge.construction;
    expect(movementMultiplier(state, 16.5, 12.5)).toBe(1);
    expect(travelTimeMap(state, { x: 15.5, y: 12.5 }, 0, 1, 100)[12 * 32 + 17]).toBeCloseTo(2);
  });

  it('does not add a milestone building when the population reaches thirty', () => {
    const state = createGame(fixture().world);
    entityStore(state).units.replace(state.units.filter(unit => unit.faction === 0)); state.marauderPacks = [];
    const buildings = state.buildings.map(({ id, kind, x, y }) => ({ id, kind, x, y }));
    for (const population of [29, 30, 45]) {
      state.factions[0].population = population;
      updateGame(state, .1, idle);
      expect(state.buildings.map(({ id, kind, x, y }) => ({ id, kind, x, y }))).toEqual(buildings);
    }
  });

  it('expands productive farmland when needed', () => {
    const state = createGame(fixture().world);
    entityStore(state).units.replace(state.units.filter(unit => unit.faction === 0)); state.marauderPacks = [];
    const camps = state.buildings.filter(building => building.kind === 'camp'); expect(camps.length).toBeGreaterThan(2);
    for (const camp of camps) expect(palaceSpacingAllowed(state, camp.kind, camp.x, camp.y)).toBe(true);
    state.factions[0].population = 54; state.buildings.find(building => building.kind === 'palace' && building.faction === 0)!.populationGrowth = 1; state.time = 59.9; state.tick = 1;
    updateGame(state, .1, idle);
    expect(state.buildings.filter(building => building.kind === 'camp')).toHaveLength(camps.length + 4);
    for (const building of state.buildings.filter(building => building.kind !== 'palace')) {
      expect(palaceSpacingAllowed(state, building.kind, building.x, building.y)).toBe(true);
      expect(buildingSize(building)).toBe(1);
    }
  });

  it('allows buildings beside the palace and extends its existing roads', () => {
    const state = fixture(), leader = getLeader(state)!; leader.x = 8.5; leader.y = 9.5; updateFog(state);
    unlockBuildingResearch(state.factions[0]);
    for (const kind of ['woodenTower', 'wall'] as const) {
      expect(validateBuildAt(state, kind, 5, 10).ok).toBe(true);
      expect(validateBuildAt(state, kind, 8, 10).ok).toBe(true);
    }
    entityStore(state).buildings.add(building(30, 'road', 5, 9));
    const resources = state.factions[0].gold;
    expect(buildAt(state, 'road', 5, 10).ok).toBe(true);
    expect(state.buildings.find(building => building.kind === 'road' && building.y === 10)).toMatchObject({ x: 5, y: 10, construction: { waitingForBuilder: true } });
    expect(state.factions[0].gold).toBe(resources - 10);
  });
});
