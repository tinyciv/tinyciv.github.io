import type { Meta, StoryObj } from '@storybook/html-vite';
import { renderGallery } from '../harness/gallery';
import { bridgeSets, columnsFor, pieceGrid, WATER, withNotes } from './tile-review';
// Bump `rev` after re-running scripts/final_stone_2B.py (scratch/ is not watched by the dev server).
import finalAuditText from '../../scratch/2026-11-11-bridges-roads/final-stone-2B/edge-audit.json?rev=1&raw';

// Bridge candidates from scratch/2026-11-11-bridges-roads (review only; not in the game).
// Columns: Object API sets, then Tileset API sets; each 32 px set is followed by its
// 16 px reduction. Rows: every piece / orientation. Drawn on the game's water colour,
// so gaps in transparent Object API pieces show up. Pieces are chosen and labelled by
// measured edge contact; an end must reach both the deck side and the bank side.
const PIECES = ['LR interior', 'UD interior', 'W end', 'E end', 'N end', 'S end'] as const;

function bridges(material: 'wood' | 'stone'): HTMLElement {
  const sets = bridgeSets.filter(set => set.material === material);
  return withNotes(sets, pieceGrid(PIECES, columnsFor(sets), WATER));
}

const meta: Meta = { title: 'Tiles/Bridges' };
export default meta;

/** Wood: Object API sets (W1, W2) vs W3-W4 Tileset API (failed ends, no bank pieces). */
export const Wood: StoryObj = { render: () => bridges('wood') };
/** Stone: S1-S3 Object API vs S4 Tileset API (pier-cap ends, no S end). */
export const Stone: StoryObj = { render: () => bridges('stone') };

// Final stone bridge (2B): scratch/2026-11-11-bridges-roads/final-stone-2B (scripts/final_stone_2B.py).
const finalFiles = import.meta.glob('../../scratch/2026-11-11-bridges-roads/final-stone-2B/*.png', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;
function finalFile(name: string): string {
  const url = finalFiles[`../../scratch/2026-11-11-bridges-roads/final-stone-2B/${name}.png`];
  if (!url) throw new Error(`Missing final-stone-2B/${name}.png`);
  return url;
}
const FINAL_PIECES = [['lr-interior', 'LR interior'], ['lr-end-w', 'W end'], ['lr-end-e', 'E end'],
  ['ud-interior', 'UD interior'], ['ud-end-n', 'N end'], ['ud-end-s', 'S end']] as const;

function finalStone2B(): HTMLElement {
  const audit = JSON.parse(finalAuditText) as {
    pass: boolean; problems: string[];
    pieces: Record<string, { mask_name: string; profiles: Record<string, [number, number]> }>;
    join_groups: Record<string, { spread_px: number }>;
  };
  const note = document.createElement('p');
  note.style.cssText = 'font-family:"Pixel Operator",monospace;font-size:16px;color:#e6e6e6;max-width:1100px;margin:0 0 16px';
  const tag = document.createElement('b');
  tag.textContent = audit.pass ? 'EDGE AUDIT PASS: ' : 'EDGE AUDIT FAIL: ';
  tag.style.color = audit.pass ? '#8fe39a' : '#ff8c8c';
  const joins = Object.entries(audit.join_groups).map(([group, v]) => `${group} spread ${v.spread_px} px`).join('; ');
  note.append(tag, audit.pass
    ? `all 6 pieces reach exactly their labelled edges; ${joins}. Interiors are 2B frames 0/1; ends are generated with 2B as style reference, deck-side edges spliced from the interior, palette locked to 2B.`
    : audit.problems.join('; '));
  const items = [
    ...FINAL_PIECES.map(([file, label]) => {
      const piece = audit.pieces[label];
      const spans = Object.entries(piece.profiles).map(([edge, [a, b]]) => `${edge} ${a}-${b}`).join(' ');
      return { label: `${label} (${piece.mask_name}: ${spans})`, src: finalFile(file), scales: [1, 4] };
    }),
    { label: 'Left-right crossing on game grass/water', src: finalFile('comp-lr-1x'), scales: [1, 2] },
    { label: 'Up-down crossing on game grass/water', src: finalFile('comp-ud-1x'), scales: [1, 2] },
  ];
  const wrap = document.createElement('div');
  wrap.append(note, renderGallery(items, { background: WATER }));
  return wrap;
}

/** Final stone bridge (2B): interior + bank ends, both orientations, chained across a river. */
export const FinalStone2B: StoryObj = { name: 'Final stone bridge (2B)', render: () => finalStone2B() };
