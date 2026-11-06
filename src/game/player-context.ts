import type { GameState, InputState, PlayerControlState } from './types';

export const playerFaction = (state: GameState): number => state.playerFaction ?? 0;
export const isHumanFaction = (state: GameState, faction: number): boolean =>
  state.multiplayer ? state.multiplayer.humanFactionIds.includes(faction) : faction === 0;
const activeContexts = new WeakMap<GameState, number>();
const NO_INPUT: InputState = { up: false, down: false, left: false, right: false };

export function playerControl(state: GameState, faction = playerFaction(state)): PlayerControlState {
  if (!state.multiplayer) return { retinueStance: state.retinueStance ?? 'aggressive', movementMode: state.movementMode ?? 'travel',
    forbiddenZones: state.forbiddenZones, fog: state.fog };
  return state.multiplayer.controls[faction] ??= { retinueStance: 'aggressive', movementMode: 'travel' };
}
export const playerInput = (state: GameState, faction: number): InputState => state.multiplayer?.inputs[faction] ?? NO_INPUT;
export const movementModeFor = (state: GameState, faction: number): 'travel' | 'formation' =>
  state.multiplayer ? playerControl(state, faction).movementMode : state.movementMode ?? 'travel';
export const retinueStanceFor = (state: GameState, faction: number) =>
  state.multiplayer ? playerControl(state, faction).retinueStance : state.retinueStance ?? 'aggressive';

/** Run one synchronous validated command as its authenticated owner. Context
 * aliases are persisted per human; local selection never becomes a remote order. */
export function withPlayerFaction<T>(state: GameState, faction: number, operation: () => T): T {
  if (!state.multiplayer) {
    const previous = state.playerFaction; state.playerFaction = faction;
    try { return operation(); } finally { state.playerFaction = previous; }
  }
  if (activeContexts.get(state) === faction) return operation();
  const previousContext = activeContexts.get(state); activeContexts.set(state, faction);
  const previous = { playerFaction: state.playerFaction, retinueStance: state.retinueStance, movementMode: state.movementMode,
    forbiddenZones: state.forbiddenZones, fog: state.fog, selected: state.selected, selectedType: state.selectedType,
    buildMode: state.buildMode, diplomacy: state.diplomacy };
  const control = playerControl(state, faction);
  state.playerFaction = faction; state.retinueStance = control.retinueStance; state.movementMode = control.movementMode;
  state.forbiddenZones = control.forbiddenZones; state.fog = control.fog;
  try { return operation(); } finally {
    control.retinueStance = state.retinueStance ?? 'aggressive'; control.movementMode = state.movementMode ?? 'travel';
    control.forbiddenZones = state.forbiddenZones; control.fog = state.fog;
    Object.assign(state, previous);
    if (previousContext === undefined) activeContexts.delete(state); else activeContexts.set(state, previousContext);
  }
}
