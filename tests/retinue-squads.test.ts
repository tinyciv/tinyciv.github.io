import { describe, expect, it } from 'vitest';
import { setSoldierRole } from '../src/game/archery';
import { entityStore } from '../src/game/entity-store';
import { parseGameSave, serializeGameSave } from '../src/game/game-save';
import { joinRetinueSquad, recordRetinueKill, RETINUE_SQUAD_SIZE, synchronizeRetinueSquads } from '../src/game/retinue-squads';
import { updateGame } from '../src/game/simulation';
import { unitAttack, unitDefense, veterancy } from '../src/game/veterancy';
import type { Faction, GameState, Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const soldier = (id: number, faction = 0): Unit => ({ id, kind: 'warrior', faction,
  x: 10.5 + id, y: 10.5, hp: 100, maxHp: 100, morale: 100, attack: 17, defense: 4,
  speed: 3.96, range: 1.1, order: 'hold', cooldown: 0, lastCombat: -60,
  moving: false, facing: 0, attackTime: 0 });
const faction = (id: number): Faction => ({ id, name: `Faction ${id}`, color: '#f34f59', affinity: 100,
  relation: id === 0 ? 'self' : 'peace', food: 500, gold: 500, production: 0, population: 0,
  yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, nextRetinueAt: Infinity, defeated: false });
function fixture(count = 4): GameState {
  return { world: { width: 40, height: 30, seed: 'squads', source: 'test', spawns: [],
    tiles: Array.from({ length: 1200 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
      moisture: .5, food: 2, production: 0, gold: 0, variation: .5 })) },
    units: Array.from({ length: count }, (_, i) => soldier(i + 1)),
    buildings: [{ id: 100, kind: 'palace', faction: 0, x: 3, y: 18, hp: 650, maxHp: 650, capacity: 0,
      populationGrowth: -10000, governorPermissions: { farms: false, housing: false } }],
    factions: [faction(0), faction(1)], time: 0, tick: 0, paused: false, speed: 1,
    events: [], particles: [], fields: [], selected: null, selectedType: null, buildMode: null,
    diplomacy: null, gameOver: false, victory: false, seed: 'squads', rngState: 17,
    marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1,
    fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 1 },
    wildlife: { herds: [], sequence: 0, nextRespawnAt: Infinity, targetHerds: 0 } };
}
function recruit(state: GameState, id: number, factionId = 0): Unit {
  const unit = soldier(id, factionId); entityStore(state).units.add(unit);
  joinRetinueSquad(state, unit); return unit;
}

