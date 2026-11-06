import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const baselineRoot = path.resolve(argument('baseline') || '/tmp/btv-perf-baseline');
const statePath = path.resolve(argument('state') || '/tmp/btv-live-profile/state.json');
const output = path.resolve(argument('out') || '/tmp/btv-live-parity');
const frames = Number(argument('frames') || 60), dt = Number(argument('dt') || 1 / 60);
if (!Number.isInteger(frames) || frames < 1 || !Number.isFinite(dt) || dt <= 0) throw new Error('Use positive frames and dt.');
mkdirSync(output, { recursive: true });
const temporary = mkdtempSync(path.join(tmpdir(), 'btv-live-parity-bundles-'));
const canonical = value => {
  if (typeof value === 'number' && !Number.isFinite(value)) return { $number: String(value) };
  if (Array.isArray(value)) return value.map(item => item === undefined ? null : canonical(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
  return value;
};
function difference(a, b, at = '$') {
  if (Object.is(a, b)) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return { path: at, baseline: a, optimized: b };
  for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    if (!(key in a) || !(key in b)) return { path: `${at}.${key}`, baseline: a[key], optimized: b[key] };
    const result = difference(a[key], b[key], `${at}.${key}`);
    if (result) return result;
  }
  return null;
}
// Fog presentation/memory caches are allowed to differ. All gameplay state,
// including exact array order and floating-point coordinates, remains checked.
const gameplay = state => { const { fog, ...rest } = state; return canonical(rest); };
const report = { baselineRoot, optimizedRoot: root, statePath, frames, dt, pass: false, checked: 0 };
try {
  for (const [name, directory] of [['baseline', baselineRoot], ['optimized', root]]) await build({
    entryPoints: [path.join(directory, 'src/game/simulation.ts')], bundle: true, platform: 'node',
    format: 'esm', target: 'node20', outfile: path.join(temporary, `${name}.mjs`),
  });
  const baseline = await import(pathToFileURL(path.join(temporary, 'baseline.mjs')));
  const optimized = await import(pathToFileURL(path.join(temporary, 'optimized.mjs')));
  const initial = JSON.parse(readFileSync(statePath, 'utf8'));
  const expected = structuredClone(initial), actual = structuredClone(initial);
  const input = { up: false, down: false, left: false, right: false };
  for (let frame = 0; frame <= frames; frame++) {
    if (frame) { baseline.updateGame(expected, dt, input); optimized.updateGame(actual, dt, input); }
    const oldState = gameplay(expected), newState = gameplay(actual);
    report.checked++;
    const mismatch = difference(oldState, newState);
    if (mismatch) {
      report.difference = { frame, ...mismatch };
      writeFileSync(path.join(output, 'baseline-difference.json'), JSON.stringify({ frame, state: oldState }, null, 2));
      writeFileSync(path.join(output, 'optimized-difference.json'), JSON.stringify({ frame, state: newState }, null, 2));
      throw new Error(`Gameplay differs at frame ${frame}: ${mismatch.path}`);
    }
    if (frame === frames) report.finalSha256 = createHash('sha256').update(JSON.stringify(newState)).digest('hex');
  }
  report.pass = true;
  report.finalTime = actual.time;
  console.log(`PASS: ${frames} exact live-state frames at dt=${dt}, speed=${actual.speed}.`);
} catch (error) {
  report.error = String(error); process.exitCode = 1;
  console.error(report.error);
  if (report.difference) console.error(JSON.stringify(report.difference, null, 2));
} finally {
  writeFileSync(path.join(output, 'parity.json'), JSON.stringify(report, null, 2));
  rmSync(temporary, { recursive: true, force: true });
}
