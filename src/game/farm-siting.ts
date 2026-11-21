import { CAMP_FIELD_OFFSETS, expectedFarmDelivery, fieldHarvestFood, FIELD_SPOIL_SECONDS } from './farms';
import { prepareIrrigation } from './irrigation';
import { hasStaticPathBetween, traversable } from './pathfinding';
import { constructionEdges } from './builders';
import { buildingAlignmentQuery } from './placement';
import { farmCityQuery, farmCollectionQuery } from './farm-travel';
import { FARM_COLLECTION_RADIUS, farmCollectionBounds, farmCollectionRangeQuery, granaryYieldMultiplier } from './granaries-native';
import { reliefFootprintAllowed } from './relief';
import { farmResearchYieldMultiplier, grainStorageMultiplier } from './research-bonuses';
import { buildingWithinBorders } from './border-placement';
import { territory } from './borders';
import { farmParcelPreferenceQuery, FARM_CLUSTER_PRODUCTION_BONUS } from './farm-clusters';
import { farmBlockPlacementQuery } from './farm-blocks';
import { farmCanShareTile, hermitCabinOverlaps } from './placement-occupancy';
import { overlapsFallenDefense } from './defense-rebuilding';
import { type Building, type GameState, type Point, buildingReady, buildingWidth, buildingHeight } from './types';

/** Each completed collection point extends the city's practical farm area. */
export const AUTOMATIC_FARM_RADIUS = FARM_COLLECTION_RADIUS;
const CLEARABLE = new Set(['none', 'forest', 'jungle', 'swamp']);
export interface FarmSitePlan { point: Point; harvest: number; irrigatedPlots: number; walkingDistance: number; expectedHarvest: number; }
interface FarmSiteCandidate extends FarmSitePlan { soilHarvest: number; streetPenalty: number; layout: number; }
interface RankedFarmSite { site: FarmSitePlan; production: number; layout: number; soilHarvest: number; }
export type FarmSiteSearchResult = { done: false } | { done: true; plan?: FarmSitePlan };
export interface AutomaticFarmSiteSearch {
  /** A deterministic candidate allowance; no gameplay time or RNG is consumed. */
  advance(maxCandidates: number): FarmSiteSearchResult;
}

