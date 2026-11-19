import { buildingActivityAvailable } from './building-activity';
import { constructionEdges } from './builders';
import { cityOwnership } from './city-ownership';
import { diplomaticRelationship } from './diplomacy-view';
import { entityStore } from './entity-store';
import { factionTradeActive } from './faction-trade-agreements';
import { forbiddenRevision } from './forbidden-zones';
import { findShortestPathBetween, workNavigationState, withNavigationFrame } from './pathfinding';
import { tradeGoldMultiplier } from './research-bonuses';
import { cityDevelopedResourceCount, cityDevelopedResourceMask } from './resource-development';
import { rustEngine } from './rust-engine';
import { simCore } from './sim-handle';
import { structuresOf, STRUCTURE_ALIVE, STRUCTURE_READY } from './structure-index';
import { buildingReady, distance, type Building, type GameState, type Point } from './types';
import { worldStructureRevision } from './world-revisions';

export function marketplacePlacementAllowed(state: GameState, faction: number, center: Point): boolean {
  const ownership = cityOwnership(state), city = ownership.nearest(center, faction);
  return !!city && !structuresOf(state, faction, STRUCTURE_ALIVE, 'marketplace').some(market => ownership.building(market)?.id === city.id);
}

export function marketplaceCity(state: GameState, market: Building): Building | undefined {
  if (market.kind === 'marketplace' && buildingReady(market)) return cityOwnership(state).building(market);
}

export function marketDestination(city: Building, market: Building): number | undefined {
  const order = market.marketTrade;
  if (order?.city === city.id && order.faction === city.faction) return order.destination;
}

export interface MarketBuildings {
  markets: ReadonlyMap<number, Building>;
  cityLibraries: ReadonlySet<number>;
  factionLibraries: ReadonlySet<number>;
}
const buildingSnapshots = new WeakMap<GameState, MarketBuildings & { until: number; revision: number }>();
export function marketBuildings(state: GameState): MarketBuildings {
  const store = entityStore(state), old = buildingSnapshots.get(state);
  if (old && old.revision === store.buildings.revision && state.time < old.until) return old;
  const markets = new Map<number, Building>(), cityLibraries = new Set<number>(), factionLibraries = new Set<number>();
  const readyMarkets = structuresOf(state, undefined, STRUCTURE_READY, 'marketplace');
  const ownership = readyMarkets.length ? cityOwnership(state) : undefined;
  for (const market of readyMarkets) {
    const city = ownership!.building(market);
    if (city) markets.set(city.id, market);
  }
  if (markets.size) for (const library of store.buildings.query('library')) {
    if (!buildingReady(library)) continue;
    factionLibraries.add(library.faction);
    const city = ownership!.building(library);
    if (city) cityLibraries.add(city.id);
  }
  const snapshot = { markets, cityLibraries, factionLibraries, until: state.time + 1, revision: store.buildings.revision };
  buildingSnapshots.set(state, snapshot);
  return snapshot;
}

export function marketPartnerEligible(state: GameState, city: Building, partner: Building): boolean {
  if (city.id === partner.id || partner.kind !== 'palace' || !buildingReady(partner) || partner.villageId !== undefined) return false;
  if (city.faction === partner.faction) return true;
  const treaty = diplomaticRelationship(state, city.faction, partner.faction);
  if (!factionTradeActive(state, city.faction, partner.faction)) return false;
  const matches = (a: number, b: number) => a === city.id && b === partner.id || a === partner.id && b === city.id;
  return treaty ? matches(treaty.origin, treaty.destination)
    : !!state.factionTrades?.some(agreement => matches(agreement.origin, agreement.partner));
}

