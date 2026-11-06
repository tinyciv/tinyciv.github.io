import { describe, expect, it } from 'vitest';
import { scenario } from '../dev/navigation-lab/scenarios';
import { entityStore, resetEntities } from '../src/game/entity-store';
import { beginUnitFrame, endUnitFrame, indexedUnit, nearbyBuildings, nearbyUnits, refreshIndexedUnit, unitsWithRole } from '../src/game/spatial';
import { beginPeasantFrame, canDispatchPeasant, endPeasantFrame, refreshPeasant } from '../src/game/peasant-capacity';

function fixture() {
  const state = scenario('Open melee'), base = state.units[1];
  entityStore(state).units.replace([
    { ...base, id: 100, kind: 'warrior' as const, x: 8.5, y: 12.5, faction: 0 },
    { ...base, id: 101, kind: 'worker' as const, builder: true, x: 9.5, y: 12.5, faction: 0 },
    { ...base, id: 102, kind: 'worker' as const, collector: true, x: 10.5, y: 12.5, faction: 1 },
  ]);
  return state;
}

describe('production bitECS entity membership', () => {
  it('advances decision revisions only when membership or roles change', () => {
    const state = fixture(), units = entityStore(state).units;
    let revision = units.revision;
    units.retain(() => true);
    state.units[0].x++; state.units[0].hp--;
    units.updateRoles(state.units[0]);
    expect(units.revision).toBe(revision);
    units.add({ ...state.units[0], id: 104 });
    expect(units.revision).toBeGreaterThan(revision);
    revision = units.revision;
    entityStore(state).setUnitRole(state.units[0], { kind: 'worker' });
    expect(units.revision).toBeGreaterThan(revision);
    revision = units.revision;
    units.retain(unit => unit.id !== 104);
    expect(units.revision).toBeGreaterThan(revision);
    revision = units.revision;
    units.replace(state.units.map(unit => ({ ...unit })));
    expect(units.revision).toBeGreaterThan(revision);
  });

  it('keeps cached role queries and ID lookup current through explicit lifetime and role changes', () => {
    const state = fixture(), store = entityStore(state), workers = store.units.query('worker');
    expect(workers).toEqual(state.units.slice(1));
    expect(store.units.query('builder')).toEqual([state.units[1]]);
    store.units.retain(unit => unit.hp > 0);
    expect(store.units.query('worker')).toBe(workers);
    const recruit = store.units.add({ ...state.units[0], id: 103, kind: 'archer' as const });
    expect(store.units.query('soldier')).toEqual([state.units[0], recruit]);
    store.setUnitRole(state.units[1], { kind: 'warrior', builder: false });
    expect(store.units.query('worker')).toEqual([state.units[2]]);
    expect(store.units.query('builder')).toEqual([]);
    store.units.retain(unit => unit.id !== 100 && unit.id !== 102);
    expect(store.units.query('soldier')).toEqual(state.units);
    expect(store.units.get(100)).toBeUndefined();
    expect(store.units.get(102)).toBeUndefined();
    expect(store.units.get(103)).toBe(recruit);
    const duplicate = { ...recruit };
    expect(() => store.units.add(duplicate)).toThrow('Duplicate entity ID: 103');
    expect(store.units.get(103)).toBe(recruit);
    const recycled = store.units.add({ ...recruit, id: 100 });
    expect(store.units.query('soldier')).toEqual([...state.units]);
    expect(store.units.get(100)).toBe(recycled);
  });

  it('does not inspect membership fields again when entering another simulation frame', () => {
    const state = fixture(), store = entityStore(state), workers = store.units.query('worker');
    let reads = 0;
    Object.defineProperty(state.units[0], 'kind', { configurable: true,
      get: () => { reads++; return 'warrior'; } });
    for (let i = 0; i < 3; i++) {
      beginUnitFrame(state);
      expect(unitsWithRole(state, 'worker')).toBe(workers);
      endUnitFrame(state);
    }
    expect(reads).toBe(0);
  });

  it('keeps live gameplay fields and does not serialize the runtime world', () => {
    const state = fixture(), before = JSON.stringify(state), index = entityStore(state);
    const builders = index.units.query('builder');
    expect(JSON.stringify(state)).toBe(before);
    const builder = state.units[1]; builder.hp = 0; builder.inside = true; builder.faction = 4;
    expect(index.units.query('builder')).toBe(builders);
    expect(builders[0]).toMatchObject({ hp: 0, inside: true, faction: 4 });
  });

  it('replaces same-ID objects cleanly when a save is loaded into the existing GameState', () => {
    const state = fixture(), index = entityStore(state), old = state.units[0];
    const replacement = structuredClone(state);
    replacement.units[0].kind = 'worker'; replacement.units[0].collector = true;
    Object.assign(state, replacement);
    resetEntities(state);
    const loaded = entityStore(state);
    expect(loaded.units.get(old.id)).toBe(state.units[0]);
    expect(loaded.units.get(old.id)).not.toBe(old);
    expect(loaded.units.query('soldier')).toEqual([]);
    expect(loaded.units.query('collector')).toEqual([state.units[0], state.units[2]]);
    expect(loaded.buildings.query('building')).toEqual(state.buildings);
    for (const building of state.buildings) expect(loaded.buildings.get(building.id)).toBe(building);
  });

  it('updates leader and soldier membership during the active unit phase', () => {
    const state = fixture(); beginUnitFrame(state);
    try {
      expect(unitsWithRole(state, 'soldier')).toEqual([state.units[0]]);
      entityStore(state).setUnitRole(state.units[1], { kind: 'archer' }); refreshIndexedUnit(state, state.units[1]);
      expect(unitsWithRole(state, 'soldier')).toEqual(state.units.slice(0, 2));
      const recruit = { ...state.units[0], id: 999, kind: 'leader' as const };
      entityStore(state).units.add(recruit); refreshIndexedUnit(state, recruit);
      expect(unitsWithRole(state, 'leader')).toEqual([recruit]);
      expect(indexedUnit(state, 999)).toBe(recruit);
    } finally { endUnitFrame(state); }
  });

  it('maintains building-kind queries while readiness and ownership remain live', () => {
    const state = fixture();
    const palace = { ...state.buildings[0], id: 12000, kind: 'palace' as const };
    const farm = { ...palace, id: 12001, kind: 'camp' as const, hp: 0 };
    entityStore(state).buildings.replace([palace, farm]);
    const index = entityStore(state), farms = index.buildings.query('farm');
    expect(farms).toEqual([farm]);
    expect(index.buildings.query('palace')).toEqual([palace]);
    farm.hp = 100; farm.faction = 3;
    expect(entityStore(state).buildings.query('farm')).toBe(farms);
    expect(farms[0]).toMatchObject({ hp: 100, faction: 3 });
    index.setBuildingKind(state.buildings[0], 'house'); index.setBuildingKind(state.buildings[1], 'palace');
    expect(index.buildings.query('farm')).toEqual([]);
    expect(index.buildings.query('palace')).toEqual([farm]);
  });
});

