import { describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { PixiScene } from '../src/game/pixi-scene';

function fixture() {
    const stage = new Container(), renderer = { render: vi.fn() };
    const art = { atlasPages: 0, prune: vi.fn(() => []), beginFrame: vi.fn(), flush: vi.fn() };
    const scene = Object.assign(Object.create(PixiScene.prototype), { stage, renderer, art, sprites: [], shapes: [], shapeKeys: new WeakMap() }) as PixiScene;
    const adds = vi.spyOn(stage, 'addChildAt'), removes = vi.spyOn(stage, 'removeChildren');
    return { scene, stage, adds, removes };
}

describe('retained Pixi scene membership', () => {
    it('updates transforms without detaching unchanged children', () => {
        const { scene, stage, adds, removes } = fixture();
        const frame = (x: number) => {
            scene.beginFrame();
            scene.image(Texture.EMPTY, x, 0, 10, 10);
            scene.graphics().rect(1, 1, 2, 2).fill('#fff');
            scene.image(Texture.EMPTY, 20, 0, 10, 10);
            scene.finishFrame();
        };
        frame(0); const children = [...stage.children];
        adds.mockClear(); removes.mockClear(); frame(5);
        expect(stage.children).toEqual(children);
        expect(stage.children[0].x).toBe(5);
        expect(adds).not.toHaveBeenCalled(); expect(removes).not.toHaveBeenCalled();
    });

    it('turns a cached hull continuously around its center while passenger overlays remain upright', () => {
        const { scene, stage } = fixture();
        const base = { texture: Texture.EMPTY, x: 0, y: 0, width: 32, height: 32 };
        const hull = { ...base, rotation: .37, rotationPivot: { x: 16, y: 18 }, overlays: [{ ...base, y: -8, height: 40 }] };
        scene.beginFrame(); const sprite = scene.sprite(hull, 100, 200, 2);
        expect(sprite.rotation).toBe(.37); expect([sprite.pivot.x, sprite.pivot.y]).toEqual([Texture.EMPTY.width / 2, Texture.EMPTY.height * 18 / 32]);
        expect([sprite.x, sprite.y]).toEqual([132,236]); expect(stage.children[1].rotation).toBe(0);
        scene.finishFrame(); scene.beginFrame(); const rotated = scene.sprite({ ...hull, rotation: .38 }, 100, 200, 2);
        expect(rotated).toBe(sprite); expect(rotated.rotation).toBe(.38); expect(stage.children[1].rotation).toBe(0);
        scene.finishFrame(); scene.beginFrame(); const ordinary = scene.sprite(base, 100, 200, 2);
        expect(ordinary).toBe(sprite); expect(ordinary.rotation).toBe(0); expect([ordinary.pivot.x, ordinary.pivot.y]).toEqual([0,0]);
    });

    it('converts a doubled native galley pivot to texture coordinates', () => {
        const { scene } = fixture();
        const art = { texture: Texture.EMPTY, x: -16, y: -16, width: 64, height: 64,
            rotation: Math.PI / 4, rotationPivot: {x:16,y:16} };
        scene.beginFrame(); const sprite = scene.sprite(art, 100, 200, 2);
        expect([sprite.pivot.x, sprite.pivot.y]).toEqual([Texture.EMPTY.width / 2, Texture.EMPTY.height / 2]);
        expect([sprite.x, sprite.y]).toEqual([132,232]);
        expect(sprite.width).toBe(128); expect(sprite.height).toBe(128);
    });

    it('preserves painter order when graphics move and removes unused tails', () => {
        const { scene, stage } = fixture();
        scene.beginFrame();
        const first = scene.image(Texture.EMPTY, 0, 0, 1, 1), shape = scene.graphics(), second = scene.image(Texture.EMPTY, 1, 0, 1, 1);
        scene.finishFrame();
        scene.beginFrame(); scene.graphics(); scene.image(Texture.EMPTY, 2, 0, 1, 1); scene.image(Texture.EMPTY, 3, 0, 1, 1); scene.finishFrame();
        expect(stage.children).toEqual([shape, first, second]);
        scene.beginFrame(); scene.image(Texture.EMPTY, 4, 0, 1, 1); scene.finishFrame();
        expect(stage.children).toEqual([first]);
        expect(shape.parent).toBeNull(); expect(second.parent).toBeNull();
    });

    it('reuses expensive geometry until an input changes, including after an ordinary shape takes the pool slot', () => {
        const { scene } = fixture(), build = vi.fn(graphics => graphics.rect(0, 0, 3, 3).fill('#fff'));
        const frame = (time: number) => { scene.beginFrame(); scene.retainedGraphics(['shimmer', time], build); scene.finishFrame(); };
        frame(1); frame(1); expect(build).toHaveBeenCalledOnce();
        frame(2); expect(build).toHaveBeenCalledTimes(2);
        scene.beginFrame(); scene.graphics().circle(0, 0, 2).fill('#fff'); scene.finishFrame();
        frame(2); expect(build).toHaveBeenCalledTimes(3);
    });
});
