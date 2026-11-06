import { entityStore } from '../src/game/entity-store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { palaceEnclosures } from '../src/game/enclosures';
import { findPath } from '../src/game/pathfinding';
import { paintTerrain } from '../src/game/terrain';
import { type Building, type GameState, type Tile, type World } from '../src/game/types';

vi.mock('../src/game/puny-world', async () => {
  const { punyAtlas } = await import('./puny-atlas');
  const atlas = punyAtlas();
  return { drawPuny: vi.fn(), punyWorldPixels: () => atlas, punyDesertLedgePixels: () => undefined };
});
afterEach(() => vi.unstubAllGlobals());

function fixture(): GameState {
  const world: World = { width: 30, height: 26, seed: 'ridge-cache', source: 'test', spawns: [], revision: 0,
    tiles: Array.from({ length: 30 * 26 }, (): Tile => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
      moisture: .5, food: 2, production: 0, gold: 0, variation: .5 })) };
  for (let y = 7; y <= 18; y++) for (let x = 7; x <= 18; x++) world.tiles[y * world.width + x].ridge = 1;
  return { world, buildings: [], units: [], factions: [{ id: 0, name: 'Test', color: '#38f', affinity: 100,
    relation: 'self', food: 100, gold: 0, production: 0, population: 1, yields: { food: 0, gold: 0, production: 0 },
    nextRaid: Infinity, defeated: false }], time: 0, tick: 0, speed: 1, paused: false, gameOver: false, victory: false,
    events: [], particles: [], projectiles: [], fields: [], marauderPacks: [], raiderCamps: [], selected: null,
    selectedType: null, buildMode: null, diplomacy: null, seed: world.seed, rngState: 1 };
}
function raiseSummit(world: World): void {
  for (let y = 9; y <= 15; y++) for (let x = 13; x <= 17; x++) world.tiles[y * world.width + x].ridgeTier = 2;
  if (world.revision !== undefined) world.revision++;
}

describe('ridge tier cache invalidation', () => {
  it.each([true, false])('rebuilds cached paths after a tier-only change (revisioned: %s)', revisioned => {
    const state = fixture(), start = { x: 9.5, y: 12.5 }, target = { x: 15.5, y: 12.5 };
    if (!revisioned) delete state.world.revision;
    expect(findPath(state, start, target, 0).at(-1)).toEqual(target);
    raiseSummit(state.world);
    expect(findPath(state, start, target, 0)).toEqual([]);
    for (const tile of state.world.tiles) delete tile.ridgeTier;
    if (state.world.revision !== undefined) state.world.revision++;
    expect(findPath(state, start, target, 0).at(-1)).toEqual(target);
  });

  it('drops the defended enclosure when a tier-only change makes its approach inaccessible even without walls', () => {
    const state = fixture(), world = state.world;
    const building = (id: number, kind: Building['kind'], x: number, y: number): Building => ({
      id, kind, x, y, faction: 0, hp: 100, maxHp: 100, capacity: 0 });
    entityStore(state).buildings.add(building(1, 'palace', 10, 10));
    world.tiles[12 * world.width + 18].stair = 'west';
    for (let y = 10; y <= 14; y++) entityStore(state).buildings.add(building(state.buildings.length + 1, 'wall', 21, y));
    for (const y of [10, 14]) for (let x = 19; x <= 20; x++) entityStore(state).buildings.add(building(state.buildings.length + 1, 'wall', x, y));
    expect(palaceEnclosures(state).regions).toHaveLength(1);
    for (const tile of world.tiles) if (tile.ridge) tile.ridgeTier = 2;
    world.revision!++;
    expect(palaceEnclosures(state).regions).toHaveLength(0);
  });

  it('repaints newly raised cliff art but keeps unchanged economic revisions cached', () => {
    const state = fixture(), drawImage = vi.fn();
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({
      createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: vi.fn(),
    }) }) });
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage, imageSmoothingEnabled: false }) } as unknown as HTMLCanvasElement;
    paintTerrain(canvas, state.world);
    expect(drawImage).toHaveBeenCalledOnce(); drawImage.mockClear();
    state.world.revision!++; paintTerrain(canvas, state.world);
    expect(drawImage).not.toHaveBeenCalled();
    raiseSummit(state.world); paintTerrain(canvas, state.world);
    expect(drawImage).toHaveBeenCalledOnce();
    expect(drawImage.mock.calls[0].slice(1)).toEqual([12 * 32, 8 * 32, 7 * 32, 9 * 32]);
  });

  it('does not confuse a fourth mountain tier with the first tier of another ridge', () => {
    const state = fixture(), drawImage = vi.fn();
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({
      createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: vi.fn(),
    }) }) });
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage, imageSmoothingEnabled: false }) } as unknown as HTMLCanvasElement;
    const tile = state.world.tiles[12 * state.world.width + 12];
    tile.ridge = 1; tile.ridgeTier = 4;
    paintTerrain(canvas, state.world); drawImage.mockClear();
    tile.ridge = 2; tile.ridgeTier = 1;
    paintTerrain(canvas, state.world);
    expect(drawImage).toHaveBeenCalledOnce();
  });
});