describe('retained spatial and workforce indexes', () => {
  it('reuses unchanged query results but observes off-phase moves, removal, ordering and building additions', () => {
    const state = fixture(), point = { x: 9, y: 12 };
    beginUnitFrame(state);
    const units = nearbyUnits(state, point, 4), buildings = nearbyBuildings(state, point, 4);
    endUnitFrame(state);
    beginUnitFrame(state);
    expect(nearbyUnits(state, point, 4)).toBe(units);
    expect(nearbyBuildings(state, point, 4)).toBe(buildings);
    endUnitFrame(state);
    const removed = state.units[0];
    entityStore(state).units.retain(unit => unit !== removed); state.units[1].x = 30.5;
    const building = { ...state.buildings[0], id: 12345, x: 9, y: 12 };
    entityStore(state).buildings.add(building);
    beginUnitFrame(state);
    try {
      expect(nearbyUnits(state, point, 4)).toEqual([state.units[0]]);
      expect(indexedUnit(state, removed.id)).toBeUndefined();
      expect(nearbyBuildings(state, point, 4)).toContain(building);
    } finally { endUnitFrame(state); }
  });

  it('retains population dispatch semantics when workers change faction, disappear or die', () => {
    const state = fixture(), requester = state.units[1], other = state.units[2];
    state.factions[0].population = 1; requester.inside = true; other.faction = 0; other.inside = false;
    const begin = () => { beginUnitFrame(state); beginPeasantFrame(state); };
    const end = () => { endPeasantFrame(state); endUnitFrame(state); };
    begin();
    expect(canDispatchPeasant(state, requester)).toBe(false);
    other.hp = 0;
    expect(canDispatchPeasant(state, requester)).toBe(true);
    other.hp = 100; other.faction = 1; refreshIndexedUnit(state, other); refreshPeasant(state, other);
    expect(canDispatchPeasant(state, requester)).toBe(true);
    end();
    other.faction = 0;
    begin(); expect(canDispatchPeasant(state, requester)).toBe(false); end();
    entityStore(state).units.retain(unit => unit !== other);
    begin(); expect(canDispatchPeasant(state, requester)).toBe(true); end();
  });
});
