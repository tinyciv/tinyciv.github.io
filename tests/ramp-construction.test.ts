import { describe, expect, it } from 'vitest';
import { buildAt, moveUnit, validateBuildAt } from '../src/game/simulation';
import { ensureBuilders, updateBuilder } from '../src/game/builders';
import { canWalk, hasStaticPath } from '../src/game/pathfinding';
import { updateConstruction } from '../src/game/structures';
import type { GameState } from '../src/game/types';

function fixture(): GameState {
  const state: GameState = {
    world: { width: 28, height: 24, seed: 'ramp-build', source: 'test', spawns: [],
      tiles: Array.from({ length: 28 * 24 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 10, y: 3, hp: 650, maxHp: 650, capacity: 4, unhousedResidents: 4 }],
    units: [{ id: 2, kind: 'leader', faction: 0, x: 14.5, y: 5.5, hp: 100, maxHp: 100, morale: 100,
      attack: 25, defense: 5, speed: 3.6, range: 4, order: 'hold', cooldown: 100,
      lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Home', color: '#d94d4d', affinity: 100, relation: 'self', population: 4,
      food: 100, gold: 1000, production: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: null,
    selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'ramp-build', rngState: 1,
  };
  for (let y = 8; y <= 16; y++) for (let x = 9; x <= 17; x++) state.world.tiles[y * 28 + x].ridge = 1;
  state.world.tiles[8 * 28 + 13].stair = 'south';
  return state;
}
describe('construction may block stair access', () => {
  it.each([7, 8, 9])('constructs a palisade at ramp/landing row %s and blocks its former route', y => {
    const state = fixture(), low = { x: 13.5, y: 6.5 }, high = { x: 13.5, y: 11.5 };
    expect(hasStaticPath(state, low, high, 0)).toBe(true);
    expect(validateBuildAt(state, 'palisade', 13, y)).toMatchObject({ ok: true });
    expect(buildAt(state, 'palisade', 13, y)).toMatchObject({ ok: true });
    const wall = state.buildings.find(building => building.kind === 'palisade')!;
    for (let step = 0; step < 900 && wall.construction; step++) {
      state.time += .1; updateConstruction(state); ensureBuilders(state);
      for (const builder of state.units) if (builder.builder && builder.hp > 0) updateBuilder(state, builder, .1, moveUnit);
    }
    expect(wall.construction).toBeUndefined();
    expect(canWalk(state, 13.5, y + .5, 0)).toBe(false);
    expect(hasStaticPath(state, low, high, 0)).toBe(false);
  });
  it('still rejects cliff faces', () => {
    expect(validateBuildAt(fixture(), 'palisade', 12, 8)).toMatchObject({ ok: false, message: 'Build on one level and leave cliff faces clear.' });
  });
});
