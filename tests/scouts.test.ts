import { describe, expect, it } from 'vitest';
import { updateScout } from '../src/game/scouts';
import { updateFog } from '../src/game/fog';
import { chooseScoutExplorationRoute } from '../src/game/scout-exploration';
import { setForbiddenRectangle } from '../src/game/forbidden-zones';
import { parseGameSave, serializeGameSave } from '../src/game/game-save';
import { entityStore } from '../src/game/entity-store';
import { beginNavigationFrame, canMove, canWalk, endNavigationFrame, hasStaticPath } from '../src/game/pathfinding';
import { beginUnitFrame, endUnitFrame, refreshIndexedUnit } from '../src/game/spatial';
import { moveUnit } from '../src/game/simulation';
import { distance, type Building, type GameState, type Point, type Unit } from '../src/game/types';

const person = (id: number, x: number, y: number, kind: Unit['kind'] = 'scout', faction = 0): Unit => ({
  id, kind, faction, x, y, hp: 100, maxHp: 100, morale: 100, attack: kind === 'scout' ? 0 : 17,
  defense: 4, speed: kind === 'scout' ? 4.752 : 3.96, range: 1.1, order: 'follow', cooldown: 0,
  lastCombat: -100, facing: 0, moving: false, attackTime: 0,
});
const structure = (id: number, x: number, y: number, kind: Building['kind'] = 'wall', faction = 0): Building => ({ id, x, y, kind, faction, hp: 500, maxHp: 500, capacity: 0 });
const hostile = (a: number, b: number) => a !== b;
const move = (state: GameState, unit: Unit, goal: Point, dt: number) => moveUnit(state, unit, goal, dt, false, false, true);
function fixture(count = 1): GameState {
  return {
    world: { width: 84, height: 64, seed: 'scouts', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: 84 * 64 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .6, food: 2, production: 1, gold: 0, variation: .5 })) },
    buildings: [], units: [person(1, 40.5, 32.5, 'leader'), ...Array.from({ length: count }, (_, i) => person(i + 10, 39.5 + i % 3, 34.5 + Math.floor(i / 3)))],
    factions: [{ id: 0, name: 'Roma', color: '#f34f59', affinity: 100, relation: 'self', food: 1000, gold: 1000, production: 0, population: 100,
      yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, nextRetinueAt: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false,
    victory: false, seed: 'scouts', rngState: 1, events: [], particles: [], fields: [], marauderPacks: [], raiderCamps: [],
  };
}
function advance(state: GameState, seconds: number, observe?: (unit: Unit) => void): void {
  for (let i = 0; i < Math.round(seconds * 10); i++) {
    state.time += .1; beginUnitFrame(state); beginNavigationFrame(state);
    try {
      for (const unit of state.units) if (unit.kind === 'scout') {
        unit.moving = false; updateScout(state, unit, .1, move, hostile); refreshIndexedUnit(state, unit); observe?.(unit);
      }
    } finally { endUnitFrame(state); endNavigationFrame(state); }
  }
}

