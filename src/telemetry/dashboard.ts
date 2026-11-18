import '../ui/game-font.css';
import './dashboard.css';
import { multiplayerEndpoint } from '../multiplayer/client';

interface Totals { players: number; sessions: number; play_sessions: number; worlds: number; attempts: number; play_seconds: number; errors: number; error_sessions: number; frames: number; frame_ms: number; stalls: number; }
interface WorldUsage { world_type: string; world_preset: string; landform: string; scenario: string; mode: string; starts: number; attempts: number; players: number; play_seconds: number; errors: number; frames: number; frame_ms: number; stalls: number; }
interface Usage {
  days: number; generatedAt: string; summary: Totals;
  daily: { day: string; players: number; worlds: number; play_seconds: number; errors: number }[];
  worlds: WorldUsage[];
  errors: { source: string; message: string; build: string; occurrences: number; last_seen: string }[];
  performance: { build: string; sessions: number; frames: number; frame_ms: number; worst_frame_ms: number; mean_p95_frame_ms: number; stalls: number; long_task_ms: number }[];
  delivery: { ga_state: string; events: number }[];
  gameAnalytics: { configured: boolean; enabled: boolean; lastSuccess: string | null };
}
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const esc = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));
const number = (value: unknown, decimals = 0) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: decimals });
const hours = (seconds: number) => `${number(seconds / 3600, 1)} h`;
const fps = (frames: number, ms: number) => ms > 0 ? number(frames * 1000 / ms, 1) : '—';
const title = (value: string) => value === 'none' ? 'Generated world' : value.replace(/-/g,' ').replace(/\b\w/g, c => c.toUpperCase());
const table = (headings: string[], rows: string[][]) => rows.length
  ? `<div class="table-scroll"><table><thead><tr>${headings.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
  : '<p class="empty">No events in this period.</p>';
let token = '', days = 7, busy = false;
try { token = sessionStorage.getItem('tinyciv-account-session') ?? ''; } catch {}
const endpoint = multiplayerEndpoint() || location.origin;
async function request(path: string, input?: unknown): Promise<any> {
  const url = new URL(path, endpoint);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw new Error('Analytics requires HTTPS.');
  const response = await fetch(url, { method: input ? 'POST' : 'GET', credentials: 'omit', cache: 'no-store',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(input ? { 'Content-Type': 'application/json' } : {}) },
    body: input ? JSON.stringify(input) : undefined, signal: AbortSignal.timeout(20000) });
  const result = await response.json();
  if (!response.ok) { if (response.status === 401) { token = ''; $('#sign-in').hidden = false; $('#dashboard').hidden = true; } throw new Error(result.error || 'Analytics is unavailable.'); }
  return result;
}
function render(data: Usage): void {
  const s = data.summary, maxPlayers = Math.max(1, ...data.daily.map(day => day.players));
  const cards = [ ['Players',number(s.players)], ['Sessions',number(s.sessions)], ['Worlds started',number(s.worlds)],
    ['Play time',hours(s.play_seconds)], ['Average play / game session',`${number(s.play_seconds / Math.max(1,s.play_sessions) / 60,1)} min`],
    ['Average FPS',fps(s.frames,s.frame_ms)], ['Stalls ≥250 ms',number(s.stalls)], ['Error sessions',number(s.error_sessions)] ];
  $('#dashboard').innerHTML = `<div class="toolbar"><h1>Game usage</h1><div class="toolbar-actions"><label>Period<select id="days"><option value="1" ${days===1?'selected':''}>24 hours</option><option value="7" ${days===7?'selected':''}>7 days</option><option value="30" ${days===30?'selected':''}>30 days</option></select></label><button id="refresh">Refresh</button><button id="logout">Sign out</button></div></div>
  <div class="cards">${cards.map(([label,value])=>`<article class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></article>`).join('')}</div>
  <section class="panel"><h2>Daily players</h2>${data.daily.length ? `<div class="bars" role="img" aria-label="Daily active players">${data.daily.map(day=>`<div class="bar-column"><span>${number(day.players)}</span><div class="bar" style="height:${Math.max(2,day.players/maxPlayers*120)}px"></div><time>${esc(day.day.slice(5))}</time></div>`).join('')}</div>` : '<p class="empty">No events in this period.</p>'}</section>
  <section class="panel"><h2>Worlds &amp; scenarios</h2>${table(['World','Landform','Scenario','Mode','Attempts','Starts','Players','Play time','FPS','Stalls','Errors'],data.worlds.map(w=>[esc(title(w.world_preset)),esc(title(w.landform)),esc(title(w.scenario)),esc(title(w.mode)),number(w.attempts),number(w.starts),number(w.players),hours(w.play_seconds),fps(w.frames,w.frame_ms),number(w.stalls),number(w.errors)]))}</section>
  <section class="panel"><h2>Performance by build</h2>${table(['Build','Sessions','FPS','Mean frame p95','Worst frame','Stalls','Long tasks'],data.performance.map(p=>[esc(p.build),number(p.sessions),fps(p.frames,p.frame_ms),`${number(p.mean_p95_frame_ms)} ms`,`${number(p.worst_frame_ms)} ms`,number(p.stalls),`${number(p.long_task_ms/1000,1)} s`]))}</section>
  <section class="panel"><h2>Errors</h2>${table(['Source','Error','Build','Reports','Last seen'],data.errors.map(e=>[esc(e.source),`<code>${esc(e.message)}</code>`,esc(e.build),number(e.occurrences),esc(new Date(e.last_seen).toLocaleString())]))}</section>
  <section class="panel delivery"><h2>GameAnalytics delivery</h2><p>${data.gameAnalytics.configured ? data.gameAnalytics.enabled ? 'Connected' : 'Collection disabled by GameAnalytics' : 'Awaiting GameAnalytics credentials'}</p>
  <div>${data.delivery.map(d=>`<span>${esc(title(d.ga_state))}: <strong>${number(d.events)}</strong></span>`).join('')}</div>
  ${data.gameAnalytics.lastSuccess?`<p>Last delivered ${esc(new Date(data.gameAnalytics.lastSuccess).toLocaleString())}</p>`:''}</section>
  <footer>Updated ${esc(new Date(data.generatedAt).toLocaleString())} · Visible play time excludes menus and pauses · Error reports are deduplicated · Frame p95 uses 16 ms buckets</footer>`;
  $('#days').addEventListener('change', event=>{days=Number((event.target as HTMLSelectElement).value);void load();});
  $('#refresh').onclick=()=>{void load();};
  $('#logout').onclick=()=>{token='';try{sessionStorage.removeItem('tinyciv-account-session');}catch{}$('#dashboard').hidden=true;$('#sign-in').hidden=false;$('#status').textContent='';};
}
async function load(): Promise<void> {
  if(busy)return;busy=true;$('#status').textContent='Loading usage…';
  try {const data:Usage=await request(`/api/analytics?days=${days}`);render(data);$('#dashboard').hidden=false;$('#sign-in').hidden=true;$('#status').textContent='';}
  catch(error){$('#status').textContent=error instanceof Error?error.message:'Analytics is unavailable.';}
  finally{busy=false;}
}
$('#login').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget as HTMLFormElement;const fields=new FormData(form);const email=String(fields.get('email')??''),password=String(fields.get('password')??'');
  const button=form.querySelector('button')!;button.disabled=true;$('#status').textContent='Signing in…';
  void request('/api/auth/login',{email,password}).then(result=>{token=result.token;try{sessionStorage.setItem('tinyciv-account-session',token);}catch{}form.reset();return load();})
    .catch(error=>{$('#status').textContent=error instanceof Error?error.message:'Sign-in failed.';}).finally(()=>{button.disabled=false;});
});
if(token)void load();
