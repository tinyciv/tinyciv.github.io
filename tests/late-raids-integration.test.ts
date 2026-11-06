import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { updateFogRaids } from '../src/game/fog-raids';
import { MAX_LIVE_RAIDERS, MAX_LIVE_RAIDERS_PER_CAMP } from '../src/game/raider-camps';
import { continueAfterVictory, updateGame } from '../src/game/simulation';
import type { GameState, MarauderPack, Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const person = (id: number, x: number, y: number, faction = -2): Unit => ({ id, x, y, faction, kind: 'warrior', hp: 100, maxHp: 100,
  attack: 0, defense: 0, morale: 100, speed: 2.35, range: 1.1, order: 'hold', cooldown: 0, lastCombat: -60,
  lastDamagedAt: -60, facing: 0, moving: false, attackTime: 0 });
function fixture(): GameState {
  // Generated worlds are revisioned; omitting it forces diagnostic full-map
  // terrain fingerprints on every sight query throughout this long simulation.
  return { world: { seed: 'late-raids', source: 'controlled integration', width: 64, height: 40, revision: 1, spawns: [],
    tiles: Array.from({ length: 2560 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
      moisture: .5, food: 1, production: 0, gold: 0, variation: .5 })) },
    units: [{ ...person(1, 8.5, 20.5, 0), kind: 'leader', speed: 0, hp: 1e9, maxHp: 1e9 }],
    buildings: [{ id: 2, kind: 'palace', x: 7, y: 17, faction: 0, hp: 1e9, maxHp: 1e9, capacity: 4,
      populationGrowth: -1e9, governorPermissions: { farms: false, housing: false } },
      { id: 3, kind: 'villageTent', x: 38, y: 18, faction: -2, hp: 200, maxHp: 200, capacity: 0, raiderCamp: 1 },
      { id: 4, kind: 'woodenTower', x: 40, y: 17, faction: -2, hp: 600, maxHp: 600, capacity: 0, raiderCamp: 1 }],
    factions: [{ id: 0, name: 'Roma', color: '#f00', affinity: 100, relation: 'self', food: 10000, gold: 10000,
      production: 0, population: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1e9,
      nextRetinueAt: 1e9, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, seed: 'late-raids', rngState: 1, events: [], particles: [], fields: [],
    projectiles: [], selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false,
    marauderPacks: [], roamingMaraudersVersion: 1,
    raiderCamps: [{ id: 1, size: 'small', x: 36, y: 16, width: 7, height: 7, gate: { x: 36, y: 19 }, houses: [3], coreTowers: [4], tentCapacity: 1,
      name: 'Late camp', waves: 0, nextRaidAt: 60 }],
    fogRaids: { nextAt: 60, waves: 0, pressureVersion: 2 },
    wildlife: { herds: [], sequence: 0, nextRespawnAt: 1e9, targetHerds: 0 } };
}
const livingRaiders = (state: GameState) => state.units.filter(u => u.faction === -2 && u.hp > 0);
function assertCaps(state: GameState): void {
  const living = livingRaiders(state), packs = new Map(state.marauderPacks!.map(p => [p.id, p]));
  expect(living.length).toBeLessThanOrEqual(MAX_LIVE_RAIDERS);
  for (const camp of state.raiderCamps!)
    expect(living.filter(u => packs.get(u.marauderPack ?? -1)?.raiderCamp === camp.id).length).toBeLessThanOrEqual(MAX_LIVE_RAIDERS_PER_CAMP);
}

describe('late raids remain live without increasing saturation limits', () => {
  it('runs both raid clocks for ten more game minutes after Keep playing, including a save round trip', () => {
    let state = fixture(); state.time = 1200;
    state.raiderCamps![0].nextRaidAt = 1200; state.fogRaids!.nextAt = 1200;
    state.raiderSkirmishes = { nextByFaction: { 0: 1200 }, wavesByFaction: { 0: 0 } };
    state.gameOver = true; state.victory = true; state.paused = true;
    updateGame(state, 1, idle);
    expect(state.time).toBe(1200); expect(state.fogRaids!.waves).toBe(0);
    expect(continueAfterVictory(state)).toBe(true);
    const observations: { time: number; large: number; small: number }[] = [];
    for (let period = 0; period < 20; period++) {
      for (let second = 0; second < 30; second++) { updateGame(state, 1, idle); assertCaps(state); }
      observations.push({ time: state.time, large: state.fogRaids!.waves, small: state.raiderSkirmishes!.wavesByFaction[0] });
      // Controlled battle losses free population capacity; neither scheduler
      // is reset, forced due, or invoked outside the real updateGame pipeline.
      for (const unit of livingRaiders(state)) unit.hp = 0;
      if (period === 9) state = JSON.parse(JSON.stringify(state)) as GameState;
    }
    expect(state.time).toBeCloseTo(1800);
    expect(state).toMatchObject({ victory: true, victoryContinued: true, gameOver: false, paused: false });
    expect(observations.at(-1)!.large).toBeGreaterThan(15);
    expect(observations.at(-1)!.small).toBeGreaterThan(15);
    for (let i = 2; i < observations.length; i += 2) {
      expect(observations[i].large).toBeGreaterThan(observations[i - 2].large);
      expect(observations[i].small).toBeGreaterThan(observations[i - 2].small);
    }
  }, 15000);

  it('recycles eight stalled reinforcement waves at the full global cap for twenty more minutes without new bodies', () => {
    const state = fixture(); state.time = 3600; state.raiderCamps![0].nextRaidAt = 3600; state.fogRaids!.nextAt = 3600;
    const old: MarauderPack[] = [];
    for (let i = 0; i < 8; i++) {
      const pack: MarauderPack = { id: 10 + i, name: 'Stalled siege', color: '#111', home: { x: 36.5, y: 19.5 },
        waypoint: { x: 8.5, y: 18.5 }, targetFaction: 0, targetBuilding: 2, nextWanderAt: 1e9, raid: true,
        returning: false, raiderCamp: 1, motivation: 'siege', phase: 'approach', musterTarget: 30,
        siegeNextReinforceAt: 3595, spawnedAt: 3500 + i, lastProgressAt: 3560,
        progressPosition: { x: 37.5, y: 19.5 } };
      old.push(pack); state.marauderPacks!.push(pack);
      entityStore(state).units.add(...Array.from({ length: 10 }, (_, j) => ({ ...person(100 + i * 10 + j, 37.5, 19.5),
        marauderPack: pack.id, kills: 35 })));
    }
    entityStore(state).units.add(...Array.from({ length: MAX_LIVE_RAIDERS - 80 }, (_, i) => person(1000 + i, 55.5, 32.5)));
    const originalIds = new Set(livingRaiders(state).map(u => u.id));
    expect(new Set(state.marauderPacks!.map(p => `${p.raiderCamp}:${p.spawnedAt}`)).size).toBe(8);
    updateFogRaids(state);
    expect(old.every(p => p.returning && p.siegeNextReinforceAt === undefined)).toBe(true);
    expect(state.fogRaids!.waves).toBe(1);
    for (let period = 0; period < 40; period++) {
      state.time += 31; updateFogRaids(state);
      assertCaps(state);
      expect(livingRaiders(state)).toHaveLength(MAX_LIVE_RAIDERS);
      expect(livingRaiders(state).every(u => originalIds.has(u.id))).toBe(true);
      expect(livingRaiders(state).filter(u => u.kills === 35)).toHaveLength(80);
    }
    expect(state.fogRaids!.waves).toBeGreaterThan(15);
  });
});
