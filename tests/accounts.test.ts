import { describe, expect, it } from 'vitest';
import { hashPassword, validPassword, validPasswordHash, verifyPassword } from '../server/accounts/password';
import { normalizedEmail } from '../server/accounts/http';

describe('account password storage', () => {
  it('uses independent random salts and verifies the original password only', async () => {
    const password = 'test-only sample password';
    const first = await hashPassword(password), second = await hashPassword(password);
    expect(first).not.toBe(second);
    expect(first.split('$')[4]).not.toBe(second.split('$')[4]);
    expect(validPasswordHash(first)).toBe(true);
    expect(first).not.toContain(password);
    expect(await verifyPassword(password, first)).toBe(true);
    expect(await verifyPassword('different sample password', first)).toBe(false);
  });
  it('rejects missing and malformed hashes without treating plaintext as a hash', async () => {
    expect(validPasswordHash('plaintext-password')).toBe(false);
    expect(await verifyPassword('test-only sample password', undefined)).toBe(false);
    expect(await verifyPassword('test-only sample password', 'scrypt$1$1$1$00$00')).toBe(false);
  });
  it('accepts the supported minimum and bounds UTF-8 input before hashing', () => {
    expect(validPassword('0123456789')).toBe(true);
    expect(validPassword('012345678')).toBe(false);
    expect(validPassword('😊'.repeat(300))).toBe(false);
    expect(validPassword({})).toBe(false);
  });
});

describe('account identity', () => {
  it('normalizes email consistently and rejects malformed input', () => {
    expect(normalizedEmail('  Commander@Example.com  ')).toBe('commander@example.com');
    for (const value of [null, {}, 'commander', 'a@b', 'a b@example.com', '<x>@example.com'])
      expect(normalizedEmail(value)).toBeUndefined();
  });
});
