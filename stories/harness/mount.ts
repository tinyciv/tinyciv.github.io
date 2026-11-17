/**
 * Mount a GameState with the game's real renderer (src/game/renderer.ts ->
 * PixiScene/WebGL), exactly as src/main.ts does: same art loaders, same
 * Renderer, same per-frame draw call, same simulation step clamp.
 */
import '../../src/ui/game-font.css';
import './harness.css';
import { Renderer, MIN_ZOOM, MAX_ZOOM } from '../../src/game/renderer';
import { updateGame } from '../../src/game/simulation';
import { frameSimulationDelta } from '../../src/game/frame-time';
import type { GameState, Point } from '../../src/game/types';
import { loadGameArt } from './assets';
import { IDLE_INPUT, buildScenario, type ScenarioOptions } from './scenario';

export interface MountOptions {
  /** World-tile point at the centre of the view (default: player capital). */
  camera?: Point;
  /** Game zoom; clamped to the game's MIN_ZOOM..MAX_ZOOM (0.65..2.2). */
  zoom?: number;
  /** CSS pixel size of the game canvas (default 1280 x 800). */
  width?: number;
  height?: number;
  /** Start the real simulation running (default false: frozen frame). */
  play?: boolean;
  /** Show Play / Pause / Step controls under the canvas (default true). */
  controls?: boolean;
  /** Health bars, city ribbons and alerts (default true, as in the game). */
  overlays?: boolean;
}

export interface MountedScenario {
  readonly state: GameState;
  readonly renderer: Renderer;
  readonly canvas: HTMLCanvasElement;
  readonly element: HTMLElement;
  playing: boolean;
  /** Advance the real simulation by `seconds` (0.1 s steps) and redraw. */
  step(seconds: number): void;
  /** Draw one frame now (with `dt` seconds of presentation time). */
  draw(dt?: number): void;
  /** WebGL read-back of the current frame. */
  snapshot(): HTMLCanvasElement;
  destroy(): void;
}

const nextFrame = () => new Promise<number>(resolve => requestAnimationFrame(resolve));
async function connected(element: HTMLElement): Promise<void> {
  for (let i = 0; i < 600 && !element.isConnected; i++) await nextFrame();
  if (!element.isConnected) throw new Error('Scenario host was never attached to the document.');
}

/** Attach the real renderer for `state` inside `host`. */
export async function mountGameState(host: HTMLElement, state: GameState, options: MountOptions = {}): Promise<MountedScenario> {
  const width = options.width ?? 1280, height = options.height ?? 800;
  const element = document.createElement('div');
  element.className = 'tc-scenario';
  const viewport = document.createElement('div');
  viewport.className = 'tc-viewport';
  viewport.style.width = `${width}px`; viewport.style.height = `${height}px`;
  const canvas = document.createElement('canvas');
  canvas.className = 'tc-world';
  // The renderer always maintains a minimap; it skips drawing at zero size.
  const minimap = document.createElement('canvas');
  minimap.className = 'tc-minimap';
  viewport.append(canvas, minimap);
  element.append(viewport);
  host.append(element);
  await connected(element);
  await loadGameArt();

  const renderer = new Renderer(canvas, minimap);
  await renderer.initialize();
  renderer.resize();
  renderer.prepare(state);
  renderer.follow = false;
  renderer.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, options.zoom ?? renderer.zoom));
  if (options.camera) renderer.camera = { ...options.camera };
  else renderer.center(state);
  renderer.follow = false;
  renderer.overlays = options.overlays ?? true;

  let frame = 0, last = performance.now(), destroyed = false;
  const status = document.createElement('div');
  status.className = 'tc-status';
  const mounted: MountedScenario = {
    state, renderer, canvas, element, playing: !!options.play,
    step(seconds) {
      for (let remaining = seconds; remaining > 1e-8; remaining -= .1) updateGame(state, Math.min(.1, remaining), IDLE_INPUT);
      mounted.draw(Math.min(seconds, .15));
    },
    draw(dt = 0) {
      renderer.draw(state, dt);
      status.textContent = `${mounted.playing ? 'Playing' : 'Paused'}  t = ${state.time.toFixed(1)} s`;
    },
    snapshot: () => renderer.snapshot(),
    destroy() {
      if (destroyed) return;
      destroyed = true; cancelAnimationFrame(frame); renderer.destroy(); element.remove();
    },
  };

  if (options.controls !== false) {
    const bar = document.createElement('div');
    bar.className = 'tc-controls';
    const button = (text: string, action: () => void) => {
      const control = document.createElement('button');
      control.type = 'button'; control.textContent = text; control.onclick = action;
      bar.append(control); return control;
    };
    const toggle = button(mounted.playing ? 'Pause' : 'Play', () => {
      mounted.playing = !mounted.playing; toggle.textContent = mounted.playing ? 'Pause' : 'Play'; last = performance.now();
    });
    toggle.dataset.control = 'play';
    button('Step 1 s', () => mounted.step(1)).dataset.control = 'step';
    bar.append(status);
    element.append(bar);
  }

  // Same per-frame shape as src/main.ts: simulate (when playing), then draw.
  const tick = (now: number) => {
    if (destroyed) return;
    if (!element.isConnected) { mounted.destroy(); return; }
    const elapsed = Math.max(0, (now - last) / 1000); last = now;
    if (mounted.playing) updateGame(state, frameSimulationDelta(elapsed, state.speed), IDLE_INPUT);
    mounted.draw(mounted.playing ? Math.min(elapsed, .15) : 0);
    frame = requestAnimationFrame(tick);
  };
  // Settle lazily-built terrain, fog and presentation caches before reporting ready.
  for (let i = 0; i < 3; i++) { mounted.draw(0); await nextFrame(); }
  element.dataset.ready = 'true';
  frame = requestAnimationFrame(tick);
  return mounted;
}

export interface ScenarioStoryOptions extends MountOptions {
  /** Shown while the world is generated (Pixel Operator). */
  title?: string;
}

/**
 * Storybook render helper: returns an element immediately, then builds the
 * scenario (real world generator + constructors + simulation) and mounts it.
 * `scenario` is either ScenarioOptions or a function returning a GameState.
 * `view` may compute camera/zoom from the built state.
 */
export function scenarioStory(scenario: ScenarioOptions | (() => GameState | Promise<GameState>),
  options: ScenarioStoryOptions | ((state: GameState) => ScenarioStoryOptions) = {}, title?: string): HTMLElement {
  const host = document.createElement('div');
  host.className = 'tc-host';
  const loading = document.createElement('div');
  loading.className = 'tc-loading';
  loading.textContent = `Building ${title ?? (typeof options === 'object' ? options.title : undefined) ?? 'scenario'}...`;
  host.append(loading);
  void (async () => {
    try {
      await connected(host);
      await nextFrame();
      const state = typeof scenario === 'function' ? await scenario() : buildScenario(scenario);
      const resolved = typeof options === 'function' ? options(state) : options;
      const mounted = await mountGameState(host, state, resolved);
      loading.remove();
      (window as unknown as { __scenario?: MountedScenario }).__scenario = mounted;
    } catch (error) {
      loading.textContent = `Scenario failed: ${error instanceof Error ? error.message : String(error)}`;
      loading.dataset.error = 'true';
      console.error(error);
    }
  })();
  return host;
}
