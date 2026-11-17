import { rustEngine } from './rust-engine';
import { simCore } from './sim-handle';
import { BUILDING_KIND_CODES, UNIT_KIND_CODES, entityStore } from './entity-store';
import { playerFaction } from './player-context';
import { buildingTargetable } from './building-targeting';
import { buildingWidth, buildingHeight, unitMaxHp,
  type Building, type BuildingKind, type GameState, type Point, type Unit } from './types';

const STRIDE = 12;
type Target = Building | Unit;
type Sample = { target: Target; hostile?: boolean; range?: number; defense?: number; damage?: number };
const center = (target: Target): Point => 'capacity' in target
  ? { x: target.x + buildingWidth(target) / 2, y: target.y + buildingHeight(target) / 2 } : target;

/** Transport only: the native resource decides range, priority and health.
 * Commands are sparse (one delivery, due shot or shell impact), never scans
 * scheduled at movement cadence. Copy before callbacks can grow WASM memory. */
export function battleSupport(state: GameState, mode: 1 | 2 | 3 | 4 | 5 | 6, origin: Point, faction: number,
  skip: number, samples: readonly Sample[]): Float64Array {
  const handle = simCore(state).handle;
  const values: number[] = [];
  for (let row = 0; row < samples.length; row++) {
    const { target, hostile, range, defense, damage } = samples[row], building = 'capacity' in target, point = center(target);
    values.push(target.id, point.x, point.y, target.hp, building ? target.maxHp : unitMaxHp(target), target.faction,
      building ? BUILDING_KIND_CODES[target.kind] : UNIT_KIND_CODES[target.kind],
      (building ? 1 : 0) | (building ? buildingTargetable(target) ? 2 : 0 : target.hp > 0 ? 2 : 0)
        | (hostile ? 4 : 0) | (building || !target.inside && target.embarkedOn === undefined ? 8 : 0)
        | (building && target.palaceLevel === 2 ? 16 : 0),
      range ?? 0, building ? 0 : target.kills ?? 0, defense ?? 1, damage ?? 0);
  }
  const pointer = rustEngine.sim_battle_input(handle, samples.length);
  new Float64Array(rustEngine.memory.buffer, pointer, samples.length * STRIDE).set(values);
  const output = rustEngine.sim_battle_run(handle, samples.length, mode, origin.x, origin.y, faction, skip);
  const count = new Float64Array(rustEngine.memory.buffer, output, 1)[0];
  return new Float64Array(rustEngine.memory.buffer, output + 8, count * 3).slice();
}

export function deliverSupplyHealing(state: GameState, leader: Unit, cart: Unit): void {
  // Wounded membership also includes sleeping/garrisoned units, which are
  // absent from the movement index. Full-health units need no observation.
  const store = entityStore(state);
  const output = battleSupport(state, 1, leader, cart.faction, cart.id,
    store.units.query('wounded').map(target => ({ target })));
  for (let row = 0; row < output.length; row += 3) {
    const unit = store.units.get(output[row]); if (!unit) continue;
    unit.hp = output[row + 1]; store.units.updateRoles(unit, false);
    const healed = Number(output[row + 2].toPrecision(3));
    state.particles.push({ x: unit.x, y: unit.y, text: `+${healed}`, kind: 'healing', color: '#88d18a', life: 1.6 });
  }
}

export const farmRampAllowed = (stair: unknown): boolean => !!rustEngine.farm_site_allowed(Number(!!stair));
export function governorPurchaseAllowed(state: GameState, faction: number, kind: BuildingKind): boolean {
  const localPlacing = faction === playerFaction(state) && !!state.buildMode && state.buildMode !== 'clearTrees';
  return !!rustEngine.governor_purchase_allowed(simCore(state).handle, faction, Number(localPlacing), BUILDING_KIND_CODES[kind]);
}

export function setPlacementIntent(state: GameState, faction: number, placing: boolean): void {
  rustEngine.sim_placement_intent(simCore(state).handle, faction, Number(placing));
}

export function startingRoadArm(corner: number, step: number): Point {
  const pointer = rustEngine.starting_road_arm(corner, step);
  const values = new Float64Array(rustEngine.memory.buffer, pointer, 2);
  return { x: values[0], y: values[1] };
}
