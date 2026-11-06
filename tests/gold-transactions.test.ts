import { describe, expect, it } from 'vitest';
import { purchaseBlacksmithUpgrade } from '../src/game/blacksmith';
import { removeCoveredRoads } from '../src/game/covered-roads';
import { entityStore } from '../src/game/entity-store';
import { goldFlowSummary } from '../src/game/gold-ledger';
import { guardPostUpkeep, updateGuardPosts, upgradeGuardPost } from '../src/game/guard-posts';
import { importImmigrant } from '../src/game/immigration';
import { purchaseOrchardUpgrade } from '../src/game/orchards';
import { updateRaiderGroupMotivation, updateRaiderMotivation } from '../src/game/raider-motivations';
import { purchaseRetinueSlot } from '../src/game/retinue-purchases';
import { purchaseKeepHousing } from '../src/game/settlement-upgrades';
import { updateMerchant } from '../src/game/trade';
import { updateTreasureChests } from '../src/game/treasure';
import { buildingHeight, type Building, type GameState, type MarauderPack } from '../src/game/types';
import { performVillageAction, updateVillages, VILLAGE_DEVELOPMENT_COSTS } from '../src/game/villages';
import { building, fixture as researchFixture, person } from './helpers/research-income';

function fixture(): GameState {
  const state = researchFixture();
  entityStore(state).buildings.replace([building(1, 'palace', 6, 10)]);
  state.factions[0].gold = 10000;
  return state;
}
function nearby(state: GameState, target: Building): void {
  Object.assign(state.units[0], { x: target.x + .5, y: target.y + buildingHeight(target) + .5 });
}
function villageFixture(): GameState {
  const state = fixture(), camp = { ...building(3, 'villageTent', 24, 10, 1), villageId: 1 };
  entityStore(state).buildings.add(camp);
  state.factions.push({ id: 1, villageId: 1, name: 'Sabines', color: '#fff', affinity: 50, relation: 'peace', population: 0,
    food: 0, gold: 0, production: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false });
  state.villages = [{ id: 1, faction: 1, campId: 3, name: 'Sabines', identity: 'growers', relation: 'neutral', x: 24, y: 10,
    nextGrowthAt: Infinity, nextRecruitAt: Infinity, nextThinkAt: 0 }];
  nearby(state, camp);
  return state;
}

