import { grantIncome } from './resource-income';
import type { Building, GameState, Unit } from './types';
import { simulationReadsActive } from './simulation-reads';

export function refreshFoodCargo(unit: Unit): void {
  unit.cargoBatches = (unit.cargoBatches ?? []).filter(batch => batch.amount > 1e-9);
  unit.cargo = unit.cargoBatches.reduce((sum, batch) => sum + batch.amount, 0);
  unit.cargoExpiresAt = unit.cargoBatches.length ? Math.min(...unit.cargoBatches.map(batch => batch.expiresAt)) : undefined;
}

/** Food remains perishable until delivery, including at the exact deadline.
 * This is also used while a courier is travelling or fleeing. */
export function expireFoodCargo(state: GameState, unit: Unit): void {
  // The next deadline is maintained whenever cargo changes. Travelling couriers
  // need no batch scan before that instant; delivery still expires food exactly.
  if (simulationReadsActive(state) && unit.cargoExpiresAt !== undefined && unit.cargoExpiresAt > state.time + 1e-7) return;
  const expired = (unit.cargoBatches ?? []).filter(batch => batch.expiresAt <= state.time + 1e-7);
  if (!expired.length) return;
  const lost = expired.reduce((sum, batch) => sum + batch.amount, 0);
  if (lost > 1e-7) state.particles.push({ x: unit.x, y: unit.y - .25,
    text: `−${Number(lost.toFixed(1))} food`, color: '#f46b63', life: 1.6 });
  unit.cargoBatches = unit.cargoBatches!.filter(batch => batch.expiresAt > state.time + 1e-7);
  refreshFoodCargo(unit);
}

/** A courier physically at a palace door deposits every surviving batch.
 * Distance and spoilage determine supply; the palace imposes no intake limit. */
export function deliverFoodCargo(state: GameState, palace: Building, courier: Unit): number {
  const faction = state.factions.find(candidate => candidate.id === palace.faction);
  if (!faction) return 0;
  expireFoodCargo(state, courier);
  refreshFoodCargo(courier);
  const delivered = courier.cargo ?? 0;
  grantIncome(faction, { food: delivered }, state);
  palace.foodDelivered = (palace.foodDelivered ?? 0) + delivered;
  courier.cargoBatches = [];
  refreshFoodCargo(courier);
  return delivered;
}
