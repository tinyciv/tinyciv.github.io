import { describe, expect, it } from 'vitest';
import { createGame, createDuelGame } from '../src/game/simulation';
import { DEFAULT_WORLD_WIDTH, DEFAULT_WORLD_HEIGHT, generateWorld } from '../src/world/generator';
import { MIN_FACTION_START_DISTANCE } from '../src/world/starting-sites';
import { OPPOSING_FACTION_COUNT } from '../src/game/civilizations';
import type { World } from '../src/game/types';

const startingTownCount = OPPOSING_FACTION_COUNT * 2 + 1;
const spacing = (points: { x: number; y: number; faction: number }[]): number => Math.min(...points.flatMap((a, i) =>
  points.slice(i + 1).filter(b => b.faction !== a.faction).map(b => Math.hypot(a.x - b.x, a.y - b.y))));
const towns = (world: World) => [...world.spawns.map((point, faction) => ({ ...point, faction })),
  ...(world.secondarySpawns ?? []).map((point, index) => ({ ...point, faction: index + 1 }))];

describe('starting realms have room to grow', () => {
  it.each(['fractal', 'continents', 'pangaea'] as const)('keeps all foreign starting towns at least 30 tiles apart on %s', style => {
    const world = generateWorld('CROWN', undefined, undefined, { style });
    expect(world.minimumFactionStartDistance).toBe(MIN_FACTION_START_DISTANCE);
    expect(towns(world)).toHaveLength(startingTownCount);
    for (const [i, a] of world.spawns.entries())
      expect(Math.min(...world.spawns.filter((_, j) => i !== j).map(b => Math.hypot(a.x - b.x, a.y - b.y)))).toBeLessThanOrEqual(100);
    expect(spacing(towns(world))).toBeGreaterThanOrEqual(30);
  }, 120_000);

  it('preserves separation through actual settlement layout and multiplayer selection', () => {
    const world = generateWorld('42');
    const state = createGame(world);
    const palaces = state.buildings.filter(building => building.kind === 'palace');
    expect(palaces).toHaveLength(startingTownCount);
    for (const faction of new Set(palaces.map(p => p.faction))) {
      const own = palaces.filter(p => p.faction === faction), others = palaces.filter(p => p.faction !== faction);
      expect(Math.min(...own.flatMap(a => others.map(b => Math.hypot(a.x - b.x, a.y - b.y))))).toBeLessThanOrEqual(100);
    }
    expect(spacing(palaces)).toBeGreaterThanOrEqual(30);
    const multiplayer = createDuelGame(generateWorld('42'));
    expect(spacing(multiplayer.buildings.filter(building => building.kind === 'palace'))).toBeLessThanOrEqual(100);
    expect(spacing(multiplayer.buildings.filter(building => building.kind === 'palace'))).toBeGreaterThanOrEqual(30);
  }, 120_000);

  it('preserves minimum map size and separation on constrained continents', () => {
    const world = generateWorld('42', undefined, undefined, { style: 'continents' });
    expect(world.width).toBe(DEFAULT_WORLD_WIDTH);
    expect(world.height).toBe(DEFAULT_WORLD_HEIGHT);
    expect(towns(world)).toHaveLength(startingTownCount);
    for (const [i, a] of world.spawns.entries())
      expect(Math.min(...world.spawns.filter((_, j) => i !== j).map(b => Math.hypot(a.x - b.x, a.y - b.y)))).toBeLessThanOrEqual(100);
    expect(spacing(towns(world))).toBeGreaterThanOrEqual(30);
  }, 120_000);

  it('keeps explicit small development fixtures small', () => {
    const world = generateWorld('small', 64, 64);
    expect([world.width, world.height]).toEqual([64, 64]);
    expect(world.minimumFactionStartDistance).toBeUndefined();
    expect(towns(world)).toHaveLength(startingTownCount);
    for (const [i, a] of world.spawns.entries())
      expect(Math.min(...world.spawns.filter((_, j) => i !== j).map(b => Math.hypot(a.x - b.x, a.y - b.y)))).toBeLessThanOrEqual(100);
  });
});
