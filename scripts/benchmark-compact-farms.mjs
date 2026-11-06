import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Real governor, construction, harvesting and movement. The only temporary
// instrumentation records deliveries and road-triggered field relocations.
const root = process.cwd(), out = path.join(root, 'scratch/2026-11-01-compact-farms');
await mkdir(out, { recursive: true });
const selected = process.argv.includes('--baseline-only') ? ['baseline'] : ['baseline', 'current'];
const modules = {}, report = [];
for (const version of selected) {
  const outfile = path.join(out, `simulation-${version}.mjs`);
  await build({ stdin: { contents: "export {createGame,updateGame} from './src/game/simulation.ts';export {entityStore} from './src/game/entity-store.ts';export {cityDevelopmentNeeds} from './src/game/governor.ts';export {isFarmKind} from './src/game/types.ts';", resolveDir: root },
    bundle: true, platform: 'node', format: 'esm', outfile,
    plugins: [{ name: 'controlled-before-after-and-counters', setup(b) {
      b.onLoad({ filter: /src\/game\/(traffic|farm-siting|farm-relocation|builders|simulation|food-cargo)\.ts$/ }, async args => {
        const name = path.basename(args.path);
        let contents = await readFile(version === 'baseline' && ['traffic.ts', 'farm-siting.ts', 'farm-relocation.ts', 'builders.ts'].includes(name)
          ? path.join(out, 'baseline', name) : args.path, 'utf8');
        if (version === 'baseline' && name === 'simulation.ts' && contents.includes("const roadBuilder = unit.kind === 'merchant';")) {
          contents = "import { isCampRoadBuilder } from './traffic';\n" + contents.replace("const roadBuilder = unit.kind === 'merchant';", "const roadBuilder = isCampRoadBuilder(state, unit) || unit.kind === 'merchant';");
        }
        if (name === 'farm-relocation.ts') contents = contents.replace('  applyFarmRelocation(state, plan);\n  finishFarmRelocations(state);',
          '  if (options.road && state.__farmAudit) state.__farmAudit.roadRelocations++;\n  applyFarmRelocation(state, plan);\n  finishFarmRelocations(state);');
        if (name === 'food-cargo.ts') contents = contents.replace('  grantIncome(faction, { food: delivered });',
          '  if (state.__farmAudit && delivered > 0) { state.__farmAudit.deliveries++; state.__farmAudit.deliveredFood += delivered; }\n  grantIncome(faction, { food: delivered });');
        return { contents, loader: 'ts', resolveDir: path.dirname(args.path) };
      });
    } }],
  });
  modules[version] = await import(pathToFileURL(outfile).href);
}

function fieldGeometry(farms, width) {
  const cells = new Set(farms.map(b => b.y * width + b.x)), unseen = new Set(cells), sizes = [];
  let edges = 0, isolated = 0;
  for (const cell of cells) {
    const x = cell % width, neighbors = [cell - width, cell + width];
    if (x > 0) neighbors.push(cell - 1);
    if (x < width - 1) neighbors.push(cell + 1);
    if (!neighbors.some(n => cells.has(n))) isolated++;
    if (cells.has(cell + width)) edges++;
    if (x < width - 1 && cells.has(cell + 1)) edges++;
  }
  while (unseen.size) {
    const start = unseen.values().next().value, queue = [start]; unseen.delete(start);
    for (let i = 0; i < queue.length; i++) {
      const cell = queue[i], x = cell % width, neighbors = [cell - width, cell + width];
      if (x > 0) neighbors.push(cell - 1);
      if (x < width - 1) neighbors.push(cell + 1);
      for (const n of neighbors) if (unseen.delete(n)) queue.push(n);
    }
    sizes.push(queue.length);
  }
  sizes.sort((a, b) => b - a);
  return { components: sizes.length, isolated, largest: sizes[0] ?? 0, sharedEdges: edges,
    meanNeighbors: Number((2 * edges / Math.max(1, cells.size)).toFixed(3)), componentSizes: sizes };
}

