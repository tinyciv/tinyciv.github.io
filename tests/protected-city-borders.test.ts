import { describe, expect, it } from 'vitest';
import { territory, territoryClaimWithoutSource, UNCLAIMED } from '../src/game/borders';
import { entityStore } from '../src/game/entity-store';
import { buildingTerritoryOwner } from '../src/game/property-territory';
import { updateWallOwnership } from '../src/game/wall-ownership';
import type { Building, GameState } from '../src/game/types';

const building = (id: number, kind: Building['kind'], faction: number, x: number, y = 10): Building =>
  ({ id, kind, faction, x, y, hp: 100, maxHp: 100, capacity: 0 });
function fixture(buildings: Building[]): GameState {
  return { world: { width: 40, height: 24, seed: 'protected-cities', source: 'fixture', spawns: [],
    tiles: Array.from({ length: 960 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5,
      food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings, units: [], factions: [0, 1].map(id => ({ id, name: `Faction ${id}`, color: '#fff', affinity: 0,
      relation: id ? 'war' : 'self', gold: 1000, food: 100, production: 0, population: 0,
      yields: { gold: 0, food: 0, production: 0 }, culture: id ? 0 : 100000, nextRaid: Infinity, defeated: false })),
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'protected-cities', rngState: 1 };
}
function bufferCells(building: Building, width = 40): number[] {
  return Array.from({ length: 16 }, (_, i) => (building.y - 1 + Math.floor(i / 4)) * width + building.x - 1 + i % 4);
}

describe('minimum settlement and fort borders', () => {
  it.each(['palace', 'fort'] as const)('keeps a full one-cell buffer around a %s against stronger culture', kind => {
    const home = building(20, kind, 1, 20), enemy = building(1, 'monument', 0, 16);
    const state = fixture([enemy, home]), borders = territory(state);
    for (const cell of bufferCells(home)) {
      expect(borders.owners[cell]).toBe(1); expect(borders.sourceIds[cell]).toBe(home.id);
    }
    expect(borders.owners[10 * 40 + 23]).toBe(0); // Protection ends at the immediate ring.
    expect(territoryClaimWithoutSource(state, 20, 10, home.id, borders)?.faction).toBe(0);
    expect(buildingTerritoryOwner(state, home, borders)).toBe(1);
    updateWallOwnership(state);
    expect(home.faction).toBe(1); // Ownership updates cannot bypass the visual protection.
    expect(territory(state).owners).toEqual(borders.owners);
  });

  it.each(['palace', 'fort'] as const)('keeps the %s buffer across water and dense woodland', kind => {
    const home = building(20, kind, 1, 20), state = fixture([building(1, 'monument', 0, 16), home]);
    for (const cell of bufferCells(home)) state.world.tiles[cell].overlay = 'forest';
    for (const [i, terrain] of (['ocean', 'coast', 'lake', 'river'] as const).entries())
      state.world.tiles[bufferCells(home)[i]].terrain = terrain;
    const borders = territory(state);
    expect(bufferCells(home).map(cell => borders.owners[cell])).toEqual(Array(16).fill(1));
  });

  it('updates the entire buffer after capture and releases it after destruction or faction defeat', () => {
    const home = building(20, 'palace', 1, 20), state = fixture([building(1, 'monument', 0, 16), home]);
    const original = territory(state); home.faction = 0;
    const captured = territory(state);
    expect(captured.revision).toBeGreaterThan(original.revision);
    expect(bufferCells(home).every(cell => captured.owners[cell] === 0)).toBe(true);
    home.faction = 1; home.hp = 0;
    expect(bufferCells(home).every(cell => territory(state).owners[cell] === 0)).toBe(true);
    home.hp = 100; state.factions[1].defeated = true;
    expect(bufferCells(home).every(cell => territory(state).owners[cell] === 0)).toBe(true);
  });

  it('preserves both footprints when rings overlap and resolves shared cells deterministically', () => {
    const left = building(20, 'fort', 0, 10), right = building(10, 'palace', 1, 13);
    const state = fixture([left, right]), first = territory(state);
    expect(first.owners[10 * 40 + 11]).toBe(0); expect(first.owners[10 * 40 + 13]).toBe(1);
    expect(first.owners[10 * 40 + 12]).toBe(1); // Equal distance: lower stable source ID.
    expect(territoryClaimWithoutSource(state, 12, 10, right.id, first)?.sourceId).toBe(left.id);
    entityStore(state).buildings.replace([...state.buildings].reverse());
    const reversed = territory(state), fresh = territory(structuredClone(state));
    expect(reversed.owners).toEqual(first.owners); expect(fresh.owners).toEqual(first.owners);
    expect(reversed.sourceIds).toEqual(first.sourceIds);
    expect(reversed.alternateSourceIds).toEqual(first.alternateSourceIds);
  });

  it('prioritizes a building footprint over the neighboring building’s ring', () => {
    const left = building(1, 'fort', 0, 10), right = building(20, 'palace', 1, 12);
    const state = fixture([left, right]), borders = territory(state);
    for (const y of [10, 11]) for (const x of [10, 11, 12, 13])
      expect(borders.owners[y * 40 + x]).toBe(x < 12 ? 0 : 1);
  });

  it('clips safely at map edges and waits for the structure to complete', () => {
    const home = building(20, 'fort', 1, 0, 0), state = fixture([home]);
    home.construction = { startedAt: 0, duration: 240, waitingForBuilder: true };
    expect(territory(state).owners[0]).toBe(UNCLAIMED);
    delete home.construction;
    const borders = territory(state);
    for (let y = 0; y <= 2; y++) for (let x = 0; x <= 2; x++) expect(borders.owners[y * 40 + x]).toBe(1);
  });
});
