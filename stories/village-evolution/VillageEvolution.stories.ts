import type { Meta, StoryObj } from '@storybook/html-vite';
import { scenarioStory } from '../harness/mount';
import {
  advanceEvolution, createEvolutionGame, EVOLUTION_DEFINITIONS, EVOLUTION_KEYS, EVOLUTION_TIMES, familyName, TIMESTEP_NAMES, type EvolutionKey,
} from './fixture';
import { evolutionRun, frameElement, type EvolutionRun } from './frames';
import { loyaltyStory } from './loyalty-ui';

/**
 * Village evolution (docs/loyalty-affiliation-design.md, sections 8 and 13).
 * Each frame is a real GameState (generateWorld + createGame + updateGame with
 * the Rust settlement core) drawn by the game's Renderer. See fixture.ts for
 * the per-family seeds and the player actions in each run.
 */

function shell(titleText: string, subtitleText: string): { root: HTMLElement; progress: HTMLElement; stage: HTMLElement; body: HTMLElement } {
  const root = document.createElement('div');
  root.className = 've-root';
  const title = document.createElement('div'); title.className = 've-title'; title.textContent = titleText;
  const subtitle = document.createElement('div'); subtitle.className = 've-subtitle'; subtitle.textContent = subtitleText;
  const progress = document.createElement('div'); progress.className = 've-progress'; progress.textContent = 'Waiting for the simulation...';
  const stage = document.createElement('div');
  const body = document.createElement('div');
  root.append(title, subtitle, progress, stage, body);
  return { root, progress, stage, body };
}

const connected = async (element: HTMLElement): Promise<void> => {
  for (let i = 0; i < 600 && !element.isConnected; i++) await new Promise(requestAnimationFrame);
};

// Finished strips are tagged like harness galleries, so stories/check-stories.mjs
// also accepts them (it waits for .tc-gallery[data-ready] or .tc-loading[data-error]).
const ready = (root: HTMLElement): void => { root.classList.add('tc-gallery'); root.dataset.ready = 'true'; };
const fail = (progress: HTMLElement, error: unknown): void => {
  progress.textContent = `Story failed: ${error instanceof Error ? error.message : String(error)}`;
  progress.classList.add('tc-loading');
  progress.dataset.error = 'true';
  console.error(error);
};

const describe = (key: EvolutionKey): string => {
  const d = EVOLUTION_DEFINITIONS[key];
  return `Seed ${d.seed}${'size' in d ? ` (${d.size}×${d.size})` : ''} · frames at ${EVOLUTION_TIMES.map(t => `${t} s`).join(', ')} · the player's buildings nearby can be adopted`;
};

function strip(key: EvolutionKey): HTMLElement {
  const { root, progress, stage, body } = shell(`${familyName(EVOLUTION_DEFINITIONS[key].family)} village, five timesteps`, describe(key));
  body.className = 've-strip';
  void (async () => {
    await connected(root);
    const run = await evolutionRun(key, stage, text => { progress.textContent = text; });
    if (!root.isConnected) return;
    for (const frame of run.frames) body.append(frameElement(run, frame));
    progress.textContent = `${run.village} · ${run.family} layout · learns from ${run.neighbor}`;
    ready(root);
  })().catch(error => fail(progress, error));
  return root;
}

function gallery(): HTMLElement {
  const { root, progress, stage, body } = shell('Village evolution: 4 layout families × 5 timesteps', `Frames at ${EVOLUTION_TIMES.map(t => `${t} s`).join(', ')}; one real simulation per family.`);
  body.className = 've-grid';
  body.append(document.createElement('span'));
  for (const name of TIMESTEP_NAMES) { const head = document.createElement('div'); head.className = 've-title'; head.textContent = name; body.append(head); }
  void (async () => {
    await connected(root);
    const done: EvolutionRun[] = [];
    for (const key of EVOLUTION_KEYS) {
      const run = await evolutionRun(key, stage, text => { progress.textContent = `${done.length + 1} of ${EVOLUTION_KEYS.length} · ${text}`; });
      if (!root.isConnected) return;
      done.push(run);
      const label = document.createElement('div'); label.className = 've-row-label'; label.textContent = run.family;
      body.append(label, ...run.frames.map(frame => frameElement(run, frame, .6)));
    }
    progress.textContent = 'All four layout families captured.';
    ready(root);
  })().catch(error => fail(progress, error));
  return root;
}

interface StripArgs { key: EvolutionKey }
interface LiveArgs { family: EvolutionKey; timestep: number; zoom: number; play: boolean }
interface LoyaltyArgs { time: number; width: number; height: number }

const meta: Meta = {
  title: 'Game/Village Evolution',
};
export default meta;

export const RoadsideStrip: StoryObj<StripArgs> = { name: 'Roadside: 5 timesteps', render: () => strip('roadside') };
export const MarketCrossStrip: StoryObj<StripArgs> = { name: 'Market cross: 5 timesteps', render: () => strip('marketCross') };
export const RiversideStrip: StoryObj<StripArgs> = { name: 'Riverside: 5 timesteps', render: () => strip('riverside') };
export const HillClusterStrip: StoryObj<StripArgs> = { name: 'Hill cluster: 5 timesteps', render: () => strip('hillCluster') };
export const Gallery: StoryObj = { name: 'Gallery: 4 families × 5 timesteps', render: () => gallery() };

/** One timestep mounted live (Play / Step 1 s run the real simulation from there). */
export const LiveVillage: StoryObj<LiveArgs> = {
  name: 'Live village at a timestep',
  args: { family: 'roadside', timestep: 4, zoom: .9, play: false },
  argTypes: {
    family: { control: { type: 'inline-radio' }, options: EVOLUTION_KEYS },
    timestep: { control: { type: 'inline-radio', labels: Object.fromEntries(TIMESTEP_NAMES.map((name, i) => [i, `${i} ${name}`])) }, options: [0, 1, 2, 3, 4] },
    zoom: { control: { type: 'range', min: .65, max: 2.2, step: .05 } },
    play: { control: 'boolean' },
  },
  render: args => {
    let center = { x: 0, y: 0 };
    return scenarioStory(async () => {
      const game = createEvolutionGame(EVOLUTION_DEFINITIONS[args.family]);
      await advanceEvolution(game, EVOLUTION_TIMES[args.timestep] ?? 0);
      center = game.center;
      return game.state;
    }, () => ({ camera: center, zoom: args.zoom, width: 1100, height: 720, play: args.play }),
    `${familyName(EVOLUTION_DEFINITIONS[args.family].family)} village at ${EVOLUTION_TIMES[args.timestep]} s`);
  },
};

/** City loyalty panel + village popup with a live "Request confederation" button. */
export const ConfederationAccepted: StoryObj<LoyaltyArgs> = {
  name: 'Loyalty UI: confederation accepted',
  args: { time: 1000, width: 1240, height: 900 },
  argTypes: { time: { control: { type: 'number', min: 300, max: 2600, step: 50 } } },
  render: args => loyaltyStory(args),
};
export const ConfederationRefused: StoryObj<LoyaltyArgs> = {
  name: 'Loyalty UI: confederation refused',
  args: { time: 600, width: 1240, height: 900 },
  argTypes: { time: { control: { type: 'number', min: 300, max: 2600, step: 50 } } },
  render: args => loyaltyStory(args),
};
