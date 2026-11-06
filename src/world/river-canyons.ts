import { WATER, type World } from '../game/types';
import { ridgeIsLedge } from '../game/ridges';
import { terrainYields } from './generator';
import { rebuildIncisedRelief } from './regional-relief';

/** Keep the original geology before the channel painter changes water cells. */
export interface RiverReliefSnapshot {
  ridge: Uint32Array;
  tier: Uint8Array;
  relief: Uint8Array;
  elevation: Float32Array;
}
export interface RiverCanyonResult {
  canyonCells: number[];
  wallCells: number[];
  removedRidgeCells: number[];
  affectedRidges: number;
  stairs: number;
}

export function captureRiverRelief(world: World): RiverReliefSnapshot {
  return {
    ridge: Uint32Array.from(world.tiles, tile => tile.ridge ?? 0),
    tier: Uint8Array.from(world.tiles, tile => tile.ridge ? tile.ridgeTier ?? 1 : 0),
    relief: Uint8Array.from(world.tiles, tile => tile.relief === 'mountains' ? 2 : tile.relief === 'hills' ? 1 : 0),
    elevation: Float32Array.from(world.tiles, tile => tile.elevation),
  };
}

/** Incise rivers into completed landforms, leaving the surviving uplands as
 * genuine native ledges. The two dry bank tiles are the existing art/navigation
 * apron, not a second water brush. Only full rivers incise these banks.
 * Channel elevations and runoff are never raised or recomputed here. */
export function carveRiverCanyons(world: World, before: RiverReliefSnapshot,
  channelMask?: Uint8Array): RiverCanyonResult {
  const { width, height, tiles } = world, count = tiles.length;
  if (before.ridge.length !== count || channelMask && channelMask.length !== count)
    throw new RangeError('River canyon fields must match the world dimensions.');
  const channel = Uint8Array.from(tiles, (tile, cell) => Number(tile.terrain === 'river' && (!channelMask || channelMask[cell])));
  const cut = new Uint8Array(count), affected = new Set<number>(), channelNearRelief = new Uint8Array(count);
  const visitSquare = (cell: number, radius: number, visit: (next: number) => void) => {
    const x = cell % width, y = Math.floor(cell / width);
    for (let ny = Math.max(0, y - radius); ny <= Math.min(height - 1, y + radius); ny++)
      for (let nx = Math.max(0, x - radius); nx <= Math.min(width - 1, x + radius); nx++) visit(ny * width + nx);
  };
  // A river may graze a hill as well as split it. Both cases need the complete
  // dry palette apron; simply deleting the wet ridge cell leaves broken ledges.
  for (let cell = 0; cell < count; cell++) if (channel[cell]) visitSquare(cell, 2, next => {
    cut[next] = 1;
    if (before.ridge[next]) { affected.add(before.ridge[next]); channelNearRelief[cell] = 1; }
  });
  if (!affected.size) return { canyonCells: [], wallCells: [], removedRidgeCells: [], affectedRidges: 0, stairs: 0 };

  const fragments = new Map<number, { cells: number[]; kind: 'hills' | 'mountains' }>();
  const originalMembers: number[] = [], floor = new Uint8Array(count);
  const clearVegetation = (cell: number) => {
    const tile = tiles[cell];
    if (tile.overlay !== 'ford') {
      const old = terrainYields(tile.terrain, tile.overlay), plain = terrainYields(tile.terrain, 'none');
      for (const key of ['food', 'production', 'gold'] as const) tile[key] = Math.max(0, tile[key] + plain[key] - old[key]);
      tile.overlay = 'none';
    }
    delete tile.treeClass; delete tile.palm;
  };
  for (let cell = 0; cell < count; cell++) {
    const id = before.ridge[cell]; if (!affected.has(id)) continue;
    originalMembers.push(cell);
    const tile = tiles[cell];
    delete tile.ridge; delete tile.ridgeTier; delete tile.stair;
    if (cut[cell] || WATER.has(tile.terrain) || channel[cell]) {
      floor[cell] = 1; tile.canyon = 'floor';
      if (before.relief[cell] === 2) tile.mountainPass = true;
      clearVegetation(cell);
      // Dry canyon banks descend from the original shelf. Leave water and
      // source heights entirely to the network's downstream incision profile.
      if (!channel[cell] && !WATER.has(tile.terrain)) {
        let nearby = Infinity;
        visitSquare(cell, 2, next => { if (channel[next]) nearby = Math.min(nearby, tiles[next].elevation); });
        if (Number.isFinite(nearby)) tile.elevation = Math.min(tile.elevation, nearby + .025);
      }
    } else {
      const fragment = fragments.get(id) ?? { cells: [], kind: before.relief[cell] === 2 ? 'mountains' : 'hills' };
      fragment.cells.push(cell); fragments.set(id, fragment);
    }
  }
  for (let cell = 0; cell < count; cell++) if (channelNearRelief[cell]) {
    floor[cell] = 1; tiles[cell].canyon = 'floor'; clearVegetation(cell);
  }

  // Disconnected banks receive separate identities, supported 2×2 outlines,
  // nested mountain tiers and real stairs. Unserviceable floor slivers become
  // low saddles instead of being stranded above an impassable decorative lip.
  rebuildIncisedRelief(world, [...fragments.values()]);
  const wallCells: number[] = [], canyonCells: number[] = [];
  const nearbyFloor = new Uint8Array(count);
  for (let cell = 0; cell < count; cell++) if (floor[cell]) {
    canyonCells.push(cell); visitSquare(cell, 3, next => { nearbyFloor[next] = 1; });
  }
  for (let cell = 0; cell < count; cell++) if (nearbyFloor[cell] && affected.has(before.ridge[cell]) && tiles[cell].ridge
    && ridgeIsLedge(world, cell % width, Math.floor(cell / width))) {
    tiles[cell].canyon = 'wall'; wallCells.push(cell); clearVegetation(cell);
  }
  return { canyonCells, wallCells, removedRidgeCells: originalMembers.filter(cell => !tiles[cell].ridge),
    affectedRidges: affected.size, stairs: tiles.reduce((sum, tile, cell) => sum + Number(!!tile.stair && nearbyFloor[cell]), 0) };
}
