import { describe, expect, it } from 'vitest';
import { desiredRetinueSize, retinueComposition } from '../src/game/archery';
import { applyFactionEquipment } from '../src/game/blacksmith';
import { entityStore } from '../src/game/entity-store';
import { parseGameSave, serializeGameSave } from '../src/game/game-save';
import { awardLeaderXp, earnsLeaderCombatXp, initialLeaderProgression, leaderProgressionView, leaderRetinueBonus,
  leaderXpRequired, learnLeaderSkill, readLeaderProgression, type LeaderSkillId } from '../src/game/leader-progression';
import { withPlayerFaction } from '../src/game/player-context';
import { retinueSlotUpkeep } from '../src/game/retinue-purchases';
import { getLeader, respawnLeader, updateGame } from '../src/game/simulation';
import type { Faction, GameState, Unit } from '../src/game/types';
import { unitAttack, unitDefense } from '../src/game/veterancy';

const idle = { up: false, down: false, left: false, right: false };
const person = (id: number, kind: Unit['kind'], x = 12.5, y = 12.5, faction = 0): Unit => ({
  id, kind, faction, x, y, hp: 100, maxHp: 100, morale: 100, attack: 25, defense: 5,
  speed: 0, range: kind === 'leader' || kind === 'archer' ? 4 : 1.1, order: 'hold', cooldown: 0,
  lastCombat: -60, lastDamagedAt: 0, moving: false, facing: 0, attackTime: 0,
});
function fixture(): GameState {
  return {
    world: { width: 32, height: 24, seed: 'leader-xp', source: 'test', spawns: [],
      tiles: Array.from({ length: 768 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
        moisture: .6, food: 3, production: 0, gold: 1, variation: .5 })) },
    units: [{ ...person(10, 'leader', 3.5, 3.5), leaderProgression: initialLeaderProgression(), cooldown: 100 }],
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 2, y: 6, hp: 650, maxHp: 650, capacity: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 500,
      production: 0, population: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, nextRetinueAt: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'leader-xp', rngState: 1,
    fields: [], marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1,
    fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 2 },
  };
}
function lethalShot(state: GameState, attacker: Unit, target: Unit): void {
  (state.projectiles ??= []).push({ x: attacker.x, y: attacker.y, start: { x: attacker.x, y: attacker.y },
    end: { x: target.x, y: target.y }, attacker: attacker.id, target: target.id, faction: attacker.faction,
    damage: 500, elapsed: 0, duration: .01 });
}

