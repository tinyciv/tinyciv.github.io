import { describe, expect, it, vi } from 'vitest';
import { dockMoorings, dockPlacement } from '../src/game/dock';
import { creekConnections, creekLayers, creekMouthConnections, loadCreekArt } from '../src/game/creek-art';
import { entityStore } from '../src/game/entity-store';
import { initializeFishing } from '../src/game/fishing';
import { irrigationConnects, isFreshwaterSource } from '../src/game/irrigation';
import { canTraverseEdge, traversable } from '../src/game/pathfinding';
import { canSail, sailingPath } from '../src/game/sailing';
import { rasterTerrain, terrainQuads, waterArtKey } from '../src/game/terrain';
import { tileAt, type GameState, type Unit } from '../src/game/types';
import { punyAtlas } from './puny-atlas';

function fixture(): GameState {
  const width = 32, height = 24;
  return {
    world: { width, height, seed: 'creeks', source: 'test', spawns: [],
      tiles: Array.from({ length: width * height }, () => ({ terrain: 'grassland', overlay: 'none',
        elevation: .2, moisture: .6, food: 1, production: 0, gold: 0, variation: .5 })) },
    buildings: [], units: [], factions: [{ id: 0, relation: 'self' }],
    time: 0, tick: 0, seed: 'creeks', rngState: 1,
  } as unknown as GameState;
}

function river(state: GameState, x: number, y: number, creek = false): void {
  Object.assign(tileAt(state.world, x, y)!, { terrain: 'river', creek });
}

