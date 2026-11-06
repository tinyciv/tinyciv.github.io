import { afterEach, describe, expect, it, vi } from 'vitest';
import { scenario } from '../dev/navigation-lab/scenarios';
import { entityStore } from '../src/game/entity-store';
import { attackSpots, claimAttackSpot, movementCongestion, releaseAttackSpot } from '../src/game/engagement';
import * as collisions from '../src/game/collisions';
import { beginUnitFrame, endUnitFrame } from '../src/game/spatial';
import { invalidateNavigation } from '../src/game/pathfinding';
import { sailingNavigation } from '../src/game/sailing';
import { withSimulationReads } from '../src/game/simulation-reads';
import { markWorldChanged } from '../src/game/world-revisions';
import type { Building, Point, Unit } from '../src/game/types';

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const state = scenario('Open melee'), base = state.units[1];
  const attacker = { ...base, id: 100, faction: 0, x: 8.5, y: 12.5 };
  const owner = { ...attacker, id: 101, x: 8.5, y: 15.5 };
  const target = { ...base, id: 900, faction: -2, x: 13.5, y: 12.5 };
  entityStore(state).units.replace([attacker, owner]);
  entityStore(state).buildings.replace([]);
  return { state, attacker, owner, target };
}
const at = (a: Point, b: Point) => Math.floor(a.x) === Math.floor(b.x) && Math.floor(a.y) === Math.floor(b.y);

describe('cell-owned attack reservations', () => {
  it('preserves the inclusive expiry boundary and does not expire a renewed claim', () => {
    const { state, attacker, owner, target } = fixture();
    const first = claimAttackSpot(state, owner, target, () => true)!;
    expect(first).toBeDefined();
    expect(attackSpots(state, attacker, target, () => true).some(point => at(point, first))).toBe(false);
    state.time = 1.25;
    expect(attackSpots(state, attacker, target, () => true).some(point => at(point, first))).toBe(false);
    const renewed = claimAttackSpot(state, owner, target, () => true)!;
    state.time = 1.251;
    expect(attackSpots(state, attacker, target, () => true).some(point => at(point, renewed))).toBe(false);
    state.time = 2.5;
    expect(attackSpots(state, attacker, target, () => true).some(point => at(point, renewed))).toBe(false);
    state.time = 2.501;
    expect(attackSpots(state, attacker, target, () => true).some(point => at(point, renewed))).toBe(true);
  });

  it('releases old cell membership on replacement, cancellation and live death', () => {
    const { state, attacker, owner, target } = fixture();
    const first = claimAttackSpot(state, owner, target, () => true)!;
    expect(first).toBeDefined();
    const secondTarget = { ...target, id: 901, x: 20.5 };
    const second = claimAttackSpot(state, owner, secondTarget, () => true)!;
    expect(second).toBeDefined();
    expect(attackSpots(state, attacker, target, () => true).some(point => at(point, first))).toBe(true);
    expect(attackSpots(state, attacker, secondTarget, () => true).some(point => at(point, second))).toBe(false);
    releaseAttackSpot(state, owner);
    expect(attackSpots(state, attacker, secondTarget, () => true).some(point => at(point, second))).toBe(true);
    const third = claimAttackSpot(state, owner, target, () => true)!;
    owner.hp = 0;
    expect(attackSpots(state, attacker, target, () => true).some(point => at(point, third))).toBe(true);
  });

  it('does not inspect a distant claim while enumerating local target cells', () => {
    const { state, attacker, owner, target } = fixture();
    const remote = claimAttackSpot(state, owner, { ...target, id: 901, x: 25.5, y: 20.5 }, () => true)!;
    expect(remote).toBeDefined();
    const x = remote.x, read = vi.fn(() => x);
    Object.defineProperty(remote, 'x', { get: read, configurable: true });
    beginUnitFrame(state);
    try {
      for (let i = 0; i < 20; i++) {
        state.time += .01;
        expect(attackSpots(state, attacker, target, () => true).length).toBeGreaterThan(0);
      }
      expect(read).not.toHaveBeenCalled();
    } finally { endUnitFrame(state); }
  });
});

