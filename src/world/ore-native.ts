import { rustEngine } from '../game/rust-engine';
import { reliefBuildable, reliefGroundWalkable } from '../game/relief';
import { isFord, WATER, type Tile, type World } from '../game/types';
import { resourceBlocksGround } from '../game/resource-terrain';
import { seededRandom, terrainYields } from './generator';
import { clearRockFormation, ROCK_ARRANGEMENTS, ROCK_RANGE_LENGTHS, varyRockArt } from './rock-formations';

const depositResources = ['copper', 'iron', 'gold', 'marble', 'peat', 'grapes', 'coal'] as const;
const INPUT_STRIDE = 7;
const OUTPUT_STRIDE = 12;
const ROCK_TREE = 1 << 4;
const RANGE_GAP = 1 << 5;
const RANGE_ID_SCALE = 1 << 6;
const RIVER_WATER = 1, NARROW_CHANNEL = 2, FORD_ACCESS = 4, FJORD_SHORE = 8, FJORD_ROCK = 16;
const starterOre = (tile: Tile): boolean => tile.resource === 'copper' || tile.resource === 'iron' || tile.resource === 'gold';

function clearDepositSurface(tile: Tile): void {
  if (tile.overlay !== 'none') {
    const before = terrainYields(tile.terrain, tile.overlay), after = terrainYields(tile.terrain, 'none');
    for (const yieldKind of ['food', 'production', 'gold'] as const)
      tile[yieldKind] = Math.max(0, tile[yieldKind] + after[yieldKind] - before[yieldKind]);
    tile.overlay = 'none';
  }
  delete tile.palm; delete tile.marsh; delete tile.treeClass; delete tile.desertStone;
}

/** Native habitat bits: salt=1, fish-bearing water=2, available dry ground=4. */
export function resourceHabitats(world: World): Float64Array {
  const n = world.tiles.length, pointer = rustEngine.ore_input(n);
  const input = new Float64Array(rustEngine.memory.buffer, pointer, n);
  world.tiles.forEach((tile, cell) => {
    input[cell] = tile.geothermal || tile.overlay === 'volcano' || tile.overlay === 'glacier' ? 4
      : tile.terrain === 'ocean' ? 3 : WATER.has(tile.terrain) ? 2 : tile.terrain === 'tundra' ? 1 : 0;
  });
  const output = rustEngine.resource_habitats(world.width, world.height);
  return new Float64Array(rustEngine.memory.buffer, output, n).slice();
}
export const saltPanLimit = (): number => rustEngine.resource_group_limit(6);

function fordAccessMask(world: World): Uint8Array {
  const { width, height, tiles } = world;
  const access = new Uint8Array(tiles.length);
  tiles.forEach((tile, cell) => {
    if (!isFord(tile)) return;
    access[cell] = 1;
    const x = cell % width, y = Math.floor(cell / width);
    const axes = tile.fordAxis === 'horizontal' ? [[1, 0]] : tile.fordAxis === 'vertical' ? [[0, 1]] : [[1, 0], [0, 1]];
    for (const [dx, dy] of axes) for (const sign of [-1, 1]) for (let distance = 1; distance <= 2; distance++) {
      const nx = x + sign * distance * dx, ny = y + sign * distance * dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) break;
      const next = ny * width + nx;
      if (WATER.has(tiles[next].terrain) || tiles[next].creek) break;
      access[next] = 1;
    }
  });
  return access;
}

