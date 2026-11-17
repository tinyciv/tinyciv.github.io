import { rustEngine } from './rust-engine';
import { simCore } from './sim-handle';
import { SCENARIOS } from './scenario-content';
import type { Building, GameState } from './types';

/** Called only while rebuilding a changed palace footprint, never per frame. */
export function scenarioCityClaim(state: GameState, source: Building, radius: number): Float64Array | undefined {
  if (!state.world.scenario || source.kind !== 'palace' || !source.scenarioCity) return;
  const code = SCENARIOS.findIndex(scenario => scenario.id === state.world.scenario);
  const pointer = rustEngine.sim_scenario_city_claim(simCore(state).handle, code, source.x, source.y, radius, state.world.width, state.world.height);
  const count = new Float64Array(rustEngine.memory.buffer, pointer, 1)[0];
  return count ? new Float64Array(rustEngine.memory.buffer, pointer, 5 + count * 2).slice() : undefined;
}
