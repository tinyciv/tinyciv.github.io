import { decisionDue, type DecisionClock } from './decision-schedule';
import { simulationReadsActive } from './simulation-reads';
import { forEachNearbyUnit } from './spatial';
import { entityStore, type EntityObserver, type EntityStore } from './entity-store';
import { isRetinueMember, isSoldier, type BattleCasualty, type GameState, type Unit, type UnitOrder } from './types';
import { rustEngine } from './rust-engine';
import { SIM_ENGINE, SimSlot, simCore, type SimCore } from './sim-handle';
import { culturalHomeGround } from './cultural-territory';

export const CASUALTY_RADIUS = rustEngine.morale_constant(0);
export const CASUALTY_WINDOW = rustEngine.morale_constant(1);
export const CASUALTY_LOSS_RATIO = rustEngine.morale_constant(2);
export const CASUALTY_FLOOR = rustEngine.morale_constant(3);
export const CASUALTY_MORALE_DRAIN = rustEngine.morale_constant(4);
export const CASUALTY_SHOCK_SECONDS = rustEngine.morale_constant(5);
export const MARAUDER_LEADER_LOSS_RADIUS = rustEngine.morale_constant(6);
export const MARAUDER_LEADER_LOSS_MORALE = rustEngine.morale_constant(7);
export const ROUT_CONTAGION_MORALE_DRAIN = rustEngine.morale_constant(8);
export const MARAUDER_MIN_ROUT_SECONDS = rustEngine.morale_constant(9);
export const MARAUDER_MAX_MORALE = rustEngine.morale_constant(11);
const ORDERS: readonly UnitOrder[] = ['follow', 'hold', 'work', 'raid', 'wander', 'flee'];
const CASUALTY_KINDS = new Set<Unit['kind']>(['leader', 'warrior', 'swordsman', 'spearman', 'pikeman', 'musketman', 'horseman', 'horseArcher', 'knight', 'slinger', 'archer', 'scout', 'militia', 'worker']);
const unitFlags = (unit: Unit): number => (CASUALTY_KINDS.has(unit.kind) ? 1 : 0)
  | (isSoldier(unit) || unit.kind === 'leader' || unit.kind === 'militia' ? 2 : 0)
  | (isRetinueMember(unit) ? 4 : 0) | (unit.kind === 'leader' ? 8 : 0)
  | (unit.garrison ? 16 : 0) | (unit.guardPost !== undefined ? 32 : 0) | (unit.villageId !== undefined ? 64 : 0)
  | (unit.marauderPack !== undefined ? 128 : 0) | (unit.inside ? 256 : 0);
const orderCode = (order: UnitOrder | undefined): number => order === undefined ? -1 : ORDERS.indexOf(order);
const booleanTag = (value: boolean | undefined): number => value === undefined ? 0 : value ? 2 : 1;

/** Native Bevy resources own casualty history, spatial buckets and expiry.
 * This class keeps only serialization identity and reusable transfer buffers. */
