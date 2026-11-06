import { afterEach, describe, expect, it, vi } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import * as fog from '../src/game/fog';
import * as navigation from '../src/game/pathfinding';
import * as motivation from '../src/game/raider-motivations';
import { beginMarauderFrame, marauderPackUpdateDue, marauderUpdateElapsed } from '../src/game/marauder-schedule';
import { movementProfile, setMovementProfiling } from '../src/game/movement-profile';
import { moveUnit, updateGame } from '../src/game/simulation';
import { beginUnitFrame, endUnitFrame } from '../src/game/spatial';
import { type GameState, type MarauderPack, type Unit } from '../src/game/types';
import { scoutRealm } from './helpers/scouts';

const idle = { up: false, down: false, left: false, right: false };
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const state = scoutRealm();
  state.world.width = 96; state.world.height = 48;
  state.world.tiles = Array.from({ length: 96 * 48 }, () => ({ ...state.world.tiles[0] }));
  const leader = { ...state.units[0], x: 3.5, y: 3.5, attack: 0, speed: 0 };
  const raider: Unit = { ...state.units[1], id: 108, faction: -2, x: 32.5, y: 24.5, speed: 2.35,
    order: 'raid', attack: 0, cooldown: 10, attackTime: 3, morale: 50, lastCombat: -60, lastDamagedAt: -60, marauderPack: 7 };
  entityStore(state).units.replace([leader, raider]);
  entityStore(state).buildings.replace([{ id: 100, kind: 'palace', faction: 0, x: 2, y: 2,
    hp: 10000, maxHp: 10000, capacity: 0, governorPermissions: { housing: false, farms: false } }]);
  state.factions[0].population = 0;
  const pack: MarauderPack = { id: 7, name: 'Test', color: '#aaa', home: { x: 32.5, y: 24.5 },
    waypoint: { x: 80.5, y: 24.5 }, targetFaction: 0, nextWanderAt: Infinity, campDefense: true, defenseUntil: Infinity };
  state.marauderPacks = [pack];
  return { state, leader, raider, pack };
}
function stepClock(state: GameState, dt: number): void { state.time += dt; beginMarauderFrame(state); }
function sightFixture(state: GameState, visible: boolean): void {
  const view = fog.updateFog(state);
  vi.spyOn(fog, 'humanVisibilityViews').mockReturnValue([{ ...view, visible: new Uint8Array(view.visible.length).fill(+visible) }]);
}

