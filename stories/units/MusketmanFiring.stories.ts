import type { Meta, StoryObj } from '@storybook/html-vite';
import { loadGameFonts } from '../../src/game/game-font';
import { drawMusketman, loadMusketmanArt } from '../../src/game/musketman-art';
import { drawMusketBullet } from '../../src/game/musket-projectile-art';
import { drawPuny, loadPunyWorld } from '../../src/game/puny-world';
import { rustEngine } from '../../src/game/rust-engine';
import type { Point, Unit } from '../../src/game/types';
import './musketman-firing.css';

const DIRECTIONS = { E: 0, SE: Math.PI / 4, S: Math.PI / 2, SW: 3 * Math.PI / 4,
  W: Math.PI, NW: -3 * Math.PI / 4, N: -Math.PI / 2, NE: -Math.PI / 4 } as const;
interface Args { direction: keyof typeof DIRECTIONS; soldiers: number; color: string; paused: boolean }
const TILE = 32, WIDTH = 340, HEIGHT = 250, SCALE = 2;
// Encoding only: role 7 and kind 24 match the native retinue/kind declarations.
const RANGE = rustEngine.retinue_stat(7, 4);
const RELOAD = rustEngine.retinue_attack_timing(24, 0);
const ATTACK = rustEngine.retinue_attack_timing(24, 1);

/** A seekable visual fixture. Rust's resident projectile engine supplies every
 * bullet position; this story never starts a game or runs an AI/economy loop. */
class PreviewFlight {
  private readonly handle = rustEngine.projectiles_create();
  private readonly pointer = rustEngine.projectiles_input(this.handle, 1);
  readonly end: Point;
  readonly duration: number;
  constructor(facing: number) {
    this.end = { x: Math.cos(facing) * RANGE, y: Math.sin(facing) * RANGE };
    this.duration = rustEngine.projectiles_duration_for_kind(0, 0, this.end.x, this.end.y, 4);
  }
  sample(elapsed: number): Point | undefined {
    if (elapsed < 0 || elapsed >= this.duration) return;
    // [id,startX,startY,elapsed,duration,damage,kind,tower,faction,
    //  x,y,endX,endY,targetX,targetY,targetFacts]. No damage is applied here.
    new Float64Array(rustEngine.memory.buffer, this.pointer, 16).set([
      1, 0, 0, elapsed, this.duration, 0, 4, 0, 0,
      0, 0, this.end.x, this.end.y, this.end.x, this.end.y, 1 | 4 | 16,
    ]);
    rustEngine.projectiles_publish(this.handle, 0);
    rustEngine.projectiles_begin(this.handle, 1, 0, 1);
    const pointer = rustEngine.projectiles_advance(this.handle, 0, 1);
    const output = new Float64Array(rustEngine.memory.buffer, pointer, 6);
    return output[0] === 1 ? { x: output[1], y: output[2] } : undefined;
  }
  destroy(): void { rustEngine.projectiles_drop(this.handle); }
}

function previewUnit(id: number, facing: number): Unit {
  return { id, kind: 'musketman', faction: 0, x: 0, y: 0, hp: 80, maxHp: 80,
    morale: 100, attack: 34, defense: 3, speed: 3, range: RANGE, order: 'hold',
    cooldown: 0, facing, moving: false, attackTime: 0, lastCombat: -60 };
}

function text(element: HTMLElement, value: string): void {
  if (element.textContent !== value) element.textContent = value;
}

