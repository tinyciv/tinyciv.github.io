import { describe, expect, it } from 'vitest';
import { constructionEdges } from '../src/game/builders';
import { entityStore } from '../src/game/entity-store';
import { ensureFactionStartingExits, establishFactionStartingDefenses } from '../src/game/faction-start';
import { canTraverseEdge, canWalk, hasStaticPath, withNavigationFrame } from '../src/game/pathfinding';
import type { Building, GameState, Point } from '../src/game/types';

function fixture(): GameState {
  return { world: { width: 48, height: 48, seed: 'starting-wall-terrain', source: 'test', spawns: [],
    tiles: Array.from({ length: 48 * 48 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .5,
      food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', faction: 1, x: 20, y: 20, hp: 650, maxHp: 650, capacity: 10 }], units: [],
    factions: [0, 1].map(id => ({ id, name: `Faction ${id}`, color: '#fff', relation: id ? 'war' : 'self', affinity: 0,
      food: 500, gold: 500, production: 0, population: 5, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1000, defeated: false })),
    time: 0, tick: 0, speed: 1, paused: false, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'starting-wall-terrain', rngState: 1 };
}
/** Use actual eight-direction movement for friendly and hostile approaches
 * across marsh, fords, rocks and farm-sized gaps. */
function exteriorRoute(state: GameState, palace: Building, faction: number): Point[] | undefined {
  return withNavigationFrame(state, () => {
    const width = state.world.width, height = state.world.height, queue: number[] = [], previous = new Map<number, number>();
    for (const point of constructionEdges(state, palace)) if (canWalk(state, point.x, point.y, faction)) {
      const key = Math.floor(point.y) * width + Math.floor(point.x); queue.push(key); previous.set(key, -1);
    }
    for (let i = 0; i < queue.length; i++) {
      const key = queue[i], x = key % width, y = Math.floor(key / width);
      if (Math.max(Math.abs(x - palace.x), Math.abs(y - palace.y)) > 15) {
        const route: Point[] = [];
        for (let cell = key; cell >= 0; cell = previous.get(cell)!) route.push({ x: cell % width, y: Math.floor(cell / width) });
        return route.reverse();
      }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (!dx && !dy || nx < 0 || ny < 0 || nx >= width || ny >= height || previous.has(next)
          || !canWalk(state, nx + .5, ny + .5, faction) || !canTraverseEdge(state.world, { x, y }, { x: nx, y: ny })) continue;
        previous.set(next, key); queue.push(next);
      }
    }
  });
}
function defend(state: GameState): void {
  let id = Math.max(...state.buildings.map(building => building.id)) + 1;
  const create = (kind: 'road' | 'woodenTower', point: Point) => entityStore(state).buildings.add({ id: id++, kind,
    faction: 1, x: point.x, y: point.y, hp: 100, maxHp: 100, capacity: 0 });
  establishFactionStartingDefenses(state, state.buildings[0], create);
  ensureFactionStartingExits(state, 1, create);
}

describe('open starting towers on traversable terrain', () => {
  it('preserves an existing approach road without adding a palisade layer', () => {
    const state = fixture();
    entityStore(state).buildings.add({ id: 2, kind: 'road', faction: 1, x: 17, y: 16, hp: 100, maxHp: 100, capacity: 0 });
    defend(state);
    expect(state.buildings.filter(building => building.kind === 'road' && building.x === 17 && building.y === 16)).toHaveLength(1);
    expect(state.buildings.some(building => building.kind === 'palisade')).toBe(false);
  });

  it.each(['flat', 'marsh', 'ford', 'farm', 'rocks'] as const)('protects tower contacts around %s while keeping the city and countryside connected', terrain => {
    const state = fixture(), palace = state.buildings[0], width = state.world.width;
    if (terrain === 'marsh' || terrain === 'ford') for (let x = 0; x < width; x++) {
      if (x >= 18 && x <= 23) continue;
      Object.assign(state.world.tiles[20 * width + x], terrain === 'marsh' ? { marsh: true } : { terrain: 'river', overlay: 'ford' });
    }
    if (terrain === 'farm') for (let radius = 4; radius <= 10; radius++) entityStore(state).buildings.add({ id: 100 + radius,
      kind: 'camp', faction: 1, x: palace.x - radius, y: palace.y, hp: 100, maxHp: 100, capacity: 0 });
    if (terrain === 'rocks') {
      for (let y = 5; y <= 42; y++) if (y !== 20) state.world.tiles[y * width + 25].rockRelief = 0;
      expect(canWalk(state, 25, 20, 0)).toBe(true);
    }
    expect(exteriorRoute(state, palace, 0)).toBeDefined();
    defend(state);
    expect(exteriorRoute(state, palace, 0)).toBeDefined();
    expect(exteriorRoute(state, palace, 1)).toBeDefined();
    const towers = state.buildings.filter(building => building.kind === 'woodenTower');
    expect(towers).toHaveLength(4);
    const walls = state.buildings.filter(building => building.kind === 'palisade');
    expect(walls).toHaveLength(0);
    for (const tower of towers) {
      const contacts = constructionEdges(state, tower);
      expect(contacts.length).toBeGreaterThan(1);
      expect(constructionEdges(state, palace).some(exit => contacts.some(contact => hasStaticPath(state, exit, contact, 1)))).toBe(true);
      expect(contacts.every(contact => canWalk(state, contact.x, contact.y, 0))).toBe(true);
    }
    if (terrain === 'farm') expect(state.buildings.filter(building => building.kind === 'camp')).toHaveLength(7);
  });
});
