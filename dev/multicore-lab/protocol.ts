import type { GameState, InputState, World } from '../../src/game/types';
import type { navigationWasmStatus } from '../../src/game/navigation-wasm';

export type SnapshotMode = 'none' | 'full' | 'dynamic' | 'packed';
export type DynamicState = Omit<GameState, 'world'>;
export const PACKED_UNIT_FIELDS = ['id', 'x', 'y', 'hp', 'maxHp', 'morale', 'moving', 'facing', 'attackTime', 'faction'] as const;
export const PACKED_UNIT_STRIDE = PACKED_UNIT_FIELDS.length;

/** This deliberately small transport sample cannot drive the existing renderer.
 * It omits kinds, equipment, buildings, field state, fog, world changes, etc. */
export interface PackedSnapshot {
  units: Float64Array;
  unitCount: number;
  stride: number;
}

export interface SnapshotMetadata {
  time: number;
  tick: number;
  worldRevision: number;
  /** A dynamic snapshot includes a replacement world when this is true. */
  worldChanged?: boolean;
  units: number;
  livingUnits: number;
  visibleUnits: number;
  movingUnits: number;
  totalUnitHp: number;
  buildings: number;
  fields: number;
  projectiles: number;
  bloodEffects: number;
  rngState: number;
  paused: boolean;
  speed: number;
  gameOver: boolean;
  factions: { id: number; population: number; food: number; gold: number }[];
}

export interface InitRequest { kind: 'init'; id: number; state: GameState; wasm?: boolean }
export interface StepRequest {
  kind: 'step';
  id: number;
  dt: number;
  count?: number;
  mode: SnapshotMode;
  input?: InputState;
  /** Ownership is transferred back to the worker for the next packed reply. */
  reuse?: ArrayBuffer;
}
export interface DigestRequest { kind: 'digest'; id: number }
export type WorkerRequest = InitRequest | StepRequest | DigestRequest;
export type SnapshotPayload = { state: GameState } | { dynamic: DynamicState; world?: World } | { packed: PackedSnapshot } | Record<string, never>;

export interface InitResponse {
  kind: 'initialized';
  id: number;
  metadata: SnapshotMetadata;
  wasm: ReturnType<typeof navigationWasmStatus>;
  timings: { initMs: number; wasmLoadMs: number };
}
export interface StepResponse {
  kind: 'stepped';
  id: number;
  mode: SnapshotMode;
  count: number;
  metadata: SnapshotMetadata;
  timings: { simulationMs: number; snapshotMs: number };
  payload: SnapshotPayload;
}
export interface StateDigest { sha256: string; jsonBytes: number; metadata: SnapshotMetadata }
export interface DigestResponse { kind: 'digest'; id: number; digest: StateDigest }
export interface ErrorResponse { kind: 'error'; id: number; message: string; stack?: string }
export type WorkerResponse = InitResponse | StepResponse | DigestResponse | ErrorResponse;
