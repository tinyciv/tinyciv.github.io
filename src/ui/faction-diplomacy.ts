import { negotiateDiplomacy, diplomacyEventText, diplomaticTechMask, type DiplomacyResult } from '../game/diplomacy';
import { TREATY, diplomaticRelationship, diplomaticSide, emptyDiplomacyTerms, type DiplomaticOffer, type DiplomacyTerms } from '../game/diplomacy-view';
import { RESEARCH_BRANCHES } from '../game/research';
import { playerFaction } from '../game/player-context';
import { buildingReady, type Faction, type GameState, type ResearchBranchId } from '../game/types';
import './faction-diplomacy.css';

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const gold = (n: number) => Math.ceil(n).toLocaleString('en-US');
const remaining = (until: number, now: number) => `${Math.max(0, Math.ceil((until - now) / 60))} min`;
const treatyLabels: readonly [number, string, string][] = [[TREATY.peace, 'Peace', 'Ends combat and protects a three-minute truce.'],
  [TREATY.pact, 'Nonaggression', 'Give 30 seconds’ notice before withdrawing.'],
  [TREATY.trade, 'Trade', 'A shared caravan earns gold on completed deliveries.'],
  [TREATY.access, 'Military access', 'Open gates; construction and ownership rights stay with the owner.'],
  [TREATY.alliance, 'Defensive alliance', 'Shares military sight and access. Respond to attacks on your partner; offensive wars require a separate deal.']];
