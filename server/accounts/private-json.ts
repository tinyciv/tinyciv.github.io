import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Supply credentials to a subprocess without putting their value in argv. */
export function withPrivateJson<T>(value: unknown, use: (path: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), 'tinyciv-credentials-'));
  try {
    chmodSync(directory, 0o700);
    const path = join(directory, 'credentials.json');
    writeFileSync(path, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    return use(path);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
