import { describe, expect, it, vi } from 'vitest';
import { scoutRealm } from './helpers/scouts';
import { entityStore } from '../src/game/entity-store';
import { BUILD_COSTS, buildAt, updateGame, validateBuildAt } from '../src/game/simulation';
import { automaticallyRebuildDefenses, recordDestroyedDefense, setAutomaticallyRebuildDefenses, updateDefenseRebuilds } from '../src/game/defense-rebuilding';
import { demolishBuildingsInArea } from '../src/game/area-tools';
import { parseGameSave, serializeGameSave } from '../src/game/game-save';
import { applyGameCommand } from '../src/multiplayer/commands';
import { canWalk } from '../src/game/pathfinding';
import type { Building, GameState } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
function fixture(kind: Building['kind'] = 'wall') {
  const state = scoutRealm(), leader = state.units[0];
  leader.x = 35.5; leader.y = 25.5; leader.attack = 0;
  entityStore(state).units.replace([leader]);
  Object.assign(state.factions[0], { population: 20, gold: 1000 });
  Object.assign(state.factions[0].research!.levels, { wall: 1, woodenTower: 1 });
  const palace: Building = { id: 100, kind: 'palace', faction: 0, x: 2, y: 2, hp: 650, maxHp: 650,
    capacity: 20, unhousedResidents: 20, governorPermissions: { farms: false, housing: false } };
  const defense: Building = { id: 101, kind, faction: 0, x: 6, y: 4, hp: 100, maxHp: 100, capacity: 0 };
  entityStore(state).buildings.replace([palace, defense]);
  return { state, defense, palace };
}
function advance(state: GameState, seconds: number) {
  for (let elapsed = 0; elapsed < seconds - 1e-7; elapsed += .05) updateGame(state, .05, idle);
}
function destroy(state: GameState, defense: Building) {
  const from = { x: defense.x + .5, y: defense.y + 1.5 };
  state.projectiles = [{ kind: 'arrow', attacker: 900, faction: -2, target: defense.id, ...from,
    start: from, end: { x: defense.x + .5, y: defense.y + .5 }, elapsed: 0, duration: .01, damage: 10000 }];
  updateGame(state, .05, idle);
  expect(defense.hp).toBe(0);
}

