import { CompanyLab } from './engine';
import { SCENARIOS } from './scenarios';
import { LabRenderer, TEAM_COLORS } from './render';
import type { BattleSize, CompanyOrder, Point, ScenarioId, Soldier, Team } from './types';

const element = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = element<HTMLCanvasElement>('battlefield');
const renderer = new LabRenderer(canvas);
const scenarioInput = element<HTMLSelectElement>('scenario');
const sizeInput = element<HTMLSelectElement>('size');
const combatInput = element<HTMLInputElement>('combat');
const debugInput = element<HTMLInputElement>('debug');
const teamInput = element<HTMLSelectElement>('control-team');
for (const scenario of SCENARIOS) { const option = document.createElement('option'); option.value = scenario.id; option.textContent = scenario.name; scenarioInput.append(option); }
scenarioInput.value = 'town';
sizeInput.value = 'small';
const lab = new CompanyLab({ scenario: 'town', size: 'small', seed: 42, combat: true });
let team: Team = 0, order: CompanyOrder = 'move', paused = false, speed = 1, ready = false;
let accumulator = 0, lastTime = performance.now(), lastUi = 0, frameCpu = 0, toastUntil = 0;
let marker: { point: Point; at: number } | undefined;
let drag: { id: number; start: Point; current: Point; last: Point; pan: boolean; shift: boolean; moved: boolean } | undefined;
const cards = new Map<number, { button: HTMLButtonElement; status: HTMLElement; mode: HTMLElement; stars: HTMLElement; bars: HTMLElement[] }>();
const aliveCompanies = () => new Set(lab.soldiers.filter(s => s.hp > 0).map(s => s.company));
const chosen = () => lab.companies.filter(c => c.selected && c.team === team);
const orderNames: Partial<Record<CompanyOrder, string>> = { move: 'move', attack: 'attack-move', defend: 'defend', regroup: 'regroup', retreat: 'retreat to base' };
function toast(text: string): void { element('toast').textContent = text; element('toast').classList.add('show'); toastUntil = performance.now() + 2400; }
function setPaused(value: boolean): void { paused = value; accumulator = 0; const button = element<HTMLButtonElement>('pause'); button.setAttribute('aria-pressed', String(paused)); button.innerHTML = `${paused ? 'Resume' : 'Pause'} <kbd>Space</kbd>`; updateUi(); }
function setSpeed(value: number): void { speed = value; document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.speed) === speed))); }
function setOrder(value: CompanyOrder): void { order = value; document.querySelectorAll<HTMLButtonElement>('[data-order]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.order === order))); element('orders-text').textContent = `Right-click to ${orderNames[order]} selected companies`; }
function select(ids: number[], additive = false): void { const own = new Set(lab.companies.filter(c => c.team === team).map(c => c.id)); lab.select([...new Set([...(additive ? chosen().map(c => c.id) : []), ...ids.filter(id => own.has(id))])]); updateUi(); }
function setTeam(value: Team): void { team = value; teamInput.value = String(team); lab.select([]); buildRoster(); updateUi(); }
function selectArmy(): void { const living = aliveCompanies(); select(lab.companies.filter(c => c.team === team && living.has(c.id)).map(c => c.id)); }
function centerSelection(): void { const selected = chosen(); if (!selected.length) { toast('Select a company to center the camera.'); return; } renderer.camera = { x: selected.reduce((n, c) => n + c.x, 0) / selected.length, y: selected.reduce((n, c) => n + c.y, 0) / selected.length }; }
function issue(point: Point): void { const selected = chosen(); if (!selected.length) { toast('Select a company or use Select army first.'); return; } if (point.x < 0 || point.y < 0 || point.x >= lab.world.width || point.y >= lab.world.height) return; lab.command(team, point, order, selected.map(c => c.id)); marker = { point, at: performance.now() / 1000 }; toast(`${selected.length} ${selected.length === 1 ? 'company' : 'companies'} · ${orderNames[order]}`); updateUi(); }
function restart(): void {
  lab.reset({ scenario: scenarioInput.value as ScenarioId, size: sizeInput.value as BattleSize, seed: 42, combat: combatInput.checked });
  renderer.invalidate(); renderer.fit(lab.world); accumulator = 0; marker = undefined; drag = undefined; frameCpu = 0; toastUntil = 0; element('toast').classList.remove('show');
  buildRoster(); const first = lab.companies.find(c => c.team === team); select(first ? [first.id] : []);
  const scenario = SCENARIOS.find(s => s.id === scenarioInput.value)!;
  element('scenario-name').textContent = scenario.name; element('scenario-description').textContent = scenario.description;
  updateUi();
}
function buildRoster(): void {
  cards.clear(); const roster = element('roster'); roster.replaceChildren();
  element('roster-title').textContent = `${team ? 'Blue' : 'Red'} companies`;
  for (const company of lab.companies) if (company.team === team) {
    const button = document.createElement('button'); button.className = 'company-card'; button.dataset.company = String(company.id);
    button.innerHTML = `<div class="company-heading"><span class="number">${String(company.id).padStart(2, '0')}</span><span class="kind">${company.kind === 'archer' ? 'Archers' : 'Infantry'}</span><span class="stars"></span></div><div class="company-sub"><span class="status"></span><span class="mode"></span></div><div class="health-bars"><i><b></b></i><i><b></b></i><i><b></b></i></div>`;
    button.addEventListener('click', event => select([company.id], event.shiftKey));
    button.addEventListener('dblclick', () => { select([company.id]); centerSelection(); });
    roster.append(button); cards.set(company.id, { button, status: button.querySelector('.status')!, mode: button.querySelector('.mode')!, stars: button.querySelector('.stars')!, bars: Array.from(button.querySelectorAll('b')) });
  }
}
function updateUi(): void {
  const stats = lab.stats, living = lab.soldiers.filter(s => s.hp > 0), byId = new Map(lab.soldiers.map(s => [s.id, s]));
  const aliveByCompany = new Set(living.map(s => s.company)), selected = chosen(), selectedIds = new Set(selected.map(c => c.id));
  const red = living.filter(s => s.team === 0).length, blue = living.length - red;
  const texts: Record<string, string> = {
    time: `${Math.floor(lab.time / 60)}:${String(Math.floor(lab.time % 60)).padStart(2, '0')}`,
    'metric-frame': frameCpu.toFixed(1), 'metric-frame-note': `ms · step p95 ${stats.p95StepMs.toFixed(1)}`,
    'metric-path': stats.pathMs.toFixed(1), 'metric-path-note': `ms total · ${stats.searches} searches`,
    'metric-wait': String(stats.stuckUnits), 'metric-stuck': `${stats.waiting} waiting`,
    'metric-idle': stats.idleDrift.toFixed(3), 'metric-cohesion': stats.cohesionP95.toFixed(2),
    'metric-moving': String(stats.moving), 'metric-alive': `of ${living.length} soldiers`,
    'red-count': String(red), 'blue-count': String(blue),
    'battle-state': paused ? 'Paused' : red && blue ? lab.combatEnabled ? 'Combat live' : 'Movement only' : red ? 'Red survives' : blue ? 'Blue survives' : 'Battle ended',
    'selection-count': `${selected.length} selected`,
    'roster-count': `${lab.companies.filter(c => c.team === team && aliveByCompany.has(c.id)).length} active`,
    'selection-note': selected.length ? `${selected.length} ${selected.length === 1 ? 'company' : 'companies'} · ${living.filter(s => selectedIds.has(s.company)).length} soldiers. Right-click to ${orderNames[order]}.` : 'Select a company or the whole army, then right-click its destination.',
  };
  for (const [id, value] of Object.entries(texts)) { const el = element(id); if (el.textContent !== value) el.textContent = value; }
  for (const company of lab.companies) {
    const card = cards.get(company.id); if (!card) continue;
    const alive = aliveByCompany.has(company.id); card.button.classList.toggle('selected', company.selected); card.button.classList.toggle('dead', !alive); card.button.setAttribute('aria-pressed', String(company.selected));
    card.status.textContent = alive ? company.status : 'Destroyed'; card.mode.textContent = alive ? company.mode : '';
    card.stars.textContent = '★'.repeat(Math.max(0, Math.min(3, Math.floor(company.veterancy))));
    const members: (Soldier | undefined)[] = company.soldierIds.map(id => byId.get(id));
    card.bars.forEach((bar, index) => { const unit = members[index], fraction = unit ? Math.max(0, unit.hp / unit.maxHp) : 0; bar.style.width = `${fraction * 100}%`; bar.style.background = fraction < .3 ? '#d99968' : TEAM_COLORS[company.team]; bar.parentElement!.classList.toggle('empty', !fraction); bar.parentElement!.title = unit ? `${Math.ceil(Math.max(0, unit.hp))} / ${unit.maxHp} HP` : 'No soldier'; });
    card.button.setAttribute('aria-label', `Company ${company.id}, ${company.kind}, ${alive ? company.status : 'destroyed'}, ${members.filter(s => s && s.hp > 0).length} soldiers, veterancy ${company.veterancy}`);
  }
}

scenarioInput.addEventListener('change', restart); sizeInput.addEventListener('change', restart); element('reset').addEventListener('click', restart);
combatInput.addEventListener('change', () => { lab.setCombat(combatInput.checked); updateUi(); toast(combatInput.checked ? 'Combat enabled. Use Attack to advance.' : 'Combat disabled. Existing movement orders continue.'); });
element('pause').addEventListener('click', () => setPaused(!paused));
document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach(button => button.addEventListener('click', () => setSpeed(Number(button.dataset.speed))));
document.querySelectorAll<HTMLButtonElement>('[data-order]').forEach(button => button.addEventListener('click', () => { setOrder(button.dataset.order as CompanyOrder); updateUi(); }));
teamInput.addEventListener('change', () => setTeam(Number(teamInput.value) as Team));
element('select-all').addEventListener('click', selectArmy); element('clear-selection').addEventListener('click', () => select([])); element('center-selection').addEventListener('click', centerSelection);
element('zoom-in').addEventListener('click', () => renderer.zoomAt(1.3)); element('zoom-out').addEventListener('click', () => renderer.zoomAt(1 / 1.3)); element('fit').addEventListener('click', () => renderer.fit(lab.world));
const pixel = (event: MouseEvent): Point => { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
canvas.addEventListener('contextmenu', event => { event.preventDefault(); issue(renderer.point(pixel(event))); });
canvas.addEventListener('wheel', event => { event.preventDefault(); renderer.zoomAt(Math.exp(-event.deltaY * .0013), pixel(event)); }, { passive: false });
canvas.addEventListener('pointerdown', event => { if (event.button !== 0 && event.button !== 1) return; event.preventDefault(); canvas.focus({ preventScroll: true }); const start = pixel(event); drag = { id: event.pointerId, start, current: start, last: start, pan: event.button === 1, shift: event.shiftKey, moved: false }; canvas.setPointerCapture(event.pointerId); });
canvas.addEventListener('pointermove', event => { if (!drag || drag.id !== event.pointerId) return; drag.current = pixel(event); if (Math.hypot(drag.current.x - drag.start.x, drag.current.y - drag.start.y) > 5) drag.moved = true; if (drag.pan) renderer.pan(drag.current.x - drag.last.x, drag.current.y - drag.last.y); drag.last = drag.current; });
canvas.addEventListener('pointerup', event => {
  if (!drag || drag.id !== event.pointerId) return; const gesture = drag; drag = undefined; if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); if (gesture.pan) return;
  if (gesture.moved) {
    const a = renderer.point(gesture.start), b = renderer.point(gesture.current), ids = new Set<number>();
    for (const unit of lab.soldiers) if (unit.hp > 0 && unit.team === team && unit.x >= Math.min(a.x, b.x) && unit.x <= Math.max(a.x, b.x) && unit.y >= Math.min(a.y, b.y) && unit.y <= Math.max(a.y, b.y)) ids.add(unit.company);
    select([...ids], gesture.shift);
  } else {
    const point = renderer.point(pixel(event)); let nearest: Soldier | undefined, distance = Math.max(.9, 12 / renderer.scale);
    for (const unit of lab.soldiers) if (unit.hp > 0) { const d = Math.hypot(unit.x - point.x, unit.y - .35 - point.y); if (d < distance) { distance = d; nearest = unit; } }
    if (nearest) { if (nearest.team !== team) setTeam(nearest.team); select([nearest.company], gesture.shift); } else if (!gesture.shift) select([]);
  }
});
canvas.addEventListener('pointercancel', () => { drag = undefined; });
window.addEventListener('keydown', event => {
  const target = event.target as HTMLElement; if (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName) || target.isContentEditable) return;
  const key = event.key.toLowerCase();
  if (key === ' ') { event.preventDefault(); if (!event.repeat) setPaused(!paused); }
  else if ((event.ctrlKey || event.metaKey) && key === 'a') { event.preventDefault(); selectArmy(); }
  else if (key === 'escape') { drag = undefined; select([]); }
  else if (['1', '2', '4'].includes(key)) setSpeed(Number(key));
  else if (key === 'f') centerSelection();
  else { const commands: Record<string, CompanyOrder> = { m: 'move', a: 'attack', d: 'defend', g: 'regroup', r: 'retreat' }; if (commands[key]) { setOrder(commands[key]); updateUi(); } }
});
new ResizeObserver(() => renderer.resize(lab.world)).observe(canvas.parentElement!);
function frame(now: number): void {
  const elapsed = Math.min(.2, Math.max(0, (now - lastTime) / 1000)); lastTime = now;
  if (ready) {
    const began = performance.now();
    if (!paused) { accumulator = Math.min(.25, accumulator + elapsed * speed); let steps = 0; while (accumulator >= 1 / 60 && steps++ < 16) { lab.step(1 / 60); accumulator -= 1 / 60; } }
    renderer.draw(lab, { debug: debugInput.checked, now: now / 1000, box: drag && drag.moved && !drag.pan ? { a: drag.start, b: drag.current } : undefined, marker });
    const cpu = performance.now() - began; frameCpu = frameCpu ? frameCpu * .9 + cpu * .1 : cpu; lab.stats.frameMs = frameCpu;
    if (now - lastUi > 200) { updateUi(); lastUi = now; }
    if (toastUntil && now > toastUntil) { element('toast').classList.remove('show'); toastUntil = 0; }
  }
  requestAnimationFrame(frame);
}
Object.assign(window, { __companyLab: lab, __companyUI: { renderer, select, selectArmy, setTeam, setOrder, setPaused, setSpeed, restart, issue, updateUi } });
renderer.load().then(() => { restart(); element('loading').hidden = true; ready = true; lastTime = performance.now(); }).catch(error => { element('loading').textContent = `The embedded artwork could not load: ${String(error)}`; console.error(error); });
requestAnimationFrame(frame);
