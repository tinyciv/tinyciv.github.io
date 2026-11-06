import { describe, expect, it } from 'vitest';
import { MARAUDER_LEADER_LOSS_MORALE, MARAUDER_LEADER_LOSS_RADIUS, recordBattleDeath } from '../src/game/battle-morale';
import { entityStore } from '../src/game/entity-store';
import { entityVisible } from '../src/game/fog';
import { beginUnitFrame, endUnitFrame } from '../src/game/spatial';
import { updateGame } from '../src/game/simulation';
import type { Building, GameState, Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const unit = (id: number, faction = -2, x = 20.5, y = 12.5): Unit => ({
  id, faction, x, y, kind: 'warrior', hp: 100, maxHp: 100, morale: 100,
  attack: 0, defense: 0, speed: 0, range: 1.1, order: 'hold', cooldown: 0,
  lastCombat: -60, moving: false, facing: 0, attackTime: 0,
});
const building = (id: number, kind: Building['kind'], x: number, y: number): Building => ({
  id, kind, faction: 0, x, y, hp: 650, maxHp: 650, capacity: 0,
});
function fixture(): GameState {
  return {
    world: { width: 40, height: 32, seed: 'leader-morale', source: 'test', spawns: [],
      tiles: Array.from({ length: 40 * 32 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
        moisture: .6, food: 3, production: 1, gold: 0, variation: .5 })) },
    units: [{ ...unit(1, 0, 2.5, 20.5), kind: 'leader', range: 4 }], buildings: [building(2, 'palace', 2, 22)],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 500,
      production: 0, population: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity,
      nextRetinueAt: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'leader-morale', rngState: 1,
    fields: [], marauderPacks: [], raiderCamps: [], fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 1 },
    wildlife: { herds: [], sequence: 0, nextRespawnAt: Infinity, targetHerds: 0 },
  };
}

describe('marauder commander death morale', () => {
  it.each([false, true])('shocks nearby allied soldiers across bands, including the radius boundary, with spatial indexing %s', indexed => {
    const state = fixture(), commander = { ...unit(10), hp: 0, marauderLeader: true, marauderPack: 1 };
    const close = { ...unit(11, -2, 23.5, 16.5), marauderPack: 1 };
    const edge = { ...unit(12, -2, 20.5 + MARAUDER_LEADER_LOSS_RADIUS, 12.5), kind: 'archer' as const, marauderPack: 2 };
    const outside = unit(13, -2, edge.x + .001, edge.y);
    const civilian = { ...unit(14), kind: 'worker' as const }, reserve = { ...unit(15), inside: true };
    const player = unit(16, 0), rival = unit(17, 1), neutral = unit(18, -1), dead = { ...unit(19), hp: 0 };
    entityStore(state).units.add(commander, close, edge, outside, civilian, reserve, player, rival, neutral, dead);
    if (indexed) beginUnitFrame(state);
    try { recordBattleDeath(state, commander); }
    finally { if (indexed) endUnitFrame(state); }
    expect(close.morale).toBe(100 - MARAUDER_LEADER_LOSS_MORALE);
    expect(edge.morale).toBe(60);
    for (const unaffected of [outside, civilian, reserve, player, rival, neutral, dead]) expect(unaffected.morale).toBe(100);
    expect(state.casualties).toHaveLength(1);
  });

  it('works outside player sight, clamps at zero, and never repeats for the same death', () => {
    const state = fixture(), commander = { ...unit(10), marauderLeader: true };
    const survivor = { ...unit(11, -2, 21.5, 12.5), morale: 25, order: 'raid' as const,
      target: 1, destination: { x: 2, y: 20 }, path: [{ x: 19, y: 12 }] };
    entityStore(state).units.add(commander, survivor);
    expect(entityVisible(state, commander)).toBe(false);
    recordBattleDeath(state, commander); expect(survivor.morale).toBe(25); // Still alive.
    commander.hp = 0; recordBattleDeath(state, commander);
    expect(survivor).toMatchObject({ morale: 0, order: 'flee', routOrder: 'raid', routed: true });
    expect(survivor.target).toBeUndefined(); expect(survivor.path).toBeUndefined(); expect(survivor.destination).toBeUndefined();
    updateGame(state, .1, idle);
    expect(survivor.order).toBe('flee'); expect(survivor.morale).toBeLessThan(1);
    survivor.morale = 20; state.time = 1; recordBattleDeath(state, commander);
    expect(survivor.morale).toBe(20); expect(state.casualties).toHaveLength(1);
    recordBattleDeath(state, { ...commander }); // A distinct commander may reuse the numeric ID.
    expect(survivor.morale).toBe(0); expect(state.casualties).toHaveLength(2);
  });

  it('does not add a leader shock for ordinary raiders or other factions', () => {
    const state = fixture(), survivor = unit(11); entityStore(state).units.add(survivor);
    recordBattleDeath(state, { ...unit(10), hp: 0 });
    recordBattleDeath(state, { ...unit(12, 0), hp: 0, marauderLeader: true });
    recordBattleDeath(state, { ...unit(13, 1), kind: 'leader', hp: 0 });
    expect(survivor.morale).toBe(100);
  });

  it.each(['melee', 'javelin', 'arrow', 'tower', 'orphaned projectile'] as const)('applies once through a real %s death and persists through subsequent morale updates', cause => {
    const state = fixture(), commander = { ...unit(10), hp: 1, marauderLeader: true };
    const survivor = unit(11, -2, 26, 12.5), distant = unit(12, -2, 35.5, 12.5);
    commander.marauderPack = 1; survivor.marauderPack = 1;
    state.marauderPacks = [{ id: 1, name: 'Test band', color: '#191b22', targetFaction: 0,
      home: { x: 30.5, y: 12.5 }, waypoint: { x: 3, y: 23 }, nextWanderAt: Infinity,
      raid: true, targetBuilding: 2, leaderId: commander.id, startingTroops: 1 }];
    entityStore(state).units.add(commander, survivor, distant);
    let attacker: Unit | undefined;
    if (cause === 'tower') entityStore(state).buildings.add(building(20, 'woodenTower', 17, 12));
    else if (cause === 'orphaned projectile') state.projectiles = [{ kind: 'arrow', attacker: 999, target: commander.id,
      faction: 0, x: 18.5, y: 12.5, start: { x: 18.5, y: 12.5 }, end: { x: 20.5, y: 12.5 },
      damage: 100, elapsed: 0, duration: .01 }];
    else {
      attacker = { ...unit(20, 0, cause === 'melee' ? 19.5 : 17.5, 12.5), attack: 100,
        kind: cause === 'melee' ? 'warrior' : cause === 'arrow' ? 'archer' : 'leader',
        range: cause === 'melee' ? 1.1 : 4, target: commander.id };
      entityStore(state).units.add(attacker);
    }
    for (let step = 0; step < 10 && commander.hp > 0; step++) updateGame(state, .1, idle);
    expect(commander.hp).toBe(0);
    expect(state.casualties?.filter(event => event.unit === commander.id)).toHaveLength(1);
    expect(survivor.morale).toBeGreaterThanOrEqual(60); expect(survivor.morale).toBeLessThan(62);
    expect(distant.morale).toBe(100);
    if (attacker) attacker.attack = 0;
    const afterDeath = survivor.morale;
    updateGame(state, .5, idle); recordBattleDeath(state, commander);
    expect(state.units).not.toContain(commander);
    expect(survivor.morale).toBeGreaterThanOrEqual(afterDeath);
    expect(survivor.morale).toBeLessThan(70);
    expect(state.casualties?.filter(event => event.unit === commander.id)).toHaveLength(1);
  });
});
