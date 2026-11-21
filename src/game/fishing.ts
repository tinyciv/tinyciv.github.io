import { observeScalars, type ScalarObserver } from './scalar-observer';
import { rustEngine } from './rust-engine';
import { simCore, SimSlot } from './sim-handle';
import { harborWaterEdges } from './harbor-water-geometry';
import { refreshWaterTraffic } from './water-traffic';
import { cityOwnership } from './city-ownership';
import { dockMoorings } from './dock';
import { ECONOMY_INTERVAL } from './economy-constants';
import { entityStore, type EntityStore, type EntityObserver } from './entity-store';
import { grantIncome } from './resource-income';
import { buildingReady, tileAt, WATER, type Building, type GameState, type Point } from './types';
export { harborWaterEdges } from './harbor-water-geometry';

export const FISHING_ZONE_CAPACITY = 8;
export const FISHING_BOAT_CAPACITY = rustEngine.fishery_constant(0);
export const FISHING_INCOME_WINDOW = 90;
export const WHALING_POST_COST = rustEngine.fishery_constant(5);
export const WHALING_POST_HP = rustEngine.fishery_constant(6);
export const WHALE_GOLD = rustEngine.fishery_constant(2);
export const WHALING_RANGE = rustEngine.fishery_constant(7);

/** Serializable mirrors. All stock, resource and voyage decisions live in Rust. */
export interface FishingZone { id: number; cells: number[]; stock: number; capacity: number; collapsed: boolean }
export interface FishingFish extends Point { id: number; zone: number; food: number; spawnedAt: number; facing: number; claimedBy?: number }
export interface WhaleResource extends Point { id: number; readyAt: number }
export interface FishingBoat extends Point {
  id: number; kind?: 'fishing' | 'whaling'; dock: number; city: number; faction: number; hp: number; home: Point;
  phase: 'idle' | 'outbound' | 'loading' | 'returning' | 'unloading'; cargo: number; facing: number; moving: boolean;
  target?: number; path: Point[]; nextPlanAt: number; until?: number; homeCell?: number; routeCells?: number[];
}
export interface FishingState {
  seed: string; startedAt: number; sequence: number; zones: FishingZone[]; fish: FishingFish[]; boats: FishingBoat[];
  whales: WhaleResource[]; nextTick: number; buffs: Record<number, number>;
  receipts: { city: number; faction: number; at: number; food: number }[]; replacements: Record<number, number>;
}
const PHASES = ['idle', 'outbound', 'loading', 'returning', 'unloading'] as const;
const networks = new SimSlot<FisheryBridge>();
const seedHash = (seed: string): number => { let value = 2166136261; for (let i = 0; i < seed.length; i++) value = Math.imul(value ^ seed.charCodeAt(i), 16777619); return value >>> 0; };

