import { describe, expect, it } from 'vitest';
import { announceArmyMobilization } from '../src/game/army-warnings';
import { toggleInfantryFormation } from '../src/game/infantry-drill';
import { updateMarauderFormations } from '../src/game/marauder-formations';
import { levyPopulation } from '../src/game/mass-levy';
import { withPlayerFaction } from '../src/game/player-context';
import { applyGameCommand } from '../src/multiplayer/commands';
import { ArmyWarningFeed, armyWarningPosition, separateArmyWarning } from '../src/ui/army-warning-layout';
import { armyWarningFixture } from './helpers/army-warnings';

describe('authoritative army mobilization warnings', () => {
  it('announces an enemy formation once on activation, not release or failed commands', () => {
    const state = armyWarningFixture();
    expect(withPlayerFaction(state, 1, () => toggleInfantryFormation(state)).ok).toBe(true);
    expect(state.armyWarnings).toMatchObject([{ kind: 'formation', sourceId: 2, faction: 1, recipients: [0], color: '#368bd4',
      message: 'The Carthaginians have entered into a formation and are on the move!' }]);
    withPlayerFaction(state, 1, () => toggleInfantryFormation(state));
    state.factions[1].research!.levels.infantryDrill = 0;
    expect(withPlayerFaction(state, 1, () => toggleInfantryFormation(state)).ok).toBe(false);
    expect(state.armyWarnings).toHaveLength(1);
  });
  it('announces real marauder ranks once across repeated strategic updates', () => {
    const state = armyWarningFixture();
    updateMarauderFormations(state, () => true);
    expect(state.units.find(u => u.id === 100)?.infantryFormation?.active).toBe(true);
    expect(state.armyWarnings).toMatchObject([{ faction: -2, color: '#9c62ce',
      message: 'Nearby marauders have entered into a formation and are on the move', recipients: [0] }]);
    state.time = 1; updateMarauderFormations(state, () => true);
    expect(state.armyWarnings).toHaveLength(1);
  });
  it('announces a paid levy, but not a rejected repeat or a dismissed levy', () => {
    const state = armyWarningFixture();
    expect(levyPopulation(state, 3, 1)).toMatchObject({ ok: true, count: 3 });
    expect(state.armyWarnings).toMatchObject([{ kind: 'levy', sourceId: 2,
      message: 'The Carthaginians are conscripting their people to raise a large army!' }]);
    expect(levyPopulation(state, 3, 1).ok).toBe(false);
    expect(state.armyWarnings).toHaveLength(1);
  });
  it.each([79.99, 80, 80.01])('uses an inclusive 80-tile radius from the player Leader (%s)', range => {
    const state = armyWarningFixture(), enemy = state.units[1];
    enemy.x = state.units[0].x + range; enemy.y = state.units[0].y;
    announceArmyMobilization(state, enemy, 'formation');
    expect(state.armyWarnings?.length ?? 0).toBe(range <= 80 ? 1 : 0);
  });
  it.each(['peace', 'confederated'] as const)('ignores friendly armies (%s), own actions, and missing player Leaders', relation => {
    const state = armyWarningFixture(); state.factions[1].relation = relation;
    announceArmyMobilization(state, state.units[1], 'formation');
    announceArmyMobilization(state, state.units[0], 'levy');
    state.units[0].hp = 0; announceArmyMobilization(state, state.units[2], 'formation');
    expect(state.armyWarnings).toBeUndefined();
  });
  it('addresses multiplayer warnings to the nearby opponent, independently of command actor context', () => {
    const state = armyWarningFixture();
    state.multiplayer = { humanFactionIds: [0, 1], inputs: {}, controls: { 0: {retinueStance:'aggressive',movementMode:'travel'}, 1: {retinueStance:'aggressive',movementMode:'travel'} }, winner: null };
    expect(applyGameCommand(state, 1, { type: 'infantry-formation' }).ok).toBe(true);
    expect(state.armyWarnings?.[0].recipients).toEqual([0]);
    announceArmyMobilization(state, state.units[0], 'levy');
    expect(state.armyWarnings?.[1].recipients).toEqual([1]);
    state.units[1].x = 250;
    announceArmyMobilization(state, state.units[0], 'levy');
    expect(state.armyWarnings).toHaveLength(2);
  });
  it('bounds retained events without reusing sequence numbers', () => {
    const state = armyWarningFixture();
    for (let i = 0; i < 200; i++) announceArmyMobilization(state, state.units[1], 'formation');
    expect(state.armyWarnings).toHaveLength(128); expect(state.nextArmyWarningId).toBe(200);
    state.time = 31; announceArmyMobilization(state, state.units[1], 'levy');
    expect(state.armyWarnings).toHaveLength(1); expect(state.armyWarnings![0].id).toBe(201);
  });
});

describe('six-second warning presentation', () => {
  it('tracks the army, survives 4× time, expires after six real seconds, and never replays a snapshot', () => {
    const state = armyWarningFixture(), feed = new ArmyWarningFeed();
    state.multiplayer = { humanFactionIds: [0,1], inputs: {}, controls: {}, winner: null };
    announceArmyMobilization(state, state.units[1], 'formation');
    expect(feed.update(state, 1000)).toHaveLength(1);
    state.units[1].x += 5; state.time = 20;
    expect(feed.update({ ...state }, 6000)).toMatchObject([{ x: 36.5 }]);
    expect(feed.update({ ...state }, 6999)).toHaveLength(1);
    expect(feed.update({ ...state }, 7000)).toEqual([]);
    expect(feed.update({ ...state }, 8000)).toEqual([]);
  });
  it('ignores stale events and clears old indicators on new worlds and viewer changes', () => {
    const state = armyWarningFixture(), feed = new ArmyWarningFeed();
    announceArmyMobilization(state, state.units[1], 'formation'); state.time = 10;
    expect(feed.update(state, 0)).toEqual([]);
    announceArmyMobilization(state, state.units[1], 'levy'); expect(feed.update(state, 1)).toHaveLength(1);
    state.playerFaction = 1; expect(feed.update(state, 2)).toEqual([]);
    expect(feed.update(armyWarningFixture(), 3)).toEqual([]);
  });
  it('preserves onscreen anchors and pins distant bearings to each screen edge', () => {
    expect(armyWarningPosition({x:400,y:200},800,600)).toMatchObject({x:400,y:200,edge:false});
    expect(armyWarningPosition({x:2000,y:319},800,600)).toMatchObject({x:774,y:319,edge:true});
    expect(armyWarningPosition({x:-2000,y:319},800,600)).toMatchObject({x:26,y:319,edge:true});
    expect(armyWarningPosition({x:400,y:-2000},800,600)).toMatchObject({x:400,y:64,edge:true});
    expect(armyWarningPosition({x:400,y:2000},800,600)).toMatchObject({x:400,y:574,edge:true});
    const diagonal = armyWarningPosition({x:2400,y:-681},800,600);
    expect((diagonal.x-400)/(diagonal.y-319)).toBeCloseTo(-2);
  });
  it('keeps simultaneous formation and levy messages separately reachable', () => {
    const position = armyWarningPosition({x:2000,y:319},800,600);
    const next = separateArmyWarning(position,[position],800,600);
    expect(next.x).toBe(position.x); expect(Math.abs(next.y-position.y)).toBeGreaterThanOrEqual(40);
    expect(next.edge).toBe(true);
  });
});
