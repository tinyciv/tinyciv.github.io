import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));

async function bundledRuntime(embedded = false): Promise<string> {
  const result = await build({ entryPoints: [fileURLToPath(new URL('../src/game/rust-engine.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'node', target: 'node22',
    define: embedded ? { '__TINYCIV_SIMULATION_BASE64__': JSON.stringify(readFileSync(`${root}/public/wasm/simulation.wasm`).toString('base64')) } : {},
  });
  if (!result.outputFiles?.length) throw new Error('Runtime bundle was not emitted.');
  return `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`;
}

function nodeReport(source: string): Record<string, unknown> {
  // Exercise Node's real data: module loader, which standalone headless lab
  // bundles use. A Vite-transformed import would not cover that loader boundary.
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module'], {
    cwd: root, input: source, encoding: 'utf8', maxBuffer: 1024 * 1024,
  }));
}

describe('Rust runtime loading and entity publications', () => {
  it('loads a data: bundle and preserves independent worlds, safe IDs, and snapshots after memory growth', async () => {
    const url = await bundledRuntime();
    const report = nodeReport(`
      const runtime = await import(${JSON.stringify(url)});
      // Units (table 0) and buildings (table 1) are tables of each game's World.
      const engine = runtime.rustEngine, memory = () => engine.memory.buffer;
      const ids = pointer => Array.from(new Float64Array(memory(), pointer + 8, new Float64Array(memory(), pointer, 1)[0]));
      const insert = (game, id, kind) => { engine.sim_entity_insert(game, 0, id); engine.sim_unit_traits(game, id, kind, 0, 100, 100, -1, 1); };
      const first = engine.sim_create(1), second = engine.sim_create(1);
      insert(first, -7, 5); insert(first, Number.MAX_SAFE_INTEGER, 15); insert(first, 0, 15);
      insert(second, -7, 15); insert(second, 2 ** 32 + 1, 5);
      const original = ids(engine.sim_entity_view(first, 0, 0));
      const buffer = memory();
      engine.memory.grow(1);
      engine.sim_unit_traits(first, Number.MAX_SAFE_INTEGER, 5, 0, 100, 100, -1, 1);
      const removed = engine.sim_entity_remove(first, 0, -7); insert(first, -7, 15);
      const views = { first: ids(engine.sim_entity_view(first, 0, 0)), firstRole: ids(engine.sim_entity_view(first, 0, 4)),
        second: ids(engine.sim_entity_view(second, 0, 0)), secondRole: ids(engine.sim_entity_view(second, 0, 4)),
        duplicate: engine.sim_entity_insert(first, 0, 0), missing: engine.sim_entity_remove(first, 0, 12345) >>> 0,
        removedSoldier: (removed & 16) !== 0, next: engine.sim_entity_allocate_id(second, 1) };
      engine.sim_drop(first); engine.sim_drop(second);
      // One simulation core owns the game's engines and its random stream.
      const sim = engine.sim_create(1);
      engine.sim_engine_create(sim, 1, 8, 8, 0); const health = engine.sim_engine_create(sim, 4, 0, 0, 0);
      const owned = engine.sim_engine_count(sim); engine.sim_engine_release(sim, 4, health);
      const draws = [engine.sim_random(sim), engine.sim_random(sim), engine.sim_random(sim)];
      const rng = new Float64Array(engine.memory.buffer, engine.sim_outbox(sim), 8)[2];
      const remaining = engine.sim_engine_count(sim); engine.sim_drop(sim); engine.sim_engine_release(sim, 1, 1);
      console.log(JSON.stringify({ owned, remaining, draws, rng,
        imports: WebAssembly.Module.imports(runtime.rustModule),
        abi: runtime.rustEngine.simulation_abi_version(),
        grew: runtime.rustEngine.memory.buffer !== buffer,
        original, ...views,
      }));
    `);
    let state = 1;
    const mulberry32 = () => {
      let t = state = (state + 0x6D2B79F5) >>> 0;
      t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    const draws = [mulberry32(), mulberry32(), mulberry32()];
    expect(report).toEqual({ owned: 2, remaining: 1, draws, rng: state, imports: [], abi: 13, grew: true,
      original: [-7, Number.MAX_SAFE_INTEGER, 0], first: [Number.MAX_SAFE_INTEGER, 0, -7], firstRole: [Number.MAX_SAFE_INTEGER],
      second: [-7, 2 ** 32 + 1], secondRole: [2 ** 32 + 1],
      duplicate: 0, missing: 0xffffffff, removedSoldier: true, next: 2 ** 32 + 2 });
  });

  it('loads the embedded browser core without fetching files or requiring a server', async () => {
    const url = await bundledRuntime(true);
    const report = nodeReport(`
      globalThis.window = {};
      globalThis.fetch = () => { throw new Error('An embedded lab must not fetch the simulation'); };
      const runtime = await import(${JSON.stringify(url)});
      const engine = runtime.rustEngine, game = engine.sim_create(1); engine.sim_entity_insert(game, 1, -42);
      engine.sim_building_traits(game, -42, 4, 0, 1);
      const pointer = engine.sim_entity_view(game, 1, 0);
      const entities = Array.from(new Float64Array(engine.memory.buffer, pointer + 8, new Float64Array(engine.memory.buffer, pointer, 1)[0]));
      console.log(JSON.stringify({ abi: engine.simulation_abi_version(), entities }));
    `);
    expect(report).toEqual({ abi: 13, entities: [-42] });
  });
});
