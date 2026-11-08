import { createNoise2D } from 'simplex-noise';
import { narrowHillPassage, ridgeEdgeAllowed, ridgeGroundWalkable, ridgeStairAccess } from '../game/ridges';
import { resourceBlocksGround } from '../game/resource-terrain';
import { WATER, type World } from '../game/types';
import { environmentRandom, settlementCoreMask, terrainDistance } from './environment-fields';
import { stonePlainsSites } from './stone-plains';

const CARDINAL = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
export const RESOURCE_GROUP_SIZES = { copper: [2, 18], iron: [2, 18], stone: [3, 24], olives: [4, 32], salt: [8, 50] } as const;
/** Minimum distance between the closest occupied tiles of distinct deposits. */
export const RESOURCE_GROUP_SEPARATION = 10;
type ClusterResource = keyof typeof RESOURCE_GROUP_SIZES;

/** Rotated seams, rounded outcrops, bent veins and irregular groves. Every
 * deposit has its own clear space, including deposits of different resources.
 * The independent seed stream never moves settlements or alters other world RNG. */
export function assignRegionalResources(world: World): void {
  const { width, height, tiles } = world, random = environmentRandom(`${world.seed}:resource-provinces`);
  const geology = createNoise2D(random), seams = createNoise2D(random);
  // Key each choice by location instead of consuming RNG only for eligible
  // cells: carving one tributary must not reshuffle distant forest clearings.
  const layoutSeed = Math.floor(environmentRandom(`${world.seed}:resource-layout`)() * 0x100000000);
  const sample = (resource: ClusterResource, cell: number, salt = 0): number => {
    let value = cell ^ layoutSeed ^ Math.imul(resource.charCodeAt(0) + resource.length * 31, 0x45d9f3b) ^ Math.imul(salt, 0x27d4eb2d);
    value = Math.imul(value ^ value >>> 16, 0x7feb352d);
    value = Math.imul(value ^ value >>> 15, 0x846ca68b);
    return ((value ^ value >>> 16) >>> 0) / 0x100000000;
  };
  const fresh = terrainDistance(world, tile => tile.terrain === 'river' || tile.terrain === 'lake', 5);
  const coast = terrainDistance(world, tile => tile.terrain === 'coast' || tile.terrain === 'ocean', 8);
  const land = terrainDistance(world, tile => !WATER.has(tile.terrain), 5), cores = settlementCoreMask(world);
  const stoneSites = stonePlainsSites(world);
  // Starting layouts need clear ground beyond the settlement's own footprint.
  for (const site of [...world.spawns, ...(world.secondarySpawns ?? [])])
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const x = Math.floor(site.x) + dx, y = Math.floor(site.y) + dy;
      if (x >= 0 && y >= 0 && x < width && y < height) cores[y * width + x] = 1;
    }
  for (const tile of tiles) { delete tile.resource; delete tile.resourceGroup; delete tile.resourceDeveloped; }
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height ? y * width + x : -1;
  const neighbors = (cell: number) => CARDINAL.map(([dx, dy]) => at(cell % width + dx, Math.floor(cell / width) + dy)).filter(next => next >= 0);
  const usable = new Uint8Array(tiles.length);
  let dryLand = 0;
  for (let cell = 0; cell < tiles.length; cell++) {
    const tile = tiles[cell], x = cell % width, y = Math.floor(cell / width);
    usable[cell] = Number(!cores[cell] && !WATER.has(tile.terrain) && !tile.creek && !ridgeStairAccess(world, x, y) && !narrowHillPassage(world, x, y)
      && !tile.mountainPass && !tile.marsh && tile.farm === undefined && ridgeGroundWalkable(world, x, y));
    if (usable[cell]) dryLand++;
    if (cores[cell] || tile.stair || tile.mountainPass) continue;
    const patch = .5 + geology(x * .047, y * .047) * .34 + seams(x * .16 + 29, y * .16 - 37) * .16;
    if (patch < .67) continue;
    if (WATER.has(tile.terrain)) {
      if (tile.terrain !== 'ocean' && land[cell] <= 3 && (tile.temperature ?? .5) > .2) tile.resource = 'fish';
    } else if (fresh[cell] <= 3 && !tile.ridge && (tile.fertility ?? .5) > .5) tile.resource = 'clay';
  }
  let nextGroup = 1;
  const excluded = new Uint8Array(tiles.length);
  const separationOffsets: [number, number][] = [];
  for (let dy = -RESOURCE_GROUP_SEPARATION; dy <= RESOURCE_GROUP_SEPARATION; dy++)
    for (let dx = -RESOURCE_GROUP_SEPARATION; dx <= RESOURCE_GROUP_SEPARATION; dx++)
      if (dx * dx + dy * dy < RESOURCE_GROUP_SEPARATION ** 2) separationOffsets.push([dx, dy]);
  const habitat = (resource: ClusterResource, cell: number): boolean => {
    const tile = tiles[cell];
    if (!usable[cell] || excluded[cell] || tile.resource) return false;
    if (resource === 'salt') return !tile.ridge && coast[cell] <= 6 && tile.moisture < .58;
    if (resource === 'olives') return (tile.terrain === 'grassland' || tile.terrain === 'plains')
      && (tile.temperature ?? .6) >= .35 && (tile.temperature ?? .6) <= .85 && tile.moisture >= .22 && tile.moisture <= .76;
    // Keep the continuous sandy shore walkable; coastal salt pans are flat,
    // but ore and stone are solid obstacles.
    if (tile.beach) return false;
    if (resource === 'stone') return !!stoneSites[cell];
    if (resource === 'iron') return !!tile.ridge || tile.elevation > .51;
    return tile.terrain !== 'tundra' && (tile.elevation > .34 || !!tile.ridge);
  };
  const priority = (resource: ClusterResource, cell: number): number => {
    const tile = tiles[cell], x = cell % width, y = Math.floor(cell / width);
    const province = geology(x * .033 + (resource === 'iron' ? 170 : 0), y * .033 - 83);
    if (resource === 'salt') return coast[cell] * .05 + tile.moisture;
    if (resource === 'olives') return Math.abs(tile.moisture - .48) - province * .18;
    // Prefer exposed uplands, but allow lower open ground when mountain
    // shelves occupy every high site (notably the Mediterranean map).
    const lowStone = resource === 'stone' && tile.elevation <= .51 ? 2 : 0;
    return lowStone - tile.elevation * .3 - province * .25;
  };
  const grow = (resource: ClusterResource, start: number, target: number): number[] => {
    const sx = start % width, sy = Math.floor(start / width), selected = new Set<number>([start]), candidates = new Map<number, number>();
    const highStone = resource === 'stone' && tiles[start].elevation > .51;
    const mode = Math.floor(sample(resource, start, 2) * 4), angle = sample(resource, start, 3) * Math.PI;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const aspect = mode === 0 ? 1 : 1.6 + sample(resource, start, 4) * 2.8;
    const length = Math.sqrt(target * aspect), radius = Math.ceil(length) + 2;
    const bend = mode === 2 ? (sample(resource, start, 5) - .5) * length * .75 : 0;
    const roughness = mode === 3 ? 4.5 : mode === 0 ? .8 : 1.6;
    const shapeScore = (dx: number, dy: number, cell: number): number => {
      const along = dx * cos + dy * sin, across = -dx * sin + dy * cos;
      const curve = across - bend * Math.sin(along / length * Math.PI);
      // The lobed mode grows two irregular shoulders around a narrow connected
      // waist; frontier growth keeps every patch developable with one click.
      const lobe = mode === 3 ? Math.min((along - length * .28) ** 2, (along + length * .28) ** 2) : along * along;
      return lobe / aspect + curve * curve * aspect + sample(resource, cell, start + 1) * roughness;
    };
    const add = (cell: number) => {
      for (const next of neighbors(cell)) {
        if (selected.has(next) || candidates.has(next) || !habitat(resource, next) || highStone && tiles[next].elevation <= .51
          ) continue;
        const dx = next % width - sx, dy = Math.floor(next / width) - sy;
        if (Math.max(Math.abs(dx), Math.abs(dy)) > radius) continue;
        candidates.set(next, shapeScore(dx, dy, next));
      }
    };
    add(start);
    while (selected.size < target && candidates.size) {
      let next = -1, best = Infinity;
      for (const [candidate, score] of candidates) if (score < best) { best = score; next = candidate; }
      candidates.delete(next); selected.add(next); add(next);
    }
    return [...selected];
  };
  // Blocking deposits must leave all previously connected approaches linked.
  // A local perimeter detour proves this without flooding the whole map for
  // every candidate, and prevents sealing a ford, land neck or stair route.
  const keepsApproachesConnected = (cells: number[]): boolean => {
    const removed = new Set(cells), approaches = new Set<number>();
    const ground = (cell: number) => {
      const tile = tiles[cell];
      return !removed.has(cell) && !resourceBlocksGround(tile) && tile.overlay !== 'volcano' && tile.overlay !== 'glacier'
        && (!WATER.has(tile.terrain) || tile.terrain === 'river' && tile.overlay === 'ford')
        && ridgeGroundWalkable(world, cell % width, Math.floor(cell / width));
    };
    const linked = (a: number, b: number) => ridgeEdgeAllowed(world,
      { x: a % width, y: Math.floor(a / width) }, { x: b % width, y: Math.floor(b / width) });
    // Woodland guarantees an exposed, usable cell beside each remaining tree.
    // A rocky deposit can preserve overall connectivity while consuming that
    // tree's last clearing, so check this separately from the detour flood.
    for (const cell of cells) for (const tree of neighbors(cell)) {
      if (removed.has(tree) || tiles[tree].overlay !== 'forest') continue;
      if (!neighbors(tree).some(open => ground(open) && tiles[open].overlay === 'none' && linked(tree, open))) return false;
    }
    let x0 = width, x1 = 0, y0 = height, y1 = 0;
    for (const cell of cells) {
      const x = cell % width, y = Math.floor(cell / width);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const next of neighbors(cell)) if (ground(next) && linked(cell, next)) approaches.add(next);
    }
    if (approaches.size < 2) return true;
    x0 = Math.max(0, x0 - 2); x1 = Math.min(width - 1, x1 + 2);
    y0 = Math.max(0, y0 - 2); y1 = Math.min(height - 1, y1 + 2);
    const queue = [approaches.values().next().value!], visited = new Set(queue);
    approaches.delete(queue[0]);
    for (let head = 0; head < queue.length && approaches.size; head++) for (const next of neighbors(queue[head])) {
      const x = next % width, y = Math.floor(next / width);
      if (x < x0 || x > x1 || y < y0 || y > y1 || visited.has(next) || !ground(next) || !linked(queue[head], next)) continue;
      visited.add(next); approaches.delete(next); queue.push(next);
    }
    return approaches.size === 0;
  };
  const perArea: Record<ClusterResource, number> = { copper: 1100, iron: 1400, stone: 1500, olives: 1000, salt: 2200 };
  const plans = (['salt', 'copper', 'iron', 'stone', 'olives'] as const).map(resource => {
    const candidates = tiles.flatMap((_, cell) => habitat(resource, cell) ? [{ cell, score: priority(resource, cell) + sample(resource, cell) * .6 }] : []);
    candidates.sort((a, b) => a.score - b.score || a.cell - b.cell);
    return { resource, candidates, cursor: 0, count: 0, desired: Math.max(1, Math.round(dryLand / perArea[resource])) };
  });
  // Interleave types so a dense run of one ore cannot use every spaced site
  // before the other resources receive their first deposit.
  for (let round = 0; round < Math.max(...plans.map(plan => plan.desired)); round++) for (const plan of plans) {
    const { resource, candidates } = plan, [minimum, maximum] = RESOURCE_GROUP_SIZES[resource];
    if (plan.count >= plan.desired) continue;
    while (plan.cursor < candidates.length) {
      const { cell } = candidates[plan.cursor++];
      if (!habitat(resource, cell)) continue;
      // Many modest deposits plus occasional large finds, rather than every
      // patch converging on the same middle-sized circle.
      const target = minimum + Math.floor(sample(resource, cell, 1) ** 1.45 * (maximum - minimum + 1));
      const cells = grow(resource, cell, target);
      if (cells.length < minimum || (resource === 'copper' || resource === 'iron' || resource === 'stone') && !keepsApproachesConnected(cells)) continue;
      const group = nextGroup++; plan.count++;
      for (const next of cells) {
        const tile = tiles[next]; tile.resource = resource; tile.resourceGroup = group;
        tile.overlay = 'none'; delete tile.palm; delete tile.marsh; delete tile.treeClass;
        const x = next % width, y = Math.floor(next / width);
        for (const [dx, dy] of separationOffsets) {
          const near = at(x + dx, y + dy);
          if (near >= 0) excluded[near] = 1;
        }
      }
      break;
    }
  }
}
