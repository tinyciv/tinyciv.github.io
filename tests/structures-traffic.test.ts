import { updateWallStats } from '../src/game/wall-stats';
import { synchronizeFarms } from '../src/game/farms';
import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import type { Building, GameState, Unit } from '../src/game/types';
import { buildingReady } from '../src/game/types';
import { CONSTRUCTION_SECONDS, startConstruction, updateConstruction } from '../src/game/structures';
import { beginTrafficFrame, endTrafficFrame, canPlaceRoad, hasNeighboringRoad, recordTraffic, ROAD_TRAFFIC_THRESHOLD, ROAD_TRAFFIC_WINDOW, updateTraffic } from '../src/game/traffic';
import { canWalk, movementMultiplier } from '../src/game/pathfinding';
import { withSimulationReads } from '../src/game/simulation-reads';

function fixture(): GameState {
  return { world: { width: 16, height: 16, seed: 'systems', source: 'test', spawns: [], tiles: Array.from({ length: 256 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 2, production: 1, gold: 0, variation: .2 })) },
    units: [], buildings: [{ id: 900, kind: 'palace', x: 12, y: 12, hp: 650, maxHp: 650, capacity: 0, faction: 0 }], factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 500, production: 500, population: 5, culture: 10000, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1000, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'systems', rngState: 1 };
}
const structure = (kind: Building['kind'], x: number, y: number, id = 1): Building => ({ id, kind, x, y, faction: 0, hp: 100, maxHp: 100, capacity: 0 });
const unit = (x: number, y: number): Unit => ({ id: 99, kind: 'militia', faction: 0, x, y, hp: 100, morale: 100, attack: 17, defense: 4, speed: 3.96, range: 1.1, order: 'follow', cooldown: 0, lastCombat: -60, moving: true, facing: 0, attackTime: 0 });

describe('construction', () => {
  it('keeps bridges unusable until their actual construction duration elapses', () => {
    const state = fixture(), bridge = structure('bridge', 5, 5);
    state.world.tiles[85].terrain = 'river'; entityStore(state).buildings.add(bridge);
    startConstruction(bridge, state.time);
    expect(canWalk(state, 5, 5, 0)).toBe(false);
    state.time = CONSTRUCTION_SECONDS.bridge - .01;
    expect(updateConstruction(state)).toBe(false);
    state.time = CONSTRUCTION_SECONDS.bridge;
    expect(updateConstruction(state)).toBe(true);
    expect(buildingReady(bridge)).toBe(true);
    expect(canWalk(state, 5, 5, 0)).toBe(true);
    expect(movementMultiplier(state, 5, 5)).toBe(1);
    expect(updateConstruction(state)).toBe(false);
  });
  it('keeps friendly road gates passable during work without healing damaged sites', () => {
    const state = fixture(), wall = structure('wall', 6, 6), road = structure('road', 6, 6, 2);
    entityStore(state).buildings.add(wall, road); updateWallStats(state); startConstruction(wall, 0); wall.hp = 42;
    expect(canWalk(state, 6, 6, 0)).toBe(true);
    expect(canWalk(state, 6, 6, -2)).toBe(false);
    state.time = CONSTRUCTION_SECONDS.wall; updateConstruction(state);
    expect(canWalk(state, 6, 6, 0)).toBe(true); expect(wall.hp).toBe(42);
  });

});

