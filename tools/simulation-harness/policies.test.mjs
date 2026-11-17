import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPolicyCatalog } from './policies.mjs';
import { comparePolicies } from './policy-analysis.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
function temporary(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'tinyciv-ai-policies-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
test('policy files reject duplicate names, cycles, unknown parents and misspelled fields', t => {
  const directory = temporary(t), file = path.join(directory, 'policies.json');
  for (const policies of [
    [{ id: 'legacy' }], [{ id: 'a' }, { id: 'a' }], [{ id: 'a', extends: 'missing' }],
    [{ id: 'a', extends: 'b' }, { id: 'b', extends: 'a' }],
    [{ id: 'a', parameters: { retreatHeath: .8 } }], [{ id: 'a', features: { formations: 1 } }],
  ]) {
    writeFileSync(file, JSON.stringify({ version: 1, policies }));
    assert.throws(() => loadPolicyCatalog(file, root));
  }
  const valid = loadPolicyCatalog('experiments/ai-policies.json', root);
  assert.ok(valid.available.includes('cautious'));
  assert.equal(valid.source.sha256.length, 64);
});

const baseline = (seed, score) => ({ scenario: 'open-battle', seed, policy: 'coordinated', score,
  initialStateHash: `fixture-${seed}`, leaderAlive: true, kills: 2, survivors: 8 });
test('paired analysis uses seed matches, reports uncertainty, and retains ties', () => {
  const a = baseline('a', 100), b = baseline('b', 200);
  const candidate = row => ({ ...row, policy: 'candidate' });
  const result = comparePolicies([a, b, { ...candidate(a), score: 110 }, { ...candidate(b), score: 190 }],
    ['coordinated', 'candidate'], 'coordinated').comparisons[0];
  assert.equal(result.meanScoreDelta, 0);
  assert.equal(result.wins, 1); assert.equal(result.losses, 1); assert.equal(result.matchedPairs, 2);
  assert.deepEqual(result.approximate95PercentInterval, [-19.6, 19.6]);
  const single = comparePolicies([a, candidate(a)], ['coordinated', 'candidate'], 'coordinated').comparisons[0];
  assert.equal(single.ties, 1); assert.equal(single.approximate95PercentInterval, null);
});
test('paired analysis refuses missing, duplicated, invalid or unfair trials', () => {
  const a = baseline('a', 100), b = baseline('b', 200), candidate = { ...a, policy: 'candidate' };
  for (const rows of [[a, b, candidate], [a, a, candidate], [a, candidate, candidate],
    [a, { ...candidate, initialStateHash: 'different' }], [a, { ...candidate, score: NaN }]])
    assert.throws(() => comparePolicies(rows, ['coordinated', 'candidate'], 'coordinated'));
});

test('the real headless CLI runs isolated policy variants on matching fixtures', { timeout: 120_000 }, t => {
  const directory = temporary(t), out = path.join(directory, 'report.json');
  execFileSync(process.execPath, ['tools/simulation-harness/cli.mjs', 'ai',
    '--policy-file=experiments/ai-policies.json', '--policies=no-formations',
    '--seconds=0.2', '--seeds=1', '--jobs=2', `--out=${out}`], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  const report = JSON.parse(readFileSync(out, 'utf8'));
  assert.deepEqual(report.configuration.policies, ['coordinated', 'no-formations']);
  assert.equal(report.rows.length, 6);
  assert.equal(report.paired.comparisons[0].matchedPairs, 3);
  for (const row of report.rows) {
    assert.equal(row.simulatedSeconds, .2);
    assert.equal(row.policyDefinition.features.formations, row.policy !== 'no-formations');
    assert.deepEqual(row.appliedFactions, [1]);
  }
  const repeat = path.join(directory, 'repeat.json');
  execFileSync(process.execPath, ['tools/simulation-harness/cli.mjs', 'ai',
    '--policy-file=experiments/ai-policies.json', '--policies=no-formations',
    '--seconds=0.2', '--seeds=1', '--jobs=1', `--out=${repeat}`], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  const again = JSON.parse(readFileSync(repeat, 'utf8'));
  const outcomes = rows => rows.map(({ id, score, initialStateHash, missions, leaderHP, survivingHP, kills }) =>
    ({ id, score, initialStateHash, missions, leaderHP, survivingHP, kills }));
  assert.deepEqual(outcomes(report.rows), outcomes(again.rows));
});