interface Panel { element: HTMLElement; draw(elapsed: number): void; destroy(): void }
function firingPanel(args: Args, rate: number, freeze: boolean): Panel {
  const facing = DIRECTIONS[args.direction], flight = new PreviewFlight(facing);
  const slowed = rate < 1, loop = slowed ? .8 : RELOAD;
  let phase = freeze ? flight.duration / 2 : 0, playing = !freeze && !args.paused;
  const element = document.createElement('section'); element.className = 'tc-musket-panel';
  element.innerHTML = `<div class="tc-musket-panel-heading"><h2>${slowed ? 'Slow motion · 0.1×' : 'Normal speed · 1×'}</h2><span>${slowed ? 'First 0.8 seconds, repeated' : `${RELOAD}s between volleys`}</span></div>
    <canvas width="${WIDTH * SCALE}" height="${HEIGHT * SCALE}" aria-label="Musket firing animation with visible bullets and stationary blue targets"></canvas>
    <div class="tc-musket-controls"><button type="button" data-action="play"></button><button type="button" data-action="replay">Replay volley</button><button type="button" data-action="freeze">Freeze bullet</button><output class="tc-musket-time"></output></div>
    <label class="tc-musket-scrubber">Shot timeline <input type="range" min="0" max="${loop}" step="0.001" value="${phase}" aria-label="${slowed ? 'Slow motion' : 'Normal speed'} shot time"></label>
    <p class="tc-musket-phase"></p>`;
  const canvas = element.querySelector('canvas')!, context = canvas.getContext('2d')!;
  const play = element.querySelector<HTMLButtonElement>('[data-action="play"]')!;
  const slider = element.querySelector<HTMLInputElement>('input')!;
  const time = element.querySelector<HTMLOutputElement>('output')!;
  const status = element.querySelector<HTMLElement>('.tc-musket-phase')!;
  // Background is cached, with native game grass at the same 32px tile scale.
  const ground = document.createElement('canvas'); ground.width = WIDTH * SCALE; ground.height = HEIGHT * SCALE;
  const grass = ground.getContext('2d')!; grass.imageSmoothingEnabled = false; grass.scale(SCALE, SCALE);
  for (let y = 0; y < HEIGHT / TILE; y++) for (let x = 0; x < WIDTH / TILE; x++) {
    const variant = (x * 13 + y * 17) % 9;
    drawPuny(grass, variant % 3 * 16, Math.floor(variant / 3) * 16, 16, 16, x * TILE, y * TILE, TILE, TILE);
  }
  const count = Math.min(5, Math.max(1, Math.floor(args.soldiers)));
  const shooters = Array.from({ length: count }, (_, index) => previewUnit(index + 1, facing));
  const targets = Array.from({ length: count }, (_, index) => previewUnit(index + 101, facing + Math.PI));
  const starts = shooters.map((_, index) => {
    const lateral = (index - (count - 1) / 2) * .9;
    return { x: -flight.end.x / 2 - Math.sin(facing) * lateral,
      y: -flight.end.y / 2 + Math.cos(facing) * lateral };
  });
  // Same unit origin and foot registration as Renderer.unitTop and drawUnit.
  const person = (unit: Unit, point: Point, color: string) => {
    context.save(); context.translate(WIDTH / 2 + (point.x - .5) * TILE, HEIGHT / 2 + (point.y - .85) * TILE);
    drawMusketman(context, unit, phase, color); context.restore();
  };
  const draw = (elapsed: number) => {
    if (!playing && elapsed > 0) return;
    if (playing) phase = (phase + elapsed * rate) % loop;
    const bullet = flight.sample(phase);
    context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(ground, 0, 0); context.scale(SCALE, SCALE); context.imageSmoothingEnabled = false;
    // Sort along the ground exactly as units in the world renderer are sorted.
    const figures = shooters.flatMap((unit, index) => {
      unit.attackTime = Math.max(0, ATTACK - phase);
      const start = starts[index], end = { x: start.x + flight.end.x, y: start.y + flight.end.y };
      return [{ unit, point: start, color: args.color }, { unit: targets[index], point: end, color: '#66a9e8' }];
    }).sort((a, b) => a.point.y - b.point.y);
    for (const figure of figures) person(figure.unit, figure.point, figure.color);
    if (bullet) for (const start of starts) {
      context.save();
      context.translate(WIDTH / 2 + (start.x + bullet.x) * TILE, HEIGHT / 2 + (start.y + bullet.y - .48) * TILE);
      // The world tracer is two screen pixels thick, independent of zoom.
      context.rotate(facing); context.scale(1 / SCALE, 1 / SCALE);
      drawMusketBullet(context, TILE * SCALE); context.restore();
    }
    text(play, playing ? 'Pause' : 'Play'); play.setAttribute('aria-pressed', String(playing));
    if (document.activeElement !== slider) slider.value = String(phase);
    text(time, `${phase.toFixed(3)} s`);
    text(status, bullet ? `Bullet in flight · ${(flight.duration * 1000).toFixed(0)} ms across ${RANGE} tiles`
      : phase < ATTACK ? 'Muzzle flash, smoke and return to idle' : 'Reloading · next volley at 2.5 seconds');
    canvas.dataset.projectiles = String(bullet ? count : 0);
  };
  play.onclick = () => { playing = !playing; draw(0); };
  element.querySelector<HTMLButtonElement>('[data-action="replay"]')!.onclick = () => { phase = 0; playing = true; draw(0); };
  element.querySelector<HTMLButtonElement>('[data-action="freeze"]')!.onclick = () => { phase = flight.duration / 2; playing = false; draw(0); };
  slider.oninput = () => { phase = Number(slider.value); playing = false; draw(0); };
  draw(0);
  return { element, draw, destroy: () => flight.destroy() };
}

