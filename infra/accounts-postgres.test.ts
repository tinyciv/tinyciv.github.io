import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { Pool, escapeLiteral } from 'pg';
import { accountDatabase, type DatabaseConfig } from '../server/accounts/database';
import { handleAccountRequest } from '../server/accounts/http';
import { SCHEMA } from '../server/accounts/schema';

describe.skipIf(!process.env.ACCOUNTS_TEST_CONFIG)('PostgreSQL account API over verified TLS', () => {
  let admin: Pool, server: Server, origin: string, token = '', secondToken = '', userId = '';
  const email = 'commander@example.test', password = 'temporary integration password';
  const request = async (path: string, method = 'GET', data?: unknown, auth = token, site = 'https://tinyciv.github.io') => {
    const response = await fetch(origin + path, { method, headers: {
      Origin: site, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, headers: response.headers, body: response.status === 204 ? {} : await response.json() };
  };
  beforeAll(async () => {
    const config: DatabaseConfig = JSON.parse(readFileSync(process.env.ACCOUNTS_TEST_CONFIG!, 'utf8'));
    const app: DatabaseConfig = JSON.parse(readFileSync(process.env.ACCOUNT_DATABASE_CONFIG!, 'utf8'));
    admin = new Pool({ host: config.host, port: config.port, database: config.database,
      user: config.username, password: config.password,
      ssl: { ca: readFileSync(process.env.ACCOUNT_DATABASE_CA!, 'utf8'), rejectUnauthorized: true } });
    await admin.query(`CREATE ROLE tinyciv_app LOGIN PASSWORD ${escapeLiteral(app.password)} NOSUPERUSER NOCREATEDB NOCREATEROLE`);
    await admin.query(SCHEMA);
    server = createServer((req, res) => { void handleAccountRequest(req, res, new Set(['https://tinyciv.github.io'])); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    server?.closeAllConnections();
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    await accountDatabase().end();
    await admin?.end();
  });
  it('registers a normalized identity and stores only an independently salted hash', async () => {
    const result = await request('/api/auth/register', 'POST', { email: ' Commander@Example.test ', password });
    expect(result.status).toBe(201);
    expect(result.body.user.email).toBe(email);
    expect(result.body.user.password_hash).toBeUndefined();
    token = result.body.token; userId = result.body.user.id;
    const stored = await admin.query('SELECT password_hash FROM accounts.users WHERE id=$1', [userId]);
    expect(stored.rows[0].password_hash).toMatch(/^scrypt\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
    expect(stored.rows[0].password_hash).not.toContain(password);
    const session = await admin.query('SELECT token_hash FROM accounts.sessions WHERE user_id=$1', [userId]);
    expect(session.rows[0].token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(session.rows[0].token_hash).not.toBe(token);
  });
  it('rejects incorrect credentials and duplicate registration without changing the account', async () => {
    expect((await request('/api/auth/login', 'POST', { email, password: 'incorrect test password' })).status).toBe(401);
    expect((await request('/api/auth/login', 'POST', { email: 'absent@example.test', password })).status).toBe(401);
    expect((await request('/api/auth/register', 'POST', { email, password: 'different test password' })).status).toBe(409);
    const result = await request('/api/auth/login', 'POST', { email, password });
    expect(result.status).toBe(200);
    token = result.body.token;
  });
  it('persists profile data and isolates it from a second authenticated user', async () => {
    const second = await request('/api/auth/register', 'POST', { email: 'second@example.test', password });
    expect(second.status).toBe(201); secondToken = second.body.token;
    const data = { preferences: { sound: false }, note: "quoted '; DROP TABLE accounts.users; --" };
    expect((await request('/api/account', 'PATCH', { data, displayName: 'Commander', userId: second.body.user.id })).status).toBe(200);
    const restored = await request('/api/account');
    expect(restored.body.data).toEqual(data);
    expect((await request('/api/account', 'GET', undefined, secondToken)).body.data).toEqual({});
    // A separate administrator connection verifies committed SQL persistence.
    expect((await admin.query('SELECT data FROM accounts.user_data WHERE user_id=$1', [userId])).rows[0].data).toEqual(data);
  });
  it('enforces authorization, CORS, payload limits, and expiration', async () => {
    expect((await request('/api/account', 'GET', undefined, '')).status).toBe(401);
    expect((await request('/api/account', 'PATCH', { data: {} }, '')).status).toBe(401);
    expect((await request('/api/account', 'GET', undefined, token, 'https://untrusted.example')).status).toBe(403);
    expect((await request('/api/auth/login', 'OPTIONS', undefined, '')).status).toBe(204);
    expect((await request('/api/account', 'PATCH', { data: { oversized: 'x'.repeat(21000) } })).status).toBe(413);
    await admin.query("UPDATE accounts.sessions SET expires_at=now()-interval '1 minute' WHERE token_hash=$1", [createHash('sha256').update(secondToken).digest('hex')]);
    expect((await request('/api/auth/session', 'GET', undefined, secondToken)).status).toBe(401);
  });
  it('revokes sessions on logout', async () => {
    expect((await request('/api/auth/logout', 'POST', {})).status).toBe(200);
    expect((await request('/api/auth/session')).status).toBe(401);
    const result = await request('/api/auth/login', 'POST', { email, password });
    expect(result.status).toBe(200); token = result.body.token;
  });
  it('enforces persistent login throttling before expensive hashing', async () => {
    await admin.query(`INSERT INTO accounts.auth_limits(key,attempts,reset_at) VALUES ($1,15,now()+interval '15 minutes')
      ON CONFLICT(key) DO UPDATE SET attempts=15,reset_at=excluded.reset_at`,
    [createHash('sha256').update(`login:email:${email}`).digest('hex')]);
    const result = await request('/api/auth/login', 'POST', { email, password });
    expect(result.status).toBe(429);
    expect(result.headers.get('Retry-After')).toBe('900');
  });
  it('uses TLS and a database role without administrative or schema privileges', async () => {
    const tls = await accountDatabase().query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()');
    expect(tls.rows[0].ssl).toBe(true);
    const role = await accountDatabase().query('SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user');
    expect(role.rows[0]).toEqual({ rolsuper: false, rolcreatedb: false, rolcreaterole: false });
    await expect(accountDatabase().query('CREATE TABLE accounts.forbidden(id int)')).rejects.toMatchObject({ code: '42501' });
  });
});
