import { rustEngine } from './rust-engine';
import { simCore, SimSlot } from './sim-handle';
import { entityStore, BUILDING_KIND_CODES, UNIT_KIND_CODES } from './entity-store';
import { structuresOf, STRUCTURE_ALIVE } from './structure-index';
import { constructionEdges } from './builders';
import { offensiveBuildingTargetable } from './building-targeting';
import { nearbyBuildings, nearbyUnits } from './spatial';
import { nativeMoveLayers, canMove, canWalk, traversable, wallBreachingNavigation, withNavigationFrame, findPath, findShortestPathBetween } from './pathfinding';
import { atWar } from './relations';
import { factionById, playerFaction, isHumanFaction } from './player-context';
import { researchLevel } from './research';
import { desiredRetinueSize, interruptOutboundTraining } from './archery';
import { invalidateDecisions } from './decision-schedule';
import { setMarchCollisionGroup } from './movement-native';
import { structureChangeRevision } from './simulation-reads';
import { worldStructureRevision } from './world-revisions';
import { requestFieldCannonDecision } from './field-cannons-native';
import { buildingWidth, buildingHeight, buildingPresent, isRetinueMember, unitMaxHp, type Building, type Faction, type GameState, type OffensiveState, type Point, type Unit } from './types';

const HEADER = 8, STRIDE = 7, MEMBER = 9;
export interface OffensiveDirective { mode: number; goal: Point; target?: number; recover: boolean; marchSpeed: number }
interface Bridge {
  next: number;
  directives: Map<number, OffensiveDirective>;
  routeRequests: Map<number, { from: Point; revision: string; at: number }>;
}
const bridges = new SimSlot<Bridge>();
const bridge = (state: GameState): Bridge => bridges.get(state) ?? bridges.set(state, { next: -Infinity, directives: new Map(), routeRequests: new Map() });
const ordinaryMember = (unit: Unit): boolean => isRetinueMember(unit) && !unit.ranger && !unit.garrison && unit.guardPost === undefined
  && unit.villageId === undefined && unit.marauderPack === undefined && !unit.engineer && unit.embarkedOn === undefined;

function publish(state: GameState, faction: number, values: Float64Array): OffensiveState | undefined {
  if (values[6] > state.time) (state.offensiveReadyAt ??= {})[faction] = values[6];
  else if (state.offensiveReadyAt?.[faction] !== undefined) delete state.offensiveReadyAt[faction];
  const orders = state.offensives ??= [], index = orders.findIndex(order => order.faction === faction);
  if (!values[0]) { if (index >= 0) orders.splice(index, 1); return; }
  const order: OffensiveState = { faction, leader: values[7], phase: values[0] === 1 ? 'rally' : values[0] === 2 ? 'attack' : 'captured',
    rally: { x: values[1], y: values[2] }, objective: { x: values[3], y: values[4] } };
  if (index >= 0) orders[index] = order; else orders.push(order);
  return order;
}

export function offensiveStatus(state: GameState, faction = playerFaction(state)): OffensiveState | undefined {
  const mirrored = state.offensives?.find(order => order.faction === faction);
  if (mirrored) return mirrored;
  const pointer = rustEngine.sim_offensive_status(simCore(state).handle, faction);
  return publish(state, faction, new Float64Array(rustEngine.memory.buffer, pointer, HEADER));
}
export const isOffensiveMember = (state: GameState, unit: Unit): boolean => ordinaryMember(unit)
  && !!state.offensives?.some(order => order.faction === unit.faction && order.phase !== 'captured');

export function offensiveCooldownMessage(state: GameState, faction: number): string {
  const seconds = Math.ceil((state.offensiveReadyAt?.[faction] ?? 0) - state.time);
  return seconds > 0 ? `Offensive ready in ${seconds}s.` : '';
}

