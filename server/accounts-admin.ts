/** Root-only installation tasks. No raw user password is accepted by this tool. */
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import { Pool, escapeLiteral } from 'pg';
import { SCHEMA } from './accounts/schema';
import { validPasswordHash } from './accounts/password';
import { normalizedEmail, normalizedUsername } from './accounts/http';
import { accountDatabase } from './accounts/database';
import { withPrivateJson } from './accounts/private-json';

function aws(...args: string[]): any {
  return JSON.parse(execFileSync('aws', ['--region', 'us-west-2', ...args, '--output', 'json'],
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 }));
}
function secret(arn: string): { username: string; password: string } {
  return JSON.parse(aws('secretsmanager', 'get-secret-value', '--secret-id', arn).SecretString);
}

async function configure(): Promise<void> {
  if (process.getuid?.() !== 0) throw new Error('Root required.');
  const config = JSON.parse(aws('ssm', 'get-parameter', '--name', '/tinyciv/accounts/database').Parameter.Value);
  const master = secret(config.masterSecretArn);
  let app: { username: string; password: string };
  try { app = secret(config.appSecretArn); }
  catch (error) {
    // Only an empty, newly created secret may be initialized. Do not rotate on
    // access errors or transient failures, which could break an active server.
    const stderr = String((error as { stderr?: Buffer }).stderr ?? '');
    if (!stderr.includes('ResourceNotFoundException')) throw error;
    app = { username: 'tinyciv_app', password: randomBytes(48).toString('base64url') };
    // Node's child stdin is a socket on Linux and cannot be reopened as
    // /dev/stdin by AWS CLI's file loader. Use a private, temporary file.
    withPrivateJson(app, path => execFileSync('aws', ['--region', 'us-west-2', 'secretsmanager', 'put-secret-value',
      '--secret-id', config.appSecretArn, '--secret-string', 'file://' + path, '--output', 'json'],
    { stdio: ['ignore', 'pipe', 'pipe'] }));
  }
  if (app.username !== 'tinyciv_app' || !app.password) throw new Error('Invalid application credentials.');
  const pool = new Pool({ host: config.host, port: config.port, database: config.database,
    user: master.username, password: master.password, max: 1, connectionTimeoutMillis: 10000,
    ssl: { ca: readFileSync(new URL('./rds-ca.pem', import.meta.url), 'utf8'), rejectUnauthorized: true } });
  const client = await pool.connect();
  let analytics: { gameKey: string; secretKey: string; adminUserIds: string[] };
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(872191024)");
    await client.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tinyciv_app') THEN
      CREATE ROLE tinyciv_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION; END IF; END $$`);
    await client.query(`ALTER ROLE tinyciv_app PASSWORD ${escapeLiteral(app.password)}`);
    await client.query(`GRANT CONNECT ON DATABASE tinyciv TO tinyciv_app`);
    await client.query(SCHEMA);
    analytics = await analyticsConfiguration(client);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); await pool.end(); }
  const target = '/etc/btv-database.json';
  writeFileSync(target + '.next', JSON.stringify({ host: config.host, port: config.port,
    database: config.database, username: app.username, password: app.password }), { mode: 0o600 });
  execFileSync('chown', ['root:btv', target + '.next']);
  chmodSync(target + '.next', 0o640);
  renameSync(target + '.next', target);
  writeAnalyticsConfiguration(analytics!);
  console.log('Account schema and restricted application credentials configured.');
}

/** Optional secret container is managed by Terraform; its value is never logged. */
async function analyticsConfiguration(database: Pick<Pool, 'query'>): Promise<{ gameKey: string; secretKey: string; adminUserIds: string[] }> {
  let input;
  try { input = JSON.parse(aws('secretsmanager', 'get-secret-value', '--secret-id', 'tinyciv/accounts/analytics').SecretString); }
  catch (error) {
    if (String((error as { stderr?: Buffer }).stderr ?? '').includes('ResourceNotFoundException')) {
      // An empty/new secret disables GA forwarding and owner access until populated.
      input = { gameKey: '', secretKey: '', adminUserIds: [] };
    } else throw error;
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || typeof input.gameKey !== 'string' || typeof input.secretKey !== 'string'
    || !((!input.gameKey && !input.secretKey) || /^[a-f0-9]{32}$/.test(input.gameKey) && /^[a-f0-9]{32,64}$/.test(input.secretKey))
    || input.adminUserIds !== undefined && !Array.isArray(input.adminUserIds)
    || input.adminEmails !== undefined && !Array.isArray(input.adminEmails))
    throw new Error('Invalid analytics configuration.');
  input.adminUserIds ??= []; input.adminEmails ??= [];
  if (input.adminUserIds.length > 20 || input.adminEmails.length > 20
    || input.adminUserIds.some((id: unknown) => typeof id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)))
    throw new Error('Invalid analytics configuration.');
  const emails = [...new Set<string>(input.adminEmails.map((email: unknown) => {
    const normalized = normalizedEmail(email);
    if (!normalized) throw new Error('Invalid dashboard account email.');
    return normalized;
  }))];
  if (emails.length) {
    const result = await database.query('SELECT id FROM accounts.users WHERE email=ANY($1::text[])', [emails]);
    // Do not leave an email allowlist that could grant a future registration access.
    if (result.rows.length !== emails.length) throw new Error('Create the requested dashboard game accounts first.');
    input.adminUserIds.push(...result.rows.map(row => row.id));
  }
  return { gameKey: input.gameKey, secretKey: input.secretKey, adminUserIds: [...new Set<string>(input.adminUserIds)] };
}
function writeAnalyticsConfiguration(input: { gameKey: string; secretKey: string; adminUserIds: string[] }): void {
  const target = '/etc/btv-analytics.json';
  writeFileSync(target + '.next', JSON.stringify({ gameKey: input.gameKey, secretKey: input.secretKey,
    adminUserIds: input.adminUserIds }), { mode: 0o600 });
  execFileSync('chown', ['root:btv', target + '.next']); chmodSync(target + '.next', 0o640);
  renameSync(target + '.next', target);
}

async function analyticsAccount(): Promise<void> {
  const email = normalizedEmail(JSON.parse(readFileSync(0, 'utf8')).email);
  if (!email) throw new Error('A valid account email is required.');
  const pool = accountDatabase();
  try {
    const result = await pool.query('SELECT id FROM accounts.users WHERE email=$1', [email]);
    if (!result.rows.length) throw new Error('Create a game account first.');
    console.log(JSON.stringify({ userId: result.rows[0].id }));
  } finally { await pool.end(); }
}

async function importUser(): Promise<void> {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const email = normalizedEmail(input.email);
  const username = normalizedUsername(input.username);
  if (!username || !validPasswordHash(input.passwordHash)) throw new Error('A valid username and salted scrypt hash are required.');
  if (input.email != null && !email) throw new Error('Enter a valid email address.');
  const pool = accountDatabase();
  try {
    // Never replace an existing account or silently reset its password.
    const result = await pool.query(`INSERT INTO accounts.users(id,username,email,password_hash,display_name)
      VALUES ($1,$2,$3,$4,$2) ON CONFLICT DO NOTHING RETURNING id`,
    [randomUUID(), username, email ?? null, input.passwordHash]);
    if (!result.rows.length) throw new Error('Account already exists; no password changed.');
    console.log(JSON.stringify({ created: true, username, email: email ?? null }));
  } finally { await pool.end(); }
}

async function inspect(): Promise<void> {
  const pool = accountDatabase();
  try {
    const result = await pool.query(`SELECT count(*)::int AS users,
      bool_and(password_hash ~ '^scrypt\\$131072\\$8\\$1\\$[a-f0-9]{32}\\$[a-f0-9]{64}$') AS salted_hashes_only
      FROM accounts.users`);
    const tls = await pool.query('SELECT ssl, bits FROM pg_stat_ssl WHERE pid=pg_backend_pid()');
    const role = await pool.query("SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user");
    console.log(JSON.stringify({ ...result.rows[0], tls: tls.rows[0], databaseRole: role.rows[0] }));
  } finally { await pool.end(); }
}

/** Operator-only output; feedback and account details never enter service logs. */
async function feedback(): Promise<void> {
  const pool = accountDatabase();
  try {
    const result = await pool.query(`SELECT f.id, f.created_at AS "createdAt", f.user_id AS "userId",
      u.display_name AS "displayName", u.email, f.visitor_id AS "visitorId", f.message, f.context
      FROM accounts.feedback f LEFT JOIN accounts.users u ON u.id=f.user_id
      ORDER BY f.created_at DESC LIMIT 50`);
    console.log(JSON.stringify(result.rows));
  } finally { await pool.end(); }
}

try {
  const command = process.argv[2];
  if (command === 'configure') await configure();
  else if (command === 'import-user') await importUser();
  else if (command === 'inspect') await inspect();
  else if (command === 'feedback') await feedback();
  else if (command === 'analytics-account') await analyticsAccount();
  else throw new Error('Expected configure, import-user, inspect, feedback or analytics-account.');
} catch {
  // CLI errors can contain database credentials or secret values. Report only
  // a generic failure; no secret-bearing objects or SQL statements are logged.
  console.error('Account administration failed; no credentials were logged.');
  process.exitCode = 1;
}