describe('gold ledger records actual gameplay transactions', () => {
  it('categorizes successful purchases at rounded prices and ignores rejected purchases', () => {
    const state = fixture(), faction = state.factions[0], keep = state.buildings[0];
    keep.palaceLevel = 2; keep.capacity = 10;
    const smith = building(2, 'blacksmith', 12, 10), farm = building(3, 'camp', 15, 10), post = building(4, 'guardPost', 18, 10);
    entityStore(state).buildings.add(smith, farm, post);
    nearby(state, smith);
    expect(purchaseBlacksmithUpgrade(state, smith, 'armor').ok).toBe(true);
    expect(purchaseBlacksmithUpgrade(state, smith, 'weapon').ok).toBe(true);
    nearby(state, farm); expect(purchaseOrchardUpgrade(state, farm).ok).toBe(true);
    expect(purchaseOrchardUpgrade(state, farm).ok).toBe(false);
    nearby(state, post); expect(upgradeGuardPost(state, post).ok).toBe(true);
    nearby(state, keep); expect(purchaseKeepHousing(state, keep).ok).toBe(true);
    expect(purchaseKeepHousing(state, keep).ok).toBe(false);
    expect(purchaseRetinueSlot(state, keep).ok).toBe(true);
    expect(importImmigrant(state, keep).ok).toBe(true);
    const summary = goldFlowSummary(state, faction);
    expect(summary.inputs).toEqual([]);
    expect(summary.outlays.map(row => [row.category, row.amount])).toEqual([
      ['army', 1000], ['upgrades', 1505], ['immigration', 100],
    ]);
    expect(faction.gold - 10000).toBe(summary.net);
    expect(faction.incomeTotals?.gold ?? 0).toBe(0);
  });

  it('records a covered-road refund once without generating earnings or Science', () => {
    const state = researchFixture(), faction = state.factions[0];
    const road = { ...building(30, 'road', 18, 10), construction: { startedAt: 0, duration: 10, paidGold: 2 } };
    entityStore(state).buildings.add(road);
    state.time = 2.5;
    const beforeResearch = structuredClone(faction.research), beforeIncome = structuredClone(faction.incomeTotals), gold = faction.gold;
    removeCoveredRoads(state, building(31, 'house', 18, 10));
    removeCoveredRoads(state, building(31, 'house', 18, 10));
    expect(state.buildings).not.toContain(road);
    expect(faction.gold).toBe(gold + 1.5);
    expect(faction.research).toEqual(beforeResearch); expect(faction.incomeTotals).toEqual(beforeIncome);
    expect(goldFlowSummary(state, faction)).toMatchObject({ inputs: [{ category: 'refunds', amount: 1.5 }], outlays: [], net: 1.5 });
  });

  it('records full treasure receipts and separately accounts for their Science diversion', () => {
    const state = researchFixture(), faction = state.factions[0], leader = state.units[0], gold = faction.gold;
    state.treasures = [{ id: 1, x: Math.floor(leader.x), y: Math.floor(leader.y) }];
    updateTreasureChests(state); updateTreasureChests(state);
    expect(faction.incomeTotals?.gold).toBe(200);
    expect(goldFlowSummary(state, faction)).toMatchObject({ inputs: [{ category: 'treasure', amount: 200 }],
      outlays: [{ category: 'science', amount: 50 }], totalInputs: 200, totalOutlays: 50, net: 150 });
    expect(faction.gold - gold).toBe(150);
  });

  it('records a village agreement only once and both parties’ delivered trade income, never partial travel', () => {
    const state = villageFixture(), faction = state.factions[0], village = state.factions[1], camp = state.buildings[1];
    expect(performVillageAction(state, camp, 'trade').ok).toBe(true);
    expect(performVillageAction(state, camp, 'trade').ok).toBe(false);
    expect(goldFlowSummary(state, faction)).toMatchObject({ inputs: [], outlays: [{ category: 'diplomacy', amount: 250 }], net: -250 });
    const route = state.tradeRoutes!.find(candidate => candidate.villageId === 1)!;
    const merchant = state.units.find(unit => unit.id === route.merchantId)!;
    state.time = .1; updateMerchant(state, merchant, .1, () => {});
    expect(goldFlowSummary(state, faction).totalInputs).toBe(0);
    route.distance = 100; route.goal = { x: merchant.x, y: merchant.y };
    updateMerchant(state, merchant, .1, () => {}); updateMerchant(state, merchant, .1, () => {});
    expect(route.journeys).toBe(1);
    expect(goldFlowSummary(state, faction).inputs).toMatchObject([{ category: 'trade', amount: 120 }]);
    expect(goldFlowSummary(state, village)).toMatchObject({ inputs: [{ category: 'trade', amount: 120 }], outlays: [], net: 120 });
    expect(faction.gold - 10000).toBe(-130); expect(village.gold).toBe(120);
  });

  it('records actual village construction and guard purchases from its treasury', () => {
    const state = villageFixture(), village = state.villages![0], faction = state.factions[1];
    faction.gold = 500; village.nextGrowthAt = 0; village.nextRecruitAt = 0;
    updateVillages(state);
    const houses = state.buildings.filter(item => item.villageId === village.id && item.kind === 'house');
    expect(houses.length).toBeGreaterThan(0);
    expect(state.units.filter(unit => unit.villageId === village.id && unit.kind === 'warrior')).toHaveLength(1);
    const summary = goldFlowSummary(state, faction);
    expect(summary.outlays.map(row => [row.category, row.amount])).toEqual([
      ['construction', houses.length * VILLAGE_DEVELOPMENT_COSTS.house], ['army', VILLAGE_DEVELOPMENT_COSTS.guard],
    ]);
    expect(faction.gold - 500).toBe(summary.net);
    updateVillages(state); expect(goldFlowSummary(state, faction)).toEqual(summary);
  });

  it('records guard service only when paid and does not record suspended service as an expense', () => {
    const state = fixture(), faction = state.factions[0], post = building(2, 'guardPost', 10, 10);
    post.guardPost = { level: 0, funded: true, nextUpkeepAt: 30, needsRecruits: true };
    entityStore(state).buildings.add(post);
    const update = () => updateGuardPosts(state, { hostile: () => false });
    update(); expect(goldFlowSummary(state, faction).totalOutlays).toBe(0);
    state.time = 30; update(); update();
    expect(goldFlowSummary(state, faction).outlays).toMatchObject([{ category: 'defenses', amount: guardPostUpkeep(post) }]);
    faction.gold = 14; state.time = 60; update();
    expect(post.guardPost.funded).toBe(false); expect(faction.gold).toBe(14);
    expect(goldFlowSummary(state, faction).totalOutlays).toBe(15);
  });

  it('records theft once for the actual amount removed, without reducing gross earnings', () => {
    const state = fixture(), faction = state.factions[0], palace = state.buildings[0];
    faction.gold = 500; state.units[0].x = 1.5; state.units[0].y = 1.5;
    entityStore(state).units.retain(unit => unit.kind === 'leader');
    const pack: MarauderPack = { id: 50, name: 'Thieves', color: '#111', targetFaction: 0, targetBuilding: palace.id,
      raid: true, motivation: 'theft', phase: 'approach', home: { x: 2.5, y: 2.5 }, waypoint: { x: 7, y: 11 },
      nextWanderAt: 0, startingTroops: 2, leaderId: 100, raiderCamp: 60 };
    const members = [100, 101, 102].map(id => ({ ...person(id, 'warrior', palace.x - .5, palace.y + .5, -2),
      marauderPack: pack.id, order: 'raid' as const }));
    state.marauderPacks = [pack]; entityStore(state).units.add(...members);
    updateRaiderGroupMotivation(state, pack, members);
    for (const member of members) updateRaiderMotivation(state, member, .1, { move: () => {}, attack: () => {}, visible: () => true });
    expect(faction.gold).toBe(250);
    expect(members.reduce((sum, unit) => sum + (unit.stolenGold ?? 0), 0)).toBe(250);
    expect(goldFlowSummary(state, faction)).toMatchObject({ inputs: [], outlays: [{ category: 'raided', amount: 250 }], net: -250 });
    expect(faction.incomeTotals?.gold ?? 0).toBe(0);
  });
});
