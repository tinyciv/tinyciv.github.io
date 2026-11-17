import { describe, expect, it } from 'vitest';
import { riverFixture, fixtureBuilding } from './helpers/river';
import { territory } from '../src/game/borders';
import { controlledStoneTiles, stoneDefenseMultiplier } from '../src/game/stone-defense';
import { markWorldChanged } from '../src/game/world-revisions';
import { buildCostAt, buildAt, cancelConstruction, BUILD_COSTS, moveUnit } from '../src/game/simulation';
import { buildingMaintenance } from '../src/game/maintenance';
import { entityStore } from '../src/game/entity-store';
import { canWalk, findPath, invalidateNavigation } from '../src/game/pathfinding';
import { unitNavigationState } from '../src/game/unit-navigation';
import { establishFactionTrade, updateMerchant, updateTradeRoutes, domesticTradePayout } from '../src/game/trade';
import { ensureBuilders, updateBuilder } from '../src/game/builders';
import { queueConstruction, updateConstruction } from '../src/game/structures';
import { parseGameSave, serializeGameSave } from '../src/game/game-save';
import { buildingReady } from '../src/game/types';
import { withSimulationReads } from '../src/game/simulation-reads';

function fixture() {
  const s = riverFixture();
  for (const tile of s.world.tiles) tile.terrain = 'grassland';
  entityStore(s).units.replace([]); s.buildings[0].capacity = 100; s.buildings[0].unhousedResidents = 100; s.factions[0].population = 100;
  return s;
}
function foreignTrade() {
  const s = fixture();
  s.factions.push({ ...s.factions[0], id: 1, name: 'Capua', relation: 'peace', gold: 0 });
  entityStore(s).buildings.add({ ...fixtureBuilding(2, 'palace', 30, 7, 1), capacity: 100, unhousedResidents: 100 });
  return s;
}

describe('controlled stone defense discounts', () => {
  it('updates sparse deposits and ownership without rereading the world after cosmetic edits', () => {
    const s = fixture(); s.world.revision = 0;
    const owned = withSimulationReads(s, () => territory(s).owners);
    const cells = [...owned.keys()].filter(cell => owned[cell] === 0).slice(0, 3);
    s.world.tiles[cells[0]].resource = 'stone';
    let reads = 0;
    for (const tile of s.world.tiles) {
      let value = tile.resource;
      Object.defineProperty(tile, 'resource', { configurable: true, enumerable: true,
        get: () => { reads++; return value; }, set: next => { value = next; } });
    }
    withSimulationReads(s, () => {
      expect(controlledStoneTiles(s, 0)).toBe(1);
      reads = 0;
      s.world.tiles[cells[1]].variation++;
      markWorldChanged(s.world, 'appearance', [cells[1]]);
      expect(controlledStoneTiles(s, 0)).toBe(1);
      expect(reads).toBe(1);
      reads = 0;
      expect(stoneDefenseMultiplier(s, 0, 'wall')).toBe(.95);
      expect(reads).toBe(0);
      s.world.tiles[cells[2]].resource = 'stone';
      markWorldChanged(s.world, 'appearance', [cells[2]]);
      expect(controlledStoneTiles(s, 0)).toBe(2);
      delete s.world.tiles[cells[0]].resource;
      markWorldChanged(s.world, 'appearance', [cells[0]]);
      expect(controlledStoneTiles(s, 0)).toBe(1);
      s.buildings[0].faction = 1;
      s.factions.push({ ...s.factions[0], id: 1, relation: 'peace' });
      markWorldChanged(s.world, 'structure');
      invalidateNavigation(s);
      expect(controlledStoneTiles(s, 0)).toBe(0);
      expect(controlledStoneTiles(s, 1)).toBe(1);
    });
  });
  it('charges discounted construction and refunds the paid price even after stone ownership changes', () => {
    const s = riverFixture();
    for (const tile of s.world.tiles) tile.terrain = 'grassland';
    for (const x of [5, 6]) s.world.tiles[7 * 40 + x].resource = 'stone';
    markWorldChanged(s.world, 'appearance');
    const before = s.factions[0].gold;
    expect(buildAt(s, 'wall', 14, 10).ok).toBe(true);
    const wall = s.buildings.find(b => b.kind === 'wall')!;
    expect(s.factions[0].gold).toBeCloseTo(before - 13.5);
    for (const tile of s.world.tiles) delete tile.resource;
    markWorldChanged(s.world, 'appearance');
    expect(cancelConstruction(s, wall.id)).toEqual({ ok: true, refund: 13.5 });
    expect(s.factions[0].gold).toBe(before);
  });
  it('counts undeveloped controlled tiles, caps at 75%, and updates prices and upkeep after territory is lost', () => {
    const s = fixture(), owners = territory(s).owners;
    const indices = s.world.tiles.map((_, i) => i).filter(i => owners[i] === 0).slice(0, 20);
    for (const i of indices.slice(0, 2)) s.world.tiles[i].resource = 'stone';
    markWorldChanged(s.world, 'appearance');
    expect(controlledStoneTiles(s, 0)).toBe(2);
    expect(buildCostAt(s, 'wall', 15, 15).gold).toBeCloseTo(BUILD_COSTS.wall.gold * .9);
    expect(buildingMaintenance(s, fixtureBuilding(9, 'tower', 10, 10))).toBeCloseTo(4.5);
    expect(stoneDefenseMultiplier(s, 0, 'palisade')).toBe(1);
    for (const i of indices) s.world.tiles[i].resource = 'stone';
    markWorldChanged(s.world, 'appearance');
    expect(controlledStoneTiles(s, 0)).toBe(20);
    expect(stoneDefenseMultiplier(s, 0, 'wall')).toBe(.25);
    s.buildings[0].faction = 1;
    s.factions.push({ ...s.factions[0], id: 1, relation: 'peace' });
    markWorldChanged(s.world, 'structure');
    expect(controlledStoneTiles(s, 0)).toBe(0);
    expect(buildingMaintenance(s, fixtureBuilding(9, 'tower', 10, 10))).toBe(5);
  });
});

