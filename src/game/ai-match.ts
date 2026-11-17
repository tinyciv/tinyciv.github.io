import { refreshDiplomacy } from './diplomacy';
import { rustEngine } from './rust-engine';
import { simCore } from './sim-handle';
import type { GameState } from './types';

/** Controlled headless combat experiment: normal native war/combat/capture
 * rules. Other actors are neutral; automatic negotiations are disabled. */
export function configureAIMatch(state:GameState,a:number,b:number):void {
  refreshDiplomacy(state);
  if(!rustEngine.sim_diplomacy_match(simCore(state).handle,a,b))throw new Error('AI matches require two active nonhuman factions.');
  refreshDiplomacy(state);
}