describe('work avoided by retained navigation inputs', () => {
  it.each(['worker', 'supplyCart', 'merchant', 'scout'] as const)('does no army or claim preparation for a %s', kind => {
    const { state, attacker, owner, target } = fixture();
    claimAttackSpot(state, owner, target, () => true);
    entityStore(state).units.add(...Array.from({ length: 1000 }, (_, i): Unit => ({ ...attacker, id: 1000 + i, x: 25.5, y: 20.5 })));
    const civilian = { ...attacker, kind }, collision = vi.spyOn(collisions, 'unitBlocksNavigationCell');
    const visitor = vi.fn(), scratch = new Map([[99, 50]]);
    expect(movementCongestion(state, civilian, visitor, scratch)).toBe(scratch);
    expect(scratch.size).toBe(0);
    expect(collision).not.toHaveBeenCalled(); expect(visitor).not.toHaveBeenCalled();
  });

  it('shares static sailing blockers until a structural change, while boat traffic remains live', () => {
    const { state, attacker } = fixture();
    for (const tile of state.world.tiles) { tile.terrain = 'river'; tile.overlay = 'none'; delete tile.farm; }
    markWorldChanged(state.world, 'geometry');
    const building: Building = { id: 500, kind: 'house', faction: 0, x: 14, y: 12, hp: 100, maxHp: 100, capacity: 0 };
    entityStore(state).buildings.add(building);
    const boat = { ...attacker, kind: 'sailboat' as const, x: 11.5, y: 12.5 };
    entityStore(state).units.add({ ...boat, id: 600, x: 16.5 });
    const hp = vi.fn(() => 100);
    Object.defineProperty(building, 'hp', { get: hp, configurable: true });
    withSimulationReads(state, () => {
      expect(sailingNavigation(state, boat).cell(14, 12)).toBe(false);
      expect(sailingNavigation(state, boat).cell(16, 12)).toBe(false);
      const reads = hp.mock.calls.length;
      for (let i = 0; i < 20; i++) expect(sailingNavigation(state, boat).cell(14, 12)).toBe(false);
      expect(hp).toHaveBeenCalledTimes(reads);
      state.units.find(unit => unit.id === 600)!.x = 17.5;
      expect(sailingNavigation(state, boat).cell(16, 12)).toBe(true);
      expect(sailingNavigation(state, boat).cell(17, 12)).toBe(false);
      Object.defineProperty(building, 'hp', { value: 0, writable: true, configurable: true });
      invalidateNavigation(state);
      expect(sailingNavigation(state, boat).cell(14, 12)).toBe(true);
      entityStore(state).buildings.add({ ...building, id: 501, hp: 100 });
      expect(sailingNavigation(state, boat).cell(14, 12)).toBe(false);
    });
    state.buildings.find(candidate => candidate.id === 501)!.hp = 0;
    expect(sailingNavigation(state, boat).cell(14, 12)).toBe(true);
  });
});

describe('retained army and defense membership', () => {
  it('does no squad reconciliation between membership changes and credits only the local squad', async () => {
    const { synchronizeRetinueSquads, invalidateRetinueSquads, recordRetinueKill } = await import('../src/game/retinue-squads');
    const { state, attacker } = fixture();
    entityStore(state).units.replace(Array.from({ length: 90 }, (_, i): Unit => ({ ...attacker, id: 100 + i, kind: 'warrior', marauderPack: undefined, fort: undefined, guardPost: undefined })));
    const last = state.units.at(-1)!;
    withSimulationReads(state, () => {
      synchronizeRetinueSquads(state);
      const hp = vi.fn(() => 100);
      Object.defineProperty(last, 'hp', { get: hp, configurable: true });
      for (let i = 0; i < 20; i++) synchronizeRetinueSquads(state);
      expect(hp).not.toHaveBeenCalled();
      expect(recordRetinueKill(state, state.units[0])).toBe(true);
      expect(state.units.slice(0, 3).map(unit => unit.kills)).toEqual([1, 1, 1]);
      expect(hp).not.toHaveBeenCalled();
      const lastSquad = last.retinueSquad;
      for (const unit of state.units.slice(-3)) Object.defineProperty(unit, 'hp', { value: 0, writable: true, configurable: true });
      invalidateRetinueSquads(state); synchronizeRetinueSquads(state);
      expect(state.retinueSquads?.some(squad => squad.id === lastSquad)).toBe(false);
      const recruit = { ...state.units[0], id: 1000, retinueSquad: undefined, kills: 0 };
      entityStore(state).units.add(recruit); synchronizeRetinueSquads(state);
      expect(recruit.retinueSquad).toBeDefined(); expect(recruit.retinueSquad).not.toBe(lastSquad);
    });
    state.units[0].hp = 0;
    synchronizeRetinueSquads(state);
    expect(recordRetinueKill(state, state.units[1])).toBe(true);
    expect(state.units[1].kills).toBe(2);
  });

  it('does not visit ordinary buildings while updating defensive weapons', async () => {
    const { updateWoodenTowers } = await import('../src/game/tower-combat');
    const { state } = fixture();
    const houses: Building[] = Array.from({ length: 1000 }, (_, id) => ({ id: 2000 + id, kind: 'house', faction: 0, x: 5, y: 5,
      hp: 100, maxHp: 100, capacity: 1 }));
    entityStore(state).buildings.add(...houses, { ...houses[0], id: 4000, kind: 'woodenTower' });
    const kind = vi.fn(() => 'house');
    for (const house of houses) Object.defineProperty(house, 'kind', { get: kind, configurable: true });
    updateWoodenTowers(state, .1, { hostile: () => false, clearShot: () => true, shoot: vi.fn() });
    expect(kind).not.toHaveBeenCalled();
  });
});
