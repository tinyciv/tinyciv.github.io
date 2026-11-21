import { describe, expect, it } from 'vitest';
import { beginBattleRout, casualtyPressure, integrateBattleMorale, recordBattleDeath, type BattleMoraleInput } from '../src/game/battle-morale';
import { entityStore } from '../src/game/entity-store';
import { rustEngine } from '../src/game/rust-engine';
import type { GameState, Unit } from '../src/game/types';

function soldier(id: number, faction = 0, x = 10, y = 10): Unit {
  return { id, faction, kind: 'warrior', x, y, hp: 100, maxHp: 100, morale: 100, attack: 0, defense: 4,
    speed: 0, range: 1.1, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 };
}
function fixture(): GameState {
  return { units: [], buildings: [], world: { width: 40, height: 32, seed: 'native-morale', source: 'test', spawns: [],
    tiles: Array.from({ length: 1280 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .5, variation: 0, food: 0, gold: 0, production: 0 })) },
    time: 0, factions: [], casualties: [] } as unknown as GameState;
}
const calm: BattleMoraleInput = { enemies: 0, allies: 1, routingAllies: 0, fightingUntil: -Infinity, shelter: false,
  hostileSide: false, nearLeader: false, collapsing: false, unfavorableExchange: true,
  maximumMorale: 100, defeated: false, leaderFleeing: false };

describe('native casualty resources and morale actors', () => {
  it('preserves hostile callback bucket/insertion order, duplicates, and nearby filtering through memory growth', () => {
    const state = fixture(), observer = soldier(1); entityStore(state).units.add(observer);
    for (const casualty of [soldier(10, 1, 14, 10), soldier(11, 2, 14, 10), soldier(12, 3, 7.9, 10),
      soldier(13, 4, 30, 10), soldier(14, 2, 14, 10), soldier(15)]) recordBattleDeath(state, { ...casualty, hp: 0 });
    const seen: number[] = [];
    const result = casualtyPressure(state, observer, (_faction, other) => {
      seen.push(other); rustEngine.memory.grow(1); return other !== 1;
    });
    expect(seen).toEqual([3, 1, 2, 2]);
    expect(result).toMatchObject({ losses: 1, enemyLosses: 3, recentEnemyKill: true, collapsing: false });
    expect(state.casualties).toHaveLength(6);
  });

  it('rehydrates retained serialized prefix events on rewind without changing the strict expiry boundary', () => {
    const state = fixture(), observer = soldier(1); entityStore(state).units.add(observer);
    state.casualties = [0, 10, 10, 10].map((time, index) => ({ unit: index ? Number.MAX_SAFE_INTEGER - index : -1,
      faction: 0, x: 10, y: 10, time }));
    state.time = 20;
    expect(casualtyPressure(state, observer, () => false).losses).toBe(4);
    state.time = 20.001;
    expect(casualtyPressure(state, observer, () => false).losses).toBe(3);
    expect(state.casualties).toHaveLength(4); // Prefix compaction is amortized.
    state.time = 15;
    expect(casualtyPressure(state, observer, () => false).losses).toBe(4);
    state.time = 30.001;
    expect(casualtyPressure(state, observer, () => false).losses).toBe(0);
    expect(state.casualties).toEqual([]);
  });

  it('integrates elapsed morale identically for coarse and fine steps and observes actor removal/reused IDs', () => {
    const coarse = fixture(), fine = fixture(), first = { ...soldier(Number.MAX_SAFE_INTEGER), morale: 10 }, second = { ...first };
    entityStore(coarse).units.add(first); entityStore(fine).units.add(second);
    coarse.time = .5; integrateBattleMorale(coarse, first, .5, calm);
    for (let step = 1; step <= 20; step++) { fine.time = step * .025; integrateBattleMorale(fine, second, .025, calm); }
    expect(first.morale).toBe(13); expect(second.morale).toBeCloseTo(first.morale, 12);
    entityStore(coarse).units.retain(() => false);
    const replacement = { ...soldier(first.id), morale: 40 }; entityStore(coarse).units.add(replacement);
    coarse.time = .75; integrateBattleMorale(coarse, replacement, .25, calm);
    expect(replacement.morale).toBe(41.5);
    integrateBattleMorale(coarse, replacement, 0, calm); expect(replacement.morale).toBe(41.5);
  });

  it('ends a four-second casualty shock without bypassing the fifteen-second marauder rout deadline', () => {
    const state = fixture(), actor = soldier(1, -2); entityStore(state).units.add(actor);
    actor.target = 9; actor.destination = { x: 20, y: 20 }; actor.path = [{ x: 11, y: 10 }];
    expect(integrateBattleMorale(state, actor, 1.6, { ...calm, collapsing: true })).toBe(true);
    expect(actor).toMatchObject({ morale: 0, order: 'flee', routOrder: 'hold', routed: true, routUntil: 15,
      casualtyShock: { until: 4, routed: true } });
    expect(actor.target).toBeUndefined(); expect(actor.path).toBeUndefined(); expect(actor.destination).toBeUndefined();
    state.time = 1; beginBattleRout(state, actor); expect(actor.routUntil).toBe(15);
    state.time = 4.1; integrateBattleMorale(state, actor, .1, { ...calm, unfavorableExchange: false });
    expect(actor).toMatchObject({ morale: 50, order: 'flee', routUntil: 15, casualtyShock: { until: 4, routed: false } });
    state.time = 15; integrateBattleMorale(state, actor, 0, calm);
    expect(actor.order).toBe('hold'); expect(actor.routed).toBe(false); expect(actor.routUntil).toBeUndefined();
  });

  it('keeps a recovered retinue fleeing with its Leader and prevents defeated factions from rallying', () => {
    for (const defeated of [false, true]) {
      const state = fixture(), actor = { ...soldier(1), morale: 80, order: 'flee' as const, routOrder: 'hold' as const, routed: true };
      entityStore(state).units.add(actor);
      integrateBattleMorale(state, actor, .1, { ...calm, leaderFleeing: !defeated, defeated });
      expect(actor.order).toBe('flee'); expect(actor.routed).toBe(true);
    }
  });
});
