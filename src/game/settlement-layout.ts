import { HOUSE_BASE_CAPACITIES } from './housing-config';
import { PALACE_HOUSING } from './city-support';
import { expectedFarmDelivery, fieldHarvestFood, harvestFoodPerEconomyCycle } from './farms';
import { farmWalkingDistance, palaceWalkingDistances } from './farm-travel';
import { buildingWidth, buildingHeight, tileAt, WATER, type Building, type GameState, type Point } from './types';
import { ridgeFootprintAllowed } from './ridges';
import { farmBlockPlacementQuery } from './farm-blocks';
import { farmParcelPreferenceQuery, FARM_CLUSTER_PRODUCTION_BONUS } from './farm-clusters';

export interface StartingSettlementLayout {
  /** Top-left of the two-cell palace and single crop tiles. */
  palace: Point;
  roads: Point[];
  houses: Point[];
  farms: Point[];
}

const CARDINAL = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const NEIGHBORS = [...CARDINAL, [-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
const CLEARABLE = new Set(['none', 'forest', 'jungle', 'swamp']);

/** A closed perimeter, with no road cells inside the palace or connecting arms. */
function townAt(palace: Point, population: number): StartingSettlementLayout {
  const { x, y } = palace, roads: Point[] = [];
  for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++)
    if (dx === -1 || dx === 2 || dy === -1 || dy === 2) roads.push({ x: x + dx, y: y + dy });
  const houses = [
    { x, y: y - 2 }, { x: x + 3, y }, { x: x + 1, y: y + 3 }, { x: x - 2, y: y + 1 },
    { x: x - 2, y: y - 2 }, { x: x + 3, y: y - 2 }, { x: x + 3, y: y + 3 }, { x: x - 2, y: y + 3 },
  ].slice(0, Math.max(4, Math.ceil(Math.max(0, population - PALACE_HOUSING) / HOUSE_BASE_CAPACITIES[0])));
  return { palace, roads, farms: [], houses };
}

/** Empty cells separating a crop tile from a two-cell palace. */
export function startingFarmPalaceGap(farm: Point, palace: Point): number {
  return Math.max(palace.x - (farm.x + 1), farm.x - (palace.x + 2),
    palace.y - (farm.y + 1), farm.y - (palace.y + 2), 0);
}

interface StartingFarmSite extends Point { score: number; travel: number }

/** Initial fields use the governor's square-parcel preference while retaining
 * real projected food output and checking every resulting physical component,
 * including any neighboring faction's existing farmland. */
function selectStartingFarms(state: GameState, palace: Building, sites: StartingFarmSite[], target: number): { farms: Point[]; supply: number } {
  const width = state.world.width, key = (point: Point): number => point.y * width + point.x;
  const addedCells = new Set<number>(), farms: Point[] = [];
  let supply = 0;
  while (supply + 1e-7 < target) {
    const blocks = farmBlockPlacementQuery(state, { addedCells });
    const parcelPreference = farmParcelPreferenceQuery(state, palace, sites, { plannedCells: addedCells });
    let chosen: StartingFarmSite | undefined, bestProduction = -Infinity, bestShape = Infinity;
    for (const site of sites) {
      if (site.score * (1 + FARM_CLUSTER_PRODUCTION_BONUS) + 1e-7 < bestProduction) break;
      if (addedCells.has(key(site))) continue;
      const result = blocks.canAdd(site);
      if (!result.ok) continue;
      const block = result.blocks[0];
      // Prefer a compact growing patch among equally productive locations.
      // This also keeps small exempt plots from turning into long six-cell
      // strips that cannot ever grow into a legal larger block.
      const shape = site.travel + (block.aspectRatio - 1) * .8 + (block.width * block.height - block.size) * .06
        - Math.min(15, block.size - 1) * .12;
      const production = site.score * (1 + parcelPreference(site.x, site.y) * FARM_CLUSTER_PRODUCTION_BONUS);
      if (!chosen || production > bestProduction + 1e-7 || Math.abs(production - bestProduction) < 1e-7 && shape < bestShape) {
        chosen = site; bestProduction = production; bestShape = shape;
      }
    }
    if (!chosen) break;
    addedCells.add(key(chosen)); farms.push({ x: chosen.x, y: chosen.y }); supply += chosen.score;
  }
  return { farms, supply };
}

function planStartingFarmSites(state: GameState, palace: Building, population: number, available: (point: Point) => boolean): { farms: Point[]; supply: number } {
  const { world } = state, { width, height } = world, walking = palaceWalkingDistances(state, palace);
  const sites: StartingFarmSite[] = [];
  const left = Math.max(0, Math.ceil(palace.x + .5 - 26)), right = Math.min(width - 1, Math.floor(palace.x + .5 + 26));
  const top = Math.max(0, Math.ceil(palace.y + .5 - 26)), bottom = Math.min(height - 1, Math.floor(palace.y + .5 + 26));
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    const point = { x, y };
    if (startingFarmPalaceGap(point, palace) < 2 || !available(point) || !ridgeFootprintAllowed(world, x, y, 1)) continue;
    const travel = farmWalkingDistance(walking, width, x, y), delivery = expectedFarmDelivery(travel);
    if (delivery <= 0 || !Number.isFinite(walking[y * width + x])) continue;
    const yieldFood = harvestFoodPerEconomyCycle(fieldHarvestFood(world, x, y));
    sites.push({ ...point, travel, score: yieldFood * delivery });
  }
  sites.sort((a, b) => b.score - a.score || a.travel - b.travel || a.y - b.y || a.x - b.x);
  return selectStartingFarms(state, palace, sites, population * 1.25);
}

