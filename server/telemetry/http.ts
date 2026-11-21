import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { accountDatabase, accountsConfigured } from '../accounts/database';
import { analyticsConfig } from './config';
import { gameAnalyticsStatus } from './gameanalytics';
import { SCENARIOS } from '../../src/game/scenario-content';
import { isLandformFamily } from '../../src/world/options';
import type { TelemetryEvent, TelemetryKind, WorldType } from '../../src/telemetry/types';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const KINDS: TelemetryKind[] = ['session-start','session-end','world-attempt','play-start','play-end','heartbeat','performance','error'];
const WORLDS: WorldType[] = ['menu','continents','pangaea','fractal','unknown'];
const SCENARIO_IDS = new Set<string>(['none', ...SCENARIOS.map(scenario => scenario.id)]);
const SOURCES = new Set(['uncaught','promise','asset','engine','world-generation','save-load','multiplayer']);
const METRICS = ['frames','frameMs','frameWorkMs','p95FrameMs','stalls','worstFrameMs','longTasks','longTaskMs'];
const limits = new Map<string, { count: number; until: number }>();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const respond = (response: ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
};
class RequestError extends Error { constructor(readonly status: number, message: string) { super(message); } }
function throttle(key: string, maximum = 30): void {
  const now = Date.now();
  if (limits.size >= 4096) {
    for (const [stored, entry] of limits) if (entry.until <= now) limits.delete(stored);
    if (limits.size >= 4096) throw new RequestError(429, 'Telemetry is busy.');
  }
  const entry = limits.get(key);
  if (!entry || entry.until <= now) limits.set(key, { count: 1, until: now + 60000 });
  else if (++entry.count > maximum) throw new RequestError(429, 'Telemetry rate limit.');
}
function cleanMessage(value: unknown): string {
  return String(value ?? '').replace(/https?:\/\/[^\s)]+/g, '[url]')
    .replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [redacted]')
    .replace(/\b(password|passwd|secret|token|authorization|api[_-]?key)["']?\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[redacted]')
    .replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\b/gi, '[id]')
    .replace(/\b[a-f0-9]{24,}\b/gi, '[id]').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').slice(0, 2000);
}
function eventFrom(input: unknown): TelemetryEvent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RequestError(400, 'Invalid telemetry.');
  const e = input as TelemetryEvent;
  if (![e.id,e.visitorId,e.sessionId].every(id => typeof id === 'string' && UUID.test(id))
    || !KINDS.includes(e.kind) || !WORLDS.includes(e.worldType) || !SCENARIO_IDS.has(e.scenario)
    || ![...WORLDS,'archipelago'].includes(e.worldPreset) || !isLandformFamily(e.landform)
    || !['menu','singleplayer','multiplayer'].includes(e.mode)
    || typeof e.build !== 'string' || !/^[\w.-]{1,32}$/.test(e.build)
    || !Number.isSafeInteger(e.sessionNum) || e.sessionNum < 1 || e.sessionNum > 2147483647
    || !Number.isFinite(e.at) || e.at < Date.now()-86400000 || e.at > Date.now()+300000
    || !Number.isFinite(e.value) || e.value < 0 || e.value > 172800
    || ![e.width,e.height].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 10000))
    throw new RequestError(400, 'Invalid telemetry.');
  const metrics: Record<string, number> = {};
  for (const key of METRICS) {
    const value = e.metrics?.[key];
    if (value !== undefined && Number.isFinite(value) && value >= 0 && value <= 1e9) metrics[key] = value;
  }
  return { id: e.id, visitorId: e.visitorId, sessionId: e.sessionId, sessionNum: e.sessionNum,
    kind: e.kind, at: Math.floor(e.at), worldType: e.worldType, worldPreset: e.worldPreset, landform: e.landform, scenario: e.scenario, mode: e.mode,
    build: e.build, width: e.width, height: e.height, value: e.value, metrics,
    ...(e.kind === 'error' ? { source: SOURCES.has(e.source ?? '') ? e.source : 'uncaught', message: cleanMessage(e.message) } : {}) };
}
async function dashboardUser(request: IncomingMessage): Promise<void> {
  const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.authorization ?? '')?.[1];
  if (!token) throw new RequestError(401, 'Sign in with a dashboard account.');
  const result = await accountDatabase().query(`SELECT user_id FROM accounts.sessions
    WHERE token_hash=$1 AND expires_at>now()`, [hash(token)]);
  if (!result.rows.length) throw new RequestError(401, 'Your session expired.');
  if (!analyticsConfig.adminUserIds.has(result.rows[0].user_id)) throw new RequestError(403, 'This account cannot access analytics.');
}

