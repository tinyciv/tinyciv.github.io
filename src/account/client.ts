import { multiplayerEndpoint } from '../multiplayer/client';

export interface AccountUser { id: string; email: string; displayName: string; createdAt: string; }
const SESSION_KEY = 'tinyciv-account-session';

export class AccountClient {
  private token = '';
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
  private async request(path: string, method = 'GET', input?: unknown): Promise<any> {
    const url = new URL(path, this.endpoint || location.origin);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      throw new Error('Sign-in requires HTTPS.');
    const response = await fetch(url, { method, cache: 'no-store', credentials: 'omit',
      headers: { ...(input === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
      body: input === undefined ? undefined : JSON.stringify(input), signal: AbortSignal.timeout(20000) });
    let value;
    try { value = await response.json(); }
    catch { throw new Error('Account service is unavailable. Try again.'); }
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
}