describe('retinue squads', () => {
  it('groups soldiers in threes with a partial last squad, without changing headcount', () => {
    const state = fixture(8); synchronizeRetinueSquads(state);
    expect(RETINUE_SQUAD_SIZE).toBe(3);
    expect(state.retinueSquads).toHaveLength(3);
    expect(state.retinueSquads!.map(squad => state.units.filter(unit => unit.retinueSquad === squad.id).length)).toEqual([3, 3, 2]);
    expect(state.units).toHaveLength(8);
    const ids = state.units.map(unit => unit.retinueSquad);
    synchronizeRetinueSquads(state); expect(state.units.map(unit => unit.retinueSquad)).toEqual(ids);
  });

  it('pools kills once and applies the existing rank bonuses to all squad members', () => {
    const state = fixture(); synchronizeRetinueSquads(state);
    for (let i = 0; i < 9; i++) expect(recordRetinueKill(state, state.units[i % 3])).toBe(true);
    expect(state.units.slice(0, 3).map(unit => unit.kills)).toEqual([9, 9, 9]);
    expect(state.units.slice(0, 3).map(veterancy)).toEqual([0, 0, 0]);
    recordRetinueKill(state, state.units[1]);
    expect(state.retinueSquads![0].kills).toBe(10);
    for (const unit of state.units.slice(0, 3)) {
      expect(unit.kills).toBe(10); expect(veterancy(unit)).toBe(1);
      expect(unitAttack(unit)).toBeCloseTo(14); expect(unitDefense(unit)).toBe(6);
      expect(unit.attack).toBe(17); expect(unit.defense).toBe(4);
    }
    expect(state.units[3].kills ?? 0).toBe(0);
  });

  it('preserves a wounded lone survivor and gives replacements its squad veterancy', () => {
    const state = fixture(3); synchronizeRetinueSquads(state);
    for (let i = 0; i < 100; i++) recordRetinueKill(state, state.units[0]);
    const survivor = state.units[2], squadId = survivor.retinueSquad;
    state.units[0].hp = state.units[1].hp = 0; survivor.hp = 27;
    synchronizeRetinueSquads(state);
    expect(state.retinueSquads).toEqual([{ id: squadId, faction: 0, kills: 100 }]);
    const first = recruit(state, 20), second = recruit(state, 21);
    for (const unit of [survivor, first, second]) {
      expect(unit.retinueSquad).toBe(squadId); expect(unit.kills).toBe(100); expect(veterancy(unit)).toBe(2);
    }
    expect(survivor.hp).toBe(27); expect(first.hp).toBe(100);
  });

  it('retires a wiped squad and starts its replacements without experience or reused identity', () => {
    const state = fixture(3); synchronizeRetinueSquads(state);
    const oldId = state.retinueSquads![0].id;
    for (let i = 0; i < 10; i++) recordRetinueKill(state, state.units[0]);
    state.units.forEach(unit => { unit.hp = 0; });
    // Recruitment must notice the wipe even before the next periodic sync.
    const replacement = recruit(state, 20);
    expect(replacement.retinueSquad).not.toBe(oldId);
    expect(replacement.kills ?? 0).toBe(0); expect(veterancy(replacement)).toBe(0);
    expect(state.retinueSquads!.some(squad => squad.id === oldId)).toBe(false);
  });

  it('never merges surviving squads and fills the oldest surviving squad first', () => {
    const state = fixture(6); synchronizeRetinueSquads(state);
    const firstId = state.units[0].retinueSquad, secondId = state.units[3].retinueSquad;
    for (const index of [1, 2, 4, 5]) state.units[index].hp = 0;
    synchronizeRetinueSquads(state);
    expect(state.retinueSquads).toHaveLength(2);
    expect(state.units[0].retinueSquad).toBe(firstId); expect(state.units[3].retinueSquad).toBe(secondId);
    expect(recruit(state, 20).retinueSquad).toBe(firstId);
    expect(recruit(state, 21).retinueSquad).toBe(firstId);
    expect(recruit(state, 22).retinueSquad).toBe(secondId);
  });

  it('keeps squads and kill credit isolated by faction', () => {
    const state = fixture(2); entityStore(state).units.add(soldier(3, 1), soldier(4, 1));
    synchronizeRetinueSquads(state);
    expect(state.units[0].retinueSquad).not.toBe(state.units[2].retinueSquad);
    recordRetinueKill(state, state.units[0]);
    expect(state.units.map(unit => unit.kills ?? 0)).toEqual([1, 1, 0, 0]);
    expect(recruit(state, 20, 1).retinueSquad).toBe(state.units[2].retinueSquad);
  });

  it('excludes Leaders, guards, civilians, and raiders from retinue experience', () => {
    const state = fixture(0);
    const excluded: Unit[] = [
      { ...soldier(1), kind: 'leader', kills: 99 }, { ...soldier(2), kind: 'militia', guardPost: 100, kills: 10 },
      { ...soldier(3), kind: 'worker', kills: 0 }, { ...soldier(4, -2), kills: 20 },
      { ...soldier(5), marauderPack: 1, kills: 30 },
    ];
    entityStore(state).units.add(...excluded); synchronizeRetinueSquads(state);
    expect(state.retinueSquads ?? []).toHaveLength(0);
    for (const unit of excluded) { expect(unit.retinueSquad).toBeUndefined(); expect(recordRetinueKill(state, unit)).toBe(false); }
    expect(excluded.map(unit => unit.kills)).toEqual([99, 10, 0, 20, 30]);
  });

  it('keeps squad membership and experience when warriors retrain as archers', () => {
    const state = fixture(3); synchronizeRetinueSquads(state);
    const unit = state.units[0], squadId = unit.retinueSquad;
    for (let i = 0; i < 10; i++) recordRetinueKill(state, unit);
    unit.hp = 60; setSoldierRole(unit, 'archer'); synchronizeRetinueSquads(state);
    expect(unit.retinueSquad).toBe(squadId); expect(unit.kills).toBe(10);
    expect(unit.hp).toBeCloseTo(40); expect(unitAttack(unit)).toBeCloseTo(11.62); expect(unitDefense(unit)).toBe(4);
    recordRetinueKill(state, unit); expect(state.units.map(unit => unit.kills)).toEqual([11, 11, 11]);
  });

  it('preserves squad identities, shared experience, and replacement inheritance through saving', () => {
    const state = fixture(3); synchronizeRetinueSquads(state);
    for (let i = 0; i < 10; i++) recordRetinueKill(state, state.units[0]);
    state.units[0].hp = state.units[1].hp = 0; synchronizeRetinueSquads(state);
    const loaded = parseGameSave(serializeGameSave(state)); synchronizeRetinueSquads(loaded);
    expect(loaded.retinueSquads).toEqual(state.retinueSquads);
    expect(loaded.nextRetinueSquadId).toBe(state.nextRetinueSquadId);
    const replacement = recruit(loaded, 20);
    expect(replacement.retinueSquad).toBe(state.units[2].retinueSquad); expect(replacement.kills).toBe(10);
  });

  it('leaves movement, individual health, selection, and standing orders unchanged', () => {
    const state = fixture(3), unit = state.units[0];
    Object.assign(unit, { hp: 42, retinueStance: 'hold', target: 77, destination: { x: 20, y: 20 },
      path: [{ x: 12, y: 10 }, { x: 13, y: 10 }], defensiveAnchor: { x: 11, y: 10 } });
    state.selected = unit.id; state.selectedType = 'unit';
    const before = structuredClone(unit); synchronizeRetinueSquads(state); recordRetinueKill(state, unit);
    const { retinueSquad: _squad, kills: _kills, ...after } = unit;
    expect(after).toEqual(before); expect(state.selected).toBe(unit.id); expect(state.selectedType).toBe('unit');
  });

  it('credits an actual combat kill to surviving squadmates through the simulation', () => {
    const state = fixture(3), attacker = state.units[0];
    entityStore(state).units.add({ ...soldier(90), kind: 'leader', x: 5.5, y: 20.5, attack: 0 });
    attacker.x = 10.5; attacker.y = 10.5;
    state.units[1].x = 20.5; state.units[2].x = 22.5;
    synchronizeRetinueSquads(state);
    for (let i = 0; i < 9; i++) recordRetinueKill(state, attacker);
    entityStore(state).units.add({ ...soldier(91, -2), x: 11.5, y: 10.5, hp: 1, speed: 0, attack: 0 });
    updateGame(state, .1, idle);
    expect(state.units.slice(0, 3).map(unit => unit.kills)).toEqual([10, 10, 10]);
    expect(state.factions[0].gold).toBe(506);
  });

  it('recruits palace replacements one at a time into a surviving squad without exceeding capacity', () => {
    const state = fixture(), survivor = state.units[2];
    entityStore(state).units.add({ ...soldier(90), kind: 'leader', x: 5.5, y: 20.5, attack: 0 });
    synchronizeRetinueSquads(state);
    for (let i = 0; i < 10; i++) recordRetinueKill(state, survivor);
    const squadId = survivor.retinueSquad;
    state.units[0].hp = state.units[1].hp = 0;
    state.factions[0].nextRetinueAt = 0;
    const living = () => state.units.filter(unit => unit.faction === 0 && unit.kind === 'warrior' && unit.hp > 0);
    updateGame(state, .1, idle);
    expect(living()).toHaveLength(3);
    const first = living().find(unit => unit.id !== 3 && unit.id !== 4)!;
    expect(first.retinueSquad).toBe(squadId); expect(first.kills).toBe(10);
    expect(first.joiningRetinue).toBe(true);
    expect(Math.hypot(first.x - 4, first.y - 19)).toBeLessThan(4);
    const recruitInterval = state.factions[0].nextRetinueAt! - state.time;
    updateGame(state, recruitInterval - .2, idle); expect(living()).toHaveLength(3);
    updateGame(state, .3, idle); expect(living()).toHaveLength(4);
    expect(living().filter(unit => unit.retinueSquad === squadId)).toHaveLength(3);
    expect(living().filter(unit => unit.retinueSquad === squadId).every(unit => unit.kills === 10)).toBe(true);
    updateGame(state, recruitInterval + .1, idle); expect(living()).toHaveLength(4);
  });

  it('discards shared experience when combat kills the final survivor before later recruitment', () => {
    const state = fixture(3), victim = state.units[0];
    entityStore(state).units.add({ ...soldier(90), kind: 'leader', x: 5.5, y: 20.5, attack: 0 });
    synchronizeRetinueSquads(state);
    for (let i = 0; i < 10; i++) recordRetinueKill(state, victim);
    const oldId = victim.retinueSquad;
    victim.hp = 1; victim.attack = 0; victim.x = 10.5; victim.y = 10.5;
    state.units[1].hp = state.units[2].hp = 0;
    entityStore(state).units.add({ ...soldier(91, -2), x: 11.5, y: 10.5, attack: 100, speed: 0 });
    updateGame(state, .1, idle);
    expect(victim.hp).toBeLessThanOrEqual(0);
    updateGame(state, .4, idle); // Squad cleanup runs on the capped maintenance clock.
    expect(state.retinueSquads!.some(squad => squad.id === oldId)).toBe(false);
    state.factions[0].nextRetinueAt = 0; updateGame(state, .4, idle);
    const replacement = state.units.find(unit => unit.kind === 'warrior' && unit.faction === 0 && unit.hp > 0)!;
    expect(replacement).toBeDefined(); expect(replacement.retinueSquad).not.toBe(oldId);
    expect(replacement.kills ?? 0).toBe(0); expect(veterancy(replacement)).toBe(0);
  });
});