describe('automatic defense rebuilding', () => {
  it.each(['wall', 'palisade', 'woodenTower'] as const)('rebuilds a combat-destroyed %s with paid builder work while the Leader is away', kind => {
    const { state, defense } = fixture(kind);
    destroy(state, defense);
    expect(state.defenseRebuilds).toHaveLength(1);
    expect(validateBuildAt(state, kind, defense.x, defense.y).message).toContain('leader');
    advance(state, 1.2);
    const replacement = state.buildings.find(building => building.kind === kind)!;
    expect(replacement).toBeDefined(); expect(replacement.id).toBeGreaterThan(defense.id);
    expect(replacement.construction?.paidGold).toBe(BUILD_COSTS[kind].gold);
    expect(state.factions[0].gold).toBe(1000 - BUILD_COSTS[kind].gold);
    expect(state.defenseRebuilds).toHaveLength(0);
    for (let step = 0; step < 500 && replacement.construction; step++) updateGame(state, .05, idle);
    expect(replacement.construction).toBeUndefined(); expect(replacement.hp).toBe(replacement.maxHp);
    expect(state.buildings.filter(building => building.kind === kind)).toHaveLength(1);
  });

  it('retains a surviving gate road and lets friendly units use the rebuilt gate', () => {
    const { state, defense } = fixture();
    const road: Building = { ...defense, id: 102, kind: 'road' };
    // These gates were legally opened by placing roads over existing walls;
    // reconstructing the same wall must not apply new-gate spacing rules.
    entityStore(state).buildings.add(road, { ...defense, id: 103, x: 7 }, { ...road, id: 104, x: 7 });
    destroy(state, defense); advance(state, 15);
    expect(state.buildings).toContain(road);
    expect(state.buildings.some(building => building.kind === 'wall' && !building.construction)).toBe(true);
    expect(canWalk(state, 6.5, 4.5, 0)).toBe(true);
    expect(canWalk(state, 6.5, 4.5, -2)).toBe(false);
  });

  it('waits for resources and saves the pending order without charging twice', () => {
    const { state, defense } = fixture(); state.factions[0].gold = 0;
    destroy(state, defense); advance(state, 3);
    expect(state.defenseRebuilds).toHaveLength(1); expect(state.buildings.some(building => building.kind === 'wall')).toBe(false);
    const restored = parseGameSave(serializeGameSave(state)); restored.factions[0].gold = 50;
    advance(restored, 5);
    expect(restored.defenseRebuilds).toHaveLength(0);
    expect(restored.factions[0].gold).toBe(50 - BUILD_COSTS.wall.gold);
    expect(restored.buildings.filter(building => building.kind === 'wall')).toHaveLength(1);
  });

  it('does not reuse another fallen defense or stale projectile target identity', () => {
    const { state, defense } = fixture();
    recordDestroyedDefense(state, defense);
    recordDestroyedDefense(state, { ...defense, id: 102, x: 8 });
    entityStore(state).buildings.retain(building => building !== defense);
    state.projectiles = [{ attacker: 300, target: 301, faction: -2, damage: 1, x: 4, y: 4,
      start: { x: 4, y: 4 }, end: { x: 5, y: 5 }, elapsed: 0, duration: 10 }];
    state.time = 2;
    updateDefenseRebuilds(state, (order, minimumId) => buildAt(state, order.kind, order.x, order.y, order.faction, undefined, { ...order, minimumId }).ok);
    const rebuilt = state.buildings.filter(building => building.kind === 'wall');
    expect(rebuilt).toHaveLength(2);
    expect(rebuilt.every(building => building.id > 301)).toBe(true);
    expect(new Set(rebuilt.map(building => building.id)).size).toBe(2);
  });

  it('never rebuilds deliberately demolished defenses or canceled construction', () => {
    const { state, defense } = fixture();
    expect(demolishBuildingsInArea(state, defense, defense, 0).count).toBe(1);
    advance(state, 5);
    expect(state.defenseRebuilds ?? []).toHaveLength(0);
    expect(state.buildings.some(building => building.kind === 'wall')).toBe(false);
    expect(state.factions[0].gold).toBe(1000);
  });

  it('disables future replacements and drops pending orders through the authenticated setting command', () => {
    const { state, defense } = fixture();
    expect(automaticallyRebuildDefenses(state.factions[0])).toBe(true);
    destroy(state, defense);
    expect(applyGameCommand(state, 0, { type: 'auto-rebuild-defenses', enabled: false, faction: 9 }).ok).toBe(true);
    expect(automaticallyRebuildDefenses(state.factions[0])).toBe(false);
    advance(state, 4); expect(state.defenseRebuilds).toHaveLength(0);
    expect(state.buildings.some(building => building.kind === 'wall')).toBe(false);
    expect(applyGameCommand(state, 0, { type: 'auto-rebuild-defenses', enabled: 'yes' }).ok).toBe(false);
    expect(parseGameSave(serializeGameSave(state)).factions[0].autoRebuildDefenses).toBe(false);
  });

  it('bounds retry work and does not keep charging or retrying while disabled', () => {
    const { state, defense } = fixture();
    for (let i = 0; i < 20; i++) recordDestroyedDefense(state, { ...defense, id: 200 + i, x: 4 + i % 4, y: 5 + Math.floor(i / 4) });
    state.time = 2;
    const attempt = vi.fn(() => false);
    updateDefenseRebuilds(state, attempt); expect(attempt).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 10; i++) updateDefenseRebuilds(state, attempt);
    expect(attempt).toHaveBeenCalledTimes(3);
    setAutomaticallyRebuildDefenses(state, false); state.time = 100;
    updateDefenseRebuilds(state, attempt); expect(attempt).toHaveBeenCalledTimes(3);
  });
});
