import { describe, expect, it } from 'vitest';
import { buildingEffectCells, buildingPlacementEffect } from '../src/game/building-aoe';
import { borderRadius } from '../src/game/borders';
import { WOODEN_TOWER_RANGE } from '../src/game/tower-combat';
import { WELL_RADIUS } from '../src/game/wells';
import { IRRIGATION_RADIUS } from '../src/game/irrigation';
import { HEALER_SHACK_RADIUS } from '../src/game/healer-shack';
import type { GameState, Point } from '../src/game/types';

const world = { width: 40, height: 32 };
const origin = { x: 16, y: 16 };
const cellKeys = (cells: Point[]) => new Set(cells.map(({ x, y }) => `${x},${y}`));
const nonEffectModes: GameState['buildMode'][] = [null, 'road', 'bridge', 'wall', 'palisade', 'camp', 'clearTrees', 'tower'];

describe('building placement area of effect', () => {
    it.each([
        { kind: 'well' as const, radius: WELL_RADIUS, beneficial: true, diagonalInside: 5, diagonalOutside: 6 },
        { kind: 'irrigation' as const, radius: IRRIGATION_RADIUS, beneficial: true, diagonalInside: 1, diagonalOutside: 2 },
        { kind: 'healerShack' as const, radius: HEALER_SHACK_RADIUS, beneficial: true, diagonalInside: 2, diagonalOutside: 3 },
        { kind: 'woodenTower' as const, radius: WOODEN_TOWER_RANGE, beneficial: false, diagonalInside: 4, diagonalOutside: 5 },
    ])('shows the inclusive radial boundary of $kind using its gameplay radius', ({ kind, radius, beneficial, diagonalInside, diagonalOutside }) => {
        const effect = buildingPlacementEffect(kind)!;
        expect(effect).toEqual({ radius, beneficial });
        const cells = cellKeys(buildingEffectCells(world, [origin], effect.radius));
        expect(cells.has('16,16')).toBe(true);
        for (const [dx, dy] of [[radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
            expect(cells.has(`${origin.x + dx},${origin.y + dy}`)).toBe(true);
        }
        expect(cells.has(`${origin.x + radius + 1},${origin.y}`)).toBe(false);
        expect(cells.has(`${origin.x + diagonalInside},${origin.y + diagonalInside}`)).toBe(true);
        expect(cells.has(`${origin.x + diagonalOutside},${origin.y + diagonalOutside}`)).toBe(false);
    });

    it('shows the full green observation sight preview, clipped at the viewport', () => {
        expect(buildingPlacementEffect('observationPost')).toEqual({ radius: 21, beneficial: true });
        const cells = cellKeys(buildingEffectCells({ width: 80, height: 80 }, [{ x: 40, y: 40 }], 21));
        expect(cells.has('61,40')).toBe(true); expect(cells.has('62,40')).toBe(false);
        expect(cells.has('54,54')).toBe(true); expect(cells.has('55,55')).toBe(false);
    });

    it('expands monument coverage exactly at culture thresholds', () => {
        const initial = buildingPlacementEffect('monument', 0)!;
        const before = buildingPlacementEffect('monument', 99.999)!;
        const expanded = buildingPlacementEffect('monument', 100)!;
        expect(initial).toEqual({ radius: borderRadius('monument', 0), beneficial: true });
        expect(before).toEqual(initial);
        expect(expanded).toEqual({ radius: borderRadius('monument', 100), beneficial: true });
        const initialCells = cellKeys(buildingEffectCells(world, [origin], initial.radius));
        const expandedCells = cellKeys(buildingEffectCells(world, [origin], expanded.radius));
        expect(initialCells.has('20,16')).toBe(true);
        expect(initialCells.has('21,16')).toBe(false);
        expect(expandedCells.has('21,16')).toBe(true);
        expect(expandedCells.has('21,17')).toBe(true);
        expect(expandedCells.has('21,18')).toBe(false);
        expect([...initialCells].every(key => expandedCells.has(key))).toBe(true);
    });

    it('includes the beneficial border coverage supplied by houses', () => {
        const initial = buildingPlacementEffect('house')!;
        const expanded = buildingPlacementEffect('house', 100)!;
        expect(initial).toEqual({ radius: borderRadius('house'), beneficial: true });
        expect(expanded.radius).toBe(borderRadius('house', 100));
        const initialCells = cellKeys(buildingEffectCells(world, [origin], initial.radius));
        const expandedCells = cellKeys(buildingEffectCells(world, [origin], expanded.radius));
        expect(initialCells.has('19,17')).toBe(true);
        expect(initialCells.has('19,18')).toBe(false);
        expect(expandedCells.has('19,18')).toBe(true);
    });

    it('clips the full coverage to map edges and the visible viewport', () => {
        const map = { width: 5, height: 4 };
        const full = buildingEffectCells(map, [{ x: 0, y: 0 }], WELL_RADIUS);
        expect(full).toHaveLength(20);
        expect(cellKeys(full)).toContain('0,0');
        expect(cellKeys(full)).toContain('4,3');
        const visible = buildingEffectCells(map, [{ x: 0, y: 0 }], WELL_RADIUS,
            { left: 2, right: 4, top: 1, bottom: 3 });
        expect(cellKeys(visible)).toEqual(new Set(['2,1', '3,1', '2,2', '3,2']));
        expect(buildingEffectCells(map, [{ x: 0, y: 0 }], 1,
            { left: 3, right: 5, top: 2, bottom: 4 })).toEqual([]);
    });

    it('paints overlapping dragged placements once and snaps the origin to its cell', () => {
        const a = { x: 10, y: 10 }, b = { x: 12, y: 10 };
        const first = buildingEffectCells(world, [a], WOODEN_TOWER_RANGE);
        const second = buildingEffectCells(world, [b], WOODEN_TOWER_RANGE);
        const combined = buildingEffectCells(world, [a, b, a, { x: 10.9, y: 10.2 }], WOODEN_TOWER_RANGE);
        expect(cellKeys(combined)).toEqual(cellKeys([...first, ...second]));
        expect(combined).toHaveLength(cellKeys(combined).size);
        expect(combined.length).toBeLessThan(first.length + second.length);
    });

    it('does not project coverage from a hovered cell outside the world', () => {
        expect(buildingEffectCells(world, [{ x: -1, y: 16 }, { x: 40, y: 16 }, { x: 16, y: 32 }], WELL_RADIUS)).toEqual([]);
        expect(buildingEffectCells(world, [], WELL_RADIUS)).toEqual([]);
    });

    it('calculates nominal coverage without reading hidden terrain or entities', () => {
        const hiddenWorld = new Proxy(world, {
            get(target, property) {
                if (property !== 'width' && property !== 'height') throw new Error(`Read hidden data: ${String(property)}`);
                return target[property];
            },
        });
        expect(buildingEffectCells(hiddenWorld, [origin], 4)).toEqual(buildingEffectCells(world, [origin], 4));
    });

    it.each(nonEffectModes)
    ('does not add an area overlay for %s', kind => {
        expect(buildingPlacementEffect(kind, 300)).toBeUndefined();
    });
});