function renderFiring(args: Args, freeze = false): HTMLElement {
  const root = document.createElement('div'); root.className = 'tc-musket-firing';
  root.innerHTML = `<header><p class="tc-musket-eyebrow">GUNPOWDER · FIRING RANGE</p><h1>Musket volleys</h1><p>Musketmen fire pale-gold bullets at stationary blue targets, five tiles away. Native size at 2× zoom.</p></header><p class="tc-musket-loading">Loading musket artwork…</p>`;
  let panels: Panel[] = [], attached = false, disposed = false, frame = 0;
  const dispose = () => { if (disposed) return; disposed = true; cancelAnimationFrame(frame); for (const panel of panels) panel.destroy(); observer.disconnect(); };
  const observer = new MutationObserver(() => {
    if (root.isConnected) attached = true;
    else if (attached) dispose();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  void Promise.all([loadMusketmanArt(), loadPunyWorld(), loadGameFonts()]).then(() => {
    if (disposed) return;
    panels = [firingPanel(args, 1, freeze), firingPanel(args, .1, freeze)];
    const grid = document.createElement('div'); grid.className = 'tc-musket-panels';
    grid.append(...panels.map(panel => panel.element)); root.querySelector('.tc-musket-loading')!.replaceWith(grid);
    const note = document.createElement('p'); note.className = 'tc-musket-note';
    note.textContent = 'Freeze bullet pauses halfway to the target. Scrub the timeline to inspect any firing frame. Slow motion repeats the opening 0.8s and skips the rest of the reload. Targets stay still for comparison.';
    root.append(note); root.dataset.ready = 'true';
    let previous = performance.now();
    const tick = (now: number) => {
      if (disposed) return;
      if (root.isConnected) attached = true;
      else if (attached) { dispose(); return; }
      const elapsed = document.hidden ? 0 : Math.min(.1, Math.max(0, (now - previous) / 1000)); previous = now;
      for (const panel of panels) panel.draw(elapsed);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }).catch(error => {
    const message = root.querySelector<HTMLElement>('.tc-musket-loading');
    if (message) { message.textContent = String(error); message.dataset.error = 'true'; }
    dispose();
  });
  return root;
}

const meta: Meta<Args> = {
  title: 'Units/Musketman firing',
  args: { direction: 'E', soldiers: 3, color: '#f34f59', paused: false },
  argTypes: {
    direction: { control: 'select', options: Object.keys(DIRECTIONS) },
    soldiers: { control: { type: 'range', min: 1, max: 5, step: 1 } },
    color: { control: 'color' }, paused: { control: 'boolean' },
  },
};
export default meta;
type Story = StoryObj<Args>;
export const Volley: Story = { render: args => renderFiring(args) };
export const BulletInFlight: Story = { name: 'Bullet in flight · frozen', render: args => renderFiring(args, true) };