class FisheryBridge implements ScalarObserver {
  readonly handle: number;
  readonly store: EntityStore;
  private geometry?: Uint8Array;
  private nextSync = -Infinity;
  private source?: FishingState;
  private sites = new Set<Building>();
  private sitesDirty = true;
  private readonly observer: EntityObserver<Building>;
  private zoneViews = new Map<number, FishingZone>();
  private fishViews = new Map<number, FishingFish[]>();
  constructor(state: GameState) {
    this.handle = simCore(state).handle; this.store = entityStore(state);
    this.observer = { added: b => this.track(b), changed: b => this.track(b), removed: b => { if (this.sites.delete(b)) this.sitesDirty = true; } };
    this.store.buildings.observe(this.observer); for (const b of state.buildings) this.track(b);
    this.syncGeometry(state);
    if (state.fishing) this.restore(state);
    else {
      state.fishing = { seed: state.seed, startedAt: state.time, sequence: 0, zones: [], fish: [], boats: [], whales: [],
        receipts: [], replacements: {}, nextTick: state.time + 1, buffs: {} };
      const islands = (state.world.worldFeatures ?? []).filter(feature => feature.kind === 'atoll' || feature.kind === 'volcanic-island');
      this.publish(state, 5, islands.flatMap(feature => [feature.x, feature.y, feature.radiusX, feature.radiusY,
        feature.kind === 'atoll' ? 0 : 4]), islands.length);
    }
    this.source = state.fishing;
    this.read(state, rustEngine.sim_fishery_step(this.handle, state.time, 0));
  }
  private track(b: Building): void {
    if (b.kind !== 'dock' && b.kind !== 'whalingPost') { if (this.sites.delete(b)) this.sitesDirty = true; return; }
    this.sites.add(b); this.sitesDirty = true;
    observeScalars(b, ['kind', 'faction', 'x', 'y', 'hp', 'construction'], this);
  }
  changed(target: object, key: string, before: unknown, after: unknown): void {
    if (key !== 'hp' || (Number(before) > 0) !== (Number(after) > 0)) { this.sitesDirty = true; if (key === 'kind') this.track(target as Building); }
  }
  private publish(state: GameState, mode: number, values: ArrayLike<number>, count: number): void {
    const pointer = rustEngine.sim_fishery_input(this.handle, values.length);
    new Float64Array(rustEngine.memory.buffer, pointer, values.length).set(values);
    rustEngine.sim_fishery_commit(this.handle, mode, count, state.world.width, state.world.height, seedHash(state.seed), state.time);
  }
  syncGeometry(state: GameState): void {
    const edges = harborWaterEdges(state); if (edges === this.geometry) return;
    const values = new Float64Array(edges.length * 3); values.set(edges);
    for (let i = 0; i < edges.length; i++) {
      const tile = state.world.tiles[i], terrain = tile?.terrain;
      // Preserve ocean/coast identity for native offshore whale placement.
      values[edges.length + i] = terrain === 'lake' ? 1 : terrain === 'ocean' ? 2 : terrain === 'coast' ? 3 : 0;
      const fjord = tile?.fjord === 'water' && (terrain === 'ocean' || terrain === 'coast');
      values[edges.length * 2 + i] = Number(!!terrain && WATER.has(terrain)) | Number(fjord) << 1;
    }
    this.publish(state, 0, values, edges.length); this.geometry = edges;
  }
  private restore(state: GameState): void {
    this.fishViews.clear();
    const f = state.fishing!, buffs = Object.entries(f.buffs), replacements = Object.entries(f.replacements);
    const rows = [0, f.zones.length, f.boats.length, f.whales.length, 0, buffs.length, replacements.length, f.nextTick];
    for (const z of f.zones) { rows.push(z.id, z.stock, z.capacity, Number(z.collapsed), z.cells.length, ...z.cells); this.zoneViews.set(z.id, z); }
    for (const w of f.whales) rows.push(w.id, w.x, w.y, w.readyAt);
    for (const b of f.boats) rows.push(b.id, Number(b.kind === 'whaling'), b.dock, b.city, b.faction, b.x, b.y, b.facing, b.hp,
      PHASES.indexOf(b.phase), b.cargo, b.until ?? state.time, b.homeCell ?? Math.floor(b.home.y) * state.world.width + Math.floor(b.home.x),
      b.target ?? -1, Number(b.moving), b.nextPlanAt, 0, b.routeCells?.length ?? 0, ...b.routeCells ?? []);
    for (const [id, until] of buffs) rows.push(Number(id), until);
    for (const [id, until] of replacements) rows.push(Number(id), until);
    rows[0] = rows.length; this.publish(state, 2, rows, rows.length);
  }
  syncSites(state: GameState): void {
    const ownership = cityOwnership(state), rows: number[] = [];
    for (const b of this.sites) {
      if (b.kind !== 'dock' && b.kind !== 'whalingPost') continue;
      const city = ownership.building(b), faction = state.factions.find(f => f.id === b.faction);
      let home: Point | undefined;
      if (b.kind === 'dock') home = dockMoorings(state, b)[0];
      else {
        const shore = [[0,-1],[1,-1],[2,0],[2,1],[0,2],[1,2],[-1,0],[-1,1]];
        home = shore.map(([dx,dy]) => ({ x: b.x + dx + .5, y: b.y + dy + .5 }))
          .find(p => !!tileAt(state.world, p.x, p.y) && !!this.geometry?.[Math.floor(p.y) * state.world.width + Math.floor(p.x)]);
      }
      rows.push(b.id, Number(b.kind === 'whalingPost'), b.faction, city?.id ?? -1, b.x, b.y,
        Number(buildingReady(b) && b.hp > 0), Number((faction?.research?.levels[b.kind === 'dock' ? 'sailing' : 'whaling'] ?? 0) > 0),
        home?.x ?? -1, home?.y ?? -1, Number(!!faction && !faction.defeated && !!home));
    }
    this.publish(state, 1, rows, rows.length / 11); this.sitesDirty = false;
  }
  step(state: GameState, dt: number): number {
    if (state.fishing !== this.source) { this.restore(state); this.source = state.fishing; }
    if (this.sitesDirty || state.time >= this.nextSync) { this.syncGeometry(state); this.syncSites(state); this.nextSync = state.time + 1; }
    const health: number[] = []; for (const b of state.fishing?.boats ?? []) health.push(b.id, b.hp);
    this.publish(state, 4, health, health.length / 2);
    const blockers: number[] = [];
    for (const u of this.store.units.query('vessel')) if (u.hp > 0 && u.kind === 'sailboat')
      blockers.push(u.x, u.y, u.facing, u.warship ? 1.5 : u.seaInvasion === undefined ? 1 : .5, u.warship ? 1 : .5);
    for (const route of state.tradeRoutes ?? []) {
      const u = route.merchantId === undefined ? undefined : this.store.units.get(route.merchantId);
      if (u?.hp && u.hp > 0 && u.aboardRiverTrade) blockers.push(u.x, u.y, u.facing, 0, .3);
    }
    for (const b of state.harborTradeShips ?? []) blockers.push(b.x, b.y, b.facing, 0, .25);
    this.publish(state, 3, blockers, blockers.length / 5);
    return this.read(state, rustEngine.sim_fishery_step(this.handle, state.time, dt));
  }
  private read(state: GameState, pointer: number): number {
    const length = rustEngine.sim_fishery_length(this.handle), values = new Float64Array(rustEngine.memory.buffer, pointer, length).slice();
    const f = state.fishing!, width = state.world.width, [, zones, boats, whales, events, buffs, replacements, nextTick] = values;
    f.nextTick = nextTick; let p = 8;
    let fishChanged = false;
    f.zones = [];
    for (let i = 0; i < zones; i++) {
      const [id, stock, capacity, collapsed, count] = values.subarray(p, p + 5); p += 5;
      let z = this.zoneViews.get(id);
      if (!z) { z = { id, stock, capacity, collapsed: !!collapsed, cells: [] }; this.zoneViews.set(id, z); }
      z.stock = stock; z.capacity = capacity; z.collapsed = !!collapsed;
      if (count) z.cells = Array.from(values.subarray(p, p + count)); p += count; f.zones.push(z);
      // Presentation proxies: never used as harvestable stock or navigation targets.
      const countVisible = Math.min(z.cells.length, Math.floor(FISHING_ZONE_CAPACITY * stock / capacity));
      let fish = this.fishViews.get(id);
      if (!fish || count || fish.length !== countVisible) {
        fishChanged = true;
        fish = Array.from({ length: countVisible }, (_, k) => {
          const cells = z!.cells, offset = Math.imul(id, 17) % cells.length;
          const slot = cells.length % 29 === 0 ? Math.floor(k * cells.length / FISHING_ZONE_CAPACITY) : k * 29;
          const cell = cells[(offset + slot) % cells.length];
          return { id: id * 16 + k, zone: id, x: cell % width + .5, y: Math.floor(cell / width) + .5, facing: k % 2 ? Math.PI : 0, food: 0, spawnedAt: f.startedAt };
        }); this.fishViews.set(id, fish);
      }
    }
    if (fishChanged) f.fish = f.zones.flatMap(z => this.fishViews.get(z.id) ?? []);
    f.whales = []; for (let i = 0; i < whales; i++) { f.whales.push({ id: values[p], x: values[p + 1], y: values[p + 2], readyAt: values[p + 3] }); p += 4; }
    const previous = new Map(f.boats.map(b => [b.id, b])), nextBoats: FishingBoat[] = [];
    for (let i = 0; i < boats; i++) {
      const r = values.subarray(p, p + 18), homeCell = r[12], routeCells = Array.from(values.subarray(p + 18, p + 18 + r[17]));
      const b: FishingBoat = previous.get(r[0]) ?? {} as FishingBoat;
      Object.assign(b, { id: r[0], kind: r[1] ? 'whaling' : 'fishing', dock: r[2], city: r[3], faction: r[4], x: r[5], y: r[6], facing: r[7], hp: r[8],
        phase: PHASES[r[9]], cargo: r[10], until: r[11], homeCell, target: r[13], moving: !!r[14], nextPlanAt: r[15], routeCells,
        home: { x: homeCell % width + .5, y: Math.floor(homeCell / width) + .5 }, path: routeCells.map(c => ({ x: c % width + .5, y: Math.floor(c / width) + .5 })) });
      nextBoats.push(b); p += 18 + r[17];
    }
    if (nextBoats.length !== f.boats.length || nextBoats.some((b, i) => b !== f.boats[i])) f.boats = nextBoats;
    for (const b of f.boats) refreshWaterTraffic(state, b);
    f.buffs = {}; for (let i = 0; i < buffs; i++) { f.buffs[values[p]] = values[p + 1]; p += 2; }
    for (const faction of state.factions) faction.whalingUntil = f.buffs[faction.id] ?? 0;
    f.replacements = {}; for (let i = 0; i < replacements; i++) { f.replacements[values[p]] = values[p + 1]; p += 2; }
    let delivered = 0;
    for (let i = 0; i < events; i++) {
      const [cityId, factionId, kind, amount, at] = values.subarray(p, p + 5); p += 5;
      const city = this.store.buildings.get(cityId), faction = state.factions.find(f => f.id === factionId);
      if (!city || !faction || city.faction !== factionId || !buildingReady(city) || faction.defeated) continue;
      grantIncome(faction, kind ? { gold: amount } : { food: amount }, state, kind ? 'loot' : undefined);
      if (!kind) { city.foodDelivered = (city.foodDelivered ?? 0) + amount; f.receipts.push({ city: cityId, faction: factionId, at, food: amount }); delivered += amount; }
      state.particles.push({ x: city.x + 1, y: city.y + 1, text: `+${Math.round(amount)} ${kind ? 'gold' : 'food'}`, color: kind ? '#edcf7a' : '#b9df85', life: 1.6, kind: kind ? undefined : 'food' });
    }
    pruneFishingReceipts(state); return delivered;
  }
}
function network(state: GameState): FisheryBridge {
  let current = networks.get(state);
  if (!current || current.store !== entityStore(state)) current = networks.set(state, new FisheryBridge(state));
  return current;
}
export function initializeFishing(state: GameState): void { network(state); }
/** Offline authoring command; resource choices stay in the fisheries ECS. */
export function provisionScenarioWhales(state: GameState): number {
  const bridge = network(state); bridge.syncGeometry(state); bridge.syncSites(state);
  const count = rustEngine.sim_fishery_scenario_whales(bridge.handle);
  bridge.step(state, 0);
  return count;
}
/** Offline native authoring; returns the number of original districts refined. */
export function provisionAtollFisheries(state: GameState, center: Point, radii: Point, multiplier = 4): number {
  const bridge = network(state); bridge.syncGeometry(state); bridge.syncSites(state);
  const refined = rustEngine.sim_fishery_atoll_provision(bridge.handle, center.x, center.y, radii.x, radii.y, multiplier);
  bridge.step(state, 0);
  return refined;
}
export function updateFishing(state: GameState, dt: number): number { return network(state).step(state, dt); }
/** Explicit diagnostic reads; ordinary simulation and rendering do not call this. */
export function fisheryPathStatus(state: GameState, id: number) {
  const pointer = rustEngine.sim_fishery_status(simCore(state).handle, id);
  const r = new Float64Array(rustEngine.memory.buffer, pointer, 20).slice();
  return { id: r[0], phase: r[1], x: r[2], y: r[3], angle: r[4], route: r[5], queued: !!r[6], searching: !!r[7],
    visited: r[8], frontier: r[9], goal: { x: r[10], y: r[11] }, maneuver: r[12],
    currentShoreClear: !!r[13], currentTrafficClear: !!r[14], goalShoreClear: !!r[15], goalTrafficClear: !!r[16],
    yielding: !!r[17], activeSearches: r[18], waiting: r[19] };
}
export function whalingPostSiteError(state: GameState, point: Point): string | undefined {
  const bridge = network(state); bridge.syncGeometry(state);
  return rustEngine.sim_fishery_placement(bridge.handle, point.x, point.y) ? undefined : 'A whaling post needs water beside its 2×2 shore site.';
}
/** Native multiplier; the host only transports the faction's expiry mirror. */
export function whalingMovementSpeed(state: GameState, faction: number, value: number): number {
  return rustEngine.fishery_speed(state.factions.find(f => f.id === faction)?.whalingUntil ?? 0, state.time, value);
}
type FishingReceipt = FishingState['receipts'][number];
interface ReceiptIndex {
  source: FishingReceipt[]; count: number; head: number; time: number; revision: number;
  totals: Map<number, Map<number, number>>;
}
const receiptIndexes = new WeakMap<FishingState, ReceiptIndex>();
function fishingReceipts(state: GameState): ReceiptIndex | undefined {
  const fishing = state.fishing; if (!fishing) return;
  let index = receiptIndexes.get(fishing);
  if (!index || index.source !== fishing.receipts || fishing.receipts.length < index.count || state.time < index.time) {
    index = { source: fishing.receipts, count: 0, head: 0, time: state.time, revision: (index?.revision ?? 0) + 1, totals: new Map() };
    receiptIndexes.set(fishing, index);
  }
  const adjust = (receipt: FishingReceipt, amount: number): void => {
    let city = index!.totals.get(receipt.city);
    if (!city) { city = new Map(); index!.totals.set(receipt.city, city); }
    city.set(receipt.faction, (city.get(receipt.faction) ?? 0) + amount);
    index!.revision++;
  };
  for (; index.count < index.source.length; index.count++) adjust(index.source[index.count], index.source[index.count].food);
  while (index.head < index.count && index.source[index.head].at <= state.time - FISHING_INCOME_WINDOW) {
    const receipt = index.source[index.head++]; adjust(receipt, -receipt.food);
  }
  index.time = state.time;
  return index;
}
/** Revision of the rolling receipts, with expiry processed once for all cities. */
export function fishingIncomeRevision(state: GameState): number {
  return fishingReceipts(state)?.revision ?? 0;
}
function pruneFishingReceipts(state: GameState): void {
  const index = fishingReceipts(state);
  if (index?.head && (index.head >= 256 || index.head * 2 >= index.count)) {
    index.source = state.fishing!.receipts = index.source.slice(index.head);
    index.count -= index.head; index.head = 0;
  }
}

/** Each delivery and expiry changes a city/faction total once. Reads do not
 * rescan other cities' receipts; capture cannot inherit the former owner's catch. */
export function fishingCityFoodPerEconomyCycle(state: GameState, palaceId: number): number {
  const fishing = state.fishing; if (!fishing) return 0;
  const palace = entityStore(state).buildings.get(palaceId); if (!palace || !buildingReady(palace)) return 0;
  const elapsed = Math.max(ECONOMY_INTERVAL, Math.min(FISHING_INCOME_WINDOW, state.time - fishing.startedAt));
  const index = fishingReceipts(state)!;
  return (index.totals.get(palaceId)?.get(palace.faction) ?? 0) * ECONOMY_INTERVAL / elapsed;
}
