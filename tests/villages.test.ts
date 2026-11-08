import { describe, expect, it, vi } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { canWalk } from '../src/game/pathfinding';
import { updateFog, pointInSight } from '../src/game/fog';
import { insideOwnBorders } from '../src/game/borders';
import { createGame } from '../src/game/simulation';
import { generateWorld } from '../src/world/generator';
import { distance, type GameState, type VillageIdentity } from '../src/game/types';
import { initializeVillages, performVillageAction, refreshVillageBonuses, updateVillages, updateVillageUnit,
  villageCamp, villageDiplomacyStatus, villageHostility, villageTradeActive, villageRequiredResource, VILLAGE_REQUIRED_RESOURCES } from '../src/game/villages';

function fixture(civilizations = 1): GameState {
  const corners = [[12, 12], [80, 12], [12, 62], [80, 62]];
  return {
    world: { width: 96, height: 80, seed: 'village-test', source: 'test', revision: 0, spawns: [],
      tiles: Array.from({ length: 96 * 80 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 1, production: 0, gold: 0, variation: .5 })) },
    buildings: corners.slice(0, civilizations).map(([x, y], i) => ({ id: i + 100, kind: 'palace', faction: i, x, y, hp: 650, maxHp: 650, capacity: 0 })),
    units: [{ id: 1, kind: 'leader', faction: 0, x: 14.5, y: 14.5, hp: 100, attack: 20, defense: 4, speed: 3.6, morale: 100,
      range: 1.1, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: Array.from({ length: civilizations }, (_, id) => ({ id, name: `Faction ${id}`, color: '#ff0000', affinity: 0, relation: id ? 'peace' : 'self',
      population: 20, food: 500, gold: 5000, production: 0, culture: 0, yields: { food: 0, gold: 0, production: 0 }, defeated: false, nextRaid: Infinity })),
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: null, selectedType: null, buildMode: null,
    diplomacy: null, gameOver: false, victory: false, seed: 'village-test', rngState: 101,
  };
}
function settlement(identity: VillageIdentity = 'growers') {
  const state = fixture(); initializeVillages(state);
  const village = state.villages![0], camp = villageCamp(state, village)!;
  village.identity = identity;
  state.units[0].x = camp.x + .5; state.units[0].y = camp.y + 1.5;
  return { state, village, camp };
}
function orders(state: GameState) {
  return { hostile: vi.fn((a: number, b: number) => villageHostility(state, a, b) ?? false), visible: vi.fn(() => true),
    move: vi.fn(), engage: vi.fn() };
}

describe('neutral villages', () => {
  it('scatters three tents around a walkable clearing with two to five white villagers, at 1.5 per civilization', () => {
    const state = fixture(4); initializeVillages(state);
    expect(state.villages).toHaveLength(6);
    for (const village of state.villages!) {
      expect(village.relation).toBe('neutral');
      expect(VILLAGE_REQUIRED_RESOURCES).toContain(village.requiredResource);
      const buildings = state.buildings.filter(b => b.villageId === village.id), units = state.units.filter(u => u.villageId === village.id);
      expect(buildings.filter(b => b.kind === 'villageTent')).toHaveLength(3);
      expect(buildings).toHaveLength(3);
      expect(villageCamp(state, village)?.kind).toBe('villageTent');
      expect(canWalk(state, village.x + .5, village.y + .5, village.faction)).toBe(true);
      expect(buildings.some(building => building.x === village.x && building.y === village.y)).toBe(false);
      expect(buildings.some(b => ['palace', 'wall', 'palisade'].includes(b.kind))).toBe(false);
      expect(units.length).toBeGreaterThanOrEqual(2); expect(units.length).toBeLessThanOrEqual(5);
      expect(units.every(u => u.kind === 'worker' && u.faction === village.faction)).toBe(true);
      expect(state.units.some(u => u.faction === village.faction && u.kind === 'leader')).toBe(false);
      expect(state.factions.find(f => f.id === village.faction)).toMatchObject({ color: '#ffffff', villageId: village.id, population: units.length });
      expect(new Set(buildings.map(b => `${b.x},${b.y}`)).size).toBe(3);
    }
    const count = state.buildings.length; initializeVillages(state);
    expect(state.buildings).toHaveLength(count);
  });

  it('uses deterministic village identities and positions for a seed', () => {
    const first = fixture(4), second = fixture(4); initializeVillages(first); initializeVillages(second);
    expect(first.villages).toEqual(second.villages);
    expect(first.units).toEqual(second.units);
  });

  it('keeps resource demand stable without consuming game RNG and varies it between villages and seeds', () => {
    const state = fixture(4); initializeVillages(state);
    const rng = state.rngState;
    const choices = new Set(state.villages!.map(village => villageRequiredResource(state, village)));
    expect(choices.size).toBeGreaterThan(1);
    for (const village of state.villages!) {
      expect(villageRequiredResource(state, village)).toBe(village.requiredResource);
      expect(villageRequiredResource(state, { ...village, requiredResource: undefined })).toBe(village.requiredResource);
    }
    const village = { ...state.villages![0], requiredResource: undefined };
    const acrossSeeds = new Set(Array.from({ length: 30 }, (_, index) => {
      const sample = { ...state, world: { ...state.world, seed: `village-demand-${index}` } };
      return villageRequiredResource(sample, village);
    }));
    expect(acrossSeeds).toEqual(new Set(VILLAGE_REQUIRED_RESOURCES));
    expect(state.rngState).toBe(rng);
  });

  it('keeps village structures off existing units and away from initial raiding bands', () => {
    const first = fixture(); initializeVillages(first);
    const point = first.villages![0], state = fixture();
    entityStore(state).units.add({ ...state.units[0], id: 9000, kind: 'warrior', faction: -2, x: point.x + .5, y: point.y + .5 });
    initializeVillages(state);
    expect(state.villages).toHaveLength(2);
    expect(state.villages!.every(village => distance(village, point) >= 7)).toBe(true);
    expect(canWalk(state, point.x + .5, point.y + .5, -2)).toBe(true);
  });

  it.each(['BTV-472259', 'BTV-847', 'willow-raid'])('fills the village target on a congested default fractal world: %s', seed => {
    const state = createGame(generateWorld(seed));
    const civilizations = state.factions.filter(faction => faction.villageId === undefined);
    expect(state.villages).toHaveLength(Math.round(civilizations.length * 1.5));
    for (const village of state.villages!) {
      expect(state.buildings.filter(b => b.villageId === village.id && b.kind === 'villageTent')).toHaveLength(3);
      expect(state.units.filter(u => u.villageId === village.id).every(u => canWalk(state, u.x, u.y, u.faction))).toBe(true);
    }
  }, 120_000);

  it('charges 250 once for trade and 3000 once for alliance, immediately creating trade while paused', () => {
    const { state, village, camp } = settlement(); state.paused = true;
    expect(performVillageAction(state, camp, 'trade').ok).toBe(true);
    expect(state.factions[0].gold).toBe(4750); expect(villageTradeActive(state, village)).toBe(true);
    expect(state.tradeRoutes?.filter(route => route.villageId === village.id)).toHaveLength(1);
    expect(performVillageAction(state, camp, 'trade').ok).toBe(false);
    expect(state.factions[0].gold).toBe(4750);
    expect(performVillageAction(state, camp, 'ally').ok).toBe(true);
    expect(state.factions[0].gold).toBe(1750);
    expect(performVillageAction(state, camp, 'ally').ok).toBe(false);
    expect(state.factions[0].gold).toBe(1750); expect(villageTradeActive(state, village)).toBe(true);
  });

  it('keeps alliance and trade independent, including trading after an alliance', () => {
    const { state, village, camp } = settlement();
    expect(performVillageAction(state, camp, 'ally').ok).toBe(true);
    expect(villageTradeActive(state, village)).toBe(false);
    expect(state.tradeRoutes?.some(route => route.villageId === village.id)).toBe(false);
    expect(villageDiplomacyStatus(state, camp)?.trade.available).toBe(true);
    expect(performVillageAction(state, camp, 'trade').ok).toBe(true);
    expect(village.relation).toBe('allied'); expect(villageTradeActive(state, village)).toBe(true);
    expect(state.factions[0].gold).toBe(1750);
  });

  it('requires gold and Leader proximity for agreements without charging rejected actions', () => {
    const { state, camp } = settlement(); state.factions[0].gold = 249;
    expect(performVillageAction(state, camp, 'trade').message).toBe('Need 250 gold.');
    state.factions[0].gold = 2999;
    expect(performVillageAction(state, camp, 'ally').message).toBe('Need 3000 gold.');
    state.units[0].x = 0; state.units[0].y = 0;
    expect(performVillageAction(state, camp, 'trade').ok).toBe(false);
    expect(state.factions[0].gold).toBe(2999);
    expect(performVillageAction(state, camp, 'war').ok).toBe(false);
    expect(performVillageAction(state, camp, 'war', true).ok).toBe(true);
    expect(state.factions[0].gold).toBe(2999);
    state.gameOver = true;
    expect(performVillageAction(state, camp, 'war', true).message).toBe('Your realm can no longer negotiate.');
  });

  it('war cancels trade, alliance bonuses and repeated agreements', () => {
    const { state, village, camp } = settlement('merchants');
    performVillageAction(state, camp, 'trade'); performVillageAction(state, camp, 'ally');
    expect(state.factions[0].villageBonuses?.trade).toBe(.15);
    expect(performVillageAction(state, camp, 'war').ok).toBe(true);
    expect(village.relation).toBe('war'); expect(village.trading).toBe(false);
    expect(state.factions[0].villageBonuses?.trade).toBe(0);
    expect(villageTradeActive(state, village)).toBe(false);
    expect(state.tradeRoutes?.some(route => route.villageId === village.id)).toBe(false);
    expect(performVillageAction(state, camp, 'trade').ok).toBe(false);
    expect(performVillageAction(state, camp, 'ally').ok).toBe(false);
    expect(performVillageAction(state, camp, 'war').ok).toBe(false);
  });

  it.each([['growers', 'food', .1], ['merchants', 'trade', .15], ['builders', 'construction', .15], ['scholars', 'research', .15]] as const)
    ('grants the %s bonus while its allied camp survives, without same-identity stacking', (identity, key, value) => {
      const { state, village, camp } = settlement(identity);
      performVillageAction(state, camp, 'ally');
      const second = state.villages![1]; second.identity = identity; second.relation = 'allied';
      refreshVillageBonuses(state); expect(state.factions[0].villageBonuses?.[key]).toBe(value);
      camp.hp = 0; updateVillages(state);
      expect(village.destroyed).toBe(true); expect(state.factions[0].villageBonuses?.[key]).toBe(value);
      villageCamp(state, second)!.hp = 0; updateVillages(state);
      expect(state.factions[0].villageBonuses?.[key]).toBe(0);
      expect(villageDiplomacyStatus(state, camp)).toBeUndefined();
    });

  it('removes a destroyed camp’s route immediately and never grows a dead village', () => {
    const { state, village, camp } = settlement(); performVillageAction(state, camp, 'trade');
    const count = state.buildings.filter(b => b.villageId === village.id).length;
    camp.hp = 0; updateVillages(state);
    expect(state.tradeRoutes?.some(route => route.villageId === village.id)).toBe(false);
    state.time = 5000; updateVillages(state);
    expect(state.buildings.filter(b => b.villageId === village.id)).toHaveLength(count);
  });

  it('shares a wide allied camp view while keeping village territory separate, and loses it when the camp dies', () => {
    const { state, village, camp } = settlement();
    const point = [[15, 0], [-15, 0], [0, 15], [0, -15]].map(([dx, dy]) => ({ x: camp.x + .5 + dx, y: camp.y + .5 + dy }))
      .find(p => p.x > 0 && p.y > 0 && p.x < state.world.width && p.y < state.world.height && distance(p, state.buildings[0]) > 15)!;
    expect(point).toBeDefined();
    expect(pointInSight(updateFog(state), point.x, point.y)).toBe(false);
    performVillageAction(state, camp, 'ally');
    expect(pointInSight(updateFog(state), point.x, point.y)).toBe(true);
    expect(insideOwnBorders(state, village.faction, camp.x + .5, camp.y + .5)).toBe(true);
    expect(insideOwnBorders(state, 0, camp.x + .5, camp.y + .5)).toBe(false);
    camp.hp = 0; updateVillages(state);
    expect(pointInSight(updateFog(state), point.x, point.y)).toBe(false);
  });

  it('grows gradually to at most ten houses, two guard posts and four watchtowers without walls or leaders', () => {
    const { state, village } = settlement();
    state.factions.find(f => f.id === village.faction)!.gold = 10_000;
    state.time = 89; updateVillages(state);
    expect(state.buildings.filter(b => b.villageId === village.id)).toHaveLength(3);
    for (let step = 1; step <= 65; step++) { state.time = step * 120; updateVillages(state); }
    const buildings = state.buildings.filter(b => b.villageId === village.id);
    expect(buildings.filter(b => b.kind === 'house')).toHaveLength(10);
    expect(buildings.filter(b => b.kind === 'guardPost')).toHaveLength(2);
    expect(buildings.filter(b => b.kind === 'woodenTower')).toHaveLength(4);
    expect(buildings.some(b => ['palace', 'wall', 'palisade'].includes(b.kind))).toBe(false);
    expect(state.units.some(u => u.villageId === village.id && u.kind === 'leader')).toBe(false);
    const guards = state.units.filter(u => u.villageId === village.id && u.kind === 'warrior');
    expect(guards).toHaveLength(12);
  });

  it('is peaceful toward civilizations until war, and allied villages fight the player’s enemies nearby', () => {
    const { state, village, camp } = settlement();
    state.factions.push({ ...state.factions[0], id: 100, relation: 'war' });
    expect(villageHostility(state, village.faction, 0)).toBe(false);
    expect(villageHostility(state, village.faction, 100)).toBe(false);
    expect(villageHostility(state, village.faction, -2)).toBe(false);
    performVillageAction(state, camp, 'ally');
    expect(villageHostility(state, village.faction, -2)).toBe(true);
    expect(villageHostility(state, village.faction, 100)).toBe(true);
    expect(villageHostility(state, 100, village.faction)).toBe(true);
    const villager = state.units.find(u => u.villageId === village.id)!;
    villager.x = camp.x + .5; villager.y = camp.y + 1.5;
    const enemy = { ...state.units[0], id: 10000, faction: 100, x: camp.x + 3.5, y: camp.y + 1.5 };
    entityStore(state).units.add(enemy);
    const callbacks = orders(state); updateVillageUnit(state, villager, .1, callbacks);
    expect(callbacks.engage).toHaveBeenCalledWith(villager, enemy, .1);
    enemy.x = camp.x + 20; state.time = 1; callbacks.engage.mockClear();
    updateVillageUnit(state, villager, .1, callbacks);
    expect(callbacks.engage).not.toHaveBeenCalled();
  });

  it('bounds wandering to the village and abandons blocked destinations instead of milling forever', () => {
    const { state, village, camp } = settlement(), callbacks = orders(state);
    const villager = state.units.find(u => u.villageId === village.id)!;
    villager.destination = { x: camp.x + 30, y: camp.y + 30 }; villager.villageNextWanderAt = 1;
    villager.path = [{ x: camp.x + 30, y: camp.y + 30 }];
    state.time = 2; updateVillageUnit(state, villager, .1, callbacks);
    expect(villager.path).toBeUndefined();
    expect(villager.destination).toBeDefined();
    expect(distance(villager.destination!, village)).toBeLessThanOrEqual(6);
    expect(canWalk(state, villager.destination!.x, villager.destination!.y, village.faction)).toBe(true);
    const destination = { ...villager.destination! };
    for (let step = 0; step < 20; step++) { state.time += .05; updateVillageUnit(state, villager, .05, callbacks); }
    expect(villager.destination).toEqual(destination);
    villager.x = camp.x + 9.5; villager.y = camp.y + .5;
    state.time = 30; updateVillageUnit(state, villager, .1, callbacks);
    expect(distance(villager.destination!, camp)).toBeLessThan(2);
  });

  it('slowly replaces allied villagers without farms, food stock, or a faction Leader', () => {
    const { state, village, camp } = settlement();
    performVillageAction(state, camp, 'ally');
    village.nextGrowthAt = Infinity; village.nextRecruitAt = 90;
    const villagers = state.units.filter(u => u.villageId === village.id);
    for (const unit of villagers.slice(1)) unit.hp = 0;
    const count = () => state.units.filter(u => u.villageId === village.id && u.hp > 0 && u.kind === 'worker').length;
    state.time = 89; updateVillages(state); expect(count()).toBe(1);
    state.time = 90; updateVillages(state); expect(count()).toBe(2);
    state.time = 91; updateVillages(state); expect(count()).toBe(2);
    state.time = 180; updateVillages(state); expect(count()).toBe(3);
    expect(state.factions.find(f => f.id === village.faction)).toMatchObject({ population: 3, food: 0 });
    expect(state.buildings.some(b => b.villageId === village.id && ['camp', 'farm', 'palace'].includes(b.kind))).toBe(false);
    expect(state.units.some(u => u.villageId === village.id && (u.collector || u.kind === 'leader'))).toBe(false);
  });

  it('mirrors new and ended player wars in both directions for allied villages', () => {
    const { state, village, camp } = settlement();
    state.factions.push({ ...state.factions[0], id: 100, relation: 'peace' });
    performVillageAction(state, camp, 'ally');
    const enemy = state.factions.find(f => f.id === 100)!;
    for (const relation of ['peace', 'war', 'peace'] as const) {
      enemy.relation = relation;
      expect(villageHostility(state, village.faction, enemy.id)).toBe(relation === 'war');
      expect(villageHostility(state, enemy.id, village.faction)).toBe(relation === 'war');
    }
    expect(villageHostility(state, -2, village.faction)).toBe(true);
    expect(villageHostility(state, village.faction, -2)).toBe(true);
  });

  it('shares and throttles whole-world threat scans across a village’s residents', () => {
    const { state, village } = settlement(), callbacks = orders(state);
    const villagers = state.units.filter(u => u.villageId === village.id);
    for (let frame = 0; frame < 100; frame++) {
      state.time = frame / 100;
      for (const unit of villagers) updateVillageUnit(state, unit, .01, callbacks);
    }
    expect(callbacks.engage).not.toHaveBeenCalled();
    expect(callbacks.hostile.mock.calls.length).toBeLessThanOrEqual(state.units.length * 4);
  });
});
