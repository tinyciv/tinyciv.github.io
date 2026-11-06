import { afterEach, describe, expect, it, vi } from 'vitest';
import { Renderer } from '../src/game/renderer';
import type { GameState } from '../src/game/types';
import type { FogView } from '../src/game/fog';
import { CHECK_INTERVAL_MS } from '../src/game/work-cadence';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('minimap presentation clock', () => {
    it('limits world composition to 3 Hz while updating the camera every frame', () => {
        vi.stubGlobal('devicePixelRatio', 1);
        const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
        const content = vi.fn(), box = vi.fn(), copy = vi.fn();
        const context = { setTransform() {}, drawImage: copy, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, strokeRect: box };
        const renderer = Object.assign(Object.create(Renderer.prototype), {
            mini: context, minimap: { clientWidth: 200, clientHeight: 100, width: 200, height: 100 },
            minimapContent: { width: 200, height: 100 }, drawMinimapContent: content,
            minimapProjection: { x: 0, y: 0, width: 200, height: 100, scale: 2, world: { x: 0, y: 0, width: 100, height: 50 } },
            width: 320, height: 240, zoom: 1, camera: { x: 30, y: 20 },
        });
        const state = { world: {}, time: 0, multiplayer: {} } as GameState, fog = {} as FogView;
        renderer.drawMinimap(state, fog);
        const firstBox = box.mock.calls[0];
        for (let frame = 1; frame <= 5; frame++) {
            clock.mockReturnValue(frame * 16); state.time += 4; renderer.camera.x++;
            renderer.drawMinimap({ ...state }, fog);
        }
        expect(content).toHaveBeenCalledOnce();
        expect(copy).toHaveBeenCalledTimes(6); expect(box).toHaveBeenCalledTimes(6);
        expect(box.mock.calls[5]).not.toEqual(firstBox);
        clock.mockReturnValue(CHECK_INTERVAL_MS - 1); renderer.drawMinimap(state, fog);
        expect(content).toHaveBeenCalledOnce();
        clock.mockReturnValue(CHECK_INTERVAL_MS); renderer.drawMinimap(state, fog);
        expect(content).toHaveBeenCalledTimes(2);
        renderer.minimap.clientWidth = 210; renderer.drawMinimap(state, fog);
        expect(content).toHaveBeenCalledTimes(3);
        renderer.drawMinimap({ ...state, world: {} } as GameState, fog);
        expect(content).toHaveBeenCalledTimes(4);
    });
});
