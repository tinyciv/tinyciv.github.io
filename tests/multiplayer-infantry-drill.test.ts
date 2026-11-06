import { describe, expect, it } from 'vitest';
import { createDuelGame, getLeader } from '../src/game/simulation';
import { infantryFormationActive, infantryFormationSoldierCount } from '../src/game/infantry-drill';
import { applyGameCommand } from '../src/multiplayer/commands';
import { entityStore } from '../src/game/entity-store';
import { isSoldier, type World } from '../src/game/types';

function fixture(unlocked = true) {
  const world: World = { width: 64, height: 36, seed: 'multiplayer-drill', source: 'fixture', spawns: [{ x: 8, y: 18 }, { x: 54, y: 18 }],
    tiles: Array.from({ length: 64 * 36 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .5, food: 3, production: 0, gold: 0, variation: .5 })) };
  const state = createDuelGame(world);
  if (unlocked) for (const faction of state.factions) faction.research = { focus: 'infantryDrill', levels: { infantryDrill: 1 }, progress: {} };
  let id = Math.max(...state.units.map(unit => unit.id), ...state.buildings.map(building => building.id)) + 1;
  for (const faction of state.factions) {
    const recruit = state.units.find(unit => unit.faction === faction.id && isSoldier(unit) && unit.guardPost === undefined)!;
    while (infantryFormationSoldierCount(state, faction.id) < 8)
      entityStore(state).units.add({ ...recruit, id: id++, inside: false, training: undefined, joiningRetinue: undefined });
  }
  return state;
}

describe('authoritative multiplayer Infantry Drill', () => {
  it.each([0, 1])('toggles only authenticated faction %s, ignoring forged targets', actor => {
    const state = fixture(), enemy = getLeader(state, 1 - actor)!;
    const otherBefore = structuredClone(enemy), context = { faction: state.playerFaction, selected: state.selected };
    const forged = { faction: 1 - actor, leaderId: enemy.id, unitId: enemy.id };
    expect(applyGameCommand(state, actor, { type: 'infantry-formation', ...forged })).toMatchObject({ ok: true });
    expect(infantryFormationActive(state, actor)).toBe(true); expect(infantryFormationActive(state, 1 - actor)).toBe(false);
    expect(enemy).toEqual(otherBefore);
    expect({ faction: state.playerFaction, selected: state.selected }).toEqual(context);
    expect(applyGameCommand(state, actor, { type: 'infantry-formation' })).toMatchObject({ ok: true });
    expect(infantryFormationActive(state, actor)).toBe(false);
  });

  it('rejects unresearched formation and rotation instead of trusting client unlock fields', () => {
    const state = fixture(false);
    expect(applyGameCommand(state, 1, { type: 'infantry-formation', researched: true, infantryDrill: 1 })).toMatchObject({ ok: false });
    expect(applyGameCommand(state, 1, { type: 'infantry-rotate', direction: 1 })).toMatchObject({ ok: false });
    expect(infantryFormationActive(state, 1)).toBe(false);
  });

  it.each([0, 1])('counts only authenticated faction %s living soldiers toward the eight-soldier requirement', actor => {
    const state = fixture(), casualty = state.units.find(unit => unit.faction === actor && isSoldier(unit))!;
    casualty.hp = 0;
    expect(infantryFormationSoldierCount(state, actor)).toBe(7);
    expect(infantryFormationSoldierCount(state, 1 - actor)).toBe(8);
    expect(applyGameCommand(state, actor, { type: 'infantry-formation', faction: 1 - actor, soldierCount: 8 }))
      .toMatchObject({ ok: false, message: 'Formation requires 8 living retinue soldiers.' });
    expect(infantryFormationActive(state, actor)).toBe(false);
    expect(applyGameCommand(state, 1 - actor, { type: 'infantry-formation' }).ok).toBe(true);
    casualty.hp = casualty.maxHp ?? 100;
    expect(applyGameCommand(state, actor, { type: 'infantry-formation' }).ok).toBe(true);
    expect(infantryFormationActive(state, actor)).toBe(true);
  });

  it.each([-1, 1, undefined, null, 0, 2, -2, .5, '1', {}, true, NaN])('rejects removed discrete rotation command (%j) without changing the army', direction => {
    const state = fixture(); applyGameCommand(state, 1, { type: 'infantry-formation' });
    const before = structuredClone(getLeader(state, 1)!.infantryFormation);
    expect(applyGameCommand(state, 1, { type: 'infantry-rotate', direction })).toEqual({ ok: false, message: 'Invalid command.' });
    expect(getLeader(state, 1)!.infantryFormation).toEqual(before);
  });

  it('rejects unavailable actors, ended matches, and Leaders aboard a boat', () => {
    const state = fixture();
    expect(applyGameCommand(state, 9, { type: 'infantry-formation' }).ok).toBe(false);
    getLeader(state, 1)!.embarkedOn = 999;
    expect(applyGameCommand(state, 1, { type: 'infantry-formation' }).ok).toBe(false);
    state.gameOver = true;
    expect(applyGameCommand(state, 0, { type: 'infantry-formation' }).ok).toBe(false);
    expect(infantryFormationActive(state, 0)).toBe(false);
  });
});