function farmSiteReader(state: GameState, palace: Building, exactOwnership = false): (x: number, y: number) => FarmSiteCandidate | undefined {
  const { width, height } = state.world, occupied = new Set<number>(), roads = new Set<number>();
  for (const building of state.buildings) {
    if (building.hp > 0 && building.faction === palace.faction && building.kind === 'road') roads.add(building.y * width + building.x);
    if (building.hp <= 0 && !(building.kind === 'fort' && building.fort?.destroyed)
      || farmCanShareTile(building, palace.faction)) continue;
    for (let y = building.y; y < building.y + buildingHeight(building); y++)
      for (let x = building.x; x < building.x + buildingWidth(building); x++) occupied.add(y * width + x);
  }
  for (const field of state.fields ?? []) occupied.add(field.y * width + field.x);
  const collection = farmCollectionQuery(state, palace), inRange = farmCollectionRangeQuery(state, palace), coverage = prepareIrrigation(state).coverage;
  const faction = state.factions.find(faction => faction.id === palace.faction);
  const shelfLife = FIELD_SPOIL_SECONDS * grainStorageMultiplier(faction);
  const foodBonus = farmResearchYieldMultiplier(faction) * (1 + (faction?.villageBonuses?.food ?? 0));
  const farmCity = farmCityQuery(state, palace.faction, exactOwnership);
  const alignment = buildingAlignmentQuery(state, palace.faction), origin = { x: palace.x + 1, y: palace.y + 1 };
  const borders = state.villages?.length ? territory(state) : undefined;
  return (x, y) => {
    if (!Number.isInteger(x) || !Number.isInteger(y)
      || x < 0 || y < 0 || x >= width || y >= height) return;
    if (!inRange(x, y)) return;
    if (!buildingWithinBorders(state, 'camp', x, y, palace.faction, borders) || farmCity({ x, y })?.id !== palace.id
      || !reliefFootprintAllowed(state.world, x, y, 1)) return;
    let harvest = 0, soilHarvest = 0, irrigatedPlots = 0, streetPenalty = 1;
    for (const [dx, dy] of CAMP_FIELD_OFFSETS) {
      const px = x + dx, py = y + dy, cell = py * width + px, tile = state.world.tiles[cell];
      if (!tile || occupied.has(cell) || overlapsFallenDefense(state, 'camp', px, py) || !CLEARABLE.has(tile.overlay)
        || !traversable(state.world, px, py) || hermitCabinOverlaps(state, px, py)) return;
      const irrigated = !!coverage[cell];
      irrigatedPlots += Number(irrigated);
      const baseHarvest = fieldHarvestFood(state.world, px, py);
      soilHarvest += baseHarvest;
      harvest += baseHarvest * (irrigated ? tile.terrain === 'desert' ? 3 : 2 : 1) * foodBonus
        * granaryYieldMultiplier(state, palace.faction, px, py);
      if (Math.hypot(px + .5 - origin.x, py + .5 - origin.y) <= 6) {
        if (roads.has(cell)) streetPenalty = 1.2;
        else if (streetPenalty < 1.1) {
          for (let sy = Math.max(0, py - 1); sy <= Math.min(height - 1, py + 1); sy++)
            for (let sx = Math.max(0, px - 1); sx <= Math.min(width - 1, px + 1); sx++)
              if (roads.has(sy * width + sx)) streetPenalty = 1.1;
        }
      }
    }
    if (harvest <= 0) return;
    const walkingDistance = collection({ x, y }).walkingDistance, expectedHarvest = harvest * expectedFarmDelivery(walkingDistance, shelfLife);
    if (expectedHarvest <= 0) return;
    const layout = -Math.abs(walkingDistance - 5) * .55 + alignment(x, y) * .2;
    return { point: { x, y }, harvest, irrigatedPlots, walkingDistance, expectedHarvest, soilHarvest, streetPenalty, layout };
  };
}

/** Recheck only the selected plot against current geometry before paying.
 * A cursor may retain an older ranking, never an authorization to overlap a
 * new order, cross a closed route, or borrow another city's farm territory. */
export function validateAutomaticFarmSite(state: GameState, palace: Building, point: Point): FarmSitePlan | undefined {
  if (palace.kind !== 'palace' || !buildingReady(palace) || !state.buildings.includes(palace)) return;
  const candidate = farmSiteReader(state, palace, true)(point.x, point.y);
  if (!candidate || !farmBlockPlacementQuery(state).canAdd(point).ok
    || !hasStaticPathBetween(state, constructionEdges(state, palace, true), [{ x: point.x + .5, y: point.y + .5 }], palace.faction, true)) return;
  const { streetPenalty: _street, layout: _layout, soilHarvest: _soil, ...plan } = candidate;
  return plan;
}

/** Fill the most productive available crop tiles first. The yield estimate
 * uses the same completed-ditch bitmap as actual harvests: partial coverage is
 * counted per plot and overlapping ditches never stack. Completed owned ditches can
 * share farmland; roads reserve their cells for travel.
 * Clearable trees have no siting penalty: reserving the farm clears its whole
 * footprint. Walking distance and ripened-food expiry discount production:
 * land across a lake is not nearby merely because it looks nearby. Within
 * six tiles of the palace, prefer keeping streets and their frontages free for
 * urban buildings. Expected delivery and street access establish the winning
 * soil tier. Within that tier, completing rectangular parcels with one-cell
 * gaps receives at most a 20% selection bonus. */
export function planAutomaticFarmSite(state: GameState, palace: Building): FarmSitePlan | undefined {
  const result = createAutomaticFarmSiteSearch(state, palace).advance(Infinity);
  return result.done ? result.plan : undefined;
}

/** A governor owns this cursor until its farm action completes. Unrelated
 * construction never discards progress. Read phases retain the original row
 * and scoring order; the final selected plot is checked live before purchase.
 * On a changing world an older valid ranking may win until the next search. */
