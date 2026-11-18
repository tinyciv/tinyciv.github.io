import { WATER, tileAt, type Tile, type World } from './types';
import type { WorldCellChanges } from './world-revisions';

export enum MarshRushBand { Low, Middle, High, Tall }

export interface MarshRushPlacement {
  band: MarshRushBand;
  left: boolean;
  right: boolean;
  shootVariant: number;
}

const NEIGHBORS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
const FRINGE_DEPTH = 3;
const INFLUENCE_RADIUS = FRINGE_DEPTH + 1;

export function isMarshRushTile(tile?: Tile): tile is Tile {
  return !!tile?.marsh && !WATER.has(tile.terrain);
}

/** Water leaves the bank's rush height intact. Only a route through marsh to
 * open ground creates a fringe. Each search visits at most three rings. */
function distanceToDryGround(world: World, x: number, y: number): number {
  const start = y * world.width + x;
  const queue = [start], seen = new Set(queue);
  let head = 0;
  for (let distance = 1; distance <= FRINGE_DEPTH && head < queue.length; distance++) {
    const stop = queue.length;
    for (; head < stop; head++) {
      const index = queue[head], cx = index % world.width, cy = Math.floor(index / world.width);
      for (const [dx, dy] of NEIGHBORS) {
        const nx = cx + dx, ny = cy + dy;
        const neighbor = tileAt(world, nx, ny);
        if (!neighbor || WATER.has(neighbor.terrain)) continue;
        if (!neighbor.marsh) return distance;
        const next = ny * world.width + nx;
        if (distance < FRINGE_DEPTH && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
  }
  return FRINGE_DEPTH + 1;
}

function bandAt(world: World, x: number, y: number, variation: number): MarshRushBand {
  const depth = distanceToDryGround(world, x, y);
  if (depth === 1) return variation < .56 ? MarshRushBand.Low : variation < .94 ? MarshRushBand.Middle : MarshRushBand.High;
  if (depth === 2) return variation < .42 ? MarshRushBand.Middle : variation < .86 ? MarshRushBand.High : MarshRushBand.Tall;
  return depth === 3 && variation < .46 ? MarshRushBand.High : MarshRushBand.Tall;
}

/** Lazily index drawn marsh tiles. Terrain journaling drops just the affected
 * four-cell radius, which covers the fringe and its immediate side neighbors. */
export class MarshRushPlacementCache {
  private world?: World;
  private readonly bands = new Map<number, MarshRushBand>();
  private readonly placements = new Map<number, MarshRushPlacement>();

  refresh(world: World, changes: WorldCellChanges): void {
    if (this.world !== world || changes.full) {
      this.world = world;
      this.bands.clear();
      this.placements.clear();
      return;
    }
    if (!this.bands.size) return;
    for (const index of changes.cells) {
      const x = index % world.width, y = Math.floor(index / world.width);
      for (let ny = Math.max(0, y - INFLUENCE_RADIUS); ny <= Math.min(world.height - 1, y + INFLUENCE_RADIUS); ny++) {
        const reach = INFLUENCE_RADIUS - Math.abs(ny - y);
        for (let nx = Math.max(0, x - reach); nx <= Math.min(world.width - 1, x + reach); nx++) {
          const cell = ny * world.width + nx;
          this.bands.delete(cell);
          this.placements.delete(cell);
        }
      }
    }
  }

  private band(world: World, x: number, y: number): MarshRushBand | undefined {
    const tile = tileAt(world, x, y);
    if (!isMarshRushTile(tile)) return;
    const cell = y * world.width + x;
    let band = this.bands.get(cell);
    if (band === undefined) {
      band = bandAt(world, x, y, tile.variation);
      this.bands.set(cell, band);
    }
    return band;
  }

  get(world: World, x: number, y: number): MarshRushPlacement | undefined {
    const cell = y * world.width + x;
    const cached = this.placements.get(cell);
    if (cached) return cached;
    const band = this.band(world, x, y);
    if (band === undefined) return;
    const leftBand = this.band(world, x - 1, y), rightBand = this.band(world, x + 1, y);
    const seed = Math.imul(cell + 72143, 2654435761) >>> 0;
    const placement = {
      band,
      left: (seed & 7) !== 0 && (leftBand === undefined || band - leftBand >= 2),
      right: ((seed >>> 9) & 7) !== 0 && (rightBand === undefined || band - rightBand >= 2),
      shootVariant: band >= MarshRushBand.High ? seed & 1 : 0,
    };
    this.placements.set(cell, placement);
    return placement;
  }
}
