import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { palaceEnclosures } from '../src/game/enclosures';
import { insideOwnBorders } from '../src/game/borders';
import { isForbidden, setForbiddenRectangle } from '../src/game/forbidden-zones';
import { canWalk, findPath } from '../src/game/pathfinding';
import { militiaCityContains, militiaMovementLimits, setGuardPostWallsOnly, updateGuardPosts } from '../src/game/guard-posts';
import { updateGame } from '../src/game/simulation';
import type { Building, GameState, Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const building = (id: number, kind: Building['kind'], x: number, y: number): Building =>
  ({ id, kind, x, y, faction: 0, hp: 350, maxHp: 350, capacity: 0 });
const person = (id: number, x: number, y: number, faction = -2, kind: Unit['kind'] = 'warrior'): Unit =>
  ({ id, kind, x, y, faction, hp: 10000, maxHp: 10000, morale: 100, attack: 0, defense: 0, speed: 0,
    range: 1.1, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 });
function fixture(): GameState {
  return {
    world: { width: 40, height: 28, seed: 'walls-only', source: 'test', spawns: [],
      tiles: Array.from({ length: 40 * 28 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [{ ...building(1, 'palace', 8, 10), populationGrowth: -10000, unhousedResidents: 10,
      governorPermissions: { farms: false, housing: false } }, building(2, 'guardPost', 11, 12)],
    units: [person(10, 11.5, 14.5, 0, 'leader')],
    factions: [{ id: 0, name: 'Roma', color: '#f34f59', affinity: 100, relation: 'self', food: 500, gold: 500,
      production: 0, population: 10, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity,
      nextRetinueAt: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'walls-only', rngState: 1,
    marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1,
    fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 1 },
    wildlife: { herds: [], sequence: 0, nextRespawnAt: Infinity, targetHerds: 0 },
  };
}
function ring(state: GameState, x0 = 4, y0 = 5, x1 = 16, y1 = 19): Building[] {
  let id = Math.max(99, ...state.buildings.map(b => b.id)) + 1;
  const walls: Building[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
    if (x === x0 || x === x1 || y === y0 || y === y1) walls.push(building(id++, 'wall', x, y));
  entityStore(state).buildings.add(...walls);
  // A populated perimeter retains ownership; an isolated distant wall is
  // intentionally neutralized by the normal wall-claim mechanic.
  for (const [x, y] of [[x0 + 2, y0 + 2], [x1 - 2, y0 + 2], [x0 + 2, y1 - 2], [x1 - 2, y1 - 2]])
    entityStore(state).buildings.add({ ...building(id++, 'house', x, y), capacity: 4, residents: 0 });
  return walls;
}
function gate(state: GameState, x: number, y: number): void {
  entityStore(state).buildings.add(building(Math.max(...state.buildings.map(b => b.id)) + 1, 'road', x, y));
}
const guards = (state: GameState, post = 2) => state.units.filter(u => u.kind === 'militia' && u.guardPost === post && u.hp > 0);
const refresh = (state: GameState) => updateGuardPosts(state, { hostile: (a, b) => a >= 0 && a !== b });
function advance(state: GameState, seconds: number, inspect?: () => void): void {
  for (let step = 0; step < Math.round(seconds * 10); step++) { updateGame(state, .1, idle); inspect?.(); }
}
function enable(state: GameState): void { expect(setGuardPostWallsOnly(state, state.buildings[1], true).ok).toBe(true); }

describe('guard posts restricted to their physical city enclosure', () => {
  it('defaults off and persists independently per post without a gold charge or loss of upgrades', () => {
    const state = fixture(), post = state.buildings[1];
    entityStore(state).buildings.add(building(3, 'guardPost', 13, 13)); refresh(state);
    expect(post.guardPost?.wallsOnly ?? false).toBe(false);
    Object.assign(post.guardPost!, { level: 1, kills: 250 });
    enable(state); refresh(state);
    expect(post.guardPost).toMatchObject({ wallsOnly: true, level: 1, kills: 250 });
    expect(state.buildings[2].guardPost?.wallsOnly ?? false).toBe(false);
    expect(state.factions[0].gold).toBe(500);
    expect(structuredClone(state).buildings[1].guardPost?.wallsOnly).toBe(true);
    expect(setGuardPostWallsOnly(state, post, false).ok).toBe(true);
    refresh(state); expect(post.guardPost?.wallsOnly).toBe(false);
  });

  it('rejects foreign, absent, unfinished and out-of-range posts without changing their setting', () => {
    const state = fixture(), post = state.buildings[1]; refresh(state);
    post.faction = 1; expect(setGuardPostWallsOnly(state, post, true).ok).toBe(false); post.faction = 0;
    expect(setGuardPostWallsOnly(state, { ...post }, true).ok).toBe(false);
    expect(setGuardPostWallsOnly(state, state.buildings[0], true).ok).toBe(false);
    post.construction = { startedAt: 0, duration: 30, waitingForBuilder: true, paidGold: 200 };
    expect(setGuardPostWallsOnly(state, post, true).ok).toBe(false); delete post.construction;
    state.units[0].x = 35; expect(setGuardPostWallsOnly(state, post, true).ok).toBe(false);
    state.units[0].x = 11.5; state.units[0].hp = 0; expect(setGuardPostWallsOnly(state, post, true).ok).toBe(false);
    expect(post.guardPost?.wallsOnly ?? false).toBe(false);
  });

  it('attacks intruders inside the walls even when their presence suspends the growth bonus', () => {
    const state = fixture(); ring(state); enable(state);
    const enemy = person(20, 14.5, 12.5); entityStore(state).units.add(enemy);
    expect(palaceEnclosures(state).regions).toHaveLength(0);
    expect(palaceEnclosures(state, true).regions).toHaveLength(1);
    advance(state, 3);
    expect(guards(state)).toHaveLength(3);
    expect(enemy.hp).toBeLessThan(10000);
    expect(guards(state).every(u => u.x > 4 && u.x < 16 && u.y > 5 && u.y < 19)).toBe(true);
  });

  it('ignores enemies and endangered civilians outside a friendly gate, even inside cultural borders', () => {
    const state = fixture(); ring(state); gate(state, 4, 12); enable(state);
    const enemy = person(20, 3.5, 12.5), worker = person(21, 3.5, 13.5, 0, 'worker');
    entityStore(state).units.add(enemy, worker);
    expect(insideOwnBorders(state, 0, enemy.x, enemy.y)).toBe(true);
    expect(canWalk(state, 4.5, 12.5, 0)).toBe(true);
    advance(state, 4);
    expect(guards(state)).toHaveLength(3);
    expect(guards(state).every(u => u.inside && u.target === undefined)).toBe(true);
    expect(enemy.hp).toBe(10000);
  });

  it('keeps the usual long pursuit when disabled, then recalls an outside garrison without attacking', () => {
    const state = fixture(); ring(state); gate(state, 16, 12);
    const enemy = person(20, 14.5, 12.5); entityStore(state).units.add(enemy);
    advance(state, 2); enemy.x = 19.5;
    advance(state, 5);
    const roster = guards(state);
    expect(roster.some(u => u.x > 16 && u.target === enemy.id)).toBe(true);
    enable(state); const hp = enemy.hp;
    advance(state, 12, () => expect(roster.every(u => u.target === undefined)).toBe(true));
    expect(enemy.hp).toBe(hp);
    expect(roster.every(u => u.inside)).toBe(true);
  });

  it('drops an escaping target immediately rather than attacking across the wall or pursuing through a gate', () => {
    const state = fixture(); ring(state); gate(state, 16, 12); enable(state);
    const enemy = person(20, 14.5, 12.5); entityStore(state).units.add(enemy); advance(state, 2);
    expect(enemy.hp).toBeLessThan(10000); enemy.x = 17.5; const hp = enemy.hp;
    advance(state, 8, () => {
      expect(guards(state).every(u => u.inside || u.x > 4 && u.x < 16 && u.y > 5 && u.y < 19)).toBe(true);
      expect(guards(state).every(u => u.target === undefined)).toBe(true);
    });
    expect(enemy.hp).toBe(hp); expect(guards(state).every(u => u.inside)).toBe(true);
  });

  it('stays sheltered with no enclosure, and returns immediately after a real wall breach', () => {
    const state = fixture(), enemy = person(20, 14.5, 12.5); enable(state); entityStore(state).units.add(enemy);
    advance(state, 2); expect(guards(state).every(u => u.inside)).toBe(true); expect(enemy.hp).toBe(10000);
    const walls = ring(state); advance(state, 2); expect(enemy.hp).toBeLessThan(10000);
    walls.find(wall => wall.x === 16 && wall.y === 12)!.hp = 0;
    expect(palaceEnclosures(state, true).regions).toHaveLength(0); const hp = enemy.hp;
    advance(state, 8, () => expect(guards(state).every(u => u.target === undefined)).toBe(true));
    expect(enemy.hp).toBe(hp); expect(guards(state).every(u => u.inside)).toBe(true);
  });

  it('does not deploy from a post outside its settlement’s ring', () => {
    const state = fixture(); ring(state); state.buildings[1].x = 3;
    state.units[0].x = 3.5; state.units[0].y = 14.5; enable(state);
    const enemy = person(20, 6.5, 12.5); entityStore(state).units.add(enemy); advance(state, 3);
    expect(guards(state)).toHaveLength(3);
    expect(guards(state).every(u => u.inside)).toBe(true); expect(enemy.hp).toBe(10000);
  });

  it('escapes a forbidden area toward safe interior ground instead of getting stuck at a nearer gate exit', () => {
    const state = fixture(); ring(state); gate(state, 16, 12); enable(state); advance(state, .1);
    const guard = guards(state)[0];
    Object.assign(guard, { x: 15.5, y: 12.5, inside: false, target: undefined, destination: undefined, path: undefined });
    setForbiddenRectangle(state, { x: 13, y: 8 }, { x: 15, y: 16 }, true);
    expect(isForbidden(state, guard.x, guard.y)).toBe(true);
    expect(isForbidden(state, 16.5, 12.5)).toBe(false);
    expect(canWalk(state, 16.5, 12.5, 0)).toBe(true);
    advance(state, 4, () => expect(guard.x < 16 && guard.x > 4 && guard.y > 5 && guard.y < 19).toBe(true));
    expect(isForbidden(state, guard.x, guard.y)).toBe(false);
    expect(guard.x).toBeLessThan(13);
  });

  it('uses its own settlement’s enclosure rather than another friendly city’s protected region', () => {
    const state = fixture(); ring(state);
    entityStore(state).buildings.add({ ...building(3, 'palace', 28, 10), unhousedResidents: 10,
      populationGrowth: -10000, governorPermissions: { farms: false, housing: false } }, building(4, 'guardPost', 30, 12));
    ring(state, 25, 6, 35, 19); state.factions[0].population = 20; enable(state); refresh(state);
    expect(palaceEnclosures(state, true).regions).toHaveLength(2);
    const local = guards(state)[0];
    expect(militiaCityContains(state, local, { x: 13.5, y: 12.5 })).toBe(true);
    expect(militiaCityContains(state, local, { x: 31.5, y: 12.5 })).toBe(false);
    const enemy = person(20, 32.5, 12.5); entityStore(state).units.add(enemy); advance(state, 3);
    expect(guards(state).every(u => u.inside)).toBe(true);
    expect(guards(state, 4).some(u => !u.inside)).toBe(true);
    expect(enemy.hp).toBeLessThan(10000);
  });

  it('takes the interior route around a concave city instead of shortcutting through two friendly gates', () => {
    const state = fixture(), palace = state.buildings[0], post = state.buildings[1];
    palace.x = 6; palace.y = 10; post.x = 6; post.y = 7;
    state.units[0].x = 6.5; state.units[0].y = 8.5;
    const footprint = (x: number, y: number) => x >= 4 && x <= 22 && y >= 4 && y <= 22 && (x <= 9 || x >= 17 || y >= 17);
    let id = 100;
    for (let y = 4; y <= 22; y++) for (let x = 4; x <= 22; x++) if (footprint(x, y)
      && [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]].some(([dx, dy]) => !footprint(x + dx, y + dy)))
      entityStore(state).buildings.add(building(id++, 'wall', x, y));
    gate(state, 9, 8); gate(state, 17, 8);
    for (const [x, y] of [[6, 6], [19, 6], [6, 19], [19, 19]])
      entityStore(state).buildings.add({ ...building(id++ + 10, 'house', x, y), capacity: 4, residents: 0 });
    const enemy = person(20, 19.5, 8.5); entityStore(state).units.add(enemy); enable(state); refresh(state);
    const area = palaceEnclosures(state, true).regions.find(r => r.palaces.includes(palace.id))!;
    expect(area).toBeDefined(); const interior = new Set(area.cells);
    const from = { x: 7.5, y: 8.5 }, unrestricted = findPath(state, from, enemy, 0);
    expect(unrestricted.some(p => !interior.has(Math.floor(p.y) * state.world.width + Math.floor(p.x)))).toBe(true);
    expect(insideOwnBorders(state, 0, enemy.x, enemy.y)).toBe(true);
    let lowest = 0;
    advance(state, 24, () => {
      for (const guard of guards(state)) if (!guard.inside) {
        lowest = Math.max(lowest, guard.y);
        expect(interior.has(Math.floor(guard.y) * state.world.width + Math.floor(guard.x))).toBe(true);
        for (const point of guard.path ?? []) expect(interior.has(Math.floor(point.y) * state.world.width + Math.floor(point.x))).toBe(true);
        expect(militiaMovementLimits(state, guard)).toBeDefined();
      }
    });
    expect(lowest).toBeGreaterThan(17); expect(enemy.hp).toBeLessThan(10000);
  });
});
