import { describe, expect, it } from 'vitest';
import { createGame, updateGame } from '../src/game/simulation';
import { desiredRetinueSize } from '../src/game/archery';
import { ADVANCED_START_POPULATION, ADVANCED_START_RETINUE, ADVANCED_START_FOOD, ADVANCED_START_GOLD, ADVANCED_START_MIDPOINT_DEPTH, ADVANCED_HOUSE_BLOCK } from '../src/game/advanced-start';
import { sharedHouseForWell } from '../src/game/house-wells';
import { WELL_RADIUS, houseLevel } from '../src/game/wells';
import { serializeGameSave, parseGameSave } from '../src/game/game-save';
import { buildingResearchRequirement, isBuildingUnlocked, isInfantryDrillUnlocked, researchDepth, researchLevel, RESEARCH_BRANCHES } from '../src/game/research';
import { bridgeSpanAt } from '../src/game/bridge-spans';
import { constructionEdges } from '../src/game/builders';
import { hasStaticPath } from '../src/game/pathfinding';
import { createIrrigationConnectionQuery, irrigationYieldMultiplier } from '../src/game/irrigation';
import { BUILDABLE_KINDS, buildingReady, buildingWidth, buildingHeight, isFarmKind, isRetinueMember, type World } from '../src/game/types';
import { farmBlockGeometry } from './helpers/farm-block-geometry';
import { cityResidents } from '../src/game/cities';
import { generateWorld } from '../src/world/generator';
import { entityStore } from '../src/game/entity-store';
import { factionHasDevelopedResource } from '../src/game/resource-development';
import { startingRoadRing } from '../src/game/settlement-layout';

const coastalKinds = ['dock', 'shipyard', 'whalingPost'];
const inlandKinds = BUILDABLE_KINDS.filter(kind => ![...coastalKinds, 'observationPost', 'colosseum', 'barracks', 'bridge', 'irrigation'].includes(kind));

function world(water = false): World {
  const width = 64, height = 56;
  return { width, height, seed: `advanced-start-${water}`, source: 'test', revision: 1, spawns: [{ x: 31, y: 27 }],
    tiles: Array.from({ length: width * height }, (_, i) => ({ terrain: water && i % width >= 44 && i % width <= 45 ? 'river' : 'grassland',
      overlay: 'none', elevation: .3, moisture: .7, food: 3, production: 1, gold: 0, variation: .5 })) };
}

