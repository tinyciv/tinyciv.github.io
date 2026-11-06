import { entityStore } from '../src/game/entity-store';
import { expect, it } from 'vitest';
import { scenario } from '../dev/navigation-lab/scenarios';
import { createReachabilityQuery } from '../src/game/pathfinding';

it('rejects a large encircled combat area without flooding the continent', () => {
  const state = scenario('Open melee');
  state.world.width = 120; state.world.height = 100;
  state.world.tiles = Array.from({ length: 12000 }, () => ({ terrain: 'plains' as const, overlay: 'none' as const, elevation: 0, moisture: .5, food: 1, production: 1, gold: 0, variation: 0 }));
  entityStore(state).buildings.replace([]);
  let probes = 0;
  const occupied = { has: (cell: number) => {
    probes++;
    const x = cell % 120, y = Math.floor(cell / 120);
    return ((x === 30 || x === 55) && y >= 30 && y <= 55) || ((y === 30 || y === 55) && x >= 30 && x <= 55);
  } };
  const reaches = createReachabilityQuery(state, { x: 5.5, y: 5.5 }, 0, occupied);
  expect(reaches({ x: 40.5, y: 40.5 })).toBe(false);
  expect(probes).toBeLessThan(5000);
  expect(reaches({ x: 8.5, y: 8.5 })).toBe(true);
  expect(reaches({ x: 50.5, y: 50.5 })).toBe(false);
});
