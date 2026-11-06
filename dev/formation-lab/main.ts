import { FormationLab, FORMATION_SPEED, CATCHUP_SPEED, frontMultiplier, type Scenario } from './engine';
import { Renderer } from './render';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let lab = new FormationLab('gate', 12), paused = false, speed = 1, last = performance.now(), frameMs = 0;
const renderer = new Renderer($<HTMLCanvasElement>('battle'));
const icons = [
  '<svg viewBox="0 0 32 32"><g fill="currentColor"><path d="M5 5h5v5H5zm9 0h5v5h-5zm9 0h5v5h-5zM5 14h5v5H5zm18 0h5v5h-5zM5 23h5v5H5zm9 0h5v5h-5zm9 0h5v5h-5z"/><path fill="#fff4bc" d="m16.5 12 4.5 4.5-4.5 4.5-4.5-4.5z"/></g></svg>',
  '<svg viewBox="0 0 32 32"><path d="m5 5 11-3 11 3v13c0 5-11 12-11 12S5 23 5 18z" fill="none" stroke="currentColor" stroke-width="2"/><path fill="currentColor" d="M8 9h4v4H8zm12 0h4v4h-4zM8 16h4v4H8zm12 0h4v4h-4z"/><path fill="#fff4bc" d="m16 9 3 5-3 9-3-9z"/></svg>',
  '<svg viewBox="0 0 32 32"><path d="M4 10 16 3l12 7M4 17l12-7 12 7M4 24l12-7 12 7" fill="none" stroke="currentColor" stroke-width="3"/><path fill="#fff4bc" d="M13 23h6v6h-6z"/></svg>',
];
let chosenIcon = 0;
const held = new Set<string>();
function clearMovement() { held.clear(); lab.setStrafe(0); }
function updateMovement() { lab.setStrafe((Number(held.has('d')) - Number(held.has('a'))) as -1 | 0 | 1); }
function updateIcon() { $('formation-icon').innerHTML = icons[chosenIcon]; document.querySelectorAll('[data-icon]').forEach((button, i) => button.setAttribute('aria-pressed', String(i === chosenIcon))); }
function reset() { clearMovement(); lab = new FormationLab($<HTMLSelectElement>('scenario').value as Scenario, Number($<HTMLSelectElement>('army').value)); paused = false; renderer.marker = undefined; renderer.fit(lab); update(); }
function update() {
  $('formation').setAttribute('aria-pressed', String(lab.formation)); $('mode').textContent = lab.mode === 'rectangle' ? 'Close ranks' : lab.mode === 'column' ? 'Column' : 'Loose order';
  $('status').textContent = lab.status; $('speed-value').textContent = lab.formation ? '70%' : '100%';
  $('cohesion').textContent = `${lab.slotError.toFixed(2)} tiles`; $('alive').textContent = `${lab.troops.filter(unit => unit.hp > 0).length} / ${lab.count}`;
  $('cpu').textContent = `${frameMs.toFixed(1)} ms`; $('path-time').textContent = `${lab.nav.milliseconds.toFixed(1)} ms`;
  $('dealt').textContent = `${Math.round(lab.damageDealt)}`; $('taken').textContent = `${Math.round(lab.damageTaken)}`;
  $('bonus').textContent = String(lab.frontalHits); $('ordinary').textContent = String(lab.flankHits);
  $('pause').textContent = paused ? 'Resume' : 'Pause'; $('clock').textContent = `${Math.floor(lab.time / 60)}:${String(Math.floor(lab.time % 60)).padStart(2, '0')}`;
}
function moveTo(x: number, y: number) { clearMovement(); if (lab.command({ x, y })) renderer.marker = { point: { x, y }, at: lab.time }; update(); }
function toggle() { lab.toggle(); update(); }
$('formation').onclick = toggle; $('reset').onclick = reset; $('scenario').onchange = reset; $('army').onchange = reset;
$('march').onclick = () => moveTo(lab.world.goal.x, lab.world.goal.y);
$('front').onclick = () => { lab.spawnAttack('front'); update(); }; $('flank').onclick = () => { lab.spawnAttack('flank'); update(); }; $('rear').onclick = () => { lab.spawnAttack('rear'); update(); };
$('left').onclick = () => lab.turn(-Math.PI / 2); $('right').onclick = () => lab.turn(Math.PI / 2);
$('pause').onclick = () => { paused = !paused; update(); };
$('rate').onclick = () => { speed = speed === 1 ? 2 : 1; $('rate').textContent = `${speed}×`; };
$('zoom-in').onclick = () => renderer.zoomAt(lab, 1.4);
$('zoom-out').onclick = () => renderer.zoomAt(lab, 1 / 1.4);
$('fit').onclick = () => renderer.fit(lab);
$<HTMLInputElement>('debug').onchange = event => { renderer.debug = (event.target as HTMLInputElement).checked; };
document.querySelectorAll<HTMLElement>('[data-icon]').forEach((button, i) => { button.innerHTML = `${icons[i]}<span>${['1A · Ranks', '2B · Shield', '3C · Chevron'][i]}</span>`; button.onclick = () => { chosenIcon = i; updateIcon(); }; });
renderer.canvas.addEventListener('pointerdown', event => { const bounds = renderer.canvas.getBoundingClientRect(), p = renderer.point({ x: event.clientX - bounds.left, y: event.clientY - bounds.top }); moveTo(p.x, p.y); });
renderer.canvas.addEventListener('contextmenu', event => event.preventDefault());
renderer.canvas.addEventListener('wheel', event => { event.preventDefault(); const box = renderer.canvas.getBoundingClientRect(); renderer.zoomAt(lab, event.deltaY < 0 ? 1.15 : 1 / 1.15, { x: event.clientX - box.left, y: event.clientY - box.top }); }, { passive: false });
window.addEventListener('keydown', event => {
  if ((event.target as HTMLElement).closest('select,input,textarea,[contenteditable="true"]')) return;
  const key = event.key.toLowerCase();
  if (key === 'a' || key === 'd') {
    event.preventDefault(); held.add(key); updateMovement(); renderer.marker = undefined; return;
  }
  if (event.repeat) return;
  if (key === '3') { event.preventDefault(); toggle(); }
  if (event.code === 'Space') { event.preventDefault(); paused = !paused; }
  if (key === 'q' || key === 'e') { event.preventDefault(); lab.turn(key === 'q' ? -Math.PI / 2 : Math.PI / 2); }
});
window.addEventListener('keyup', event => { if (held.delete(event.key.toLowerCase())) updateMovement(); });
window.addEventListener('blur', clearMovement);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearMovement(); });
document.addEventListener('focusin', event => { if ((event.target as HTMLElement).closest('select,input,textarea,[contenteditable="true"]')) clearMovement(); });
window.addEventListener('resize', () => renderer.resize(lab));
await renderer.load(); renderer.resize(lab); updateIcon(); $('loading').hidden = true;
const samples: number[] = [];
function frame(now: number) {
  const dt = Math.min(.05, (now - last) / 1000); last = now; const start = performance.now();
  if (!paused) for (let i = 0; i < speed; i++) lab.step(dt);
  renderer.draw(lab); samples.push(performance.now() - start); if (samples.length > 60) samples.shift(); frameMs = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  update(); requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// Explicit, isolated inspection hooks for the standalone prototype only.
Object.assign(window, { formationLab: { get lab() { return lab; }, renderer, reset(scenario: Scenario, count: number) { $('scenario').setAttribute('value', scenario); $<HTMLSelectElement>('scenario').value = scenario; $<HTMLSelectElement>('army').value = String(count); reset(); },
  pause(value = true) { paused = value; }, step(seconds: number) { for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += .025) lab.step(.025); renderer.draw(lab); update(); return lab.snapshot(); },
  snapshot: () => lab.snapshot(), moveTo, toggle, frontMultiplier, constants: { FORMATION_SPEED, CATCHUP_SPEED } } });
