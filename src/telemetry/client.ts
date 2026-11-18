import { multiplayerEndpoint } from '../multiplayer/client';
import type { GameState } from '../game/types';
import type { NewGameOptions } from '../ui/world-generation';
import type { TelemetryContext, TelemetryEvent, TelemetryKind, WorldType, WorldPreset } from './types';

const QUEUE_KEY = 'tinyciv-telemetry-queue', VISITOR_KEY = 'tinyciv-telemetry-visitor';
const MAX_QUEUE = 128, MAX_BATCH = 16, REPORT_MS = 60000;
const uuid = (): string => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
};
const worldPreset = (style: WorldType, parameters?: { islandDensity?: number; islandSize?: number }): WorldPreset =>
  style === 'fractal' && (parameters?.islandDensity ?? 0) >= 1.7 && (parameters?.islandSize ?? 1) <= .7 ? 'archipelago' : style;
/** Avoid URLs, user input, identifiers and account details in exception reports. */
export function sanitizeError(value: unknown): string {
  const text = value instanceof Error ? `${value.name}: ${value.message}\n${value.stack ?? ''}`
    : typeof value === 'string' ? value : 'Unhandled non-Error rejection';
  return text.replace(/https?:\/\/[^\s)]+/g, url => {
    try { return new URL(url).pathname.split('/').at(-1)?.replace(/[^\w.:-]/g, '') || '[url]'; } catch { return '[url]'; }
  }).replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [redacted]')
    .replace(/\b(password|passwd|secret|token|authorization|api[_-]?key)["']?\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[redacted]')
    .replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\b/gi, '[id]')
    .replace(/\b[a-f0-9]{24,}\b/gi, '[id]').replace(/([?&](?:token|key|password|email|authorization)=)[^\s&]+/gi, '$1[redacted]')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').slice(0, 2000);
}

class Telemetry {
  private enabled = import.meta.env.VITE_TELEMETRY_ENABLED === 'true'
    || import.meta.env.PROD && import.meta.env.VITE_TELEMETRY_ENABLED !== 'false';
  private queue: TelemetryEvent[] = [];
  private sending = false;
  private visitorId: string = uuid();
  private sessionId: string = uuid();
  private sessionNum = 0;
  private sessionOpen = false;
  private sessionAt = performance.now();
  private world: Pick<TelemetryContext, 'worldType' | 'worldPreset' | 'landform' | 'scenario' | 'mode' | 'width' | 'height'> = {
    worldType: 'menu', worldPreset: 'menu', landform: 'mixed', scenario: 'none', mode: 'menu', width: 0, height: 0,
  };
  private playing = false;
  private active = false;
  private activeMs = 0;
  private reportAt = performance.now();
  private lastFrame = 0;
  private frames = 0;
  private frameMs = 0;
  private frameWorkMs = 0;
  private stalls = 0;
  private worstFrame = 0;
  private longTasks = 0;
  private longTaskMs = 0;
  private buckets = new Uint32Array(65);
  private seenErrors = new Map<string, number>();
  private errorWindowAt = 0;
  private errorsInWindow = 0;
  private errorsInSession = 0;
  private endpoint = '';

