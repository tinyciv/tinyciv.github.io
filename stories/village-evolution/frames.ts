/**
 * Browser half of the village evolution stories: advances a fixture game
 * through the real simulation and captures one frame per timestep with the
 * game's real Renderer (PixiScene, WebGL).
 *
 * WebGL context limits forbid many renderers on one page, so each run owns one
 * renderer, draws every timestep into it, copies the result into a 2D canvas,
 * and destroys the renderer when the run ends. Runs are serialized and cached
 * per family, so the strips and the gallery share work within one page.
 */
import '../../src/ui/game-font.css';
import '../harness/harness.css';
import './village-evolution.css';
import { Renderer, MIN_ZOOM, MAX_ZOOM } from '../../src/game/renderer';
import { loadGameArt } from '../harness/assets';
import {
  advanceEvolution, createEvolutionGame, EVOLUTION_DEFINITIONS, EVOLUTION_TIMES, familyName, stageName, TIMESTEP_NAMES, villageSnapshot,
  type EvolutionGame, type EvolutionKey, type VillageSnapshot,
} from './fixture';

export const FRAME = { width: 560, height: 420, zoom: .8 } as const;

export interface EvolutionFrame extends VillageSnapshot {
  index: number;
  /** Device-pixel copy of the WebGL frame. */
  image: HTMLCanvasElement;
}
export interface EvolutionRun { key: EvolutionKey; frames: EvolutionFrame[]; village: string; family: string; quarter: EvolutionGame['quarter']; neighbor: string }

const nextFrame = () => new Promise<number>(resolve => requestAnimationFrame(resolve));
const runs = new Map<EvolutionKey, Promise<EvolutionRun>>();
let queue: Promise<unknown> = Promise.resolve();

export const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
const label = (kind: string): string => ({ woodenTower: 'wooden tower', healerShack: "healer's shack", scoutLodge: "scouts' lodge", archeryRange: 'archery range' }[kind] ?? kind);

/** Progress line shown while a run is building (Pixel Operator via harness.css). */
export type Progress = (text: string) => void;

/** Run (or reuse) the 0 → 2600 s evolution for one family. `stage` hosts the live preview canvas. */
export function evolutionRun(key: EvolutionKey, stage: HTMLElement, progress: Progress): Promise<EvolutionRun> {
  let run = runs.get(key);
  if (!run) {
    run = queue.then(() => captureRun(key, stage, progress));
    queue = run.catch(() => undefined);
    runs.set(key, run);
    run.catch(() => runs.delete(key));
  }
  return run;
}

async function captureRun(key: EvolutionKey, stage: HTMLElement, progress: Progress): Promise<EvolutionRun> {
  const definition = EVOLUTION_DEFINITIONS[key];
  progress(`${familyName(definition.family)}: generating world ${definition.seed}...`);
  await nextFrame();
  const game = createEvolutionGame(definition);
  const viewport = document.createElement('div');
  viewport.className = 've-live';
  viewport.style.width = `${FRAME.width}px`; viewport.style.height = `${FRAME.height}px`;
  const canvas = document.createElement('canvas'), minimap = document.createElement('canvas');
  canvas.className = 'tc-world'; minimap.className = 'tc-minimap';
  viewport.append(canvas, minimap);
  stage.append(viewport);
  await loadGameArt();
  const renderer = new Renderer(canvas, minimap);
  try {
    await renderer.initialize();
    renderer.resize();
    renderer.prepare(game.state);
    renderer.follow = false;
    renderer.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, FRAME.zoom));
    const frames: EvolutionFrame[] = [];
    for (const [index, time] of EVOLUTION_TIMES.entries()) {
      await advanceEvolution(game, time, { progress: now => {
        progress(`${familyName(definition.family)}: simulating ${clock(now)} of ${clock(EVOLUTION_TIMES.at(-1)!)}`);
        renderer.camera = { ...game.center }; renderer.draw(game.state, 0);
      } });
      const snapshot = villageSnapshot(game.state, game.village);
      const expected = definition.expectedStages?.[index];
      if (expected !== undefined && snapshot.stage !== expected)
        throw new Error(`${familyName(definition.family)} reached stage ${snapshot.stage} at ${time} s; the fixture expects stage ${expected}.`);
      renderer.camera = { ...game.center };
      // Settle lazily built terrain, fog and presentation caches, as the mount helper does.
      for (let i = 0; i < 3; i++) { renderer.draw(game.state, 0); await nextFrame(); }
      const source = renderer.snapshot(), image = document.createElement('canvas');
      image.width = source.width; image.height = source.height;
      image.getContext('2d')!.drawImage(source, 0, 0);
      frames.push({ ...snapshot, index, image });
    }
    return { key, frames, village: game.village.name, family: familyName(definition.family), quarter: game.quarter, neighbor: game.state.factions[0].name };
  } finally {
    renderer.destroy();
    viewport.remove();
  }
}

/** One captioned frame (2D canvas at CSS frame size). */
export function frameElement(run: EvolutionRun, frame: EvolutionFrame, scale = 1): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 've-frame';
  figure.dataset.stage = String(frame.stage);
  const canvas = document.createElement('canvas');
  canvas.width = frame.image.width; canvas.height = frame.image.height;
  canvas.style.width = `${Math.round(FRAME.width * scale)}px`; canvas.style.height = `${Math.round(FRAME.height * scale)}px`;
  canvas.getContext('2d')!.drawImage(frame.image, 0, 0);
  const caption = document.createElement('figcaption');
  const counts = frame.buildings, houses = (counts.house ?? 0), tents = counts.villageTent ?? 0;
  const lines = [
    `${TIMESTEP_NAMES[frame.index]} · ${clock(frame.time)}`,
    `Stage ${frame.stage} · ${stageName(frame.stage)}`,
    `${houses} houses · ${tents} tents · ${counts.road ?? 0} roads`,
    frame.adopted.length ? `Learned from ${run.neighbor}: ${frame.adopted.map(label).join(', ')}` : 'Learned from neighbors: none yet',
  ];
  caption.innerHTML = lines.map(line => `<span>${line}</span>`).join('');
  figure.append(canvas, caption);
  return figure;
}
