import { CAMP_FIELD_OFFSETS, expectedFarmDelivery, fieldHarvestFoodForState, FIELD_SPOIL_SECONDS } from './farms';
import { prepareIrrigation } from './irrigation';
import { traversable } from './pathfinding';
import { buildingAlignmentQuery } from './placement';
import { farmWalkingDistance, palaceWalkingDistances } from './farm-travel';
import { ridgeFootprintAllowed } from './ridges';
import { grainStorageMultiplier } from './research-bonuses';
import { buildingWithinBorders } from './border-placement';
import { territory } from './borders';
import { farmParcelPreferenceQuery, FARM_CLUSTER_PRODUCTION_BONUS } from './farm-clusters';
import { farmBlockPlacementQuery } from './farm-blocks';
import { type Building, type GameState, type Point, buildingReady, buildingWidth, buildingHeight } from './types';

/** Retain the governor's existing practical collection radius. Irrigation does
 * not justify expanding past the area served by ordinary farm couriers. */
export const AUTOMATIC_FARM_RADIUS = 25;
const CLEARABLE = new Set(['none', 'forest', 'jungle', 'swamp']);
export interface FarmSitePlan { point: Point; harvest: number; irrigatedPlots: number; walkingDistance: number; expectedHarvest: number; }

/** Fill the most productive available crop tiles first. The yield estimate
 * uses the same completed-ditch bitmap as actual harvests: partial coverage is
 * counted per plot and overlapping ditches never stack. Owned ditches can
 * share farmland; roads reserve their cells for travel.
 * Clearable trees have no siting penalty: reserving the farm clears its whole
 * footprint. Walking distance and ripened-food expiry discount production:
 * land across a lake is not nearby merely because it looks nearby. Within
 * six tiles of the palace, prefer keeping streets and their frontages free for
 * urban buildings. Completing 2×2/3×3 squares with one-cell gaps receives at
 * most a 20% selection bonus; cramped sites remain available and estimated
 * output is unchanged. */
export function planAutomaticFarmSite(state: GameState, palace: Building): FarmSitePlan | undefined {
  if (palace.kind !== 'palace' || !buildingReady(palace)) return;
  const { width, height } = state.world, occupied = new Set<number>(), roads = new Set<number>();
  for (const building of state.buildings) {
    if (building.hp > 0 && building.faction === palace.faction && building.kind === 'road') roads.add(building.y * width + building.x);
    if (building.hp <= 0 || building.faction === palace.faction && building.kind === 'irrigation') continue;
    for (let y = building.y; y < building.y + buildingHeight(building); y++)
      for (let x = building.x; x < building.x + buildingWidth(building); x++) occupied.add(y * width + x);
  }
  for (const field of state.fields ?? []) occupied.add(field.y * width + field.x);
  const walking = palaceWalkingDistances(state, palace), coverage = prepareIrrigation(state).coverage;
  const shelfLife = FIELD_SPOIL_SECONDS * grainStorageMultiplier(state.factions.find(faction => faction.id === palace.faction));
  const palaces = state.buildings.filter(building => building.kind === 'palace' && building.faction === palace.faction && buildingReady(building));
  const otherWalks = palaces.filter(other => other.id !== palace.id).map(other => ({ id: other.id, distances: palaceWalkingDistances(state, other) }));
  const alignment = buildingAlignmentQuery(state, palace.faction), origin = { x: palace.x + 1, y: palace.y + 1 };
  const borders = state.villages?.length ? territory(state) : undefined;
  const candidates: (FarmSitePlan & { streetPenalty: number; layout: number })[] = [];
  for (let y = Math.max(0, Math.floor(origin.y - AUTOMATIC_FARM_RADIUS)); y <= Math.min(height - 1, Math.ceil(origin.y + AUTOMATIC_FARM_RADIUS)); y++) {
    for (let x = Math.max(0, Math.floor(origin.x - AUTOMATIC_FARM_RADIUS)); x <= Math.min(width - 1, Math.ceil(origin.x + AUTOMATIC_FARM_RADIUS)); x++) {
      const d = Math.hypot(x + .5 - origin.x, y + .5 - origin.y);
      if (d < 2 || d > AUTOMATIC_FARM_RADIUS) continue;
      if (!buildingWithinBorders(state, 'camp', x, y, palace.faction, borders)) continue;
      const cityDistance = farmWalkingDistance(walking, width, x, y);
      if (otherWalks.some(other => {
        const otherDistance = farmWalkingDistance(other.distances, width, x, y);
        return otherDistance < cityDistance || otherDistance === cityDistance && other.id < palace.id;
      })) continue;
      if (!ridgeFootprintAllowed(state.world, x, y, 1)) continue;
      let harvest = 0, irrigatedPlots = 0, valid = true, streetPenalty = 1;
      for (const [dx, dy] of CAMP_FIELD_OFFSETS) {
        const px = x + dx, py = y + dy, cell = py * width + px, tile = state.world.tiles[cell];
        if (!tile || occupied.has(cell) || !Number.isFinite(walking[cell]) || !CLEARABLE.has(tile.overlay) || !traversable(state.world, px, py)) { valid = false; break; }
        const irrigated = !!coverage[cell];
        irrigatedPlots += Number(irrigated);
        harvest += fieldHarvestFoodForState(state, px, py, palace.faction);
        if (Math.hypot(px + .5 - origin.x, py + .5 - origin.y) <= 6) {
          if (roads.has(cell)) streetPenalty = 1.2;
          else if (streetPenalty < 1.1) {
            for (let sy = Math.max(0, py - 1); sy <= Math.min(height - 1, py + 1); sy++)
              for (let sx = Math.max(0, px - 1); sx <= Math.min(width - 1, px + 1); sx++)
                if (roads.has(sy * width + sx)) streetPenalty = 1.1;
          }
        }
      }
      if (!valid || harvest <= 0) continue;
      const walkingDistance = farmWalkingDistance(walking, width, x, y), expectedHarvest = harvest * expectedFarmDelivery(walkingDistance, shelfLife);
      if (expectedHarvest <= 0) continue;
      const layout = -Math.abs(walkingDistance - 5) * .55 + alignment(x, y) * .2;
      candidates.push({ point: { x, y }, harvest, irrigatedPlots, walkingDistance, expectedHarvest, streetPenalty, layout });
    }
  }
  const parcelPreference = farmParcelPreferenceQuery(state, palace, candidates.map(site => site.point));
  const geometry = farmBlockPlacementQuery(state);
  let best: FarmSitePlan | undefined, bestProduction = -Infinity, bestLayout = -Infinity;
  for (const { streetPenalty, layout, ...site } of candidates) {
    if (!geometry.canAdd(site.point).ok) continue;
    const production = site.expectedHarvest / streetPenalty * (1 + parcelPreference(site.point.x, site.point.y) * FARM_CLUSTER_PRODUCTION_BONUS);
    const tiedYield = !!best && Math.abs(production - bestProduction) < 1e-7;
    if (!best || production > bestProduction + 1e-7 || tiedYield && (site.irrigatedPlots > best.irrigatedPlots
      || site.irrigatedPlots === best.irrigatedPlots && layout > bestLayout)) {
      best = site; bestProduction = production; bestLayout = layout;
    }
  }
  return best;
}
