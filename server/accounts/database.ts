import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

export interface DatabaseConfig { host: string; port: number; database: string; username: string; password: string; }
let pool: Pool | undefined;
export const accountsConfigured = () => Boolean(process.env.ACCOUNT_DATABASE_CONFIG);

export function accountDatabase(): Pool {
  if (!accountsConfigured()) throw new Error('Accounts are unavailable.');
  if (!pool) {
    const config: DatabaseConfig = JSON.parse(readFileSync(process.env.ACCOUNT_DATABASE_CONFIG!, 'utf8'));
    pool = new Pool({ host: config.host, port: config.port, database: config.database,
      user: config.username, password: config.password, max: 4,
      connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 5000, query_timeout: 7000,
      ssl: { ca: readFileSync(process.env.ACCOUNT_DATABASE_CA ?? new URL('./rds-ca.pem', import.meta.url), 'utf8'), rejectUnauthorized: true },
    });
    // Do not log pg error objects: they can contain connection or query details.
    pool.on('error', () => console.error('Account database connection interrupted.'));
  }
  return pool;
}

export async function accountsHealthy(): Promise<boolean> {
  if (!accountsConfigured()) return true;
  try { await accountDatabase().query('SELECT 1 FROM accounts.users LIMIT 1'); return true; }
  catch { return false; }
}
