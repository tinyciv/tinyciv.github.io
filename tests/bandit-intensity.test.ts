import { describe, expect, it } from 'vitest';
import { banditIntensity, banditPopulationCap, banditSpawnDelay, normalizeBanditIntensity, setBanditIntensity } from '../src/game/bandit-intensity';
import { entityStore } from '../src/game/entity-store';
import { initializeFogRaids, updateFogRaids } from '../src/game/fog-raids';
import { parseGameSave, serializeGameSave } from '../src/game/game-save';
import { defendRaiderCamp, initializeRaiderSkirmishes, updateRaiderActivity } from '../src/game/raider-activity';
import { MAX_LIVE_RAIDERS, MAX_LIVE_RAIDERS_PER_CAMP, raiderCampWarning, updateRaiderCamps } from '../src/game/raider-camps';
import { raiderWaveInterval } from '../src/game/raider-pressure';
import { initializeRoamingMarauders, roamingPackTarget } from '../src/game/roaming-marauders';
import { createGame } from '../src/game/simulation';
import type { GameState, Unit } from '../src/game/types';

const person = (id: number, faction = -2): Unit => ({ id, x: 8.5, y: 20.5, faction, kind: 'warrior', hp: 100, maxHp: 100,
  attack: 0, defense: 0, morale: 100, speed: 2.35, range: 1.1, order: 'hold', cooldown: 0, lastCombat: -60, lastDamagedAt: -60, facing: 0, moving: false, attackTime: 0 });
