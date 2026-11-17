import { rustEngine } from './rust-engine';
import { SimSlot, simCore } from './sim-handle';
import { entityStore } from './entity-store';
import { presentationFog, buildingInSight, pointInSight, invalidateFog } from './fog';
import { observationPostVisibleTo } from './observation-visibility';
import { nearbyUnits } from './spatial';
import { structuresOf, STRUCTURE_READY } from './structure-index';
import { cityResidents } from './cities';
import { structureChangeRevision } from './simulation-reads';
import { cityOwnership } from './city-ownership';
import { RESEARCH_BRANCHES, researchCost, receiveDiplomaticTechnology } from './research';
import { nativeResearchIndex } from './research-native';
import { recordGoldInput, spendGold } from './gold-ledger';
import { recordCampaignPopulation } from './campaign-stats';
import { invalidateNavigation } from './pathfinding';
import { invalidateSettlementDecisions } from './settlement-decisions';
import { invalidateFactionStrategies } from './faction-strategy';
import { civAffiliation, settlements } from './settlement-bridge';
import { findFactionTradeEndpoints, factionTradeIncomeEstimate, updateTradeRoutes } from './trade';
import { invalidateCityTransfer, resetOrders, settlementHost } from './settlement-transfer';
import { applyDefenseResearch } from './defense-research';
import { isHumanFaction, playerFaction } from './player-context';
import { TREATY, diplomaticRelationship, emptyDiplomacyTerms, type DiplomaticHistory, type DiplomaticOffer,
  type DiplomaticRelationship, type DiplomacySnapshot, type DiplomacyTerms } from './diplomacy-view';
import { buildingReady, type Building, type GameState, type ResearchBranchId, type Unit } from './types';

const PAIR = 36, OFFER = 19, HEADER = 10;
const bridges = new SimSlot<DiplomacyBridge>();
const militaryTechnologies = new Set<ResearchBranchId>(['woodenTower', 'wall', 'blacksmith', 'archeryRange', 'reinforcedDefenses',
  'metalCasting', 'fletching', 'militaryTactics', 'infantryDrill', 'siegeEngines', 'horsebackRiding', 'compoundBow', 'stirrups', 'massLevy', 'urbanMilitia', 'gunpowder']);
type Sight = (state: GameState, observer: Unit | Building, target: Unit | Building) => boolean;
let sight: Sight = () => false;
export function registerDiplomacySight(value: Sight): void { sight = value; }
export const diplomaticTechMask = (ids: readonly ResearchBranchId[]): number => ids.reduce((mask, id) => mask + 2 ** nativeResearchIndex(id), 0);
const technologiesFromMask = (mask: number): ResearchBranchId[] => RESEARCH_BRANCHES.filter((_, i) => Math.floor(mask / 2 ** i) % 2 === 1).map(t => t.id);
function writeTerms(t: DiplomacyTerms): number[] {
  return [t.flags, t.giveGold, t.getGold, t.giveRate, t.getRate, t.duration, diplomaticTechMask(t.giveTech), diplomaticTechMask(t.getTech),
    t.giveCity, t.getCity, t.enemy, t.origin, t.destination];
}
function readTerms(r: Float64Array): DiplomacyTerms {
  return { flags: r[0], giveGold: r[1], getGold: r[2], giveRate: r[3], getRate: r[4], duration: r[5], giveTech: technologiesFromMask(r[6]),
    getTech: technologiesFromMask(r[7]), giveCity: r[8], getCity: r[9], enemy: r[10], origin: r[11], destination: r[12] };
}
const errors = ['', 'This faction is no longer available for negotiations.', 'Establish contact first.', 'One faction cannot afford the offered gold. Reduce the amount given or requested.',
  'Choose completed technologies the recipient does not know.', 'The recipient needs all technology prerequisites.',
  'The recipient needs a completed library.', 'An acquired technology cannot be traded onward for three game minutes.',
  'Include peace before negotiating other terms during war.', 'No reachable trade connection is available.',
  'This offer has expired or was replaced.', 'They refuse these terms.', 'This breaks an active treaty. Confirm the declaration to continue.',
  'They need greater trust before making this commitment.', 'Their affiliation must reach 70.',
  'Confederation requires an alliance honored for three game minutes.', 'Only captured towns can be returned to their previous sovereign.', 'Add something to the offer.'];
