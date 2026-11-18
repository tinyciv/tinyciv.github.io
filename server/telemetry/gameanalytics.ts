import { createHmac } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { accountDatabase, accountsConfigured } from '../accounts/database';
import { analyticsConfig, gameAnalyticsConfigured } from './config';
import type { TelemetryEvent } from '../../src/telemetry/types';

let busy = false, initializedAt = 0, enabled = true, clockOffset = 0, batchSize = 100;
const stats = { sent: 0, rejected: 0, failures: 0, lastSuccess: null as string | null };
export const gameAnalyticsStatus = () => ({ configured: gameAnalyticsConfigured(), enabled, ...stats });

async function post(route: string, input: unknown): Promise<Response> {
  const payload = gzipSync(Buffer.from(JSON.stringify(input)));
  return fetch(`https://api.gameanalytics.com/v2/${analyticsConfig.gameKey}/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip',
      Authorization: createHmac('sha256', analyticsConfig.secretKey).update(payload).digest('base64') },
    body: payload, signal: AbortSignal.timeout(10000),
  });
}
function annotations(event: TelemetryEvent): Record<string, unknown> {
  return { v: 2, user_id: event.visitorId, session_id: event.sessionId, session_num: event.sessionNum,
    client_ts: Math.floor(event.at / 1000 + clockOffset), sdk_version: 'rest api v2',
    platform: 'webgl', os_version: 'webgl 0.0.0', device: 'browser', manufacturer: 'unknown',
    build: event.build, custom_01: event.worldPreset, custom_02: event.scenario, custom_03: event.mode };
}
function convert(event: TelemetryEvent): Record<string, unknown>[] {
  const common = annotations(event);
  const design = (name: string, value: number) => ({ ...common, category: 'design',
    event_id: `${name}:${event.worldPreset}:${event.scenario}:${event.mode}:${event.landform}`, value });
  if (event.kind === 'session-start') return [{ ...common, category: 'user' }];
  if (event.kind === 'session-end') return [{ ...common, category: 'session_end', length: Math.floor(event.value) }];
  if (event.kind === 'error') return [
    { ...common, category: 'error', severity: event.source === 'engine' ? 'critical' : 'error',
      message: `[${event.source}; ${event.worldPreset}; ${event.landform}; ${event.scenario}; ${event.build}] ${event.message}`.slice(0, 8192) },
    design('Errors', 1),
  ];
  if (event.kind === 'performance') return [design('FPS', event.value),
    design('FrameP95Ms', event.metrics?.p95FrameMs ?? 0), design('Stalls', event.metrics?.stalls ?? 0),
    design('WorstFrameMs', event.metrics?.worstFrameMs ?? 0), design('LongTaskMs', event.metrics?.longTaskMs ?? 0)];
  const names = { 'world-attempt': 'WorldTried', 'play-start': 'WorldStarted', 'play-end': 'WorldEnded', heartbeat: 'PlaySeconds' } as const;
  return [design(names[event.kind], event.value)];
}

/** Durable SQL outbox; collector work never blocks ingestion or the game loop. */
async function forward(): Promise<void> {
  if (busy || !accountsConfigured() || !gameAnalyticsConfigured()) return;
  busy = true;
  try {
    if (!initializedAt || Date.now() - initializedAt > 3600000) {
      const response = await post('init', { platform: 'webgl', os_version: 'webgl 0.0.0', sdk_version: 'rest api v2' });
      if (!response.ok) throw new Error('Collector init failed.');
      const init = await response.json() as { enabled?: boolean; server_ts?: number };
      enabled = init.enabled !== false; initializedAt = Date.now();
      if (Number.isFinite(init.server_ts)) clockOffset = init.server_ts! - Math.floor(Date.now() / 1000);
    }
    if (!enabled) return;
    const result = await accountDatabase().query(`SELECT id,payload,ga_retry_at FROM telemetry.events
      WHERE ga_state='pending' AND ga_attempts < 20
      ORDER BY queue_order LIMIT $1`, [batchSize]);
    if (!result.rows.length) return;
    // Preserve session-start ordering when a previous network attempt is waiting to retry.
    if (new Date(result.rows[0].ga_retry_at).getTime() > Date.now()) return;
    const ids = result.rows.map(row => row.id);
    await accountDatabase().query(`UPDATE telemetry.events SET ga_attempts=ga_attempts+1,
      ga_retry_at=now()+interval '2 minutes' WHERE id=ANY($1::uuid[])`, [ids]);
    const events = result.rows.flatMap(row => convert(row.payload));
    const response = await post('events', events);
    if (response.status === 413) { batchSize = Math.max(1, Math.floor(batchSize / 2)); stats.failures++; return; }
    if (response.status === 429 || response.status >= 500) { stats.failures++; return; }
    // A 400 may partially accept a batch; retrying it creates duplicate events.
    const state = response.ok ? 'sent' : 'rejected';
    await accountDatabase().query('UPDATE telemetry.events SET ga_state=$1 WHERE id=ANY($2::uuid[])', [state, ids]);
    if (response.ok) { stats.sent += events.length; stats.lastSuccess = new Date().toISOString(); }
    else { stats.rejected += events.length; console.error(`GameAnalytics collector rejected a batch (${response.status}).`); }
  } catch { stats.failures++; /* Keep pending records for bounded retry; never log credential-bearing errors. */ }
  finally { busy = false; }
}
setInterval(() => { void forward(); }, 8000).unref();

// Indexed bounded retention batches avoid long deletes on a growing production table.
setInterval(() => {
  if (!accountsConfigured()) return;
  void accountDatabase().query(`DELETE FROM telemetry.events WHERE id IN (
    SELECT id FROM telemetry.events WHERE received_at < now()-interval '90 days' ORDER BY received_at LIMIT 10000
  )`).catch(() => {});
  void accountDatabase().query(`UPDATE telemetry.events SET ga_state='expired' WHERE id IN (
    SELECT id FROM telemetry.events WHERE ga_state='pending'
      AND (received_at < now()-interval '7 days' OR ga_attempts>=20) ORDER BY ga_retry_at LIMIT 10000
  )`).catch(() => {});
}, 60000).unref();
