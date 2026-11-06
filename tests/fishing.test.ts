import { describe, expect, it } from 'vitest';
import { ECONOMY_INTERVAL } from '../src/game/economy-constants';
import { entityStore } from '../src/game/entity-store';
import {
  FISH_FOOD, FISH_RESPAWN_MEAN_SECONDS, FISHING_BOAT_CAPACITY, FISHING_BOAT_REPLACE_SECONDS,
  FISHING_BOAT_SPEED, FISHING_MAX_ZONES, FISHING_ZONE_CAPACITY, FISHING_ZONE_POPULATION,
  fishingCityFoodPerEconomyCycle, fishingNavigationStats, initializeFishing, updateFishing,
  type FishingFish,
} from '../src/game/fishing';
import { updateSailboatLaunches } from '../src/game/sailing';
import { markWorldChanged } from '../src/game/world-revisions';
import { distance, WATER, type Building, type GameState } from '../src/game/types';
import { withSimulationReads } from '../src/game/simulation-reads';
import { CHECK_INTERVAL } from '../src/game/work-cadence';

function fixture(width = 24, height = 18): GameState {
  return {
    world: { width, height, revision: 0, seed: 'fishing', source: 'test', spawns: [],
      tiles: Array.from({ length: width * height }, (_, i) => ({ terrain: Math.floor(i / width) < 4 ? 'grassland' : 'coast', overlay: 'none',
        elevation: .1, moisture: .5, food: 0, production: 0, gold: 0, variation: .5 })) },
    buildings: [
      { id: 1, kind: 'palace', faction: 0, x: 1, y: 0, hp: 650, maxHp: 650, capacity: 4 },
      { id: 2, kind: 'dock', faction: 0, x: 5, y: 3, dockFacing: 2, hp: 250, maxHp: 250, capacity: 0 },
    ], units: [],
    factions: [{ id: 0, name: 'Player', color: '#ee4040', affinity: 100, relation: 'self', food: 0, gold: 1000, production: 0,
      population: 25, culture: 0, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 1e9, defeated: false,
      research: { focus: 'sailing', levels: { sailing: 1 }, progress: {} } }],
    time: 0, tick: 0, paused: false, speed: 1, gameOver: false, victory: false, events: [], particles: [],
    selected: null, selectedType: null, buildMode: null, diplomacy: null, seed: 'fishing', rngState: 123,
    fields: [], raiderCamps: [], marauderPacks: [], villages: [], retinueStance: 'hold', movementMode: 'travel',
  } as unknown as GameState;
}
function advance(state: GameState, seconds: number, dt = .1): number {
  let food = 0;
  for (let elapsed = 0; elapsed < seconds - 1e-8;) {
    const step = Math.min(dt, seconds - elapsed); state.time += step; food += updateFishing(state, step); elapsed += step;
  }
  return food;
}
function controlled(state = fixture()) {
  updateFishing(state, 0);
  state.fishing!.fish = []; for (const zone of state.fishing!.zones) zone.nextSpawnAt = 1e12;
  const boat = state.fishing!.boats[0]; boat.target = undefined; boat.path = []; boat.phase = 'idle'; boat.nextPlanAt = 0;
  return { state, boat };
}
function addFish(state: GameState, x: number, y: number) {
  const fish: FishingFish = { id: ++state.fishing!.sequence, zone: state.fishing!.zones[0].id, x, y, food: FISH_FOOD, spawnedAt: state.time, facing: 0 };
  state.fishing!.fish.push(fish); return fish;
}

