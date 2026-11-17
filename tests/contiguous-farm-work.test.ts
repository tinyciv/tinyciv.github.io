import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { farmWorkGroups } from '../src/game/farm-work-groups';
import { farmHarvestMarkers, parcelHarvest } from '../src/game/farm-parcels';
import { withSimulationReads } from '../src/game/simulation-reads';
import { prepareCourierUpdates, settleCourier, wakeFarmCouriers } from '../src/game/courier-sleep';
import { beginCollectorFrame, endCollectorFrame, ensureCollectors, FIELD_SPOIL_SECONDS,
  synchronizeFarms, updateCollector, updateHarvests, updateScheduledHarvests } from '../src/game/farms';
import type { Building, GameState, Point, Unit } from '../src/game/types';

function fixture(points: Point[] = Array.from({ length: 16 }, (_, i) => ({ x: 9 + i % 4, y: 6 + Math.floor(i / 4) }))): GameState {
  const state: GameState = {
    world: { width: 80, height: 60, seed: 'parcel-workers', source: 'test', spawns: [],
      tiles: Array.from({ length: 4800 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .5, food: 2, production: 0, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', x: 2, y: 7, faction: 0, hp: 650, maxHp: 650, capacity: 1000 },
      ...points.map((point, i): Building => ({ id: i + 2, kind: 'camp', ...point, faction: 0, hp: 100, maxHp: 100, capacity: 0 }))],
    units: [], fields: [], factions: [{ id: 0, name: 'Test', color: '#f34f59', affinity: 100, relation: 'self',
      food: 20, gold: 20, production: 0, population: 100, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'parcel-workers', rngState: 1,
  };
  synchronizeFarms(state); ensureCollectors(state);
  return state;
}
const collectors = (state: GameState) => state.units.filter(unit => unit.collector && unit.hp > 0);
function ripe(state: GameState, expiresAt = FIELD_SPOIL_SECONDS): void {
  for (const field of state.fields!) Object.assign(field, { nextHarvest: 1000, food: 4, expiresAt, foodBatches: [{ amount: 4, expiresAt }] });
}
function walk(_state: GameState, unit: Unit, goal: Point, dt: number): void {
  let remaining = unit.speed * dt;
  while (remaining > 1e-9) {
    const target = unit.path?.[0] ?? goal, dx = target.x - unit.x, dy = target.y - unit.y, d = Math.hypot(dx, dy);
    if (d <= remaining) {
      unit.x = target.x; unit.y = target.y; remaining -= d;
      if (unit.path?.length) unit.path.shift(); else break;
    } else { unit.x += dx / d * remaining; unit.y += dy / d * remaining; break; }
  }
}

describe('one gatherer per contiguous field', () => {
  it('uses one worker for 16 connected cells and keeps diagonal/disconnected plots separate', () => {
    const state = fixture(); expect(collectors(state)).toHaveLength(1);
    entityStore(state).buildings.add({ id: 100, kind: 'camp', x: 13, y: 10, faction: 0, hp: 100, maxHp: 100, capacity: 0 });
    synchronizeFarms(state); ensureCollectors(state);
    expect(farmWorkGroups(state).groups).toHaveLength(2); expect(collectors(state)).toHaveLength(2);
  });

  it('merges and splits jobs without duplicating workers or losing carried food', () => {
    const state = fixture([{ x: 7, y: 7 }, { x: 9, y: 7 }]);
    expect(collectors(state)).toHaveLength(2);
    const second = collectors(state)[1];
    Object.assign(second, { cargo: 4, cargoField: state.fields![1].id, cargoBatches: [{ amount: 4, expiresAt: 30 }], cargoExpiresAt: 30 });
    entityStore(state).buildings.add({ id: 100, kind: 'camp', x: 8, y: 7, faction: 0, hp: 100, maxHp: 100, capacity: 0 });
    synchronizeFarms(state); ensureCollectors(state);
    expect(collectors(state)).toHaveLength(1);
    expect(state.fields!.reduce((n, field) => n + field.food, 0) + collectors(state).reduce((n, unit) => n + (unit.cargo ?? 0), 0)).toBe(4);
    entityStore(state).buildings.retain(building => building.id !== 100);
    synchronizeFarms(state); ensureCollectors(state); ensureCollectors(state);
    expect(collectors(state)).toHaveLength(2);
    expect(new Set(collectors(state).map(unit => farmWorkGroups(state).byCamp.get(unit.collectorCamp!))).size).toBe(2);
  });

  it('keeps a field that straddles two cities to one collector', () => {
    const state = fixture();
    entityStore(state).buildings.add({ id: 100, kind: 'palace', x: 16, y: 7, faction: 0, hp: 650, maxHp: 650, capacity: 100, unhousedResidents: 40 });
    synchronizeFarms(state); ensureCollectors(state);
    expect(collectors(state)).toHaveLength(1);
  });

  it('wakes the existing gatherer when a non-anchor plot in the parcel changes', () => {
    const state = fixture(), worker = collectors(state)[0];
    prepareCourierUpdates(state); settleCourier(state, worker);
    expect(entityStore(state).units.query('active')).not.toContain(worker);
    const other = state.fields!.find(field => field.camp !== worker.collectorCamp)!;
    wakeFarmCouriers(state, other.camp);
    expect(entityStore(state).units.query('active')).toContain(worker);
    expect(collectors(state)).toEqual([worker]);
  });

  it.each([false, true])('collects all 16 cells at one stop with fixed deadlines (scheduled=%s)', scheduled => {
    const state = fixture(), worker = collectors(state)[0]; ripe(state);
    let pickups = 0;
    for (let step = 0; step < 400; step++) {
      state.time = step / 10;
      (scheduled ? updateScheduledHarvests : updateHarvests)(state);
      const before = worker.cargo ?? 0;
      beginCollectorFrame(state); updateCollector(state, worker, .1, walk); endCollectorFrame(state);
      if ((worker.cargo ?? 0) > before) {
        pickups++;
        expect(worker.cargo).toBe(64);
        expect(worker.cargoBatches).toEqual([{ amount: 64, expiresAt: FIELD_SPOIL_SECONDS }]);
        expect(worker.collectPhase).toBe('returning');
        expect(state.fields!.every(field => field.food === 0)).toBe(true);
      }
      expect(state.fields!.every(field => (field.expiresAt ?? 0) <= FIELD_SPOIL_SECONDS)).toBe(true);
    }
    expect(pickups).toBe(1);
    expect(state.buildings[0].foodDelivered).toBeCloseTo(64);
    expect(worker.inside).toBe(true); expect(collectors(state)).toHaveLength(1);
  });

  it.each(['idle', 'returning', 'fleeing', 'outside'] as const)('does not preserve food while %s', mode => {
    const state = fixture(), worker = collectors(state)[0], field = state.fields![0]; ripe(state, 2);
    Object.assign(worker, { inside: false, x: field.x + .5, y: field.y + .5, field: field.id, collectPhase: 'outbound', cargo: 4,
      cargoBatches: [{ amount: 4, expiresAt: 2 }], cargoExpiresAt: 2 }); field.claimedBy = worker.id;
    if (mode === 'idle') worker.collectPhase = 'idle';
    if (mode === 'returning') worker.collectPhase = 'returning';
    if (mode === 'fleeing') worker.routed = true;
    if (mode === 'outside') worker.x = 5;
    updateHarvests(state); state.time = 3; updateHarvests(state);
    expect(state.fields!.every(field => field.food === 0)).toBe(true); expect(worker.cargo).toBe(0);
  });

  it('does not keep an abandoned pickup alive when the worker gets stuck', () => {
    const state = fixture(), worker = collectors(state)[0], field = state.fields!.at(-1)!; ripe(state, 3);
    Object.assign(worker, { inside: false, x: 9.5, y: 6.5, field: field.id, collectPhase: 'outbound' }); field.claimedBy = worker.id;
    for (let t = 0; t <= 8; t += .25) { state.time = t; updateHarvests(state); }
    expect(field.food).toBe(0);
  });

  it('reduces a 256-tile farm district from 64 gatherers to 16', () => {
    const points: Point[] = [];
    for (let block = 0; block < 16; block++) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++)
      points.push({ x: 8 + block % 4 * 5 + x, y: 5 + Math.floor(block / 4) * 5 + y });
    const state = fixture(points);
    expect(state.fields).toHaveLength(256); expect(collectors(state)).toHaveLength(16);
    const ids = collectors(state).map(unit => unit.id);
    for (let step = 0; step < 30; step++) { state.time += 1 / 3; ensureCollectors(state); }
    expect(collectors(state).map(unit => unit.id)).toEqual(ids);
  });
  it('draws one grain load for each connected parcel and removes it at pickup', () => {
    const state = fixture(), worker = collectors(state)[0]; ripe(state);
    const markers = farmHarvestMarkers(state);
    expect(markers.size).toBe(1);
    expect([...markers.values()][0].food).toBe(64);
    expect(farmHarvestMarkers(state)).toBe(markers);
    const field = state.fields![0];
    Object.assign(worker, { inside: false, x: field.x + .5, y: field.y + .5, field: field.id, collectPhase: 'outbound' });
    updateCollector(state, worker, .1, walk);
    expect(farmHarvestMarkers(state).size).toBe(0);
  });

  it('does not read crop readiness or rewrite tile deadlines while a collector travels', () => {
    const state = fixture(), worker = collectors(state)[0]; ripe(state);
    withSimulationReads(state, () => {
      updateScheduledHarvests(state);
      updateCollector(state, worker, .01, walk);
    });
    expect(worker.collectPhase).toBe('outbound');
    let foodReads = 0, deadlineWrites = 0;
    for (const field of state.fields!) {
      let food = field.food, expiresAt = field.expiresAt;
      Object.defineProperty(field, 'food', { configurable: true, get: () => { foodReads++; return food; }, set: value => { food = value; } });
      Object.defineProperty(field, 'expiresAt', { configurable: true, get: () => expiresAt, set: value => { deadlineWrites++; expiresAt = value; } });
    }
    for (let step = 1; step <= 200; step++) {
      state.time = step / 200;
      withSimulationReads(state, () => {
        updateScheduledHarvests(state);
        beginCollectorFrame(state); updateCollector(state, worker, .005, () => {}); endCollectorFrame(state);
      });
    }
    expect(foodReads).toBe(0); expect(deadlineWrites).toBe(0);
  });

  it('invalidates cached parcel readiness when the scheduled crop ripens', () => {
    const state = fixture();
    for (const field of state.fields!) field.nextHarvest = 1;
    withSimulationReads(state, () => {
      updateScheduledHarvests(state);
      const group = farmWorkGroups(state).groups[0];
      const empty = parcelHarvest(state, group);
      expect(empty.food).toBe(0);
      expect(parcelHarvest(state, group)).toBe(empty);
      state.time = 1; updateScheduledHarvests(state);
      expect(parcelHarvest(state, group).food).toBeGreaterThan(0);
    });
  });

  it('retains parcel readiness across unrelated road construction', () => {
    const state = fixture(); ripe(state); updateHarvests(state);
    withSimulationReads(state, () => {
      const group = farmWorkGroups(state).groups[0], before = parcelHarvest(state, group);
      expect(before.food).toBe(64);
      entityStore(state).buildings.add({ id: 500, kind: 'road', x: 1, y: 1, faction: 0, hp: 60, maxHp: 60, capacity: 0 });
      expect(parcelHarvest(state, group)).toBe(before);
    });
  });

  it('cultivates every mature orchard in a connected fallow parcel at one arrival', () => {
    const state = fixture();
    for (const camp of state.buildings) if (camp.kind === 'camp') {
      camp.orchard = { startedAt: -120, readyAt: 0 }; camp.farmFallow = true;
    }
    for (const field of state.fields!) { field.orchard = state.buildings.find(camp => camp.id === field.camp)!.orchard; field.planted = false; }
    synchronizeFarms(state); ensureCollectors(state);
    const worker = collectors(state)[0], field = state.fields![0];
    Object.assign(worker, { inside: false, x: field.x + .5, y: field.y + .5, field: field.id, collectPhase: 'outbound', cultivating: true });
    updateCollector(state, worker, .1, walk);
    expect(state.buildings.filter(camp => camp.kind === 'camp').every(camp => !camp.farmFallow)).toBe(true);
    expect(state.fields!.every(field => field.planted)).toBe(true);
    expect(worker.collectPhase).toBe('returning');
  });

});