export interface DiplomacyResult { ok: boolean; error: number; message: string; score: number; reasons: number; counterGold: number; tradeIncome?: number }
export type DiplomacyCommand = 'preview' | 'propose' | 'accept' | 'decline' | 'war' | 'withdraw' | 'confederate' | 'aid';
const commandModes: Record<DiplomacyCommand, number> = { preview: 0, propose: 1, accept: 2, decline: 3, war: 4, withdraw: 5, confederate: 6, aid: 7 };

class DiplomacyBridge {
  readonly handle: number;
  nextStep = -Infinity;
  private sampledAt = -Infinity;
  private sampledStructure = -1;
  private sampledMembership = -1;
  private observationCursor = 0;
  private publishedAt = -Infinity;
  private observations: number[] = [];
  private cityRows: number[] = [];
  private summaries = new Map<number, { cities: number; power: number; library: boolean }>();
  private routes = new Map<string, { at: number; origin: number; destination: number }>();
  private routeCursor = 0;
  constructor(readonly state: GameState) { this.handle = simCore(state).handle; }
  route(a: number, b: number, force = false): { origin: number; destination: number } {
    const low = Math.min(a, b), high = Math.max(a, b), key = `${low}:${high}`;
    let cached = this.routes.get(key);
    if (!cached || force || this.state.time >= cached.at + 30) {
      const connection = findFactionTradeEndpoints(this.state, high, low);
      cached = { at: this.state.time, origin: connection?.origin.id ?? -1, destination: connection?.partner.id ?? -1 };
      this.routes.set(key, cached);
    }
    return a === low ? cached : { origin: cached.destination, destination: cached.origin };
  }
  private sample(): void {
    const state = this.state, store = entityStore(state);
    const factions = state.factions.filter(f => f.villageId === undefined);
    const cities = store.buildings.query('palace').filter(buildingReady);
    const soldiers = [...store.units.query('soldier'), ...store.units.query('leader')].filter(u => u.hp > 0 && !u.inside);
    const populations = new Map(cityResidents(state).map(row => [row.palace.id, row.population]));
    this.cityRows = cities.filter(c => factions.some(f => f.id === c.faction))
      .flatMap(c => [c.id, c.faction, c.previousSovereign ?? -1, populations.get(c.id) ?? 0, c.x, c.y, c.lastAttacked ?? -1e9]);
    this.summaries.clear();
    for (const f of factions) this.summaries.set(f.id, { cities: cities.filter(c => c.faction === f.id).length,
      power: soldiers.filter(u => u.faction === f.id).reduce((sum, u) => sum + u.hp, 0),
      library: structuresOf(state, f.id, STRUCTURE_READY, 'library').length > 0 });
    // One route candidate per five-second sample bounds expensive route work.
    const pairs = factions.flatMap((f, i) => factions.slice(i + 1).map(g => [f.id, g.id]));
    if (pairs.length) {
      const [a, b] = pairs[this.routeCursor++ % pairs.length];
      if (diplomaticRelationship(state, a, b)?.contact) this.route(a, b);
    }
    this.observations = [];
    const observers = cities.concat(structuresOf(state, undefined, STRUCTURE_READY, 'tower', 'woodenTower'));
    const fog = presentationFog(state);
    for (const f of factions) {
      const seen = new Set<Unit>();
      const sites = observers.filter(b => b.faction === f.id);
      // Inspect at most eight static sources per faction per sample, rotating
      // fairly. Leaders always contribute. Candidate queries use the existing
      // unit spatial index during simulation updates.
      const sourceOffset = sites.length ? this.observationCursor % sites.length : 0;
      const sources: (Unit | Building)[] = [...store.units.query('leader').filter(u => u.faction === f.id && u.hp > 0 && !u.inside),
        ...sites.slice(sourceOffset, sourceOffset + 8), ...sites.slice(0, Math.max(0, sourceOffset + 8 - sites.length))];
      if (isHumanFaction(state, f.id)) {
        for (const target of soldiers) if (target.faction !== f.id && pointInSight(fog, target.x, target.y)) seen.add(target);
      } else for (const source of sources) {
        for (const target of nearbyUnits(state, source, 24)) {
          if (target.faction === f.id || target.faction < 0 || target.hp <= 0 || target.inside || target.attack <= 0 || seen.has(target)
            || Math.hypot(source.x - target.x, source.y - target.y) > 24) continue;
          if (sight(state, source, target)) seen.add(target);
        }
      }
      const visiblePower = new Map<number, number>();
      for (const u of seen) visiblePower.set(u.faction, (visiblePower.get(u.faction) ?? 0) + u.hp);
      for (const g of factions) if (f !== g) {
        const visibleCities = cities.filter(c => c.faction === g.id && (isHumanFaction(state, f.id)
          ? buildingInSight(fog, c) : sources.some(source => Math.hypot(source.x - c.x, source.y - c.y) <= 24 && sight(state, source, c))));
        const contact = visibleCities.length > 0 || visiblePower.has(g.id) || isHumanFaction(state, f.id)
          && structuresOf(state, g.id, STRUCTURE_READY, 'house', 'library', 'blacksmith', 'dock').some(b => buildingInSight(fog, b));
        const old = diplomaticRelationship(state, f.id, g.id), known = !!old?.contact || contact;
        const route = this.routes.get(`${Math.min(f.id, g.id)}:${Math.max(f.id, g.id)}`);
        const commonEnemies = factions.filter(h => h !== f && h !== g
          && diplomaticRelationship(state, f.id, h.id)?.war && diplomaticRelationship(state, g.id, h.id)?.war).length;
        this.observations.push(f.id, g.id, Number(contact), visiblePower.get(g.id) ?? -1,
          visibleCities.length, known ? civAffiliation(state, f.id, g.id) : 0, commonEnemies, route?.origin ?? -1, route?.destination ?? -1);
      }
    }
    this.observationCursor += 8;
    this.sampledStructure = structureChangeRevision(state);
    this.sampledMembership = store.buildings.revision;
    this.sampledAt = state.time;
  }
  sync(force = false): void {
    const state = this.state;
    if (state.time < this.sampledAt || state.time >= this.sampledAt + 5 || force && (state.time !== this.sampledAt
      || this.sampledStructure !== structureChangeRevision(state) || this.sampledMembership !== entityStore(state).buildings.revision)) this.sample();
    // Endpoint queries can finish while the simulation is paused; publish that
    // route result without repeating observation or pathfinding work.
    for (let o = 0; o < this.observations.length; o += 9) {
      const a = this.observations[o], b = this.observations[o + 1];
      const route = this.routes.get(`${Math.min(a, b)}:${Math.max(a, b)}`);
      this.observations[o + 7] = route?.origin ?? -1; this.observations[o + 8] = route?.destination ?? -1;
    }
    if (force) {
      const fog = presentationFog(state), player = playerFaction(state), store = entityStore(state);
      for (let o = 0; o < this.observations.length; o += 9) {
        const target = this.observations[o + 1];
        if (this.observations[o] !== player || this.observations[o + 2]) continue;
        if (structuresOf(state, target, STRUCTURE_READY).some(b => buildingInSight(fog, b))
          || store.units.query('unit').some(u => u.faction === target && u.hp > 0 && !u.inside
            && observationPostVisibleTo(u, player) && pointInSight(fog, u.x, u.y))) this.observations[o + 2] = 1;
      }
    }
    const factions = state.factions.filter(f => f.villageId === undefined);
    const values = [factions.length, RESEARCH_BRANCHES.length, this.observations.length / 9, this.cityRows.length / 7];
    for (const branch of RESEARCH_BRANCHES) values.push(researchCost(undefined, branch.id, state),
      diplomaticTechMask(branch.prerequisites), Number(militaryTechnologies.has(branch.id)));
    for (const f of factions) {
      const summary = this.summaries.get(f.id);
      const known = RESEARCH_BRANCHES.reduce((mask, branch, i) => mask + (f.research?.levels[branch.id] ? 2 ** i : 0), 0);
      values.push(f.id, Number(isHumanFaction(state, f.id)), Number(!f.defeated && f.relation !== 'confederated'), f.gold, f.population,
        summary?.cities ?? 0, summary?.power ?? 0, Number(summary?.library), known, Number(f.relation === 'war'), 0, 0);
      for (const branch of RESEARCH_BRANCHES) values.push(Math.max(0, researchCost(f, branch.id, state) - (f.research?.progress[branch.id] ?? 0)));
    }
    values.push(...this.observations, ...this.cityRows);
    const pointer = rustEngine.sim_diplomacy_input(this.handle, values.length);
    new Float64Array(rustEngine.memory.buffer, pointer, values.length).set(values);
    rustEngine.sim_diplomacy_sync(this.handle, state.time);
  }
  command(command: DiplomacyCommand, target: number, terms: DiplomacyTerms, offer: number, confirmed: boolean): DiplomacyResult {
    this.sync(true);
    if (command === 'propose' || command === 'preview') {
      if (terms.flags & TREATY.trade) {
        const route = this.route(playerFaction(this.state), target);
        terms = { ...terms, origin: route.origin, destination: route.destination };
        // Publish the validated endpoint pair before asking Rust to accept it.
        this.sync(true);
      }
      const values = writeTerms(terms), pointer = rustEngine.sim_diplomacy_input(this.handle, values.length);
      new Float64Array(rustEngine.memory.buffer, pointer, values.length).set(values);
    }
    const result = this.publish(rustEngine.sim_diplomacy_command(this.handle, commandModes[command], playerFaction(this.state), target, offer, Number(confirmed)), command);
    if (terms.flags & TREATY.trade && terms.origin >= 0 && terms.destination >= 0) {
      const store = entityStore(this.state), origin = store.buildings.get(terms.origin), partner = store.buildings.get(terms.destination);
      if (origin && partner) result.tradeIncome = factionTradeIncomeEstimate(this.state, origin, partner);
    }
    return result;
  }
  step(): void { this.sync(); this.publish(rustEngine.sim_diplomacy_step(this.handle, this.state.time)); }
  private publish(pointer: number, command?: DiplomacyCommand): DiplomacyResult {
    const state = this.state, header = new Float64Array(rustEngine.memory.buffer, pointer, HEADER).slice();
    const [error, score, reasons, counterGold, revision, pairCount, offerCount, eventCount, historyCount, accountCount] = header;
    const values = new Float64Array(rustEngine.memory.buffer, pointer,
      HEADER + pairCount * PAIR + offerCount * OFFER + eventCount * 5 + historyCount * 6 + accountCount * 6).slice();
    let offset = HEADER;
    const relationships: DiplomaticRelationship[] = [], offers: DiplomaticOffer[] = [], history: DiplomaticHistory[] = [];
    for (let i = 0; i < pairCount; i++, offset += PAIR) {
      const r = values.subarray(offset, offset + PAIR);
      relationships.push({ a: r[0], b: r[1], contact: !!r[2], war: !!r[3], since: r[4], truce: r[5], pact: r[6], trade: r[7], access: r[8], alliance: r[9], withdrawal: r[10],
        trust: [r[11], r[12]], grievances: [r[13], r[14]], interest: [r[15], r[16]], affiliation: [r[17], r[18]], observedPower: [r[19], r[20]],
        observedCities: [r[21], r[22]], origin: r[23], destination: r[24], giveRate: r[25], getRate: r[26], paymentAt: r[27], paymentEnd: r[28],
        arrears: [r[29], r[30]], defaultAt: [r[31], r[32]], honored: r[33] });
    }
    for (let i = 0; i < offerCount; i++, offset += OFFER) {
      const r = values.subarray(offset, offset + OFFER);
      offers.push({ id: r[0], from: r[1], to: r[2], expires: r[3], call: !!r[4], score: r[5], terms: readTerms(r.subarray(6)) });
    }
    const events = values.slice(offset, offset + eventCount * 5); offset += eventCount * 5;
    for (let i = 0; i < historyCount; i++, offset += 6) {
      const r = values.subarray(offset, offset + 6); history.push({ time: r[0], kind: r[1], a: r[2], b: r[3], value: r[4], extra: r[5] });
    }
    const transferable: Record<number, number> = {};
    const personalities: Record<number, number> = {};
    const assistance: DiplomacySnapshot['assistance'] = {};
    for (let i = 0; i < accountCount; i++, offset += 6) {
      personalities[values[offset]] = values[offset + 5];
      transferable[values[offset]] = values[offset + 1];
      if (values[offset + 4] > state.time) assistance[values[offset]] = { city: values[offset + 2], ally: values[offset + 3], until: values[offset + 4] };
    }
    const previous = state.diplomacyState;
    const previousPairs = new Map(previous?.relationships.map(p => [`${p.a}:${p.b}`, p]));
    const accessChanged = !previous || relationships.some(p => {
      const old = previousPairs.get(`${p.a}:${p.b}`);
      return !old || p.war !== old.war || (Math.max(p.access, p.alliance, p.withdrawal) > state.time)
        !== (Math.max(old.access, old.alliance, old.withdrawal) > this.publishedAt);
    });
    const tradeChanged = !previous || relationships.some(p => {
      const old = previousPairs.get(`${p.a}:${p.b}`);
      return !old || p.war !== old.war || p.origin !== old.origin || p.destination !== old.destination
        || (p.trade > state.time) !== (old.trade > this.publishedAt);
    });
    const sightChanged = accessChanged || relationships.some(p => {
      const old = previousPairs.get(`${p.a}:${p.b}`);
      return !old || (p.alliance > state.time) !== (old.alliance > this.publishedAt);
    });
    const accessRevision = (previous?.accessRevision ?? 0) + Number(accessChanged);
    state.diplomacyState = { revision, accessRevision, relationships, offers, history, transferable, assistance, personalities } satisfies DiplomacySnapshot;
    for (const p of relationships) if (p.a === 0) {
      const faction = state.factions.find(f => f.id === p.b);
      if (faction && faction.relation !== 'confederated') faction.relation = p.war ? 'war' : 'peace';
    }
    state.factionTrades = relationships.filter(p => !p.war && p.trade > state.time && p.origin >= 0 && p.destination >= 0)
      .map(p => ({ faction: p.a, partnerFaction: p.b, origin: p.origin, partner: p.destination }));
    for (let o = 0; o < events.length; o += 5) {
      const [kind, a, b, value, extra] = events.subarray(o, o + 5);
      const from = state.factions.find(f => f.id === a), to = state.factions.find(f => f.id === b);
      if (kind === 1 && from && to) {
        // Transfers conserve gold exactly, without income difficulty bonuses
        // or a second allocation to Science.
        spendGold(state, from, value, 'transfers'); to.gold += value; recordGoldInput(state, to, value, 'transfers');
      } else if (kind === 2) receiveDiplomaticTechnology(state, b, RESEARCH_BRANCHES[value].id);
      else if (kind === 3) {
        for (const unit of state.units) if (unit.faction === a || unit.faction === b) {
          const target = unit.target === undefined ? undefined : entityStore(state).units.get(unit.target) ?? entityStore(state).buildings.get(unit.target);
          if (target && (target.faction === a || target.faction === b)) { unit.target = undefined; unit.forcedAttack = undefined; unit.path = undefined; unit.pathGoal = undefined; }
        }
        state.projectiles = state.projectiles?.filter(p => !((p.faction === a && projectileTargetFaction(state, p.target) === b)
          || (p.faction === b && projectileTargetFaction(state, p.target) === a)));
      } else if (kind === 9) returnDiplomaticCity(state, value, a, b);
      if (a === playerFaction(state) || b === playerFaction(state)) {
        const text = diplomacyEventText(state, { time: state.time, kind, a, b, value, extra });
        if (text) {
          state.events.unshift({ id: (state.events[0]?.id ?? 0) + 1, time: state.time, kind: [3, 6, 8, 14, 15].includes(kind) ? 'warning' : 'info', text });
          state.events.length = Math.min(40, state.events.length);
        }
      }
    }
    if (accessChanged) {
      settlements(state).markFactionsChanged(); invalidateFactionStrategies(state); invalidateNavigation(state);
      invalidateSettlementDecisions(state);
    }
    if (sightChanged) invalidateFog(state);
    if (tradeChanged) updateTradeRoutes(state);
    this.publishedAt = state.time;
    return { ok: !error, error, score, reasons, counterGold, message: error ? errors[error] ?? 'Negotiation failed. Reopen diplomacy and try again.' : command === 'propose' && offers.some(o => o.from === playerFaction(state)) ? 'Offer sent.' : command === 'decline' ? 'Offer declined.' : command === 'withdraw' ? 'Treaties end in 30 game seconds.' : 'Agreement accepted.' };
  }
}
function projectileTargetFaction(state: GameState, target: number | undefined): number | undefined {
  return target === undefined ? undefined : (entityStore(state).units.get(target) ?? entityStore(state).buildings.get(target))?.faction;
}
function bridge(state: GameState): DiplomacyBridge { return bridges.get(state) ?? bridges.set(state, new DiplomacyBridge(state)); }
export function updateDiplomacy(state: GameState): void {
  if (state.multiplayer || state.gameOver) return;
  const view = bridge(state);
  if (state.time < view.nextStep) return;
  view.nextStep = state.time + 1; view.step();
}
export function refreshDiplomacy(state: GameState): void {
  if (state.multiplayer) return;
  const view = bridge(state); view.sync(true);
  // A query publishes current native state without advancing strategic clocks.
  view.command('confederate', -1, emptyDiplomacyTerms(), 0, false);
}
export function negotiateDiplomacy(state: GameState, target: number, command: DiplomacyCommand, terms = emptyDiplomacyTerms(), offer = 0, confirmed = false): DiplomacyResult {
  if (state.multiplayer || state.gameOver) return { ok: false, error: 1, message: state.gameOver ? 'The match has ended.'
    : 'Treaty negotiations are unavailable in multiplayer.', score: 0, reasons: 0, counterGold: 0 };
  return bridge(state).command(command, target, terms, offer, confirmed);
}
export function recordDiplomaticCasualty(state: GameState, a: number, b: number, city: boolean): void {
  if (!state.multiplayer && a >= 0 && b >= 0) rustEngine.sim_diplomacy_casualty(simCore(state).handle, a, b, Number(city));
}
export function diplomacyEventText(state: GameState, h: DiplomaticHistory): string {
  const a = state.factions.find(f => f.id === h.a)?.name ?? 'Faction', b = state.factions.find(f => f.id === h.b)?.name ?? 'Faction';
  switch (h.kind) {
    case 2: return `${a} shared ${RESEARCH_BRANCHES[h.value]?.label ?? 'a technology'} with ${b}.`;
    case 3: return h.value ? `${a} declared war on ${b}${h.extra ? ', breaking a treaty' : ''}.` : `${a} and ${b} made peace.`;
    case 4: return `${a} and ${b} signed an agreement.`;
    case 6: return `${a} refused to defend ${b}. Their alliance has ended.`;
    case 7: return `${a} proposed a deal to ${b}.`;
    case 8: return `${a} calls ${b} to its defense.`;
    case 9: return `${a} returned a captured town to ${b}.`;
    case 10: return `${a} declined ${b}'s offer.`;
    case 11: return `${a} gave ${b} 30 seconds' notice of treaty withdrawal.`;
    case 12: return `The offer from ${a} to ${b} expired.`;
    case 13: return `${a} and ${b}'s treaties ended because a faction is no longer independent.`;
    case 14: return `${a} owes ${Math.ceil(h.value)} gold to ${b}; payment is due within 30 seconds.`;
    case 17: return `${a} is sending troops to defend ${b}.`;
    case 16: return `${a} and ${b}'s treaty expired.`;
    case 15: return `${a} defaulted on its agreement with ${b}.`;
    default: return '';
  }
}
/** Materialize the ownership event accepted by Rust using existing city
 * ownership assignments. Armies retain their original sovereign. */
