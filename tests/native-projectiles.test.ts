import { describe, expect, it } from 'vitest';
import { advanceProjectiles, projectileDuration, type ProjectileHooks } from '../src/game/projectile-native';
import { rustEngine } from '../src/game/rust-engine';
import type { Building, GameState, Projectile, Unit } from '../src/game/types';

function soldier(id = 10, faction = 1, x = 10, y = 0): Unit {
  return { id, faction, kind: 'warrior', x, y, hp: 100, maxHp: 100, attack: 0, defense: 4,
    morale: 100, speed: 0, range: 1.1, order: 'hold', cooldown: 0, lastCombat: -60, facing: 0, moving: false, attackTime: 0 };
}
function shot(target = 10, duration = .125, kind?: Projectile['kind']): Projectile {
  return { attacker: 1, faction: 0, target, kind, x: 0, y: 0, start: { x: 0, y: 0 }, end: { x: 10, y: 0 },
    damage: 20, elapsed: 0, duration, leaderXp: 2 };
}
function fixture(projectiles: Projectile[], targets: (Unit | Building)[] = [soldier()]) {
  const state = { units: [], buildings: [], projectiles, world: { width: 32, height: 24, tiles: [], spawns: [], seed: 'native-projectiles', source: 'test' } } as unknown as GameState;
  const contacts: { target: number; straight: boolean }[] = [];
  const impacts: { target: number; before: number; hp: number; dead: boolean; xp?: number }[] = [];
  const hidden = new Set<number>(), protectedCities = new Set<number>();
  const hooks: ProjectileHooks = {
    target: id => targets.find(target => target.id === id && target.hp > 0 && ('capacity' in target || !target.inside)),
    hostile: (a, b) => a !== b,
    huntable: target => target.kind === 'boar',
    observable: target => !hidden.has(target.id),
    protected: target => protectedCities.has(target.id),
    clear: (_projectile, target, straight) => { contacts.push({ target: target.id, straight }); return true; },
    defense: () => 1,
    hit: (projectile, target, before, hp, dead) => {
      impacts.push({ target: target.id, before, hp, dead, xp: projectile.leaderXp }); target.hp = hp;
    },
  };
  return { state, hooks, targets, contacts, impacts, hidden, protectedCities };
}