describe('narrow natural creeks', () => {
  it('paints the original slim water pixels over ground and retains all four native animation frames', async () => {
    const sheets = {
      ditch: punyAtlas(new URL('../public/assets/irrigation/ditch.png', import.meta.url)),
      inlet: punyAtlas(new URL('../public/assets/irrigation/inlet.png', import.meta.url)),
    };
    class LoadedImage {
      src = '';
      get pixels() { return this.src.includes('ditch') ? sheets.ditch : sheets.inlet; }
      get naturalWidth() { return this.pixels.width; }
      get naturalHeight() { return this.pixels.height; }
      async decode() {}
    }
    vi.stubGlobal('Image', LoadedImage);
    vi.stubGlobal('document', { createElement: () => {
      let source: LoadedImage;
      return { width: 0, height: 0, getContext: () => ({
        drawImage: (image: LoadedImage) => { source = image; }, getImageData: () => source.pixels,
      }) };
    } });
    try { await loadCreekArt(); } finally { vi.unstubAllGlobals(); }
    const state = fixture(), world = state.world, atlas = punyAtlas();
    for (let y = 9; y <= 11; y++) river(state, 10, y, true);
    const crop = { x: 10, y: 10, width: 1, height: 1 }, thin = rasterTerrain(world, crop, atlas);
    for (let y = 0; y < 16; y++) {
      const width = thin.water.slice(y * 16, (y + 1) * 16).reduce((sum, value) => sum + value, 0);
      expect(width).toBeGreaterThan(0); expect(width).toBeLessThanOrEqual(4);
      expect(thin.pixels[(y * 16) * 4 + 3]).toBe(255); // The bank remains opaque native ground.
    }
    const frames = new Set<string>();
    for (let frame = 0; frame < 4; frame++) {
      const [layer] = creekLayers(world, 10, 10, frame);
      const colors: number[] = [];
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const source = ((layer.sy + y) * layer.pixels.width + layer.sx + x) * 4;
        colors.push(...layer.pixels.data.slice(source, source + 4));
        if (frame === 0 && layer.pixels.data[source + 3])
          expect(thin.pixels.slice((y * 16 + x) * 4, (y * 16 + x + 1) * 4)).toEqual(layer.pixels.data.slice(source, source + 4));
      }
      frames.add(colors.join(','));
    }
    expect(frames.size).toBe(4);
    for (let y = 9; y <= 11; y++) tileAt(world, 10, y)!.creek = false;
    const broad = rasterTerrain(world, crop, atlas);
    expect(thin.water.reduce((sum, value) => sum + value, 0)).toBeLessThan(broad.water.reduce((sum, value) => sum + value, 0) * .6);
  });

  it('connects creek bends and junctions through cardinal ports, including mouths into broad water', () => {
    const state = fixture(), world = state.world;
    river(state, 10, 10, true); river(state, 10, 9, true); river(state, 11, 10);
    // A northeast elbow: the adjacent broad river is part of the same water network.
    expect(creekConnections(world, 10, 10)).toBe(3);
    expect(creekMouthConnections(world, 11, 10)).toBe(8);
    expect(creekMouthConnections(world, 10, 10)).toBe(0);
    river(state, 9, 9, true); // Diagonal contact must not add a west port.
    expect(creekConnections(world, 10, 10)).toBe(3);
    river(state, 10, 11, true);
    expect(creekConnections(world, 10, 10)).toBe(7);
    river(state, 9, 10, true);
    expect(creekConnections(world, 10, 10)).toBe(15);
    expect(creekMouthConnections(world, 12, 10)).toBe(0); // Dry ground has no inlet.
  });

  it('keeps the ground under a creek and differentiates animated cache entries by frame and connections', () => {
    const state = fixture(), world = state.world;
    const ground = terrainQuads(world, 10, 10);
    river(state, 10, 10, true); river(state, 10, 9, true); river(state, 10, 11, true);
    expect(terrainQuads(world, 10, 10)).toEqual(ground);
    const straight = waterArtKey(world, 10, 10, 0);
    expect(waterArtKey(world, 10, 10, 1)).not.toBe(straight);
    river(state, 11, 10, true);
    expect(waterArtKey(world, 10, 10, 0)).not.toBe(straight);
    const grassy = waterArtKey(world, 10, 10, 0);
    tileAt(world, 10, 10)!.creekGround = 'desert';
    expect(waterArtKey(world, 10, 10, 0)).not.toBe(grassy);
  });

  it('keeps a major river navigable while preventing boats from entering a narrow tributary', () => {
    const state = fixture();
    for (let x = 1; x < 31; x++) river(state, x, 12);
    for (let y = 4; y < 12; y++) river(state, 16, y, true);
    const boat = { id: 1, kind: 'sailboat', faction: 0, x: 4.5, y: 12.5, hp: 100 } as Unit;
    entityStore(state).units.add(boat);
    expect(sailingPath(state, boat, { x: 28.5, y: 12.5 }).length).toBeGreaterThan(0);
    expect(canSail(state, { x: 16.5, y: 11.5 }, boat)).toBe(false);
    expect(sailingPath(state, boat, { x: 16.5, y: 5.5 })).toEqual([]);
    expect(sailingPath(state, boat, { x: 16.5, y: 5.5 }, true)).toEqual([]);
  });

  it('rejects a creek berth and creek-only moorings while accepting the same broad river layout', () => {
    const state = fixture(), dock = { x: 8, y: 6, dockFacing: 2 as const, faction: 0 };
    river(state, 8, 7); river(state, 7, 7);
    expect(dockPlacement(state, 8, 6)?.facing).toBe(2);
    expect(dockMoorings(state, dock)).toContainEqual({ x: 7.5, y: 7.5 });
    tileAt(state.world, 7, 7)!.creek = true;
    expect(dockMoorings(state, dock)).toEqual([]);
    expect(dockPlacement(state, 8, 6)).toBeUndefined();
    tileAt(state.world, 7, 7)!.creek = false;
    tileAt(state.world, 8, 7)!.creek = true;
    expect(dockPlacement(state, 8, 6)).toBeUndefined();
  });

  it('excludes creeks from boat fishing zones even when they connect to a large river', () => {
    const state = fixture();
    for (let y = 8; y < 24; y++) for (let x = 0; x < 32; x++) river(state, x, y, x < 16);
    initializeFishing(state);
    const cells = state.fishing!.zones.flatMap(zone => zone.cells);
    expect(cells.length).toBeGreaterThan(100);
    expect(cells.every(cell => !state.world.tiles[cell].creek)).toBe(true);
    expect(state.fishing!.fish.every(fish => !tileAt(state.world, fish.x, fish.y)!.creek)).toBe(true);

    const onlyCreeks = fixture();
    for (let x = 1; x < 31; x++) river(onlyCreeks, x, 12, true);
    initializeFishing(onlyCreeks);
    expect(onlyCreeks.fishing!.zones).toEqual([]);
    expect(onlyCreeks.fishing!.fish).toEqual([]);
  });

  it('retains freshwater irrigation and ford crossings on a level mountain shelf', () => {
    const state = fixture();
    for (const tile of state.world.tiles) { tile.ridge = 1; tile.ridgeTier = 3; }
    river(state, 16, 12, true);
    expect(isFreshwaterSource(state, 16, 12)).toBe(true);
    expect(irrigationConnects(state, 15, 12)).toBe(true);
    expect(traversable(state.world, 16, 12)).toBe(false);
    Object.assign(tileAt(state.world, 16, 12)!, { overlay: 'ford', fordAxis: 'horizontal' });
    expect(traversable(state.world, 16, 12)).toBe(true);
    expect(canTraverseEdge(state.world, { x: 15.5, y: 12.5 }, { x: 16.5, y: 12.5 })).toBe(true);
    expect(canTraverseEdge(state.world, { x: 16.5, y: 12.5 }, { x: 17.5, y: 12.5 })).toBe(true);
    expect(canSail(state, { x: 16.5, y: 12.5 })).toBe(false);
  });
});