function returnDiplomaticCity(state: GameState, id: number, from: number, to: number): void {
  const palace = entityStore(state).buildings.get(id), recipient = state.factions.find(f => f.id === to), former = state.factions.find(f => f.id === from);
  if (!palace || !recipient || !former) throw new Error('Diplomatic city transfer lost its accepted city.');
  const ownership = cityOwnership(state);
  const owned = state.buildings.filter(b => b.faction === from && b.kind !== 'fort' && (b.id === id || ownership.building(b)?.id === id));
  const ids = new Set(owned.map(b => b.id));
  const population = cityResidents(state).find(row => row.palace.id === id)?.population ?? 0;
  const food = Math.max(0, palace.storedFood ?? 0);
  for (const b of owned) {
    b.faction = to; delete b.repairerId;
    if (b.construction) { b.construction.waitingForBuilder = true; b.construction.pausedAt = state.time; delete b.construction.builderId; }
    applyDefenseResearch(b, recipient);
  }
  for (const u of state.units) if (u.faction === from && u.kind === 'worker' && ids.has(u.home ?? -1)) { u.faction = to; resetOrders(u); }
  for (const field of state.fields ?? []) if (ids.has(field.camp)) { field.faction = to; delete field.claimedBy; }
  former.population = Math.max(0, former.population - population); recipient.population += population;
  recordCampaignPopulation(state, recipient);
  former.food = Math.max(0, former.food - food); recipient.food += food;
  palace.previousSovereign = from;
  settlements(state).commitTransfer(id, id, to, 2);
  invalidateCityTransfer(state); settlementHost().afterTransfer(state, to);
}
