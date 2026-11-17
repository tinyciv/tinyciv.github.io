import { arrayJournal } from './cell-journal';
import { territoryValue } from './territory-cells';
import type { Point } from './types';
import { UNCLAIMED, territoryChanges, type Territory } from './borders';
import type { FogView } from './fog';

export interface MinimapProjection {
  /** Tile coordinates, inclusive at the upper/left edges and exclusive below/right. */
  world: { x: number; y: number; width: number; height: number };
  /** The actual painted rectangle; unused canvas space remains black. */
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

const explorationBounds = new WeakMap<object, { left: number; top: number; right: number; bottom: number; width: number; height: number; cursor: number; observedRevision?: number }>();

/** Fit the discovered world without revealing the size or location of unknown land.
 * Fixed padding keeps these world bounds monotonic as exploration increases.
 * Letterboxing preserves square tiles instead of distorting an elongated region. */
export function createMinimapProjection(explored: readonly number[], worldWidth: number, worldHeight: number, width: number, height: number, padding = 2, explorationRevision?: number): MinimapProjection {
  const journal = arrayJournal(explored);
  let bounds = journal ? explorationBounds.get(explored) : undefined;
  // A public/editor revision without a journal publication is an unknown
  // edit. Refresh once rather than silently trusting an incomplete journal.
  if (journal && bounds && explorationRevision !== undefined && bounds.observedRevision !== undefined
    && explorationRevision !== bounds.observedRevision && journal.revision === bounds.cursor) journal.publish();
  const changes = journal?.since(bounds?.cursor);
  const compatible = bounds?.width === worldWidth && bounds.height === worldHeight;
  let full = !compatible || !changes || changes.full;
  if (!full && bounds) for (const cell of changes!.cells) {
    const x = cell % worldWidth, y = Math.floor(cell / worldWidth);
    if (!explored[cell] && (x === bounds.left || x + 1 === bounds.right || y === bounds.top || y + 1 === bounds.bottom)) { full = true; break; }
  }
  let { left, top, right, bottom } = full ? { left: worldWidth, top: worldHeight, right: 0, bottom: 0 } : bounds!;
  const include = (cell: number): void => {
    if (!explored[cell]) return;
    const x = cell % worldWidth, y = Math.floor(cell / worldWidth);
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
  };
  if (full) for (let cell = 0; cell < worldWidth * worldHeight; cell++) include(cell);
  else for (const cell of changes!.cells) include(cell);
  if (journal) explorationBounds.set(explored, { left, top, right, bottom, width: worldWidth, height: worldHeight, cursor: journal.revision, observedRevision: explorationRevision });
  if (right <= left || bottom <= top) { left = 0; top = 0; right = worldWidth; bottom = worldHeight; }
  else {
    left = Math.max(0, left - padding); top = Math.max(0, top - padding);
    right = Math.min(worldWidth, right + padding); bottom = Math.min(worldHeight, bottom + padding);
  }
  const world = { x: left, y: top, width: right - left, height: bottom - top };
  const scale = Math.min(width / world.width, height / world.height);
  const paintedWidth = world.width * scale, paintedHeight = world.height * scale;
  return { world, x: (width - paintedWidth) / 2, y: (height - paintedHeight) / 2, width: paintedWidth, height: paintedHeight, scale };
}

export function worldToMinimap(point: Point, projection: MinimapProjection): Point {
  return { x: projection.x + (point.x - projection.world.x) * projection.scale, y: projection.y + (point.y - projection.world.y) * projection.scale };
}

/** Ignore clicks in the letterbox; never jump to undiscovered opposite map edges. */
export function minimapToWorld(point: Point, projection: MinimapProjection): Point | null {
  if (point.x < projection.x || point.y < projection.y || point.x > projection.x + projection.width || point.y > projection.y + projection.height || projection.scale <= 0) return null;
  return { x: projection.world.x + (point.x - projection.x) / projection.scale, y: projection.world.y + (point.y - projection.y) / projection.scale };
}

/** All claims require discovered ground; the cache updates on exploration,
 * never revealing a rival civilization through unexplored terrain. */
export class MinimapTerritoryMemory {
  owners = new Int32Array();
  boundary = new Uint8Array();
  private borders?: Territory;
  private fog?: FogView;
  private claimRevision = -1;
  private explorationRevision = -1;
  private explored?: readonly number[];
  private explorationCursor?: number;

  update(borders: Territory, fog: FogView, repaint = false): number[] {
    const reset = !this.borders || this.borders.width !== borders.width || this.borders.height !== borders.height || this.explored !== fog.explored || this.fog !== fog && !arrayJournal(fog.explored);
    const oldOwners = reset ? this.owners : undefined;
    if (reset) {
      this.owners = new Int32Array((borders.width * borders.height)).fill(UNCLAIMED);
      this.boundary = new Uint8Array((borders.width * borders.height));
    }
    const journal = arrayJournal(fog.explored);
    if (!reset && journal && this.explorationRevision !== fog.explorationRevision
      && journal.revision === this.explorationCursor) journal.publish();
    if (!reset && !repaint && this.borders === borders && this.claimRevision === borders.revision
      && this.explorationRevision === fog.explorationRevision && (!journal || journal.revision === this.explorationCursor)) return [];
    const claims = this.claimRevision === borders.revision && this.borders === borders
      ? { full: false, cells: [] } : territoryChanges(borders, this.borders);
    const exploration = journal?.since(reset ? undefined : this.explorationCursor)
      ?? { full: reset || this.explorationRevision !== fog.explorationRevision, cells: [] };
    const full = reset || repaint || claims.full || exploration.full;
    const dirty = new Set<number>(exploration?.cells);
    const changed: number[] = [], width = borders.width, height = borders.height;
    for (const cell of claims.cells) {
      dirty.add(cell); const x = cell % width, y = Math.floor(cell / width);
      if (x) dirty.add(cell - 1); if (x + 1 < width) dirty.add(cell + 1);
      if (y) dirty.add(cell - width); if (y + 1 < height) dirty.add(cell + width);
    }
    const refresh = (cell: number): void => {
      const claimed = territoryValue(borders, cell), owner = !fog.explored[cell] ? UNCLAIMED : claimed;
      const x = cell % width, y = Math.floor(cell / width);
      const edge = Number(owner !== UNCLAIMED && (x === 0 || y === 0 || x === width - 1 || y === height - 1
        || territoryValue(borders, cell - 1) !== owner || territoryValue(borders, cell + 1) !== owner
        || territoryValue(borders, cell - width) !== owner || territoryValue(borders, cell + width) !== owner));
      if (owner !== this.owners[cell] || edge !== this.boundary[cell] || repaint && owner !== UNCLAIMED
        || oldOwners && cell < oldOwners.length && oldOwners[cell] !== UNCLAIMED) {
        this.owners[cell] = owner; this.boundary[cell] = edge; changed.push(cell);
      }
    };
    if (full) for (let cell = 0; cell < this.owners.length; cell++) refresh(cell);
    else for (const cell of [...dirty].sort((a, b) => a - b)) refresh(cell);
    this.explored = fog.explored; this.explorationCursor = journal?.revision;
    this.borders = borders; this.fog = fog; this.claimRevision = borders.revision;
    this.explorationRevision = fog.explorationRevision;
    return changed;
  }
}
