import { unitMaxHp, type GameState } from '../../src/game/types';
import { PACKED_UNIT_STRIDE, type DynamicState, type SnapshotMetadata, type SnapshotMode, type SnapshotPayload, type StateDigest } from './protocol';

export function snapshotMetadata(state: GameState): SnapshotMetadata {
  let livingUnits = 0, visibleUnits = 0, movingUnits = 0, totalUnitHp = 0;
  for (const unit of state.units) {
    totalUnitHp += unit.hp;
    if (unit.hp <= 0) continue;
    livingUnits++;
    if (!unit.inside) visibleUnits++;
    if (unit.moving && !unit.inside) movingUnits++;
  }
  return {
    time: state.time, tick: state.tick, worldRevision: state.world.revision ?? 0,
    units: state.units.length, livingUnits, visibleUnits, movingUnits, totalUnitHp,
    buildings: state.buildings.length, fields: state.fields?.length ?? 0,
    projectiles: state.projectiles?.length ?? 0, bloodEffects: state.bloodEffects?.length ?? 0,
    rngState: state.rngState, paused: state.paused, speed: state.speed, gameOver: state.gameOver,
    factions: state.factions.map(({ id, population, food, gold }) => ({ id, population, food, gold })),
  };
}

/** The caller owns the simulation state. full/dynamic are shallow views until
 * postMessage synchronously clones them; packed owns its transferable buffer. */
export function makeSnapshot(state: GameState, mode: SnapshotMode, reuse?: ArrayBuffer, includeWorld = false): {
  metadata: SnapshotMetadata; payload: SnapshotPayload; transfer: ArrayBuffer[];
} {
  const metadata = snapshotMetadata(state);
  if (mode === 'none') return { metadata, payload: {}, transfer: [] };
  if (mode === 'full') return { metadata, payload: { state }, transfer: [] };
  if (mode === 'dynamic') {
    // The sender owns revision tracking. Changes without a world revision are
    // deliberately a limitation of this mode; full snapshots remain exact.
    const { world: _world, ...dynamic } = state;
    metadata.worldChanged = includeWorld;
    return { metadata, payload: { dynamic: dynamic as DynamicState, ...(includeWorld ? { world: state.world } : {}) }, transfer: [] };
  }
  const length = state.units.length * PACKED_UNIT_STRIDE, bytes = length * Float64Array.BYTES_PER_ELEMENT;
  const buffer = reuse && reuse.byteLength >= bytes ? reuse : new ArrayBuffer(bytes);
  const units = new Float64Array(buffer, 0, length);
  for (let index = 0; index < state.units.length; index++) {
    const unit = state.units[index], offset = index * PACKED_UNIT_STRIDE;
    units[offset] = unit.id; units[offset + 1] = unit.x; units[offset + 2] = unit.y;
    units[offset + 3] = unit.hp; units[offset + 4] = unitMaxHp(unit); units[offset + 5] = unit.morale;
    units[offset + 6] = Number(unit.moving); units[offset + 7] = unit.facing;
    units[offset + 8] = unit.attackTime; units[offset + 9] = unit.faction;
  }
  return { metadata, payload: { packed: { units, unitCount: state.units.length, stride: PACKED_UNIT_STRIDE } }, transfer: [buffer] };
}

/** Hash the complete serializable state outside timed frames. The same cloned
 * input and update sequence should produce identical property/array order. */
export async function digestGameState(state: GameState): Promise<StateDigest> {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return { sha256: Array.from(hash, value => value.toString(16).padStart(2, '0')).join(''),
    jsonBytes: bytes.byteLength, metadata: snapshotMetadata(state) };
}
