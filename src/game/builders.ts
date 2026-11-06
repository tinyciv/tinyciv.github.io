import { civilianWorkforcePopulations, constructionWorkerAllowance, recordCivilianCasualties } from './civilian-population';
import { isForbidden } from './forbidden-zones';
import { buildingWorkForbidden } from './forbidden-work';
import { entityStore } from './entity-store';
import { idleJobDecisionDue } from './settlement-decisions';
import { unitPositionBlocked } from './civilian-movement';
import { canDispatchPeasant } from './peasant-capacity';
import { indexedBuilding, unitOccupancy } from './spatial';
import { clearConstructionSite } from './construction-clearance';
import { removeCoveredRoads } from './covered-roads';
import { type Building, type GameState, type Point, type Unit, buildingReady, buildingWidth, buildingHeight, distance, isFarmKind } from './types';
import { canTraverseEdge, canWalk, findPath, invalidateNavigation, movementMultiplier, withNavigationFrame } from './pathfinding';

import { CONSTRUCTION_SECONDS } from './structures';
import { fellTree, hasTree, TREE_CLEAR_SECONDS, treeWorkEdges } from './tree-clearing';
import { constructionSpeedMultiplier } from './research-bonuses';
import { notifyRepairJobChanged, repairJobCandidates } from './builder-jobs';
import { simulationReadsActive } from './simulation-reads';
import { invalidateWorkerHomes, settlementWorkers } from './settlement-rosters';
import { decisionDue, type DecisionClock } from './decision-schedule';
import { CHECK_INTERVAL, recurringWorkElapsed } from './work-cadence';
export { notifyRepairJobChanged } from './builder-jobs';

export const POPULATION_PER_BUILDER = 5;
export const REPAIR_QUIET_SECONDS = 5;
/** Small surviving settlements retain one builder so they can rebuild housing. */
export function builderCapacity(population: number): number { return constructionWorkerAllowance(population); }
export function repairRate(building: Building): number { return building.maxHp / Math.max(1, CONSTRUCTION_SECONDS[building.kind]); }
function repairable(state: GameState, building: Building): boolean {
  return !buildingWorkForbidden(state, building) && buildingReady(building) && !isFarmKind(building.kind) && building.kind !== 'ruin' && building.hp < building.maxHp
    && state.time - (building.lastAttacked ?? -Infinity) >= REPAIR_QUIET_SECONDS;
}
function pauseSite(state: GameState, building: Building): void {
  const site = building.construction;
  if (!site) return;
  if (!site.waitingForBuilder) site.pausedAt = state.time;
  site.waitingForBuilder = true; site.cleared = false;
  invalidateNavigation(state);
}
type Move = (state: GameState, unit: Unit, goal: Point, dt: number, direct?: boolean, allowPartial?: boolean) => void;
const tileKey = (state: GameState, point: Point): number => Math.floor(point.y) * state.world.width + Math.floor(point.x);
const previousOrders = new WeakMap<GameState, Set<Building>>();
interface WorkEdges extends DecisionClock { state: GameState; key: string; points: Point[] }
const workEdges = new WeakMap<Unit, WorkEdges>();
const routeClocks = new WeakMap<Unit, { state: GameState; clock: DecisionClock }>();

/** Reuse access geometry between worker decisions. Actual movement still
 * validates its next segment, so a newly closed doorway cannot be crossed. */
function workerEdges(state: GameState, unit: Unit, key: string, read: () => Point[]): Point[] {
  if (!simulationReadsActive(state)) return read();
  let cached = workEdges.get(unit);
  if (!cached || cached.state !== state || cached.key !== key) {
    cached = { state, key, points: [] }; workEdges.set(unit, cached);
  }
  if (decisionDue(cached, state.time, unit.id)) cached.points = read();
  return cached.points;
}
function routeDecisionDue(state: GameState, unit: Unit): boolean {
  if (!simulationReadsActive(state)) return true;
  let cached = routeClocks.get(unit);
  if (!cached || cached.state !== state) { cached = { state, clock: {} }; routeClocks.set(unit, cached); }
  return decisionDue(cached.clock, state.time, unit.id);
}

