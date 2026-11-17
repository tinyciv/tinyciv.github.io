import { ACHIEVEMENTS, achievementDefinition, achievementIconUrl, achievementStatus, type AchievementId } from '../game/achievements';
import type { Building, GameState } from '../game/types';
import { wholeNumber } from './number-format';
import './achievement-tree.css';

const PITCH = 280, HEIGHT = 600;
const WIDTH = 240 + Math.max(...ACHIEVEMENTS.map(node => node.column)) * PITCH;
const cultureIcon = () => `<img class="achievement-currency" src="${import.meta.env.BASE_URL}assets/runtime/ui/resources/culture.webp" alt="culture">`;
const text = (element: Element, value: string) => { if (element.textContent !== value) element.textContent = value; };

/** Same framed, horizontally scrollable tree as the library, with explicit
 * culture purchases instead of automatic Science funding. */
export class AchievementTree {
  private inspected: AchievementId = 'superstition';
  private signature = '';
  private state?: GameState;
  private building?: Building;
  private readonly nodes = new Map<AchievementId, HTMLButtonElement>();
  constructor(private readonly element: HTMLElement, private readonly purchase: (id: AchievementId) => void) {
    const edges = ACHIEVEMENTS.flatMap(node => node.prerequisites.map(id => {
      const from = achievementDefinition(id), x = 10 + from.column * PITCH + 220, y = 100 + from.row * 200;
      const endX = 10 + node.column * PITCH, endY = 100 + node.row * 200;
      const path = `M${x} ${y}C${x + 30} ${y} ${endX - 30} ${endY} ${endX} ${endY}`;
      return `<g class="research-edge" data-from="${id}" data-to="${node.id}"><title>${from.label} required for ${node.label}</title><path class="research-edge-halo" d="${path}"/><path class="research-edge-line" d="${path}" marker-end="url(#achievement-arrow)"/></g>`;
    })).join('');
    element.innerHTML = `<div class="achievement-balance"><span>${cultureIcon()}<strong class="achievement-available"></strong> available culture</span><span class="achievement-invested"></span></div>
      <div class="research-tree-scroll" role="region" aria-label="Achievement tree, scroll horizontally" tabindex="0"><div class="research-board achievement-board" style="width:${WIDTH}px">
      <svg class="research-connections" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none" aria-label="Achievement dependencies"><defs><marker id="achievement-arrow" viewBox="0 0 6 8" refX="5" refY="4" markerWidth="5" markerHeight="6" orient="auto"><path d="M0 0L6 4L0 8" fill="none" stroke="context-stroke" stroke-width="1.5"/></marker></defs>${edges}</svg>
      ${ACHIEVEMENTS.map(node => `<button type="button" class="research-node achievement-node" data-achievement="${node.id}" style="left:${10 + node.column * PITCH}px;--achievement-row:${node.row}" aria-pressed="false">
        <span class="research-node-frame"><img class="research-node-icon" src="${achievementIconUrl(node.id)}" alt=""></span>
        <span class="research-node-copy"><strong>${node.label}</strong><span class="research-node-meta"><span class="research-node-price">${node.cost}${cultureIcon()}</span></span></span></button>`).join('')}
      </div></div>
      <section class="research-detail" aria-label="Selected achievement"><img class="research-detail-icon" alt=""><div class="research-detail-copy"><h3 class="research-tech"></h3></div>
      <div class="achievement-purchase-controls"><button type="button" class="research-prioritize achievement-buy">Purchase</button></div></section>`;
    for (const button of element.querySelectorAll<HTMLButtonElement>('[data-achievement]')) {
      const id = button.dataset.achievement as AchievementId;
      this.nodes.set(id, button);
      button.onclick = () => this.inspect(id);
      button.onfocus = () => this.reveal(button);
      button.onkeydown = event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const current = achievementDefinition(id);
        const candidates = ACHIEVEMENTS.filter(node => event.key === 'ArrowLeft' ? node.column < current.column : event.key === 'ArrowRight' ? node.column > current.column
          : node.column === current.column && (event.key === 'ArrowUp' ? node.row < current.row : node.row > current.row));
        candidates.sort((a, b) => Math.abs(a.column - current.column) - Math.abs(b.column - current.column) || Math.abs(a.row - current.row) - Math.abs(b.row - current.row));
        const next = event.key === 'Home' ? ACHIEVEMENTS[0].id : event.key === 'End' ? ACHIEVEMENTS[ACHIEVEMENTS.length - 1].id : candidates[0]?.id;
        if (next) { this.inspect(next); this.nodes.get(next)!.focus({ preventScroll: true }); }
      };
    }
    element.querySelector<HTMLButtonElement>('.achievement-buy')!.onclick = () => this.purchase(this.inspected);
    const scroller = element.querySelector<HTMLElement>('.research-tree-scroll')!;
    scroller.addEventListener('wheel', event => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      if (scroller.scrollHeight > scroller.clientHeight && !event.shiftKey) return;
      event.preventDefault(); scroller.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? scroller.clientWidth : 1);
    }, { passive: false });
  }
  private reveal(button: HTMLElement): void {
    const scroller = this.element.querySelector<HTMLElement>('.research-tree-scroll')!;
    if (button.offsetLeft < scroller.scrollLeft + 6) scroller.scrollLeft = button.offsetLeft - 6;
    else if (button.offsetLeft + button.offsetWidth > scroller.scrollLeft + scroller.clientWidth - 6)
      scroller.scrollLeft = button.offsetLeft + button.offsetWidth - scroller.clientWidth + 6;
    if (button.offsetTop < scroller.scrollTop + 6) scroller.scrollTop = button.offsetTop - 6;
    else if (button.offsetTop + button.offsetHeight > scroller.scrollTop + scroller.clientHeight - 6)
      scroller.scrollTop = button.offsetTop + button.offsetHeight - scroller.clientHeight + 6;
  }
  private inspect(id: AchievementId): void {
    this.inspected = id; this.signature = '';
    if (this.state && this.building) this.refresh(this.state, this.building);
  }
  reset(): void {
    this.inspected = 'superstition'; this.signature = '';
    const scroller = this.element.querySelector('.research-tree-scroll')!;
    scroller.scrollLeft = 0; scroller.scrollTop = 0;
  }
  refresh(state: GameState, building: Building): void {
    this.state = state; this.building = building;
    const faction = state.factions.find(item => item.id === building.faction), selected = achievementDefinition(this.inspected);
    const statuses = new Map(ACHIEVEMENTS.map(node => [node.id, achievementStatus(faction, node.id)]));
    const tech = (faction?.research?.levels.culturalIdentity ?? 0) >= 1;
    const signature = JSON.stringify([this.inspected, Math.floor(faction?.culture ?? 0), faction?.achievements, tech, ...statuses.values()]);
    if (signature === this.signature) return; this.signature = signature;
    text(this.element.querySelector('.achievement-available')!, wholeNumber(Math.floor(faction?.culture ?? 0)));
    text(this.element.querySelector('.achievement-invested')!, `${wholeNumber(faction?.cultureSpent ?? 0)} culture invested`);
    for (const node of ACHIEVEMENTS) {
      const button = this.nodes.get(node.id)!, status = statuses.get(node.id)!;
      const label = status === 1 ? 'Purchased' : status === 2 ? 'Locked' : status === 3 ? 'Save culture' : 'Available';
      button.classList.toggle('is-selected', node.id === this.inspected); button.classList.toggle('is-complete', status === 1); button.classList.toggle('is-locked', status === 2);
      button.setAttribute('aria-pressed', String(node.id === this.inspected));
      button.setAttribute('aria-label', `${node.label}, ${node.cost} culture, ${label}. ${node.description}`);
      button.title = `${node.description} Costs ${node.cost} culture.${node.prerequisites.length ? ` Requires ${node.prerequisites.map(id => achievementDefinition(id).label).join(' and ')}.` : ''}`;
    }
    for (const edge of this.element.querySelectorAll<SVGGElement>('.research-edge')) {
      const from = edge.dataset.from as AchievementId, to = edge.dataset.to as AchievementId;
      edge.classList.toggle('is-open', statuses.get(from) === 1);
      edge.classList.toggle('is-selected', from === this.inspected || to === this.inspected);
    }
    const status = statuses.get(selected.id)!, missing = selected.prerequisites.filter(id => statuses.get(id) !== 1);
    this.element.querySelector<HTMLImageElement>('.research-detail-icon')!.src = achievementIconUrl(selected.id);
    text(this.element.querySelector('.research-tech')!, selected.label);
    const buy = this.element.querySelector<HTMLButtonElement>('.achievement-buy')!;
    buy.disabled = status !== 0 || !tech;
    const purchaseLabel = status === 1 ? 'Purchased' : `Purchase <span class="research-node-price">${selected.cost}${cultureIcon()}</span>`;
    if (buy.innerHTML !== purchaseLabel) buy.innerHTML = purchaseLabel;
    const reason = status === 1 ? 'Permanent faction bonus' : !tech ? 'Research Cultural Identity first' : missing.length ? `Purchase ${missing.map(id => achievementDefinition(id).label).join(' + ')} first`
      : status === 3 ? `${Math.ceil(selected.cost - (faction?.culture ?? 0))} more culture needed` : 'Ready to purchase';
    buy.title = reason;
    buy.setAttribute('aria-label', status === 1 ? 'Purchased' : `Purchase ${selected.label}, ${selected.cost} culture. ${reason}`);
  }
}
