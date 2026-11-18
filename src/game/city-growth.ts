import type { CitySummary } from './cities';
import { structuresOf, STRUCTURE_READY } from './structure-index';
import { houseBirthProgress, palaceEnclosures } from './enclosures';
import { type Faction, type GameState, buildingReady } from './types';
import { rustEngine } from './rust-engine';
import { SIM_ENGINE, SimSlot, simCore } from './sim-handle';
import { colosseumGrowthMultiplier } from './colosseum';
import { recordCampaignPopulation } from './campaign-stats';

/** Scale the release allowance too, so banked or enclosed growth is not clipped. */
export const MAX_CITY_BIRTHS_PER_TICK = rustEngine.population_constant(1);
const CITY_INPUT_STRIDE = 9, HOUSE_INPUT_STRIDE = 6, CITY_OUTPUT_STRIDE = 3;
/** The game's persistent population pools (one engine per simulation core). */
const engines = new SimSlot<{ handle: number }>();
function populationEngine(state: GameState): number {
  let engine = engines.get(state);
  if (!engine) {
    const core = simCore(state), owner = { core, handle: 0 };
    owner.handle = core.engine(owner, SIM_ENGINE.population);
    engine = engines.set(state, owner);
  }
  return engine.handle;
}

/** Advance every city's birth clock once per economy tick. Food stores remain shared,
 * but a city's production, credit, vacant homes and birth allowance do not.
 * The caller snapshots city yields before births, then reconciles workers
 * and housing once after all births rather than after each individual birth. */
export function advanceCityPopulation(state: GameState, faction: Faction, summaries: readonly CitySummary[],
  huntingMultiplier: number, unfed = 0): number {
  const cities = summaries.filter(city => city.palace.faction === faction.id && buildingReady(city.palace));
  if (!cities.length) return 0;
  const homes = structuresOf(state, faction.id, STRUCTURE_READY, 'house', 'apartments')
    .filter(house => !((house.residents ?? 0) >= house.capacity));
  // Resolve the enclosure map once per economy batch. Finish all native cache
  // reads before obtaining the transfer view, since they may grow WASM memory.
  const enclosures = homes.length ? palaceEnclosures(state) : undefined;
  // Native birth credit and its release cap share the faction growth bonus,
  // including residents born into the palace rather than a separate house.
  const growth = rustEngine.sim_offensive_growth(simCore(state).handle, faction.id, colosseumGrowthMultiplier(state, faction.id));
  const required = homes.map(home => houseBirthProgress(state, home, enclosures));
  const engine = populationEngine(state);
  const pointer = rustEngine.population_configure(engine, cities.length, homes.length);
  const input = new Float64Array(rustEngine.memory.buffer, pointer, cities.length * CITY_INPUT_STRIDE + homes.length * HOUSE_INPUT_STRIDE);
  for (let row = 0; row < cities.length; row++) {
    const city = cities[row], palace = city.palace, offset = row * CITY_INPUT_STRIDE;
    input[offset] = palace.id; input[offset + 1] = palace.x; input[offset + 2] = palace.y;
    input[offset + 3] = city.population; input[offset + 4] = city.food; input[offset + 5] = palace.populationGrowth ?? 0;
    input[offset + 6] = palace.capacity; input[offset + 7] = palace.unhousedResidents ?? 0;
    input[offset + 8] = palace.depopulated === undefined ? 0 : palace.depopulated ? 2 : 1;
  }
  for (let row = 0; row < homes.length; row++) {
    const home = homes[row], offset = cities.length * CITY_INPUT_STRIDE + row * HOUSE_INPUT_STRIDE;
    input[offset] = home.id; input[offset + 1] = home.x; input[offset + 2] = home.y;
    input[offset + 3] = home.residents ?? 0; input[offset + 4] = home.capacity; input[offset + 5] = required[row];
  }
  const outputPointer = rustEngine.population_run(engine, faction.food, faction.population, huntingMultiplier, unfed, growth, faction.achievements ?? 0);
  const output = new Float64Array(rustEngine.memory.buffer, outputPointer, 3 + cities.length * CITY_OUTPUT_STRIDE + homes.length);
  faction.food = output[0]; faction.population = output[1];
  for (let row = 0; row < cities.length; row++) {
    const palace = cities[row].palace, offset = 3 + row * CITY_OUTPUT_STRIDE;
    palace.populationGrowth = output[offset];
    if (output[offset + 1] !== (palace.unhousedResidents ?? 0)) palace.unhousedResidents = output[offset + 1];
    if (output[offset + 2] === 0) delete palace.depopulated;
    else palace.depopulated = output[offset + 2] === 2;
  }
  const housesOffset = 3 + cities.length * CITY_OUTPUT_STRIDE;
  for (let row = 0; row < homes.length; row++)
    if (output[housesOffset + row] !== (homes[row].residents ?? 0)) homes[row].residents = output[housesOffset + row];
  const births = output[2];
  rustEngine.sim_offensive_births(simCore(state).handle, faction.id, births);
  recordCampaignPopulation(state, faction);
  return births;
}
