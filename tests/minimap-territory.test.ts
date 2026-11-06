import { describe, expect, it, vi } from 'vitest';
import { MinimapTerritoryMemory } from '../src/game/minimap';
import { territory, UNCLAIMED, type Territory } from '../src/game/borders';
import type { FogView } from '../src/game/fog';
import { Renderer } from '../src/game/renderer';
import type { Building, GameState } from '../src/game/types';

function politicalMap() {
  const width = 7, height = 5;
  const borders: Territory = { width, height, owners: new Int32Array(width * height).fill(UNCLAIMED),
    sourceIds: new Int32Array(width * height).fill(UNCLAIMED), alternateOwners: new Int32Array(width * height).fill(UNCLAIMED),
    alternateSourceIds: new Int32Array(width * height).fill(UNCLAIMED), sourceRadii: new Map(),
    edges: [], paths: [], revision: 1 };
  for (let y = 1; y < 4; y++) for (let x = 1; x < 4; x++) borders.owners[y * width + x] = 1;
  const fog: FogView = { width, height, visible: new Uint8Array(width * height).fill(1), explored: Array(width * height).fill(1),
    buildings: [], fields: [], sources: [], revision: 1, explorationRevision: 1 };
  return { borders, fog, memory: new MinimapTerritoryMemory() };
}

