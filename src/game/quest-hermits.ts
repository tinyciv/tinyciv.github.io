import { rustEngine } from './rust-engine';
import { territory } from './borders';
import { territoryValue } from './territory-cells';
import { terrainNavigationEdges, traversable } from './pathfinding';
import { buildingHeight, buildingWidth, type GameState, type Hermit } from './types';
/** Initial observations only; all placement decisions run in Rust. */
export function planHermitHomes(state: GameState): Hermit[] {
    const { world } = state, borders = territory(state), edges = terrainNavigationEdges(world);
    const buildings = state.buildings.filter(b => b.hp > 0), actor = state.multiplayer?.humanFactionIds[0] ?? 0;
    const capital = buildings.find(b => b.kind === 'palace' && b.faction === actor);
    let seed = 2166136261;
    for (const c of `${world.seed}:hermits`)
        seed = Math.imul(seed ^ c.charCodeAt(0), 16777619);
    const values: number[] = [world.width, world.height, seed >>> 0, buildings.length, capital?.x ?? -1, capital?.y ?? -1];
    world.tiles.forEach((tile, i) => {
        const walk = traversable(world, i % world.width, Math.floor(i / world.width));
        const flags = Number(tile.overlay !== 'none') | Number(!!tile.ridge) << 1 | Number(!!tile.stair) << 2 | Number(tile.terrain === 'river') << 3 | Number(!!tile.palm) << 4;
        values.push(flags, territoryValue(borders, i), edges[i], Number(walk));
    });
    for (const b of buildings)
        values.push(b.x, b.y, buildingWidth(b), buildingHeight(b), Number(b.raiderCamp !== undefined), Number(b.kind === 'bridge'));
    const pointer = rustEngine.hermit_plan_input(values.length);
    new Float64Array(rustEngine.memory.buffer, pointer, values.length).set(values);
    const output = rustEngine.hermit_plan(), count = new Float64Array(rustEngine.memory.buffer, output, 1)[0];
    const rows = new Float64Array(rustEngine.memory.buffer, output + 8, count * 2).slice();
    return Array.from({ length: count }, (_, i) => ({ id: i + 1, x: rows[i * 2], y: rows[i * 2 + 1], status: 'home' }));
}
