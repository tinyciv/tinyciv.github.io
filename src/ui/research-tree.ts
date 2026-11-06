import { RESEARCH_BRANCHES, researchStatus, type ResearchBranchId, type ResearchStatus } from '../game/research';
import type { Building, GameState } from '../game/types';
import { researchIconUrl } from './research-icons';
import { formatResearchCost } from './research-format';
import { scienceIcon } from './science-icon';
import { RESEARCH_POSITIONS as positions, RESEARCH_COLUMNS, RESEARCH_COLUMN_PITCH, RESEARCH_BOARD_WIDTH, RESEARCH_BOARD_HEIGHT, researchEdgePath, researchNeighbor } from './research-tree-layout';
import './research-tree.css';

const definitions = new Map(RESEARCH_BRANCHES.map(branch => [branch.id, branch]));
const summaries: Partial<Record<ResearchBranchId, string>> = {
  woodenTower: 'Unlocks wooden towers, guard posts and settlement upgrades to Keeps.',
  traditionalMedicine: 'Healers’ shacks triple nearby healing inside your borders.',
  scoutLodge: 'Build Scouts’ Lodges to unlock concealed observation posts.',
  sailing: 'Unlocks docks, exploration galleys and automatic river trade.',
  militaryTactics: 'Train defensive spearmen whose thrusts pierce multiple enemies.',
  infantryDrill: 'Close ranks with stronger frontal combat. Requires eight retinue soldiers.',
  horsebackRiding: 'Stables train fast horsemen with a powerful charging attack.',
  siegeEngines: 'Build long-range ballistae to attack enemy fortifications.',
  supplyTrain: 'Supply carts reach the Leader and heal all friendly units by 10 HP.',
  massLevy: 'Levy one third of your population; 5 gold per soldier every 30 seconds.',
};
const text = (element: HTMLElement, value: string) => { if (element.textContent !== value) element.textContent = value; };
const percentage = (progress: number, required: number) => Math.min(100, Math.floor(progress / Math.max(1, required) * 100 + 1e-7));
export interface ResearchTreeActions {
  allocate: (fraction: number) => void;
  prioritize: (branch: ResearchBranchId) => void;
  remove: (branch: ResearchBranchId) => void;
}

/** Nodes, slider and queue chips keep their DOM identity while research advances. */
export class ResearchTree {
  private inspected: ResearchBranchId | null = null;
  private status?: ResearchStatus;
  private state?: GameState;
  private building?: Building;
  private signature = '';
  private iconsReady = false;
  private editingAllocation = false;
  private pendingAllocation?: { value: number; until: number };
  private readonly nodes = new Map<ResearchBranchId, HTMLButtonElement>();
  private readonly chips = new Map<ResearchBranchId, HTMLButtonElement>();
  private readonly allocation: HTMLInputElement;

