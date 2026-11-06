import { CHECK_INTERVAL } from './work-cadence';
import { decisionDue, type DecisionClock } from './decision-schedule';
import { indexedBuilding, nearbyUnits } from './spatial';
import { wakeCourier } from './courier-sleep';
import { deliverFoodCargo, expireFoodCargo } from './food-cargo';
import { buildingWorkForbidden } from './forbidden-work';
import { isForbidden } from './forbidden-zones';
import { constructionEdges } from './builders';
import { releaseAttackSpot } from './engagement';
import { canWalk, findPath, hasStaticPath, invalidateNavigation } from './pathfinding';
import { buildingReady, buildingWidth, buildingHeight, distance, type Building, type GameState, type Point, type Unit } from './types';
import { civilianThreat } from './morale-perception';

const escapeClocks = new WeakMap<Unit, DecisionClock>();

type Move = (state: GameState, unit: Unit, goal: Point, dt: number) => void;

/** Damage interrupts the job immediately; resources already carried stay with the peasant. */
export function panicCivilian(state: GameState, unit: Unit, threat: Point): void {
  if (unit.kind !== 'worker' && unit.kind !== 'merchant' || unit.hp <= 0) return;
  unit.civilianPanic = { ...unit.civilianPanic, until: state.time + 3, threat: { x: threat.x, y: threat.y }, previousOrder: unit.civilianPanic?.previousOrder ?? unit.order };
  wakeCourier(state, unit);
  unit.morale = 0; unit.order = 'flee'; unit.routed = true; unit.target = undefined;
  unit.destination = undefined; unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
  unit.forcedAttack = undefined; releaseAttackSpot(state, unit);
  if (unit.kind === 'merchant') return;
  for (const field of state.fields ?? []) if (field.claimedBy === unit.id) delete field.claimedBy;
  unit.field = undefined;
  if (unit.collector) unit.collectPhase = 'returning';
  for (const building of state.buildings) {
    if (building.construction?.builderId === unit.id) {
      const site = building.construction;
      if (!site.waitingForBuilder) site.pausedAt = state.time;
      site.waitingForBuilder = true; site.cleared = false; delete site.builderId;
      invalidateNavigation(state);
    }
    if (building.repairerId === unit.id) delete building.repairerId;
  }
  for (const order of state.treeClearings ?? []) if (order.workerId === unit.id) delete order.workerId;
  unit.buildSite = undefined; unit.repairSite = undefined; unit.clearTree = undefined; unit.clearProgress = undefined;
  if (unit.builder) unit.buildPhase = 'returning';
}

interface ShelterObservation { sampledAt: number; threat?: Unit }
const shelterObservations = new WeakMap<GameState, Map<Building, ShelterObservation>>();

/** Everyone in the same settlement shares a cheap check of the actual exits.
 * Enemies behind unbreached walls or water do not indefinitely trap civilians. */
function shelterThreat(state: GameState, unit: Unit, shelter: Building, hostile: (a: number, b: number) => boolean,
  visible: (observer: Unit, target: Unit) => boolean): Unit | undefined {
  let observations = shelterObservations.get(state);
  if (!observations) { observations = new Map(); shelterObservations.set(state, observations); }
  const old = observations.get(shelter);
  if (old && state.time >= old.sampledAt && state.time + 1e-9 < old.sampledAt + CHECK_INTERVAL)
    return old.threat && old.threat.hp > 0 && !old.threat.inside && hostile(unit.faction, old.threat.faction) ? old.threat : undefined;
  const doors = constructionEdges(state, shelter, true), observer = { ...unit, inside: false };
  let threat: Unit | undefined;
  for (const enemy of nearbyUnits(state, { x: shelter.x + buildingWidth(shelter) / 2, y: shelter.y + buildingHeight(shelter) / 2 }, 9)) {
    if (enemy.hp <= 0 || enemy.inside || enemy.attack <= 0 || !hostile(unit.faction, enemy.faction)) continue;
    if (doors.some(door => {
      observer.x = door.x; observer.y = door.y;
      return distance(enemy, door) <= 7 && visible(observer, enemy) && hasStaticPath(state, enemy, door, enemy.faction);
    })) { threat = enemy; break; }
  }
  observations.set(shelter, { sampledAt: state.time, threat });
  return threat;
}
function clearPanicJourney(unit: Unit): void {
  unit.destination = undefined; unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0; unit.moving = false;
}
function enterShelter(state: GameState, unit: Unit, shelter: Building): void {
  unit.inside = true; unit.civilianPanic!.shelter = shelter.id; delete unit.civilianPanic!.destinationShelter;
  unit.x = shelter.x + buildingWidth(shelter) / 2; unit.y = shelter.y + buildingHeight(shelter) / 2;
  clearPanicJourney(unit);
  if (unit.collector && (unit.cargo ?? 0) > 0) {
    unit.cargoBatches ??= [{ amount: unit.cargo!, expiresAt: unit.cargoExpiresAt ?? Infinity }];
    deliverFoodCargo(state, shelter, unit); unit.cargoField = undefined;
  }
}

