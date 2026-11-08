import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { planAutomaticFarmSite } from '../src/game/farm-siting';
import { CAMP_FIELD_OFFSETS, FIELD_HARVEST_FOOD, fieldHarvestFoodForState, synchronizeFarms } from '../src/game/farms';
import { cityDevelopmentNeeds } from '../src/game/governor';
import { updateGame } from '../src/game/simulation';
import { type Building, type GameState, type Point, tileAt } from '../src/game/types';

const near = { x: 15, y: 18 }, far = { x: 25, y: 18 };
const idle = { up: false, down: false, left: false, right: false };
function fixture(): GameState {
  const state: GameState = {
    world: { width: 60, height: 40, seed: 'irrigated-farm-sites', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: 60 * 40 }, () => ({ terrain: 'lake', overlay: 'none', elevation: .3,
        moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 6, y: 18, hp: 650, maxHp: 650, capacity: 0,
      populationGrowth: -1000, governorNextPlanAt: 30, governorPermissions: { farms: true, housing: false } }],
    units: [{ id: 2, kind: 'leader', faction: 0, x: 8.5, y: 18.5, hp: 100, maxHp: 100,
      morale: 100, attack: 0, defense: 5, speed: 3.6, range: 4, order: 'hold', cooldown: 0,
      lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#d94d4d', affinity: 100, relation: 'self', food: 1000, gold: 1000,
      production: 0, population: 8, yields: { food: 0, gold: 0, production: 0 },
      nextRaid: Infinity, nextRetinueAt: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'irrigated-farm-sites', rngState: 1,
    fields: [], marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: Infinity, waves: 0 },
    wildlife: { herds: [], nextRespawnAt: Infinity, sequence: 0, targetHerds: 0 },
  };
  for (let x = 6; x <= 27; x++) tileAt(state.world, x, 18)!.terrain = 'grassland';
  for (const point of [state.buildings[0], near, far]) clearPlot(state, point);
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) tileAt(state.world, 6 + dx, 18 + dy)!.terrain = 'grassland';
  for (let x = 8; x <= 27; x++) if (x !== near.x && x !== far.x) add(state, 'road', { x, y: 18 });
  return state;
}
function clearPlot(state: GameState, point: Point): void {
  for (const [dx, dy] of CAMP_FIELD_OFFSETS) tileAt(state.world, point.x + dx, point.y + dy)!.terrain = 'grassland';
  entityStore(state).buildings.retain(building => building.kind !== 'road' || building.x !== point.x || building.y !== point.y);
}
function add(state: GameState, kind: Building['kind'], point: Point, extra: Partial<Building> = {}): Building {
  const building: Building = { id: Math.max(10, ...state.buildings.map(b => b.id)) + 1, kind, faction: 0, ...point, hp: 100, maxHp: 100, capacity: 0, ...extra };
  entityStore(state).buildings.add(building); state.world.revision!++;
  return building;
}
const plan = (state: GameState) => planAutomaticFarmSite(state, state.buildings[0]);
function transport(state: GameState): void {
  state.factions[0].research = { focus: 'grainStorage', levels: { grainStorage: 1 }, progress: {} };
  for (let x = 8; x <= 26; x++) if (x !== near.x && x !== far.x && !state.buildings.some(b => b.kind === 'road' && b.x === x && b.y === 18)) add(state, 'road', { x, y: 18 });
  // Existing road approach keeps travel fast without occupying crop cells.
}
const harvest = (state: GameState, point: Point) => CAMP_FIELD_OFFSETS.reduce((food, [dx, dy]) => food + fieldHarvestFoodForState(state, point.x + dx, point.y + dy), 0);

const streetSite = { x: 10, y: 14 }, quietSite = { x: 10, y: 22 };
function centralSites(): GameState {
  const state = fixture();
  entityStore(state).buildings.retain(building => building.kind !== 'road');
  for (const tile of state.world.tiles) tile.terrain = 'lake';
  for (const point of [state.buildings[0], streetSite, quietSite]) clearPlot(state, point);
  // One-cell approaches leave precisely two buildable farm footprints.
  for (let x = 8; x <= 10; x++) tileAt(state.world, x, 18)!.terrain = 'grassland';
  for (let y = streetSite.y; y <= quietSite.y; y++) tileAt(state.world, 10, y)!.terrain = 'grassland';
  for (let x = 8; x <= 9; x++) add(state, 'road', { x, y: 18 });
  // A pathable foreign road reserves the approach without making these two
  // isolated candidates extensions of an illegal seven-cell farm strip.
  for (let y = streetSite.y + 1; y < quietSite.y; y++) add(state, 'road', { x: 10, y }, { faction: -1 });
  return state;
}

