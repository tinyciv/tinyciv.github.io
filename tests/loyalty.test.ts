import { describe, expect, it } from 'vitest';
import { secedeCity, hasSecededCity } from '../src/game/settlement-transfer';
import { recordSettlementCasualty, settlementStep } from '../src/game/settlement-step';
import { TRANSFER, affiliationBreakdown, hostileView, setSettlementAffiliation, settlements, loyaltyOf, settlementCasualty, settlementTrade, villageAlliedWith } from '../src/game/settlement-bridge';
import { recordCivilianCasualty } from '../src/game/civilian-population';
import { territory } from '../src/game/borders';
import { villageDiplomacyStatus, performVillageAction, villageTradeActive } from '../src/game/villages';
import { palaceDefenses } from '../src/game/palace-capture';
import { updateGame, resolvePalaceCapture, diplomacyAction } from '../src/game/simulation';
import { updateFog } from '../src/game/fog';
import { withPlayerFaction } from '../src/game/player-context';
import { entityStore } from '../src/game/entity-store';
import type { GameState } from '../src/game/types';
import { loyaltyFixture } from './helpers/loyalty';
const idle = { up: false, down: false, left: false, right: false };

/** Advance the scheduled settlement pulse only (Rust chunks elapsed time). */
function advance(state: GameState, seconds: number, each?: (time: number) => void): void {
  const end = state.time + seconds;
  while (state.time < end - 1e-9) { state.time = Math.min(end, state.time + 1); each?.(state.time); settlementStep(state); }
}

// Score formulas, constants and the worked examples are Rust unit tests in
// rust/src/affiliation.rs and rust/src/settlement.rs. These exercise the host
// path: scheduled steps, casualty and trade inputs, views and transfers.
describe('city loyalty through the settlement engine', () => {
  it('keeps a peaceful sole capital at or above 70, and a distant second city lower', () => {
    const { state, city, other } = loyaltyFixture();
    advance(state, 600);
    expect(loyaltyOf(state, city).target).toBeLessThan(65);
    entityStore(state).buildings.retain(b => b !== other);
    advance(state, 600);
    const loyalty = loyaltyOf(state, city);
    expect(loyalty.value).toBeGreaterThanOrEqual(69.5);
    expect(loyalty.target).toBeGreaterThanOrEqual(70);
    expect(loyalty.warning).toBe(false);
  });
  it('counts real casualties from any hostile attacker as threat, weighted by population', () => {
    const { state, city, worker } = loyaltyFixture();
    advance(state, 10);
    worker.hp = 0; expect(recordCivilianCasualty(state, worker)).toBe(true);
    recordSettlementCasualty(state, worker, -2);
    advance(state, 5);
    expect(affiliationBreakdown(state, city.id, 0).threat).toBeGreaterThan(0);
    expect(recordCivilianCasualty(state, worker)).toBe(false);
  });
  it('raises loyalty with delivered domestic trade', () => {
    const { state, city, other } = loyaltyFixture();
    advance(state, 10);
    const before = affiliationBreakdown(state, city.id, 0);
    settlementTrade(state, city.id, other.id, 0, 0, 400, 2);
    advance(state, 5);
    const after = affiliationBreakdown(state, city.id, 0);
    expect(before.trade).toBe(0); expect(after.trade).toBeGreaterThan(0);
    expect(after.target).toBeGreaterThan(before.target);
  });
  it('warns, then secedes a raided, culturally foreign city once loyalty reaches zero through the scheduled step', () => {
    const { state, city } = loyaltyFixture();
    // A conquered outpost keeps its Roman heritage under Carthaginian rule,
    // with no other Carthaginian city to support it.
    entityStore(state).buildings.retain(b => !(b.kind === 'palace' && b.faction === 1));
    advance(state, 5);
    city.faction = 1; settlements(state).commitTransfer(city.id, city.id, 1, TRANSFER.capture);
    const raid = () => { if (city.villageId === undefined) settlementCasualty(state, city.id, -2, 4); };
    advance(state, 115, raid);
    expect(loyaltyOf(state, city)).toMatchObject({ value: 60, grace: true });
    let warnedAt = NaN, secededAt = NaN;
    advance(state, 600, time => {
      raid();
      if (Number.isNaN(warnedAt) && loyaltyOf(state, city).warning) warnedAt = time;
      if (Number.isNaN(secededAt) && city.villageId !== undefined) secededAt = time;
    });
    expect(warnedAt).toBeLessThan(secededAt);
    // Several minutes to respond after the grace period ends.
    expect(secededAt - warnedAt).toBeGreaterThan(120);
    expect(state.villages).toHaveLength(1); expect(state.villages![0].secededCity?.formerFaction).toBe(1);
    advance(state, 30);
    expect(state.villages).toHaveLength(1);
  });
});