describe('minimap political map', () => {
  it('tints claimed land and marks its true perimeter, with no work on an unchanged frame', () => {
    const { borders, fog, memory } = politicalMap();
    expect(memory.update(borders, fog)).toHaveLength(9);
    expect(memory.owners[2 * 7 + 2]).toBe(1);
    expect(memory.boundary[2 * 7 + 2]).toBe(0);
    expect(memory.boundary[1 * 7 + 2]).toBe(1);
    expect(memory.owners[0]).toBe(UNCLAIMED);
    expect(memory.update(borders, fog)).toEqual([]);
  });

  it('shows current borders on explored tiles and updates ownership through light fog', () => {
    const { borders, fog, memory } = politicalMap();
    fog.visible.fill(0); fog.visible[16] = 1;
    memory.update(borders, fog);
    expect(memory.owners[16]).toBe(1);
    expect(memory.owners[15]).toBe(1);
    fog.visible.fill(0); fog.revision++;
    const conquered = { ...borders, owners: borders.owners.map(owner => owner === 1 ? 2 : owner), revision: 2 };
    memory.update(conquered, fog);
    expect(memory.owners[16]).toBe(2);
    expect(memory.owners[15]).toBe(2);
    fog.visible[16] = 1; fog.revision++;
    memory.update(conquered, fog);
    expect(memory.owners[16]).toBe(2);
  });

  it('hides every undiscovered claim and reveals only newly explored cells', () => {
    const { borders, fog, memory } = politicalMap();
    fog.visible.fill(0); fog.explored.fill(0);
    expect(memory.update(borders, fog)).toEqual([]);
    expect([...memory.owners].every(owner => owner === UNCLAIMED)).toBe(true);
    fog.explored[16] = 1; fog.explorationRevision++;
    expect(memory.update(borders, fog)).toEqual([16]);
    expect(memory.owners[16]).toBe(1);
    expect(memory.owners[15]).toBe(UNCLAIMED);
    expect(memory.update(borders, fog)).toEqual([]);
    const conquered = { ...borders, owners: borders.owners.map(owner => owner === 1 ? 2 : owner), revision: 2 };
    memory.update(conquered, fog);
    expect(memory.owners[16]).toBe(2); expect(memory.owners[15]).toBe(UNCLAIMED);
  });

  it('shows conquered territory and resets political colors for a new fog/world', () => {
    const { borders, fog, memory } = politicalMap();
    borders.owners[16] = 0; memory.update(borders, fog);
    fog.visible.fill(0); fog.revision++;
    memory.update({ ...borders, owners: borders.owners.map(owner => owner === 0 ? 2 : owner), revision: 2 }, fog);
    expect(memory.owners[16]).toBe(2);
    expect(memory.update(borders, { ...fog, revision: 1 })).toHaveLength(9);
    expect(memory.owners[16]).toBe(0);
    expect(memory.owners[15]).toBe(1);
  });

  it('repaints territory for faction palette changes while hidden', () => {
    const { borders, fog, memory } = politicalMap();
    memory.update(borders, fog); fog.visible.fill(0); fog.revision++;
    expect(memory.update(borders, fog, true)).toHaveLength(9);
    expect(memory.owners[16]).toBe(1);
  });

  it.each([1, .27])('keeps known palace icons readable above fog at HUD scale %s without revealing unknown cities', hudScale => {
    vi.stubGlobal('devicePixelRatio', 1);
    const palace = (id: number, faction: number, x: number): Building => ({ id, kind: 'palace', faction, x, y: 4, hp: 100, maxHp: 100, capacity: 0 });
    const state = { world: { width: 30, height: 15, seed: 'palaces', source: 'test', spawns: [],
      tiles: Array.from({ length: 450 }, () => ({ terrain: 'grassland', overlay: 'none' })) },
      factions: [{ id: 0, color: '#d83838', culture: 0 }, { id: 1, color: '#307ed6', culture: 0 }, { id: 2, color: '#ff00ff', culture: 0 }],
      buildings: [palace(1, 0, 3), palace(2, 1, 14), palace(3, 2, 25)], units: [],
    } as unknown as GameState;
    const fog: FogView = { width: 30, height: 15, visible: new Uint8Array(450), explored: Array(450).fill(1),
      buildings: state.buildings.slice(0, 2), fields: [], sources: [], revision: 1, explorationRevision: 1 };
    for (let y = 0; y < 15; y++) for (let x = 0; x < 12; x++) fog.visible[y * 30 + x] = 1;
    const events: { kind: string; value: unknown; alpha?: number; width?: number; height?: number }[] = [];
    const c = { globalAlpha: 1, fillStyle: '', save() {}, restore() { this.globalAlpha = 1; }, beginPath() {}, rect() {}, clip() {},
      setTransform() {}, strokeRect() {}, fillRect(_x: number, _y: number, width: number, height: number) { events.push({ kind: 'fill', value: this.fillStyle, alpha: this.globalAlpha, width, height }); },
      drawImage(image: unknown) { events.push({ kind: 'image', value: image }); } };
    const overlayContext = { clearRect: vi.fn(), fillRect: vi.fn() }, fogCanvas = { width: 30 };
    const renderer = Object.assign(Object.create(Renderer.prototype), {
      mini: c, minimap: { clientWidth: 712, clientHeight: 642, width: 712, height: 642,
        getBoundingClientRect: () => ({ left: 6.75, top: 600.25, width: 712 * hudScale, height: 642 * hudScale }) }, miniature: {}, fogCanvas,
      minimapTerritory: { width: 0, height: 0, getContext: () => overlayContext }, minimapClaims: new MinimapTerritoryMemory(),
      minimapContent: { width: 0, height: 0, getContext: () => c },
      width: 900, height: 600, zoom: 1, camera: { x: 8, y: 8 },
    });
    renderer.drawMinimap(state, fog);
    const fogIndex = events.findIndex(event => event.value === fogCanvas);
    const cities = events.slice(fogIndex + 1).filter(event => event.kind === 'fill' && ['#d83838', '#307ed6', '#ff00ff'].includes(String(event.value)));
    expect(cities.map(({ kind, value, alpha }) => ({ kind, value, alpha }))).toEqual([{ kind: 'fill', value: '#d83838', alpha: 1 }, { kind: 'fill', value: '#307ed6', alpha: .75 }]);
    const outlines = events.slice(fogIndex + 1).filter(event => event.value === '#fff4d1');
    expect(outlines[0].width! * hudScale).toBeCloseTo(8);
    expect(outlines[0].height! * hudScale).toBeCloseTo(6);
    const backing = events.slice(fogIndex + 1).find(event => event.value === '#161b17')!;
    expect(backing.width! * hudScale).toBeCloseTo(10);
    expect(backing.height! * hudScale).toBeCloseTo(10);
    overlayContext.fillRect.mockClear(); renderer.drawMinimap(state, fog);
    expect(overlayContext.fillRect).not.toHaveBeenCalled();
    expect(territory(state).owners.some(owner => owner === 2)).toBe(true); // Hidden claims really exist.
    vi.unstubAllGlobals();
  });
});
