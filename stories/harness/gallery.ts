/**
 * "Images and animations only" gallery: labelled, nearest-neighbour previews
 * of PNGs and animated sprite sheets at native, 2x and 4x scale.
 */
import '../../src/ui/game-font.css';
import './harness.css';

export interface SheetSpec {
  /** Size of one frame in source pixels. */
  frameWidth: number;
  frameHeight: number;
  /** Rows are directions; defaults to image height / frameHeight. */
  rows?: number;
  /** Columns are animation frames; defaults to image width / frameWidth. */
  columns?: number;
  /** Animation speed in frames per second (default 8). */
  fps?: number;
  /** Show only these rows (directions), in this order. Default: every row. */
  rowIndices?: number[];
  /** Frames actually used per row, if fewer than `columns`. */
  frames?: number;
  /** Source offset of the sheet inside the image (default 0, 0). */
  offsetX?: number;
  offsetY?: number;
}

export interface GalleryItem {
  /** The only text shown, e.g. "1A" or "2C". */
  label: string;
  /** Image URL: `repoAsset('scratch/...png')`, a public `/assets/...` path, or a Vite `?url` import. */
  src: string;
  /** Present => animated sprite sheet; absent => static image. */
  sheet?: SheetSpec;
  /** Overrides the gallery scales for this item. */
  scales?: number[];
}

export interface GalleryOptions {
  /** Default [1, 2, 4] (native, 2x, 4x), shown left to right. */
  scales?: number[];
  /** CSS background behind every preview (default dark green-grey). */
  background?: string;
}

/**
 * URL for a file in this repository, e.g. repoAsset('scratch/2026-11-11-ships/galley.png').
 * Served by the Storybook dev server (see .storybook/main.ts, `/@repo/`); only
 * image files under scratch/, public/, docs/ and output/ are exposed.
 * For files that must also ship in `build-storybook`, import them with `?url`.
 */
export function repoAsset(path: string): string {
  return `/@repo/${path.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/')}`;
}

const images = new Map<string, Promise<HTMLImageElement>>();
function loadImage(src: string): Promise<HTMLImageElement> {
  let promise = images.get(src);
  if (!promise) {
    promise = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Unable to load ${src}`));
      image.src = src;
    });
    images.set(src, promise);
  }
  return promise;
}

interface Animation { context: CanvasRenderingContext2D; image: HTMLImageElement; spec: SheetSpec; row: number; frames: number; scale: number; drawn: number }

function canvasAt(width: number, height: number, background: string): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  canvas.style.background = background;
  const context = canvas.getContext('2d')!;
  context.imageSmoothingEnabled = false;
  return { canvas, context };
}

/** Render a gallery element. Animations stop when the element is detached. */
export function renderGallery(items: readonly GalleryItem[], options: GalleryOptions = {}): HTMLElement {
  const root = document.createElement('div');
  root.className = 'tc-gallery';
  const background = options.background ?? '#2b3a33';
  const animations: Animation[] = [];
  let pending = items.length;
  const settle = () => { if (--pending <= 0) root.dataset.ready = 'true'; };
  if (!pending) root.dataset.ready = 'true';

  for (const item of items) {
    const card = document.createElement('figure');
    card.className = 'tc-gallery-item';
    card.style.margin = '0';
    const label = document.createElement('figcaption');
    label.className = 'tc-gallery-label';
    label.textContent = item.label;
    const body = document.createElement('div');
    body.className = 'tc-gallery-rows';
    card.append(label, body);
    root.append(card);
    const scales = item.scales ?? options.scales ?? [1, 2, 4];
    loadImage(item.src).then(image => {
      const spec = item.sheet;
      if (!spec) {
        const row = document.createElement('div');
        row.className = 'tc-gallery-row';
        for (const scale of scales) {
          const { canvas, context } = canvasAt(image.naturalWidth * scale, image.naturalHeight * scale, background);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          row.append(canvas);
        }
        body.append(row);
        return;
      }
      const columns = spec.columns ?? Math.floor((image.naturalWidth - (spec.offsetX ?? 0)) / spec.frameWidth);
      const rows = spec.rows ?? Math.floor((image.naturalHeight - (spec.offsetY ?? 0)) / spec.frameHeight);
      const frames = Math.max(1, Math.min(columns, spec.frames ?? columns));
      for (const index of spec.rowIndices ?? Array.from({ length: rows }, (_, row) => row)) {
        const row = document.createElement('div');
        row.className = 'tc-gallery-row';
        for (const scale of scales) {
          const { canvas, context } = canvasAt(spec.frameWidth * scale, spec.frameHeight * scale, background);
          row.append(canvas);
          animations.push({ context, image, spec, row: index, frames, scale, drawn: -1 });
        }
        body.append(row);
      }
    }).catch(error => {
      const missing = document.createElement('div');
      missing.className = 'tc-gallery-missing';
      missing.textContent = String(error instanceof Error ? error.message : error);
      body.append(missing);
      console.warn(error);
    }).finally(settle);
  }

  const start = performance.now();
  let attached = false;
  const tick = (now: number) => {
    if (root.isConnected) attached = true;
    else if (attached) return;
    const seconds = (now - start) / 1000;
    for (const animation of animations) {
      const { context, image, spec, row, frames, scale } = animation;
      const frame = Math.floor(seconds * (spec.fps ?? 8)) % frames;
      if (frame === animation.drawn) continue;
      animation.drawn = frame;
      context.clearRect(0, 0, spec.frameWidth * scale, spec.frameHeight * scale);
      context.drawImage(image, (spec.offsetX ?? 0) + frame * spec.frameWidth, (spec.offsetY ?? 0) + row * spec.frameHeight,
        spec.frameWidth, spec.frameHeight, 0, 0, spec.frameWidth * scale, spec.frameHeight * scale);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return root;
}