export function contactedFactions(state: GameState): Faction[] {
  return state.factions.filter(f => f.id !== playerFaction(state) && f.villageId === undefined && !f.defeated && f.relation !== 'confederated'
    && diplomaticRelationship(state, f.id, playerFaction(state))?.contact);
}
function technologyChoices(state: GameState, seller: number, buyer: number, selected: readonly ResearchBranchId[], name: string): string {
  const from = state.factions.find(f => f.id === seller), to = state.factions.find(f => f.id === buyer);
  const transferable = state.diplomacyState?.transferable[seller] ?? 0;
  const choices = RESEARCH_BRANCHES.filter(t => from?.research?.levels[t.id] && !to?.research?.levels[t.id]);
  return `<fieldset class="diplomacy-techs"><legend>Technologies</legend>${choices.length ? choices.map(t => {
    const prerequisites = t.prerequisites.every(id => !!to?.research?.levels[id]);
    const resale = Math.floor(transferable / diplomaticTechMask([t.id])) % 2 === 0;
    const reason = !prerequisites ? 'The recipient needs prerequisite technologies.' : resale ? 'Available for onward trading three minutes after acquisition.' : '';
    return `<label title="${escape(reason)}"><input type="checkbox" name="${name}" value="${t.id}" ${selected.includes(t.id) ? 'checked' : ''} ${reason ? 'disabled' : ''}>${escape(t.label)}</label>`;
  }).join('') : '<span class="diplomacy-muted">None available</span>'}</fieldset>`;
}
function cityChoices(state: GameState, owner: number, previous: number, selected: number, name: string): string {
  const cities = state.buildings.filter(b => b.kind === 'palace' && b.faction === owner && b.previousSovereign === previous && buildingReady(b));
  return cities.length ? `<label>Return captured town<select name="${name}"><option value="-1">None</option>${cities.map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${escape(c.cityName ?? 'Town')}</option>`).join('')}</select></label>` : '';
}
function termsSide(state: GameState, t: DiplomacyTerms, give: boolean): string {
  const techs = give ? t.giveTech : t.getTech, city = give ? t.giveCity : t.getCity;
  const now = give ? t.giveGold : t.getGold, rate = give ? t.giveRate : t.getRate;
  const lines = [now ? `${gold(now)} gold now` : '', rate ? `${gold(rate)} gold / 30s for ${t.duration / 60} min` : '',
    ...techs.map(id => RESEARCH_BRANCHES.find(b => b.id === id)?.label ?? id),
    city >= 0 ? `Return ${state.buildings.find(b => b.id === city)?.cityName ?? 'captured town'}` : ''].filter(Boolean);
  return lines.map(s => `<li>${escape(s)}</li>`).join('') || '<li>—</li>';
}
function offerMarkup(state: GameState, offer: DiplomaticOffer): string {
  const from = state.factions.find(f => f.id === offer.from);
  const treaties = treatyLabels.filter(([flag]) => offer.terms.flags & flag).map(([, label]) => label);
  const enemy = state.factions.find(f => f.id === offer.terms.enemy);
  return `<article class="diplomacy-offer"><strong>${offer.call ? 'Call to arms' : 'Incoming offer'} · ${escape(from?.name ?? 'Faction')}</strong>
    <span class="diplomacy-muted">Expires in ${remaining(offer.expires, state.time)}</span>
    ${offer.call ? `<p>Defend ${escape(from?.name ?? 'your ally')} against ${escape(enemy?.name ?? 'their attacker')}.</p>` : `
    <p>${escape(treaties.join(' · '))}${offer.terms.flags & TREATY.support ? ` · Join war against ${escape(enemy?.name ?? 'enemy')}` : ''} · ${offer.terms.duration / 60} min</p>
    <div class="diplomacy-offer-sides"><div><span>You receive</span><ul>${termsSide(state, offer.terms, true)}</ul></div><div><span>You give</span><ul>${termsSide(state, offer.terms, false)}</ul></div></div>`}
    <div class="diplomacy-inline"><button type="button" data-accept-offer="${offer.id}">Accept</button><button type="button" data-decline-offer="${offer.id}">Decline</button>${offer.call ? '' : `<button type="button" data-counter-offer="${offer.id}">Counteroffer</button>`}</div></article>`;
}
export function factionDiplomacyMarkup(state: GameState, requested?: number, draft?: DiplomacyTerms, message = ''): string {
  const factions = contactedFactions(state), player = playerFaction(state);
  const selected = factions.find(f => f.id === requested) ?? factions[0];
  const incoming = state.diplomacyState?.offers.filter(o => o.to === player) ?? [];
  const navigation = factions.map(f => {
    const p = diplomaticRelationship(state, player, f.id)!;
    const count = incoming.filter(o => o.from === f.id).length;
    return `<button type="button" data-diplomacy-faction="${f.id}" aria-pressed="${selected?.id === f.id}" aria-label="${escape(f.name)}, ${p.war ? 'at war' : p.alliance > state.time ? 'allied' : 'at peace'}${count ? `, ${count} offers` : ''}"><span>${escape(f.name)}</span>${count ? `<span class="diplomacy-offer-count">${count}</span>` : ''}</button>`;
  }).join('');
  if (!selected) return `<div class="diplomacy-menu"><h2 id="dialog-title">Diplomacy</h2><p>No factions contacted.</p></div>`;
  const id = selected.id, pair = diplomaticRelationship(state, player, id)!, side = diplomaticSide(pair, id);
  const terms = draft ?? { ...emptyDiplomacyTerms(), flags: pair.war ? TREATY.peace : 0 };
  const active = [['Truce', pair.truce], ['Nonaggression', pair.pact], ['Trade', pair.trade], ['Military access', pair.access], ['Defensive alliance', pair.alliance]] as const;
  const activeMarkup = active.filter(([, until]) => until > state.time).map(([label, until]) => `<li>${label}<span>${remaining(until, state.time)}</span></li>`).join('');
  const own = state.factions.find(f => f.id === player)!;
  const debts = pair.arrears.map((n, i) => n > 0 ? `<li>${i === diplomaticSide(pair, player) ? 'You owe' : 'They owe'} ${gold(n)} gold<span>${remaining(pair.defaultAt[i], state.time)} to default</span></li>` : '').join('');
  const history = (state.diplomacyState?.history ?? []).filter(h => (h.a === id && h.b === player || h.a === player && h.b === id)).slice(-12).reverse();
  const outgoing = state.diplomacyState?.offers.find(o => o.from === player && o.to === id);
  return `<div class="diplomacy-menu" data-selected-faction="${id}"><h2 id="dialog-title">Diplomacy</h2><div class="diplomacy-layout">
    <nav class="diplomacy-factions" aria-label="Factions">${navigation}</nav><div class="diplomacy-content">
      <header><h3>${escape(selected.name)}</h3><span>${['Mercantile', 'Cautious', 'Expansionist', 'Scholarly'][state.diplomacyState?.personalities[id] ?? 0]} · ${pair.war ? 'At war' : 'At peace'}</span></header>
      <dl class="diplomacy-attitude"><div><dt>Trust</dt><dd>${Math.round(pair.trust[side])}</dd></div><div><dt>Grievances</dt><dd>${Math.round(pair.grievances[side])}</dd></div><div><dt>Affiliation</dt><dd>${Math.round(pair.affiliation[side])}</dd></div></dl>
      ${incoming.filter(o => o.from === id).map(o => offerMarkup(state, o)).join('')}
      ${outgoing ? `<p class="diplomacy-muted">Your offer is awaiting a response.</p>` : ''}
      <details class="diplomacy-treaties" ${activeMarkup || debts ? 'open' : ''}><summary>Treaties & obligations</summary><ul>${activeMarkup || '<li>No active treaties</li>'}${debts}</ul>
      ${pair.paymentEnd > state.time && (pair.giveRate || pair.getRate) ? `<p>You pay ${gold(pair.a === player ? pair.giveRate : pair.getRate)} · Receive ${gold(pair.a === player ? pair.getRate : pair.giveRate)} gold / 30s · ${remaining(pair.paymentEnd, state.time)} remaining</p>` : ''}
      ${activeMarkup ? '<button type="button" id="diplomacy-withdraw" title="Payments remain due through their agreed term. The protected peace truce remains in force.">Give withdrawal notice</button>' : ''}</details>
      ${pair.alliance > state.time ? `<div class="diplomacy-inline"><label>Defend town<select id="diplomacy-defense-city">${state.buildings.filter(b => b.kind === 'palace' && b.faction === player && buildingReady(b)).map(b => `<option value="${b.id}">${escape(b.cityName ?? 'Town')}</option>`).join('')}</select></label><button type="button" id="diplomacy-request-aid">Request defense</button></div>` : ''}
      <form id="diplomacy-deal"><fieldset class="diplomacy-treaty-options"><legend>Agreement</legend>${treatyLabels.filter(([flag]) => flag !== TREATY.peace || pair.war).map(([flag, label, description]) => `<label title="${escape(description)}"><input type="checkbox" name="treaty" value="${flag}" ${terms.flags & flag ? 'checked' : ''}>${label}</label>`).join('')}</fieldset>
      <div class="diplomacy-deal-sides"><fieldset><legend>Your offer</legend><label>Gold now<input type="number" name="giveGold" min="0" max="${Math.floor(own.gold)}" step="1" value="${terms.giveGold}"></label>
      <label>Gold / 30s<input type="number" name="giveRate" min="0" max="1000000" step="1" value="${terms.giveRate}"></label>
      ${technologyChoices(state, player, id, terms.giveTech, 'giveTech')}${cityChoices(state, player, id, terms.giveCity, 'giveCity')}</fieldset>
      <fieldset><legend>Their offer</legend><label>Gold now<input type="number" name="getGold" min="0" max="1000000" step="1" value="${terms.getGold}"></label>
      <label>Gold / 30s<input type="number" name="getRate" min="0" max="1000000" step="1" value="${terms.getRate}"></label>
      ${technologyChoices(state, id, player, terms.getTech, 'getTech')}${cityChoices(state, id, player, terms.getCity, 'getCity')}</fieldset></div>
      <div class="diplomacy-deal-options"><label>Duration<select name="duration">${[120, 180, 300, 600].map(n => `<option value="${n}" ${n === terms.duration ? 'selected' : ''}>${n / 60} min</option>`).join('')}</select></label>
      <label>Ask them to join war against<select name="enemy"><option value="-1">None</option>${factions.filter(f => f.id !== id).map(f => `<option value="${f.id}" ${f.id === terms.enemy ? 'selected' : ''}>${escape(f.name)}</option>`).join('')}</select></label></div>
      <div id="diplomacy-evaluation" role="status"></div><div class="diplomacy-inline"><button type="button" id="diplomacy-review">Review offer</button><button type="submit">Propose deal</button></div></form>
      <div class="diplomacy-inline diplomacy-state-actions">${pair.war ? '' : '<button type="button" id="diplomacy-war">Declare war</button>'}<button type="button" id="diplomacy-confederate" title="Requires peace, trust 75, affiliation 70 and an alliance honored for three game minutes.">Request confederation</button></div>
      <div id="diplomacy-confirmation"></div><p id="diplomacy-result" role="status">${escape(message)}</p>
      <details class="diplomacy-history"><summary>Diplomatic history</summary><ol>${history.map(h => `<li><time>${Math.floor(h.time / 60)}:${String(Math.floor(h.time % 60)).padStart(2, '0')}</time>${escape(diplomacyEventText(state, h))}</li>`).join('') || '<li>No recent events</li>'}</ol></details>
    </div></div></div>`;
}
function readDraft(form: HTMLFormElement): DiplomacyTerms {
  const data = new FormData(form), number = (name: string) => Number(data.get(name) ?? -1);
  return { ...emptyDiplomacyTerms(), flags: data.getAll('treaty').reduce((sum, v) => sum + Number(v), 0) | (number('enemy') >= 0 ? TREATY.support : 0),
    giveGold: number('giveGold'), getGold: number('getGold'), giveRate: number('giveRate'), getRate: number('getRate'), duration: number('duration'),
    giveTech: data.getAll('giveTech') as ResearchBranchId[], getTech: data.getAll('getTech') as ResearchBranchId[],
    giveCity: number('giveCity'), getCity: number('getCity'), enemy: number('enemy') };
}
export function bindFactionDiplomacy(root: HTMLElement, state: GameState, render: (id: number, draft?: DiplomacyTerms, message?: string) => void,
  confederate: (id: number) => { ok: boolean; message: string }, changed: () => void): void {
  const menu = root.querySelector<HTMLElement>('.diplomacy-menu');
  const id = Number(menu?.dataset.selectedFaction); if (!Number.isFinite(id)) return;
  const form = root.querySelector<HTMLFormElement>('#diplomacy-deal')!;
  const result = root.querySelector<HTMLElement>('#diplomacy-result')!;
  root.querySelectorAll<HTMLButtonElement>('[data-diplomacy-faction]').forEach(button => button.onclick = () => render(Number(button.dataset.diplomacyFaction)));
  const finish = (outcome: DiplomacyResult, draft?: DiplomacyTerms) => { changed(); render(id, draft, outcome.message); };
  root.querySelectorAll<HTMLButtonElement>('[data-accept-offer]').forEach(button => button.onclick = () => {
    const response = negotiateDiplomacy(state, id, 'accept', undefined, Number(button.dataset.acceptOffer));
    if (response.error === 12) confirm('Break treaties and answer call', () => finish(negotiateDiplomacy(state, id, 'accept', undefined, Number(button.dataset.acceptOffer), true)));
    else finish(response);
  });
  root.querySelectorAll<HTMLButtonElement>('[data-decline-offer]').forEach(button => button.onclick = () => finish(negotiateDiplomacy(state, id, 'decline', undefined, Number(button.dataset.declineOffer))));
  root.querySelectorAll<HTMLButtonElement>('[data-counter-offer]').forEach(button => button.onclick = () => {
    const t = state.diplomacyState?.offers.find(o => o.id === Number(button.dataset.counterOffer))?.terms;
    if (t) render(id, { ...t, giveGold: t.getGold, getGold: t.giveGold, giveRate: t.getRate, getRate: t.giveRate,
      giveTech: t.getTech, getTech: t.giveTech, giveCity: t.getCity, getCity: t.giveCity, origin: t.destination, destination: t.origin });
  });
  function confirm(label: string, action: () => void): void {
    const slot = root.querySelector<HTMLElement>('#diplomacy-confirmation')!;
    slot.replaceChildren();
    const explanation = document.createElement('p'); explanation.textContent = 'Active treaty commitments will be broken. Other factions will remember the betrayal.';
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.onclick = action;
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.onclick = () => slot.replaceChildren();
    slot.append(explanation, button, cancel); button.focus();
  }
  const review = () => {
    if (!form.reportValidity()) return;
    const response = negotiateDiplomacy(state, id, 'preview', readDraft(form));
    const reasons = [[1, 'They are weary of war.'], [2, 'They believe they have a military advantage.'], [4, 'They value the trade connection.'],
      [8, 'They hold grievances against you.'], [16, 'They distrust your commitments.'], [32, 'You share an enemy.'],
      [64, 'They value their technological advantage.'], [128, 'Future payments are discounted by trust.']] as const;
    root.querySelector<HTMLElement>('#diplomacy-evaluation')!.textContent = [response.ok
      ? response.score >= 0 ? 'They will accept.' : `They want ${gold(response.counterGold)} more gold.` : response.message,
      ...reasons.filter(([flag]) => response.reasons & flag).map(([, text]) => text),
      response.tradeIncome === undefined ? '' : `Trade estimate: ${response.tradeIncome.toFixed(1)} gold each / 30s of land transit, before Science.`].filter(Boolean).join(' ');
  };
  root.querySelector<HTMLButtonElement>('#diplomacy-review')!.onclick = review;
  form.onchange = () => { root.querySelector<HTMLElement>('#diplomacy-evaluation')!.textContent = ''; };
  form.onsubmit = event => { event.preventDefault(); if (form.reportValidity()) finish(negotiateDiplomacy(state, id, 'propose', readDraft(form)), readDraft(form)); };
  const war = root.querySelector<HTMLButtonElement>('#diplomacy-war');
  if (war) war.onclick = () => {
    const response = negotiateDiplomacy(state, id, 'war');
    if (response.error === 12) confirm('Break treaties and declare war', () => finish(negotiateDiplomacy(state, id, 'war', undefined, 0, true)));
    else finish(response);
  };
  const aid = root.querySelector<HTMLButtonElement>('#diplomacy-request-aid');
  if (aid) aid.onclick = () => finish(negotiateDiplomacy(state, id, 'aid', undefined, Number(root.querySelector<HTMLSelectElement>('#diplomacy-defense-city')!.value)));
  const withdraw = root.querySelector<HTMLButtonElement>('#diplomacy-withdraw');
  if (withdraw) withdraw.onclick = () => finish(negotiateDiplomacy(state, id, 'withdraw'));
  root.querySelector<HTMLButtonElement>('#diplomacy-confederate')!.onclick = () => { const response = confederate(id); changed(); render(id, undefined, response.message); };
  // Keep errors in the panel; draft contents survive a refused proposal.
  result.scrollIntoView({ block: 'nearest' });
}
