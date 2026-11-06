import { describe, expect, it } from 'vitest';
import { constructionEdges } from '../src/game/builders';
import { hasStaticPath } from '../src/game/pathfinding';
import { updateVillages, VILLAGE_DEVELOPMENT_COSTS, VILLAGE_MAX_GUARDS } from '../src/game/villages';
import { updateWellUpgrades } from '../src/game/wells';
import { type Building, type GameState } from '../src/game/types';

function fixture(gold = 0): GameState {
  const faction = { id: 1, villageId: 1, name: 'Sabine Grove', color: '#ffffff', affinity: 50, relation: 'peace' as const,
    population: 2, food: 0, gold, production: 0, culture: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false };
  return {
    world: { width: 64, height: 64, seed: 'village-development', source: 'test', revision: 0, spawns: [],
      tiles: Array.from({ length: 64 * 64 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 1, production: 0, gold: 0, variation: .5 })) },
    villages: [{ id: 1, faction: 1, campId: 100, name: 'Sabine Grove', identity: 'growers', relation: 'neutral', x: 32, y: 32,
      nextGrowthAt: 90, nextThinkAt: 0, nextRecruitAt: 90 }],
    buildings: [[30, 31], [34, 31], [32, 34]].map(([x, y], i) => ({ id: 100 + i, kind: 'villageTent',
      faction: 1, villageId: 1, x, y, hp: 500, maxHp: 500, capacity: 0 })),
    units: [0, 1].map(i => ({ id: 1 + i, kind: 'worker', faction: 1, villageId: 1, x: 30.5 + i, y: 33.5, hp: 45, maxHp: 45,
      attack: 8, defense: 1, speed: 2.4, morale: 100, range: .9, order: 'wander', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 })),
    factions: [faction], time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: null,
    selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'village-development', rngState: 101,
  };
}
function advance(state: GameState, pulses: number): void {
  for (let i = 0; i < pulses; i++) { state.time += 90; updateVillages(state); }
}
function clusters(houses: Building[]): Building[][] {
  const remaining = new Set(houses), result: Building[][] = [];
  while (remaining.size) {
    const cluster = [remaining.values().next().value!]; remaining.delete(cluster[0]);
    for (const house of cluster) for (const other of remaining)
      if (Math.abs(house.x - other.x) + Math.abs(house.y - other.y) === 1) { remaining.delete(other); cluster.push(other); }
    result.push(cluster);
  }
  return result;
}

describe('trade-funded village development', () => {
  it('does not give an untraded village free houses, defenses or guards, while civilians regenerate slowly', () => {
    const state = fixture();
    advance(state, 60);
    expect(state.buildings).toHaveLength(3);
    expect(state.units.filter(unit => unit.kind === 'warrior')).toHaveLength(0);
    expect(state.units.filter(unit => unit.kind === 'worker')).toHaveLength(5);
    expect(state.factions[0].gold).toBe(0); expect(state.factions[0].food).toBe(0);
  });

  it('spends actual village gold on gradual clumps, higher-quality housing and bounded defenses', () => {
    const state = fixture(10_000);
    state.time = 89; updateVillages(state); expect(state.buildings).toHaveLength(3);
    state.time = 90; updateVillages(state);
    const first = state.buildings.filter(building => building.kind === 'house');
    expect(first.length).toBeGreaterThanOrEqual(1); expect(first.length).toBeLessThanOrEqual(3);
    expect(state.units.filter(unit => unit.kind === 'warrior')).toHaveLength(1);
    expect(state.factions[0].gold).toBe(10_000 - first.length * VILLAGE_DEVELOPMENT_COSTS.house - VILLAGE_DEVELOPMENT_COSTS.guard);
    advance(state, 65);
    const houses = state.buildings.filter(building => building.kind === 'house');
    expect(houses).toHaveLength(10);
    expect(houses.every(house => house.houseLevel === 3 && house.houseStyle === 'cottage' && house.capacity === 4)).toBe(true);
    expect(state.buildings.filter(building => building.kind === 'guardPost')).toHaveLength(2);
    expect(state.buildings.filter(building => building.kind === 'woodenTower')).toHaveLength(4);
    expect(state.units.filter(unit => unit.kind === 'warrior')).toHaveLength(VILLAGE_MAX_GUARDS);
    expect(state.units.filter(unit => unit.kind === 'worker')).toHaveLength(20);
    expect(state.buildings.some(building => ['palace', 'wall', 'palisade', 'camp', 'farm'].includes(building.kind))).toBe(false);
    expect(state.buildings.every(building => Math.hypot(building.x - state.villages![0].x, building.y - state.villages![0].y) <= 6)).toBe(true);
    expect(state.units.some(unit => unit.kind === 'leader')).toBe(false);
    const groups = clusters(houses);
    expect(groups.every(group => group.length <= 3)).toBe(true);
    expect(groups.some(group => group.length > 1)).toBe(true);
    for (const group of groups) for (const house of group) for (const other of houses.filter(candidate => !group.includes(candidate)))
      expect(Math.max(Math.abs(house.x - other.x), Math.abs(house.y - other.y))).toBeGreaterThanOrEqual(2);
    const camp = state.buildings[0], origin = constructionEdges(state, camp)[0];
    expect(origin).toBeDefined();
    for (const building of state.buildings)
      expect(constructionEdges(state, building).some(exit => hasStaticPath(state, origin, exit, 1))).toBe(true);
    const expectedSpent = 10 * (40 + 50 + 100) + 2 * 120 + 4 * 100 + 12 * 40;
    expect(state.factions[0].gold).toBe(10_000 - expectedSpent);
    const gold = state.factions[0].gold, count = state.units.length;
    advance(state, 20);
    expect(state.factions[0].gold).toBe(gold); expect(state.units).toHaveLength(count);
  });

  it('retains purchased housing quality through ordinary city well and enclosure updates', () => {
    const state = fixture(10_000); advance(state, 65);
    updateWellUpgrades(state); state.time += 120; updateWellUpgrades(state);
    const houses = state.buildings.filter(building => building.kind === 'house');
    expect(houses).toHaveLength(10);
    expect(houses.every(house => house.houseLevel === 3 && house.houseDowngradeAt === undefined)).toBe(true);
  });

  it('requires a new paid recruit to replace a guard and never catches up a missed recruitment schedule in one step', () => {
    const state = fixture(10_000); advance(state, 65);
    state.units.find(unit => unit.kind === 'warrior')!.hp = 0;
    state.factions[0].gold = 0; advance(state, 1);
    expect(state.units.filter(unit => unit.kind === 'warrior' && unit.hp > 0)).toHaveLength(11);
    state.factions[0].gold = VILLAGE_DEVELOPMENT_COSTS.guard;
    state.time += 1000; updateVillages(state);
    expect(state.units.filter(unit => unit.kind === 'warrior' && unit.hp > 0)).toHaveLength(12);
    expect(state.factions[0].gold).toBe(0);
  });

  it('does not charge for a development site with no usable land', () => {
    const state = fixture(500); state.villages![0].nextRecruitAt = Infinity;
    const door = constructionEdges(state, state.buildings[0])[0];
    for (const tile of state.world.tiles) tile.terrain = 'ocean';
    state.world.tiles[Math.floor(door.y) * 64 + Math.floor(door.x)].terrain = 'grassland';
    for (const building of state.buildings) state.world.tiles[building.y * 64 + building.x].terrain = 'grassland';
    state.world.revision = 1; advance(state, 5);
    expect(state.factions[0].gold).toBe(500); expect(state.buildings).toHaveLength(3);
  });
});
