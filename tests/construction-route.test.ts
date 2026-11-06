import * as construction from '../src/game/construction';
import { synchronizeFarms } from '../src/game/farms';
import { describe, expect, it, vi } from 'vitest';
import { createGame, getLeader } from '../src/game/simulation';
import { constructionRoute } from '../src/game/construction-route';
import { buildStroke, planConstruction } from '../src/game/construction';
import { entityStore } from '../src/game/entity-store';
import { unlockBuildingResearch } from './helpers/research';
import type { Point, World } from '../src/game/types';
import { applyGameCommand } from '../src/multiplayer/commands';

function fixture() {
  const world: World = { width: 40, height: 32, seed: 'adaptive-placement', source: 'fixture', spawns: [{ x: 8.5, y: 12.5 }],
    tiles: Array.from({ length: 40 * 32 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) };
  const state = createGame(world);
  state.factions.forEach(unlockBuildingResearch);
  entityStore(state).units.replace(state.units.filter(u => u.kind === 'leader'));
  entityStore(state).buildings.replace(state.buildings.filter(b => b.kind === 'palace'));
  Object.assign(getLeader(state)!, { x: 22.5, y: 14.5 });
  state.factions[0].gold = 10000;
  entityStore(state).buildings.add({ id: 900, kind: 'road', faction: 0, x: 19, y: 14, hp: 100, maxHp: 100, capacity: 0 });
  return state;
}
const contiguous = (route: Point[]) => route.slice(1).every((point, i) => Math.abs(point.x - route[i].x) + Math.abs(point.y - route[i].y) === 1);

describe('adaptive two-click construction', () => {
  it('routes a road around an occupied site without disconnected gaps or mutating the world', () => {
    const state = fixture();
    entityStore(state).buildings.add({ id: 901, kind: 'monument', faction: 0, x: 22, y: 14, hp: 100, maxHp: 100, capacity: 0 });
    const before = JSON.stringify([state.buildings, state.factions[0].gold]);
    const route = constructionRoute(state, 'road', { x: 19, y: 14 }, { x: 25, y: 14 });
    expect(route.at(-1)).toEqual({ x: 25, y: 14 });
    expect(contiguous(route)).toBe(true);
    expect(route.some(p => p.x === 22 && p.y === 14)).toBe(false);
    expect(planConstruction(state, 'road', route)).toMatchObject({ ok: true, skipped: 0 });
    expect(JSON.stringify([state.buildings, state.factions[0].gold])).toBe(before);
    expect(buildStroke(state, 'road', route)).toMatchObject({ ok: true, skipped: 0 });
  });
  it('ends at the nearest reachable land when the endpoint is in unbridged water', () => {
    const state = fixture();
    for (let y = 0; y < 32; y++) for (let x = 24; x < 40; x++) state.world.tiles[y * 40 + x].terrain = 'river';
    const route = constructionRoute(state, 'road', { x: 19, y: 14 }, { x: 26, y: 14 });
    expect(route.at(-1)).toEqual({ x: 23, y: 14 });
    expect(contiguous(route)).toBe(true);
    expect(planConstruction(state, 'road', route)).toMatchObject({ ok: true, skipped: 0 });
  });
  it('keeps palisades contiguous around obstacles and respects wall topology', () => {
    const state = fixture();
    entityStore(state).buildings.add({ id: 901, kind: 'monument', faction: 0, x: 22, y: 16, hp: 100, maxHp: 100, capacity: 0 });
    const route = constructionRoute(state, 'palisade', { x: 19, y: 16 }, { x: 25, y: 16 });
    expect(route.at(-1)).toEqual({ x: 25, y: 16 });
    expect(contiguous(route)).toBe(true);
    expect(planConstruction(state, 'palisade', route)).toMatchObject({ ok: true, skipped: 0 });
  });
  it('snaps a diagonal bridge end to a complete straight bank-to-bank crossing', () => {
    const state = fixture();
    for (let y = 0; y < 32; y++) for (let x = 22; x <= 24; x++) state.world.tiles[y * 40 + x].terrain = 'river';
    const route = constructionRoute(state, 'bridge', { x: 21, y: 16 }, { x: 25, y: 17 });
    expect(contiguous(route)).toBe(true);
    expect(new Set(route.map(p => p.y)).size).toBe(1);
    const plan = planConstruction(state, 'bridge', route);
    expect(plan).toMatchObject({ ok: true, skipped: 0 });
    expect(plan.tiles).toHaveLength(3);
  });
  it('does not silently connect irrigation without freshwater', () => {
    const state = fixture();
    const route = constructionRoute(state, 'irrigation', { x: 19, y: 16 }, { x: 25, y: 16 });
    expect(planConstruction(state, 'irrigation', route).ok).toBe(false);
  });
  it('rejects an occupied start without buying disconnected pieces beyond it', () => {
    const state = fixture();
    entityStore(state).buildings.add({ id: 901, kind: 'monument', faction: 0, x: 20, y: 16, hp: 100, maxHp: 100, capacity: 0 });
    const route = constructionRoute(state, 'palisade', { x: 20, y: 16 }, { x: 25, y: 16 });
    expect(buildStroke(state, 'palisade', route)).toMatchObject({ ok: false, placed: 0 });
    expect(state.buildings.some(b => b.kind === 'palisade')).toBe(false);
  });
  it('authoritatively expands a single water-cell bridge command to the complete crossing', () => {
    const state = fixture();
    for (let y = 0; y < 32; y++) for (let x = 22; x <= 24; x++) state.world.tiles[y * 40 + x].terrain = 'river';
    expect(applyGameCommand(state, 0, { type: 'build', kind: 'bridge', points: [{ x: 23, y: 16 }] }).ok).toBe(true);
    expect(state.buildings.filter(b => b.kind === 'bridge').map(b => b.x).sort()).toEqual([22, 23, 24]);
  });
});


describe('bounded construction search work', () => {
  it('prunes impossible neighboring gates before retrying expensive farm plans', () => {
    const state = fixture();
    entityStore(state).buildings.add(...[[18,14],[20,14],[21,14],[22,14],[19,13],[19,15]].map(([x,y],i)=>({id:1000+i,kind:'road' as const,faction:0,x,y,hp:100,maxHp:100,capacity:0})));
    const plan = vi.spyOn(construction,'planConstruction');
    try {
      const route=constructionRoute(state,'palisade',{x:19,y:14},{x:25,y:14});
      expect(route).toEqual([{x:19,y:14}]);
      expect(plan.mock.calls.length).toBeLessThanOrEqual(3);
      expect(planConstruction(state,'palisade',route)).toMatchObject({ok:true,skipped:0});
    } finally {plan.mockRestore();}
  });
  it('reuses multiple farm previews and requotes them immediately after engineer death', () => {
    const state=fixture(), leader=getLeader(state)!;
    Object.assign(leader,{leaderProgression:{level:2,xp:0,skillPoints:0,skills:{power:0,guard:0,command:0,engineer:1}}});
    const engineer={...leader,id:1100,kind:'worker' as const,engineer:{leader:leader.id},hp:100};
    entityStore(state).units.add(engineer);
    entityStore(state).buildings.add(...[20,21].map((x,i)=>({id:1200+i,kind:'camp' as const,faction:0,x,y:14,hp:100,maxHp:100,capacity:0})));
    synchronizeFarms(state);
    const a=[{x:19,y:14},{x:20,y:14}], b=[...a,{x:21,y:14}];
    const before=JSON.stringify([state.buildings,state.fields,state.factions]);
    const first=planConstruction(state,'road',a),second=planConstruction(state,'road',b);
    expect(first).toMatchObject({ok:true,skipped:0,cost:5});expect(second).toMatchObject({ok:true,skipped:0,cost:10});
    expect(planConstruction(state,'road',a)).toBe(first);
    expect(planConstruction(state,'road',b)).toBe(second);
    expect(JSON.stringify([state.buildings,state.fields,state.factions])).toBe(before);
    engineer.hp=0;
    expect(planConstruction(state,'road',a)).toMatchObject({ok:true,skipped:0,cost:10});
    expect(planConstruction(state,'road',b)).toMatchObject({ok:true,skipped:0,cost:20});
  });
});
