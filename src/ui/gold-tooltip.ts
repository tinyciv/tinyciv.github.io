import { goldFlowSummary } from '../game/gold-ledger';
import type { Faction, GameState } from '../game/types';
import './gold-tooltip.css';

let sequence = 0;
const signed = (value: number): string => {
  const rounded = Math.round(Math.abs(value));
  return rounded ? `${value < 0 ? '−' : '+'}${rounded.toLocaleString('en-US')}` : '0';
};

/** The gold ledger is read on demand; opening it never changes the game. */
export class GoldTooltip {
  private readonly element = document.createElement('div');
  private state?: GameState;
  private faction?: Faction;
  private signature = '';
  private anchorHovered = false;
  private tooltipHovered = false;
  private focused = false;
  private closeTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly anchor: HTMLElement) {
    const id = `gold-flow-tooltip-${++sequence}`;
    this.element.id = id; this.element.className = 'gold-flow-tooltip'; this.element.hidden = true;
    this.element.setAttribute('role', 'tooltip');
    this.element.innerHTML = '<header class="gold-flow-header"><strong>Gold</strong><span>Last 60 game seconds</span></header>'
      + '<section class="gold-flow-section is-income"><div class="gold-flow-heading"><span>Inputs</span><strong data-total="inputs">0</strong></div><dl class="gold-flow-rows" data-rows="inputs"></dl></section>'
      + '<section class="gold-flow-section is-outlay"><div class="gold-flow-heading"><span>Outlays</span><strong data-total="outlays">0</strong></div><dl class="gold-flow-rows" data-rows="outlays"></dl></section>'
      + '<div class="gold-flow-net"><span>Net</span><strong data-total="net">0</strong></div>';
    document.body.append(this.element);
    anchor.removeAttribute('title');
    if (anchor.tabIndex < 0) anchor.tabIndex = 0;
    anchor.setAttribute('aria-describedby', [anchor.getAttribute('aria-describedby'), id].filter(Boolean).join(' '));
    anchor.addEventListener('pointerenter', () => { this.anchorHovered = true; this.open(); });
    anchor.addEventListener('pointerleave', () => { this.anchorHovered = false; this.scheduleClose(); });
    anchor.addEventListener('focus', () => { this.focused = true; this.open(); });
    anchor.addEventListener('blur', () => { this.focused = false; this.scheduleClose(); });
    this.element.addEventListener('pointerenter', () => { this.tooltipHovered = true; this.cancelClose(); });
    this.element.addEventListener('pointerleave', () => { this.tooltipHovered = false; this.scheduleClose(); });
    // Hovering or scrolling this overlay must not place or order anything below it.
    for (const name of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel'])
      this.element.addEventListener(name, event => event.stopPropagation());
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || this.element.hidden) return;
      event.preventDefault(); event.stopImmediatePropagation(); this.close();
    }, true);
    window.addEventListener('resize', () => this.position());
    window.addEventListener('blur', () => { this.anchorHovered = false; this.tooltipHovered = false; this.close(); });
  }

  refresh(state: GameState, faction: Faction): void {
    this.state = state; this.faction = faction;
    // Avoid the browser's second, unstyled native tooltip.
    this.anchor.removeAttribute('title');
    this.anchor.setAttribute('aria-label', `${Math.floor(faction.gold).toLocaleString('en-US')} gold. Inputs and outlays over the last 60 game seconds.`);
    if (!this.element.hidden) this.render();
  }

  private cancelClose(): void { if (this.closeTimer) clearTimeout(this.closeTimer); this.closeTimer = undefined; }
  private scheduleClose(): void {
    this.cancelClose();
    this.closeTimer = setTimeout(() => { if (!this.anchorHovered && !this.tooltipHovered && !this.focused) this.close(); }, 120);
  }
  private close(): void { this.cancelClose(); this.element.hidden = true; this.tooltipHovered = false; }
  private open(): void { this.cancelClose(); this.element.hidden = false; this.render(); this.position(); }

  private render(): void {
    if (!this.state || !this.faction) return;
    const summary = goldFlowSummary(this.state, this.faction), signature = JSON.stringify(summary);
    if (signature !== this.signature) {
      this.signature = signature;
      for (const kind of ['inputs', 'outlays'] as const) {
        const list = this.element.querySelector<HTMLElement>(`[data-rows="${kind}"]`)!;
        const fragment = document.createDocumentFragment();
        for (const row of summary[kind]) {
          if (!(row.amount > 0)) continue;
          const wrapper = document.createElement('div'); wrapper.className = 'gold-flow-row'; wrapper.dataset.category = row.category;
          const label = document.createElement('dt'), amount = document.createElement('dd');
          label.textContent = row.label; amount.textContent = signed(kind === 'inputs' ? row.amount : -row.amount);
          wrapper.append(label, amount); fragment.append(wrapper);
        }
        list.replaceChildren(fragment);
      }
      this.element.querySelector<HTMLElement>('[data-total="inputs"]')!.textContent = signed(summary.totalInputs);
      this.element.querySelector<HTMLElement>('[data-total="outlays"]')!.textContent = signed(-summary.totalOutlays);
      const net = this.element.querySelector<HTMLElement>('[data-total="net"]')!;
      net.textContent = signed(summary.net); net.classList.toggle('is-positive', Math.round(summary.net) > 0); net.classList.toggle('is-negative', Math.round(summary.net) < 0);
    }
    this.position();
  }

  private position(): void {
    if (this.element.hidden) return;
    const rect = this.anchor.getBoundingClientRect(), width = window.innerWidth, height = window.innerHeight;
    this.element.style.maxHeight = `${Math.max(70, height - rect.bottom - 14)}px`;
    const left = Math.min(Math.max(8, rect.left), Math.max(8, width - this.element.offsetWidth - 8));
    const top = Math.min(rect.bottom + 6, Math.max(8, height - this.element.offsetHeight - 8));
    this.element.style.left = `${Math.round(left)}px`; this.element.style.top = `${Math.round(top)}px`;
  }
}
