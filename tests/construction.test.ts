import { entityStore } from '../src/game/entity-store';
import { unlockBuildingResearch } from './helpers/research';
import { describe, expect, it } from 'vitest';
import { constructionLine } from '../src/game/construction';

describe('drag construction strokes', () => {
  it('includes endpoints and every intervening horizontal or vertical tile', () => {
    expect(constructionLine({x:2.5,y:4.5},{x:6.8,y:4.2})).toEqual([2,3,4,5,6].map(x=>({x,y:4})));
    expect(constructionLine({x:3,y:7},{x:3,y:3})).toEqual([7,6,5,4,3].map(y=>({x:3,y})));
  });
  it('keeps diagonal drags connected without duplicate or two-tile-wide sections', () => {
    for(const end of [{x:9,y:6},{x:-3,y:8},{x:10,y:-6},{x:-4,y:-8}]) {
      const points=constructionLine({x:1,y:1},end);
      expect(points.at(-1)).toEqual(end);
      expect(new Set(points.map(p=>`${p.x},${p.y}`)).size).toBe(points.length);
      expect(points.length).toBe(Math.abs(end.x-1)+Math.abs(end.y-1)+1);
      points.slice(1).forEach((p,i)=>expect(Math.abs(p.x-points[i].x)+Math.abs(p.y-points[i].y)).toBe(1));
    }
  });
  it('treats a click as a one-tile stroke', () => {
    expect(constructionLine({x:4.3,y:7.8},{x:4.9,y:7.1})).toEqual([{x:4,y:7}]);
  });
});

