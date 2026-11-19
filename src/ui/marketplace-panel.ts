import { marketPartnerEligible, marketplaceCity } from '../game/marketplace';
import { structuresOf, STRUCTURE_READY } from '../game/structure-index';
import { marketplaceTradeView, type MarketplaceTradeView } from '../game/trade';
import { type Building, type GameState } from '../game/types';
import { icon } from './icons';
import { scienceIcon } from './science-icon';

const number = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
const cityName = (city: Building): string => city.cityName ?? 'Town';

export class MarketplacePanel {
  private readonly select: HTMLSelectElement;
  private readonly apply: HTMLButtonElement;
  private readonly table: HTMLTableElement;
  private readonly city: HTMLElement;
  private readonly route: HTMLElement;
  private readonly eta: HTMLElement;
  private readonly status: HTMLElement;
  private readonly rows: HTMLTableRowElement[];
  private marketId?: number;
  private saved?: number;
  private editing = false;
  private refreshAt = 0;
  private options = '';

  constructor(element: HTMLElement, order: (destination: number | null) => void, redraw: () => void) {
    element.innerHTML = `<label class="marketplace-destination">
      <span>Destination</span><select name="market-destination"></select>
    </label>
    <button class="activity-upgrade marketplace-apply" type="button"><span class="upgrade-label">Set destination</span></button>
    <div class="marketplace-heading"><strong data-market-city></strong><span data-market-eta></span></div>
    <p class="marketplace-status" data-market-status></p>
    <p class="marketplace-route" data-market-route></p>
    <table class="marketplace-yields" aria-label="Trade yields">
      <thead><tr><th scope="col">Yield</th><th scope="col">${icon('gold')} Gold</th><th scope="col">${scienceIcon()} Science</th></tr></thead>
      <tbody>
        <tr><th scope="row">Outbound</th><td></td><td></td></tr>
        <tr><th scope="row">Return</th><td></td><td></td></tr>
        <tr><th scope="row">Per minute</th><td></td><td></td></tr>
        <tr class="marketplace-last"><th scope="row">Last delivery</th><td></td><td></td></tr>
      </tbody>
    </table>`;
    this.select = element.querySelector('select')!;
    this.apply = element.querySelector('button')!;
    this.table = element.querySelector('table')!;
    this.city = element.querySelector('[data-market-city]')!;
    this.route = element.querySelector('[data-market-route]')!;
    this.eta = element.querySelector('[data-market-eta]')!;
    this.status = element.querySelector('[data-market-status]')!;
    this.rows = [...this.table.tBodies[0].rows];
    this.select.onchange = () => { this.editing = true; this.refreshAt = 0; redraw(); };
    this.apply.onclick = () => { this.editing = false; this.refreshAt = 0; order(this.selected() ?? null); };
  }

  reset(): void {
    this.marketId = undefined;
    this.editing = false;
    this.refreshAt = 0;
  }

  private selected(): number | undefined { return this.select.value === '' ? undefined : Number(this.select.value); }

  refresh(state: GameState, market: Building): void {
    const now = performance.now();
    if (market.id === this.marketId && now < this.refreshAt) return;
    this.refreshAt = now + 1000;
    if (market.id !== this.marketId) { this.editing = false; this.marketId = market.id; }
    const city = marketplaceCity(state, market);
    if (!city) { this.reset(); return; }
    this.saved = market.marketTrade?.city === city.id && market.marketTrade.faction === city.faction ? market.marketTrade.destination : undefined;
    const cities = structuresOf(state, undefined, STRUCTURE_READY, 'palace')
      .filter(candidate => marketPartnerEligible(state, city, candidate))
      .sort((a, b) => cityName(a).localeCompare(cityName(b)) || a.id - b.id);
    const items: { id: string; label: string }[] = [{ id: '', label: 'Auto' }];
    for (const destination of cities) items.push({ id: String(destination.id), label: cityName(destination) });
    if (this.saved !== undefined && !cities.some(candidate => candidate.id === this.saved))
      items.push({ id: String(this.saved), label: 'Unavailable' });
    const signature = JSON.stringify(items);
    const draft = this.editing ? this.select.value : String(this.saved ?? '');
    if (signature !== this.options) {
      this.select.replaceChildren(...items.map(item => new Option(item.label, item.id)));
      this.options = signature;
    }
    if (this.select.value !== draft) this.select.value = draft;
    if (this.select.selectedIndex < 0) this.select.value = '';
    const candidate = this.selected();
    const active = marketplaceTradeView(state, market);
    const preview = this.editing && candidate !== undefined && candidate !== this.saved ? marketplaceTradeView(state, market, candidate) : active;
    if (active) this.paint(active, preview, this.editing && candidate !== this.saved);
    this.apply.disabled = candidate === this.saved || candidate !== undefined && preview?.yield === undefined;
  }

  private paint(active: MarketplaceTradeView, preview = active, editing = false): void {
    this.city.textContent = cityName(active.city);
    this.status.textContent = editing ? preview?.yield ? 'Preview' : 'Route blocked' : active.status;
    const activeRoute = active.route;
    const currentPartner = activeRoute ? activeRoute.origin === active.city.id ? activeRoute.partner : activeRoute.origin : undefined;
    this.route.textContent = preview?.partner ? cityName(preview.partner) : '';
    if (active.status === 'Returning before switch' && !editing && currentPartner !== undefined && preview?.partner)
      this.status.textContent = 'Change queued';
    this.eta.textContent = preview?.seconds === undefined ? '' : `ETA ${Math.ceil(preview.seconds)}s`;
    const live = activeRoute?.marketLeg, completed = activeRoute?.lastMarketDelivery;
    const estimate = preview?.yield;
    const returning = activeRoute?.target === (active.reverse ? activeRoute?.partner : activeRoute?.origin);
    const direct = (receipt: NonNullable<typeof live>): number => active.reverse && activeRoute?.partnerFaction !== undefined
      ? receipt.partnerScience : receipt.science;
    const showLeg = !editing && live && activeRoute && preview?.partner?.id === currentPartner;
    const rows = [
      [showLeg && !returning ? live.gold : estimate?.outboundGold, showLeg && !returning ? direct(live) : estimate?.science],
      [showLeg && returning ? live.gold : estimate?.returnGold, showLeg && returning ? direct(live) : estimate?.science],
      [estimate?.goldPerMinute, estimate?.sciencePerMinute],
      [completed?.gold, completed ? direct(completed) : undefined],
    ];
    this.table.hidden = !estimate && !completed && !showLeg;
    this.rows.forEach((row, i) => {
      row.hidden = i === 3 && !completed;
      for (let cell = 0; cell < 2; cell++) {
        const value = rows[i][cell];
        row.cells[cell + 1].textContent = value === undefined ? '—' : number.format(value);
      }
    });
  }
}
