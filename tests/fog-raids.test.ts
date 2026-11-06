import { entityStore } from '../src/game/entity-store';
import { describe, expect, it, vi } from 'vitest';
import { constructionEdges } from '../src/game/builders';
import { fogRaidProfile, initializeFogRaids, updateFogRaids, MAX_RAIDER_GROUP_SIZE, MAX_RAIDER_WAVE_SIZE } from '../src/game/fog-raids';
import { MAX_LIVE_RAIDERS, MAX_LIVE_RAIDERS_PER_CAMP, RAIDER_COLOR, RAIDER_CAMP_REBUILD_SECONDS, RAIDER_CAMP_RETRY_SECONDS, campSpawnTiles, raiderCampActive, raiderCampCenter, raiderCampWarning } from '../src/game/raider-camps';
import { raiderWaveInterval } from '../src/game/raider-pressure';
import { canWalk, findPath, travelTimeMapFrom } from '../src/game/pathfinding';
import { createGame } from '../src/game/simulation';
import { distance, isWallKind, type Building, type GameState, type Unit, type World } from '../src/game/types';
import { generateWorld } from '../src/world/generator';
import { updateFog } from '../src/game/fog';
import { recordNativeFrame } from './helpers/native-renderer';

function unit(id: number, x: number, y: number, kind: Unit['kind'] = 'warrior', faction = 0): Unit {
  return { id, x, y, kind, faction, hp: 100, morale: 100, attack: 17, defense: 4, speed: 3.6,
    range: 1.1, order: 'follow', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 };
}
function building(id: number, x: number, y: number, kind: Building['kind'] = 'palace', faction = 0): Building {
  return { id, x, y, kind, faction, hp: 100, maxHp: 100, capacity: 0 };
}
function fixture(retinue = 2): GameState {
  const world: World = { width: 80, height: 72, seed: 'camp-raid-test', source: 'test', spawns: [], revision: 0,
    tiles: Array.from({ length: 80 * 72 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .2,
      moisture: .5, food: 1, production: 0, gold: 0, variation: .5 })) };
  return { world, units: [unit(1, 42.5, 36.5, 'leader'), ...Array.from({ length: retinue }, (_, index) => unit(index + 2, 43.5 + index % 3, 34.5 + Math.floor(index / 3)))],
    buildings: [building(100, 39, 35)], factions: [], time: 0, tick: 0, paused: false, speed: 1,
    events: [], particles: [], selected: null, selectedType: null, buildMode: null, diplomacy: null,
    gameOver: false, victory: false, seed: world.seed, rngState: 731, marauderPacks: [] };
}
function due(state: GameState): void { initializeFogRaids(state); state.time = state.fogRaids!.nextAt; updateFogRaids(state); }
const raiders = (state: GameState): Unit[] => state.units.filter(unit => state.marauderPacks?.some(pack => pack.raid && pack.id === unit.marauderPack) && unit.hp > 0);

