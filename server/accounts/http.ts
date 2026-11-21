import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { accountDatabase, accountsConfigured } from './database';
import { HashingBusy, hashPassword, validPassword, verifyPassword } from './password';
import { feedbackInput } from './feedback';
import { CLOUD_SAVE_MAX_BYTES, CLOUD_SAVE_PATH } from '../../src/account/cloud-save';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function normalizedEmail(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(email) ? email : undefined;
}
export function normalizedUsername(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const username = value.trim();
  if (/^[A-Za-z0-9_.-]{1,40}$/.test(username)) return username;
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

async function rateLimit(request: IncomingMessage, scope: string, identity?: string): Promise<void> {
  // CloudFront appends the actual viewer address to X-Forwarded-For. Earlier
  // entries may be supplied by the caller, so never use the first entry.
  const forwarded = String(request.headers['x-forwarded-for'] ?? '').split(',').at(-1)?.trim();
  const ip = forwarded && isIP(forwarded) ? forwarded : request.socket.remoteAddress ?? 'unknown';
  const keys = [`${scope}:ip:${ip}`, ...(identity ? [`${scope}:identity:${identity}`] : [])];
  for (const key of keys) {
    const result = await accountDatabase().query(`
      INSERT INTO accounts.auth_limits(key, attempts, reset_at) VALUES ($1, 1, now() + interval '15 minutes')
      ON CONFLICT(key) DO UPDATE SET
        attempts = CASE WHEN accounts.auth_limits.reset_at <= now() THEN 1 ELSE accounts.auth_limits.attempts + 1 END,
        reset_at = CASE WHEN accounts.auth_limits.reset_at <= now() THEN now() + interval '15 minutes' ELSE accounts.auth_limits.reset_at END
      RETURNING attempts`, [digest(key)]);
    if (result.rows[0].attempts > (scope === 'register' || scope === 'feedback' ? 5 : 15)) throw new AccountError(429, 'Too many attempts. Try again in 15 minutes.');
  }
}

function sessionToken(request: IncomingMessage): string {
  const match = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.authorization ?? '');
  if (!match) throw new AccountError(401, 'Sign in to continue.');
  return match[1];
}
async function signedIn(request: IncomingMessage) {
  const result = await accountDatabase().query(`SELECT u.id, u.username, u.email, u.display_name AS "displayName", u.created_at AS "createdAt"
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

const SAVE_ID = /^(?:single-player|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/;
const SAVE_HEADER_BYTES = 4096;
let cloudTransfers = 0;

async function readSaveUpload(request: IncomingMessage) {
  if (request.headers['content-type'] !== 'application/octet-stream') throw new AccountError(415, 'Send a compressed game save.');
  const bodyLimit = SAVE_HEADER_BYTES + CLOUD_SAVE_MAX_BYTES;
  const oversized = () => new AccountError(413, 'This game is too large to save to the cloud.');
  if (Number(request.headers['content-length']) > bodyLimit) throw oversized();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > bodyLimit) throw oversized();
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks, size);
  const end = bytes.subarray(0, SAVE_HEADER_BYTES).indexOf(10);
  if (end < 0) throw new AccountError(400, 'Missing game save details.');
  let details: Record<string, unknown> | null = null;
  try { details = JSON.parse(bytes.toString('utf8', 0, end)); } catch { /* Invalid details use the same error. */ }
  const { name, time, seed, civilization } = details ?? {};
  const validText = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length <= limit && !value.includes('\0');
  if (!validText(name, 80) || !name.trim() || !validText(seed, 256) || !validText(civilization, 100)
      || typeof time !== 'number' || !Number.isFinite(time) || time < 0) throw new AccountError(400, 'Invalid game save details.');
  const payload = bytes.subarray(end + 1);
  if (payload.length > CLOUD_SAVE_MAX_BYTES) throw oversized();
  if (payload.length < 18 || payload[0] !== 0x1f || payload[1] !== 0x8b || payload[2] !== 8)
    throw new AccountError(400, 'Invalid compressed game save.');
  return { name: name.trim(), time, seed, civilization, payload };
}

async function handleCloudSaves(request: IncomingMessage, response: ServerResponse, path: string): Promise<void> {
  const user = await signedIn(request);
  const database = accountDatabase();
  if (path === CLOUD_SAVE_PATH && request.method === 'GET') {
    const result = await database.query(`SELECT id, name, extract(epoch FROM saved_at)::double precision * 1000 AS "savedAt",
      game_time AS time, seed, civilization FROM accounts.game_saves WHERE user_id=$1 ORDER BY saved_at DESC, id`, [user.id]);
    send(response, 200, { saves: result.rows });
    return;
  }
  const id = path.slice(CLOUD_SAVE_PATH.length + 1);
  if (!SAVE_ID.test(id)) throw new AccountError(404, 'This saved game is no longer available.');
  if (request.method !== 'PUT' && request.method !== 'GET') throw new AccountError(404, 'Not found.');
  if (cloudTransfers >= 4) throw new AccountError(503, 'Cloud saves are busy. Try again shortly.');
  cloudTransfers++;
  try {
    if (request.method === 'PUT') {
      const save = await readSaveUpload(request);
      await database.query(`INSERT INTO accounts.game_saves(user_id,id,name,game_time,seed,civilization,payload)
        VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,id) DO UPDATE SET
        name=excluded.name,saved_at=now(),game_time=excluded.game_time,seed=excluded.seed,civilization=excluded.civilization,payload=excluded.payload`,
      [user.id, id, save.name, save.time, save.seed, save.civilization, save.payload]);
      send(response, 200, { ok: true });
      return;
    }
    const result = await database.query('SELECT payload FROM accounts.game_saves WHERE user_id=$1 AND id=$2', [user.id, id]);
    const payload: Buffer | undefined = result.rows[0]?.payload;
    if (!payload) throw new AccountError(404, 'This saved game is no longer available.');
    response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': payload.length,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    await new Promise<void>(resolve => {
      response.once('close', resolve);
      response.end(payload, resolve);
    });
  } finally { cloudTransfers--; }
}

export async function handleAccountRequest(request: IncomingMessage, response: ServerResponse, origins: Set<string>): Promise<boolean> {
  const path = request.url?.split('?')[0];
  const cloudSaves = path === CLOUD_SAVE_PATH || path?.startsWith(CLOUD_SAVE_PATH + '/');
  if (!cloudSaves && !path?.startsWith('/api/auth/') && path !== '/api/account' && path !== '/api/feedback') return false;
  try {
    if (!accountsConfigured()) throw new AccountError(503, path === '/api/feedback' ? 'Feedback is unavailable. Your message has not been sent. Try again later.' : 'Accounts are unavailable. Try again later.');
    const origin = request.headers.origin;
    if (origin && !origins.has(origin)) throw new AccountError(403, 'This site is not allowed.');
    if (request.method === 'OPTIONS') {
      if (!origin || !origins.has(origin)) throw new AccountError(403, 'This site is not allowed.');
      response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' }).end();
      return true;
    }
    if (cloudSaves && path) { await handleCloudSaves(request, response, path); return true; }
    if (path === '/api/feedback' && request.method === 'POST') {
      const input = feedbackInput(await body(request), request.headers['user-agent']);
      if (!input) throw new AccountError(400, 'Enter feedback of 1 to 4000 characters.');
      // A supplied session must be valid. Guest reports use a pseudonymous ID;
      // account IDs and contact details always come from the verified session.
      const user = request.headers.authorization ? await signedIn(request) : undefined;
      await rateLimit(request, 'feedback', user?.id);
      await accountDatabase().query(`INSERT INTO accounts.feedback(id,user_id,visitor_id,message,context)
        VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT(id) DO NOTHING`,
      [input.id, user?.id ?? null, input.visitorId, input.message, JSON.stringify(input.context)]);
      send(response, 201, { ok: true }); return true;
    }
    if (request.method === 'POST' && (path === '/api/auth/login' || path === '/api/auth/register')) {
      const input = await body(request), email = normalizedEmail(input.email), username = normalizedUsername(input.username);
      if (!validPassword(input.password)) throw new AccountError(400, 'Enter a password of up to 1024 bytes.');
      if (path.endsWith('register')) {
        if (!username) throw new AccountError(400, 'Use 1 to 40 letters, numbers, periods, underscores, or hyphens for your username.');
        const emailSupplied = typeof input.email === 'string' ? Boolean(input.email.trim()) : input.email != null;
        if (emailSupplied && !email) throw new AccountError(400, 'Enter a valid email address.');
        await rateLimit(request, 'register', username.toLowerCase());
        const passwordHash = await hashPassword(input.password);
        const token = randomBytes(32).toString('hex');
        const result = await accountDatabase().query(`WITH created AS (
          INSERT INTO accounts.users(id,username,email,password_hash,display_name) VALUES ($1,$2,$3,$4,$2)
          ON CONFLICT DO NOTHING RETURNING id,username,email,display_name AS "displayName",created_at AS "createdAt"
        ), session AS (
          INSERT INTO accounts.sessions(token_hash,user_id,expires_at) SELECT $5,id,now()+interval '7 days' FROM created
        ) SELECT * FROM created`, [randomUUID(), username, email ?? null, passwordHash, digest(token)]);
        if (!result.rows.length) throw new AccountError(409, 'That username or email is already in use.');
        send(response, 201, { user: result.rows[0], token });
        return true;
      }
      const identity = email ?? username?.toLowerCase();
      if (!identity) throw new AccountError(400, 'Enter your username or email address.');
      await rateLimit(request, 'login', identity);
      const result = await accountDatabase().query(`SELECT id,username,email,password_hash,display_name AS "displayName",created_at AS "createdAt"
        FROM accounts.users WHERE ${email ? 'email' : 'lower(username)'}=$1`, [identity]);
      const record = result.rows[0];
      if (!await verifyPassword(input.password, record?.password_hash)) throw new AccountError(401, 'Username, email, or password is incorrect.');
      const { password_hash: _hash, ...user } = record;
      const token = await newSession(user.id);
      send(response, 200, { user, token }); return true;
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
    if (cloudSaves && status === 413) response.setHeader('Connection', 'close');
    // Passwords, request bodies, hashes, tokens and pg errors never enter logs.
    send(response, status, { error: error instanceof AccountError || error instanceof HashingBusy ? error.message : path === '/api/feedback' ? 'Feedback is unavailable. Your message has not been confirmed. Try again.' : cloudSaves ? 'Cloud saves are unavailable. Try again later.' : 'Accounts are unavailable. Try again later.' });
    return true;
  }
}

setInterval(() => {
  if (!accountsConfigured()) return;
  void accountDatabase().query('DELETE FROM accounts.sessions WHERE expires_at < now()').catch(() => {});
  void accountDatabase().query('DELETE FROM accounts.auth_limits WHERE reset_at < now()').catch(() => {});
}, 60 * 60 * 1000).unref();
