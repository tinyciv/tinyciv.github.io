import { isBuildingUnlocked, RESEARCH_BRANCHES, researchDepth } from './research';
import { houseCapacity, houseLevel, WELL_RADIUS } from './wells';
import { buildingWithinBorders } from './border-placement';
import { bridgeSpanAt } from './bridge-spans';
import { constructionEdges, canReachConstruction } from './builders';
import { canWalk, hasStaticPath } from './pathfinding';
import { irrigationConnects } from './irrigation';
import { reliefFootprintAllowed } from './relief';
import { settlementFootprintAllowed } from './terrain-sites';
import { dockPlacement } from './dock';
import { applySoilFertility } from '../world/soil';
import { BUILDABLE_KINDS as ALL_BUILDABLE_KINDS, buildingWidth, buildingHeight, tileAt, WATER, type Building, type BuildingKind, type Faction, type GameState, type Point, type ResearchBranchId } from './types';
/** Endgame civic buildings are earned in play, never granted by the advanced start. */
const BUILDABLE_KINDS = ALL_BUILDABLE_KINDS.filter(kind => kind !== 'colosseum' && kind !== 'barracks');

/** 4 base escorts + 5 from the first 100 residents + 3 from the next 150. */
export const ADVANCED_START_POPULATION = 250;
export const ADVANCED_START_RETINUE = 12;
export const ADVANCED_START_FOOD = ADVANCED_START_POPULATION * 5;
export const ADVANCED_START_GOLD = ADVANCED_START_POPULATION * 5;
/** Midpoint: the first half of the research tree. Complete: every branch researched. */
export type AdvancedStartPhase = 'midpoint' | 'complete';
export const ADVANCED_START_PHASES: readonly AdvancedStartPhase[] = ['midpoint', 'complete'];
/** Midpoint grants every branch whose prerequisite chain is at most this deep (16 of 27). */
export const ADVANCED_START_MIDPOINT_DEPTH = 3;
/** Houses stand in blocks of this many, each served by one well. */
export const ADVANCED_HOUSE_BLOCK = { min: 8, max: 12 } as const;
type CreateBuilding = (kind: BuildingKind, point: Point) => Building;

/** Deterministic layout variety that leaves the simulation's random stream untouched. */
function layoutRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = h + 0x6d2b79f5 | 0;
    let t = Math.imul(h ^ h >>> 15, 1 | h);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** Seed an established city before its farms and retinue are created. Everything
 * is ordinary completed gameplay state, with no recurring free construction. */
