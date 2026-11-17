import type { Meta, StoryObj } from '@storybook/html-vite';
import { renderGallery, type GalleryItem } from '../harness/gallery';

// Military units, first land batch (PixelLab, 48x48 frames). Review only; nothing here is in the game.
// Every unit has an 8-direction idle plus walk / attack / death sheets in the same layout as the musketman template.
// Imported with `?url` so the gallery also works in build-storybook.
const ROOT = '../../scratch/2026-11-11-military-units/review/';
const files = import.meta.glob('../../scratch/2026-11-11-military-units/review/**/*.png', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

function file(path: string): string {
  const src = files[ROOT + path];
  // A missing file still renders (as a red error) so the check reports it.
  return src ?? `/missing/${path}`;
}

/** Row / column order used by every sheet (see the batch manifest.json). */
const DIRECTIONS = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'] as const;
const FRAME = 48;

const UNITS = [
  'musketman', 'pikeman', 'crossbowman', 'longbowman', 'rifleman', 'brigand',
  'cavalry', 'tank', 'mgcrew', 'fighter', 'bomber',
] as const;
const NAMES: Record<string, string> = { mgcrew: 'Machine-gun crew' };

/** Same animation set for every unit. For vehicles and aircraft "walk" is tread movement / flight. */
const ANIMATIONS: { name: string; frames: number; fps: number }[] = [
  { name: 'walk', frames: 8, fps: 10 },
  // 6 generated frames + the direction's idle frame appended as a return-to-idle frame
  { name: 'attack', frames: 7, fps: 12 },
  // holds the last frame in game; loops here
  { name: 'death', frames: 8, fps: 10 },
];

const title = (unit: string) => NAMES[unit] ?? unit[0].toUpperCase() + unit.slice(1);

/** Idle sheets are one row with one column per direction. */
function idleItems(unit: string): GalleryItem[] {
  return DIRECTIONS.map((direction, index) => ({
    label: `${title(unit)} idle ${direction}`,
    src: file(`${unit}/idle.png`),
    sheet: { frameWidth: FRAME, frameHeight: FRAME, columns: 1, frames: 1, rows: 1, offsetX: index * FRAME },
  }));
}

/** Animation sheets are one row per direction, one column per frame. */
function animationItems(unit: string): GalleryItem[] {
  return ANIMATIONS.flatMap(({ name, frames, fps }) => DIRECTIONS.map((direction, index) => ({
    label: `${title(unit)} ${name} ${direction}`,
    src: file(`${unit}/${name}.png`),
    sheet: { frameWidth: FRAME, frameHeight: FRAME, columns: frames, frames, rows: DIRECTIONS.length, rowIndices: [index], fps },
  })));
}

const unitItems = (unit: string) => [...idleItems(unit), ...animationItems(unit)];

/** Style variants from the pilot (style A was chosen); stored pre-scaled at 4x, shown at 1x and 2x of that file. */
const VARIANTS: [string, string[]][] = [
  ['musketman', ['A', 'B', 'C']],
  ['pikeman', ['B', 'C']],
  ['crossbowman', ['B', 'C']],
  ['brigand', ['B', 'C']],
  ['longbowman', ['B', 'C']],
  ['rifleman', ['B', 'C']],
  ['tank', ['A', 'B', 'C']],
];
const variantItems = (): GalleryItem[] => VARIANTS.flatMap(([unit, letters]) => letters.map(letter => ({
  label: `${title(unit)} style ${letter} (4x file)`,
  src: file(`variants/${unit}-${letter}@4x.png`),
  scales: [1, 2],
})));

/** Rejected rows that were re-done (the replacements are in the unit stories). */
const ALTERNATES: [string, number, number][] = [
  ['musketman-attack-E', 6, 12],
  ['musketman-attack-E-r2', 6, 12],
  ['musketman-attack-W', 6, 12],
  ['musketman-attack-N', 6, 12],
  ['musketman-attack-N-r2', 6, 12],
  ['musketman-attack-N-r3', 6, 12],
  ['musketman-walk-NE', 8, 10],
  ['musketman-death-E', 8, 10],
  ['fighter-death-E', 8, 10],
];
const alternateItems = (): GalleryItem[] => ALTERNATES.map(([job, frames, fps]) => ({
  label: `${job} (rejected)`,
  src: file(`alternates/${job}.png`),
  sheet: { frameWidth: FRAME, frameHeight: FRAME, columns: frames, frames, rows: 1, fps },
}));

/** S idle at native pixel scale: in-game worker, swordsman, archer, then the six new infantry units. */
const SCALE_ITEM: GalleryItem = {
  label: 'Scale: worker | swordsman | archer (in game) | musketman | pikeman | crossbowman | brigand | longbowman | rifleman',
  src: file('scale-compare.png'),
};
/** SW idle of every batch unit side by side at native pixel scale (size accepted as is). */
const BATCH_SCALE_ITEM: GalleryItem = {
  label: 'Batch scale (SW idle): ' + UNITS.map(title).join(' | '),
  src: file('scale-batch.png'),
};

const gallery = (items: GalleryItem[]) => renderGallery(items, { scales: [1, 2, 4] });

const meta: Meta = { title: 'Units/Batch 1' };
export default meta;

/** Every unit, every animation, every direction, then style variants, rejected rows and the scale comparisons. */
export const All: StoryObj = {
  render: () => gallery([
    ...UNITS.flatMap(unitItems),
    ...variantItems(),
    ...alternateItems(),
    SCALE_ITEM,
    BATCH_SCALE_ITEM,
  ]),
};
/** Template unit: idle, walk (8 f, 10 fps), attack (7 f incl. return-to-idle, 12 fps), death (8 f, 10 fps). */
export const Musketman: StoryObj = { render: () => gallery(unitItems('musketman')) };
export const Pikeman: StoryObj = { render: () => gallery(unitItems('pikeman')) };
export const Crossbowman: StoryObj = { render: () => gallery(unitItems('crossbowman')) };
export const Longbowman: StoryObj = { render: () => gallery(unitItems('longbowman')) };
export const Rifleman: StoryObj = { render: () => gallery(unitItems('rifleman')) };
export const Brigand: StoryObj = { render: () => gallery(unitItems('brigand')) };
export const Cavalry: StoryObj = { render: () => gallery(unitItems('cavalry')) };
/** Walk = tread movement, attack = cannon fire, death = burning wreck. */
export const Tank: StoryObj = { render: () => gallery(unitItems('tank')) };
export const MachineGunCrew: StoryObj = { render: () => gallery(unitItems('mgcrew')) };
/** Walk = flight loop, attack = wing guns, death = crash. */
export const Fighter: StoryObj = { render: () => gallery(unitItems('fighter')) };
/** Walk = flight loop, attack = bomb release, death = crash. */
export const Bomber: StoryObj = { render: () => gallery(unitItems('bomber')) };
/** A = in-game look (chosen), B = larger and more detailed, C = more realistic; tank concept stills. */
export const StyleVariants: StoryObj = { render: () => gallery(variantItems()) };
/** Rejected rows that were re-done; compare with the unit stories. */
export const RejectedRows: StoryObj = { render: () => gallery(alternateItems()) };
/** New units next to the in-game worker, swordsman and archer, plus the whole batch side by side. */
export const ScaleCompare: StoryObj = { render: () => gallery([SCALE_ITEM, BATCH_SCALE_ITEM]) };
