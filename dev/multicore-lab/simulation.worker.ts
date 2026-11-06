import { updateGame } from '../../src/game/simulation';
import { loadNavigationWasm, navigationWasmStatus, setNavigationWasmEnabled } from '../../src/game/navigation-wasm';
import type { GameState, InputState, World } from '../../src/game/types';
import { digestGameState, makeSnapshot, snapshotMetadata } from './snapshot';
import type { WorkerRequest, WorkerResponse, StepResponse } from './protocol';

// The experiment owns a complete production simulation, not a mock workload.
// This local interface keeps DOM and WebWorker TypeScript libs from colliding.
const endpoint = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse, transfer?: Transferable[]) => void;
};
const NO_INPUT: InputState = { up: false, down: false, left: false, right: false };
let state: GameState | undefined;
let deliveredWorld: World | undefined;
let deliveredWorldRevision: number | undefined;
let queue: Promise<void> = Promise.resolve();

async function handle(request: WorkerRequest): Promise<void> {
  if (request.kind === 'init') {
    const started = performance.now();
    setNavigationWasmEnabled(request.wasm !== false);
    // The production module auto-loads only in a Window. Workers must do this
    // explicitly; readiness is reported so comparisons can reject JS fallback.
    const wasmStarted = performance.now();
    if (request.wasm !== false) await loadNavigationWasm();
    const wasmLoadMs = performance.now() - wasmStarted;
    state = request.state;
    // The caller already owns the world that it sent in the initialization.
    deliveredWorld = state.world; deliveredWorldRevision = state.world.revision ?? 0;
    endpoint.postMessage({ kind: 'initialized', id: request.id, metadata: snapshotMetadata(state),
      wasm: navigationWasmStatus(), timings: { initMs: performance.now() - started, wasmLoadMs } });
    return;
  }
  if (!state) throw new Error('Initialize the simulation worker before requesting work.');
  if (request.kind === 'digest') {
    endpoint.postMessage({ kind: 'digest', id: request.id, digest: await digestGameState(state) });
    return;
  }
  if (request.kind !== 'step') throw new Error('Unknown simulation-worker request.');
  const count = request.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 100_000 || !Number.isFinite(request.dt) || request.dt <= 0)
    throw new Error('Step requires a positive finite dt and an integer count from 1 to 100000.');
  if (!['none', 'full', 'dynamic', 'packed'].includes(request.mode)) throw new Error('Unknown snapshot mode.');
  const started = performance.now();
  for (let step = 0; step < count; step++) updateGame(state, request.dt, request.input ?? NO_INPUT);
  const simulationMs = performance.now() - started, snapshotStarted = performance.now();
  const worldChanged = state.world !== deliveredWorld || (state.world.revision ?? 0) !== deliveredWorldRevision;
  const snapshot = makeSnapshot(state, request.mode, request.reuse, worldChanged);
  const response: StepResponse = { kind: 'stepped', id: request.id, mode: request.mode, count,
    metadata: snapshot.metadata, timings: { simulationMs, snapshotMs: performance.now() - snapshotStarted }, payload: snapshot.payload };
  // Clone/transfer and message delivery costs are deliberately outside the two
  // compute timings. The browser runner measures complete round-trip latency.
  endpoint.postMessage(response, snapshot.transfer);
  if (request.mode === 'full' || request.mode === 'dynamic') {
    deliveredWorld = state.world; deliveredWorldRevision = state.world.revision ?? 0;
  }
}

endpoint.onmessage = event => {
  const request = event.data;
  // Async initialization/digests cannot overtake subsequent state mutations.
  queue = queue.then(() => handle(request)).catch((error: unknown) => {
    endpoint.postMessage({ kind: 'error', id: request?.id ?? -1,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined });
  });
};
