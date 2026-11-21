import { HOUSE_BASE_CAPACITIES } from './housing-config';
import { tundraStartAllowed } from './tundra-starts';
import { PALACE_HOUSING } from './city-support';
import { expectedFarmDelivery, fieldHarvestFood, fieldHarvestFoodForState, FIELD_SPOIL_SECONDS, harvestFoodPerEconomyCycle } from './farms';
import { farmCollectionQuery, farmWalkingDistance, palaceWalkingDistances } from './farm-travel';
import { grainStorageMultiplier } from './research-bonuses';
import { buildingWidth, buildingHeight, isFarmKind, tileAt, WATER, type Building, type GameState, type Point, type World } from './types';
import { reliefBuildable } from './relief';
import { settlementFootprintAllowed } from './terrain-sites';
import { startingRoadArm } from './battle-support-native';
import { rustEngine } from './rust-engine';
import { simCore } from './sim-handle';
import { canTraverseEdge, travelTimeMapFrom, withNavigationFrame } from './pathfinding';
import { constructionEdges } from './builders';
import { cityGranary } from './granaries-native';
import { IRRIGATION_OFFSETS, irrigationYieldMultiplier, isFreshwaterSource } from './irrigation';

export interface StartingSettlementLayout {
  /** Top-left of the two-cell palace and single crop tiles. */
  palace: Point;
  library?: Point;
  roads: Point[];
  houses: Point[];
  farms: Point[];
}

