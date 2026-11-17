import type { Meta, StoryObj } from '@storybook/html-vite';
import { scenarioStory } from '../harness/mount';
import { RIVER_CITY, WALLED_CITY } from '../harness/scenarios';
import type { GameState, Point } from '../../src/game/types';

// The integrated stone bridge (set 2B) seen through the real renderer. The
// advanced start always builds a river crossing; the camera centers on it.
function bridgeView(state: GameState): { camera: Point; zoom: number } {
  const bridges = state.buildings.filter(b => b.kind === 'bridge');
  if (!bridges.length) return { camera: { x: state.world.width / 2, y: state.world.height / 2 }, zoom: 2.2 };
  const x = bridges.reduce((sum, b) => sum + b.x + .5, 0) / bridges.length;
  const y = bridges.reduce((sum, b) => sum + b.y + .5, 0) / bridges.length;
  return { camera: { x, y }, zoom: 2.2 };
}

const meta: Meta = { title: 'Game/Stone bridge' };
export default meta;

export const RiverCity: StoryObj = { render: () => scenarioStory(RIVER_CITY.options, bridgeView, 'Stone bridge: river city') };
export const WalledCity: StoryObj = { render: () => scenarioStory(WALLED_CITY.options, bridgeView, 'Stone bridge: walled city') };