describe('farm placement around palace streets', () => {
  it.each(['overlap', 'adjacent'] as const)('prefers a site clear of a nearby road over a central %s site', relationship => {
    const state = centralSites();
    expect(plan(state)?.point).toEqual(streetSite);
    const road = relationship === 'overlap' ? streetSite : { x: 9, y: 14 };
    tileAt(state.world, road.x, road.y)!.terrain = 'grassland';
    add(state, 'road', road);
    expect(plan(state)?.point).toEqual(quietSite);
  });

  it('rejects road footprints even beyond the six-tile palace neighborhood', () => {
    const state = fixture();
    add(state, 'road', near);
    expect(plan(state)?.point).not.toEqual(near);
  });

  it('does not consume a central road when no suitable farmland exists', () => {
    const state = centralSites();
    add(state, 'road', streetSite);
    for (const [dx, dy] of CAMP_FIELD_OFFSETS) tileAt(state.world, quietSite.x + dx, quietSite.y + dy)!.terrain = 'lake';
    expect(plan(state)).toBeUndefined();
  });

  it('keeps irrigation yield more important than the street-frontage preference', () => {
    const state = centralSites();
    tileAt(state.world, 9, 14)!.terrain = 'grassland'; add(state, 'road', { x: 9, y: 14 });
    add(state, 'irrigation', { x: 8, y: 14 });
    expect(plan(state)).toMatchObject({ point: streetSite, irrigatedPlots: 1 });
  });

  it('ignores removed roads when preserving central frontage', () => {
    const state = centralSites();
    add(state, 'road', streetSite, { hp: 0 });
    expect(plan(state)?.point).toEqual(streetSite);
  });
});