class MoraleRuntime implements EntityObserver<Unit> {
  readonly handle: number;
  events?: BattleCasualty[];
  private factionList?: GameState['factions'];
  private factionIndex = new Map<number, GameState['factions'][number]>();
  achievementMask(state: GameState, faction: number): number {
    if (this.factionList !== state.factions || this.factionIndex.size !== state.factions.length) {
      this.factionList = state.factions; this.factionIndex = new Map(state.factions.map(item => [item.id, item]));
    }
    return this.factionIndex.get(faction)?.achievements ?? 0;
  }
  count = 0;
  prunedAt = -Infinity;
  values = new Float64Array(0);
  relations = new Float64Array(0);
  candidates: Unit[] = [];
  private capacity = 0;
  private pointer = 0;
  private view?: Float64Array;
  constructor(readonly store: EntityStore, readonly world: GameState['world'], readonly core: SimCore) {
    this.handle = core.engine(this, SIM_ENGINE.morale); store.units.observe(this);
  }
  added(_unit: Unit): void {}
  removed(unit: Unit): void { rustEngine.morale_remove_actor(this.handle, unit.id); }
  reserve(count: number): void {
    if (count <= this.capacity) return;
    this.capacity = Math.max(16, 2 ** Math.ceil(Math.log2(count)));
    this.values = new Float64Array(this.capacity);
    this.pointer = rustEngine.morale_input(this.handle, this.capacity);
  }
  write(count: number): void {
    if (!this.view || this.view.buffer !== rustEngine.memory.buffer || this.view.byteOffset !== this.pointer || this.view.length !== this.values.length)
      this.view = new Float64Array(rustEngine.memory.buffer, this.pointer, this.values.length);
    this.view.set(this.values.subarray(0, count));
  }
  history(state: GameState): void {
    let events = state.casualties ??= [];
    if (this.events !== events || this.count !== events.length || state.time < this.prunedAt) {
      this.reserve(events.length * 5);
      // Numeric indexing preserves streaming histories with instrumented iterators.
      for (let row = 0; row < events.length; row++) {
        const event = events[row], index = row * 5;
        this.values[index] = event.unit; this.values[index + 1] = event.faction;
        this.values[index + 2] = event.x; this.values[index + 3] = event.y; this.values[index + 4] = event.time;
      }
      this.write(events.length * 5); rustEngine.morale_reset(this.handle, events.length);
      this.events = events; this.count = events.length;
    }
    const pointer = rustEngine.morale_prune(this.handle, state.time);
    const compacted = new Float64Array(rustEngine.memory.buffer, pointer, 3)[0];
    if (compacted) { events = state.casualties = events.slice(compacted); this.events = events; this.count = events.length; }
    this.prunedAt = state.time;
  }
}
const runtimes = new SimSlot<MoraleRuntime>();
function runtime(state: GameState): MoraleRuntime {
  const store = entityStore(state);
  let value = runtimes.get(state);
  if (!value || value.store !== store || value.world !== state.world) value = runtimes.set(state, new MoraleRuntime(store, state.world, simCore(state)));
  return value;
}
const routClocks = new WeakMap<Unit, DecisionClock>();
const recordedDeaths = new WeakMap<GameState, WeakSet<Unit>>();

/** The native policy starts one episode; repeated notifications retain its deadline. */
export function beginBattleRout(state: Pick<GameState, 'time' | 'units'>, unit: Unit): void {
  const pointer = rustEngine.morale_begin_rout(state.time, unit.faction, orderCode(unit.order), unit.routUntil ?? -Infinity);
  const result = new Float64Array(rustEngine.memory.buffer, pointer, 2), started = result[0], until = result[1];
  if (started) {
    unit.routOrder = unit.order; unit.order = 'flee'; unit.routed = true;
    if (unit.faction === -2) unit.routUntil = until;
    unit.target = undefined; unit.destination = undefined; unit.path = undefined;
    unit.pathGoal = undefined; unit.repathAt = 0;
    unit.forcedAttack = undefined; unit.attackReturn = undefined; unit.recallIssuedAt = undefined;
    unit.infantryDrillLeader = undefined;
    if (unit.kind === 'leader') leaderRoutEpisodes.set(unit, (leaderRoutEpisodes.get(unit) ?? 0) + 1);
  }
  if (unit.kind === 'leader') routLeaderRetinue(state, unit);
}

/** Native eligibility keeps guards, scouts and marauder bands independent.
 * The trusted command roster is indexed; public fixture/import calls remain live. */
/** A Leader's rout shakes his retinue (50 morale, once per rout) instead of
 * breaking every soldier outright: only those already shaken flee with him.
 * The all-at-once rout added on 11-08 doubled routed time in the 2026-11-13
 * battle experiments and emptied whole battle lines at once. */
