import { rustEngine } from './rust-engine';
import { simCore } from './sim-handle';
import { markWorldChanged } from './world-revisions';
import { WATER, type GameState, type Tile } from './types';

/** One startup command. Placement, density, clearances, spacing and variant
 * selection belong to the ECS; this adapter packs terrain and mirrors results. */
export function initializeGeothermal(state: GameState, seed: number): void {
    const world = state.world;
    if (world.geothermalGenerated) return;
    const starts = [...world.spawns, ...(world.secondarySpawns ?? [])];
    const core = simCore(state), count = world.tiles.length;
    const pointer = rustEngine.sim_geothermal_input(core.handle, count, starts.length);
    const input = new Float64Array(rustEngine.memory.buffer, pointer, (count + starts.length) * 2);
    for (let cell = 0; cell < count; cell++) {
        const tile = world.tiles[cell];
        input[cell * 2] = WATER.has(tile.terrain) ? 0 : tile.overlay === 'forest' || tile.overlay === 'jungle' ? 2 : 1;
        input[cell * 2 + 1] = Number(!!tile.resource || tile.rockHost !== undefined) | Number(!!tile.relief) << 1
            | Number(!!tile.waterfall) << 3 | Number(!!tile.creek) << 4 | Number(!!tile.palm) << 5
            | Number(!!tile.marsh) << 6 | Number(!!tile.beach) << 7 | Number(!!tile.geothermal) << 8
            | Number(!!tile.villageTrail) << 9 | Number(tile.overlay === 'volcano' || tile.overlay === 'glacier' || tile.overlay === 'ford') << 10
            // Reserve the forest canopy and the open routes that cross it.
            | Number(!!tile.relief) << 11 | Number(!!tile.worldFeature) << 12 | Number(tile.biome === 'forest') << 13;
    }
    starts.forEach((start, i) => { input[(count + i) * 2] = start.x; input[(count + i) * 2 + 1] = start.y; });
    const result = rustEngine.sim_geothermal_generate(core.handle, world.width, world.height, starts.length, seed);
    const placed = new Float64Array(rustEngine.memory.buffer, result, 1)[0];
    const output = new Float64Array(rustEngine.memory.buffer, result, 1 + placed * 2);
    const changed: number[] = [];
    for (let i = 0; i < placed; i++) {
        const anchor = output[1 + i * 2], variant = output[2 + i * 2] as NonNullable<Tile['geothermal']>;
        for (const offset of [0, 1, world.width, world.width + 1]) {
            const cell = anchor + offset, tile = world.tiles[cell];
            tile.geothermal = variant; tile.geothermalAnchor = anchor;
            // This existing terrain layer blocks pathfinding, swept movement,
            // rowboats, settlement placement, roads, bridges and farms alike.
            tile.overlay = 'volcano';
            tile.food = tile.production = tile.gold = 0;
            delete tile.desertStone;
            delete tile.treeClass;
            changed.push(cell);
        }
    }
    world.geothermalGenerated = true;
    if (changed.length) markWorldChanged(world, 'geometry', changed);
}
