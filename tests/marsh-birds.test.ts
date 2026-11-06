import { describe, expect, it, vi } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { seededRandom } from '../src/world/generator';
import { initializeWildlife, isHuntable, rewardHunt, updateHerdAnimal, updateWildlife, WILDLIFE_FACTION } from '../src/game/hunting';
import { canMarshBirdMove, marshBirdFlockTarget, marshBirdHabitat, marshFlockGoal, moveMarshBird, spawnMarshBirdFlock } from '../src/game/marsh-birds';
import { pointInSight, updateFog } from '../src/game/fog';
import { beginUnitFrame, endUnitFrame, refreshIndexedUnit } from '../src/game/spatial';
import { canWalk } from '../src/game/pathfinding';
import { clearBuildingFootprint } from '../src/game/construction-clearance';
import { WATER, type GameState, type Unit, type WildlifeHerd } from '../src/game/types';

function fixture(): GameState {
  const width = 60, height = 40;
  return { world: { width, height, seed: 'marsh-flocks', source: 'test', spawns: [],
    tiles: Array.from({ length: width * height }, (_, cell) => {
      const x = cell % width, y = Math.floor(cell / width), marsh = x >= 25 && x <= 45 && y >= 12 && y <= 28;
      const water = marsh && (x % 3 === 0 || y % 4 === 0);
      return { terrain: water ? 'coast' : 'grassland', overlay: 'none', elevation: .3, moisture: .8,
        food: 2, production: 1, gold: 0, variation: .5, ...(marsh ? { delta: 1, marsh: !water, biome: 'wetland' } : {}) };
    }) },
    units: [], buildings: [], factions: [{ id: 0, name: 'Player', color: '#acf', relation: 'self', affinity: 100,
      food: 50, gold: 100, production: 0, population: 5, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 1e9, defeated: false }],
    wildlife: { herds: [], sequence: 0, nextRespawnAt: 1e9, targetHerds: 0 },
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'marsh-flocks', rngState: 1 } as GameState;
}
function bird(state: GameState, x = 29.5, y = 20.5): Unit {
  const unit: Unit = { id: 20, kind: 'marshBird', faction: WILDLIFE_FACTION, x, y, herdId: 1, hp: 8, maxHp: 8,
    attack: 0, defense: 0, morale: 100, speed: .75, range: 0, order: 'wander', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 };
  entityStore(state).units.add(unit);
  state.wildlife!.herds = [{ id: 1, species: 'marshBird', delta: 1, waypoint: { x: 34.5, y: 20.5 }, nextWanderAt: 30, wanderUntil: 30 }];
  return unit;
}

function walk(state: GameState, unit: Unit, flock: WildlifeHerd, seconds: number): void {
  for (let t = 0; t < seconds; t += .1) {
    beginUnitFrame(state);
    moveMarshBird(state, unit, flock, .1);
    refreshIndexedUnit(state, unit); endUnitFrame(state); state.time += .1;
    expect(canMarshBirdMove(state, unit, unit)).toBe(true);
  }
}

