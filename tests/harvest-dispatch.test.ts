import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { beginCollectorFrame, endCollectorFrame, ensureCollectors, FIELD_SPOIL_SECONDS,
  synchronizeFarms, updateCollector, updateHarvests } from '../src/game/farms';
import { beginNavigationFrame, endNavigationFrame } from '../src/game/pathfinding';
import { panicCivilian } from '../src/game/civilian-panic';
import { parseGameSave, serializeGameSave } from '../src/game/game-save';
import { moveUnit } from '../src/game/simulation';
import { beginUnitFrame, endUnitFrame, refreshIndexedUnit } from '../src/game/spatial';
import type { Building, GameState, Point, Unit } from '../src/game/types';

const building = (id: number, kind: Building['kind'], x: number, y: number): Building => ({
  id, kind, x, y, faction: 0, hp: 200, maxHp: 200, capacity: kind === 'palace' ? 100 : 0,
  unhousedResidents: kind === 'palace' ? 100 : undefined, governorPermissions: { farms: false, housing: false },
});
function fixture(points: Point[], shelfLife = FIELD_SPOIL_SECONDS): GameState {
  const state: GameState = {
    world: { width: 40, height: 40, revision: 0, seed: 'harvest-dispatch', source: 'test', spawns: [],
      tiles: Array.from({ length: 1600 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
        moisture: .6, food: 2, production: 0, gold: 0, variation: .5 })) },
    buildings: [building(1, 'palace', 16, 16), ...points.map(({ x, y }, i) => building(100 + i, 'camp', x, y))],
    units: [], fields: [], factions: [{ id: 0, name: 'Test', color: '#f34f59', affinity: 100, relation: 'self', food: 100,
      gold: 100, production: 0, population: 100, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false }],
    time: 10, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'harvest-dispatch', rngState: 1,
  };
  synchronizeFarms(state);
  for (const field of state.fields!) Object.assign(field, { food: 1, nextHarvest: 1e9,
    foodBatches: [{ amount: 1, expiresAt: state.time + shelfLife }], expiresAt: state.time + shelfLife });
  ensureCollectors(state);
  return state;
}
function frame(state: GameState, dt = .05, move = moveUnit): number {
  state.time += dt; state.tick++;
  updateHarvests(state);
  if (state.tick % 7 === 0) ensureCollectors(state);
  beginCollectorFrame(state); beginUnitFrame(state); beginNavigationFrame(state);
  let departures = 0;
  try {
    for (const unit of state.units) if (unit.collector && unit.hp > 0 && !unit.civilianPanic) {
      const inside = unit.inside;
      updateCollector(state, unit, dt, move);
      refreshIndexedUnit(state, unit);
      if (inside && !unit.inside) departures++;
    }
  } finally { endNavigationFrame(state); endUnitFrame(state); endCollectorFrame(state); }
  return departures;
}
const block = (x: number, y: number): Point[] => Array.from({ length: 4 }, (_, i) => ({ x: x + i % 2, y: y + Math.floor(i / 2) }));

