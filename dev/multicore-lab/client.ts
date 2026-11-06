import { updateGame } from '../../src/game/simulation';
import { loadNavigationWasm, navigationWasmStatus } from '../../src/game/navigation-wasm';
import type { GameState, InputState } from '../../src/game/types';
import { digestGameState, snapshotMetadata } from './snapshot';
import type { SnapshotMode, WorkerRequest, WorkerResponse, StepResponse } from './protocol';

const input: InputState = { up: false, down: false, left: false, right: false };
type Request = WorkerRequest extends infer T ? T extends WorkerRequest ? Omit<T, 'id'> : never : never;
class SimulationClient {
  worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });
  private serial = 0;
  private pending = new Map<number, { resolve: (response: WorkerResponse) => void; reject: (error: Error) => void }>();
  constructor() {
    this.worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      const entry = this.pending.get(data.id); if (!entry) return;
      this.pending.delete(data.id);
      if (data.kind === 'error') entry.reject(new Error(data.message)); else entry.resolve(data);
    };
    this.worker.onerror = error => { for (const entry of this.pending.values()) entry.reject(new Error(error.message)); this.pending.clear(); };
  }
  call(request: Request, transfer: Transferable[] = []): Promise<WorkerResponse> {
    const id = ++this.serial;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.worker.postMessage({ ...request, id }, transfer); });
  }
  close(): void { this.worker.terminate(); this.pending.clear(); }
}

export const statistics = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b), at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  return { count: values.length, mean: values.reduce((sum, n) => sum + n, 0) / Math.max(1, values.length), p50: at(.5), p95: at(.95), max: sorted.at(-1) ?? 0 };
};

export async function parity(source: GameState, steps = 90) {
  await loadNavigationWasm(); const worker = new SimulationClient(), main = structuredClone(source);
  main.paused = false;
  try {
    const init = await worker.call({ kind: 'init', state: structuredClone(main) });
    for (let i = 0; i < steps; i++) updateGame(main, 1 / 60, input);
    const reply = await worker.call({ kind: 'step', dt: 1 / 60, count: steps, mode: 'none' });
    const remote = await worker.call({ kind: 'digest' }), local = await digestGameState(main);
    return { steps, init, reply, local, remote, equal: remote.kind === 'digest' && remote.digest.sha256 === local.sha256, mainWasm: navigationWasmStatus() };
  } finally { worker.close(); }
}

/** Includes native message serialization and transfer in end-to-end latency.
 * Packed mode is a transport experiment, not a complete production view. */
export async function transport(source: GameState, mode: SnapshotMode, frames = 90) {
  const worker = new SimulationClient(), samples: { roundTrip: number; simulation: number; snapshot: number; other: number; sender: number }[] = [];
  let reuse: ArrayBuffer | undefined;
  const state = structuredClone(source); state.paused = false;
  try {
    const begin = performance.now(), init = await worker.call({ kind: 'init', state });
    const initRoundTrip = performance.now() - begin;
    for (let i = 0; i < frames + 15; i++) {
      const started = performance.now();
      const pending = worker.call({ kind: 'step', dt: 1 / 60, mode, reuse }, reuse ? [reuse] : []);
      const sender = performance.now() - started;
      const reply = await pending as StepResponse, roundTrip = performance.now() - started;
      if ('packed' in reply.payload) reuse = reply.payload.packed.units.buffer as ArrayBuffer;
      if (i >= 15) samples.push({ roundTrip, simulation: reply.timings.simulationMs, snapshot: reply.timings.snapshotMs,
        other: Math.max(0, roundTrip - reply.timings.simulationMs - reply.timings.snapshotMs), sender });
    }
    return { mode, frames, initRoundTrip, init, metrics: Object.fromEntries(['roundTrip', 'simulation', 'snapshot', 'other', 'sender'].map(key =>
      [key, statistics(samples.map(sample => sample[key as keyof typeof sample]))])), samples };
  } finally { worker.close(); }
}

interface Renderer { draw(state: GameState, dt: number): void }
interface FrameSample { work: number; render: number; apply: number; simulation: number; gap: number; snapshotAge: number }