describe('finite natural fishing supply', () => {
  it('caps recurring fishing maintenance while preserving per-frame boat movement', () => {
    const { state, boat } = controlled(); addFish(state, 14.5, 5.5);
    state.time = 1;
    withSimulationReads(state, () => updateFishing(state, 0));
    expect(boat.phase).toBe('outbound');
    const boats = state.fishing!.boats, searchCount = fishingNavigationStats(state).fishSearches;
    const start = { x: boat.x, y: boat.y };
    for (let i = 1; i <= 18; i++) {
      const before = { x: boat.x, y: boat.y }; state.time = 1 + i / 60;
      withSimulationReads(state, () => updateFishing(state, 1 / 60));
      expect(state.fishing!.boats).toBe(boats);
      expect(distance(before, boat)).toBeGreaterThan(0);
      expect(distance(before, boat)).toBeLessThanOrEqual(FISHING_BOAT_SPEED / 60 + 1e-7);
    }
    expect(distance(start, boat)).toBeGreaterThan(.5);
    expect(fishingNavigationStats(state).fishSearches).toBe(searchCount);

    const empty = fixture(); entityStore(empty).buildings.retain(building => building.kind !== 'dock');
    const samples: number[] = []; let previous = empty.fishing?.boats;
    for (let i = 0; i < 120; i++) {
      empty.time = i / 60;
      withSimulationReads(empty, () => updateFishing(empty, 1 / 60));
      if (empty.fishing!.boats !== previous) { samples.push(empty.time); previous = empty.fishing!.boats; }
    }
    expect(samples.length).toBeLessThanOrEqual(6);
    expect(samples.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < samples.length; i++) expect(samples[i] - samples[i - 1]).toBeGreaterThanOrEqual(CHECK_INTERVAL - 1e-9);
  });
  it('swims continuously in water without altering food stocks or the spawning random stream', () => {
    const state = fixture(); entityStore(state).buildings.retain(b => b.kind !== 'dock'); updateFishing(state, 0);
    state.fishing!.zones.forEach(zone => zone.nextSpawnAt = 1e12);
    const initial = state.fishing!.fish.map(fish => ({ id: fish.id, x: fish.x, y: fish.y })), total = state.fishing!.fish.reduce((sum, fish) => sum + fish.food, 0);
    const random = state.fishing!.zones.map(zone => zone.rngState); let excursion = 0;
    for (let i = 0; i < 240; i++) {
      advance(state, .25, .25);
      for (const fish of state.fishing!.fish) {
        const before = initial.find(point => point.id === fish.id)!; excursion = Math.max(excursion, distance(before, fish));
        expect(WATER.has(state.world.tiles[Math.floor(fish.y) * state.world.width + Math.floor(fish.x)].terrain)).toBe(true);
        expect(distance(fish.swim!.origin, fish.swim!.end)).toBeLessThanOrEqual(1);
      }
    }
    expect(excursion).toBeGreaterThan(.9); expect(state.fishing!.zones.map(zone => zone.rngState)).toEqual(random);
    expect(state.fishing!.fish.reduce((sum, fish) => sum + fish.food, 0)).toBe(total);
    expect(state.factions[0].food).toBe(0);
  });

  it('keeps swimming fish in a narrow water channel instead of crossing its banks or a bridge', () => {
    const state = fixture(32, 10); entityStore(state).buildings.retain(b => b.kind !== 'dock');
    for (let y = 0; y < 10; y++) for (let x = 0; x < 32; x++) state.world.tiles[y * 32 + x].terrain = y === 5 ? 'river' : 'grassland';
    entityStore(state).buildings.add({ id: 90, kind: 'bridge', x: 16, y: 5, faction: 0, hp: 100, maxHp: 100, capacity: 0 });
    updateFishing(state, 0); state.fishing!.zones.forEach(zone => zone.nextSpawnAt = 1e12);
    for (let i = 0; i < 200; i++) {
      advance(state, .2, .2);
      for (const fish of state.fishing!.fish) { expect(fish.y).toBe(5.5); expect(Math.floor(fish.x)).not.toBe(16); }
    }
  });

  it.each([false, true])('separates waterfall fishing stocks without spawning or swimming on the face (raised shelf: %s)', raised => {
    const state = fixture(); entityStore(state).buildings.retain(b => b.kind !== 'dock');
    if (raised) for (let y = 0; y <= 8; y++) for (let x = 0; x < state.world.width; x++) state.world.tiles[y * state.world.width + x].ridge = 1;
    for (let x = 0; x < state.world.width; x++) state.world.tiles[8 * state.world.width + x].waterfall = 'south';
    initializeFishing(state);
    const zones = state.fishing!.zones;
    expect(zones.some(zone => zone.cells.every(cell => Math.floor(cell / state.world.width) < 8))).toBe(true);
    expect(zones.some(zone => zone.cells.every(cell => Math.floor(cell / state.world.width) > 8))).toBe(true);
    for (const zone of zones) {
      expect(new Set(zone.cells.map(cell => Math.floor(cell / state.world.width) < 8)).size).toBe(1);
      expect(zone.cells.every(cell => !state.world.tiles[cell].waterfall)).toBe(true);
      zone.nextSpawnAt = 1e12;
    }
    const initialSide = new Map(state.fishing!.fish.map(fish => [fish.id, fish.y < 8]));
    for (let i = 0; i < 100; i++) {
      advance(state, .25, .25);
      for (const fish of state.fishing!.fish) {
        expect(Math.floor(fish.y)).not.toBe(8);
        expect(fish.y < 8).toBe(initialSide.get(fish.id));
      }
    }
  });

  it('calibrates each zone to 25 residents, bounds stocks and does not bank full-stock arrivals', () => {
    expect(FISH_FOOD * ECONOMY_INTERVAL / FISH_RESPAWN_MEAN_SECONDS).toBe(FISHING_ZONE_POPULATION);
    const state = fixture(); entityStore(state).buildings.retain(building => building.kind !== 'dock');
    initializeFishing(state); expect(state.fishing!.zones.length).toBeGreaterThan(0);
    state.time = 10000; updateFishing(state, 0);
    for (const zone of state.fishing!.zones) {
      expect(state.fishing!.fish.filter(fish => fish.zone === zone.id)).toHaveLength(FISHING_ZONE_CAPACITY);
      expect(zone.nextSpawnAt).toBeGreaterThan(state.time);
      const mean = state.time / zone.spawnAttempts; expect(mean).toBeGreaterThan(5.5); expect(mean).toBeLessThan(6.5);
    }
    state.fishing!.fish = []; updateFishing(state, 0); expect(state.fishing!.fish).toHaveLength(0);
    expect(state.rngState).toBe(123);
  });

  it('keeps arrivals identical across frame sizes and a JSON save round trip', () => {
    const a = fixture(), b = fixture();
    for (const state of [a, b]) { entityStore(state).buildings.retain(building => building.kind !== 'dock'); initializeFishing(state); }
    advance(a, 120, .25); b.time = 120; updateFishing(b, 0);
    expect(a.fishing).toEqual(b.fishing);
    const saved = JSON.parse(JSON.stringify(b)) as GameState;
    advance(a, 120, .25); advance(saved, 120, .25); expect(a.fishing).toEqual(saved.fishing);
  });

  it('caps large maps and never creates additional zones when more docks are built', () => {
    const state = fixture(180, 120); initializeFishing(state);
    expect(state.fishing!.zones).toHaveLength(FISHING_MAX_ZONES);
    const ids = state.fishing!.zones.map(zone => zone.id);
    entityStore(state).buildings.add({ ...state.buildings[1], id: 3, x: 14 }); updateFishing(state, 0);
    expect(state.fishing!.zones.map(zone => zone.id)).toEqual(ids);
    expect(state.fishing!.boats).toHaveLength(2);
  });

  it('actually delivers approximately 25 residents of food from one nearby zone over an hour', () => {
    const samples: number[] = [];
    for (let seed = 0; seed < 8; seed++) {
      const state = fixture(); state.seed = `fishing-delivery-${seed}`; initializeFishing(state);
      const zone = state.fishing!.zones.find(zone => zone.cells.every(cell => cell % state.world.width < 12 && Math.floor(cell / state.world.width) < 12))!;
      expect(zone).toBeDefined(); state.fishing!.zones = [zone]; state.fishing!.fish = state.fishing!.fish.filter(fish => fish.zone === zone.id);
      advance(state, 600, .2); const before = state.factions[0].food;
      advance(state, 3000, .2); samples.push((state.factions[0].food - before) * ECONOMY_INTERVAL / 3000);
      expect(state.factions[0].incomeTotals?.food).toBe(state.factions[0].food);
      expect(state.buildings[0].foodDelivered).toBe(state.factions[0].food);
    }
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    console.info('Eight one-hour seeds, actual delivered food per 30 seconds:', { samples, mean });
    expect(mean).toBeGreaterThan(24); expect(mean).toBeLessThan(26);
  });
});