function fixture(intensity = 1): GameState {
  const state: GameState = { world: { seed: 'bandit-intensity', source: 'test', width: 64, height: 40, spawns: [], tiles: Array.from({ length: 2560 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .5, food: 1, production: 0, gold: 0, variation: .5 })) },
    units: [{ ...person(1, 0), kind: 'leader', speed: 0 }],
    buildings: [{ id: 2, kind: 'palace', x: 7, y: 17, faction: 0, hp: 10000, maxHp: 10000, capacity: 0 },
      { id: 3, kind: 'villageTent', x: 38, y: 18, faction: -2, hp: 200, maxHp: 200, capacity: 0, raiderCamp: 1 },
      { id: 5, kind: 'woodenTower', x: 40, y: 17, faction: -2, hp: 600, maxHp: 600, capacity: 0, raiderCamp: 1 }],
    factions: [{ id: 0, name: 'Test', color: '#f00', affinity: 100, relation: 'self', food: 0, gold: 0, production: 0, population: 0,
      yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1e9, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, seed: 'bandit-intensity', rngState: 1, events: [], particles: [], fields: [], projectiles: [], selected: null,
    selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false, marauderPacks: [],
    raiderCamps: [{ id: 1, size: 'small', x: 36, y: 16, width: 7, height: 7, gate: { x: 36, y: 19 }, houses: [3], coreTowers: [5], tentCapacity: 1, name: 'Camp', waves: 0, nextRaidAt: 60 }],
    fogRaids: { nextAt: 60, waves: 0, pressureVersion: 2 } };
  setBanditIntensity(state, intensity); return state;
}
const raiders = (state: GameState): Unit[] => state.units.filter(unit => unit.faction === -2 && unit.hp > 0);

describe('Bandit intensity', () => {
  it('defaults to normal, clamps finite settings and scales population caps and intervals', () => {
    expect(banditIntensity({})).toBe(1);
    expect([undefined, NaN, Infinity, '2'].map(normalizeBanditIntensity)).toEqual([1, 1, 1, 1]);
    expect([-2, 0, .5, 1, 2, 4].map(normalizeBanditIntensity)).toEqual([0, 0, .5, 1, 2, 3]);
    for (const intensity of [0, .5, 1, 2, 3]) {
      const state = fixture(intensity);
      expect(banditPopulationCap(state, MAX_LIVE_RAIDERS)).toBe(240 * intensity);
      expect(banditPopulationCap(state, MAX_LIVE_RAIDERS_PER_CAMP)).toBe(90 * intensity);
      expect(roamingPackTarget(state)).toBe(2 * intensity);
      if (intensity) expect(banditSpawnDelay(state, 26)).toBe(26 / intensity);
    }
  });

  it.each([.5, 1, 2])('scales scheduled wave frequency at %s× without multiplying wave size or stats', intensity => {
    const state = fixture(intensity);
    state.time = 60; state.raiderCamps![0].nextRaidAt = 60; state.fogRaids!.nextAt = 60;
    updateFogRaids(state);
    expect(state.fogRaids!.waves).toBe(1);
    expect(raiders(state)).toHaveLength(4);
    expect(state.raiderCamps![0].nextRaidAt).toBeCloseTo(60 + raiderWaveInterval(60) / intensity);
    expect(raiders(state).filter(unit => !unit.marauderLeader).every(unit => unit.maxHp === 40 && unit.attack === 6)).toBe(true);
  });

  it.each([.5, 1, 2])('enforces the scaled global cap for wave recruits at %s×', intensity => {
    const state = fixture(intensity), cap = banditPopulationCap(state, MAX_LIVE_RAIDERS);
    entityStore(state).units.add(...Array.from({ length: cap - 2 }, (_, index) => ({ ...person(1000 + index), x: 55.5, y: 32.5 })));
    state.time = 60; state.raiderCamps![0].nextRaidAt = 60; state.fogRaids!.nextAt = 60;
    updateFogRaids(state);
    expect(raiders(state)).toHaveLength(cap);
    expect(state.fogRaids!.waves).toBe(1);
    state.time = state.raiderCamps![0].nextRaidAt; updateFogRaids(state);
    expect(raiders(state)).toHaveLength(cap);
  });

  it.each([.5, 1, 2])('enforces the scaled camp cap for attacked-building defenders at %s×', intensity => {
    const state = fixture(intensity), cap = banditPopulationCap(state, MAX_LIVE_RAIDERS_PER_CAMP);
    state.marauderPacks!.push({ id: 1, name: 'Existing attack', color: '#111', home: { x: 36.5, y: 19.5 }, waypoint: { x: 8.5, y: 20.5 }, targetFaction: 0, nextWanderAt: 0, raid: true, raiderCamp: 1 });
    entityStore(state).units.add(...Array.from({ length: cap - 2 }, (_, index) => ({ ...person(1000 + index), x: 55.5, y: 32.5, marauderPack: 1 })));
    const building = state.buildings[1];
    expect(defendRaiderCamp(state, building, { x: 37.5, y: 18.5, faction: 0 })).toBe(2);
    expect(raiders(state)).toHaveLength(cap);
    expect(state.raiderCamps![0].defenderReadyAt![building.id]).toBe(30 / intensity);
    state.time = 100; expect(defendRaiderCamp(state, building, { x: 37.5, y: 18.5, faction: 0 })).toBe(0);
  });

  it('keeps existing units when a lower cap has already been exceeded', () => {
    const state = fixture(1);
    entityStore(state).units.add(...Array.from({ length: 130 }, (_, index) => ({ ...person(1000 + index), x: 55.5, y: 32.5 })));
    setBanditIntensity(state, .5); state.time = 60;
    updateFogRaids(state);
    expect(raiders(state)).toHaveLength(130);
    expect(state.fogRaids!.waves).toBe(0);
    expect(defendRaiderCamp(state, state.buildings[1], { x: 37.5, y: 18.5, faction: 0 })).toBe(0);
  });

  it.each([.5, 1, 2])('scales recurring small raids at %s×', intensity => {
    const state = fixture(intensity);
    state.raiderSkirmishes = { nextByFaction: { 0: 0 }, wavesByFaction: { 0: 0 } };
    updateRaiderActivity(state);
    expect(state.raiderSkirmishes.wavesByFaction[0]).toBe(1);
    expect(raiders(state)).toHaveLength(1);
    expect(state.raiderSkirmishes.nextByFaction[0]).toBeGreaterThanOrEqual(18 / intensity);
    expect(state.raiderSkirmishes.nextByFaction[0]).toBeLessThanOrEqual(24 / intensity);
  });

  it('zero suppresses opening parties, roamers, waves, skirmishes, siege recruits, camp defenses and replacements', () => {
    const state = fixture(0);
    initializeFogRaids(state); initializeRaiderSkirmishes(state); initializeRoamingMarauders(state);
    expect(raiders(state)).toHaveLength(0);
    expect(state.raiderSkirmishes!.nextByFaction[0]).toBe(18);
    entityStore(state).units.add({ ...person(4), x: 36.5, y: 19.5, marauderPack: 1 });
    state.marauderPacks!.push({ id: 1, name: 'Siege', color: '#111', home: { x: 36.5, y: 19.5 }, waypoint: { x: 8.5, y: 20.5 }, targetFaction: 0, nextWanderAt: 0,
      raid: true, raiderCamp: 1, motivation: 'siege', phase: 'approach', musterTarget: 30, siegeNextReinforceAt: 10 });
    state.time = 65; updateFogRaids(state);
    expect(raiders(state)).toHaveLength(1);
    expect(state.fogRaids!.waves).toBe(0);
    expect(state.raiderSkirmishes!.wavesByFaction[0]).toBe(0);
    expect(raiderCampWarning(state, { ...state.raiderCamps![0], nextRaidAt: 70 })).toBe(false);
    expect(defendRaiderCamp(state, state.buildings[1], { x: 37.5, y: 18.5, faction: 0 })).toBe(0);
    state.buildings[2].hp = 0; updateRaiderCamps(state);
    const count = state.buildings.length; state.time = 500; updateRaiderCamps(state);
    expect(state.buildings).toHaveLength(count);
    expect(state.raiderCamps![0].destroyed).toBe(true);
    setBanditIntensity(state, 1);
    expect(state.raiderSkirmishes!.nextByFaction[0]).toBe(518);
    expect(state.raiderCamps![0].replacementAt).toBe(620);
  });

  it('creates a real zero-intensity game without raiders and resumes new raids after enabling', () => {
    const world = fixture().world;
    world.width = 80; world.height = 72; world.spawns = [{ x: 39, y: 35 }];
    world.tiles = Array.from({ length: 80 * 72 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
      moisture: .5, food: 1, production: 0, gold: 0, variation: .5 }));
    const state = createGame(world, undefined, { banditIntensity: 0 });
    expect(raiders(state)).toHaveLength(0);
    expect(state.raiderCamps!.length).toBeGreaterThan(0);
    state.paused = false; state.time = 1000; updateFogRaids(state);
    expect(raiders(state)).toHaveLength(0);
    setBanditIntensity(state, 1);
    expect(state.raiderCamps![0].nextRaidAt).toBe(1060);
    state.time = 1060; updateFogRaids(state);
    expect(raiders(state).length).toBeGreaterThan(0);
    expect(state.fogRaids!.waves).toBeGreaterThan(0);
    expect(raiders(state).length).toBeLessThanOrEqual(MAX_LIVE_RAIDERS);
  });

  it('retimes every spawn clock proportionally and persists frozen progress through save/reload', () => {
    const state = fixture(); state.time = 100;
    Object.assign(state.raiderCamps![0], { nextRaidAt: 150, replacementAt: 220, defenderReadyAt: { 3: 130 } });
    state.fogRaids!.nextAt = 150; state.raiderCampPopulationRetryAt = 160;
    state.raiderSkirmishes = { nextByFaction: { 0: 140 }, wavesByFaction: { 0: 3 } };
    state.marauderPacks!.push({ id: 1, name: 'Siege', color: '#111', home: { x: 36.5, y: 19.5 }, waypoint: { x: 8.5, y: 20.5 }, targetFaction: 0, nextWanderAt: 0, siegeNextReinforceAt: 120 });
    setBanditIntensity(state, 2);
    expect(state.raiderCamps![0]).toMatchObject({ nextRaidAt: 125, replacementAt: 160, defenderReadyAt: { 3: 115 } });
    expect(state.fogRaids!.nextAt).toBe(125); expect(state.raiderCampPopulationRetryAt).toBe(130);
    expect(state.raiderSkirmishes.nextByFaction[0]).toBe(120); expect(state.marauderPacks![0].siegeNextReinforceAt).toBe(110);
    state.time = 110; setBanditIntensity(state, 0); state.time = 1110;
    const restored = parseGameSave(serializeGameSave(state));
    expect(restored.banditIntensity).toBe(0); expect(restored.banditSpawnPause).toEqual({ at: 110, intensity: 2 });
    setBanditIntensity(restored, .5);
    expect(restored.raiderCamps![0]).toMatchObject({ nextRaidAt: 1170, replacementAt: 1310, defenderReadyAt: { 3: 1130 } });
    expect(restored.fogRaids!.nextAt).toBe(1170); expect(restored.raiderCampPopulationRetryAt).toBe(1190);
    expect(restored.raiderSkirmishes!.nextByFaction[0]).toBe(1150); expect(restored.marauderPacks![0].siegeNextReinforceAt).toBe(1110);
    expect(restored.banditSpawnPause).toBeUndefined();
    expect(parseGameSave(serializeGameSave(restored)).banditIntensity).toBe(.5);
  });
});
