import { describe, expect, it } from 'vitest';
import { createMinimapProjection, minimapToWorld, worldToMinimap } from '../src/game/minimap';
import { buildingAlignmentBonus, campSpacingAllowed, palaceReachability } from '../src/game/placement';
import { Renderer } from '../src/game/renderer';
import { createGame } from '../src/game/simulation';
import { generateWorld } from '../src/world/generator';
import type { Building, GameState } from '../src/game/types';

describe('minimap exploration framing', () => {
  it('zooms to a padded discovered region and preserves square tiles on a wide canvas', () => {
    const explored = Array(100 * 80).fill(0);
    for (let y = 30; y < 40; y++) for (let x = 50; x < 60; x++) explored[y * 100 + x] = 1;
    const projection = createMinimapProjection(explored, 100, 80, 220, 160);
    expect(projection.world).toEqual({ x: 48, y: 28, width: 14, height: 14 });
    expect(projection.width).toBe(projection.height);
    expect(projection.width).toBe(160);
    expect(projection.x).toBe(30);
    const center = worldToMinimap({ x: 55, y: 35 }, projection);
    const east = worldToMinimap({ x: 56, y: 35 }, projection);
    const south = worldToMinimap({ x: 55, y: 36 }, projection);
    expect(east.x - center.x).toBeCloseTo(south.y - center.y);
  });

  it('only expands its world extent as exploration grows and reconstructs it from saved fog', () => {
    const explored = Array(100 * 80).fill(0); explored[35 * 100 + 55] = 1;
    const previous = createMinimapProjection(explored, 100, 80, 200, 150).world;
    explored[10 * 100 + 80] = 1; explored[50 * 100 + 20] = 1;
    const projection = createMinimapProjection(explored, 100, 80, 200, 150);
    expect(projection.world.x).toBeLessThanOrEqual(previous.x);
    expect(projection.world.y).toBeLessThanOrEqual(previous.y);
    expect(projection.world.x + projection.world.width).toBeGreaterThanOrEqual(previous.x + previous.width);
    expect(projection.world.y + projection.world.height).toBeGreaterThanOrEqual(previous.y + previous.height);
    expect(createMinimapProjection(JSON.parse(JSON.stringify(explored)), 100, 80, 200, 150)).toEqual(projection);
    expect(createMinimapProjection(explored, 100, 80, 200, 150)).toEqual(projection);
  });

  it('uses the same projection for a camera marker and clicks, rejecting letterbox clicks', () => {
    const explored = Array(60 * 60).fill(0);
    explored[8 * 60 + 12] = 1; explored[40 * 60 + 18] = 1;
    const projection = createMinimapProjection(explored, 60, 60, 200, 160);
    for (const world of [{ x: 12.5, y: 8.5 }, { x: 18.5, y: 40.5 }, { x: 15, y: 24 }]) {
      const roundtrip = minimapToWorld(worldToMinimap(world, projection), projection)!;
      expect(roundtrip.x).toBeCloseTo(world.x); expect(roundtrip.y).toBeCloseTo(world.y);
    }
    expect(minimapToWorld({ x: 0, y: 80 }, projection)).toBeNull();
    const renderer = Object.create(Renderer.prototype) as Renderer;
    Object.assign(renderer, { minimapProjection: projection, minimap: { clientWidth: 200, clientHeight: 160, getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 80 }) } });
    const onCanvas = worldToMinimap({ x: 15, y: 24 }, projection);
    expect(renderer.minimapWorldPoint(10 + onCanvas.x / 2, 20 + onCanvas.y / 2)).toEqual({ x: 15, y: 24 });
  });

  it('clips padding at world boundaries and keeps empty unexplored maps safe', () => {
    const explored = Array(20 * 10).fill(0); explored[0] = 1; explored[199] = 1;
    expect(createMinimapProjection(explored, 20, 10, 100, 100).world).toEqual({ x: 0, y: 0, width: 20, height: 10 });
    expect(createMinimapProjection([], 20, 10, 100, 100).scale).toBe(5);
  });
});

