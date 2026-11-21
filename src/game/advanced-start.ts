import { advancedStartLayout, type CreateStartingBuilding } from './advanced-start-layout';
import { isBuildingUnlocked, RESEARCH_BRANCHES, researchDepth } from './research';
import { houseCapacity, houseLevel } from './wells';
import { buildingWithinBorders } from './border-placement';
import { UNCLAIMED } from './borders';
import { territoryValue } from './territory-cells';
import { bridgeSpanAt, type BridgeSpan } from './bridge-spans';
import { constructionEdges } from './builders';
import { hasStaticPathBetween } from './pathfinding';
import { isFreshwaterSource } from './irrigation';
import { raiderCampActive, raiderCampCenter } from './raider-camps';
import { BUILDABLE_KINDS as ALL_BUILDABLE_KINDS, buildingWidth, buildingHeight, type Building, type BuildingKind, type Faction, type GameState, type Point, type ResearchBranchId } from './types';

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
export function prepareAdvancedCity(state: GameState, faction: Faction, city: Building, create: CreateStartingBuilding, phase: AdvancedStartPhase = 'complete'): number {
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

  const layout = advancedStartLayout(state, city, create);
  const random = layoutRandom(`${state.world.seed}:advanced-houses:${city.x},${city.y}`);
  let urbanRadius = Math.SQRT1_2, capacity = city.capacity;
  const addUrban = (kind: BuildingKind, point: Point): Building => {
    const building = layout.add(kind, point);
    const dx = Math.max(Math.abs(point.x - city.x - .5), Math.abs(point.x + buildingWidth(building) - city.x - 1.5));
    const dy = Math.max(Math.abs(point.y - city.y - .5), Math.abs(point.y + buildingHeight(building) - city.y - 1.5));
    urbanRadius = Math.max(urbanRadius, Math.hypot(dx, dy));
    return building;
  };

  const placeHousing = (size: number, horizontal: boolean): boolean => {
    const length = Math.ceil(size / 2);
    const width = horizontal ? length : 2, height = horizontal ? 2 : length;
    const wellSite = (point: Point): Point => horizontal ? { x: point.x + Math.floor(length / 2), y: point.y }
      : { x: point.x, y: point.y + Math.floor(length / 2) };
    return layout.placeLot(width, height,
      (point, borders) => {
        const well = wellSite(point);
        return buildingWithinBorders(state, 'well', well.x, well.y, faction.id, borders);
      }, point => {
        for (let i = 0; i < size; i++) {
          const house = addUrban('house', horizontal
            ? { x: point.x + i % length, y: point.y + Math.floor(i / length) }
            : { x: point.x + Math.floor(i / length), y: point.y + i % length });
          if (houseLevel(house) < 2) {
            house.houseLevel = 2; house.houseStyle = 'hovel';
            house.maxHp += 40; house.hp += 40;
          }
          house.capacity = houseCapacity(house, faction, state);
          capacity += house.capacity;
        }
        layout.add('well', wellSite(point));
      });
  };

  // Two rows keep every door on a street. A 2×2 block also fits narrower
  // clearings when the usual 8–12 houses will not fit.
  while (capacity < ADVANCED_START_POPULATION) {
    const size = ADVANCED_HOUSE_BLOCK.min + Math.floor(random() * (ADVANCED_HOUSE_BLOCK.max - ADVANCED_HOUSE_BLOCK.min + 1));
    const horizontal = random() < .5;
    if (!placeHousing(size, horizontal) && !placeHousing(size, !horizontal) && !placeHousing(4, true))
      throw new Error('This starting location has too little room for an advanced city. Try another seed.');
  }

  const available = BUILDABLE_KINDS.filter(kind => isBuildingUnlocked(faction, kind));
  const local = available.filter(kind => !['palace', 'house', 'camp', 'road', 'bridge', 'irrigation',
    'observationPost', 'well', 'fort', 'dock', 'shipyard', 'whalingPost'].includes(kind));
  const small: { kind: BuildingKind; dx: number; dy: number }[] = [];
  const placeCivic = (width: number, height: number, sites: typeof small): void => {
    if (!layout.placeLot(width, height,
      (point, borders) => sites.every(({ kind, dx, dy }) => buildingWithinBorders(state, kind, point.x + dx, point.y + dy, faction.id, borders)),
      point => { for (const { kind, dx, dy } of sites) addUrban(kind, { x: point.x + dx, y: point.y + dy }); }))
      throw new Error(`The advanced city has no accessible space for ${sites[0].kind}. Try another seed.`);
  };
  for (const kind of local) {
    const width = buildingWidth({ kind }), height = buildingHeight({ kind });
    if (height > 1) placeCivic(width, height, [{ kind, dx: 0, dy: 0 }]);
  }
  // Pack the single-row buildings into four-tile civic lots.
  let used = 0;
  for (const kind of local.filter(kind => buildingHeight({ kind }) === 1).sort((a, b) => buildingWidth({ kind: b }) - buildingWidth({ kind: a }))) {
    small.push({ kind, dx: used % 2, dy: Math.floor(used / 2) });
    used += buildingWidth({ kind });
    if (used === 4) { placeCivic(2, 2, small); small.length = 0; used = 0; }
  }
  if (small.length) placeCivic(2, 2, small);

  let residents = ADVANCED_START_POPULATION;
  for (const house of state.buildings) if (house.kind === 'house' && house.faction === faction.id) {
    house.residents = Math.min(house.capacity, residents); residents -= house.residents;
  }
  city.unhousedResidents = residents;

  // Reserve shoreline frontage before choosing any optional bridge crossing.
  for (const kind of ['shipyard', 'whalingPost', 'dock'] as const)
    if (available.includes(kind)) layout.placeSeaside(kind);

  const exits = constructionEdges(state, city);
  const reachable = (points: readonly Point[]) => hasStaticPathBetween(state, exits, points, faction.id);
  let crossing: BridgeSpan | undefined;
  for (const point of layout.cells) {
    if (!isFreshwaterSource(state, point.x, point.y)) continue;
    const span = bridgeSpanAt(state, point, faction.id);
    if (span && span.tiles.every(layout.vacant) && reachable(span.banks)) { crossing = span; break; }
  }
  if (crossing) for (const point of crossing.tiles) layout.add('bridge', point);
  return urbanRadius;
}

