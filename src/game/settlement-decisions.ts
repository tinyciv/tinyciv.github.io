import { decisionDue, decisionRevision, type DecisionClock } from './decision-schedule';
import { entityStore, type EntityStore } from './entity-store';
import type { GameState, Unit } from './types';
import { structureChangeRevision } from './simulation-reads';
import { worldRevisions, worldStructureRevision } from './world-revisions';

export type SettlementDecision = 'builders' | 'farms' | 'collectors' | 'trade';
const keys: Record<SettlementDecision, number> = { builders: 101, farms: 103, collectors: 107, trade: 109 };
interface SettlementClock extends DecisionClock {
  store?: EntityStore;
  world?: GameState['world'];
  tiles?: GameState['world']['tiles'];
  terrain?: number;
  sight?: number;
  structure?: number;
  worldStructure?: number;
  buildings?: number;
  workers?: readonly Unit[];
  builders?: readonly Unit[];
  collectors?: readonly Unit[];
  fields?: GameState['fields'];
  fieldCount?: number;
  treeCount?: number;
  invalidation?: number;
  commands?: number;
  factions?: { id: number; population: number; defeated: boolean; relation: string }[];
}
interface SettlementClocks { invalidation: number; tasks: Partial<Record<SettlementDecision, SettlementClock>> }
const clocks = new WeakMap<GameState, SettlementClocks>();
function stateClocks(state: GameState): SettlementClocks {
  let value = clocks.get(state);
  if (!value) { value = { invalidation: 0, tasks: {} }; clocks.set(state, value); }
  return value;
}

/** Ownership/completion changes mutate existing entities without changing ECS
 * membership. Commands and event handlers can wake background maintenance here;
 * public ensure/synchronize helpers themselves always remain immediate. */
export function invalidateSettlementDecisions(state: GameState): void { stateClocks(state).invalidation++; }

function changed(state: GameState, task: SettlementDecision, clock: SettlementClock, invalidation: number): boolean {
  const store = entityStore(state), revisions = state.world.revision === undefined ? undefined : worldRevisions(state.world);
  if (clock.store !== store || clock.world !== state.world || clock.tiles !== state.world.tiles
    || clock.terrain !== revisions?.geometry || clock.sight !== revisions?.sight || clock.structure !== structureChangeRevision(state)
    || clock.worldStructure !== (revisions ? worldStructureRevision(state.world) : undefined)
    || clock.buildings !== store.buildings.revision
    || clock.invalidation !== invalidation || clock.commands !== decisionRevision(state)
    || clock.factions?.length !== state.factions.length) return true;
  if ((task === 'builders' || task === 'collectors') && (clock.workers !== store.units.query('worker')
    || clock.builders !== store.units.query('builder') || clock.collectors !== store.units.query('collector'))) return true;
  if ((task === 'farms' || task === 'collectors')
    && (clock.fields !== state.fields || clock.fieldCount !== (state.fields?.length ?? 0))) return true;
  if (task === 'builders' && clock.treeCount !== (state.treeClearings?.length ?? 0)) return true;
  return state.factions.some((faction, index) => {
    const old = clock.factions![index];
    return old.id !== faction.id || old.population !== faction.population || old.defeated !== faction.defeated || old.relation !== faction.relation;
  });
}
function remember(state: GameState, clock: SettlementClock, invalidation: number): void {
  const store = entityStore(state), revisions = state.world.revision === undefined ? undefined : worldRevisions(state.world);
  clock.store = store; clock.world = state.world; clock.tiles = state.world.tiles; clock.terrain = revisions?.geometry;
  clock.sight = revisions?.sight; clock.structure = structureChangeRevision(state);
  clock.worldStructure = revisions ? worldStructureRevision(state.world) : undefined;
  clock.buildings = store.buildings.revision;
  clock.workers = store.units.query('worker'); clock.builders = store.units.query('builder'); clock.collectors = store.units.query('collector');
  clock.fields = state.fields; clock.fieldCount = state.fields?.length ?? 0; clock.treeCount = state.treeClearings?.length ?? 0;
  clock.invalidation = invalidation;
  clock.commands = decisionRevision(state);
  clock.factions = state.factions.map(({ id, population, defeated, relation }) => ({ id, population, defeated, relation }));
}

