import { observationUnitsForViewer } from '../game/observation-visibility';
import { updateFog } from '../game/fog';
import { playerControl, withPlayerFaction } from '../game/player-context';
import type { GameState } from '../game/types';

/** Snapshots and deltas share exactly the same viewer/concealment boundary. */
export function multiplayerView(state: GameState, faction: number): GameState {
  return withPlayerFaction(state, faction, () => {
    updateFog(state, faction);
    const control = playerControl(state, faction);
    return { ...state, units: observationUnitsForViewer(state.units, faction), playerFaction: faction,
      selected: null, selectedType: null, buildMode: null, diplomacy: null,
      armyWarnings: state.armyWarnings?.filter(warning => warning.recipients.includes(faction)),
      victory: state.multiplayer!.winner === faction,
      multiplayer: { ...state.multiplayer!, inputs: {}, controls: { [faction]: { ...control, fog: state.fog } } } };
  });
}
