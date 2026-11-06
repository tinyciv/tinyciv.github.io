import { describe, expect, it, vi } from 'vitest';
import { PixiScene } from '../src/game/pixi-scene';

function fixture() {
  const chunks = new Map(Array.from({ length: 4 }, (_, i) => [`${i % 2},${Math.floor(i / 2)}`, {
    canvas: { width: 1024, height: 1024, getContext: () => ({ drawImage: vi.fn() }) },
    texture: { source: { update: vi.fn() } }, revision: 0,
  }]));
  const scene = Object.assign(Object.create(PixiScene.prototype), { chunks, terrainRevision: 0, terrainUploads: 0, image: vi.fn() }) as PixiScene;
  const canvas = { width: 2048, height: 2048 } as HTMLCanvasElement;
  return { scene, canvas, chunks };
}

describe('dirty terrain GPU chunks', () => {
  it('uploads only chunks intersecting changed terrain pixels', () => {
    const { scene, canvas, chunks } = fixture();
    scene.invalidateTerrain({ x: 100, y: 100, width: 64, height: 64 });
    scene.terrain(canvas, 0, 0, 1, 2048, 2048);
    expect(chunks.get('0,0')!.texture.source.update).toHaveBeenCalledOnce();
    for (const key of ['1,0', '0,1', '1,1']) expect(chunks.get(key)!.texture.source.update).not.toHaveBeenCalled();
    scene.terrain(canvas, 0, 0, 1, 2048, 2048);
    expect(chunks.get('0,0')!.texture.source.update).toHaveBeenCalledOnce();
  });

  it('keeps dirty offscreen chunks pending until visible, without dirtying a neighboring chunk at an exact boundary', () => {
    const { scene, canvas, chunks } = fixture();
    scene.invalidateTerrain({ x: 1024, y: 1024, width: 64, height: 64 });
    scene.terrain(canvas, 0, 0, 1, 512, 512);
    for (const chunk of chunks.values()) expect(chunk.texture.source.update).not.toHaveBeenCalled();
    scene.terrain(canvas, -1024, -1024, 1, 512, 512);
    expect(chunks.get('1,1')!.texture.source.update).toHaveBeenCalledOnce();
    for (const key of ['0,0', '1,0', '0,1']) expect(chunks.get(key)!.texture.source.update).not.toHaveBeenCalled();
  });
});
