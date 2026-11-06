import { describe, expect, it } from 'vitest';
import { scenario } from '../dev/navigation-lab/scenarios';
import { entityStore, resetEntities } from '../src/game/entity-store';
import { updateCulture, MONUMENT_CULTURE_PER_SECOND } from '../src/game/culture';
import { updateResearch } from '../src/game/research';
import { grantIncome } from '../src/game/resource-income';
import { queueConstruction, startConstruction, updateActiveConstruction, updateConstruction } from '../src/game/structures';
import type { Building, BuildingKind } from '../src/game/types';

const building = (id: number, kind: BuildingKind): Building => ({ id, kind, faction: 0, x: 4, y: 4,
  hp: 100, maxHp: 100, capacity: 0 });
function fixture() {
  const state = scenario('Open melee');
  entityStore(state).buildings.replace([]);
  state.factions[0].culture = 0;
  state.factions[0].research = { focus: 'wall', priorities: ['wall'], allocation: .25, levels: { woodenTower: 1 }, progress: {} };
  return state;
}

describe('active building maintenance', () => {
  it('registers construction before and after insertion and removes completed/cancelled sites', () => {
    const state = fixture(), before = building(100, 'road'), after = building(101, 'road');
    startConstruction(before, 0);
    const store = entityStore(state);
    store.buildings.add(before, after);
    expect(store.buildings.query('construction')).toEqual([before]);
    startConstruction(after, 1, state);
    expect(store.buildings.query('construction')).toEqual([before, after]);
    state.time = 1.999;
    expect(updateActiveConstruction(state)).toBe(false);
    state.time = 2;
    expect(updateActiveConstruction(state)).toBe(true);
    expect(before.construction).toBeUndefined();
    expect(store.buildings.query('construction')).toEqual([after]);
    delete after.construction;
    expect(updateActiveConstruction(state)).toBe(false);
    expect(store.buildings.query('construction')).toEqual([]);
    queueConstruction(after, state.time, 0, state);
    state.time = 100;
    expect(updateActiveConstruction(state)).toBe(false);
    expect(after).toMatchObject({ construction: { waitingForBuilder: true } });
    store.buildings.retain(value => value !== after);
    expect(store.buildings.query('construction')).toEqual([]);
  });

  it('reconciles direct construction edits at the public boundary and rebuilds after import', () => {
    const state = fixture(), site = building(100, 'road');
    entityStore(state).buildings.add(site);
    site.construction = { startedAt: 0, duration: 2 };
    state.time = 2;
    expect(updateConstruction(state)).toBe(true);
    const replacement = structuredClone(state);
    replacement.buildings[0].construction = { startedAt: 2, duration: 2 };
    Object.assign(state, replacement); resetEntities(state);
    state.time = 4;
    expect(updateActiveConstruction(state)).toBe(true);
    expect(state.buildings[0].construction).toBeUndefined();
  });

  it('keeps construction progress exact when the live research rate changes', () => {
    const state = fixture(), site = building(100, 'house');
    entityStore(state).buildings.add(site); startConstruction(site, 0, state);
    site.construction!.cleared = true;
    state.time = 10;
    state.factions[0].research!.levels.metalTools = 1;
    expect(updateActiveConstruction(state)).toBe(false);
    expect(site.construction).toMatchObject({ startedAt: 2, duration: (40 / 3) / 1.25 });
    state.time = 2 + (40 / 3) / 1.25 - .01; expect(updateActiveConstruction(state)).toBe(false);
    state.time = 2 + (40 / 3) / 1.25; expect(updateActiveConstruction(state)).toBe(true);
    expect(entityStore(state).buildings.query('construction')).toEqual([]);
  });

  it('pauses an active site immediately when its assigned builder dies', () => {
    const state = fixture(), site = building(100, 'road');
    const worker = { ...state.units[0], id: 101, kind: 'worker' as const, builder: true,
      x: 5.5, y: 4.5, hp: 100, inside: false, buildSite: site.id, buildPhase: 'working' as const, order: 'follow' as const };
    queueConstruction(site, 0);
    Object.assign(site.construction!, { waitingForBuilder: false, builderId: worker.id });
    entityStore(state).buildings.add(site); entityStore(state).units.add(worker);
    state.time = .5; expect(updateActiveConstruction(state)).toBe(false);
    expect(site.construction!.waitingForBuilder).toBe(false);
    worker.hp = 0; state.time = 1; expect(updateActiveConstruction(state)).toBe(false);
    expect(site.construction).toMatchObject({ waitingForBuilder: true, pausedAt: 1, cleared: false });
    expect(site.construction!.builderId).toBeUndefined();
    state.time = 100; expect(updateActiveConstruction(state)).toBe(false);
    expect(site.construction).toBeDefined();
  });

  it('keeps tracked mutations attached to the owning state after a shallow planning copy', () => {
    const state = fixture(), road = building(100, 'road');
    const store = entityStore(state); store.buildings.add(road);
    const virtual = { ...state, buildings: [...state.buildings] };
    const planning = entityStore(virtual);
    expect(planning.buildings.get(road.id)).toBe(road);
    startConstruction(road, 0, state);
    expect(store.buildings.query('construction')).toEqual([road]);
    expect(planning.buildings.query('construction')).toEqual([]);
    state.time = 2;
    expect(updateActiveConstruction(state)).toBe(true);
    expect(road.construction).toBeUndefined();
  });

  it('does not revisit unrelated completed buildings in any fast maintenance pass', () => {
    const state = fixture(), unrelated = building(100, 'road'), site = building(101, 'road');
    const library = building(102, 'library'), monument = building(103, 'monument');
    queueConstruction(site, 0);
    entityStore(state).buildings.add(unrelated, site, library, monument);
    let reads = 0;
    Object.defineProperties(unrelated, {
      kind: { configurable: true, get: () => { reads++; return 'road'; } },
      construction: { configurable: true, get: () => { reads++; return undefined; } },
    });
    for (let step = 0; step < 5; step++) {
      state.time += .1;
      expect(updateActiveConstruction(state)).toBe(false);
      updateResearch(state, .1); grantIncome(state.factions[0], { gold: .4 }, state); updateCulture(state, .1);
    }
    updateResearch(state,30);
    expect(reads).toBe(0);
    expect(state.factions[0].research!.progress.wall).toBeCloseTo(.5);
    expect(state.factions[0].culture).toBeCloseTo(.5 * MONUMENT_CULTURE_PER_SECOND);
  });

  it('observes live readiness, capture, death, kind changes and replacement in economic groups', () => {
    const state = fixture(), library = building(100, 'library'), monument = building(101, 'monument');
    const other = { ...state.factions[0], id: 1, culture: 0, research: { focus: 'wall' as const, priorities: ['wall' as const], allocation: .25, levels: { woodenTower: 1 }, progress: {} } };
    state.factions = [state.factions[0], other];
    const store = entityStore(state); store.buildings.add(library, monument);
    updateResearch(state, 1);
    for (const faction of state.factions) grantIncome(faction, { gold: 4 }, state);
    updateResearch(state,30);
    updateCulture(state, 1);
    library.construction = { startedAt: 0, duration: 90 }; monument.hp = 0;
    updateResearch(state, 1);
    for (const faction of state.factions) grantIncome(faction, { gold: 4 }, state);
    updateResearch(state,30);
    updateCulture(state, 1);
    expect(state.factions[0].research!.progress.wall).toBe(1);
    expect(state.factions[0].culture).toBe(MONUMENT_CULTURE_PER_SECOND);
    delete library.construction; monument.hp = 100;
    library.faction = monument.faction = 1;
    updateResearch(state, 1);
    for (const faction of state.factions) grantIncome(faction, { gold: 4 }, state);
    updateResearch(state,30);
    updateCulture(state, 1);
    expect(other.research.progress).toEqual({ wall: 1 });
    expect(other.culture).toBe(MONUMENT_CULTURE_PER_SECOND);
    store.setBuildingKind(library, 'road'); store.setBuildingKind(monument, 'road');
    updateResearch(state, 1);
    for (const faction of state.factions) grantIncome(faction, { gold: 4 }, state);
    updateResearch(state,30);
    updateCulture(state, 1);
    expect(other.research.progress).toEqual({ wall: 1 });
    expect(other.culture).toBe(MONUMENT_CULTURE_PER_SECOND);
    store.buildings.replace([{ ...library, kind: 'library' }, { ...monument, kind: 'monument' }]);
    updateResearch(state, 1);
    for (const faction of state.factions) grantIncome(faction, { gold: 4 }, state);
    updateResearch(state,30);
    updateCulture(state, 1);
    expect(other.research.progress).toEqual({ wall: 2 });
    expect(other.culture).toBe(2 * MONUMENT_CULTURE_PER_SECOND);
  });
});
