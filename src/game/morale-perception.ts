import { decisionDue, type DecisionClock } from './decision-schedule';
import type { GameState, Unit } from './types';
import { hasStaticPath, withNavigationFrame } from './pathfinding';
import { nearbyUnits } from './spatial';

export interface MoralePerception {
  enemies: number;
  allies: number;
  routingAllies: number;
  fightingUntil: number;
  firstEnemyFaction: number;
  shelter: boolean;
}
interface Observation extends DecisionClock { perception?: MoralePerception }
const perceptions = new WeakMap<GameState, WeakMap<Unit, Observation>>();
interface CivilianObservation extends DecisionClock { threat?: Unit }
const civilianObservations = new WeakMap<GameState, WeakMap<Unit, CivilianObservation>>();
const CIVILIAN_THREAT_RADIUS = 2;

/** Civilians fear enemies that can reach their space. Neighborhood, sight and
 * reachability work share the capped decision cadence. A known dead, hidden or
 * newly peaceful threat is discarded immediately without another search. */
export function civilianThreat(state: GameState, unit: Unit,
  hostile: (a: number, b: number) => boolean, visible: (observer: Unit, target: Unit) => boolean): Unit | undefined {
  if (unit.inside || unit.hp <= 0 || unit.kind !== 'worker' && unit.kind !== 'merchant') return;
  let observations = civilianObservations.get(state);
  if (!observations) { observations = new WeakMap(); civilianObservations.set(state, observations); }
  let observation = observations.get(unit);
  if (!observation) { observation = {}; observations.set(unit, observation); }
  if (decisionDue(observation, state.time, unit.id)) {
    observation.threat = withNavigationFrame(state, () => {
      let nearest: Unit | undefined, best = CIVILIAN_THREAT_RADIUS ** 2;
      for (const other of nearbyUnits(state, unit, CIVILIAN_THREAT_RADIUS)) {
        if (other.hp <= 0 || other.inside || other.attack <= 0 || !hostile(unit.faction, other.faction)) continue;
        const distance = (other.x - unit.x) ** 2 + (other.y - unit.y) ** 2;
        if (distance > best || !visible(unit, other) || !hasStaticPath(state, other, unit, other.faction)) continue;
        nearest = other; best = distance;
      }
      return nearest;
    });
  }
  const threat = observation.threat;
  return threat && threat.hp > 0 && !threat.inside && hostile(unit.faction, threat.faction) ? threat : undefined;
}

/** Combat execution still validates a retained target before attacking. */
export function hasMoraleThreat(state: GameState, unit: Unit): boolean {
  return (perceptions.get(state)?.get(unit)?.perception?.enemies ?? 0) > 0;
}

/** Cache perception, while morale integration and hit reactions stay continuous.
 * State changes are read together at the next scheduled sample; they no longer
 * require per-frame invalidation/diplomacy scans or bypass the frequency cap. */
export function senseMorale(state: GameState, unit: Unit, _leader: Unit | undefined,
  _pressure: { losses: number; enemyLosses: number }, sample: () => MoralePerception): MoralePerception {
  let observations = perceptions.get(state);
  if (!observations) { observations = new WeakMap(); perceptions.set(state, observations); }
  let observation = observations.get(unit);
  if (!observation) { observation = {}; observations.set(unit, observation); }
  if (decisionDue(observation, state.time, unit.id)) observation.perception = sample();
  return observation.perception!;
}
