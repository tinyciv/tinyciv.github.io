import type { Meta, StoryObj } from '@storybook/html-vite';
import { scenarioStory } from '../harness/mount';
import { buildDefinition, FIELD_BATTLE, RIVER_CITY, WALLED_CITY, type ScenarioDefinition } from '../harness/scenarios';

interface Args { width: number; height: number; zoom?: number; play: boolean }

/** Real world generator + createGame + updateGame, drawn by the game's Renderer. */
const render = (definition: ScenarioDefinition) => (args: Args) => {
  let view: ReturnType<ScenarioDefinition['view']> | undefined;
  return scenarioStory(() => { const built = buildDefinition(definition); view = built.view; return built.state; },
    () => ({ camera: view!.camera, zoom: args.zoom ?? view!.zoom, width: args.width, height: args.height, play: args.play }), definition.title);
};

const meta: Meta<Args> = {
  title: 'Game/Base Scenarios',
  args: { width: 1280, height: 800, play: false },
  argTypes: {
    width: { control: { type: 'number', min: 320, max: 2560, step: 16 } },
    height: { control: { type: 'number', min: 240, max: 1600, step: 16 } },
    zoom: { control: { type: 'range', min: .65, max: 2.2, step: .05 } },
    play: { control: 'boolean' },
  },
};
export default meta;
type Story = StoryObj<Args>;

export const RiverCity: Story = { name: '1 River plains city', render: render(RIVER_CITY) };
export const WalledCity: Story = { name: '2 Walled city at work', render: render(WALLED_CITY) };
export const FieldBattle: Story = { name: '3 Battle near a settlement', render: render(FIELD_BATTLE) };
