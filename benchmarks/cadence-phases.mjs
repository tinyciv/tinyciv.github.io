import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Replay recorded RAF intervals through real clocks, without rendering or
// advancing a world. Isolates phase collapse from unrelated gameplay changes.
const arg = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const root = process.cwd(), baseline = arg('baseline', '/tmp/btv-pop800-2026-11-08/baseline');
const framesFile = arg('frames', '/tmp/btv-pop800-2026-11-08/baseline.json');
const output = arg('out', 'benchmarks/cadence-phases-2026-11-08.json');
const scratch = path.resolve('scratch/2026-11-08-cadence-phases');
await mkdir(scratch, { recursive: true });
const source = await readFile(framesFile, 'utf8'), recorded = JSON.parse(source);
const simulation = await readFile(path.join(root, 'src/game/simulation.ts'), 'utf8');
const keys = [...new Set([...simulation.matchAll(/runRecurringWork\(state, '([^']+)'/g)].map(match => match[1]))];
const directKeys = ['builders:staff', 'farms:sync', 'collectors:staff'];
const summary = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { maximum: sorted.at(-1), p95: sorted[Math.floor(sorted.length * .95)],
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    histogram: Object.fromEntries([...values.reduce((counts, value) => counts.set(value, (counts.get(value) ?? 0) + 1), new Map())].sort((a, b) => a[0] - b[0])) };
};
const results = {};
for (const [label, directory] of [['before', baseline], ['after', root]]) {
  const bundle = path.join(scratch, `${label}.mjs`);
  await build({ stdin: { contents: `
export { decisionDue } from './src/game/decision-schedule';
export { runRecurringWork, recurringWorkElapsed } from './src/game/work-cadence';`, resolveDir: path.resolve(directory) },
    bundle: true, platform: 'node', format: 'esm', outfile: bundle });
  const engine = await import(pathToFileURL(bundle));
  const state = { world: { width: 1, height: 1, tiles: [], revision: 0 }, units: [], buildings: [], time: 0 };
  const clocks = Array.from({ length: 120 }, () => ({})), rows = [];
  for (const frame of recorded.frames) {
    const dt = Math.min((frame.interval || 1000 / 60) / 1000 * 3, .1);
    state.time += dt;
    const row = { recurring: 0, directSettlement: 0, decisions: 0 };
    for (const key of keys) engine.runRecurringWork(state, key, dt, () => row.recurring++);
    for (const key of directKeys) if (engine.recurringWorkElapsed(state, key, dt) !== undefined) row.directSettlement++;
    for (let id = 0; id < clocks.length; id++) if (engine.decisionDue(clocks[id], state.time, id + 1)) row.decisions++;
    if (state.time > 10) rows.push(row);
  }
  results[label] = { measuredFrames: rows.length, gameTime: state.time,
    ...Object.fromEntries(['recurring', 'directSettlement', 'decisions'].map(key => [key, summary(rows.map(row => row[key]))])) };
}
const report = { methodology: 'Real before/after clock implementations replay identical recorded RAF intervals at 3× speed, capped at one 0.1-game-second update. Excludes the first 10 game seconds. Counts simultaneous due tasks, not CPU time. Late observations retain the original unrounded phases in the new implementation. Average nominal rate remains 3 Hz; physical observations can be one frame closer.',
  framesFile, framesSha256: createHash('sha256').update(source).digest('hex'), baseline,
  sourceKeys: keys, counts: { recurring: keys.length, directSettlement: directKeys.length, decisions: 120 }, results };
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, counts: report.counts, results }, null, 2));
