/**
 * Bake source for the main-menu globe (public/assets/ui/main-menu/globe-world.png).
 *
 * A 128 × 128 `fractal` world is generated (smaller worlds are always one
 * compact island, whatever the style), every faction is developed with the
 * real simulation, and the player's army meets the hostile rival in the field.
 * The whole world is then drawn once by the game's Renderer at zoom 1 with the
 * map revealed and presentation overlays hidden. `scripts/bake-menu-globe.mjs`
 * reads the frame back; the menu wraps it onto a sphere at runtime.
 */
import type { Meta, StoryObj } from '@storybook/html-vite';
import type { GameState } from '../../src/game/types';
import { TILE_SIZE } from '../../src/game/types';
import { setMapRevealed } from '../../src/game/fog';
import { entityStore } from '../../src/game/entity-store';
import { scenarioStory } from '../harness/mount';
import { buildScenario, scenarioTools, simulate } from '../harness/scenario';

export interface MenuGlobeArgs { seed: string; size: number; develop: number; battle: number; soldiers: number }
export const MENU_GLOBE_DEFAULTS: MenuGlobeArgs = { seed: 'Globe-4', size: 128, develop: 150, battle: .7, soldiers: 20 };

export function buildMenuGlobeWorld(args: MenuGlobeArgs): GameState {
  const state = buildScenario({
    seed: args.seed,
    world: { width: args.size, height: args.size, style: 'fractal' },
    game: { advancedStart: 'complete' },
    simulateSeconds: args.develop,
  });
  const tools = scenarioTools(state), enemy = tools.hostileFaction();
  const home = tools.centerOf(tools.playerPalace()), rival = tools.centerOf(tools.playerPalace(enemy));
  const midpoint = { x: (home.x + rival.x) / 2, y: (home.y + rival.y) / 2 };
  const field = tools.openField(midpoint, 4, 2, 0, 30, [0, enemy]);
  const ours = tools.army(0, false), theirs = tools.army(enemy, false);
  ours.push(...tools.reinforce(0, Math.max(0, args.soldiers - ours.length)));
  // A rival that lost its army while developing enlists copies of a player
  // soldier under its own banner (new entity IDs, same as tools.reinforce).
  if (!theirs.length && ours.length) {
    const recruit = structuredClone(ours[0]);
    recruit.id = entityStore(state).allocateId(); recruit.faction = enemy;
    delete recruit.path; delete recruit.destination; delete recruit.target; delete recruit.forcedAttack;
    entityStore(state).units.add(recruit); theirs.push(recruit);
  }
  theirs.push(...tools.reinforce(enemy, Math.max(0, args.soldiers - theirs.length)));
  // Two blocks a few paces apart so the front ranks meet in the baked frame.
  tools.formation(ours, { x: field.x - 2.2, y: field.y }, 4, .8);
  tools.formation(theirs, { x: field.x + 2.2, y: field.y }, 4, .8);
  simulate(state, args.battle, 1 / 30);
  (state as GameState & { menuGlobeBattle?: { x: number; y: number } }).menuGlobeBattle = field;
  return state;
}

const meta: Meta<MenuGlobeArgs> = {
  title: 'Menu/Globe Bake',
  args: MENU_GLOBE_DEFAULTS,
  argTypes: {
    seed: { control: 'text' },
    size: { control: { type: 'number', min: 64, max: 160, step: 8 } },
    develop: { control: { type: 'number', min: 0, max: 900, step: 30 } },
    battle: { control: { type: 'number', min: 0, max: 10, step: .1 } },
    soldiers: { control: { type: 'number', min: 4, max: 40, step: 1 } },
  },
};
export default meta;

export const WholeWorld: StoryObj<MenuGlobeArgs> = {
  name: 'Whole world (bake source)',
  render: args => scenarioStory(() => {
    const state = buildMenuGlobeWorld(args);
    setMapRevealed(state, true);
    state.selected = null; state.selectedType = null; state.particles.length = 0;
    return state;
  }, state => ({
    camera: { x: state.world.width / 2, y: state.world.height / 2 },
    zoom: 1, width: state.world.width * TILE_SIZE, height: state.world.height * TILE_SIZE, controls: false, overlays: false,
  }), 'menu globe world'),
};
