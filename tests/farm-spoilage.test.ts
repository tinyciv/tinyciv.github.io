import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { ensureCollectors, FIELD_HARVEST_FOOD, FIELD_SPOIL_SECONDS, fieldSpoilsSoon, synchronizeFarms, updateCollector, updateHarvests } from '../src/game/farms';
import { findPath } from '../src/game/pathfinding';
import { validateNetworkPlacement } from '../src/game/network-placement';
import { planHouseSite } from '../src/game/housing';
import { updateGame } from '../src/game/simulation';
import { type Building, type GameState } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
function fixture(population = 4): GameState {
  const state: GameState = {
    world: { width: 72, height: 72, seed: 'harvest-expiry', source: 'test', spawns: [], tiles: Array.from({ length: 72 * 72 }, () =>
      ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 35, y: 35, hp: 650, maxHp: 650, capacity: 0, populationGrowth: -10000, governorPermissions: { farms: false, housing: false } },
      { id: 2, kind: 'camp', faction: 0, x: 39, y: 35, hp: 100, maxHp: 100, capacity: 0 }],
    units: [{ id: 3, kind: 'leader', faction: 0, x: 60.5, y: 60.5, hp: 100, morale: 100, attack: 25, defense: 5,
      speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: population * 3, gold: 500, production: 0,
      population, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 1e9, nextRetinueAt: 1e9, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: 3, selectedType: 'unit',
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'harvest-expiry', rngState: 1,
    marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 1 },
  };
  synchronizeFarms(state); ensureCollectors(state);
  return state;
}

describe('perishable farm harvests', () => {
  it('warns before ripe food expires, reports exactly the lost batch, and keeps newer food fresh', () => {
    const state = fixture(), field = state.fields![0], treasury = state.factions[0].food;
    field.nextHarvest = 30; state.time = 30; updateHarvests(state);
    expect(field.food).toBe(FIELD_HARVEST_FOOD);
    expect(field.expiresAt).toBe(30 + FIELD_SPOIL_SECONDS);
    field.nextHarvest = 35; state.time = 35; updateHarvests(state);
    // Isolate two batches so a new harvest at the expiry boundary cannot mask
    // the loss of the oldest bag.
    field.nextHarvest = 1000;
    state.time = 30 + FIELD_SPOIL_SECONDS - 3; updateHarvests(state);
    expect(fieldSpoilsSoon(field, state.time)).toBe(true);
    expect(field.food).toBeCloseTo(FIELD_HARVEST_FOOD * 2);
    state.time = 30 + FIELD_SPOIL_SECONDS; updateHarvests(state);
    expect(field.food).toBeCloseTo(FIELD_HARVEST_FOOD);
    expect(field.expiresAt).toBe(35 + FIELD_SPOIL_SECONDS);
    expect(state.particles.some(particle => particle.x === field.x + .5 && particle.text === `−${Number(FIELD_HARVEST_FOOD.toFixed(1))} food`)).toBe(true);
    expect(state.factions[0].food).toBe(treasury);
  });

  it('keeps the original deadline after pickup and cannot deliver spoiled cargo', () => {
    const state = fixture(), field = state.fields![0], collector = state.units.find(unit => unit.collector)!;
    field.food = 4; field.foodBatches = [{ amount: 4, expiresAt: 10 }]; field.expiresAt = 10; field.nextHarvest = 1000;
    Object.assign(collector, { inside: false, x: field.x + .5, y: field.y + .5, field: field.id, collectPhase: 'outbound' });
    state.time = 9; updateCollector(state, collector, .1, () => {});
    expect(collector.cargo).toBe(4); expect(collector.cargoExpiresAt).toBe(10); expect(field.food).toBe(0);
    const treasury = state.factions[0].food;
    state.time = 10; updateCollector(state, collector, .1, () => {});
    expect(collector.cargo).toBe(0); expect(state.factions[0].food).toBe(treasury);
    expect(state.particles.some(particle => particle.text === '−4 food')).toBe(true);
  });

  it('does not reset deadlines when farms synchronize or a courier is reassigned', () => {
    const state = fixture(), field = state.fields![0];
    field.food = 2; field.foodBatches = [{ amount: 2, expiresAt: 20 }]; field.expiresAt = 20;
    state.time = 15; synchronizeFarms(state); ensureCollectors(state); synchronizeFarms(state);
    expect(field.expiresAt).toBe(20); expect(field.foodBatches).toEqual([{ amount: 2, expiresAt: 20 }]);
    state.time = 20; updateHarvests(state); expect(field.food).toBe(0);
  });

  it.each(['outbound', 'returning'] as const)('falls back to a reachable opposite-flow door when %s doors are isolated', flow => {
    const state = fixture(), farm = state.buildings[1], corridorY = flow === 'outbound' ? 35 : 36;
    for (const tile of state.world.tiles) { tile.terrain = 'lake'; delete tile.farm; }
    Object.assign(farm, { x: 29, y: corridorY });
    const land = (x: number, y: number) => { state.world.tiles[y * state.world.width + x].terrain = 'grassland'; };
    for (let x = 29; x <= 34; x++) land(x, corridorY);
    for (let y = farm.y; y < farm.y + 2; y++) for (let x = farm.x; x < farm.x + 2; x++) land(x, y);
    for (let y = 35; y < 37; y++) for (let x = 35; x < 37; x++) land(x, y);
    // The preferred east door is walkable but belongs to a separate island.
    land(37, corridorY);
    state.fields = []; entityStore(state).units.replace([state.units[0]]);
    Object.assign(state.units[0], { x: 32.5, y: corridorY + .5 });
    synchronizeFarms(state); ensureCollectors(state);
    const field = state.fields!.find(plot => plot.y === corridorY)!;
    for (const plot of state.fields!) plot.nextHarvest = 1000;
    field.food = 4; field.foodBatches = [{ amount: 4, expiresAt: 75 }]; field.expiresAt = 75;
    for (let step = 0; step < 250; step++) updateGame(state, .1, idle);
    expect(state.buildings[0].foodDelivered).toBe(4);
    expect(state.units.find(unit => unit.collector)?.inside).toBe(true);
  });

  it('cannot sustain a 300-person city from 300 unirrigated farm tiles', () => {
    const state = fixture(300), faction = state.factions[0];
    entityStore(state).buildings.replace([state.buildings[0]]); state.fields = []; entityStore(state).units.replace([state.units[0]]);
    let id = 10;
    // Established towns have the palace road loop and builder-laid approaches.
    for (let y = 34; y <= 37; y++) for (let x = 34; x <= 37; x++) if (x === 34 || x === 37 || y === 34 || y === 37)
      entityStore(state).buildings.add({ id: id++, kind: 'road', faction: 0, x, y, hp: 60, maxHp: 60, capacity: 0 });
    // A planned large town retains an arterial route from each palace side.
    // Free-form housing can be much denser than the former 2×4 zoning: mark the
    // roads before filling parcels so this test measures food distance/decay,
    // rather than asking a single narrow residential alley to carry the city’s couriers.
    for (let n = 14; n <= 56; n++) {
      const point = n < 34 ? [{ x: n, y: 34 }, { x: 37, y: n }]
        : n > 37 ? [{ x: n, y: 37 }, { x: 34, y: n }] : [];
      for (const { x, y } of point) entityStore(state).buildings.add({ id: id++, kind: 'road', faction: 0, x, y, hp: 60, maxHp: 60, capacity: 0 });
    }
    // Fifty level-two homes in the remaining reachable parcels supply 300 beds.
    for (let i = 0; i < 50; i++) {
      const plan = planHouseSite(state, state.buildings[0]);
      expect(plan, `house ${i + 1} has a legal site`).toBeDefined();
      entityStore(state).buildings.add({ id: id++, kind: 'house', faction: 0, ...plan!.point,
        hp: 200, maxHp: 200, capacity: 6, houseLevel: 2 } as Building);
    }
    // Dense, touching crop cells fill the land around the reserved roads.
    const sites: { x: number; y: number }[] = [];
    for (let y = 14; y <= 56; y++) for (let x = 14; x <= 56; x++) {
      const distance = Math.hypot(x + .5 - 36, y + .5 - 36);
      if (distance < 11 || distance > 22) continue;
      if (state.buildings.some(building => x >= building.x && x < building.x + (building.kind === 'palace' ? 2 : 1) && y >= building.y && y < building.y + (building.kind === 'palace' ? 2 : 1))) continue;
      sites.push({ x, y });
    }
    sites.sort((a, b) => Math.hypot(a.x - 35, a.y - 35) - Math.hypot(b.x - 35, b.y - 35));
    for (const point of sites.slice(0, 300)) entityStore(state).buildings.add({ id: id++, kind: 'camp', faction: 0, ...point, hp: 100, maxHp: 100, capacity: 0 });
    for (const farm of state.buildings.filter(building => building.kind === 'camp')) {
      const path = findPath(state, { x: 34.5, y: 35.5 }, { x: farm.x + .5, y: farm.y + .5 }, 0);
      for (const point of path) {
        const x = Math.floor(point.x), y = Math.floor(point.y);
        if (state.buildings.some(building => x >= building.x && y >= building.y
          && x < building.x + (building.kind === 'palace' ? 2 : 1)
          && y < building.y + (building.kind === 'palace' ? 2 : 1))) continue;
        if (!validateNetworkPlacement(state, 'road', x, y, 0).ok) continue;
        entityStore(state).buildings.add({ id: id++, kind: 'road', faction: 0, x, y, hp: 60, maxHp: 60, capacity: 0 });
      }
      state.world.revision = (state.world.revision ?? 0) + 1;
    }
    synchronizeFarms(state); ensureCollectors(state);
    expect(state.fields).toHaveLength(300);
    expect(state.units.filter(unit => unit.collector).length).toBeLessThanOrEqual(300);
    let delivered = 0, consumed = 0, baseline = 0;
    for (let step = 0; step < 6000; step++) {
      const previousTick = state.tick;
      updateGame(state, .1, idle);
      if (state.tick > previousTick) consumed += 300;
      delivered = state.buildings[0].foodDelivered ?? 0;
      if (step === 1199) baseline = delivered;
    }
    const deliveriesPerCycle = (delivered - baseline) / 16;
    console.log(JSON.stringify({ population: faction.population, tiles: state.fields!.length, deliveriesPerCycle, foodRemaining: faction.food, delivered, consumed }));
    expect(state.gameOver).toBe(false);
    expect(faction.population).toBe(300);
    // Even with dedicated arteries and nearby multi-pickups, these 300 crop
    // cells cannot cover 300 residents under the unchanged decay clock.
    expect(deliveriesPerCycle).toBeLessThan(faction.population * .6);
    expect(faction.food).toBe(0);
  }, 90000);
});