const CARDINAL = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const NEIGHBORS = [...CARDINAL, [-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
const CLEARABLE = new Set(['none', 'forest', 'jungle', 'swamp']);
const STARTING_FARM_RANGE = 26;
// Surround every 3–5-tile candidate with room for its footprint and doors.
const LIBRARY_GRID_RADIUS = 7;
const LIBRARY_GRID_SPAN = LIBRARY_GRID_RADIUS * 2 + 1;

/** Clockwise so each consecutive pair shares a road edge. */
export function startingRoadRing({ x, y }: Point, width: number, height: number): Point[] {
  const roads: Point[] = [];
  for (let dx = -1; dx <= width; dx++) roads.push({ x: x + dx, y: y - 1 });
  for (let dy = 0; dy <= height; dy++) roads.push({ x: x + width, y: y + dy });
  for (let dx = width - 1; dx >= -1; dx--) roads.push({ x: x + dx, y: y + height });
  for (let dy = height - 1; dy >= 0; dy--) roads.push({ x: x - 1, y: y + dy });
  return roads;
}

/** A closed perimeter with four six-tile roads extending from its corners. */
function townAt(palace: Point, population: number, advanced: boolean, openingCapital: boolean): StartingSettlementLayout {
  const { x, y } = palace, roads = startingRoadRing(palace, 2, 2);
  if (advanced) return { palace, roads, houses: [], farms: [] };
  roads.sort((a, b) => a.y - b.y || a.x - b.x);
  for (let corner = 0; corner < 4; corner++) for (let step = 0; step < 6; step++) {
    const arm = startingRoadArm(corner, step); roads.push({ x: x + arm.x, y: y + arm.y });
  }
  const houses = [
    { x, y: y - 2 }, { x: x + 3, y }, { x: x + 1, y: y + 3 }, { x: x - 2, y: y + 1 },
    { x: x - 2, y: y - 2 }, { x: x + 3, y: y - 2 }, { x: x + 3, y: y + 3 }, { x: x - 2, y: y + 3 },
  ].slice(0, Math.max(4, Math.ceil(Math.max(0, population - PALACE_HOUSING) / HOUSE_BASE_CAPACITIES[0])));
  if (openingCapital) houses.push({ x: x + 1, y: y - 2 }, { x, y: y + 3 });
  return { palace, roads, farms: [], houses };
}

/** Empty cells separating a crop tile from a two-cell palace. */
export function startingFarmPalaceGap(farm: Point, palace: Point): number {
  return Math.max(palace.x - (farm.x + 1), farm.x - (palace.x + 2),
    palace.y - (farm.y + 1), farm.y - (palace.y + 2), 0);
}

interface StartingFarmSite extends Point { score: number; travel: number; }

function startingFarmBounds(world: World, palace: Building) {
  return {
    left: Math.max(0, Math.ceil(palace.x + .5 - STARTING_FARM_RANGE)),
    right: Math.min(world.width - 1, Math.floor(palace.x + .5 + STARTING_FARM_RANGE)),
    top: Math.max(0, Math.ceil(palace.y + .5 - STARTING_FARM_RANGE)),
    bottom: Math.min(world.height - 1, Math.floor(palace.y + .5 + STARTING_FARM_RANGE)),
  };
}

const outsideCity = (point: Point, palace: Building, urbanRadius: number) =>
  Math.hypot(point.x - palace.x - .5, point.y - palace.y - .5) > urbanRadius;

/** Pass legal terrain and projected delivery to the native opening planner. */
function selectStartingFarms(state: GameState, sites: readonly StartingFarmSite[], target: number): { farms: Point[]; supply: number } {
  const { width, height } = state.world;
  const existing = state.buildings.filter(building => building.hp > 0 && isFarmKind(building.kind)
    && building.x >= 0 && building.x < width && building.y >= 0 && building.y < height);
  const handle = simCore(state).handle;
  const input = rustEngine.sim_starting_farms_input(handle, sites.length, existing.length);
  const rows = new Float64Array(rustEngine.memory.buffer, input, sites.length * 3 + existing.length);
  let index = 0;
  for (const site of sites) {
    rows[index++] = site.y * width + site.x;
    rows[index++] = site.score;
    rows[index++] = site.travel;
  }
  for (const farm of existing) rows[index++] = farm.y * width + farm.x;
  const output = rustEngine.sim_starting_farms_plan(handle, width, height, sites.length, target);
  const [length, supply] = new Float64Array(rustEngine.memory.buffer, output, 2);
  const cells = new Float64Array(rustEngine.memory.buffer, output + 2 * Float64Array.BYTES_PER_ELEMENT, length);
  const farms = Array.from(cells, cell => ({ x: cell % width, y: Math.floor(cell / width) }));
  return { farms, supply };
}

function planStartingFarmSites(state: GameState, palace: Building, population: number, available: (point: Point) => boolean,
  urbanRadius?: number): { farms: Point[]; supply: number } {
  const { world } = state, { width, height } = world, walking = palaceWalkingDistances(state, palace);
  const collect = urbanRadius === undefined ? undefined : farmCollectionQuery(state, palace);
  const shelfLife = FIELD_SPOIL_SECONDS * (collect ? grainStorageMultiplier(state.factions.find(faction => faction.id === palace.faction)) : 1);
  const sites: StartingFarmSite[] = [];
  const { left, right, top, bottom } = startingFarmBounds(world, palace);
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    const point = { x, y };
    if (startingFarmPalaceGap(point, palace) < 2 || !available(point) || !reliefBuildable(tileAt(world, x, y)) || !settlementFootprintAllowed(world, x, y)) continue;
    if (urbanRadius !== undefined && !outsideCity(point, palace, urbanRadius)) continue;
    const travel = collect ? collect(point).walkingDistance : farmWalkingDistance(walking, width, x, y);
    const delivery = expectedFarmDelivery(travel, shelfLife);
    if (delivery <= 0 || !Number.isFinite(walking[y * width + x])) continue;
    const yieldFood = harvestFoodPerEconomyCycle(collect ? fieldHarvestFoodForState(state, x, y, palace.faction) : fieldHarvestFood(world, x, y));
    sites.push({ ...point, travel, score: yieldFood * delivery });
  }
  return selectStartingFarms(state, sites, population * 1.25);
}

function startingCityFarmGround(state: GameState, spawn: Point): (point: Point) => boolean {
  const { world } = state, occupied = new Set<number>(), reserved = new Set<number>();
  for (const building of state.buildings) if (building.hp > 0)
    for (let dy = 0; dy < buildingHeight(building); dy++) for (let dx = 0; dx < buildingWidth(building); dx++)
      occupied.add((building.y + dy) * world.width + building.x + dx);
  for (const field of state.fields ?? []) occupied.add(field.y * world.width + field.x);
  for (const other of [...world.spawns, ...world.secondarySpawns ?? []]) if (Math.hypot(other.x - spawn.x, other.y - spawn.y) > 1) {
    const ox = Math.floor(other.x), oy = Math.floor(other.y);
    for (let y = oy - 3; y <= oy + 4; y++) for (let x = ox - 3; x <= ox + 4; x++) reserved.add(y * world.width + x);
  }
  return point => {
    const tile = tileAt(world, point.x, point.y), cell = point.y * world.width + point.x;
    return !!tile && !WATER.has(tile.terrain) && !tile.marsh && CLEARABLE.has(tile.overlay) && !occupied.has(cell) && !reserved.has(cell);
  };
}

/** Re-plan against final occupancy so the complete field geometry stays legal. */
export function planStartingCityFarms(state: GameState, palace: Building, population: number, spawn: Point = palace, urbanRadius?: number): Point[] {
  return planStartingFarmSites(state, palace, population, startingCityFarmGround(state, spawn), urbanRadius).farms;
}

/** Up to two short runs off real freshwater banks. Score the added production
 * on usable farm ground, deducting land occupied by the ditches themselves. */
export function planStartingCityIrrigation(state: GameState, palace: Building, spawn: Point, urbanRadius: number): Point[] {
  const { world } = state, { width, height } = world;
  const key = (point: Point) => point.y * width + point.x;
  const { left, right, top, bottom } = startingFarmBounds(world, palace);
  const available = startingCityFarmGround(state, spawn);
  const land = new Map<number, Point>(), inlets: Point[] = [];
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    const point = { x, y };
    if (!available(point) || !settlementFootprintAllowed(world, x, y)) continue;
    land.set(key(point), point);
    if (CARDINAL.some(([dx, dy]) => isFreshwaterSource(state, x + dx, y + dy))) inlets.push(point);
  }
  if (!inlets.length) return [];

  const granary = cityGranary(state, palace);
  const walking = withNavigationFrame(state, () => {
    const doors = constructionEdges(state, palace, true);
    if (granary) doors.push(...constructionEdges(state, granary, true));
    return travelTimeMapFrom(state, doors, palace.faction, 1, STARTING_FARM_RANGE, true);
  });
  const shelfLife = FIELD_SPOIL_SECONDS * grainStorageMultiplier(state.factions.find(faction => faction.id === palace.faction));
  const production = new Map<number, { food: number; bonus: number }>();
  for (const [cell, point] of land) {
    if (!outsideCity(point, palace, urbanRadius) || startingFarmPalaceGap(point, palace) < 2) continue;
    const delivery = expectedFarmDelivery(walking[cell], shelfLife);
    if (delivery <= 0) continue;
    const { x, y } = point, tile = world.tiles[cell];
    const food = harvestFoodPerEconomyCycle(fieldHarvestFoodForState(state, x, y, palace.faction)) * delivery;
    const bonus = irrigationYieldMultiplier(state, x, y) === 1 ? food * (tile.terrain === 'desert' ? 2 : 1) : 0;
    production.set(cell, { food, bonus });
  }

  const runs: { cells: number[]; coverage: Set<number> }[] = [];
  const maxRunLength = 3, maxRuns = 2;
  for (const inlet of inlets) for (const [dx, dy] of CARDINAL) {
    const cells: number[] = [], coverage = new Set<number>();
    for (let step = 0; step < maxRunLength; step++) {
      const x = inlet.x + dx * step, y = inlet.y + dy * step, cell = y * width + x;
      if (x < left || x > right || y < top || y > bottom || !land.has(cell) || !Number.isFinite(walking[cell])) break;
      cells.push(cell);
      for (const [ox, oy] of IRRIGATION_OFFSETS) {
        const px = x + ox, py = y + oy, plot = py * width + px;
        if (px >= 0 && px < width && py >= 0 && py < height && production.get(plot)?.bonus) coverage.add(plot);
      }
      if (step || dx === 0 && dy === -1) runs.push({ cells: [...cells], coverage: new Set(coverage) });
    }
  }

  const chosen = new Set<number>(), covered = new Set<number>();
  for (let i = 0; i < maxRuns; i++) {
    let best: typeof runs[number] | undefined, bestGain = 0;
    for (const run of runs) {
      if (run.cells.some(cell => chosen.has(cell))) continue;
      let gain = 0;
      for (const plot of run.coverage) if (!covered.has(plot) && !run.cells.includes(plot)) gain += production.get(plot)!.bonus;
      for (const cell of run.cells) {
        const lost = production.get(cell);
        if (lost) gain -= lost.food + (covered.has(cell) ? lost.bonus : 0);
      }
      if (gain > bestGain + 1e-7) { bestGain = gain; best = run; }
    }
    if (!best) break;
    for (const cell of best.cells) { chosen.add(cell); covered.add(cell); }
    for (const cell of best.coverage) covered.add(cell);
  }
  return [...chosen].map(cell => land.get(cell)!);
}

