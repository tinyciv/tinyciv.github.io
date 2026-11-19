import './action-tooltips.css';

const selector = '[data-build], [data-action], [data-hotbar-action], .activity-upgrade, [data-leader-learn], .research-node, .research-prioritize, .research-remove, .research-queue-chip';
/** Custom tooltips also work on disabled items and use the game's pixel font. */
export class ActionTooltips {
  private readonly popup = document.createElement('div');
  private active?: HTMLElement;
  // Frame updates re-place the popup only when its item or text changes, or on
  // a slow clock; reading layout every frame forced a synchronous reflow.
  private placed?: { item: HTMLElement; text: string; at: number };
  constructor() {
    this.popup.id = 'action-tooltip'; this.popup.className = 'action-tooltip'; this.popup.hidden = true;
    this.popup.setAttribute('role', 'tooltip'); document.body.append(this.popup);
    document.addEventListener('pointerover', event => {
      const item = event.target instanceof Element ? event.target.closest<HTMLElement>(selector) : null;
      if (item) { this.active = item; this.update(); }
    });
    document.addEventListener('pointerout', event => {
      if (this.active && !(event.relatedTarget instanceof Node && this.active.contains(event.relatedTarget))) this.close();
    });
    document.addEventListener('focusin', event => {
      if (event.target instanceof HTMLElement && event.target.matches(selector)) { this.active = event.target; this.update(); }
    });
    document.addEventListener('focusout', () => this.close());
    document.addEventListener('pointerdown', () => this.close());
    document.addEventListener('keydown', event => { if (event.key === 'Escape') this.close(); });
    window.addEventListener('blur', () => this.close());
  }
  sync(): void {
    for (const item of document.querySelectorAll<HTMLElement>(selector)) this.capture(item);
    this.update();
  }
  private capture(item: HTMLElement): void {
    if (item.title) { item.dataset.tooltip = item.title; item.removeAttribute('title'); }
    const text = item.dataset.tooltip;
    if (text && item.getAttribute('aria-description') !== text) item.setAttribute('aria-description', text);
  }
  private close(): void {
    this.active?.removeAttribute('aria-describedby'); this.active = undefined; this.placed = undefined; this.popup.hidden = true;
  }
  update(): void {
    const item = this.active;
    if (!item) return;
    this.capture(item);
    const text = item.dataset.tooltip, now = performance.now(), placed = this.placed;
    if (placed && placed.item === item && placed.text === text && now - placed.at < 250) return;
    if (!item.isConnected || !item.getClientRects().length || item.closest('[hidden]')) { this.close(); return; }
    if (!text) { this.close(); return; }
    this.placed = { item, text, at: now };
    if (placed?.item !== item || this.popup.textContent !== text) {
      const cost = item.hasAttribute('data-research') ? /(^|\n)Cost: ([^\n]+? Science)(?= ·|$)/.exec(text) : null;
      if (cost) {
        const start = cost.index + cost[1].length + 'Cost: '.length;
        const value = document.createElement('span');
        value.className = 'science-text'; value.textContent = cost[2];
        this.popup.replaceChildren(text.slice(0, start), value, text.slice(start + cost[2].length));
      } else this.popup.textContent = text;
    }
    this.popup.hidden = false; item.setAttribute('aria-describedby', this.popup.id);
    const rect = item.getBoundingClientRect(), width = this.popup.offsetWidth, height = this.popup.offsetHeight;
    this.popup.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, rect.x + rect.width / 2 - width / 2))}px`;
    this.popup.style.top = `${rect.y - height - 8 >= 8 ? rect.y - height - 8 : Math.min(innerHeight - height - 8, rect.bottom + 8)}px`;
  }
}
