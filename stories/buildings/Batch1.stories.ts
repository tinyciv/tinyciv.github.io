import type { Meta, StoryObj } from '@storybook/html-vite';
import { renderGallery, type GalleryItem } from '../harness/gallery';

// Batch 1 building candidates (PixelLab, 32x32), review only; not in the game.
// Imported with `?url` so the gallery also works in build-storybook.
const files = import.meta.glob('../../scratch/2026-11-11-civ-buildings/outputs/*.png', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

/** Every variant, sorted by label: 1A-1G temple, 2A-2D university, 3A-3D palace, 4A-4G library. */
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

const meta: Meta = { title: 'Buildings/Batch 1' };
export default meta;

/** All 22 variants at native, 2x and 4x. */
export const All: StoryObj = { render: () => gallery() };
/** 1A-1G. */
export const Temple: StoryObj = { render: () => gallery('temple') };
/** 2A-2D. */
export const University: StoryObj = { render: () => gallery('university') };
/** 3A-3D. */
export const Palace: StoryObj = { render: () => gallery('palace') };
/** 4A-4G. */
export const Library: StoryObj = { render: () => gallery('library') };
