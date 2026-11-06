import { describe, expect, it } from 'vitest';
import { ensureBuilders, updateBuilder } from '../src/game/builders';
import { canMove, canWalk, findPath } from '../src/game/pathfinding';
import { HIDDEN_MARAUDER_UPDATE_DIVISOR } from '../src/game/marauder-schedule';
import { updateGame } from '../src/game/simulation';
import { queueConstruction, updateConstruction } from '../src/game/structures';
import type { Building, GameState, Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
function person(id: number, x: number, y: number, faction = 0): Unit {
  return { id, kind: faction === 0 ? 'leader' : 'warrior', x, y, faction, hp: 100, maxHp: 100, morale: 100,
    attack: faction === 0 ? 0 : 25, defense: 0, speed: 0, range: 1.1, order: 'wander', cooldown: 0,
    lastCombat: -60, moving: false, facing: 0, attackTime: 0, marauderPack: faction === 0 ? undefined : 1 };
}
function fixture(): { state: GameState; site: Building; enemy: Unit } {
  const site: Building = { id: 2, kind: 'house', faction: 0, x: 15, y: 11, hp: 160, maxHp: 160, capacity: 4 };
  queueConstruction(site, 0);
  const enemy = person(4, 14.5, 11.5, -2);
  const state: GameState = { world: { width: 32, height: 24, seed: 'inactive-sites', source: 'test', spawns: [],
    tiles: Array.from({ length: 768 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .6, food: 3, production: 0, gold: 1, variation: .5 })) },
    units: [person(3, 3.5, 3.5), enemy], buildings: [{ id: 1, kind: 'palace', faction: 0, x: 2, y: 10, hp: 650, maxHp: 650, capacity: 0 }, site],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 500, production: 0,
      population: 5, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1000, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null, buildMode: null,
    diplomacy: null, gameOver: false, victory: false, seed: 'inactive-sites', rngState: 1, fields: [], raiderCamps: [],
    marauderPacks: [{ id: 1, name: 'Test', color: '#111', targetFaction: 0, home: { x: 20.5, y: 11.5 }, waypoint: { x: 14.5, y: 11.5 }, nextWanderAt: 1000 }],
    fogRaids: { nextAt: 1000, waves: 0, pressureVersion: 2 } };
  return { state, site, enemy };
}
function shot(state: GameState, target: Building): void {
  state.projectiles = [{ x: 17, y: 11, start: { x: 17, y: 11 }, end: { x: 15.5, y: 11.5 },
    attacker: 999, target: target.id, faction: -2, damage: 20, elapsed: 0, duration: .1 }];
}

describe('queued and paused sites as open ground', () => {
  it('does not divert paths, attract attacks, or take stale projectile damage before work begins', () => {
    const { state, site, enemy } = fixture(), from = { x: 14.5, y: 11.5 }, to = { x: 16.5, y: 11.5 };
    expect(canMove(state, from, to, 0)).toBe(true);
    expect(findPath(state, from, to, 0)).toContainEqual({ x: 15.5, y: 11.5 });
    enemy.target = site.id; shot(state, site);
    updateGame(state, .3, idle);
    expect(site.hp).toBe(160); expect(site.lastAttacked).toBeUndefined();
    // Projectile/contact guards apply immediately; a hidden marauder clears
    // its stale objective on its staggered sensing turn, within five steps.
    for (let step = 1; step < HIDDEN_MARAUDER_UPDATE_DIVISOR; step++) updateGame(state, .05, idle);
    expect(enemy.target).not.toBe(site.id);
    expect(site.hp).toBe(160); expect(site.lastAttacked).toBeUndefined();
    expect(site.construction!.waitingForBuilder).toBe(true);
  });

  it('becomes solid and damageable only while worked, then reopens if its builder is lost', () => {
    const { state, site, enemy } = fixture(); enemy.attack = 0;
    ensureBuilders(state);
    const worker = state.units.find(unit => unit.builder)!;
    Object.assign(worker, { x: 15.5, y: 10.5, inside: false, buildSite: site.id, buildPhase: 'outbound' });
    site.construction!.builderId = worker.id;
    updateBuilder(state, worker, .1, () => { throw new Error('Already at the site.'); });
    expect(canWalk(state, 15, 11, 0)).toBe(false);
    shot(state, site); updateGame(state, .1, idle);
    expect(site.hp).toBe(140); expect(site.lastAttacked).toBeCloseTo(.1);
    worker.hp = 0; updateConstruction(state);
    expect(site.construction!.waitingForBuilder).toBe(true);
    expect(canWalk(state, 15, 11, 0)).toBe(true);
    shot(state, site); updateGame(state, .1, idle);
    expect(site.hp).toBe(140);
  });
});
