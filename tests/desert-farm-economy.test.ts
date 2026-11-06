import { entityStore } from '../src/game/entity-store';
import { PALACE_FOOD_PER_CYCLE } from '../src/game/city-support';
import { describe, expect, it } from 'vitest';
import { createGame, updateGame } from '../src/game/simulation';
import { CAMP_FIELD_OFFSETS, ensureCollectors, synchronizeFarms } from '../src/game/farms';
import { planHouseSite } from '../src/game/housing';
import { palaceReachability } from '../src/game/placement';
import { type Building, type GameState, type Terrain, type World, tileAt } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
function world(terrain: Terrain = 'grassland'): World {
  return { width: 40, height: 40, seed: 'desert-farm-economy', source: 'fixture', spawns: [{ x: 18, y: 18 }],
    tiles: Array.from({ length: 1600 }, () => ({ terrain, overlay: 'none', elevation: .4, moisture: .7, food: 3, production: 1, gold: 0, variation: .5 })) };
}
function quietRealm(map = world()): GameState {
  const state = createGame(map);
  entityStore(state).units.replace(state.units.filter(unit => unit.kind === 'leader' && unit.faction === 0));
  state.marauderPacks = [];
  state.fogRaids = { nextAt: 1e9, waves: 0 };
  return state;
}
function economy(state: GameState): void {
  state.time = (state.tick + 1) * 30 - .05;
  updateGame(state, .05, idle);
}
const camp = (id: number, x: number, y: number): Building => ({ id, x, y, kind: 'camp', faction: 0, hp: 100, maxHp: 100, capacity: 0 });