describe('persistent Bevy projectile lifecycle', () => {
  it('advances fractional time, tracks moving endpoints, and retains object identity until the impact', () => {
    const projectile = shot(), target = soldier(), { state, hooks, impacts } = fixture([projectile], [target]);
    advanceProjectiles(state, .05, hooks);
    expect(state.projectiles).toEqual([projectile]); expect(state.projectiles![0]).toBe(projectile);
    expect(projectile).toMatchObject({ x: 4, y: 0, elapsed: .05, end: { x: 10, y: 0 } });
    target.x = 20;
    advanceProjectiles(state, .05, hooks);
    expect(projectile).toMatchObject({ x: 16, elapsed: .1, end: { x: 20, y: 0 } });
    expect(impacts).toEqual([]);
    advanceProjectiles(state, .025, hooks);
    expect(state.projectiles).toEqual([]); expect(projectile.elapsed).toBe(.125);
    expect(impacts).toEqual([{ target: target.id, before: 100, hp: 80, dead: false, xp: 2 }]);
  });

  it('does not apply a second impact or kill reward after an earlier shot kills the same target', () => {
    const target = soldier(); target.hp = 10;
    const { state, hooks, contacts, impacts } = fixture([shot(10, .01), shot(10, .01)], [target]);
    advanceProjectiles(state, .02, hooks);
    expect(impacts).toEqual([{ target: 10, before: 10, hp: 0, dead: true, xp: 2 }]);
    expect(contacts).toHaveLength(1); expect(state.projectiles).toEqual([]);
  });

  it('refreshes allegiance and protection after each earlier impact before examining the next projectile', () => {
    for (const mutation of ['capture', 'protection']) {
      const first = soldier(10), city: Building = { id: 11, kind: 'palace', faction: 1, x: 12, y: 0, hp: 100, maxHp: 100, capacity: 4 };
      const { state, hooks, contacts, impacts, protectedCities } = fixture([shot(10, .01), shot(11, .01)], [first, city]);
      const hit = hooks.hit;
      hooks.hit = (...args) => {
        hit(...args);
        if (mutation === 'capture') city.faction = 0;
        else protectedCities.add(city.id);
        // Other domain systems can grow memory while processing this impact.
        rustEngine.memory.grow(1);
      };
      advanceProjectiles(state, .02, hooks);
      expect(impacts).toHaveLength(1); expect(contacts).toEqual([{ target: 10, straight: false }]);
      expect(city.hp).toBe(100); expect(state.projectiles).toEqual([]);
    }
  });

  it('allows a later palace impact when the earlier impact removes its final defense', () => {
    const defense: Building = { id: 10, kind: 'woodenTower', faction: 1, x: 10, y: 0, hp: 10, maxHp: 100, capacity: 0 };
    const city: Building = { id: 11, kind: 'palace', faction: 1, x: 12, y: 0, hp: 100, maxHp: 100, capacity: 4 };
    const { state, hooks, impacts, protectedCities } = fixture([shot(10, .01), shot(11, .01)], [defense, city]);
    protectedCities.add(city.id);
    const hit = hooks.hit;
    hooks.hit = (...args) => { hit(...args); if (args[1] === defense && args[4]) protectedCities.delete(city.id); };
    advanceProjectiles(state, .02, hooks);
    expect(impacts.map(impact => impact.target)).toEqual([10, 11]);
    expect(defense.hp).toBe(0); expect(city.hp).toBe(80);
  });

  it('uses straight clearance for arrows, stones and bolts but arced clearance for tower arrows and javelins', () => {
    const projectiles = [shot(10, .01, 'arrow'), shot(10, .01, 'stone'), shot(10, .01, 'ballistaBolt'),
      { ...shot(10, .01, 'arrow'), towerArrow: true }, shot(10, .01, 'javelin')];
    const target = soldier(); target.hp = 1000;
    const { state, hooks, contacts } = fixture(projectiles, [target]);
    advanceProjectiles(state, .02, hooks);
    expect(contacts.map(contact => contact.straight)).toEqual([true, true, true, false, false]);
    expect(target.hp).toBe(900);
  });

  it('keeps launch damage/XP after the attacker is gone and applies live Elite and formation defense', () => {
    const target = soldier(); target.kills = 500;
    const projectile = { ...shot(10, .01), attacker: Number.MAX_SAFE_INTEGER, damage: 100, leaderXp: 2 };
    const { state, hooks, impacts } = fixture([projectile], [target]);
    hooks.defense = () => 2;
    advanceProjectiles(state, .02, hooks);
    expect(target.hp).toBe(92.5); expect(impacts[0].xp).toBe(2);
  });

  it('cancels hidden or sheltered targets, and consumes blocked impacts without damage', () => {
    const hiddenTarget = soldier(10), sheltered = { ...soldier(11), inside: true }, visible = soldier(12);
    const { state, hooks, hidden, impacts, contacts } = fixture([shot(10, .01), shot(11, .01), shot(12, .01)], [hiddenTarget, sheltered, visible]);
    hidden.add(hiddenTarget.id);
    const clear = hooks.clear; hooks.clear = (...args) => { clear(...args); return false; };
    advanceProjectiles(state, .02, hooks);
    expect(contacts).toEqual([{ target: visible.id, straight: false }]); expect(impacts).toEqual([]);
    expect(visible.hp).toBe(100); expect(state.projectiles).toEqual([]);
  });

  it('keeps separate game worlds independent and reloads a replaced projectile view exactly once', () => {
    const first = fixture([shot()]), second = fixture([shot()]);
    advanceProjectiles(first.state, .05, first.hooks);
    expect(second.state.projectiles![0].elapsed).toBe(0);
    first.state.projectiles = structuredClone(first.state.projectiles);
    advanceProjectiles(first.state, .075, first.hooks);
    expect(first.impacts).toHaveLength(1); expect(second.targets[0].hp).toBe(100);
    advanceProjectiles(second.state, .125, second.hooks);
    expect(second.impacts).toHaveLength(1);
    expect(projectileDuration({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5 / 12, 14);
  });
});
