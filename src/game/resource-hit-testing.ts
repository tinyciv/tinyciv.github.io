import { isVisible } from './fog';
import { resourceHasArt } from './resource-art';
import { rockOreAtPoint } from './rock-range-art';
import { buildingHeight, buildingPresent, buildingWidth, type GameState, type Point } from './types';

/** Select the visible resource tile. Callers retain unit/building priority. */
export function resourceAtPoint(state: GameState, point: Point): Point | undefined {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    const { world } = state, x = Math.floor(point.x), y = Math.floor(point.y);
    if (x < 0 || x >= world.width || y < 0 || y >= world.height) return;
    const tile = world.tiles[y * world.width + x];
    if (!resourceHasArt(tile) || rockOreAtPoint(world, tile, point) === false || !isVisible(state, x + .5, y + .5)) return;
    if (state.fields?.some(field => field.x === x && field.y === y)
        || state.buildings.some(building => buildingPresent(building) && !['road', 'bridge', 'irrigation'].includes(building.kind)
            && x >= building.x && x < building.x + buildingWidth(building)
            && y >= building.y && y < building.y + buildingHeight(building))) return;
    return { x, y };
}
