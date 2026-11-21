import { rustEngine } from '../game/rust-engine';
import type { World } from '../game/types';
import { clearRockFormation, ROCK_FORMATION_SIZES } from './rock-formations';

const SYMMETRY_INPUT_STRIDE = 6;
const SYMMETRY_OUTPUT_STRIDE = 7;

/** Copy native symmetry commands over an ordinary generated landscape. Rust
 * selects source cells and transforms directional/footprint metadata. */
export function mirrorScenarioLandscape(world: World): void {
  const handle = rustEngine.sim_create(261116);
  try {
    const inputLength = world.tiles.length * SYMMETRY_INPUT_STRIDE;
    const outputLength = world.tiles.length * SYMMETRY_OUTPUT_STRIDE;
    const pointer = rustEngine.sim_scenario_input(handle, inputLength, world.width, world.height);
    const input = new Float64Array(rustEngine.memory.buffer, pointer, inputLength);
    world.tiles.forEach((tile, cell) => input.set([tile.drainage ?? -1, tile.channelNext ?? -1,
      tile.oreAnchor ?? -1, tile.oreWidth ?? 1, tile.geothermalAnchor ?? -1, tile.resourceGroup ?? -1], cell * SYMMETRY_INPUT_STRIDE));
    const output = rustEngine.sim_scenario_symmetry(handle);
    const rows = new Float64Array(rustEngine.memory.buffer, output, outputLength).slice();
    const source = world.tiles;
    const features = world.worldFeatures ?? [];
    const featureAnchors = new Map(features.map(feature => [feature.id, Math.floor(feature.y) * world.width + Math.floor(feature.x)]));
    const featuresAt = new Map(features.map(feature => [Math.floor(feature.y) * world.width + Math.floor(feature.x), feature]));
    world.tiles = source.map((_, cell) => {
      const at = cell * SYMMETRY_OUTPUT_STRIDE, tile = { ...source[rows[at]] };
      tile.drainage = rows[at + 1] < 0 ? undefined : rows[at + 1];
      tile.channelNext = rows[at + 2] < 0 ? undefined : rows[at + 2];
      tile.oreAnchor = rows[at + 3] < 0 ? undefined : rows[at + 3];
      tile.geothermalAnchor = rows[at + 4] < 0 ? undefined : rows[at + 4];
      tile.resourceGroup = rows[at + 5] < 0 ? undefined : rows[at + 5];
      return tile;
    });
    // The same native link transform carries landscape feature identities.
    // Cell-address IDs keep the mirrored metadata and tile labels in sync.
    const metadataPointer=rustEngine.sim_scenario_input(handle,inputLength,world.width,world.height);
    const metadata=new Float64Array(rustEngine.memory.buffer,metadataPointer,inputLength);
    metadata.fill(-1);
    source.forEach((tile,cell)=>{
      const at = cell * SYMMETRY_INPUT_STRIDE;
      metadata[at]=featureAnchors.get(tile.worldFeature??-1)??-1;
      if (tile.rockHost !== undefined) {
        const host = source[tile.rockHost];
        if (host.rockFormation !== undefined) {
          metadata[at + 2] = tile.rockHost;
          metadata[at + 3] = ROCK_FORMATION_SIZES[host.rockFormation][0];
          metadata[at + 4] = host.rockOre ?? -1;
        }
      }
    });
    const metadataOutput=rustEngine.sim_scenario_symmetry(handle);
    const mirrored=new Float64Array(rustEngine.memory.buffer,metadataOutput,outputLength).slice();
    world.worldFeatures=[];
    world.tiles.forEach((tile,cell)=>{
      const at = cell * SYMMETRY_OUTPUT_STRIDE;
      const feature=featuresAt.get(mirrored[at]);
      if(feature)world.worldFeatures!.push({...feature,id:cell+1,
        x:cell%world.width+(feature.x-Math.floor(feature.x))*mirrored[at + 6],y:feature.y});
      tile.worldFeature=mirrored[at + 1]<0?undefined:mirrored[at + 1]+1;
      const previousHost = tile.rockHost;
      if (previousHost === undefined) return;
      const host = mirrored[at + 3];
      if (host < 0) {
        clearRockFormation(tile);
        if (tile.resource === 'copper' || tile.resource === 'iron' || tile.resource === 'gold' || tile.resource === 'coal') {
          delete tile.resource; delete tile.resourceGroup; delete tile.resourceDeveloped;
          delete tile.oreAnchor; delete tile.oreWidth; delete tile.oreHeight; delete tile.oreFamily; delete tile.oreVariant;
        }
        return;
      }
      tile.rockHost = host;
      delete tile.rockOre; delete tile.rockFormation; delete tile.rockAlternate; delete tile.rockMirror;
      if (cell !== host) return;
      const original = source[previousHost];
      const section = mirrored[at + 4];
      tile.rockFormation = original.rockFormation;
      if (section >= 0) tile.rockOre = section;
      if (original.rockAlternate && section < 0) tile.rockAlternate = true;
      tile.rockMirror = (cell % world.width >= world.width / 2) !== !!original.rockMirror;
    });
    world.revision = (world.revision ?? 0) + 1;
    // This complete authored landscape must not receive a later asymmetric
    // startup placement pass over the planner's reserved city footprints.
    world.geothermalGenerated = true;
  } finally { rustEngine.sim_drop(handle); }
}

/** Terrain transport only: Rust shapes the requested strait before the ordinary
 * coastline, relief, river, biome and resource stages consume the land mask. */
export function applyScenarioOceanChannel(land: Uint8Array, width: number, height: number, channelWidth: number): void {
  const handle = rustEngine.sim_create(261116);
  try {
    const pointer = rustEngine.sim_scenario_input(handle, land.length, width, height);
    new Float64Array(rustEngine.memory.buffer, pointer, land.length).set(land);
    const result = rustEngine.sim_scenario_channel(handle, channelWidth);
    land.set(new Float64Array(rustEngine.memory.buffer, result, land.length));
  } finally { rustEngine.sim_drop(handle); }
}
