import { decisionDue, type DecisionClock } from './decision-schedule';
import { simulationReadsActive } from './simulation-reads';
import { forEachNearbyUnit } from './spatial';
import { distance, isRetinueMember, isSoldier, type BattleCasualty, type GameState, type Unit } from './types';

export const CASUALTY_RADIUS = 8;
export const CASUALTY_WINDOW = 20;
export const CASUALTY_LOSS_RATIO = 5;
export const CASUALTY_FLOOR = 6;
export const CASUALTY_MORALE_DRAIN = 50;
export const CASUALTY_SHOCK_SECONDS = 4;
export const MARAUDER_LEADER_LOSS_RADIUS = 6;
export const MARAUDER_LEADER_LOSS_MORALE = 40;
export const ROUT_CONTAGION_MORALE_DRAIN = 18;
export const MARAUDER_MIN_ROUT_SECONDS = 15;
const HISTORY_LIMIT = 2048;
interface CasualtyIndex { events: BattleCasualty[]; count: number; prunedAt: number; buckets: Map<number, Map<number, BattleCasualty[]>>; }
const indexes = new WeakMap<GameState, CasualtyIndex>();
const routClocks = new WeakMap<Unit, DecisionClock>();
const recordedDeaths = new WeakMap<GameState, WeakSet<Unit>>();

/** Start one rout episode. Repeated updates cannot move its rally deadline. */
export function beginBattleRout(state: Pick<GameState, 'time' | 'units'>, unit: Unit): void {
  if (unit.order !== 'flee') {
    unit.routOrder = unit.order; unit.order = 'flee'; unit.routed = true;
    if (unit.faction === -2) unit.routUntil = state.time + MARAUDER_MIN_ROUT_SECONDS;
    unit.target = undefined; unit.destination = undefined; unit.path = undefined;
    unit.pathGoal = undefined; unit.repathAt = 0;
    unit.forcedAttack = undefined; unit.attackReturn = undefined; unit.recallIssuedAt = undefined;
    unit.infantryDrillLeader = undefined;
  }
  if (unit.kind === 'leader') routLeaderRetinue(state, unit);
}

/** A faction commander's retreat is an immediate army-wide order, even for
 * distant escorts holding position. Guards, villagers and independent scouts
 * are not members of that commander's retinue. Marauder bands retain their
 * separate pack retreat system. */
export function routLeaderRetinue(state: Pick<GameState, 'time' | 'units'>, leader: Unit): void {
  if (leader.kind !== 'leader' || leader.faction < 0 || leader.hp <= 0 || leader.order !== 'flee') return;
  if (leader.infantryFormation) leader.infantryFormation.active = false;
  if ('world' in state && simulationReadsActive(state as GameState)) {
    let clock = routClocks.get(leader);
    if (!clock) { clock = {}; routClocks.set(leader, clock); }
    if (!decisionDue(clock, state.time, leader.id)) return;
  }
  for (const member of state.units) {
    if (member.faction !== leader.faction || member.hp <= 0 || !isRetinueMember(member)
      || member.garrison || member.guardPost !== undefined || member.villageId !== undefined || member.marauderPack !== undefined) continue;
    if (member.order !== 'flee') { member.morale = 0; beginBattleRout(state, member); }
    member.infantryDrillLeader = undefined;
  }
}

export const canRallyFromRout = (state: Pick<GameState, 'time'>, unit: Unit): boolean =>
  unit.faction !== -2 || state.time >= (unit.routUntil ?? -Infinity);

/** A few fugitives cannot dissolve a healthy formation. A collapsing line can
 * spread panic quickly; a commander who still stands halves that pressure. */
export function routContagionDrain(routingAllies: number, standingAllies: number, nearLeader: boolean): number {
  return ROUT_CONTAGION_MORALE_DRAIN * Math.min(1, routingAllies / Math.max(1, standingAllies)) * (nearLeader ? .5 : 1);
}

function history(state: GameState): CasualtyIndex {
  let events = state.casualties ??= [];
  let index = indexes.get(state);
  if (index?.prunedAt !== state.time && (events.length > HISTORY_LIMIT || events[0]?.time < state.time - CASUALTY_WINDOW)) {
    events = state.casualties = events.filter(event => event.time >= state.time - CASUALTY_WINDOW).slice(-HISTORY_LIMIT);
  }
  if (!index || index.events !== events || index.count !== events.length) {
    const buckets = new Map<number, Map<number, BattleCasualty[]>>();
    for (const event of events) {
      const x = Math.floor(event.x / CASUALTY_RADIUS), y = Math.floor(event.y / CASUALTY_RADIUS);
      let row = buckets.get(y);
      if (!row) { row = new Map(); buckets.set(y, row); }
      const group = row.get(x);
      if (group) group.push(event); else row.set(x, [event]);
    }
    index = { events, count: events.length, prunedAt: state.time, buckets };
    indexes.set(state, index);
  }
  index.prunedAt = state.time;
  return index;
}

