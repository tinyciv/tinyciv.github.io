import { describe, expect, it } from 'vitest';
import { createGame, updateGame } from '../src/game/simulation';
import { desiredRetinueSize } from '../src/game/archery';
import { ADVANCED_START_POPULATION, ADVANCED_START_RETINUE, ADVANCED_START_FOOD, ADVANCED_START_GOLD } from '../src/game/advanced-start';
import { serializeGameSave, parseGameSave } from '../src/game/game-save';
import { buildingResearchRequirement, isBuildingUnlocked, isInfantryDrillUnlocked } from '../src/game/research';
import { bridgeSpanAt } from '../src/game/bridge-spans';
import { constructionEdges } from '../src/game/builders';
import { hasStaticPath } from '../src/game/pathfinding';
import { irrigationConnects } from '../src/game/irrigation';
import { dockBerth, dockMoorings } from '../src/game/dock';
import { BUILDABLE_KINDS, buildingReady, buildingWidth, buildingHeight, isFarmKind, isRetinueMember, tileAt, WATER, type World } from '../src/game/types';
import { farmBlockGeometry } from './helpers/farm-block-geometry';
import { cityResidents } from '../src/game/cities';
import { generateWorld } from '../src/world/generator';
import { entityStore } from '../src/game/entity-store';

function world(water = false, raised = false): World {
  const width = 64, height = 56;
  return { width, height, seed: `advanced-start-${water}`, source: 'test', revision: 1, spawns: [{ x: 31, y: 27 }],
    tiles: Array.from({ length: width * height }, (_, i) => ({ terrain: water && i % width >= 44 && i % width <= 45 ? 'river' : 'grassland',
      overlay: 'none', ...(raised ? { ridge: 1 } : {}), elevation: .3, moisture: .7, food: 3, production: 1, gold: 0, variation: .5 })) };
}

describe('advanced starting cities', () => {
  it.each([[false, false], [true, false], [false, true]])('starts with a populated, accessible city and every buildable structure (river=%s, plateau=%s)', (water, raised) => {
    const state = createGame(world(water, raised), undefined, { advancedStart: true });
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
    for (const kind of BUILDABLE_KINDS.filter(kind => kind !== 'observationPost')) {
      expect(buildings.some(b => b.kind === kind), `Missing ${kind}`).toBe(true);
      if (buildingResearchRequirement(kind)) expect(isBuildingUnlocked(faction, kind), `Locked ${kind}`).toBe(true);
    }
    expect(state.buildings.some(building => building.kind === 'observationPost')).toBe(false);
    const housing = buildings.filter(b => b.kind === 'house' || b.kind === 'palace');
    expect(housing.reduce((sum, b) => sum + b.capacity, 0)).toBeGreaterThanOrEqual(ADVANCED_START_POPULATION);
    expect(housing.reduce((sum, b) => sum + (b.residents ?? 0) + (b.unhousedResidents ?? 0), 0)).toBe(ADVANCED_START_POPULATION);
    const farms = buildings.filter(building => isFarmKind(building.kind));
    expect(farms.length).toBeGreaterThan(16);
    for (const block of farmBlockGeometry(farms)) {
      expect(block.size).toBeLessThanOrEqual(16);
      if (block.size > 6) expect(block.aspectRatio).toBeLessThanOrEqual(1.5);
    }
    const occupied = new Set<number>();
    for (const building of buildings) {
      for (let dy = 0; dy < buildingHeight(building); dy++) for (let dx = 0; dx < buildingWidth(building); dx++) {
        const cell = (building.y + dy) * state.world.width + building.x + dx;
        expect(occupied.has(cell), `Overlapping ${building.kind} at ${cell}`).toBe(false); occupied.add(cell);
      }
      if (building.kind === 'bridge') expect(bridgeSpanAt(state, building, 0)).toBeDefined();
      if (building.kind === 'irrigation') expect(irrigationConnects(state, building.x, building.y)).toBe(true);
      if (building.kind === 'dock') {
        const berth = dockBerth(building);
        expect(WATER.has(tileAt(state.world, berth.x, berth.y)!.terrain)).toBe(true);
        expect(dockMoorings(state, building).length).toBeGreaterThan(0);
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

  it('houses the advanced population on a generated landscape and retains city assignment through an economy tick', () => {
    const state = createGame(generateWorld('advanced-infantry-drill'), undefined, { advancedStart: true, banditIntensity: 0 });
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
    for (const kind of BUILDABLE_KINDS.filter(kind => kind !== 'observationPost')) expect(state.buildings.some(building => building.faction === 0 && building.kind === kind && buildingReady(building))).toBe(true);
    state.paused = false;
    for (let second = 0; second < 30; second++) updateGame(state, 1, { up: false, down: false, left: false, right: false });
    const after = cityResidents(state).filter(city => city.palace.faction === 0);
    expect(after.reduce((sum, city) => sum + city.population, 0)).toBe(faction.population);
    expect(faction.population).toBeGreaterThanOrEqual(ADVANCED_START_POPULATION);
    expect(faction.food).toBeGreaterThan(0);
  }, 30_000);

  it('keeps ordinary starts at 20 residents without free technologies or extra retinue capacity', () => {
    const state = createGame(world());
    expect(state.factions[0].population).toBe(20);
    expect(state.factions[0].bonusRetinueSlots).toBeUndefined();
    expect(isBuildingUnlocked(state.factions[0], 'ballista')).toBe(false);
  });
});