export function prepareAdvancedCity(state: GameState, faction: Faction, city: Building, create: CreateBuilding, phase: AdvancedStartPhase = 'complete'): void {
  faction.food = Math.max(faction.food, ADVANCED_START_FOOD);
  faction.gold = Math.max(faction.gold, ADVANCED_START_GOLD);
  faction.archerFraction = faction.spearmanFraction = faction.horsemanFraction = .25;
  const research = faction.research ??= { focus: 'woodenTower', levels: {}, progress: {} };
  const unlock = (id: ResearchBranchId): void => {
    const definition = RESEARCH_BRANCHES.find(branch => branch.id === id)!;
    for (const prerequisite of definition.prerequisites) unlock(prerequisite);
    research.levels[id] = 1;
  };
  for (const branch of RESEARCH_BRANCHES)
    if (phase === 'complete' || researchDepth(branch.id) <= ADVANCED_START_MIDPOINT_DEPTH) unlock(branch.id);
  research.focus = RESEARCH_BRANCHES.find(branch => !research.levels[branch.id])?.id ?? 'woodenTower';

  const cells: Point[] = [];
  for (let y = Math.max(1, city.y - 30); y < Math.min(state.world.height - 1, city.y + 31); y++)
    for (let x = Math.max(1, city.x - 30); x < Math.min(state.world.width - 1, city.x + 31); x++)
      if (!state.world.spawns.some(spawn => Math.hypot(spawn.x - city.x, spawn.y - city.y) > 8 && Math.hypot(spawn.x - x, spawn.y - y) < 9)) cells.push({ x, y });
  cells.sort((a, b) => Math.hypot(a.x - city.x, a.y - city.y) - Math.hypot(b.x - city.x, b.y - city.y) || a.y - b.y || a.x - b.x);
  const overlaps = (point: Point, width = 1, height = 1, lane = false): boolean => state.buildings.some(building => {
    if (building.hp <= 0) return false;
    const gap = lane && !['road', 'irrigation', 'bridge'].includes(building.kind) ? 1 : 0;
    return point.x < building.x + buildingWidth(building) + gap && point.x + width > building.x - gap
      && point.y < building.y + buildingHeight(building) + gap && point.y + height > building.y - gap;
  });
  const emptyLand = (point: Point): boolean => {
    const tile = tileAt(state.world, point.x, point.y);
    return !!tile && !WATER.has(tile.terrain) && !tile.marsh && !overlaps(point) && settlementFootprintAllowed(state.world, point.x, point.y);
  };
  const place = (kind: BuildingKind): Building | undefined => {
    const width = buildingWidth({ kind }), height = buildingHeight({ kind });
    const point = cells.find(point => {
      if (overlaps(point, width, height, true) || !buildingWithinBorders(state, kind, point.x, point.y, faction.id)
        || !reliefFootprintAllowed(state.world, point.x, point.y, width, height)) return false;
      for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++)
        if (!emptyLand({ x: point.x + dx, y: point.y + dy })) return false;
      const candidate: Building = { id: -999, kind, faction: faction.id, ...point, hp: 100, maxHp: 100, capacity: 0 };
      return canReachConstruction(state, city, candidate);
    });
    return point ? create(kind, point) : undefined;
  };

  // Reserve the two-cell civic footprints before one-cell housing fills the
  // clearing. Their surrounding lanes also keep the initial city navigable.
  const available = BUILDABLE_KINDS.filter(kind => isBuildingUnlocked(faction, kind));
  const civic = available.filter(kind => kind !== 'palace' && (buildingWidth({ kind }) > 1 || buildingHeight({ kind }) > 1));
  for (const kind of civic) if (!place(kind))
    throw new Error(`The advanced city has no accessible space for ${kind}. Try another seed.`);

  // Houses stand in two-row blocks of 8-12 with a lane around each block, so
  // every home faces open ground. One well shares a central house's tile and
  // supplies the whole block, which therefore starts at housing level 2.
  // Blocks also expand ordinary borders for the remaining one-cell buildings.
  const random = layoutRandom(`${state.world.seed}:advanced-houses:${city.x},${city.y}`);
  const wells: Building[] = [];
  // The level a well grants in play (wells.ts), applied up front.
  const supply = (house: Building): void => {
    if (houseLevel(house) >= 2) return;
    house.houseLevel = 2; house.houseStyle = 'hovel';
    house.maxHp += 40; house.hp += 40;
    house.capacity = houseCapacity(house, faction, state);
  };
  const placeBlock = (size: number): Building[] | undefined => {
    const long = Math.ceil(size / 2);
    for (const anchor of cells) for (const horizontal of [true, false]) {
      const width = horizontal ? long : 2, height = horizontal ? 2 : long;
      const sites = Array.from({ length: size }, (_, i) => horizontal
        ? { x: anchor.x + i % long, y: anchor.y + Math.floor(i / long) }
        : { x: anchor.x + Math.floor(i / long), y: anchor.y + i % long });
      const wellSite = horizontal ? sites[Math.floor(long / 2)] : sites[long + Math.floor(long / 2)];
      // Borders grow from the houses themselves, so only the block's well
      // tile must already lie inside them; the new homes claim the rest.
      if (overlaps(anchor, width, height, true) || !reliefFootprintAllowed(state.world, anchor.x, anchor.y, width, height)
        || !buildingWithinBorders(state, 'house', wellSite.x, wellSite.y, faction.id) || !sites.every(emptyLand)) continue;
      const reachable = (site: Point) => canReachConstruction(state, city, { id: -999, kind: 'house', faction: faction.id, ...site, hp: 100, maxHp: 100, capacity: 0 });
      if (!reachable(sites[0]) || !reachable(sites[size - 1])) continue;
      const houses = sites.map(site => create('house', site));
      wells.push(create('well', wellSite));
      for (const house of houses) supply(house);
      return houses;
    }
  };
  let capacity = state.buildings.filter(b => b.faction === faction.id && (b.kind === 'house' || b.kind === 'palace')).reduce((sum, b) => sum + b.capacity, 0);
  while (capacity < ADVANCED_START_POPULATION) {
    const block = placeBlock(ADVANCED_HOUSE_BLOCK.min + Math.floor(random() * (ADVANCED_HOUSE_BLOCK.max - ADVANCED_HOUSE_BLOCK.min + 1)));
    if (!block) break;
    capacity += block.reduce((sum, house) => sum + house.capacity, 0);
  }
  // Cramped sites finish with single houses rather than failing.
  while (capacity < ADVANCED_START_POPULATION) {
    const house = place('house');
    if (!house) throw new Error('This starting location has too little room for an advanced city. Try another seed.');
    capacity += house.capacity;
  }
  // The founding town's homes near a block well are upgraded too.
  for (const house of state.buildings) if (house.kind === 'house' && house.faction === faction.id
    && wells.some(well => Math.hypot(well.x - house.x, well.y - house.y) <= WELL_RADIUS)) supply(house);
  const hasWell = wells.length > 0;
  // Observation posts deploy residents on neutral ground; they are not city structures.
  for (const kind of available) {
    if (civic.includes(kind) || ['palace', 'house', 'camp', 'road', 'bridge', 'dock', 'irrigation', 'observationPost'].includes(kind)) continue;
    if (kind === 'well' && hasWell) continue;
    if (!place(kind)) throw new Error(`The advanced city has no accessible space for ${kind}. Try another seed.`);
  }
  let residents = ADVANCED_START_POPULATION;
  for (const house of state.buildings.filter(b => b.kind === 'house' && b.faction === faction.id)) {
    house.residents = Math.min(house.capacity, residents); residents -= house.residents;
  }
  city.unhousedResidents = residents;

  // Use a real nearby crossing and freshwater inlet where possible. A dry
  // starting region receives a tiny spring pond as part of its initial layout.
  const exits = constructionEdges(state, city);
  let crossing = cells.map(point => ({ point, tile: tileAt(state.world, point.x, point.y) }))
    .filter(({ tile }) => !!tile && WATER.has(tile.terrain))
    .map(({ point }) => bridgeSpanAt(state, point, faction.id))
    .find(span => span && span.tiles.every(point => !overlaps(point)) && span.banks.some(bank => exits.some(exit => hasStaticPath(state, exit, bank, faction.id))));
  let inlet = cells.find(point => emptyLand(point) && irrigationConnects(state, point.x, point.y)
    && exits.some(exit => hasStaticPath(state, exit, point, faction.id)));
  if (!crossing || !inlet) {
    const spring = cells.find(point => Math.hypot(point.x - city.x, point.y - city.y) >= 7
      && [-1, 0, 1].every(dy => [-1, 0, 1].every(dx => emptyLand({ x: point.x + dx, y: point.y + dy })))
      && canWalk(state, point.x, point.y, faction.id) && exits.some(exit => hasStaticPath(state, exit, point, faction.id)));
    if (!spring) throw new Error('The advanced city needs room for its spring and bridge. Try another seed.');
    const tile = tileAt(state.world, spring.x, spring.y)!;
    Object.assign(tile, { terrain: 'lake', lakeShape: 'compact', overlay: 'none', food: 0, production: 0, gold: 0 });
    delete tile.palm; delete tile.marsh;
    // The spring footprint has already passed the flat-ground placement rules.
    state.world.revision = (state.world.revision ?? 0) + 1;
    crossing ??= bridgeSpanAt(state, spring, faction.id);
    inlet ??= { x: spring.x, y: spring.y + 1 };
  }
  if (crossing) for (const point of crossing.tiles) create('bridge', point);
  if (inlet) create('irrigation', inlet);

  const dockSite = () => cells.find(point => emptyLand(point) && buildingWithinBorders(state, 'dock', point.x, point.y, faction.id)
    && dockPlacement(state, point.x, point.y, faction.id)
    && canReachConstruction(state, city, { id: -999, kind: 'dock', faction: faction.id, ...point, hp: 250, maxHp: 250, capacity: 0 }));
  let shore = dockSite();
  if (!shore) {
    // Inland advanced starts still include an example dock and a berth. Keep
    // this small harbor distinct from the spring occupied by the bridge.
    shore = cells.find(point => emptyLand(point) && buildingWithinBorders(state, 'dock', point.x, point.y, faction.id)
      && [-1, 0, 1].every(dx => [-1, 0, 1, 2].every(dy => emptyLand({ x: point.x + dx, y: point.y + dy })))
      && canReachConstruction(state, city, { id: -999, kind: 'dock', faction: faction.id, ...point, hp: 250, maxHp: 250, capacity: 0 }));
    if (!shore) throw new Error('The advanced city needs an accessible shore for its dock. Try another seed.');
    for (const dx of [0, 1]) for (const dy of [1, 2]) {
      const tile = tileAt(state.world, shore.x + dx, shore.y + dy)!;
      Object.assign(tile, { terrain: 'lake', lakeShape: 'compact', overlay: 'none', food: 0, production: 0, gold: 0 });
      delete tile.palm; delete tile.marsh;
    }
    state.world.revision = (state.world.revision ?? 0) + 1;
  }
  create('dock', shore);
  // The starter spring/harbor changes freshwater distance after world generation.
  applySoilFertility(state.world);
}
