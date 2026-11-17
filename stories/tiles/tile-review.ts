/**
 * Shared data + layout for the bridge / road tile review stories.
 * Source: scratch/2026-11-11-bridges-roads (review strips assembled from the
 * PixelLab outputs; see that folder's index.html and review/catalog.json).
 * Review only: nothing here is wired into the game renderer.
 */
import { renderGallery, type GalleryItem } from '../harness/gallery';
// scratch/ is ignored by the dev-server watcher (.storybook/main.ts), so a running Storybook keeps serving the
// catalog it first loaded. Bump `rev` after re-running scripts/assemble_review.py to make it re-read the file.
import catalogText from '../../scratch/2026-11-11-bridges-roads/review/catalog.json?rev=2&raw';

const catalog = JSON.parse(catalogText) as { bridges: unknown; roads: unknown; composites: unknown };

// Bundled with `?url`, so the stories also work in build-storybook.
const files = import.meta.glob('../../scratch/2026-11-11-bridges-roads/review/*-1x.png', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

/** URL of `review/<name>-1x.png`; throws during story render if the file is gone. */
export function reviewFile(name: string): string {
  const key = `../../scratch/2026-11-11-bridges-roads/review/${name}-1x.png`;
  const url = files[key];
  if (!url) throw new Error(`Missing review file ${name}-1x.png`);
  return url;
}

/** In-game colours sampled from the composites (puny-world overworld cells). */
export const WATER = 'rgb(4, 160, 180)';
export const GRASS = 'rgb(133, 166, 67)';

export interface CatalogSet {
  id: string; api: string; native: number; frames: Record<string, number | null>; views: Record<string, string>;
  /** Pieces with no frame that reaches the required edges. */
  missing: string[];
  /** Pieces present but whose measured edge contact differs from their label (scripts/edge_audit.py). */
  failed: string[];
  /** How each piece was chosen: 'requested', 'variant frame N' or 'tile_rules'. */
  frame_source: Record<string, string>;
  audit_pass: boolean; audit_problems: string[]; eye?: string; note?: string; material?: string; style?: string;
}
export const bridgeSets = catalog.bridges as unknown as CatalogSet[];
export const roadSets = catalog.roads as unknown as CatalogSet[];
export const composites = catalog.composites as unknown as { id: string; orient: 'lr' | 'ud'; px: string; file: string; audit_pass: boolean }[];

/** One column of the piece grid: a 1x strip whose slots follow the catalog's frame-key order. */
export interface TileColumn {
  header: string;
  src: string;
  /** Slot size in px (16 or 32). */
  size: number;
  /** Row key -> slot index in the strip. */
  slots: Record<string, number>;
  missing?: string[];
  /** Row keys whose piece fails its measured edge contact. */
  failed?: string[];
  /** Row key -> short note appended to the label (e.g. 'variant f9'). */
  notes?: Record<string, string>;
}

/**
 * Columns are sets (object API first, then tileset API), rows are pieces.
 * Uses one renderGallery so `.tc-gallery[data-ready]` covers every cell.
 */
export function pieceGrid(rows: readonly string[], columns: readonly TileColumn[], background: string): HTMLElement {
  const items: GalleryItem[] = [];
  const places: [number, number][] = [];
  columns.forEach((column, c) => rows.forEach((row, r) => {
    const slot = column.slots[row];
    if (slot === undefined) return;
    items.push({
      label: column.missing?.includes(row) ? `${row} (missing)`
        : column.failed?.includes(row) ? `${row} (FAIL edges)`
          : column.notes?.[row] ? `${row} (${column.notes[row]})` : row,
      src: column.src,
      sheet: { frameWidth: column.size, frameHeight: column.size, rows: 1, columns: 1, frames: 1, offsetX: slot * column.size },
      scales: column.size === 16 ? [1, 4] : [1, 2],
    });
    places.push([r + 2, c + 1]);
  }));
  const root = renderGallery(items, { background });
  root.classList.add('tc-tile-grid');
  root.style.display = 'grid';
  root.style.gridTemplateColumns = `repeat(${columns.length}, max-content)`;
  root.style.columnGap = '28px';
  root.style.rowGap = '14px';
  [...root.children].forEach((figure, i) => {
    (figure as HTMLElement).style.gridRow = String(places[i][0]);
    (figure as HTMLElement).style.gridColumn = String(places[i][1]);
  });
  columns.forEach((column, c) => {
    const header = document.createElement('div');
    header.className = 'tc-gallery-label tc-tile-header';
    header.textContent = column.header;
    header.style.gridRow = '1';
    header.style.gridColumn = String(c + 1);
    header.style.color = '#ffe08a';
    root.append(header);
  });
  return root;
}

/** Strip slot index for each catalog frame key (strips are assembled in key order). */
export function slotsOf(set: CatalogSet, rename: (key: string) => string = key => key): Record<string, number> {
  return Object.fromEntries(Object.keys(set.frames).map((key, i) => [rename(key), i]));
}

/** Object API first, then Tileset API; each 32 px set is followed by its 16 px reduction. */
export function columnsFor(sets: readonly CatalogSet[], rename?: (key: string) => string): TileColumn[] {
  const ren = (key: string) => (rename ? rename(key) : key);
  const ordered = [...sets].sort((a, b) => (a.api === b.api ? 0 : a.api === 'object' ? -1 : 1));
  const columns: TileColumn[] = [];
  for (const set of ordered) {
    const slots = slotsOf(set, rename);
    const missing = set.missing.map(ren);
    const failed = set.failed.map(ren);
    const notes = Object.fromEntries(Object.entries(set.frame_source)
      .filter(([, source]) => source.startsWith('variant'))
      .map(([key, source]) => [ren(key), source.replace('variant frame ', 'variant f')]));
    const api = set.api === 'object' ? 'Object API' : 'Tileset API';
    const verdict = set.audit_pass ? 'PASS' : 'FAIL';
    const base = { slots, missing, failed, notes };
    columns.push({ header: `${set.id} ${api} ${set.native}px [${verdict}]`, src: reviewFile(`${set.id}-native`), size: set.native, ...base });
    if (set.views['16px']) {
      columns.push({ header: `${set.id} ${api} ->16px [${verdict}]`, src: reviewFile(`${set.id}-16px`), size: 16, ...base });
    }
  }
  return columns;
}

/** Per-set verdict notes (edge audit result + by-eye note) shown above a grid. */
export function verdictNotes(sets: readonly CatalogSet[]): HTMLElement {
  const box = document.createElement('div');
  box.className = 'tc-tile-verdicts';
  box.style.cssText = 'font-family:"Pixel Operator",monospace;font-size:16px;color:#e6e6e6;max-width:1100px;margin:0 0 16px';
  for (const set of sets) {
    const line = document.createElement('p');
    line.style.margin = '4px 0';
    const tag = document.createElement('b');
    tag.textContent = `${set.id} ${set.audit_pass ? 'EDGE AUDIT PASS' : 'EDGE AUDIT FAIL'}: `;
    tag.style.color = set.audit_pass ? '#8fe39a' : '#ff8c8c';
    line.append(tag, set.eye ?? set.audit_problems.slice(0, 2).join('; '));
    box.append(line);
  }
  return box;
}

/** Notes + piece grid in one wrapper (the grid keeps its own `.tc-gallery[data-ready]`). */
export function withNotes(sets: readonly CatalogSet[], grid: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.append(verdictNotes(sets), grid);
  return wrap;
}
