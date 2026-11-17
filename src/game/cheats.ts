import { rustEngine } from './rust-engine';
import { simCore } from './sim-handle';
import { playerFaction } from './player-context';
import { recordIncome } from './resource-income';
import { recordGoldInput } from './gold-ledger';
import type { GameState } from './types';

/** Mirror the native economy command and its ledger receipt. */
export function applyInfiniteGold(state: GameState): void {
  const faction = state.factions.find(faction => faction.id === playerFaction(state));
  if (!faction) return;
  const pointer = rustEngine.sim_cheat_gold_tick(simCore(state).handle, Number(!!state.infiniteGold), Number(!!state.multiplayer), faction.gold);
  const [gold, amount] = new Float64Array(rustEngine.memory.buffer, pointer, 2);
  faction.gold = gold;
  recordIncome(faction, { gold: amount });
  recordGoldInput(state, faction, amount, 'other');
}
