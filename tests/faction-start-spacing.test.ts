import { describe, expect, it } from 'vitest';
import { createGame, createDuelGame } from '../src/game/simulation';
import { DEFAULT_WORLD_WIDTH, DEFAULT_WORLD_HEIGHT, generateWorld } from '../src/world/generator';
import { MIN_FACTION_START_DISTANCE } from '../src/world/starting-sites';
import type { World } from '../src/game/types';

const spacing = (points: { x: number; y: number; faction: number }[]): number => Math.min(...points.flatMap((a, i) =>
  points.slice(i + 1).filter(b => b.faction !== a.faction).map(b => Math.hypot(a.x - b.x, a.y - b.y))));
const towns = (world: World) => [...world.spawns.map((point, faction) => ({ ...point, faction })),
  ...(world.secondarySpawns ?? []).map((point, index) => ({ ...point, faction: index + 1 }))];

describe('starting realms have room to grow', () => {
  it.each(['fractal', 'continents', 'pangaea', 'mediterranean'] as const)('keeps all foreign starting towns at least 80 tiles apart on %s', style => {
    const world = generateWorld('CROWN', undefined, undefined, { style });
    expect(world.minimumFactionStartDistance).toBe(MIN_FACTION_START_DISTANCE);
    expect(towns(world)).toHaveLength(11);
    expect(spacing(towns(world))).toBeGreaterThanOrEqual(80);
  }, 120_000);

  it('preserves separation through actual settlement layout and multiplayer selection', () => {
    const world = generateWorld('42');
    const state = createGame(world);
    const palaces = state.buildings.filter(building => building.kind === 'palace');
    expect(palaces).toHaveLength(11);
    expect(spacing(palaces)).toBeGreaterThanOrEqual(80);
    const multiplayer = createDuelGame(generateWorld('42'));
    expect(spacing(multiplayer.buildings.filter(building => building.kind === 'palace'))).toBeGreaterThanOrEqual(80);
  }, 120_000);

  it('enlarges constrained continents instead of reducing faction separation', () => {
    const world = generateWorld('42', undefined, undefined, { style: 'continents' });
    expect(world.width).toBeGreaterThan(DEFAULT_WORLD_WIDTH);
    expect(world.height).toBeGreaterThan(DEFAULT_WORLD_HEIGHT);
    expect(towns(world)).toHaveLength(11);
    expect(spacing(towns(world))).toBeGreaterThanOrEqual(80);
  }, 120_000);

  it('keeps explicit small development fixtures small', () => {
    const world = generateWorld('small', 64, 64);
    expect([world.width, world.height]).toEqual([64, 64]);
    expect(world.minimumFactionStartDistance).toBeUndefined();
    expect(towns(world)).toHaveLength(11);
  });
});
