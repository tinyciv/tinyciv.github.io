import { afterEach, describe, expect, it, vi } from 'vitest';
import { Renderer } from '../src/game/renderer';
import { BuildingActivityPopup } from '../src/ui/building-activity';
import { CHECK_INTERVAL_MS } from '../src/game/work-cadence';
import type { Building, GameState } from '../src/game/types';
import * as borders from '../src/game/borders';
import * as enclosures from '../src/game/enclosures';
import * as research from '../src/game/research';
import * as villages from '../src/game/village-marker';
import * as trade from '../src/game/river-trade';
import * as activity from '../src/game/building-activity';

afterEach(() => vi.restoreAllMocks());

describe('presentation observation cadence', () => {
    it('samples global presentation queries at most 3 Hz regardless of game speed or network frames', () => {
        const queries = [
            vi.spyOn(borders, 'territory').mockReturnValue({} as ReturnType<typeof borders.territory>),
            vi.spyOn(enclosures, 'palaceEnclosures').mockReturnValue({} as ReturnType<typeof enclosures.palaceEnclosures>),
            vi.spyOn(research, 'researchStatus').mockReturnValue({} as ReturnType<typeof research.researchStatus>),
            vi.spyOn(villages, 'alliedVillageCamps').mockReturnValue([]),
            vi.spyOn(trade, 'riverTradingPosts').mockReturnValue([]),
        ];
        const renderer = Object.create(Renderer.prototype);
        const state = { world: {}, time: 0, factions: [{ id: 0 }], multiplayer: {} } as GameState;
        const first = renderer.observePresentation(state, 0);
        for (let frame = 1; frame < 20; frame++) {
            // Authoritative multiplayer snapshots replace the state object.
            const next = { ...state, time: frame * 4 };
            expect(renderer.observePresentation(next, frame * 16)).toBe(first);
        }
        for (const query of queries) expect(query).toHaveBeenCalledOnce();
        expect(renderer.observePresentation(state, CHECK_INTERVAL_MS)).not.toBe(first);
        for (const query of queries) expect(query).toHaveBeenCalledTimes(2);
        renderer.observePresentation({ ...state, world: {} }, CHECK_INTERVAL_MS);
        for (const query of queries) expect(query).toHaveBeenCalledTimes(3);
    });

    it('keeps popup positioning smooth without rechecking availability each frame', () => {
        const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
        const available = vi.spyOn(activity, 'buildingActivityAvailable').mockReturnValue(true);
        vi.spyOn(activity, 'buildingActivityKind').mockReturnValue(undefined);
        const building = { id: 1, kind: 'house', hp: 100 } as Building;
        const state = { buildings: [building], units: [] } as unknown as GameState;
        const position = vi.fn();
        const popup = Object.assign(Object.create(BuildingActivityPopup.prototype), {
            buildingId: 1, nextRefreshAt: -Infinity, getState: () => state, position,
            element: { classList: { toggle() {} }, querySelector: () => ({}) },
        });
        popup.update(0);
        for (let frame = 1; frame < 20; frame++) { clock.mockReturnValue(frame * 16); popup.update(frame * 16); }
        expect(available).toHaveBeenCalledOnce();
        expect(position).toHaveBeenCalledTimes(20);
        clock.mockReturnValue(CHECK_INTERVAL_MS); popup.update(CHECK_INTERVAL_MS);
        expect(available).toHaveBeenCalledTimes(2);
    });
});