export function beginOffensive(state: GameState, rally: Point, objective: Point, faction = playerFaction(state)): { ok: boolean; message: string } {
  const owner = factionById(state, faction), leader = entityStore(state).units.queryFaction('leader', faction).find(u => u.hp > 0);
  if (state.gameOver || owner?.defeated || !leader || leader.order === 'flee' || leader.embarkedOn !== undefined) return { ok: false, message: 'Choose an available Leader.' };
  if (!researchLevel(owner, 'officerCorps')) return { ok: false, message: 'Research Officer Corps first.' };
  const cooldown = offensiveCooldownMessage(state, faction);
  if (cooldown) return { ok: false, message: cooldown };
  const hostileObjective = traversable(state.world, objective.x, objective.y) && entityStore(state).buildings.query('building').some(building => building.hp > 0
    && atWar(state, faction, building.faction) && offensiveBuildingTargetable(building)
    && objective.x >= building.x && objective.x < building.x + buildingWidth(building)
    && objective.y >= building.y && objective.y < building.y + buildingHeight(building));
  if (![rally.x, rally.y, objective.x, objective.y].every(Number.isFinite)
    || !canWalk(state, rally.x, rally.y, faction) || !canWalk(state, objective.x, objective.y, faction) && !hostileObjective) return { ok: false, message: 'Place the flags on reachable ground.' };
  const handle = simCore(state).handle;
  const began = rustEngine.sim_offensive_begin(handle, faction, leader.id, rally.x, rally.y, objective.x, objective.y, 1);
  const statusPointer = rustEngine.sim_offensive_status(handle, faction);
  publish(state, faction, new Float64Array(rustEngine.memory.buffer, statusPointer, HEADER));
  if (!began) return { ok: false, message: offensiveCooldownMessage(state, faction) || 'The offensive could not begin.' };
  const value = bridge(state); value.next = -Infinity; value.routeRequests.delete(faction);
  if (leader.infantryFormation) leader.infantryFormation.active = false;
  for (const unit of entityStore(state).units.queryFaction('retinue', faction)) if (ordinaryMember(unit)) {
    interruptOutboundTraining(state, unit);
    unit.infantryDrillLeader = undefined; unit.forcedAttack = undefined; unit.attackReturn = undefined; unit.recallIssuedAt = undefined;
    unit.defensiveAnchor = undefined; unit.defensiveThreat = undefined;
    unit.target = undefined; unit.destination = undefined; unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
    if (unit.order !== 'flee') unit.order = 'follow';
  }
  invalidateDecisions(state);
  return { ok: true, message: 'Offensive ordered.' };
}

export function cancelOffensive(state: GameState, faction = playerFaction(state)): void {
  rustEngine.sim_offensive_cancel(simCore(state).handle, faction);
  state.offensives = state.offensives?.filter(order => order.faction !== faction);
  const value = bridge(state); value.next = -Infinity; value.routeRequests.delete(faction);
  for (const unit of entityStore(state).units.queryFaction('retinue', faction)) if (ordinaryMember(unit)) {
    value.directives.delete(unit.id);
    setMarchCollisionGroup(unit);
    unit.target = undefined; unit.destination = undefined; unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0; unit.forcedAttack = undefined;
    if (unit.order !== 'flee') unit.order = unit.retinueStance === 'hold' ? 'hold' : 'follow';
    if (unit.kind === 'fieldCannon') requestFieldCannonDecision(state, unit);
  }
  invalidateDecisions(state);
}

function updateMarchRoute(state: GameState, handle: number, value: Bridge, order: OffensiveState): void {
  const pointer = rustEngine.sim_offensive_route_start(handle, order.faction);
  if (!pointer) return;
  const [x, y] = new Float64Array(rustEngine.memory.buffer, pointer, 2);
  const previous = value.routeRequests.get(order.faction);
  const revision = `${worldStructureRevision(state.world)}:${structureChangeRevision(state)}:${state.diplomacyState?.accessRevision ?? 0}`;
  if (previous && (state.time - previous.at < 2
    || previous.revision === revision && previous.from.x === x && previous.from.y === y)) return;
  const from = { x, y }, to = order.objective;
  const planning = wallBreachingNavigation(state, { kind: 'offensive', faction: order.faction, hostile: owner => atWar(state, order.faction, owner) });
  const route = withNavigationFrame(planning, () =>
    canMove(planning, from, to, order.faction) ? [to] : findPath(planning, from, to, order.faction, true));
  const input = rustEngine.sim_offensive_route_input(handle, route.length);
  const points = new Float64Array(rustEngine.memory.buffer, input, route.length * 2);
  route.forEach((point, index) => points.set([point.x, point.y], index * 2));
  rustEngine.sim_offensive_set_route(handle, order.faction, route.length);
  value.routeRequests.set(order.faction, { from, revision, at: state.time });
}

