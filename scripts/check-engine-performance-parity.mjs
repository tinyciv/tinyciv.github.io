import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = key => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const output = path.resolve(root, arg('out') || 'scratch/2026-10-27-engine-performance');
const baselinePath = path.resolve(root, arg('baseline') || 'scratch/2026-10-27-engine-performance/baseline-simulation.mjs');
const frames = Number(arg('frames') || 120), dt = 1 / 60;
const scenarios = (arg('scenarios') || 'idle-100,combat-100,combat-300').split(',');
if (!Number.isInteger(frames) || frames < 1 || frames > 900) throw new Error('Use --frames=1..900 (at most 15 simulated seconds).');
if (!existsSync(baselinePath)) throw new Error(`Preserved baseline bundle not found: ${baselinePath}`);
mkdirSync(output, { recursive: true });
const temporary = mkdtempSync(path.join(tmpdir(), 'btv-engine-parity-'));

// Canonical keys avoid treating object insertion order as a gameplay difference.
// Array order and every finite number remain exact: iteration order and tiny
// position changes can affect future collisions, targeting and RNG consumption.
function canonical(value) {
  if (typeof value === 'number' && !Number.isFinite(value)) return { $number: String(value) };
  if (Array.isArray(value)) return value.map(item => item === undefined ? null : canonical(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
  return value;
}
const serialized = value => JSON.stringify(canonical(value));
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : serialized(value)).digest('hex');
function firstDifference(a, b, at = '$') {
  if (Object.is(a, b)) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return { path: at, baseline: a, current: b };
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const key of keys) {
    if (!(key in a) || !(key in b)) return { path: `${at}.${key}`, baseline: a[key], current: b[key] };
    const difference = firstDifference(a[key], b[key], `${at}.${key}`);
    if (difference) return difference;
  }
  return null;
}
const report = {
  baseline: path.relative(root, baselinePath), baselineSha256: digest(readFileSync(baselinePath, 'utf8')),
  scenarios: [], frames, dt, checks: {
    initialCaches: 'One prepared fixture is structured-cloned twice, so both engine modules start with identical state and empty per-state WeakMap caches.',
    dynamicState: 'Every frame: all state except world, including unit order/positions/HP/morale/targets/paths, projectiles, blood, fog exploration/memories, buildings, fields, economy and RNG.',
    world: 'Initial, every30 frames and final: complete world/tiles, including topology, revision and farm assignment.',
    numericComparison: 'Exact; no rounding or tolerance.',
  }, pass: false,
};
try {
  const currentPath = path.join(temporary, 'current.mjs');
  await build({
    stdin: { resolveDir: root, sourcefile: 'performance-parity-entry.ts', contents:
      "export * as simulation from './src/game/simulation.ts'; export * from './dev/performance/scenarios.ts';" },
    outfile: currentPath, bundle: true, platform: 'node', format: 'esm', target: 'node20', sourcemap: 'inline',
  });
  const current = await import(pathToFileURL(currentPath).href);
  const baseline = await import(pathToFileURL(baselinePath).href);
  for (const id of scenarios) {
    const initial = current.createPerformanceScenario(id);
    // The fixture prepares current-module fog/navigation caches. Clone BOTH
    // states so neither driver inherits those private WeakMap entries; otherwise
    // the first fog-memory refresh differs solely because one cache is warm.
    const actual = structuredClone(initial.state), expected = structuredClone(initial.state);
    const result = { id, metadata: initial.metadata, dynamicChecks: 0, worldChecks: 0, lastFrame: 0, pass: false };
    report.scenarios.push(result);
    const compare = (frame, includeWorld) => {
      const { world: oldWorld, ...oldState } = expected, { world: newWorld, ...newState } = actual;
      const a = serialized(oldState), b = serialized(newState);
      result.dynamicChecks++;
      const oldWorldString = includeWorld ? serialized(oldWorld) : '', newWorldString = includeWorld ? serialized(newWorld) : '';
      if (includeWorld) result.worldChecks++;
      if (a !== b || oldWorldString !== newWorldString) {
        const scope = a !== b ? 'state' : 'world';
        const oldData = JSON.parse(scope === 'state' ? a : oldWorldString), newData = JSON.parse(scope === 'state' ? b : newWorldString);
        result.difference = { frame, scope, ...firstDifference(oldData, newData) };
        writeFileSync(path.join(output, `parity-${id}-baseline.json`), JSON.stringify({ frame, state: canonical(expected) }, null, 2) + '\n');
        writeFileSync(path.join(output, `parity-${id}-current.json`), JSON.stringify({ frame, state: canonical(actual) }, null, 2) + '\n');
        throw new Error(`${id} differs at frame ${frame}: ${scope} ${result.difference.path}`);
      }
      result.lastFrame = frame;
      result.finalStateSha256 = digest(a);
      if (includeWorld) result.finalWorldSha256 = digest(oldWorldString);
    };
    compare(0, true);
    for (let frame = 1; frame <= frames; frame++) {
      baseline.updateGame(expected, dt, current.NO_INPUT);
      current.simulation.updateGame(actual, dt, current.NO_INPUT);
      compare(frame, frame % 30 === 0 || frame === frames);
    }
    if (expected.gameOver || actual.gameOver || actual.time < frames * dt - 1e-9) throw new Error(`${id} stopped before the full parity run.`);
    result.baselineFinal = current.summarizePerformanceState(expected);
    result.currentFinal = current.summarizePerformanceState(actual);
    result.pass = true;
    console.log(`PASS ${id}: ${frames} exact simulation frames; ${result.dynamicChecks} dynamic-state and ${result.worldChecks} full-world comparisons.`);
  }
  report.pass = true;
} catch (error) {
  report.error = String(error);
  throw error;
} finally {
  writeFileSync(path.join(output, 'parity.json'), JSON.stringify(report, null, 2) + '\n');
  rmSync(temporary, { recursive: true, force: true });
}
