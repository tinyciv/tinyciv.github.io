import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { bridgeSpanAt, bridgeSpanLimit, bridgeStroke, INITIAL_BRIDGE_SPAN, MAX_BRIDGE_SPAN, validateBridgeTile } from '../src/game/bridge-spans';
import { buildStroke, constructionLine, planConstruction } from '../src/game/construction';
import { canMove, canWalk, findPath, hasStaticPath, movementMultiplier, travelTimeMap } from '../src/game/pathfinding';
import { createGame, getLeader, moveUnit, validateBuildAt } from '../src/game/simulation';
import { type Terrain, type World } from '../src/game/types';
import { insideOwnBorders } from '../src/game/borders';
import { ensureBuilders, updateBuilder } from '../src/game/builders';
import { updateConstruction } from '../src/game/structures';

function crossing(width = 8, terrains: Terrain[] = ['coast'], engineering = true) {
  const world: World = { width: 40, height: 30, seed: 'bridge-spans', source: 'fixture', spawns: [{ x: 8.5, y: 15.5 }],
    tiles: Array.from({ length: 40 * 30 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
      moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) };
  const state = createGame(world), leader = getLeader(state)!;
  entityStore(state).units.replace([leader]); Object.assign(leader, { x: 15.5, y: 15.5 });
  entityStore(state).buildings.replace(state.buildings.filter(building => building.kind === 'palace')); state.fields = [];
  state.factions[0].gold = 1000; state.factions[0].culture = 0;
  state.factions[0].research = { focus: 'engineering', levels: engineering ? { engineering: 1 } : {}, progress: {} };
  for (const tile of world.tiles) delete tile.farm;
  for (let y = 0; y < world.height; y++) for (let x = 16; x < Math.min(world.width, 16 + width); x++)
    Object.assign(world.tiles[y * world.width + x], { terrain: terrains[(x - 16) % terrains.length], overlay: 'none' });
  world.revision = (world.revision ?? 0) + 1;
  return state;
}

describe('complete water crossings', () => {
  it.each([1, 2])('allows a complete %i-tile crossing before Engineering', width => {
    const state = crossing(width, ['river'], false);
    expect(bridgeSpanLimit(state)).toBe(INITIAL_BRIDGE_SPAN);
    expect(buildStroke(state, 'bridge', [{ x: 16, y: 15 }])).toMatchObject({ ok: true, placed: width });
    expect(state.factions[0].gold).toBe(1000 - width * 10);
  });

  it('rejects longer previews and purchases until Engineering finishes, without allowing partial-span bypasses', () => {
    const state = crossing(3, ['river'], false), point = { x: 17, y: 15 };
    expect(bridgeSpanAt(state, point)).toBeUndefined();
    expect(validateBuildAt(state, 'bridge', point.x, point.y)).toMatchObject({ ok: false });
    expect(planConstruction(state, 'bridge', [point])).toMatchObject({ ok: false });
    expect(buildStroke(state, 'bridge', [point])).toMatchObject({ ok: false, placed: 0 });
    expect(state.factions[0].gold).toBe(1000);
    expect(validateBridgeTile(state, point.x, point.y).message).toContain('Research Engineering');
    entityStore(state).buildings.add({ id: 10000, kind: 'bridge', faction: 0, x: 16, y: 15, hp: 100, maxHp: 100, capacity: 0 });
    expect(bridgeSpanAt(state, point)).toBeUndefined();
    state.factions[0].research!.levels.engineering = 1;
    expect(bridgeSpanLimit(state)).toBe(MAX_BRIDGE_SPAN);
    expect(buildStroke(state, 'bridge', [point])).toMatchObject({ ok: true, placed: 2 });
  });

  it('uses the requesting faction’s Engineering research for all crossing calculations', () => {
    const state = crossing(8);
    state.factions = [state.factions[0], { ...structuredClone(state.factions[0]), id: 1, research: { focus: 'engineering', levels: {}, progress: {} } }];
    expect(bridgeSpanAt(state, { x: 19, y: 15 }, 0)?.tiles).toHaveLength(8);
    expect(bridgeSpanAt(state, { x: 19, y: 15 }, 1)).toBeUndefined();
    expect(bridgeStroke(state, [{ x: 19, y: 15 }], 1).ok).toBe(false);
    state.factions[1].research!.levels.engineering = 1;
    expect(bridgeStroke(state, [{ x: 19, y: 15 }], 1).ok).toBe(true);
  });

  it('invalidates a rejected bridge preview immediately when Engineering completes', () => {
    const state = crossing(8, ['coast'], false), stroke = [{ x: 19, y: 15 }];
    const rejected = planConstruction(state, 'bridge', stroke);
    expect(rejected.ok).toBe(false);
    state.factions[0].research!.levels.engineering = 1;
    const unlocked = planConstruction(state, 'bridge', stroke);
    expect(unlocked).not.toBe(rejected);
    expect(unlocked).toMatchObject({ ok: true, cost: 80 });
    expect(unlocked.tiles).toHaveLength(8);
  });
  it.each<Terrain>(['river', 'coast', 'ocean', 'lake'])('permits exactly eight %s tiles with dry banks', terrain => {
    const state = crossing(MAX_BRIDGE_SPAN, [terrain]);
    const span = bridgeSpanAt(state, { x: 19, y: 15 });
    expect(span).toEqual({ axis: 'horizontal', banks: [{ x: 15, y: 15 }, { x: 24, y: 15 }],
      tiles: Array.from({ length: 8 }, (_, i) => ({ x: 16 + i, y: 15 })) });
    expect(validateBridgeTile(state, 19, 15).ok).toBe(true);
  });

  it('rejects nine water cells, the edge of the world, and obstructed banks', () => {
    expect(bridgeSpanAt(crossing(9), { x: 20, y: 15 })).toBeUndefined();
    expect(bridgeSpanAt(crossing(30), { x: 17, y: 15 })).toBeUndefined();
    const state = crossing();
    entityStore(state).buildings.add({ id: 10000, kind: 'wall', faction: 0, x: 24, y: 15, hp: 100, maxHp: 100, capacity: 0 });
    expect(bridgeSpanAt(state, { x: 20, y: 15 })).toBeUndefined();
    expect(validateBridgeTile(state, 20, 15).message).toContain('land at both ends');
  });

  it('allows a small island as the far bank, without requiring mainland terrain', () => {
    const state = crossing(30);
    Object.assign(state.world.tiles[15 * 40 + 24], { terrain: 'desert', overlay: 'none' });
    expect(bridgeSpanAt(state, { x: 20, y: 15 })?.tiles).toHaveLength(8);
  });

  it('never bridges or walks a waterfall, even if a crossing still has ford and bridge metadata', () => {
    const state = crossing(1, ['river']), from = { x: 15.5, y: 15.5 }, to = { x: 17.5, y: 15.5 };
    const tile = state.world.tiles[15 * state.world.width + 16];
    delete state.world.revision; // Revisionless fixture caches must observe the new waterfall flag too.
    tile.overlay = 'ford';
    entityStore(state).buildings.add({ id: 10000, kind: 'bridge', faction: 0, x: 16, y: 15, hp: 100, maxHp: 100, capacity: 0 });
    expect(canWalk(state, 16.5, 15.5, 0)).toBe(true);
    expect(hasStaticPath(state, from, to, 0)).toBe(true);
    tile.waterfall = 'south';
    expect(validateBridgeTile(state, 16, 15)).toEqual({ ok: false, message: 'Waterfalls cannot be bridged.' });
    expect(bridgeSpanAt(state, { x: 16, y: 15 })).toBeUndefined();
    expect(canWalk(state, 16.5, 15.5, 0)).toBe(false);
    expect(hasStaticPath(state, from, to, 0)).toBe(false);
    expect(findPath(state, from, to, 0)).toEqual([]);
    expect(canMove(state, from, { x: 16.5, y: 15.5 }, 0)).toBe(false);
  });

  it('uses a straight vertical drag to choose the north-south span', () => {
    const state = crossing(0);
    for (let y = 10; y < 18; y++) for (let x = 0; x < 40; x++) state.world.tiles[y * 40 + x].terrain = 'lake';
    const span = bridgeSpanAt(state, { x: 20, y: 14 });
    expect(span?.axis).toBe('vertical'); expect(span?.tiles).toHaveLength(8);
    const stroke = bridgeStroke(state, constructionLine({ x: 20, y: 18 }, { x: 20, y: 9 }));
    expect(stroke.ok).toBe(true); expect(stroke.points).toHaveLength(10);
  });

  it('rejects bent strokes and does not invent crossings when only dry land is selected', () => {
    const state = crossing();
    expect(bridgeStroke(state, constructionLine({ x: 15, y: 14 }, { x: 24, y: 16 })).ok).toBe(false);
    expect(bridgeStroke(state, [{ x: 14, y: 15 }]).ok).toBe(false);
  });

  it('expands a click to its entire span and charges no gold for either bank', () => {
    const state = crossing(8, ['river', 'coast', 'ocean', 'lake']);
    expect(insideOwnBorders(state, 0, 20.5, 15.5)).toBe(false);
    expect(validateBuildAt(state, 'bridge', 20, 15).ok).toBe(true);
    const plan = planConstruction(state, 'bridge', [{ x: 20, y: 15 }]);
    expect(plan).toMatchObject({ ok: true, skipped: 0, cost: 80 });
    expect(plan.tiles).toHaveLength(8); expect(plan.cells).toHaveLength(10);
    expect(plan.cells.filter(cell => cell.existing)).toHaveLength(2);
    expect(state.factions[0].gold).toBe(1000);
    expect(buildStroke(state, 'bridge', [{ x: 20, y: 15 }])).toMatchObject({ ok: true, placed: 8, skipped: 0 });
    expect(state.factions[0].gold).toBe(920);
    expect(state.buildings.filter(building => building.kind === 'bridge')).toHaveLength(8);
  });

  it('rejects an unaffordable or obstructed span without purchasing a partial pier', () => {
    const state = crossing(); state.factions[0].gold = 79;
    expect(planConstruction(state, 'bridge', [{ x: 20, y: 15 }]).message).toBe('Need 80 gold for this complete bridge.');
    expect(buildStroke(state, 'bridge', [{ x: 20, y: 15 }])).toMatchObject({ ok: false, placed: 0, message: 'Need 80 gold for this complete bridge.' });
    expect(state.factions[0].gold).toBe(79);
    expect(state.buildings.some(building => building.kind === 'bridge')).toBe(false);
    state.factions[0].gold = 1000;
    entityStore(state).buildings.add({ id: 10000, kind: 'bridge', faction: 1, x: 20, y: 15, hp: 100, maxHp: 100, capacity: 0 });
    expect(buildStroke(state, 'bridge', [{ x: 20, y: 15 }])).toMatchObject({ ok: false, placed: 0 });
    expect(state.factions[0].gold).toBe(1000);
  });

  it('reuses existing friendly segments and prices only missing water cells', () => {
    const state = crossing();
    entityStore(state).buildings.add({ id: 10000, kind: 'bridge', faction: 0, x: 20, y: 15, hp: 100, maxHp: 100, capacity: 0 });
    const plan = planConstruction(state, 'bridge', constructionLine({ x: 24, y: 15 }, { x: 15, y: 15 }));
    expect(plan).toMatchObject({ ok: true, cost: 70, skipped: 0 }); expect(plan.tiles).toHaveLength(7);
    expect(buildStroke(state, 'bridge', [{ x: 20, y: 15 }])).toMatchObject({ ok: true, placed: 7, skipped: 0 });
  });

  it('opens every water type to movement and weighted routing only when construction finishes', () => {
    const state = crossing(8, ['river', 'coast', 'ocean', 'lake']);
    const from = { x: 15.5, y: 15.5 }, to = { x: 24.5, y: 15.5 };
    expect(findPath(state, from, to, 0)).toEqual([]);
    expect(buildStroke(state, 'bridge', [{ x: 20, y: 15 }]).placed).toBe(8);
    expect(findPath(state, from, to, 0)).toEqual([]);
    for (const building of state.buildings) if (building.kind === 'bridge') delete building.construction;
    for (let x = 16; x <= 23; x++) {
      expect(canWalk(state, x, 15, 0)).toBe(true);
      expect(movementMultiplier(state, x, 15)).toBe(1);
    }
    expect(canMove(state, from, to, 0)).toBe(true);
    expect(findPath(state, from, to, 0).at(-1)).toEqual(to);
    expect(travelTimeMap(state, from, 0, 1, 100)[15 * 40 + 24]).toBe(9);
    expect(canWalk(state, 20, 14, 0)).toBe(false);
  });

  it('lets one palace peasant construct all eight segments successively from the accessible bank', () => {
    const state = crossing(8, ['river', 'coast', 'ocean', 'lake']);
    state.factions[0].population = 5;
    expect(buildStroke(state, 'bridge', [{ x: 20, y: 15 }]).placed).toBe(8);
    Object.assign(getLeader(state)!, { x: 14.5, y: 13.5 });
    for (let i = 0; i < 1800; i++) {
      state.time += .1; updateConstruction(state); ensureBuilders(state);
      for (const unit of state.units) if (unit.builder) updateBuilder(state, unit, .1, moveUnit);
    }
    const bridges = state.buildings.filter(building => building.kind === 'bridge');
    expect(bridges).toHaveLength(8);
    expect(bridges.every(building => !building.construction)).toBe(true);
    expect(findPath(state, { x: 15.5, y: 15.5 }, { x: 24.5, y: 15.5 }, 0).at(-1)).toEqual({ x: 24.5, y: 15.5 });
  });
});
