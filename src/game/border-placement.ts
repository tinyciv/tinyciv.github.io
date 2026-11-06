import { playerFaction } from './player-context';
import { buildingWidth, buildingHeight, isFarmKind, isWallKind, type BuildingKind, type GameState } from './types';
import { insideOwnBorders, territory, type Territory } from './borders';

/** Village reservations apply even to infrastructure normally allowed outside
 * faction borders. The village's own construction may still develop its land. */
export function buildingOverlapsVillageBorders(state: GameState, kind: BuildingKind, x: number, y: number, faction = playerFaction(state), borders?: Territory): boolean {
    if (!state.villages?.length || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const villageFactions = new Set(state.villages.filter(village => !village.destroyed && village.faction !== faction).map(village => village.faction));
    if (!villageFactions.size) return false;
    borders ??= territory(state);
    for (let dy = 0; dy < buildingHeight({ kind }); dy++) for (let dx = 0; dx < buildingWidth({ kind }); dx++) {
        const tx = Math.floor(x) + dx, ty = Math.floor(y) + dy;
        if (tx >= 0 && ty >= 0 && tx < borders.width && ty < borders.height && villageFactions.has(borders.owners[ty * borders.width + tx])) return true;
    }
    return false;
}

/** Farms, infrastructure, walls and ballistae may extend beyond claims, but
 * their complete reserved footprint must still fit the world. Towers and guard
 * posts require owned territory; unfinished sources cannot grant themselves land. */
export function buildingWithinBorders(state: GameState, kind: BuildingKind, x: number, y: number, faction = playerFaction(state), borders?: Territory): boolean {
    if (faction < 0 || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    x = Math.floor(x); y = Math.floor(y);
    const farm = isFarmKind(kind), width = buildingWidth({ kind }), height = buildingHeight({ kind });
    if (x < 0 || y < 0 || x + width > state.world.width || y + height > state.world.height) return false;
    if (buildingOverlapsVillageBorders(state, kind, x, y, faction, borders)) return false;
    if (farm || isWallKind(kind) || kind === 'road' || kind === 'bridge' || kind === 'irrigation' || kind === 'ballista') return true;
    borders ??= territory(state);
    if (kind === 'palace') {
        for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) {
            const owner = borders.owners[(y + dy) * state.world.width + x + dx];
            if (owner >= 0 && owner !== faction) return false;
        }
        return true;
    }
    for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++)
        if (!insideOwnBorders(state, faction, x + dx + .5, y + dy + .5, borders)) return false;
    return true;
}
