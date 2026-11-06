import { grantIncome } from '../src/game/resource-income';
import { describe, expect, it } from 'vitest';
import { createDuelGame, updateGame, updateLeaderRespawns, getLeader, commandMove, setRetinueStance, toggleMovementMode, BUILD_COSTS } from '../src/game/simulation';
import { playerFaction, withPlayerFaction } from '../src/game/player-context';
import { updateFog, pointInSight } from '../src/game/fog';
import { setForbiddenRectangle, isForbidden } from '../src/game/forbidden-zones';
import { buildStroke } from '../src/game/construction';
import { clearArea } from '../src/game/area-tools';
import { prioritizeResearch, researchCost, updateResearch } from '../src/game/research';
import { entityStore } from '../src/game/entity-store';
import { getFactionStrategy } from '../src/game/faction-strategy';
import { updateTreasureChests } from '../src/game/treasure';
import { unitObstructs } from '../src/game/collisions';
import { canWalk } from '../src/game/pathfinding';
import { applyGameCommand } from '../src/multiplayer/commands';
import type { GameState, Unit, World } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
function world(): World {
  return { width: 64, height: 36, seed: 'two-humans', source: 'fixture', spawns: [{ x: 8, y: 18 }, { x: 54, y: 18 }, { x: 25, y: 18 }],
    tiles: Array.from({ length: 64 * 36 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .5, food: 3, production: 0, gold: 0, variation: .5 })) };
}
function fixture(): GameState {
  const leaders: Unit[] = [0, 1].map(faction => ({ id: faction + 1, faction, kind: 'leader', humanControlled: true,
    x: 8.5 + faction * 45, y: 10.5, hp: 100, maxHp: 100, morale: 100, attack: 25, defense: 5,
    speed: 3, range: 3, order: 'follow', cooldown: 0, lastCombat: 0, moving: false, facing: 0, attackTime: 0 }));
  return { world: world(), units: leaders, buildings: [0, 1].map(faction => ({ id: 10 + faction, faction, kind: 'palace',
    x: 8 + faction * 45, y: 14, hp: 650, maxHp: 650, capacity: 0, governor: { housing: false, farms: false } })),
    factions: [0, 1].map(id => ({ id, name: `Player ${id}`, color: id ? '#d33' : '#36f', affinity: 0, relation: 'war',
      food: 500, gold: 500, production: 0, population: 20, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1e9, nextRetinueAt: 1e9, defeated: false })),
    multiplayer: { humanFactionIds: [0, 1], inputs: { 0: { ...idle }, 1: { ...idle } }, controls: {
      0: { retinueStance: 'aggressive', movementMode: 'travel' }, 1: { retinueStance: 'aggressive', movementMode: 'travel' },
    }, winner: null }, playerFaction: 0, time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [],
    selected: 1, selectedType: 'unit', buildMode: null, diplomacy: null, gameOver: false, victory: false,
    seed: 'two-humans', rngState: 1, villages: [], marauderPacks: [], raiderCamps: [],
    fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 1 }, retinueStance: 'aggressive', movementMode: 'travel' };
}