describe('staggered, coordinated harvest dispatch', () => {
  it.each([0, 1, 2, 3, 4, 5, 8, 9, 16, 64])('allocates one gatherer to each contiguous parcel (%i connected tiles)', count => {
    const points = Array.from({ length: count }, (_, i) => ({ x: 2 + i % 10, y: 2 + Math.floor(i / 10) }));
    const state = fixture(points);
    expect(state.units.filter(unit => unit.collector)).toHaveLength(count ? 1 : 0);
    const ids = state.units.map(unit => unit.id);
    ensureCollectors(state);
    expect(state.units.map(unit => unit.id)).toEqual(ids);
  });

  it('still limits the shared gathering pool to real residents after builder capacity', () => {
    const state = fixture([...block(19, 16), ...block(13, 16), ...block(16, 19)]);
    state.factions[0].population = 2;
    state.buildings[0].unhousedResidents = 2;
    ensureCollectors(state);
    expect(state.units.filter(unit => unit.collector)).toHaveLength(1);
    state.factions[0].population = 0;
    state.buildings[0].unhousedResidents = 0;
    ensureCollectors(state);
    expect(state.units.filter(unit => unit.collector)).toHaveLength(0);
  });

  it('assigns disconnected parcels independently to their nearest city', () => {
    const state = fixture([{ x: 19, y: 16 }, ...block(6, 5).slice(0, 3)]);
    entityStore(state).buildings.add(building(2, 'palace', 3, 5));
    state.factions[0].population = 200;
    ensureCollectors(state);
    expect(state.units.filter(unit => unit.collector).map(unit => unit.home).sort()).toEqual([1, 2]);
  });

  it('counts only completed live farms when the city staffing requirement changes', () => {
    const state = fixture([...block(19, 16), { x: 13, y: 16 }]);
    const fifth = state.buildings.at(-1)!;
    fifth.construction = { startedAt: state.time, duration: 10 };
    ensureCollectors(state);
    expect(state.units.filter(unit => unit.collector)).toHaveLength(1);
    delete fifth.construction;
    ensureCollectors(state);
    expect(state.units.filter(unit => unit.collector)).toHaveLength(2);
    fifth.hp = 0;
    ensureCollectors(state);
    expect(state.units.filter(unit => unit.collector)).toHaveLength(1);
  });

  it('assigns one peasant to a four-field block and collects all four bags in one trip', () => {
    const state = fixture(block(19, 16));
    expect(state.units.filter(unit => unit.collector)).toHaveLength(1);
    expect(frame(state)).toBe(1);
    const worker = state.units.find(unit => unit.collector && !unit.inside)!;
    expect(worker.collectorStops).toHaveLength(3);
    expect(state.fields!.every(field => field.claimedBy === worker.id)).toBe(true);
    ensureCollectors(state); updateHarvests(state);
    expect(state.fields!.every(field => field.claimedBy === worker.id)).toBe(true);
    let largestLoad = 0;
    for (let i = 0; i < 200; i++) { frame(state); largestLoad = Math.max(largestLoad, worker.cargo ?? 0); }
    expect(largestLoad).toBe(4);
    expect(state.buildings[0].foodDelivered).toBe(4);
    expect(state.factions[0].food).toBe(104);
    expect(state.fields!.every(field => field.food === 0 && field.claimedBy === undefined)).toBe(true);
    expect(worker.inside).toBe(true);
  });

  it('spreads separate harvest teams across frames instead of spawning a single wave', () => {
    const state = fixture([...block(19, 16), ...block(13, 16), ...block(16, 19), ...block(16, 13)]);
    const departures: { time: number; count: number }[] = [];
    for (let i = 0; i < 220; i++) {
      const count = frame(state);
      if (count) departures.push({ time: state.time, count });
    }
    expect(departures.length).toBeGreaterThan(2);
    expect(Math.max(...departures.map(sample => sample.count))).toBeLessThanOrEqual(2);
    expect(departures.at(-1)!.time - departures[0].time).toBeGreaterThan(.5);
    expect(departures.reduce((sum, sample) => sum + sample.count, 0)).toBeLessThanOrEqual(6);
    expect(state.buildings[0].foodDelivered).toBe(16);
  });

  it('lets separate settlements dispatch independently', () => {
    const state = fixture([...block(19, 16), ...block(6, 5)]);
    entityStore(state).buildings.add(building(2, 'palace', 3, 5));
    state.factions[0].population = 200;
    ensureCollectors(state);
    frame(state);
    const homes = new Set(state.units.filter(unit => unit.collector && !unit.inside).map(unit => unit.home));
    expect(homes).toEqual(new Set([1, 2]));
  });

  it('preserves an in-flight sweep and its original spoilage deadlines through save/reload', () => {
    const state = fixture(block(19, 16)); frame(state);
    const first = state.units.find(unit => unit.collector && !unit.inside)!;
    const savedStops = [...first.collectorStops!], savedDeadline = state.fields![0].expiresAt;
    const restored = parseGameSave(serializeGameSave(state));
    expect(restored.units.find(unit => unit.id === first.id)!.collectorStops).toEqual(savedStops);
    for (let i = 0; i < 200; i++) frame(restored);
    expect(restored.buildings[0].foodDelivered).toBe(4);
    expect(restored.fields!.every(field => field.claimedBy === undefined)).toBe(true);
    expect(savedDeadline).toBe(10 + FIELD_SPOIL_SECONDS);
  });

  it('does not delay a separate urgent crop past its last viable departure', () => {
    // Two ripe parcels dispatch; the third unripe parcel remains idle.
    const state = fixture([{ x: 19, y: 16 }, { x: 13, y: 16 }, ...block(3, 3).slice(0, 3)]);
    for (const field of state.fields!.slice(2)) { field.food = 0; field.foodBatches = []; field.expiresAt = undefined; }
    const urgent = state.fields![1]; urgent.expiresAt = state.time + 2.1;
    urgent.foodBatches = [{ amount: 1, expiresAt: urgent.expiresAt }];
    frame(state);
    expect(state.units.filter(unit => unit.collector && !unit.inside)).toHaveLength(2);
    for (let i = 0; i < 50; i++) frame(state);
    expect(state.buildings[0].foodDelivered).toBe(2);
  });

  it.each(['death', 'panic', 'stalled'] as const)('frees reserved bags when their courier is %s', reason => {
    const state = fixture(block(19, 16)); frame(state);
    const worker = state.units.find(unit => unit.collector && !unit.inside)!, stops = [...worker.collectorStops!];
    if (reason === 'death') worker.hp = 0;
    if (reason === 'panic') panicCivilian(state, worker, { x: 20, y: 16 });
    if (reason === 'stalled') {
      updateCollector(state, worker, .05, () => {});
      state.time += 2.1; updateCollector(state, worker, .05, () => {});
    } else { updateHarvests(state); ensureCollectors(state); }
    expect(stops.every(id => state.fields!.find(field => field.id === id)?.claimedBy !== worker.id)).toBe(true);
  });

  it('delivers a 64-plot simultaneous harvest with fewer trips and a bounded departure peak', () => {
    const points: Point[] = [];
    for (const [ox, oy] of [[11, 11], [18, 11], [11, 18], [18, 18]])
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) points.push({ x: ox + x, y: oy + y });
    const state = fixture(points);
    let departures = 0, peakDepartures = 0, peakActive = 0, largestLoad = 0;
    const startedAt = performance.now();
    for (let i = 0; i < 600; i++) {
      const leaving = frame(state); departures += leaving; peakDepartures = Math.max(peakDepartures, leaving);
      peakActive = Math.max(peakActive, state.units.filter(unit => unit.collector && !unit.inside).length);
      largestLoad = Math.max(largestLoad, ...state.units.map(unit => unit.cargo ?? 0));
    }
    const delivered = state.buildings[0].foodDelivered ?? 0;
    console.log(JSON.stringify({ harvestPlots: 64, departures, peakDepartures, peakActive, largestLoad, delivered,
      cpuMs: Math.round(performance.now() - startedAt) }));
    expect(delivered).toBe(64);
    expect(departures).toBe(4);
    expect(peakDepartures).toBeLessThanOrEqual(3);
    expect(largestLoad).toBe(16);
    expect(state.units.filter(unit => unit.collector)).toHaveLength(4);
    expect(peakActive).toBeLessThanOrEqual(4);
  });
});