describe('Leader XP and skills', () => {
  it('reads fresh progression without mutating the Leader or leaking writable ranks', () => {
    const state = fixture(), leader = getLeader(state)!; delete leader.leaderProgression;
    const before = structuredClone(leader), view = leaderProgressionView(state)!;
    expect(view).toMatchObject({ level: 1, xp: 0, xpRequired: 19200, skillPoints: 0 });
    expect(view.skills.every(skill => !skill.canLearn && skill.rank === 0)).toBe(true);
    expect(leader).toEqual(before);
    leader.leaderProgression = initialLeaderProgression();
    const read = readLeaderProgression(leader);
    expect(read.skills).not.toBe(leader.leaderProgression.skills);
  });

  it('crosses increasing thresholds, carries XP and applies each bonus once while preserving wounds', () => {
    const state = fixture(), leader = getLeader(state)!; leader.hp = 35;
    expect(awardLeaderXp(state, 15360)).toBe(0);
    expect(leader).toMatchObject({ hp: 35, maxHp: 100, attack: 25 });
    expect(awardLeaderXp(state, 3840)).toBe(1);
    expect(leader).toMatchObject({ hp: 45, maxHp: 110, attack: 26 });
    expect(readLeaderProgression(leader)).toMatchObject({ level: 2, xp: 0, skillPoints: 1 });
    expect(awardLeaderXp(state, 130560)).toBe(2);
    expect(readLeaderProgression(leader)).toMatchObject({ level: 4, xp: 34560, skillPoints: 3 });
    expect(leader).toMatchObject({ hp: 65, maxHp: 130, attack: 28 });
    expect(leaderXpRequired(4)).toBe(76800);
    for (let i = 0; i < 10; i++) leaderProgressionView(state);
    expect(leader).toMatchObject({ hp: 65, maxHp: 130, attack: 28 });
  });

  it.each([0, -20, NaN, Infinity])('ignores invalid XP amount %s', amount => {
    const state = fixture(), before = structuredClone(getLeader(state));
    expect(awardLeaderXp(state, amount)).toBe(0);
    expect(getLeader(state)).toEqual(before);
  });

  it('spends each point once and previews effective attack and defense with equipment and veterancy', () => {
    const state = fixture(), leader = getLeader(state)!;
    state.factions[0].weaponLevel = 3; state.factions[0].armorLevel = 2;
    leader.kills = 100; applyFactionEquipment(state, 0);
    awardLeaderXp(state, 57600);
    const power = leaderProgressionView(state)!.skills.find(skill => skill.id === 'power')!;
    expect(learnLeaderSkill(state, 'power').ok).toBe(true);
    expect(unitAttack(leader)).toBeCloseTo(power.nextAttack);
    const guard = leaderProgressionView(state)!.skills.find(skill => skill.id === 'guard')!;
    expect(learnLeaderSkill(state, 'guard').ok).toBe(true);
    expect(unitDefense(leader)).toBeCloseTo(guard.nextDefense);
    expect(leader).toMatchObject({ attack: 29, defense: 6, weaponLevel: 3, armorLevel: 2, kills: 100 });
    const before = structuredClone(leader);
    expect(learnLeaderSkill(state, 'command').ok).toBe(false);
    expect(learnLeaderSkill(state, 'unknown' as LeaderSkillId).ok).toBe(false);
    expect(leader).toEqual(before);
    applyFactionEquipment(state, 0);
    expect(leader).toEqual(before);
  });

  it.each<LeaderSkillId>(['power', 'guard', 'command'])('caps %s at ten ranks without consuming another point', skill => {
    const state = fixture(); awardLeaderXp(state, 1267200);
    for (let rank = 1; rank <= 10; rank++) expect(learnLeaderSkill(state, skill).ok).toBe(true);
    const before = structuredClone(getLeader(state));
    expect(learnLeaderSkill(state, skill).ok).toBe(false);
    expect(getLeader(state)).toEqual(before);
    const view = leaderProgressionView(state)!.skills.find(row => row.id === skill)!;
    expect(view).toMatchObject({ rank: 10, maxRank: 10, canLearn: false });
  });

  it('adds Command to retinue recruitment/composition capacity without purchased-slot upkeep', () => {
    const state = fixture(), leader = getLeader(state)!, faction = state.factions[0];
    faction.purchasedRetinueSlots = 2;
    const initial = retinueComposition(state, 0).total, upkeep = retinueSlotUpkeep(faction);
    awardLeaderXp(state, 1056000);
    for (let rank = 1; rank <= 10; rank++) {
      expect(learnLeaderSkill(state, 'command').ok).toBe(true);
      expect(desiredRetinueSize(faction, leader)).toBe(initial + rank);
      expect(retinueComposition(state, 0).total).toBe(initial + rank);
      expect(retinueSlotUpkeep(faction)).toBe(upkeep);
    }
    leader.hp = 0;
    expect(leaderRetinueBonus(leader)).toBe(0);
    expect(retinueComposition(state, 0).total).toBe(initial);
  });

  it('fills a newly learned Command slot through the normal settlement recruit clock', () => {
    const state = fixture(), faction = state.factions[0];
    entityStore(state).units.add(...Array.from({ length: 4 }, (_, index) => person(20 + index, 'warrior', 10.5 + index, 10.5)));
    faction.nextRetinueAt = 0; updateGame(state, .1, idle);
    expect(state.units.filter(unit => unit.kind === 'warrior')).toHaveLength(4);
    awardLeaderXp(state, 19200); learnLeaderSkill(state, 'command');
    faction.nextRetinueAt = state.time; updateGame(state, .4, idle);
    expect(state.units.filter(unit => unit.kind === 'warrior')).toHaveLength(5);
    expect(state.units.find(unit => unit.kind === 'warrior' && unit.home === 1)?.joiningRetinue).toBe(true);
    expect(faction.nextRetinueAt).toBeGreaterThan(state.time);
  });

  it('persists XP, ranks and bonuses through an ordinary game save without applying them again', () => {
    const state = fixture(); awardLeaderXp(state, 149760); learnLeaderSkill(state, 'power'); learnLeaderSkill(state, 'command');
    const before = structuredClone(getLeader(state)!);
    const restored = parseGameSave(serializeGameSave(state));
    expect(getLeader(restored)).toEqual(before);
    expect(leaderProgressionView(restored)).toMatchObject({ level: 4, xp: 34560, skillPoints: 1, maxHp: 130 });
    expect(retinueComposition(restored, 0).total).toBe(retinueComposition(state, 0).total);
  });

  it('does not award or learn after defeat and a replacement Leader starts at level one', () => {
    const state = fixture(), dead = getLeader(state)!;
    awardLeaderXp(state, 115200); learnLeaderSkill(state, 'power'); learnLeaderSkill(state, 'command');
    dead.hp = 0; state.gameOver = true; state.factions[0].defeated = true;
    const before = structuredClone(dead);
    expect(awardLeaderXp(state, 19200)).toBe(0); expect(learnLeaderSkill(state, 'guard').ok).toBe(false);
    expect(dead).toEqual(before); expect(leaderProgressionView(state)).toBeUndefined();
    const result = respawnLeader(state);
    expect(result.ok).toBe(true);
    expect(result.leader).toMatchObject({ maxHp: 100, attack: 25, defense: 5, leaderProgression: initialLeaderProgression() });
  });

  it('rejects spending another faction\'s points outside its authenticated context', () => {
    const state = fixture(), second = { ...state.factions[0], id: 1, relation: 'war' } as Faction;
    state.factions.push(second); entityStore(state).units.add(person(30, 'leader', 25.5, 20.5, 1));
    awardLeaderXp(state, 19200, 1);
    expect(learnLeaderSkill(state, 'power', 1).ok).toBe(false);
    expect(withPlayerFaction(state, 1, () => learnLeaderSkill(state, 'power', 1)).ok).toBe(true);
    expect(readLeaderProgression(getLeader(state)!)).toEqual(initialLeaderProgression());
  });
});

