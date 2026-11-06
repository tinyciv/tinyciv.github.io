import { describe, expect, it } from 'vitest';
import { constructionEdges } from '../src/game/builders';
import { entityStore } from '../src/game/entity-store';
import { setForbiddenRectangle } from '../src/game/forbidden-zones';
import { parseGameSave, serializeGameSave } from '../src/game/game-save';
import { canWalk } from '../src/game/pathfinding';
import { LODGE_SCOUT_SPEED, scoutLodgeStatus, updateScoutLodges } from '../src/game/scout-lodges';
import type { GameState } from '../src/game/types';
import { scoutRealm } from './helpers/scouts';

const scouts = (state: GameState, faction = 0) => state.units.filter(unit => unit.kind === 'scout' && unit.hp > 0 && unit.faction === faction);

describe('automatic Scouts’ Lodge recruitment', () => {
  it('immediately launches two dedicated explorers at distinct clear exits for no extra resources', () => {
    const state = scoutRealm(), lodge = state.buildings[1], faction = { ...state.factions[0] };
    updateScoutLodges(state);
    expect(scouts(state)).toHaveLength(2);
    const exits = constructionEdges(state, lodge);
    expect(scouts(state).every(unit => exits.some(point => point.x === unit.x && point.y === unit.y) && canWalk(state, unit.x, unit.y, 0))).toBe(true);
    expect(new Set(scouts(state).map(unit => `${unit.x},${unit.y}`)).size).toBe(2);
    for (const unit of scouts(state)) expect(unit).toMatchObject({ scoutLodge: lodge.id, hp: 100, maxHp: 100, attack: 0,
      defense: 4, range: 0, speed: LODGE_SCOUT_SPEED, morale: 100 });
    expect(state.factions[0]).toEqual(faction);
    expect(scoutLodgeStatus(state, lodge)).toEqual({ capacity: 2, alive: 2, recruitingIn: null, blocked: false });
    state.time = 10000; updateScoutLodges(state); expect(scouts(state)).toHaveLength(2);
  });

  it('maintains two explorers independently at every lodge', () => {
    const state = scoutRealm(); entityStore(state).buildings.add({ ...state.buildings[1], id: 102, x: 25 });
    updateScoutLodges(state);
    expect(scouts(state)).toHaveLength(4);
    expect(scouts(state).filter(unit => unit.scoutLodge === 101)).toHaveLength(2);
    expect(scouts(state).filter(unit => unit.scoutLodge === 102)).toHaveLength(2);
    expect(new Set(state.units.map(unit => unit.id)).size).toBe(state.units.length);
  });

  it('waits for completion and a non-defeated owner', () => {
    const state = scoutRealm(), lodge = state.buildings[1];
    lodge.construction = { startedAt: 0, duration: 45, waitingForBuilder: true };
    updateScoutLodges(state); expect(scouts(state)).toHaveLength(0);
    delete lodge.construction; state.factions[0].defeated = true;
    updateScoutLodges(state); expect(scouts(state)).toHaveLength(0);
    state.factions[0].defeated = false; updateScoutLodges(state); expect(scouts(state)).toHaveLength(2);
  });

  it('replaces two losses one at a time, fifteen seconds apart, and keeps deadlines through reload', () => {
    const state = scoutRealm(); updateScoutLodges(state);
    entityStore(state).units.retain(unit => unit.kind !== 'scout'); state.time = 20; updateScoutLodges(state);
    expect(state.buildings[1].scoutLodge?.nextRecruitAt).toBe(35);
    expect(scoutLodgeStatus(state, state.buildings[1]).recruitingIn).toBe(15);
    const loaded = parseGameSave(serializeGameSave(state));
    loaded.time = 34.9; updateScoutLodges(loaded); expect(scouts(loaded)).toHaveLength(0);
    loaded.time = 35; updateScoutLodges(loaded); expect(scouts(loaded)).toHaveLength(1);
    expect(loaded.buildings[1].scoutLodge?.nextRecruitAt).toBe(50);
    loaded.time = 49.9; updateScoutLodges(loaded); expect(scouts(loaded)).toHaveLength(1);
    loaded.time = 50; updateScoutLodges(loaded); expect(scouts(loaded)).toHaveLength(2);
    const ids = scouts(loaded).map(unit => unit.id); updateScoutLodges(loaded);
    expect(scouts(loaded).map(unit => unit.id)).toEqual(ids);
  });

  it('does not catch up multiple missing recruits after a long delayed update', () => {
    const state = scoutRealm(); updateScoutLodges(state);
    entityStore(state).units.retain(unit => unit.kind !== 'scout'); updateScoutLodges(state);
    state.time = 1000; updateScoutLodges(state);
    expect(scouts(state)).toHaveLength(1); expect(state.buildings[1].scoutLodge?.nextRecruitAt).toBe(1015);
  });

  it('waits for occupied exits to clear without spawning inside walls or across water', () => {
    const state = scoutRealm(), lodge = state.buildings[1];
    const exits = constructionEdges(state, lodge);
    for (const [index, point] of exits.entries()) entityStore(state).units.add({ ...state.units[0], id: 500 + index, ...point, kind: 'worker' });
    updateScoutLodges(state); expect(scouts(state)).toHaveLength(0);
    expect(scoutLodgeStatus(state, lodge)).toMatchObject({ alive: 0, recruitingIn: 0, blocked: true });
    entityStore(state).units.retain(unit => unit.id < 500);
    for (const point of exits.slice(1)) state.world.tiles[Math.floor(point.y) * state.world.width + Math.floor(point.x)].terrain = 'river';
    state.world.revision!++; updateScoutLodges(state);
    expect(scouts(state)).toHaveLength(1); expect(scouts(state)[0]).toMatchObject(exits[0]);
    state.world.tiles[Math.floor(exits[1].y) * state.world.width + Math.floor(exits[1].x)].terrain = 'grassland';
    state.world.revision!++; state.time = 1; updateScoutLodges(state);
    expect(scouts(state)).toHaveLength(2);
  });

  it('respects forbidden recruitment areas and resumes when the area is allowed', () => {
    const state = scoutRealm(); setForbiddenRectangle(state, { x: 15, y: 9 }, { x: 17, y: 11 }, true);
    updateScoutLodges(state); expect(scouts(state)).toHaveLength(0);
    setForbiddenRectangle(state, { x: 15, y: 9 }, { x: 17, y: 11 }, false);
    updateScoutLodges(state); expect(scouts(state)).toHaveLength(2);
  });

  it('stops replacement when destroyed without deleting surviving explorers', () => {
    const state = scoutRealm(); updateScoutLodges(state);
    const survivor = scouts(state)[0]; entityStore(state).units.retain(unit => unit.kind !== 'scout' || unit.id === survivor.id);
    state.buildings[1].hp = 0; state.time = 100; updateScoutLodges(state);
    expect(scouts(state)).toEqual([survivor]);
    expect(scoutLodgeStatus(state, state.buildings[1]).recruitingIn).toBeNull();
  });

  it('gives a capturing owner their own two scouts while survivors retain their allegiance', () => {
    const state = scoutRealm(); updateScoutLodges(state); const old = scouts(state);
    state.factions.push({ ...state.factions[0], id: 1, relation: 'war' });
    state.buildings[1].faction = 1; updateScoutLodges(state);
    expect(scouts(state)).toEqual(old); expect(scouts(state, 1)).toHaveLength(2);
    expect(scoutLodgeStatus(state, state.buildings[1]).alive).toBe(2);
    state.time = 20; updateScoutLodges(state); expect(scouts(state, 1)).toHaveLength(2);
  });
});
