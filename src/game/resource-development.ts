import { reliefBuildable } from './relief';
import { territoryValue } from './territory-cells';
import { territory, UNCLAIMED } from './borders';
import { entityStore } from './entity-store';
import { isHumanFaction, playerFaction, withPlayerFaction } from './player-context';
import { pointExplored, updateFog } from './fog';
import { spendGold } from './gold-ledger';
import { markWorldChanged, worldChangesSince, worldStructureRevision } from './world-revisions';
import { onResourceDeveloped } from './resource-workers';
import { buildingHeight, buildingPresent, buildingReady, buildingWidth, WATER,
  type Building, type GameState, type RegionalResource, type Tile } from './types';

export const RESOURCE_DEVELOPMENT_COST = 50;
export const SALT_RESIDENTS_PER_TILE = 10;
export const SALT_FOOD_REDUCTION = .25;
export const OLIVE_VILLAGE_TRADE_BONUS_PER_TILE = .02;
export const DEVELOPABLE_RESOURCES = ['copper', 'iron', 'gold', 'stone', 'salt', 'olives'] as const;
export type DevelopableResource = typeof DEVELOPABLE_RESOURCES[number];
export const isDevelopableResource = (resource: RegionalResource | undefined): resource is DevelopableResource =>
  resource !== undefined && (DEVELOPABLE_RESOURCES as readonly RegionalResource[]).includes(resource);

export interface ResourceDevelopmentStatus {
  ok: boolean;
  message: string;
  resource: DevelopableResource | undefined;
  /** Affordable undeveloped tiles in this city's part of the patch; all candidates when blocked for lack of gold. */
  cells: number[];
  cost: number;
  remainingCount: number;
  developedCount: number;
  totalCount: number;
  city: Building | undefined;
}
interface ResourceIndex {
  world: GameState['world']; tiles: Tile[]; revision: number; territoryRevision: number; structures: number; buildings: number;
  cityAt: Int32Array; blocked: Uint8Array;
  cities: Map<number, Building>;
  cityCounts: Map<number, Map<RegionalResource, number>>;
  factionCounts: Map<number, Map<RegionalResource, number>>;
  ownedUndeveloped: Map<number, number[]>;
}
const indexes = new WeakMap<GameState, ResourceIndex>();
const increments = (map: Map<number, Map<RegionalResource, number>>, key: number, resource: RegionalResource) => {
  let counts = map.get(key); if (!counts) { counts = new Map(); map.set(key, counts); }
  counts.set(resource, (counts.get(resource) ?? 0) + 1);
};
export const resourceGroundAvailable = (tile: Tile | undefined): boolean => !!tile && !WATER.has(tile.terrain)
  && !tile.creek && reliefBuildable(tile);

interface ResourceCell { resource: DevelopableResource; developed: boolean; }
interface ResourceCells {
  tiles: Tile[]; cursor?: number; revision: number; cells: Map<number, ResourceCell>;
}
const deposits = new WeakMap<GameState['world'], ResourceCells>();

/** Resource deposits are sparse and crop/road artwork does not change them.
 * Consume the tile journal once, retaining only usable resource cells. */
function resourceCells(world: GameState['world']): ResourceCells {
  let result = deposits.get(world);
  if (!result || result.tiles !== world.tiles) {
    result = { tiles: world.tiles, revision: 0, cells: new Map() };
    deposits.set(world, result);
  }
  const changes = worldChangesSince(world, result.cursor);
  let changed = false;
  const reconcile = (cell: number) => {
    const tile = world.tiles[cell], previous = result.cells.get(cell);
    if (!isDevelopableResource(tile.resource) || !resourceGroundAvailable(tile)) {
      if (previous) { result.cells.delete(cell); changed = true; }
    } else if (previous?.resource !== tile.resource || previous.developed !== !!tile.resourceDeveloped) {
      result.cells.set(cell, { resource: tile.resource, developed: !!tile.resourceDeveloped }); changed = true;
    }
  };
  if (changes.full) for (let cell = 0; cell < world.tiles.length; cell++) reconcile(cell);
  else for (const cell of changes.cells) reconcile(cell);
  if (changed) result.revision++;
  result.cursor = changes.revision;
  return result;
}

/** One ownership index serves all city food calculations, trade trips and
 * recruitment checks. Border/structure edits invalidate it; unit movement does not. */