describe('hidden marauder update schedule', () => {
  it('updates exactly one fifth of a hidden crowd on each step and conserves elapsed time', () => {
    const { state, raider } = fixture();
    const crowd = Array.from({ length: 100 }, (_, i) => ({ ...raider, id: 1000 + i }));
    const counts = crowd.map(() => 0), elapsed = crowd.map(() => 0);
    for (let frame = 0; frame < 100; frame++) {
      stepClock(state, .02);
      let updated = 0;
      crowd.forEach((unit, index) => {
        const dt = marauderUpdateElapsed(state, unit, .02);
        if (dt) { counts[index]++; elapsed[index] += dt; updated++; }
      });
      expect(updated).toBe(20);
    }
    expect(counts.every(count => count === 20)).toBe(true);
    // Revealing all units flushes only their own pending time next step.
    sightFixture(state, true); stepClock(state, .02);
    crowd.forEach((unit, index) => expect(elapsed[index] + marauderUpdateElapsed(state, unit, .02)).toBeCloseTo(2.02, 10));
  });

  it('wakes immediately in actual player sight and never throttles factions or villagers', () => {
    const { state, leader, raider, pack } = fixture();
    stepClock(state, .1);
    expect(marauderUpdateElapsed(state, raider, .1)).toBe(0);
    expect(marauderPackUpdateDue(state, pack, [raider])).toBe(false);
    leader.x = raider.x; leader.y = raider.y + 3;
    stepClock(state, .1);
    expect(marauderUpdateElapsed(state, raider, .1)).toBeCloseTo(.2);
    expect(marauderPackUpdateDue(state, pack, [raider])).toBe(true);
    for (const unit of [{ ...raider, faction: 1 }, { ...raider, faction: 0 }, { ...raider, villageId: 12 }])
      expect(marauderUpdateElapsed(state, unit, .1)).toBe(.1);
  });

  it('uses every human sight context independently of which player is viewing the game', () => {
    const { state, raider, leader } = fixture();
    const guest = { ...leader, id: 999, faction: 1, x: raider.x, y: raider.y + 3 };
    entityStore(state).units.add(guest);
    state.factions.push({ ...state.factions[0], id: 1 });
    state.multiplayer = { humanFactionIds: [0, 1], inputs: { 0: idle, 1: idle }, controls: {
      0: { retinueStance: 'aggressive', movementMode: 'travel' }, 1: { retinueStance: 'aggressive', movementMode: 'travel' },
    }, winner: null };
    expect(fog.entityVisible(state, raider)).toBe(false);
    stepClock(state, .02);
    expect(marauderUpdateElapsed(state, raider, .02)).toBe(.02);
    expect(state.playerFaction ?? 0).toBe(0);
  });

  it('does not accrue inactive camp time or advance while the game is paused', () => {
    const { state, raider } = fixture();
    state.paused = true; updateGame(state, 3, idle);
    expect(state.time).toBe(0);
    state.paused = false;
    stepClock(state, .1); expect(marauderUpdateElapsed(state, raider, .1)).toBe(0);
    for (let i = 0; i < 12; i++) stepClock(state, .1);
    sightFixture(state, true);
    stepClock(state, .1); expect(marauderUpdateElapsed(state, raider, .1)).toBe(.1);
  });

  it('reduces real movement/AI calls fivefold without reducing marching speed or timers', () => {
    const results = [false, true].map(visible => {
      const { state, raider } = fixture(); sightFixture(state, visible);
      setMovementProfiling(state, true);
      const ai = vi.spyOn(motivation, 'updateRaiderMotivation');
      for (let i = 0; i < 100; i++) updateGame(state, .05, idle);
      const result = { x: raider.x, cooldown: raider.cooldown, morale: raider.morale,
        attackTime: raider.attackTime, calls: movementProfile(state)!.calls, ai: ai.mock.calls.filter(([, unit]) => unit === raider).length };
      vi.restoreAllMocks(); return result;
    });
    expect(results[0].calls).toBe(20); expect(results[1].calls).toBe(100);
    expect(results[0].ai).toBe(20); expect(results[1].ai).toBe(100);
    expect(Math.abs(results[0].x - results[1].x)).toBeLessThan(.6);
    expect(results[0].x).toBeGreaterThan(43);
    expect(results[0].cooldown).toBeCloseTo(5, 8);
    expect(results[0].attackTime).toBe(0);
    expect(Math.abs(results[0].morale - results[1].morale)).toBeLessThan(1);
  });

  it.each(['warrior', 'archer'] as const)('keeps %s attacks on their fast cooldown without catch-up damage bursts', kind => {
    const results = [false, true].map(visible => {
      const { state, raider } = fixture(); sightFixture(state, visible);
      Object.assign(raider, { kind, attack: 20, range: kind === 'archer' ? 5 : 1.1, speed: 0, cooldown: 0, morale: 100 });
      const target: Unit = { ...raider, id: 900, faction: 1, marauderPack: undefined, x: raider.x + 1, hp: 10000, maxHp: 10000,
        attack: 0, order: 'hold', cooldown: 1000 };
      state.factions.push({ ...state.factions[0], id: 1, relation: 'peace' });
      entityStore(state).units.add(target);
      const hits: number[] = []; let hp = target.hp;
      for (let i = 0; i < 300; i++) {
        updateGame(state, 1 / 60, idle);
        if (target.hp < hp) hits.push(state.time);
        hp = target.hp;
      }
      vi.restoreAllMocks(); return { hits, damage: 10000 - target.hp };
    });
    expect(results[0].hits.length).toBeGreaterThanOrEqual(5);
    expect(results[0].hits).toHaveLength(results[1].hits.length);
    // The tiny difference comes from the existing continuous equipment ramp:
    // acquisition can occur a few frames later while hidden.
    expect(results[0].damage).toBeCloseTo(results[1].damage, 2);
    for (let i = 1; i < results[0].hits.length; i++) expect(results[0].hits[i] - results[0].hits[i - 1]).toBeCloseTo(.95, 2);
  });

  it('spends coarse movement across cached nodes without repeated path searches or crossing water/walls', () => {
    const { state, raider } = fixture();
    raider.speed = 4;
    for (let y = 0; y < 48; y++) if (y !== 28) state.world.tiles[y * 96 + 36].terrain = 'lake';
    entityStore(state).buildings.add({ id: 800, kind: 'wall', faction: 0, x: 35, y: 25, hp: 10000, maxHp: 10000, capacity: 0 });
    const goal = { x: 42.5, y: 24.5 }, searches = vi.spyOn(navigation, 'findPath');
    let crossed = false;
    for (let i = 0; i < 16; i++) {
      state.time += .5; beginUnitFrame(state); navigation.beginNavigationFrame(state);
      const from = { x: raider.x, y: raider.y }, before = searches.mock.calls.length;
      moveUnit(state, raider, goal, .5);
      expect(navigation.canWalk(state, raider.x, raider.y, -2)).toBe(true);
      if (from.x < 36.5 && raider.x >= 36.5) { crossed = true; expect(raider.y).toBeGreaterThanOrEqual(28); }
      expect(searches.mock.calls.length - before).toBeLessThanOrEqual(1);
      endUnitFrame(state); navigation.endNavigationFrame(state);
    }
    expect(crossed).toBe(true);
    expect(Math.hypot(raider.x - goal.x, raider.y - goal.y)).toBeLessThan(.15);
    expect(searches.mock.calls.length).toBe(1);
  });

  it('approaches a defended line with coarse steps, stops in contact, and never crosses the defender', () => {
    const { state, raider } = fixture(); sightFixture(state, false);
    Object.assign(raider, { attack: 20, cooldown: 0, morale: 100 });
    const target: Unit = { ...raider, id: 900, faction: 1, marauderPack: undefined,
      x: 38.5, hp: 10000, maxHp: 10000, attack: 0, speed: 0, order: 'hold', cooldown: 1000 };
    state.factions.push({ ...state.factions[0], id: 1, relation: 'peace' });
    entityStore(state).units.add(target);
    for (let i = 0; i < 60; i++) {
      updateGame(state, .1, idle);
      expect(raider.x).toBeLessThan(target.x);
      expect(Math.hypot(raider.x - target.x, raider.y - target.y)).toBeGreaterThan(.6);
      expect(navigation.canWalk(state, raider.x, raider.y, -2)).toBe(true);
    }
    expect(target.hp).toBeLessThan(9980);
    expect(Math.hypot(raider.x - target.x, raider.y - target.y)).toBeLessThanOrEqual(raider.range);
  });
});
