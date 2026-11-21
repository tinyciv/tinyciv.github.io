import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const N = 131072, r = 8, p = 1, length = 32;
// Fixed cost and bounded concurrency prevent password hashing exhausting the host.
let active = 0;
export class HashingBusy extends Error {}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (active >= 1) return Promise.reject(new HashingBusy('Sign-in is busy. Try again shortly.'));
  active++;
  return new Promise((resolve, reject) => {
    scrypt(password, salt, length, { N, r, p, maxmem: 192 * 1024 * 1024 }, (error, result) => {
      active--;
      if (error) reject(error); else resolve(result);
    });
  });
}

export function validPassword(password: unknown): password is string {
  return typeof password === 'string' && password.length > 0 && Buffer.byteLength(password, 'utf8') <= 1024;
}

export function validPasswordHash(value: unknown): value is string {
  return typeof value === 'string' && /^scrypt\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(value);
}

export async function hashPassword(password: string): Promise<string> {
  if (!validPassword(password)) throw new Error('Enter a password of up to 1024 bytes.');
  const salt = randomBytes(16), hash = await derive(password, salt);
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

const dummy = `scrypt$${N}$${r}$${p}$${randomBytes(16).toString('hex')}$${randomBytes(length).toString('hex')}`;
export async function verifyPassword(password: string, encoded: string | undefined): Promise<boolean> {
  const valid = validPasswordHash(encoded);
  const parts = (valid ? encoded : dummy).split('$');
  const actual = await derive(password, Buffer.from(parts[4], 'hex'));
  return timingSafeEqual(actual, Buffer.from(parts[5], 'hex')) && valid;
}
