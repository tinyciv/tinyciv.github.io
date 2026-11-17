import type { Preview } from '@storybook/html-vite';
import '../src/ui/game-font.css';
import '../stories/harness/harness.css';

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    backgrounds: { disable: true },
    controls: { expanded: true },
  },
};
export default preview;
