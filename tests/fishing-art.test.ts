import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fishArtFrame, fishArtKey, fishSurfaceFrame, fishingBoatArtKey } from '../src/game/fishing-art';
import { rowboatArtFrame } from '../src/game/naval-art';
import { unitKey, NativeArt, type BakedArt } from '../src/game/native-art';
import type { Unit } from '../src/game/types';
import { punyAtlas } from './puny-atlas';

describe('native Miniworld fishing artwork', () => {
  it('ships the unchanged source sheets, licensed provenance and nonempty native cells', () => {
    const source = JSON.parse(readFileSync('public/assets/miniworld/Fishing-source.json', 'utf8'));
    expect(source.license).toBe('CC0-1.0'); expect(source.files).toHaveLength(2);
    for (const record of source.files) {
      expect(createHash('sha256').update(readFileSync(`public/assets/miniworld/${record.file}`)).digest('hex')).toBe(record.sha256);
      const art = punyAtlas(new URL(`../public/assets/miniworld/${record.file}`, import.meta.url));
      expect([art.width, art.height]).toEqual(record.dimensions);
    }
    const fish = punyAtlas(new URL('../public/assets/miniworld/Fish-Sheet.png', import.meta.url));
    for (const x of [32, 48]) for (const y of [0, 16, 32, 48]) {
      let visible = 0;
      for (let dy = 0; dy < 16; dy++) for (let dx = 0; dx < 16; dx++) visible += Number(fish.data[((y + dy) * fish.width + x + dx) * 4 + 3] > 0);
      expect(visible).toBeGreaterThan(12); expect(visible).toBeLessThan(160);
    }
  });

  it('bounds cached frames independently of time, IDs and continuous directions', () => {
    const fish = new Set<string>(), boats = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const subject = { id: i, facing: i / 31 }; fish.add(fishArtKey(subject, i)); boats.add(fishingBoatArtKey(subject, i));
      expect(fishArtFrame(subject).slice(2)).toEqual([16, 16]); expect(rowboatArtFrame(subject).slice(2)).toEqual([16, 16]);
    }
    expect(fish.size).toBeGreaterThan(8); expect(fish.size).toBeLessThanOrEqual(8 * 17); expect(boats.size).toBe(2);
  });

  it('uses the native north, south, east and west swimming perspectives', () => {
    expect([0, Math.PI / 2, Math.PI, -Math.PI / 2].map(facing => fishArtFrame({ id: 1, facing })[1])).toEqual([32, 48, 16, 0]);
  });

  it('keeps fishing sailboats distinct from the Leader rowboat and redraws a boarding passenger', () => {
    const boat = { kind: 'sailboat', facing: 0, sailboat: { dock: 1 } } as Unit;
    const leader = { id: 2, kind: 'leader', facing: 0, armorLevel: 0, inside: true, moving: false, attackTime: 0 } as Unit;
    const empty = unitKey(boat, 0, '#c94c4c'), occupied = unitKey(boat, 0, '#c94c4c', leader);
    expect(empty.startsWith('rowboat:16:')).toBe(true);
    expect(occupied).not.toBe(empty);
    expect(unitKey(boat, 100, '#c94c4c', leader)).toBe(occupied);
    expect(unitKey({ ...boat, facing: Math.PI / 2 }, 0, '#c94c4c', leader)).not.toBe(occupied);
    expect(unitKey(boat, 0, '#c94c4c', { ...leader, armorLevel: 1 })).not.toBe(occupied);
    expect(fishingBoatArtKey(boat)).toBe('sail:false');
    expect(fishingBoatArtKey({ facing: Math.PI })).toBe('sail:true');
    expect(unitKey({ ...boat, kind: 'merchant', aboardRiverTrade: true }, 0, '#c94c4c')).toBe('sailboat:false');
  });

  it('rotates the Leader hull continuously without producing an unbounded angle atlas or rotating the passenger', () => {
    const art = new NativeArt(), keys = new Set<string>();
    vi.spyOn(art, 'paint').mockImplementation((key, bounds) => { keys.add(key); return { ...bounds, texture: {} } as BakedArt; });
    const passenger = { id: 1, kind: 'leader', inside: true, armorLevel: 0, attackTime: 0, moving: false } as Unit;
    for (let index = 0; index < 1000; index++) {
      const facing = index / 31, boat = { kind: 'sailboat', facing, inside: false } as Unit;
      const picture = art.unit(boat, index, '#c94c4c', { passenger });
      expect(picture.rotation).toBe(facing); expect(picture.rotationPivot).toEqual({ x: 16, y: 18 });
      expect(picture.overlays).toHaveLength(1); expect(picture.overlays![0].rotation).toBeUndefined();
    }
    expect(keys.size).toBe(9); expect(keys.has('rowboat:hull')).toBe(true);
  });

  it('keeps fish entirely underwater about 90% of the time and staggers brief surface events', () => {
    let hidden = 0, surface = 0, glimpses = 0;
    for (let id = 1; id <= 100; id++) for (let time = 0; time < 120; time += .1) {
      const frame = fishSurfaceFrame({ id, spawnedAt: 0 }, time);
      if (frame < 0) hidden++; else { surface++; if (frame <= 6) glimpses++; }
    }
    expect(hidden / (hidden + surface)).toBeGreaterThan(.88);
    expect(hidden / (hidden + surface)).toBeLessThan(.93);
    expect(glimpses / (hidden + surface)).toBeLessThan(.05);
    const simultaneous = Array.from({ length: 100 }, (_, id) => fishSurfaceFrame({ id, spawnedAt: 0 }, 10)).filter(frame => frame >= 0).length;
    expect(simultaneous).toBeGreaterThan(2); expect(simultaneous).toBeLessThan(20);
  });
});