export function createAutomaticFarmSiteSearch(state: GameState, palace: Building): AutomaticFarmSiteSearch {
  const world = state.world, tiles = world.tiles, width = world.width, height = world.height;
  const faction = palace.faction, owner = state.factions.find(value => value.id === faction), startedAt = state.time;
  const originX = palace.x, originY = palace.y;
  const { left, right, top, bottom } = farmCollectionBounds(state, palace);
  const candidates: FarmSiteCandidate[] = [];
  const bestBySoil = new Map<number, RankedFarmSite>();
  let phase: 'prepare' | 'scan' | 'layout' | 'score' | 'done' = 'prepare';
  let read: ReturnType<typeof farmSiteReader>, preference: ReturnType<typeof farmParcelPreferenceQuery>;
  let geometry: ReturnType<typeof farmBlockPlacementQuery>;
  let x = left, y = top, scoreIndex = 0, baseline: RankedFarmSite | undefined, best: FarmSitePlan | undefined;
  const outranks = (candidate: RankedFarmSite, current?: RankedFarmSite): boolean => !current
    || candidate.production > current.production + 1e-7
    || Math.abs(candidate.production - current.production) < 1e-7
      && (candidate.site.irrigatedPlots > current.site.irrigatedPlots
        || candidate.site.irrigatedPlots === current.site.irrigatedPlots && candidate.layout > current.layout);
  return { advance(maxCandidates) {
    if (phase === 'done') return { done: true, plan: best };
    // A replaced world or captured/moved palace invalidates this city's job;
    // ordinary terrain/building edits are handled by live final validation.
    if (state.world !== world || world.tiles !== tiles || world.width !== width || world.height !== height
      || state.time < startedAt || !state.buildings.includes(palace) || state.factions.find(value => value.id === faction) !== owner
      || palace.kind !== 'palace' || !buildingReady(palace) || palace.faction !== faction || palace.x !== originX || palace.y !== originY) {
      phase = 'done'; return { done: true };
    }
    if (!(maxCandidates > 0)) return { done: false };
    const bounded = Number.isFinite(maxCandidates), budget = Math.floor(maxCandidates);
    if (phase === 'prepare') {
      read = farmSiteReader(state, palace); phase = 'scan';
      if (bounded) return { done: false };
    }
    if (phase === 'scan') {
      for (let checked = 0; checked < budget && y <= bottom; checked++) {
        const candidate = read(x, y); if (candidate) candidates.push(candidate);
        if (++x > right) { x = left; y++; }
      }
      if (y <= bottom) return { done: false };
      phase = 'layout'; if (bounded) return { done: false };
    }
    if (phase === 'layout') {
      preference = farmParcelPreferenceQuery(state, palace, candidates.map(site => site.point));
      geometry = farmBlockPlacementQuery(state); phase = 'score';
      if (bounded) return { done: false };
    }
    if (phase === 'score') {
      // Shape/parcel checks cost more than the cheap grid filter. Give scoring
      // its own smaller allowance, with the same stable row-order ties.
      const allowance = bounded ? Math.min(budget, 128) : Infinity;
      for (let checked = 0; checked < allowance && scoreIndex < candidates.length; checked++, scoreIndex++) {
        const { streetPenalty, soilHarvest, layout, ...site } = candidates[scoreIndex];
        if (!geometry.canAdd(site.point).ok) continue;
        const unweighted = { site, soilHarvest, layout, production: site.expectedHarvest / streetPenalty };
        if (outranks(unweighted, baseline)) baseline = unweighted;
        const production = unweighted.production * (1 + preference(site.point.x, site.point.y) * FARM_CLUSTER_PRODUCTION_BONUS);
        const weighted = { ...unweighted, production };
        if (outranks(weighted, bestBySoil.get(soilHarvest))) bestBySoil.set(soilHarvest, weighted);
      }
      if (scoreIndex < candidates.length) return { done: false };
      if (baseline) best = bestBySoil.get(baseline.soilHarvest)?.site;
      phase = 'done'; return { done: true, plan: best };
    }
    return { done: false };
  } };
}
