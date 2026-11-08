import { isVisible } from './fog';
import { resourceHasArt } from './resource-art';
import { buildingHeight, buildingPresent, buildingWidth, type GameState, type Point } from './types';

/** Resource figures use the same tile scale and olive variant as the renderer.
 * Check southern footings first: a tall crown can cover the northern tile.
 * Callers retain unit/building priority before opening the resource popup. */
export function resourceAtPoint(state: GameState, point: Point): Point | undefined {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    const { world } = state, x = Math.floor(point.x), row = Math.floor(point.y);
    if (x < 0 || x >= world.width) return;
    for (let y = row + 1; y >= row; y--) {
        if (y < 0 || y >= world.height) continue;
        const tile = world.tiles[y * world.width + x];
        if (!resourceHasArt(tile) || !isVisible(state, x + .5, y + .5)) continue;
        const tallOlive = tile.resource === 'olives' && (Math.floor(tile.variation * 0x1000000) & 1) !== 0;
        const top = y - Number(tallOlive);
        if (point.y < top || point.y >= y + 1) continue;
        if (state.fields?.some(field => field.x === x && field.y === y)
            || state.buildings.some(building => buildingPresent(building) && !['road', 'bridge', 'irrigation'].includes(building.kind)
                && x >= building.x && x < building.x + buildingWidth(building)
                && y >= building.y && y < building.y + buildingHeight(building))) continue;
        return { x, y };
    }
    return undefined;
}