describe('destructible raider camps and ramped waves', () => {
  it('doubles opening pressure, keeps increasing after five minutes, and saturates at two parties', () => {
    expect([0, 60, 120, 180, 240, 300].map(time => fogRaidProfile(2, time).total)).toEqual([4, 4, 12, 20, 28, 36]);
    expect(fogRaidProfile(2, 60)).toEqual({ total: 4, parties: 1, hp: 70, attack: 13, defense: 2 });
    expect(fogRaidProfile(2, 300)).toEqual({ total: 36, parties: 2, hp: 91, attack: 17, defense: 3 });
    expect([360, 600, 900, 1800, 3600].map(time => fogRaidProfile(2, time).total)).toEqual([38, 46, 56, 60, 60]);
    expect(fogRaidProfile(10000, 86400)).toEqual(fogRaidProfile(60, 3600));
    expect(fogRaidProfile(2, 900).hp).toBe(fogRaidProfile(2, 300).hp);
    expect(fogRaidProfile(24, 60).total).toBe(4);
    expect(fogRaidProfile(24, 300).total).toBeGreaterThan(fogRaidProfile(2, 300).total);
  });

  it('starts with slightly more frequent waves and progressively shortens their intervals', () => {
    const state = fixture(); initializeFogRaids(state);
    expect(state.raiderCamps!.map(camp => camp.nextRaidAt)).toEqual([60, 86]);
    const arrivals: number[] = [];
    for (let wave = 0; wave < 6; wave++) {
      state.time = state.fogRaids!.nextAt;
      updateFogRaids(state); arrivals.push(state.time);
      // Let the previous wave leave the muster area for this scheduling check.
      for (const unit of raiders(state)) unit.hp = 0;
    }
    expect(arrivals.slice(0, 2)).toEqual([60, 86]);
    expect(arrivals[2]).toBeCloseTo(60 + 2 * raiderWaveInterval(60));
    expect(arrivals[3]).toBeCloseTo(86 + 2 * raiderWaveInterval(86));
    expect(arrivals.slice(1).every((time, i) => time - arrivals[i] < 30)).toBe(true);
    expect(state.fogRaids!.waves).toBe(6);
  });

  it('allows eight separate live waves, then waits for one to finish', () => {
    const state = fixture(); initializeFogRaids(state);
    for (let wave = 0; wave < 8; wave++) {
      state.time = state.fogRaids!.nextAt;
      for (const unit of raiders(state)) unit.lastCombat = state.time; // These waves remain actively engaged.
      updateFogRaids(state);
      for (const unit of raiders(state)) { unit.x = 42.5; unit.y = 40.5; }
    }
    expect(state.fogRaids!.waves).toBe(8);
    state.time = state.fogRaids!.nextAt;
      for (const unit of raiders(state)) unit.lastCombat = state.time; // These waves remain actively engaged.
      updateFogRaids(state);
    expect(state.fogRaids!.waves).toBe(8);
    const firstTime = state.marauderPacks!.find(pack => pack.raid)!.spawnedAt;
    const firstIds = new Set(state.marauderPacks!.filter(pack => pack.raid && pack.spawnedAt === firstTime).map(pack => pack.id));
    for (const unit of state.units) if (firstIds.has(unit.marauderPack ?? -1)) unit.hp = 0;
    state.time = state.fogRaids!.nextAt;
      for (const unit of raiders(state)) unit.lastCombat = state.time; // These waves remain actively engaged.
      updateFogRaids(state);
    expect(state.fogRaids!.waves).toBe(9);
  });

  it('musters a bounded late wave on connected ground around its camp', () => {
    const state = fixture(); initializeFogRaids(state);
    for (const camp of state.raiderCamps!.slice(1)) camp.nextRaidAt = Infinity;
    state.time = 3600; updateFogRaids(state);
    expect(raiders(state)).toHaveLength(MAX_RAIDER_WAVE_SIZE);
    const camp = state.raiderCamps![0];
    expect(raiders(state).every(unit => findPath(state, unit, { x: camp.gate.x + .5, y: camp.gate.y + .5 }, -2).length > 0
      || Math.floor(unit.x) === camp.gate.x && Math.floor(unit.y) === camp.gate.y)).toBe(true);
  });

  it('plateaus over four hours even when every wave returns alive and no raiders are killed', () => {
    const state = fixture(); initializeFogRaids(state);
    // Wilderness bands and raiders without a pack must share the same budget.
    state.marauderPacks!.push({ id: 500, name: 'Wanderers', color: RAIDER_COLOR, targetFaction: 0,
      home: { x: 42.5, y: 42.5 }, waypoint: { x: 42.5, y: 42.5 }, nextWanderAt: Infinity });
    for (let i = 0; i < 60; i++) entityStore(state).units.add({ ...unit(20000 + i, 42.5, 42.5, 'warrior', -2),
      marauderPack: i < 40 ? 500 : undefined });
    const counts: number[] = [], start = performance.now();
    for (let time = 1800; time <= 1800 + 4 * 3600; time += 15) {
      state.time = time; updateFogRaids(state);
      // Returning bands used to disappear from the active-wave budget, causing
      // unlimited replacement waves while their survivors still occupied the map.
      for (const pack of state.marauderPacks!) if (pack.raid) pack.returning = true;
      for (const raider of raiders(state)) { raider.x = 42.5; raider.y = 40.5; }
      const living = state.units.filter(unit => unit.hp > 0 && unit.faction === -2);
      counts.push(living.length);
      expect(living.length).toBeLessThanOrEqual(MAX_LIVE_RAIDERS);
      for (const camp of state.raiderCamps!) {
        const packs = new Set(state.marauderPacks!.filter(pack => pack.raiderCamp === camp.id).map(pack => pack.id));
        expect(living.filter(unit => packs.has(unit.marauderPack ?? -1)).length).toBeLessThanOrEqual(MAX_LIVE_RAIDERS_PER_CAMP);
      }
    }
    expect(Math.max(...counts)).toBe(MAX_LIVE_RAIDERS);
    expect(counts.slice(-100).every(count => count === MAX_LIVE_RAIDERS)).toBe(true);
    expect(state.fogRaids!.waves).toBe(4);
    expect(state.marauderPacks!.length).toBe(7); // Six camp parties and one wilderness band.
    console.log('four-hour raider saturation', { max: Math.max(...counts), final: counts.at(-1),
      waves: state.fogRaids!.waves, packs: state.marauderPacks!.length, elapsedMs: performance.now() - start });
  });

  it('counts destroyed-camp survivors and unassigned raiders, then replaces only actual casualties', () => {
    const state = fixture(); initializeFogRaids(state);
    const [camp, destroyed] = state.raiderCamps!;
    for (const house of state.buildings) if (destroyed.coreTowers!.includes(house.id)) house.hp = 0;
    state.marauderPacks!.push({ id: 500, name: 'Survivors', color: RAIDER_COLOR, targetFaction: 0,
      raiderCamp: destroyed.id, raid: true, returning: true, home: { x: 42.5, y: 42.5 },
      waypoint: { x: 42.5, y: 42.5 }, nextWanderAt: Infinity });
    for (let i = 0; i < MAX_LIVE_RAIDERS; i++) entityStore(state).units.add({ ...unit(20000 + i, 42.5, 42.5, 'warrior', -2),
      marauderPack: i < 120 ? 500 : undefined });
    state.time = 3600; updateFogRaids(state);
    expect(camp.waves).toBe(0);
    expect(state.units.filter(unit => unit.hp > 0 && unit.faction === -2)).toHaveLength(MAX_LIVE_RAIDERS);
    for (const dead of state.units.filter(unit => unit.faction === -2).slice(0, 13)) dead.hp = 0;
    state.time = state.fogRaids!.nextAt; updateFogRaids(state);
    const newRaid = state.units.filter(unit => unit.bornAt === state.time && unit.faction === -2);
    expect(newRaid).toHaveLength(13);
    expect(newRaid.filter(unit => unit.marauderLeader)).toHaveLength(1);
    expect(state.units.filter(unit => unit.hp > 0 && unit.faction === -2)).toHaveLength(MAX_LIVE_RAIDERS);
    expect(state.marauderPacks!.find(pack => pack.id === newRaid[0].marauderPack)!.startingTroops).toBe(12);
  });

  it('redeploys returned veterans at the population cap without healing, teleporting or adding bodies', () => {
    const state = fixture(); initializeFogRaids(state);
    const camp = state.raiderCamps![0]; state.raiderCamps![1].nextRaidAt = Infinity;
    const home = { x: camp.gate.x + .5, y: camp.gate.y + .5 };
    state.marauderPacks!.push({ id: 500, name: 'Returning', color: RAIDER_COLOR, targetFaction: 0,
      raiderCamp: camp.id, raid: true, returning: true, home, waypoint: home, nextWanderAt: 0,
      leaderId: 20000, startingTroops: 29 });
    for (let i = 0; i < MAX_LIVE_RAIDERS; i++) entityStore(state).units.add({
      ...unit(20000 + i, i < 30 ? home.x : 42.5, i < 30 ? home.y : 42.5, 'warrior', -2),
      hp: 40, maxHp: 100, kills: 7, marauderPack: i < 30 ? 500 : undefined, marauderLeader: i === 0,
    });
    const before = state.units.map(unit => [unit.id, unit.hp, unit.x, unit.y, unit.kills]);
    state.time = 3600; updateFogRaids(state);
    expect(state.units.map(unit => [unit.id, unit.hp, unit.x, unit.y, unit.kills])).toEqual(before);
    expect(camp.waves).toBe(1);
    expect(state.marauderPacks).toHaveLength(1);
    const pack = state.marauderPacks![0];
    expect(pack.id).not.toBe(500); expect(pack.leaderId).toBe(20000); expect(pack.startingTroops).toBe(29);
    const members = state.units.filter(unit => unit.marauderPack === pack.id);
    expect(members).toHaveLength(30); expect(members.filter(unit => unit.marauderLeader)).toHaveLength(1);
    expect(pack.returning).toBeUndefined();
  });

  it('never musters units across an uncrossable river beside the camp', () => {
    const state = fixture(); initializeFogRaids(state);
    const camp = state.raiderCamps![0], riverX = camp.x + camp.width + 2;
    for (let y = 0; y < state.world.height; y++) state.world.tiles[y * state.world.width + riverX].terrain = 'river';
    const points = campSpawnTiles(state, camp, 100);
    expect(points.length).toBeGreaterThan(0);
    expect(points.every(point => point.x < riverX)).toBe(true);
  });

  it('builds compact tent camps with wooden towers, complete palisade wards, and owned gates', () => {
    const state = fixture(); initializeFogRaids(state);
    expect(state.raiderCamps).toHaveLength(2);
    expect(state.raiderCamps!.map(camp => camp.size).sort()).toEqual(['medium', 'small']);
    for (const camp of state.raiderCamps!) {
      const profile = { small: { tents: [3, 5], towers: 5, tiers: 2 }, medium: { tents: [6, 9], towers: 6, tiers: 3 },
        large: { tents: [10, 18], towers: 7, tiers: 4 } }[camp.size];
      expect(camp.houses.length).toBeGreaterThanOrEqual(profile.tents[0]); expect(camp.houses.length).toBeLessThanOrEqual(profile.tents[1]);
      expect(distance(raiderCampCenter(camp), { x: 40, y: 36 })).toBeGreaterThanOrEqual(21);
      const structures = state.buildings.filter(b => b.raiderCamp === camp.id);
      expect(structures.every(b => b.faction === -2 && b.capacity === 0)).toBe(true);
      expect(structures.filter(b => b.kind === 'palisade').length).toBeGreaterThan(0);
      expect(structures.filter(b => b.kind === 'woodenTower')).toHaveLength(profile.towers);
      const roadCells = new Set(structures.filter(b => b.kind === 'road').map(b => `${b.x},${b.y}`));
      expect(structures.filter(b => isWallKind(b.kind) && roadCells.has(`${b.x},${b.y}`))).toHaveLength(profile.tiers);
      for (const house of structures.filter(b => b.kind === 'villageTent')) {
        expect(house.x).toBeGreaterThanOrEqual(camp.x); expect(house.x).toBeLessThan(camp.x + camp.width);
        expect(house.y).toBeGreaterThanOrEqual(camp.y); expect(house.y).toBeLessThan(camp.y + camp.height);
      }
      const atGate = structures.filter(b => b.x === camp.gate.x && b.y === camp.gate.y);
      expect(atGate.map(b => b.kind).sort()).toEqual(['road', 'wall']);
      expect(canWalk(state, camp.gate.x + .5, camp.gate.y + .5, -2)).toBe(true);
      expect(canWalk(state, camp.gate.x + .5, camp.gate.y + .5, 0)).toBe(false);
    }
  });

  it('spawns only at a surviving camp, at full health, with an accessible building objective', () => {
    const state = fixture(8); state.units[1].hp = 0; due(state);
    const spawned = raiders(state), profile = fogRaidProfile(7, state.time);
    expect(spawned).toHaveLength(profile.total);
    expect(state.fogRaids!.waves).toBe(1);
    expect(new Set(spawned.map(unit => `${unit.x},${unit.y}`)).size).toBe(spawned.length);
    for (const raider of spawned) {
      const pack = state.marauderPacks!.find(pack => pack.id === raider.marauderPack)!;
      const camp = state.raiderCamps!.find(camp => camp.id === pack.raiderCamp)!;
      const target = state.buildings.find(building => building.id === pack.targetBuilding)!;
      expect(distance(raider, raiderCampCenter(camp))).toBeLessThanOrEqual(Math.max(9, Math.hypot(camp.width, camp.height) / 2 + 1));
      expect(raider.hp).toBeCloseTo(profile.hp * (raider.marauderLeader ? 1.2 : 1));
      expect(raider.hp).toBe(raider.maxHp);
      expect(raider.speed).toBeCloseTo(raider.marauderLeader ? 3.525 : 2.35);
      expect(pack.color).toBe(RAIDER_COLOR); expect(pack.retinueAtSpawn).toBe(7);
      expect(canWalk(state, pack.home.x, pack.home.y, -2)).toBe(true);
      expect(constructionEdges(state, target).some(edge => findPath(state, raider, edge, -2).length > 0)).toBe(true);
    }
    expect(state.events).toEqual([]);
  });

  it.each([60, 180, 300, 1800])('applies commander bonuses and archer role stats to each party at %i seconds', time => {
    const state = fixture(2); initializeFogRaids(state);
    // Exercise one camp's full wave, including multiple parties at mature strength.
    for (const camp of state.raiderCamps!.slice(1)) camp.nextRaidAt = Infinity;
    state.time = time; updateFogRaids(state);
    const profile = fogRaidProfile(2, time), spawned = raiders(state);
    expect(spawned).toHaveLength(profile.total);
    expect(spawned.filter(unit => unit.marauderLeader)).toHaveLength(profile.parties);
    for (const id of new Set(spawned.map(unit => unit.marauderPack))) {
      const group = spawned.filter(unit => unit.marauderPack === id);
      expect(group.length).toBeLessThanOrEqual(MAX_RAIDER_GROUP_SIZE);
      expect(group.filter(unit => unit.marauderLeader)).toHaveLength(1);
    }
    for (const unit of spawned) {
      expect(unit.maxHp).toBeCloseTo(profile.hp * (unit.marauderLeader ? 1.2 : unit.kind === 'archer' ? 2 / 3 : 1));
      expect(unit.hp).toBe(unit.maxHp);
      expect(unit.attack).toBe(unit.marauderLeader ? Math.round(profile.attack * 1.4) : profile.attack * (unit.kind === 'archer' ? .8 : 1));
      expect(unit.speed).toBeCloseTo(unit.marauderLeader ? 3.525 : 2.35);
    }
  });

  it('shows a ten-second warning only for the camp whose party is next', () => {
    const state = fixture(); initializeFogRaids(state);
    const [first, second] = state.raiderCamps!;
    state.time = 49.9; expect(raiderCampWarning(state, first)).toBe(false);
    state.time = 50; expect(raiderCampWarning(state, first)).toBe(true);
    expect(raiderCampWarning(state, second)).toBe(false);
    state.time = 60; updateFogRaids(state);
    expect(raiderCampWarning(state, first)).toBe(false);
    state.time = 80; expect(raiderCampWarning(state, second)).toBe(true);
  });

  it('draws a jumping red warning for explored camps without revealing unexplored ones', () => {
    const state = fixture(); initializeFogRaids(state); state.time = 55;
    const fog = updateFog(state), camp = state.raiderCamps![0], center = raiderCampCenter(camp);
    const draw = (time: number) => {
      state.time = time;
      return recordNativeFrame(state, { fog }).texts.filter(text => text.color === '#ff3b30');
    };
    expect(draw(55)).toHaveLength(0);
    fog.explored[Math.floor(center.y) * fog.width + Math.floor(center.x)] = 1;
    const initial = draw(Math.PI * 108 / 6), later = draw(Math.PI * 108 / 6 + Math.PI / 12);
    expect(initial).toHaveLength(1); expect(later).toHaveLength(1);
    expect(initial[0].text).toBe('!');
    expect(later[0].y).toBeLessThan(initial[0].y);
  });

  it('continues while one core tower survives, then stops waves from that camp and schedules its replacement', () => {
    const state = fixture(); initializeFogRaids(state); const first = state.raiderCamps![0];
    for (const house of state.buildings) if (first.coreTowers!.includes(house.id) && house.id !== first.coreTowers![0]) house.hp = 0;
    expect(raiderCampActive(state, first)).toBe(true); due(state);
    expect(state.marauderPacks!.some(pack => pack.raiderCamp === first.id)).toBe(true);
    const original = raiders(state).map(unit => unit.id);
    state.buildings.find(building => building.id === first.coreTowers![0])!.hp = 0;
    updateFogRaids(state); expect(first.destroyed).toBe(true); expect(raiderCampWarning(state, first)).toBe(false);
    expect(first.replacementAt).toBe(state.time + RAIDER_CAMP_REBUILD_SECONDS);
    due(state);
    expect(state.marauderPacks!.filter(pack => pack.raiderCamp === first.id)).toHaveLength(0); // Survivors find a living camp or resume attacking.
    expect(original.every(id => state.units.some(unit => unit.id === id))).toBe(true);
    const restored = structuredClone(state); initializeFogRaids(restored);
    expect(restored.raiderCamps![0].destroyed).toBe(true);
  });

  it('replaces destroyed camps in fog after a respite, preserving deadlines across reloads', () => {
    const state = fixture(); initializeFogRaids(state);
    const original = state.raiderCamps!.map(camp => camp.id);
    for (const b of state.buildings) if (b.raiderCamp && b.kind === 'woodenTower') b.hp = 0;
    state.time = 300; updateFogRaids(state);
    expect(raiders(state)).toEqual([]); expect(state.raiderCamps!.every(camp => camp.destroyed)).toBe(true);
    expect(state.fogRaids!.nextAt).toBe(300 + RAIDER_CAMP_REBUILD_SECONDS);
    const restored = structuredClone(state); initializeFogRaids(restored);
    restored.time = 300 + RAIDER_CAMP_REBUILD_SECONDS - 1; updateFogRaids(restored);
    expect(restored.raiderCamps!.every(camp => camp.destroyed)).toBe(true);
    restored.time++;
    const fog = updateFog(restored);
    updateFogRaids(restored);
    expect(restored.raiderCamps).toHaveLength(original.length);
    expect(restored.raiderCamps!.every(camp => raiderCampActive(restored, camp) && !original.includes(camp.id))).toBe(true);
    for (const camp of restored.raiderCamps!) {
      expect(camp.nextRaidAt).toBeGreaterThanOrEqual(restored.time + 60);
      for (let y = camp.y - 1; y <= camp.y + camp.height; y++) for (let x = camp.x - 1; x <= camp.x + camp.width; x++)
        expect(fog.visible[y * fog.width + x]).toBe(0);
    }
    expect(raiders(restored)).toEqual([]);
    due(restored); expect(raiders(restored).length).toBeGreaterThan(0);
    restored.raiderCamps = []; initializeFogRaids(restored); updateFogRaids(restored);
    expect(restored.raiderCamps).toEqual([]);
  });

  it('defers camp replacement while all potential sites are observed', () => {
    const state = fixture(); initializeFogRaids(state);
    for (const building of state.buildings) if (building.raiderCamp && building.kind === 'woodenTower') building.hp = 0;
    updateFogRaids(state);
    state.time = RAIDER_CAMP_REBUILD_SECONDS;
    const fog = updateFog(state); fog.visible.fill(1);
    updateFogRaids(state);
    expect(state.raiderCamps!.every(camp => camp.destroyed)).toBe(true);
    expect(state.raiderCamps!.every(camp => camp.replacementAt === state.time + RAIDER_CAMP_RETRY_SECONDS)).toBe(true);
    expect(raiders(state)).toHaveLength(0);
  });

  it('preserves schedules and identity through reload, with deterministic new camps', () => {
    const first = fixture(), second = fixture(); initializeFogRaids(first); initializeFogRaids(second);
    expect(first.raiderCamps).toEqual(second.raiderCamps); expect(first.buildings).toEqual(second.buildings);
    first.time = 51;
    const restored = structuredClone(first); initializeFogRaids(restored, 30);
    expect(restored.raiderCamps).toEqual(first.raiderCamps); expect(restored.fogRaids).toEqual(first.fogRaids);
    due(first); due(restored); expect(restored.units).toEqual(first.units); expect(restored.marauderPacks).toEqual(first.marauderPacks);
  });

  it('replaces obsolete fog raids while preserving independent bands and full factions', () => {
    const state = fixture(), fullFaction = unit(400, 60.5, 35.5, 'warrior', 1);
    entityStore(state).units.add(fullFaction, { ...unit(401, 20.5, 35.5, 'warrior', -2), marauderPack: 5 },
      { ...unit(402, 21.5, 35.5, 'warrior', -2), marauderPack: 6 });
    state.marauderPacks = [{ id: 5, name: 'Old band', color: '#fff', targetFaction: 0, home: { x: 20.5, y: 35.5 }, waypoint: { x: 20.5, y: 35.5 }, nextWanderAt: 0, approachAt: 1 }];
    state.marauderPacks.push({ ...state.marauderPacks[0], id: 6, raid: true });
    initializeFogRaids(state);
    expect(state.units).toContain(fullFaction); expect(state.units.some(unit => unit.id === 401)).toBe(true);
    expect(state.units.some(unit => unit.id === 402)).toBe(false);
    expect(state.marauderPacks).toHaveLength(1); expect(state.marauderPacks![0].approachAt).toBeUndefined();
    due(state); const count = raiders(state).length; initializeFogRaids(state); expect(raiders(state)).toHaveLength(count);
  });

  it.each(['queued', 'paused', 'evacuating'])('keeps %s sites and farms out of raid objectives', phase => {
    const state = fixture(); initializeFogRaids(state);
    entityStore(state).buildings.replace(state.buildings.filter(b => b.faction !== 0));
    const pending = building(20000, 39, 35, 'house');
    pending.construction = { startedAt: 0, duration: 20, waitingForBuilder: phase === 'queued',
      pausedAt: phase === 'paused' ? 0 : undefined, evacuating: phase === 'evacuating' };
    entityStore(state).buildings.add(pending, building(20001, 44, 35, 'camp'));
    due(state); expect(raiders(state)).toEqual([]);
  });

  it('does not put camps on disconnected land or force them into water', () => {
    const state = fixture();
    for (let y = 0; y < 72; y++) for (let x = 0; x < 80; x++)
      if (Math.max(Math.abs(x - 40), Math.abs(y - 36)) === 9) state.world.tiles[y * 80 + x].terrain = 'river';
    initializeFogRaids(state); expect(state.raiderCamps).toEqual([]);
    state.time = 600; updateFogRaids(state); expect(raiders(state)).toEqual([]);
  });

  it('pauses due parties, and stops after the game has ended', () => {
    const state = fixture(); initializeFogRaids(state); state.time = 60; state.paused = true;
    updateFogRaids(state); expect(raiders(state)).toEqual([]); expect(state.raiderCamps![0].nextRaidAt).toBe(60);
    state.paused = false; state.gameOver = true; updateFogRaids(state); expect(raiders(state)).toEqual([]);
    state.gameOver = false; updateFogRaids(state); expect(raiders(state)).toHaveLength(4);
  });

  it.each(['willow-raid', 'river-raid', 'coastal-raid'])('places reachable camps on generated world %s', { timeout: 120_000 }, seed => {
    const state = createGame(generateWorld(seed));
    expect(state.raiderCamps!.length).toBeGreaterThan(0);
    // The committed stockades must not sever the same approach that was open
    // while the site was being planned, including camps which raid later.
    // Rival settlements now start fully enclosed. Siege planning can breach
    // their walls; actual terrain and the camp's own stockades stay impassable.
    const planning = { ...state, buildings: state.buildings.filter(building => building.faction < 0 || !isWallKind(building.kind)) };
    const palaceEdges = planning.buildings.filter(b => b.kind === 'palace' && b.faction >= 0).flatMap(b => constructionEdges(planning, b));
    const access = travelTimeMapFrom(planning, palaceEdges, -2, 2.35, Infinity);
    for (const camp of state.raiderCamps!) expect(Number.isFinite(access[camp.gate.y * state.world.width + camp.gate.x])).toBe(true);
    due(state); const spawned = raiders(state).filter(unit => state.marauderPacks!.some(pack => pack.id === unit.marauderPack && !pack.microRaid));
    expect(spawned).toHaveLength(fogRaidProfile(2, state.time).total);
    for (const raider of spawned) {
      const pack = state.marauderPacks!.find(pack => pack.id === raider.marauderPack)!;
      const target = state.buildings.find(building => building.id === pack.targetBuilding)!;
      expect(constructionEdges(planning, target).some(edge => findPath(planning, raider, edge, -2).length > 0)).toBe(true);
    }
  });
});
