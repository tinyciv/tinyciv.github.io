import { describe, expect, it } from 'vitest';
import { ClientStateReplica } from '../src/multiplayer/client-state';
import { StateDeltaEncoder } from '../src/multiplayer/state-delta';
import { multiplayerView } from '../src/multiplayer/view';
import { entityStore } from '../src/game/entity-store';
import { farmFieldIndex } from '../src/game/farm-index';
import { createDuelGame, updateGame } from '../src/game/simulation';
import { NO_INPUT } from '../src/multiplayer/input';
import { presentationFog } from '../src/game/fog';
import type { Building, FarmField, GameState, Unit, World } from '../src/game/types';

const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function fixture(): GameState {
  const world: World = { width: 64, height: 36, seed: 'replication', source: 'fixture', revision: 0,
    spawns: [{ x: 8, y: 18 }, { x: 54, y: 18 }],
    tiles: Array.from({ length: 64 * 36 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
      moisture: .5, food: 3, production: 0, gold: 0, variation: .5 })) };
  return { world, units: [{ id: 1, kind: 'worker', faction: 0, x: 2, y: 3, hp: 100, maxHp: 100, lastDamagedAt: Infinity,
    destination: { x: 8, y: 4 }, path: [{ x: 3, y: 3 }, { x: 4, y: 3 }] } as Unit],
    buildings: [{ id: 2, kind: 'house', faction: 0, x: 5, y: 5, hp: 100, maxHp: 100, capacity: 4 } as Building],
    fields: [{ id: 3, camp: 2, faction: 0, x: 8, y: 8, crop: .5 } as unknown as FarmField],
    factions: [], seed: 'replication', time: 0, tick: 0, paused: false, speed: 1,
    events: [], particles: [], selected: null, selectedType: null, buildMode: null, diplomacy: null,
    gameOver: false, victory: false, rngState: 1,
    fog: { width: world.width, height: world.height, seed: world.seed, explored: Array(world.tiles.length).fill(0), buildings: [], fields: [] } };
}

describe('multiplayer field deltas', () => {
  it('round trips in-place nested mutations, absent properties, sparse arrays and entity deletion while retaining identities', () => {
    const live = fixture(), encoder = new StateDeltaEncoder(live), replica = new ClientStateReplica(wire(live));
    const state = replica.state, store = entityStore(state), unit = store.units.get(1)!, building = store.buildings.get(2)!;
    const unitView = store.units.query('worker'), field = state.fields![0], exploration = state.fog!.explored;
    const farmIndex = farmFieldIndex(state);
    expect(encoder.encode(live)).toEqual({});
    live.units[0].hp = 70; delete live.units[0].destination; live.units[0].path!.splice(0, 1);
    live.buildings[0].hp = 80; live.fields![0].x = 9; live.fields![0].camp = 20; live.time = .15;
    live.fog!.explored[40] = 1;
    const delta = wire(encoder.encode(live)); replica.apply(delta);
    expect(wire(state)).toEqual(wire(live));
    expect(entityStore(state)).toBe(store); expect(store.units.get(1)).toBe(unit);
    expect(store.units.query('worker')).toBe(unitView); expect(store.buildings.get(2)).toBe(building);
    expect(state.fields![0]).toBe(field); expect(state.fog!.explored).toBe(exploration);
    expect(farmFieldIndex(state)).not.toBe(farmIndex);
    expect(farmFieldIndex(state).cells.has(8 * state.world.width + 8)).toBe(false);
    expect(farmFieldIndex(state).cells.get(8 * state.world.width + 9)).toBe(field);
    expect(farmFieldIndex(state).camps.get(20)).toEqual([field]);
    expect(JSON.stringify(delta)).not.toContain('"world"');
    expect(JSON.stringify(delta).length).toBeLessThan(JSON.stringify(live).length / 20);
    entityStore(live).units.retain(() => false); live.fields = [];
    const deleted = wire(encoder.encode(live)); expect(deleted.units!.removed).toEqual([1]); expect(deleted.fields!.removed).toEqual([3]);
    replica.apply(deleted); expect(store.units.get(1)).toBeUndefined(); expect(state.fields).toEqual([]);
    expect(wire(state)).toEqual(wire(live));
  });

  it('keeps emitted values detached and maintains role queries and authoritative order', () => {
    const live = fixture(), encoder = new StateDeltaEncoder(live), replica = new ClientStateReplica(wire(live));
    live.units[0].destination = { x: 14, y: 15 };
    const first = encoder.encode(live), frozen = wire(first);
    live.units[0].destination.x = 16; live.units[0].kind = 'warrior';
    const second = encoder.encode(live);
    expect(first).toEqual(frozen); replica.apply(wire(first)); replica.apply(wire(second));
    const store = entityStore(replica.state), original = store.units.get(1)!;
    expect(store.units.query('worker')).toHaveLength(0); expect(store.units.query('soldier')).toEqual([original]);
    const newUnit = { ...live.units[0], id: 4 }; entityStore(live).units.add(newUnit);
    replica.apply(wire(encoder.encode(live))); const added = store.units.get(4)!;
    entityStore(live).units.replace([newUnit, live.units[0]]);
    replica.apply(wire(encoder.encode(live)));
    expect(replica.state.units).toEqual([added, original]); expect(replica.state.units[1]).toBe(original);
  });

  it('replicates consecutive real simulation views exactly and keeps each viewer concealment separate', () => {
    const live = createDuelGame(fixture().world);
    const lookout = { ...live.units.find(unit => unit.faction === 0 && unit.kind === 'leader')!, id: 90001,
      observationPost: { x: 8, y: 18, discoveredBy: [0] } } as Unit;
    entityStore(live).units.add(lookout);
    const encoders = [0, 1].map(faction => new StateDeltaEncoder(multiplayerView(live, faction)));
    const replicas = [0, 1].map(faction => new ClientStateReplica(wire(multiplayerView(live, faction))));
    expect(replicas[1].state.units.some(unit => unit.id === lookout.id)).toBe(false);
    live.multiplayer!.inputs[0] = { ...NO_INPUT, right: true };
    for (let tick = 0; tick < 6; tick++) {
      updateGame(live, .15, NO_INPUT);
      for (const faction of [0, 1]) {
        const receivedFog = JSON.stringify(replicas[faction].state.fog);
        presentationFog(replicas[faction].state);
        expect(JSON.stringify(replicas[faction].state.fog)).toBe(receivedFog);
        const view = multiplayerView(live, faction);
        replicas[faction].apply(wire(encoders[faction].encode(view)));
        // Terrain edits have a separate journal channel.
        const { world: _received, ...received } = replicas[faction].state;
        const { world: _expected, ...expected } = view;
        expect(wire(received)).toEqual(wire(expected));
      }
    }
    lookout.observationPost!.discoveredBy.push(1);
    replicas[1].apply(wire(encoders[1].encode(multiplayerView(live, 1))));
    expect(replicas[1].state.units.some(unit => unit.id === lookout.id)).toBe(true);
    lookout.observationPost!.discoveredBy = [0];
    const hidden = encoders[1].encode(multiplayerView(live, 1));
    expect(hidden.units!.removed).toContain(lookout.id); replicas[1].apply(wire(hidden));
    expect(replicas[1].state.units.some(unit => unit.id === lookout.id)).toBe(false);
    expect(replicas[0].state.multiplayer!.controls[1]).toBeUndefined();
    expect(replicas[1].state.multiplayer!.controls[0]).toBeUndefined();
  });
});