describe('irrigated automatic farm placement', () => {
  it('keeps the ordinary nearby collection ring when yields are equal', () => {
    const state = fixture();
    expect(plan(state)).toMatchObject({ point: near, irrigatedPlots: 0, harvest: FIELD_HARVEST_FOOD * 1.25 });
  });

  it.each(['forest', 'jungle', 'palm'] as const)('queues and completes a nearby farm through %s instead of choosing the distant clearing', vegetation => {
    const state = fixture(), near = { x: 10, y: 18 };
    clearPlot(state, near);
    add(state, 'road', { x: 15, y: 18 });
    for (const x of [15, 16]) tileAt(state.world, x, 19)!.terrain = 'lake';
    // Both the only approach and the preferred footprint are wooded.
    for (let x = 8; x <= near.x + 1; x++) {
      const tile = tileAt(state.world, x, 18)!;
      if (vegetation === 'palm') tile.palm = true;
      else tile.overlay = vegetation;
    }
    for (const [dx, dy] of CAMP_FIELD_OFFSETS) {
      const tile = tileAt(state.world, near.x + dx, near.y + dy)!;
      if (vegetation === 'palm') tile.palm = true;
      else tile.overlay = vegetation;
    }
    expect(plan(state)?.point).toEqual(near);
    // Leave the one-cell approach clear of the resting military unit.
    Object.assign(state.units[0], { x: 6.5, y: 19.5 });
    state.time = 29.95; updateGame(state, .05, idle);
    const farm = state.buildings.find(building => building.kind === 'camp')!;
    expect(farm).toMatchObject({ ...near, construction: { waitingForBuilder: true } });
    for (const [dx, dy] of CAMP_FIELD_OFFSETS) {
      const tile = tileAt(state.world, near.x + dx, near.y + dy)!;
      expect(tile.overlay).toBe('none'); expect(tile.palm).toBeUndefined();
    }
    state.buildings[0].governorPermissions!.farms = false;
    for (let i = 0; i < 600 && farm.construction; i++) updateGame(state, .1, idle);
    expect(farm.construction).toBeUndefined();
    expect(state.fields!.filter(field => field.camp === farm.id)).toHaveLength(1);
  });

  it('does not bypass nearby forest for a negligible fertility advantage at a distant clearing', () => {
    const state = fixture();
    for (const [dx, dy] of CAMP_FIELD_OFFSETS) {
      Object.assign(tileAt(state.world, near.x + dx, near.y + dy)!, { overlay: 'forest', fertility: .5 });
      tileAt(state.world, far.x + dx, far.y + dy)!.fertility = .51;
    }
    expect(harvest(state, far)).toBeGreaterThan(harvest(state, near));
    expect(plan(state)?.point).toEqual(near);
    transport(state); add(state, 'irrigation', far);
    expect(plan(state)?.point).toEqual(far);
  });

  it('fills a farther fully irrigated site before a nearer ordinary field', () => {
    const state = fixture(); transport(state); add(state, 'irrigation', far);
    const site = plan(state)!;
    expect(site).toMatchObject({ point: far, irrigatedPlots: 1 });
    expect(site.harvest).toBeCloseTo(FIELD_HARVEST_FOOD * 2.5); expect(site.harvest).toBeCloseTo(harvest(state, far));
  });

  it('counts a single irrigated plot and lets that extra yield beat the distance preference', () => {
    const state = fixture(); transport(state); add(state, 'irrigation', { x: 23, y: 18 });
    expect(plan(state)).toMatchObject({ point: far, irrigatedPlots: 1, harvest: FIELD_HARVEST_FOOD * 2.5 });
  });

  it('rejects irrigation whose long walk will spoil the harvest', () => {
    const state = fixture(), edge = { x: 31, y: 18 };
    for (let x = far.x; x <= far.x + 1; x++) tileAt(state.world, x, far.y + 1)!.terrain = 'lake';
    for (let x = 27; x <= edge.x; x++) tileAt(state.world, x, 18)!.terrain = 'grassland';
    clearPlot(state, edge); add(state, 'irrigation', { x: 28, y: 18 });
    expect(plan(state)).toMatchObject({ point: near, irrigatedPlots: 0, harvest: FIELD_HARVEST_FOOD * 1.25 });
  });

  it('does not stack overlapping ditches on a crop tile', () => {
    const state = fixture(); transport(state);
    add(state, 'irrigation', far); add(state, 'irrigation', { x: far.x + 1, y: far.y });
    const site = plan(state)!;
    expect(site).toMatchObject({ point: far, irrigatedPlots: 1 });
    expect(site.harvest).toBeCloseTo(FIELD_HARVEST_FOOD * 2.5); expect(site.harvest).toBeCloseTo(harvest(state, far));
  });

  it('orders a real crop tile over its own ditch while retaining nearby roads', () => {
    const state = fixture(); transport(state);
    const ditch = add(state, 'irrigation', far), road = state.buildings.find(b => b.kind === 'road' && b.x === far.x + 1 && b.y === far.y)!;
    state.time = 29.95; updateGame(state, .05, idle);
    const farm = state.buildings.find(building => building.kind === 'camp')!;
    expect(farm).toMatchObject({ ...far, construction: { waitingForBuilder: true } });
    expect(state.buildings).toContain(ditch); expect(state.buildings).toContain(road);
    expect(state.factions[0].gold).toBeLessThan(1000 + 8);
    expect(cityDevelopmentNeeds(state, state.buildings[0]).foodCapacity).toBeGreaterThan(0);
    delete farm.construction; synchronizeFarms(state);
    expect(state.fields).toHaveLength(1);
    expect(state.fields!.every(field => fieldHarvestFoodForState(state, field.x, field.y) === FIELD_HARVEST_FOOD * 2.5)).toBe(true);
  });

  it.each(['unfinished', 'dead'] as const)('does not promise a harvest bonus from a %s ditch', status => {
    const state = fixture(); add(state, 'irrigation', far, status === 'dead' ? { hp: 0 }
      : { construction: { startedAt: 0, duration: 4, waitingForBuilder: true } });
    expect(plan(state)).toMatchObject({ point: near, irrigatedPlots: 0, harvest: FIELD_HARVEST_FOOD * 1.25 });
  });

  it.each(['road', 'irrigation'] as const)('does not build over a foreign %s even when its plots receive irrigation', kind => {
    const state = fixture(); add(state, 'irrigation', { x: 24, y: 18 }); add(state, kind, far, { faction: 1 });
    expect(plan(state)?.point).toEqual(near);
  });

  it('rejects disconnected irrigated ground', () => {
    const state = fixture(); add(state, 'irrigation', far);
    tileAt(state.world, 20, 18)!.terrain = 'lake'; state.world.revision!++;
    expect(plan(state)?.point).toEqual(near);
  });

  it('keeps irrigated sites inside their own city’s management area', () => {
    const state = fixture(); add(state, 'irrigation', far); add(state, 'palace', { x: 29, y: 18 });
    expect(plan(state)?.point).toEqual(near);
  });

  it('does not expand beyond the existing collection radius to chase irrigation', () => {
    const state = fixture(), outside = { x: 40, y: 18 };
    for (let x = 27; x <= outside.x; x++) tileAt(state.world, x, 18)!.terrain = 'grassland';
    clearPlot(state, outside); add(state, 'irrigation', outside);
    expect(plan(state)?.point).toEqual(near);
  });

  it('uses actual food output, so desert irrigation can outweigh nearer unwatered grassland', () => {
    const state = fixture(); transport(state); add(state, 'irrigation', far);
    for (const [dx, dy] of CAMP_FIELD_OFFSETS) tileAt(state.world, far.x + dx, far.y + dy)!.terrain = 'desert';
    expect(harvest(state, far)).toBeCloseTo(FIELD_HARVEST_FOOD * .75 * 3);
    expect(plan(state)?.point).toEqual(far);
  });
});