describe('builder-only house navigation', () => {
  it('constructs across a solid line of houses while soldiers remain blocked', () => {
    const s = fixture(); s.factions[0].population = 5; s.buildings[0].unhousedResidents = 5;
    for (let y = 0; y < s.world.height; y++) entityStore(s).buildings.add(fixtureBuilding(200+y, 'house', 15, y));
    const site = fixtureBuilding(500, 'tower', 19, 8); queueConstruction(site, 0); entityStore(s).buildings.add(site);
    ensureBuilders(s); const worker = s.units.find(u => u.builder)!;
    expect(canWalk(s, 15.5, 8.5, 0)).toBe(false);
    expect(canWalk(unitNavigationState(s, worker), 15.5, 8.5, 0)).toBe(true);
    expect(findPath(s, { x: 14.5, y: 8.5 }, { x: 16.5, y: 8.5 }, 0, false)).toHaveLength(0);
    for (let t = 0; t < 1500 && !buildingReady(site); t++) {
      s.time += .1; updateConstruction(s); updateBuilder(s, worker, .1, moveUnit);
    }
    expect(buildingReady(site)).toBe(true);
    const house = s.buildings.find(b => b.x === 15 && b.y === 8)!; house.kind = 'wall'; invalidateNavigation(s);
    expect(canWalk(unitNavigationState(s, worker), 15.5, 8.5, 0)).toBe(false);
  });
});

describe('faction trade and travel-time receipts', () => {
  it('funds one caravan, crosses partner gates, pays both factions, and stops immediately at war', () => {
    const s = foreignTrade();
    for (let y = 0; y < s.world.height; y++) entityStore(s).buildings.add(fixtureBuilding(200+y, 'wall', 25, y, 1));
    entityStore(s).buildings.add(fixtureBuilding(300, 'road', 25, 8, 1));
    expect(establishFactionTrade(s, 1).ok).toBe(true);
    expect(s.factions[0].gold).toBe(750);
    expect(establishFactionTrade(s, 1).ok).toBe(false);
    updateTradeRoutes(s); expect(s.tradeRoutes).toHaveLength(1);
    const route = s.tradeRoutes![0], merchant = s.units.find(u => u.id === route.merchantId)!;
    expect(canWalk(s, 25.5, 8.5, 0)).toBe(false);
    expect(canWalk(unitNavigationState(s, merchant), 25.5, 8.5, 0)).toBe(true);
    for (let t = 0; t < 1000 && route.journeys === 0; t++) { s.time += .1; updateMerchant(s, merchant, .1, moveUnit); }
    expect(route.journeys).toBe(1);
    expect(s.factions[0].gold).toBeGreaterThan(750);
    expect(s.factions[1].gold).toBeCloseTo(s.factions[0].gold - 750);
    s.factions[1].relation = 'war'; const gold = s.factions[0].gold;
    s.time += 2; updateMerchant(s, merchant, 10, (_, u, goal) => Object.assign(u, goal));
    expect(s.factions[0].gold).toBe(gold);
    updateTradeRoutes(s); expect(s.tradeRoutes).toHaveLength(0);
  });
  it('preserves an agreement and accrued transit in saves, and cancels delivery when an endpoint is captured', () => {
    const s = foreignTrade(); establishFactionTrade(s, 1);
    const route = s.tradeRoutes![0], merchant = s.units[0];
    updateMerchant(s, merchant, 1, moveUnit);
    const restored = parseGameSave(serializeGameSave(s));
    expect(restored.factionTrades).toEqual(s.factionTrades);
    expect(restored.tradeRoutes![0].transitSeconds).toBe(route.transitSeconds);
    restored.buildings[1].faction = 0;
    const gold = restored.factions[0].gold;
    updateMerchant(restored, restored.units[0], 100, (_, u, goal) => Object.assign(u, goal));
    expect(restored.factions[0].gold).toBe(gold);
    updateTradeRoutes(restored);
    expect(restored.factionTrades).toHaveLength(0);
    expect(restored.tradeRoutes!.every(r => r.partnerFaction === undefined)).toBe(true);
  });
  it('pays equal amounts for equal travel time regardless of distance and pays nothing while stalled', () => {
    const totals: number[] = [];
    for (const x of [20, 32]) {
      const s = foreignTrade(); s.buildings[1].x = x; establishFactionTrade(s, 1);
      const route = s.tradeRoutes![0], merchant = s.units[0];
      updateMerchant(s, merchant, 100, () => {});
      expect(route.transitSeconds ?? 0).toBe(0);
      expect(s.factions[1].gold).toBe(0);
      updateMerchant(s, merchant, 10, (_, u, goal) => Object.assign(u, goal));
      totals.push(s.factions[1].gold);
      expect(route.transitSeconds).toBe(0);
    }
    expect(totals[0]).toBeCloseTo(totals[1]);
    expect(totals[0]).toBeCloseTo(domesticTradePayout(10, 100, 100));
    expect(domesticTradePayout(20, 100, 100)).toBeCloseTo(2 * totals[0]);
  });
});
