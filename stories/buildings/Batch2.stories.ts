import type { Meta, StoryObj } from '@storybook/html-vite';
import { renderGallery, type GalleryItem } from '../harness/gallery';

// Batch 2 building candidates (PixelLab, 32x32), review only; not in the game.
// Imported with `?url` so the gallery also works in build-storybook.
const files = import.meta.glob('../../scratch/2026-11-11-civ-buildings/outputs-batch2/*.png', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

/** Every variant, sorted by label: 5A-5D barracks, 6A-6D granary, 7A-7D marketplace, 8A-8D aqueduct, 9A-9D colosseum. */
const variants: (GalleryItem & { building: string })[] = Object.entries(files)
  .map(([path, src]) => {
    const [, label, building] = /\/(\d[A-Z])-([a-z]+)\.png$/.exec(path)!;
    return { label, building, src };
  })
  .sort((a, b) => a.label.localeCompare(b.label));

const gallery = (building?: string) => renderGallery(
  variants.filter(item => !building || item.building === building).map(({ label, src }) => ({ label, src })),
  { scales: [1, 2, 4] },
);

const meta: Meta = { title: 'Buildings/Batch 2' };
export default meta;

/** All 20 variants at native, 2x and 4x. */
export const All: StoryObj = { render: () => gallery() };
/** 5A-5D. */
export const Barracks: StoryObj = { render: () => gallery('barracks') };
/** 6A-6D. */
export const Granary: StoryObj = { render: () => gallery('granary') };
/** 7A-7D. */
export const Marketplace: StoryObj = { render: () => gallery('marketplace') };
/** 8A-8D. */
export const Aqueduct: StoryObj = { render: () => gallery('aqueduct') };
/** 9A-9D. */
export const Colosseum: StoryObj = { render: () => gallery('colosseum') };