describe('marsh bird habitat and flocks', () => {
  it('spawns deterministic small flocks in hidden connected marsh and its channels, with no economy RNG use', () => {
    const a = fixture(), b = fixture();
    const first = spawnMarshBirdFlock(a, seededRandom('flock'))!, second = spawnMarshBirdFlock(b, seededRandom('flock'))!;
    expect(first).toEqual(second); expect(a.units).toEqual(b.units);
    expect(a.units.length).toBeGreaterThanOrEqual(4); expect(a.units.length).toBeLessThanOrEqual(8);
    const fog = updateFog(a);
    for (const unit of a.units) {
      expect(isHuntable(unit)).toBe(true); expect(unit.kind).toBe('marshBird');
      expect(marshBirdHabitat(a.world, unit.x, unit.y, first.delta)).toBe(true);
      expect(pointInSight(fog, unit.x, unit.y)).toBe(false);
    }
    expect(a.rngState).toBe(1);
  });

  it('requires actual marsh, bounds flock capacity, and does not spawn on a visible marsh', () => {
    const state = fixture();
    expect(marshBirdFlockTarget(state)).toBeGreaterThan(0);
    expect(marshBirdFlockTarget(state)).toBeLessThanOrEqual(16);
    for (const tile of state.world.tiles) delete tile.marsh;
    expect(marshBirdFlockTarget(state)).toBe(0);
    expect(spawnMarshBirdFlock(state, seededRandom('none'))).toBeUndefined();
    const visible = fixture();
    for (const [index, [x, y]] of [[29, 16], [40, 16], [29, 25], [40, 25]].entries())
      entityStore(visible).buildings.add({ id: index + 1, kind: 'palace', x, y, faction: 0, hp: 650, maxHp: 650, capacity: 0 });
    expect(spawnMarshBirdFlock(visible, seededRandom('visible'))).toBeUndefined();
  });

  it('initializes birds separately from boar carrying capacity and replaces only one missing flock per respawn', () => {
    const state = fixture(); delete state.wildlife;
    initializeWildlife(state);
    const flocks = state.wildlife!.herds.filter(herd => herd.species === 'marshBird');
    expect(flocks.length).toBe(marshBirdFlockTarget(state));
    entityStore(state).units.replace(state.units.filter(unit => unit.kind !== 'marshBird'));
    state.time = state.wildlife!.nextRespawnAt;
    updateWildlife(state);
    expect(state.wildlife!.herds.filter(herd => herd.species === 'marshBird')).toHaveLength(1);
    expect(state.units.filter(unit => unit.kind === 'marshBird').length).toBeGreaterThanOrEqual(4);
  });

  it('crosses land, delta boundaries and open water without invisible habitat barriers', () => {
    const state = fixture(), unit = bird(state, 29.5, 20.5);
    expect(canWalk(state, 30.5, 20.5, WILDLIFE_FACTION)).toBe(false);
    expect(canMarshBirdMove(state, unit, { x: 34.5, y: 20.5 })).toBe(true);
    expect(canMarshBirdMove(state, unit, { x: 24.5, y: 20.5 })).toBe(true);
    const other = state.world.tiles[20 * 60 + 32]; other.delta = 2;
    expect(canMarshBirdMove(state, unit, { x: 34.5, y: 20.5 })).toBe(true);
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) Object.assign(state.world.tiles[y * 60 + x], { terrain: 'ocean', delta: 1, marsh: false });
    expect(marshBirdHabitat(state.world, 3, 3, 1)).toBe(false);
    expect(canMarshBirdMove(state, unit, { x: 3.5, y: 3.5 })).toBe(true);
  });

  it('checks the whole swimming segment, including new buildings, terrain edits, ridges and diagonal corners', () => {
    const state = fixture(), unit = bird(state, 29.5, 20.5);
    const target = { x: 34.5, y: 20.5 }, obstacle = state.world.tiles[20 * 60 + 31];
    Object.assign(obstacle, { terrain: 'grassland', marsh: false, overlay: 'volcano' });
    expect(canMarshBirdMove(state, unit, target)).toBe(false);
    obstacle.marsh = true; obstacle.overlay = 'none'; obstacle.ridge = 4;
    expect(canMarshBirdMove(state, unit, target)).toBe(false);
    delete obstacle.ridge;
    entityStore(state).buildings.add({ id: 1, kind: 'house', faction: 0, x: 31, y: 20, hp: 100, maxHp: 100, capacity: 0 });
    expect(canMarshBirdMove(state, unit, target)).toBe(false);
    entityStore(state).buildings.replace([]);
    Object.assign(state.world.tiles[20 * 60 + 30], { terrain: 'grassland', overlay: 'volcano' });
    expect(canMarshBirdMove(state, unit, { x: 30.5, y: 21.5 })).toBe(false);
  });

  it('moves across alternating water and land without invoking soldier movement', () => {
    const state = fixture(), unit = bird(state), flock = state.wildlife!.herds[0], landMove = vi.fn();
    const start = unit.x;
    updateHerdAnimal(state, unit, .1, landMove);
    expect(landMove).not.toHaveBeenCalled();
    walk(state, unit, flock, 12);
    expect(unit.x).toBeGreaterThan(start + 3);
    expect(WATER.has(state.world.tiles[Math.floor(unit.y) * 60 + Math.floor(unit.x)].terrain)).toBe(true);
  });

  it('crosses cleared ground and chooses reachable flee destinations beyond its marsh', () => {
    const state = fixture(), unit = bird(state, 29.5, 19.5), flock = state.wildlife!.herds[0];
    for (let y = 17; y <= 21; y++) Object.assign(state.world.tiles[y * 60 + 32], { terrain: 'grassland', marsh: false });
    flock.waypoint = { x: 35.5, y: 19.5 };
    walk(state, unit, flock, 18);
    expect(unit.x).toBeGreaterThan(32);
    for (let i = 0; i < 20; i++) {
      const goal = marshFlockGoal(state, unit, unit, { x: unit.x - 1, y: unit.y }, seededRandom(String(i)));
      expect(canMarshBirdMove(state, { ...unit, ...goal }, goal)).toBe(true);
      flock.waypoint = goal; flock.fleeUntil = state.time + 3;
      walk(state, unit, flock, 1);
    }
  });

  it('awards exactly twenty food once per bird, without boar growth bonuses', () => {
    const state = fixture(), unit = bird(state); unit.hp = 0;
    entityStore(state).buildings.add({ id: 1, kind: 'palace', x: 29, y: 18, faction: 0, hp: 650, maxHp: 650, capacity: 0 });
    expect(rewardHunt(state, { faction: 0 }, unit)).toBe(true);
    expect(state.factions[0].food).toBe(70); expect(state.particles).toMatchObject([{ text: '+20 food', kind: 'hunt' }]);
    expect(state.buildings[0].huntingBonuses).toBeUndefined();
    rewardHunt(state, { faction: 0 }, unit);
    expect(state.factions[0].food).toBe(70); expect(state.particles).toHaveLength(1);
    expect(rewardHunt(state, { faction: 0 }, { ...unit, hp: 8, huntRewarded: false })).toBe(false);
  });

  it('keeps birds alive and resting when marsh is cleared into ordinary farmland', () => {
    const state = fixture(), unit = bird(state, 29.5, 19.5), flock = state.wildlife!.herds[0];
    delete flock.wanderUntil;
    for (const tile of state.world.tiles) { delete tile.marsh; delete tile.delta; }
    state.world.tiles[19 * 60 + 29].farm = 0;
    moveMarshBird(state, unit, flock, 1);
    expect(unit).toMatchObject({ hp: 8, x: 29.5, y: 19.5, moving: false });
  });

  it('uses identical paths and speed on land, water and mixed shorelines', () => {
    const states = [fixture(), fixture(), fixture()];
    for (const tile of states[0].world.tiles) { tile.terrain = 'grassland'; delete tile.marsh; delete tile.delta; }
    for (const tile of states[1].world.tiles) { tile.terrain = 'ocean'; delete tile.marsh; delete tile.delta; }
    const units = states.map(state => bird(state, 29.5, 19.5));
    for (let frame = 0; frame < 100; frame++) {
      for (const [i, state] of states.entries()) { moveMarshBird(state, units[i], state.wildlife!.herds[0], .1); state.time += .1; }
      expect(units[0].x).toBe(units[1].x); expect(units[0].y).toBe(units[1].y);
      expect(units[0].x).toBe(units[2].x); expect(units[0].y).toBe(units[2].y);
    }
    expect(units[0].x).toBeGreaterThan(32);
  });

  it('lets birds escape a new solid building onto ordinary land or water', () => {
    const state = fixture(), unit = bird(state, 29.5, 19.5), flock = state.wildlife!.herds[0];
    delete flock.wanderUntil;
    const site = { id: 2, kind: 'house' as const, x: 29, y: 19, faction: 0, hp: 100, maxHp: 100, capacity: 0 };
    entityStore(state).buildings.add(site);
    delete state.world.tiles[19 * 60 + 29].marsh;
    expect(clearBuildingFootprint(state, site)).toBe(false);
    expect(unit).toMatchObject({ x: 29.5, y: 19.5 });
    for (let i = 0; i < 5; i++) moveMarshBird(state, unit, flock, .1);
    expect(unit.hp).toBe(8);
    expect(canMarshBirdMove(state, unit, unit)).toBe(true);
    expect(clearBuildingFootprint(state, site)).toBe(true);
  });
});
