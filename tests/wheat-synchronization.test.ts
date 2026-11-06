import { expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { ensureCollectors, FIELD_HARVEST_SECONDS, FIELD_SPOIL_SECONDS, synchronizeFarms, synchronizeWheatFields, updateCollector, updateHarvests } from '../src/game/farms';
import { fieldGrowth, fieldStage, wheatJoinMask } from '../src/game/farm-art';
import { invalidateFog, updateFog } from '../src/game/fog';
import type { Building, GameState, Unit } from '../src/game/types';

function fixture(xs = [6, 7, 8]): GameState {
  const state: GameState = {
    world: { width: 30, height: 20, seed: 'shared-wheat', source: 'test', spawns: [],
      tiles: Array.from({ length: 600 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .5, food: 2, production: 0, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 2, y: 7, hp: 650, maxHp: 650, capacity: 0 },
      ...xs.map((x, i): Building => ({ id: i + 2, kind: 'camp', faction: 0, x, y: 7, hp: 100, maxHp: 100, capacity: 0 }))],
    units: [], fields: [], factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 100, gold: 500, production: 0,
      population: 10, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null, buildMode: null,
    diplomacy: null, gameOver: false, victory: false, seed: 'shared-wheat', rngState: 1,
  };
  synchronizeFarms(state);
  return state;
}
function leader(): Unit { return { id: 100, kind: 'leader', faction: 0, x: 6.5, y: 7.5, hp: 100, morale: 100,
  attack: 0, defense: 0, speed: 3, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }; }

it('keeps joined wheat golden for 21 seconds before producing its scheduled harvest', () => {
  const state = fixture();
  state.fields!.forEach(field => field.nextHarvest = 80);
  synchronizeWheatFields(state);
  state.time = 58.999; updateHarvests(state);
  expect(state.fields!.every(field => fieldStage(field, state.time) === 1 && field.food === 0)).toBe(true);
  for (const time of [59, 70, 79.999]) {
    state.time = time; updateHarvests(state);
    expect(state.fields!.every(field => fieldStage(field, time) === 2 && field.food === 0 && !field.wheatRipe && field.nextHarvest === 80)).toBe(true);
    const fieldAt = (x: number, y: number) => state.fields!.find(field => field.x === x && field.y === y);
    expect(state.fields!.map(field => wheatJoinMask(field, time, fieldAt))).toEqual([2, 2 | 8, 8]);
  }
  state.time = 80; updateHarvests(state);
  expect(state.fields!.every(field => field.food > 0 && field.wheatRipe && field.nextHarvest === 140)).toBe(true);
});

it('shares growth, ripe and regrowth while preserving every pickup and original expiry', () => {
  const state = fixture(); ensureCollectors(state);
  state.fields!.forEach((field, i) => field.nextHarvest = 60 + 10 * i);
  synchronizeWheatFields(state);
  expect(state.fields!.map(field => field.nextHarvest)).toEqual([80, 80, 80]);
  state.time = 50; updateHarvests(state);
  expect(state.fields!.map(field => fieldGrowth(field, 50))).toEqual([.5, .5, .5]);
  state.time = 80; updateHarvests(state);
  const total = state.fields!.reduce((sum, field) => sum + field.food, 0);
  expect(total).toBeGreaterThan(0);
  expect(state.fields!.every(field => fieldStage(field, 80) === 2 && field.expiresAt === 80 + FIELD_SPOIL_SECONDS)).toBe(true);
  const workers = state.units.filter(unit => unit.collector);
  expect(workers).toHaveLength(1); // One real courier serves all three fields.
  const worker = workers[0]; state.time = 81;
  updateCollector(state, worker, .1, () => {});
  const collected = new Set<number>();
  while (worker.collectPhase === 'outbound' && collected.size < state.fields!.length) {
    const field = state.fields!.find(field => field.id === worker.field)!;
    expect(field).toBeDefined(); expect(collected.has(field.id)).toBe(false);
    // Finish each selected walking leg; the production planner chooses the next pickup.
    Object.assign(worker, { x: field.x + .5, y: field.y + .5 });
    updateCollector(state, worker, .1, () => {}); collected.add(field.id);
    expect(worker.cargoExpiresAt).toBe(80 + FIELD_SPOIL_SECONDS);
    expect(field.food).toBe(0);
    expect(state.factions[0].food).toBe(100);
    if (collected.size < state.fields!.length) expect(state.fields!.every(plot => fieldStage(plot, state.time) === 2)).toBe(true);
  }
  expect(collected.size).toBe(state.fields!.length);
  expect(worker.cargo).toBeCloseTo(total);
  expect(worker.cargoBatches!.every(batch => batch.expiresAt === 80 + FIELD_SPOIL_SECONDS)).toBe(true);
  expect(state.fields!.every(field => field.nextHarvest === 140 && fieldStage(field, 81) === 0)).toBe(true);
  expect(worker.collectPhase).toBe('returning'); expect(state.factions[0].food).toBe(100);
  Object.assign(worker, worker.destination); updateCollector(state, worker, .1, () => {});
  expect(state.factions[0].food).toBeCloseTo(100 + total);
  expect(state.buildings[0].foodDelivered).toBeCloseTo(total);
  expect(worker.cargo).toBe(0); expect(worker.inside).toBe(true);
});

it('merges once using the later deadline without resetting batches, then lets separated patches diverge', () => {
  const state = fixture([6, 8]), left = state.fields![0], right = state.fields![1];
  left.nextHarvest = 60; right.nextHarvest = 80;
  left.food = 2; left.expiresAt = 12; left.foodBatches = [{ amount: 2, expiresAt: 12 }];
  state.time = 3;
  entityStore(state).buildings.add({ id: 10, kind: 'camp', faction: 0, x: 7, y: 7, hp: 100, maxHp: 100, capacity: 0 });
  synchronizeFarms(state);
  const deadline = left.nextHarvest;
  expect(deadline).toBeGreaterThanOrEqual(80);
  expect(state.fields!.every(field => field.nextHarvest === deadline && field.wheatRipe)).toBe(true);
  state.time = 4; synchronizeWheatFields(state); updateHarvests(state);
  expect(left.nextHarvest).toBe(deadline);
  expect(left.foodBatches).toEqual([{ amount: 2, expiresAt: 12 }]);
  expect(state.fields!.reduce((sum, field) => sum + field.food, 0)).toBe(2);
  entityStore(state).buildings.retain(building => building.id !== 10); synchronizeFarms(state);
  left.nextHarvest = 160; right.nextHarvest = 180; synchronizeWheatFields(state);
  expect(left.nextHarvest).toBe(160); expect(right.nextHarvest).toBe(180);
  expect(left.wheatRipe).toBe(true); expect(right.wheatRipe).toBe(false);
});

it('shares fallow and replanting across a patch after a visit to only one tile', () => {
  const state = fixture();
  for (const camp of state.buildings) delete camp.farmFirstHarvestAt;
  state.time = 120; updateHarvests(state);
  expect(state.fields!.every(field => !field.planted)).toBe(true);
  entityStore(state).units.add(leader()); state.time = 150; updateHarvests(state);
  expect(state.fields!.every(field => field.planted && field.nextHarvest >= 150 + FIELD_HARVEST_SECONDS)).toBe(true);
  expect(new Set(state.fields!.map(field => field.nextHarvest)).size).toBe(1);
  expect(state.buildings.filter(building => building.kind === 'camp').every(camp => camp.farmLastVisitedAt === 150 && !camp.farmFallow)).toBe(true);
});

it('keeps harvest membership checks linear when many units visit one connected patch', () => {
  const state = fixture(Array.from({ length: 24 }, (_, i) => i + 5));
  for (const [i, field] of state.fields!.entries()) entityStore(state).units.add({ ...leader(), id: 100 + i, x: field.x + .5 });
  updateHarvests(state);
  let positionReads = 0;
  for (const field of state.fields!) {
    const x = field.x;
    Object.defineProperty(field, 'x', { configurable: true, get: () => { positionReads++; return x; } });
  }
  state.time = 1; updateHarvests(state);
  // A few linear topology/visitation passes are expected. Validating every
  // plot for every visiting unit makes this grow quadratically instead.
  expect(positionReads).toBeLessThan(state.fields!.length * 8);
  expect(state.buildings.filter(camp => camp.kind === 'camp').every(camp => camp.farmLastVisitedAt === 1)).toBe(true);
});

it('separates visits immediately when an orchard conversion splits a fallow wheat patch', () => {
  const state = fixture();
  for (const camp of state.buildings) delete camp.farmFirstHarvestAt;
  state.time = 120; updateHarvests(state);
  const middle = state.buildings.find(camp => camp.id === state.fields![1].camp)!;
  // Exercise a building edit arriving before synchronizeFarms copies it into
  // its field. The harvest pass must not keep its original connected group.
  middle.orchard = { startedAt: 120, readyAt: 250 };
  entityStore(state).units.add(leader()); state.time = 150; updateHarvests(state);
  expect(state.fields!.map(field => field.planted)).toEqual([true, false, false]);
  expect(state.fields![1].orchard).toBe(middle.orchard);
  expect(state.buildings.find(camp => camp.id === state.fields![2].camp)!.farmLastVisitedAt).toBe(0);
});

it('revalidates ownership edits between harvest passes even at the same simulation time', () => {
  const state = fixture();
  for (const camp of state.buildings) delete camp.farmFirstHarvestAt;
  state.time = 120; updateHarvests(state);
  const middle = state.fields![1];
  middle.faction = 1;
  state.buildings.find(camp => camp.id === middle.camp)!.faction = 1;
  entityStore(state).units.add(leader()); updateHarvests(state);
  expect(state.fields!.map(field => field.planted)).toEqual([true, false, false]);
  expect(state.fields![0].nextHarvest).toBeGreaterThanOrEqual(state.time + FIELD_HARVEST_SECONDS);
});

it('does not postpone established crops during expansion or grant brand-new plots an immediate harvest', () => {
  const state = fixture();
  for (const field of state.fields!) field.nextHarvest = 90;
  for (const camp of state.buildings) if (camp.kind === 'camp') camp.farmFirstHarvestAt = 90;
  state.time = 80;
  entityStore(state).buildings.add({ id: 30, kind: 'camp', faction: 0, x: 9, y: 7, hp: 100, maxHp: 100, capacity: 0 });
  synchronizeFarms(state);
  state.time = 85;
  entityStore(state).buildings.add({ id: 31, kind: 'camp', faction: 0, x: 10, y: 7, hp: 100, maxHp: 100, capacity: 0 });
  synchronizeFarms(state);
  expect(state.fields!.every(field => field.nextHarvest === 90)).toBe(true);
  state.time = 90; updateHarvests(state);
  expect(state.fields!.filter(field => field.camp < 30).every(field => field.food > 0)).toBe(true);
  expect(state.fields!.filter(field => field.camp >= 30).every(field => field.food === 0 && field.wheatRipe)).toBe(true);
  expect(state.fields!.every(field => field.nextHarvest === 150)).toBe(true);
  state.time = 150; updateHarvests(state);
  expect(state.fields!.every(field => field.food > 0)).toBe(true);
});

it('shares a new plot’s first-harvest grace without extending it every cycle', () => {
  const state = fixture();
  for (const field of state.fields!) field.nextHarvest = 80;
  for (const camp of state.buildings) if (camp.kind === 'camp') camp.farmFirstHarvestAt = 80;
  state.time = 80; updateHarvests(state);
  state.time = 90;
  entityStore(state).buildings.add({ id: 40, kind: 'camp', faction: 0, x: 9, y: 7, hp: 100, maxHp: 100, capacity: 0 });
  synchronizeFarms(state);
  state.fields!.find(field => field.camp === 40)!.nextHarvest = 215;
  state.buildings.find(building => building.id === 40)!.farmFirstHarvestAt = 215;
  synchronizeWheatFields(state);
  state.time = 210; updateHarvests(state);
  expect(state.fields!.every(field => field.planted)).toBe(true);
  state.time = 215; updateHarvests(state);
  expect(state.fields!.every(field => field.food > 0 && field.planted)).toBe(true);
  state.time = 215 + FIELD_SPOIL_SECONDS; updateHarvests(state);
  expect(state.fields!.every(field => !field.planted && field.food === 0)).toBe(true);
});

it('expires individual remaining bags without resetting the patch clock or duplicating grain', () => {
  const state = fixture(), [a,b,c] = state.fields!;
  a.food = 2; a.expiresAt = 10; a.foodBatches = [{ amount: 2, expiresAt: 10 }];
  b.food = 3; b.expiresAt = 12; b.foodBatches = [{ amount: 3, expiresAt: 12 }];
  state.time = 9; updateHarvests(state); const deadline = a.nextHarvest;
  state.time = 10; updateHarvests(state);
  expect(a.food).toBe(0); expect(b.food).toBe(3); expect(c.food).toBe(0);
  expect(state.fields!.every(field => field.wheatRipe)).toBe(true);
  state.time = 12; updateHarvests(state);
  expect(state.fields!.every(field => field.food === 0 && !field.wheatRipe && field.nextHarvest === deadline)).toBe(true);
  expect(state.factions[0].food).toBe(100);
});

it('keeps different owners, diagonal fields and orchards on independent clocks', () => {
  const state = fixture([6,7,8,9]);
  const [a,b,c,d] = state.fields!;
  b.faction = 1; c.orchard = { startedAt: 0, readyAt: 120 }; d.y = 8;
  [a,b,c,d].forEach((field,i) => field.nextHarvest = 60 + 10*i);
  synchronizeWheatFields(state);
  expect([a,b,c,d].map(field => field.nextHarvest)).toEqual([60,70,80,90]);
});

it('remembers the shared ripe state in fog even on a tile whose own bag was collected', () => {
  const state = fixture(); entityStore(state).buildings.replace([]); entityStore(state).units.add(leader());
  for (const field of state.fields!) field.faction = 1;
  const [a,b] = state.fields!; a.food = 0; b.food = 2; synchronizeWheatFields(state);
  let fog = updateFog(state);
  expect(fog.fields.find(field => field.id === a.id)?.wheatRipe).toBe(true);
  state.units[0].x = 27.5; state.time = 4; invalidateFog(state); fog = updateFog(state);
  b.food = 0; synchronizeWheatFields(state); state.time = 5; invalidateFog(state); fog = updateFog(state);
  const memory = fog.fields.find(field => field.id === a.id)!;
  expect(memory.wheatRipe).toBe(true); expect(fieldStage(memory, memory.observedAt)).toBe(2);
});

