import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { ensureBuilders, updateBuilder } from '../src/game/builders';
import { updateCollector } from '../src/game/farms';
import { moveUnit, updateGame } from '../src/game/simulation';
import { queueConstruction } from '../src/game/structures';
import { beginPeasantFrame, canDispatchPeasant, endPeasantFrame, refreshPeasant } from '../src/game/peasant-capacity';
import type { Building, GameState, Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
function structure(id: number, kind: Building['kind'], x: number, y: number): Building {
  return { id, kind, x, y, faction: 0, hp: 160, maxHp: 160, capacity: 0 };
}
function person(id: number, kind: Unit['kind'], x: number, y: number, faction = 0): Unit {
  return { id, kind, x, y, faction, hp: 100, maxHp: 100, morale: 100, attack: 0, defense: 0, speed: 0,
    range: kind === 'leader' ? 4 : 1.1, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 };
}
function fixture(): GameState {
  return { world: { width: 32, height: 24, seed: 'peasant-jobs', source: 'test', spawns: [],
    tiles: Array.from({ length: 768 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .6, food: 3, production: 0, gold: 1, variation: .5 })) },
    units: [person(50, 'leader', 3.5, 3.5)], buildings: [structure(1, 'palace', 2, 10)],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 500, production: 0,
      population: 2, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1000, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null, buildMode: null,
    diplomacy: null, gameOver: false, victory: false, seed: 'peasant-jobs', rngState: 1, fields: [], marauderPacks: [], raiderCamps: [],
    fogRaids: { nextAt: 1000, waves: 0, pressureVersion: 2 } };
}

