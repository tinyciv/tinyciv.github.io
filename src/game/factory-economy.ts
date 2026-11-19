import { citiesWithDevelopedCoal } from './resource-development';
import { rustEngine } from './rust-engine';
import { SimSlot, simCore } from './sim-handle';
import { structureIndex } from './structure-index';
import type { GameState } from './types';

const coalSupply = new SimSlot<ReadonlySet<number>>();

/** Publish the supplying cities once for a batch of native income queries. */
export function factoryIncomeQuote(state: GameState, cities = citiesWithDevelopedCoal(state)): (faction: number, base: number) => number {
  structureIndex(state);
  const handle = simCore(state).handle, previous = coalSupply.get(state);
  if (cities !== previous) {
    if (cities.size || previous?.size) {
      const pointer = rustEngine.sim_civic_prepare(handle, cities.size);
      new Float64Array(rustEngine.memory.buffer, pointer, cities.size).set(Array.from(cities));
      rustEngine.sim_civic_coal_cities(handle, cities.size);
    }
    coalSupply.set(state, cities);
  }
  return (faction, base) => rustEngine.sim_civic_factory_income(handle, faction, base);
}
