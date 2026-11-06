import { describe, expect, it, vi } from 'vitest';
import { continueAfterVictory, createGame, getLeader, canRespawnLeader, updateGame, updateLeaderRespawns } from '../src/game/simulation';
import type { GameState } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
function victory(): GameState {
  const state = createGame({ width: 48, height: 32, seed: 'keep-playing', source: 'test',
    spawns: [{ x: 8.5, y: 12.5 }, { x: 35.5, y: 17.5 }],
    tiles: Array.from({ length: 48 * 32 }, () => ({ terrain: 'grassland', overlay: 'none',
      elevation: .4, moisture: .7, food: 2, production: 2, gold: 1, variation: .5 })) });
  state.factions[1].defeated = true;
  updateGame(state, .1, idle);
  expect(state).toMatchObject({ gameOver: true, victory: true });
  state.paused = true;
  return state;
}

describe('continuing a victorious world', () => {
  it('resumes the same settlement and does not repeat victory on following updates', () => {
    const state = victory(), buildings = [...state.buildings], units = [...state.units];
    const treasury = structuredClone(state.factions), world = state.world, time = state.time;
    expect(continueAfterVictory(state)).toBe(true);
    expect(state).toMatchObject({ gameOver: false, paused: false, victory: true, victoryContinued: true });
    expect(state.world).toBe(world);
    expect(state.buildings).toEqual(buildings); expect(state.units).toEqual(units);
    expect(state.factions).toEqual(treasury);
    updateGame(state, 1, idle);
    expect(state.time).toBeCloseTo(time + 1);
    expect(state.gameOver).toBe(false);
    expect(state.events.filter(event => event.text.includes('Victory!'))).toHaveLength(1);
  });

  it('preserves the choice across a save and reload', () => {
    const state = victory(); continueAfterVictory(state);
    const restored: GameState = JSON.parse(JSON.stringify(state));
    const time = restored.time;
    updateGame(restored, .2, idle);
    expect(restored.time).toBeCloseTo(time + .2);
    expect(restored.gameOver).toBe(false);
  });

  it('automatically respawns a fallen Leader after ten seconds without announcing the same victory again', () => {
    const state = victory(); continueAfterVictory(state);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      getLeader(state)!.hp = 0; updateGame(state, .4, idle);
      expect(state).toMatchObject({ gameOver: false, victoryContinued: true });
      expect(state.factions[0].leaderRespawn?.readyAtWallTime).toBe(1_010_000);
      expect(state.events.filter(event => event.text.includes('Victory!'))).toHaveLength(1);
      updateLeaderRespawns(state, 1_009_999); expect(getLeader(state)).toBeUndefined();
      updateLeaderRespawns(state, 1_010_000); updateGame(state, .1, idle);
      expect(getLeader(state)?.hp).toBeGreaterThan(0);
      expect(state).toMatchObject({ gameOver: false, victory: false, victoryContinued: true });
      expect(state.events.filter(event => event.text.includes('Victory!'))).toHaveLength(1);
    } finally { clock.mockRestore(); }
  });

  it('still allows true defeat after the last settlement is lost in a continued world', () => {
    const state = victory(); continueAfterVictory(state);
    for (const building of state.buildings) if (building.kind === 'palace' && building.faction === 0) building.hp = 0;
    updateGame(state, .4, idle);
    expect(state).toMatchObject({ gameOver: true, victory: false, victoryContinued: true });
    expect(canRespawnLeader(state)).toBe(false);
    expect(state.events.filter(event => event.text.includes('Victory!'))).toHaveLength(1);
  });

  it.each(['ongoing', 'defeat'] as const)('does not resume %s through the victory action', mode => {
    const state = victory();
    if (mode === 'ongoing') state.gameOver = false;
    else state.victory = false;
    const before = structuredClone(state);
    expect(continueAfterVictory(state)).toBe(false);
    expect(state).toEqual(before);
  });
});
