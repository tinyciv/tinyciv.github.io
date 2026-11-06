import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessTestReport, formatTestSummary } from './ci-test-report.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'output/ci-tests');
mkdirSync(output, { recursive: true });
for (const file of ['vitest.json', 'runtime.json', 'assessment.json', 'summary.md']) rmSync(join(output, file), { force: true });
const collect = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? collect(path) : entry.isFile() && /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name) ? [relative(root, path).replaceAll('\\', '/')] : [];
});
const expectedFiles = collect(join(root, 'tests')).sort();
const child = spawn(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', 'tests',
  '--config', './scripts/ci-test.config.mjs', '--exclude', 'scratch/**', '--maxWorkers', '2', '--testTimeout', '60000',
  '--reporter=default', '--reporter=json', '--reporter=./scripts/ci-test-runtime-reporter.mjs', `--outputFile=${join(output, 'vitest.json')}`],
  { cwd: root, stdio: 'inherit', env: { ...process.env, CI: 'true', CI_TEST_OUTPUT: output } });
let processError;
child.on('error', error => { processError = error.message; });
const execution = await new Promise(resolve => child.on('close', (exitCode, signal) => resolve({ exitCode, signal })));
const parse = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return undefined; } };
const result = assessTestReport(parse(join(output, 'vitest.json')), parse(join(output, 'runtime.json')),
  parse(join(root, 'tests/ci-known-failures.json')), { root, expectedFiles, ...execution });
if (processError) { result.ok = false; result.errors.push(`Unable to start Vitest: ${processError}`); }
const summary = formatTestSummary(result);
writeFileSync(join(output, 'assessment.json'), JSON.stringify(result, null, 2) + '\n');
writeFileSync(join(output, 'summary.md'), summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(summary);
process.exitCode = result.ok ? 0 : 1;
