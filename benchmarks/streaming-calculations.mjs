import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2), option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const baseline = option('--before'), output = path.resolve(option('--out', '/tmp/btv-streaming-comparison'));
if (!baseline) throw Error('Pass --before frozen-source-directory');
await mkdir(output, { recursive: true });
const makeCounters = () => ({ contributions: 0, evaluatedCells: 0, edgeCells: 0, economyBuildings: 0, economyUnits: 0, irrigationBuildings: 0, specialtyBuildings: 0, specialtySearches: 0 });
globalThis.__streamingBenchmark = makeCounters();
const reset = () => Object.assign(globalThis.__streamingBenchmark, makeCounters());
const counts = () => ({ ...globalThis.__streamingBenchmark });
const engines = {};
for (const [name, root] of [['before', path.resolve(baseline)], ['after', process.cwd()]]) {
  const outfile = path.join(output, `${name}.mjs`);
  await build({ stdin: { resolveDir: root, contents: `
export {benchmarkAllocateId,buildAt,validateBuildAt,advanceConstructionReconciliation} from './src/game/simulation.ts';
export {denseConstructionFixture} from './tests/helpers/construction-preview.ts';
export {recordBattleDeath} from './src/game/battle-morale.ts';
export {territory} from './src/game/borders.ts';
export {withSimulationReads} from './src/game/simulation-reads.ts';
export {entityStore} from './src/game/entity-store.ts';
export {citySummaries} from './src/game/cities.ts';
export {prepareIrrigation} from './src/game/irrigation.ts';
export {citySpecialties} from './src/game/regional-economy.ts';
export {createMinimapProjection,MinimapTerritoryMemory} from './src/game/minimap.ts';
export {StateDeltaEncoder} from './src/multiplayer/state-delta.ts';
export {fishingCityFoodPerEconomyCycle} from './src/game/fishing.ts';
export {markWorldChanged} from './src/game/world-revisions.ts';
${existsSync(path.join(root, 'src/game/cell-journal.ts')) ? "export {trackArray} from './src/game/cell-journal.ts';" : 'export const trackArray = () => ({publish(){}});'}` },
    bundle: true, platform: 'node', format: 'esm', outfile,
    plugins: [{ name: 'operation-counters', setup(context) {
      context.onLoad({ filter: /\/src\/game\/(simulation|borders|city-economy-index|irrigation|regional-economy)\.ts$/ }, async ({ path: filename }) => {
        let contents = await readFile(filename, 'utf8');
        if (filename.endsWith('/simulation.ts')) contents += contents.includes('function nextId(state: GameState)')
          ? '\nexport {nextId as benchmarkAllocateId};\n' : '\nexport const benchmarkAllocateId = (state: GameState) => entityStore(state).allocateId();\n';
        if (filename.endsWith('/borders.ts')) {
          contents = contents.replace('const terrain = world.tiles[cell]?.terrain;', 'globalThis.__streamingBenchmark.contributions++; const terrain = world.tiles[cell]?.terrain;');
          contents = contents.replace('const distance = footprint.costs[', 'globalThis.__streamingBenchmark.contributions++; const distance = footprint.costs[');
          contents = contents.replace('for (const cell of dirty) {', 'for (const cell of dirty) { globalThis.__streamingBenchmark.evaluatedCells++;');
          contents = contents.replace('const cell = y * width + x, faction = owners[cell];', 'globalThis.__streamingBenchmark.edgeCells++; const cell = y * width + x, faction = owners[cell];');
          contents = contents.replace('for (const cell of edgeDirty) {', 'for (const cell of edgeDirty) { globalThis.__streamingBenchmark.edgeCells++;');
        }
        if (filename.endsWith('/city-economy-index.ts')) {
          contents = contents.replace('for (const building of state.buildings) {', 'for (const building of state.buildings) { globalThis.__streamingBenchmark.economyBuildings++;');
          contents = contents.replace('for (const building of inputs.buildingsFor(selected)) {', 'for (const building of inputs.buildingsFor(selected)) { globalThis.__streamingBenchmark.economyBuildings++;');
          contents = contents.replace('for (const unit of state.units) {', 'for (const unit of state.units) { globalThis.__streamingBenchmark.economyUnits++;');
          contents = contents.replace('for (const unit of inputs.unitsFor(selected)) {', 'for (const unit of inputs.unitsFor(selected)) { globalThis.__streamingBenchmark.economyUnits++;');
        }
        if (filename.endsWith('/irrigation.ts')) contents = contents.replace('for (const building of state.buildings) {', 'for (const building of state.buildings) { globalThis.__streamingBenchmark.irrigationBuildings++;');
        if (filename.endsWith('/regional-economy.ts')) {
          contents = contents.replace(/state\.buildings\.map\(b => (`[^`]+`)\)/, 'state.buildings.map(b => { globalThis.__streamingBenchmark.specialtyBuildings++; return $1; })');
          contents = contents.replace('const queue: number[] = [],', 'globalThis.__streamingBenchmark.specialtySearches++; const queue: number[] = [],');
        }
        return { contents, loader: 'ts' };
      });
    } }],
  });
  engines[name] = await import(pathToFileURL(outfile).href);
}
const faction = id => ({ id, name: 'Review', color: '#f00', affinity: 100, relation: id ? 'war' : 'self', food: 100, gold: 100,
  production: 0, population: 0, culture: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1000, defeated: false });
const building = (id, kind, x, y) => ({ id, kind, x, y, faction: 0, hp: 100, maxHp: 100, capacity: kind === 'palace' ? 5 : 0 });
function fixture(size = 64) {
  return { world: { width: size, height: size, seed: 'streaming-review', source: 'test', spawns: [], revision: 0,
    tiles: Array.from({ length: size * size }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [], units: [], fields: [], factions: [faction(0)], time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [],
    selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'streaming-review', rngState: 1 };
}
const report = { method: 'Deterministic headless operation counts on the frozen working tree and current source. Initial caches are warmed except ID import. No game loop or rendering. Counters are inserted only into temporary bundles.', baseline: path.resolve(baseline), cpu: os.cpus()[0].model, results: {}, parity: {} };
const values = {};
for (const [name, e] of Object.entries(engines)) {
  const r = {}; report.results[name] = r;
  {
    let reads = 0; const state = { units: [], buildings: [] };
    for (let id = 1; id <= 10000; id++) state.buildings.push({ get id() { reads++; return id; } });
    for (let i = 0; i < 100; i++) { const id = e.benchmarkAllocateId(state); state.units.push({ get id() { reads++; return id; } }); }
    r.entityIds = { initialEntities: 10000, allocations: 100, idReads: reads };
  }
  {
    let visits = 0; const state = { time: 0, casualties: [] };
    state.casualties[Symbol.iterator] = function* () { for (let i = 0; i < this.length; i++) { visits++; yield this[i]; } };
    for (let i = 0; i < 500; i++) e.recordBattleDeath(state, { id: i, kind: 'warrior', hp: 0, faction: 0, x: 2, y: 2 });
    r.casualtyIndex = { deaths: 500, oldEventVisits: visits };
  }
  {
    const state = fixture(256); state.buildings.push(building(1, 'palace', 10, 10));
    for (let i = 0; i < 100; i++) state.buildings.push(building(i + 2, 'house', 30 + i % 10 * 15, 30 + Math.floor(i / 10) * 15));
    const before = e.withSimulationReads(state, () => e.territory(state)), old = before.owners.slice(); reset();
    e.entityStore(state).buildings.add(building(999, 'house', 31, 30));
    const result = e.withSimulationReads(state, () => e.territory(state)), work = counts();
    const view = { owners: result.owners, sources: result.sourceIds, alternates: result.alternateOwners,
      alternateSources: result.alternateSourceIds, radii: [...result.sourceRadii], edges: result.edges, paths: result.paths };
    values[name] = view;
    r.territory = { worldCells: 65536, changedOwners: result.owners.reduce((n, value, i) => n + Number(value !== old[i]), 0),
      contributions: work.contributions, evaluatedCells: work.evaluatedCells || 'full reconstruction', borderCellsScanned: work.edgeCells,
      oldSnapshotUnchanged: isDeepStrictEqual(before.owners, old) };
  }
  {
    const state = fixture(); state.buildings.push(building(1, 'palace', 4, 4));
    for (let i = 0; i < 2000; i++) state.buildings.push(building(i + 2, 'road', i % 64, 20 + Math.floor(i / 64)));
    for (let i = 0; i < 200; i++) state.units.push({ id: i + 3000, kind: 'worker', hp: 50, faction: 0, x: 20, y: 20 });
    e.withSimulationReads(state, () => e.citySummaries(state)); reset();
    const cities = e.withSimulationReads(state, () => { e.citySummaries(state); return e.citySummaries(state); });
    const work = counts(); r.liveEconomy = { unchangedReads: 2, buildingVisits: work.economyBuildings, unitVisits: work.economyUnits };
    report.parity[name + 'Economy'] = cities.map(({ palace, ...city }) => ({ palace: palace.id, ...city }));
    e.prepareIrrigation(state); reset(); state.time += .1; e.withSimulationReads(state, () => e.prepareIrrigation(state));
    r.irrigation = { topologyChanges: 0, elapsedSeconds: .1, buildingVisits: counts().irrigationBuildings };
    e.withSimulationReads(state, () => e.citySpecialties(state.world, state.buildings[0], state)); reset();
    e.withSimulationReads(state, () => e.citySpecialties(state.world, state.buildings[0], state));
    r.specialties = { cacheHitBuildingVisits: counts().specialtyBuildings };
    reset(); e.markWorldChanged(state.world, 'appearance', [4095]); e.withSimulationReads(state, () => e.citySpecialties(state.world, state.buildings[0], state));
    r.specialties.unrelatedAppearanceSearches = counts().specialtySearches;
  }
  {
    let reads = 0; const raw = Array(65536).fill(0), explored = new Proxy(raw, { get(a, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++; return Reflect.get(a, key, receiver);
    } });
    raw[0] = 1; const journal = e.trackArray(explored);
    e.createMinimapProjection(explored, 256, 256, 200, 200);
    const borders = { width: 256, height: 256, owners: new Int32Array(65536).fill(-1), revision: 1 };
    const fog = { explored, explorationRevision: 1 }, memory = new e.MinimapTerritoryMemory(); memory.update(borders, fog);
    raw[1] = 1; journal.publish([1]); fog.explorationRevision++; reads = 0;
    e.createMinimapProjection(explored, 256, 256, 200, 200);
    const projectionReads = reads; reads = 0; memory.update(borders, fog);
    r.minimap = { newlyExploredCells: 1, projectionExploredReads: projectionReads, memoryExploredReads: reads };
    const state = { world: {}, units: [], buildings: [], fog, multiplayer: { controls: { 0: { fog } } } };
    const encoder = new e.StateDeltaEncoder(state); reads = 0;
    if (!isDeepStrictEqual(encoder.encode(state), {})) throw Error('Expected an empty unchanged frame');
    r.multiplayer = { unchangedEncode: true, exploredCellReadsPerViewer: reads };
  }
  {
    const state = fixture(); state.time = 90; let visits = 0;
    for (let i = 0; i < 20; i++) state.buildings.push(building(i + 1, 'palace', i * 3, 4));
    state.fishing = { startedAt: 0, receipts: Array.from({ length: 100 }, (_, i) => ({ get city() { visits++; return i % 20 + 1; }, faction: 0, at: 80, food: 5 })) };
    for (const palace of state.buildings) e.fishingCityFoodPerEconomyCycle(state, palace.id);
    visits = 0; for (const palace of state.buildings) e.fishingCityFoodPerEconomyCycle(state, palace.id);
    r.fishingRates = { cities: 20, retainedReceipts: 100, steadyReceiptVisits: visits };
  }
  {
    const state = e.denseConstructionFixture(); Object.assign(state.units[0], {x:82.5,y:72.5});
    const commits = [], phases = [];
    for (const [kind, x, y] of [['well',82,72],['guardPost',82,74]]) {
      if (!e.validateBuildAt(state,kind,x,y).ok) throw Error('Unexpected dense fixture rejection');
      const started=performance.now(); const result=e.buildAt(state,kind,x,y); commits.push(performance.now()-started);
      if (!result.ok) throw Error(result.message);
    }
    for(let i=0;i<8;i++) {const started=performance.now();const work=e.advanceConstructionReconciliation(state);phases.push(performance.now()-started);if(!work)break;}
    r.denseConstruction = { commitMs: commits, reconciliationMs: phases, maxMs: Math.max(...commits,...phases) };
  }

}
report.parity.territory = isDeepStrictEqual(values.before, values.after);
report.parity.economy = isDeepStrictEqual(report.parity.beforeEconomy, report.parity.afterEconomy);
if (!report.parity.territory || !report.parity.economy) throw Error('Derived values changed');
await writeFile(path.join(output, 'comparison.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
