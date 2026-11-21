import { afterEach, describe, expect, it, vi } from 'vitest';
import { paintTerrain } from '../src/game/terrain';
import { markWorldChanged, worldChangesSince } from '../src/game/world-revisions';
import { type GameState, type Tile, type World } from '../src/game/types';

vi.mock('../src/game/puny-world', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/game/puny-world')>();
  const { punyAtlas } = await import('./puny-atlas');
  const atlas = punyAtlas();
  return { ...actual, loadPunyWorld: async () => undefined, drawPuny: vi.fn(), punyWorldPixels: () => atlas, punySandBankPalette: () => undefined };
});
afterEach(() => vi.unstubAllGlobals());

function fixture(): GameState {
  const world: World = { width: 30, height: 26, seed: 'terrain-patch-cache', source: 'test', spawns: [], revision: 0,
    tiles: Array.from({ length: 30 * 26 }, (): Tile => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
      moisture: .5, food: 2, production: 0, gold: 0, variation: .5 })) };
  return { world, buildings: [], units: [], factions: [{ id: 0, name: 'Test', color: '#38f', affinity: 100,
    relation: 'self', food: 100, gold: 0, production: 0, population: 1, yields: { food: 0, gold: 0, production: 0 },
    nextRaid: Infinity, defeated: false }], time: 0, tick: 0, speed: 1, paused: false, gameOver: false, victory: false,
    events: [], particles: [], projectiles: [], fields: [], marauderPacks: [], raiderCamps: [], selected: null,
    selectedType: null, buildMode: null, diplomacy: null, seed: world.seed, rngState: 1 };
}
describe('terrain cache invalidation', () => {
  it('repaints a journaled farm cell without rescanning distant terrain', () => {
    const state = fixture(), drawImage = vi.fn();
    let reads = 0;
    for (const tile of state.world.tiles) {
      const variation = tile.variation;
      Object.defineProperty(tile, 'variation', { get() { reads++; return variation; } });
    }
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({
      createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: vi.fn(),
    }) }) });
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage, imageSmoothingEnabled: false }) } as unknown as HTMLCanvasElement;
    paintTerrain(canvas, state.world); const cursor = worldChangesSince(state.world).revision;
    drawImage.mockClear(); reads = 0;
    const cell = 3 * state.world.width + 3;
    state.world.tiles[cell].farm = 0; markWorldChanged(state.world, 'appearance', [cell]);
    expect(paintTerrain(canvas, state.world, worldChangesSince(state.world, cursor))).toEqual({ x: 2, y: 2, width: 3, height: 3 });
    expect(reads).toBeLessThan(30);
    expect(drawImage).toHaveBeenCalledOnce();
    expect(drawImage.mock.calls[0].slice(1)).toEqual([2 * 32, 2 * 32, 3 * 32, 3 * 32]);
  });
});
