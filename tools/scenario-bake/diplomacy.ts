import { refreshDiplomacy } from '../../src/game/diplomacy';
import { SCENARIOS } from '../../src/game/scenario-content';
import { rustEngine } from '../../src/game/rust-engine';
import { simCore } from '../../src/game/sim-handle';
import type { GameState } from '../../src/game/types';

/** Apply the native starting relationship policy once, during offline authoring. */
export function finalizeScenarioDiplomacy(state: GameState): void {
  const scenario = SCENARIOS.findIndex(entry => entry.id === state.world.scenario);
  if (scenario < 0) throw new Error('Choose a prepared scenario before finalizing diplomacy.');
  // Publish accounts before the native authoring command, then read its result.
  refreshDiplomacy(state);
  if (!rustEngine.sim_scenario_diplomacy(simCore(state).handle, scenario))
    throw new Error('Scenario starting diplomacy could not be initialized.');
  refreshDiplomacy(state);
}
