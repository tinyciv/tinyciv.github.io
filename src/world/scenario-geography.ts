import { rustEngine } from '../game/rust-engine';
import type { World } from '../game/types';

/** Copy native symmetry commands over an ordinary generated landscape. Rust
 * selects source cells and transforms directional/footprint metadata. */
export function mirrorScenarioLandscape(world: World): void {
  const handle = rustEngine.sim_create(261116), stairs = ['north', 'east', 'south', 'west'] as const;
  try {
    const pointer = rustEngine.sim_scenario_input(handle, world.tiles.length * 7, world.width, world.height);
    const input = new Float64Array(rustEngine.memory.buffer, pointer, world.tiles.length * 7);
    world.tiles.forEach((tile, cell) => input.set([tile.drainage ?? -1, tile.channelNext ?? -1,
      tile.oreAnchor ?? -1, tile.oreWidth ?? 1, tile.geothermalAnchor ?? -1,
      tile.stair ? stairs.indexOf(tile.stair) : -1, tile.resourceGroup ?? -1], cell * 7));
    const output = rustEngine.sim_scenario_symmetry(handle);
    const rows = new Float64Array(rustEngine.memory.buffer, output, world.tiles.length * 8).slice();
    const source = world.tiles;
    const features = world.worldFeatures ?? [];
    const featureAnchors = new Map(features.map(feature => [feature.id, Math.floor(feature.y) * world.width + Math.floor(feature.x)]));
    const featuresAt = new Map(features.map(feature => [Math.floor(feature.y) * world.width + Math.floor(feature.x), feature]));
    world.tiles = source.map((_, cell) => {
      const at = cell * 8, tile = { ...source[rows[at]] };
      tile.drainage = rows[at + 1] < 0 ? undefined : rows[at + 1];
      tile.channelNext = rows[at + 2] < 0 ? undefined : rows[at + 2];
      tile.oreAnchor = rows[at + 3] < 0 ? undefined : rows[at + 3];
      tile.geothermalAnchor = rows[at + 5] < 0 ? undefined : rows[at + 5];
      tile.stair = stairs[rows[at + 6]];
      tile.resourceGroup = rows[at + 7] < 0 ? undefined : rows[at + 7];
      return tile;
    });
    // The same native link transform carries landscape feature identities.
    // Cell-address IDs keep the mirrored metadata and tile labels in sync.
    const metadataPointer=rustEngine.sim_scenario_input(handle,source.length*7,world.width,world.height);
    const metadata=new Float64Array(rustEngine.memory.buffer,metadataPointer,source.length*7);
    metadata.fill(-1);
    source.forEach((tile,cell)=>{
      metadata[cell*7]=featureAnchors.get(tile.worldFeature??-1)??-1;
      metadata[cell*7+5]=1;
    });
    const metadataOutput=rustEngine.sim_scenario_symmetry(handle);
    const mirrored=new Float64Array(rustEngine.memory.buffer,metadataOutput,source.length*8).slice();
    world.worldFeatures=[];
    world.tiles.forEach((tile,cell)=>{
      const feature=featuresAt.get(mirrored[cell*8]);
      if(feature)world.worldFeatures!.push({...feature,id:cell+1,
        x:cell%world.width+(feature.x-Math.floor(feature.x))*[0,1,0,-1][mirrored[cell*8+6]],y:feature.y});
      tile.worldFeature=mirrored[cell*8+1]<0?undefined:mirrored[cell*8+1]+1;
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
