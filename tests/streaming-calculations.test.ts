import { describe, expect, it, vi } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { casualtyPressure, recordBattleDeath } from '../src/game/battle-morale';
import { territory, territoryChanges } from '../src/game/borders';
import { TerritoryCells } from '../src/game/territory-cells';
import { withSimulationReads } from '../src/game/simulation-reads';
import { cityResidents, citySummaries } from '../src/game/cities';
import { prepareIrrigation } from '../src/game/irrigation';
import { citySpecialties } from '../src/game/regional-economy';
import { createMinimapProjection, MinimapTerritoryMemory } from '../src/game/minimap';
import { CellJournal, trackArray } from '../src/game/cell-journal';
import { markWorldChanged } from '../src/game/world-revisions';
import { StateDeltaEncoder, applyValueDelta } from '../src/multiplayer/state-delta';
import { fishingCityFoodPerEconomyCycle } from '../src/game/fishing';
import type { Building, GameState, Unit } from '../src/game/types';
import type { FogView } from '../src/game/fog';

function fixture(size = 64): GameState {
  return { world: { width: size, height: size, seed: 'streaming', source: 'test', revision: 0, spawns: [],
    tiles: Array.from({ length: size * size }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
      moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [], units: [], fields: [],
    factions: [0, 1].map(id => ({ id, name: `Realm ${id}`, color: '#f00', affinity: 0, relation: id ? 'war' : 'self',
      food: 500, gold: 500, production: 0, population: 0, culture: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1000, defeated: false })),
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'streaming', rngState: 1 };
}
const building = (id: number, kind: Building['kind'], x: number, y: number, faction = 0): Building =>
  ({ id, kind, x, y, faction, hp: 100, maxHp: 100, capacity: kind === 'house' ? 4 : 5 });
const soldier = (id: number): Unit => ({ id, kind: 'warrior', faction: 0, hp: 0, x: 10.5, y: 10.5,
  morale: 100, attack: 0, defense: 0, speed: 0, range: 1, order: 'hold', cooldown: 0, lastCombat: 0, moving: false, facing: 0, attackTime: 0 });
const live = <T>(state: GameState, run: () => T) => withSimulationReads(state, run);
const publicClaims = (state: GameState) => {
  const view = territory(state);
  return { owners: view.owners, sources: view.sourceIds, alternateOwners: view.alternateOwners,
    alternateSources: view.alternateSourceIds, radii: [...view.sourceRadii], edges: view.edges, paths: view.paths };
};

describe('streaming derived calculations', () => {
  it('allocates IDs with one import scan and reserves explicit IDs across both collections', () => {
    const state = fixture(); let reads = 0;
    for (let id = 1; id <= 10000; id++) (state.buildings as Building[]).push({ get id() { reads++; return id; } } as Building);
    const store = entityStore(state);
    expect(store.allocateId()).toBe(10001);
    reads = 0;
    for (let i = 0; i < 100; i++) store.allocateId();
    expect(reads).toBe(0);
    const other = fixture(), entities = entityStore(other);
    expect(entities.allocateId()).toBe(1);
    entities.buildings.add(building(90000, 'house', 1, 1));
    expect(entities.allocateId()).toBe(90001);
    entities.units.add({ ...soldier(95000), hp: 100 });
    entities.units.retain(() => false);
    expect(entities.allocateId(100000)).toBe(100000);
    expect(entities.allocateId()).toBe(100001);
  });

  it('inserts casualties without revisiting old events and expires their spatial buckets exactly', () => {
    const state = fixture(); let visits = 0;
    state.casualties = [];
    state.casualties[Symbol.iterator] = function* () { for (let i = 0; i < this.length; i++) { visits++; yield this[i]; } return undefined; };
    for (let id = 0; id < 500; id++) recordBattleDeath(state, soldier(id));
    expect(visits).toBe(0);
    const observer = { ...soldier(1000), hp: 100 };
    expect(casualtyPressure(state, observer, () => false).losses).toBe(500);
    state.time = 20;
    expect(casualtyPressure(state, observer, () => false).losses).toBe(500);
    state.time = 20.001;
    expect(casualtyPressure(state, observer, () => false).losses).toBe(0);
    expect(state.casualties).toHaveLength(0);
  });

  it('keeps a local territory edit bounded, publishes dirty cells and preserves older snapshots', () => {
    const state = fixture(256);
    (state.buildings as Building[]).push(building(1, 'palace', 10, 10));
    for (let i = 0; i < 100; i++) (state.buildings as Building[]).push(building(i + 2, 'house', 30 + i % 10 * 15, 30 + Math.floor(i / 10) * 15));
    const before = live(state, () => territory(state)), oldOwners = before.owners.slice();
    const reads = vi.spyOn(TerritoryCells.prototype, 'get');
    entityStore(state).buildings.add(building(1000, 'house', 31, 30));
    const after = live(state, () => territory(state));
    expect(reads.mock.calls.length).toBeLessThan(4096); reads.mockRestore();
    const changes = territoryChanges(after, before);
    expect(changes.full).toBe(false); expect(changes.cells.length).toBe(7);
    expect(before.owners).toEqual(oldOwners);
    expect(publicClaims(state)).toEqual(publicClaims(structuredClone(state)));
  });

  it('reveals hidden third claimants after capture/removal and preserves protected fort ordering', () => {
    const state = fixture(); state.factions.push({ ...state.factions[1], id: 2 });
    (state.buildings as Building[]).push(building(1, 'palace', 15, 15), building(2, 'house', 18, 16, 1),
      building(3, 'house', 19, 16, 2), building(4, 'fort', 20, 18, 1));
    territory(state);
    for (const edit of [() => { state.buildings[0].faction = 2; }, () => { state.buildings[1].hp = 0; },
      () => entityStore(state).buildings.retain(value => value.id !== 3),
      () => { state.world.tiles[17 * 64 + 20].overlay = 'forest'; markWorldChanged(state.world, 'sight', [17 * 64 + 20]); }]) {
      edit(); expect(publicClaims(state)).toEqual(publicClaims(structuredClone(state)));
    }
  });

  it('skips unchanged economy inputs and keeps same-step and faction-local mutations fresh', () => {
    const state = fixture(); let reads = 0;
    (state.buildings as Building[]).push(building(1, 'palace', 4, 4), building(2, 'palace', 45, 45, 1), building(3, 'house', 43, 43, 1));
    for (let i = 0; i < 1000; i++) (state.buildings as Building[]).push({ ...building(i + 10, 'road', i % 64, 20 + Math.floor(i / 64)), get kind() { reads++; return 'road' as const; } });
    state.factions[1].population = 1; // Warm the shared resource-ownership index too.
    const read = () => live(state, () => citySummaries(state));
    read(); reads = 0; state.time = 1; read(); read();
    expect(reads).toBe(0);
    state.buildings[2].residents = 3; state.factions[1].population = 3;
    expect(read().find(city => city.palace.id === 2)?.population).toBe(3);
    expect(reads).toBe(0);
    state.factions[1].gold--;
    expect(read()).toEqual(citySummaries(structuredClone(state)));
    state.factions[1].population = 1;
    expect(live(state, () => cityResidents(state)).find(city => city.palace.id === 2)?.population).toBe(1);
    expect(read()).toEqual(citySummaries(structuredClone(state)));
  });

  it('keeps captured farms coupled to fields awaiting reassignment during partial refreshes', () => {
    const state = fixture();
    (state.buildings as Building[]).push(building(1, 'palace', 4, 4), building(2, 'palace', 20, 20, 1), building(3, 'camp', 15, 15, 1));
    state.fields!.push({ id: 1, camp: 3, faction: 0, x: 15, y: 15, planted: true, food: 0, nextHarvest: 30 });
    const read = () => live(state, () => citySummaries(state));
    expect(read()).toEqual(citySummaries(structuredClone(state)));
    state.fields![0].planted = false;
    expect(read()).toEqual(citySummaries(structuredClone(state)));
    state.fields![0].planted = true; state.factions[1].population = 2;
    expect(read()).toEqual(citySummaries(structuredClone(state)));
    state.factions[0].villageBonuses = { food: .2, trade: 0, construction: 0, research: 0 };
    expect(read()).toEqual(citySummaries(structuredClone(state)));
    state.fields![0].faction = 1;
    expect(read()).toEqual(citySummaries(structuredClone(state)));
  });

  it('handles irrigation overlap, duplicate tiles, completion, movement and removal across times', () => {
    const state = fixture(); const a = building(1, 'irrigation', 10, 10), b = building(2, 'irrigation', 10, 10), c = building(3, 'irrigation', 12, 10);
    (state.buildings as Building[]).push(a, b, c); const read = () => live(state, () => prepareIrrigation(state));
    const first = read().coverage; state.time = 10;
    expect(read().coverage).toBe(first);
    a.hp = 0; expect(read().coverage[10 * 64 + 10]).toBe(1);
    b.x = 20; expect(read().coverage[10 * 64 + 10]).toBe(1); // c still covers the edge.
    c.hp = 0; expect(read().coverage[10 * 64 + 10]).toBe(0);
    expect(first[10 * 64 + 10]).toBe(1);
    b.construction = { startedAt: 10, duration: 2, waitingForBuilder: true };
    entityStore(state).buildings.updateRoles(b);
    expect(read().coverage[10 * 64 + 20]).toBe(0);
    delete b.construction; entityStore(state).buildings.updateRoles(b);
    expect(read().coverage[10 * 64 + 20]).toBe(1);
    entityStore(state).buildings.retain(value => value !== b);
    expect(read().coverage[10 * 64 + 20]).toBe(0);
  });

  it('reuses specialty searches across cosmetic/remote edits but detects local deposits and access', () => {
    const state = fixture(), city = building(1, 'palace', 4, 4); (state.buildings as Building[]).push(city);
    for (let y = 5; y <= 7; y++) state.world.tiles[y * 64 + 8].resource = 'iron';
    const read = () => live(state, () => citySpecialties(state.world, city, state));
    const initial = read(); expect(initial).toEqual(['iron']);
    markWorldChanged(state.world, 'appearance', [4095]); expect(read()).toBe(initial);
    entityStore(state).buildings.add(building(2, 'house', 50, 50)); expect(read()).toBe(initial);
    for (let y = 5; y <= 7; y++) { state.world.tiles[y * 64 + 8].resource = 'clay'; markWorldChanged(state.world, 'appearance', [y * 64 + 8]); }
    expect(read()).toEqual(['clay']);
    expect(read()).toEqual(citySpecialties(structuredClone(state.world), city, structuredClone(state)));
  });

  it('updates minimap bounds and memory from one explored cell without scanning the map', () => {
    let reads = 0; const raw = Array(65536).fill(0);
    const explored = new Proxy(raw, { get(target, key, receiver) { if (typeof key === 'string' && /^\d+$/.test(key)) reads++; return Reflect.get(target, key, receiver); } });
    raw[0] = 1; const journal = trackArray(explored);
    createMinimapProjection(explored, 256, 256, 200, 200);
    const claims = { width: 256, height: 256, owners: new Int32Array(65536).fill(0), sourceIds: new Int32Array(65536),
      alternateOwners: new Int32Array(65536), alternateSourceIds: new Int32Array(65536), sourceRadii: new Map(), edges: [], paths: [], revision: 1 };
    const fog = { explored, explorationRevision: 1 } as FogView, memory = new MinimapTerritoryMemory(); memory.update(claims, fog);
    raw[10] = 1; journal.publish([10]); fog.explorationRevision++; reads = 0;
    expect(createMinimapProjection(explored, 256, 256, 200, 200).world.width).toBe(13);
    expect(memory.update(claims, fog)).toEqual([10]); expect(reads).toBeLessThan(10);
  });

  it('encodes independently aliased exploration baselines sparsely, including expiry of journal history', () => {
    let reads = 0; const raw = Array(65536).fill(0);
    const explored = new Proxy(raw, { get(target, key, receiver) { if (typeof key === 'string' && /^\d+$/.test(key)) reads++; return Reflect.get(target, key, receiver); } });
    const journal = trackArray(explored), fog = { explored };
    const state = { world: {}, units: [], buildings: [], fog, multiplayer: { controls: { 0: { fog } } } } as unknown as GameState;
    const encoder = new StateDeltaEncoder(state), replica = JSON.parse(JSON.stringify(state)); reads = 0;
    expect(encoder.encode(state)).toEqual({}); expect(reads).toBe(0);
    raw[12] = 1; journal.publish([12]); reads = 0;
    const patch = encoder.encode(state); expect(reads).toBeLessThan(8);
    applyValueDelta(replica, patch.state!);
    expect(replica.fog.explored[12]).toBe(1); expect(replica.multiplayer.controls[0].fog.explored[12]).toBe(1);
    raw[13] = 1; journal.publish();
    const fallback = encoder.encode(state); applyValueDelta(replica, fallback.state!);
    expect(replica.fog.explored).toEqual(raw);
  });

  it('maintains rolling fishing totals by city/owner with exact expiry, append, rewind and replacement', () => {
    const state = fixture(); state.time = 90;
    (state.buildings as Building[]).push(building(1, 'palace', 4, 4), building(2, 'palace', 40, 40, 1));
    let reads = 0;
    state.fishing = { seed: state.seed, startedAt: 0, sequence: 0, whales: [], buffs: {}, nextTick: 1, zones: [], fish: [], boats: [], replacements: {},
      receipts: Array.from({ length: 100 }, (_, i) => ({ get city() { reads++; return i % 2 + 1; }, faction: i % 2, at: 80, food: 5 })) };
    expect(fishingCityFoodPerEconomyCycle(state, 1)).toBeCloseTo(250 / 3); reads = 0;
    for (let i = 0; i < 100; i++) fishingCityFoodPerEconomyCycle(state, i % 2 + 1);
    expect(reads).toBe(0);
    state.fishing.receipts.push({ city: 1, faction: 0, at: 95, food: 6 }); state.time = 95;
    expect(fishingCityFoodPerEconomyCycle(state, 1)).toBeCloseTo(256 / 3);
    state.buildings[0].faction = 1; expect(fishingCityFoodPerEconomyCycle(state, 1)).toBe(0);
    state.buildings[0].faction = 0; state.time = 170;
    expect(fishingCityFoodPerEconomyCycle(state, 1)).toBe(2);
    state.time = 185; expect(fishingCityFoodPerEconomyCycle(state, 1)).toBe(0);
    state.time = 90; expect(fishingCityFoodPerEconomyCycle(state, 1)).toBeCloseTo(256 / 3);
    state.fishing.receipts = [{ city: 1, faction: 0, at: 90, food: 9 }];
    expect(fishingCityFoodPerEconomyCycle(state, 1)).toBe(3);
  });

  it('lets independent cell-journal readers catch up or fall back without retaining unbounded history', () => {
    const journal = new CellJournal(4); const early = journal.revision;
    journal.publish([1, 2]); const recent = journal.revision;
    journal.publish([2, 3]); expect([...journal.since(early).cells].sort()).toEqual([1, 2, 3]);
    journal.publish([4, 5]); expect(journal.since(early).full).toBe(true);
    expect([...journal.since(recent).cells].sort()).toEqual([2, 3, 4, 5]);
  });
});
