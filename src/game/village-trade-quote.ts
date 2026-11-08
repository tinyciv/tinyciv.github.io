import { constructionEdges } from './builders';
import { entityStore } from './entity-store';
import { forbiddenRevision } from './forbidden-zones';
import { findPath, hasStaticPath, movementMultiplier, withNavigationFrame } from './pathfinding';
import { playerFaction } from './player-context';
import { factionHasDevelopedResource } from './resource-development';
import { MERCHANT_SPEED, tradeConnection, villageTradePayout } from './trade';
import { villageCamp, villageRequiredResource } from './villages';
import { worldRevisions, worldStructureRevision } from './world-revisions';
import { buildingReady, distance, type Building, type GameState, type NeutralVillage, type Point, type ResourceWorkKind } from './types';

export interface VillageTradeQuote {
  requiredResource: ResourceWorkKind;
  hasResource: boolean;
  routeAvailable: boolean;
  withoutResourceGoldPer30: number;
  withResourceGoldPer30: number;
  originId?: number;
  /** Mean distance of the outgoing and homeward legs. */
  distance?: number;
  roundTripSeconds?: number;
}
interface TravelQuote {
  originId: number;
  outboundDistance: number;
  returnDistance: number;
  roundTripSeconds: number;
}
interface CachedTravel {
  world: GameState['world'];
  tiles: GameState['world']['tiles'];
  key: string;
  travel?: TravelQuote;
}
const journeys = new WeakMap<GameState, Map<string, CachedTravel>>();
const TURNAROUND_SECONDS = 1.5;

function travelLeg(state: GameState, start: Point, destination: Building, faction: number): { end: Point; distance: number; seconds: number } | undefined {
  const end = constructionEdges(state, destination, true).sort((a, b) => distance(start, a) - distance(start, b))
    .find(goal => hasStaticPath(state, start, goal, faction, true));
  if (!end) return;
  const path = findPath(state, start, end, faction, false, undefined, undefined, undefined, true, true);
  if (!path.length || distance(path[path.length - 1], end) > .18) return;
  let previous = start, length = 0, seconds = 0;
  for (const point of path) {
    const segment = distance(previous, point);
    // Paths join tile centers. Half of a segment lies in each endpoint's
    // terrain; this includes forest, ford, ditch and existing road speeds.
    const a = movementMultiplier(state, previous.x, previous.y), b = movementMultiplier(state, point.x, point.y);
    if (a <= 0 || b <= 0) return;
    length += segment; seconds += segment / (2 * MERCHANT_SPEED) * (1 / a + 1 / b);
    previous = point;
  }
  return { end, distance: length, seconds };
}

function planTravel(state: GameState, camp: Building, faction: number, cities: Building[], activeOrigin?: number): TravelQuote | undefined {
  const existing = cities.find(city => city.id === activeOrigin);
  const candidates = existing ? [existing] : [...cities].sort((a, b) => distance(a, camp) - distance(b, camp) || a.id - b.id);
  return withNavigationFrame(state, () => {
    for (const city of candidates) {
      const connected = tradeConnection(state, city, camp);
      if (!connected) continue;
      const outbound = travelLeg(state, connected.start, camp, faction);
      if (!outbound) continue;
      const returning = travelLeg(state, outbound.end, city, faction);
      if (!returning) continue;
      return { originId: city.id, outboundDistance: outbound.distance, returnDistance: returning.distance,
        roundTripSeconds: outbound.seconds + returning.seconds + TURNAROUND_SECONDS * 2 };
    }
  });
}

/** Potential income from one caravan on the current route, before or after an
 * agreement. Payments use the same payout function as actual arrivals. This
 * does not dispatch a merchant or count unfinished journeys as earned gold. */
export function villageTradeQuote(state: GameState, village: NeutralVillage, faction = playerFaction(state)): VillageTradeQuote {
  const requiredResource = villageRequiredResource(state, village), hasResource = factionHasDevelopedResource(state, faction, requiredResource);
  const quote: VillageTradeQuote = { requiredResource, hasResource, routeAvailable: false,
    withoutResourceGoldPer30: 0, withResourceGoldPer30: 0 };
  const owner = state.factions.find(candidate => candidate.id === faction), camp = villageCamp(state, village);
  if (!owner || owner.defeated || owner.villageId !== undefined || owner.relation === 'confederated' || village.destroyed || !camp) return quote;
  const cities = state.buildings.filter(city => city.kind === 'palace' && city.faction === faction && buildingReady(city));
  const activeOrigin = state.tradeRoutes?.find(route => route.villageId === village.id && route.faction === faction && route.partner === camp.id)?.origin;
  const revisions = worldRevisions(state.world);
  const key = `${worldStructureRevision(state.world)}:${revisions.sight}:${revisions.geometry}:${entityStore(state).buildings.revision}:${forbiddenRevision(state, faction)}:${activeOrigin ?? ''}`
    + `|${camp.id}:${camp.x}:${camp.y}|${cities.map(city => `${city.id}:${city.x}:${city.y}`).join(',')}`
    + `|${state.factions.map(candidate => `${candidate.id}:${candidate.relation}:${Number(candidate.defeated)}`).join(',')}`;
  let cache = journeys.get(state);
  if (!cache) { cache = new Map(); journeys.set(state, cache); }
  const slot = `${village.id}:${faction}`, previous = cache.get(slot);
  let travel: TravelQuote | undefined;
  if (previous?.world === state.world && previous.tiles === state.world.tiles && previous.key === key) travel = previous.travel;
  else {
    travel = planTravel(state, camp, faction, cities, activeOrigin);
    cache.set(slot, { world: state.world, tiles: state.world.tiles, key, travel });
  }
  if (!travel) return quote;
  const rate = (supplied: boolean) => (villageTradePayout(state, village, faction, travel.outboundDistance, supplied)
    + villageTradePayout(state, village, faction, travel.returnDistance, supplied)) * 30 / travel.roundTripSeconds;
  return { ...quote, routeAvailable: true, originId: travel.originId, distance: (travel.outboundDistance + travel.returnDistance) / 2,
    roundTripSeconds: travel.roundTripSeconds, withoutResourceGoldPer30: rate(false), withResourceGoldPer30: rate(true) };
}