  constructor(private readonly element: HTMLElement, private readonly actions: ResearchTreeActions) {
    const edges = RESEARCH_BRANCHES.flatMap(branch => branch.prerequisites.map(prerequisite => {
      const path = researchEdgePath(prerequisite, branch.id);
      return `<g class="research-edge" data-from="${prerequisite}" data-to="${branch.id}"><title>${definitions.get(prerequisite)!.label} required for ${branch.label}</title><path class="research-edge-halo" d="${path}"/><path class="research-edge-line" d="${path}" marker-end="url(#research-arrow)"/></g>`;
    })).sort((a, b) => Number(a.includes('data-to="metalTools"')) - Number(b.includes('data-to="metalTools"'))).join('');
    element.innerHTML = `<div class="research-funding">
      <label for="research-allocation">Gold income to Science <output for="research-allocation" class="research-allocation-value">25%</output></label>
      <input id="research-allocation" name="research-allocation" type="range" min="0" max="100" step="5" value="25" aria-label="Gold income allocated to research">
    </div>
    <div class="research-queue"><span class="research-queue-label">Priorities</span><div class="research-queue-list" aria-label="Research priorities"></div><span class="research-default">Cheapest available first</span></div>
    <div class="research-tree-scroll" aria-label="Technology tree, scroll horizontally"><div class="research-board" style="width:${RESEARCH_BOARD_WIDTH}px">
      <svg class="research-connections" width="${RESEARCH_BOARD_WIDTH}" height="${RESEARCH_BOARD_HEIGHT}" viewBox="0 0 ${RESEARCH_BOARD_WIDTH} ${RESEARCH_BOARD_HEIGHT}" preserveAspectRatio="none" aria-label="Research prerequisites"><defs><marker id="research-arrow" viewBox="0 0 6 8" refX="5" refY="4" markerWidth="5" markerHeight="6" orient="auto"><path d="M0 0L6 4L0 8" fill="none" stroke="context-stroke" stroke-width="1.5"/></marker></defs>${edges}</svg>
      ${RESEARCH_COLUMNS.flat().filter((id): id is ResearchBranchId => !!id).map(id => {
        const branch = definitions.get(id)!, position = positions.get(id)!;
        return `<button type="button" class="research-node" data-research="${id}" style="left:${10 + position.x * RESEARCH_COLUMN_PITCH}px;--research-row:${position.y}" aria-pressed="false">
          <span class="research-node-frame"><img class="research-node-icon" alt=""><span class="research-node-badge" aria-hidden="true"></span></span>
          <span class="research-node-copy"><strong>${branch.label}</strong><span class="research-node-meta"><span class="research-node-price"><span class="research-cost-number"></span>${scienceIcon()}</span><span class="research-node-state"></span></span></span>
          <span class="research-node-progress" aria-hidden="true" hidden><span></span></span></button>`;
      }).join('')}
    </div></div>
      <section class="research-detail" aria-label="Selected technology">
        <img class="research-detail-icon" alt=""><div class="research-detail-copy"><h3 class="research-tech"></h3><p class="research-effect"></p><p class="research-requirement"></p><p class="research-plan"></p></div>
        <div class="research-detail-controls">
        <div class="research-priority-actions"><button type="button" class="research-prioritize">Prioritize</button><button type="button" class="research-remove" hidden>Remove priority</button></div>
        <progress class="research-progress" aria-label="Selected technology progress" max="100" value="0"></progress>
        <div class="research-status"><span class="research-activity"><span class="research-activity-number"></span>${scienceIcon()}</span><span class="research-percentage"></span></div>
        </div>
      </section>`;
    const scroller = element.querySelector<HTMLElement>('.research-tree-scroll')!;
    scroller.addEventListener('wheel', event => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      event.preventDefault(); scroller.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? scroller.clientWidth : 1);
    }, { passive: false });
    this.allocation = element.querySelector<HTMLInputElement>('[name="research-allocation"]')!;
    this.allocation.onpointerdown = () => { this.editingAllocation = true; };
    this.allocation.oninput = () => { this.editingAllocation = true; this.showAllocation(Number(this.allocation.value)); };
    this.allocation.onchange = () => this.commitAllocation();
    this.allocation.onblur = () => { if (this.editingAllocation) this.commitAllocation(); };
    this.allocation.onpointercancel = () => { this.editingAllocation = false; this.refreshCurrent(); };
    const queue = element.querySelector<HTMLElement>('.research-queue-list')!;
    for (const button of element.querySelectorAll<HTMLButtonElement>('[data-research]')) {
      const id = button.dataset.research as ResearchBranchId; this.nodes.set(id, button);
      button.onclick = () => this.inspect(id);
      button.onfocus = () => this.reveal(button);
      const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'research-queue-chip';
      chip.dataset.priority = id; chip.hidden = true; chip.onclick = () => this.inspect(id); this.chips.set(id, chip); queue.append(chip);
      button.onkeydown = event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const next = researchNeighbor(id, event.key);
        this.nodes.get(next!)?.focus({ preventScroll: true });
      };
    }
    element.querySelector<HTMLButtonElement>('.research-prioritize')!.onclick = () => { if (this.status) this.actions.prioritize(this.inspected ?? this.status.focus); };
    element.querySelector<HTMLButtonElement>('.research-remove')!.onclick = () => { if (this.status) this.actions.remove(this.inspected ?? this.status.focus); };
  }

  private reveal(button: HTMLElement): void {
    const scroller = this.element.querySelector<HTMLElement>('.research-tree-scroll')!;
    const left = button.offsetLeft, right = left + button.offsetWidth;
    if (left < scroller.scrollLeft + 6) scroller.scrollLeft = left - 6;
    else if (right > scroller.scrollLeft + scroller.clientWidth - 6) scroller.scrollLeft = right - scroller.clientWidth + 6;
  }
  private inspect(id: ResearchBranchId): void { this.inspected = id; this.signature = ''; this.refreshCurrent(); }
  private refreshCurrent(): void { if (this.state && this.building) this.refresh(this.state, this.building); }
  private showAllocation(value: number): void {
    text(this.element.querySelector<HTMLElement>('.research-allocation-value')!, `${value}%`);
    this.allocation.style.setProperty('--allocation', `${value}%`);
    this.allocation.setAttribute('aria-valuetext', `${value}% of gold income to Science`);
  }
  private commitAllocation(): void {
    const value = Number(this.allocation.value); this.editingAllocation = false;
    this.pendingAllocation = { value, until: performance.now() + 1500 };
    this.actions.allocate(value / 100); this.refreshCurrent();
  }
  reset(): void { this.inspected = null; this.signature = ''; this.editingAllocation = false; this.pendingAllocation = undefined; }

  refresh(state: GameState, building: Building): void {
    this.state = state; this.building = building;
    const status = this.status = researchStatus(state, building.faction), allocation = Math.round(status.allocation * 100);
    if (this.pendingAllocation && (this.pendingAllocation.value === allocation || performance.now() >= this.pendingAllocation.until)) this.pendingAllocation = undefined;
    if (!this.editingAllocation) { this.allocation.value = String(this.pendingAllocation?.value ?? allocation); this.showAllocation(Number(this.allocation.value)); }
    const selected = this.inspected ?? status.focus;
    const signature = JSON.stringify([selected, status.focus, status.active, state.paused, status.allocation, status.priorities,
      status.branches.map(branch => [branch.id, branch.complete, Math.floor(branch.progress), percentage(branch.progress, branch.required), branch.required])]);
    if (signature === this.signature) return; this.signature = signature;
    if (!this.iconsReady) { for (const [id, button] of this.nodes) button.querySelector<HTMLImageElement>('img')!.src = researchIconUrl(id); this.iconsReady = true; }
    for (const branch of status.branches) {
      const button = this.nodes.get(branch.id); if (!button) continue;
      const missing = branch.prerequisites.filter(id => !status.branches.find(item => item.id === id)?.complete);
      const percent = percentage(branch.progress, branch.required), priority = status.priorities.indexOf(branch.id);
      const current = !branch.complete && status.focus === branch.id;
      const label = branch.complete ? 'Complete' : current ? `${state.paused || !status.active ? 'Paused' : 'Researching'} · ${percent}%`
        : priority >= 0 ? `Priority ${priority + 1}` : missing.length ? 'Prerequisites first' : 'Available';
      button.classList.toggle('is-selected', selected === branch.id); button.classList.toggle('is-complete', branch.complete);
      button.classList.toggle('is-locked', !!missing.length); button.classList.toggle('is-current', current); button.classList.toggle('is-priority', priority >= 0);
      button.setAttribute('aria-pressed', String(selected === branch.id));
      const requirement = branch.prerequisites.length ? `Requires ${branch.prerequisites.map(id => definitions.get(id)!.label).join(' and ')}. ` : '';
      button.title = `${branch.label} · ${formatResearchCost(branch.required)} Science. ${requirement}${definitions.get(branch.id)!.tiers[0].description}`;
      button.setAttribute('aria-label', `${branch.label}, ${formatResearchCost(branch.required)} Science, ${label}. ${requirement}`);
      text(button.querySelector<HTMLElement>('.research-cost-number')!, formatResearchCost(branch.required));
      button.querySelector<HTMLElement>('.research-node-price')!.setAttribute('aria-label', `${formatResearchCost(branch.required)} Science`);
      text(button.querySelector<HTMLElement>('.research-node-state')!, branch.complete || current || priority >= 0 ? label : '');
      const bar = button.querySelector<HTMLElement>('.research-node-progress')!; bar.hidden = branch.complete || (!current && branch.progress <= 0);
      bar.firstElementChild!.setAttribute('style', `width:${percent}%`);
      const chip = this.chips.get(branch.id)!; chip.hidden = priority < 0; chip.style.order = String(priority);
      text(chip, `${priority + 1}. ${branch.label}`); chip.classList.toggle('is-selected', selected === branch.id);
      chip.title = `Priority ${priority + 1}: ${branch.label}. Select to change priority.`;
    }
    this.element.querySelector<HTMLElement>('.research-default')!.hidden = status.priorities.length > 0;
    for (const edge of this.element.querySelectorAll<SVGGElement>('.research-edge')) {
      const from = edge.dataset.from as ResearchBranchId, to = edge.dataset.to as ResearchBranchId;
      edge.classList.toggle('is-open', !!status.branches.find(branch => branch.id === from)?.complete);
      edge.classList.toggle('is-selected', selected === from || selected === to);
    }
    const branch = status.branches.find(branch => branch.id === selected)!, priority = status.priorities.indexOf(selected);
    const missing = branch.prerequisites.filter(id => !status.branches.find(item => item.id === id)?.complete);
    const detailIcon = this.element.querySelector<HTMLImageElement>('.research-detail-icon')!;
    if (detailIcon.dataset.research !== selected) { detailIcon.src = researchIconUrl(selected); detailIcon.dataset.research = selected; }
    text(this.element.querySelector<HTMLElement>('.research-tech')!, branch.label);
    const effect = this.element.querySelector<HTMLElement>('.research-effect')!;
    text(effect, summaries[selected] ?? definitions.get(selected)!.tiers[0].description);
    effect.title = definitions.get(selected)!.tiers[0].description;
    const requirement = this.element.querySelector<HTMLElement>('.research-requirement')!;
    text(requirement, missing.length ? `Requires ${missing.map(id => definitions.get(id)!.label).join(' + ')}` : ''); requirement.hidden = !missing.length;
    const plan = this.element.querySelector<HTMLElement>('.research-plan')!;
    text(plan, branch.complete ? '' : priority === 0 && status.focus !== selected ? `${definitions.get(status.focus)!.label} first`
      : missing.length ? 'Prerequisites included automatically' : '');
    plan.hidden = !plan.textContent;
    const prioritize = this.element.querySelector<HTMLButtonElement>('.research-prioritize')!, remove = this.element.querySelector<HTMLButtonElement>('.research-remove')!;
    prioritize.hidden = branch.complete; prioritize.disabled = priority === 0;
    text(prioritize, priority === 0 ? 'First priority' : priority > 0 ? 'Make first priority' : 'Prioritize'); remove.hidden = priority < 0 || branch.complete;
    const progress = this.element.querySelector<HTMLProgressElement>('.research-progress')!, percent = branch.complete ? 100 : percentage(branch.progress, branch.required);
    progress.value = percent; progress.setAttribute('aria-valuetext', `${Math.floor(branch.progress)} of ${formatResearchCost(branch.required)} Science`);
    text(this.element.querySelector<HTMLElement>('.research-percentage')!, `${percent}%`);
    text(this.element.querySelector<HTMLElement>('.research-activity-number')!, branch.complete ? 'Complete' : `${Math.floor(branch.progress)} / ${formatResearchCost(branch.required)}`);
    this.element.querySelector<SVGElement>('.research-activity .science-icon')!.style.display = branch.complete ? 'none' : '';
    this.element.querySelector<HTMLElement>('.research-activity')!.setAttribute('aria-label', branch.complete ? 'Complete' : `${Math.floor(branch.progress)} of ${formatResearchCost(branch.required)} Science`);
  }
}
