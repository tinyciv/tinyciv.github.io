import { describe, expect, it } from 'vitest';
import { garrisonCityAt, garrisonMovementLimits, garrisonStatus, toggleGarrison, updateGarrison, GARRISON_PURSUIT_SECONDS } from '../src/game/garrison';
import { moveUnit, recallRetinue, setRetinueStance, updateGame } from '../src/game/simulation';
import { retinueFormation } from '../src/game/formation';
import { infantryFormationSoldierCount, toggleInfantryFormation } from '../src/game/infantry-drill';
import { beginBattleRout } from '../src/game/battle-morale';
import { applyGameCommand } from '../src/multiplayer/commands';
import { entityStore } from '../src/game/entity-store';
import { markWorldChanged } from '../src/game/world-revisions';
import { distance, type GameState, type Unit } from '../src/game/types';

function soldier(id: number, x: number, y: number, kind: Unit['kind'] = 'warrior', faction = 0): Unit {
  return { id, kind, faction, x, y, hp: 100, maxHp: 100, morale: 100, attack: 10, defense: 5, speed: 3.3,
    range: kind === 'archer' ? 4 : 1.1, order: kind === 'leader' ? 'hold' : 'follow', retinueStance: 'aggressive',
    cooldown: 0, lastCombat: -100, moving: false, facing: 0, attackTime: 0 };
}
function fixture(count = 8) {
  const width = 48, height = 32, leader = soldier(1, 12.5, 15.5, 'leader');
  const members = Array.from({ length: count }, (_, i) => soldier(i + 2, 11.5 + i % 4, 17.5 + Math.floor(i / 4), i % 3 === 0 ? 'archer' : 'warrior'));
  const state = {
    world: { width, height, revision: 1, seed: 'garrison', source: 'test', spawns: [], tiles: Array.from({ length: width * height }, () =>
      ({ terrain: 'grassland', overlay: 'none', elevation: .1, moisture: .5, food: 0, production: 0, gold: 0, variation: .5 })) },
    units: [leader, ...members], buildings: [{ id: 1000, kind: 'palace', faction: 0, x: 12, y: 12, hp: 650, maxHp: 650, capacity: 4,
      cityName: 'Roma', governorPermissions: { housing: false, farms: false } }],
    factions: [{ id: 0, name: 'Player', color: '#f44', affinity: 100, relation: 'self', population: 0, food: 10000, gold: 10000, production: 0, culture: 0,
      yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1e9, nextRetinueAt: 1e9, defeated: false,
      research: { focus: 'infantryDrill', levels: { infantryDrill: 1 }, progress: {} } }],
    time: 0, tick: 0, paused: false, speed: 1, gameOver: false, victory: false, events: [], particles: [], selected: leader.id, selectedType: 'unit',
    buildMode: null, diplomacy: null, seed: 'garrison', rngState: 1, fields: [], raiderCamps: [], marauderPacks: [], villages: [],
    fogRaids: { nextAt: 1e9, nextSmallAt: 1e9, waves: 0, pressureVersion: 1 }, retinueStance: 'aggressive', movementMode: 'travel',
  } as unknown as GameState;
  return { state, leader, members, city: state.buildings[0] };
}
const idle = { up: false, down: false, left: false, right: false };
function run(state: GameState, seconds: number) { for (let i = 0; i < seconds * 10; i++) updateGame(state, .1, idle); }