describe('authoritative two-human engine', () => {
  it('creates two equally funded human capitals at separated starting sites without rival governors or villages', () => {
    const state = createDuelGame(world(), ['Host', 'Guest'], ['#3366ff', '#dd3333']);
    expect(state.factions.map(f => [f.id, f.name, f.gold, f.food, f.population])).toEqual([
      [0, 'Host', 500, 500, 20], [1, 'Guest', 500, 500, 20],
    ]);
    expect(state.buildings.filter(b => b.kind === 'palace').map(b => b.faction)).toEqual([0, 1]);
    expect(state.multiplayer?.humanFactionIds).toEqual([0, 1]);
    expect(state.villages ?? []).toEqual([]);
    expect(state.world.spawns).toEqual([world().spawns[0], world().spawns[1]]);
    expect(state.units.filter(u => u.kind === 'leader').every(u => u.humanControlled)).toBe(true);
  });

  it('uses connected starting sites and rejects a world where the players cannot meet', () => {
    const terrain = world();
    for (let y = 0; y < terrain.height; y++) terrain.tiles[y * terrain.width + 40].terrain = 'lake';
    const state = createDuelGame(terrain);
    expect(state.world.spawns).toEqual([terrain.spawns[0], terrain.spawns[2]]);
    const isolated = world();
    isolated.spawns = isolated.spawns.slice(0, 2);
    for (let y = 0; y < isolated.height; y++) isolated.tiles[y * isolated.width + 40].terrain = 'lake';
    expect(() => createDuelGame(isolated)).toThrow('connected by walkable terrain');
  });

  it('moves both leaders from independent held inputs and leaves an idle human outside AI control', () => {
    const state = fixture(), host = getLeader(state, 0)!, guest = getLeader(state, 1)!;
    state.multiplayer!.inputs[0] = { ...idle, right: true };
    state.multiplayer!.inputs[1] = { ...idle, left: true };
    updateGame(state, .2, idle);
    expect(host.x).toBeGreaterThan(8.5); expect(guest.x).toBeLessThan(53.5);
    expect(getFactionStrategy(state, 0)).toBeUndefined(); expect(getFactionStrategy(state, 1)).toBeUndefined();
    state.multiplayer!.inputs[1] = { ...idle };
    const stopped = { x: guest.x, y: guest.y };
    updateGame(state, .2, idle);
    expect({ x: guest.x, y: guest.y }).toEqual(stopped);
  });

  it('scopes guest move, stance and formation commands without changing the host selection or controls', () => {
    const state = fixture(), host = getLeader(state, 0)!, guest = getLeader(state, 1)!;
    entityStore(state).units.add({ ...guest, id: 20, kind: 'warrior', x: 51.5, humanControlled: undefined });
    withPlayerFaction(state, 1, () => {
      expect(commandMove(state, 49, 10)).toBe(true);
      setRetinueStance(state, 'hold');
      expect(toggleMovementMode(state)).toBe('formation');
      setRetinueStance(state, 'defensive');
    });
    expect(host.destination).toBeUndefined(); expect(guest.destination).toBeDefined();
    expect(state.selected).toBe(host.id); expect(playerFaction(state)).toBe(0);
    expect(state.multiplayer!.controls[0]).toMatchObject({ movementMode: 'travel', retinueStance: 'aggressive' });
    expect(state.multiplayer!.controls[1]).toMatchObject({ movementMode: 'formation', retinueStance: 'defensive' });
    expect(state.units.find(u => u.id === 20)?.retinueStance).toBe('defensive');
    expect(unitObstructs(guest, state.units.find(u => u.id === 20)!)).toBe(false);
    expect(unitObstructs(state.units.find(u => u.id === 20)!, guest)).toBe(true);
  });

  it('isolates current sight, exploration and forbidden cells for each human', () => {
    const state = fixture(), host = getLeader(state, 0)!, guest = getLeader(state, 1)!;
    const a = updateFog(state, 0), b = updateFog(state, 1);
    expect(pointInSight(a, host.x, host.y)).toBe(true); expect(pointInSight(a, guest.x, guest.y)).toBe(false);
    expect(pointInSight(b, guest.x, guest.y)).toBe(true); expect(pointInSight(b, host.x, host.y)).toBe(false);
    expect(state.multiplayer!.controls[0].fog).not.toBe(state.multiplayer!.controls[1].fog);
    withPlayerFaction(state, 1, () => setForbiddenRectangle(state, { x: 50, y: 10 }, { x: 50, y: 10 }, true));
    expect(isForbidden(state, 50, 10, 1)).toBe(true); expect(isForbidden(state, 50, 10, 0)).toBe(false);
    expect(canWalk(state, 50, 10, 1, undefined, true)).toBe(false);
    expect(canWalk(state, 50, 10, 0, undefined, true)).toBe(true);
    withPlayerFaction(state, 0, () => setForbiddenRectangle(state, { x: 10, y: 10 }, { x: 10, y: 10 }, true));
    expect(isForbidden(state, 10, 10, 0)).toBe(true); expect(isForbidden(state, 10, 10, 1)).toBe(false);
  });

  it('charges and refunds only the guest treasury for guest construction and clear', () => {
    const state = fixture();
    withPlayerFaction(state, 1, () => {
      const result = buildStroke(state, 'library', [{ x: 50, y: 12 }]);
      expect(result).toMatchObject({ ok: true, placed: 1 });
      expect(state.buildings.find(b => b.kind === 'library')?.faction).toBe(1);
      expect(state.factions[1].gold).toBe(500 - BUILD_COSTS.library.gold);
      expect(clearArea(state, { x: 50, y: 12 }, { x: 51, y: 13 })).toMatchObject({ ok: true, count: 1, refund: BUILD_COSTS.library.gold });
    });
    expect(state.factions.map(f => f.gold)).toEqual([500, 500]);
  });

  it('rejects enemy priorities while guest income researches its own queue', () => {
    const state = fixture(), guest = getLeader(state, 1)!;
    const library = { id: 30, faction: 1, kind: 'library' as const, x: 52, y: 11, hp: 100, maxHp: 100, capacity: 0 };
    entityStore(state).buildings.add(library);
    expect(prioritizeResearch(state, library, 'woodenTower').ok).toBe(false);
    withPlayerFaction(state, 1, () => {
      expect(prioritizeResearch(state, library, 'woodenTower').ok).toBe(true);
      grantIncome(state.factions[1], { gold: researchCost(state.factions[1], 'woodenTower') / .25 }, state);
    });
    updateResearch(state, 1000);
    expect(state.factions[1].research).toMatchObject({ focus: 'scoutLodge', levels: { woodenTower: 1 } });
    expect(state.factions[0].gold).toBe(500);
    expect(guest.target).toBeUndefined();
  });

  it('authenticates income allocation and ordered priority commands for the owning library only', () => {
    const state = fixture(); const library = { id: 30, faction: 1, kind: 'library' as const, x: 52, y: 11, hp: 750, maxHp: 750, capacity: 0 };
    entityStore(state).buildings.add(library);
    expect(applyGameCommand(state, 0, {type:'research-allocation',buildingId:30,allocation:1}).ok).toBe(false);
    expect(applyGameCommand(state, 1, {type:'research-allocation',buildingId:30,allocation:.6}).ok).toBe(true);
    expect(applyGameCommand(state, 1, {type:'research-priority',buildingId:30,branch:'siegeEngines'}).ok).toBe(true);
    expect(applyGameCommand(state, 1, {type:'research-priority',buildingId:30,branch:'irrigation'}).ok).toBe(true);
    expect(state.factions[1].research).toMatchObject({allocation:.6, priorities:['irrigation','siegeEngines'], focus:'irrigation'});
    expect(applyGameCommand(state, 1, {type:'research-remove-priority',buildingId:30,branch:'irrigation'}).ok).toBe(true);
    expect(state.factions[1].research).toMatchObject({priorities:['siegeEngines'],focus:'woodenTower'});
    for (const allocation of [-.1,1.1,Infinity,NaN]) expect(applyGameCommand(state,1,{type:'research-allocation',buildingId:30,allocation}).ok).toBe(false);
    grantIncome(state.factions[1],{gold:10},state); expect(state.factions[1].gold).toBe(504);
    updateResearch(state,30);
    expect(state.factions[1].research?.progress.woodenTower).toBe(6); expect(state.factions[0].research).toBeUndefined();
    getLeader(state,1)!.x = 40; expect(applyGameCommand(state,1,{type:'research-allocation',buildingId:30,allocation:0}).ok).toBe(false);
    expect(playerFaction(state)).toBe(0);
  });

  it('lets either human collect a chest exactly once', () => {
    const state = fixture();
    state.treasures = [{ id: 1, x: 53, y: 10, rewardGold: 200 }];
    updateTreasureChests(state); updateTreasureChests(state);
    expect(state.factions.map(f => f.gold)).toEqual([500, 700]);
    expect(state.treasures[0].collected).toBe(true);
  });

  it('assigns guest tree-clearing work to the guest and restores context after nested queries or failures', () => {
    const state = fixture();
    state.world.tiles[9 * state.world.width + 50].overlay = 'forest';
    withPlayerFaction(state, 1, () => {
      expect(buildStroke(state, 'clearTrees', [{ x: 50, y: 9 }])).toMatchObject({ ok: true, placed: 1 });
      setRetinueStance(state, 'hold');
      withPlayerFaction(state, 1, () => expect(state.retinueStance).toBe('hold'));
      withPlayerFaction(state, 0, () => expect(playerFaction(state)).toBe(0));
      expect(playerFaction(state)).toBe(1);
    });
    expect(state.treeClearings).toEqual([{ x: 50, y: 9, faction: 1 }]);
    expect(() => withPlayerFaction(state, 1, () => { throw new Error('rejected'); })).toThrow('rejected');
    expect(playerFaction(state)).toBe(0); expect(state.selected).toBe(1);
    expect(state.multiplayer!.controls[1].retinueStance).toBe('hold');
  });

  it.each([0, 1])('reports the other human as winner when player %s loses their last settlement', loser => {
    const state = fixture(); state.buildings.find(building => building.faction === loser && building.kind === 'palace')!.hp = 0;
    updateGame(state, .1, idle);
    expect(state.gameOver).toBe(true); expect(state.multiplayer!.winner).toBe(1 - loser);
  });

  it.each([0, 1])('captures the opponent settlement for player %s immediately through the authoritative dispatcher', winner => {
    const state = fixture(), attacker = getLeader(state, winner)!, loser = 1 - winner;
    const target = state.buildings.find(b => b.faction === loser)!; target.hp = 1;
    attacker.x = target.x + .5; attacker.y = target.y - 1.5; attacker.attack = 1000;
    getLeader(state, loser)!.x = 30.5;
    expect(applyGameCommand(state, winner, { type: 'attack', x: target.x + .5, y: target.y + .5 }).ok).toBe(true);
    for (let i = 0; i < 20 && !state.gameOver; i++) updateGame(state, .1, idle);
    expect(state.palaceCaptures ?? []).toEqual([]); expect(state.paused).toBe(false);
    expect(state.buildings.some(b => b.kind === 'palace' && b.faction === winner && b.x === target.x && b.y === target.y)).toBe(true);
    expect(state.multiplayer!.winner).toBe(winner);
  });

  it.each([0, 1])('applies actual projectile damage, rewards player %s, and respawns the defeated Leader without ending the match', winner => {
    const state = fixture(), attacker = getLeader(state, winner)!, victim = getLeader(state, 1 - winner)!;
    attacker.x = 29.5; attacker.y = 10.5; attacker.attack = 1000;
    victim.x = 31.5; victim.y = 10.5; victim.hp = 5;
    expect(applyGameCommand(state, winner, { type: 'attack', x: victim.x, y: victim.y }).ok).toBe(true);
    updateGame(state, .1, idle);
    expect(state.projectiles?.some(projectile => projectile.faction === winner && projectile.target === victim.id)).toBe(true);
    for (let i = 0; i < 20 && !state.gameOver; i++) updateGame(state, .1, idle);
    expect(victim.hp).toBeLessThanOrEqual(0);
    expect(state.gameOver).toBe(false); expect(state.multiplayer!.winner).toBeNull();
    expect(state.factions[winner].gold).toBe(700); expect(state.factions[1 - winner].gold).toBe(300);
    expect(attacker.leaderProgression?.level).toBe(2);
    const deadline = state.factions[1 - winner].leaderRespawn!.readyAtWallTime;
    state.paused = true; updateLeaderRespawns(state, deadline - 1);
    expect(getLeader(state, 1 - winner)).toBeUndefined();
    updateLeaderRespawns(state, deadline);
    expect(getLeader(state, 1 - winner)).toMatchObject({ humanControlled: true, hp: 100, leaderProgression: { level: 1 } });
    expect(state.gameOver).toBe(false); expect(state.multiplayer!.winner).toBeNull();
  });

  it.each([0, 1])('walks player %s across the map before accepting a newly visible combat target', actor => {
    const state = fixture(), attacker = getLeader(state, actor)!, victim = getLeader(state, 1 - actor)!;
    attacker.attack = 1000;
    expect(applyGameCommand(state, actor, { type: 'attack', x: victim.x, y: victim.y }).ok).toBe(false);
    const approach = { x: victim.x + (actor ? 3.5 : -3.5), y: victim.y };
    expect(applyGameCommand(state, actor, { type: 'move', ...approach }).ok).toBe(true);
    for (let i = 0; i < 200 && Math.abs(attacker.x - victim.x) > 4.5; i++) updateGame(state, .1, idle);
    expect(Math.abs(attacker.x - victim.x)).toBeLessThanOrEqual(4.5);
    expect(pointInSight(updateFog(state, actor), victim.x, victim.y)).toBe(true);
    expect(applyGameCommand(state, actor, { type: 'attack', x: victim.x, y: victim.y }).ok).toBe(true);
    for (let i = 0; i < 50 && !state.gameOver; i++) updateGame(state, .1, idle);
    expect(victim.hp).toBeLessThanOrEqual(0); expect(state.multiplayer!.winner).toBeNull();
    expect(state.gameOver).toBe(false); expect(state.factions[1 - actor].leaderRespawn).toBeDefined();
  });

  it.each([0, 1])('validates player %s commands before changing any other player resources, orders or upgrades', actor => {
    const state = fixture(), enemy = 1 - actor, leader = getLeader(state, actor)!;
    const enemyLibrary = { id: 30, faction: enemy, kind: 'library' as const, x: Math.floor(leader.x), y: 11, hp: 100, maxHp: 100, capacity: 0 };
    entityStore(state).buildings.add(enemyLibrary);
    const originalGold = state.factions.map(faction => faction.gold);
    expect(applyGameCommand(state, actor, { type: 'research-focus', buildingId: 30, branch: 'woodenTower' }).ok).toBe(false);
    expect(applyGameCommand(state, actor, { type: 'move', x: NaN, y: 10 }).ok).toBe(false);
    expect(applyGameCommand(state, 99, { type: 'move', x: 20, y: 10 }).ok).toBe(false);
    const target = getLeader(state, enemy)!;
    expect(applyGameCommand(state, actor, { type: 'attack', x: target.x, y: target.y }).ok).toBe(false);
    expect(state.factions.map(faction => faction.gold)).toEqual(originalGold);
    expect(state.factions[enemy].research).toBeUndefined(); expect(target.destination).toBeUndefined();
    expect(applyGameCommand(state, actor, { type: 'move', x: leader.x - 2, y: leader.y }).ok).toBe(true);
    expect(leader.destination).toBeDefined(); expect(target.destination).toBeUndefined();
    expect(applyGameCommand(state, actor, { type: 'stance', stance: 'hold' }).ok).toBe(true);
    expect(state.multiplayer!.controls[actor].retinueStance).toBe('hold');
    expect(state.multiplayer!.controls[enemy].retinueStance).toBe('aggressive');
  });
});
