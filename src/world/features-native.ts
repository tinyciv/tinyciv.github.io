/** Transport only: native Bevy terrain authoring selects and shapes landscapes. */
import { rustEngine } from '../game/rust-engine';
import { reliefAllowsTrees, reliefFlags } from '../game/relief';
import { markWorldChanged } from '../game/world-revisions';
import { WATER, type World, type WorldFeatureKind } from '../game/types';
import { terrainYields } from './generator';
import { DEFAULT_LANDSCAPE_PARAMETERS } from './options';

const STRIDE = 20;
const TERRAINS = ['ocean', 'coast', 'river', 'lake', 'grassland', 'plains', 'desert', 'tundra'] as const;
const OVERLAYS = ['none', 'forest', 'jungle', 'swamp', 'glacier', 'volcano', 'ford'] as const;
const BIOMES = ['temperate', 'taiga', 'tundra', 'rainforest', 'savanna', 'steppe', 'desert', 'wetland', 'alpine'] as const;
const RESOURCES = [undefined, 'clay', 'copper', 'iron', 'gold', 'stone', 'salt', 'olives', 'fish', 'marble', 'peat', 'grapes', 'coal'] as const;
const KINDS: readonly WorldFeatureKind[] = ['atoll', 'harbor', 'oasis', 'old-river', 'volcanic-island'];
const CLEAR_FIELDS = ['resource', 'resourceGroup', 'resourceDeveloped', 'oreAnchor', 'oreFamily', 'oreVariant', 'oreWidth', 'oreHeight',
    'relief', 'reliefRegion', 'reliefFlags', 'reliefLevel', 'reliefSpeed', 'reliefRuggedness', 'reliefStyle',
    'ridge', 'ridgeTier', 'stair', 'mountainPass', 'hillBiome', 'canyon', 'treeClass', 'desertStone',
    'beach', 'palm', 'marsh', 'oxbow', 'lakeShape', 'geothermal', 'geothermalAnchor'] as const;

export function generateWorldFeatures(world: World): number {
    let seed = 2166136261;
    for (const character of `${world.seed}:world-features`) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
    const handle = rustEngine.sim_create(seed >>> 0);
    try {
        const starts = [...world.spawns, ...world.secondarySpawns ?? []];
        const count = world.tiles.length;
        const pointer = rustEngine.sim_world_features_input(handle, count * STRIDE + starts.length * 2 + 2);
        const input = new Float64Array(rustEngine.memory.buffer, pointer, count * STRIDE + starts.length * 2 + 2);
        world.tiles.forEach((tile, cell) => input.set([
            TERRAINS.indexOf(tile.terrain), OVERLAYS.indexOf(tile.overlay), tile.elevation, tile.moisture,
            tile.temperature ?? .55, tile.variation, Number(!!tile.ridge || !reliefAllowsTrees(tile)),
            tile.reliefRegion ?? 0, tile.reliefRuggedness ?? 0, BIOMES.indexOf(tile.biome ?? 'temperate'),
            RESOURCES.indexOf(tile.resource), Number(!!tile.beach) | Number(!!tile.palm) << 1 | Number(!!tile.marsh) << 2 | Number(!!tile.oxbow) << 3,
            tile.reliefStyle ?? 0, tile.rainfall ?? tile.moisture, tile.fertility ?? 1, 0,
            tile.channel === 'main' ? 2 : tile.channel === 'tributary' ? 1 : 0, Number(!!tile.creek), Number(!!tile.delta), reliefFlags(tile),
        ], cell * STRIDE));
        starts.forEach((point, index) => input.set([point.x, point.y], count * STRIDE + index * 2));
        const climate = world.generationParameters ?? DEFAULT_LANDSCAPE_PARAMETERS;
        input.set([climate.equatorPosition, climate.equatorWidth], count * STRIDE + starts.length * 2);
        const output = rustEngine.sim_world_features_generate(handle, world.width, world.height, seed >>> 0, starts.length);
        const header = new Float64Array(rustEngine.memory.buffer, output, 2).slice();
        const rows = new Float64Array(rustEngine.memory.buffer, output, 2 + count * STRIDE + header[0] * 6).slice();
        const changed: number[] = [];
        world.tiles.forEach((tile, cell) => {
            const row = rows.subarray(2 + cell * STRIDE, 2 + (cell + 1) * STRIDE);
            if (!row[15]) return;
            if (tile.channel || tile.creek || tile.delta || tile.terrain === 'river' || tile.overlay === 'ford')
                throw new Error('Native landscape authoring attempted to change an active waterway.');
            const previous = tile.terrain;
            for (const key of CLEAR_FIELDS) delete tile[key];
            tile.terrain = TERRAINS[row[0]]; tile.overlay = OVERLAYS[row[1]];
            tile.elevation = row[2]; tile.moisture = row[3]; tile.temperature = row[4]; tile.variation = row[5];
            tile.biome = BIOMES[row[9]]; tile.rainfall = row[13]; tile.fertility = row[14]; tile.worldFeature = row[15];
            if (tile.overlay === 'volcano') {
                // Native islands use the shared 2x2 geothermal footprint/art.
                tile.geothermal = row[12] as 1 | 2 | 3;
                tile.geothermalAnchor = row[7];
            }
            if (RESOURCES[row[10]]) tile.resource = RESOURCES[row[10]];
            if (row[11] & 1) tile.beach = true;
            if (row[11] & 2) tile.palm = true;
            if (row[11] & 4) tile.marsh = true;
            if (row[11] & 8) tile.oxbow = true;
            if (previous !== tile.terrain && WATER.has(tile.terrain)) { tile.drainage = -1; tile.flow = 0; }
            if (WATER.has(previous) && !WATER.has(tile.terrain)) { delete tile.drainage; delete tile.flow; }
            Object.assign(tile, terrainYields(tile.terrain, tile.overlay));
            if (tile.geothermal) tile.food = tile.production = tile.gold = 0;
            changed.push(cell);
        });
        let cursor = 2 + count * STRIDE;
        world.worldFeatures = Array.from({ length: header[0] }, () => {
            const [kind, id, x, y, radiusX, radiusY] = rows.subarray(cursor, cursor += 6);
            if (!KINDS[kind]) throw new Error('Unknown native world landscape.');
            return { kind: KINDS[kind], id, x, y, radiusX, radiusY };
        });
        if (changed.length) markWorldChanged(world, 'geometry', changed);
        return changed.length;
    } finally {
        rustEngine.sim_drop(handle);
    }
}
