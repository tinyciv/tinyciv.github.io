import { entityStore } from '../src/game/entity-store';
import { unlockBuildingResearch } from './helpers/research';
import { describe, expect, it } from 'vitest';
import { buildAt, BUILD_COSTS, cancelConstruction, moveUnit, updateGame, validateBuildAt } from '../src/game/simulation';
import { ensureBuilders, updateBuilder } from '../src/game/builders';
import { canWalk } from '../src/game/pathfinding';
import { updateConstruction } from '../src/game/structures';
import { updateFog } from '../src/game/fog';
import { canShareWallTowerTile, sharedTowerForWall, sharedWallForTower } from '../src/game/wall-towers';
import type { Building, GameState, Unit } from '../src/game/types';

const target = { x: 12, y: 8 };
const idle = { up: false, down: false, left: false, right: false };
function fixture(): GameState {
  const state: GameState = {
    world: { width: 32, height: 24, seed: 'wall-tower-sharing', source: 'test', spawns: [], tiles: Array.from({ length: 768 }, () =>
      ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 6, y: 10, hp: 650, maxHp: 650, capacity: 0 }],
    units: [{ id: 2, kind: 'leader', faction: 0, x: 14.5, y: 12.5, hp: 100, morale: 100, attack: 25, defense: 5,
      speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 1000, production: 0,
      population: 30, culture: 10000, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 10000, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: 2, selectedType: 'unit',
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'wall-tower-sharing', rngState: 1,
    marauderPacks: [], fogRaids: { nextAt: 10000, waves: 0, pressureVersion: 1 },
  };
  state.factions.forEach(unlockBuildingResearch);
  updateFog(state); return state;
}
function add(state: GameState, kind: Building['kind'], changes: Partial<Building> = {}): Building {
  const tower = kind === 'woodenTower';
  const building: Building = { id: Math.max(...state.buildings.map(b => b.id), ...state.units.map(u => u.id)) + 1,
    kind, faction: 0, ...target, hp: tower ? 600 : 225, maxHp: tower ? 600 : 225, armor: tower ? 6 : 2, capacity: 0, ...changes };
  entityStore(state).buildings.add(building); return building;
}
function advanceUntilComplete(state: GameState, buildings: Building[]): void {
  for (let step = 0; step < 900 && buildings.some(b => b.construction); step++) {
    state.time += .1; updateConstruction(state); ensureBuilders(state);
    for (const unit of state.units) if (unit.builder && unit.hp > 0) updateBuilder(state, unit, .1, moveUnit);
  }
  expect(buildings.every(b => !b.construction)).toBe(true);
}
const opponent = (): Unit => ({ id: 200, kind: 'warrior', faction: -2, x: 16.5, y: 8.5, hp: 100, maxHp: 100,
  morale: 100, attack: 0, defense: 4, speed: 0, range: 1, order: 'hold', cooldown: 0, lastCombat: -60,
  moving: false, facing: 0, attackTime: 0 });

describe('walls and defensive towers sharing a tile', () => {
  it.each(['wall', 'woodenTower'] as const)('orders %s first and completes both independent structures with real builders', first => {
    const state = fixture(), second = first === 'wall' ? 'woodenTower' : 'wall', before = state.factions[0].gold;
    expect(buildAt(state, first, target.x, target.y).ok).toBe(true);
    const one = state.buildings.at(-1)!;
    expect(one.construction?.waitingForBuilder).toBe(true);
    expect(buildAt(state, second, target.x, target.y).ok).toBe(true);
    const two = state.buildings.at(-1)!;
    expect(two.id).not.toBe(one.id);
    expect(state.factions[0].gold).toBe(before - BUILD_COSTS.wall.gold - BUILD_COSTS.woodenTower.gold);
    expect([one, two].map(b => b.construction?.paidGold)).toEqual([BUILD_COSTS[first].gold, BUILD_COSTS[second].gold]);
    advanceUntilComplete(state, [one, two]);
    expect(canWalk(state, target.x + .5, target.y + .5, 0)).toBe(false);
    const tower = first === 'woodenTower' ? one : two, wall = first === 'wall' ? one : two;
    expect(tower).toMatchObject({ hp: 6000, maxHp: 6000, armor: 6 });
    expect(wall).toMatchObject({ hp: 2250, maxHp: 2250, armor: 2 });
    expect(sharedWallForTower(tower, state.buildings)).toBe(wall);
    expect(sharedTowerForWall(wall, state.buildings)).toBe(tower);
  });

  it.each(['wall', 'woodenTower'] as const)('adds a second layer to a completed %s without replacing the existing structure', first => {
    const state = fixture(), existing = add(state, first, { hp: 100 }), second = first === 'wall' ? 'woodenTower' : 'wall';
    expect(buildAt(state, second, target.x, target.y).ok).toBe(true);
    expect(existing.hp / existing.maxHp).toBeCloseTo(100 / (first === 'wall' ? 225 : 600)); // Preserve the fraction already wounded.
    const ordered = state.buildings.at(-1)!;
    advanceUntilComplete(state, [ordered]);
    expect(existing.hp).toBeGreaterThanOrEqual(100); // Existing palace repair workers may repair it.
    expect(existing.maxHp).toBe(first === 'wall' ? 2250 : 6000);
    expect(existing.construction).toBeUndefined();
    expect(state.buildings).toContain(existing); expect(state.buildings).toContain(ordered);
  });

  it.each(['wall', 'woodenTower'] as const)('allows sharing an actively constructed %s', first => {
    const state = fixture(); add(state, first, { construction: { startedAt: 0, duration: 20, waitingForBuilder: false, cleared: true } });
    expect(validateBuildAt(state, first === 'wall' ? 'woodenTower' : 'wall', target.x, target.y).ok).toBe(true);
  });

  it.each(['wall', 'woodenTower'] as const)('canceling a %s order preserves its partner and solid footprint', kind => {
    const state = fixture(), existing = add(state, kind === 'wall' ? 'woodenTower' : 'wall'), gold = state.factions[0].gold;
    expect(buildAt(state, kind, target.x, target.y).ok).toBe(true);
    const order = state.buildings.at(-1)!;
    expect(cancelConstruction(state, order.id)).toEqual({ ok: true, refund: BUILD_COSTS[kind].gold });
    expect(state.buildings).toContain(existing); expect(state.buildings).not.toContain(order);
    expect(state.factions[0].gold).toBe(gold);
    expect(canWalk(state, target.x + .5, target.y + .5, 0)).toBe(false);
  });

  it.each(['wall', 'woodenTower'] as const)('can replace a destroyed %s without damaging the surviving layer', kind => {
    const state = fixture(), dead = add(state, kind), survivor = add(state, kind === 'wall' ? 'woodenTower' : 'wall');
    dead.hp = 0;
    expect(canWalk(state, target.x + .5, target.y + .5, 0)).toBe(false);
    expect(buildAt(state, kind, target.x, target.y).ok).toBe(true);
    expect(state.buildings.filter(b => b.kind === kind && b.hp > 0)).toHaveLength(1);
    expect(survivor.hp).toBe(survivor.maxHp);
  });

  it.each(['wall', 'woodenTower'] as const)('rejects duplicate %s orders without charging gold', kind => {
    const state = fixture(); add(state, 'wall'); add(state, 'woodenTower', { construction: { startedAt: 0, duration: 15, waitingForBuilder: true } });
    const count = state.buildings.length, gold = state.factions[0].gold;
    expect(buildAt(state, kind, target.x, target.y)).toEqual({ ok: false, message: 'Tile occupied.' });
    expect(state.buildings).toHaveLength(count); expect(state.factions[0].gold).toBe(gold);
  });

  it.each(['wall', 'woodenTower'] as const)('rejects sharing an enemy %s', existingKind => {
    const state = fixture(); add(state, existingKind, { faction: 1 });
    expect(validateBuildAt(state, existingKind === 'wall' ? 'woodenTower' : 'wall', target.x, target.y))
      .toEqual({ ok: false, message: 'Tile occupied.' });
  });

  it('keeps every unrelated structure and a second layer in an adjacent tile independent', () => {
    for (const kind of ['house', 'well', 'monument', 'palace'] as const) {
      const state = fixture(); add(state, kind);
      expect(validateBuildAt(state, 'woodenTower', target.x, target.y).ok).toBe(false);
    }
    const state = fixture(), wall = add(state, 'wall'), tower = add(state, 'woodenTower', { x: target.x + 1 });
    expect(canShareWallTowerTile(wall, tower)).toBe(false);
    expect(sharedWallForTower(tower, state.buildings)).toBeUndefined();
  });

  it.each([undefined, { startedAt: 0, duration: 2, waitingForBuilder: true }, { startedAt: 0, duration: 2, waitingForBuilder: false }] as const)
    ('keeps completed and ordered gate passages free of towers (%j)', construction => {
      const state = fixture(); add(state, 'wall'); add(state, 'road', { construction });
      expect(validateBuildAt(state, 'woodenTower', target.x, target.y)).toEqual({ ok: false, message: 'Towers need a solid wall section, not a gate.' });
      entityStore(state).buildings.replace(state.buildings.filter(b => b.kind !== 'wall'));
      add(state, 'woodenTower', { construction: { startedAt: 0, duration: 15, waitingForBuilder: true } });
      expect(validateBuildAt(state, 'wall', target.x, target.y)).toEqual({ ok: false, message: 'Towers need a solid wall section, not a gate.' });
    });

  it('prevents a road from opening a gate beneath an existing wall-mounted tower', () => {
    const state = fixture(); add(state, 'wall'); add(state, 'woodenTower'); add(state, 'road', { x: target.x - 1 });
    expect(validateBuildAt(state, 'road', target.x, target.y)).toEqual({ ok: false, message: 'Tile occupied.' });
  });

  it('still permits a standalone tower to replace an ordinary road', () => {
    const state = fixture(), road = add(state, 'road');
    expect(buildAt(state, 'woodenTower', target.x, target.y).ok).toBe(true);
    const tower = state.buildings.at(-1)!; expect(state.buildings).toContain(road);
    advanceUntilComplete(state, [tower]); expect(state.buildings).not.toContain(road);
  });

  it('permits standalone and wall-mounted towers beside a house while retaining their price and footprint checks', () => {
    const state = fixture(); add(state, 'house', { x: target.x - 1 });
    expect(validateBuildAt(state, 'woodenTower', target.x, target.y).ok).toBe(true);
    expect(validateBuildAt(state, 'woodenTower', target.x - 1, target.y)).toEqual({ ok: false, message: 'Tile occupied.' });
    add(state, 'wall'); expect(validateBuildAt(state, 'woodenTower', target.x, target.y).ok).toBe(true);
    state.factions[0].gold = 39;
    expect(validateBuildAt(state, 'woodenTower', target.x, target.y).message).toBe('Need 40 gold.');
  });

  it('fires normally from a wall-mounted tower', () => {
    const state = fixture(), tower = add(state, 'woodenTower'); add(state, 'wall'); entityStore(state).units.add(opponent());
    updateGame(state, .1, idle);
    expect(state.projectiles?.some(shot => shot.attacker === tower.id && shot.target === 200)).toBe(true);
  });

  it('keeps other wall-mounted towers as ranged obstructions', () => {
    const state = fixture(), shooter = add(state, 'woodenTower'); add(state, 'wall');
    add(state, 'woodenTower', { x: 14, attackCooldown: 99 }); add(state, 'wall', { x: 14 }); entityStore(state).units.add(opponent());
    updateGame(state, .1, idle);
    expect(state.projectiles?.some(shot => shot.attacker === shooter.id)).toBeFalsy();
  });
});
