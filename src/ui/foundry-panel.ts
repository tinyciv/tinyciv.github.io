import { convertFieldCannon, fieldCannonCandidates, foundryConversionStatus } from '../game/field-cannons-native';
import { entityStore } from '../game/entity-store';
import { isRetinueMember, type Building, type GameState } from '../game/types';
import type { GameCommand } from '../multiplayer/protocol';
import { icon } from './icons';

export class FoundryPanel {
  private nextRefresh = 0;
  private buildingId = -1;
  private candidates = '';
  constructor(private element: HTMLElement, private getState: () => GameState, private changed: () => void,
    private message: (text: string, error: boolean) => void, private sendCommand?: (command: GameCommand) => boolean) {
    element.innerHTML = `<div class="activity-stack">
      <label class="composition-row"><span>Soldier</span><select aria-label="Soldier to convert"></select></label>
      <button type="button" class="activity-upgrade" data-convert-cannon>${icon('fieldCannon')}<span class="upgrade-label">Convert to field cannon</span></button>
      <p class="activity-note foundry-status"></p></div>`;
    const select = element.querySelector('select')!;
    select.onchange = () => { this.nextRefresh = 0; const b = entityStore(getState()).buildings.get(this.buildingId); if (b) this.refresh(b); };
    element.querySelector<HTMLButtonElement>('[data-convert-cannon]')!.onclick = () => {
      const state = getState(), foundry = entityStore(state).buildings.get(this.buildingId), unit = entityStore(state).units.get(Number(select.value));
      if (!foundry || !unit) return;
      if (sendCommand?.({ type: 'foundry-convert', buildingId: foundry.id, unitId: unit.id })) return;
      const result = convertFieldCannon(state, foundry, unit); message(result.message,!result.ok); this.nextRefresh = 0; this.refresh(foundry); changed();
    };
  }
  refresh(foundry: Building): void {
    if (foundry.id === this.buildingId && performance.now() < this.nextRefresh) return;
    this.nextRefresh = performance.now() + 1000; this.buildingId = foundry.id;
    const state = this.getState(), select = this.element.querySelector('select')!;
    const units = fieldCannonCandidates(state, foundry).filter(isRetinueMember), key = units.map(u => u.id).join(':');
    if (key !== this.candidates || !select.options.length) {
      this.candidates = key; const chosen = select.value; select.replaceChildren();
      if (!units.length) select.add(new Option('No soldiers nearby', ''));
      for (const u of units) select.add(new Option(`${u.name ?? u.kind[0].toUpperCase() + u.kind.slice(1)} · ${u.id}`, String(u.id)));
      if ([...select.options].some(o => o.value === chosen)) select.value = chosen;
    }
    const unit = entityStore(state).units.get(Number(select.value));
    const status = foundryConversionStatus(state, foundry, unit);
    this.element.querySelector<HTMLButtonElement>('[data-convert-cannon]')!.disabled = !status.ok;
    this.element.querySelector<HTMLElement>('.foundry-status')!.textContent = status.message;
  }
}
