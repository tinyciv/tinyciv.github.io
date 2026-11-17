import type { Meta, StoryObj } from '@storybook/html-vite';
import { renderGallery } from '../harness/gallery';
// Imported files are bundled, so they also work in build-storybook. During
// development, repoAsset('scratch/...png') can reference files without imports.
import cabin from '../../public/assets/hermit/cabin.png?url';

const meta: Meta = { title: 'Gallery/Example' };
export default meta;

/** Shows the gallery helper with shipped unit sheets (32 x 32 frames, 8 direction rows). */
export const UnitSheets: StoryObj = {
  render: () => renderGallery([
    { label: '1A', src: '/assets/puny-world/characters/Archer-Green.png', sheet: { frameWidth: 32, frameHeight: 32, frames: 4, rowIndices: [0, 2, 4, 6], fps: 6 } },
    { label: '1B', src: '/assets/puny-world/characters/Club-Warrior.png', sheet: { frameWidth: 32, frameHeight: 32, frames: 4, rowIndices: [0, 2, 4, 6], fps: 6 } },
    { label: '2A', src: '/assets/buildings/wooden-settlement.png' },
    { label: '2B', src: cabin },
  ]),
};
