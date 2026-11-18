import { multiplayerEndpoint } from '../multiplayer/client';
import { telemetry } from '../telemetry/client';

export interface AccountUser { id: string; email: string; displayName: string; createdAt: string; }
const SESSION_KEY = 'tinyciv-account-session';

export class AccountClient {
  private token = '';
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
  private async request(path: string, method = 'GET', input?: unknown, authenticated = true): Promise<any> {
    const url = new URL(path, this.endpoint || location.origin);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      throw new Error(path === '/api/feedback' ? 'Sending feedback requires HTTPS.' : 'Sign-in requires HTTPS.');
    const response = await fetch(url, { method, cache: 'no-store', credentials: 'omit',
      headers: { ...(input === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(authenticated && this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
      body: input === undefined ? undefined : JSON.stringify(input), signal: AbortSignal.timeout(20000) });
    let value;
    try { value = await response.json(); }
    catch { throw new Error(path === '/api/feedback' ? 'Feedback is unavailable. Your message has not been confirmed. Try again.' : 'Account service is unavailable. Try again.'); }
    if (!response.ok) {
      if (response.status === 401) this.remember('');
      throw new Error(value.error || 'Account request failed. Try again.');
    }
    return value;
  }
  async restore(): Promise<AccountUser | null> {
    if (!this.token) return null;
    return (await this.request('/api/auth/session')).user;
  }
  async signIn(mode: 'login' | 'create-account', email: string, password: string): Promise<AccountUser> {
    const result = await this.request(`/api/auth/${mode === 'login' ? 'login' : 'register'}`, 'POST', { email, password });
    if (!/^[a-f0-9]{64}$/.test(result.token) || typeof result.user?.email !== 'string')
      throw new Error('Account service returned an invalid session. Try again.');
    this.remember(result.token);
    return result.user;
  }
  async logout(): Promise<void> {
    if (this.token) await this.request('/api/auth/logout', 'POST', {});
    this.remember('');
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