/** Plans the initial settlement before creating entities. A nearby natural
 * clearing is preferred to flattening shorelines or putting houses in water.
 * Tiny fixture maps retain whatever fits rather than creating invalid tiles. */
export function planStartingSettlement(state: GameState, spawn: Point, population = 5, advanced = false,
  openingCapital = false, requireResourceClearance = false, withLibrary = false): StartingSettlementLayout {
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
      && settlementFootprintAllowed(world, point.x, point.y);
    usableCache[index] = allowed ? 2 : 1;
    return allowed;
  };
  const footprintCells = ({ x, y }: Point): Point[] => [{ x, y }, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 }];
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

  const libraryGrid = withLibrary ? new Uint8Array(LIBRARY_GRID_SPAN ** 2) : undefined;
  function libraryFor(layout: StartingSettlementLayout): Point | undefined {
    if (!libraryGrid) return;
    const left = layout.palace.x - LIBRARY_GRID_RADIUS, top = layout.palace.y - LIBRARY_GRID_RADIUS;
    const cell = (x: number, y: number): number => (y - top) * LIBRARY_GRID_SPAN + x - left;
    for (let y = top; y < top + LIBRARY_GRID_SPAN; y++) for (let x = left; x < left + LIBRARY_GRID_SPAN; x++) {
      const point = { x, y };
      libraryGrid[cell(x, y)] = Number(usable(point) && !reserved.has(key(point)) && !tileAt(world, x, y)?.resource);
    }
    for (const point of [...footprintCells(layout.palace), ...layout.houses]) libraryGrid[cell(point.x, point.y)] = 0;
    for (const road of layout.roads) libraryGrid[cell(road.x, road.y)] = 2;
    const input = rustEngine.terrain_sites_input(libraryGrid.length);
    new Float64Array(rustEngine.memory.buffer, input, libraryGrid.length).set(libraryGrid);
    const site = rustEngine.terrain_sites_opening_library(LIBRARY_GRID_SPAN, LIBRARY_GRID_RADIUS);
    return site < 0 ? undefined : { x: left + site % LIBRARY_GRID_SPAN, y: top + Math.floor(site / LIBRARY_GRID_SPAN) };
  }

  function farmsFor(layout: StartingSettlementLayout): { farms: Point[]; supply: number } {
    const placeholder = (kind: Building['kind'], point: Point, id: number): Building =>
      ({ id, kind, ...point, faction: 0, hp: 100, maxHp: 100, capacity: 0 });
    const palace = placeholder('palace', layout.palace, -1);
    const virtual: GameState = { ...state, buildings: [...state.buildings, palace,
      ...(layout.library ? [placeholder('library', layout.library, -200)] : []),
      ...layout.houses.map((point, i) => placeholder('house', point, -2 - i)),
      ...layout.roads.map((point, i) => placeholder('road', point, -20 - i))] };
    // Roads remain reachable in the virtual walking grid. Reserve the planned
    // layout explicitly so that productive road cells cannot become farms.
    const plannedCells = new Set([...footprintCells(layout.palace), ...layout.houses, ...layout.roads,
      ...(layout.library ? footprintCells(layout.library) : [])].map(key));
    return planStartingFarmSites(virtual, palace, population, point => usable(point)
      && !reserved.has(key(point)) && !plannedCells.has(key(point)));
  }

  function partialLayout(layout: StartingSettlementLayout): StartingSettlementLayout {
    layout.roads = layout.roads.filter(usable);
    layout.houses = layout.houses.filter(point => usable(point) && houseLane(point));
    if (withLibrary) layout.library = libraryFor(layout);
    return layout;
  }

  let best: StartingSettlementLayout | undefined, libraryFallback: StartingSettlementLayout | undefined;
  let bestSupply = -1, firstPalace: Point | undefined, completeCount = 0;
  // Usually the first site fits. The bounded retry also handles small islands
  // without scanning the whole world once per possible palace coordinate.
  // Filtering after distance ordering gives the same nearest valid settlements
  // while avoiding expensive footprint/lane checks for every distant tile.
  for (const palace of candidates) {
    if (!tundraStartAllowed(world, palace.x, palace.y) || !settlementFootprintAllowed(world, palace.x, palace.y, 2, 2, requireResourceClearance)
      || !footprintCells(palace).every(point => usable(point) && !reserved.has(key(point)))) continue;
    firstPalace ??= palace;
    const layout = townAt(palace, population, advanced, openingCapital);
    if (![...layout.roads, ...layout.houses].every(tile => usable(tile) && !reserved.has(key(tile)))
      || !layout.houses.every(houseLane)) {
      if (withLibrary && !libraryFallback) {
        const fallback = partialLayout(layout);
        if (fallback.library) libraryFallback = fallback;
      }
      continue;
    }
    if (advanced) {
      if (layout.roads.every((point, i) => canTraverseEdge(world, point, layout.roads[(i + 1) % layout.roads.length]))) return layout;
      continue;
    }
    if (withLibrary) {
      layout.library = libraryFor(layout);
      if (!layout.library) continue;
    }
    const planned = farmsFor(layout); layout.farms = planned.farms;
    if (planned.supply + 1e-7 >= population * 1.25) return layout;
    if (!best || planned.supply > bestSupply) { best = layout; bestSupply = planned.supply; }
    if (++completeCount >= 48) break;
  }
  if (best) return best;
  if (!firstPalace) throw new Error('No valid starting town has clear low ground.');
  const fallback = libraryFallback ?? partialLayout(townAt(firstPalace, population, advanced, openingCapital));
  if (!advanced) fallback.farms = farmsFor(fallback).farms;
  return fallback;
}