/** Peasants stand on a reachable side of a structure, never inside its footprint. */
export function constructionEdges(state: GameState, building: Building, avoidForbidden = false): Point[] {
  const width = buildingWidth(building), height = buildingHeight(building), points: Point[] = [];
  for (let i = 0; i < height; i++) points.push({ x: building.x - .5, y: building.y + i + .5 }, { x: building.x + width + .5, y: building.y + i + .5 });
  for (let i = 0; i < width; i++) points.push({ x: building.x + i + .5, y: building.y - .5 }, { x: building.x + i + .5, y: building.y + height + .5 });
  return points.filter(point => canWalk(state, point.x, point.y, building.faction, undefined, avoidForbidden) && canTraverseEdge(state.world, point, {
    x: Math.max(building.x, Math.min(building.x + width - 1, Math.floor(point.x))),
    y: Math.max(building.y, Math.min(building.y + height - 1, Math.floor(point.y))),
  }));
}

/** Check access after the proposed solid footprint itself has been reserved. */
export function canReachConstruction(state: GameState, palace: Building, building: Building): boolean {
  if (buildingWorkForbidden(state, building, palace.faction)) return false;
  const planned = state.buildings.includes(building) ? state : { ...state, buildings: [...state.buildings, building] };
  const exits = constructionEdges(planned, palace, true), edges = constructionEdges(planned, building, true);
  for (const edge of edges) for (const exit of exits.slice().sort((a, b) => distance(a, edge) - distance(b, edge))) {
    if (distance(exit, edge) < .12 || findPath(planned, exit, edge, palace.faction, false, undefined, undefined, undefined, false, true).length) return true;
  }
  return false;
}

function clearJourney(unit: Unit): void {
  unit.destination = undefined; unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
}
function setJourney(unit: Unit, goal: Point, path: Point[]): void {
  unit.destination = goal; unit.path = path; unit.pathGoal = { ...goal }; unit.repathAt = 0;
}
function releaseSite(state: GameState, unit: Unit): void {
  const building = indexedBuilding(state, unit.buildSite);
  if (building?.construction?.builderId === unit.id) {
    pauseSite(state, building); delete building.construction.builderId;
  }
  const repair = indexedBuilding(state, unit.repairSite);
  if (repair?.repairerId === unit.id) delete repair.repairerId;
  for (const order of state.treeClearings ?? []) if (order.workerId === unit.id) delete order.workerId;
  unit.clearTree = undefined; unit.clearProgress = undefined;
  unit.buildSite = undefined; unit.repairSite = undefined; clearJourney(unit);
}
function makeBuilder(state: GameState, palace: Building, id: number): Unit {
  const unit: Unit = {
    id,
    kind: 'worker', faction: palace.faction, home: palace.id, x: palace.x + 1, y: palace.y + 1,
    hp: 50, maxHp: 50, morale: 100, attack: 0, defense: 0, speed: 2.2, range: 1.1, order: 'work',
    cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0, bornAt: state.time,
    builder: true, inside: true, buildPhase: 'idle',
  };
  entityStore(state).units.add(unit);
  return unit;
}

interface ConstructionJourney { palace: Building; exit: Point; goal: Point; path: Point[]; cost: number; }

/** Builders leave their own inhabited city. Choose its best real exit and
 * route, including roads and detours, without borrowing an empty city's origin. */
