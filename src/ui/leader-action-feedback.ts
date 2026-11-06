import { indexedLeader } from '../game/spatial';
import type { GameState, Point } from '../game/types';
import { playerFaction } from '../game/player-context';

const DISPLAY_MS = 2000;
const FADE_MS = 200;

/** A brief screen-space echo of the last accepted hotbar action. The marker
 * follows the Leader while its lifetime continues independently of game pause. */
export class LeaderActionFeedback {
  private active?: { state: GameState; leaderId: number; expiresAt: number };

  constructor(
    private readonly element: HTMLElement,
    private readonly getState: () => GameState,
    private readonly screenPoint: (point: Point) => Point,
  ) {
    this.clear();
  }

  show(button: HTMLButtonElement, label?: string): void {
    this.clear();
    const state = this.getState(), leader = indexedLeader(state, playerFaction(state));
    const art = button.querySelector<HTMLElement>('.hotbar-art');
    if (!art || state.gameOver || !leader || leader.hp <= 0 || leader.inside) return;

    this.element.append(art.cloneNode(true));
    if (label) {
      const caption = this.element.ownerDocument.createElement('span');
      caption.className = 'leader-action-label';
      caption.textContent = label;
      this.element.append(caption);
    }
    if (button.dataset.slot !== undefined) this.element.dataset.slot = button.dataset.slot;
    const now = performance.now();
    this.active = { state, leaderId: leader.id, expiresAt: now + DISPLAY_MS };
    this.element.hidden = false;
    this.update(now);
  }

  update(now = performance.now()): void {
    const active = this.active;
    if (!active) return;
    const state = this.getState(), leader = indexedLeader(state, playerFaction(state));
    const changedSession = state !== active.state && (!state.multiplayer || state.world !== active.state.world || playerFaction(state) !== playerFaction(active.state));
    if (changedSession || state.gameOver || !leader || leader.id !== active.leaderId
      || leader.hp <= 0 || leader.inside || now >= active.expiresAt) {
      this.clear();
      return;
    }
    const point = this.screenPoint({ x: leader.x, y: leader.y - .8 });
    this.element.style.left = `${point.x}px`;
    this.element.style.top = `${point.y - 6}px`;
    this.element.style.opacity = String(Math.min(1, (active.expiresAt - now) / FADE_MS));
  }

  clear(): void {
    this.active = undefined;
    this.element.hidden = true;
    this.element.replaceChildren();
    delete this.element.dataset.slot;
    this.element.style.removeProperty('opacity');
    this.element.style.removeProperty('left');
    this.element.style.removeProperty('top');
  }
}
