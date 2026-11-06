import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { territory } from '../src/game/borders';
import { findRiverTradeConnection, riverTradingPosts } from '../src/game/river-trade';
import { domesticTradePayout, MERCHANT_REPLACEMENT_SECONDS, MERCHANT_SPEED, updateMerchant, updateTradeRoutes } from '../src/game/trade';
import { moveUnit, updateGame } from '../src/game/simulation';
import { markWorldChanged } from '../src/game/world-revisions';
import { distance, type Building, type GameState, type Unit } from '../src/game/types';

function fixture(): GameState {
  const city = (id: number, x: number): Building => ({ id, kind: 'palace', faction: 0, x, y: 12,
    hp: 650, maxHp: 650, capacity: 100, unhousedResidents: 100, cityName: id === 1 ? 'Roma' : 'Capua',
    governorPermissions: { farms: false, housing: false } });
  return { world: { width: 80, height: 38, seed: 'river-trade', source: 'test', spawns: [], revision: 0,
    tiles: Array.from({ length: 80 * 38 }, (_, i) => ({ terrain: Math.floor(i / 80) >= 18 && Math.floor(i / 80) <= 20 ? 'river' : 'grassland',
      overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [city(1, 8), city(2, 60)], units: [], fields: [],
    factions: [{ id: 0, name: 'Romans', color: '#c44', relation: 'self', affinity: 100, population: 200, food: 1000,
      gold: 0, culture: 0, production: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false,
      research: { focus: 'sailing', levels: { sailing: 1 }, progress: {} } }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null, buildMode: null,
    diplomacy: null, gameOver: false, victory: false, seed: 'river-trade', rngState: 1, marauderPacks: [], raiderCamps: [],
    roamingMaraudersVersion: 1, fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 1 },
    wildlife: { herds: [], sequence: 0, nextRespawnAt: Infinity, targetHerds: 0 }, banditIntensity: 0 };
}
function start(state: GameState) {
  updateTradeRoutes(state); expect(state.tradeRoutes).toHaveLength(1);
  const route = state.tradeRoutes![0], merchant = state.units.find(u => u.id === route.merchantId)!;
  expect(route.river).toBeDefined(); expect(merchant).toBeDefined(); return { route, merchant };
}
function threeCities(): GameState {
  const state = fixture(); state.world.height = 96;
  state.world.tiles = Array.from({ length: 80 * 96 }, (_, i) => ({ terrain: Math.floor(i / 80) >= 18 && Math.floor(i / 80) <= 20 ? 'river' : 'grassland',
    overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 }));
  entityStore(state).buildings.add({ ...state.buildings[0], id: 3, x: 38, y: 70, cityName: 'Ostia' });
  for (let y = 18; y <= 20; y++) entityStore(state).buildings.add({ id: 100 + y, kind: 'bridge', faction: 0, x: 1, y, hp: 100, maxHp: 100, capacity: 0 });
  state.factions[0].population = 300; return state;
}
function travelUntil(state: GameState, merchant: Unit, done: () => boolean): void {
  for (let frame = 0; frame < 4000 && !done(); frame++) {
    const before = { x: merchant.x, y: merchant.y }; state.time += .1;
    updateMerchant(state, merchant, .1, moveUnit);
    expect(distance(before, merchant)).toBeLessThanOrEqual(MERCHANT_SPEED * .1 * 2);
  }
  expect(done()).toBe(true);
}
function advance(state: GameState, merchant: Unit, done: () => boolean, seconds = 120): void {
  for (let frame = 0; frame < seconds * 20 && !done(); frame++) {
    const before = { x: merchant.x, y: merchant.y };
    state.time += .05; updateMerchant(state, merchant, .05, moveUnit);
    expect(distance(before, merchant)).toBeLessThanOrEqual(MERCHANT_SPEED * .05 * 1.01);
  }
  expect(done(), JSON.stringify({ x:merchant.x, y:merchant.y, phase: state.tradeRoutes?.[0].riverLeg?.phase, source:state.tradeRoutes?.[0].riverLeg?.connection.origin, path:merchant.path, goal:merchant.pathGoal })).toBe(true);
}

describe('river trade eligibility', () => {
  it('prefers the eligible river partner over a farther land-only third city', () => {
    const state = threeCities(); updateTradeRoutes(state);
    expect(state.tradeRoutes!.some(route => route.river && route.origin === 1 && route.partner === 2)).toBe(true);
    expect(state.tradeRoutes!.filter(route => [route.origin, route.partner].sort().join(':') === '1:2')).toHaveLength(1);
    expect(state.tradeRoutes!.find(route => route.origin === 3)?.river).toBeUndefined();
  });

  it('keeps both land quotes until home, then reassigns the same merchant after Sailing unlocks', () => {
    const state = threeCities(); state.factions[0].research!.levels.sailing = 0; updateTradeRoutes(state);
    const route = state.tradeRoutes!.find(r => r.origin === 1)!, merchant = state.units.find(u => u.id === route.merchantId)!;
    expect(route.partner).toBe(3);
    for (const trader of state.units.filter(u => u.kind === 'merchant')) updateMerchant(state, trader, .1, moveUnit);
    const outgoing = route.legValue!, position = { x: merchant.x, y: merchant.y }, identity = merchant.id;
    state.factions[0].research!.levels.sailing = 1; updateTradeRoutes(state);
    expect(route.pendingRiverPartner).toBe(2); expect(route.partner).toBe(3); expect(route.legValue).toBe(outgoing); expect(merchant).toMatchObject(position);
    travelUntil(state, merchant, () => route.journeys === 1);
    expect(route.partner).toBe(3); expect(route.target).toBe(1);
    state.time += 1.5; updateMerchant(state, merchant, .1, moveUnit); const returning = route.legValue!;
    expect(returning).toBeDefined(); travelUntil(state, merchant, () => route.journeys === 2);
    const atHome = { x: merchant.x, y: merchant.y }, earned = state.factions[0].gold;
    expect(earned).toBeCloseTo(outgoing.gold + returning.gold);
    state.time += 2; updateMerchant(state, merchant, .1, moveUnit);
    expect(merchant).toMatchObject(atHome); expect(route.legValue).toBeUndefined(); // waits for the planner
    const cooldown = state.time + 240; state.tradeCooldowns = { '1:2': cooldown };
    updateTradeRoutes(state);
    expect(route.partner).toBe(2); expect(route.merchantId).toBe(identity); expect(route.river).toBeDefined();
    expect(merchant).toMatchObject(atHome); expect(merchant.hp).toBeGreaterThan(0); expect(state.factions[0].gold).toBe(earned);
    expect(route.nextPlanAt).toBe(cooldown);
    state.time = cooldown - .1; updateMerchant(state, merchant, .1, moveUnit);
    expect(merchant).toMatchObject(atHome); expect(route.legValue).toBeUndefined();
    state.time = cooldown; updateMerchant(state, merchant, .1, moveUnit);
    expect(route.riverLeg).toBeDefined();
  });

  it('establishes river service for a new city and retires the superseded land caravan only after its return', () => {
    const state = threeCities(), second = state.buildings.find(b => b.id === 2)!;
    entityStore(state).buildings.retain(b => b.id !== second.id); updateTradeRoutes(state);
    const route = state.tradeRoutes![0], merchant = state.units.find(u => u.id === route.merchantId)!;
    updateMerchant(state, merchant, .1, moveUnit); const outgoing = route.legValue!;
    entityStore(state).buildings.add(second); updateTradeRoutes(state);
    expect(route.pendingRiverPartner).toBe(2); expect(route.legValue).toBe(outgoing); expect(merchant.hp).toBeGreaterThan(0);
    expect(state.tradeRoutes!.filter(r => r.river && [r.origin, r.partner].sort().join(':') === '1:2')).toHaveLength(1);
    travelUntil(state, merchant, () => route.journeys === 2);
    const earned = state.factions[0].gold; updateTradeRoutes(state);
    expect(merchant.hp).toBe(0); expect(state.tradeRoutes).not.toContain(route); expect(state.factions[0].gold).toBe(earned);
    expect(Object.keys(state.tradeCooldowns ?? {})).toHaveLength(0);
    const pairs = state.tradeRoutes!.map(r => [r.origin, r.partner].sort().join(':'));
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('requires Sailing and creates one river caravan and two posts within the two cities’ own river borders', () => {
    const state = fixture(); state.factions[0].research!.levels.sailing = 0;
    expect(findRiverTradeConnection(state, ...state.buildings as [Building, Building])).toBeUndefined();
    updateTradeRoutes(state); const original = state.units[0]; expect(state.tradeRoutes![0].river).toBeUndefined();
    state.factions[0].research!.levels.sailing = 1;
    const { route, merchant } = start(state); expect(merchant.id).toBe(original.id);
    const borders = territory(state), river = route.river!;
    for (const end of [river.origin, river.partner]) {
      expect(borders.owners[Math.floor(end.water.y) * 80 + Math.floor(end.water.x)]).toBe(0);
      expect(river.waterDistance).toBeGreaterThan(end.landDistance);
    }
    expect(riverTradingPosts(state)).toHaveLength(2); expect(state.units).toHaveLength(1);
  });

  it.each(['ocean', 'coast', 'lake', 'ford', 'bridge', 'waterfall'] as const)('does not connect two river stretches through %s', blocker => {
    const state = fixture();
    for (let y = 18; y <= 20; y++) {
      const tile = state.world.tiles[y * 80 + 35];
      if (blocker === 'ford') tile.overlay = 'ford';
      else if (blocker === 'waterfall') tile.waterfall = 'south';
      else if (blocker === 'bridge') entityStore(state).buildings.add({ id: 100 + y, kind: 'bridge', x: 35, y, faction: 0, hp: 100, maxHp: 100, capacity: 0 });
      else tile.terrain = blocker;
    }
    expect(findRiverTradeConnection(state, ...state.buildings.slice(0, 2) as [Building, Building])).toBeUndefined();
  });

  it('rejects a river outside city borders and a route with too much walking at either end', () => {
    const state = fixture(); state.buildings[1].y = 2;
    expect(findRiverTradeConnection(state, ...state.buildings as [Building, Building])).toBeUndefined();
    const short = fixture(); short.factions[0].culture = 1e6;
    for (let y = 18; y <= 20; y++) for (let x = 0; x < 80; x++) if (x < 34 || x > 44) short.world.tiles[y * 80 + x].terrain = 'grassland';
    expect(findRiverTradeConnection(short, ...short.buildings as [Building, Building])).toBeUndefined();
  });

  it('requires reachable dry access, and never treats a cliff shore as an entrance', () => {
    const state = fixture();
    for (let x = 0; x < 80; x++) entityStore(state).buildings.add({ id: 100 + x, kind: 'wall', faction: -2, x, y: 16, hp: 2250, maxHp: 2250, capacity: 0 });
    expect(findRiverTradeConnection(state, ...state.buildings.slice(0, 2) as [Building, Building])).toBeUndefined();
    const cliffs = fixture();
    for (let y = 0; y < 18; y++) for (let x = 0; x < 80; x++) cliffs.world.tiles[y * 80 + x].ridge = 1;
    expect(findRiverTradeConnection(cliffs, ...cliffs.buildings as [Building, Building])).toBeUndefined();
  });
});

describe('continuous river caravan journeys', () => {
  it('walks, boards, sails at merchant speed, disembarks, and pays one fixed weighted quote at the city', () => {
    const state = fixture(), { route, merchant } = start(state);
    updateMerchant(state, merchant, .05, () => {});
    const quote = { ...route.legValue! }, connection = route.river!;
    expect(quote.distance).toBeGreaterThan(connection.waterDistance * 2.5);
    expect(quote.gold).toBeCloseTo(domesticTradePayout(quote.distance, 100, 100));
    advance(state, merchant, () => route.riverLeg?.phase === 'river');
    expect(merchant.aboardRiverTrade).toBe(true); const before = { x: merchant.x, y: merchant.y };
    state.time += .1; updateMerchant(state, merchant, .1, moveUnit);
    expect(distance(before, merchant)).toBeCloseTo(MERCHANT_SPEED * .1);
    route.distance = 999; // Avoidance and backtracking cannot inflate the quote.
    advance(state, merchant, () => route.journeys === 1);
    expect(state.factions[0].gold).toBeCloseTo(quote.gold);
    expect(merchant.aboardRiverTrade).toBe(false); expect(route.legValue).toBeUndefined();
    advance(state, merchant, () => route.journeys === 2);
    expect(state.units).toHaveLength(1); expect(route.target).toBe(route.partner);
  });

  it('waits for a blocked boat, then continues without crossing its hull or paying early', () => {
    const state = fixture(), { route, merchant } = start(state);
    advance(state, merchant, () => route.riverLeg?.phase === 'river');
    const next = route.riverLeg!.waterPath.find(p => distance(p, merchant) > .1)!;
    const blocker: Unit = { ...merchant, id: 999, kind: 'sailboat', tradeRoute: undefined, aboardRiverTrade: undefined, ...next };
    entityStore(state).units.add(blocker);
    const before = { x: merchant.x, y: merchant.y }, quote = route.legValue!.gold;
    state.time += .05; updateMerchant(state, merchant, .05, moveUnit);
    expect(distance(before, merchant)).toBe(0); expect(route.journeys).toBe(0); expect(route.legValue!.gold).toBe(quote);
    entityStore(state).units.retain(u => u.id !== blocker.id);
    advance(state, merchant, () => route.journeys === 1);
  });

  it('keeps the normal merchant casualty cooldown and replaces a sunk trader only after 240 seconds', () => {
    const state = fixture(), { route, merchant } = start(state);
    advance(state, merchant, () => route.riverLeg?.phase === 'river');
    merchant.hp = 0; state.time += 5; updateTradeRoutes(state);
    const due = route.nextDepartureAt; expect(due - state.time).toBe(MERCHANT_REPLACEMENT_SECONDS);
    state.time = due - .1; updateTradeRoutes(state); expect(route.merchantId).toBeUndefined();
    state.time = due + 5; updateTradeRoutes(state);
    expect(route.merchantId).not.toBe(merchant.id); expect(state.units.filter(u => u.hp > 0 && u.kind === 'merchant')).toHaveLength(1);
    expect(route.riverLeg).toBeUndefined(); expect(state.factions[0].gold).toBe(0);
  });

  it('responds to a route becoming eligible without replacing or teleporting the existing caravan', () => {
    const state = fixture(); state.factions[0].research!.levels.sailing = 0; updateTradeRoutes(state);
    const route = state.tradeRoutes![0], merchant = state.units[0]; updateMerchant(state, merchant, .1, moveUnit);
    const quote = route.legValue, position = { x: merchant.x, y: merchant.y };
    state.factions[0].research!.levels.sailing = 1; updateTradeRoutes(state);
    expect(route.river).toBeDefined(); expect(route.legValue).toBe(quote); expect(merchant).toMatchObject(position); expect(route.riverLeg).toBeUndefined();
    advance(state, merchant, () => route.journeys === 1); state.time += 1.5; updateMerchant(state, merchant, .1, moveUnit);
    expect(route.riverLeg).toBeDefined(); expect(state.units).toHaveLength(1);
  });

  it('replans a river detour around a new obstruction without increasing the departure reward', () => {
    const state = fixture(), { route, merchant } = start(state);
    advance(state, merchant, () => route.riverLeg?.phase === 'river');
    const quote = route.legValue!.gold, middle = route.riverLeg!.waterPath[Math.floor(route.riverLeg!.waterPath.length / 2)];
    entityStore(state).buildings.add({ id: 999, kind: 'bridge', faction: 0, x: Math.floor(middle.x), y: Math.floor(middle.y), hp: 100, maxHp: 100, capacity: 0 });
    markWorldChanged(state.world);
    advance(state, merchant, () => route.journeys === 1);
    expect(state.factions[0].gold).toBeCloseTo(quote);
  });

  it.each(['river', 'disembark'] as const)('moves its destination post when construction blocks the landing during %s', phase => {
    const state = fixture(), { route, merchant } = start(state);
    advance(state, merchant, () => route.riverLeg?.phase === phase);
    if (phase === 'disembark') { state.time += .1; updateMerchant(state, merchant, .1, moveUnit); }
    const quote = route.legValue!.gold, old = { ...route.riverLeg!.connection.partner.shore };
    entityStore(state).buildings.add({ id: 999, kind: 'house', faction: 0, x: Math.floor(old.x), y: Math.floor(old.y), hp: 100, maxHp: 100, capacity: 0 });
    markWorldChanged(state.world);
    advance(state, merchant, () => route.journeys === 1);
    expect(route.river!.partner.shore).not.toEqual(old); expect(state.factions[0].gold).toBeCloseTo(quote);
  });

  it.each([false, true])('does not strand a caravan when its source bank is built on (already boarding: %s)', boarding => {
    const state = fixture(), { route, merchant } = start(state);
    advance(state, merchant, () => route.riverLeg?.phase === 'board');
    if (boarding) { state.time += .1; updateMerchant(state, merchant, .1, moveUnit); expect(merchant.aboardRiverTrade).toBe(true); }
    const quote = route.legValue!.gold, source = { ...route.riverLeg!.connection.origin.shore };
    entityStore(state).buildings.add({ id: 999, kind: 'house', faction: 0, x: Math.floor(source.x), y: Math.floor(source.y),
      hp: 100, maxHp: 100, capacity: 0,
      // An order cannot finish through a land occupant; queued footprints are
      // pathable, but already unavailable as a new boarding location.
      construction: boarding ? undefined : { startedAt: state.time, duration: 20, waitingForBuilder: true } });
    markWorldChanged(state.world);
    advance(state, merchant, () => route.journeys === 1);
    expect(merchant.aboardRiverTrade).toBe(false); expect(state.factions[0].gold).toBeCloseTo(quote);
  });

  it('remains damageable while sailing and pays the normal merchant bounty exactly once', () => {
    const state = fixture(), { merchant } = start(state);
    advance(state, merchant, () => state.tradeRoutes![0].riverLeg?.phase === 'river');
    state.factions.push({ ...state.factions[0], id: 1, relation: 'war', gold: 0, research: undefined });
    const from = { x: merchant.x + 2, y: merchant.y };
    state.projectiles = [{ kind: 'arrow', attacker: 999, faction: 1, target: merchant.id, ...from,
      start: from, end: { x: merchant.x, y: merchant.y }, elapsed: 0, duration: .01, damage: 1000 }];
    updateGame(state, .05, { up: false, down: false, left: false, right: false });
    expect(merchant.hp).toBe(0); expect(state.factions[1].gold).toBe(200);
    updateGame(state, .05, { up: false, down: false, left: false, right: false });
    expect(state.factions[1].gold).toBe(200);
  });

  it('completes every transport phase through the real simulation without land collision or panic taking over afloat', () => {
    const state = fixture(); state.factions[0].food = 5000; state.factions[0].nextRetinueAt = Infinity;
    entityStore(state).units.add({ id: 90, kind: 'leader', faction: 0, x: 6.5, y: 12.5, hp: 100, maxHp: 100, morale: 100,
      attack: 0, defense: 5, speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 });
    const { route, merchant } = start(state), phases = new Set<string>();
    for (let i = 0; i < 1600 && !route.journeys; i++) {
      updateGame(state, .05, { up: false, down: false, left: false, right: false });
      if (route.riverLeg) phases.add(route.riverLeg.phase);
    }
    expect([...phases]).toEqual(expect.arrayContaining(['embark', 'board', 'river', 'disembark', 'city']));
    expect(route.journeys).toBe(1); expect(merchant.hp).toBeGreaterThan(0); expect(merchant.aboardRiverTrade).toBe(false);
    expect(state.units.filter(u => u.kind === 'merchant' && u.hp > 0)).toHaveLength(1);
  });

  it('retires a river caravan cleanly if its destination is captured, without paying a bounty', () => {
    const state = fixture(), { merchant } = start(state);
    advance(state, merchant, () => state.tradeRoutes![0].riverLeg?.phase === 'river');
    state.factions.push({ ...state.factions[0], id: 1, relation: 'war', gold: 0 });
    state.buildings[1].faction = 1; markWorldChanged(state.world); updateTradeRoutes(state);
    expect(merchant.hp).toBe(0); expect(state.tradeRoutes).toHaveLength(0);
    expect(state.factions[0].gold).toBe(0); expect(state.factions[1].gold).toBe(0);
  });
});
