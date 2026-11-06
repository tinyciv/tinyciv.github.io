import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { createGame, updateGame } from '../src/game/simulation';
import { cityDevelopmentNeeds, governorPermissions, setGovernorPermission } from '../src/game/governor';
import { ensureCollectors, synchronizeFarms } from '../src/game/farms';
import { buildingReady, isFarmKind, type GameState } from '../src/game/types';
const idle = { up: false, down: false, left: false, right: false };
function realm(): GameState {
  const state = createGame({ width: 64, height: 44, seed: 'governor-permissions', source: 'fixture', spawns: [{ x: 14, y: 20 }],
    tiles: Array.from({ length: 64 * 44 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) });
  entityStore(state).buildings.replace(state.buildings.filter(building => building.faction === 0)); entityStore(state).units.replace(state.units.filter(unit => unit.faction === 0));
  state.raiderCamps = []; state.marauderPacks = []; state.fogRaids = { nextAt: 1e9, waves: 0 };
  Object.assign(state.factions[0], { food: 10000, gold: 10000, population: 8, nextRetinueAt: 1e9 });
  const camps = new Set(state.buildings.filter(b => b.kind === 'camp').slice(0, 2).map(b => b.id));
  const houses = new Set(state.buildings.filter(b => b.kind === 'house').slice(0, 4).map(b => b.id));
  entityStore(state).buildings.replace(state.buildings.filter(b => b.kind !== 'camp' && b.kind !== 'house' || camps.has(b.id) || houses.has(b.id)));
  state.fields = []; for (const tile of state.world.tiles) delete tile.farm;
  palace(state).populationGrowth = -1000;
  synchronizeFarms(state); ensureCollectors(state); return state;
}
function economy(state: GameState): void {
  state.time = (state.tick + 1) * 30 - .05;
  // Courier trips are omitted by the time jump. Existing farms remain tended
  // while these checks isolate automatic-construction permissions.
  for (const farm of state.buildings) if (isFarmKind(farm.kind) && buildingReady(farm)) farm.farmLastVisitedAt = state.time;
  updateGame(state, .05, idle);
}
const palace = (state: GameState) => state.buildings.find(building => building.kind === 'palace')!;
const count = (state: GameState, kind: 'camp' | 'house') => state.buildings.filter(building => building.kind === kind).length;

describe('city governor permissions and growth priorities', () => {
  it('defaults to both permissions and funds the food bottleneck before more vacant housing', () => {
    const state = realm(); expect(governorPermissions(palace(state))).toEqual({ farms: true, housing: true });
    expect(cityDevelopmentNeeds(state, palace(state)).priority).toBe('farm');
    economy(state); expect(count(state, 'camp')).toBe(6); expect(count(state, 'house')).toBe(4);
  });
  it('disabling both permissions stops new automatic orders without stopping existing crops', () => {
    const state = realm(), home = palace(state), field = state.fields![0];
    setGovernorPermission(home, 'farms', false); setGovernorPermission(home, 'housing', false);
    field.nextHarvest = 30;
    for (let i = 0; i < 5; i++) economy(state);
    expect(count(state, 'camp')).toBe(2); expect(count(state, 'house')).toBe(4);
    expect(field.nextHarvest).toBeGreaterThan(150);
  });
  it('allows profitable automatic housing when farm permission is off', () => {
    const state = realm(), home = palace(state);
    state.factions[0].population = 2; synchronizeFarms(state);
    home.automaticHouseCredit = .8; setGovernorPermission(home, 'farms', false);
    expect(cityDevelopmentNeeds(state, home).priority).toBe('house');
    economy(state); expect(count(state, 'camp')).toBe(2); expect(count(state, 'house')).toBe(5);
  });
  it('allows automatic farms while housing permission is off', () => {
    const state = realm(), home = palace(state); setGovernorPermission(home, 'housing', false);
    economy(state); expect(count(state, 'camp')).toBe(6); expect(count(state, 'house')).toBe(4);
  });
  it('counts queued farms toward supply and does not repeatedly order the same deficit', () => {
    const state = realm(); state.factions[0].population = 1; synchronizeFarms(state); setGovernorPermission(palace(state), 'housing', false);
    const before = cityDevelopmentNeeds(state, palace(state)).foodCapacity;
    for (let i = 0; i < 3; i++) economy(state);
    expect(count(state, 'camp')).toBe(10);
    const shortfall = cityDevelopmentNeeds(state, palace(state));
    expect(shortfall.foodCapacity).toBeLessThan(shortfall.foodTarget);
    economy(state);
    expect(count(state, 'camp')).toBe(11);
    expect(state.buildings.filter(building => building.kind === 'camp' && building.construction).length).toBeGreaterThan(0);
    const supplied = cityDevelopmentNeeds(state, palace(state));
    expect(supplied.foodCapacity).toBeGreaterThan(before);
    expect(supplied.foodCapacity).toBeGreaterThanOrEqual(supplied.foodTarget);
    // Queued crops count toward supply: the last small shortfall gets one plot,
    // then repeated planning leaves the complete pending order set unchanged.
    const orders = state.buildings.filter(building => building.kind === 'camp').map(building => building.id);
    for (let i = 0; i < 3; i++) economy(state);
    expect(state.buildings.filter(building => building.kind === 'camp').map(building => building.id)).toEqual(orders);
  });
  it('keeps permissions local to each palace instead of disabling the whole faction', () => {
    const state = realm(), first = palace(state);
    setGovernorPermission(first, 'farms', false); setGovernorPermission(first, 'housing', false);
    entityStore(state).buildings.add({ ...first, id: 10000, x: 48, y: 20, governorPermissions: { farms: true, housing: false } });
    economy(state);
    const farm = state.buildings.find(building => building.kind === 'camp' && building.construction)!;
    expect(farm).toBeDefined(); expect(Math.hypot(farm.x - 48, farm.y - 20)).toBeLessThan(16);
    expect(Math.hypot(farm.x - first.x, farm.y - first.y)).toBeGreaterThan(16);
  });
});
