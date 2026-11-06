import { isAbsolute, relative, resolve } from 'node:path';

const stripAnsi = value => String(value).replace(/\u001b\[[0-9;]*m/g, '');
const identity = (file, name) => `${file}\n${name}`;
const count = value => Number.isInteger(value) && value >= 0;

export function validateKnownFailures(manifest) {
  if (!manifest || !Array.isArray(manifest.failures)) throw new Error('Known-failure manifest must contain a failures array.');
  const seen = new Set();
  for (const row of manifest.failures) {
    if (!row || typeof row.file !== 'string' || !/^tests\/[\w./-]+\.test\.[cm]?[jt]sx?$/.test(row.file)
      || row.file.includes('..') || typeof row.fullName !== 'string' || !row.fullName
      || typeof row.assertion !== 'string' || !row.assertion.startsWith('AssertionError: ') || row.assertion.includes('\n'))
      throw new Error('Known failures require an exact test path, full name, and single AssertionError message.');
    const key = identity(row.file, row.fullName);
    if (seen.has(key)) throw new Error(`Duplicate known failure: ${row.file} > ${row.fullName}`);
    seen.add(key);
  }
  return manifest.failures;
}

/** Vitest's JSON reporter omits unhandled worker errors, so a second reporter
 * must prove the run completed without those errors before exemptions apply. */
export function assessTestReport(report, runtime, manifest, { root = process.cwd(), exitCode, signal, expectedFiles } = {}) {
  const errors = [], accepted = [], fixed = [], observed = new Map(), suitesSeen = new Set();
  let known;
  try { known = validateKnownFailures(manifest); } catch (error) { errors.push(error.message); known = []; }
  const lookup = new Map(known.map(row => [identity(row.file, row.fullName), row]));
  if (signal) errors.push(`Test process terminated by ${signal}.`);
  if (![0, 1].includes(exitCode)) errors.push(`Test process exited abnormally (${exitCode ?? 'no exit code'}).`);
  if (!runtime || runtime.completed !== true || !Array.isArray(runtime.errors) || !count(runtime.modules)
    || !['passed', 'failed'].includes(runtime.reason)) errors.push('Missing or incomplete runtime report.');
  else {
    for (const error of runtime.errors) errors.push(`Unhandled test error: ${error.name ?? 'Error'}: ${error.message ?? String(error)}`);
    if (!runtime.modules) errors.push('No test modules ran.');
  }
  if (!report || !Array.isArray(report.testResults) || !count(report.numTotalTests) || !report.numTotalTests
    || !count(report.numPassedTests) || !count(report.numFailedTests))
    return { ok: false, errors: [...errors, 'Missing, malformed, or empty Vitest JSON report.'], accepted, fixed, passed: 0, total: 0 };

  let total = 0, passed = 0, failed = 0;
  for (const suite of report.testResults) {
    if (!suite || typeof suite.name !== 'string' || !Array.isArray(suite.assertionResults)) { errors.push('Malformed test module.'); continue; }
    const file = relative(root, isAbsolute(suite.name) ? suite.name : resolve(root, suite.name)).replaceAll('\\', '/');
    if (!file.startsWith('tests/') || file.startsWith('../')) errors.push(`Unexpected test module outside tests/: ${file}`);
    if (suitesSeen.has(file)) errors.push(`Duplicate test module: ${file}`);
    suitesSeen.add(file);
    if (suite.message) errors.push(`Module/collection error in ${file}: ${suite.message}`);
    if (!suite.assertionResults.length) errors.push(`No tests collected in ${file}.`);
    let suiteFailures = 0;
    for (const test of suite.assertionResults) {
      total++;
      if (!test || typeof test.fullName !== 'string' || !Array.isArray(test.failureMessages)) { errors.push(`Malformed test result in ${file}.`); continue; }
      const key = identity(file, test.fullName), entry = lookup.get(key);
      // Parameterized passing tests can share a display name. Exemptions must
      // identify exactly one assertion so they cannot cover multiple failures.
      if (entry && observed.has(key)) errors.push(`Duplicate test identity: ${file} > ${test.fullName}`);
      observed.set(key, test.status);
      if (test.status === 'passed') {
        passed++;
        if (test.failureMessages.length) errors.push(`Passed test contains errors: ${file} > ${test.fullName}`);
        if (entry) fixed.push(entry);
      } else if (test.status === 'failed') {
        failed++; suiteFailures++;
        const matches = entry && test.failureMessages.length === 1
          && stripAnsi(test.failureMessages[0]).split('\n')[0].trim() === entry.assertion;
        if (matches) accepted.push(entry);
        else errors.push(`Unexpected failure: ${file} > ${test.fullName}${entry ? ' (failure no longer matches its recorded assertion)' : ''}`);
      } else errors.push(`Test did not execute (${test.status}): ${file} > ${test.fullName}`);
    }
    if (suite.status !== (suiteFailures ? 'failed' : 'passed')) errors.push(`Module status does not match its tests: ${file}`);
  }
  for (const entry of known) if (!observed.has(identity(entry.file, entry.fullName))) errors.push(`Recorded failure was not collected: ${entry.file} > ${entry.fullName}`);
  if (expectedFiles) {
    for (const file of expectedFiles) if (!suitesSeen.has(file)) errors.push(`Test file was not collected: ${file}`);
    for (const file of suitesSeen) if (!expectedFiles.includes(file)) errors.push(`Unexpected collected file: ${file}`);
  }
  if (runtime && count(runtime.modules) && runtime.modules !== suitesSeen.size) errors.push('Runtime and JSON module counts disagree.');
  if (total !== report.numTotalTests || passed !== report.numPassedTests || failed !== report.numFailedTests) errors.push('Vitest test counts disagree with the individual results.');
  if (exitCode === 0 && failed || exitCode === 1 && !failed) errors.push('Test-process exit status disagrees with assertion results.');
  if (report.success !== (failed === 0)) errors.push('Vitest success flag disagrees with assertion results.');
  if (runtime && ['passed', 'failed'].includes(runtime.reason) && runtime.reason !== (failed ? 'failed' : 'passed')) errors.push('Runtime completion status disagrees with assertion results.');
  return { ok: errors.length === 0, errors, accepted, fixed, passed, total };
}

const inline = value => String(value).replaceAll('`', '\\`').replaceAll('\n', ' ');
export function formatTestSummary(result) {
  const lines = ['## TinyCiv test gate', '', `**${result.ok ? 'Passed' : 'Failed'}** — ${result.passed} passing assertions out of ${result.total}.`, ''];
  if (result.accepted.length) {
    lines.push(`### Known terrain failures (${result.accepted.length})`, '', 'These assertions remain failing; they are the exact pre-existing baseline, not passing tests.', '');
    for (const row of result.accepted) lines.push(`- \`${inline(row.file)}\` — ${inline(row.fullName)}`);
    lines.push('');
  }
  if (result.fixed.length) {
    lines.push('### Baseline entries now passing', '', 'Remove these obsolete exceptions from `tests/ci-known-failures.json`:', '');
    for (const row of result.fixed) lines.push(`- \`${inline(row.file)}\` — ${inline(row.fullName)}`);
    lines.push('');
  }
  if (result.errors.length) { lines.push('### Blocking errors', ''); for (const error of result.errors) lines.push(`- ${inline(error)}`); lines.push(''); }
  return `${lines.join('\n')}\n`;
}