/** Sample the indexed retinue and hostile contacts near members and the
 * objective twice a second. Rust makes every order. */
export function updateOffensives(state: GameState): void {
  const value = bridge(state);
  if (state.time < value.next) return;
  const handle = simCore(state).handle, store = entityStore(state);
  value.next = state.time + .5;
  for (const id of value.directives.keys()) {
    const unit = store.units.get(id);
    if (unit) setMarchCollisionGroup(unit);
  }
  value.directives.clear();
  for (const faction of state.factions) {
    const pointer = rustEngine.sim_offensive_status(handle, faction.id);
    const order = publish(state, faction.id, new Float64Array(rustEngine.memory.buffer, pointer, HEADER));
    if (!order || order.phase === 'captured') continue;
    const leader = store.units.get(order.leader);
    if (!leader || leader.hp <= 0 || faction.defeated) { cancelOffensive(state, faction.id); continue; }
    updateMarchRoute(state, handle, value, order);
    const members = store.units.queryFaction('retinue', faction.id).filter(u => u.hp > 0 && ordinaryMember(u));
    const observed = new Map<number, Unit | Building>();
    const observe = (point: Point, radius: number): void => {
      for (const target of [...nearbyUnits(state, point, radius), ...nearbyBuildings(state, point, radius)]) {
        if (target.hp > 0 && atWar(state, faction.id, target.faction)
          && ('capacity' in target ? offensiveBuildingTargetable(target) : !target.inside && target.embarkedOn === undefined)) observed.set(target.id, target);
      }
    };
    observe(order.objective, 6);
    // Adjacent soldiers share an observation. A bucket center is at most
    // sqrt(8) tiles from a member; radius9 covers the native 5.5-tile contact.
    const buckets = new Set<string>();
    for (const unit of members) {
      const x = Math.floor(unit.x / 4), y = Math.floor(unit.y / 4), key = `${x},${y}`;
      if (buckets.has(key)) continue; buckets.add(key);
      observe({ x: x * 4 + 2, y: y * 4 + 2 }, 9);
    }
    const enemies = [...observed.values()];
    const layers = nativeMoveLayers(state, faction.id, true);
    rustEngine.sim_offensive_navigation(handle, layers?.engine.handle ?? 0, layers?.grid ?? 0, layers?.blockers ?? 0, layers?.forbidden ?? 0);
    const inputPointer = rustEngine.sim_offensive_input(handle, members.length, enemies.length);
    const input = new Float64Array(rustEngine.memory.buffer, inputPointer, members.length * MEMBER + enemies.length * STRIDE);
    members.forEach((u, index) => input.set([u.id, u.x, u.y, u.hp, Number(u.order === 'flee' || !!u.routed), u.morale,
      Number(!u.inside && !u.training), UNIT_KIND_CODES[u.kind], u.speed], index * MEMBER));
    enemies.forEach((target, index) => {
      const building = 'capacity' in target;
      const footprint = building ? buildingPresent(target) ? 2 : 1 : 0;
      input.set([target.id, target.x, target.y, target.hp, footprint, building ? buildingWidth(target) : 0, building ? buildingHeight(target) : 0], members.length * MEMBER + index * STRIDE);
    });
    const armyCapacity = rustEngine.exploration_ordinary_slots(desiredRetinueSize(faction, leader), faction.rangerCompanions ?? 0);
    const resultPointer = rustEngine.sim_offensive_step(handle, faction.id, state.time, members.length, enemies.length, armyCapacity);
    const count = new Float64Array(rustEngine.memory.buffer, resultPointer, HEADER)[5];
    const result = new Float64Array(rustEngine.memory.buffer, resultPointer, HEADER + count * STRIDE).slice();
    const status = publish(state, faction.id, result);
    for (let index = 0; index < count; index++) {
      const row = HEADER + index * STRIDE, unit = store.units.get(result[row]);
      const mode = result[row + 1], goal = { x: result[row + 2], y: result[row + 3] };
      const directive = { mode, goal, target: result[row + 4] < 0 ? undefined : result[row + 4], recover: !!result[row + 5],
        marchSpeed: result[row + 6] };
      if (status?.phase !== 'captured') {
        value.directives.set(result[row], directive);
        if (unit && unit.order !== 'flee' && !unit.routed && (mode === 1 || mode === 2)) setMarchCollisionGroup(unit, faction.id);
      }
      if (unit?.kind === 'fieldCannon') {
        if (directive.recover) { unit.order = 'follow'; unit.routed = false; unit.routOrder = undefined; unit.routUntil = undefined; }
        if (unit.order !== 'flee') unit.order = status?.phase === 'captured' ? 'follow' : 'hold';
        else if (status?.phase === 'captured') unit.routOrder = 'follow';
        unit.destination = status?.phase === 'captured' ? undefined : directive.goal;
        unit.forcedAttack = undefined; unit.target = directive.target;
        requestFieldCannonDecision(state, unit);
      }
    }
  }
}