  constructor() {
    const privacy = navigator as Navigator & { globalPrivacyControl?: boolean };
    this.enabled &&= navigator.doNotTrack !== '1' && !privacy.globalPrivacyControl;
    try {
      this.enabled &&= localStorage.getItem('tinyciv-telemetry-disabled') !== 'true';
      const visitor = localStorage.getItem(VISITOR_KEY);
      if (visitor && /^[a-f0-9-]{36}$/.test(visitor)) this.visitorId = visitor;
      else if (this.enabled) localStorage.setItem(VISITOR_KEY, this.visitorId);
      this.sessionNum = Math.max(0, Number(localStorage.getItem('tinyciv-telemetry-sessions')) || 0);
      const stored = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]');
      if (Array.isArray(stored)) this.queue = stored.filter(event => event && typeof event.id === 'string'
        && typeof event.kind === 'string' && Date.now() - event.at < 86400000).slice(-MAX_QUEUE);
    } catch { /* Storage is optional; telemetry never prevents startup. */ }
    try {
      const base = import.meta.env.VITE_TELEMETRY_URL || multiplayerEndpoint() || location.origin;
      const url = new URL('/api/telemetry', base);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) this.enabled = false;
      else this.endpoint = url.href;
    } catch { this.enabled = false; }
    if (!this.enabled) { this.queue = []; return; }
    this.beginSession();
    window.addEventListener('error', (event: Event) => {
      if (event instanceof ErrorEvent) this.error(event.error ?? event.message, 'uncaught');
      else {
        const target = event.target;
        if (target instanceof HTMLScriptElement || target instanceof HTMLImageElement || target instanceof HTMLLinkElement) {
          const url = target instanceof HTMLLinkElement ? target.href : target.src;
          this.error(`Asset failed: ${sanitizeError(url)}`, 'asset');
        }
      }
    }, true);
    window.addEventListener('unhandledrejection', event => this.error(event.reason, 'promise'));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.endSession(); this.persist(); void this.flush(true); }
      else { this.beginSession(); this.lastFrame = 0; }
    });
    window.addEventListener('pagehide', () => { this.endSession(); this.persist(); void this.flush(true); });
    window.addEventListener('pageshow', () => { if (!document.hidden) this.beginSession(); });
    window.addEventListener('online', () => { void this.flush(); });
    setInterval(() => { this.report(); void this.flush(); }, 15000);
    try {
      if (PerformanceObserver.supportedEntryTypes.includes('longtask')) new PerformanceObserver(list => {
        if (!this.active || document.hidden) return;
        for (const task of list.getEntries()) { this.longTasks++; this.longTaskMs += task.duration; }
      }).observe({ type: 'longtask', buffered: false });
    } catch { /* Long Tasks API is absent in some browsers. */ }
  }
  context(): TelemetryContext {
    return { visitorId: this.visitorId, sessionId: this.sessionId, sessionNum: this.sessionNum,
      build: String(import.meta.env.VITE_BUILD_VERSION || '0.1.0').replace(/[^\w.-]/g, '').slice(0, 32), ...this.world };
  }
  private beginSession(): void {
    if (this.sessionOpen || !this.enabled || document.hidden) return;
    this.sessionOpen = true; this.sessionId = uuid(); this.sessionAt = performance.now(); this.sessionNum++;
    try { localStorage.setItem('tinyciv-telemetry-sessions', String(this.sessionNum)); } catch {}
    this.emit('session-start');
  }
  private endSession(): void {
    if (!this.sessionOpen) return;
    this.report(true); this.emit('session-end', Math.min(172800, (performance.now() - this.sessionAt) / 1000));
    this.sessionOpen = false; this.active = false; this.lastFrame = 0;
  }
  private emit(kind: TelemetryKind, value = 1, extra: Partial<TelemetryEvent> = {}): void {
    if (!this.enabled) return;
    this.queue.push({ ...this.context(), id: uuid(), kind, at: Date.now(), value, ...extra });
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
  }
  private persist(): void {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(this.queue)); } catch {}
  }
  startPlay(state: GameState): void {
    if (!this.enabled) return;
    this.stopPlay();
    const worldType = state.world.generationStyle ?? 'unknown';
    this.world = { worldType, worldPreset: worldPreset(worldType, state.world.generationParameters), landform: state.world.landformFamily ?? 'mixed',
      scenario: state.world.scenario ?? 'none', mode: state.multiplayer ? 'multiplayer' : 'singleplayer',
      width: state.world.width, height: state.world.height };
    this.playing = true; this.reportAt = performance.now(); this.emit('play-start');
  }
  ensurePlay(state: GameState): void { if (!this.playing) this.startPlay(state); }
  attemptWorld(options: NewGameOptions): void {
    this.stopPlay();
    const worldType = options.scenario ? 'unknown' : options.style ?? 'fractal';
    this.world = { worldType, worldPreset: worldPreset(worldType, options.parameters), landform: options.landformFamily ?? 'mixed', scenario: options.scenario ?? 'none',
      mode: 'singleplayer', width: options.width ?? 0, height: options.height ?? 0 };
    this.emit('world-attempt');
  }
  stopPlay(): void {
    if (!this.playing) return;
    this.report(true); this.emit('play-end'); this.playing = false; this.active = false;
  }
  /** Constant work per rendered frame. Histogram quantiles are computed once/minute. */
  frame(now: number, workMs: number, active: boolean): void {
    if (!this.enabled) return;
    this.active = active && !document.hidden;
    if (this.active && this.playing && this.lastFrame) {
      const elapsed = now - this.lastFrame;
      if (elapsed > 0) {
        this.activeMs += Math.min(elapsed, 300000); this.frames++; this.frameMs += Math.min(elapsed, 1e9); this.frameWorkMs += workMs;
        this.worstFrame = Math.max(this.worstFrame, elapsed);
        if (elapsed >= 250) this.stalls++;
        this.buckets[Math.min(64, Math.floor(elapsed / 16))]++;
      }
    }
    this.lastFrame = this.active ? now : 0;
  }
  error(error: unknown, source: 'uncaught' | 'promise' | 'asset' | 'engine' | 'world-generation' | 'save-load' | 'multiplayer'): void {
    if (!this.enabled || this.errorsInSession >= 100) return;
    const now = performance.now(), message = sanitizeError(error), key = `${source}:${message}`;
    if (now - this.errorWindowAt >= 60000) { this.errorWindowAt = now; this.errorsInWindow = 0; }
    if (this.errorsInWindow >= 20 || now - (this.seenErrors.get(key) ?? -Infinity) < 60000) return;
    if (this.seenErrors.size >= 32) this.seenErrors.delete(this.seenErrors.keys().next().value!);
    this.seenErrors.set(key, now); this.errorsInWindow++; this.errorsInSession++;
    this.emit('error', 1, { source, message }); void this.flush();
  }
  private report(force = false): void {
    const now = performance.now();
    if (!force && now - this.reportAt < REPORT_MS) return;
    if (this.activeMs > 0) this.emit('heartbeat', this.activeMs / 1000);
    if (this.frames > 0) {
      let cumulative = 0, p95 = 0;
      for (let i = 0; i < this.buckets.length; i++) {
        cumulative += this.buckets[i]; if (cumulative >= this.frames * .95) { p95 = i === 64 ? this.worstFrame : (i + 1) * 16; break; }
      }
      this.emit('performance', this.frames * 1000 / this.frameMs, { metrics: {
        frames: this.frames, frameMs: this.frameMs, frameWorkMs: this.frameWorkMs, p95FrameMs: p95,
        stalls: this.stalls, worstFrameMs: this.worstFrame, longTasks: this.longTasks, longTaskMs: this.longTaskMs,
      } });
    }
    this.activeMs = this.frames = this.frameMs = this.frameWorkMs = this.stalls = this.worstFrame = this.longTasks = this.longTaskMs = 0;
    this.buckets.fill(0); this.reportAt = now;
  }
  async flush(keepalive = false): Promise<void> {
    if (!this.enabled || this.sending || !this.queue.length) return;
    this.sending = true;
    try {
      const batch: TelemetryEvent[] = [];
      const encoder = new TextEncoder(); let bytes = 16;
      for (const event of this.queue) {
        if (event.visitorId !== this.queue[0].visitorId) continue;
        const size = encoder.encode(JSON.stringify(event)).byteLength + 1;
        if (bytes + size > 48000 || batch.length >= MAX_BATCH) break;
        batch.push(event); bytes += size;
      }
      this.persist();
      // Bound UTF-8 bytes as well as event count for the browser's 64KB keepalive budget.
      const response = await fetch(this.endpoint, { method: 'POST', credentials: 'omit', keepalive,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events: batch }),
        signal: AbortSignal.timeout(8000) });
      if (response.ok || response.status === 400) {
        const sent = new Set(batch.map(event => event.id)); this.queue = this.queue.filter(event => !sent.has(event.id));
      }
    } catch { /* Offline/blocked analytics cannot affect gameplay. Bounded queue retries later. */ }
    finally {
      this.sending = false;
      this.persist();
    }
  }
}

export const telemetry = new Telemetry();