/** Called at the damage site, before dead units are removed. Each unit object
 * contributes once; numeric IDs can be reused after a dead unit is removed. */
export function recordBattleDeath(state: GameState, unit: Unit): void {
  if (unit.hp > 0 || !['leader', 'warrior', 'spearman', 'horseman', 'archer', 'scout', 'militia', 'worker'].includes(unit.kind)) return;
  let recorded = recordedDeaths.get(state);
  if (!recorded) { recorded = new WeakSet(); recordedDeaths.set(state, recorded); }
  if (recorded.has(unit)) return;
  recorded.add(unit);
  history(state).events.push({ unit: unit.id, faction: unit.faction, x: unit.x, y: unit.y, time: state.time });
  // A commander's death is one immediate local shock, in addition to counting
  // as one ordinary casualty. Neither player fog nor band membership limits it.
  if (unit.faction === -2 && unit.marauderLeader) forEachNearbyUnit(state, unit, MARAUDER_LEADER_LOSS_RADIUS, ally => {
    if (ally.faction !== -2 || ally.hp <= 0 || ally.inside
      || !(isSoldier(ally) || ally.kind === 'leader' || ally.kind === 'militia')
      || distance(unit, ally) > MARAUDER_LEADER_LOSS_RADIUS) return;
    ally.morale = Math.max(0, ally.morale - MARAUDER_LEADER_LOSS_MORALE);
    // Route immediately at zero; the next normal morale integration must not
    // recover a fraction of a point before noticing this collapse.
    if (ally.morale === 0) beginBattleRout(state, ally);
  });
}

/** Count the local cohort before its recent losses, so losing allies does not
 * continually lower the proportional threshold. Other battles are irrelevant. */
type CasualtyPressure = { losses: number; threshold: number; recentEnemyKill: boolean; enemyLosses: number; unfavorableExchange: boolean; collapsing: boolean };
interface PressureObservation extends DecisionClock { value?: CasualtyPressure }
const pressureObservations = new WeakMap<GameState, WeakMap<Unit, PressureObservation>>();
export function casualtyPressure(state: GameState, unit: Unit, hostile: (a: number, b: number) => boolean): CasualtyPressure {
  if (!simulationReadsActive(state)) return sampleCasualtyPressure(state, unit, hostile);
  let observations = pressureObservations.get(state);
  if (!observations) { observations = new WeakMap(); pressureObservations.set(state, observations); }
  let observation = observations.get(unit);
  if (!observation) { observation = {}; observations.set(unit, observation); }
  if (decisionDue(observation, state.time, unit.id)) observation.value = sampleCasualtyPressure(state, unit, hostile);
  return observation.value!;
}
function sampleCasualtyPressure(state: GameState, unit: Unit, hostile: (a: number, b: number) => boolean): CasualtyPressure {
  const index = history(state);
  if (!index.events.length) return { losses: 0, threshold: CASUALTY_FLOOR, recentEnemyKill: false,
    enemyLosses: 0, unfavorableExchange: true, collapsing: false };
  let losses = 0, totalLosses = 0, enemyLosses = 0;
  const bx = Math.floor(unit.x / CASUALTY_RADIUS), by = Math.floor(unit.y / CASUALTY_RADIUS);
  for (let y = by - 1; y <= by + 1; y++) {
    const row = index.buckets.get(y);
    if (!row) continue;
    for (let x = bx - 1; x <= bx + 1; x++) {
      const deaths = row.get(x);
      if (!deaths) continue;
      for (const death of deaths) {
        if (death.time < state.time - CASUALTY_WINDOW || distance(unit, death) > CASUALTY_RADIUS) continue;
        // Losses during an earlier shock cannot keep restarting it. Keep the
        // deadline after recovery, including in saves and when leaving the area.
        if (death.faction === unit.faction) {
          totalLosses++;
          if (death.time > (unit.casualtyShock?.until ?? -Infinity)) losses++;
        } else if (hostile(unit.faction, death.faction)) enemyLosses++;
      }
    }
  }
  let living = 0;
  if (losses >= CASUALTY_FLOOR) forEachNearbyUnit(state, unit, CASUALTY_RADIUS, ally => {
    if (ally.faction === unit.faction && ally.hp > 0 && !ally.inside && ['leader', 'warrior', 'spearman', 'horseman', 'archer', 'scout', 'militia', 'worker'].includes(ally.kind)
      && distance(unit, ally) <= CASUALTY_RADIUS) living++;
  });
  const threshold = Math.max(CASUALTY_FLOOR, Math.ceil((living + losses) / 2));
  const unfavorableExchange = totalLosses >= CASUALTY_LOSS_RATIO * enemyLosses;
  return { losses, threshold, enemyLosses, recentEnemyKill: enemyLosses > 0, unfavorableExchange,
    collapsing: losses >= threshold && unfavorableExchange };
}
