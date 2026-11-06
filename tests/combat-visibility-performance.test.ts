import { entityStore } from '../src/game/entity-store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fog from '../src/game/fog';
import { updateGame } from '../src/game/simulation';
import { scenario } from '../dev/navigation-lab/scenarios';
import type { Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
afterEach(() => vi.restoreAllMocks());

function fixture(enemies: number, aggressive = false) {
  const state = scenario('Open melee'), leader = state.units[0];
  const defender: Unit = { ...leader, id: 100, kind: 'warrior', x: 16.5, y: 12.5,
    order: aggressive ? 'follow' : 'hold', retinueStance: aggressive ? 'aggressive' : undefined,
    range: 1.1, attack: 0, speed: 0 };
  entityStore(state).units.replace([leader, defender]);
  state.marauderPacks = [];
  for (let i = 0; i < enemies; i++) entityStore(state).units.add({ ...defender,
    id: 200 + i, faction: -2, x: 19.5 + i % 4 * .25, y: 11.5 + Math.floor(i / 4) * .25,
    order: 'hold', retinueStance: undefined });
  return state;
}

/** entityVisible calls updateFog internally; imported updateFog calls represent
 * the direct batch refreshes and the normal end-of-update refresh. */
function fogValidations(state: ReturnType<typeof fixture>): number {
  const entities = vi.spyOn(fog, 'entityVisible'), refreshes = vi.spyOn(fog, 'updateFog');
  updateGame(state, .1, idle);
  const count = entities.mock.calls.length + refreshes.mock.calls.length;
  entities.mockRestore(); refreshes.mockRestore();
  return count;
}

describe('combat visibility query cost', () => {
  it('does not prepare fog for idle candidate searches without enemies', () => {
    const small = fixture(0), large = fixture(0);
    for (let i = 0; i < 24; i++) entityStore(large).units.add({ ...large.units[1], id: 300 + i,
      x: 12.5 + i % 6, y: 12.5 + Math.floor(i / 6) });
    expect(fogValidations(large)).toBe(fogValidations(small));
  });

  it('bounds morale fog validation by the observing unit, not nearby enemy count', () => {
    expect(fogValidations(fixture(16))).toBe(fogValidations(fixture(1)));
  });

  it('bounds target acquisition and approach fog validation as candidates increase', () => {
    const small = fixture(1, true), large = fixture(16, true);
    const smallCount = fogValidations(small), largeCount = fogValidations(large);
    expect(small.units[1].target).toBe(200);
    expect(large.units[1].target).toBeDefined();
    expect(largeCount).toBeLessThanOrEqual(smallCount + 1);
    expect(largeCount).toBeLessThan(10);
  });
});
