import { describe, expect, it } from 'vitest';
import { GAME_SAVE_VERSION, parseGameSave, serializeGameSave } from '../src/game/game-save';
import { createGame, continueAfterVictory, updateGame } from '../src/game/simulation';
import { generateWorld } from '../src/world/generator';

describe('compact lossless game saves', () => {
  it('round-trips a production world and all gameplay state below the browser save budget', () => {
    const state = createGame(generateWorld('SAVE-COMPACT-PRODUCTION'));
    const metadata = state.world.tiles[0] as unknown as Record<string, unknown>;
    Object.assign(metadata, { arbitraryMetadata: { note: 'grove 🌲', nested: [1, null, false, { a: 1.2345678901234567 }] },
      aTinyNumber: Number.MIN_VALUE, aHugeNumber: Number.MAX_VALUE, omitted: undefined });
    state.factions.slice(1).forEach(faction => { faction.defeated = true; });
    updateGame(state, .1, { up: false, down: false, left: false, right: false });
    expect(continueAfterVictory(state)).toBe(true);
    const serialized = serializeGameSave(state), restored = parseGameSave(serialized);
    const raw = JSON.stringify(state);
    expect(restored).toEqual(JSON.parse(raw));
    expect(restored).toMatchObject({ victory: true, victoryContinued: true, gameOver: false });
    expect(serialized.length).toBeLessThan(4.8 * 1024 * 1024);
  }, 15_000);

  it.each([
    { version: 0 },
    { version: GAME_SAVE_VERSION, tileSchemas: [], tileFloats: '', state: { world: { tiles: [[0, 'grassland']] } } },
    { version: GAME_SAVE_VERSION, tileSchemas: [['terrain']], tileFloats: '', state: { world: { tiles: [[0]] } } },
    { version: GAME_SAVE_VERSION, tileSchemas: [['elevation']], tileFloats: '', state: { world: { tiles: [[0]] } } },
  ])('rejects unsupported or inconsistent terrain encoding', input => {
    expect(() => parseGameSave(JSON.stringify(input))).toThrow();
  });
});
