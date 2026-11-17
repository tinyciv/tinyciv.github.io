import { rustEngine } from '../game/rust-engine';
import type { World } from '../game/types';
import type { Drainage } from './hydrology';
function seedCode(seed: string): number {
    let code = 2166136261;
    for (let i = 0; i < seed.length; i++)
        code = Math.imul(code ^ seed.charCodeAt(i), 16777619);
    return code >>> 0;
}
export function riverResistance(width: number, height: number, seed: string, meander: number): Float64Array {
    const pointer = rustEngine.river_resistance(width, height, seedCode(seed), meander);
    return new Float64Array(rustEngine.memory.buffer, pointer, width * height).slice();
}
/** Transport only: Rust chooses catchments, source lengths, bends and oxbows. */
export function planNativeRivers(world: World, drainage: Drainage, target: number): {
    skeleton: Uint8Array;
    cutoffs: number[];
    catchments: number;
} {
    const count = world.tiles.length, pointer = rustEngine.river_input(count);
    const input = new Float64Array(rustEngine.memory.buffer, pointer, count * 5);
    world.tiles.forEach((tile, i) => input.set([drainage.directions[i], drainage.flow[i], tile.elevation,
        tile.rainfall ?? tile.moisture, tile.terrain === 'lake' ? 1 : tile.terrain === 'ocean' || tile.terrain === 'coast' ? 2 : 0], i * 5));
    const output = rustEngine.river_plan(world.width, world.height, target, seedCode(world.seed));
    const rows = new Float64Array(rustEngine.memory.buffer, output, 1 + count * 4).slice();
    const skeleton = new Uint8Array(count), cutoffs: number[] = [];
    world.tiles.forEach((tile, i) => {
        const offset = 1 + i * 4;
        tile.drainage = drainage.directions[i] = rows[offset];
        tile.flow = drainage.flow[i] = rows[offset + 1];
        skeleton[i] = rows[offset + 2];
        if (rows[offset + 3])
            cutoffs.push(i);
    });
    return { skeleton, cutoffs, catchments: rows[0] };
}
