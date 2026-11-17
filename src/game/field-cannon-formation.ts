import { rustEngine } from './rust-engine';
import { simCore } from './sim-handle';
import { UNIT_KIND_CODES } from './entity-store';
import type { GameState, Point, Unit } from './types';

/** Encode existing reachable slots; native artillery policy assigns the rear. */
export function cannonRearGoals(state: GameState, members: readonly Unit[], goals: Map<number, Point>, origin: Point, heading: number, reassigned?: (id: number) => void): Map<number, Point> {
  if (!members.some(unit => unit.kind === 'fieldCannon' && goals.has(unit.id))) return goals;
  const rows = members.filter(unit => goals.has(unit.id)), handle = simCore(state).handle;
  const pointer = rustEngine.sim_field_input(handle, rows.length * 4);
  const input = new Float64Array(rustEngine.memory.buffer, pointer, rows.length * 4);
  rows.forEach((unit, index) => { const point = goals.get(unit.id)!; input.set([unit.id, UNIT_KIND_CODES[unit.kind], point.x, point.y], index * 4); });
  const output = rustEngine.sim_field_formation(handle, rows.length, origin.x, origin.y, heading);
  const values = new Float64Array(rustEngine.memory.buffer, output, rows.length * 4);
  rows.forEach((unit, index) => {
    const previous = goals.get(unit.id)!, point = { x: values[index * 4 + 2], y: values[index * 4 + 3] };
    if (previous.x !== point.x || previous.y !== point.y) reassigned?.(unit.id);
    goals.set(unit.id, point);
  });
  return goals;
}
