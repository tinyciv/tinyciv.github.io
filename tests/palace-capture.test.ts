import { indexedBuilding } from '../src/game/spatial';
import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { commandAttackAt, resolvePalaceCapture, updateGame, validateBuildAt } from '../src/game/simulation';
import { buildingReady, type Building, type GameState, type Unit } from '../src/game/types';
import { canWalk } from '../src/game/pathfinding';
import { territory } from '../src/game/borders';
import { citySummaries } from '../src/game/cities';
import { palaceDefenses } from '../src/game/palace-capture';

const idle = { up: false, down: false, left: false, right: false };
const palace = (id: number, x: number, faction: number): Building => ({
  id, kind: 'palace', faction, x, y: 10, hp: faction ? 1 : 650, maxHp: 650, armor: 2, capacity: 0,
  cityName: faction ? 'Thebes' : 'Roma', governorNextPlanAt: 1e9,
});
const leader = (id: number, faction = 0): Unit => ({
  id, kind: 'leader', faction, x: 12.5, y: 11.5, hp: 100, maxHp: 100, morale: 100,
  attack: 0, defense: 5, speed: 0, range: 4, order: 'hold', cooldown: 0, lastCombat: -60,
  moving: false, facing: 0, attackTime: 0,
});
const structure = (id: number, kind: Building['kind'], x: number, y: number, faction = 1): Building => ({
  id, kind, x, y, faction, hp: 100, maxHp: 100, capacity: kind === 'house' ? 4 : 0, attackCooldown: 1e9,
});
function fixture(): GameState {
  return {
    world: { width: 32, height: 24, seed: 'capture', source: 'test', spawns: [],
      tiles: Array.from({ length: 32 * 24 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 3, gold: 0, production: 1, variation: .5 })) },
    buildings: [palace(1, 3, 0), palace(2, 14, 1)], units: [leader(20)],
    factions: [0, 1].map(id => ({ id, name: id ? 'Egyptians' : 'Romans', color: id ? '#cc5555' : '#3988ff',
      relation: id ? 'war' : 'self', affinity: 0, food: 100, gold: 100, production: 0, population: 0,
      yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1e9, defeated: false })),
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'capture', rngState: 1,
    fields: [], raiderCamps: [], marauderPacks: [], wildlife: { herds: [], nextRespawnAt: 1e9, sequence: 0, targetHerds: 0 },
    fogRaids: { nextAt: 1e9, waves: 0 },
    projectiles: [{ start: { x: 12.5, y: 11.5 }, end: { x: 15, y: 11 }, x: 12.5, y: 11.5,
      attacker: 20, target: 2, faction: 0, damage: 10, elapsed: 0, duration: .05 }],
  };
}