function resourceIndex(state: GameState): ResourceIndex {
  const borders = territory(state), world = state.world;
  const resources = resourceCells(world), revision = resources.revision, structures = worldStructureRevision(world);
  const buildings = entityStore(state).buildings.revision, previous = indexes.get(state);
  if (previous?.world === world && previous.tiles === world.tiles && previous.revision === revision
    && previous.territoryRevision === borders.revision && previous.structures === structures && previous.buildings === buildings) return previous;
  const cities = new Map(state.buildings.filter(b => b.kind === 'palace' && buildingReady(b)
    && !state.factions.find(f => f.id === b.faction)?.defeated).map(b => [b.id, b]));
  const citiesByFaction = new Map<number, Building[]>();
  for (const city of cities.values()) {
    const list = citiesByFaction.get(city.faction) ?? []; list.push(city); citiesByFaction.set(city.faction, list);
  }
  const blocked = new Uint8Array(world.tiles.length);
  for (const b of state.buildings) if (buildingPresent(b) && b.kind !== 'road') {
    for (let y = b.y; y < b.y + buildingHeight(b); y++) for (let x = b.x; x < b.x + buildingWidth(b); x++)
      if (x >= 0 && y >= 0 && x < world.width && y < world.height) blocked[y * world.width + x] = 1;
  }
  const result: ResourceIndex = { world, tiles: world.tiles, revision, structures, buildings, territoryRevision: borders.revision,
    cityAt: new Int32Array(world.tiles.length).fill(-1), blocked, cities, cityCounts: new Map(), factionCounts: new Map(), ownedUndeveloped: new Map() };
  for (const [cell, resource] of resources.cells) {
    const faction = territoryValue(borders, cell);
    if (faction === UNCLAIMED) continue;
    const x = cell % world.width + .5, y = Math.floor(cell / world.width) + .5;
    let city: Building | undefined, best = Infinity;
    for (const candidate of citiesByFaction.get(faction) ?? []) {
      const d = (candidate.x + buildingWidth(candidate) / 2 - x) ** 2 + (candidate.y + buildingHeight(candidate) / 2 - y) ** 2;
      if (d < best || d === best && candidate.id < city!.id) { city = candidate; best = d; }
    }
    if (!city) continue;
    result.cityAt[cell] = city.id;
    if (blocked[cell]) continue;
    if (resource.developed) {
      increments(result.cityCounts, city.id, resource.resource); increments(result.factionCounts, faction, resource.resource);
    } else {
      const list = result.ownedUndeveloped.get(faction) ?? []; list.push(cell); result.ownedUndeveloped.set(faction, list);
    }
  }
  indexes.set(state, result); return result;
}

export function resourceCityAt(state: GameState, x: number, y: number): Building | undefined {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= state.world.width || y >= state.world.height) return;
  const index = resourceIndex(state); return index.cities.get(index.cityAt[y * state.world.width + x]);
}

export function resourceDevelopmentStatus(state: GameState, x: number, y: number, faction = playerFaction(state), budget = Infinity): ResourceDevelopmentStatus {
  const result: ResourceDevelopmentStatus = { ok: false, message: '', resource: undefined, cells: [], cost: 0, remainingCount: 0, developedCount: 0, totalCount: 0, city: undefined };
  const fail = (message: string) => ({ ...result, message });
  if (!Number.isFinite(x) || !Number.isFinite(y)) return fail('Choose a resource deposit.');
  x = Math.floor(x); y = Math.floor(y);
  const { world } = state, start = y * world.width + x;
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return fail('Choose a resource deposit.');
  const resource = world.tiles[start].resource;
  if (!isDevelopableResource(resource)) return fail('This resource cannot be developed.');
  const fog = isHumanFaction(state, faction) ? withPlayerFaction(state, faction, () => updateFog(state)) : undefined;
  const known = (cell: number) => !fog || pointExplored(fog, cell % world.width + .5, Math.floor(cell / world.width) + .5);
  if (!known(start)) return fail('Explore this deposit first.');
  result.resource = resource;
  const index = resourceIndex(state), city = index.cities.get(index.cityAt[start]); result.city = city;
  if (!city || city.faction !== faction) return fail('This resource must be inside one of your city borders.');
  const owner = state.factions.find(f => f.id === faction);
  if (state.gameOver || !owner || owner.defeated) return fail('Your realm can no longer develop resources.');
  if (index.blocked[start]) return fail('Remove the building on this resource first.');
  const seen = new Set<number>([start]), queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head], tx = cell % world.width, ty = Math.floor(cell / world.width);
    if (index.cityAt[cell] === city.id && known(cell)) {
      result.totalCount++;
      if (world.tiles[cell].resourceDeveloped) result.developedCount++;
      else if (!index.blocked[cell] && resourceGroundAvailable(world.tiles[cell])) result.cells.push(cell);
    }
    for (const [nx, ny] of [[tx, ty - 1], [tx + 1, ty], [tx, ty + 1], [tx - 1, ty]]) {
      const next = ny * world.width + nx;
      if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height || seen.has(next) || !known(next)
        || world.tiles[next].resource !== resource) continue;
      seen.add(next); queue.push(next);
    }
  }
  result.cells.sort((a, b) => a - b); result.cost = result.cells.length * RESOURCE_DEVELOPMENT_COST;
  if (!result.cells.length) return fail(result.developedCount ? 'This part of the deposit is already developed.' : 'No clear resource tiles are available here.');
  // Purchase whole tiles nearest the clicked cell first. Unpurchased tiles
  // remain ordinary undeveloped deposits for a later visit.
  result.cells.sort((a, b) => Math.abs(a % world.width - x) + Math.abs(Math.floor(a / world.width) - y)
    - Math.abs(b % world.width - x) - Math.abs(Math.floor(b / world.width) - y) || a - b);
  const available = Math.max(0, Math.min(owner.gold, budget));
  const affordable = Math.floor(available / RESOURCE_DEVELOPMENT_COST);
  result.remainingCount = Math.max(0, result.cells.length - affordable);
  if (affordable < 1) return fail(`Need ${RESOURCE_DEVELOPMENT_COST} gold to develop one tile.`);
  result.cells = result.cells.slice(0, affordable);
  result.cost = result.cells.length * RESOURCE_DEVELOPMENT_COST;
  result.ok = true; return result;
}