describe('automatic dock fishing boats', () => {
  it('still physically catches a moving fish with long simulation steps and delivers its unchanged yield', () => {
    const { state } = controlled(); addFish(state, 10.5, 6.5);
    advance(state, 30, 1);
    expect(state.fishing!.fish).toHaveLength(0); expect(state.factions[0].food).toBe(FISH_FOOD);
    expect(state.buildings[0].foodDelivered).toBe(FISH_FOOD);
  });
  it('launches once only after completion, separately from the Leader transport boat', () => {
    const state = fixture(), dock = state.buildings[1]; dock.construction = { startedAt: 0, duration: 30 };
    updateFishing(state, 1); expect(state.fishing!.boats).toHaveLength(0);
    delete dock.construction; updateSailboatLaunches(state); updateFishing(state, 0);
    expect(state.units.filter(unit => unit.kind === 'sailboat')).toHaveLength(1);
    expect(state.fishing!.boats).toHaveLength(1); expect(state.fishing!.boats[0].home).not.toEqual({ x: state.units[0].x, y: state.units[0].y });
    updateFishing(state, 1); expect(state.fishing!.boats).toHaveLength(1);
  });

  it('collects several fish on a trip and credits food only after physical delivery', () => {
    const { state, boat } = controlled();
    for (let x = 8; x < 12; x++) addFish(state, x + .5, 5.5);
    for (let i = 0; i < 200 && boat.cargo < FISHING_BOAT_CAPACITY; i++) {
      const previous = { x: boat.x, y: boat.y }; advance(state, .1);
      expect(distance(previous, boat)).toBeLessThanOrEqual(FISHING_BOAT_SPEED * .1 + .00001);
      expect(WATER.has(state.world.tiles[Math.floor(boat.y) * state.world.width + Math.floor(boat.x)].terrain)).toBe(true);
      expect(state.factions[0].food).toBe(0);
    }
    expect(boat.cargo).toBe(FISHING_BOAT_CAPACITY); expect(boat.phase).toBe('returning');
    expect(advance(state, 12)).toBe(FISHING_BOAT_CAPACITY); expect(boat.cargo).toBe(0);
    expect(state.buildings[0].foodDelivered).toBe(FISHING_BOAT_CAPACITY);
    expect(fishingCityFoodPerEconomyCycle(state, 1)).toBe(FISHING_BOAT_CAPACITY);
    advance(state, 100); expect(fishingCityFoodPerEconomyCycle(state, 1)).toBe(0);
  });

  it('coordinates shared fish claims between docks without duplicate harvest', () => {
    const { state } = controlled(); entityStore(state).buildings.add({ ...state.buildings[1], id: 3, x: 14 });
    for (let x = 7; x < 12; x++) addFish(state, x + .5, 6.5);
    updateFishing(state, 0);
    const targets = state.fishing!.boats.map(boat => boat.target).filter(target => target !== undefined);
    expect(new Set(targets).size).toBe(2); expect(targets).toHaveLength(2);
    advance(state, 50); expect(state.factions[0].food).toBe(25); expect(state.fishing!.fish).toHaveLength(0);
  });

  it('uses the owning city, discards captured cargo and starts a new owner boat', () => {
    const { state, boat } = controlled();
    state.factions.push({ ...state.factions[0], id: 1, name: 'Rival', relation: 'war', incomeTotals: undefined });
    entityStore(state).buildings.add({ ...state.buildings[0], id: 10, faction: 1, x: 15 });
    boat.cargo = 20; boat.phase = 'returning'; boat.x = 10.5;
    state.buildings[1].faction = 1; updateFishing(state, 0);
    expect(state.fishing!.boats).toHaveLength(1); expect(state.fishing!.boats[0]).toMatchObject({ faction: 1, city: 10, cargo: 0 });
    expect(state.factions.every(faction => faction.food === 0)).toBe(true);
    addFish(state, 7.5, 5.5); advance(state, 20);
    expect(state.factions[0].food).toBe(0); expect(state.factions[1].food).toBe(5);
    expect(state.buildings.find(building => building.id === 10)?.foodDelivered).toBe(5);
    expect(fishingCityFoodPerEconomyCycle(state, 1)).toBe(0);
  });

  it('clears reservations and delays replacement after destruction; city/dock loss stops service', () => {
    const { state, boat } = controlled(); const fish = addFish(state, 10.5, 6.5); updateFishing(state, 0);
    expect(fish.claimedBy).toBe(boat.id); boat.hp = 0; updateFishing(state, 0);
    expect(state.fishing!.boats).toHaveLength(0); expect(fish.claimedBy).toBeUndefined();
    advance(state, FISHING_BOAT_REPLACE_SECONDS - .1); expect(state.fishing!.boats).toHaveLength(0);
    advance(state, .2); expect(state.fishing!.boats).toHaveLength(1); expect(state.fishing!.boats[0].id).not.toBe(boat.id);
    state.buildings[0].hp = 0; updateFishing(state, 0); expect(state.fishing!.boats).toHaveLength(0);
    state.buildings[0].hp = 650; updateFishing(state, 0); expect(state.fishing!.boats).toHaveLength(1);
    state.buildings[1].hp = 0; updateFishing(state, 0); expect(state.fishing!.boats).toHaveLength(0);
  });
});