describe('shared peasant jobs', () => {
  it('keeps framed dispatch capacity current across same-turn exits, arrivals and deaths', () => {
    const state = fixture(); state.factions[0].population = 1;
    const first = { ...person(60, 'worker', 3, 11), inside: true }, second = { ...person(61, 'worker', 3, 11), inside: true };
    entityStore(state).units.add(first, second);
    beginPeasantFrame(state);
    try {
      expect(canDispatchPeasant(state, first)).toBe(true);
      first.inside = false;
      expect(canDispatchPeasant(state, second)).toBe(false);
      first.hp = 0; // No refresh of the victim is required to free its slot.
      expect(canDispatchPeasant(state, second)).toBe(true);
      first.hp = 100; first.inside = true; second.inside = false;
      expect(canDispatchPeasant(state, first)).toBe(false);
      second.inside = true;
      expect(canDispatchPeasant(state, first)).toBe(true);
    } finally { endPeasantFrame(state); }
  });

  it('updates worker membership and reads population reductions within a dispatch frame', () => {
    const state = fixture(); state.factions[0].population = 1;
    const waiting = { ...person(60, 'worker', 3, 11), inside: true }, other = person(61, 'warrior', 5, 11);
    entityStore(state).units.add(waiting, other);
    beginPeasantFrame(state);
    try {
      expect(canDispatchPeasant(state, waiting)).toBe(true);
      entityStore(state).setUnitRole(other, { kind: 'worker' }); refreshPeasant(state, other);
      expect(canDispatchPeasant(state, waiting)).toBe(false);
      other.faction = 1; refreshPeasant(state, other);
      expect(canDispatchPeasant(state, waiting)).toBe(true);
      state.factions[0].population = 0;
      expect(canDispatchPeasant(state, waiting)).toBe(false);
    } finally { endPeasantFrame(state); }
  });

  it.each([true, false])('limits total couriers plus builders to population regardless of dispatch order (builder first: %s)', builderFirst => {
    const state = fixture(), firstFarm = structure(2, 'camp', 20, 6), secondFarm = structure(3, 'camp', 20, 17);
    entityStore(state).buildings.add(firstFarm, secondFarm);
    const site = structure(4, 'woodenTower', 12, 11); queueConstruction(site, 0); entityStore(state).buildings.add(site);
    ensureBuilders(state);
    const builder = state.units.find(unit => unit.builder)!;
    const couriers = [firstFarm, secondFarm].map((farm, index): Unit => ({ ...person(60 + index, 'worker', 3, 11),
      hp: 50, maxHp: 50, speed: 2.2, order: 'work', collector: true, collectorCamp: farm.id, home: 1, inside: true, collectPhase: 'idle' }));
    entityStore(state).units.add(...couriers);
    state.fields = [firstFarm, secondFarm].map((farm, index) => ({ id: 100 + index, camp: farm.id, faction: 0,
      // Urgent crops bypass departure smoothing so this isolates resident capacity.
      x: farm.x, y: farm.y, planted: true, food: 3, nextHarvest: 1000, expiresAt: .1 }));
    const work = () => updateBuilder(state, builder, .1, moveUnit);
    const gather = () => couriers.filter(courier => state.units.includes(courier)).forEach(courier => updateCollector(state, courier, .1, moveUnit));
    if (builderFirst) { work(); gather(); } else { gather(); work(); }
    const outside = state.units.filter(unit => unit.kind === 'worker' && !unit.inside);
    expect(outside).toHaveLength(2);
    expect(state.units.filter(unit => unit.kind === 'worker' && unit.inside)).toHaveLength(1);
    expect(builder.inside).toBe(!builderFirst);
    // A removed trip frees a shared slot; idle workers claim it on their next sample.
    entityStore(state).units.replace(state.units.filter(unit => unit !== outside.find(unit => unit.collector)));
    work(); gather();
    expect(state.units.filter(unit => unit.kind === 'worker' && !unit.inside)).toHaveLength(1);
    state.time += 2 / 3;
    work(); gather();
    expect(state.units.filter(unit => unit.kind === 'worker' && !unit.inside)).toHaveLength(2);
  });

  it('records actual melee damage and waits five quiet seconds before dispatching a repair', () => {
    const state = fixture(), target = structure(2, 'house', 12, 11);
    state.factions[0].population = 5; entityStore(state).buildings.add(target);
    const enemy = { ...person(70, 'warrior', 13.5, 11.5, -2), attack: 20, order: 'wander' as const, marauderPack: 1 };
    entityStore(state).units.add(enemy);
    state.marauderPacks = [{ id: 1, name: 'Test', color: '#111', targetFaction: 0,
      home: { x: 20.5, y: 11.5 }, waypoint: { x: 13.5, y: 11.5 }, nextWanderAt: 1000 }];
    updateGame(state, .1, idle);
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(target.lastAttacked).toBeCloseTo(.1);
    const damaged = target.hp, worker = state.units.find(unit => unit.builder)!;
    entityStore(state).units.replace(state.units.filter(unit => unit !== enemy));
    updateGame(state, 4.8, idle);
    expect(target.hp).toBe(damaged); expect(worker.repairSite).toBeUndefined();
    updateGame(state, 2, idle);
    expect(worker).toMatchObject({ repairSite: target.id, inside: false, buildPhase: 'outbound' });
    expect(target.hp).toBe(damaged); // Travel is real; dispatch alone does not heal.
  });

  it('records projectile impact time, not the earlier launch time, for repairs', () => {
    const state = fixture(), target = structure(2, 'house', 12, 11);
    entityStore(state).buildings.add(target);
    state.projectiles = [{ x: 15, y: 11, start: { x: 15, y: 11 }, end: { x: 12.5, y: 11.5 },
      attacker: 999, target: target.id, faction: -2, damage: 10, elapsed: 0, duration: .3 }];
    updateGame(state, .1, idle);
    expect(target.lastAttacked).toBeUndefined(); expect(target.hp).toBe(160);
    updateGame(state, .2, idle);
    expect(target.lastAttacked).toBeCloseTo(.3); expect(target.hp).toBe(150);
  });
});