import { buildStroke, planConstruction } from '../src/game/construction';
import { buildAt, createGame, validateBuildAt } from '../src/game/simulation';
import { movementMultiplier } from '../src/game/pathfinding';
import { insideOwnBorders } from '../src/game/borders';
import { isVisible } from '../src/game/fog';
import type { World } from '../src/game/types';
function settlement() {
  const world: World = { width:48,height:32,seed:'stroke-test',source:'fixture',spawns:[{x:8.5,y:12.5}],tiles:Array.from({length:48*32},()=>({terrain:'grassland',overlay:'none',elevation:.3,moisture:.5,food:3,production:1,gold:0,variation:.5})) };
  const state=createGame(world);
  state.factions.forEach(unlockBuildingResearch);
  entityStore(state).units.replace(state.units.filter(u=>u.kind==='leader'));
  entityStore(state).buildings.replace(state.buildings.filter(b=>b.kind==='palace'));
  entityStore(state).buildings.add({id:900,kind:'road',faction:0,x:24,y:14,hp:100,maxHp:100,capacity:0});
  Object.assign(state.units[0],{x:24.5,y:14.5});
  state.factions[0].gold=40;
  state.factions[0].culture=30000; // Keep the stroke fixtures inside established territory.
  return state;
}
describe('drag construction commits',()=>{
  it.each([[23, 14], [25, 14], [24, 13], [24, 15]])('starts a road on bank %s,%s beside a ford without an existing road', (x, y) => {
    const state = settlement();
    entityStore(state).buildings.replace(state.buildings.filter(building => building.kind !== 'road'));
    state.factions[0].culture = 0; // Manual road starts may be beyond faction borders.
    Object.assign(state.world.tiles[14 * 48 + 24], { terrain: 'river', overlay: 'ford' });
    expect(insideOwnBorders(state, 0, x + .5, y + .5)).toBe(false);
    expect(validateBuildAt(state, 'road', x, y).ok).toBe(true);
    expect(buildAt(state, 'road', x, y).ok).toBe(true);
    expect(state.factions[0].gold).toBe(38);
    expect(state.buildings.filter(building => building.kind === 'road')).toMatchObject([{ x, y, construction: { waitingForBuilder: true } }]);
  });

  it.each([false, true])('builds both banks of a wide ford, retaining its natural crossing (reverse: %s)', reverse => {
    const state = settlement();
    entityStore(state).buildings.replace(state.buildings.filter(building => building.kind !== 'road'));
    for (const x of [24, 25, 26]) Object.assign(state.world.tiles[14 * 48 + x], { terrain: 'river', overlay: 'ford' });
    const line = constructionLine({ x: reverse ? 28 : 22, y: 14 }, { x: reverse ? 22 : 28, y: 14 });
    const plan = planConstruction(state, 'road', line);
    expect(plan).toMatchObject({ ok: true, skipped: 0, cost: 8 });
    expect(plan.cells.every(cell => cell.ok)).toBe(true);
    expect(plan.cells.filter(cell => cell.existing).map(cell => cell.x).sort()).toEqual([24, 25, 26]);
    expect(plan.tiles.map(tile => tile.x).sort()).toEqual([22, 23, 27, 28]);
    expect(state.factions[0].gold).toBe(40); // Planning is read-only.
    expect(buildStroke(state, 'road', line)).toMatchObject({ ok: true, placed: 4, skipped: 0 });
    expect(state.factions[0].gold).toBe(32);
    const roads = state.buildings.filter(building => building.kind === 'road');
    expect(roads.map(road => road.x).sort()).toEqual([22, 23, 27, 28]);
    for (const road of roads) delete road.construction;
    for (const x of [24, 25, 26]) expect(movementMultiplier(state, x + .5, 14.5)).toBe(.45);
  });

  it('treats a ford-only stroke as free existing crossing and rejects paving it directly', () => {
    const state = settlement();
    entityStore(state).buildings.replace(state.buildings.filter(building => building.kind !== 'road'));
    for (const x of [24, 25, 26]) Object.assign(state.world.tiles[14 * 48 + x], { terrain: 'river', overlay: 'ford' });
    const line = constructionLine({ x: 24, y: 14 }, { x: 26, y: 14 });
    expect(planConstruction(state, 'road', line)).toMatchObject({ ok: true, tiles: [], skipped: 0, cost: 0 });
    expect(buildStroke(state, 'road', line)).toMatchObject({ ok: true, placed: 0, skipped: 0 });
    expect(buildAt(state, 'road', 25, 14)).toEqual({ ok: false, message: 'Fords already provide a crossing. Start the road on either bank.' });
    expect(state.factions[0].gold).toBe(40);
    expect(state.buildings.some(building => building.kind === 'road')).toBe(false);
    expect(movementMultiplier(state, 25.5, 14.5)).toBe(.45);
  });

  it.each([['road', 'wall'], ['wall', 'road']] as const)('applies gate layout exemptions when adding %s then %s, charging only new segments', (first, second) => {
    const state = settlement(), line = constructionLine({ x: 25, y: 14 }, { x: 28, y: 14 });
    state.factions[0].gold = 300;
    expect(buildStroke(state, first, line).placed).toBe(4);
    const placed = 2;
    expect(buildStroke(state, second, line).placed).toBe(placed);
    const remaining = second === 'wall' ? 232 : 176;
    expect(state.factions[0].gold).toBe(remaining);
    expect(buildStroke(state, second, line).placed).toBe(0);
    expect(state.factions[0].gold).toBe(remaining);
    const gates = line.filter(tile => state.buildings.filter(building => building.x === tile.x && building.y === tile.y).length === 2);
    expect(gates.map(tile => tile.x)).toEqual([25, 27]);
  });
  it('skips the occupied hostile crossing while spacing gates through friendly walls', () => {
    const state = settlement(), line = constructionLine({ x: 25, y: 14 }, { x: 30, y: 14 });
    state.factions[0].gold = 300;
    expect(buildStroke(state, 'wall', line).placed).toBe(6);
    state.buildings.find(building => building.kind === 'wall' && building.x === 29)!.faction = 1;
    const plan = planConstruction(state, 'road', line);
    expect(plan.cells.map(cell => cell.ok)).toEqual([true, false, true, false, false, true]);
    expect(plan.cells.find(cell => cell.x === 29)).toMatchObject({ ok: false, message: 'Tile occupied.' });
    expect(plan.cells.filter(cell => !cell.ok).map(cell => cell.x)).toEqual([26, 28, 29]);
    expect(plan).toMatchObject({ ok: true, cost: 6, skipped: 3 });
    expect(buildStroke(state, 'road', line)).toMatchObject({ ok: true, placed: 3, skipped: 3 });
    expect(state.factions[0].gold).toBe(114);
    expect(state.buildings.filter(building => building.kind === 'road')).toHaveLength(4);
  });
  it('places a complete line once and charges only new segments when extending',()=>{
    const state=settlement();
    expect(buildStroke(state,'road',constructionLine({x:25,y:14},{x:30,y:14})).placed).toBe(6);
    expect(state.factions[0].gold).toBe(28);
    expect(buildStroke(state,'road',constructionLine({x:28,y:14},{x:32,y:14})).placed).toBe(2);
    expect(state.factions[0].gold).toBe(24);
    expect(state.buildings.filter(b=>b.kind==='road')).toHaveLength(9);
  });
  it('purchases only the affordable connected part and previews later cells as invalid',()=>{
    const state=settlement(),line=constructionLine({x:25,y:14},{x:29,y:14});
    state.factions[0].gold=5;
    const plan = planConstruction(state, 'road', line);
    expect(plan).toMatchObject({ ok: true, cost: 4, skipped: 3, costs: { production: 0, food: 0, gold: 4 } });
    expect(plan.cells.map(cell => cell.ok)).toEqual([true, true, false, false, false]);
    // A preview never spends the actual treasury or reserves an actual building.
    expect(state.factions[0].gold).toBe(5);
    expect(state.buildings.filter(b=>b.kind==='road')).toHaveLength(1);
    expect(buildStroke(state,'road',line)).toMatchObject({ ok: true, placed: 2, skipped: 3 });
    expect(state.factions[0].gold).toBe(1);
    expect(state.buildings.filter(b=>b.kind==='road')).toHaveLength(3);
  });
  it('builds walls on both sides of a rejected tile without charging for the gap', () => {
    const state = settlement(), line = constructionLine({ x: 25, y: 14 }, { x: 29, y: 14 });
    state.factions[0].gold = 200;
    state.world.tiles[14 * 48 + 27].terrain = 'river';
    const plan = planConstruction(state, 'wall', line);
    expect(plan.cells.map(cell => cell.ok)).toEqual([true, true, false, true, true]);
    expect(plan.cells[2].message).toBe('Build on dry land.');
    expect(plan).toMatchObject({ cost: 120, skipped: 1 });
    expect(buildStroke(state, 'wall', line)).toMatchObject({ ok: true, placed: 4, skipped: 1 });
    expect(state.buildings.filter(b => b.kind === 'wall').map(b => b.x)).toEqual([25, 26, 28, 29]);
    expect(state.factions[0].gold).toBe(80);
  });
  it('keeps roads beyond a rejected tile disconnected unless another road reaches that side', () => {
    const state = settlement(), line = constructionLine({ x: 25, y: 14 }, { x: 29, y: 14 });
    state.world.tiles[14 * 48 + 27].terrain = 'river';
    expect(planConstruction(state, 'road', line).cells.map(cell => cell.ok)).toEqual([true, true, false, false, false]);
    entityStore(state).buildings.add({ id: 901, kind: 'road', faction: 0, x: 30, y: 14, hp: 100, maxHp: 100, capacity: 0 });
    const plan = planConstruction(state, 'road', line);
    expect(plan.cells.map(cell => cell.ok)).toEqual([true, true, false, true, true]);
    expect(plan.tiles.map(tile => tile.x)).toEqual([25, 26, 29, 28]);
    expect(buildStroke(state, 'road', line)).toMatchObject({ ok: true, placed: 4, skipped: 1 });
    expect(state.factions[0].gold).toBe(32);
  });
  it('marks existing segments valid and free while skipping occupied cells in the same stroke', () => {
    const state = settlement();
    state.factions[0].gold = 100;
    entityStore(state).buildings.add({ id: 901, kind: 'wall', faction: 0, x: 25, y: 14, hp: 225, maxHp: 225, capacity: 0 });
    entityStore(state).buildings.add({ id: 902, kind: 'tower', faction: 0, x: 27, y: 14, hp: 1200, maxHp: 1200, capacity: 0 });
    const line = constructionLine({ x: 25, y: 14 }, { x: 29, y: 14 });
    const plan = planConstruction(state, 'wall', [...line, line[0]]);
    expect(plan.cells).toHaveLength(5);
    expect(plan.cells.map(cell => [cell.ok, cell.existing])).toEqual([[true, true], [true, false], [false, false], [true, false], [true, false]]);
    expect(plan).toMatchObject({ cost: 90, skipped: 1 });
    expect(buildStroke(state, 'wall', line)).toMatchObject({ ok: true, placed: 3, skipped: 1 });
    expect(state.factions[0].gold).toBe(10);
  });
  it('completes each water crossing in a mixed stroke and treats banks as free endpoints', () => {
    const state = settlement(), line = constructionLine({ x: 25, y: 14 }, { x: 29, y: 14 });
    state.factions[0].gold = 100;
    for (const x of [25, 26, 28, 29]) state.world.tiles[14 * 48 + x].terrain = 'river';
    const plan = planConstruction(state, 'bridge', line);
    expect(plan.cells.every(cell => cell.ok)).toBe(true);
    expect(plan.tiles.map(tile => tile.x).sort()).toEqual([25, 26, 28, 29]);
    expect(plan.cells.filter(cell => cell.existing).map(cell => cell.x).sort()).toEqual([24, 27, 30]);
    expect(buildStroke(state, 'bridge', line)).toMatchObject({ ok: true, placed: 4, skipped: 0 });
    expect(state.factions[0].gold).toBe(100 - plan.cost);
  });
  it('allows wall strokes throughout owned territory even beyond the leader sight radius', () => {
    const state = settlement(), line = constructionLine({ x: 25, y: 14 }, { x: 34, y: 14 });
    state.factions[0].gold = 400;
    expect(line.every(point => insideOwnBorders(state, 0, point.x + .5, point.y + .5))).toBe(true);
    expect(isVisible(state, 34.5, 14.5)).toBe(true);
    const plan = planConstruction(state, 'wall', line);
    expect(plan.cells.every(cell => cell.ok)).toBe(true);
    expect(buildStroke(state, 'wall', line)).toMatchObject({ ok: true, placed: 10, skipped: 0 });
    expect(state.factions[0].gold).toBe(100);
  });
  it('queues the unseen end of a road stroke without revealing it', () => {
    const state = settlement(), line = constructionLine({ x: 25, y: 14 }, { x: 34, y: 14 });
    state.factions[0].culture = 0;
    state.factions[0].gold = 200;
    expect(line.every(point => !insideOwnBorders(state, 0, point.x + .5, point.y + .5))).toBe(true);
    expect(isVisible(state, 33.5, 14.5)).toBe(true);
    expect(isVisible(state, 34.5, 14.5)).toBe(false);
    const plan = planConstruction(state, 'road', line);
    expect(plan.cells.every(cell => cell.ok)).toBe(true);
    expect(buildStroke(state, 'road', line)).toMatchObject({ ok: true, placed: 10, skipped: 0 });
    expect(state.factions[0].gold).toBe(180);
    expect(isVisible(state, 34.5, 14.5)).toBe(false);
  });
  it('builds a stroke dragged toward the network in connection order', () => {
    const state = settlement();
    const line = constructionLine({ x: 30, y: 14 }, { x: 25, y: 14 });
    const plan = planConstruction(state, 'road', line);
    expect(plan.ok).toBe(true);
    expect(plan.tiles).toEqual([25, 26, 27, 28, 29, 30].map(x => ({ x, y: 14 })));
    expect(buildStroke(state, 'road', line).placed).toBe(6);
    expect(state.factions[0].gold).toBe(28);
  });
  it('rejects disconnected strokes without spending gold', () => {
    const state = settlement();
    expect(buildStroke(state, 'road', constructionLine({ x: 26, y: 14 }, { x: 30, y: 14 }))).toMatchObject({ ok: false, placed: 0 });
    expect(state.factions[0].gold).toBe(40);
    expect(state.buildings.filter(b => b.kind === 'road')).toHaveLength(1);
  });
});
