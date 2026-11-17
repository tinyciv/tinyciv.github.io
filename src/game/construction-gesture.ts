import type { ConstructionPlan } from './construction';
import { previewConstructionGesture } from './construction-display';
import { CHECK_INTERVAL_MS } from './work-cadence';
import type { BuildSelection, GameState, Point } from './types';

/** One immutable quote is shared by the cost display and world ghosts. */
export interface ConstructionGesturePreview {
  state: GameState;
  world: GameState['world'];
  kind: BuildSelection;
  points: Point[];
  plan: ConstructionPlan;
  requestedEnd?: Point;
  message?: string;
  requestedCost?: number;
  requestedTiles?: number;
}

type ResolveGesture = typeof previewConstructionGesture;

/** The frontend supplies only the latest pointer position each animation frame.
 * Unchanged endpoints share their quote until the slow refresh clock. Release
 * forces a fresh read; actual purchases still validate each cell live. */
export class ConstructionGestureCache {
  private cached?: { value: ConstructionGesturePreview; tiles: GameState['world']['tiles'];
    key: string; refreshAt: number };

  constructor(private readonly resolve: ResolveGesture = previewConstructionGesture) {}

  clear(): void { this.cached = undefined; }

  read(state: GameState, kind: BuildSelection, from: Point, to: Point, now: number, force = false): ConstructionGesturePreview {
    const start = { x: Math.floor(from.x), y: Math.floor(from.y) };
    const end = { x: Math.floor(to.x), y: Math.floor(to.y) };
    const key = `${kind}:${start.x},${start.y}:${end.x},${end.y}`, old = this.cached;
    if (!force && old && old.value.state === state && old.value.world === state.world
      && old.tiles === state.world.tiles && old.key === key && now < old.refreshAt) return old.value;
    // A forced read resamples live dependencies and funds. Inner route caches
    // remain useful when that fresh sample confirms unchanged local geometry.
    const result = this.resolve(state, kind, start, end, false);
    const value: ConstructionGesturePreview = { ...result, state, world: state.world, kind, requestedEnd: end };
    this.cached = { value, tiles: state.world.tiles, key, refreshAt: now + CHECK_INTERVAL_MS };
    return value;
  }
}