/** Transport only: native ECS owns deposit placement, footprints and access. */
export function assignOreDeposits(world: World, cores: Uint8Array, tutorial = false, marbleSites?: Uint8Array): number {
  const n = world.tiles.length, pointer = rustEngine.ore_input(n * INPUT_STRIDE);
  const input = new Float64Array(rustEngine.memory.buffer, pointer, n * INPUT_STRIDE);
  if (tutorial) {
    const removed = new Set<number>();
    world.tiles.forEach((tile, cell) => {
      if (tile.rockOre !== undefined && starterOre(world.tiles[tile.rockOre])) removed.add(cell);
    });
    for (const tile of world.tiles) if (tile.rockHost !== undefined && removed.has(tile.rockHost)) clearRockFormation(tile);
  }
  const starts = new Map<number, number>();
  world.spawns.forEach((point, faction) => starts.set(Math.floor(point.y) * world.width + Math.floor(point.x), faction + 1));
  world.secondarySpawns?.forEach((point, index) => starts.set(Math.floor(point.y) * world.width + Math.floor(point.x), index + 2));
  const fordAccess = fordAccessMask(world);
  world.tiles.forEach((tile, cell) => {
    const x = cell % world.width, y = Math.floor(cell / world.width);
    const dry = !WATER.has(tile.terrain) && !tile.creek;
    const walk = !tile.waterfall && (dry || tile.terrain === 'river' && tile.overlay === 'ford');
    const replacedOre = tutorial && starterOre(tile);
    const depositGround = dry && !tile.waterfall && !cores[cell] && reliefBuildable(tile) && (!tile.resource||replacedOre) && !tile.beach
      && tile.rockHost === undefined && !tile.rockRangeGap && !tile.geothermal && tile.farm === undefined
      && ['none', 'forest', 'jungle'].includes(tile.overlay);
    const eligible = depositGround && !tile.marsh;
    const accessible = walk && (!resourceBlocksGround(tile) || replacedOre)
      && reliefGroundWalkable(world, x, y) && tile.overlay !== 'volcano' && tile.overlay !== 'glacier';
    const rockSite = eligible && accessible && !tile.worldFeature && !tile.villageTrail;
    const river = tile.terrain === 'river' && !tile.delta && !tile.waterfall;
    const placement = (river ? RIVER_WATER : 0)
      | (river && tile.channel && (tile.channelWidth ?? 1) <= 3 ? NARROW_CHANNEL : 0)
      | (fordAccess[cell] ? FORD_ACCESS : 0)
      | (tile.fjord === 'shore' ? FJORD_SHORE : 0)
      | (tile.fjord === 'rock' ? FJORD_ROCK : 0);
    input.set([Number(accessible) | Number(eligible) << 1
      | Number(tile.overlay === 'forest' || tile.overlay === 'jungle') << 2
      | Number(tutorial && starts.has(cell)) << 3
      | Number(!!marbleSites?.[cell]) << 4
      | Number(depositGround) << 5
      | Number(rockSite) << 6
      | (starts.get(cell) ?? 0) << 7,
      tile.elevation, ['grassland', 'plains', 'desert', 'tundra'].indexOf(tile.terrain), Number(dry),
      tile.temperature ?? .5, tile.moisture, placement], cell * INPUT_STRIDE);
  });
  let seed = 2166136261; for (const ch of `${world.seed}:ore`) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
  const firstGroup = tutorial ? world.tiles.reduce((max, tile) => Math.max(max, tile.resourceGroup ?? 0), 0) + 1 : 1;
  const result = rustEngine.ore_generate(world.width, world.height, seed >>> 0, firstGroup, Number(tutorial));
  const rows = new Float64Array(rustEngine.memory.buffer, result, n * OUTPUT_STRIDE);
  const bareAnchors: number[] = [];
  let nextGroup = firstGroup;
  for (let cell = 0; cell < n; cell++) {
    const at = cell * OUTPUT_STRIDE, kind = rows[at], tile = world.tiles[cell];
    if (tutorial && starterOre(tile)) {
      delete tile.resource; delete tile.resourceGroup; delete tile.resourceDeveloped;
      delete tile.oreAnchor;delete tile.oreFamily;delete tile.oreVariant;delete tile.oreWidth;delete tile.oreHeight;
    }
    const shape = rows[at + 7], host = rows[at + 8], section = rows[at + 9], policy = rows[at + 10], detail = rows[at + 11];
    if (shape) {
      tile.rockFormation = (shape - 1) as Tile['rockFormation'];
      if (!section) bareAnchors.push(cell);
    }
    if (section) tile.rockOre = section - 1;
    if (host) {
      tile.rockHost = host - 1;
      if (policy) tile.rockRelief = (policy - 1) as Tile['rockRelief'];
      clearDepositSurface(tile);
    }
    const arrangement = detail & (ROCK_TREE - 1);
    if (arrangement) {
      const marker = arrangement - 1, orientations = ROCK_ARRANGEMENTS.length;
      tile.rockArrangement = ROCK_ARRANGEMENTS[marker % orientations];
      tile.rockRangeLength = ROCK_RANGE_LENGTHS[Math.floor(marker / orientations)];
    }
    if (detail & ROCK_TREE) tile.rockTree = true;
    const range = Math.floor(detail / RANGE_ID_SCALE);
    if (range) tile.rockRangeId = range - 1;
    if (detail & RANGE_GAP) {
      tile.rockRangeGap = tile.terrain === 'river' ? 'river' : 'dry';
      if (tile.rockRangeGap === 'dry') clearDepositSurface(tile);
    }
    const resource = depositResources[kind - 1];
    if (!resource) continue;
    tile.resource = resource;
    tile.resourceGroup = rows[at + 1]; tile.oreAnchor = rows[at + 2]; tile.oreFamily = rows[at + 3] as Tile['oreFamily'];
    tile.oreVariant = rows[at + 4] as 0 | 1; tile.oreWidth = rows[at + 5]; tile.oreHeight = rows[at + 6];
    if (!host) clearDepositSurface(tile);
    nextGroup = Math.max(nextGroup, tile.resourceGroup + 1);
  }
  varyRockArt(world, bareAnchors, seededRandom(`${world.seed}:rock-art`));
  return nextGroup;
}
