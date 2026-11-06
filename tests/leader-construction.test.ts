import { entityStore } from '../src/game/entity-store';
import { unlockBuildingResearch } from './helpers/research';
import { describe, expect, it } from 'vitest';
import { BUILD_COSTS, buildAt, updateGame, validateBuildAt } from '../src/game/simulation';
import { buildStroke, constructionLine, planConstruction } from '../src/game/construction';
import { CONSTRUCTION_SECONDS } from '../src/game/structures';
import { canWalk } from '../src/game/pathfinding';
import { isExplored, isVisible, updateFog } from '../src/game/fog';
import { insideOwnBorders } from '../src/game/borders';
import { isPendingCampField } from '../src/game/farms';
import type { Building, GameState } from '../src/game/types';

function fixture(): GameState {
  const state: GameState = {
    world: { width: 32, height: 24, seed: 'manual-build', source: 'test', spawns: [], tiles: Array.from({ length: 768 }, () =>
      ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 6, y: 10, hp: 650, maxHp: 650, capacity: 0 }],
    units: [{ id: 2, kind: 'leader', faction: 0, x: 14.5, y: 12.5, hp: 100, morale: 100, attack: 25, defense: 5,
      speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 500, production: 500,
      population: 4, culture: 10000, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 10000, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: 2, selectedType: 'unit',
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'manual-build', rngState: 1,
    marauderPacks: [], fogRaids: { nextAt: 10000, waves: 0, pressureVersion: 1 },
  };
  state.factions.forEach(unlockBuildingResearch);
  updateFog(state); return state;
}
function extra(state: GameState, kind: Building['kind'], x: number, y: number): Building {
  const b: Building = { id: state.buildings.length + 100, kind, faction: 0, x, y, hp: 100, maxHp: 100, capacity: 0 };
  entityStore(state).buildings.add(b); return b;
}

describe('Leader construction', () => {
  it('charges gold and queues four seconds of work for a wall', () => {
    const state = fixture(), before = state.factions[0].gold;
    expect(buildAt(state, 'wall', 12, 10).ok).toBe(true);
    const fence = state.buildings.at(-1)!;
    expect(before - state.factions[0].gold).toBe(BUILD_COSTS.wall.gold);
    expect(BUILD_COSTS.wall).toEqual({ gold: 30, food: 0, production: 0 });
    expect(CONSTRUCTION_SECONDS.wall).toBe(4);
    expect(fence).toMatchObject({ kind: 'wall', x: 12, y: 10, maxHp: 2250, armor: 2 });
    expect(fence.construction).toMatchObject({ duration: CONSTRUCTION_SECONDS.wall, waitingForBuilder: true });
    expect(state.units.some(unit => unit.builder && unit.home === 1)).toBe(true);
    expect(canWalk(state, 12.5, 10.5, 0)).toBe(true);
  });

  it.each([['wall', 'road'], ['road', 'wall']] as const)('layers %s then %s into open ground while queued and friendly gates once complete', (first, second) => {
    const state = fixture(), line = constructionLine({ x: 12, y: 9 }, { x: 15, y: 9 });
    extra(state, 'road', 11, 9);
    expect(buildStroke(state, first, line).placed).toBe(4);
    expect(buildStroke(state, second, line).placed).toBe(2);
    expect(state.factions[0].gold).toBe(second === 'wall' ? 432 : 376);
    expect(canWalk(state, 12.5, 9.5, 0)).toBe(true);
    for (const b of state.buildings) delete b.construction;
    expect(canWalk(state, 12.5, 9.5, 0)).toBe(true);
    for (const faction of [1, -2]) expect(canWalk(state, 12.5, 9.5, faction)).toBe(false);
    state.buildings.find(b => b.kind === 'road' && b.x === 12)!.hp = 0;
    expect(canWalk(state, 12.5, 9.5, 0)).toBe(false);
  });

  it('orders a farm, reserves its single field, and sends a palace peasant to finish it', () => {
    const state = fixture();
    extra(state, 'road', 8, 10);
    expect(buildAt(state, 'camp', 13, 8).ok).toBe(true);
    const camp = state.buildings.at(-1)!;
    expect(camp.capacity).toBe(0);
    expect(state.fields).toHaveLength(0);
    expect(isPendingCampField(state, 13, 8)).toBe(true);
    expect(isPendingCampField(state, 14, 9)).toBe(false);
    expect(validateBuildAt(state, 'house', 13, 8).ok).toBe(false);
    for (let t = 0; t < 290; t++) updateGame(state, .1, { up: false, down: false, left: false, right: false });
    expect(camp.construction).toBeUndefined();
    expect(state.fields!.filter(field => field.camp === camp.id)).toHaveLength(1);
    expect(state.fields!.filter(field => field.camp === camp.id && field.planted)).toHaveLength(1);
    expect(state.buildings.some(b => b.kind === 'road')).toBe(true);
  });

  it.each(['water', 'enemy road', 'farm', 'house'] as const)('rejects farms with an occupied or wet plot: %s', reason => {
    const state = fixture();
    if (reason === 'water') state.world.tiles[8 * 32 + 13].terrain = 'lake';
    if (reason === 'enemy road') extra(state, 'road', 13, 8).faction = -2;
    if (reason === 'farm') extra(state, 'camp', 13, 8);
    if (reason === 'house') extra(state, 'house', 13, 8);
    const before = state.factions[0].gold;
    expect(buildAt(state, 'camp', 13, 8).ok).toBe(false);
    expect(state.factions[0].gold).toBe(before);
  });

  it('reserves a single farm tile entirely hidden in fog', () => {
    const state = fixture(); state.factions[0].culture = 0;
    state.units[0].x = 7.5; state.units[0].y = 8.5; updateFog(state);
    expect(insideOwnBorders(state, 0, 15.5, 5.5)).toBe(false);
    expect(isVisible(state, 15.5, 5.5)).toBe(true);
    expect(isVisible(state, 16.5, 6.5)).toBe(false);
    expect(buildAt(state, 'camp', 16, 6).ok).toBe(true);
    expect(state.factions[0].gold).toBe(500 - BUILD_COSTS.camp.gold);
    expect(isPendingCampField(state, 16, 6)).toBe(true);
    expect(isVisible(state, 16.5, 6.5)).toBe(false);
  });

  it.each(['camp', 'palace', 'road', 'bridge'] as const)('allows an entirely unexplored %s placement without revealing it', kind => {
    const state = fixture(); state.factions[0].culture = 0;
    delete state.fog;
    if (kind === 'road') extra(state, 'road', 23, 12);
    if (kind === 'bridge') state.world.tiles[12 * 32 + 24].terrain = 'river';
    expect(isVisible(state, 24.5, 12.5)).toBe(false);
    expect(isExplored(state, 24.5, 12.5)).toBe(false);
    expect(validateBuildAt(state, kind, 24, 12)).toMatchObject({ ok: true, message: '' });
    expect(buildStroke(state, kind, [{ x: 24, y: 12 }])).toMatchObject({ ok: true, placed: 1 });
    expect(state.buildings.some(building => building.kind === kind && building.x === 24 && building.y === 12 && building.construction)).toBe(true);
    expect(isVisible(state, 24.5, 12.5)).toBe(false);
    expect(isExplored(state, 24.5, 12.5)).toBe(false);
  });

  it('fills adjoining and sealed parcels while rejecting occupied sites', () => {
    const state = fixture();
    state.factions[0].gold = 5000;
    for (const x of [11, 12, 13, 14]) expect(buildAt(state, 'house', x, 8).ok).toBe(true);
    expect(buildAt(state, 'house', 15, 8).ok).toBe(true);
    expect(validateBuildAt(state, 'house', 15, 8).ok).toBe(false);
    expect(buildAt(state, 'house', 11, 9).ok).toBe(true);
    expect(buildAt(state, 'house', 11, 10).ok).toBe(true);
    for (const [x, y] of [[18, 7], [20, 7], [19, 6], [19, 8]]) extra(state, 'wall', x, y);
    expect(validateBuildAt(state, 'house', 19, 7).ok).toBe(true);
    expect(validateBuildAt(state, 'wall', 12, 7).ok).toBe(true);
    expect(validateBuildAt(state, 'woodenTower', 12, 7).ok).toBe(false);
    expect(state.buildings.filter(b => b.kind === 'house').every(b => b.capacity === 2 && b.construction?.waitingForBuilder
      && b.construction.paidGold === 62.5 && b.construction.duration === 40 / 3)).toBe(true);
  });

  it('allows detached manual houses within borders while enforcing the Leader’s 10-tile range', () => {
    const state = fixture(), point = { x: 9, y: 9 };
    extra(state, 'house', 2, 10);
    state.units[0].x = 19.51; state.units[0].y = 9.5;
    delete state.fog;
    expect(insideOwnBorders(state, 0, point.x + .5, point.y + .5)).toBe(true);
    const before = JSON.stringify(state);
    expect(planConstruction(state, 'house', [point])).toMatchObject({ ok: false, tiles: [] });
    expect(buildAt(state, 'house', point.x, point.y)).toEqual({ ok: false, message: 'Build within 10 tiles of your leader.' });
    expect(JSON.stringify(state)).toBe(before);
    // At exactly ten tiles, no adjacent house or connection is needed.
    state.units[0].x = 19.5;
    const inRange = JSON.stringify(state);
    expect(planConstruction(state, 'house', [point])).toMatchObject({ ok: true, tiles: [point] });
    expect(JSON.stringify(state)).toBe(inRange);
    expect(buildAt(state, 'house', point.x, point.y).ok).toBe(true);
    expect(state.factions[0].gold).toBe(500 - BUILD_COSTS.house.gold);
    expect(state.buildings.at(-1)).toMatchObject({ kind: 'house', ...point, construction: { waitingForBuilder: true } });
  });

  it.each(['house', 'wall'] as const)('allows a manual %s next to a foreign structure inside owned borders', kind => {
    const state = fixture();
    state.factions.push({ ...state.factions[0], id: 1, relation: 'war', culture: 0 });
    const foreignPost = extra(state, 'guardPost', 12, 10); foreignPost.faction = 1;
    expect(insideOwnBorders(state, 0, 11.5, 10.5)).toBe(true);
    const before = JSON.stringify(state), gold = state.factions[0].gold;
    expect(validateBuildAt(state, kind, 11, 10)).toEqual({ ok: true, message: '' });
    expect(JSON.stringify(state)).toBe(before);
    expect(buildAt(state, kind, 11, 10).ok).toBe(true);
    expect(state.factions[0].gold).toBe(gold - BUILD_COSTS[kind].gold);
    expect(state.buildings.at(-1)).toMatchObject({ kind, faction: 0, x: 11, y: 10, construction: { waitingForBuilder: true } });
    expect(foreignPost.faction).toBe(1);
  });

  it.each(['forest', 'jungle', 'swamp'] as const)('clears %s under a manually placed house', overlay => {
    const state = fixture(), tile = state.world.tiles[9 * 32 + 9];
    tile.overlay = overlay; state.world.revision = 1;
    expect(validateBuildAt(state, 'house', 9, 9).ok).toBe(true);
    expect(tile.overlay).toBe(overlay);
    expect(buildAt(state, 'house', 9, 9).ok).toBe(true);
    expect(tile.overlay).toBe('none');
  });

  it.each(['water', 'ledge', 'occupied', 'outside borders'] as const)('still rejects physically invalid or unowned house sites: %s', reason => {
    const state = fixture(), point = reason === 'outside borders' ? { x: 31, y: 0 } : { x: 9, y: 9 };
    state.units[0].x = point.x + .5; state.units[0].y = point.y + .5;
    const tile = state.world.tiles[point.y * 32 + point.x];
    if (reason === 'water') tile.terrain = 'lake';
    if (reason === 'ledge') tile.ridge = 1;
    if (reason === 'occupied') extra(state, 'wall', point.x, point.y);
    state.world.revision = 1;
    const before = JSON.stringify(state);
    expect(buildAt(state, 'house', point.x, point.y).ok).toBe(false);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('reserves a walkable tower site under a unit and rejects building overlaps or unaffordable orders', () => {
    const state = fixture();
    expect(buildAt(state, 'woodenTower', 12, 10).ok).toBe(true);
    expect(state.buildings.at(-1)).toMatchObject({ kind: 'woodenTower', maxHp: 600, armor: 6, construction: { duration: 15 } });
    expect(state.factions[0]).toMatchObject({ production: 500, gold: 460 });
    expect(buildAt(state, 'woodenTower', 12, 10).ok).toBe(false);
    expect(buildAt(state, 'woodenTower', 14, 12).ok).toBe(true);
    expect(state.factions[0]).toMatchObject({ production: 500, gold: 420 });
    // Placing a stroke must not move the Leader and invalidate its remaining cells.
    expect(state.units[0]).toMatchObject({ x: 14.5, y: 12.5 });
    updateGame(state, .1, { up: false, down: false, left: false, right: false });
    expect(canWalk(state, state.units[0].x, state.units[0].y, 0)).toBe(true);
    expect(state.units[0]).toMatchObject({ x: 14.5, y: 12.5 });
    state.factions[0].gold = 0;
    expect(buildAt(state, 'woodenTower', 13, 10).ok).toBe(false);
  });
});