describe('combat XP attribution', () => {
  it('credits the killer faction while the local player is viewing another Leader', () => {
    const state = fixture(); state.playerFaction = 0;
    state.factions.push({ ...state.factions[0], id: 1, relation: 'war' });
    entityStore(state).buildings.add({ ...state.buildings[0], id: 2, faction: 1, x: 25, y: 19 });
    const otherLeader = person(30, 'leader', 25.5, 20.5, 1);
    const attacker = { ...person(20, 'archer', 12.5, 12.5, 1), cooldown: 100 };
    const target = { ...person(21, 'warrior', 13.5, 12.5, -2), hp: 1, cooldown: 100 };
    entityStore(state).units.add(otherLeader, attacker, target); lethalShot(state, attacker, target);
    updateGame(state, .1, idle);
    expect(readLeaderProgression(otherLeader).xp).toBe(2);
    expect(readLeaderProgression(getLeader(state)!).xp).toBe(0);
  });

  it.each(['warrior', 'spearman', 'horseman'] as const)('awards once for an actual %s melee kill', kind => {
    const state = fixture(), attacker = person(20, kind), target = { ...person(21, 'warrior', 13.5, 12.5, -2), hp: 1, cooldown: 100 };
    entityStore(state).units.add(attacker, target);
    updateGame(state, .1, idle);
    expect(target.hp).toBe(0);
    expect(readLeaderProgression(getLeader(state)!).xp).toBe(2);
    updateGame(state, .1, idle);
    expect(readLeaderProgression(getLeader(state)!).xp).toBe(2);
  });

  it.each(['leader', 'archer'] as const)('awards XP from a real %s projectile', kind => {
    const state = fixture(), leader = getLeader(state)!;
    const attacker = kind === 'leader' ? Object.assign(leader, { x: 12.5, y: 12.5, cooldown: 0 }) : person(20, kind);
    const target = { ...person(21, 'warrior', 15.5, 12.5, -2), hp: 1, cooldown: 100 };
    entityStore(state).units.add(...(kind === 'leader' ? [target] : [attacker, target]));
    updateGame(state, .05, idle);
    expect(state.projectiles?.find(shot => shot.attacker === attacker.id)?.leaderXp).toBe(kind === 'leader' ? 20 : 2);
    updateGame(state, .4, idle);
    expect(target.hp).toBe(0);
    expect(readLeaderProgression(leader).xp).toBe(kind === 'leader' ? 20 : 2);
  });

  it('retains archer kill credit after its death while the arrow is in flight', () => {
    const state = fixture(), archer = person(20, 'archer'), target = { ...person(21, 'warrior', 15.5, 12.5, -2), hp: 1, cooldown: 100 };
    // Launch just before the next corpse cleanup so the archer is actually
    // removed while its projectile is still in flight. Both units are present
    // for the initial visibility sample; only the firing cooldown is delayed.
    archer.cooldown = .34;
    entityStore(state).units.add(archer, target); updateGame(state, .4, idle);
    expect(state.projectiles?.some(shot => shot.attacker === archer.id)).toBe(true);
    archer.hp = 0; updateGame(state, .05, idle);
    expect(state.units).not.toContain(archer);
    expect(state.projectiles?.some(shot => shot.attacker === archer.id)).toBe(true);
    expect(target.hp).toBe(1);
    updateGame(state, .3, idle);
    expect(target.hp).toBe(0);
    expect(readLeaderProgression(getLeader(state)!).xp).toBe(2);
  });

  it('does not award twice when two projectiles hit the same casualty', () => {
    const state = fixture(), attacker = { ...person(20, 'archer'), cooldown: 100 }, target = { ...person(21, 'warrior', 13.5, 12.5, -2), hp: 1, cooldown: 100 };
    entityStore(state).units.add(attacker, target);
    lethalShot(state, attacker, target); lethalShot(state, attacker, target);
    updateGame(state, .1, idle);
    expect(readLeaderProgression(getLeader(state)!).xp).toBe(2);
  });

  it.each(['worker', 'merchant', 'boar', 'scout'] as const)('does not award XP for a %s victim', kind => {
    const state = fixture(), attacker = { ...person(20, 'archer'), cooldown: 100 }, target = { ...person(21, kind, 13.5, 12.5, -2), hp: 1, cooldown: 100 };
    entityStore(state).units.add(attacker, target); lethalShot(state, attacker, target);
    updateGame(state, .1, idle);
    expect(readLeaderProgression(getLeader(state)!).xp).toBe(0);
  });

  it('does not award XP for friendly victims or militia/building kills', () => {
    const state = fixture(), militia = { ...person(20, 'militia'), cooldown: 100 }, target = { ...person(21, 'warrior', 13.5, 12.5, -2), hp: 1, cooldown: 100 };
    entityStore(state).units.add(militia, target); lethalShot(state, militia, target);
    updateGame(state, .1, idle);
    expect(readLeaderProgression(getLeader(state)!).xp).toBe(0);
    const ally = { ...person(22, 'warrior', 13.5, 12.5), cooldown: 100 };
    entityStore(state).units.add(ally); lethalShot(state, getLeader(state)!, ally);
    updateGame(state, .1, idle);
    expect(ally.hp).toBe(100); expect(readLeaderProgression(getLeader(state)!).xp).toBe(0);
    expect(earnsLeaderCombatXp(undefined)).toBe(false);
    expect(earnsLeaderCombatXp({ ...militia, kind: 'warrior', marauderPack: 1 })).toBe(false);
  });
});
