import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { ensureMarauderLeaders } from '../src/game/marauder-leaders';
import { getFactionStrategy } from '../src/game/faction-strategy';
import { updateGame } from '../src/game/simulation';
import { type Faction, type GameState, type Unit, distance } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
function unit(id: number, kind: 'leader' | 'warrior', faction: number, x: number, y: number): Unit {
  return { id, kind, faction, x, y, hp: 100, maxHp: 100, morale: 100,
    attack: kind === 'leader' ? 25 : 17, defense: kind === 'leader' ? 5 : 4,
    speed: kind === 'leader' ? 3.6 : 3.96, range: kind === 'leader' ? 4 : 1.1,
    order: 'follow', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 };
}
function fixture(): GameState {
  const faction = (id: number): Faction => ({ id, name: `Realm${id}`, color: '#3988ff', relation: id ? 'peace' : 'self',
    affinity: 50, population: 5, food: 0, gold: 0, production: 0, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 1e9, nextRetinueAt: 1e9, defeated: false });
  return { world: { width: 56, height: 40, seed: 'npc-hunting', source: 'test', spawns: [],
    tiles: Array.from({ length: 56 * 40 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    factions: [faction(0), faction(1)],
    buildings: [{ id: 100, kind: 'palace', faction: 0, x: 3, y: 3, hp: 650, maxHp: 650, capacity: 0, governorPermissions: { farms: false, housing: false } },
      { id: 101, kind: 'palace', faction: 1, x: 18, y: 20, hp: 650, maxHp: 650, capacity: 0, governorPermissions: { farms: false, housing: false } }],
    units: [unit(1, 'leader', 0, 5.5, 5.5), unit(2, 'leader', 1, 22.5, 21.5),
      ...[[21.5, 21.5], [22.5, 22.5], [21.5, 20.5], [22.5, 20.5]].map(([x, y], index) => unit(10 + index, 'warrior', 1, x, y))],
    fields: [], time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], projectiles: [],
    selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false,
    seed: 'npc-hunting', rngState: 1, marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1,
    fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 1 } };
}
function addBand(state: GameState, size: number, x = 30.5, y = 21.5): number[] {
  const packId = Math.max(0, ...(state.marauderPacks ?? []).map(pack => pack.id)) + 1;
  let id = Math.max(...state.units.map(candidate => candidate.id), ...state.buildings.map(building => building.id)) + 1;
  state.marauderPacks!.push({ id: packId, name: 'Wilderness band', color: '#111', targetFaction: 1,
    home: { x, y }, waypoint: { x, y }, nextWanderAt: 1e9 });
  const ids: number[] = [];
  for (let i = 0; i < size; i++) {
    ids.push(id);
    entityStore(state).units.add({ ...unit(id++, 'warrior', -2, x + i % 6, y + Math.floor(i / 6)),
      hp: 65, maxHp: 65, attack: 10, defense: 2, speed: 2.35, order: 'wander', marauderPack: packId });
  }
  ensureMarauderLeaders(state);
  return ids;
}

function advance(state: GameState, seconds: number, observe: () => void = () => {}): void {
  for (let step = 0; step < seconds * 10 && !state.gameOver; step++) { updateGame(state, .1, idle); observe(); }
}

describe('rival leader and army operations in the live simulation', () => {
  it('does not let a raid order give a faction soldier an independent assault role', () => {
    const state = fixture(), soldier = state.units[2];
    state.factions[1].relation = 'war';
    soldier.order = 'raid'; soldier.target = state.buildings[0].id;
    advance(state, 2);
    expect(soldier.order).toBe('follow');
    expect(soldier.target).not.toBe(state.buildings[0].id);
    expect(distance(soldier, state.units[1])).toBeLessThan(8);
  });

  it('takes the Leader and escorts on a long campaign and attacks the city together', () => {
    const state = fixture(), target = state.buildings[0], leader = state.units[1];
    Object.assign(target, { x: 48, y: 3, hp: 1e6, maxHp: 1e6 });
    Object.assign(state.units[0], { x: 3.5, y: 5.5, attack: 0, speed: 0 });
    state.world.revision = 1;
    state.factions[1].relation = 'war'; state.factions[1].nextRaid = 0;
    let maxDistance = 0, detached = false, escortsAtCity = 0;
    advance(state, 70, () => {
      maxDistance = Math.max(maxDistance, distance(leader, { x: 19, y: 21 }));
      detached ||= state.units.some(candidate => candidate.faction === 1 && candidate.order === 'raid');
      escortsAtCity = Math.max(escortsAtCity, state.units.filter(candidate => candidate.faction === 1 && candidate.kind === 'warrior'
        && distance(candidate, { x: 49, y: 4 }) < 8 && distance(candidate, leader) < 8).length);
    });
    expect(maxDistance).toBeGreaterThan(26);
    expect(leader.hp).toBeGreaterThan(0);
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(escortsAtCity).toBeGreaterThanOrEqual(2);
    expect(detached).toBe(false);
  });

  it('takes escorts beyond the settlement, earns actual raider bounties, and returns alive', () => {
    const state = fixture(), enemies = addBand(state, 2), home = { x: 19, y: 21 };
    // Isolate earned bounties from the improved governor reinvesting them in
    // early timber defenses; defensive construction is covered separately.
    state.factions[1].constructionPauseUntil = { palisade: Infinity, wall: Infinity, woodenTower: Infinity };
    let maxLeaderDistance = 0, escortsAway = 0, returnedAfterHunt = false;
    advance(state, 180, () => {
      const leader = state.units.find(candidate => candidate.id === 2);
      if (leader) maxLeaderDistance = Math.max(maxLeaderDistance, distance(leader, home));
      escortsAway = Math.max(escortsAway, state.units.filter(candidate => candidate.faction === 1 && candidate.kind === 'warrior' && distance(candidate, home) > 8).length);
      if (leader && maxLeaderDistance > 8 && distance(leader, home) < 8
        && enemies.every(id => !state.units.some(candidate => candidate.id === id))) returnedAfterHunt = true;
    });
    const leader = state.units.find(candidate => candidate.id === 2);
    expect(leader?.hp).toBeGreaterThan(0);
    expect(maxLeaderDistance).toBeGreaterThan(8);
    expect(escortsAway).toBeGreaterThanOrEqual(2);
    expect(enemies.every(id => !state.units.some(candidate => candidate.id === id))).toBe(true);
    // Retinue experience belongs to a squad and is mirrored onto each member.
    // Either the Leader or an escort may land the final blow; count each award once.
    const individualKills = state.units.filter(candidate => candidate.faction === 1 && candidate.retinueSquad === undefined)
      .reduce((sum, candidate) => sum + (candidate.kills ?? 0), 0);
    const squadKills = (state.retinueSquads ?? []).filter(squad => squad.faction === 1)
      .reduce((sum, squad) => sum + squad.kills, 0);
    expect(individualKills + squadKills).toBe(2);
    // Five residents at 0.7 tax minus upkeep for four escorts gives 1.5 gold per economy
    // tick; the remaining 206 is the actual 6 + 200 raider bounty.
    expect(state.factions[1].gold).toBeCloseTo(206 + state.tick * 1.5);
    expect(returnedAfterHunt).toBe(true);
  });

  it('does not send the leader and a small retinue into an overwhelming band', () => {
    const state = fixture(), band = addBand(state, 12);
    // An advanced scout can see the entire force. A hidden rear rank would
    // legitimately change the strength estimate only after first contact.
    state.units.find(candidate => candidate.id === 2)!.x = 26.5;
    band.forEach((id, index) => Object.assign(state.units.find(candidate => candidate.id === id)!,
      { x: 30.5 + index % 3, y: 19.5 + Math.floor(index / 3) }));
    let maxInitialLeaderDistance = 0, unsafeHunt = false, fullBandObservations = 0;
    advance(state, 30, () => {
      const leader = state.units.find(candidate => candidate.id === 2);
      // Pursuing weakened survivors after defending successfully is valid.
      // Reject a hunt while the original overwhelming force is still intact.
      if (band.every(id => state.units.some(candidate => candidate.id === id && candidate.hp > 0))) {
        fullBandObservations++;
        if (leader) maxInitialLeaderDistance = Math.max(maxInitialLeaderDistance, distance(leader, { x: 19, y: 21 }));
        unsafeHunt ||= getFactionStrategy(state, 1)?.mode === 'hunt';
      }
    });
    expect(state.units.find(candidate => candidate.id === 2)?.hp).toBeGreaterThan(0);
    expect(fullBandObservations).toBeGreaterThan(10);
    expect(unsafeHunt).toBe(false);
    expect(maxInitialLeaderDistance).toBeLessThan(10);
    // A slower sensing/route cadence may leave a defensive exchange in
    // progress at thirty seconds. Require a bounded return after that exchange,
    // rather than treating its exact finishing frame as an unsafe assault.
    const leader = state.units.find(candidate => candidate.id === 2)!;
    for (let step = 0; step < 100 && distance(leader, { x: 19, y: 21 }) >= 6; step++) updateGame(state, .1, idle);
    expect(leader.hp).toBeGreaterThan(0);
    expect(distance(leader, { x: 19, y: 21 })).toBeLessThan(6);
    expect(state.factions[1].defeated).toBe(false);
  });
});
