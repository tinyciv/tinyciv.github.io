import { describe, expect, it } from 'vitest';
import { assessTestReport, formatTestSummary, validateKnownFailures } from '../scripts/ci-test-report.mjs';

const row = { file: 'tests/terrain.test.ts', fullName: 'terrain keeps rivers below ledges', assertion: 'AssertionError: expected river to be grassland' };
const manifest = () => ({ failures: [{ ...row }] });
const test = (fullName, status = 'passed', failureMessages = []) => ({ fullName, status, failureMessages });
function fixture() {
  return {
    report: { numTotalTests: 2, numPassedTests: 1, numFailedTests: 1, success: false,
      testResults: [{ name: '/project/tests/terrain.test.ts', message: '', status: 'failed', assertionResults: [
        test(row.fullName, 'failed', [`${row.assertion}\n    at terrain.test.ts:10:2`]), test('terrain places trees'),
      ] }] },
    runtime: { completed: true, modules: 1, reason: 'failed', errors: [] },
    manifest: manifest(),
    options: { root: '/project', exitCode: 1, expectedFiles: ['tests/terrain.test.ts'] },
  };
}
const assess = f => assessTestReport(f.report, f.runtime, f.manifest, f.options);
const failures = result => result.errors.join('\n');

describe('CI baseline gate', () => {
  it('allows only the exact existing assertion while reporting it as a failure', () => {
    const result = assess(fixture());
    expect(result).toMatchObject({ ok: true, accepted: [row], passed: 1, total: 2 });
    expect(formatTestSummary(result)).toContain('exact pre-existing baseline, not passing tests');
  });
  it('ignores terminal color escapes but not assertion contents', () => {
    const f = fixture();
    f.report.testResults[0].assertionResults[0].failureMessages[0] = `\u001b[31m${row.assertion}\u001b[0m\n at test`;
    expect(assess(f).ok).toBe(true);
  });
  it.each(['TypeError: Cannot read properties of undefined', 'AssertionError: expected mountain to be grassland'])(
    'rejects a different error in an exempted test: %s', message => {
      const f = fixture();
      f.report.testResults[0].assertionResults[0].failureMessages = [message];
      expect(assess(f).ok).toBe(false);
      expect(failures(assess(f))).toContain('no longer matches');
    });
  it('rejects an additional error in an exempted test', () => {
    const f = fixture();
    f.report.testResults[0].assertionResults[0].failureMessages.push('TypeError: broken teardown');
    expect(assess(f).ok).toBe(false);
  });
  it('rejects a new failing assertion next to the known one', () => {
    const f = fixture();
    f.report.numPassedTests = 0; f.report.numFailedTests = 2;
    f.report.testResults[0].assertionResults[1] = test('terrain places trees', 'failed', [row.assertion]);
    expect(failures(assess(f))).toContain('Unexpected failure: tests/terrain.test.ts > terrain places trees');
  });
  it('rejects unhandled worker errors that Vitest JSON alone omits', () => {
    const f = fixture();
    f.runtime.errors.push({ name: 'ReferenceError', message: 'worker crashed' });
    expect(failures(assess(f))).toContain('Unhandled test error: ReferenceError: worker crashed');
  });
  it('rejects module import or collection errors even beside the baseline', () => {
    const f = fixture();
    f.report.testResults[0].message = 'Failed to load module';
    expect(failures(assess(f))).toContain('Module/collection error');
  });
  it.each([undefined, {}, { testResults: [], numTotalTests: 0, numPassedTests: 0, numFailedTests: 0 }])(
    'rejects absent, malformed, or empty JSON', report => {
      const f = fixture(); f.report = report;
      expect(failures(assess(f))).toContain('Missing, malformed, or empty Vitest JSON');
    });
  it.each([undefined, {}, { completed: false, modules: 1, errors: [], reason: 'failed' }, { completed: true, modules: 1, errors: [], reason: 'interrupted' }])(
    'requires proof the runtime completed without interruption', runtime => {
      const f = fixture(); f.runtime = runtime;
      expect(failures(assess(f))).toContain('Missing or incomplete runtime report');
    });
  it.each([null, 2, 137])('rejects abnormal exit %s', exitCode => {
    const f = fixture(); f.options.exitCode = exitCode;
    expect(failures(assess(f))).toContain('exited abnormally');
  });
  it('rejects a signaled process', () => {
    const f = fixture(); f.options.signal = 'SIGTERM';
    expect(failures(assess(f))).toContain('terminated by SIGTERM');
  });
  it('rejects incomplete collection rather than passing on a subset', () => {
    const f = fixture(); f.options.expectedFiles.push('tests/missing.test.ts');
    expect(failures(assess(f))).toContain('Test file was not collected: tests/missing.test.ts');
  });
  it('requires every baseline test to be collected', () => {
    const f = fixture(); f.manifest.failures.push({ ...row, fullName: 'missing baseline test' });
    expect(failures(assess(f))).toContain('Recorded failure was not collected');
  });
  it.each(['pending', 'skipped', 'todo'])('rejects tests silently %s', status => {
    const f = fixture(); f.report.testResults[0].assertionResults[1].status = status;
    expect(failures(assess(f))).toContain('Test did not execute');
  });
  it('detects incomplete or inconsistent reporter output', () => {
    const f = fixture(); f.runtime.modules = 2; f.report.numTotalTests = 3;
    expect(failures(assess(f))).toContain('module counts disagree');
    expect(failures(assess(f))).toContain('test counts disagree');
  });
  it('rejects inconsistent status flags', () => {
    const f = fixture(); f.options.exitCode = 0; f.report.success = true; f.report.testResults[0].status = 'passed'; f.runtime.reason = 'passed';
    expect(failures(assess(f))).toContain('exit status disagrees');
    expect(failures(assess(f))).toContain('success flag disagrees');
    expect(failures(assess(f))).toContain('Module status does not match');
    expect(failures(assess(f))).toContain('Runtime completion status disagrees');
  });
  it('allows fixes and visibly asks to remove stale exceptions', () => {
    const f = fixture();
    f.report.numPassedTests = 2; f.report.numFailedTests = 0; f.report.success = true;
    f.report.testResults[0].status = 'passed'; f.report.testResults[0].assertionResults[0] = test(row.fullName);
    f.runtime.reason = 'passed'; f.options.exitCode = 0;
    const result = assess(f);
    expect(result).toMatchObject({ ok: true, accepted: [], fixed: [row], passed: 2 });
    expect(formatTestSummary(result)).toContain('Remove these obsolete exceptions');
  });
  it('rejects duplicate identities so an exemption cannot hide a second assertion', () => {
    const f = fixture(); f.report.testResults[0].assertionResults[1].fullName = row.fullName;
    expect(failures(assess(f))).toContain('Duplicate test identity');
  });
  it('rejects test modules outside the expected test tree', () => {
    const f = fixture(); f.report.testResults[0].name = '/project/scratch/tests/terrain.test.ts';
    expect(failures(assess(f))).toContain('Unexpected test module outside tests/');
  });
  it.each([
    { failures: [{ ...row, file: 'tests/*.test.ts' }] },
    { failures: [{ ...row, file: 'tests/../terrain.test.ts' }] },
    { failures: [{ ...row, assertion: 'TypeError: broken' }] },
    { failures: [{ ...row, assertion: `${row.assertion}\nmore` }] },
    { failures: [row, row] },
  ])('rejects wildcard, runtime-error, and duplicate exemption definitions', bad => {
    expect(() => validateKnownFailures(bad)).toThrow();
    const f = fixture(); f.manifest = bad;
    expect(assess(f).ok).toBe(false);
  });
});