describe('desert yield in settlement planning', () => {
  it('uses fertile pockets first and adds enough extra farmland for the starting population', () => {
    const map = world('desert'), pockets = [{ x: 8, y: 18 }, { x: 29, y: 18 }];
    // Each fertile pocket supports one single-cell farm.
    for (const pocket of pockets) for (const [dx, dy] of CAMP_FIELD_OFFSETS)
      tileAt(map, pocket.x + dx, pocket.y + dy)!.terrain = 'grassland';
    const state = quietRealm(map);
    const camps = state.buildings.filter(building => building.kind === 'camp');
    expect(camps.length).toBeGreaterThan(2);
    expect(camps.map(({ x, y }) => ({ x, y })).sort((a, b) => a.x - b.x)).toEqual(expect.arrayContaining(pockets));
    expect(state.fields!.filter(field => tileAt(map, field.x, field.y)!.terrain === 'grassland').length).toBeGreaterThanOrEqual(2);
  });

  it('sends later farm expansion to a farther fertile site over a closer desert site', () => {
    const state = quietRealm(), palace = state.buildings.find(building => building.kind === 'palace')!;
    Object.assign(palace, { x: 6, y: 10 });
    const oldCamp = camp(100, 6, 5), near = { x: 14, y: 10 }, fertile = { x: 14, y: 17 };
    entityStore(state).buildings.replace([palace, oldCamp]); state.fields = [];
    Object.assign(state.units[0], { x: 7.5, y: 12.5 });
    for (const tile of state.world.tiles) { tile.terrain = 'lake'; tile.overlay = 'none'; delete tile.farm; }
    const clear = (x: number, y: number, terrain: Terrain = 'grassland'): void => { tileAt(state.world, x, y)!.terrain = terrain; };
    // Roads reserve the narrow connections, leaving two possible crop sites.
    for (let y = 7; y <= 12; y++) clear(6, y);
    for (let x = 6; x <= 14; x++) clear(x, 10);
    for (let y = 10; y <= 17; y++) clear(14, y);
    clear(7, 10); clear(7, 11); clear(7, 12);
    for (const center of [oldCamp, near, fertile]) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      clear(center.x + dx, center.y + dy, center === near ? 'desert' : 'grassland');
    let roadId = 1000;
    for (let y = 0; y < state.world.height; y++) for (let x = 0; x < state.world.width; x++) {
      if (tileAt(state.world, x, y)!.terrain === 'lake' || x === near.x && y === near.y || x === fertile.x && y === fertile.y) continue;
      if (state.buildings.some(building => x >= building.x && x < building.x + (building.kind === 'palace' ? 2 : 1)
        && y >= building.y && y < building.y + (building.kind === 'palace' ? 2 : 1))) continue;
      entityStore(state).buildings.add({ id: roadId++, kind: 'road', faction: 0, x, y, hp: 60, maxHp: 60, capacity: 0 });
    }
    state.world.revision = (state.world.revision ?? 0) + 1;
    state.factions[0].population = 27; palace.populationGrowth = -100;
    state.factions[0].culture = 10000; // Both candidate clearings are already claimed.
    synchronizeFarms(state);
    const reachable = palaceReachability(state, palace);
    expect(reachable[near.y * state.world.width + near.x]).toBe(1);
    expect(reachable[fertile.y * state.world.width + fertile.x]).toBe(1);
    state.tick = 1; economy(state);
    const newCamps = state.buildings.filter(building => building.kind === 'camp' && building.id !== oldCamp.id);
    expect(newCamps).toHaveLength(2);
    expect(newCamps[0]).toMatchObject({ x: fertile.x, y: fertile.y, construction: { waitingForBuilder: true } });
  });

  it('reports fractional desert production in the HUD surplus and recomputes it for mixed plots', () => {
    const state = quietRealm(world('desert'));
    const population = state.factions[0].population, count = state.fields!.filter(field => field.planted).length;
    expect(population).toBe(20);
    expect(count).toBeGreaterThan(8);
    state.buildings.find(b => b.kind === 'palace')!.governorPermissions = { farms: false, housing: false };
    expect(state.factions[0].yields.food).toBeCloseTo(PALACE_FOOD_PER_CYCLE + count * (.1 * 4 / 3) - population);
    const field = state.fields!.find(field => field.planted)!;
    tileAt(state.world, field.x, field.y)!.terrain = 'grassland';
    // Prevent births and house orders from changing the population or farm count.
    state.factions[0].food = 0;
    economy(state);
    expect(state.factions[0].population).toBe(population);
    expect(state.factions[0].yields.food).toBeCloseTo(PALACE_FOOD_PER_CYCLE + (.4 + (count - 1) * .1) * 4 / 3 - population);
  });

  it('keeps a necessary fertile farm when replacement would leave only insufficient desert fields', () => {
    const map = world(); map.spawns = [{ x: 10, y: 12 }];
    const state = quietRealm(map), palace = state.buildings.find(building => building.kind === 'palace')!;
    const near = camp(100, 16, 12), far = camp(101, 28, 12);
    entityStore(state).buildings.replace([palace, near, far]); state.fields = [];
    Object.assign(state.units[0], { x: 9.5, y: 13.5 });
    // Only the near farm's clearing could hold a house; the desert farm is
    // outside the residential radius, and surrounding forest stays intact.
    for (const tile of state.world.tiles) { tile.overlay = 'forest'; delete tile.farm; }
    for (const building of state.buildings) tileAt(map, building.x, building.y)!.overlay = 'none';
    for (const [dx, dy] of CAMP_FIELD_OFFSETS) tileAt(map, far.x + dx, far.y + dy)!.terrain = 'desert';
    map.revision = (map.revision ?? 0) + 1;
    state.factions[0].population = 8; palace.populationGrowth = -100;
    synchronizeFarms(state); ensureCollectors(state);
    for (const field of state.fields!) field.nextHarvest = 1000;
    for (const unit of state.units) if (unit.collector) unit.repathAt = 1000;
    expect(planHouseSite(state, palace)?.replaceCampId).toBe(near.id);
    economy(state);
    expect(state.factions[0].yields.food).toBeCloseTo(PALACE_FOOD_PER_CYCLE + (.4 + .1) * 4 / 3 - 8);
    expect(near.kind).toBe('camp');
    expect(state.buildings.some(building => building.kind === 'house')).toBe(false);
  });
});
