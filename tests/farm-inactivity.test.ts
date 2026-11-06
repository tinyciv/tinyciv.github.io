import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { ensureCollectors, FARM_ABANDON_SECONDS, FARM_IDLE_SECONDS, FIELD_HARVEST_FOOD, FIELD_HARVEST_SECONDS, FIELD_SPOIL_SECONDS, synchronizeFarms, updateCollector, updateHarvests } from '../src/game/farms';
import { fieldGrowth } from '../src/game/farm-art';
import type { GameState, Unit } from '../src/game/types';

function fixture(campId = 2): GameState {
  const state: GameState = {
    world: { width: 24, height: 16, seed: 'idle-farms', source: 'test', spawns: [],
      tiles: Array.from({ length: 384 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
        moisture: .6, food: 2, production: 0, gold: 0, variation: .5 })) },
    buildings: [
      { id: 1, kind: 'palace', x: 2, y: 7, faction: 0, hp: 650, maxHp: 650, capacity: 0 },
      { id: campId, kind: 'camp', x: 6, y: 7, faction: 0, hp: 100, maxHp: 100, capacity: 0 },
    ],
    units: [], fields: [], factions: [{ id: 0, name: 'Test', color: '#f34f59', affinity: 100, relation: 'self',
      food: 20, gold: 20, production: 0, population: 4, yields: { food: 0, gold: 0, production: 0 },
      nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'idle-farms', rngState: 1,
  };
  synchronizeFarms(state);
  return state;
}
function visitor(overrides: Partial<Unit> = {}): Unit {
  return { id: 10, kind: 'leader', faction: 0, x: 6.5, y: 7.5, hp: 100, morale: 100, attack: 1,
    defense: 0, speed: 2.2, range: 1.1, order: 'hold', cooldown: 0, lastCombat: -60, moving: false,
    facing: 0, attackTime: 0, ...overrides };
}

describe('farm inactivity', () => {
  it.each([false, true])('removes only a neutral farm after ten unclaimed minutes and frees plots and courier assignments (orchard=%s)', orchard => {
    const state = fixture(); ensureCollectors(state);
    const farm = state.buildings[1]; farm.faction = -1;
    if (orchard) farm.orchard = { startedAt: 0, readyAt: 120 };
    for (const field of state.fields!) { field.faction = -1; state.world.tiles[field.y * 24 + field.x].farm = -1; }
    state.selected = 2; state.selectedType = 'building';
    const plots = state.fields!.map(field => ({ x: field.x, y: field.y }));
    updateHarvests(state);
    expect(farm.farmAbandonedAt).toBe(0);
    state.time = FARM_ABANDON_SECONDS - .01; updateHarvests(state);
    expect(state.buildings.includes(farm)).toBe(true);
    state.time += .01; updateHarvests(state);
    expect(state.buildings.includes(farm)).toBe(false);
    expect(state.fields).toHaveLength(0);
    expect(state.units.some(unit => unit.collectorCamp === 2)).toBe(false);
    expect(state.selected).toBe(null);
    for (const plot of plots) expect(state.world.tiles[plot.y * 24 + plot.x].farm).toBeUndefined();
    expect(state.factions[0].food).toBe(20);
  });

  it.each([0, 1, -2])('keeps owned fallow farmland indefinitely for faction %i', faction => {
    const state = fixture(), farm = state.buildings[1];
    farm.faction = faction; farm.farmAbandonedAt = 0;
    state.time = 5000; updateHarvests(state);
    expect(state.buildings.includes(farm)).toBe(true);
    expect(farm.farmFallow).toBe(true); expect(farm.farmAbandonedAt).toBeUndefined();
    expect(state.fields).toHaveLength(1);
  });

  it('starts the neutral timer at ownership loss rather than backdating to its last visit', () => {
    const state = fixture(), farm = state.buildings[1];
    state.time = 900; updateHarvests(state);
    expect(farm.farmFallow).toBe(true); expect(farm.farmAbandonedAt).toBeUndefined();
    farm.faction = -1; synchronizeFarms(state); updateHarvests(state);
    expect(farm.farmAbandonedAt).toBe(900);
    // Passing over neutral farmland is neither ownership nor a clock reset.
    entityStore(state).units.add(visitor()); state.time = 1499; updateHarvests(state);
    expect(farm.farmAbandonedAt).toBe(900); expect(farm.farmFallow).toBe(true);
    expect(state.buildings.includes(farm)).toBe(true);
    state.time = 1500; updateHarvests(state);
    expect(state.buildings.includes(farm)).toBe(false);
  });

  it('excludes unfinished neutral farm construction from abandonment', () => {
    const state = fixture(), farm = state.buildings[1];
    farm.faction = -1; farm.farmAbandonedAt = 0; farm.farmFallow = true;
    farm.construction = { startedAt: 0, duration: 30 };
    state.time = 2000; updateHarvests(state);
    expect(state.buildings.includes(farm)).toBe(true);
  });

  it('stops the crop tile at 120 seconds, without treating ripening or spoilage as visits', () => {
    const state = fixture(), farm = state.buildings[1];
    state.time = FARM_IDLE_SECONDS - .01; updateHarvests(state);
    expect(state.fields!.every(field => field.planted)).toBe(true);
    state.time = FARM_IDLE_SECONDS; updateHarvests(state);
    expect(farm.farmFallow).toBe(true);
    expect(farm.farmLastVisitedAt).toBe(0);
    expect(state.fields!.every(field => !field.planted)).toBe(true);
    const deadlines = state.fields!.map(field => field.nextHarvest);
    state.time = 600; updateHarvests(state);
    expect(state.fields!.map(field => field.nextHarvest)).toEqual(deadlines);
    expect(state.fields!.every(field => field.food === 0 && fieldGrowth(field, state.time) === 0)).toBe(true);
    expect(state.factions[0].food).toBe(20);
  });

  it('keeps a late first crop alive for collection, then uses the ordinary idle deadline after a visit', () => {
    const state = fixture(55), farm = state.buildings[1], firstHarvest = state.fields![0].nextHarvest;
    expect(firstHarvest).toBeGreaterThan(119);
    expect(firstHarvest).toBeLessThan(120);
    state.time = 120; updateHarvests(state);
    expect(farm.farmFallow).not.toBe(true);
    expect(state.fields!.every(field => field.planted && field.food === FIELD_HARVEST_FOOD)).toBe(true);
    expect(farm.farmLastVisitedAt).toBe(0);
    entityStore(state).units.add(visitor()); state.time = firstHarvest + 1; updateHarvests(state);
    const visitedAt = state.time;
    expect(farm.farmLastVisitedAt).toBe(visitedAt);
    expect(farm.farmFirstHarvestAt).toBeUndefined();
    entityStore(state).units.replace([]);
    state.time = visitedAt + FARM_IDLE_SECONDS - .01; updateHarvests(state);
    expect(farm.farmFallow).not.toBe(true);
    state.time = visitedAt + FARM_IDLE_SECONDS; updateHarvests(state);
    expect(farm.farmFallow).toBe(true);
    expect(state.fields!.every(field => !field.planted)).toBe(true);
  });

  it('ends an unattended late first harvest grace period when that crop expires', () => {
    const state = fixture(55), farm = state.buildings[1], firstHarvest = state.fields![0].nextHarvest;
    const expiresAt = firstHarvest + FIELD_SPOIL_SECONDS;
    state.time = expiresAt - .01; updateHarvests(state);
    expect(farm.farmFallow).not.toBe(true);
    expect(state.fields!.every(field => field.planted && field.food === FIELD_HARVEST_FOOD)).toBe(true);
    state.time = expiresAt; updateHarvests(state);
    expect(farm.farmFallow).toBe(true);
    expect(state.fields!.every(field => !field.planted && field.food === 0)).toBe(true);
    expect(farm.farmLastVisitedAt).toBe(0);
  });

  it('retains first-harvest grace when a visitor crosses the farm before crops ripen', () => {
    const state = fixture(55), farm = state.buildings[1], firstHarvest = state.fields![0].nextHarvest;
    entityStore(state).units.add(visitor()); state.time = 1; updateHarvests(state);
    expect(farm.farmLastVisitedAt).toBe(1);
    expect(farm.farmFirstHarvestAt).toBe(firstHarvest);
    entityStore(state).units.replace([]);
    state.time = firstHarvest + FIELD_SPOIL_SECONDS - .01; updateHarvests(state);
    expect(state.time).toBeGreaterThan(1 + FARM_IDLE_SECONDS);
    expect(farm.farmFallow).not.toBe(true);
    state.time = firstHarvest + FIELD_SPOIL_SECONDS; updateHarvests(state);
    expect(farm.farmFallow).toBe(true);
  });

  it('uses the last actual owning-faction visit to the crop tile', () => {
    const state = fixture(), farm = state.buildings[1];
    entityStore(state).units.add(visitor()); state.time = 100; updateHarvests(state);
    expect(farm.farmLastVisitedAt).toBe(100);
    entityStore(state).units.replace([]); state.time = 219.99; updateHarvests(state);
    expect(farm.farmFallow).not.toBe(true);
    state.time = 220; updateHarvests(state);
    expect(farm.farmFallow).toBe(true);
  });

  it.each([
    { faction: 1 }, { faction: -2 }, { hp: 0 }, { inside: true }, { x: 8.5 },
  ])('does not let an enemy, hidden/dead unit, or nearby passerby count: %j', overrides => {
    const state = fixture(); entityStore(state).units.add(visitor(overrides));
    state.time = 119; updateHarvests(state); state.time = 120; updateHarvests(state);
    expect(state.buildings[1].farmLastVisitedAt).toBe(0);
    expect(state.buildings[1].farmFallow).toBe(true);
  });

  it('keeps unattended farms fallow across synchronization, terrain edits and ownership changes', () => {
    const state = fixture(), farm = state.buildings[1];
    state.time = 120; updateHarvests(state);
    const deadlines = state.fields!.map(field => field.nextHarvest);
    farm.faction = 1; state.world.revision = (state.world.revision ?? 0) + 1;
    synchronizeFarms(state); synchronizeFarms(state);
    expect(farm.farmFallow).toBe(true);
    expect(farm.farmLastVisitedAt).toBe(0);
    expect(state.fields!.every(field => !field.planted && field.faction === 1)).toBe(true);
    expect(state.fields!.map(field => field.nextHarvest)).toEqual(deadlines);
  });

  it('restarts a full growth cycle on a return visit, without awarding overdue crops', () => {
    const state = fixture(), farm = state.buildings[1];
    state.time = 500; updateHarvests(state);
    entityStore(state).units.add(visitor()); state.time = 510; updateHarvests(state);
    expect(farm.farmFallow).toBe(false);
    expect(farm.farmLastVisitedAt).toBe(510);
    expect(state.fields!.every(field => field.planted && field.food === 0 && field.nextHarvest >= 510 + FIELD_HARVEST_SECONDS)).toBe(true);
    state.time = 510 + FIELD_HARVEST_SECONDS - 1; updateHarvests(state);
    expect(state.fields!.every(field => field.food === 0)).toBe(true);
    state.time = Math.max(...state.fields!.map(field => field.nextHarvest)); updateHarvests(state);
    expect(state.fields!.every(field => field.food === FIELD_HARVEST_FOOD)).toBe(true);
  });

  it('preserves the remaining ripe bags and their expiry while no new grain grows', () => {
    const state = fixture(), field = state.fields![0];
    field.food = 3; field.foodBatches = [{ amount: 3, expiresAt: 140 }]; field.expiresAt = 140;
    for (const plot of state.fields!) plot.nextHarvest = 120;
    state.time = 120; updateHarvests(state);
    expect(field.food).toBe(3); expect(field.expiresAt).toBe(140);
    expect(field.nextHarvest).toBe(120); expect(field.planted).toBe(false);
    state.time = 140; updateHarvests(state);
    expect(field.food).toBe(0);
    expect(state.particles.some(particle => particle.text === '−3 food')).toBe(true);
  });

  it('sends the assigned worker to cultivate a fallow farm even without a ripe bag', () => {
    const state = fixture(); ensureCollectors(state);
    const worker = state.units.find(unit => unit.collector)!;
    state.time = 300; updateHarvests(state);
    updateCollector(state, worker, .1, () => {});
    expect(worker.collectPhase).toBe('outbound'); expect(worker.cultivating).toBe(true);
    expect(state.buildings[1].farmFallow).toBe(true); // Dispatch alone is not a visit.
    const field = state.fields!.find(field => field.id === worker.field)!;
    worker.x = field.x + .5; worker.y = field.y + .5;
    state.time = 301; updateHarvests(state); updateCollector(state, worker, .1, () => {});
    expect(state.buildings[1].farmFallow).toBe(false);
    expect(worker.collectPhase).toBe('returning'); expect(worker.cultivating).toBeUndefined();
    expect(state.fields!.every(field => field.planted && field.food === 0 && field.nextHarvest >= 331)).toBe(true);
    expect(state.factions[0].food).toBe(20);
  });

  it('leaves a farm fallow when nobody can be dispatched or the palace route is blocked', () => {
    const state = fixture(); ensureCollectors(state);
    const worker = state.units.find(unit => unit.collector)!;
    state.time = 300; updateHarvests(state);
    state.factions[0].population = 0;
    updateCollector(state, worker, .1, () => {});
    expect(worker.inside).toBe(true); expect(state.buildings[1].farmFallow).toBe(true);
    state.factions[0].population = 4;
    for (let y = 0; y < 16; y++) state.world.tiles[y * 24 + 5].terrain = 'lake';
    state.world.revision = (state.world.revision ?? 0) + 1;
    updateCollector(state, worker, .1, () => {});
    expect(worker.inside).toBe(true); expect(state.buildings[1].farmLastVisitedAt).toBe(0);
    expect(state.buildings[1].farmFallow).toBe(true);
  });
});