/** Aggregation uses the time/kind indexes, a fixed 30-day window and bounded result groups. */
async function dashboard(days: number): Promise<unknown> {
  const db = accountDatabase(), since = new Date(Date.now()-days*86400000).toISOString();
  const results = await Promise.all([
    db.query(`SELECT count(DISTINCT visitor_id)::int AS players,
      count(*) FILTER(WHERE kind='session-start')::int AS sessions,
      count(DISTINCT session_id) FILTER(WHERE kind='heartbeat')::int AS play_sessions,
      count(*) FILTER(WHERE kind='play-start')::int AS worlds,
      count(*) FILTER(WHERE kind='world-attempt')::int AS attempts,
      coalesce(sum(value) FILTER(WHERE kind='heartbeat'),0) AS play_seconds,
      count(*) FILTER(WHERE kind='error')::int AS errors,
      count(DISTINCT session_id) FILTER(WHERE kind='error')::int AS error_sessions,
      coalesce(sum((metrics->>'frames')::float) FILTER(WHERE kind='performance'),0) AS frames,
      coalesce(sum((metrics->>'frameMs')::float) FILTER(WHERE kind='performance'),0) AS frame_ms,
      coalesce(sum((metrics->>'stalls')::float) FILTER(WHERE kind='performance'),0) AS stalls
      FROM telemetry.events WHERE received_at >= $1`, [since]),
    db.query(`SELECT date_trunc('day',received_at)::date::text AS day,
      count(DISTINCT visitor_id)::int AS players,
      count(*) FILTER(WHERE kind='play-start')::int AS worlds,
      coalesce(sum(value) FILTER(WHERE kind='heartbeat'),0) AS play_seconds,
      count(*) FILTER(WHERE kind='error')::int AS errors
      FROM telemetry.events WHERE received_at >= $1 GROUP BY 1 ORDER BY 1`, [since]),
    db.query(`SELECT world_type,world_preset,landform,scenario,mode,
      count(*) FILTER(WHERE kind='play-start')::int AS starts,
      count(*) FILTER(WHERE kind='world-attempt')::int AS attempts,
      count(DISTINCT visitor_id)::int AS players,
      coalesce(sum(value) FILTER(WHERE kind='heartbeat'),0) AS play_seconds,
      count(*) FILTER(WHERE kind='error')::int AS errors,
      coalesce(sum((metrics->>'frames')::float) FILTER(WHERE kind='performance'),0) AS frames,
      coalesce(sum((metrics->>'frameMs')::float) FILTER(WHERE kind='performance'),0) AS frame_ms,
      coalesce(sum((metrics->>'stalls')::float) FILTER(WHERE kind='performance'),0) AS stalls
      FROM telemetry.events WHERE received_at >= $1 AND mode<>'menu'
      GROUP BY 1,2,3,4,5 ORDER BY starts DESC LIMIT 100`, [since]),
    db.query(`SELECT source,left(message,300) AS message,build,count(*)::int AS occurrences,max(received_at) AS last_seen
      FROM telemetry.events WHERE received_at >= $1 AND kind='error'
      GROUP BY 1,2,3 ORDER BY occurrences DESC LIMIT 30`, [since]),
    db.query(`SELECT build,count(DISTINCT session_id)::int AS sessions,
      coalesce(sum((metrics->>'frames')::float),0) AS frames,coalesce(sum((metrics->>'frameMs')::float),0) AS frame_ms,
      coalesce(max((metrics->>'worstFrameMs')::float),0) AS worst_frame_ms,
      coalesce(avg((metrics->>'p95FrameMs')::float),0) AS mean_p95_frame_ms,
      coalesce(sum((metrics->>'stalls')::float),0) AS stalls,
      coalesce(sum((metrics->>'longTaskMs')::float),0) AS long_task_ms
      FROM telemetry.events WHERE received_at >= $1 AND kind='performance' GROUP BY 1 ORDER BY sessions DESC LIMIT 20`, [since]),
    db.query(`SELECT ga_state,count(*)::int AS events FROM telemetry.events WHERE received_at >= $1 GROUP BY ga_state`, [since]),
  ]);
  return { days, generatedAt: new Date().toISOString(), summary: results[0].rows[0], daily: results[1].rows,
    worlds: results[2].rows, errors: results[3].rows, performance: results[4].rows,
    delivery: results[5].rows, gameAnalytics: gameAnalyticsStatus() };
}