function nearestConstructionJourney(state: GameState, unit: Unit, building: Building,
  occupied: Pick<ReadonlySet<number>, 'has'>): ConstructionJourney | undefined {
  return withNavigationFrame(state, () => {
    const goals = constructionEdges(state, building, true);
    const palaces = entityStore(state).buildings.query('palace')
      .filter(palace => palace.id === unit.home && palace.faction === unit.faction && buildingReady(palace) && !buildingWorkForbidden(state, palace))
      .map(palace => ({ palace, exits: constructionEdges(state, palace, true)
        .filter(exit => !occupied.has(tileKey(state, exit)) && !unitPositionBlocked(state, unit, exit)) }));
    // Prefer an unoccupied working side, as ordinary builder dispatch does.
    for (const busy of [false, true]) {
      const candidates = palaces.flatMap(({ palace, exits }) => exits.flatMap(exit => goals
        .filter(goal => occupied.has(tileKey(state, goal)) === busy)
        .map(goal => ({ palace, exit, goal, lowerBound: distance(exit, goal) / 1.5 }))));
      candidates.sort((a, b) => a.lowerBound - b.lowerBound || a.palace.id - b.palace.id);
      let best: ConstructionJourney | undefined;
      for (const candidate of candidates) {
        // Roads are the fastest terrain at 1.5×, so no remaining route can win.
        if (best && candidate.lowerBound > best.cost + 1e-8) break;
        const { palace, exit, goal } = candidate;
        const path = findPath(state, exit, goal, unit.faction, false, undefined, undefined, undefined, false, true);
        if (!path.length && distance(exit, goal) > .12) continue;
        let from = exit, cost = 0;
        for (const point of path) {
          cost += distance(from, point) * (1 / movementMultiplier(state, from.x, from.y) + 1 / movementMultiplier(state, point.x, point.y)) / 2;
          from = point;
        }
        if (!best || cost < best.cost - 1e-8 || Math.abs(cost - best.cost) < 1e-8 && palace.id < best.palace.id)
          best = { palace, exit, goal, path, cost };
      }
      if (best) return best;
    }
    return undefined;
  });
}

/** Each inhabited city funds a construction/repair workforce from its own residents. */
export function ensureBuilders(state: GameState): void {
  if (simulationReadsActive(state) && recurringWorkElapsed(state, 'builders:staff', 0) === undefined) return;
  recordCivilianCasualties(state);
  const populations = civilianWorkforcePopulations(state);
  const entities = entityStore(state), byId = entities.units;
  state.treeClearings = state.treeClearings?.filter(order => hasTree(state, order));
  for (const order of state.treeClearings ?? []) {
    const worker = byId.get(order.workerId ?? -1);
    if (!worker?.builder || worker.hp <= 0 || worker.builderRetiring || worker.faction !== order.faction
      || !worker.clearTree || worker.clearTree.x !== order.x || worker.clearTree.y !== order.y) delete order.workerId;
  }
  const pending = new Set<Building>(), wake = new Set<number>(), previous = previousOrders.get(state);
  for (const building of state.buildings) {
    const site = building.construction;
    if (site && building.kind === 'ballista') continue;
    if (site && buildingWorkForbidden(state, building)) {
      if (!site.waitingForBuilder) pauseSite(state, building);
      const builder = byId.get(site.builderId ?? -1);
      if (builder) { releaseSite(state, builder); builder.buildPhase = builder.inside ? 'idle' : 'returning'; }
      delete site.builderId;
    }
    if (site?.builderId !== undefined) {
      const builder = byId.get(site.builderId);
      if (!builder?.builder || builder.hp <= 0 || builder.builderRetiring || builder.faction !== building.faction
        || builder.buildSite !== building.id || !['working', 'outbound'].includes(builder.buildPhase ?? '')) {
        pauseSite(state, building); delete site.builderId;
      }
    }
    if (building.repairerId !== undefined) {
      const worker = byId.get(building.repairerId);
      if (!worker?.builder || worker.hp <= 0 || worker.builderRetiring || worker.repairSite !== building.id
        || worker.faction !== building.faction) delete building.repairerId;
    }
    if (building.hp > 0 && site?.waitingForBuilder && site.builderId === undefined) {
      pending.add(building);
      if (!previous?.has(building)) wake.add(building.faction);
    }
  }
  previousOrders.set(state, pending);
  const remove = new Set<Unit>();
  const roster = settlementWorkers(state);
  let nextId: number | undefined;
  for (const faction of state.factions) {
    const factionPalaces = entities.buildings.query('palace').filter(building => building.faction === faction.id && buildingReady(building));
    if (!factionPalaces.length) {
      for (const worker of entities.units.query('builder')) if (worker.faction === faction.id) { releaseSite(state, worker); remove.add(worker); }
      continue;
    }
    for (const city of factionPalaces) {
      const palaces = [city], population = populations.get(city.id) ?? 0;
      const builders = (roster.buildersByCity.get(city.id) ?? []).filter(unit => unit.hp > 0 && unit.faction === faction.id);
      const wanted = !faction.defeated && faction.relation !== 'confederated' ? builderCapacity(population) : 0;
      // Preserve ongoing construction ahead of repairs and idle workers when population falls.
      const priority = (worker: Unit): number => worker.buildPhase === 'working' || worker.buildPhase === 'clearing' ? 0 : worker.buildSite !== undefined || worker.clearTree ? 1
        : worker.repairSite !== undefined ? 2 : worker.inside ? 3 : 4;
      builders.sort((a, b) => priority(a) - priority(b) || a.id - b.id);
      const retained = builders.slice(0, wanted);
      const retainedBuilders = new Set(retained);
      for (const builder of builders) {
        if (!retainedBuilders.has(builder)) {
          if (!builder.builderRetiring) { releaseSite(state, builder); builder.buildPhase = 'returning'; builder.builderRetiring = true; }
          if (builder.inside || !palaces.length) { builder.inside = true; remove.add(builder); }
          continue;
        }
        delete builder.builderRetiring;
        // A new order wakes palace workers immediately without removing the
        // normal retry delay for an unchanged, unreachable construction queue.
        if (wake.has(faction.id) && builder.buildPhase === 'idle') builder.repathAt = 0;
        if (!palaces.some(palace => palace.id === builder.home)) {
          const palace = palaces.slice().sort((a, b) => distance(a, builder) - distance(b, builder))[0];
          builder.home = palace.id;
          invalidateWorkerHomes(state);
          if (builder.inside) { builder.x = palace.x + 1; builder.y = palace.y + 1; }
          else clearJourney(builder);
        }
      }
      if (retained.length >= wanted) continue;
      const homeCounts = new Map<number, number>();
      for (const worker of entities.units.query('builder')) if (worker.hp > 0 && !worker.builderRetiring && worker.home !== undefined)
        homeCounts.set(worker.home, (homeCounts.get(worker.home) ?? 0) + 1);
      let staffed = (roster.byCity.get(city.id) ?? []).filter(unit => unit.hp > 0).length;
      for (let count = retained.length; count < wanted && staffed < population; count++, staffed++) {
        let palace = palaces[0];
        for (let i = 1; i < palaces.length; i++) if ((homeCounts.get(palaces[i].id) ?? 0) < (homeCounts.get(palace.id) ?? 0)) palace = palaces[i];
        if (nextId === undefined) {
          nextId = 0;
          for (const id of entities.units.ids()) nextId = Math.max(nextId, id);
          for (const id of entities.buildings.ids()) nextId = Math.max(nextId, id);
        }
        const worker = makeBuilder(state, palace, ++nextId);
        homeCounts.set(palace.id, (homeCounts.get(palace.id) ?? 0) + 1);
      }
    }
  }
  if (remove.size) entityStore(state).units.retain(unit => !remove.has(unit));
}

