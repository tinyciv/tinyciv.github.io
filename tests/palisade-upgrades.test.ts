import { describe, expect, it } from 'vitest';
import { buildAt, buildCostAt, cancelConstruction, minimumBuildGold, moveUnit, validateBuildAt } from '../src/game/simulation';
import { buildStroke, planConstruction } from '../src/game/construction';
import { entityStore } from '../src/game/entity-store';
import { updateBuilder } from '../src/game/builders';
import { queueConstruction, updateActiveConstruction } from '../src/game/structures';
import { canWalk } from '../src/game/pathfinding';
import { removeBuildings } from '../src/game/construction-cancellation';
import { palaceEnclosures } from '../src/game/enclosures';
import { buildingReady, type Building, type GameState } from '../src/game/types';

function fixture(): GameState {
  return {
    world: { width: 32, height: 24, seed: 'palisade-upgrade', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: 768 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 3, production: 0, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 6, y: 10, hp: 650, maxHp: 650, capacity: 4,
      unhousedResidents: 20, governorPermissions: { farms: false, housing: false } }],
    units: [{ id: 2, kind: 'leader', faction: 0, x: 11.5, y: 10.5, hp: 100, maxHp: 100, morale: 100,
      attack: 25, defense: 5, speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60,
      moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Roma', color: '#ee3434', affinity: 100, relation: 'self', food: 500, gold: 100,
      production: 0, population: 20, culture: 10000, yields: { food: 0, production: 0, gold: 0 },
      nextRaid: Infinity, defeated: false, research: { focus: 'wall', levels: { woodenTower: 1, wall: 1 }, progress: {} } }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: 2, selectedType: 'unit',
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'palisade-upgrade', rngState: 1,
    marauderPacks: [], raiderCamps: [],
  };
}
function add(state: GameState, kind: Building['kind'], x = 12, y = 10, faction = 0): Building {
  const building: Building = { id: Math.max(...state.buildings.map(b => b.id), ...state.units.map(u => u.id)) + 1,
    kind, x, y, faction, hp: kind === 'palisade' ? 56.25 : 225, maxHp: kind === 'palisade' ? 56.25 : 225, capacity: 0 };
  entityStore(state).buildings.add(building); return building;
}
function upgrade(state: GameState, x = 12, y = 10): Building {
  expect(buildAt(state, 'wall', x, y)).toMatchObject({ ok: true });
  return state.buildings.find(b => b.kind === 'wall' && b.x === x && b.y === y)!;
}
function advance(state: GameState, seconds: number): void {
  for (let step = 0; step < Math.ceil(seconds * 10); step++) {
    state.time += .1;
    for (const unit of state.units) if (unit.builder && unit.hp > 0) updateBuilder(state, unit, .1, moveUnit);
    updateActiveConstruction(state);
  }
}

