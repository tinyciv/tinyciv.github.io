/**
 * The real main menu (src/ui/frontend.ts) with its static painted backdrop,
 * without a running game. Actions are logged.
 */
import type { Meta, StoryObj } from '@storybook/html-vite';
import '../../src/ui/game-font.css';
import { Frontend, type FrontendView } from '../../src/ui/frontend';

interface Args { view: FrontendView; resumable: boolean }

const meta: Meta<Args> = {
  title: 'Menu/Main Menu',
  args: { view: 'main', resumable: false },
  argTypes: { view: { control: 'select', options: ['login', 'create-account', 'forgot-password', 'main', 'single', 'scenarios', 'saves', 'options', 'controls', 'fame', 'credits', 'loading', 'error'] } },
  parameters: { layout: 'fullscreen' },
};
export default meta;

export const Menu: StoryObj<Args> = {
  render: args => {
    const host = document.createElement('div');
    const frontend = new Frontend(host, action => console.info('menu action', action));
    frontend.setSession(args.resumable);
    frontend.setSaves([
      { id: 'example-save', name: 'Before the siege', savedAt: Date.parse('2026-11-14T18:30:00Z'), time: 2400, seed: 'TinyCiv-482113', civilization: 'Roma' },
      { id: 'single-player', name: 'Autosave', savedAt: Date.parse('2026-11-14T18:45:00Z'), time: 3000, seed: 'TinyCiv-482113', civilization: 'Roma' },
    ], 'Roma · 50 min');
    frontend.setHallOfFame([
      { result: 'Victory', civilization: 'Roma', seed: 'TinyCiv-482113', minutes: 74, population: 412, date: '2026-11-12' },
      { result: 'Defeat', civilization: 'Roma', seed: 'TinyCiv-190344', minutes: 31, population: 96, date: '2026-11-10' },
    ]);
    requestAnimationFrame(() => {
      if (args.view === 'loading') frontend.loading('Loading', '', .6);
      else if (args.view === 'error') frontend.error('Unable to connect. Try again.');
      else frontend.show(args.view);
      host.dataset.ready = 'true';
    });
    return host;
  },
};

/** The actual setup panel, isolated from game creation and save writes. */
export const WorldGeneration: StoryObj<Args> = { ...Menu, args: { view: 'single' } };
export const Scenarios: StoryObj<Args> = { ...Menu, args: { view: 'scenarios' } };
export const SavedGames: StoryObj<Args> = { ...Menu, args: { view: 'saves', resumable: true } };
export const LoadGame: StoryObj<Args> = { ...Menu, args: { view: 'saves', resumable: false } };
/** Isolated loading UI; no world creation or simulation runs in this story. */
export const Loading: StoryObj<Args> = {
  render: () => {
    const host = document.createElement('div');
    const frontend = new Frontend(host, () => {});
    requestAnimationFrame(() => {
      frontend.loading('Generating world', 'Growing woodland', .68);
      host.dataset.ready = 'true';
    });
    return host;
  },
};

export const Login: StoryObj<Args> = { ...Menu, args: { view: 'login' } };
export const CreateAccount: StoryObj<Args> = { ...Menu, args: { view: 'create-account' } };
export const ResetPassword: StoryObj<Args> = { ...Menu, args: { view: 'forgot-password' } };
