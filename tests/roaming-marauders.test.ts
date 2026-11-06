import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { initializeRoamingMarauders, roamingPackTarget } from '../src/game/roaming-marauders';
import { defendRaiderCamp, updateRaiderActivity } from '../src/game/raider-activity';
import { MAX_LIVE_RAIDERS } from '../src/game/raider-camps';
import { createGame, updateGame } from '../src/game/simulation';
import { generateWorld } from '../src/world/generator';
import type { GameState, Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
function fixture(): GameState {
  const person: Unit = { id: 1, x: 6.5, y: 12.5, faction: 0, kind: 'leader', hp: 100, attack: 0, defense: 0,
    morale: 100, speed: 0, range: 1.1, order: 'hold', cooldown: 0, lastCombat: -60, lastDamagedAt: -60, moving: false, facing: 0, attackTime: 0 };
  return { world: { seed: 'sleeping-reserves', source: 'test', width: 60, height: 32, spawns: [], tiles: Array.from({ length: 1920 }, () =>
    ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .5, food: 1, production: 0, gold: 0, variation: .5 })) },
    units: [person], buildings: [{ id: 2, kind: 'palace', x: 5, y: 10, faction: 0, hp: 10000, maxHp: 10000, capacity: 0 },
      { id: 3, kind: 'villageTent', x: 40, y: 12, faction: -2, hp: 200, maxHp: 200, capacity: 0, raiderCamp: 1 },
      { id: 4, kind: 'woodenTower', x: 44, y: 12, faction: -2, hp: 200, maxHp: 200, capacity: 0, raiderCamp: 1 }],
    factions: [{ id: 0, name: 'Test', color: '#f00', affinity: 100, relation: 'self', food: 0, gold: 0, production: 0, population: 0,
      yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1e9, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, seed: 'sleeping-reserves', rngState: 1, events: [], particles: [], fields: [], projectiles: [], selected: null,
    selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false, marauderPacks: [],
    raiderCamps: [{ id: 1, size: 'small', x: 38, y: 10, width: 9, height: 7, gate: { x: 38, y: 13 }, houses: [3], coreTowers: [4], name: 'Camp', waves: 0, nextRaidAt: 1e9 }],
    fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 2 }, raiderSkirmishes: { nextByFaction: { 0: 1e9 }, wavesByFaction: { 0: 0 } } };
}
const sleepers = (state: GameState) => state.units.filter(unit => unit.faction === -2 && unit.inside);

describe('camp reserves instead of wilderness milling', () => {
  it('starts extra bands asleep in actual tents, with zero active pathing bodies', () => {
    const state = fixture(), originalRng = state.rngState, clocks = structuredClone([state.fogRaids, state.raiderCamps]);
    const clone = structuredClone(state);
    initializeRoamingMarauders(state); initializeRoamingMarauders(clone);
    expect([state.units, state.marauderPacks]).toEqual([clone.units, clone.marauderPacks]);
    expect(state.marauderPacks).toHaveLength(roamingPackTarget(state));
    expect(sleepers(state).length).toBeGreaterThanOrEqual(4);
    expect(state.units.filter(unit => unit.faction === -2 && !unit.inside)).toHaveLength(0);
    expect(entityStore(state).units.query('active').filter(unit => unit.faction === -2)).toHaveLength(0);
    for (const unit of sleepers(state)) expect(unit).toMatchObject({ x: 40.5, y: 12.5, raiderGarrison: 3, order: 'hold' });
    expect(state.rngState).toBe(originalRng); expect([state.fogRaids, state.raiderCamps]).toEqual(clocks);
    const snapshots = structuredClone(sleepers(state));
    for (let step = 0; step < 120; step++) updateGame(state, .1, idle);
    expect(sleepers(state).map(unit => [unit.id, unit.x, unit.y])).toEqual(snapshots.map(unit => [unit.id, unit.x, unit.y]));
    expect(sleepers(state).every(unit => !unit.path?.length && !unit.moving)).toBe(true);
    expect(entityStore(state).units.query('active').filter(unit => unit.faction === -2)).toHaveLength(0);
  });

  it('reuses tent occupants as defenders without replacing wounds or experience', () => {
    const state = fixture(); initializeRoamingMarauders(state);
    const reserves = sleepers(state); for (const unit of reserves) { unit.hp *= .8; unit.kills = 12; }
    const ids = new Set(reserves.map(unit => unit.id));
    const responding = defendRaiderCamp(state, state.buildings[1], { x: 39.5, y: 12.5, faction: 0 });
    expect(responding).toBeGreaterThanOrEqual(2); expect(responding).toBeLessThanOrEqual(5);
    const active = state.units.filter(unit => unit.faction === -2 && !unit.inside);
    expect(active.some(unit => ids.has(unit.id))).toBe(true);
    for (const unit of active.filter(unit => ids.has(unit.id))) {
      expect(unit.kills).toBe(12); expect(unit.hp / unit.maxHp!).toBeCloseTo(.8);
      expect(entityStore(state).units.query('active')).toContain(unit);
    }
  });

  it('bounds sleepers under the same global cap and initializes them only once', () => {
    const state = fixture(), source = state.units[0];
    entityStore(state).units.add(...Array.from({ length: MAX_LIVE_RAIDERS - 2 }, (_, i) => ({ ...source, id: 100 + i, faction: -2, kind: 'warrior' as const })));
    initializeRoamingMarauders(state);
    expect(state.units.filter(unit => unit.faction === -2)).toHaveLength(MAX_LIVE_RAIDERS);
    expect(sleepers(state)).toHaveLength(2);
    const first = sleepers(state)[0]; first.hp = 0;
    initializeRoamingMarauders(state);
    expect(sleepers(state)).toHaveLength(2); expect(first.hp).toBe(0);
  });

  it('assigns existing unsheltered bands a real attack immediately, with no patrol grace period', () => {
    const state = fixture(); state.roamingMaraudersVersion = 1;
    const pack = { id: 10, name: 'Band', color: '#000', targetFaction: 0, home: { x: 25.5, y: 12.5 },
      waypoint: { x: 25.5, y: 12.5 }, nextWanderAt: 0, spawnedAt: 0 };
    state.marauderPacks!.push(pack);
    entityStore(state).units.add({ ...state.units[0], id: 11, x: 25.5, y: 12.5, faction: -2, kind: 'warrior', marauderPack: 10, order: 'wander', speed: 2.35 });
    updateRaiderActivity(state);
    expect(pack).toMatchObject({ raid: true, targetBuilding: 2, targetFaction: 0, motivation: 'assault' });
    expect(state.units.at(-1)!.order).toBe('raid');
  });

  it('does not manufacture unsheltered idle packs when no camp exists', () => {
    const state = fixture(); state.raiderCamps = [];
    initializeRoamingMarauders(state);
    expect(state.units.filter(unit => unit.faction === -2)).toHaveLength(0);
  });

  it('keeps real opening attacks while every other starting marauder sleeps in a camp', () => {
    const state = createGame(generateWorld('willow-raid'));
    const raiders = state.units.filter(unit => unit.faction === -2);
    expect(sleepers(state).length).toBeGreaterThan(0);
    for (const unit of raiders.filter(unit => !unit.inside)) {
      const pack = state.marauderPacks!.find(pack => pack.id === unit.marauderPack)!;
      expect(pack.microRaid).toBe(true); expect(pack.raid).toBe(true); expect(pack.targetBuilding).toBeDefined();
      expect(unit.order).toBe('raid');
    }
    expect(raiders.length).toBeLessThanOrEqual(MAX_LIVE_RAIDERS);
  }, 120_000);
});