describe('Scouts Lodge world exploration', () => {
  it('chooses separate unexplored frontiers and keeps goals stable while the Leader moves', () => {
    const state = fixture(2), goals = new Map<number, Point>();
    const capture = (_state: GameState, unit: Unit, goal: Point) => goals.set(unit.id, { ...goal });
    for (const scout of state.units.slice(1)) updateScout(state, scout, .1, capture, hostile);
    expect(goals.size).toBe(2);
    const [a, b] = [...goals.values()];
    expect(distance(a, b)).toBeGreaterThan(8);
    const fog = updateFog(state);
    for (const point of goals.values()) {
      expect(fog.explored[Math.floor(point.y) * 84 + Math.floor(point.x)]).toBe(0);
      expect(hasStaticPath(state, state.units[1], point, 0)).toBe(true);
    }
    const previous = [...goals.values()]; state.units[0].x += 20; state.time = 1;
    for (const scout of state.units.slice(1)) updateScout(state, scout, .1, capture, hostile);
    expect([...goals.values()]).toEqual(previous);
  });

  it('steadily maps the reachable world beyond Leader sight instead of circling home', () => {
    const state = fixture(2), leader = state.units[0];
    const initial = updateFog(state).explored.reduce((sum, value) => sum + value, 0);
    let farthest = 0;
    advance(state, 90, scout => { farthest = Math.max(farthest, distance(scout, leader)); expect(canWalk(state, scout.x, scout.y, 0)).toBe(true); });
    const mapped = updateFog(state).explored.reduce((sum, value) => sum + value, 0);
    expect(farthest).toBeGreaterThan(25);
    expect(mapped).toBeGreaterThan(initial * 5);
    expect(mapped / state.world.tiles.length).toBeGreaterThan(.65);
  });

  it('eventually covers every reachable forest cell despite the reduced sight radius', () => {
    const state = fixture(2);
    for (const tile of state.world.tiles) tile.overlay = 'forest';
    state.world.revision = 1;
    advance(state, 720);
    const fog = updateFog(state);
    expect(fog.explored.every(Boolean)).toBe(true);
    const positions = state.units.slice(1).map(scout => ({ x: scout.x, y: scout.y }));
    advance(state, 10);
    expect(state.units.slice(1).map(scout => ({ x: scout.x, y: scout.y }))).toEqual(positions);
  });

  it('rests on a fully mapped world and resumes after newly reachable land is revealed', () => {
    const state = fixture(2);
    state.fog = { width: 84, height: 64, seed: 'scouts', explored: Array(84 * 64).fill(1) };
    const start = state.units.slice(1).map(scout => ({ x: scout.x, y: scout.y }));
    advance(state, 12);
    expect(state.units.slice(1).map(scout => ({ x: scout.x, y: scout.y }))).toEqual(start);
    expect(state.units.slice(1).every(scout => !scout.moving && !scout.path?.length)).toBe(true);
    // A new save/editor world removes the old frontier cache along with its map.
    const resumed = parseGameSave(serializeGameSave(state));
    for (let y = 0; y < 64; y++) for (let x = 58; x < 84; x++) resumed.fog!.explored[y * 84 + x] = 0;
    advance(resumed, 8);
    expect(resumed.units.slice(1).some(scout => scout.x > 48)).toBe(true);
  });

  it('ignores unreachable islands, then crosses a new bridge without a new scout order', () => {
    const state = fixture(2), width = state.world.width;
    for (let y = 0; y < 64; y++) for (let x = 45; x <= 49; x++) state.world.tiles[y * width + x].terrain = 'river';
    state.world.revision = 1;
    state.fog = { width: 84, height: 64, seed: 'scouts', explored: Array.from({ length: 84 * 64 }, (_, index) => Number(index % 84 < 50)) };
    advance(state, 6);
    expect(state.units.slice(1).every(scout => scout.x < 45)).toBe(true);
    for (let x = 45; x <= 49; x++) entityStore(state).buildings.add(structure(100 + x, x, 34, 'bridge'));
    state.world.revision = 2;
    advance(state, 30);
    expect(state.units.slice(1).some(scout => scout.x > 50)).toBe(true);
    expect(updateFog(state).explored[34 * 84 + 65]).toBe(1);
  });

  it.each([false, true])('uses stairs to explore a wooded ridge: %s', ramp => {
    const state = fixture(), scout = state.units[1];
    for (let y = 26; y <= 38; y++) for (let x = 48; x <= 60; x++) {
      const tile = state.world.tiles[y * 84 + x]; tile.ridge = 1; tile.overlay = 'forest';
    }
    if (ramp) state.world.tiles[32 * 84 + 48].stair = 'east';
    state.world.revision = 1;
    state.fog = { width: 84, height: 64, seed: 'scouts', explored: state.world.tiles.map(tile => Number(!tile.ridge)) };
    let visitedHigh = false, previous = { x: scout.x, y: scout.y };
    advance(state, 35, unit => {
      expect(canMove(state, previous, unit, 0)).toBe(true); previous = { x: unit.x, y: unit.y };
      expect(canWalk(state, unit.x, unit.y, 0)).toBe(true);
      visitedHigh ||= !!state.world.tiles[Math.floor(unit.y) * 84 + Math.floor(unit.x)].ridge;
    });
    expect(visitedHigh).toBe(ramp);
  });

  it('respects forbidden corridors and explores them when the restriction is removed', () => {
    const state = fixture();
    state.fog = { width: 84, height: 64, seed: 'scouts', explored: Array.from({ length: 84 * 64 }, (_, index) => Number(index % 84 < 52)) };
    setForbiddenRectangle(state, { x: 46, y: 0 }, { x: 48, y: 63 }, true);
    advance(state, 8);
    expect(state.units[1].x).toBeLessThan(46);
    setForbiddenRectangle(state, { x: 46, y: 0 }, { x: 48, y: 63 }, false);
    advance(state, 15);
    expect(state.units[1].x).toBeGreaterThan(52);
  });

  it('does not mill against a sealed city wall or attack it', () => {
    const state = fixture(2), walls: Building[] = [];
    for (let x = 35; x <= 46; x++) for (const y of [27, 39]) walls.push(structure(100 + walls.length, x, y));
    for (let y = 28; y < 39; y++) for (const x of [35, 46]) walls.push(structure(100 + walls.length, x, y));
    entityStore(state).buildings.replace(walls);
    advance(state, 12);
    const positions = state.units.slice(1).map(scout => ({ x: scout.x, y: scout.y }));
    advance(state, 8);
    expect(state.units.slice(1).map(scout => ({ x: scout.x, y: scout.y }))).toEqual(positions);
    expect(walls.every(wall => wall.hp === 500)).toBe(true);
    expect(state.units.slice(1).every(scout => !scout.target && !scout.moving)).toBe(true);
  });

  it.each([['warrior', 1.1], ['archer', 4], ['leader', 4]] as const)
    ('backs one tile beyond a %s’s weapon range without fighting or collapsing morale', (kind, range) => {
      const state = fixture(), scout = state.units[1], radius = range + 1;
      const enemy = { ...person(80, scout.x + radius - .4, scout.y, kind, -2), range };
      entityStore(state).units.add(enemy); scout.target = 80; scout.forcedAttack = { target: 80 }; scout.attackTime = .5;
      advance(state, 3);
      expect(distance(scout, enemy)).toBeGreaterThanOrEqual(radius);
      expect(distance(scout, enemy)).toBeLessThan(radius + 1.2);
      expect(scout.morale).toBe(100); expect(scout.routed).toBe(false); expect(scout.order).toBe('follow');
      expect(scout.target).toBeUndefined(); expect(scout.forcedAttack).toBeUndefined(); expect(enemy.hp).toBe(100);
    });

  it.each([['woodenTower', 7], ['ballista', 19]] as const)('remembers an observed %s and retreats beyond its weapon reach', (kind, radius) => {
    const state = fixture(), scout = state.units[1];
    const tower = structure(90, scout.x + 6, scout.y - .5, kind, -2); entityStore(state).buildings.add(tower);
    const center = { x: tower.x + .5, y: tower.y + .5 };
    advance(state, 5);
    expect(distance(scout, center)).toBeGreaterThanOrEqual(radius);
    expect(scout.order).toBe('follow'); expect(scout.routed).toBe(false); expect(scout.morale).toBe(100);
  });

  it('continues discovering land when the Leader dies and ignores retinue recall', () => {
    const state = fixture(), scout = state.units[1]; state.units[0].hp = 0;
    scout.recallIssuedAt = 0; scout.retinueStance = 'hold';
    const initial = updateFog(state).explored.reduce((sum, value) => sum + value, 0);
    advance(state, 12);
    expect(updateFog(state).explored.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(initial * 2);
    expect(scout.recallIssuedAt).toBeUndefined(); expect(scout.retinueStance).toBe('hold');
  });

  it('keeps NPC exploration separate from the human map and preserves it through save/reload', () => {
    const state = fixture(), ownFog = updateFog(state), initial = [...ownFog.explored];
    const humanFogState = state.fog;
    state.factions.push({ ...state.factions[0], id: 1, relation: 'peace' });
    const scout = person(70, 8.5, 8.5, 'scout', 1); entityStore(state).units.add(scout);
    let goal: Point | undefined; updateScout(state, scout, .1, (_state, _unit, point) => { goal = point; }, () => false);
    expect(goal).toBeDefined(); expect(state.playerFaction).toBeUndefined(); expect(state.fog).toBe(humanFogState);
    expect(state.fog!.explored).toEqual(initial);
    expect(state.scoutExploration?.[1]?.explored[8 * 84 + 8]).toBe(1);
    expect(state.fog!.explored[8 * 84 + 8]).toBe(0);
    const restored = parseGameSave(serializeGameSave(state));
    expect(restored.scoutExploration![1].explored).toEqual(state.scoutExploration![1].explored);
    expect(restored.fog!.explored).toEqual(initial);
  });

  it('uses each multiplayer faction’s own revealed map', () => {
    const state = fixture();
    state.factions.push({ ...state.factions[0], id: 1, relation: 'war' });
    state.multiplayer = { humanFactionIds: [0, 1], inputs: {}, controls: {
      0: { retinueStance: 'hold', movementMode: 'travel' },
      1: { retinueStance: 'hold', movementMode: 'travel' },
    }, winner: null };
    const scout = person(70, 8.5, 8.5, 'scout', 1); entityStore(state).units.add(scout);
    updateFog(state, 0); const human = [...state.multiplayer.controls[0].fog!.explored];
    chooseScoutExplorationRoute(state, scout, new Map(), []);
    expect(state.multiplayer.controls[0].fog!.explored).toEqual(human);
    expect(state.multiplayer.controls[1].fog!.explored[8 * 84 + 8]).toBe(1);
    expect(state.fog!.explored).toEqual(human);
  });
});
