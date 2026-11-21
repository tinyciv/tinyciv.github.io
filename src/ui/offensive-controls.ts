import { playerFaction } from '../game/player-context';
import { offensiveCooldownMessage } from '../game/offensive-native';
import { researchLevel } from '../game/research';
import type { GameState } from '../game/types';
import { actionTooltip } from './action-tooltips';

export function offensiveControl(state: GameState) {
  const faction = playerFaction(state);
  const unlocked = researchLevel(state.factions.find(candidate => candidate.id === faction), 'officerCorps') > 0;
  const active = state.offensives?.find(order => order.faction === faction && order.phase !== 'captured');
  const leader = state.units.find(unit => unit.faction === faction && unit.kind === 'leader' && unit.hp > 0);
  const reason = !unlocked ? 'Research Officer Corps first.' : state.gameOver ? 'The game has ended.'
    : !leader || leader.inside || leader.embarkedOn !== undefined || leader.boardingBoat !== undefined || leader.order === 'flee'
      ? 'Your Leader must be ready on land.' : offensiveCooldownMessage(state, faction);
  return { unlocked, active, enabled: !!active || !reason, reason };
}

export function updateOffensiveButton(button: HTMLButtonElement, state: GameState, placing = false): void {
  const control = offensiveControl(state);
  button.disabled = !control.enabled;
  button.classList.toggle('research-locked', !control.unlocked);
  button.setAttribute('aria-pressed', String(!!control.active || placing));
  button.setAttribute('aria-label', control.active ? 'End offensive' : 'Offensive');
  button.querySelector<HTMLElement>('.hotbar-label')!.textContent = control.active ? 'End offensive' : 'Offensive';
  button.title = actionTooltip('Sends the retinue in formation from a rally point to an objective.', 0, 0, control.active ? '' : control.reason);
}
