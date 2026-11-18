import { shipyardOrder, shipyardWarship, SHIP_CLASSES, SHIP_LABELS, NAVAL_WEAPONS, WEAPON_LABELS, MARINE_TYPES,
  type NavalLoadout } from '../game/warships-native';
import { researchLevel } from '../game/research';
import type { Building, GameState, NavalWeapon, WarshipClass, MarineType } from '../game/types';
import type { GameCommand } from '../multiplayer/protocol';
import { icon } from './icons';
import './shipyard.css';
const art = (name: string) => `${import.meta.env.BASE_URL}assets/runtime/ui/naval/${name}.webp`;
const marineLabels = { archer: 'Archer marines', musketman: 'Musket marines' };
const weaponArt = { empty: '', ballista: 'ballista', cannon: 'cannon' };
export class ShipyardPanel {
  private yard?: number;
  private draft: NavalLoadout = { class: 'warGalley', marine: 'archer', weapons: ['empty', 'empty', 'empty', 'empty'] };
  private changedDraft = false;
  constructor(private element: HTMLElement, private state: () => GameState, private changed: () => void, private message: (text: string, error: boolean) => void,
    private send?: (command: GameCommand) => boolean) {
    element.innerHTML = `<div class="naval-classes" role="group" aria-label="Warship class">${SHIP_CLASSES.map(c => `<button type="button" data-ship-class="${c}" aria-pressed="false"><img alt="" src="${art(c === 'warGalley' ? 'galley' : c)}"><span>${SHIP_LABELS[c]}</span></button>`).join('')}</div>
      <p class="naval-status"></p>
      <div class="naval-weapons">${Array.from({ length: 4 }, (_, i) => `<fieldset data-mount="${i}"><legend>Mount ${i + 1}</legend><div class="naval-weapon-options" role="group" aria-label="Weapon mount ${i + 1}">${NAVAL_WEAPONS.map(w => `<button type="button" data-weapon="${i}" data-kind="${w}" aria-pressed="false">${w === 'empty' ? '' : `<img alt="" src="${art(weaponArt[w])}">`}<span>${WEAPON_LABELS[w]}</span></button>`).join('')}</div></fieldset>`).join('')}</div>
      <fieldset class="naval-marines"><legend>Marines</legend><div role="group" aria-label="Marine type">${MARINE_TYPES.map(m => `<button type="button" data-marine="${m}" aria-pressed="false">${marineLabels[m]}</button>`).join('')}</div></fieldset>
      <button type="button" class="activity-upgrade" data-naval-build><span class="upgrade-label">Build warship</span><span class="upgrade-price">500${icon('gold')}</span></button>
      <button type="button" class="activity-upgrade" data-naval-refit>Refit warship</button>`;
    element.querySelectorAll<HTMLButtonElement>('[data-ship-class]').forEach(b => b.onclick = () => {
      this.draft.class = b.dataset.shipClass as WarshipClass; this.changedDraft = true;
      for (let i = SHIP_CLASSES.indexOf(this.draft.class) + 2; i < 4; i++) this.draft.weapons[i] = 'empty'; this.refreshCurrent();
    });
    element.querySelectorAll<HTMLButtonElement>('[data-weapon]').forEach(button => button.onclick = () => {
      this.draft.weapons[Number(button.dataset.weapon)] = button.dataset.kind as NavalWeapon;
      this.changedDraft = true; this.refreshCurrent();
    });
    element.querySelectorAll<HTMLButtonElement>('[data-marine]').forEach(button => button.onclick = () => {
      this.draft.marine = button.dataset.marine as MarineType; this.changedDraft = true; this.refreshCurrent();
    });
    for (const refit of [false, true]) element.querySelector<HTMLButtonElement>(refit ? '[data-naval-refit]' : '[data-naval-build]')!.onclick = () => {
      const state = this.state(), yard = state.buildings.find(b => b.id === this.yard); if (!yard) return;
      const loadout = { ...this.draft, weapons: [...this.draft.weapons] };
      if (this.send?.({ type: 'shipyard', buildingId: yard.id, loadout, refit })) return;
      const result = shipyardOrder(state, yard, loadout, refit); this.message(result.message,!result.ok);
      if (result.ok) { this.changedDraft = false; this.changed(); } this.refresh(yard);
    };
  }
  private refreshCurrent(): void { const yard = this.state().buildings.find(b => b.id === this.yard); if (yard) this.refresh(yard); }
  refresh(yard: Building): void {
    const state = this.state(), ship = shipyardWarship(state, yard), faction = state.factions.find(f => f.id === yard.faction);
    if (this.yard !== yard.id || !this.changedDraft && ship?.warship) {
      this.draft = ship?.warship ? { class: ship.warship.class, marine: ship.warship.marine, weapons: [...ship.warship.weapons] }
        : { class: 'warGalley', marine: !researchLevel(faction, 'archeryRange') && researchLevel(faction, 'gunpowder') ? 'musketman' : 'archer', weapons: ['empty', 'empty', 'empty', 'empty'] };
      this.yard = yard.id; this.changedDraft = false;
    }
    this.element.querySelector<HTMLElement>('.naval-status')!.textContent = ship?.warship
      ? `${ship.warship.name} · ${Math.ceil(ship.warship.crewHp / 100)}/8 marines${state.time < ship.warship.readyAt ? ` · Building ${Math.ceil(ship.warship.readyAt - state.time)}s` : ''}${!ship.warship.funded ? ' · Unpaid upkeep' : ''}` : 'Berth available';
    this.element.querySelectorAll<HTMLButtonElement>('[data-ship-class]').forEach(b => {
      const c = b.dataset.shipClass as WarshipClass, locked = c === 'caravel' ? !researchLevel(faction, 'lateenSails') : c === 'frigate' ? !researchLevel(faction, 'navalEngineering') : false;
      b.disabled = locked || !!ship && c !== ship.warship?.class;
      b.title = locked ? c === 'caravel' ? 'Requires Lateen Sails' : 'Requires Naval Engineering'
        : ship && c !== ship.warship?.class ? 'Refitting cannot change the hull class.' : SHIP_LABELS[c];
      b.setAttribute('aria-pressed', String(c === this.draft.class));
    });
    this.element.querySelectorAll<HTMLElement>('[data-mount]').forEach(mount => {
      mount.hidden = Number(mount.dataset.mount) >= SHIP_CLASSES.indexOf(this.draft.class) + 2;
    });
    this.element.querySelectorAll<HTMLButtonElement>('[data-weapon]').forEach(button => {
      const i = Number(button.dataset.weapon), weapon = button.dataset.kind as NavalWeapon;
      const locked = weapon !== 'empty' && (!researchLevel(faction, 'siegeEngines') || weapon === 'cannon' && !researchLevel(faction, 'gunpowder'));
      button.disabled = locked;
      button.title = locked ? weapon === 'cannon' ? 'Requires Siege Engines and Gunpowder' : 'Requires Siege Engines' : WEAPON_LABELS[weapon];
      button.setAttribute('aria-pressed', String((this.draft.weapons[i] ?? 'empty') === weapon));
    });
    this.element.querySelectorAll<HTMLButtonElement>('[data-marine]').forEach(button => {
      const marine = button.dataset.marine as MarineType;
      const technology = marine === 'archer' ? 'archeryRange' : 'gunpowder';
      button.disabled = !researchLevel(faction, technology);
      button.title = button.disabled ? `Requires ${marine === 'archer' ? 'Archery' : 'Gunpowder'}` : marineLabels[marine];
      button.setAttribute('aria-pressed', String(this.draft.marine === marine));
    });
    const build = this.element.querySelector<HTMLButtonElement>('[data-naval-build]')!, refit = this.element.querySelector<HTMLButtonElement>('[data-naval-refit]')!;
    build.hidden = !!ship; build.disabled = (faction?.gold ?? 0) < 500; refit.hidden = !ship;
    build.title = build.disabled ? 'Need 500 gold to build a warship.' : 'Build warship';
    refit.disabled = !!ship && Math.hypot(ship.x - yard.x - 1.5, ship.y - yard.y - 1.5) > 9;
    refit.title = refit.disabled ? 'Return this warship within 9 tiles of its own shipyard.' : '';
  }
}
