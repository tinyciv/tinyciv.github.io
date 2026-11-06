import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { insideOwnBorders, territory, UNCLAIMED } from '../src/game/borders';
import { citySummaries } from '../src/game/cities';
import { BUILD_COSTS, buildAt, updateGame, validateBuildAt } from '../src/game/simulation';
import { updateConstruction } from '../src/game/structures';
import { buildingReady, type Building, type GameState } from '../src/game/types';
import { buildSelectionForKey, supportsBuildStroke } from '../src/ui/build-controls';

const idle = { up: false, down: false, left: false, right: false };
function fixture(): GameState {
  return {
    world: { width: 40, height: 28, seed: 'new-city', source: 'test', spawns: [], tiles: Array.from({ length: 1120 }, () =>
      ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 6, y: 10, hp: 650, maxHp: 650, capacity: 0,
      cityName: 'Home', governorPermissions: { farms: false, housing: false } }],
    units: [{ id: 2, kind: 'leader', faction: 0, x: 19.5, y: 13.5, hp: 100, morale: 100, attack: 25, defense: 5,
      speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Home', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 500, production: 0,
      population: 5, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, nextRetinueAt: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], treasures: [], raiderCamps: [], marauderPacks: [],
    selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'new-city', rngState: 1,
  };
}
const city = (id: number, x: number): Building => ({ id, kind: 'palace', faction: 0, x, y: 10, hp: 650, maxHp: 650,
  capacity: 0, cityName: 'New Home', governorPermissions: { farms: false, housing: false } });

describe('founding another city', () => {
  it('uses B then N for a single settlement without taking the normal-play shortcut', () => {
    expect(buildSelectionForKey('n', null)).toBeUndefined();
    expect(buildSelectionForKey('N', 'build')).toBe('palace');
    expect(supportsBuildStroke('palace')).toBe(false);
  });

  it('costs 100 gold, takes 90 seconds of builder work, then claims a named empty city', () => {
    const state = fixture();
    expect(insideOwnBorders(state, 0, 20.5, 10.5)).toBe(false);
    state.factions[0].gold = 99;
    expect(buildAt(state, 'palace', 20, 10)).toMatchObject({ ok: false, message: 'Need 100 gold.' });
    state.factions[0].gold = 100;
    expect(buildAt(state, 'palace', 20, 10).ok).toBe(true);
    const palace = state.buildings.find(building => building.kind === 'palace' && building.id !== 1)!;
    expect(state.factions[0].gold).toBe(0);
    expect(palace).toMatchObject({ capacity: 4, cityName: 'Roma', construction: { duration: 90, paidGold: 100, waitingForBuilder: true } });
    expect(insideOwnBorders(state, 0, 20.5, 10.5)).toBe(false);
    for (let i = 0; i < 200 && palace.construction?.waitingForBuilder; i++) updateGame(state, .1, idle);
    expect(palace.construction?.waitingForBuilder).toBe(false);
    const start = palace.construction!.startedAt;
    state.time = start + 89.99; updateConstruction(state); expect(buildingReady(palace)).toBe(false);
    state.time = start + 90; updateConstruction(state); expect(buildingReady(palace)).toBe(true);
    expect(insideOwnBorders(state, 0, 20.5, 10.5)).toBe(true);
    expect(citySummaries(state).find(summary => summary.palace.id === palace.id)).toMatchObject({ name: 'Roma', housing: 4, population: 0, food: 4 });
    expect(state.buildings.filter(building => building.kind === 'house')).toHaveLength(0);
  });

  it('allows a settlement on an unclaimed footprint beside a foreign guard post', () => {
    const state = fixture();
    state.factions.push({ ...state.factions[0], id: 1, relation: 'peace' });
    const foreignPost: Building = { ...city(3, 22), kind: 'guardPost', faction: 1 };
    entityStore(state).buildings.add(foreignPost);
    const borders = territory(state);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]])
      expect(borders.owners[(10 + dy) * 40 + 20 + dx]).toBe(UNCLAIMED);
    const before = JSON.stringify(state), { gold, food, production } = state.factions[0];
    expect(validateBuildAt(state, 'palace', 20, 10)).toEqual({ ok: true, message: '' });
    expect(JSON.stringify(state)).toBe(before);
    expect(buildAt(state, 'palace', 20, 10).ok).toBe(true);
    expect(state.factions[0]).toMatchObject({ gold: gold - BUILD_COSTS.palace.gold, food, production });
    expect(state.buildings.find(building => building.kind === 'palace' && building.x === 20)).toMatchObject({
      faction: 0, y: 10, construction: { duration: 90, paidGold: 100, waitingForBuilder: true },
    });
    expect(foreignPost.faction).toBe(1);
  });

  it.each([[0, 0], [1, 0], [0, 1], [1, 1]])('rejects a settlement when only footprint cell (%i, %i) is rival-owned without spending resources', (claimedX, claimedY) => {
    const state = fixture();
    state.factions.push({ ...state.factions[0], id: 1, relation: 'peace' });
    // A diagonal house reaches exactly one corner of the proposed 2 by 2 site.
    entityStore(state).buildings.add({ ...city(3, claimedX ? 23 : 18), kind: 'house', faction: 1, y: claimedY ? 13 : 8 });
    const borders = territory(state);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]])
      expect(borders.owners[(10 + dy) * 40 + 20 + dx]).toBe(dx === claimedX && dy === claimedY ? 1 : UNCLAIMED);
    const before = JSON.stringify(state);
    const rejection = { ok: false, message: 'Settlements cannot be built inside another faction’s borders.' };
    expect(validateBuildAt(state, 'palace', 20, 10)).toEqual(rejection);
    expect(buildAt(state, 'palace', 20, 10)).toEqual(rejection);
    expect(JSON.stringify(state)).toBe(before);
  });

  it.each(['water', 'occupied', 'field', 'ridge', 'outside world', 'rival territory', 'disconnected'] as const)
  ('rejects the full two-by-two footprint or inaccessible city: %s', reason => {
    const state = fixture(); let x = 20, y = 10;
    if (reason === 'water') state.world.tiles[11 * 40 + 21].terrain = 'lake';
    if (reason === 'occupied') entityStore(state).buildings.add({ ...city(3, 21), kind: 'well', y: 11 });
    if (reason === 'field') state.fields!.push({ id: 100, camp: 50, faction: 0, x: 21, y: 11, planted: true, food: 1, nextHarvest: 30 });
    if (reason === 'ridge') state.world.tiles[11 * 40 + 21].ridge = 1;
    if (reason === 'outside world') { x = 39; state.units[0].x = 38; }
    if (reason === 'rival territory') {
      state.factions.push({ ...state.factions[0], id: 1, relation: 'peace' });
      entityStore(state).buildings.add({ ...city(3, 24), faction: 1 });
    }
    if (reason === 'disconnected') for (let row = 0; row < 28; row++) state.world.tiles[row * 40 + 15].terrain = 'ocean';
    const before = JSON.stringify(state);
    expect(validateBuildAt(state, 'palace', x, y).ok).toBe(false);
    expect(buildAt(state, 'palace', x, y).ok).toBe(false);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('routes a fleeing Leader toward the nearest completed reachable city', () => {
    const state = fixture(), leader = state.units[0];
    entityStore(state).buildings.add(city(3, 25), { ...city(4, 20), y: 18, construction: { startedAt: 0, duration: 90, waitingForBuilder: true } });
    Object.assign(leader, { x: 22.5, y: 15.5, hp: 20, morale: 0, order: 'flee', routed: true, lastDamagedAt: 0 });
    updateGame(state, .1, idle);
    expect(leader.destination).toBeDefined();
    expect(leader.destination!.x).toBeGreaterThan(23);
    expect(leader.destination!.y).toBeLessThan(13);
  });

  it('falls back to the other city if the nearer city is on disconnected land', () => {
    const state = fixture(), leader = state.units[0];
    entityStore(state).buildings.add(city(3, 25));
    for (let row = 0; row < 28; row++) state.world.tiles[row * 40 + 24].terrain = 'ocean';
    Object.assign(leader, { x: 22.5, y: 13.5, hp: 20, morale: 0, order: 'flee', routed: true, lastDamagedAt: 0 });
    updateGame(state, .1, idle);
    expect(leader.destination).toBeDefined();
    expect(leader.destination!.x).toBeLessThan(10);
  });
});