/** Re-plan after advanced-start structures have occupied their actual cells.
 * Filtering a previously valid patch one plot at a time can leave wider
 * remnants; selecting against final occupancy keeps every block valid. */
export function planStartingCityFarms(state: GameState, palace: Building, population: number, spawn: Point = palace): Point[] {
  const { world } = state, occupied = new Set<number>(), reserved = new Set<number>();
  for (const building of state.buildings) if (building.hp > 0)
    for (let dy = 0; dy < buildingHeight(building); dy++) for (let dx = 0; dx < buildingWidth(building); dx++)
      occupied.add((building.y + dy) * world.width + building.x + dx);
  for (const field of state.fields ?? []) occupied.add(field.y * world.width + field.x);
  for (const other of [...world.spawns, ...world.secondarySpawns ?? []]) if (Math.hypot(other.x - spawn.x, other.y - spawn.y) > 1) {
    const ox = Math.floor(other.x), oy = Math.floor(other.y);
    for (let y = oy - 3; y <= oy + 4; y++) for (let x = ox - 3; x <= ox + 4; x++) reserved.add(y * world.width + x);
  }
  return planStartingFarmSites(state, palace, population, point => {
    const tile = tileAt(world, point.x, point.y), cell = point.y * world.width + point.x;
    return !!tile && !WATER.has(tile.terrain) && !tile.marsh && CLEARABLE.has(tile.overlay) && !occupied.has(cell) && !reserved.has(cell);
  }).farms;
}

/** Plans the initial settlement before creating entities. A nearby natural
 * clearing is preferred to flattening shorelines or putting houses in water.
 * Tiny fixture maps retain whatever fits rather than creating invalid tiles. */
