import type { Point } from './types';
import { UNCLAIMED, type Territory } from './borders';
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

/** Fit the discovered world without revealing the size or location of unknown land.
 * Fixed padding keeps these world bounds monotonic as exploration increases.
 * Letterboxing preserves square tiles instead of distorting an elongated region. */
export function createMinimapProjection(explored: readonly number[], worldWidth: number, worldHeight: number, width: number, height: number, padding = 2): MinimapProjection {
  let left = worldWidth, top = worldHeight, right = 0, bottom = 0;
  for (let y = 0; y < worldHeight; y++) for (let x = 0; x < worldWidth; x++) {
    if (!explored[y * worldWidth + x]) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
  }
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

  update(borders: Territory, fog: FogView, repaint = false): number[] {
    const reset = !this.borders || this.borders.width !== borders.width || this.borders.height !== borders.height || this.fog !== fog;
    const oldOwners = reset ? this.owners : undefined;
    if (reset) {
      this.owners = new Int32Array(borders.owners.length).fill(UNCLAIMED);
      this.boundary = new Uint8Array(borders.owners.length);
    }
    if (!reset && !repaint && this.borders === borders && this.claimRevision === borders.revision
      && this.explorationRevision === fog.explorationRevision) return [];
    const changed: number[] = [], width = borders.width, height = borders.height;
    for (let cell = 0; cell < this.owners.length; cell++) {
      const claimed = borders.owners[cell], owner = !fog.explored[cell] ? UNCLAIMED : claimed;
      const x = cell % width, y = Math.floor(cell / width);
      const edge = Number(owner !== UNCLAIMED && (x === 0 || y === 0 || x === width - 1 || y === height - 1
        || borders.owners[cell - 1] !== owner || borders.owners[cell + 1] !== owner
        || borders.owners[cell - width] !== owner || borders.owners[cell + width] !== owner));
      if (owner !== this.owners[cell] || edge !== this.boundary[cell] || repaint && owner !== UNCLAIMED
        || oldOwners && cell < oldOwners.length && oldOwners[cell] !== UNCLAIMED) {
        this.owners[cell] = owner; this.boundary[cell] = edge; changed.push(cell);
      }
    }
    this.borders = borders; this.fog = fog; this.claimRevision = borders.revision;
    this.explorationRevision = fog.explorationRevision;
    return changed;
  }
}
