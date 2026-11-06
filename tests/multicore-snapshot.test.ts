import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPerformanceScenario, NO_INPUT } from '../dev/performance/scenarios';
import { PACKED_UNIT_FIELDS, PACKED_UNIT_STRIDE, type WorkerRequest, type WorkerResponse } from '../dev/multicore-lab/protocol';
import { digestGameState, makeSnapshot, snapshotMetadata } from '../dev/multicore-lab/snapshot';
import { updateGame } from '../src/game/simulation';
import { unitMaxHp, type GameState } from '../src/game/types';

const fixture = (): GameState => createPerformanceScenario('idle-100').state;
afterEach(() => vi.unstubAllGlobals());

describe('multicore transport experiment', () => {
  it('full snapshots preserve the entire serializable game state', () => {
    const state = fixture(), snapshot = makeSnapshot(state, 'full');
    expect(snapshot.transfer).toEqual([]);
    expect(structuredClone(snapshot.payload)).toEqual({ state });
    expect(snapshotMetadata(state)).toMatchObject({ units: state.units.length,
      livingUnits: state.units.length, buildings: state.buildings.length,
      fields: state.fields!.length, worldRevision: state.world.revision });
  });

  it('dynamic snapshots preserve every non-world property and carry requested world patches', () => {
    const state = fixture(), initialWorld = structuredClone(state.world);
    const unchanged = structuredClone(makeSnapshot(state, 'dynamic').payload);
    expect('dynamic' in unchanged).toBe(true);
    if (!('dynamic' in unchanged)) throw new Error('Expected dynamic snapshot.');
    expect(unchanged).not.toHaveProperty('world');
    expect({ ...unchanged.dynamic, world: initialWorld }).toEqual(state);
    state.world.tiles[0].overlay = 'forest';
    state.world.revision = (state.world.revision ?? 0) + 1;
    const changed = makeSnapshot(state, 'dynamic', undefined, true);
    expect(changed.metadata.worldChanged).toBe(true);
    expect(changed.payload).toHaveProperty('world', state.world);
    const payload = structuredClone(changed.payload);
    if (!('dynamic' in payload)) throw new Error('Expected dynamic snapshot.');
    expect({ ...payload.dynamic, world: payload.world }).toEqual(state);
  });

  it('transfers packed ownership and reuses the returned buffer without changing field order', () => {
    const state = fixture(), first = makeSnapshot(state, 'packed');
    expect(PACKED_UNIT_FIELDS).toEqual(['id', 'x', 'y', 'hp', 'maxHp', 'morale', 'moving', 'facing', 'attackTime', 'faction']);
    if (!('packed' in first.payload)) throw new Error('Expected packed snapshot.');
    const original = first.payload.packed.units;
    const received = structuredClone(first.payload, { transfer: first.transfer });
    expect(original.byteLength).toBe(0);
    expect(received.packed.units.length).toBe(state.units.length * PACKED_UNIT_STRIDE);
    const unit = state.units[0];
    expect([...received.packed.units.subarray(0, PACKED_UNIT_STRIDE)]).toEqual([
      unit.id, unit.x, unit.y, unit.hp, unitMaxHp(unit), unit.morale,
      Number(unit.moving), unit.facing, unit.attackTime, unit.faction,
    ]);
    const back = structuredClone({ reuse: received.packed.units.buffer as ArrayBuffer },
      { transfer: [received.packed.units.buffer as ArrayBuffer] });
    expect(received.packed.units.byteLength).toBe(0);
    state.units[0].x += 1;
    const second = makeSnapshot(state, 'packed', back.reuse);
    if (!('packed' in second.payload)) throw new Error('Expected packed snapshot.');
    expect(second.payload.packed.units.buffer).toBe(back.reuse);
    expect(second.payload.packed.units[1]).toBe(unit.x);
  });

  it('allocates a larger packed buffer when population exceeds the returned capacity', () => {
    const state = fixture(), tiny = new ArrayBuffer(8);
    const snapshot = makeSnapshot(state, 'packed', tiny);
    if (!('packed' in snapshot.payload)) throw new Error('Expected packed snapshot.');
    expect(snapshot.payload.packed.units.buffer).not.toBe(tiny);
    expect(snapshot.payload.packed.units.byteLength).toBe(state.units.length * PACKED_UNIT_STRIDE * 8);
    expect(makeSnapshot(state, 'none').payload).toEqual({});
  });

  it('digests include terrain and state omitted from the packed transport sample', async () => {
    const state = fixture(), copy = structuredClone(state);
    const original = await digestGameState(state);
    expect(original.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await digestGameState(copy)).toEqual(original);
    copy.world.tiles[0].food += 1;
    expect((await digestGameState(copy)).sha256).not.toBe(original.sha256);
  });

  it('serializes worker RPCs, preserves production simulation results, and replies to errors', async () => {
    const pending = new Map<number, (response: WorkerResponse) => void>();
    const order: number[] = [];
    vi.stubGlobal('postMessage', (message: WorkerResponse, transfer: Transferable[] = []) => {
      const response = structuredClone(message, { transfer });
      order.push(response.id); pending.get(response.id)?.(response); pending.delete(response.id);
    });
    vi.stubGlobal('onmessage', null);
    await import('../dev/multicore-lab/simulation.worker');
    const send = (request: WorkerRequest) => new Promise<WorkerResponse>(resolve => {
      pending.set(request.id, resolve);
      const event = { data: structuredClone(request) } as MessageEvent<WorkerRequest>;
      (globalThis as unknown as { onmessage: (event: MessageEvent<WorkerRequest>) => void }).onmessage(event);
    });
    const state = fixture(), expected = structuredClone(state);
    const initialized = send({ kind: 'init', id: 1, state, wasm: false });
    const stepped = send({ kind: 'step', id: 2, dt: 1 / 60, count: 2, mode: 'dynamic' });
    const digested = send({ kind: 'digest', id: 3 });
    expect((await initialized).kind).toBe('initialized');
    const result = await stepped;
    expect(result.kind).toBe('stepped');
    if (result.kind !== 'stepped') throw new Error('Expected step response.');
    expect(result.timings.simulationMs).toBeGreaterThanOrEqual(0);
    expect(result.timings.snapshotMs).toBeGreaterThanOrEqual(0);
    for (let index = 0; index < 2; index++) updateGame(expected, 1 / 60, NO_INPUT);
    const digest = await digested;
    if (digest.kind !== 'digest') throw new Error('Expected digest response.');
    expect(digest.digest).toEqual(await digestGameState(expected));
    expect(order).toEqual([1, 2, 3]);
    const bad = await send({ kind: 'step', id: 4, dt: -1, mode: 'none' });
    expect(bad).toMatchObject({ kind: 'error', id: 4 });
    const recovered = await send({ kind: 'step', id: 5, dt: 1 / 60, mode: 'packed' });
    expect(recovered.kind).toBe('stepped');
  });
});
