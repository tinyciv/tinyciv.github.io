import { researchStatus, RESEARCH_BRANCHES } from '../game/research';
import { playerFaction } from '../game/player-context';
import type { GameState } from '../game/types';
import { researchIconUrl } from './research-icons';
import { formatResearchCost } from './research-format';
import './research-toolbar.css';

/** Read-only faction progress; changing research remains a library activity. */
export class ResearchToolbar {
  private signature = '';
  constructor(private readonly element: HTMLElement) {
    element.innerHTML = '<img class="research-toolbar-icon" alt=""><span class="research-toolbar-copy"><strong class="research-toolbar-name"></strong><span class="research-toolbar-track" role="progressbar" aria-label="Current research progress" aria-valuemin="0" aria-valuemax="100"><span></span></span></span><span class="research-toolbar-percent"></span>';
  }
  refresh(state: GameState): void {
    const status = researchStatus(state, playerFaction(state));
    const value = status.completed ? 100 : Math.min(100, Math.floor(status.progress / Math.max(1, status.required) * 100 + 1e-7));
    const label = status.completed ? 'Research complete' : !status.library ? 'Build a library' : RESEARCH_BRANCHES.find(branch => branch.id === status.focus)!.label;
    const paused = status.library && !status.completed && !status.active;
    const signature = JSON.stringify([label, paused, value, status.focus, Math.floor(status.progress), status.required]);
    if (signature === this.signature) return; this.signature = signature;
    const image = this.element.querySelector<HTMLImageElement>('img')!;
    if (image.dataset.research !== status.focus) { image.src = researchIconUrl(status.focus); image.dataset.research = status.focus; }
    this.element.querySelector<HTMLElement>('.research-toolbar-name')!.textContent = label;
    this.element.querySelector<HTMLElement>('.research-toolbar-percent')!.textContent = status.library || status.completed ? `${value}%` : '';
    const track = this.element.querySelector<HTMLElement>('.research-toolbar-track')!;
    track.setAttribute('aria-valuenow', String(value)); track.firstElementChild!.setAttribute('style', `width:${value}%`);
    this.element.classList.toggle('is-inactive', !status.active && !status.completed);
    this.element.title = `${label}${status.library && !status.completed ? ` · ${Math.floor(status.progress)} / ${formatResearchCost(status.required)} Science` : ''}${paused ? ' · Paused' : ''}`;
    this.element.setAttribute('aria-label', this.element.title);
  }
}
