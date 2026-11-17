import { grantIncome } from './resource-income';
import type { Building, GameState, Unit } from './types';
import { simulationReadsActive } from './simulation-reads';
import { buildingWithId } from './entity-store';
import { depositGranaryFood } from './granaries-native';

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
    text: `−${Math.round(lost)} food`, color: '#f46b63', life: 1.6 });
  unit.cargoBatches = unit.cargoBatches!.filter(batch => batch.expiresAt > state.time + 1e-7);
  refreshFoodCargo(unit);
}

/** A courier at its town or granary deposits every surviving batch. The city
 * retains its delivery accounting when storage is in an outlying granary. */
export function deliverFoodCargo(state: GameState, palace: Building, courier: Unit): number {
  const faction = state.factions.find(candidate => candidate.id === palace.faction);
  if (!faction) return 0;
  expireFoodCargo(state, courier);
  refreshFoodCargo(courier);
  let delivered = courier.cargo ?? 0;
  const city = palace.kind === 'granary' ? buildingWithId(state, courier.home) : palace;
  if (palace.kind === 'granary') {
    if (!city) return 0;
    const accepted = depositGranaryFood(state, courier, city, palace, delivered);
    if (accepted < delivered) return 0;
    delivered = accepted;
  }
  grantIncome(faction, { food: delivered }, state);
  palace.foodDelivered = (palace.foodDelivered ?? 0) + delivered;
  if (city && city !== palace) city.foodDelivered = (city.foodDelivered ?? 0) + delivered;
  courier.cargoBatches = [];
  refreshFoodCargo(courier);
  return delivered;
}
