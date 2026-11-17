import { describe, expect, it, vi } from 'vitest';
import { GAME_SAVE_VERSION, parseGameSave, serializeGameSave, serializeGameSaveAsync } from '../src/game/game-save';
import { markWorldChanged } from '../src/game/world-revisions';
import type { GameState } from '../src/game/types';
import { createGame, continueAfterVictory, migrateGame, updateGame } from '../src/game/simulation';
import { settlementStep } from '../src/game/settlement-step';
import { loyaltyOf, villageStage, villageTreasury } from '../src/game/settlement-bridge';
import { simRandom } from '../src/game/sim-handle';
import { generateWorld } from '../src/world/generator';

/** Saves add the native snapshot (GameState.simCore); live states never hold one. */
function withoutCore(saved: GameState): GameState {
  expect(saved.simCore).toEqual(expect.any(String));
  const { simCore: _core, ...rest } = saved;
  return rest as GameState;
}

describe('compact lossless game saves', () => {
  it('round-trips a production world and all gameplay state without rounding terrain values', () => {
    const state = createGame(generateWorld('SAVE-COMPACT-PRODUCTION'));
    const metadata = state.world.tiles[0] as unknown as Record<string, unknown>;
    Object.assign(metadata, { arbitraryMetadata: { note: 'grove 🌲', nested: [1, null, false, { a: 1.2345678901234567 }] },
      aTinyNumber: Number.MIN_VALUE, aHugeNumber: Number.MAX_VALUE, omitted: undefined });
    state.factions.slice(1).forEach(faction => { faction.defeated = true; });
    updateGame(state, .1, { up: false, down: false, left: false, right: false });
    expect(continueAfterVictory(state)).toBe(true);
    const serialized = serializeGameSave(state), restored = parseGameSave(serialized);
    const raw = JSON.stringify(state);
    // The native core (clock, RNG, settlements) is flushed into the save at the same instant.
    const { simCore, ...rest } = restored;
    expect(simCore).toEqual(expect.any(String));
    expect(rest).toEqual(JSON.parse(raw));
    expect(restored).toMatchObject({ victory: true, victoryContinued: true, gameOver: false });
    // Persistence uses IndexedDB: the larger world intentionally exceeds the
    // former localStorage quota, while retaining its exact numerical values.
    expect(serialized.length).toBeLessThan(raw.length);
  }, 120_000);

  it('restores the native clock and random stream (simCore section 0) so play continues bit-identically', () => {
    const control = createGame(generateWorld('SAVE-SIM-CORE')), idle = { up: false, down: false, left: false, right: false };
    for (let step = 0; step < 40; step++) updateGame(control, .1, idle, { wallNow: 1_000 });
    const loaded = migrateGame(parseGameSave(serializeGameSave(control)));
    expect(loaded.simCore).toBeUndefined();
    expect([loaded.time, loaded.tick, loaded.rngState]).toEqual([control.time, control.tick, control.rngState]);
    expect(control.time).toBeGreaterThan(3.9); expect(control.rngState).not.toBe(0);
    // The restored stream continues exactly where the saved game stopped.
    expect(Array.from({ length: 5 }, () => simRandom(loaded))).toEqual(Array.from({ length: 5 }, () => simRandom(control)));
    expect(loaded.rngState).toBe(control.rngState);
  }, 120_000);

  it('rejects a corrupt native snapshot', () => {
    const state = parseGameSave(serializeGameSave(createGame(generateWorld('SAVE-SIM-CORRUPT'))));
    state.simCore = btoa('not a simulation snapshot');
    expect(() => migrateGame(state)).toThrow('The saved simulation state is invalid.');
  }, 60_000);

  it('saves the settlement engine (simCore section 1) so loaded play continues identically to an unsaved control', () => {
    const control = createGame(generateWorld('SAVE-SETTLEMENTS'));
    const advance = (state: GameState, from: number, to: number) => { for (let time = from + 1; time <= to; time++) { state.time = time; settlementStep(state); } };
    advance(control, 0, 300);
    const loaded = migrateGame(parseGameSave(serializeGameSave(control)));
    expect(GAME_SAVE_VERSION).toBe(8);
    advance(control, 300, 600); advance(loaded, 300, 600);
    const rows = (state: GameState) => (state.villages ?? []).map(village => [villageStage(state, village), villageTreasury(state, village)]);
    expect(rows(loaded)).toEqual(rows(control));
    const palace = control.buildings.find(b => b.kind === 'palace' && b.faction === 0)!;
    expect(loyaltyOf(loaded, loaded.buildings.find(b => b.id === palace.id)!).value).toBe(loyaltyOf(control, palace).value);
  }, 120_000);

  it.each([
    { version: 0 },
    { version: GAME_SAVE_VERSION, terrain: [{ tileSchemas: [], tileFloats: '', tiles: [[0, 'grassland']] }], state: { world: { width: 1, height: 1 } } },
    { version: GAME_SAVE_VERSION, terrain: [{ tileSchemas: [['terrain']], tileFloats: '', tiles: [[0]] }], state: { world: { width: 1, height: 1 } } },
    { version: GAME_SAVE_VERSION, terrain: [{ tileSchemas: [['elevation']], tileFloats: '', tiles: [[0]] }], state: { world: { width: 1, height: 1 } } },
  ])('rejects unsupported or inconsistent terrain encoding', input => {
    expect(() => parseGameSave(JSON.stringify(input))).toThrow();
  });

  it('yields during terrain preparation and captures edits and dynamic state at one final instant', async () => {
    const state = { time: 1, paused: false, world: { width: 32, height: 32, revision: 0, seed: 'async-save',
      tiles: Array.from({ length: 1024 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .12345678901234567 })) },
      factions: [{ gold: 123 }] } as unknown as GameState;
    let clock = 0, yields = 0;
    const timer = vi.spyOn(performance, 'now').mockImplementation(() => clock += 4);
    try {
      const serialized = await serializeGameSaveAsync(state, { yieldTask: async () => {
        if (++yields !== 2) return;
        state.world.tiles[0].overlay = 'forest';
        markWorldChanged(state.world, 'sight', [0]);
        state.time = 2; state.factions[0].gold = 456;
      } });
      expect(yields).toBeGreaterThan(1);
      expect(withoutCore(parseGameSave(serialized))).toEqual(JSON.parse(JSON.stringify(state)));
      // A later autosave encodes changed terrain, retaining untouched chunks.
      state.world.tiles[1000].overlay = 'jungle'; markWorldChanged(state.world, 'sight', [1000]);
      expect(withoutCore(parseGameSave(await serializeGameSaveAsync(state, { incremental: true })))).toEqual(JSON.parse(JSON.stringify(state)));
      // Explicit saves also preserve arbitrary editor changes without a journal entry.
      Object.assign(state.world.tiles[10], { note: 'grove 🌲', extreme: Number.MIN_VALUE });
      expect(withoutCore(parseGameSave(await serializeGameSaveAsync(state)))).toEqual(JSON.parse(JSON.stringify(state)));
    } finally { timer.mockRestore(); }
  });
});