/** Run independent maintenance scans at no more than 3 Hz. Revisions are read
 * only when the deadline permits work; mutations never bypass that minimum
 * spacing. Remember after the
 * callback so its own staffing/topology edits do not schedule a redundant pass. */
export function runSettlementDecision(state: GameState, task: SettlementDecision, run: () => void): boolean {
  const scheduling = stateClocks(state), clock = scheduling.tasks[task] ??= {};
  if (clock.sampledAt !== undefined && state.time >= clock.sampledAt
    && state.time + 1e-9 < clock.nextAt!) return false;
  if (!decisionDue(clock, state.time, keys[task], false, changed(state, task, clock, scheduling.invalidation))) return false;
  run();
  remember(state, clock, scheduling.invalidation);
  return true;
}

interface IdleJobClock extends DecisionClock {
  state?: GameState; world?: GameState['world']; terrain?: number; sight?: number; structure?: number; worldStructure?: number;
  buildings?: number; workers?: readonly Unit[]; builders?: readonly Unit[]; collectors?: readonly Unit[]; commands?: number; population?: number;
  home?: number; camp?: number; faction?: number; treeCount?: number; retryAt?: number;
}
const idleJobs = new WeakMap<Unit, IdleJobClock>();

/** Only choosing work is sampled. Trips, pickup, delivery, clearing and repairs
 * still execute every simulation step. Keep existing blocked-route backoffs,
 * while commands that reset a retry clock are observed at the next sample. */
export function idleJobDecisionDue(state: GameState, unit: Unit): boolean {
  let clock = idleJobs.get(unit);
  if (!clock) { clock = {}; idleJobs.set(unit, clock); }
  if (clock.state === state && clock.sampledAt !== undefined && state.time >= clock.sampledAt
    && state.time + 1e-9 < clock.nextAt!) return false;
  const retryAt = unit.repathAt ?? 0, retryReset = retryAt < (clock.retryAt ?? 0);
  clock.retryAt = retryAt;
  if (state.time < retryAt) return false;
  const store = entityStore(state), buildings = store.buildings.revision, commands = decisionRevision(state);
  const workers = store.units.query('worker'), builders = store.units.query('builder'), collectors = store.units.query('collector');
  const revisions = state.world.revision === undefined ? undefined : worldRevisions(state.world);
  const structure = structureChangeRevision(state), worldStructure = revisions ? worldStructureRevision(state.world) : undefined;
  const population = state.factions.find(faction => faction.id === unit.faction)?.population;
  const urgent = retryReset || clock.state !== state || clock.world !== state.world || clock.terrain !== revisions?.geometry
    || clock.sight !== revisions?.sight || clock.structure !== structure || clock.worldStructure !== worldStructure
    || clock.buildings !== buildings || clock.workers !== workers || clock.builders !== builders || clock.collectors !== collectors
    || clock.population !== population || clock.commands !== commands || clock.home !== unit.home
    || clock.camp !== unit.collectorCamp || clock.faction !== unit.faction
    || unit.builder && clock.treeCount !== (state.treeClearings?.length ?? 0);
  if (!decisionDue(clock, state.time, unit.id, false, urgent)) return false;
  clock.state = state; clock.world = state.world; clock.terrain = revisions?.geometry; clock.sight = revisions?.sight;
  clock.structure = structure; clock.worldStructure = worldStructure; clock.buildings = buildings;
  clock.workers = workers; clock.builders = builders; clock.collectors = collectors; clock.population = population;
  clock.commands = commands; clock.home = unit.home; clock.camp = unit.collectorCamp; clock.faction = unit.faction;
  clock.treeCount = state.treeClearings?.length ?? 0;
  return true;
}
