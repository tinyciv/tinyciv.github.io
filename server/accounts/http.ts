import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { accountDatabase, accountsConfigured } from './database';
import { HashingBusy, hashPassword, validPassword, verifyPassword } from './password';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function normalizedEmail(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(email) ? email : undefined;
}
class AccountError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const send = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
};
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new AccountError(415, 'Send JSON.');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 20000) throw new AccountError(413, 'Request is too large.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new AccountError(400, 'Invalid request.'); }
}

async function rateLimit(request: IncomingMessage, scope: string, email?: string): Promise<void> {
  // CloudFront appends the actual viewer address to X-Forwarded-For. Earlier
  // entries may be supplied by the caller, so never use the first entry.
  const forwarded = String(request.headers['x-forwarded-for'] ?? '').split(',').at(-1)?.trim();
  const ip = forwarded && isIP(forwarded) ? forwarded : request.socket.remoteAddress ?? 'unknown';
  const keys = [`${scope}:ip:${ip}`, ...(email ? [`${scope}:email:${email}`] : [])];
  for (const key of keys) {
    const result = await accountDatabase().query(`
      INSERT INTO accounts.auth_limits(key, attempts, reset_at) VALUES ($1, 1, now() + interval '15 minutes')
      ON CONFLICT(key) DO UPDATE SET
        attempts = CASE WHEN accounts.auth_limits.reset_at <= now() THEN 1 ELSE accounts.auth_limits.attempts + 1 END,
        reset_at = CASE WHEN accounts.auth_limits.reset_at <= now() THEN now() + interval '15 minutes' ELSE accounts.auth_limits.reset_at END
      RETURNING attempts`, [digest(key)]);
    if (result.rows[0].attempts > (scope === 'register' ? 5 : 15)) throw new AccountError(429, 'Too many attempts. Try again in 15 minutes.');
  }
}

function sessionToken(request: IncomingMessage): string {
  const match = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.authorization ?? '');
  if (!match) throw new AccountError(401, 'Sign in to continue.');
  return match[1];
}
async function signedIn(request: IncomingMessage) {
  const result = await accountDatabase().query(`SELECT u.id, u.email, u.display_name AS "displayName", u.created_at AS "createdAt"
    FROM accounts.sessions s JOIN accounts.users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > now()`, [digest(sessionToken(request))]);
  if (!result.rows.length) throw new AccountError(401, 'Your session expired. Sign in again.');
  return result.rows[0];
}
async function newSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await accountDatabase().query(`INSERT INTO accounts.sessions(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '7 days')`, [digest(token), userId]);
  return token;
}

export async function handleAccountRequest(request: IncomingMessage, response: ServerResponse, origins: Set<string>): Promise<boolean> {
  const path = request.url?.split('?')[0];
  if (!path?.startsWith('/api/auth/') && path !== '/api/account') return false;
  try {
    if (!accountsConfigured()) throw new AccountError(503, 'Accounts are unavailable. Try again later.');
    const origin = request.headers.origin;
    if (origin && !origins.has(origin)) throw new AccountError(403, 'This site is not allowed.');
    if (request.method === 'OPTIONS') {
      if (!origin || !origins.has(origin)) throw new AccountError(403, 'This site is not allowed.');
      response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' }).end();
      return true;
    }
    if (request.method === 'POST' && (path === '/api/auth/login' || path === '/api/auth/register')) {
      const input = await body(request), email = normalizedEmail(input.email);
      if (!email || !validPassword(input.password)) throw new AccountError(400, 'Enter a valid email and a password of at least 10 characters.');
      await rateLimit(request, path.endsWith('register') ? 'register' : 'login', email);
      let user;
      if (path.endsWith('register')) {
        const name = email.split('@')[0].slice(0, 40);
        const passwordHash = await hashPassword(input.password);
        const result = await accountDatabase().query(`INSERT INTO accounts.users(id,email,password_hash,display_name)
          VALUES ($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING RETURNING id,email,display_name AS "displayName",created_at AS "createdAt"`,
        [randomUUID(), email, passwordHash, name]);
        if (!result.rows.length) throw new AccountError(409, 'An account with this email is unavailable. Try signing in.');
        user = result.rows[0];
      } else {
        const result = await accountDatabase().query('SELECT id,email,password_hash,display_name AS "displayName",created_at AS "createdAt" FROM accounts.users WHERE email=$1', [email]);
        const record = result.rows[0];
        if (!await verifyPassword(input.password, record?.password_hash)) throw new AccountError(401, 'Email or password is incorrect.');
        const { password_hash: _hash, ...publicUser } = record;
        user = publicUser;
      }
      const token = await newSession(user.id);
      send(response, path.endsWith('register') ? 201 : 200, { user, token }); return true;
    }
    if (path === '/api/auth/logout' && request.method === 'POST') {
      await accountDatabase().query('DELETE FROM accounts.sessions WHERE token_hash=$1', [digest(sessionToken(request))]);
      send(response, 200, { ok: true }); return true;
    }
    if (path === '/api/auth/session' && request.method === 'GET') {
      send(response, 200, { user: await signedIn(request) }); return true;
    }
    if (path === '/api/account' && request.method === 'GET') {
      const user = await signedIn(request);
      const result = await accountDatabase().query('SELECT data FROM accounts.user_data WHERE user_id=$1', [user.id]);
      send(response, 200, { user, data: result.rows[0]?.data ?? {} }); return true;
    }
    if (path === '/api/account' && request.method === 'PATCH') {
      const user = await signedIn(request), input = await body(request);
      const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : user.displayName;
      const data = input.data;
      if (!displayName || displayName.length > 40 || /[\x00-\x1f]/.test(displayName)) throw new AccountError(400, 'Use a display name of 1 to 40 characters.');
      if (data !== undefined && (!data || typeof data !== 'object' || Array.isArray(data) || Buffer.byteLength(JSON.stringify(data)) > 12000))
        throw new AccountError(400, 'Account data must be an object smaller than 12 KB.');
      const client = await accountDatabase().connect();
      try {
        await client.query('BEGIN');
        await client.query('UPDATE accounts.users SET display_name=$1 WHERE id=$2', [displayName, user.id]);
        if (data !== undefined) await client.query(`INSERT INTO accounts.user_data(user_id,data) VALUES ($1,$2::jsonb)
          ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,updated_at=now()`, [user.id, JSON.stringify(data)]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
      send(response, 200, { ok: true }); return true;
    }
    throw new AccountError(404, 'Not found.');
  } catch (error) {
    const status = error instanceof AccountError ? error.status : error instanceof HashingBusy ? 429 : 503;
    if (status === 429) response.setHeader('Retry-After', '900');
    // Passwords, request bodies, hashes, tokens and pg errors never enter logs.
    send(response, status, { error: error instanceof AccountError || error instanceof HashingBusy ? error.message : 'Accounts are unavailable. Try again later.' });
    return true;
  }
}

setInterval(() => {
  if (!accountsConfigured()) return;
  void accountDatabase().query('DELETE FROM accounts.sessions WHERE expires_at < now()').catch(() => {});
  void accountDatabase().query('DELETE FROM accounts.auth_limits WHERE reset_at < now()').catch(() => {});
}, 60 * 60 * 1000).unref();
