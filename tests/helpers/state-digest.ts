import type { GameState } from '../../src/game/types';

/** SHA-256 digests of simulation state, shared by tests, the orchestration
 * trace and the multicore lab (moved from dev/multicore-lab/snapshot.ts).
 * Uses Web Crypto so it runs unchanged in Node and in browsers. */

export async function sha256Hex(text: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(hash, value => value.toString(16).padStart(2, '0')).join('');
}

/** Order-independent JSON: object keys sorted, undefined members dropped,
 * non-finite numbers tagged, Map/Set expanded in insertion order. Field
 * insertion order therefore never changes a digest; values and array order do. */
export function canonicalize(value: unknown): unknown {
  if (typeof value === 'number') return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : { $number: String(value) };
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  if (value === null || typeof value !== 'object') return typeof value === 'function' ? undefined : value;
  if (Array.isArray(value)) return value.map(item => item === undefined ? null : canonicalize(item));
  if (ArrayBuffer.isView(value)) return { $typed: Array.from(value as unknown as ArrayLike<number>, item => canonicalize(item)) };
  if (value instanceof Map) return { $map: Array.from(value, ([key, item]) => [canonicalize(key), canonicalize(item)]) };
  if (value instanceof Set) return { $set: Array.from(value, item => canonicalize(item)) };
  const record = value as Record<string, unknown>, out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    const item = record[key];
    if (item === undefined || typeof item === 'function') continue;
    out[key] = canonicalize(item);
  }
  return out;
}

export function canonicalJson(value: unknown): string { return JSON.stringify(canonicalize(value)); }

/** The simulation fields every migration step must preserve exactly: units,
 * buildings, factions, rngState, time and tick (canonical JSON). */
export function simulationDigestInput(state: GameState): string {
  return canonicalJson({ units: state.units, buildings: state.buildings, factions: state.factions,
    rngState: state.rngState, time: state.time, tick: state.tick });
}

export async function simulationStateDigest(state: GameState): Promise<string> {
  return sha256Hex(simulationDigestInput(state));
}

/** Hash the complete serializable state outside timed frames. The same cloned
 * input and update sequence should produce identical property/array order. */
export async function fullStateDigest(state: GameState): Promise<{ sha256: string; jsonBytes: number }> {
  const json = JSON.stringify(state);
  return { sha256: await sha256Hex(json), jsonBytes: new TextEncoder().encode(json).byteLength };
}