export const LEADER_ROUT_MORALE_LOSS = 50;
export const LEADER_ROUT_BREAK_MORALE = 25;
const leaderRoutEpisodes = new WeakMap<Unit, number>();
const shakenByRout = new WeakMap<Unit, { leader: Unit; episode: number }>();
export function routLeaderRetinue(state: Pick<GameState, 'time' | 'units'>, leader: Unit): void {
  if (!rustEngine.morale_leader_rout(unitFlags(leader), leader.faction, leader.hp, orderCode(leader.order))) return;
  if (leader.infantryFormation) leader.infantryFormation.active = false;
  const trusted = 'world' in state && simulationReadsActive(state as GameState);
  if (trusted) {
    let clock = routClocks.get(leader);
    if (!clock) { clock = {}; routClocks.set(leader, clock); }
    if (!decisionDue(clock, state.time, leader.id)) return;
  }
  const members = trusted ? entityStore(state as GameState).units.query('retinue') : state.units;
  for (const member of members) {
    const actions = rustEngine.morale_retinue_member(unitFlags(member), member.faction, member.hp, orderCode(member.order), leader.faction);
    if (actions & 2) {
      const episode = leaderRoutEpisodes.get(leader) ?? 0, previous = shakenByRout.get(member);
      if (previous?.leader !== leader || previous.episode !== episode) {
        shakenByRout.set(member, { leader, episode });
        member.morale = Math.max(0, member.morale - LEADER_ROUT_MORALE_LOSS);
        if (member.morale < LEADER_ROUT_BREAK_MORALE) beginBattleRout(state, member);
      }
    }
    if (actions & 1) member.infantryDrillLeader = undefined;
  }
}
export const canRallyFromRout = (state: Pick<GameState, 'time'>, unit: Unit): boolean =>
  !!rustEngine.morale_can_rally(state.time, unit.faction, unit.routUntil ?? -Infinity);
export const routContagionDrain = (routingAllies: number, standingAllies: number, nearLeader: boolean): number =>
  rustEngine.morale_contagion(routingAllies, standingAllies, Number(nearLeader));

/** Object identity is a host-boundary concern: distinct dead objects may reuse
 * an ID. The actual casualty record/index/lifetime lives in the native world. */
export function recordBattleDeath(state: GameState, unit: Unit): void {
  if (!rustEngine.morale_casualty_allowed(unit.hp, unitFlags(unit))) return;
  let recorded = recordedDeaths.get(state);
  if (!recorded) { recorded = new WeakSet(); recordedDeaths.set(state, recorded); }
  if (recorded.has(unit)) return;
  recorded.add(unit);
  const value = runtime(state); value.history(state);
  rustEngine.morale_record(value.handle, unit.id, unit.faction, unit.x, unit.y, state.time);
  value.events!.push({ unit: unit.id, faction: unit.faction, x: unit.x, y: unit.y, time: state.time }); value.count++;
  if (unit.faction !== -2 || !unit.marauderLeader) return;
  const candidates = value.candidates; candidates.length = 0;
  forEachNearbyUnit(state, unit, MARAUDER_LEADER_LOSS_RADIUS, ally => { candidates.push(ally); });
  value.reserve(candidates.length * 7);
  for (let row = 0; row < candidates.length; row++) {
    const ally = candidates[row], index = row * 7;
    value.values[index] = ally.faction; value.values[index + 1] = ally.hp; value.values[index + 2] = unitFlags(ally);
    value.values[index + 3] = ally.morale; value.values[index + 4] = ally.x; value.values[index + 5] = ally.y; value.values[index + 6] = orderCode(ally.order);
  }
  value.write(candidates.length * 7);
  const pointer = rustEngine.morale_commander_shock(value.handle, unit.x, unit.y, candidates.length);
  const result = new Float64Array(rustEngine.memory.buffer, pointer, candidates.length * 2).slice();
  for (let row = 0; row < candidates.length; row++) {
    const actions = result[row * 2], ally = candidates[row];
    if (actions & 1) ally.morale = result[row * 2 + 1];
    if (actions & 2) beginBattleRout(state, ally);
  }
}

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
  const value = runtime(state); value.history(state);
  const pressurePointer = rustEngine.morale_pressure(value.handle, state.time, unit.x, unit.y, unit.faction, unit.casualtyShock?.until ?? -Infinity);
  const needsLiving = new Float64Array(rustEngine.memory.buffer, pressurePointer, 2)[1];
  const count = rustEngine.morale_faction_count(value.handle), foreignPointer = rustEngine.morale_factions(value.handle);
  const foreign = new Float64Array(rustEngine.memory.buffer, foreignPointer, count).slice();
  if (value.relations.length < count) value.relations = new Float64Array(Math.max(16, 2 ** Math.ceil(Math.log2(count))));
  for (let row = 0; row < count; row++) value.relations[row] = Number(hostile(unit.faction, foreign[row]));
  let living = 0;
  if (needsLiving) {
    const candidates = value.candidates; candidates.length = 0;
    forEachNearbyUnit(state, unit, CASUALTY_RADIUS, ally => { candidates.push(ally); });
    value.reserve(candidates.length * 5);
    for (let row = 0; row < candidates.length; row++) {
      const ally = candidates[row], index = row * 5;
      value.values[index] = ally.faction; value.values[index + 1] = ally.hp; value.values[index + 2] = unitFlags(ally);
      value.values[index + 3] = ally.x; value.values[index + 4] = ally.y;
    }
    value.write(candidates.length * 5);
    living = rustEngine.morale_living(value.handle, unit.faction, unit.x, unit.y, candidates.length);
  }
  value.reserve(count); value.values.set(value.relations.subarray(0, count)); value.write(count);
  const pointer = rustEngine.morale_pressure_finish(value.handle, living);
  const result = new Float64Array(rustEngine.memory.buffer, pointer, 6);
  return { losses: result[0], threshold: result[1], recentEnemyKill: !!result[2], enemyLosses: result[3],
    unfavorableExchange: !!result[4], collapsing: !!result[5] };
}

