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
    element.setAttribute('role', 'group');
    element.innerHTML = '<img class="research-toolbar-icon" alt=""><strong class="research-toolbar-name"></strong><span class="research-toolbar-eta" aria-hidden="true" hidden></span>';
  }
  refresh(state: GameState): void {
    const status = researchStatus(state, playerFaction(state));
    const label = status.completed ? 'Research complete' : !status.library ? 'Build a library' : RESEARCH_BRANCHES.find(branch => branch.id === status.focus)!.label;
    const inProgress = status.library && !status.completed;
    const paused = inProgress && !status.active;
    const seconds = inProgress && status.rate > 0 ? Math.ceil(Math.max(0, status.required - status.progress) / status.rate) : undefined;
    const signature = JSON.stringify([label, paused, seconds, status.focus, Math.floor(status.progress), status.required]);
    if (signature === this.signature) return; this.signature = signature;
    const image = this.element.querySelector<HTMLImageElement>('img')!;
    if (image.dataset.research !== status.focus) { image.src = researchIconUrl(status.focus); image.dataset.research = status.focus; }
    this.element.querySelector<HTMLElement>('.research-toolbar-name')!.textContent = label;
    const eta = this.element.querySelector<HTMLElement>('.research-toolbar-eta')!;
    eta.hidden = !inProgress;
    eta.textContent = seconds === undefined ? '—' : `${seconds}s`;
    const timing = seconds !== undefined ? ` · ${seconds} game seconds remaining` : inProgress && !paused ? ' · Waiting for Science' : '';
    const progress = inProgress ? ` · ${Math.floor(status.progress)} / ${formatResearchCost(status.required)} Science` : '';
    this.element.title = `${label}${timing}${progress}${paused ? ' · Paused' : ''}`;
    this.element.setAttribute('aria-label', this.element.title);
  }
}