interface MarketPath { distance: number; seconds: number }
interface CachedPaths { revision: string; paths: Map<string, MarketPath | undefined> }
const landPaths = new WeakMap<GameState, CachedPaths>();
export function marketLandPath(state: GameState, origin: Building, partner: Building, speed: number): MarketPath | undefined {
  const revision = `${worldStructureRevision(state.world)}:${forbiddenRevision(state)}:${state.diplomacyState?.accessRevision ?? 0}`;
  let cache = landPaths.get(state);
  if (cache?.revision !== revision) landPaths.set(state, cache = { revision, paths: new Map() });
  const key = `${origin.id}:${partner.id}:${origin.faction}:${partner.faction}`;
  if (cache.paths.has(key)) return cache.paths.get(key);
  const path = withNavigationFrame(state, () => {
    const navigation = origin.faction === partner.faction ? state : workNavigationState(state, false, origin.faction, partner.faction);
    const trip = findShortestPathBetween(navigation, constructionEdges(navigation, origin, true), constructionEdges(navigation, partner, true), origin.faction, true);
    if (!trip || !trip.path.length) return;
    let length = 0, previous = trip.from;
    for (const point of trip.path) { length += distance(previous, point); previous = point; }
    return { distance: length, seconds: trip.cost / speed };
  });
  if (cache.paths.size >= 96) cache.paths.delete(cache.paths.keys().next().value!);
  cache.paths.set(key, path);
  return path;
}

const resourceSnapshots = new WeakMap<GameState, { until: number; masks: Map<number, number> }>();
function tradeResources(state: GameState, city: Building): number {
  let snapshot = resourceSnapshots.get(state);
  if (!snapshot || state.time >= snapshot.until) {
    resourceSnapshots.set(state, snapshot = { until: state.time + 1, masks: new Map() });
  }
  const old = snapshot.masks.get(city.id);
  if (old !== undefined) return old;
  const mask = cityDevelopedResourceMask(state, city);
  snapshot.masks.set(city.id, mask);
  return mask;
}

export interface MarketYield {
  outboundGold: number; returnGold: number; science: number; partnerScience: number;
  goldPerMinute: number; sciencePerMinute: number;
}
export function marketQuote(state: GameState, origin: Building, partner: Building, path: MarketPath,
  originResidents: number, partnerResidents: number, originDegree: number, partnerDegree: number): MarketYield {
  const handle = simCore(state).handle, buildings = marketBuildings(state), domestic = origin.faction === partner.faction;
  const faction = state.factions.find(owner => owner.id === origin.faction);
  const originGoods = tradeResources(state, origin), partnerGoods = tradeResources(state, partner);
  // Resolve resource ownership before opening the WASM view.
  const originGrapes = cityDevelopedResourceCount(state, origin, 'grapes');
  const partnerGrapes = cityDevelopedResourceCount(state, partner, 'grapes');
  const input = rustEngine.sim_land_trade_input(handle);
  new Float64Array(rustEngine.memory.buffer, input, 16).set([
    path.distance, originResidents, partnerResidents, originDegree, partnerDegree,
    originGoods, partnerGoods, Number(buildings.cityLibraries.has(origin.id)) + Number(buildings.cityLibraries.has(partner.id)),
    Number(buildings.factionLibraries.has(origin.faction)) | (Number(buildings.factionLibraries.has(partner.faction)) << 1),
    tradeGoldMultiplier(faction), faction?.achievements ?? 0, Number(domestic), path.seconds, path.seconds, originGrapes, partnerGrapes,
  ]);
  const quote = rustEngine.sim_land_trade_quote(handle);
  const [outboundGold, returnGold, science, partnerScience, goldPerMinute, sciencePerMinute] =
    new Float64Array(rustEngine.memory.buffer, quote, 6);
  return { outboundGold, returnGold, science, partnerScience, goldPerMinute, sciencePerMinute };
}

export function setMarketDestination(state: GameState, market: Building, destination: number | null, speed: number): { ok: boolean; message: string } {
  const city = marketplaceCity(state, market);
  if (!city || !buildingActivityAvailable(state, market)) return { ok: false, message: 'Marketplace unavailable.' };
  if (destination === null) {
    delete market.marketTrade;
    return { ok: true, message: '' };
  }
  const partner = entityStore(state).buildings.get(destination);
  if (!partner || !marketPartnerEligible(state, city, partner) || !marketLandPath(state, city, partner, speed))
    return { ok: false, message: 'Land route unavailable.' };
  market.marketTrade = { city: city.id, faction: city.faction, destination };
  return { ok: true, message: '' };
}