export function planStartingSettlement(state: GameState, spawn: Point, population = 5): StartingSettlementLayout {
  const { world } = state, { width, height } = world;
  const key = (point: Point): number => point.y * width + point.x;
  const occupied = new Set<number>();
  const reserved = new Set<number>();
  for (const building of state.buildings) if (building.hp > 0) {
    const farm = ['camp', 'shack', 'cottage'].includes(building.kind);
    const left = building.x, top = building.y, spanX = buildingWidth(building), spanY = buildingHeight(building);
    for (let y = top; y < top + spanY; y++) for (let x = left; x < left + spanX; x++) occupied.add(y * width + x);
    // Keep a walking lane around existing structures and complete farm plots.
    if (!farm && !['road', 'bridge'].includes(building.kind))
      for (let y = top - 1; y <= top + spanY; y++) for (let x = left - 1; x <= left + spanX; x++) reserved.add(y * width + x);
  }
  for (const field of state.fields ?? []) occupied.add(key(field));
  // Do not occupy a future faction's initial clearing with our distant fields.
  for (const other of [...world.spawns, ...world.secondarySpawns ?? []]) if (Math.hypot(other.x - spawn.x, other.y - spawn.y) > 1) {
    const ox = Math.floor(other.x), oy = Math.floor(other.y);
    for (let y = oy - 3; y <= oy + 4; y++) for (let x = ox - 3; x <= ox + 4; x++) reserved.add(y * width + x);
  }
  const usableCache = new Uint8Array(width * height);
  const usable = (point: Point): boolean => {
    const tile = tileAt(world, point.x, point.y);
    if (!tile) return false;
    const index = key(point), cached = usableCache[index];
    if (cached) return cached === 2;
    const allowed = !WATER.has(tile.terrain) && !tile.marsh && CLEARABLE.has(tile.overlay) && !occupied.has(index)
      && ridgeFootprintAllowed(world, point.x, point.y);
    usableCache[index] = allowed ? 2 : 1;
    return allowed;
  };
  const palaceCells = ({ x, y }: Point): Point[] => [{ x, y }, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 }];
  const houseLane = (house: Point): boolean => NEIGHBORS.every(([dx, dy]) => usable({ x: house.x + dx, y: house.y + dy }));
  const origin = { x: Math.floor(spawn.x), y: Math.floor(spawn.y) };
  const minimumFactionDistance = world.minimumFactionStartDistance ?? 0;
  const sameSpawn = (point: Point): boolean => point.x === spawn.x && point.y === spawn.y;
  const capitalOwner = world.spawns.findIndex(sameSpawn);
  const secondaryOwner = world.secondarySpawns?.findIndex(sameSpawn) ?? -1;
  const owner = capitalOwner >= 0 ? capitalOwner : secondaryOwner >= 0 ? secondaryOwner + 1 : -1;
  const foreignStarts = minimumFactionDistance && owner >= 0 ? [
    ...world.spawns.filter((_, faction) => faction !== owner),
    ...(world.secondarySpawns ?? []).filter((_, index) => index + 1 !== owner),
  ].map(point => ({ x: Math.floor(point.x), y: Math.floor(point.y) })) : [];
  const foreignCities = [...foreignStarts, ...state.buildings.filter(building => building.kind === 'palace' && building.hp > 0 && building.faction !== owner)];
  const respectsSeparation = (point: Point): boolean => !minimumFactionDistance || owner < 0
    || foreignCities.every(other => (point.x - other.x) ** 2 + (point.y - other.y) ** 2 >= minimumFactionDistance ** 2);
  const candidates: Point[] = [];
  for (let y = 0; y < height - 1; y++) for (let x = 0; x < width - 1; x++)
    if (respectsSeparation({ x, y })) candidates.push({ x, y });
  const distanceSquared = (point: Point): number => (point.x - origin.x) ** 2 + (point.y - origin.y) ** 2;
  candidates.sort((a, b) => distanceSquared(a) - distanceSquared(b) || a.y - b.y || a.x - b.x);

  function farmsFor(layout: StartingSettlementLayout): { farms: Point[]; supply: number } {
    const placeholder = (kind: Building['kind'], point: Point, id: number): Building =>
      ({ id, kind, ...point, faction: 0, hp: 100, maxHp: 100, capacity: 0 });
    const palace = placeholder('palace', layout.palace, -1);
    const virtual: GameState = { ...state, buildings: [...state.buildings, palace,
      ...layout.houses.map((point, i) => placeholder('house', point, -2 - i)),
      ...layout.roads.map((point, i) => placeholder('road', point, -20 - i))] };
    return planStartingFarmSites(virtual, palace, population, point => usable(point) && !reserved.has(key(point)));
  }

  let best: StartingSettlementLayout | undefined, bestSupply = -1, firstPalace: Point | undefined, completeCount = 0;
  // Usually the first site fits. The bounded retry also handles small islands
  // without scanning the whole world once per possible palace coordinate.
  // Filtering after distance ordering gives the same nearest valid settlements
  // while avoiding expensive footprint/lane checks for every distant tile.
  for (const palace of candidates) {
    if (!ridgeFootprintAllowed(world, palace.x, palace.y, 2)
      || !palaceCells(palace).every(point => usable(point) && !reserved.has(key(point)))) continue;
    firstPalace ??= palace;
    const layout = townAt(palace, population);
    if (![...layout.roads, ...layout.houses].every(tile => usable(tile) && !reserved.has(key(tile)))
      || !layout.houses.every(houseLane)) continue;
    const planned = farmsFor(layout); layout.farms = planned.farms;
    if (planned.supply + 1e-7 >= population * 1.25) return layout;
    if (!best || planned.supply > bestSupply) { best = layout; bestSupply = planned.supply; }
    if (++completeCount >= 48) break;
  }
  if (best) return best;
  if (minimumFactionDistance && !firstPalace) throw new Error('No valid starting settlement preserves faction separation.');
  const fallback = townAt(firstPalace ?? {
    x: Math.max(0, Math.min(width - 2, origin.x)), y: Math.max(0, Math.min(height - 2, origin.y)),
  }, population);
  fallback.roads = fallback.roads.filter(usable);
  fallback.houses = fallback.houses.filter(point => usable(point) && houseLane(point));
  fallback.farms = farmsFor(fallback).farms;
  return fallback;
}