describe('settlement spacing and alignment', () => {
  const building = (kind: Building['kind'], x: number, y: number, faction = 0): Building => ({ id: 1, kind, x, y, faction, hp: 100, maxHp: 100, capacity: 4 });
  it('allows touching farms while rejecting overlapping plots, including reserved sites and other factions', () => {
    const camp = building('camp', 8, 8, 1);
    camp.construction = { startedAt: 0, duration: 15 };
    const state = { buildings: [camp] } as unknown as GameState;
    for (let y = 7; y <= 9; y++) for (let x = 7; x <= 9; x++) expect(campSpacingAllowed(state, x, y)).toBe(x !== 8 || y !== 8);
    expect(campSpacingAllowed(state, 10, 8)).toBe(true);
    expect(campSpacingAllowed(state, 4, 4)).toBe(true);
    camp.hp = 0; expect(campSpacingAllowed(state, 9, 9)).toBe(true);
  });

  it('slightly prefers own building rows and edges without attraction to road networks', () => {
    const state = { buildings: [building('camp', 5, 5), building('palace', 10, 10), building('wall', 20, 20), building('camp', 25, 25, 1)] } as unknown as GameState;
    expect(buildingAlignmentBonus(state, 0, 5, 12)).toBe(.2);
    expect(buildingAlignmentBonus(state, 0, 11, 14)).toBe(.2);
    expect(buildingAlignmentBonus(state, 0, 4, 3)).toBe(0);
    expect(buildingAlignmentBonus(state, 0, 20, 25)).toBe(0);
    expect(buildingAlignmentBonus(state, 0, 5, 10)).toBe(.4);
  });

  it('filters automatic building sites by palace access, including newly opened fords', () => {
    const palace = building('palace', 3, 4);
    const state = { buildings: [palace], world: { width: 16, height: 12, revision: 0, tiles: Array.from({ length: 192 }, (_, index) => ({
      terrain: index % 16 === 8 ? 'river' : 'grassland', overlay: 'none', elevation: .3, variation: .5,
    })) } } as unknown as GameState;
    const before = palaceReachability(state, palace);
    expect(before[4 * 16 + 3]).toBe(0); // The palace interior is never a spawn/path cell.
    expect(before[5 * 16 + 6]).toBe(1);
    expect(before[5 * 16 + 10]).toBe(0);
    state.world.tiles[5 * 16 + 8].overlay = 'ford'; state.world.revision = 1;
    expect(palaceReachability(state, palace)[5 * 16 + 10]).toBe(1);
  });

  it('keeps generated single-cell farms distinct while allowing immediate neighbors', () => {
    for (const seed of ['BTV-847', 'aligned-camps-1', 'aligned-camps-2']) {
      const state = createGame(generateWorld(seed));
      const camps = state.buildings.filter(building => building.kind === 'camp');
      const palaces = state.buildings.filter(building => building.kind === 'palace');
      // The lower-yield economy starts cities with enough whole farms for
      // their population, including the player's larger twenty-person city.
      expect(camps.length).toBeGreaterThan(palaces.length * 2);
      // A one-cell footprint overlaps exactly when two farms share a cell.
      expect(new Set(camps.map(camp => `${camp.x},${camp.y}`)).size).toBe(camps.length);
      expect(new Set(state.fields!.map(field => `${field.x},${field.y}`)).size).toBe(state.fields!.length);
      const fieldsByCamp = new Map<number, number>();
      for (const field of state.fields!) fieldsByCamp.set(field.camp, (fieldsByCamp.get(field.camp) ?? 0) + 1);
      for (const camp of camps) expect(fieldsByCamp.get(camp.id)).toBe(1);
    }
  }, 30000); // Initialize and inspect three full-size worlds (about 18 seconds locally).
});

describe('health display', () => {
  it('shows five separate cells with three filled at sixty percent health', () => {
    const rectangles: { color: string; width: number }[] = [];
    const graphics = { rect(_x: number, _y: number, width: number) { rectangles.push({ color: '', width }); return this; },
      fill(color: string) { rectangles.at(-1)!.color = color; return this; } };
    const renderer = Object.create(Renderer.prototype) as { healthBar: (c: unknown, x: number, y: number, value: number, width: number) => void };
    renderer.healthBar({ graphics: () => graphics }, 40, 20, .6, 50);
    expect(rectangles.slice(1)).toHaveLength(5);
    expect(rectangles.filter(rect => rect.color === '#c4d78a')).toHaveLength(3);
    expect(rectangles.filter(rect => rect.color === '#5a6651')).toHaveLength(2);
  });
});
