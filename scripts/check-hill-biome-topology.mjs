import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const folder = 'scratch/2026-11-07-tiered-hill-biomes';
await mkdir(folder, { recursive: true });
const bundle = await build({ stdin: { contents: `
  export * from './dev/hill-biome-review/model';
  export { generateWorld } from './src/world/generator';
  export { traversable, canTraverseEdge } from './src/game/pathfinding';
  export { ridgeGroundWalkable, ridgeIsLedge, ridgeLevel, ridgeStairAccess, STAIR_UP } from './src/game/ridges';
  export { WATER } from './src/game/types';
`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm' });
const bundlePath = resolve(`${folder}/topology-model.snapshot.mjs`);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const api = await import(pathToFileURL(bundlePath).href);
const { WATER, traversable, canTraverseEdge, ridgeGroundWalkable, ridgeIsLedge, ridgeLevel, ridgeStairAccess, STAIR_UP } = api;
const cardinal = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const neighbors = [...cardinal, [1, 1], [1, -1], [-1, 1], [-1, -1]];
const inside = (world, x, y) => x >= 0 && y >= 0 && x < world.width && y < world.height;
const wooded = tile => tile.overlay === 'forest' || tile.overlay === 'jungle';
const point = (world, cell) => ({ x: cell % world.width, y: Math.floor(cell / world.width) });
const inBounds = (world, cell, bounds) => {
  const { x, y } = point(world, cell);
  return x >= bounds.x && y >= bounds.y && x < bounds.x + bounds.width && y < bounds.y + bounds.height;
};

/** Components use production terrain and edge rules, not the review's metrics. */
function components(world, eligible, directions = neighbors) {
  const owner = new Int32Array(world.tiles.length).fill(-1), groups = [];
  for (let start = 0; start < world.tiles.length; start++) {
    if (owner[start] >= 0 || !eligible(start)) continue;
    const cells = [start], id = groups.length; owner[start] = id;
    for (let head = 0; head < cells.length; head++) {
      const from = point(world, cells[head]);
      for (const [dx, dy] of directions) {
        const to = { x: from.x + dx, y: from.y + dy }, next = to.y * world.width + to.x;
        if (!inside(world, to.x, to.y) || owner[next] >= 0 || !eligible(next) || !canTraverseEdge(world, from, to)) continue;
        owner[next] = id; cells.push(next);
      }
    }
    groups.push(cells);
  }
  return { owner, groups };
}

/** Ignore translation, rotation and reflection when counting distinct shapes. */
function silhouette(world, cells) {
  const points = cells.map(cell => point(world, cell)), forms = [];
  for (const swap of [false, true]) for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const points2 = points.map(p => [sx * (swap ? p.y : p.x), sy * (swap ? p.x : p.y)]);
    const x0 = Math.min(...points2.map(p => p[0])), y0 = Math.min(...points2.map(p => p[1]));
    forms.push(points2.map(([x, y]) => [x - x0, y - y0]).sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(p => p.join(',')).join(';'));
  }
  return forms.sort()[0];
}

/** Maximal low-floor spans bounded by two different hills. Count each cross
 * section once; do not call open plains or a hill's own inlet a corridor. */
function corridorSections(world, bounds, hillIds) {
  const histogram = {}, samples = [];
  for (const horizontal of [false, true]) {
    const outer = horizontal ? [bounds.y, bounds.y + bounds.height] : [bounds.x, bounds.x + bounds.width];
    const inner = horizontal ? [bounds.x, bounds.x + bounds.width] : [bounds.y, bounds.y + bounds.height];
    for (let line = outer[0]; line < outer[1]; line++) {
      let prior;
      for (let along = inner[0]; along < inner[1]; along++) {
        const x = horizontal ? along : line, y = horizontal ? line : along, cell = y * world.width + x;
        if (!inside(world, x, y)) { prior = undefined; continue; }
        const tile = world.tiles[cell];
        if (tile.ridge && hillIds.has(tile.ridge)) {
          if (prior && prior.id !== tile.ridge && along > prior.along + 1) {
            const width = along - prior.along - 1;
            histogram[width] = (histogram[width] ?? 0) + 1;
            if (samples.length < 100) samples.push({ x, y, horizontal, width, ids: [prior.id, tile.ridge] });
          }
          prior = { id: tile.ridge, along };
        } else if (!traversable(world, x, y) || WATER.has(tile.terrain) || tile.ridge || tile.stair) prior = undefined;
      }
    }
  }
  const total = Object.values(histogram).reduce((sum, count) => sum + count, 0);
  const narrow = [1, 2, 3].reduce((sum, width) => sum + (histogram[width] ?? 0), 0);
  return { histogram, total, narrow, narrowShare: total ? narrow / total : 0, samples };
}

function audit(scene, base) {
  const { world } = scene, checks = [], regions = [];
  const check = (name, pass, detail) => checks.push({ name, pass: !!pass, ...(detail === undefined ? {} : { detail }) });
  const changedWater = [], changedBeach = [];
  for (let cell = 0; cell < world.tiles.length; cell++) {
    const tile = world.tiles[cell], before = base.tiles[cell];
    if ((WATER.has(tile.terrain) || WATER.has(before.terrain)) && tile.terrain !== before.terrain) changedWater.push(cell);
    if (!!tile.beach !== !!before.beach) changedBeach.push(cell);
  }
  check('water types and coastline are preserved', !changedWater.length, changedWater.slice(0, 20));
  check('beach geography is preserved', !changedBeach.length, changedBeach.slice(0, 20));
  const walkable = cell => { const p = point(world, cell); return traversable(world, p.x, p.y); };
  const low = components(world, cell => !world.tiles[cell].ridge && walkable(cell), cardinal);
  const all = components(world, walkable);
  const ridgeCells = new Map();
  world.tiles.forEach((tile, cell) => {
    if (!tile.ridge) return;
    const cells = ridgeCells.get(tile.ridge) ?? []; cells.push(cell); ridgeCells.set(tile.ridge, cells);
  });
  for (const region of scene.regions) {
    const hillIds = new Set(scene.hills.filter(hill => hill.region === region.id).map(hill => hill.id));
    const hills = [...hillIds].map(id => ({ id, cells: ridgeCells.get(id) ?? [] }));
    const lowCounts = low.groups.map(cells => cells.filter(cell => inBounds(world, cell, region.bounds)).length);
    const mainLow = lowCounts.indexOf(Math.max(...lowCounts));
    const mainStart = low.groups[mainLow]?.[0], mainAll = mainStart === undefined ? -1 : all.owner[mainStart];
    const invalidRamps = [], isolatedRamps = [], blockedLandings = [], inaccessibleFloors = [], unsupported = [];
    const hillAudits = hills.map(hill => {
      const floors = [], ramps = [];
      for (const cell of hill.cells) {
        const tile = world.tiles[cell], p = point(world, cell);
        if (!tile.stair && ridgeGroundWalkable(world, p.x, p.y)) {
          floors.push(cell); if (all.owner[cell] !== mainAll) inaccessibleFloors.push(cell);
        }
        let supported = false;
        for (const dx of [-1, 0]) for (const dy of [-1, 0]) {
          const x = p.x + dx, y = p.y + dy;
          if (inside(world, x, y) && inside(world, x + 1, y + 1)
            && [y * world.width + x, y * world.width + x + 1, (y + 1) * world.width + x, (y + 1) * world.width + x + 1]
              .every(next => world.tiles[next].ridge === hill.id)) supported = true;
        }
        if (!supported) unsupported.push(cell);
        if (!tile.stair) continue;
        ramps.push(cell);
        const up = STAIR_UP[tile.stair], lowPoint = { x: p.x - up.x, y: p.y - up.y }, highPoint = { x: p.x + up.x, y: p.y + up.y };
        const lowCell = lowPoint.y * world.width + lowPoint.x;
        if (!ridgeGroundWalkable(world, p.x, p.y) || !traversable(world, p.x, p.y)
          || !canTraverseEdge(world, lowPoint, p) || !canTraverseEdge(world, p, highPoint)
          || !canTraverseEdge(world, highPoint, p) || !canTraverseEdge(world, p, lowPoint)) invalidRamps.push(cell);
        if (ridgeLevel(tile) === 1 && low.owner[lowCell] !== mainLow) isolatedRamps.push(cell);
        for (const q of [lowPoint, p, highPoint]) {
          const next = q.y * world.width + q.x, landing = world.tiles[next];
          if (!inside(world, q.x, q.y) || !traversable(world, q.x, q.y) || WATER.has(landing.terrain)
            || wooded(landing) || landing.marsh || landing.palm) blockedLandings.push(next);
        }
      }
      return { id: hill.id, area: hill.cells.length, floorArea: floors.length, ramps: ramps.length,
        upperCells: hill.cells.filter(cell => ridgeLevel(world.tiles[cell]) === 2).length,
        upperFloors: floors.filter(cell => ridgeLevel(world.tiles[cell]) === 2).length,
        upperRamps: ramps.filter(cell => ridgeLevel(world.tiles[cell]) === 2).length,
        accessible: !!floors.length && floors.every(cell => all.owner[cell] === mainAll) };
    });
    const corridors = corridorSections(world, region.bounds, hillIds);
    const sizes = new Set(hillAudits.map(hill => hill.area)), shapes = new Set(hills.filter(hill => hill.cells.length).map(hill => silhouette(world, hill.cells)));
    const accessible = hillAudits.filter(hill => hill.accessible).length;
    const vegetation = { trees: 0, adjacentOpen: 0, solid2x2: 0, treesOnLedges: [], treesOnStairAccess: [] };
    for (let cell = 0; cell < world.tiles.length; cell++) {
      if (!inBounds(world, cell, region.bounds) || !wooded(world.tiles[cell])) continue;
      const p = point(world, cell); vegetation.trees++;
      if (ridgeIsLedge(world, p.x, p.y)) vegetation.treesOnLedges.push(cell);
      if (ridgeStairAccess(world, p.x, p.y)) vegetation.treesOnStairAccess.push(cell);
      if (cardinal.some(([dx, dy]) => {
        const q = { x: p.x + dx, y: p.y + dy };
        return inside(world, q.x, q.y) && traversable(world, q.x, q.y) && !wooded(world.tiles[q.y * world.width + q.x])
          && canTraverseEdge(world, p, q);
      })) vegetation.adjacentOpen++;
      if (inside(world, p.x + 1, p.y + 1) && [cell, cell + 1, cell + world.width, cell + world.width + 1].every(next => wooded(world.tiles[next]))) vegetation.solid2x2++;
    }
    check(`${region.id}: many varied hill bodies`, hills.length >= 15 && sizes.size >= 6 && shapes.size >= 6, { hills: hills.length, sizes: sizes.size, shapes: shapes.size });
    const tiered = hillAudits.filter(hill => hill.upperCells > 0);
    check(`${region.id}: occasional two-level hills`, tiered.length >= 2 && tiered.length / hills.length <= .25, { twoLevel: tiered.length, total: hills.length });
    check(`${region.id}: every upper summit has its own accessible ramp`, tiered.every(hill => hill.upperFloors > 0 && hill.upperRamps > 0 && hill.accessible), tiered);
    const areas=hillAudits.map(hill=>hill.area).sort((a,b)=>a-b),p10=areas[Math.floor(areas.length*.1)],p90=areas[Math.floor(areas.length*.9)];
    check(`${region.id}: small knolls and larger hill footprints coexist`,
      hillAudits.filter(hill => hill.area < 30).length >= hills.length * .1 && p90/p10 >= 3 && Math.max(...sizes)>=150,
      { small: hillAudits.filter(hill => hill.area < 30).length, p10, p90, min: Math.min(...sizes), max: Math.max(...sizes) });
    check(`${region.id}: every authored contour has native two-cell support`, !unsupported.length, unsupported.slice(0, 20));
    check(`${region.id}: all ramps are legal in both directions`, !invalidRamps.length, invalidRamps.slice(0, 20));
    check(`${region.id}: all base ramps join the principal low-ground component`, !isolatedRamps.length, isolatedRamps.slice(0, 20));
    check(`${region.id}: all ramp landings are dry and clear`, !blockedLandings.length, blockedLandings.slice(0, 20));
    check(`${region.id}: all usable summit floors are accessible`, !inaccessibleFloors.length, inaccessibleFloors.slice(0, 20));
    check(`${region.id}: most hill bodies are accessible`, accessible / hills.length >= .85, { accessible, hills: hills.length });
    check(`${region.id}: most hill-to-hill cross sections are 1–3 tiles`, corridors.total >= 10 && corridors.narrowShare >= .5, { histogram: corridors.histogram, narrowShare: corridors.narrowShare });
    check(`${region.id}: forest avoids ledges and ramp access`, !vegetation.treesOnLedges.length && !vegetation.treesOnStairAccess.length, vegetation);
    if (region.id === 'forest') {
      check('forest: a perforated mesh of trees and open ground', vegetation.trees >= 30 && !vegetation.solid2x2 && vegetation.adjacentOpen === vegetation.trees, vegetation);
    }
    regions.push({ id: region.id, hillCount: hills.length, accessibleHillShare: accessible / hills.length,
      distinctAreas: sizes.size, distinctSilhouettes: shapes.size, hillAudits, corridors,
      lowGroundComponents: lowCounts.filter(Boolean).sort((a, b) => b - a), vegetation });
  }
  return { seed: world.seed, valid: checks.every(check => check.pass), checks, regions };
}

const audits = [], globalChecks = [], geography = [];
try {
  for (const definition of api.REVIEW_WORLDS) {
    const start = performance.now(), scene = api.generateHillWorld(definition), world = scene.world;
    const base = api.generateWorld(definition.seed, world.width, world.height, {
      ...api.BASE_WORLD_OPTIONS, style: definition.style, landformFamily: definition.family,
    });
    const result = audit(scene, base); result.elapsedMs = Math.round(performance.now() - start); audits.push(result);
    geography.push(JSON.stringify(world.tiles.map(tile => [tile.terrain, tile.ridge, tile.stair, tile.overlay])));
    console.log(JSON.stringify({ seed: result.seed, passed: result.checks.filter(check => check.pass).length,
      checks: result.checks.length, issues: result.checks.filter(check => !check.pass),
      regions: result.regions.map(region => ({ id: region.id, hills: region.hillCount,
        accessible: region.accessibleHillShare, shapes: region.distinctSilhouettes,
        widths: region.corridors.histogram, narrowShare: region.corridors.narrowShare })) }));
  }
  globalChecks.push({ name: 'each world has distinct actual geography', pass: new Set(geography).size === api.REVIEW_WORLDS.length });
  const repeat = api.generateHillWorld(api.REVIEW_WORLDS[0]);
  globalChecks.push({ name: 'the same seed reconstructs identical terrain, hills, ramps and forest',
    pass: JSON.stringify(repeat.world.tiles.map(tile => [tile.terrain, tile.ridge, tile.stair, tile.overlay])) === geography[0] });
} finally {
  await writeFile(`${folder}/topology-checks.json`, JSON.stringify({ audits, checks: globalChecks }, null, 2));
}
const failures = [...globalChecks, ...audits.flatMap(audit => audit.checks.map(check => ({ ...check, seed: audit.seed })))].filter(check => !check.pass);
assert.equal(failures.length, 0, JSON.stringify(failures, null, 2));
console.log(`Topology checks passed: ${globalChecks.length + audits.reduce((sum, audit) => sum + audit.checks.length, 0)}.`);
