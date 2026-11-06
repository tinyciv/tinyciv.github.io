import { entityStore } from '../src/game/entity-store';
import { unlockBuildingResearch } from './helpers/research';
import { describe, expect, it } from 'vitest';
import { updateBuilder } from '../src/game/builders';
import { canWalk, findPath } from '../src/game/pathfinding';
import { buildAt, updateGame, validateBuildAt } from '../src/game/simulation';
import { updateConstruction } from '../src/game/structures';
import type { GameState, Unit } from '../src/game/types';

function person(kind: 'leader' | 'worker', id: number, x: number, y: number): Unit {
  return { id, kind, faction: 0, x, y, hp: kind === 'worker' ? 50 : 100, maxHp: kind === 'worker' ? 50 : 100,
    morale: 100, attack: kind === 'leader' ? 25 : 0, defense: 0, speed: 3.6, range: 4,
    order: kind === 'leader' ? 'hold' : 'work', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 };
}
function fixture(): GameState {
  const state: GameState = {
    world: { width: 20, height: 20, seed: 'clearance', source: 'test', spawns: [], tiles: Array.from({ length: 400 }, () =>
      ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 2, production: 1, gold: 0, variation: .3 })) },
    units: [person('leader', 2, 8.5, 8.5)],
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 2, y: 5, hp: 650, maxHp: 650, capacity: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 500, production: 500,
      population: 4, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 10000, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: 2, selectedType: 'unit',
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'clearance', rngState: 1,
    marauderPacks: [], fogRaids: { nextAt: 10000, waves: 0, pressureVersion: 1 },
  };
  state.factions.forEach(unlockBuildingResearch);
  return state;
}
const idle = { up: false, down: false, left: false, right: false };

describe('construction around existing units', () => {
  it.each(['leader', 'worker'] as const)('accepts a tower under a %s and leaves it open until the builder arrives', kind => {
    const state = fixture();
    const occupant = kind === 'leader' ? state.units[0] : person('worker', 3, 8.5, 8.5);
    if (kind === 'worker') { state.units[0].x = 7.5; entityStore(state).units.add(occupant); }
    const health = occupant.hp;
    expect(validateBuildAt(state, 'woodenTower', 8, 8).ok).toBe(true);
    expect(buildAt(state, 'woodenTower', 8, 8).ok).toBe(true);
    expect(occupant).toMatchObject({ x: 8.5, y: 8.5, hp: health });
    const site = state.buildings.at(-1)!;
    updateGame(state, .05, idle);
    expect(occupant).toMatchObject({ x: 8.5, y: 8.5 });
    expect(canWalk(state, 8.5, 8.5, 0)).toBe(true);
    const builder = state.units.find(unit => unit.builder)!;
    Object.assign(builder, { x: 9.5, y: 8.5, inside: false, buildSite: site.id, buildPhase: 'outbound' });
    site.construction!.builderId = builder.id;
    updateBuilder(state, builder, .1, () => { throw new Error('Adjacent builder should begin work.'); });
    expect(Math.floor(occupant.x) !== 8 || Math.floor(occupant.y) !== 8).toBe(true);
    expect(canWalk(state, occupant.x, occupant.y, occupant.faction)).toBe(true);
    expect(Math.hypot(occupant.x - 8.5, occupant.y - 8.5)).toBeLessThanOrEqual(1.5);
    expect(occupant.hp).toBe(health);
    expect(site.construction).toMatchObject({ cleared: true, evacuating: false, waitingForBuilder: false });
    expect(canWalk(state, 8.5, 8.5, 0)).toBe(false);
  });

  it('keeps an enclosed occupant on a passable reservation and retries when an exit opens', () => {
    const state = fixture(), occupant = state.units[0];
    for (let y = 7; y <= 9; y++) for (let x = 7; x <= 9; x++)
      if (x !== 8 || y !== 8) state.world.tiles[y * 20 + x].terrain = 'lake';
    expect(buildAt(state, 'woodenTower', 8, 8).ok).toBe(true);
    const site = state.buildings.at(-1)!;
    updateGame(state, .05, idle);
    expect(occupant).toMatchObject({ x: 8.5, y: 8.5 });
    expect(site.construction).toMatchObject({ waitingForBuilder: true });
    expect(site.construction!.cleared).not.toBe(true);
    expect(canWalk(state, 8.5, 8.5, 0)).toBe(true);
    state.time = 100; updateConstruction(state);
    expect(site.construction).toBeDefined();
    expect(occupant).toMatchObject({ x: 8.5, y: 8.5 });
    state.world.tiles[8 * 20 + 9].terrain = 'grassland';
    state.world.revision = (state.world.revision ?? 0) + 1;
    expect(findPath(state, occupant, { x: 9.5, y: 8.5 }, 0)).toEqual([{ x: 9.5, y: 8.5 }]);
    updateConstruction(state);
    expect(occupant).toMatchObject({ x: 8.5, y: 8.5 });
    expect(site.construction).toMatchObject({ waitingForBuilder: true });
    expect(canWalk(state, 8.5, 8.5, 0)).toBe(true);
    expect(canWalk(state, occupant.x, occupant.y, 0)).toBe(true);
  });

  it('does not start builder work while no free exit exists, then starts its full duration after clearance', () => {
    const state = fixture(), occupant = state.units[0];
    for (let y = 7; y <= 9; y++) for (let x = 7; x <= 10; x++)
      if (y !== 8 || x !== 8 && x !== 9) state.world.tiles[y * 20 + x].terrain = 'lake';
    expect(buildAt(state, 'woodenTower', 8, 8).ok).toBe(true);
    const site = state.buildings.at(-1)!, builder = state.units.find(unit => unit.builder)!;
    Object.assign(builder, { x: 9.5, y: 8.5, inside: false, buildSite: site.id, buildPhase: 'outbound' });
    // Peasants and friendly soldiers no longer obstruct the player Leader.
    // A hostile soldier still occupies the only otherwise walkable exit.
    entityStore(state).units.add({ ...person('leader', 900, 9.5, 8.5), kind: 'warrior', faction: -2 });
    site.construction!.builderId = builder.id;
    updateBuilder(state, builder, .1, () => { throw new Error('Adjacent builder should not move.'); });
    expect(site.construction).toMatchObject({ evacuating: true, waitingForBuilder: true, startedAt: 0 });
    expect(builder.buildPhase).toBe('outbound');
    expect(occupant).toMatchObject({ x: 8.5, y: 8.5 });
    state.time = 100;
    state.world.tiles[8 * 20 + 7].terrain = 'grassland';
    state.world.revision = (state.world.revision ?? 0) + 1;
    updateConstruction(state);
    updateBuilder(state, builder, .1, () => { throw new Error('Adjacent builder should start work.'); });
    expect(occupant).toMatchObject({ x: 7.5, y: 8.5 });
    expect(builder.buildPhase).toBe('working');
    expect(site.construction).toMatchObject({ cleared: true, evacuating: false, waitingForBuilder: false, startedAt: 100, duration: 15 });
    state.time = 114.9; updateConstruction(state); expect(site.construction).toBeDefined();
    state.time = 115; updateConstruction(state); expect(site.construction).toBeUndefined();
  });
});
