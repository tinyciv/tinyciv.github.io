import { describe, expect, it } from 'vitest';
import { buildingOverlapsVillageBorders, buildingWithinBorders } from '../src/game/border-placement';
import { borderRadius, insideOwnBorders, territory, UNCLAIMED, villageBorderRadius } from '../src/game/borders';
import { entityStore } from '../src/game/entity-store';
import { planAutomaticFarmSite } from '../src/game/farm-siting';
import { pointInSight, updateFog } from '../src/game/fog';
import { MinimapTerritoryMemory } from '../src/game/minimap';
import { addPalaceRoadRing } from '../src/game/palace-roads';
import { buildingTerritoryOwner } from '../src/game/property-territory';
import { buildAt, createGame, validateBuildAt } from '../src/game/simulation';
import { recordMerchantRoad } from '../src/game/trade';
import { updateWallOwnership } from '../src/game/wall-ownership';
import type { Building, GameState } from '../src/game/types';
import { recordNativeFrame } from './helpers/native-renderer';
import { unlockBuildingResearch } from './helpers/research';

const structure = (id: number, kind: Building['kind'], x: number, y: number, faction = 0): Building => ({
  id, kind, x, y, faction, hp: 650, maxHp: 650, capacity: 0,
});
function fixture(): GameState {
  const state: GameState = {
    world: { width: 64, height: 40, seed: 'village-borders', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: 64 * 40 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [structure(1, 'palace', 6, 18), ...[[30, 17], [34, 17], [32, 20]].map(([x, y], index) =>
      ({ ...structure(100 + index, 'villageTent', x, y, 1), villageId: 1 }))],
    units: [{ id: 1000, kind: 'leader', faction: 0, x: 7.5, y: 20.5, hp: 100, maxHp: 100, morale: 100,
      attack: 0, defense: 4, speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [0, 1].map(id => ({ id, name: id ? 'Sabine Grove' : 'Roma', color: id ? '#ffffff' : '#f34f59',
      affinity: 50, relation: id ? 'peace' : 'self', food: 500, gold: 10000, production: 0, population: id ? 3 : 20,
      culture: 0, yields: { food: 0, production: 0, gold: 0 }, nextRaid: Infinity, nextRetinueAt: Infinity, defeated: false,
      ...(id ? { villageId: 1 } : {}) })),
    villages: [{ id: 1, faction: 1, campId: 100, name: 'Sabine Grove', identity: 'growers', relation: 'neutral',
      x: 32, y: 18, nextGrowthAt: 90, nextThinkAt: 0, nextRecruitAt: 90 }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'village-borders', rngState: 1,
    raiderCamps: [], marauderPacks: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 1 },
    wildlife: { herds: [], sequence: 0, nextRespawnAt: Infinity, targetHerds: 0 },
  };
  state.factions.forEach(unlockBuildingResearch);
  return state;
}

describe('neutral village reservations', () => {
  it('starts at three tiles, grows with residents and development, and never exceeds six tiles from the clearing', () => {
    const state = fixture(), village = state.villages![0], first = territory(state);
    expect(villageBorderRadius(state, village)).toBe(3);
    expect(insideOwnBorders(state, 1, 35.5, 18.5)).toBe(true);
    expect(insideOwnBorders(state, 1, 36.5, 18.5)).toBe(false);
    expect(territory(state)).toBe(first);
    state.factions[1].culture = 1e9;
    expect(territory(state)).toBe(first);
    state.factions[1].population = 10;
    expect(villageBorderRadius(state, village)).toBe(3.5);
    expect(territory(state)).not.toBe(first);
    for (let i = 0; i < 5; i++) entityStore(state).buildings.add({ ...structure(200 + i, 'house', 29 + i, 22, 1), villageId: 1 });
    expect(villageBorderRadius(state, village)).toBe(4.5);
    state.factions[1].population = 1000;
    expect(villageBorderRadius(state, village)).toBe(6);
    const borders = territory(state);
    expect(borders.sourceRadii.get(village.campId)).toBe(6);
    expect(insideOwnBorders(state, 1, 38.5, 18.5)).toBe(true);
    for (let cell = 0; cell < borders.owners.length; cell++) if (borders.owners[cell] === 1)
      expect(Math.hypot(cell % borders.width - village.x, Math.floor(cell / borders.width) - village.y)).toBeLessThanOrEqual(6);
  });

  it.each(['camp', 'house', 'road', 'wall', 'palisade', 'woodenTower', 'guardPost', 'palace', 'bridge', 'irrigation'] as const)
  ('blocks foreign %s footprints even when that kind normally builds beyond faction borders', kind => {
    const state = fixture(); Object.assign(state.units[0], { x: 32.5, y: 19.5 });
    if (kind === 'bridge') state.world.tiles[18 * 64 + 32].terrain = 'river';
    const before = state.factions[0].gold, count = state.buildings.length;
    expect(buildingOverlapsVillageBorders(state, kind, 32, 18)).toBe(true);
    expect(buildingWithinBorders(state, kind, 32, 18)).toBe(false);
    expect(validateBuildAt(state, kind, 32, 18)).toEqual({ ok: false, message: 'Cannot build inside a neutral village’s borders.' });
    expect(buildAt(state, kind, 32, 18).ok).toBe(false);
    expect(state.factions[0].gold).toBe(before); expect(state.buildings).toHaveLength(count);
  });

  it('protects partial footprints and allied villages while allowing the village to develop its own land', () => {
    const state = fixture(); state.villages![0].relation = 'allied';
    expect(buildingWithinBorders(state, 'camp', 35, 18, 0)).toBe(false);
    expect(buildingWithinBorders(state, 'house', 32, 18, 1)).toBe(true);
    expect(buildingOverlapsVillageBorders(state, 'camp', 32, 18, 1)).toBe(false);
    state.buildings[1].hp = 0;
    expect(buildingOverlapsVillageBorders(state, 'camp', 32, 18, 0)).toBe(false);
  });

  it('reserves village land under stronger culture without automatically transferring either side’s buildings', () => {
    const state = fixture(); state.buildings[0].x = 23; state.factions[0].culture = 1e6;
    const house = { ...structure(300, 'house', 32, 18), capacity: 4, residents: 2 };
    entityStore(state).buildings.add(house);
    const borders = territory(state);
    expect(borders.owners[18 * 64 + 32]).toBe(1);
    expect(buildingTerritoryOwner(state, house, borders)).toBeUndefined();
    expect(buildingTerritoryOwner(state, state.buildings[1], borders)).toBe(1);
    updateWallOwnership(state);
    expect(house.faction).toBe(0);
    expect(state.buildings.filter(building => building.villageId === 1).every(building => building.faction === 1)).toBe(true);
  });

  it('gives no player sight or minimap knowledge until the village is observed', () => {
    const state = fixture(), fog = updateFog(state), borders = territory(state);
    expect(pointInSight(fog, 32.5, 18.5)).toBe(false);
    expect(fog.owned?.[18 * 64 + 32]).toBe(0);
    const memory = new MinimapTerritoryMemory(); memory.update(borders, fog);
    expect(memory.owners[18 * 64 + 32]).toBe(UNCLAIMED);
    fog.visible[18 * 64 + 32] = 1; fog.explored[18 * 64 + 32] = 1; fog.revision++; fog.explorationRevision++; memory.update(borders, fog);
    expect(memory.owners[18 * 64 + 32]).toBe(1);
    fog.visible[18 * 64 + 32] = 0; fog.revision++;
    expect(memory.update(borders, fog)).toEqual([]);
    expect(memory.owners[18 * 64 + 32]).toBe(1);
    const unseenVillage = borders.owners.findIndex((owner, cell) => owner === 1 && !fog.explored[cell]);
    expect(memory.owners[unseenVillage]).toBe(UNCLAIMED);
  });

  it('renders a single solid white stroke for village borders while retaining striped civilization borders', () => {
    const state = fixture(), fog = updateFog(state); fog.visible.fill(1);
    const strokes = recordNativeFrame(state, { fog, width: 2200, height: 1400 }).strokes.filter(stroke => stroke.key.startsWith('border:'));
    const village = strokes.filter(stroke => stroke.key.includes('village-white'));
    expect(village.length).toBeGreaterThan(0);
    expect(village.every(stroke => stroke.color === '#ffffff' && stroke.dash.length === 0)).toBe(true);
    expect(strokes.filter(stroke => !stroke.key.includes('village-white')).every(stroke => stroke.dash.length === 2)).toBe(true);
  });

  it('hides all borders in unexplored fog but retains discovered borders in light fog', () => {
    const state = fixture(), fog = updateFog(state), borders = territory(state);
    fog.visible.fill(0); fog.explored.fill(0);
    const hidden = recordNativeFrame(state, { fog, width: 2200, height: 1400 });
    expect(hidden.drawOrder.some(key => key.startsWith('border:') && key.includes('village-white'))).toBe(false);
    const normal = hidden.drawOrder.filter(key => key.startsWith('border:') && !key.includes('village-white'));
    expect(normal).toEqual([]);
    for (let cell = 0; cell < borders.owners.length; cell++) if (borders.owners[cell] === 1) fog.explored[cell] = 1;
    fog.explorationRevision++;
    const remembered = recordNativeFrame(state, { fog, width: 2200, height: 1400 });
    expect(remembered.drawOrder.some(key => key.startsWith('border:') && key.includes('village-white'))).toBe(true);
    expect(remembered.drawOrder.filter(key => key.startsWith('border:') && !key.includes('village-white'))).toEqual(normal);
  });

  it('does not reveal undiscovered white border segments when only one edge cell is explored', () => {
    const state = fixture(), fog = updateFog(state), borders = territory(state);
    fog.visible.fill(0); fog.explored.fill(0);
    const first = borders.paths.find(path => path.edge.faction === 1)!.edge.cell; fog.explored[first] = 1;
    const partial = recordNativeFrame(state, { fog, width: 2200, height: 1400 }).drawOrder.filter(key => key.includes('village-white'));
    expect(partial.length).toBe(borders.paths.filter(path => path.edge.faction === 1 && path.edge.cell === first).length);
    expect(partial.length).toBeLessThan(borders.paths.filter(path => path.edge.faction === 1).length);
  });

  it('keeps automatic farms, merchant roads and settlement road rings outside village land', () => {
    const state = fixture(); state.buildings[0].x = 26;
    const farm = planAutomaticFarmSite(state, state.buildings[0]);
    expect(farm).toBeDefined();
    expect(buildingOverlapsVillageBorders(state, 'camp', farm!.point.x, farm!.point.y)).toBe(false);
    const merchant = { ...state.units[0], id: 2000, kind: 'merchant' as const, tradeRoute: 1, x: 32.5, y: 18.5 };
    entityStore(state).units.add(merchant);
    expect(recordMerchantRoad(state, merchant)).toBe(false);
    const palace = structure(300, 'palace', 27, 17); entityStore(state).buildings.add(palace);
    expect(buildingOverlapsVillageBorders(state, 'road', 29, 18)).toBe(true);
    expect(addPalaceRoadRing(state, palace)).toBeGreaterThan(0);
    expect(state.buildings.some(building => building.kind === 'road' && building.x === 29 && building.y === 18)).toBe(false);
    expect(state.buildings.filter(building => building.kind === 'road').every(road => !buildingOverlapsVillageBorders(state, 'road', road.x, road.y))).toBe(true);
  });
});

describe('initial city border allowance', () => {
  it('adds exactly three tiles to the initial source, retaining ordinary new-city borders', () => {
    const state = fixture(); state.buildings[0].initialCity = true;
    const expansion = structure(2, 'palace', 50, 18); entityStore(state).buildings.add(expansion);
    const radii = territory(state).sourceRadii;
    expect(radii.get(1)).toBe(borderRadius('palace') + 3);
    expect(radii.get(2)).toBe(borderRadius('palace'));
    state.buildings[0].initialCity = false;
    expect(territory(state).sourceRadii.get(1)).toBe(borderRadius('palace'));
  });

  it('marks only each faction’s first initial city, not a rival’s second or a later settlement', () => {
    const world = fixture().world; world.spawns = [{ x: 8, y: 8 }, { x: 48, y: 8 }]; world.secondarySpawns = [{ x: 48, y: 29 }];
    const state = createGame(world), cities = state.buildings.filter(building => building.kind === 'palace');
    expect(cities.map(city => !!city.initialCity)).toEqual([true, true, false]);
    const later = structure(20000, 'palace', 8, 29); entityStore(state).buildings.add(later);
    expect(territory(state).sourceRadii.get(later.id)).toBe(borderRadius('palace'));
  });
});
