import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { createGame, getLeader, migrateGame, updateGame } from '../src/game/simulation';
import { initializeRoamingMarauders, ROAMING_PACK_SPACING, ROAMING_PALACE_CLEARANCE, roamingPackTarget } from '../src/game/roaming-marauders';
import { fogRaidProfile, initializeFogRaids, updateFogRaids } from '../src/game/fog-raids';
import { MAX_LIVE_RAIDERS } from '../src/game/raider-camps';
import { pointInSight, updateFog } from '../src/game/fog';
import { canWalk, findPath, staticReachabilityMask } from '../src/game/pathfinding';
import { distance, type GameState } from '../src/game/types';
import { generateWorld } from '../src/world/generator';

const roamers = (state: GameState) => (state.marauderPacks ?? []).filter(pack => !pack.raid && pack.raiderCamp === undefined);
function removeRoamers(state: GameState): void {
  const ids = new Set(roamers(state).map(pack => pack.id));
  entityStore(state).units.replace(state.units.filter(unit => !ids.has(unit.marauderPack ?? -1)));
  state.marauderPacks = state.marauderPacks?.filter(pack => !ids.has(pack.id));
  delete state.roamingMaraudersVersion;
}

describe('independent wilderness marauders', { timeout: 120_000 }, () => {
  it.each(['willow-raid', 'river-raid', 'coastal-raid'])('scatters many small, full-health packs over reachable wilderness on %s', seed => {
    const state = createGame(generateWorld(seed)), packs = roamers(state), fog = updateFog(state);
    const palaces = state.buildings.filter(building => building.kind === 'palace');
    // Satellite islands and ocean are not wilderness a land-only pack can
    // patrol. Measure spread across the connected starting landmass instead
    // of requiring marauders to span the entire rectangular map.
    const mainland = staticReachabilityMask({ ...state, buildings: [] }, [state.world.spawns[0]], -2);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < mainland.length; i++) if (mainland[i]) {
      const x = i % state.world.width, y = Math.floor(i / state.world.width);
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    expect(roamingPackTarget(state)).toBe(12);
    const opening = state.marauderPacks!.filter(pack => pack.microRaid);
    expect(packs.length + opening.length).toBe(roamingPackTarget(state));
    const cells: string[] = [];
    for (const pack of packs) {
      expect(mainland[Math.floor(pack.home.y) * state.world.width + Math.floor(pack.home.x)], 'pack stays on the reachable mainland').toBe(1);
      const members = state.units.filter(unit => unit.marauderPack === pack.id);
      expect(members.length).toBeGreaterThanOrEqual(2); expect(members.length).toBeLessThanOrEqual(6);
      expect(pack.raid).toBeUndefined(); expect(pack.raiderCamp).toBeUndefined(); expect(pack.approachAt).toBeUndefined();
      for (const other of packs) if (other !== pack) expect(distance(pack.home, other.home)).toBeGreaterThanOrEqual(ROAMING_PACK_SPACING);
      for (const unit of members) {
        const hp = unit.marauderLeader ? 78 : 65;
        expect(unit).toMatchObject({ faction: -2, order: 'wander', hp, maxHp: hp });
        expect(unit.speed).toBeCloseTo(unit.marauderLeader ? 3.525 : 2.35);
        expect(pointInSight(fog, unit.x, unit.y)).toBe(false); expect(canWalk(state, unit.x, unit.y, -2)).toBe(true);
        expect(distance(unit, pack.home)).toBeLessThanOrEqual(2.5);
        expect(findPath(state, unit, pack.home, -2).length).toBeGreaterThan(0);
        for (const palace of palaces) expect(distance(unit, { x: palace.x + 1, y: palace.y + 1 })).toBeGreaterThanOrEqual(ROAMING_PALACE_CLEARANCE);
        cells.push(`${Math.floor(unit.x)},${Math.floor(unit.y)}`);
      }
    }
    expect(new Set(cells).size).toBe(cells.length);
    // Large camp wards remove nearby wilderness spawn sites. Still require
    // independent bands to span at least half the usable land in both axes.
    expect(Math.max(...packs.map(pack => pack.home.x)) - Math.min(...packs.map(pack => pack.home.x))).toBeGreaterThan((maxX - minX + 1) * .5);
    expect(Math.max(...packs.map(pack => pack.home.y)) - Math.min(...packs.map(pack => pack.home.y))).toBeGreaterThan((maxY - minY + 1) * .5);
  });

  it('is deterministic and leaves camp clocks and the simulation RNG untouched', () => {
    const state = createGame(generateWorld('deterministic-wilderness')); removeRoamers(state);
    const clone = structuredClone(state), rng = state.rngState, clocks = structuredClone([state.fogRaids, state.raiderCamps]);
    initializeRoamingMarauders(state); initializeRoamingMarauders(clone);
    expect([state.units, state.marauderPacks]).toEqual([clone.units, clone.marauderPacks]); expect(state.rngState).toBe(rng);
    expect([state.fogRaids, state.raiderCamps]).toEqual(clocks);
    const originalUnits = state.units.map(unit => unit.id);
    state.time = state.fogRaids!.nextAt; updateFogRaids(state);
    const raids = state.marauderPacks!.filter(pack => pack.raid && !pack.microRaid), ids = new Set(raids.map(pack => pack.id));
    expect(state.units.filter(unit => ids.has(unit.marauderPack ?? -1))).toHaveLength(fogRaidProfile(2, state.time).total);
    expect(originalUnits.every(id => state.units.some(unit => unit.id === id))).toBe(true); // Idle bands may join camps, but no one disappears.
  });

  it('shares the total population budget with raiders that already exist', () => {
    const state = createGame(generateWorld('bounded-wilderness')); removeRoamers(state);
    const source = getLeader(state)!;
    const existing = state.units.filter(unit => unit.faction === -2 && unit.hp > 0).length;
    for (let i = 0; i < MAX_LIVE_RAIDERS - existing - 2; i++) entityStore(state).units.add({ ...source,
      id: 90000 + i, kind: 'warrior', faction: -2, marauderPack: undefined });
    initializeRoamingMarauders(state);
    expect(state.units.filter(unit => unit.faction === -2 && unit.hp > 0)).toHaveLength(MAX_LIVE_RAIDERS);
    expect(roamers(state)).toHaveLength(1);
    const pack = roamers(state)[0];
    expect(state.units.filter(unit => unit.marauderPack === pack.id)).toHaveLength(2);
  });

  it('keeps roaming packs independent when every camp is destroyed, and never refills killed packs on load', () => {
    const state = createGame(generateWorld('independent-wilderness')), packs = structuredClone(roamers(state));
    for (const building of state.buildings) if (building.raiderCamp !== undefined && building.kind === 'woodenTower') building.hp = 0;
    state.time = 600; updateFogRaids(state);
    expect(state.marauderPacks!.filter(pack => packs.some(old => old.id === pack.id))).toHaveLength(packs.length);
    expect(state.marauderPacks!.every(pack => pack.raiderCamp === undefined)).toBe(true);
    expect(state.marauderPacks!.some(pack => pack.raid)).toBe(true); // Surviving wanderers now actively seek combat.
    const dead = packs[0].id; entityStore(state).units.replace(state.units.filter(unit => unit.marauderPack !== dead));
    const count = state.units.length;
    const saved = migrateGame(structuredClone(state));
    expect(saved.units).toHaveLength(count); expect(saved.units.some(unit => unit.marauderPack === dead)).toBe(false);
    initializeRoamingMarauders(saved); expect(saved.units).toHaveLength(count);
  });

  it('adds the wilderness population to existing saves once, outside sight, without changing raids', () => {
    const state = createGame(generateWorld('wilderness-migration')); removeRoamers(state); state.time = 140;
    const fog = updateFog(state), clock = structuredClone(state.fogRaids), camps = structuredClone(state.raiderCamps);
    const saved = migrateGame(structuredClone(state));
    expect(saved.marauderPacks!.filter(pack => pack.raiderCamp === undefined)).toHaveLength(roamingPackTarget(saved)); expect(saved.fogRaids).toEqual(clock); expect(saved.raiderCamps).toEqual(camps);
    for (const unit of saved.units) if (unit.marauderPack !== undefined) expect(pointInSight(fog, unit.x, unit.y)).toBe(false);
    const ids = saved.units.map(unit => unit.id); migrateGame(saved); expect(saved.units.map(unit => unit.id)).toEqual(ids);
  });

  it('splits oversized legacy bands while retaining wounds and depleted survivors', () => {
    const state = createGame(generateWorld('legacy-wilderness')); removeRoamers(state);
    const source = getLeader(state)!;
    state.marauderPacks!.push({ id: 99, name: 'Old band', color: '#191b22', targetFaction: 0,
      home: { x: 90.5, y: 70.5 }, waypoint: { x: 90.5, y: 70.5 }, nextWanderAt: 500 });
    const members = Array.from({ length: 13 }, (_, i) => ({ ...source, id: 90000 + i, kind: 'warrior' as const,
      faction: -2, marauderPack: 99, x: 90.5 + i % 4, y: 70.5 + Math.floor(i / 4), hp: 17, maxHp: 65, order: 'wander' as const }));
    entityStore(state).units.add(...members); initializeRoamingMarauders(state);
    const groups = new Set(members.map(unit => unit.marauderPack)); expect(groups.size).toBe(3);
    for (const id of groups) expect(members.filter(unit => unit.marauderPack === id).length).toBeLessThanOrEqual(6);
    for (const unit of members) expect(unit.hp / unit.maxHp!).toBeCloseTo(17 / 65);
    const survivor = members[0], oldIds = new Set(members.map(unit => unit.id));
    entityStore(state).units.replace(state.units.filter(unit => !oldIds.has(unit.id) || unit === survivor));
    const count = state.units.length; initializeRoamingMarauders(state); expect(state.units).toHaveLength(count);
  });

  it('uses local wandering during its brief opening patrol', () => {
    const state = createGame(generateWorld('wander-check')), pack = roamers(state)[0];
    const members = state.units.filter(unit => unit.marauderPack === pack.id);
    entityStore(state).units.replace([getLeader(state)!, ...members]); state.factions[0].population = 0;
    state.marauderPacks = [pack]; state.raiderCamps = []; state.fields = [];
    entityStore(state).buildings.replace(state.buildings.filter(building => building.kind === 'palace' && building.faction === 0));
    pack.nextWanderAt = 0;
    // Hidden pack planning runs on one of five staggered simulation steps.
    updateGame(state, .5, { up: false, down: false, left: false, right: false });
    expect(distance(pack.home, pack.waypoint)).toBeGreaterThan(0);
    expect(distance(pack.home, pack.waypoint)).toBeLessThan(9);
    expect(pack.targetBuilding).toBeUndefined(); expect(pack.approachAt).toBeUndefined();
  });
});