/** Camp positions exist only after the initial settlements are populated. */
export function placeAdvancedFort(state: GameState, city: Building, faction: Faction, create: CreateStartingBuilding): void {
  if (!isBuildingUnlocked(faction, 'fort')) return;
  const layout = advancedStartLayout(state, city, create);
  const width = buildingWidth({ kind: 'fort' }), height = buildingHeight({ kind: 'fort' });
  const distanceSquared = (x: number, y: number, point: Point) => (x - point.x) ** 2 + (y - point.y) ** 2;
  const origin = { x: city.x + 1, y: city.y + 1 };
  let nearestCamp: Point | undefined, nearestDistance = Infinity;
  for (const camp of state.raiderCamps ?? []) if (raiderCampActive(state, camp)) {
    const center = raiderCampCenter(camp), distance = distanceSquared(origin.x, origin.y, center);
    if (distance < nearestDistance) { nearestCamp = center; nearestDistance = distance; }
  }
  const score = (point: Point): number => nearestCamp
    ? distanceSquared(point.x + width / 2, point.y + height / 2, nearestCamp)
    : -distanceSquared(point.x + width / 2, point.y + height / 2, origin);
  const candidates = layout.cells.slice().sort((a, b) => score(a) - score(b) || a.y - b.y || a.x - b.x);
  layout.placeLot(width, height, (point, borders) => {
    let touchesBorder = false;
    for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) {
      const owner = territoryValue(borders, (point.y + dy) * borders.width + point.x + dx);
      if (owner === faction.id) touchesBorder = true;
      else if (owner !== UNCLAIMED) return false;
    }
    return touchesBorder;
  }, point => { layout.add('fort', point); }, candidates);
}