describe('conquered palace decisions', () => {
  it('offers capture after the killing projectile, freezes time, and defers final victory', () => {
    const state = fixture();
    updateGame(state, 3, idle);
    expect(state.buildings.some(b => b.id === 2)).toBe(false);
    expect(state.palaceCaptures).toMatchObject([{ palaceId: 2, faction: 1, x: 14, y: 10, cityName: 'Thebes' }]);
    expect(state.factions[1].defeated).toBe(true);
    expect(state.gameOver).toBe(false);
    expect(state.time).toBeCloseTo(.1);
    updateGame(state, 10, idle);
    expect(state.time).toBeCloseTo(.1);
  });

  it('instantly places a named player palace at 10% health without charging construction', () => {
    const state = fixture(); updateGame(state, .1, idle);
    const gold = state.factions[0].gold;
    expect(canWalk(state, 14.5, 10.5, 0)).toBe(true);
    const result = resolvePalaceCapture(state, 2, true), captured = result.palace!;
    expect(result.ok).toBe(true);
    expect(captured).toMatchObject({ kind: 'palace', faction: 0, x: 14, y: 10, cityName: 'Thebes', hp: 65, maxHp: 650 });
    expect(captured.id).not.toBe(2);
    expect(buildingReady(captured)).toBe(true);
    expect(captured.construction).toBeUndefined();
    expect(state.palaceCaptures).toEqual([]);
    expect(state.factions[0].gold).toBe(gold);
    expect(canWalk(state, 14.5, 10.5, 0)).toBe(false);
    expect(resolvePalaceCapture(state, 2, true).ok).toBe(false);
    updateGame(state, .1, idle);
    expect(state.victory).toBe(true);
  });

  it('registers the final reserved capture ID and removes it cleanly', () => {
    const state = fixture(); updateGame(state, .1, idle);
    state.palaceCaptures![0].palaceId = 10000;
    const provisional = Math.max(...state.units.map(unit => unit.id), ...state.buildings.map(building => building.id)) + 1;
    const captured = resolvePalaceCapture(state, 10000, true).palace!;
    expect(captured.id).toBe(10001);
    expect(indexedBuilding(state, captured.id)).toBe(captured);
    expect(indexedBuilding(state, provisional)).toBeUndefined();
    entityStore(state).buildings.retain(building => building !== captured);
    expect(indexedBuilding(state, captured.id)).toBeUndefined();
    expect(entityStore(state).buildings.query('palace')).not.toContain(captured);
  });

  it('retains people living in palace quarters when their city is captured', () => {
    const state = fixture(), home = state.buildings[1];
    home.capacity = 4; home.unhousedResidents = 4; state.factions[1].population = 4;
    updateGame(state, .1, idle);
    expect(state.palaceCaptures![0]).toMatchObject({ population: 4, unhousedResidents: 4 });
    const captured = resolvePalaceCapture(state, home.id, true).palace!;
    expect(captured).toMatchObject({ capacity: 4, unhousedResidents: 4 });
    expect(state.factions[0].population).toBe(4);
    expect(citySummaries(state).find(city => city.palace === captured)).toMatchObject({ population: 4, housing: 4, food: 0 });
  });

  it('leaves the palace destroyed when declined and resumes victory evaluation', () => {
    const state = fixture(); entityStore(state).buildings.add(structure(10, 'house', 17, 9), structure(11, 'library', 16, 12));
    updateGame(state, .1, idle);
    expect(resolvePalaceCapture(state, 2, false).ok).toBe(true);
    expect(state.buildings.filter(b => b.kind === 'palace')).toHaveLength(1);
    expect(state.buildings.filter(b => b.faction === 1).map(b => b.id)).toEqual([10, 11]);
    expect(state.palaceCaptures).toEqual([]);
    updateGame(state, .1, idle);
    expect(state.gameOver).toBe(true); expect(state.victory).toBe(true);
  });

  it('also offers capture for a melee victory while the rival retains its other city', () => {
    const state = fixture(); state.projectiles = [];
    entityStore(state).buildings.add({ ...palace(3, 24, 1), hp: 650, cityName: 'Memphis' });
    entityStore(state).units.add({ ...leader(21), kind: 'warrior', x: 13.5, attack: 100, range: 1.1, target: 2 });
    updateGame(state, .1, idle);
    expect(state.palaceCaptures?.[0].cityName).toBe('Thebes');
    expect(state.factions[1].defeated).toBe(false);
    resolvePalaceCapture(state, 2, true);
    expect(state.buildings.find(b => b.id === 3)?.faction).toBe(1);
    updateGame(state, .1, idle); expect(state.gameOver).toBe(false);
  });

  it('does not offer the player cities destroyed by another rival or raiders', () => {
    const state = fixture(); entityStore(state).units.add({ ...leader(22, -2), kind: 'warrior' });
    state.projectiles![0].faction = -2; state.projectiles![0].attacker = 22;
    updateGame(state, .1, idle);
    expect(state.palaceCaptures ?? []).toHaveLength(0);
    expect(state.buildings.some(b => b.id === 2)).toBe(false);
  });

  it('queues simultaneous victories and resolves each city exactly once', () => {
    const state = fixture(); entityStore(state).buildings.add({ ...palace(3, 24, 1), cityName: 'Memphis' });
    state.projectiles!.push({ ...state.projectiles![0], target: 3, end: { x: 25, y: 11 } });
    updateGame(state, .1, idle);
    expect(state.palaceCaptures).toHaveLength(2);
    resolvePalaceCapture(state, 2, true);
    const time = state.time; updateGame(state, 1, idle); expect(state.time).toBe(time);
    resolvePalaceCapture(state, 3, false);
    expect(state.buildings.filter(b => b.kind === 'palace').map(b => b.cityName)).toEqual(['Roma', 'Thebes']);
  });

  it.each(['fort', 'woodenTower', 'tower', 'guardPost'] as const)('requires the city’s %s to fall before palace melee or projectiles can hurt it', kind => {
    const state = fixture(), keep = state.buildings[1];
    entityStore(state).buildings.add(structure(30, kind, 17, 10));
    entityStore(state).units.add({ ...leader(21), kind: 'warrior', x: 13.5, attack: 100, range: 1.1, target: 2 });
    updateGame(state, .1, idle);
    expect(keep.hp).toBe(1); expect(state.palaceCaptures ?? []).toHaveLength(0);
    expect(state.gameOver).toBe(false);
    state.buildings.find(building => building.id === 30)!.hp = 0;
    state.projectiles = [{ start: { x: 12.5, y: 11.5 }, end: { x: 15, y: 11 }, x: 12.5, y: 11.5,
      attacker: 20, target: 2, faction: 0, damage: 10, elapsed: 0, duration: .05 }];
    updateGame(state, .1, idle);
    expect(state.palaceCaptures?.[0].palaceId).toBe(2);
  });

  it('preserves local, queued and distant Fort ownership and ruins when a nearby palace is captured', () => {
    const state = fixture();
    entityStore(state).buildings.add({ ...palace(3, 24, 1), hp: 650 });
    const fortData = { brigadeLevel: 2 as const, funded: false, nextUpkeepAt: 30, nextRecruitAt: 0, destroyed: true, initialGold: 300 };
    const local = { ...structure(30, 'fort', 17, 10), hp: 0, fort: { ...fortData } };
    const queued = { ...structure(31, 'fort', 17, 13), construction: { startedAt: 0, duration: 60, waitingForBuilder: true } };
    const distant = { ...structure(32, 'fort', 1, 1, 0), hp: 0, fort: { ...fortData } };
    const standing = structure(33, 'fort', 26, 16);
    entityStore(state).buildings.add(local, queued, distant, standing);
    updateGame(state, .1, idle);
    expect(state.palaceCaptures?.[0].palaceId).toBe(2);
    expect(state.palaceCaptures?.[0].buildingIds).not.toContain(queued.id);
    expect(resolvePalaceCapture(state, 2, true).ok).toBe(true);
    for (const fort of [local, queued, distant, standing]) expect(state.buildings).toContain(fort);
    expect([local.faction, queued.faction, distant.faction, standing.faction]).toEqual([1, 1, 0, 1]);
    expect(local.fort).toEqual(fortData); expect(distant.fort).toEqual(fortData);
    expect(queued.construction?.waitingForBuilder).toBe(true); expect(standing.hp).toBeGreaterThan(0);
  });

  it('redirects a manual palace attack to its defenses and explains the requirement', () => {
    const state = fixture(); state.projectiles = [];
    entityStore(state).buildings.add(structure(30, 'woodenTower', 17, 10));
    state.units[0].attack = 25;
    expect(commandAttackAt(state, 15, 11)).toBe(true);
    expect(state.units[0].forcedAttack?.target).toBe(30);
    expect(state.events.at(-1)?.text).toContain('watchtowers and guard posts');
  });

  it('uses only that city’s defenses and ignores empty construction reservations', () => {
    const state = fixture();
    entityStore(state).buildings.add({ ...palace(3, 24, 1), hp: 650 }, structure(30, 'guardPost', 26, 10));
    const queued = { ...structure(31, 'woodenTower', 17, 10), construction: { startedAt: 0, duration: 90, waitingForBuilder: true } };
    entityStore(state).buildings.add(queued);
    expect(palaceDefenses(state, state.buildings[1])).toHaveLength(0);
    queued.construction.waitingForBuilder = false;
    expect(palaceDefenses(state, state.buildings[1]).map(building => building.id)).toEqual([31]);
    queued.construction.waitingForBuilder = true;
    updateGame(state, .1, idle);
    const captured = resolvePalaceCapture(state, 2, true);
    expect(captured.ok).toBe(true);
    expect(state.buildings.find(building => building.id === 31)).toBeUndefined();
    expect(state.buildings.find(building => building.id === 30)?.faction).toBe(1);
  });

  it('annexes civilian buildings, residents and workers while preserving the rival’s other city', () => {
    const state = fixture();
    entityStore(state).buildings.add({ ...palace(3, 24, 1), hp: 650, cityName: 'Memphis' },
      { ...structure(10, 'house', 17, 9), residents: 3 }, { ...structure(11, 'house', 25, 8), residents: 4 },
      structure(12, 'library', 16, 12), structure(13, 'camp', 17, 6), structure(14, 'monument', 18, 11),
      structure(15, 'camp', 26, 14), structure(16, 'blacksmith', 17, 14), structure(17, 'well', 18, 8),
      structure(18, 'road', 16, 9));
    state.factions[1].population = 8; state.buildings[1].unhousedResidents = 1;
    state.buildings[1].populationGrowth = 3.5;
    entityStore(state).units.add({ ...leader(40, 1), kind: 'worker', home: 2, collector: true, collectorCamp: 13, inside: true, collectPhase: 'idle' },
      { ...leader(41, 1), kind: 'worker', home: 3, collector: true, collectorCamp: 15, inside: true, collectPhase: 'idle' },
      { ...leader(42, 1), kind: 'warrior', home: 2 });
    updateGame(state, .1, idle);
    const captured = resolvePalaceCapture(state, 2, true).palace!;
    for (const id of [10, 12, 13, 14, 16, 17, 18]) expect(state.buildings.find(building => building.id === id)?.faction).toBe(0);
    for (const id of [3, 11, 15]) expect(state.buildings.find(building => building.id === id)?.faction).toBe(1);
    expect(state.factions[0].population).toBe(4); expect(state.factions[1].population).toBe(4);
    expect(citySummaries(state).find(city => city.palace.id === captured.id)?.population).toBe(4);
    expect(citySummaries(state).find(city => city.palace.id === 3)?.population).toBe(4);
    expect(captured.populationGrowth).toBe(3.5);
    expect(state.units.find(unit => unit.id === 40)).toMatchObject({ faction: 0, home: captured.id, collectorCamp: 13 });
    expect(state.units.find(unit => unit.id === 41)).toMatchObject({ faction: 1, home: 3 });
    expect(state.units.find(unit => unit.id === 42)?.faction).toBe(1);
    expect(state.fields?.filter(field => field.camp === 13).every(field => field.faction === 0)).toBe(true);
  });

  it('immediately replaces cached borders and permits building beside annexed civilian buildings', () => {
    const state = fixture(); state.factions[0].gold = 1000;
    entityStore(state).buildings.add({ ...palace(3, 24, 1), hp: 650 }, structure(10, 'house', 17, 9),
      structure(12, 'library', 16, 12), structure(14, 'monument', 18, 11));
    const before = territory(state), cell = 9 * state.world.width + 16;
    expect(before.owners[cell]).toBe(1);
    updateGame(state, .1, idle); resolvePalaceCapture(state, 2, true);
    const after = territory(state);
    expect(after).not.toBe(before); expect(after.owners[cell]).toBe(0);
    expect(after.owners[11 * state.world.width + 25]).toBe(1);
    expect(after.edges.some(edge => edge.faction === 0 && edge.x > 10)).toBe(true);
    expect(validateBuildAt(state, 'house', 16, 9)).toEqual({ ok: true, message: '' });
    expect(validateBuildAt(state, 'library', 16, 15)).toEqual({ ok: true, message: '' });
  });

  it('snapshots simultaneous cities before either palace disappears, so annexation does not steal neighbors twice', () => {
    const state = fixture();
    entityStore(state).buildings.add({ ...palace(3, 24, 1), cityName: 'Memphis' },
      { ...structure(10, 'house', 17, 9), residents: 1 }, { ...structure(11, 'house', 25, 8), residents: 2 });
    state.factions[1].population = 3;
    state.projectiles!.push({ ...state.projectiles![0], target: 3, end: { x: 25, y: 11 } });
    updateGame(state, .1, idle);
    expect(state.palaceCaptures?.map(offer => offer.buildingIds)).toEqual([[10], [11]]);
    resolvePalaceCapture(state, 3, true);
    expect(state.factions[0].population).toBe(2); expect(state.buildings.find(building => building.id === 10)?.faction).toBe(1);
    resolvePalaceCapture(state, 2, true);
    expect(state.factions[0].population).toBe(3); expect(state.factions[1].population).toBe(0);
  });
});
