import { describe, expect, it } from 'vitest';
import { selectionSummary } from '../src/ui/selection-summary';
import { entityStore } from '../src/game/entity-store';
import type { GameState } from '../src/game/types';

function fixture(): GameState {
  return {
    world: { width: 32, height: 24, seed: 'selection', source: 'test', spawns: [], tiles: Array.from({ length: 768 }, () =>
      ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 0, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 3, y: 8, hp: 650, maxHp: 650, capacity: 4 }],
    units: [{ id: 2, kind: 'leader', faction: 0, x: 6.5, y: 9.5, hp: 100, morale: 100, attack: 25, defense: 5,
      speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 1000, production: 0,
      population: 5, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 10000, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: 2, selectedType: 'unit',
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'selection', rngState: 1,
  };
}

describe('compact selection summaries', () => {
  it('identifies Keep upgrades in the HUD while retaining the city name and health', () => {
    const state = fixture(), palace = state.buildings[0];
    state.selectedType = 'building'; state.selected = palace.id;
    palace.cityName = 'Willowhearth';
    expect(selectionSummary(state)).toMatchObject({ name: 'Settlement', picture: 'palace', maxHp: 650 });
    Object.assign(palace, { palaceLevel: 2, maxHp: 6500, hp: 3250 });
    const summary = selectionSummary(state)!;
    expect(summary).toMatchObject({ name: 'Keep', picture: 'keep', hp: 3250, maxHp: 6500, attack: 8.75 });
    expect(summary.title).toContain('Willowhearth');
    expect(summary.title).toContain('Range 6');
    expect(summary.title).toContain('Immune to raider theft');
  });

  it('preserves fractional HP and applies Elite, equipment, and archer research to displayed combat strength', () => {
    const state = fixture(), unit = state.units[0];
    Object.assign(unit, { kind: 'archer', hp: 48.25, maxHp: 66.7, attack: 20, defense: 2, weaponLevel: 1, armorLevel: 2, kills: 500 });
    state.factions[0].research = { focus: 'fletching', levels: { fletching: 1 }, progress: {} };
    const summary = selectionSummary(state)!;
    expect(summary).toMatchObject({ hp: 48.25, maxHp: 66.7, picture: 'archer', armorLevel: 2, factionColor: '#3988ff' });
    expect(summary.attack).toBeCloseTo(20 * 1.15 * .7 * 2.3 * 1.15);
    expect(summary.defense).toBeCloseTo(2.6);
    expect(summary.title).toContain('Elite'); expect(summary.title).toContain('85% less damage taken after armor');
    unit.kind = 'scout';
    expect(selectionSummary(state)!.attack).toBe(0);
  });

  it('shows combat stats for units and fortifications, and HP only for other buildings', () => {
    const state = fixture();
    expect(selectionSummary(state)!.showCombatStats).toBe(true);
    state.selectedType = 'building'; state.selected = 1;
    for (const kind of ['palace', 'house', 'camp', 'road', 'bridge', 'well', 'irrigation', 'monument', 'library', 'blacksmith', 'villageTent'] as const) {
      state.buildings[0].kind = kind;
      expect(selectionSummary(state)!.showCombatStats, kind).toBe(false);
    }
    for (const kind of ['wall', 'palisade', 'woodenTower', 'tower', 'guardPost'] as const) {
      state.buildings[0].kind = kind;
      expect(selectionSummary(state)!.showCombatStats, kind).toBe(true);
    }
  });

  it('suppresses hidden enemies, dead units, and garrisoned friendlies', () => {
    const state = fixture(), leader = state.units[0];
    entityStore(state).units.add({ ...leader, id: 3, faction: 1, x: 30.5, y: 22.5 });
    state.selected = 3;
    expect(selectionSummary(state)).toBeUndefined();
    state.selected = leader.id; leader.inside = true;
    expect(selectionSummary(state)).toBeUndefined();
    leader.inside = false; leader.hp = 0;
    expect(selectionSummary(state)).toBeUndefined();
    state.selectedType = 'building'; state.selected = 4;
    entityStore(state).buildings.add({ id: 4, kind: 'woodenTower', faction: 1, x: 30, y: 22, hp: 600, maxHp: 600, capacity: 0 });
    expect(selectionSummary(state)).toBeUndefined();
  });

  it('shows paused construction accurately and activates tower attack only after completion', () => {
    const state = fixture();
    const tower = { id: 3, kind: 'woodenTower' as const, faction: 0, x: 8, y: 8, hp: 150.5, maxHp: 600, capacity: 0, armor: 6,
      construction: { startedAt: 10, duration: 20, pausedAt: 15, waitingForBuilder: false } };
    entityStore(state).buildings.add(tower); state.selectedType = 'building'; state.selected = 3; state.time = 100;
    const summary = selectionSummary(state)!;
    expect(summary).toMatchObject({ hp: 150.5, maxHp: 600, attack: 0, defense: 6 });
    expect(summary.title).toContain('Construction 25%'); expect(summary.title).toContain('15s remaining');
    delete state.buildings[1].construction;
    expect(selectionSummary(state)!.attack).toBe(8.75);
    expect(selectionSummary(state)!.title).toContain('Range 6');
  });

  it('recognizes a gate reserved by an unfinished road, then removes the gate portrait with that road', () => {
    const state = fixture();
    entityStore(state).buildings.add({ id: 3, kind: 'wall', faction: 0, x: 8, y: 8, hp: 225, maxHp: 225, capacity: 0, armor: 2 },
      { id: 4, kind: 'road', faction: 0, x: 8, y: 8, hp: 100, maxHp: 100, capacity: 0,
        construction: { startedAt: 0, duration: 4, waitingForBuilder: true } });
    state.selectedType = 'building'; state.selected = 3;
    expect(selectionSummary(state)).toMatchObject({ name: 'Gate', picture: 'wallGate', attack: 0, defense: 3 });
    state.buildings[2].hp = 0;
    expect(selectionSummary(state)).toMatchObject({ name: 'Wall', picture: 'wall' });
  });
});
