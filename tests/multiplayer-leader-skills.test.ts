import { describe, expect, it } from 'vitest';
import { awardLeaderXp, type LeaderSkillId } from '../src/game/leader-progression';
import { createDuelGame, getLeader } from '../src/game/simulation';
import { applyGameCommand } from '../src/multiplayer/commands';
import type { World } from '../src/game/types';

function fixture() {
  const world: World = { width: 64, height: 36, seed: 'multiplayer-leader-skills', source: 'fixture',
    spawns: [{ x: 8, y: 18 }, { x: 54, y: 18 }],
    tiles: Array.from({ length: 64 * 36 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .5,
      food: 3, production: 0, gold: 0, variation: .5 })) };
  return createDuelGame(world);
}

describe('authoritative multiplayer Leader skills', () => {
  it.each([0, 1])('learns only for authenticated player %s despite forged faction, unit, rank and point fields', actor => {
    const state = fixture(), own = getLeader(state, actor)!, enemy = getLeader(state, 1 - actor)!;
    awardLeaderXp(state, 800, actor);
    const opponent = structuredClone(enemy), gold = state.factions.map(faction => faction.gold);
    const context = { faction: state.playerFaction, selected: state.selected, selectedType: state.selectedType };
    expect(applyGameCommand(state, actor, { type: 'learnLeaderSkill', skill: 'power', faction: 1 - actor,
      unitId: enemy.id, rank: 3, skillPoints: 999 })).toMatchObject({ ok: true });
    expect(own.leaderProgression).toMatchObject({ level: 2, skillPoints: 0, skills: { power: 1, guard: 0, command: 0 } });
    expect(enemy).toEqual(opponent);
    expect(state.factions.map(faction => faction.gold)).toEqual(gold);
    expect({ faction: state.playerFaction, selected: state.selected, selectedType: state.selectedType }).toEqual(context);
  });

  it.each([undefined, null, '', 'POWER', 'speed', '__proto__', 3, {}, [], true])('rejects invalid skill %j before changing progression', skill => {
    const state = fixture(); awardLeaderXp(state, 800, 1);
    const leaders = structuredClone(state.units.filter(unit => unit.kind === 'leader'));
    expect(applyGameCommand(state, 1, { type: 'learnLeaderSkill', skill })).toEqual({ ok: false, message: 'Invalid command.' });
    expect(state.units.filter(unit => unit.kind === 'leader')).toEqual(leaders);
    expect(state.playerFaction).toBe(0);
  });

  it.each([0, 1])('does not overspend player %s\'s sole earned point when commands arrive consecutively', actor => {
    const state = fixture(), leader = getLeader(state, actor)!;
    expect(applyGameCommand(state, actor, { type: 'learnLeaderSkill', skill: 'guard', skillPoints: 100 })).toMatchObject({ ok: false });
    awardLeaderXp(state, 800, actor);
    expect(applyGameCommand(state, actor, { type: 'learnLeaderSkill', skill: 'guard' })).toMatchObject({ ok: true });
    const afterPurchase = structuredClone(leader);
    expect(applyGameCommand(state, actor, { type: 'learnLeaderSkill', skill: 'command', skillPoints: 100 })).toMatchObject({ ok: false });
    expect(applyGameCommand(state, actor, { type: 'learnLeaderSkill', skill: 'guard' })).toMatchObject({ ok: false });
    expect(leader).toEqual(afterPurchase);
    expect(leader.leaderProgression?.skillPoints).toBe(0);
  });

  it.each<LeaderSkillId>(['power', 'guard', 'command'])('enforces rank three for %s without consuming an extra point', skill => {
    const state = fixture(), leader = getLeader(state, 1)!;
    awardLeaderXp(state, 100_000, 1);
    for (let rank = 1; rank <= 3; rank++) {
      expect(applyGameCommand(state, 1, { type: 'learnLeaderSkill', skill })).toMatchObject({ ok: true });
      expect(leader.leaderProgression?.skills[skill]).toBe(rank);
    }
    const capped = structuredClone(leader), unspent = leader.leaderProgression!.skillPoints;
    expect(unspent).toBeGreaterThan(0);
    expect(applyGameCommand(state, 1, { type: 'learnLeaderSkill', skill })).toMatchObject({ ok: false });
    expect(leader).toEqual(capped);
    const otherSkill = skill === 'power' ? 'guard' : 'power';
    expect(applyGameCommand(state, 1, { type: 'learnLeaderSkill', skill: otherSkill })).toMatchObject({ ok: true });
    expect(leader.leaderProgression?.skillPoints).toBe(unspent - 1);
  });

  it('rejects unavailable actors and ended matches without spending points', () => {
    const state = fixture(); awardLeaderXp(state, 800, 0); awardLeaderXp(state, 800, 1);
    const before = structuredClone(state.units.filter(unit => unit.kind === 'leader'));
    expect(applyGameCommand(state, 2, { type: 'learnLeaderSkill', skill: 'power' })).toMatchObject({ ok: false });
    state.factions[1].defeated = true;
    expect(applyGameCommand(state, 1, { type: 'learnLeaderSkill', skill: 'guard' })).toMatchObject({ ok: false });
    state.gameOver = true;
    expect(applyGameCommand(state, 0, { type: 'learnLeaderSkill', skill: 'command' })).toMatchObject({ ok: false });
    expect(state.units.filter(unit => unit.kind === 'leader')).toEqual(before);
  });
});
