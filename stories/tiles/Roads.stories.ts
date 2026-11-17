import type { Meta, StoryObj } from '@storybook/html-vite';
import { renderGallery } from '../harness/gallery';
import { columnsFor, GRASS, pieceGrid, reviewFile, roadSets, withNotes } from './tile-review';

// Road candidates from scratch/2026-11-11-bridges-roads (review only; not in the game).
// Rows: every connection piece (straights, corners, Ts, cross, ends). Pieces are labelled
// from their MEASURED edge contact (scripts/edge_audit.py), not the prompt order, so the
// Object API sets (R1/A1/H1) show the pieces they really lack as missing.
const PIECES = [
  'LR', 'UD',
  'corner S+E', 'corner S+W', 'corner N+E', 'corner N+W',
  'T E+S+W', 'T N+S+W', 'T N+E+W', 'T N+E+S', 'cross',
  'end open N', 'end open E', 'end open S', 'end open W',
] as const;

const CLASSES = { paved: ['R1', 'R2'], asphalt: ['A1', 'A2'], highway: ['H1', 'H2'] } as const;
function roads(...ids: string[]): HTMLElement {
  const sets = roadSets.filter(set => ids.includes(set.id));
  return withNotes(sets, pieceGrid(PIECES, columnsFor(sets), GRASS));
}

const meta: Meta = { title: 'Tiles/Roads' };
export default meta;

/** Paved medieval: R1 (touches no tile edge) vs R2 (inconsistent edges, lacks T N+E+W and end open N). Both fail. */
export const Paved: StoryObj = { render: () => roads(...CLASSES.paved) };
/** Asphalt: A1 Object API (straights, one corner, cross, two ends) vs A2 Tileset API (the only set that passes). */
export const Asphalt: StoryObj = { render: () => roads(...CLASSES.asphalt) };
/** Highway: H1 Object API vs H2 Tileset API (lane width jumps between ends and T/cross). Both fail. */
export const Highway: StoryObj = { render: () => roads(...CLASSES.highway) };
/** Auto-tiled networks of the Tileset API sets (own grass keyed out onto game grass), 16 px reduced and 32 px native. */
export const Networks: StoryObj = {
  render: () => renderGallery(['R2', 'A2', 'H2'].flatMap(id => [
    { label: `${id} network 16px`, src: reviewFile(`net-${id}-16`), scales: [1, 2] },
    { label: `${id} network 32px`, src: reviewFile(`net-${id}-32`), scales: [1] },
  ])),
};
