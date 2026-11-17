import { affiliationBreakdown } from '../game/settlement-bridge';
import { villageTradeQuote } from '../game/village-trade-quote';
import type { VillageAction, VillageDiplomacyStatus } from '../game/villages';
import type { GameState } from '../game/types';
import { villageTradeSummary } from './village-trade-summary';
import { icon } from './icons';

/** Formatting only: every number and availability flag comes from the Rust
 * village status query (settlement_village_status) via villageDiplomacyStatus. */
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const capitalize = (text: string) => text ? text[0].toUpperCase() + text.slice(1) : text;

/** Buttons shown in the popup, in display order. A petition replaces the request. */
export function villageDiplomacyActions(status: VillageDiplomacyStatus): VillageAction[] {
  return ['trade', 'ally', status.petition ? 'petition' : 'confederate', 'war'];
}

export function confederationThresholdText(status: VillageDiplomacyStatus): string {
  return status.petition ? 'Petition received' : `Confederation ${Math.round(status.affiliation)} / ${Math.round(status.acceptThreshold)}`;
}

/** `deferTrade` leaves the caravan estimate for the caller to fill in after the
 * dialog has painted: the estimate plans two paths and can take a frame. */
export function villageDiplomacyMarkup(state: GameState, status: VillageDiplomacyStatus, viewer: number, deferTrade = false): string {
  const village = status.village, factors = affiliationBreakdown(state, village.campId, viewer);
  const relation = status.relation === 'trade' ? 'Trading' : status.relation === 'war' ? 'At war' : capitalize(status.relation);
  const ratePerMinute = Number.isFinite(factors.rate) ? factors.rate * 60 : 0;
  const labels: Record<VillageAction, string> = { trade: 'Establish trade', ally: 'Form alliance', confederate: 'Request confederation', petition: 'Accept petition', war: 'Declare war' };
  const buttons = villageDiplomacyActions(status).map(action => {
    const option = status[action === 'petition' ? 'confederate' : action];
    const price = action === 'petition' || option.cost ? `<span class="upgrade-price">${action === 'petition' ? 0 : Math.ceil(option.cost).toLocaleString('en-US')}${icon('gold')}</span>` : '';
    return `<button id="village-${action}" data-village-diplomacy="${action}" ${option.available ? '' : 'disabled'} title="${escape(option.reason)}">${labels[action]}${price}</button>`;
  }).join('');
  return `<h2 id="dialog-title">${escape(village.name)}</h2>
    <p class="diplomacy-stats">${escape(capitalize(status.stageName))}</p>
    <p class="diplomacy-stats">${relation}${status.relation === 'allied' && status.trading ? ' · Trading' : ''}</p>
    <p class="diplomacy-stats village-affiliation">Affiliation ${Math.round(status.affiliation)} / 100 (${ratePerMinute < 0 ? '−' : '+'}${Math.abs(ratePerMinute).toFixed(1)} / min)</p>
    <p class="diplomacy-stats">Independence ${Math.round(status.independence)} / 100</p>
    <div id="village-trade-comparison" data-village="${village.id}">${deferTrade ? '<p class="village-trade-pending">Estimating caravan route…</p>' : villageTradeSummary(villageTradeQuote(state, village))}</div>
    <div class="dialog-actions">${buttons}<button id="cancel-war">Cancel</button></div>
    <p class="diplomacy-stats village-confederation-threshold">${escape(confederationThresholdText(status))}</p>
    <p id="war-result" role="status"></p>`;
}
