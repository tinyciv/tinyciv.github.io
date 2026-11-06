import { entityStore } from '../src/game/entity-store';
import { afterEach, expect, it, vi } from 'vitest';
import { scenario } from '../dev/navigation-lab/scenarios';
import { updateGame } from '../src/game/simulation';
import * as engagement from '../src/game/engagement';
import * as navigation from '../src/game/pathfinding';
import type { Unit } from '../src/game/types';

afterEach(() => vi.restoreAllMocks());
it('backs off a failed crowded contact search, then retries on its decision clock', () => {
  const state = scenario('Open melee'), leader = state.units[0];
  leader.x = 16.5; leader.y = 10.5; leader.attack = 0;
  const defender: Unit = { ...leader, id: 100, kind: 'warrior', x: 16.5, y: 12.5, range: 1.1, speed: 0, order: 'follow', retinueStance: 'aggressive' };
  const enemy: Unit = { ...defender, id: 200, faction: -2, x: 19.5, order: 'hold', retinueStance: undefined };
  entityStore(state).units.replace([leader, defender, enemy]); state.marauderPacks = [];
  const claims = vi.spyOn(engagement, 'claimAttackSpot').mockReturnValue(undefined);
  vi.spyOn(navigation, 'findPath').mockReturnValue([]);
  const input = { up: false, down: false, left: false, right: false };
  for (let i = 0; i < 6; i++) updateGame(state, .05, input);
  const attempts = () => claims.mock.calls.filter(call => call[1].id === defender.id).length;
  expect(attempts()).toBe(1);
  updateGame(state, .6, input);
  expect(attempts()).toBe(2);
});
