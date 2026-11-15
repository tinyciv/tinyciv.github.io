import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { withPrivateJson } from '../server/accounts/private-json';

describe('private subprocess credentials', () => {
  it('allows a subprocess to open the file while denying group/other access, then removes it', () => {
    let saved = '';
    const expected = { password: 'temporary test credential' };
    withPrivateJson(expected, path => {
      saved = path;
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
      const text = execFileSync(process.execPath, ['-e', 'process.stdout.write(require("node:fs").readFileSync(process.argv[1]))', path], { encoding: 'utf8' });
      expect(JSON.parse(text)).toEqual(expected);
    });
    expect(existsSync(saved)).toBe(false);
    expect(existsSync(dirname(saved))).toBe(false);
  });
  it('removes the file even when the subprocess operation fails', () => {
    let saved = '';
    expect(() => withPrivateJson({ password: 'temporary test credential' }, path => {
      saved = path;
      throw new Error('Subprocess failed');
    })).toThrow('Subprocess failed');
    expect(existsSync(dirname(saved))).toBe(false);
  });
});
