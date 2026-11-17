import type { Meta, StoryObj } from '@storybook/html-vite';
import { renderGallery } from '../harness/gallery';
import { bridgeSets, composites, reviewFile } from './tile-review';

// Composite previews from scratch/2026-11-11-bridges-roads: each bridge set spans a
// river on the game's own grass and water cells, with A2 asphalt-tileset approach roads
// (own grass keyed out) and a T junction; R1 was dropped because it touches no tile edge. These are tile layouts (assemble_review.py), not Renderer output.
// 16 px composites at native and 2x; 32 px-native composites at native (same on-screen size as 16 px at 2x).
function crossings(orient: 'lr' | 'ud'): HTMLElement {
  const api = new Map(bridgeSets.map(set => [set.id, set.api === 'object' ? 'Object API' : 'Tileset API']));
  const items = composites
    .filter(comp => comp.orient === orient)
    .sort((a, b) => (api.get(a.id) === api.get(b.id) ? 0 : api.get(a.id) === 'Object API' ? -1 : 1))
    .map(comp => ({
      label: `${comp.id} ${api.get(comp.id)} ${comp.px}px${comp.audit_pass ? '' : ' (set FAILS edge audit)'}`,
      src: reviewFile(comp.file.replace(/-view\.png$/, '')),
      scales: comp.px === '16' ? [1, 2] : [1],
    }));
  return renderGallery(items);
}

const meta: Meta = { title: 'Tiles/Bridges in-game' };
export default meta;

/** River running north-south, bridge and road running west-east. */
export const LeftRight: StoryObj = { name: 'Left-right crossing', render: () => crossings('lr') };
/** River running west-east, bridge and road running north-south. */
export const UpDown: StoryObj = { name: 'Up-down crossing', render: () => crossings('ud') };