/** The production update routine and renderer are unchanged. One request may
 * be in flight. Variable elapsed-time steps mirror the current application;
 * throughput and view age are reported alongside main-thread responsiveness. */
export async function frameExperiment(source: GameState, renderer: Renderer, raf: typeof requestAnimationFrame,
  mode: 'main' | 'worker', seconds = 10) {
  await loadNavigationWasm(); const state = structuredClone(source); state.paused = false;
  const worker = mode === 'worker' ? new SimulationClient() : undefined;
  let latest: StepResponse | undefined, pending: Promise<unknown> | undefined, failure: unknown;
  let applyTotal = 0, lastAppliedAt = performance.now(), lastSentAt = 0, updates = 0;
  const samples: FrameSample[] = [], workerRoundTrip: number[] = [], workerCompute: number[] = [];
  try {
    const init = worker && await worker.call({ kind: 'init', state });
    // Warm render caches separately; do not include terrain/asset preparation.
    renderer.draw(state, 0);
    const startGameTime = state.time, start = performance.now(); let previous = start; lastAppliedAt = start;
    const initial = snapshotMetadata(state);
    await new Promise<void>((resolve, reject) => {
      const frame = (now: number) => {
        try {
          if (failure) throw failure;
          const started = performance.now(), gap = now - previous, dt = Math.min(.15, Math.max(1 / 240, gap / 1000)); previous = now;
          let simulation = 0, apply = 0;
          if (worker) {
            if (latest) {
              const began = performance.now(), payload = latest.payload;
              if ('dynamic' in payload) {
                const world = state.world;
                if (payload.world) Object.assign(world, payload.world);
                for (const key of Object.keys(state)) if (key !== 'world' && !(key in payload.dynamic)) delete (state as unknown as Record<string, unknown>)[key];
                Object.assign(state, payload.dynamic); state.world = world;
              }
              latest = undefined; apply = performance.now() - began; applyTotal += apply; lastAppliedAt = now;
            }
            if (!pending) {
              const elapsed = lastSentAt ? Math.min(.15, (now - lastSentAt) / 1000) : dt;
              lastSentAt = now; const sent = performance.now();
              pending = worker.call({ kind: 'step', dt: elapsed, mode: 'dynamic' }).then(response => {
                const reply = response as StepResponse; latest = reply;
                workerRoundTrip.push(performance.now() - sent); workerCompute.push(reply.timings.simulationMs); updates++;
              }).catch(error => { failure = error; }).finally(() => { pending = undefined; });
            }
          } else {
            const began = performance.now(); updateGame(state, dt, input); simulation = performance.now() - began; updates++;
          }
          const drawStarted = performance.now(); renderer.draw(state, dt); const render = performance.now() - drawStarted;
          samples.push({ work: performance.now() - started, render, apply, simulation, gap, snapshotAge: worker ? now - lastAppliedAt : 0 });
          if (performance.now() - start < seconds * 1000) raf(frame); else resolve();
        } catch (error) { reject(error); }
      }; raf(frame);
    });
    const elapsed = performance.now() - start, viewGameSeconds = state.time - startGameTime, updatesAtEnd = updates;
    const authoritativeGameSeconds = latest ? latest.metadata.time - startGameTime : viewGameSeconds;
    await pending; if (failure) throw failure;
    return { mode, elapsed, frames: samples.length, fps: samples.length / elapsed * 1000, updates: updatesAtEnd, simulationHz: updatesAtEnd / elapsed * 1000,
      viewGameSeconds, authoritativeGameSeconds, speed: state.speed, achievedSpeed: authoritativeGameSeconds / elapsed * 1000,
      initial, final: latest?.metadata ?? snapshotMetadata(state), init, applyTotal,
      metrics: Object.fromEntries(['work','render','apply','simulation','gap','snapshotAge'].map(key => [key, statistics(samples.map(sample => sample[key as keyof FrameSample]))])),
      workerRoundTrip: statistics(workerRoundTrip), workerCompute: statistics(workerCompute), samples };
  } finally { worker?.close(); }
}
