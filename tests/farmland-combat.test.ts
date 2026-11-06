import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { synchronizeFarms } from '../src/game/farms';
import { updateFog } from '../src/game/fog';
import { initializeFogRaids, updateFogRaids } from '../src/game/fog-raids';
import { buildingAtPoint } from '../src/game/hit-testing';
import { interactAt, MARAUDER_FACTION, updateGame } from '../src/game/simulation';
import type { Building, GameState, MarauderPack, Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const unit = (id: number, kind: Unit['kind'], x: number, y: number, faction = 0): Unit => ({
  id, kind, faction, x, y, hp: 100, morale: 100, attack: 0, defense: 4, speed: 0,
  range: kind === 'leader' ? 4 : 1.1, order: 'hold', cooldown: 0, lastCombat: -60,
  moving: false, facing: 0, attackTime: 0,
});
const building = (id: number, kind: Building['kind'], x: number, y: number, faction = 0): Building => ({
  id, kind, faction, x, y, hp: kind === 'palace' ? 650 : 160,
  maxHp: kind === 'palace' ? 650 : 160, capacity: kind === 'house' ? 4 : 0, armor: 2,
});
function fixture(): GameState {
  const state: GameState = {
    world: { width: 48, height: 32, seed: 'farmland-combat', source: 'test', spawns: [],
      tiles: Array.from({ length: 48 * 32 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
        moisture: .6, food: 2, production: 1, gold: 0, variation: .5 })) },
    units: [unit(10, 'leader', 2.5, 28.5)],
    buildings: [building(1, 'palace', 4, 4), building(2, 'camp', 18, 12), building(3, 'house', 22, 12)],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 0,
      production: 0, population: 4, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1e9, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], projectiles: [], fields: [],
    selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false,
    seed: 'farmland-combat', rngState: 1, marauderPacks: [],
    fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 1 }, enemyPressureVersion: 1,
  };
  synchronizeFarms(state);
  return state;
}
function marauder(state: GameState, raid: boolean): { attacker: Unit; pack: MarauderPack } {
  const attacker = unit(100, 'warrior', 17.5, 12.5, MARAUDER_FACTION);
  Object.assign(attacker, { attack: 24, speed: 2.35, marauderPack: 999, order: 'raid', target: 2 });
  const pack: MarauderPack = { id: 999, name: 'Scythians', color: '#e87535', targetFaction: 0,
    home: { x: 17.5, y: 12.5 }, waypoint: { x: 17.5, y: 12.5 }, nextWanderAt: 1e9,
    raid, targetBuilding: raid ? 2 : undefined, spawnedAt: 0, retinueAtSpawn: 2 };
  entityStore(state).units.add(attacker); state.marauderPacks!.push(pack);
  return { attacker, pack };
}
function advance(state: GameState, seconds: number): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += .1) updateGame(state, .1, idle);
}

describe('farmland is traversable, indestructible ground', () => {
  it('lets wandering marauders pass a closer farm to attack a house without harming crops or population', () => {
    const state = fixture(), farm = state.buildings[1], house = state.buildings[2];
    const crops = state.fields!.map(field => ({ id: field.id, x: field.x, y: field.y }));
    const { attacker } = marauder(state, false);
    advance(state, 6);
    expect(house.hp).toBeLessThan(house.maxHp);
    expect(house.hp).toBeGreaterThan(0);
    expect(attacker.target).toBe(house.id);
    expect(farm.hp).toBe(farm.maxHp);
    expect(farm.capacity).toBe(0); expect(farm.residents).toBe(0);
    expect(state.factions[0].population).toBe(4);
    expect(state.fields!.map(field => ({ id: field.id, x: field.x, y: field.y }))).toEqual(crops);
    expect(state.fields).toHaveLength(1);
  });

  it('discards an old Leader attack order against an enemy farm', () => {
    const state = fixture(), leader = state.units[0], farm = state.buildings[1];
    farm.faction = MARAUDER_FACTION;
    Object.assign(leader, { x: 16.5, y: 12.5, attack: 25, target: farm.id });
    advance(state, 1);
    expect(leader.target).toBeUndefined();
    expect(leader.lastCombat).toBe(-60);
    expect(state.projectiles).toEqual([]);
    expect(farm.hp).toBe(farm.maxHp);
  });

  it('discards an in-flight legacy javelin aimed at a farm while still resolving a house hit', () => {
    const state = fixture(), farm = state.buildings[1], house = state.buildings[2];
    state.projectiles = [farm, house].map(target => ({
      x: target.x - 1, y: target.y + .5, start: { x: target.x - 1, y: target.y + .5 },
      end: { x: target.x + .5, y: target.y + .5 }, attacker: 999, faction: MARAUDER_FACTION,
      target: target.id, damage: target === farm ? 1000 : 30, elapsed: 0, duration: .1,
    }));
    updateGame(state, .1, idle);
    expect(state.projectiles).toEqual([]);
    expect(house.hp).toBe(house.maxHp - 30);
    expect(farm.hp).toBe(farm.maxHp);
    expect(state.buildings).toContain(farm);
    expect(state.fields).toHaveLength(1);
    expect(state.factions[0].population).toBe(4);
    expect(state.particles).toEqual([]);
  });

  it.each([0, MARAUDER_FACTION])('right-clicks faction %s farmland as a movement destination, including its center', faction => {
    const state = fixture(), leader = state.units[0], farm = state.buildings[1];
    farm.faction = faction;
    Object.assign(leader, { x: 16.5, y: 12.5, speed: 3.6, attack: 25 });
    updateFog(state);
    expect(buildingAtPoint(state, { x: 18.5, y: 12.5 })).toBe(farm);
    interactAt(state, 18.5, 12.5);
    expect(leader.target).toBeUndefined();
    expect(leader.destination).toEqual({ x: 18.5, y: 12.5 });
    expect(state.selectedType).toBe('unit');
    advance(state, 1);
    expect(leader.x).toBeCloseTo(18.5); expect(leader.y).toBeCloseTo(12.5);
    expect(farm.hp).toBe(farm.maxHp);
  });

  it('retargets a saved raid objective from farmland to the nearest reachable house', () => {
    const state = fixture(), farm = state.buildings[1], house = state.buildings[2];
    const { attacker, pack } = marauder(state, true);
    updateGame(state, .1, idle);
    expect(pack.targetBuilding).toBe(house.id);
    expect(attacker.target).toBe(house.id);
    advance(state, 4);
    expect(house.hp).toBeLessThan(house.maxHp);
    expect(farm.hp).toBe(farm.maxHp);
  });

  it('creates new fog raids against houses and never selects farmland as an objective', () => {
    const state = fixture(), farm = state.buildings[1], house = state.buildings[2];
    // Isolate objective selection: a house and a farm are the only candidates.
    initializeFogRaids(state);
    entityStore(state).buildings.replace([farm, house, ...state.buildings.filter(building => building.raiderCamp !== undefined)]);
    state.time = state.fogRaids!.nextAt;
    updateFogRaids(state);
    expect(state.fogRaids!.waves).toBe(1);
    expect(state.marauderPacks).toHaveLength(1);
    expect(state.marauderPacks![0].targetBuilding).toBe(house.id);
    expect(state.units.filter(unit => unit.marauderPack !== undefined).length).toBeGreaterThan(0);
    expect(farm.hp).toBe(farm.maxHp);
  });
});