describe('stone walls replacing palisades', () => {
  it.each([0, -1])('credits the full palisade price and permits a 25-gold order (owner %s)', owner => {
    const state = fixture(), palisade = add(state, 'palisade', 12, 10, owner);
    state.factions[0].gold = 24;
    expect(validateBuildAt(state, 'wall', 12, 10)).toEqual({ ok: false, message: 'Need 25 gold.' });
    state.factions[0].gold = 25;
    const before = JSON.stringify(state);
    expect(buildCostAt(state, 'wall', 12.5, 10.5).gold).toBe(25);
    expect(minimumBuildGold('wall')).toBe(25);
    expect(planConstruction(state, 'wall', [{ x: 12, y: 10 }])).toMatchObject({ ok: true, cost: 25, skipped: 0 });
    expect(JSON.stringify(state)).toBe(before);
    const wall = upgrade(state);
    expect(state.factions[0].gold).toBe(0);
    expect(wall).toMatchObject({ maxHp: 2250, construction: { duration: 4, paidGold: 25, replacesPalisade: palisade.id } });
    expect(state.buildings).toContain(palisade);
    expect(validateBuildAt(state, 'wall', 13, 10).message).toBe('Need 30 gold.');
  });

  it('does not bypass Masonry or allow replacing another faction’s wall', () => {
    const state = fixture(), palisade = add(state, 'palisade');
    state.factions[0].research!.levels.wall = 0;
    expect(validateBuildAt(state, 'wall', 12, 10).message).toContain('Masonry');
    state.factions[0].research!.levels.wall = 1;
    palisade.faction = 1;
    expect(buildCostAt(state, 'wall', 12, 10).gold).toBe(30);
    expect(validateBuildAt(state, 'wall', 12, 10)).toEqual({ ok: false, message: 'Tile occupied.' });
  });

  it('counts a dead palisade as empty ground at the normal stone-wall price', () => {
    const state = fixture(); add(state, 'palisade').hp = 0;
    expect(buildCostAt(state, 'wall', 12, 10).gold).toBe(30);
    expect(upgrade(state).construction?.paidGold).toBe(30);
    expect(state.factions[0].gold).toBe(70);
  });

  it('previews and purchases mixed new, upgraded and existing wall cells once at their actual prices', () => {
    const state = fixture(); add(state, 'palisade'); add(state, 'wall', 14, 10);
    const points = [12, 13, 14].map(x => ({ x, y: 10 }));
    state.factions[0].gold = 55;
    const before = JSON.stringify(state);
    const plan = planConstruction(state, 'wall', [...points, points[0]]);
    expect(plan).toMatchObject({ ok: true, cost: 55, skipped: 0 });
    expect(plan.cells.map(cell => [cell.ok, cell.existing])).toEqual([[true, false], [true, false], [true, true]]);
    expect(JSON.stringify(state)).toBe(before);
    expect(buildStroke(state, 'wall', points)).toMatchObject({ ok: true, placed: 2, skipped: 0 });
    expect(state.factions[0].gold).toBe(0);
    expect(buildStroke(state, 'wall', points)).toMatchObject({ ok: true, placed: 0, skipped: 0 });
    expect(state.factions[0].gold).toBe(0);
  });

  it('skips unaffordable new wall cells while accepting later affordable replacements', () => {
    const state = fixture(); add(state, 'palisade'); add(state, 'palisade', 14, 10);
    state.factions[0].gold = 50;
    const points = [12, 13, 14].map(x => ({ x, y: 10 }));
    expect(planConstruction(state, 'wall', points).cells.map(cell => cell.ok)).toEqual([true, false, true]);
    expect(buildStroke(state, 'wall', points)).toMatchObject({ ok: true, placed: 2, skipped: 1 });
    expect(state.factions[0].gold).toBe(0);
  });

  it('retains existing adjacent gates and their faction passage rules through upgrades', () => {
    const state = fixture();
    const roads = [12, 13].map(x => { add(state, 'palisade', x, 10); return add(state, 'road', x, 10); });
    expect(buildStroke(state, 'wall', [12, 13].map(x => ({ x, y: 10 })))).toMatchObject({ ok: true, placed: 2, skipped: 0 });
    for (const x of [12, 13]) {
      expect(canWalk(state, x + .5, 10.5, 0)).toBe(true);
      expect(canWalk(state, x + .5, 10.5, -2)).toBe(false);
    }
    advance(state, 30);
    expect(state.buildings.filter(b => b.kind === 'wall').every(buildingReady)).toBe(true);
    expect(state.buildings.filter(b => b.kind === 'palisade')).toHaveLength(0);
    for (const road of roads) expect(state.buildings).toContain(road);
    expect(canWalk(state, 12.5, 10.5, 0)).toBe(true);
    expect(canWalk(state, 12.5, 10.5, -2)).toBe(false);
  });

  it('finishes through real builder movement, retaining an attached tower and removing only the old palisade', () => {
    const state = fixture(), palisade = add(state, 'palisade'), tower = add(state, 'woodenTower');
    tower.hp = 123;
    const wall = upgrade(state);
    expect(canWalk(state, 12.5, 10.5, -2)).toBe(false);
    advance(state, 25);
    expect(buildingReady(wall)).toBe(true);
    expect(state.buildings).not.toContain(palisade);
    expect(state.buildings).toContain(tower);
    expect(tower.hp).toBeGreaterThanOrEqual(123);
    expect(wall.maxHp).toBe(2250);
    expect(canWalk(state, 12.5, 10.5, -2)).toBe(false);
  });

  it('keeps a completed defensive ring and its enclosure bonus throughout construction', () => {
    const state = fixture();
    state.units[0].x = 7.5; state.units[0].y = 12.5;
    for (let x = 4; x <= 10; x++) { add(state, 'palisade', x, 8); add(state, 'palisade', x, 14); }
    for (let y = 9; y < 14; y++) { add(state, 'palisade', 4, y); add(state, 'palisade', 10, y); }
    expect(palaceEnclosures(state).regions).toHaveLength(1);
    const wall = upgrade(state, 10, 11);
    for (let step = 0; step < 250 && wall.construction; step++) {
      expect(palaceEnclosures(state).regions).toHaveLength(1);
      advance(state, .1);
    }
    expect(buildingReady(wall)).toBe(true);
    expect(palaceEnclosures(state).regions).toHaveLength(1);
  });

  it('canceling a queued upgrade refunds only the 25-gold order and preserves the palisade', () => {
    const state = fixture(), palisade = add(state, 'palisade'), wall = upgrade(state);
    expect(cancelConstruction(state, wall.id)).toEqual({ ok: true, refund: 25 });
    expect(state.factions[0].gold).toBe(100);
    expect(state.buildings).toContain(palisade);
    expect(state.buildings).not.toContain(wall);
    expect(canWalk(state, 12.5, 10.5, -2)).toBe(false);
  });

  it('canceling work in progress refunds only the unused fraction of the discounted price', () => {
    const state = fixture(), palisade = add(state, 'palisade'), wall = upgrade(state);
    for (let step = 0; step < 200 && wall.construction?.waitingForBuilder; step++) advance(state, .1);
    expect(wall.construction?.waitingForBuilder).toBe(false);
    advance(state, 2);
    const result = cancelConstruction(state, wall.id);
    expect(result).toEqual({ ok: true, refund: 12.5 });
    expect(state.factions[0].gold).toBe(87.5);
    expect(state.buildings).toContain(palisade);
  });

  it('can replace an unfinished palisade and releases its obsolete builder when finished', () => {
    const state = fixture(), palisade = add(state, 'palisade');
    queueConstruction(palisade, state.time, 3, state);
    const wall = upgrade(state);
    advance(state, 30);
    expect(buildingReady(wall)).toBe(true);
    expect(state.buildings).not.toContain(palisade);
    expect(state.units.some(unit => unit.buildSite === palisade.id || unit.repairSite === palisade.id)).toBe(false);
  });

  it('canceling an unfinished source cancels its dependent upgrade rather than leaving a discounted stone wall', () => {
    const state = fixture();
    expect(buildAt(state, 'palisade', 12, 10).ok).toBe(true);
    const palisade = state.buildings.find(b => b.kind === 'palisade')!, wall = upgrade(state);
    expect(state.factions[0].gold).toBe(70);
    expect(cancelConstruction(state, palisade.id)).toEqual({ ok: true, refund: 30 });
    expect(state.factions[0].gold).toBe(100);
    expect(state.buildings).not.toContain(palisade);
    expect(state.buildings).not.toContain(wall);
  });

  it.each([false, true])('does not resurrect a palisade destroyed during the upgrade (cancel: %s)', cancel => {
    const state = fixture(), palisade = add(state, 'palisade'), wall = upgrade(state);
    removeBuildings(state, new Set([palisade.id]));
    if (cancel) expect(cancelConstruction(state, wall.id)).toEqual({ ok: true, refund: 25 });
    else { advance(state, 25); expect(buildingReady(wall)).toBe(true); }
    expect(state.buildings.some(b => b.kind === 'palisade')).toBe(false);
  });
});