export const offensiveDirective = (state: GameState, unit: Unit): OffensiveDirective | undefined => bridge(state).directives.get(unit.id);
export const offensiveReward = (state: GameState, unit: Unit, amount: number): number => isOffensiveMember(state, unit)
  ? rustEngine.sim_offensive_reward(simCore(state).handle, unit.faction, amount) : amount;
const casualties = new WeakMap<GameState, WeakSet<Unit>>();
export function recordOffensiveCasualty(state: GameState, unit: Unit): void {
  if (!isOffensiveMember(state, unit)) return;
  let seen = casualties.get(state); if (!seen) { seen = new WeakSet(); casualties.set(state, seen); }
  if (seen.has(unit)) return; seen.add(unit);
  rustEngine.sim_offensive_casualty(simCore(state).handle, unit.faction);
}

interface OffensiveAiView { targetId: number; goal: Point }
const aiResult = (pointer: number): number[] => Array.from(new Float64Array(rustEngine.memory.buffer, pointer, 8));
const aiView = (result: readonly number[]): OffensiveAiView | undefined => result[0] === 2 && result[1] >= 0
  ? { targetId: result[1], goal: { x: result[6], y: result[7] } } : undefined;

/** Campaign consumers use the retained native target, independently of the
 * Leader's support mission and its ordinary immediate self-defense target. */
export function offensiveAiTarget(state: GameState, faction: number): number | undefined {
  return aiView(aiResult(rustEngine.sim_offensive_ai_status(simCore(state).handle, faction)))?.targetId;
}

/** Encode indexed strategic facts, ask native policy for an objective, and
 * transport its route/flags through the same command used by human Leaders. */
