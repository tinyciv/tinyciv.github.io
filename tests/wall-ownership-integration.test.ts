import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { demolishBuildingsInArea } from '../src/game/area-tools';
import { canWalk } from '../src/game/pathfinding';
import { updateGame } from '../src/game/simulation';
import type { Building, GameState, Unit } from '../src/game/types';
import { CHECK_INTERVAL } from '../src/game/work-cadence';

const idle = { up: false, down: false, left: false, right: false };
const unit = (id: number, faction: number, x: number, y: number): Unit => ({
  id, kind: 'leader', faction, x, y, hp: 100, maxHp: 100, morale: 100, attack: 0, defense: 5,
  speed: 0, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0,
});
const building = (id: number, kind: Building['kind'], faction: number, x: number, y: number): Building => ({
  id, kind, faction, x, y, hp: 100, maxHp: 100, capacity: kind === 'house' ? 4 : 0,
});
function fixture(): GameState {
  return {
    world: { width: 56, height: 36, seed: 'wall-ownership-integration', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: 56 * 36 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 2, production: 0, gold: 0, variation: .2 })) },
    // Both crowns survive far beyond the wall's local claim radius.
    buildings: [building(1, 'palace', 0, 3, 3), building(2, 'palace', 1, 47, 27)],
    units: [unit(100, 0, 4.5, 6.5), unit(101, 1, 48.5, 30.5)],
    factions: [0, 1].map(id => ({ id, name: `Faction ${id}`, color: '#38f', relation: id === 0 ? 'self' : 'war',
      affinity: 0, food: 500, gold: 0, production: 0, population: 4, culture: 0,
      yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false })),
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], projectiles: [], fields: [],
    selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false,
    seed: 'wall-ownership-integration', rngState: 1, marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1,
    fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 1 }, enemyPressureVersion: 1,
  };
}
function gate(state: GameState, faction: number): { wall: Building; road: Building } {
  const wall = building(10, 'wall', faction, 24, 18), road = building(11, 'road', faction, 24, 18);
  entityStore(state).buildings.add(wall, road); return { wall, road };
}

describe('wall ownership through simulation actions', () => {
  it('claims a gate in the same update that combat destroys its last enemy supporting building', () => {
    const state = fixture(), { wall, road } = gate(state, 1);
    const enemyHouse = building(12, 'house', 1, 26, 18), ownHouse = building(13, 'house', 0, 22, 18);
    entityStore(state).buildings.add(enemyHouse, ownHouse);
    expect(canWalk(state, 24.5, 18.5, 0)).toBe(false);
    expect(canWalk(state, 24.5, 18.5, 1)).toBe(true);
    state.projectiles = [{ x: 27.5, y: 18.5, start: { x: 27.5, y: 18.5 }, end: { x: 26.5, y: 18.5 },
      attacker: 100, target: enemyHouse.id, faction: 0, damage: 1000, elapsed: 0, duration: .1 }];

    updateGame(state, .1, idle);

    expect(state.time).toBeCloseTo(.1);
    expect(enemyHouse.hp).toBe(0);
    expect(wall.faction).toBe(0); expect(road.faction).toBe(0);
    expect(canWalk(state, 24.5, 18.5, 0)).toBe(true);
    expect(canWalk(state, 24.5, 18.5, 1)).toBe(false);
    expect(state.projectiles).toEqual([]);
    expect(state.gameOver).toBe(false);
    expect(state.factions[1].defeated).toBe(false);
  });

  it('neutralizes an unsupported gate immediately after demolition while the game is paused', () => {
    const state = fixture(), { wall, road } = gate(state, 0), well = building(12, 'well', 0, 22, 18);
    entityStore(state).buildings.add(well); state.paused = true;
    expect(canWalk(state, 24.5, 18.5, 1)).toBe(false);

    expect(demolishBuildingsInArea(state, well, well)).toMatchObject({ ok: true, count: 1, refund: 0 });

    expect(state.time).toBe(0); expect(state.paused).toBe(true);
    expect(state.buildings).not.toContain(well);
    expect(wall.faction).toBe(-1); expect(road.faction).toBe(-1);
    expect(canWalk(state, 24.5, 18.5, 0)).toBe(true);
    expect(canWalk(state, 24.5, 18.5, 1)).toBe(true);
    expect(state.gameOver).toBe(false);
  });

  it('claims neutral walls on the update that a nearby supporting building finishes construction', () => {
    const state = fixture(), { wall, road } = gate(state, -1), monument = building(12, 'monument', 0, 22, 18);
    const builder: Unit = { ...unit(102, 0, 22.5, 17.5), kind: 'worker', home: 1, builder: true,
      buildSite: monument.id, buildPhase: 'working', order: 'work', inside: false };
    monument.construction = { startedAt: 0, duration: .2, waitingForBuilder: false, builderId: builder.id, cleared: true };
    entityStore(state).buildings.add(monument); entityStore(state).units.add(builder);

    updateGame(state, .1, idle);
    expect(monument.construction).toBeDefined();
    expect(wall.faction).toBe(-1); expect(road.faction).toBe(-1);
    expect(canWalk(state, 24.5, 18.5, 1)).toBe(true);

    updateGame(state, .1, idle);

    // Completion is detected by the next maintenance sample, then ownership
    // follows in that update rather than requiring another build transaction.
    updateGame(state, CHECK_INTERVAL, idle);
    expect(monument.construction).toBeUndefined();
    expect(wall.faction).toBe(0); expect(road.faction).toBe(0);
    expect(canWalk(state, 24.5, 18.5, 0)).toBe(true);
    expect(canWalk(state, 24.5, 18.5, 1)).toBe(false);
    expect(state.gameOver).toBe(false);
  });
});
