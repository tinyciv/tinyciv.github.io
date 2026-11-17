import { territoryValue } from './territory-cells';
import { territory, type Territory } from './borders';
import { worldChangesSince } from './world-revisions';
import type { GameState, Point, Tile } from './types';

// Ten tiles of construction range plus the route search's28-tile excursion.
const RADIUS = 40;
interface PreviewRegion {
  world: GameState['world']; tiles: GameState['world']['tiles']; width: number; height: number;
  left: number; top: number; right: number; bottom: number;
  cursor: number; terrainRevision: number; claimsRevision: number;
  terrain: Map<number, string>; claims: Uint8Array; borders?: Territory; villages?: string;
}
const regions = new WeakMap<GameState, PreviewRegion>();
const tileKey = (tile: Tile): string => [tile.terrain, tile.overlay, tile.biome, tile.resource, tile.relief,
  tile.reliefFlags, tile.reliefLevel, tile.reliefSpeed, tile.waterfall, tile.villageTrail, tile.farm, tile.palm, tile.marsh, tile.fertility].join(',');

/** Infrastructure gestures depend on local placement geometry. Remote routine city work
 * must not discard every pointer endpoint. Farm ranking can share the live
 * planner's deferred costs; the eventual purchase still validates current state. */
export function constructionPreviewRegion(state: GameState, origin: Point): PreviewRegion {
  const { world } = state, x = Math.floor(origin.x), y = Math.floor(origin.y);
  const left = Math.max(0, x - RADIUS), top = Math.max(0, y - RADIUS);
  const right = Math.min(world.width - 1, x + RADIUS), bottom = Math.min(world.height - 1, y + RADIUS);
  let region = regions.get(state);
  if (!region || region.world !== world || region.tiles !== world.tiles || region.width !== world.width || region.height !== world.height
    || region.left !== left || region.top !== top || region.right !== right || region.bottom !== bottom) {
    region = { world, tiles: world.tiles, width: world.width, height: world.height, left, top, right, bottom,
      cursor: -1, terrainRevision: 0, claimsRevision: 0, terrain: new Map(), claims: new Uint8Array((right - left + 1) * (bottom - top + 1)) };
    regions.set(state, region);
  }
  const changes = worldChangesSince(world, region.cursor);
  let changed = false;
  const inspect = (cell: number): void => {
    const cx = cell % world.width, cy = Math.floor(cell / world.width);
    if (cx < left || cx > right || cy < top || cy > bottom) return;
    const key = tileKey(world.tiles[cell]);
    if (region!.terrain.get(cell) !== key) { region!.terrain.set(cell, key); changed = true; }
  };
  if (changes.full) for (let cy = top; cy <= bottom; cy++) for (let cx = left; cx <= right; cx++) inspect(cy * world.width + cx);
  else for (const cell of changes.cells) inspect(cell);
  if (changed) region.terrainRevision++;
  region.cursor = changes.revision;
  const villages = (state.villages ?? []).filter(village => !village.destroyed);
  const villageKey = villages.map(village => `${village.id}:${village.faction}`).join(';');
  const borders = villages.length ? territory(state) : undefined;
  if (region.borders !== borders || region.villages !== villageKey) {
    const owners = new Set(villages.map(village => village.faction));
    let index = 0, changedClaims = false;
    for (let cy = top; cy <= bottom; cy++) for (let cx = left; cx <= right; cx++) {
      const reserved = Number(!!borders && owners.has(territoryValue(borders, cy * world.width + cx)));
      if (region.claims[index] !== reserved) { region.claims[index] = reserved; changedClaims = true; }
      index++;
    }
    if (changedClaims) region.claimsRevision++;
    region.borders = borders; region.villages = villageKey;
  }
  return region;
}