export function developResourceGroup(state: GameState, x: number, y: number, faction = playerFaction(state), budget = Infinity): { ok: boolean; message: string } {
  const status = resourceDevelopmentStatus(state, x, y, faction, budget);
  if (!status.ok) return { ok: false, message: status.message };
  spendGold(state, state.factions.find(f => f.id === faction)!, status.cost, 'upgrades');
  for (const cell of status.cells) state.world.tiles[cell].resourceDeveloped = true;
  markWorldChanged(state.world, 'appearance', status.cells);
  onResourceDeveloped(state, status.cells, status.resource!, faction);
  return { ok: true, message: `${status.cells.length} ${status.resource === 'olives' ? 'olive' : status.resource} tiles developed for ${status.cost} gold.` };
}

export function factionHasDevelopedResource(state: GameState, faction: number, resource: RegionalResource): boolean {
  return factionDevelopedResourceCount(state, faction, resource) > 0;
}
export function factionDevelopedResourceCount(state: GameState, faction: number, resource: RegionalResource): number {
  return resourceIndex(state).factionCounts.get(faction)?.get(resource) ?? 0;
}
export function cityDevelopedResourceCount(state: GameState, city: Building, resource: RegionalResource): number {
  return resourceIndex(state).cityCounts.get(city.id)?.get(resource) ?? 0;
}
export function saltFoodConsumptionMultiplier(state: GameState, faction: number, population = state.factions.find(owner => owner.id === faction)?.population ?? 0): number {
  if (!(population > 0)) return 1;
  const covered = Math.min(population, factionDevelopedResourceCount(state, faction, 'salt') * SALT_RESIDENTS_PER_TILE);
  return 1 - SALT_FOOD_REDUCTION * covered / population;
}
export function oliveVillageTradeMultiplier(state: GameState, faction: number): number {
  return 1 + factionDevelopedResourceCount(state, faction, 'olives') * OLIVE_VILLAGE_TRADE_BONUS_PER_TILE;
}

/** Governors attempt one affordable patch per slow economy pass. The caller
 * supplies its spendable budget after keeping the usual maintenance reserve. */
export function autoDevelopResources(state: GameState, faction: number, budget: number): { ok: boolean; message: string } {
  if (isHumanFaction(state, faction) || budget < RESOURCE_DEVELOPMENT_COST) return { ok: false, message: '' };
  const index = resourceIndex(state), seen = new Set<number>(), developed = index.factionCounts.get(faction);
  const priority = (resource: RegionalResource) => resource === 'copper' && !developed?.get(resource) ? 0
    : resource === 'iron' && !developed?.get(resource) ? 1 : resource === 'salt' ? 2 : resource === 'olives' ? 3 : 4;
  const cells = [...(index.ownedUndeveloped.get(faction) ?? [])].sort((a, b) => priority(state.world.tiles[a].resource!) - priority(state.world.tiles[b].resource!) || a - b);
  for (const cell of cells) {
    if (seen.has(cell)) continue;
    const x = cell % state.world.width, y = Math.floor(cell / state.world.width), status = resourceDevelopmentStatus(state, x, y, faction, budget);
    for (const next of status.cells) seen.add(next);
    if (status.ok && status.cost <= budget) return developResourceGroup(state, x, y, faction, budget);
  }
  return { ok: false, message: '' };
}
