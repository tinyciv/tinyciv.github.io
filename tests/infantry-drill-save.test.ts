import { describe, expect, it } from 'vitest';
import { scoutRealm } from './helpers/scouts';
import { entityStore } from '../src/game/entity-store';
import { serializeGameSave, parseGameSave } from '../src/game/game-save';
import { infantryFormationActive, toggleInfantryFormation } from '../src/game/infantry-drill';
import { getLeader, updateGame } from '../src/game/simulation';
import type { GameState, InputState } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
function fixture(): GameState {
  const state = scoutRealm();
  for (let id = 6; id <= 9; id++) entityStore(state).units.add({ ...state.units[1], id });
  state.factions[0].research!.levels.infantryDrill = 1;
  state.factions[0].nextRetinueAt = 1e9;
  state.factions[0].nextRaid = 1e9;
  state.fogRaids!.nextAt = 1e9;
  state.wildlife!.nextRespawnAt = 1e9;
  entityStore(state).buildings.replace([{ id: 100, kind: 'palace', faction: 0, x: 2, y: 2,
    hp: 650, maxHp: 650, capacity: 4, governorPermissions: { farms: false, housing: false } }]);
  state.units.forEach((unit, index) => {
    unit.x = 20.5 + (index ? index % 2 ? -1 : 1 : 0);
    unit.y = 18.5 + (index ? index < 3 ? -1 : 1 : 0);
    unit.facing = 0;
  });
  return state;
}
function advance(state: GameState, seconds: number, input: InputState = idle): void {
  for (let elapsed = 0; elapsed < seconds - 1e-7; elapsed += .05) updateGame(state, .05, input);
}

describe('saved Infantry Drill formations', () => {
  it('preserves the chosen heading after save/load without resuming a released rotation key', () => {
    const state = fixture();
    expect(toggleInfantryFormation(state).ok).toBe(true);
    advance(state, 5);
    advance(state, .2, { ...idle, turnRight: true });
    const heading = getLeader(state)!.facing;
    expect(heading).toBeGreaterThan(0);
    expect(heading).toBeLessThan(Math.PI / 2);

    const restored = parseGameSave(serializeGameSave(state));
    expect(infantryFormationActive(restored)).toBe(true);
    expect(getLeader(restored)!.facing).toBeCloseTo(heading, 10);
    advance(restored, 5);
    expect(getLeader(restored)!.facing).toBeCloseTo(heading, 8);
    expect(infantryFormationActive(restored)).toBe(true);

    const start = { x: getLeader(restored)!.x, y: getLeader(restored)!.y };
    advance(restored, .5, { ...idle, left: true });
    expect(getLeader(restored)!.x).toBeGreaterThan(start.x);
    expect(getLeader(restored)!.y).toBeLessThan(start.y);
    const dx = getLeader(restored)!.x - start.x, dy = getLeader(restored)!.y - start.y;
    expect(Math.atan2(dy, dx)).toBeCloseTo(heading - Math.PI / 2, 3);
    expect(getLeader(restored)!.facing).toBeCloseTo(heading, 8);
  });

  it('keeps researched Formation available but switched off after saving a toggle-off', () => {
    const state = fixture();
    expect(toggleInfantryFormation(state).ok).toBe(true);
    advance(state, .1);
    expect(toggleInfantryFormation(state).ok).toBe(true);
    const restored = parseGameSave(serializeGameSave(state));
    advance(restored, .1);
    expect(infantryFormationActive(restored)).toBe(false);
    expect(toggleInfantryFormation(restored).ok).toBe(true);
    expect(infantryFormationActive(restored)).toBe(true);
  });
});