describe('city secession and reconquest', () => {
  it('transfers only the city, its people, fields and defenses, preserving white territory', () => {
    const { state, city, other, worker, defender, retinue, library, wall } = loyaltyFixture();
    const before = territory(state); const cell = city.y * before.width + city.x;
    secedeCity(state, city); const village = state.villages![0], neutral = state.factions.find(f => f.id === city.faction)!;
    expect(neutral).toMatchObject({ color: '#ffffff', population: 9, villageId: village.id });
    expect(state.factions[0].population).toBe(4); expect(other.faction).toBe(0); expect(retinue.faction).toBe(0);
    expect([worker, defender, library, wall].every(e => e.faction === city.faction && e.villageId === village.id)).toBe(true);
    expect(state.fields![0].faction).toBe(city.faction); expect(territory(state).owners[cell]).toBe(city.faction);
    expect(village.secededCity!.territoryCells.length).toBeGreaterThan(20);
    advance(state, 120); expect(village.destroyed).not.toBe(true);
    expect(palaceDefenses(state, city)).toEqual([]);
  });
  it('offers trade, alliance and war, and changes route and hostility state', () => {
    const { state, city } = loyaltyFixture(); secedeCity(state, city); const village = state.villages![0];
    // A freshly seceded city resents its former owner: alliance needs affiliation 45.
    expect(villageDiplomacyStatus(state, city, true)).toMatchObject({ trade: { available: true, cost: 200 }, ally: { available: false, cost: 3000 }, war: { available: true, cost: 0 } });
    setSettlementAffiliation(state, city.id, 0, 50);
    expect(villageDiplomacyStatus(state, city, true)?.ally).toMatchObject({ available: true, cost: 3000 });
    expect(performVillageAction(state, city, 'trade', true).ok).toBe(true); expect(villageTradeActive(state, village, 0)).toBe(true);
    expect(state.tradeRoutes?.some(route => route.villageId === village.id)).toBe(true);
    expect(performVillageAction(state, city, 'ally', true).ok).toBe(true); expect(villageAlliedWith(state, village, 0)).toBe(true);
    expect(performVillageAction(state, city, 'war', true).ok).toBe(true); expect(hostileView(state, 0, city.faction)).toBe(true);
    expect(villageTradeActive(state, village, 0)).toBe(false); expect(villageAlliedWith(state, village, 0)).toBe(false);
  });
  it('lets the second multiplayer faction negotiate for itself', () => {
    const { state, city, leader } = loyaltyFixture(); secedeCity(state, city);
    state.multiplayer = { humanFactionIds: [0, 1], inputs: {}, controls: {}, winner: null };
    entityStore(state).units.add({ ...leader, id: 990, faction: 1 }); state.factions[1].gold = 10000;
    setSettlementAffiliation(state, city.id, 1, 50);
    withPlayerFaction(state, 1, () => { updateFog(state); expect(diplomacyAction(state, city.faction, 'ally', city.id).ok).toBe(true); });
    expect(state.factions[1].gold).toBe(7000); expect(state.factions[0].gold).toBe(10000);
    expect(villageAlliedWith(state, state.villages![0], 1)).toBe(true); expect(villageAlliedWith(state, state.villages![0], 0)).toBe(false);
  });
  it('captures through real projectile combat and restores people, defenses, borders and loyalty', () => {
    const { state, city, leader, guard, library, worker, wall } = loyaltyFixture(); secedeCity(state, city); const neutral = city.faction;
    performVillageAction(state, city, 'war', true); city.hp = 1;
    state.projectiles = [{ start: { x: leader.x, y: leader.y }, end: { x: city.x + 1, y: city.y + 1 }, x: leader.x, y: leader.y,
      attacker: leader.id, target: city.id, faction: 0, damage: 100, elapsed: 0, duration: .01 }];
    updateGame(state, .1, idle); expect(state.palaceCaptures?.length).toBe(1);
    const result = resolvePalaceCapture(state, city.id, true); expect(result.ok).toBe(true);
    expect(state.factions[0].population).toBe(13); expect(state.factions.find(f => f.id === neutral)?.defeated).toBe(true);
    expect([guard, library, worker, wall].every(e => e.faction === 0 && e.villageId === undefined)).toBe(true);
    expect(guard.hp).toBeGreaterThan(0);
    expect(loyaltyOf(state, result.palace!).value).toBe(60);
    expect(territory(state).owners[city.y * state.world.width + city.x]).toBe(0);
    expect(state.villages![0].destroyed).toBe(true);
  });
  it('keeps a surviving Leader in play when their last city secedes', () => {
    const { state, city, other } = loyaltyFixture(); entityStore(state).buildings.retain(b => b !== other);
    secedeCity(state, city); expect(hasSecededCity(state, 0)).toBe(true);
    updateGame(state, .1, idle); expect(state.gameOver).toBe(false);
  });
});