describe('roads worn by recent traffic', () => {
  it.each(['new worksite', 'destroyed connection'] as const)('validates a mature road against a %s before the next structure sample', change => {
    const state = fixture(), walker = unit(5.5, 5.5), road = structure('road', 4, 5);
    entityStore(state).buildings.add(road);
    withSimulationReads(state, () => {
      beginTrafficFrame(state);
      try { expect(recordTraffic(state, walker, { x: 4.5, y: 5.5 })).toBe(false); }
      finally { endTrafficFrame(state); }
      state.time = .1;
      if (change === 'new worksite') entityStore(state).buildings.add({ ...structure('house', 5, 5, 2),
        construction: { startedAt: state.time, duration: 10, waitingForBuilder: true } });
      else road.hp = 0;
      state.traffic = { '85': Array(ROAD_TRAFFIC_THRESHOLD - 1).fill(0) };
      beginTrafficFrame(state);
      try { expect(recordTraffic(state, walker, { x: 4.5, y: 5.5 })).toBe(false); }
      finally { endTrafficFrame(state); }
      expect(state.buildings.some(building => building.kind === 'road' && building.x === 5 && building.y === 5)).toBe(false);
      if (change === 'new worksite') expect(state.buildings.find(building => building.id === 2)?.construction?.waitingForBuilder).toBe(true);
    });
  });

  it.each(['leader', 'warrior', 'archer', 'scout'] as const)('%s movement never increments existing road wear', kind => {
    const state = fixture(), member = { ...unit(5.5, 5.5), kind, joiningRetinue: kind !== 'leader' };
    const farm = structure('camp', 5, 5, 2);
    entityStore(state).buildings.add(structure('road', 4, 5), farm);
    synchronizeFarms(state);
    const existingVisits = Array(ROAD_TRAFFIC_THRESHOLD - 1).fill(0);
    state.traffic = { '85': [...existingVisits] };
    for (let visit = 0; visit < ROAD_TRAFFIC_THRESHOLD * 4; visit++) {
      state.time = visit;
      expect(recordTraffic(state, member, { x: 4.5, y: 5.5 })).toBe(false);
      expect(state.traffic['85']).toEqual(existingVisits);
      expect(updateTraffic(state)).toBe(false);
    }
    expect(state.buildings.filter(building => building.kind === 'road')).toHaveLength(1);
    expect(farm).toMatchObject({ x: 5, y: 5 });
  });

  it.each([{ villageId: 7 }, { guardPost: 8 }])('keeps independent village/post soldiers eligible: %j', assignment => {
    const state = fixture(), soldier = { ...unit(5.5, 5.5), kind: 'warrior' as const, ...assignment };
    entityStore(state).buildings.add(structure('road', 4, 5));
    for (let visit = 0; visit < ROAD_TRAFFIC_THRESHOLD; visit++)
      expect(recordTraffic(state, soldier, { x: 4.5, y: 5.5 })).toBe(visit === ROAD_TRAFFIC_THRESHOLD - 1);
    expect(state.buildings.filter(building => building.kind === 'road')).toHaveLength(2);
  });

  it.each([
    { builder: true, buildPhase: 'outbound' },
    { builder: true, buildPhase: 'returning' },
    { collector: true, collectPhase: 'outbound' },
    { collector: true, collectPhase: 'returning' },
  ] as const)('work trips never pave or displace crops: %j', role => {
    const state = fixture(), worker = { ...unit(5.5, 5.5), kind: 'worker' as const, ...role };
    const farm = structure('camp', 5, 5, 2);
    entityStore(state).buildings.add(structure('road', 4, 5), farm);
    synchronizeFarms(state);
    beginTrafficFrame(state);
    try {
      for (let visit = 0; visit < ROAD_TRAFFIC_THRESHOLD * 4; visit++) {
        state.time = visit;
        expect(recordTraffic(state, worker, { x: 4.5, y: 5.5 })).toBe(false);
        expect(updateTraffic(state)).toBe(false);
      }
      expect(state.traffic?.['85']).toBeUndefined();
      expect(state.buildings.filter(building => building.kind === 'road')).toHaveLength(1);
      expect(farm).toMatchObject({ x: 5, y: 5 });
      expect(state.fields).toHaveLength(1);
      expect(state.world.tiles[85].farm).toBe(0);
    } finally { endTrafficFrame(state); }
  });

  it('shares a traffic frame while observing every newly laid road and a merchant road insertion', () => {
    const state = fixture();
    state.traffic = Object.fromEntries([5, 6, 7].map(x => [String(5 * 16 + x), Array(ROAD_TRAFFIC_THRESHOLD).fill(0)]));
    beginTrafficFrame(state);
    try {
      expect(hasNeighboringRoad(state, 7, 5)).toBe(false); // Populate the frame index.
      entityStore(state).buildings.add(structure('road', 8, 5)); // A merchant uses its own road function.
      expect(hasNeighboringRoad(state, 7, 5, { includeConstruction: false })).toBe(true);
      expect(updateTraffic(state)).toBe(true);
      expect(state.buildings.filter(b => b.kind === 'road').map(b => b.x).sort()).toEqual([5, 6, 7, 8]);
      expect(hasNeighboringRoad(state, 4, 5)).toBe(true);
      expect(recordTraffic(state, unit(5.5, 5.5), { x: 4.5, y: 5.5 })).toBe(false);
    } finally { endTrafficFrame(state); }
  });

  it('invalidates cached junction decisions after live road edits between frames and direct calls', () => {
    const state = fixture();
    const corner = structure('road', 6, 6, 3);
    entityStore(state).buildings.add(structure('road', 5, 6), structure('road', 6, 5, 2), corner);
    beginTrafficFrame(state);
    try { expect(canPlaceRoad(state, 5, 5)).toBe(false); } finally { endTrafficFrame(state); }
    corner.hp = 0;
    beginTrafficFrame(state);
    try { expect(canPlaceRoad(state, 5, 5)).toBe(true); } finally { endTrafficFrame(state); }
    corner.hp = 100;
    expect(canPlaceRoad(state, 5, 5)).toBe(false);
    corner.x = 10;
    expect(canPlaceRoad(state, 5, 5)).toBe(true);
  });

  it('uses cardinal river fords as completed road anchors, but not diagonal fords or other water', () => {
    for (const [x, y] of [[4, 5], [6, 5], [5, 4], [5, 6]]) {
      const state = fixture();
      const tile = state.world.tiles[y * 16 + x];
      Object.assign(tile, { terrain: 'river', overlay: 'ford' });
      expect(hasNeighboringRoad(state, 5, 5)).toBe(true);
      expect(hasNeighboringRoad(state, 5, 5, { includeConstruction: false })).toBe(true);
      tile.overlay = 'none';
      expect(hasNeighboringRoad(state, 5, 5)).toBe(false);
      Object.assign(tile, { terrain: 'lake', overlay: 'ford' });
      expect(hasNeighboringRoad(state, 5, 5)).toBe(false);
    }
    const state = fixture();
    Object.assign(state.world.tiles[6 * 16 + 6], { terrain: 'river', overlay: 'ford' });
    expect(hasNeighboringRoad(state, 5, 5)).toBe(false);
  });

  it('wears a road on an owned ford bank at the usual traffic threshold', () => {
    const state = fixture(), walker = unit(5.5, 5.5);
    Object.assign(state.world.tiles[5 * 16 + 4], { terrain: 'river', overlay: 'ford' });
    for (let i = 0; i < ROAD_TRAFFIC_THRESHOLD; i++) {
      state.time = i;
      expect(recordTraffic(state, walker, { x: 4.5, y: 5.5 })).toBe(i === ROAD_TRAFFIC_THRESHOLD - 1);
    }
    expect(state.buildings.filter(building => building.kind === 'road')).toMatchObject([{ x: 5, y: 5 }]);
    expect(movementMultiplier(state, 4.5, 5.5)).toBe(.45);
    expect(movementMultiplier(state, 5.5, 5.5)).toBe(1.5);
  });

  it('lets mature owned trails extend from a ford but never wears roads beyond borders', () => {
    const owned = fixture();
    Object.assign(owned.world.tiles[5 * 16 + 4], { terrain: 'river', overlay: 'ford' });
    owned.traffic = Object.fromEntries([5, 6, 7].map(x => [String(5 * 16 + x), Array(ROAD_TRAFFIC_THRESHOLD).fill(0)]));
    expect(updateTraffic(owned)).toBe(true);
    expect(owned.buildings.filter(building => building.kind === 'road').map(road => road.x).sort()).toEqual([5, 6, 7]);

    const outside = fixture(), walker = unit(5.5, 5.5);
    outside.factions[0].culture = 0;
    Object.assign(outside.world.tiles[5 * 16 + 4], { terrain: 'river', overlay: 'ford' });
    expect(hasNeighboringRoad(outside, 5, 5)).toBe(true);
    for (let i = 0; i < ROAD_TRAFFIC_THRESHOLD; i++) expect(recordTraffic(outside, walker, { x: 4.5, y: 5.5 })).toBe(false);
    // A trail prepared before the border receded cannot mature there either.
    outside.traffic = { '85': Array(ROAD_TRAFFIC_THRESHOLD).fill(0) };
    expect(updateTraffic(outside)).toBe(false);
    expect(outside.buildings.some(building => building.kind === 'road')).toBe(false);
  });

  it('counts tile entries, ignores idle time, and forms a public usable road at the threshold', () => {
    const state = fixture(), walker = unit(5.5, 5.5); entityStore(state).units.add(walker);
    entityStore(state).buildings.add(structure('road', 4, 5));
    for (let i = 0; i < 40; i++) expect(recordTraffic(state, walker, walker)).toBe(false);
    expect(state.traffic).toBeUndefined();
    for (let i = 0; i < ROAD_TRAFFIC_THRESHOLD; i++) {
      state.time = i; expect(recordTraffic(state, walker, { x: 4.5, y: 5.5 })).toBe(i === ROAD_TRAFFIC_THRESHOLD - 1);
    }
    expect(state.buildings.filter(b => b.kind === 'road')).toHaveLength(2); expect(state.buildings.at(-1)!.construction).toBeUndefined();
    expect(movementMultiplier(state, 5.5, 5.5)).toBe(1.5);
    expect(recordTraffic(state, walker, { x: 4.5, y: 5.5 })).toBe(false);
  });
  it('never seeds roads from isolated traffic, diagonal roads, or a palace', () => {
    const state = fixture(), walker = unit(5.5, 5.5);
    entityStore(state).buildings.add(structure('palace', 3, 4), structure('road', 6, 6, 2));
    for (let i = 0; i < ROAD_TRAFFIC_THRESHOLD + 10; i++) expect(recordTraffic(state, walker, { x: 5.5, y: 4.5 })).toBe(false);
    expect(hasNeighboringRoad(state, 5, 5)).toBe(false);
    expect(canPlaceRoad(state, 5, 5)).toBe(false);
    expect(updateTraffic(state)).toBe(false);
    expect(state.buildings.filter(b => b.kind === 'road')).toHaveLength(1);
  });
  it('extends previously worn trails from either end once a completed road reaches them', () => {
    const state = fixture();
    for (const x of [5, 6, 7]) state.traffic = { ...state.traffic, [5 * 16 + x]: Array(ROAD_TRAFFIC_THRESHOLD).fill(0) };
    const road = structure('road', 8, 5); entityStore(state).buildings.add(road);
    startConstruction(road, 0);
    expect(hasNeighboringRoad(state, 7, 5)).toBe(true);
    expect(hasNeighboringRoad(state, 7, 5, { includeConstruction: false })).toBe(false);
    expect(updateTraffic(state)).toBe(false);
    state.time = 3; updateConstruction(state);
    expect(updateTraffic(state)).toBe(true);
    expect(state.buildings.filter(b => b.kind === 'road').map(b => b.x).sort()).toEqual([5, 6, 7, 8]);
    expect(state.traffic).toEqual({});
  });
  it('expires old traversals and preserves the remaining rolling history through saves', () => {
    let state = fixture(); const walker = unit(5.5, 5.5);
    for (let i = 0; i < ROAD_TRAFFIC_THRESHOLD - 1; i++) { state.time = i; recordTraffic(state, walker, { x: 4.5, y: 5.5 }); }
    state = JSON.parse(JSON.stringify(state));
    state.time += ROAD_TRAFFIC_WINDOW + 1; updateTraffic(state);
    expect(Object.keys(state.traffic!)).toHaveLength(0);
    expect(recordTraffic(state, walker, { x: 4.5, y: 5.5 })).toBe(false);
    expect(state.traffic!['85']).toEqual([state.time]);
  });
  it('does not replace vegetation or river fords', () => {
    for (const patch of [{ overlay: 'forest' }, { overlay: 'jungle' }, { overlay: 'swamp' }, { overlay: 'ford', terrain: 'river' }] as const) {
      const state = fixture(), walker = unit(5.5, 5.5); Object.assign(state.world.tiles[85], patch);
      for (let i = 0; i < 20; i++) recordTraffic(state, walker, { x: 4.5, y: 5.5 });
      expect(state.buildings.filter(b => b.kind === 'road')).toHaveLength(0);
    }
  });
  it.each([false, true])('relocates farms when traffic creates roads and retains ditches, cached: %s', cached => {
    const state = fixture(), walker = unit(5.5, 5.5), farm = structure('camp', 5, 5, 2), ditch = structure('irrigation', 5, 5, 3);
    entityStore(state).buildings.add(structure('road', 4, 5), farm, ditch);
    synchronizeFarms(state);
    if (cached) beginTrafficFrame(state);
    try {
      for (let i = 0; i < ROAD_TRAFFIC_THRESHOLD; i++) {
        state.time = i;
        expect(recordTraffic(state, walker, { x: 4.5, y: 5.5 })).toBe(i === ROAD_TRAFFIC_THRESHOLD - 1);
      }
      expect(state.buildings).toContain(farm); expect(state.buildings).toContain(ditch);
      expect(state.world.tiles[85].farm).toBeUndefined();
      expect({ x: farm.x, y: farm.y }).not.toEqual({ x: 5, y: 5 });
      expect(movementMultiplier(state, 5.5, 5.5)).toBe(1.5);
    } finally { if (cached) endTrafficFrame(state); }
  });
  it('keeps lines and junctions while rejecting all four orientations of a 2×2 block', () => {
    for (const [x, y] of [[5, 5], [6, 5], [5, 6], [6, 6]]) {
      const state = fixture(); let id = 0;
      for (const [rx, ry] of [[5, 5], [6, 5], [5, 6], [6, 6]]) if (rx !== x || ry !== y) entityStore(state).buildings.add(structure('road', rx, ry, ++id));
      expect(canPlaceRoad(state, x, y)).toBe(false);
    }
    const state = fixture(); entityStore(state).buildings.add(structure('road', 5, 4), structure('road', 5, 6, 2), structure('road', 4, 5, 3), structure('road', 6, 5, 4));
    expect(canPlaceRoad(state, 5, 5)).toBe(true);
  });
});