export interface BattleMoraleInput {
  enemies: number; allies: number; routingAllies: number; fightingUntil: number; shelter: boolean;
  hostileSide: boolean; nearLeader: boolean; collapsing: boolean; unfavorableExchange: boolean;
  maximumMorale: number; defeated: boolean; leaderFleeing: boolean;
}
/** Integrate one persistent native actor after its bounded perception sample.
 * Return a new-rout event for the caller's existing rally/log publications. */
export function integrateBattleMorale(state: GameState, unit: Unit, dt: number, input: BattleMoraleInput): boolean {
  const value = runtime(state); value.reserve(16);
  const home = culturalHomeGround(state, { id: unit.faction, achievements: value.achievementMask(state, unit.faction) }, unit);
  value.values.set([unit.morale, unit.hp, input.maximumMorale, input.enemies, input.allies, input.routingAllies, input.fightingUntil,
    (input.hostileSide ? 1 : 0) | (input.nearLeader ? 2 : 0) | (input.shelter ? 4 : 0) | (input.collapsing ? 8 : 0)
      | (input.unfavorableExchange ? 16 : 0) | (unit.kind === 'leader' ? 32 : 0) | (input.defeated ? 64 : 0)
      | (isRetinueMember(unit) ? 128 : 0) | (unit.garrison ? 256 : 0) | (input.leaderFleeing ? 512 : 0) | (unit.marauderPack !== undefined ? 1024 : 0)
      | (value.achievementMask(state, unit.faction) << 11) | (home ? 1 << 30 : 0),
    unit.casualtyShock?.until ?? -Infinity, unit.casualtyShock ? 1 : 0, booleanTag(unit.casualtyShock?.routed),
    unit.faction, unit.routUntil ?? -Infinity, orderCode(unit.order), orderCode(unit.routOrder), booleanTag(unit.routed)]);
  value.write(16);
  const pointer = rustEngine.morale_integrate(value.handle, unit.id, state.time, dt);
  const result = new Float64Array(rustEngine.memory.buffer, pointer, 8).slice(), actions = result[4];
  unit.morale = result[0];
  if (actions & 4) unit.casualtyShock = { until: result[2] };
  if (unit.casualtyShock && result[3] !== booleanTag(unit.casualtyShock.routed)) {
    if (result[3]) unit.casualtyShock.routed = result[3] === 2;
    else delete unit.casualtyShock.routed;
  }
  if (actions & 1) beginBattleRout(state, unit);
  if (actions & 2) {
    unit.order = ORDERS[result[5]]; unit.routOrder = undefined; unit.routed = result[7] === 2;
    unit.routUntil = undefined; unit.destination = undefined; unit.path = undefined;
  }
  return !!(actions & 1);
}
