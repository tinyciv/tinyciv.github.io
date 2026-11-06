import { describe, expect, it, vi } from 'vitest';
import { createSailingConnectivity } from '../src/game/sailing-connectivity';
import type { World } from '../src/game/types';

function waterWorld(width = 8, height = 8): World {
  return { width, height, seed: 'connectivity', source: 'test', spawns: [], tiles: Array.from({ length: width * height }, () =>
    ({ terrain: 'coast', overlay: 'none', elevation: .1, moisture: .5, food: 0, production: 0, gold: 0, variation: 0 })) };
}

describe('sailing connectivity precheck', () => {
  it('rejects separate lakes and reuses the flood for other landing candidates', () => {
    const world = waterWorld(), cell = vi.fn((x: number) => x !== 4);
    const connected = createSailingConnectivity(world, cell);
    expect(connected({x:1.5,y:1.5},{x:6.5,y:6.5})).toBe(false);
    const checks = cell.mock.calls.length;
    expect(connected({x:1.5,y:1.5},{x:6.5,y:5.5})).toBe(false);
    expect(connected({x:1.5,y:1.5},{x:3.5,y:6.5})).toBe(true);
    // A target in the unvisited other lake may be checked once; the first
    // component itself is never searched again for candidate landfalls.
    expect(cell.mock.calls.length - checks).toBeLessThanOrEqual(1);
    expect(connected({x:6.5,y:6.5},{x:7.5,y:1.5})).toBe(true);
  });
  it('does not connect water cells that meet only at a blocked corner', () => {
    const world = waterWorld(3, 3);
    const connected = createSailingConnectivity(world, (x, y) => x === y);
    expect(connected({x:.5,y:.5},{x:1.5,y:1.5})).toBe(false);
  });
  it('rejects out-of-world, blocked and disconnected ledge levels', () => {
    const world = waterWorld();
    for (let y = 0; y < 8; y++) for (let x = 4; x < 8; x++) world.tiles[y*8+x].ridge = 1;
    const connected = createSailingConnectivity(world, (x, y) => x !== 2 || y !== 2);
    expect(connected({x:1.5,y:1.5},{x:-.5,y:1.5})).toBe(false);
    expect(connected({x:1.5,y:1.5},{x:2.5,y:2.5})).toBe(false);
    expect(connected({x:1.5,y:1.5},{x:6.5,y:1.5})).toBe(false);
    expect(connected({x:6.5,y:1.5},{x:6.5,y:6.5})).toBe(true);
  });
  it('a fresh navigation query observes changed waterways', () => {
    const world = waterWorld(); let blocked = true;
    const cell = (x: number) => !blocked || x !== 4;
    expect(createSailingConnectivity(world, cell)({x:1.5,y:1.5},{x:6.5,y:1.5})).toBe(false);
    blocked = false;
    expect(createSailingConnectivity(world, cell)({x:1.5,y:1.5},{x:6.5,y:1.5})).toBe(true);
  });
});