const idle = { up: false, down: false, left: false, right: false };
for (const version of selected) for (const scenario of ['open', 'riverbank', 'patchy']) {
  const m = modules[version], width = 84, height = 60;
  const world = { width, height, seed: `farm-blocks-${scenario}`, source: 'controlled agricultural city', spawns: [{ x: 36, y: 30 }],
    tiles: Array.from({ length: width * height }, (_, cell) => {
      const x = cell % width, y = Math.floor(cell / width), river = scenario === 'riverbank' && x >= 41 && x <= 43 && y > 4 && y < 56;
      return { terrain: river ? 'river' : 'grassland', overlay: 'none', elevation: river ? .1 : .3, moisture: .5, food: river ? 0 : 3, production: 1, gold: 0, variation: .5,
        ...(scenario === 'patchy' ? { fertility: .5 + .2 * Math.sin(x * .6) + .15 * Math.cos(y * .4) } : {}) };
    }) };
  const s = m.createGame(world);
  s.raiderCamps = []; s.marauderPacks = []; s.fogRaids = { nextAt: 1e9, waves: 0 };
  m.entityStore(s).units.replace(s.units.filter(u => u.faction === 0 && u.villageId === undefined));
  m.entityStore(s).buildings.replace(s.buildings.filter(b => b.faction === 0 && b.villageId === undefined));
  s.factions = s.factions.filter(f => f.id === 0); s.villages = [];
  s.wildlife = { herds: [], nextRespawnAt: 1e9, sequence: 0, targetHerds: 0 };
  s.factions[0].nextRaid = 1e9; s.factions[0].nextRetinueAt = 1e9;
  const palace = s.buildings.find(b => b.kind === 'palace'); palace.governorPermissions = { farms: true, housing: true };
  s.__farmAudit = { roadRelocations: 0, deliveries: 0, deliveredFood: 0 };
  const initialFarmIds = new Set(s.buildings.filter(b => m.isFarmKind(b.kind)).map(b => b.id)), completed = new Set(), builders = new Set(), collectors = new Set();
  const initialRoads = s.buildings.filter(b => b.kind === 'road').length, initialFarms = initialFarmIds.size;
  const initialPositions = new Map(s.buildings.filter(b => m.isFarmKind(b.kind)).map(b => [b.id, `${b.x},${b.y}`])), moved = new Set();
  const row = { version, scenario, initialRoads, initialFarms, snapshots: [] }, started = performance.now();
  function snapshot() {
    const farms = s.buildings.filter(b => m.isFarmKind(b.kind) && b.hp > 0), f = s.factions[0];
    return { time: Math.round(s.time), population: f.population, gold: Number(f.gold.toFixed(2)), food: Number(f.food.toFixed(2)),
      farms: farms.length, readyFarms: farms.filter(b => !b.construction).length, pending: s.buildings.filter(b => b.construction).length,
      roads: s.buildings.filter(b => b.kind === 'road').length, newFarmCompletions: completed.size,
      foodCapacity: Number(m.cityDevelopmentNeeds(s, palace).foodCapacity.toFixed(2)), ...fieldGeometry(farms, width),
      ...s.__farmAudit, deliveredFood: Number(s.__farmAudit.deliveredFood.toFixed(2)) };
  }
  row.snapshots.push(snapshot());
  for (let second = 1; second <= 600; second++) {
    m.updateGame(s, 1, idle);
    for (const b of s.buildings) if (m.isFarmKind(b.kind)) {
      if (!b.construction && !initialFarmIds.has(b.id)) completed.add(b.id);
      if (initialPositions.has(b.id) && initialPositions.get(b.id) !== `${b.x},${b.y}`) moved.add(b.id);
      initialPositions.set(b.id, `${b.x},${b.y}`);
    }
    for (const u of s.units) { if (u.builder) builders.add(u.id); if (u.collector) collectors.add(u.id); }
    if (s.tradeRoutes?.length || s.units.some(u => u.kind === 'merchant')) throw Error('Unexpected caravan');
    if (s.gameOver) throw Error(`Unexpected game end: ${s.gameOver}`);
    if (second % 120 === 0) row.snapshots.push(snapshot());
  }
  row.elapsedMs = Math.round(performance.now() - started); row.builders = builders.size; row.collectors = collectors.size; row.movedFarmIds = moved.size;
  if (!row.builders || !row.collectors || !s.__farmAudit.deliveries || !completed.size) throw Error(`Agricultural fixture did not exercise all intended paths: ${JSON.stringify(row)}`);
  await writeFile(path.join(out, `${scenario}-${version}-state.json`), JSON.stringify(s));
  report.push(row); console.log(JSON.stringify(row));
}
await writeFile(path.join(out, selected.length === 1 ? 'baseline-results.json' : 'comparison.json'), JSON.stringify(report, null, 2));
