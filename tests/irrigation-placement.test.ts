import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { BUILD_COSTS, buildAt, cancelConstruction, commandAttackAt, moveUnit, updateGame, validateBuildAt } from '../src/game/simulation';
import { demolishBuildingsInArea, demolishIrrigationAt } from '../src/game/area-tools';
import { ensureBuilders, updateBuilder } from '../src/game/builders';
import { synchronizeFarms } from '../src/game/farms';
import { updateFog } from '../src/game/fog';
import { isRaidObjective } from '../src/game/raid-targeting';
import { buildingWithinBorders } from '../src/game/border-placement';
import { updateConstruction } from '../src/game/structures';
import { buildStroke, constructionLine, planConstruction } from '../src/game/construction';
import { canWalk } from '../src/game/pathfinding';
import type { Building, GameState, Unit } from '../src/game/types';

const target = { x: 12, y: 10 }, idle = { up: false, down: false, left: false, right: false };
function fixture(): GameState {
  const state: GameState = {
    world: { width: 32, height: 24, seed: 'irrigation-placement', source: 'test', spawns: [], tiles: Array.from({ length: 768 }, () =>
      ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [
      { id: 1, kind: 'palace', faction: 0, x: 3, y: 10, hp: 650, maxHp: 650, capacity: 0 },
      { id: 2, kind: 'house', faction: 0, x: 3, y: 7, hp: 160, maxHp: 160, capacity: 4, residents: 4 },
    ],
    units: [{ id: 3, kind: 'leader', faction: 0, x: 14.5, y: 10.5, hp: 100, morale: 100, attack: 25, defense: 5,
      speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 2000, production: 0,
      population: 4, culture: 0, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 1e9, defeated: false, research: { focus: 'irrigation', levels: { irrigation: 1 }, progress: {} } }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: 3, selectedType: 'unit',
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'irrigation-placement', rngState: 1,
    projectiles: [], marauderPacks: [], fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 1 }, enemyPressureVersion: 1,
  };
  for (const [x, y] of [[12, 9], [14, 11], [9, 12]]) state.world.tiles[y * 32 + x].terrain = 'river';
  return state;
}
function add(state: GameState, kind: Building['kind'], changes: Partial<Building> = {}): Building {
  const building: Building = { id: Math.max(...state.buildings.map(b => b.id), ...state.units.map(u => u.id)) + 1,
    kind, faction: 0, ...target, hp: 100, maxHp: 100, capacity: 0, ...changes };
  entityStore(state).buildings.add(building); return building;
}
function complete(state: GameState, building: Building): void {
  for (let step = 0; step < 900 && building.construction; step++) {
    state.time += .1; updateConstruction(state); ensureBuilders(state);
    for (const worker of state.units) if (worker.builder && worker.hp > 0) updateBuilder(state, worker, .1, moveUnit);
  }
  expect(building.construction).toBeUndefined();
}

describe('irrigation placement and construction', () => {
  it('requires cardinal freshwater or a living previous ditch, including queued segments', () => {
    const state = fixture();
    for (const tile of state.world.tiles) tile.terrain = 'grassland';
    expect(validateBuildAt(state, 'irrigation', 12, 10).message).toMatch(/freshwater/);
    for (const terrain of ['coast', 'ocean'] as const) {
      state.world.tiles[9 * 32 + 12].terrain = terrain;
      expect(validateBuildAt(state, 'irrigation', 12, 10).ok).toBe(false);
    }
    for (const terrain of ['river', 'lake'] as const) {
      state.world.tiles[9 * 32 + 12].terrain = terrain;
      expect(validateBuildAt(state, 'irrigation', 12, 10).ok).toBe(true);
    }
    state.world.tiles[9 * 32 + 12].terrain = 'grassland';
    const previous = add(state, 'irrigation', { x: 11, construction: { startedAt: 0, duration: 4, waitingForBuilder: true } });
    expect(validateBuildAt(state, 'irrigation', 12, 10).ok).toBe(true);
    previous.hp = 0;
    expect(validateBuildAt(state, 'irrigation', 12, 10).ok).toBe(false);
  });

  it('grows a reverse drag from its wet end and never jumps a blocked gap', () => {
    const state = fixture();
    for (const tile of state.world.tiles) tile.terrain = 'grassland';
    state.world.tiles[10 * 32 + 10].terrain = 'lake';
    const line = constructionLine({ x: 15, y: 10 }, { x: 10, y: 10 });
    expect(planConstruction(state, 'irrigation', line)).toMatchObject({ ok: true, cost: 175,
      tiles: [11, 12, 13, 14, 15].map(x => ({ x, y: 10 })) });
    add(state, 'house', { x: 13 });
    expect(planConstruction(state, 'irrigation', line).tiles).toEqual([{ x: 11, y: 10 }, { x: 12, y: 10 }]);
    expect(state.buildings.some(b => b.kind === 'irrigation')).toBe(false);
  });

  it('prices a connected drag per new tile and never double-charges repeated placement', () => {
    const state = fixture(), line = constructionLine({ x: 10, y: 12 }, { x: 14, y: 14 });
    expect(line).toHaveLength(7);
    expect(planConstruction(state, 'irrigation', line)).toMatchObject({ ok: true, cost: 245, skipped: 0 });
    expect(state.factions[0].gold).toBe(2000);
    expect(buildStroke(state, 'irrigation', line)).toMatchObject({ ok: true, placed: 7, skipped: 0 });
    expect(state.factions[0].gold).toBe(1755);
    expect(state.buildings.filter(building => building.kind === 'irrigation')).toHaveLength(7);
    expect(planConstruction(state, 'irrigation', line)).toMatchObject({ ok: true, cost: 0, tiles: [] });
    expect(buildStroke(state, 'irrigation', line)).toMatchObject({ ok: true, placed: 0 });
    expect(state.factions[0].gold).toBe(1755);
  });

  it.each(['forest', 'palm', 'marsh'] as const)('preserves %s while ordering and completing a ditch', vegetation => {
    const state = fixture(), tile = state.world.tiles[target.y * state.world.width + target.x];
    if (vegetation === 'forest') tile.overlay = 'forest';
    else tile[vegetation] = true;
    const before = { ...tile };
    expect(buildAt(state, 'irrigation', target.x, target.y).ok).toBe(true);
    expect(tile).toEqual(before);
    const ditch = state.buildings.find(building => building.kind === 'irrigation')!;
    complete(state, ditch);
    expect(tile).toEqual(before);
  });

  it('charges exactly fifty gold, allows outside borders, and completes through a palace builder', () => {
    const state = fixture();
    expect(buildingWithinBorders(state, 'house', target.x, target.y)).toBe(false);
    expect(buildAt(state, 'irrigation', target.x, target.y)).toMatchObject({ ok: true });
    const ditch = state.buildings.at(-1)!;
    expect(BUILD_COSTS.irrigation.gold).toBe(35);
    expect(state.factions[0].gold).toBe(1965);
    expect(ditch.construction).toMatchObject({ duration: 4, paidGold: 35, waitingForBuilder: true });
    complete(state, ditch);
    expect(canWalk(state, target.x + .5, target.y + .5, 0)).toBe(true);
  });

  it.each(['road', 'irrigation'] as const)('preserves both road and ditch when %s is placed first', first => {
    const state = fixture(), existing = add(state, first);
    add(state, 'road', { x: 11 });
    const next = first === 'road' ? 'irrigation' : 'road';
    expect(buildAt(state, next, target.x, target.y)).toMatchObject({ ok: true });
    const ordered = state.buildings.at(-1)!; complete(state, ordered);
    expect(state.buildings).toContain(existing); expect(state.buildings).toContain(ordered);
    expect(existing.hp).toBe(100);
  });

  it.each(['camp', 'irrigation'] as const)('keeps the crop tile when %s is placed first', first => {
    const state = fixture(), corner = { x: target.x, y: target.y };
    const existing = add(state, first, first === 'irrigation' ? corner : {});
    synchronizeFarms(state);
    const next = first === 'camp' ? 'irrigation' : 'camp', at = next === 'irrigation' ? corner : target;
    expect(buildAt(state, next, at.x, at.y)).toMatchObject({ ok: true });
    const ordered = state.buildings.at(-1)!; complete(state, ordered); synchronizeFarms(state);
    expect(state.buildings).toContain(existing); expect(state.buildings).toContain(ordered);
    expect(state.fields).toHaveLength(1);
    expect(state.fields!.some(field => field.x === corner.x && field.y === corner.y)).toBe(true);
  });

  it('allows a ditch on a pending farm reservation without consuming either order', () => {
    const state = fixture();
    expect(buildAt(state, 'camp', target.x, target.y).ok).toBe(true);
    const camp = state.buildings.at(-1)!;
    expect(buildAt(state, 'irrigation', target.x + 1, target.y + 1).ok).toBe(true);
    expect(camp.construction).toBeDefined(); expect(state.buildings.at(-1)!.construction).toBeDefined();
  });

  it('rejects duplicates, solid structures, enemy farm layers, water and insufficient gold', () => {
    for (const kind of ['irrigation', 'house', 'wall'] as const) {
      const state = fixture(); add(state, kind);
      expect(validateBuildAt(state, 'irrigation', target.x, target.y).ok).toBe(false);
    }
    const enemy = fixture(); add(enemy, 'camp', { faction: 1 });
    expect(validateBuildAt(enemy, 'irrigation', target.x, target.y).ok).toBe(false);
    const water = fixture(); water.world.tiles[target.y * 32 + target.x].terrain = 'river';
    water.world.tiles[target.y * 32 + target.x].overlay = 'ford';
    expect(validateBuildAt(water, 'irrigation', target.x, target.y).message).toBe('Build on dry land.');
    const poor = fixture(); poor.factions[0].gold = 34;
    expect(validateBuildAt(poor, 'irrigation', target.x, target.y).message).toBe('Need 35 gold.');
  });
});

describe('irrigation removal and combat protection', () => {
  it('demolishes only the selected ditch while preserving its farm, road and traffic', () => {
    const state = fixture(), farm = add(state, 'camp'), road = add(state, 'road'), ditch = add(state, 'irrigation');
    synchronizeFarms(state); const fieldIds = state.fields!.map(field => field.id), key = target.y * 32 + target.x;
    state.traffic = { [key]: [0, 1] };
    const gold = state.factions[0].gold;
    expect(demolishIrrigationAt(state, target.x, target.y)).toMatchObject({ ok: true, count: 1, refund: 0 });
    expect(state.buildings).not.toContain(ditch); expect(state.buildings).toContain(road); expect(state.buildings).toContain(farm);
    expect(state.fields!.map(field => field.id)).toEqual(fieldIds); expect(state.factions[0].gold).toBe(gold);
    expect(state.traffic[key]).toEqual([0, 1]);
    expect(demolishIrrigationAt(state, target.x, target.y).ok).toBe(false);
  });

  it('permits area demolition and refunds cancellation only for unfinished work', () => {
    const state = fixture(); add(state, 'road');
    expect(buildAt(state, 'irrigation', target.x, target.y).ok).toBe(true);
    const pending = state.buildings.at(-1)!;
    expect(cancelConstruction(state, pending.id)).toEqual({ ok: true, refund: 35 });
    const ditch = add(state, 'irrigation', { x: 15 });
    expect(cancelConstruction(state, ditch.id).ok).toBe(false);
    expect(demolishBuildingsInArea(state, ditch, ditch)).toMatchObject({ ok: true, count: 1, refund: 0 });
  });

  it('rejects explicit enemy attack orders and discards projectiles aimed at a ditch', () => {
    const state = fixture(), ditch = add(state, 'irrigation', { faction: -2 });
    updateFog(state);
    expect(commandAttackAt(state, ditch.x + .5, ditch.y + .5)).toBe(false);
    expect(isRaidObjective(state, ditch)).toBe(false);
    const leader = state.units[0]; leader.target = ditch.id;
    state.projectiles = [{ x: 13, y: 10.5, start: { x: 13, y: 10.5 }, end: { x: 12.5, y: 10.5 },
      attacker: leader.id, faction: 0, target: ditch.id, damage: 10000, elapsed: 0, duration: .1 }];
    updateGame(state, .1, idle);
    expect(ditch.hp).toBe(ditch.maxHp); expect(state.projectiles).toEqual([]); expect(leader.target).toBeUndefined();
  });

  it('enemy melee units ignore friendly ditches even with a stale target', () => {
    const state = fixture(), ditch = add(state, 'irrigation');
    const enemy: Unit = { ...state.units[0], id: 50, kind: 'warrior', faction: -2, x: target.x - .5, y: target.y + .5,
      attack: 1000, range: 1.1, speed: 0, target: ditch.id, order: 'hold' };
    entityStore(state).units.add(enemy); state.units[0].attack = 0;
    for (let i = 0; i < 20; i++) updateGame(state, .1, idle);
    expect(ditch.hp).toBe(ditch.maxHp); expect(enemy.target).not.toBe(ditch.id);
  });
});
