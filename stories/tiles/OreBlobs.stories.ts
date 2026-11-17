import type { Meta, StoryObj } from '@storybook/html-vite';
import { renderGallery, type GalleryItem } from '../harness/gallery';
import { renderNaturalOutcrops, renderOutcropEdgeComparison, renderMineDoorReview } from './outcrop-review';

// PixelLab-generated review art. Deliberately independent of the game simulation.
const files = import.meta.glob('../assets/contiguous-ore/*.png', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;
function file(name: string): string {
  const url = files[`../assets/contiguous-ore/${name}.png`];
  if (!url) throw new Error(`Missing contiguous ore review asset: ${name}`);
  return url;
}

const rockFiles = import.meta.glob('../assets/rock-texture-overlays/*.png', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;
function rockFile(name: string): string {
  const url = rockFiles[`../assets/rock-texture-overlays/${name}.png`];
  if (!url) throw new Error(`Missing rock texture review asset: ${name}`);
  return url;
}
const ROCK_CANDIDATES = [
  { id: 1, title: 'Coarse packed stone · 64px source' },
  { id: 2, title: 'Simpler cartoon stone · 64px source' },
  { id: 3, title: 'Finer stone · 128px source' },
] as const;

const MATERIALS = ['stone', 'copper', 'iron'] as const;
const CANDIDATES = [
  { id: 1, title: '16px · broad facets · closest to current art' },
  { id: 2, title: '32px · more angular and detailed' },
  { id: 3, title: '16px · simpler rounded cartoon' },
] as const;
const letters = ['A', 'B', 'C'];

function review(note: string, items: GalleryItem[]): HTMLElement {
  const root = document.createElement('div');
  root.className = 'tc-ore-review';
  root.style.cssText = 'font-family:"Pixel Operator",monospace;background:#202c26;color:#eee;padding:20px;min-height:100vh';
  const style = document.createElement('style');
  style.textContent = '.tc-ore-review .tc-gallery-row{flex-wrap:wrap;max-width:100%}.tc-ore-review .tc-gallery-item{min-width:0;max-width:100%}.tc-ore-review canvas{max-width:100%;height:auto!important}';
  const heading = document.createElement('h1');
  heading.textContent = 'Contiguous stone & ore';
  heading.style.cssText = 'font:700 28px "Pixel Operator",monospace;margin:0 0 12px';
  const description = document.createElement('p');
  description.textContent = note;
  description.style.cssText = 'font-size:18px;max-width:1000px;line-height:1.4;margin:0 0 20px';
  root.append(style, heading, description, renderGallery(items, { background: '#516139', scales: [1, 2] }));
  return root;
}

export default { title: 'Tiles/Contiguous Ore', parameters: { layout: 'fullscreen' } } satisfies Meta;

export const MineDoorways: StoryObj = {
  name: 'Mine doorways · new ore surface',
  render: () => renderMineDoorReview(),
};

export const EdgeTreatments: StoryObj = {
  name: 'Edge treatments · before & after',
  render: () => renderOutcropEdgeComparison(),
};

export const NaturalOutcrops: StoryObj = {
  name: 'Natural outcrops & loose rocks',
  render: () => renderNaturalOutcrops(),
};

export const DifferentGeology: StoryObj = {
  name: 'Different world seed',
  render: () => renderNaturalOutcrops({ seed: 'Natural-outcrop-29' }),
};

export const DevelopedOutcrops: StoryObj = {
  name: 'Developed outcrops & mine entrances',
  render: () => renderNaturalOutcrops({ developed: true }),
};

export const TextureOverlays: StoryObj = {
  name: 'Rock texture & separate ore layers',
  render: () => review(
    'Packed gray rock based on the supplied terrain reference. Each candidate has one repeating stone texture plus separate transparent copper and iron layers. The composite examples apply those layers to the same unchanged stone. Shown at native size and 2×. Earlier slab studies remain below for comparison.',
    ROCK_CANDIDATES.flatMap(candidate => [
      { label: `${candidate.id}A · ${candidate.title}`, src: rockFile(`${candidate.id}-stone`) },
      { label: `${candidate.id}B · Copper overlay only`, src: rockFile(`${candidate.id}-copper-overlay`) },
      { label: `${candidate.id}C · Iron overlay only`, src: rockFile(`${candidate.id}-iron-overlay`) },
      { label: `${candidate.id}D · Stone + copper`, src: rockFile(`${candidate.id}-copper`) },
      { label: `${candidate.id}E · Stone + iron`, src: rockFile(`${candidate.id}-iron`) },
    ]),
  ),
};

export const Blobs: StoryObj = {
  name: 'Earlier fixed-mask blobs',
  render: () => review(
    'Earlier fixed-mask comparison of the tiled textures and ore layers. Candidates 1 and 2 use the 16px art grid; candidate 3 is reduced from the 32px grid. The current game renderer uses candidate 1 with seeded contours and loose rocks, shown in Natural outcrops.',
    ROCK_CANDIDATES.flatMap(candidate => MATERIALS.map((material, index) => ({
      label: `${candidate.id}${letters[index]} · ${material} · ${candidate.title}`,
      src: rockFile(`${candidate.id}-${material}-blobs`),
    }))),
  ),
};

export const RepeatingTexture: StoryObj = {
  name: 'Repeated rock texture',
  render: () => review(
    'A 2×2 repetition of each texture, followed by its copper and iron composites. Only the terminal pixel rows and columns are matched at opposite borders; the irregular interior is preserved. These are simple material textures and transparent ore overlays; they do not require a phase atlas.',
    ROCK_CANDIDATES.flatMap(candidate => MATERIALS.map(material => ({
      label: `${candidate.id} · ${material} · ${candidate.title}`,
      src: rockFile(`${candidate.id}-${material}-repeat`), scales: [1],
    }))),
  ),
};

export const EarlierSlabStudy: StoryObj = {
  name: 'Earlier slab study',
  render: () => review(
    'PixelLab review candidates. A = stone, B = copper with orange flecks, C = iron with dark gray flecks. Each set forms compact deposits, concave edges, narrow connections and small outcrops. Shown at the game’s 16px art scale and 2× enlargement. Choose a style before replacing the game artwork.',
    CANDIDATES.flatMap(candidate => MATERIALS.map((material, index) => ({
      label: `${candidate.id}${letters[index]} · ${material} · ${candidate.title}`,
      src: file(`${candidate.id}-${material}-game-scale`),
    }))),
  ),
};

export const Tilesets: StoryObj = {
  name: 'Earlier slab corner configurations',
  render: () => review(
    'Each 4×4 sample shows all 16 corner combinations at one material phase. The full autotile atlases include 64 texture phases so broad stone faces continue across tile boundaries. Grass is transparent. Corner masks: NW=1, NE=2, SW=4, SE=8. The generated rim follows the deposit perimeter.',
    CANDIDATES.flatMap(candidate => MATERIALS.map((material, index) => ({
      label: `${candidate.id}${letters[index]} · ${material} · ${candidate.title}`,
      src: file(`${candidate.id}-${material}`), scales: [1, 4],
    }))),
  ),
};

export const NativeResolution: StoryObj = {
  name: 'Earlier slab references',
  render: () => review(
    'Original 16×16 resource sprites, followed by the new stone candidates at their generated native resolutions. Candidate 2 is generated at 32px; the blob comparison also shows its reduction to the game’s 16px art grid. PixelLab used the original round stone as the material reference, then extended that material into a continuous surface.',
    [
      ...MATERIALS.map(material => ({ label: `Original ${material}`, src: file(`original-${material}`), scales: [1, 4] })),
      ...CANDIDATES.map(candidate => ({ label: `${candidate.id}A · ${candidate.title}`, src: file(`${candidate.id}-stone-blobs`), scales: [1] })),
    ],
  ),
};
