import { multiplayerEndpoint } from '../multiplayer/client';
import { telemetry } from '../telemetry/client';
import type { StoredGameDetails, StoredGameSummary } from '../game/game-storage';
import { CLOUD_SAVE_MAX_BYTES, CLOUD_SAVE_PATH } from './cloud-save';

export interface AccountUser { id: string; username: string | null; email: string | null; displayName: string; createdAt: string; }
export type AccountCredentials = { mode: 'login'; identifier: string; password: string }
  | { mode: 'create-account'; username: string; email: string; password: string };
const SESSION_KEY = 'tinyciv-account-session';
const MAX_DECOMPRESSED_SAVE_BYTES = 128 * 1024 * 1024;

export class AccountClient {
  private token = '';
  private currentUser: AccountUser | null = null;
  private pendingFeedback: { id: string; message: string; authenticated: boolean } | undefined;
  constructor(private readonly endpoint = multiplayerEndpoint()) {
    try {
      const token = sessionStorage.getItem(SESSION_KEY) ?? '';
      if (/^[a-f0-9]{64}$/.test(token)) this.token = token;
    } catch { /* Memory-only sessions still work. */ }
  }
  private remember(token: string): void {
    this.token = token;
    try { if (token) sessionStorage.setItem(SESSION_KEY, token); else sessionStorage.removeItem(SESSION_KEY); } catch {}
  }
  get user(): AccountUser | null { return this.currentUser; }

  private async fetch(path: string, method: string, body?: BodyInit, contentType?: string, authenticated = true): Promise<Response> {
    const url = new URL(path, this.endpoint || location.origin);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      throw new Error(path === '/api/feedback' ? 'Sending feedback requires HTTPS.' : 'Sign-in requires HTTPS.');
    const token = authenticated ? this.token : '';
    const response = await fetch(url, { method, cache: 'no-store', credentials: 'omit',
      headers: { ...(contentType ? { 'Content-Type': contentType } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body, signal: AbortSignal.timeout(path.startsWith(CLOUD_SAVE_PATH) ? 60000 : 20000) });
    if (!response.ok) {
      if (response.status === 401 && token && token === this.token) this.remember('');
      const value = await response.json().catch(() => null);
      throw new Error(value?.error || 'Account request failed. Try again.');
    }
    return response;
  }
  private async request(path: string, method = 'GET', input?: unknown, authenticated = true): Promise<any> {
    const response = await this.fetch(path, method, input === undefined ? undefined : JSON.stringify(input), input === undefined ? undefined : 'application/json', authenticated);
    try { return await response.json(); }
    catch { throw new Error(path === '/api/feedback' ? 'Feedback is unavailable. Your message has not been confirmed. Try again.' : 'Account service is unavailable. Try again.'); }
  }
  async restore(): Promise<AccountUser | null> {
    if (!this.token) return null;
    const token = this.token;
    const { user } = await this.request('/api/auth/session');
    if (this.token === token) this.currentUser = user;
    return this.currentUser;
  }
  async signIn(credentials: AccountCredentials): Promise<AccountUser> {
    const input = credentials.mode === 'create-account' ? { username: credentials.username, email: credentials.email || undefined }
      : credentials.identifier.includes('@') ? { email: credentials.identifier } : { username: credentials.identifier };
    const result = await this.request(`/api/auth/${credentials.mode === 'login' ? 'login' : 'register'}`, 'POST', { ...input, password: credentials.password }, false);
    if (!/^[a-f0-9]{64}$/.test(result.token) || typeof result.user?.id !== 'string' || typeof result.user.displayName !== 'string')
      throw new Error('Account service returned an invalid session. Try again.');
    this.remember(result.token);
    return this.currentUser = result.user;
  }
  async logout(): Promise<void> {
    if (this.token) await this.request('/api/auth/logout', 'POST', {});
    this.useGuest();
  }
  useGuest(): void {
    this.remember('');
    this.currentUser = null;
  }
  private checkSaveOwner(userId: string): void {
    if (this.currentUser?.id !== userId || !this.token) throw new Error('Sign in to access your cloud saves.');
  }
  async listGames(userId: string): Promise<StoredGameSummary[]> {
    this.checkSaveOwner(userId);
    const { saves } = await this.request(CLOUD_SAVE_PATH);
    this.checkSaveOwner(userId);
    return saves;
  }
  async readGame(userId: string, id: string): Promise<string> {
    this.checkSaveOwner(userId);
    const response = await this.fetch(`${CLOUD_SAVE_PATH}/${encodeURIComponent(id)}`, 'GET');
    if (!response.body) throw new Error('This cloud save is incomplete.');
    let expanded = 0;
    const bounded = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        expanded += chunk.byteLength;
        if (expanded > MAX_DECOMPRESSED_SAVE_BYTES) throw new Error('This cloud save is too large to load.');
        controller.enqueue(chunk);
      },
    });
    const stream = response.body.pipeThrough(new DecompressionStream('gzip')).pipeThrough(bounded);
    const serialized = await new Response(stream).text();
    this.checkSaveOwner(userId);
    return serialized;
  }
  async writeGame(userId: string, id: string, serialized: string, { name, time, seed, civilization }: StoredGameDetails): Promise<void> {
    this.checkSaveOwner(userId);
    const stream = new Blob([serialized]).stream().pipeThrough(new CompressionStream('gzip'));
    const compressed = await new Response(stream).blob();
    if (compressed.size > CLOUD_SAVE_MAX_BYTES) throw new Error('This game is too large to save to the cloud.');
    this.checkSaveOwner(userId);
    const payload = new Blob([JSON.stringify({ name, time, seed, civilization }), '\n', compressed]);
    await this.fetch(`${CLOUD_SAVE_PATH}/${encodeURIComponent(id)}`, 'PUT', payload, 'application/octet-stream');
  }
  async data(): Promise<{ user: AccountUser; data: Record<string, unknown> }> {
    return this.request('/api/account');
  }
  async saveData(data: Record<string, unknown>): Promise<void> {
    await this.request('/api/account', 'PATCH', { data });
  }
  async submitFeedback(message: string, authenticated: boolean): Promise<void> {
    // Reusing an ID after an uncertain response makes retries idempotent.
    if (this.pendingFeedback?.message !== message || this.pendingFeedback.authenticated !== authenticated)
      this.pendingFeedback = { id: crypto.randomUUID(), message, authenticated };
    const { visitorId, sessionId, build, worldType, scenario, mode } = telemetry.context();
    try {
      await this.request('/api/feedback', 'POST', { id: this.pendingFeedback.id, message, visitorId,
        context: { sessionId, build, worldType, scenario, mode, page: location.pathname } }, authenticated);
    } catch (error) {
      if (error instanceof TypeError || error instanceof DOMException)
        throw new Error('Feedback could not be confirmed. Check your connection and try again.');
      throw error;
    }
    this.pendingFeedback = undefined;
  }
}
