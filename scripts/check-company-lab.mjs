import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const args = process.argv.slice(2), full = args.includes('--full');
const option = (name, fallback) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const scenarioNames = ['plain', 'river', 'forest', 'town', 'urban', 'hills'];
const scenarios = option('scenario', scenarioNames.join(',')).split(',');
const sizes = option('size', full ? 'small,large,stress' : 'small').split(',');
const modes = option('mode', full ? 'movement,battle' : 'movement').split(',');
const durationOption = option('seconds', full ? 'auto' : '60');
const seconds = durationOption === 'auto' ? undefined : Number(durationOption);
if (scenarios.some(name => !scenarioNames.includes(name)) || sizes.some(size => !['small','medium','large','stress'].includes(size))
  || modes.some(mode => !['movement','battle'].includes(mode))
  || seconds !== undefined && (!Number.isFinite(seconds) || seconds <= 0))
  throw Error('Use --scenario=plain,river,forest,town,urban,hills --size=small,large,stress --mode=movement,battle --seconds=120 (or auto for throughput-scaled movement deadlines).');
const output = option('output', `scratch/2026-10-29-company-lab/benchmark-${full ? 'full' : 'quick'}.json`);
const bundle = await build({ entryPoints: ['dev/company-lab/benchmark.ts'], bundle: true, write: false,
  format: 'esm', platform: 'node', target: 'es2022' });
const { runBenchmark, BENCHMARK_LIMITS } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const reports = [], started = new Date().toISOString();
await mkdir(dirname(output), { recursive: true });
for (const scenario of scenarios) for (const size of sizes) for (const mode of modes) {
  // A one-cell crossing needs at least movingSoldiers / speed seconds before
  // the last soldier can enter it, in addition to the route's travel time.
  const duration = seconds ?? (mode === 'battle' ? 120 : scenario === 'hills' && size === 'stress' ? 360 : { small: 120, medium: 150, large: 180, stress: 240 }[size]);
  const report = runBenchmark({ scenario, size, mode, seconds: duration }); reports.push(report);
  await writeFile(output, JSON.stringify({ started, generatedAt: new Date().toISOString(), runtime: process.version,
    limits: BENCHMARK_LIMITS, reports }, null, 2));
  console.log(`${report.passed ? 'PASS' : 'FAIL'} ${scenario}/${size}/${mode} ${report.initialAlive} soldiers: `
    + `p95=${report.cpu.p95Ms}ms arrival=${Math.round(report.movement.arrivalFraction*100)}% stalled=${report.movement.stalled} `
    + `radius=${report.cohesion.max} overlap=${report.geometry.maxOverlapDepth} kills=${report.combat.kills}`);
  for (const check of report.checks) if (!check.pass) console.log(`  ${check.name}`);
}
console.log(`Saved ${reports.length} cases to ${output}`);
if (reports.some(report => !report.passed)) process.exitCode = 1;
