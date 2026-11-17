import { rustEngine } from './rust-engine';
import { SimSlot, simCore } from './sim-handle';
import { buildingHeight, type Building, type GameState, type ShellImpact, type Unit } from './types';

const views = new SimSlot<{ revision: number; records: Map<number, ShellImpact> }>();

/** Consume one native projectile terminal, independently of splash victims. */
export function recordProjectileShellLanding(state: GameState, projectiles: number, row: number, target?: Unit | Building): void {
  const building = target && 'capacity' in target ? target : undefined;
  rustEngine.sim_projectile_shell_landing(simCore(state).handle, projectiles, row, Number(!!building),
    building?.y ?? 0, building ? buildingHeight(building) : 0);
}

/** Native revisions change only at a landing or expiry; unchanged frames keep
 * the same immutable view. Event objects carry no gameplay mutations. */
export function publishShellImpacts(state: GameState): void {
  const cached = views.get(state) ?? views.set(state, { revision: -1, records: new Map() });
  const pointer = rustEngine.sim_shell_impacts(simCore(state).handle);
  const header = new Float64Array(rustEngine.memory.buffer, pointer, 2);
  if (header[0] === cached.revision) return;
  cached.revision = header[0];
  const rows = new Float64Array(rustEngine.memory.buffer, pointer + 16, header[1] * 5);
  const next: ShellImpact[] = [], records = new Map<number, ShellImpact>();
  for (let offset = 0; offset < rows.length; offset += 5) {
    const id = rows[offset], effect = cached.records.get(id) ?? { id, x: rows[offset + 1], y: rows[offset + 2],
      time: rows[offset + 3], renderDepth: rows[offset + 4] };
    next.push(effect); records.set(id, effect);
  }
  cached.records = records; state.shellImpacts = next;
}
