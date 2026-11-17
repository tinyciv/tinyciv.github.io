import { entityStore } from './entity-store';
import { atWar } from './relations';
import type { GameState } from './types';

const presentFactions = new WeakMap<GameState, { store: ReturnType<typeof entityStore>; units: number; buildings: number; factions: Set<number> }>();

/** Every enemy candidate (unit, building or firing tower) must be at war with
 * the searcher, so a realm with no hostile faction present can skip spatial
 * target scans. The census of entity factions follows entity additions and
 * removals; captures and defections only ever move entities to listed realms,
 * which are always checked directly. */
export function hostileFactionPresent(state: GameState, faction: number): boolean {
  const store = entityStore(state), units = store.units.revision, buildings = store.buildings.revision;
  let present = presentFactions.get(state);
  if (!present || present.store !== store || present.units !== units || present.buildings !== buildings) {
    const factions = new Set<number>();
    for (const unit of state.units) factions.add(unit.faction);
    for (const building of state.buildings) factions.add(building.faction);
    present = { store, units, buildings, factions }; presentFactions.set(state, present);
  }
  for (const other of present.factions) if (atWar(state, faction, other)) return true;
  // Listed realms also cover an allegiance changed earlier in this step.
  return state.factions.some(other => atWar(state, faction, other.id));
}