describe('city garrisons', () => {
  it('is immediately available in your city and unavailable in wilderness, enemy or unfinished cities', () => {
    const { state, leader, city } = fixture();
    state.factions[0].research = undefined;
    expect(garrisonStatus(state).enabled).toBe(true);
    leader.x = 35;
    expect(garrisonStatus(state).enabled).toBe(false); expect(toggleGarrison(state).ok).toBe(false);
    leader.x = 12.5; city.faction = 1; markWorldChanged(state.world);
    expect(garrisonStatus(state).enabled).toBe(false);
    city.faction = 0; city.hp = 0; markWorldChanged(state.world);
    expect(garrisonStatus(state).enabled).toBe(false);
  });
  it('assigns only the active retinue and releases drill without a morale collapse', () => {
    const { state, leader, members } = fixture();
    const independent = [soldier(30, 10, 12, 'militia'), soldier(31, 10, 13, 'scout'), soldier(32, 10, 14, 'worker'),
      { ...soldier(33, 10, 15), training: { range: 1000, role: 'archer' as const } }, soldier(34, 10, 16, 'warrior', 1)];
    entityStore(state).units.add(...independent);
    expect(toggleInfantryFormation(state).ok).toBe(true);
    expect(toggleGarrison(state).ok).toBe(true);
    expect(leader.infantryFormation?.active).toBe(false);
    expect(members.every(unit => unit.garrison?.city === 1000 && unit.morale === 100)).toBe(true);
    expect(independent.every(unit => !unit.garrison)).toBe(true);
    expect(infantryFormationSoldierCount(state)).toBe(0);
    expect(members.every(unit => !retinueFormation(state, leader).goals.has(unit.id))).toBe(true);
  });
  it('holds distinct posts, stays in the city while the Leader travels, then recalls from outside', () => {
    const { state, leader, members } = fixture();
    expect(toggleGarrison(state).ok).toBe(true);
    expect(new Set(members.map(unit => `${unit.garrison!.post.x},${unit.garrison!.post.y}`)).size).toBe(members.length);
    leader.x = 35.5; leader.y = 15.5; run(state, 10);
    expect(members.every(unit => garrisonCityAt(state, unit)?.id === 1000)).toBe(true);
    const settled = members.map(unit => ({ x: unit.x, y: unit.y })); run(state, 2);
    expect(members.every((unit, i) => distance(unit, settled[i]) < .01)).toBe(true);
    expect(garrisonStatus(state)).toMatchObject({ enabled: true, active: true });
    expect(toggleGarrison(state).ok).toBe(true);
    expect(members.every(unit => !unit.garrison && unit.recallIssuedAt !== undefined)).toBe(true);
    const before = members.reduce((sum, unit) => sum + distance(unit, leader), 0); run(state, 6);
    expect(members.reduce((sum, unit) => sum + distance(unit, leader), 0)).toBeLessThan(before - 30);
  });
  it('supports normal Recall and preserves combat stance, while stance commands do not abandon duty', () => {
    const { state, members } = fixture();
    members[0].retinueStance = 'hold'; toggleGarrison(state); setRetinueStance(state, 'defensive');
    expect(members.every(unit => !!unit.garrison)).toBe(true); expect(members[0].retinueStance).toBe('hold');
    recallRetinue(state); expect(members.every(unit => !unit.garrison)).toBe(true);
    expect(members[0].recallReturnOrder).toBe('hold'); expect(members[0].retinueStance).toBe('hold');
  });
  it('allows only an engaged enemy to be chased briefly and then forces a return', () => {
    const { state, members } = fixture(1); const unit = members[0]; toggleGarrison(state);
    const enemy = soldier(100, 16.5, 12.5, 'warrior', -2); const accepted: boolean[] = [];
    const update = () => updateGarrison(state, unit, { enemy: accept => { const yes = accept(enemy); accepted.push(yes); return yes ? enemy : undefined; },
      fight: target => { unit.target = target.id; }, move: () => {} });
    update(); expect(accepted.at(-1)).toBe(true);
    // Eastern edge is x=19; this tile lies just beyond Roma's border.
    enemy.x = 20.5; enemy.y = 13.5;
    expect(garrisonCityAt(state, enemy)).toBeUndefined(); update(); expect(accepted.at(-1)).toBe(true);
    expect(unit.garrison!.pursuitUntil).toBe(GARRISON_PURSUIT_SECONDS);
    unit.x = 20.5; unit.y = 13.5; state.time = GARRISON_PURSUIT_SECONDS + .1;
    update(); expect(unit.target).toBeUndefined(); expect(unit.garrison!.returning).toBe(true);
    expect(unit.garrison!.pursuitUntil).toBeUndefined();
  });
  it('constrains actual navigation to the city, then allows a bounded chase buffer', () => {
    const { state, members } = fixture(1); const unit = members[0]; toggleGarrison(state);
    let boundaryX = 13;
    while (garrisonCityAt(state, { x: boundaryX + .5, y: 13.5 })) boundaryX++;
    unit.x = boundaryX - .5; unit.y = 13.5;
    const goal = { x: boundaryX + 3.5, y: 13.5 };
    expect(garrisonMovementLimits(state, unit)?.has(13 * 48 + boundaryX)).toBe(true);
    for (let i = 0; i < 30; i++) { state.time += .1; moveUnit(state, unit, goal, .1, true); }
    expect(garrisonCityAt(state, unit)?.id).toBe(1000);
    unit.garrison!.pursuitUntil = state.time + 5;
    for (let i = 0; i < 30; i++) { state.time += .1; moveUnit(state, unit, { x: 30.5, y: 13.5 }, .1, false, true); }
    expect(unit.x).toBeGreaterThan(boundaryX); expect(unit.x).toBeLessThan(boundaryX + 3);
  });
  it('actually attacks an intruder with the Leader away and remains in its assigned city', () => {
    const { state, members, leader } = fixture(); toggleGarrison(state); leader.x = 40;
    const enemy = { ...soldier(200, 16.5, 12.5, 'warrior', -2), attack: 0, hp: 1000, maxHp: 1000, speed: 0, order: 'hold' as const };
    entityStore(state).units.add(enemy); run(state, 8);
    expect(enemy.hp).toBeLessThan(950);
    expect(members.every(unit => unit.garrison?.city === 1000 && garrisonCityAt(state, unit)?.id === 1000)).toBe(true);
  });
  it('chooses posts reachable without leaving the city around a water barrier', () => {
    const { state, members } = fixture(1); const unit = members[0]; unit.x = 10.5; unit.y = 15.5;
    for (let y = 3; y < 26; y++) state.world.tiles[y * 48 + 14].terrain = 'lake';
    markWorldChanged(state.world); expect(toggleGarrison(state).ok).toBe(true);
    // The preferred east-side post is reachable globally around the water,
    // but that detour leaves the city. Pick a connected west-side post.
    expect(unit.garrison!.post.x).toBeLessThan(14);
    run(state, 5); expect(distance(unit, unit.garrison!.post)).toBeLessThan(.2);
  });
  it('lets distant members walk around terrain before applying the city boundary on first entry', () => {
    const { state, members } = fixture(1); const unit = members[0]; unit.x = 20.5; unit.y = 13.5;
    expect(garrisonCityAt(state, unit)).toBeUndefined(); expect(toggleGarrison(state).ok).toBe(true);
    expect(unit.garrison!.arrived).toBe(false); expect(garrisonMovementLimits(state, unit)).toBeUndefined();
    run(state, 5); expect(unit.garrison!.arrived).toBe(true); expect(garrisonMovementLimits(state, unit)).toBeDefined();
    expect(garrisonCityAt(state, unit)?.id).toBe(1000);
  });
  it('executes traffic sidesteps so a posted defender does not block another defender at a gate', () => {
    const { state, members, leader } = fixture(2); leader.x = 9.5; leader.y = 10.5;
    for (let y = 3; y < 26; y++) if (y !== 15) state.world.tiles[y * 48 + 14].terrain = 'lake';
    markWorldChanged(state.world); toggleGarrison(state);
    const [posted, crossing] = members;
    Object.assign(posted, { x: 14.5, y: 15.5 }); posted.garrison!.post = { x: 14.5, y: 15.5 };
    Object.assign(crossing, { x: 12.5, y: 15.5 }); crossing.garrison!.post = { x: 16.5, y: 15.5 };
    run(state, 10);
    expect(crossing.x).toBeGreaterThan(15.5);
    expect(members.every(unit => garrisonCityAt(state, unit)?.id === 1000)).toBe(true);
  });
  it('returns to the Leader when its city is captured or destroyed', () => {
    const { state, members, city } = fixture(1); toggleGarrison(state);
    city.faction = 1; markWorldChanged(state.world);
    expect(updateGarrison(state, members[0], { enemy: () => undefined, fight: () => {}, move: () => {} })).toBe(false);
    expect(members[0].garrison).toBeUndefined(); expect(members[0].joiningRetinue).toBe(true);
  });
  it('does not rout detached city defenders when the distant Leader flees', () => {
    const { state, members, leader } = fixture(); toggleGarrison(state); leader.x = 35;
    beginBattleRout(state, leader);
    expect(members.every(unit => unit.order !== 'flee' && unit.morale === 100)).toBe(true);
  });
  it('round-trips duties in saved state and honors the authenticated faction in multiplayer', () => {
    const { state, members } = fixture();
    expect(applyGameCommand(state, 1, { type: 'garrison', faction: 0 }).ok).toBe(false);
    expect(applyGameCommand(state, 0, { type: 'garrison', faction: 1 }).ok).toBe(true);
    const loaded = JSON.parse(JSON.stringify(state)) as GameState;
    expect(garrisonStatus(loaded).active).toBe(true);
    expect(loaded.units.find(unit => unit.id === members[0].id)!.garrison).toEqual(members[0].garrison);
    expect(applyGameCommand(loaded, 0, { type: 'garrison' }).ok).toBe(true);
    expect(garrisonStatus(loaded).active).toBe(false);
  });
});