/** Flee to a reachable settlement, physically enter it, and wait for safe exits. */
export function updateCivilianPanic(state: GameState, unit: Unit, dt: number, move: Move,
  hostile: (a: number, b: number) => boolean, visible: (observer: Unit, target: Unit) => boolean): boolean {
  if (unit.kind !== 'worker' && unit.kind !== 'merchant') return false;
  expireFoodCargo(state, unit);
  let threat = civilianThreat(state, unit, hostile, visible);
  if (!unit.civilianPanic && threat) panicCivilian(state, unit, threat);
  const panic = unit.civilianPanic;
  if (!panic) return false;
  let shelter = indexedBuilding(state, panic.shelter ?? (unit.inside ? unit.home : undefined));
  if (shelter && (shelter.kind !== 'palace' || shelter.faction !== unit.faction || !buildingReady(shelter))) shelter = undefined;
  if (unit.inside) {
    if (shelter) { panic.shelter = shelter.id; threat = shelterThreat(state, unit, shelter, hostile, visible); }
    else {
      // A captured or destroyed building cannot keep hiding former residents.
      const previousShelter = panic.shelter ?? unit.home;
      unit.inside = false; delete panic.shelter; clearPanicJourney(unit);
      const exit = indexedBuilding(state, previousShelter);
      const door = exit && constructionEdges(state, exit, true).find(point => canWalk(state, point.x, point.y, unit.faction, undefined, true));
      if (door) { unit.x = door.x; unit.y = door.y; }
    }
  }
  if (threat) { panic.until = Math.max(panic.until, state.time + 2); panic.threat = { x: threat.x, y: threat.y }; unit.morale = 0; }
  if (state.time >= panic.until) unit.morale = Math.min(100, unit.morale + dt * 15);
  if (state.time >= panic.until && unit.morale >= 50 && (unit.inside || panic.destinationShelter === undefined) && !state.factions.find(faction => faction.id === unit.faction)?.defeated) {
    if (unit.inside && shelter) {
      if (unit.kind === 'worker' && shelter.id === unit.home) {
        if (unit.builder) unit.buildPhase = 'idle';
        if (unit.collector) unit.collectPhase = 'idle';
      } else {
        const door = constructionEdges(state, shelter, true)[0];
        if (!door) return true;
        unit.x = door.x; unit.y = door.y; unit.inside = false;
      }
    }
    unit.order = panic.previousOrder === 'flee' ? 'work' : panic.previousOrder;
    unit.civilianPanic = undefined; unit.routed = false; unit.routOrder = undefined;
    clearPanicJourney(unit);
    return false;
  }
  unit.order = 'flee';
  if (unit.inside) return true;
  // Physical arrival hides the civilian immediately, before another exposed idle frame.
  shelter = indexedBuilding(state, panic.destinationShelter);
  if (shelter && (shelter.kind !== 'palace' || shelter.faction !== unit.faction || !buildingReady(shelter))) shelter = undefined;
  if (shelter && constructionEdges(state, shelter, true).some(door => distance(unit, door) <= .25)) {
    enterShelter(state, unit, shelter); return true;
  }
  let escapeClock = escapeClocks.get(unit);
  if (!escapeClock) { escapeClock = {}; escapeClocks.set(unit, escapeClock); }
  const needsEscape = !unit.destination || isForbidden(state, unit.destination.x, unit.destination.y, unit.faction)
    || state.time >= (unit.repathAt ?? 0) && !unit.path?.length || !!threat && distance(unit.destination, threat) < 3;
  if (needsEscape && decisionDue(escapeClock, state.time, unit.id)) {
    const edges = state.buildings.filter(building => building.kind === 'palace' && building.faction === unit.faction && buildingReady(building) && !buildingWorkForbidden(state, building))
      .flatMap(palace => constructionEdges(state, palace, true).map(point => ({ ...point, palace })));
    edges.sort((a, b) => distance(unit, a) - distance(unit, b) + (threat ? Math.max(0, 6 - distance(a, threat)) * 8 - Math.max(0, 6 - distance(b, threat)) * 8 : 0));
    clearPanicJourney(unit); delete panic.destinationShelter;
    const fleeingFrom = threat ?? panic.threat;
    const home = edges.find(edge => (!threat || distance(unit, threat) >= 4 ||
      (edge.x - unit.x) * (unit.x - threat.x) + (edge.y - unit.y) * (unit.y - threat.y) >= 0)
      && (distance(unit, edge) < .25 || findPath(state, unit, edge, unit.faction, false, undefined, undefined, undefined, false, true).length > 0));
    if (home) {
      unit.destination = { x: home.x, y: home.y }; panic.destinationShelter = home.palace.id;
      if (distance(unit, home) <= .25) { enterShelter(state, unit, home.palace); return true; }
    } else {
      const angle = Math.atan2(unit.y - fleeingFrom.y, unit.x - fleeingFrom.x);
      for (const turn of [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI]) {
        const point = { x: Math.floor(unit.x + Math.cos(angle + turn) * 4) + .5, y: Math.floor(unit.y + Math.sin(angle + turn) * 4) + .5 };
        if (canWalk(state, point.x, point.y, unit.faction, undefined, true) && findPath(state, unit, point, unit.faction, false, undefined, undefined, undefined, false, true).length) { unit.destination = point; break; }
      }
    }
    if (unit.destination) {
      unit.path = findPath(state, unit, unit.destination, unit.faction, false, undefined, undefined, undefined, false, true); unit.pathGoal = { ...unit.destination };
    }
    unit.repathAt = state.time + 1;
  }
  if (unit.destination && distance(unit, unit.destination) > .18) move(state, unit, unit.destination, dt);
  return true;
}