function beginWork(state: GameState, unit: Unit, building: Building): void {
  // Clearance is an arrival/resumption event. An already working builder must
  // not rescan the construction footprint and nearby units every frame.
  if (unit.buildPhase === 'working' && !building.construction?.waitingForBuilder) { unit.moving = false; return; }
  if (buildingWorkForbidden(state, building) || isForbidden(state, unit.x, unit.y, unit.faction) || !clearConstructionSite(state, building)) return;
  const site = building.construction!;
  if (site.waitingForBuilder) {
    removeCoveredRoads(state, building);
    site.startedAt = site.pausedAt === undefined ? state.time : site.startedAt + state.time - site.pausedAt;
    delete site.pausedAt; site.waitingForBuilder = false;
    invalidateNavigation(state);
  }
  site.builderId = unit.id; unit.buildPhase = 'working'; unit.moving = false; clearJourney(unit);
  unit.facing = Math.atan2(building.y + buildingHeight(building) / 2 - unit.y, building.x + buildingWidth(building) / 2 - unit.x);
}

/** Dispatch uses static terrain routes; moving friends yield through the common movement system. */
export function updateBuilder(state: GameState, unit: Unit, dt: number, move: Move): void {
  // Idle workers need only sample job/capacity selection. Movement and all
  // assigned work below still run every step, including arrival transitions.
  if (!unit.builderRetiring && (unit.buildPhase === 'idle' || !unit.buildPhase)
    && unit.buildSite === undefined && unit.repairSite === undefined && !unit.clearTree
    && !idleJobDecisionDue(state, unit)) return;
  const palace = indexedBuilding(state, unit.home);
  if (!palace || palace.kind !== 'palace' || !buildingReady(palace)) return;
  if (unit.builderRetiring && (unit.buildPhase !== 'returning' || unit.buildSite !== undefined || unit.repairSite !== undefined || unit.clearTree)) {
    releaseSite(state, unit); unit.buildPhase = 'returning';
  }
  const occupied = unitOccupancy(state, unit);
  const assigned = indexedBuilding(state, unit.buildSite);
  let building = assigned && assigned.hp > 0 && assigned.faction === unit.faction && assigned.construction && !buildingWorkForbidden(state, assigned) ? assigned : undefined;
  if (unit.buildSite !== undefined && (!building || building.construction?.builderId !== unit.id)) {
    releaseSite(state, unit); unit.buildPhase = unit.inside ? 'idle' : 'returning';
  }
  if (!unit.inside && (unit.buildPhase === 'idle' || !unit.buildPhase)) {
    // Only workers already inside a settlement can be allocated a new origin.
    clearJourney(unit); unit.buildPhase = 'returning';
  }
  if (!unit.builderRetiring && (unit.buildPhase === 'idle' || !unit.buildPhase)) {
    if (state.time < (unit.repathAt ?? 0)) return;
    if (unit.inside && !canDispatchPeasant(state, unit)) return;
    const construction = simulationReadsActive(state) ? entityStore(state).buildings.query('construction') : state.buildings;
    const orders = construction.filter(candidate => candidate.kind !== 'ballista' && candidate.hp > 0 && candidate.faction === unit.faction
      && candidate.construction?.waitingForBuilder && !buildingWorkForbidden(state, candidate) && candidate.construction.builderId === undefined)
      .sort((a, b) => a.construction!.startedAt - b.construction!.startedAt || distance(palace, a) - distance(palace, b));
    for (const order of orders) {
      const journey = nearestConstructionJourney(state, unit, order, occupied);
      if (!journey) continue;
      unit.home = journey.palace.id;
      invalidateWorkerHomes(state);
      unit.x = journey.exit.x; unit.y = journey.exit.y; unit.inside = false; unit.buildSite = order.id; unit.buildPhase = 'outbound';
      order.construction!.builderId = unit.id; setJourney(unit, journey.goal, journey.path);
      return;
    }
    const exits = constructionEdges(state, palace, true).filter(point => !occupied.has(tileKey(state, point)) && !unitPositionBlocked(state, unit, point));
    // Tree orders share the palace workforce and are worked one tile at a time.
    for (const order of (state.treeClearings ?? []).filter(order => order.faction === unit.faction && order.workerId === undefined && !isForbidden(state, order.x, order.y, unit.faction))) {
      const edges = treeWorkEdges(state, order, unit.faction).sort((a, b) => Number(occupied.has(tileKey(state, a))) - Number(occupied.has(tileKey(state, b))) || distance(a, palace) - distance(b, palace));
      for (const goal of edges) for (const exit of exits.slice().sort((a, b) => distance(a, goal) - distance(b, goal))) {
        const path = findPath(state, exit, goal, unit.faction, false, undefined, undefined, undefined, false, true);
        if (!path.length && distance(exit, goal) > .12) continue;
        unit.x = exit.x; unit.y = exit.y; unit.inside = false; unit.clearTree = { x: order.x, y: order.y };
        unit.clearProgress = 0; unit.buildPhase = 'outbound'; order.workerId = unit.id; setJourney(unit, goal, path); return;
      }
    }
    // Construction takes priority; repairs reuse these same workers and slots.
    const repairs = repairJobCandidates(state, unit.faction).filter(candidate => candidate.repairerId === undefined && repairable(state, candidate))
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || distance(palace, a) - distance(palace, b)
        || entityStore(state).buildings.indexOf(a) - entityStore(state).buildings.indexOf(b));
    for (const repair of repairs) {
      const edges = constructionEdges(state, repair, true).sort((a, b) => Number(occupied.has(tileKey(state, a))) - Number(occupied.has(tileKey(state, b))) || distance(a, palace) - distance(b, palace));
      for (const goal of edges) for (const exit of exits.slice().sort((a, b) => distance(a, goal) - distance(b, goal))) {
        const path = findPath(state, exit, goal, unit.faction, false, undefined, undefined, undefined, false, true);
        if (!path.length && distance(exit, goal) > .12) continue;
        unit.x = exit.x; unit.y = exit.y; unit.inside = false; unit.repairSite = repair.id; unit.buildPhase = 'outbound';
        repair.repairerId = unit.id; setJourney(unit, goal, path); return;
      }
    }
    unit.repathAt = state.time + 2;
    return;
  }
  if (unit.clearTree && !unit.builderRetiring) {
    const tree = unit.clearTree;
    const order = state.treeClearings?.find(order => order.x === tree.x && order.y === tree.y && order.workerId === unit.id);
    if (!order || !hasTree(state, tree) || isForbidden(state, tree.x, tree.y, unit.faction)) { releaseSite(state, unit); unit.buildPhase = 'returning'; }
    else {
      const edges = workerEdges(state, unit, `tree:${tree.x},${tree.y}`, () => treeWorkEdges(state, tree, unit.faction)
        .sort((a, b) => Number(occupied.has(tileKey(state, a))) - Number(occupied.has(tileKey(state, b))) || distance(a, unit) - distance(b, unit)));
      if (edges.some(edge => distance(unit, edge) < .2)) {
        unit.buildPhase = 'clearing'; unit.moving = false; clearJourney(unit);
        unit.facing = Math.atan2(tree.y + .5 - unit.y, tree.x + .5 - unit.x);
        unit.clearProgress = (unit.clearProgress ?? 0) + dt;
        unit.attackTime = Math.max(0, .28 - unit.clearProgress % .7);
        if (unit.clearProgress + 1e-7 >= TREE_CLEAR_SECONDS) { fellTree(state, tree); releaseSite(state, unit); unit.buildPhase = 'returning'; }
        return;
      }
      unit.buildPhase = 'outbound';
      if (!unit.destination && state.time < (unit.repathAt ?? 0)) return;
      if (!unit.destination || !edges.some(edge => distance(edge, unit.destination!) < .1) || !unit.path?.length && state.time >= (unit.repathAt ?? 0)) {
        if (!routeDecisionDue(state, unit)) { if (unit.destination) move(state, unit, unit.destination, dt); return; }
        clearJourney(unit);
        for (const edge of edges) {
          const path = findPath(state, unit, edge, unit.faction, false, undefined, undefined, undefined, false, true);
          if (path.length) { setJourney(unit, edge, path); break; }
        }
        if (!unit.destination) unit.repathAt = state.time + 2;
      }
      if (unit.destination) move(state, unit, unit.destination, dt);
      return;
    }
  }
  if (unit.repairSite !== undefined && !unit.builderRetiring) {
    const repair = indexedBuilding(state, unit.repairSite);
    if (!repair || repair.faction !== unit.faction || !buildingReady(repair) || repair.repairerId !== unit.id || repair.hp >= repair.maxHp || buildingWorkForbidden(state, repair)) {
      releaseSite(state, unit); unit.buildPhase = 'returning';
    } else {
      if (!repairable(state, repair)) { unit.buildPhase = 'outbound'; unit.moving = false; clearJourney(unit); return; }
      const edges = workerEdges(state, unit, `repair:${repair.id}`, () => constructionEdges(state, repair, true)
        .sort((a, b) => Number(occupied.has(tileKey(state, a))) - Number(occupied.has(tileKey(state, b))) || distance(a, unit) - distance(b, unit)));
      if (edges.some(point => distance(point, unit) < .2)) {
        unit.buildPhase = 'repairing'; unit.moving = false; clearJourney(unit);
        unit.facing = Math.atan2(repair.y + buildingHeight(repair) / 2 - unit.y, repair.x + buildingWidth(repair) / 2 - unit.x);
        const tools = constructionSpeedMultiplier(state.factions.find(faction => faction.id === unit.faction));
        repair.hp = Math.min(repair.maxHp, repair.hp + repairRate(repair) * tools * dt);
        notifyRepairJobChanged(state, repair);
        if (repair.hp >= repair.maxHp) { releaseSite(state, unit); unit.buildPhase = 'returning'; }
        return;
      }
      unit.buildPhase = 'outbound';
      if (!unit.destination || !edges.some(point => distance(point, unit.destination!) < .1)
        || !unit.path?.length && state.time >= (unit.repathAt ?? 0)) {
        if (!routeDecisionDue(state, unit)) { if (unit.destination) move(state, unit, unit.destination, dt); return; }
        clearJourney(unit);
        for (const edge of edges) {
          const path = findPath(state, unit, edge, unit.faction, false, undefined, undefined, undefined, false, true);
          if (path.length) { setJourney(unit, edge, path); break; }
        }
        if (!unit.destination) unit.repathAt = state.time + 2;
      }
      if (unit.destination) move(state, unit, unit.destination, dt);
      return;
    }
  }
  if (unit.buildPhase === 'outbound'  || unit.buildPhase === 'working') {
    building = indexedBuilding(state, unit.buildSite);
    if (!building || building.hp <= 0 || !building.construction) return;
    const edges = workerEdges(state, unit, `construction:${building.id}`, () => constructionEdges(state, building!, true)
      .sort((a, b) => Number(occupied.has(tileKey(state, a))) - Number(occupied.has(tileKey(state, b))) || distance(a, unit) - distance(b, unit)));
    if (edges.some(point => distance(point, unit) < .2)) { beginWork(state, unit, building); return; }
    if (unit.buildPhase === 'working') {
      const site = building.construction!;
      if (!site.waitingForBuilder) pauseSite(state, building);
      unit.buildPhase = 'outbound'; clearJourney(unit);
    }
    if (!unit.destination && state.time < (unit.repathAt ?? 0)) return;
    if (!unit.destination || !edges.some(point => distance(point, unit.destination!) < .1)
      || !unit.path?.length && state.time >= (unit.repathAt ?? 0)) {
      if (!routeDecisionDue(state, unit)) { if (unit.destination) move(state, unit, unit.destination, dt); return; }
      clearJourney(unit);
      for (const edge of edges) {
        const path = findPath(state, unit, edge, unit.faction, false, undefined, undefined, undefined, false, true);
        if (path.length) { setJourney(unit, edge, path); break; }
      }
      if (!unit.destination) unit.repathAt = state.time + 2;
    }
    if (unit.destination) move(state, unit, unit.destination, dt);
    return;
  }
  if (unit.buildPhase === 'returning') {
    if (buildingWorkForbidden(state, palace)) { unit.moving = false; clearJourney(unit); return; }
    const exits = workerEdges(state, unit, `home:${palace.id}`, () => constructionEdges(state, palace, true)
      .sort((a, b) => Number(occupied.has(tileKey(state, a))) - Number(occupied.has(tileKey(state, b))) || distance(a, unit) - distance(b, unit)));
    if (exits.some(point => distance(point, unit) < .2)) {
      unit.x = palace.x + 1; unit.y = palace.y + 1; unit.inside = true; unit.buildPhase = 'idle'; unit.moving = false;
      clearJourney(unit); unit.repathAt = state.time + CHECK_INTERVAL;
      return;
    }
    if (!unit.destination && state.time < (unit.repathAt ?? 0)) return;
    if (!unit.destination || !exits.some(point => distance(point, unit.destination!) < .1)
      || !unit.path?.length && state.time >= (unit.repathAt ?? 0)) {
      if (!routeDecisionDue(state, unit)) { if (unit.destination) move(state, unit, unit.destination, dt); return; }
      clearJourney(unit);
      for (const exit of exits) {
        const path = findPath(state, unit, exit, unit.faction, false, undefined, undefined, undefined, false, true);
        if (path.length) { setJourney(unit, exit, path); break; }
      }
      if (!unit.destination) unit.repathAt = state.time + 2;
    }
    if (unit.destination) move(state, unit, unit.destination, dt);
  }
}