describe('water route correctness and caching', () => {
  it('replans a newly blocked route in transit without crossing the new bridge', () => {
    const { state, boat } = controlled(); addFish(state, 15.5, 5.5); advance(state, .8);
    const barrier: Building[] = [];
    for (let y = 4; y < state.world.height; y++) barrier.push({ id: 300 + y, kind: 'bridge', faction: 0, x: 9, y, hp: 100, maxHp: 100, capacity: 0 });
    entityStore(state).buildings.add(...barrier);
    for (let i = 0; i < 300; i++) {
      const previous = { x: boat.x, y: boat.y }; advance(state, .1);
      expect(distance(previous, boat)).toBeLessThanOrEqual(FISHING_BOAT_SPEED * .1 + .00001); expect(boat.x).toBeLessThan(9);
    }
    expect(state.factions[0].food).toBe(0); expect(state.fishing!.fish[0].claimedBy).toBeUndefined();
    entityStore(state).buildings.retain(building => building.id < 300); advance(state, 30);
    expect(state.factions[0].food).toBe(5);
  });

  it('routes around islands without crossing them and waits for disconnected water to reopen', () => {
    const state = fixture();
    for (let y = 4; y < 9; y++) state.world.tiles[y * state.world.width + 9].terrain = 'grassland';
    markWorldChanged(state.world, 'geometry'); const run = controlled(state), fish = addFish(state, 11.5, 5.5);
    updateFishing(state, 0); expect(run.boat.path.some(point => point.y >= 9.5)).toBe(true);
    for (let i = 0; i < 300; i++) { advance(state, .1); expect(state.world.tiles[Math.floor(run.boat.y) * state.world.width + Math.floor(run.boat.x)].terrain).toBe('coast'); }
    expect(state.factions[0].food).toBe(fish.food);
    for (let y = 4; y < state.world.height; y++) state.world.tiles[y * state.world.width + 9].terrain = 'grassland';
    markWorldChanged(state.world, 'geometry'); addFish(state, 11.5, 5.5); advance(state, 30);
    expect(state.factions[0].food).toBe(5); expect(run.boat.moving).toBe(false);
    state.world.tiles[9 * state.world.width + 9].terrain = 'coast'; markWorldChanged(state.world, 'geometry'); advance(state, 30);
    expect(state.factions[0].food).toBe(10);
  });

  it.each(['bridge', 'ford', 'cliff'] as const)('does not cross a complete %s barrier', barrier => {
    const state = fixture();
    if (barrier === 'bridge') {
      const structures: Building[] = [];
      for (let y = 4; y < state.world.height; y++) structures.push({ id: 100 + y, kind: 'bridge', faction: 0, x: 9, y, hp: 100, maxHp: 100, capacity: 0 });
      entityStore(state).buildings.add(...structures);
    } else {
      for (let y = 4; y < state.world.height; y++) {
        if (barrier === 'ford') {
          state.world.tiles[y * state.world.width + 9].terrain = 'river';
          state.world.tiles[y * state.world.width + 9].overlay = 'ford';
        }
        else for (let x = 9; x < state.world.width; x++) state.world.tiles[y * state.world.width + x].ridge = 1;
      }
      markWorldChanged(state.world, 'geometry');
    }
    const { boat } = controlled(state); const fish = addFish(state, 11.5, 5.5); advance(state, 30);
    expect(state.factions[0].food).toBe(0); expect(fish.claimedBy).toBeUndefined(); expect(boat).toMatchObject(boat.home);
  });

  it('reuses navigation and home reachability at rest and across unrelated land construction', () => {
    const { state, boat } = controlled(fixture(96, 64));
    advance(state, 2); const before = fishingNavigationStats(state); advance(state, 60);
    expect(fishingNavigationStats(state)).toEqual(before); expect(boat).toMatchObject(boat.home);
    entityStore(state).buildings.add({ id: 99, kind: 'house', faction: 0, x: 20, y: 0, hp: 100, maxHp: 100, capacity: 3 });
    markWorldChanged(state.world, 'structure'); updateFishing(state, .1);
    expect(fishingNavigationStats(state).navigationBuilds).toBe(before.navigationBuilds);
    expect(before.navigationBuilds).toBe(1); expect(before.homeSearches).toBe(1);
  });

  it('keeps route work bounded with eight docks, 64 zones and many land buildings', () => {
    const state = fixture(180, 120), additions: Building[] = [];
    for (let i = 1; i < 8; i++) additions.push({ ...state.buildings[1], id: 10 + i, x: 5 + i * 22 });
    for (let i = 0; i < 600; i++) additions.push({ id: 100 + i, kind: 'house', faction: 0,
      x: i % 180, y: Math.floor(i / 180), hp: 100, maxHp: 100, capacity: 4 });
    // Mooring banks remain clear; house positions model a dense developed city.
    entityStore(state).buildings.add(...additions.filter(building => building.kind === 'dock' || building.y < 3));
    updateFishing(state, 0); expect(state.fishing!.boats).toHaveLength(8);
    const start = performance.now(); advance(state, 60, .05); const elapsed = performance.now() - start;
    const work = fishingNavigationStats(state);
    console.info('Fishing 8 docks/64 zones/540 houses, milliseconds per update:', elapsed / 1200, work);
    expect(work.navigationBuilds).toBe(1); expect(work.homeSearches).toBe(8);
    expect(work.fishSearches).toBeLessThan(1000); expect(state.factions[0].food).toBeGreaterThan(100);
    expect(state.fishing!.fish.length).toBeLessThanOrEqual(FISHING_MAX_ZONES * FISHING_ZONE_CAPACITY);
  });
});
