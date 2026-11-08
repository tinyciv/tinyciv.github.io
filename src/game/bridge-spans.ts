import { playerFaction } from './player-context';
import { canTraverseEdge, canWalk, withNavigationFrame } from './pathfinding';
import { type GameState, type Point, WATER, tileAt } from './types';
import { researchLevel } from './research';

export const INITIAL_BRIDGE_SPAN = 2;
export const MAX_BRIDGE_SPAN = 8;
export const bridgeSpanLimit = (state: GameState, faction = playerFaction(state)): number =>
  researchLevel(state.factions.find(owner => owner.id === faction), 'engineering') ? MAX_BRIDGE_SPAN : INITIAL_BRIDGE_SPAN;
const bridgeLimitMessage = (state: GameState, faction: number): string =>
  `Bridges need clear land at both ends and may cross at most ${bridgeSpanLimit(state, faction)} water tiles.`
  + (bridgeSpanLimit(state, faction) === INITIAL_BRIDGE_SPAN ? ' Research Engineering for 8-tile bridges.' : '');
export type BridgeAxis = 'horizontal' | 'vertical';
export interface BridgeSpan { axis: BridgeAxis; tiles: Point[]; banks: readonly [Point, Point] }
const axisStep = (axis: BridgeAxis): Point => axis === 'horizontal' ? { x: 1, y: 0 } : { x: 0, y: 1 };
const waterAt = (state: GameState, point: Point): boolean => {
  const tile = tileAt(state.world, point.x, point.y);
  return !!tile && WATER.has(tile.terrain);
};

/** A bridge is a complete straight crossing, including the water under any
 * existing segments. A tiny island is a valid bank; the edge of the map is not. */
export function bridgeSpanAt(state: GameState, point: Point, faction = playerFaction(state), preferredAxis?: BridgeAxis): BridgeSpan | undefined {
  return withNavigationFrame(state, () => findBridgeSpan(state, point, faction, preferredAxis));
}

function findBridgeSpan(state: GameState, point: Point, faction: number, preferredAxis?: BridgeAxis): BridgeSpan | undefined {
  const origin = { x: Math.floor(point.x), y: Math.floor(point.y) };
  if (!waterAt(state, origin)) return;
  const limit = bridgeSpanLimit(state, faction);
  const spans: BridgeSpan[] = [];
  for (const axis of preferredAxis ? [preferredAxis] : ['horizontal', 'vertical'] as const) {
    const step = axisStep(axis), halves: Point[][] = [], banks: Point[] = [];
    let valid = true;
    for (const sign of [-1, 1]) {
      const half: Point[] = [];
      let cursor = origin;
      for (let distance = 1; distance <= limit; distance++) {
        const next = { x: origin.x + step.x * sign * distance, y: origin.y + step.y * sign * distance };
        if (!canTraverseEdge(state.world, cursor, next)) { valid = false; break; }
        if (!waterAt(state, next)) {
          if (!canWalk(state, next.x, next.y, faction)) valid = false;
          else banks.push(next);
          break;
        }
        half.push(next); cursor = next;
      }
      halves.push(half);
      if (!valid) break;
    }
    if (!valid || banks.length !== 2) continue;
    const tiles = [...halves[0].reverse(), origin, ...halves[1]];
    if (tiles.length <= limit) spans.push({ axis, tiles, banks: banks as [Point, Point] });
  }
  // A click chooses the shortest crossing. Horizontal wins an exact tie, so
  // hover, preview, and purchase always agree without consuming game RNG.
  return spans.sort((a, b) => a.tiles.length - b.tiles.length)[0];
}

export function validateBridgeTile(state: GameState, x: number, y: number, faction = playerFaction(state)): { ok: boolean; message: string } {
  if (tileAt(state.world, x, y)?.waterfall) return { ok: false, message: 'Waterfalls cannot be bridged.' };
  if (!waterAt(state, { x, y })) return { ok: false, message: 'Bridges span water tiles.' };
  return bridgeSpanAt(state, { x, y }, faction) ? { ok: true, message: '' }
    : { ok: false, message: bridgeLimitMessage(state, faction) };
}

/** Expand every touched water run into its whole bank-to-bank crossing. The
 * caller purchases this list atomically, so limited gold cannot strand a pier. */
export function bridgeStroke(state: GameState, points: readonly Point[], faction = playerFaction(state)): { ok: boolean; points: Point[]; message: string } {
  return withNavigationFrame(state, () => expandBridgeStroke(state, points, faction));
}

function expandBridgeStroke(state: GameState, points: readonly Point[], faction: number): { ok: boolean; points: Point[]; message: string } {
  const input = points.map(point => ({ x: Math.floor(point.x), y: Math.floor(point.y) }));
  if (!input.length) return { ok: true, points: [], message: '' };
  const first = input[0], horizontal = input.every(point => point.y === first.y), vertical = input.every(point => point.x === first.x);
  if (!horizontal && !vertical) return { ok: false, points: input, message: 'Draw bridges in a straight line between banks.' };
  const axis = horizontal && vertical ? undefined : horizontal ? 'horizontal' : 'vertical';
  const result = new Map<string, Point>();
  let spans = 0;
  for (const point of input) {
    if (!waterAt(state, point)) { result.set(`${point.x},${point.y}`, point); continue; }
    const span = bridgeSpanAt(state, point, faction, axis);
    if (!span) return { ok: false, points: input, message: bridgeLimitMessage(state, faction) };
    spans++;
    for (const tile of [span.banks[0], ...span.tiles, span.banks[1]]) result.set(`${tile.x},${tile.y}`, tile);
  }
  if (!spans) return { ok: false, points: input, message: 'Draw a bridge across water between two banks.' };
  const expanded = [...result.values()];
  // Start from the nearer end of a drag, rather than making construction depend
  // on which water cell happened to be processed first.
  expanded.sort((a, b) => Math.hypot(a.x - first.x, a.y - first.y) - Math.hypot(b.x - first.x, b.y - first.y)
    || a.y - b.y || a.x - b.x);
  return { ok: true, points: expanded, message: '' };
}