describe('advanced starting cities', () => {
  it.each([false, true])('starts with a populated, accessible inland city (river=%s)', water => {
    const state = createGame(world(water), undefined, { advancedStart: 'complete' });
    const faction = state.factions[0], buildings = state.buildings.filter(b => b.faction === 0 && buildingReady(b));
    expect(faction.population).toBe(ADVANCED_START_POPULATION);
    expect(desiredRetinueSize(faction)).toBe(ADVANCED_START_RETINUE);
    const retinue = state.units.filter(u => u.faction === 0 && isRetinueMember(u) && u.hp > 0);
    expect(retinue).toHaveLength(ADVANCED_START_RETINUE);
    for (const kind of ['warrior', 'archer', 'spearman', 'horseman']) expect(retinue.filter(unit => unit.kind === kind)).toHaveLength(3);
    expect(faction.bonusRetinueSlots).toBeUndefined();
    expect(faction.food).toBeGreaterThanOrEqual(ADVANCED_START_FOOD);
    expect(faction.gold).toBeGreaterThanOrEqual(ADVANCED_START_GOLD);
    expect(isInfantryDrillUnlocked(faction)).toBe(true);
    expect(faction.purchasedRetinueSlots ?? 0).toBe(0);
    const doors = constructionEdges(state, buildings.find(b => b.kind === 'palace')!);
    for (const unit of state.units.filter(u => u.faction === 0 && (u.kind === 'leader' || isRetinueMember(u))))
      expect(doors.some(door => hasStaticPath(state, door, unit, 0)), `Unreachable ${unit.kind} ${unit.id}`).toBe(true);
    for (const kind of inlandKinds) {
      expect(buildings.some(b => b.kind === kind), `Missing ${kind}`).toBe(true);
      if (buildingResearchRequirement(kind)) expect(isBuildingUnlocked(faction, kind), `Locked ${kind}`).toBe(true);
    }
    expect(buildings.some(building => [...coastalKinds, 'observationPost'].includes(building.kind))).toBe(false);
    const housing = buildings.filter(b => b.kind === 'house' || b.kind === 'palace');
    expect(housing.reduce((sum, b) => sum + b.capacity, 0)).toBeGreaterThanOrEqual(ADVANCED_START_POPULATION);
    expect(housing.reduce((sum, b) => sum + (b.residents ?? 0) + (b.unhousedResidents ?? 0), 0)).toBe(ADVANCED_START_POPULATION);
    const farms = buildings.filter(building => isFarmKind(building.kind));
    const ditches = buildings.filter(building => building.kind === 'irrigation');
    expect(state.world.tiles.some(tile => tile.terrain === 'lake')).toBe(false);
    if (water) {
      expect(ditches.length).toBeGreaterThan(1);
      expect(ditches.length).toBeLessThanOrEqual(6);
      expect(farms.some(farm => irrigationYieldMultiplier(state, farm.x, farm.y) > 1)).toBe(true);
      const connects = createIrrigationConnectionQuery({ ...state, buildings: [] });
      const fed = new Set<number>();
      for (const ditch of ditches) {
        expect(connects(ditch.x, ditch.y, fed)).toBe(true);
        fed.add(ditch.y * state.world.width + ditch.x);
      }
    } else {
      expect(ditches).toHaveLength(0);
    }
    expect(farms.length).toBeGreaterThan(16);
    for (const block of farmBlockGeometry(farms)) {
      expect(block.size).toBeLessThanOrEqual(16);
      if (block.size > 6) expect(block.aspectRatio).toBeLessThanOrEqual(1.5);
    }
    const occupied = new Set<number>(), roads = new Set(buildings.filter(building => building.kind === 'road').map(building => building.y * state.world.width + building.x));
    for (const building of buildings) {
      // A well may share its house's tile; every other cell has one building.
      if (building.kind === 'well' && sharedHouseForWell(building, buildings)) continue;
      for (let dy = 0; dy < buildingHeight(building); dy++) for (let dx = 0; dx < buildingWidth(building); dx++) {
        const cell = (building.y + dy) * state.world.width + building.x + dx;
        expect(occupied.has(cell), `Overlapping ${building.kind} at ${cell}`).toBe(false); occupied.add(cell);
      }
      if (building.kind === 'bridge') expect(bridgeSpanAt(state, building, 0)).toBeDefined();
      if (buildingWidth(building) * buildingHeight(building) >= 4) {
        for (const point of startingRoadRing(building, buildingWidth(building), buildingHeight(building)))
          expect(roads.has(point.y * state.world.width + point.x), `Missing road around ${building.kind}`).toBe(true);
      }
    }
    state.paused = false;
    updateGame(state, 1, { up: false, down: false, left: false, right: false });
    expect(faction.population).toBe(ADVANCED_START_POPULATION);
    const restored = parseGameSave(serializeGameSave(state));
    expect(restored.factions[0].population).toBe(ADVANCED_START_POPULATION);
    expect(desiredRetinueSize(restored.factions[0])).toBe(ADVANCED_START_RETINUE);
  });

  it('uses the minimum population that naturally supports twelve retinue without paid or bonus slots', () => {
    const faction = { population: ADVANCED_START_POPULATION } as Parameters<typeof desiredRetinueSize>[0];
    expect(ADVANCED_START_POPULATION).toBe(250); expect(ADVANCED_START_RETINUE).toBe(12);
    expect(desiredRetinueSize(faction)).toBe(12);
    expect(desiredRetinueSize({ ...faction, population: ADVANCED_START_POPULATION - 1 })).toBe(11);
  });

  it('midpoint grants the first half of the research tree; houses stand in well-served blocks of 8-12', () => {
    const state = createGame(generateWorld('advanced-infantry-drill'), undefined, { advancedStart: 'midpoint', banditIntensity: 0 });
    const faction = state.factions[0];
    for (const branch of RESEARCH_BRANCHES)
      expect(researchLevel(faction, branch.id) > 0, branch.id).toBe(researchDepth(branch.id) <= ADVANCED_START_MIDPOINT_DEPTH);
    expect(isInfantryDrillUnlocked(faction)).toBe(false);
    expect(state.buildings.some(building => building.faction === 0 && building.kind === 'ballista')).toBe(false);
    const houses = state.buildings.filter(building => building.faction === 0 && building.kind === 'house');
    const wells = state.buildings.filter(building => building.faction === 0 && building.kind === 'well');
    expect(wells.every(well => sharedHouseForWell(well, houses))).toBe(true);
    // Group houses into 4-connected blocks.
    const key = (x: number, y: number) => `${x},${y}`, byCell = new Map(houses.map(house => [key(house.x, house.y), house])), seen = new Set<string>();
    const blocks: typeof houses[] = [];
    for (const house of houses) {
      if (seen.has(key(house.x, house.y))) continue;
      const block = [house], queue = [house]; seen.add(key(house.x, house.y));
      while (queue.length) { const next = queue.pop()!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const neighbor = byCell.get(key(next.x + dx, next.y + dy));
          if (neighbor && !seen.has(key(neighbor.x, neighbor.y))) { seen.add(key(neighbor.x, neighbor.y)); block.push(neighbor); queue.push(neighbor); } } }
      blocks.push(block);
    }
    const served = blocks.filter(block => block.length >= ADVANCED_HOUSE_BLOCK.min);
    expect(served.length).toBeGreaterThan(0);
    for (const block of served) {
      expect(block.length).toBeLessThanOrEqual(ADVANCED_HOUSE_BLOCK.max);
      expect(block.some(house => wells.some(well => well.x === house.x && well.y === house.y))).toBe(true);
      for (const house of block) {
        expect(houseLevel(house)).toBe(2);
        expect(wells.some(well => Math.hypot(well.x - house.x, well.y - house.y) <= WELL_RADIUS)).toBe(true);
      }
    }
    expect(houses.reduce((sum, house) => sum + house.capacity, 0) + state.buildings.find(b => b.kind === 'palace' && b.faction === 0)!.capacity)
      .toBeGreaterThanOrEqual(ADVANCED_START_POPULATION);
  });

  it('requires copper to replace a spearman after the pre-equipped starting escort is granted', () => {
    const state = createGame(world(), undefined, { advancedStart: 'complete', banditIntensity: 0 });
    const faction = state.factions[0], spearman = state.units.find(unit => unit.faction === 0 && unit.kind === 'spearman')!;
    expect(spearman).toBeDefined();
    expect(factionHasDevelopedResource(state, 0, 'copper')).toBe(false);
    entityStore(state).units.retain(unit => unit.id !== spearman.id);
    const before = new Set(state.units.map(unit => unit.id));
    faction.nextRetinueAt = 0;
    updateGame(state, .1, { up: false, down: false, left: false, right: false });
    const replacement = state.units.find(unit => unit.faction === 0 && isRetinueMember(unit) && !before.has(unit.id));
    expect(replacement?.kind).toBe('warrior');
    expect(state.units.filter(unit => unit.faction === 0 && unit.kind === 'spearman')).toHaveLength(2);
    expect(state.units.some(unit => unit.faction === 0 && unit.training?.role === 'spearman')).toBe(false);
  });

  it('houses the advanced population on a generated landscape and retains city assignment through an economy tick', () => {
    const state = createGame(generateWorld('advanced-infantry-drill'), undefined, { advancedStart: 'complete', banditIntensity: 0 });
    // Isolate housing and the first economy cycle from rival armies.
    entityStore(state).units.retain(unit => unit.faction === 0);
    entityStore(state).buildings.replace(state.buildings.filter(building => building.faction === 0));
    for (const rival of state.factions) if (rival.id !== 0) rival.defeated = true;
    state.villages = []; state.raiderCamps = []; state.marauderPacks = [];
    const faction = state.factions[0], initial = cityResidents(state).filter(city => city.palace.faction === 0);
    expect(initial).toHaveLength(1); expect(initial[0].population).toBe(ADVANCED_START_POPULATION);
    expect(initial[0].housing).toBeGreaterThanOrEqual(ADVANCED_START_POPULATION);
    const residents = state.buildings.filter(building => building.faction === 0 && building.kind === 'house')
      .reduce((sum, house) => sum + (house.residents ?? 0), 0);
    expect(residents).toBeGreaterThanOrEqual(ADVANCED_START_POPULATION - initial[0].palace.capacity);
    for (const kind of inlandKinds) expect(state.buildings.some(building => building.faction === 0 && building.kind === kind && buildingReady(building))).toBe(true);
    state.paused = false;
    for (let second = 0; second < 30; second++) updateGame(state, 1, { up: false, down: false, left: false, right: false });
    const after = cityResidents(state).filter(city => city.palace.faction === 0);
    expect(after.reduce((sum, city) => sum + city.population, 0)).toBe(faction.population);
    expect(faction.population).toBeGreaterThanOrEqual(ADVANCED_START_POPULATION);
    expect(faction.food).toBeGreaterThan(0);
  }, 120_000);

  it('keeps ordinary starts at 20 residents without free technologies or extra retinue capacity', () => {
    const state = createGame(world());
    expect(state.factions[0].population).toBe(20);
    expect(state.factions[0].bonusRetinueSlots).toBeUndefined();
    expect(isBuildingUnlocked(state.factions[0], 'ballista')).toBe(false);
  });
});
