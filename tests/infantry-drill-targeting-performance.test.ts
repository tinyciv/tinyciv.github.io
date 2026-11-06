import { describe, expect, it, vi } from 'vitest';
import { scoutRealm } from './helpers/scouts';
import { entityStore } from '../src/game/entity-store';
import { toggleInfantryFormation } from '../src/game/infantry-drill';
import { updateGame } from '../src/game/simulation';
import * as navigation from '../src/game/pathfinding';
import * as engagement from '../src/game/engagement';
import { distance, type Building, type GameState, type Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
function advance(state: GameState, seconds: number): void {
  for (let elapsed = 0; elapsed < seconds - 1e-7; elapsed += .05) updateGame(state, .05, idle);
}
function fixture(count: number, targetKind: 'house' | 'wall') {
  const state = scoutRealm(), leader = state.units[0], template = state.units[1], { width } = state.world;
  Object.assign(leader, { x: 20.5, y: 18.5, facing: 0, attack: 0, range: 4 });
  for (let cell = 0; cell < state.world.tiles.length; cell++)
    state.world.tiles[cell].terrain = Math.floor(cell / width) === 18 ? 'grassland' : 'lake';
  const targets: Building[] = [];
  for (let x = 10; x <= 32; x++) {
    state.world.tiles[17 * width + x].terrain = 'grassland';
    targets.push({ id: 2000 + x, kind: targetKind, faction: -2, x, y: 17, hp: 1000000, maxHp: 1000000, capacity: 0 });
  }
  // Actual enemy buildings retain ownership of the nearby wall sections.
  if (targetKind === 'wall') for (const x of [12, 20, 28]) {
    state.world.tiles[16 * width + x].terrain = 'grassland';
    targets.push({ id: 3000 + x, kind: 'house', faction: -2, x, y: 16, hp: 1000000, maxHp: 1000000, capacity: 0 });
  }
  for (let y = 2; y <= 3; y++) for (let x = 2; x <= 3; x++) state.world.tiles[y * width + x].terrain = 'grassland';
  entityStore(state).buildings.replace([{ id: 100, kind: 'palace', faction: 0, x: 2, y: 2,
    hp: 650, maxHp: 650, capacity: 4, governorPermissions: { farms: false, housing: false } }, ...targets]);
  const soldiers: Unit[] = Array.from({ length: count }, (_, index) => ({ ...template, id: index + 2,
    x: leader.x + (index - (count - 1) / 2) * .4, y: leader.y,
    kind: 'warrior', attack: 10, speed: 3.3, range: 1.1, lastCombat: -100, cooldown: 0 }));
  entityStore(state).units.replace([leader, ...soldiers]);
  state.factions[0].research!.levels.infantryDrill = 1;
  expect(toggleInfantryFormation(state).ok).toBe(true);
  return { state, soldiers, targets: targets.filter(building => building.kind === targetKind && building.y === 17) };
}

describe('stationary formation target acquisition cost', () => {
  it.each([[12, 'house'], [24, 'house'], [12, 'wall'], [24, 'wall']] as const)(
    '%i formed soldiers attack reachable %s targets in a narrow passage without approach searches', (count, kind) => {
      const { state, soldiers, targets } = fixture(count, kind);
      advance(state, 8);
      expect(soldiers.every(unit => navigation.isNarrowPassage(state, unit, unit.faction))).toBe(true);
      expect(soldiers.some(unit => state.time - unit.lastCombat < 1.2)).toBe(true);
      const positions = soldiers.map(unit => ({ x: unit.x, y: unit.y })), hpBefore = targets.reduce((sum, building) => sum + building.hp, 0);
      const find = vi.spyOn(navigation, 'findPath'), reachable = vi.spyOn(navigation, 'hasStaticPath'), spots = vi.spyOn(engagement, 'attackSpots');
      try {
        advance(state, 3);
        expect(targets.reduce((sum, building) => sum + building.hp, 0)).toBeLessThan(hpBefore);
        soldiers.forEach((unit, index) => expect(distance(unit, positions[index])).toBeLessThan(.001));
        expect(find).not.toHaveBeenCalled();
        expect(reachable).not.toHaveBeenCalled();
        expect(spots).not.toHaveBeenCalled();
      } finally { find.mockRestore(); reachable.mockRestore(); spots.mockRestore(); }
    });
});
