import { describe, expect, it, vi } from 'vitest';
import { NativeArt } from '../src/game/native-art';

describe('atlas eviction', () => {
    it('does not notify the scene when every extra page is in use', () => {
        const atlases = Array.from({ length: 12 }, () => ({ used: 10 }));
        const art = new NativeArt(); Object.assign(art, { atlases, frame: 10 });
        const release = vi.fn();
        expect(art.prune(release)).toEqual([]);
        expect(release).not.toHaveBeenCalled();
        expect(art.atlasPages).toBe(12);
    });

    it('releases retained references once before destroying any texture', () => {
        const events: string[] = [], cache = new Map();
        const atlases = Array.from({ length: 10 }, (_, i) => {
            cache.set(String(i), { art: { texture: { destroy() { events.push(`texture:${i}`); } } } });
            return { used: i < 2 ? 9 : 10, source: { id: i }, keys: [String(i)] };
        });
        const art = new NativeArt(); Object.assign(art, { atlases, frame: 10, cache });
        expect(art.prune(() => events.push('release'))).toEqual([{ id: 0 }, { id: 1 }]);
        expect(events).toEqual(['release', 'texture:0', 'texture:1']);
        expect(art.atlasPages).toBe(8); expect(cache.size).toBe(8);
    });
});