export function updateFactionOffensive(state: GameState, faction: Faction, leader: Unit, home: Building,
  visible: (observer: Unit | Building, target: Unit | Building) => boolean): OffensiveAiView | undefined {
  if (faction.id <= 0 || isHumanFaction(state, faction.id) || faction.villageId !== undefined || faction.defeated
    || faction.relation === 'confederated' || !researchLevel(faction, 'officerCorps')) return;
  const handle = simCore(state).handle;
  if (!rustEngine.sim_offensive_ai_due(handle, faction.id, state.time)) {
    return state.offensives?.some(order => order.faction === faction.id && order.phase !== 'captured')
      ? aiView(aiResult(rustEngine.sim_offensive_ai_status(handle, faction.id))) : undefined;
  }
  const store = entityStore(state), members = store.units.queryFaction('retinue', faction.id).filter(ordinaryMember);
  const observers = [leader, ...members.filter(unit => unit.hp > 0 && !unit.inside)];
  const targets = structuresOf(state, undefined, STRUCTURE_ALIVE, 'palace', 'fort', 'woodenTower', 'tower', 'ballista', 'siegeCannon', 'guardPost', 'militaryAcademy')
    .filter(building => atWar(state, faction.id, building.faction));
  const retainedId = offensiveAiTarget(state, faction.id), retained = retainedId === undefined ? undefined : store.buildings.get(retainedId);
  const allegiance = !retained || retained.hp <= 0 ? -1 : Number(atWar(state, faction.id, retained.faction));
  const homeApproach = constructionEdges(state, home)[0] ?? leader;
  const expected = rustEngine.exploration_ordinary_slots(desiredRetinueSize(faction, leader), faction.rangerCompanions ?? 0);
  const seen = targets.map(target => Number(target.kind === 'palace' || observers.some(observer => visible(observer, target))));
    const layers = nativeMoveLayers(state, faction.id, true);
  rustEngine.sim_offensive_navigation(handle, layers?.engine.handle ?? 0, layers?.grid ?? 0, layers?.blockers ?? 0, layers?.forbidden ?? 0);
  const pointer = rustEngine.sim_offensive_ai_input(handle, members.length, targets.length);
  const input = new Float64Array(rustEngine.memory.buffer, pointer, 13 + members.length * 7 + targets.length * 8);
  input.set([leader.id, leader.x, leader.y, leader.hp, unitMaxHp(leader), leader.morale,
    Number(leader.inside || leader.order === 'flee' || leader.order === 'hold' || !!leader.forcedAttack || leader.embarkedOn !== undefined),
    expected, homeApproach.x, homeApproach.y, 1, 1, allegiance]);
  members.forEach((unit, index) => input.set([unit.id, unit.x, unit.y, unit.hp, unitMaxHp(unit), unit.morale,
    Number(unit.hp <= 0 || unit.inside || !!unit.training || unit.order === 'flee' || !!unit.routed)], 13 + index * 7));
  targets.forEach((target, index) => input.set([target.id, target.x, target.y, buildingWidth(target), buildingHeight(target),
    BUILDING_KIND_CODES[target.kind], target.hp, seen[index]], 13 + members.length * 7 + index * 8));
  let result = aiResult(rustEngine.sim_offensive_ai_select(handle, faction.id, state.time, members.length, targets.length));
  if (result[0] === 4) { cancelOffensive(state, faction.id); return; }
  if (result[0] !== 1) return aiView(result);
  const target = store.buildings.get(result[1]);
  let path: Point[] = [];
  if (target) {
    const navigation = wallBreachingNavigation(state, { kind: 'offensive', faction: faction.id, hostile: owner => atWar(state, faction.id, owner) });
    const journey = withNavigationFrame(navigation, () => findShortestPathBetween(navigation,
      [{ x: Math.floor(leader.x) + .5, y: Math.floor(leader.y) + .5 }], constructionEdges(navigation, target), faction.id));
    if (journey) path = [{ x: leader.x, y: leader.y }, journey.from, ...journey.path];
  }
  const pathPointer = rustEngine.sim_offensive_ai_path_input(handle, path.length);
  const points = new Float64Array(rustEngine.memory.buffer, pathPointer, path.length * 2);
  path.forEach((point, index) => points.set([point.x, point.y], index * 2));
  result = aiResult(rustEngine.sim_offensive_ai_route(handle, faction.id, state.time, path.length));
  if (result[0] !== 3) return;
  const launched = beginOffensive(state, { x: result[4], y: result[5] }, { x: result[2], y: result[3] }, faction.id).ok;
  rustEngine.sim_offensive_ai_feedback(handle, faction.id, state.time, Number(launched));
  return launched ? aiView(aiResult(rustEngine.sim_offensive_ai_status(handle, faction.id))) : undefined;
}