export async function handleTelemetryRequest(request: IncomingMessage, response: ServerResponse, origins: Set<string>): Promise<boolean> {
  const path = request.url?.split('?')[0];
  if (path !== '/api/telemetry' && path !== '/api/analytics') return false;
  try {
    const origin = request.headers.origin;
    if (origin && !origins.has(origin)) throw new RequestError(403, 'Origin is not allowed.');
    if (request.method === 'OPTIONS') {
      if (!origin || !origins.has(origin)) throw new RequestError(403, 'Origin is not allowed.');
      response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' }).end();
      return true;
    }
    if (!accountsConfigured()) throw new RequestError(503, 'Analytics storage is unavailable.');
    if (path === '/api/analytics' && request.method === 'GET') {
      await dashboardUser(request);
      const days = Number(new URL(request.url!, 'http://localhost').searchParams.get('days') || 7);
      if (![1,7,30].includes(days)) throw new RequestError(400, 'Choose 1, 7 or 30 days.');
      respond(response, 200, await dashboard(days)); return true;
    }
    if (path !== '/api/telemetry' || request.method !== 'POST') throw new RequestError(405, 'Method not allowed.');
    const forwarded = String(request.headers['x-forwarded-for'] ?? '').split(',').at(-1)?.trim();
    const ip = forwarded && isIP(forwarded) ? forwarded : request.socket.remoteAddress ?? 'unknown';
    throttle(hash(ip), 600);
    if (!request.headers['content-type']?.startsWith('application/json')) throw new RequestError(415, 'Send JSON.');
    const chunks: Buffer[] = []; let length = 0;
    for await (const chunk of request) {
      length += chunk.length; if (length > 64000) throw new RequestError(413, 'Telemetry batch is too large.');
      chunks.push(chunk);
    }
    let input;
    try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new RequestError(400, 'Invalid JSON.'); }
    if (!Array.isArray(input?.events) || input.events.length < 1 || input.events.length > 24) throw new RequestError(400, 'Invalid telemetry batch.');
    const events = input.events.map(eventFrom);
    if (events.some((event: TelemetryEvent) => event.visitorId !== events[0].visitorId)) throw new RequestError(400, 'Invalid visitor.');
    throttle(`visitor:${events[0].visitorId}`);
    // One round trip; UUID deduplication makes retries safe for first-party reports.
    await accountDatabase().query(`INSERT INTO telemetry.events
      (id,visitor_id,session_id,kind,world_type,world_preset,landform,scenario,mode,build,value,metrics,source,message,payload)
      SELECT (e->>'id')::uuid,(e->>'visitorId')::uuid,(e->>'sessionId')::uuid,e->>'kind',e->>'worldType',e->>'worldPreset',e->>'landform',
        e->>'scenario',e->>'mode',e->>'build',(e->>'value')::float,coalesce(e->'metrics','{}'::jsonb),e->>'source',e->>'message',e
      FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS events(e,position)
      ORDER BY position ON CONFLICT(id) DO NOTHING`, [JSON.stringify(events)]);
    respond(response, 202, { accepted: events.length });
  } catch (error) {
    const status = error instanceof RequestError ? error.status : 503;
    if (status === 429) response.setHeader('Retry-After', '60');
    respond(response, status, { error: error instanceof RequestError ? error.message : 'Analytics storage is unavailable.' });
  }
  return true;
}
