import { playerFaction } from './player-context';
import { civilianWorkforcePopulations, constructionWorkerAllowance, recordCivilianCasualties } from './civilian-population';
import { forbiddenRevision, isForbidden } from './forbidden-zones';
import { buildingWorkForbidden } from './forbidden-work';
import { canDispatchPeasant } from './peasant-capacity';
import { indexedBuilding } from './spatial';
import { type Building, type FarmField, type FoodBatch, type GameState, type Point, type Unit, type World, buildingReady, buildingSize, buildingWidth, buildingHeight, distance, isFarmKind, tileAt, WATER } from './types';
import { canWalk, hasStaticPath, withNavigationFrame, workNavigationState } from './pathfinding';
import { terrainYields } from '../world/generator';
import { houseCapacity, updateWellUpgrades } from './wells';
import { deliverFoodCargo, expireFoodCargo, refreshFoodCargo } from './food-cargo';
import { ORCHARD_YIELD_MULTIPLIER } from './orchards';
import { irrigationYieldMultiplier } from './irrigation';
import { soilFertility } from './fertility';
import { SimulationEvents } from './simulation-events';
import { entityStore, buildingWithId } from './entity-store';
import { idleJobDecisionDue } from './settlement-decisions';
import { questEffect } from './quest-effects';
import { AchievementEffect, achievementEffect } from './achievement-effects';
import { farmResearchYieldMultiplier, grainStorageMultiplier } from './research-bonuses';
import { farmCityQuery, farmStorageQuery, farmTravelRevision } from './farm-travel';
import { assignFarmStorage, granaryYieldMultiplier, STORAGE_REASSIGN, STORAGE_ENTER } from './granaries-native';
import { courierOutboundPath, courierReturnPath } from './courier-routes';
import { farmParcelChanged, parcelHarvest, setParcelPickup } from './farm-parcels';
import { canDepartFarm, departFarm, finishFarmTrip, farmDispatchWakeAt, invalidateFarmDispatch } from './farm-dispatch';
import { invalidateCourierSleep, wakeFarmCouriers } from './courier-sleep';
import { markWorldChanged, worldRevisions, worldStructureRevision } from './world-revisions';
import { ECONOMY_INTERVAL } from './economy-constants';
import { reliefBuildable } from './relief';
import { refreshWheatReadiness, wheatFieldGroups, type WheatGroups } from './wheat-fields';
import { farmFieldIndex, invalidateFarmFieldIndex, type FarmFieldIndex } from './farm-index';
import { simulationReadsActive, structureChangeRevision } from './simulation-reads';
import { invalidateWorkerHomes, settlementBuildings, settlementWorkers } from './settlement-rosters';
import { decisionDue, type DecisionClock } from './decision-schedule';
import { CHECK_INTERVAL, recurringWorkElapsed } from './work-cadence';
import { farmWorkGroups, type FarmWorkGroup, type FarmWorkGroups } from './farm-work-groups';

/** Larger, less frequent batches reduce courier trips without cutting production. */
export const FIELD_HARVEST_SECONDS = 60;
/** One-third more yield needs 25% less farmland for the same meals. */
export const FIELD_HARVEST_FOOD = (.4 * 4 / 3) * FIELD_HARVEST_SECONDS / ECONOMY_INTERVAL;
/** HUD, growth and investment use production per economy period, not batch size. */
export function harvestFoodPerEconomyCycle(food: number): number {
  return food * ECONOMY_INTERVAL / FIELD_HARVEST_SECONDS;
}
/** A fixed half-cycle pickup/delivery window leaves room for the city's queue.
 * Gathering never rewrites deadlines, even if the worker is delayed or fleeing. */
export const FIELD_SPOIL_SECONDS = FIELD_HARVEST_SECONDS / 2;
/** Investment reserves the rest of the pickup window for queueing. Keeping
 * a short travel budget favors compact farms as city dispatch becomes bounded. */
const FARM_TRANSPORT_SECONDS = 11;
export const FIELD_SPOIL_WARNING_SECONDS = 4;
export const FARM_COURIER_SPEED = 2.2;
export const FARM_IDLE_SECONDS = 120;
export const FARM_ABANDON_SECONDS = 600;
const PICKUP_CANDIDATE_LIMIT = 4, FARM_ROUTE_RETRY_SECONDS = 3;

export function fieldSpoilsSoon(field: FarmField, time: number): boolean {
  return field.food > 0 && field.expiresAt !== undefined && field.expiresAt > time
    && field.expiresAt - time <= FIELD_SPOIL_WARNING_SECONDS;
}

function lostFood(state: GameState, point: Point, amount: number): void {
  if (amount <= 1e-7) return;
  state.particles.push({ x: point.x + .5, y: point.y + .25, text: `−${Math.round(amount)} food`, color: '#f46b63', life: 1.6 });
}

/** Only newly ripened grain receives storage's longer deadline. Orchard fruit
 * keeps its normal lifetime, and existing bags never restart their clock. */
function harvestShelfLife(state: GameState, source: Pick<FarmField, 'faction' | 'orchard'>): number {
  return FIELD_SPOIL_SECONDS * (source.orchard ? 1 : grainStorageMultiplier(state.factions.find(faction => faction.id === source.faction)));
}

function fieldBatches(state: GameState, field: FarmField): FoodBatch[] {
  // Direct simulation fixtures can seed a bag; normal harvests always have a deadline.
  if (field.food > 0 && !field.foodBatches?.length)
    field.foodBatches = [{ amount: field.food, expiresAt: field.expiresAt ?? state.time + harvestShelfLife(state, field) }];
  return field.foodBatches ??= [];
}
function totalBatches(batches: FoodBatch[]): number { return batches.reduce((sum, batch) => sum + batch.amount, 0); }
function refreshField(field: FarmField): void {
  let food = 0, expiresAt = Infinity;
  const batches = field.foodBatches ?? [];
  for (const batch of batches) { food += batch.amount; expiresAt = Math.min(expiresAt, batch.expiresAt); }
  field.food = food; field.expiresAt = batches.length ? expiresAt : undefined;
}
function refreshCargo(unit: Unit): void {
  refreshFoodCargo(unit);
}
function spoilCargo(state: GameState, unit: Unit): void {
  if ((unit.cargo ?? 0) > 0 && !unit.cargoBatches?.length)
    unit.cargoBatches = [{ amount: unit.cargo!, expiresAt: unit.cargoExpiresAt ?? state.time + cargoShelfLife(state, unit) }];
  expireFoodCargo(state, unit);
}
function cargoShelfLife(state: GameState, unit: Unit): number {
  const source = claimedField(state, unit.cargoField ?? unit.field)
    ?? buildingWithId(state, unit.collectorCamp);
  return harvestShelfLife(state, { faction: source?.faction ?? unit.faction, orchard: source?.orchard });
}
const CLEARABLE = new Set(['forest', 'jungle', 'swamp']);

/** Use the field's ground, not the camp's tile or cleared vegetation. Keep
 * fractional food through harvest, transport, and the settlement balance. */
export function fieldHarvestFood(world: World, x: number, y: number): number {
  const tile = tileAt(world, x, y);
  if (!tile || WATER.has(tile.terrain)) return 0;
  return FIELD_HARVEST_FOOD * soilFertility(world, x, y);
}

/** Actual and projected farm production share the same completed-ditch bonus. */
export function fieldHarvestFoodForState(state: GameState, x: number, y: number, factionId = tileAt(state.world, x, y)?.farm ?? 0, orchard = false): number {
  const faction = state.factions.find(candidate => candidate.id === factionId);
  return fieldHarvestFood(state.world, x, y) * farmResearchYieldMultiplier(faction) * achievementEffect(faction, AchievementEffect.orchard,
    questEffect(faction, 6, irrigationYieldMultiplier(state, x, y) * (1 + (faction?.villageBonuses?.food ?? 0))
      * granaryYieldMultiplier(state, factionId, x, y) * (orchard ? ORCHARD_YIELD_MULTIPLIER : 1)), Number(orchard));
}

/** Actual production includes orchard establishment and its mature yield. */
export function fieldHarvestYield(state: GameState, field: FarmField, time = state.time): number {
  if (field.orchard && time + 1e-7 < field.orchard.readyAt) return 0;
  return fieldHarvestFoodForState(state, field.x, field.y, field.faction, !!field.orchard);
}

/** Coarse investment estimate after reserving time for the city's queue.
 * Storage research expands both queue and travel allowances proportionally;
 * actual food keeps its fixed harvest deadline until delivery. */
export function expectedFarmDelivery(walkingDistance: number, shelfLife = FIELD_SPOIL_SECONDS): number {
  const travelWindow = shelfLife * FARM_TRANSPORT_SECONDS / FIELD_SPOIL_SECONDS;
  return Math.max(0, Math.min(1, (travelWindow - 2 * walkingDistance / FARM_COURIER_SPEED + 1) / 6));
}

/** Irrational spacing distributes camps throughout the cycle without consuming simulation RNG. */
function nextCampHarvest(earliest: number, camp: number): number {
  const phase = ((camp * .6180339887498949) % 1) * FIELD_HARVEST_SECONDS;
  return phase + Math.ceil((earliest - phase - 1e-7) / FIELD_HARVEST_SECONDS) * FIELD_HARVEST_SECONDS;
}

function harvestDue(state: GameState, field: FarmField, dormantAt = Infinity): void {
  const version = state.farmVersion;
  const batches = fieldBatches(state, field);
  // A skipped interval may include the abandonment deadline. Account for the
  // earlier harvests, but never create crops at or after that deadline.
  const growUntil = Math.min(state.time + 1e-7, dormantAt - 1e-7);
  if (!batches.length && (!field.planted || growUntil < field.nextHarvest)) {
    field.food = 0; field.expiresAt = undefined;
    return;
  }
  let expired = 0;
  // Keep distinct harvest deadlines: a new crop cannot extend an old bag's life.
  if (field.planted && growUntil >= field.nextHarvest) {
    const count = Math.floor((growUntil - field.nextHarvest) / FIELD_HARVEST_SECONDS) + 1;
    const amount = fieldHarvestYield(state, field), shelfLife = harvestShelfLife(state, field);
    const firstYield = field.orchard ? 0 : Math.max(0, Math.ceil(((field.wheatYieldAfter ?? field.nextHarvest) - field.nextHarvest - 1e-7) / FIELD_HARVEST_SECONDS));
    for (let i = firstYield; i < count; i++) {
      const expiresAt = field.nextHarvest + i * FIELD_HARVEST_SECONDS + shelfLife;
      if (expiresAt <= state.time + 1e-7) expired += amount;
      else batches.push({ amount, expiresAt });
    }
    field.nextHarvest += FIELD_HARVEST_SECONDS * count;
    state.farmVersion = (state.farmVersion ?? 0) + 1;
  }
  for (const batch of batches) if (batch.expiresAt <= state.time + 1e-7) expired += batch.amount;
  field.foodBatches = batches.filter(batch => batch.expiresAt > state.time + 1e-7);
  refreshField(field);
  if (expired > 0) {
    lostFood(state, field, expired);
    if (!field.food) field.harvestedAt = state.time;
    state.farmVersion = (state.farmVersion ?? 0) + 1;
  }
  if (state.farmVersion !== version) wakeFarmCouriers(state, field.camp);
  if (state.farmVersion !== version) farmParcelChanged(state, field);
}

/** Each farm occupies one tile; neighboring farms may share all four edges. */
export const CAMP_FIELD_OFFSETS: readonly (readonly [number, number])[] = [[0, 0]];

/** Farms never supply housing. */
export function isHome(building: Building): boolean {
  return isFarmKind(building.kind);
}

/** Reserve the future plot while its camp is being built, without growing food early. */
export function isPendingCampField(state: GameState, x: number, y: number): boolean {
  const tile = tileAt(state.world, x, y);
  if (!tile || !reliefBuildable(tile) || WATER.has(tile.terrain) || (!CLEARABLE.has(tile.overlay) && tile.overlay !== 'none')) return false;
  return state.buildings.some(site => site.hp > 0 && site.construction && isHome(site) && !site.farmSuppressed
    && x >= site.x && y >= site.y && x < site.x + buildingWidth(site) && y < site.y + buildingHeight(site)
    && !state.buildings.some(building => building.id !== site.id && building.hp > 0 && building.kind !== 'irrigation' && x >= building.x && y >= building.y
      && x < building.x + buildingWidth(building) && y < building.y + buildingHeight(building)));
}

interface FarmTopology {
  world: World; tiles: World['tiles']; width: number; height: number; revision: number | undefined;
  membership: number; structure: number; worldStructure: number; sight: number;
  buildings: { id: number; kind: Building['kind']; faction: number; x: number; y: number; alive: boolean; ready: boolean; suppressed: boolean | undefined }[];
  fields: FarmField[];
  plots: { field: FarmField; camp: number; faction: number; x: number; y: number; orchard: boolean }[];
  ground: { x: number; y: number; terrain: string | undefined; overlay: string | undefined; farm: number | undefined; palm: boolean | undefined; marsh: boolean | undefined }[];
}
const farmTopologies = new WeakMap<GameState, FarmTopology>();

/** Housing and harvests change every tick, but plot membership does not.
 * Scalar validation also sees direct edits made by tools and isolated fixtures. */
function farmTopologyCurrent(state: GameState, camps: Building[]): boolean {
  const cached = farmTopologies.get(state), world = state.world;
  if (!cached || cached.world !== world || cached.tiles !== world.tiles || cached.width !== world.width || cached.height !== world.height
    || cached.fields !== state.fields || cached.plots.length !== state.fields.length
    || cached.buildings.length !== state.buildings.length) return false;
  if (simulationReadsActive(state)) return cached.membership === entityStore(state).buildings.revision
    && cached.structure === structureChangeRevision(state) && cached.worldStructure === worldStructureRevision(world)
    && cached.sight === worldRevisions(world).sight;
  if (cached.revision !== world.revision || camps.some(camp => (camp.storedFood ?? 0) > 0)) return false;
  for (let i = 0; i < state.buildings.length; i++) {
    const building = state.buildings[i], old = cached.buildings[i];
    if (building.id !== old.id || building.kind !== old.kind || building.faction !== old.faction || building.x !== old.x || building.y !== old.y
      || (building.hp > 0) !== old.alive || buildingReady(building) !== old.ready || building.farmSuppressed !== old.suppressed) return false;
  }
  for (let i = 0; i < state.fields.length; i++) {
    const field = state.fields[i], old = cached.plots[i];
    if (field !== old.field || field.camp !== old.camp || field.faction !== old.faction || field.x !== old.x || field.y !== old.y) return false;
  }
  for (const old of cached.ground) {
    const tile = tileAt(world, old.x, old.y);
    if (tile?.terrain !== old.terrain || tile?.overlay !== old.overlay || tile?.farm !== old.farm || tile?.palm !== old.palm || tile?.marsh !== old.marsh) return false;
  }
  return true;
}
function rememberFarmTopology(state: GameState, camps: Building[]): void {
  const { world } = state, fields = state.fields!;
  farmTopologies.set(state, {
    world, tiles: world.tiles, width: world.width, height: world.height, revision: world.revision, fields,
    membership: entityStore(state).buildings.revision, structure: structureChangeRevision(state),
    worldStructure: worldStructureRevision(world), sight: worldRevisions(world).sight,
    buildings: state.buildings.map(building => ({ id: building.id, kind: building.kind, faction: building.faction, x: building.x, y: building.y,
      alive: building.hp > 0, ready: buildingReady(building), suppressed: building.farmSuppressed })),
    plots: fields.map(field => ({ field, camp: field.camp, faction: field.faction, x: field.x, y: field.y, orchard: !!field.orchard })),
    ground: camps.flatMap(camp => CAMP_FIELD_OFFSETS.map(([dx, dy]) => {
      const x = camp.x + dx, y = camp.y + dy, tile = tileAt(world, x, y);
      return { x, y, terrain: tile?.terrain, overlay: tile?.overlay, farm: tile?.farm, palm: tile?.palm, marsh: tile?.marsh };
    })),
  });
}

/** Residents live in houses or palace quarters. Farms have no residents. */
export function synchronizeFarms(state: GameState): void {
  if (simulationReadsActive(state) && recurringWorkElapsed(state, 'farms:sync', 0) === undefined) return;
  state.fields ??= [];
  updateWellUpgrades(state);
  const { farms: camps, housesByFaction, palacesByFaction } = settlementBuildings(state);
  for (const camp of camps) { camp.capacity = 0; camp.residents = 0; }
  for (const faction of state.factions) {
    let remaining = faction.population;
    const houses = housesByFaction.get(faction.id) ?? [];
    const palaces = palacesByFaction.get(faction.id) ?? [];
    // Keep residents in their existing city instead of repacking the realm
    // into the first houses every frame. Population losses still clamp totals.
    for (const house of houses) {
      house.capacity = houseCapacity(house, faction, state);
      house.residents = buildingReady(house) ? Math.min(house.capacity, Math.max(0, house.residents ?? 0), Math.max(0, remaining)) : 0;
      remaining -= house.residents;
    }
    for (const palace of palaces) {
      palace.unhousedResidents = Math.min(Math.max(0, palace.unhousedResidents ?? 0), Math.max(0, remaining));
      remaining -= palace.unhousedResidents;
    }
    for (const house of houses) if (buildingReady(house) && house.residents! < house.capacity) {
      let nearest: Building | undefined, best = Infinity;
      for (const palace of palaces) {
        const d = (house.x + .5 - palace.x - 1) ** 2 + (house.y + .5 - palace.y - 1) ** 2;
        if (d < best || d === best && palace.id < nearest!.id) { nearest = palace; best = d; }
      }
      const local = Math.min(house.capacity - house.residents!, nearest?.unhousedResidents ?? 0);
      house.residents! += local;
      if (nearest && local) nearest.unhousedResidents! -= local;
    }
    for (const house of houses) if (buildingReady(house) && remaining > 0) {
      const incoming = Math.min(house.capacity - house.residents!, remaining);
      house.residents! += incoming; remaining -= incoming;
    }
    for (const palace of palaces) if (remaining > 0) {
      const incoming = Math.min(Math.max(0, palace.capacity - (palace.unhousedResidents ?? 0)), remaining);
      palace.unhousedResidents = (palace.unhousedResidents ?? 0) + incoming; remaining -= incoming;
    }
  }
  if (farmTopologyCurrent(state, camps)) {
    if (!simulationReadsActive(state)) synchronizeWheatFields(state);
    return;
  }
  const previous = state.fields;
  const previousTopology = farmTopologies.get(state);
  let cropChanged = false;
  const fields: FarmField[] = [], retained = new Set<FarmField>();
  const reserved = new Set<number>();
  const previousPlots = new Map<number, Map<number, FarmField>>();
  for (const field of previous) {
    let plots = previousPlots.get(field.camp);
    if (!plots) { plots = new Map(); previousPlots.set(field.camp, plots); }
    const key = field.y * state.world.width + field.x;
    if (!plots.has(key)) plots.set(key, field);
  }
  // Build footprint and spacing lookups once. Checking every building and every
  // previous field for each plot made mature settlements quadratic per frame.
  const occupied = new Map<number, Set<number>>();
  // Ditches share crop ground; roads require moving the farm before placement.
  for (const building of state.buildings) if (building.hp > 0 && building.kind !== 'irrigation') {
    for (let dy = 0; dy < buildingHeight(building); dy++) for (let dx = 0; dx < buildingWidth(building); dx++) {
      const key = (building.y + dy) * state.world.width + building.x + dx;
      let ids = occupied.get(key); if (!ids) { ids = new Set(); occupied.set(key, ids); }
      ids.add(building.id);
    }
  }
  const firstField = new Map<number, FarmField>();
  for (const camp of camps) {
    if (!buildingReady(camp) || camp.farmSuppressed) continue;
    const newlyEstablished = camp.farmLastVisitedAt === undefined;
    camp.farmLastVisitedAt ??= state.time;
    for (const [dx, dy] of CAMP_FIELD_OFFSETS) {
      const x = camp.x + dx, y = camp.y + dy, key = y * state.world.width + x;
      const tile = tileAt(state.world, x, y);
      if (!tile || !reliefBuildable(tile) || WATER.has(tile.terrain) || (!CLEARABLE.has(tile.overlay) && tile.overlay !== 'none') || reserved.has(key)) continue;
      const occupants = occupied.get(key);
      if (occupants && (occupants.size > 1 || !occupants.has(camp.id))) continue;
      const old = previousPlots.get(camp.id)?.get(key);
      const mature = !camp.orchard || state.time + 1e-7 >= camp.orchard.readyAt;
      const field = old ?? { id: key + 1, camp: camp.id, faction: camp.faction, x, y, planted: !camp.farmFallow && mature, food: 0,
        nextHarvest: nextCampHarvest(state.time + FIELD_HARVEST_SECONDS, camp.id), harvestStaggered: true };
      const wasPlanted = field.planted, previousHarvest = field.nextHarvest, previousOrchard = field.orchard;
      field.orchard = camp.orchard;
      if (!mature) { field.planted = false; field.nextHarvest = camp.orchard!.readyAt; }
      if (!old && newlyEstablished) camp.farmFirstHarvestAt = field.nextHarvest;
      // A terrain edit, ownership change or housing synchronization is not a
      // visit: it must not silently replant an abandoned farm.
      if (!field.planted && !camp.farmFallow && mature) {
        field.planted = true;
        if (!camp.orchard) field.nextHarvest = nextCampHarvest(state.time + FIELD_HARVEST_SECONDS, camp.id);
        delete field.harvestedAt;
        state.farmVersion = (state.farmVersion ?? 0) + 1;
      }
      if (field.faction !== camp.faction || !old) state.farmVersion = (state.farmVersion ?? 0) + 1;
      field.faction = camp.faction;
      if (field.planted !== wasPlanted || field.nextHarvest !== previousHarvest || field.orchard !== previousOrchard) {
        cropChanged = true; harvestFieldChanged(state, field);
      }
      fields.push(field); retained.add(field); reserved.add(key);
      if (!firstField.has(camp.id)) firstField.set(camp.id, field);
      if (tile.farm !== camp.faction || CLEARABLE.has(tile.overlay) || tile.palm || tile.marsh) {
        const clearsCover = CLEARABLE.has(tile.overlay);
        tile.farm = camp.faction;
        delete tile.palm;
        delete tile.marsh;
        if (clearsCover) { tile.overlay = 'none'; Object.assign(tile, terrainYields(tile.terrain, 'none')); }
        markWorldChanged(state.world, clearsCover ? 'sight' : 'appearance', [key]);
      }
    }
  }
  const campsById = new Map(camps.map(camp => [camp.id, camp]));
  for (const field of previous) if (!retained.has(field)) {
    const camp = campsById.get(field.camp);
    if (camp && field.food > 0) {
      camp.storedFoodBatches = [...(camp.storedFoodBatches ?? []), ...fieldBatches(state, field)];
      camp.storedFood = totalBatches(camp.storedFoodBatches);
    }
    const tile = tileAt(state.world, field.x, field.y);
    if (tile && !reserved.has(field.y * state.world.width + field.x)) delete tile.farm;
    markWorldChanged(state.world, 'appearance', [field.y * state.world.width + field.x]);
    state.farmVersion = (state.farmVersion ?? 0) + 1;
  }
  for (const camp of camps) if ((camp.storedFood ?? 0) > 0) {
    const field = firstField.get(camp.id);
    if (field) {
      field.foodBatches = [...fieldBatches(state, field), ...(camp.storedFoodBatches ?? [{ amount: camp.storedFood!, expiresAt: state.time + harvestShelfLife(state, camp) }])];
      refreshField(field); delete camp.storedFood; delete camp.storedFoodBatches;
      harvestFieldChanged(state, field);
      state.farmVersion = (state.farmVersion ?? 0) + 1;
    }
  }
  const sameMembers = fields.length === previous.length && fields.every((field, index) => field === previous[index]);
  const sameTopology = sameMembers && previousTopology?.plots.length === fields.length && fields.every((field, index) => {
    const old = previousTopology.plots[index];
    return old.field === field && old.camp === field.camp && old.faction === field.faction
      && old.x === field.x && old.y === field.y && old.orchard === !!field.orchard;
  });
  state.fields = sameMembers ? previous : fields;
  if (!sameTopology) invalidateScheduledHarvests(state);
  if (!sameTopology || cropChanged || !simulationReadsActive(state)) synchronizeWheatFields(state);
  rememberFarmTopology(state, camps);
}

interface PalaceEntranceClock extends DecisionClock { state: GameState; points: Point[] }
const palaceEntranceClocks = new WeakMap<Building, PalaceEntranceClock>();
function palaceEdges(state: GameState, palace: Building): Point[] {
  let clock = palaceEntranceClocks.get(palace);
  if (!clock || clock.state !== state) { clock = { state, points: [] }; palaceEntranceClocks.set(palace, clock); }
  if (!simulationReadsActive(state) || decisionDue(clock, state.time, palace.id)) clock.points = scanPalaceEdges(state, palace);
  // Callers sort their door choices, so never expose the retained array itself.
  return clock.points.slice();
}
function scanPalaceEdges(state: GameState, palace: Building): Point[] {
  const size = buildingSize(palace), points: Point[] = [];
  for (let i = 0; i < size; i++) {
    points.push({ x: palace.x - .5, y: palace.y + i + .5 }, { x: palace.x + size + .5, y: palace.y + i + .5 },
      { x: palace.x + i + .5, y: palace.y - .5 }, { x: palace.x + i + .5, y: palace.y + size + .5 });
  }
  return points.filter(point => canWalk(state, point.x, point.y, palace.faction, undefined, true));
}

function createCollector(state: GameState, palace: Building, camp: Building): Unit {
  const unit: Unit = {
    id: entityStore(state).allocateId(),
    x: palace.x + 1, y: palace.y + 1, kind: 'worker', faction: palace.faction, home: palace.id,
    hp: 50, maxHp: 50, morale: 100, attack: 0, defense: 0, speed: FARM_COURIER_SPEED, range: 1.1, order: 'work',
    cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0, bornAt: state.time,
    collector: true, collectorCamp: camp.id, inside: true, cargo: 0, collectPhase: 'idle',
  };
  return entityStore(state).units.add(unit);
}

interface CollectorHomes {
  signature: string; tiles: GameState['world']['tiles']; travelRevision: ReturnType<typeof farmTravelRevision>;
  homes: Map<number, Building>;
  membership: number; structure: number; worldStructure: number; factions: string;
}
const collectorHomes = new WeakMap<GameState, CollectorHomes>();

/** Farm/city membership stays immediate. Route-cost changes are reconciled
 * when the shared farming travel maps publish their next batched revision. */
function campPalaces(state: GameState, camps: Building[]): Map<number, Building> {
  const travelRevision = farmTravelRevision(state);
  const buildings = entityStore(state).buildings, trusted = simulationReadsActive(state);
  const membership = buildings.revision, structure = structureChangeRevision(state), worldStructure = trusted ? worldStructureRevision(state.world) : 0;
  const factions = state.factions.map(faction => `${faction.id}:${faction.defeated}:${faction.relation}`).join(';');
  const cached = collectorHomes.get(state), sameTravel = cached?.tiles === state.world.tiles && cached.travelRevision === travelRevision;
  if (trusted && sameTravel && cached.membership === membership && cached.structure === structure
    && cached.worldStructure === worldStructure && cached.factions === factions) return cached.homes;
  const relevant = trusted ? [...buildings.query('farm'), ...buildings.query('palace')]
    : state.buildings.filter(building => isHome(building) || building.kind === 'palace');
  const signature = `${relevant.map(building => `${building.id}:${building.kind}:${building.faction}:${building.x},${building.y}:${Number(buildingReady(building))}`).join(';')}|${factions}`;
  if (sameTravel && cached.signature === signature) {
    Object.assign(cached, { membership, structure, worldStructure, factions });
    return cached.homes;
  }
  const homes = withNavigationFrame(state, () => {
    const homes = new Map<number, Building>();
    const queries = new Map<number, ReturnType<typeof farmCityQuery>>();
    for (const camp of camps) {
      let query = queries.get(camp.faction);
      if (!query) { query = farmCityQuery(state, camp.faction); queries.set(camp.faction, query); }
      const palace = query(camp);
      // An isolated farm retains a waiting courier until a route opens.
      if (palace) homes.set(camp.id, palace);
    }
    return homes;
  });
  collectorHomes.set(state, { signature, tiles: state.world.tiles, travelRevision, homes, membership, structure, worldStructure, factions });
  return homes;
}

function clearJourney(unit: Unit): void {
  unit.destination = undefined; unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0; unit.moving = false;
  delete unit.cultivating;
}

function releaseClaims(state: GameState, unit: Unit): void {
  const schedule = simulationReadsActive(state) ? scheduledHarvests.get(state) : undefined;
  for (const field of schedule?.claimed ?? state.fields ?? []) if (field.claimedBy === unit.id) {
    delete field.claimedBy; schedule?.claimed.delete(field);
  }
}

function ownsHarvestClaim(unit: Unit | undefined, field: FarmField): boolean {
  return !!unit && unit.hp > 0 && unit.faction === field.faction && !unit.inside && !unit.civilianPanic && !unit.routed
    && unit.collectPhase === 'outbound' && unit.field === field.id;
}

/** Downsizing the old courier pool returns cargo to a bag, never directly to the treasury. */
function restoreCargo(state: GameState, unit: Unit): void {
  if ((unit.cargo ?? 0) > 0) {
    const fields = (state.fields ?? []).filter(field => field.faction === unit.faction);
    const camp = buildingWithId(state, unit.collectorCamp, building => building.faction === unit.faction && isHome(building) && building.hp > 0);
    const field = fields.find(field => field.id === unit.cargoField)
      ?? fields.find(field => field.id === unit.field)
      ?? fields.filter(field => field.camp === unit.collectorCamp).sort((a, b) => distance(a, unit) - distance(b, unit))[0]
      ?? (camp ? undefined : fields.sort((a, b) => distance(a, unit) - distance(b, unit))[0]);
    // Temporarily suppressed plots bank their bags on the camp until a plot opens.
    const batches = unit.cargoBatches?.length ? unit.cargoBatches : [{ amount: unit.cargo!, expiresAt: unit.cargoExpiresAt ?? state.time + cargoShelfLife(state, unit) }];
    if (field) { field.foodBatches = [...fieldBatches(state, field), ...batches]; refreshField(field); harvestFieldChanged(state, field); state.farmVersion = (state.farmVersion ?? 0) + 1; }
    else if (camp) {
      camp.storedFoodBatches = [...(camp.storedFoodBatches ?? []), ...batches]; camp.storedFood = totalBatches(camp.storedFoodBatches);
      farmTopologies.delete(state);
    }
    // If every farm has been destroyed, its food is lost along with the settlement.
  }
  unit.cargo = 0; unit.cargoField = undefined; unit.cargoBatches = []; unit.cargoExpiresAt = undefined;
}

/** A resident changing jobs relinquishes physical harvest claims and cargo. */
export function releaseCollectorWork(state: GameState, unit: Unit): void {
  releaseClaims(state, unit); restoreCargo(state, unit);
  finishFarmTrip(state, unit);
  unit.field = undefined; unit.cultivating = undefined;
}

/** A connected parcel owns exactly one gathering job. Population can leave
 * jobs unstaffed, but cannot create several workers for the same field. */
export function ensureCollectors(state: GameState): void {
  if (simulationReadsActive(state) && recurringWorkElapsed(state, 'collectors:staff', 0) === undefined) return;
  recordCivilianCasualties(state);
  const populations = civilianWorkforcePopulations(state);
  const camps = settlementBuildings(state).farms.filter(building => buildingReady(building)
    && state.factions.some(faction => faction.id === building.faction && !faction.defeated && faction.relation !== 'confederated'));
  const homes = campPalaces(state, camps), groups = farmWorkGroups(state);
  const roster = settlementWorkers(state), collectors = roster.collectors;
  const available = new Set(collectors.filter(unit => unit.hp > 0));
  const campsById = new Map(camps.map(camp => [camp.id, camp]));
  const budgets = new Map<number, number>(), staffing = new Map<number, number>();
  const storageQueries = new Map<number, ReturnType<typeof farmStorageQuery>>();
  for (const [city, population] of populations) budgets.set(city, Math.max(0, population - constructionWorkerAllowance(population)));
  const nonCollectors = new Map<number, number>();
  for (const unit of roster.workers) if (unit.hp > 0 && !unit.explorationRefugee && (!unit.collector || unit.builder)) {
    const city = roster.cities.get(unit)?.id;
    if (city !== undefined) nonCollectors.set(city, (nonCollectors.get(city) ?? 0) + 1);
  }
  for (const [city, count] of nonCollectors) budgets.set(city, Math.min(budgets.get(city) ?? 0, Math.max(0, (populations.get(city) ?? 0) - count)));
  const assigned = new Map<FarmWorkGroup, Unit[]>();
  for (const unit of available) {
    const group = groups.byCamp.get(unit.collectorCamp!) ?? groups.byField.get(groups.index.fields.get(unit.field!)!);
    if (group?.faction !== unit.faction) continue;
    const list = assigned.get(group) ?? []; list.push(unit); assigned.set(group, list);
  }
  const priorities = new Map(groups.groups.map(group => [group, parcelHarvest(state, group)]));
  // Stable jobs first; with scarce residents rotate only the unstaffed jobs
  // according to ripe food and oldest visit, rather than spawning per tile.
  const jobs = groups.groups.filter(group => group.fields.some(field => campsById.has(field.camp)))
    .sort((a, b) => Number(assigned.get(b)?.some(unit => !unit.inside || unit.civilianPanic)) - Number(assigned.get(a)?.some(unit => !unit.inside || unit.civilianPanic))
      || Number(priorities.get(b)!.food > 0) - Number(priorities.get(a)!.food > 0)
      || priorities.get(a)!.lastVisitedAt - priorities.get(b)!.lastVisitedAt || a.anchor - b.anchor);
  for (const group of jobs) {
    const current = (assigned.get(group) ?? []).filter(unit => available.has(unit))
      .sort((a, b) => Number(!a.inside) - Number(!b.inside) || a.id - b.id);
    const possible = group.fields.map(field => ({ camp: campsById.get(field.camp), palace: homes.get(field.camp) }))
      .filter((entry): entry is { camp: Building; palace: Building } => !!entry.camp && !!entry.palace)
      .sort((a, b) => Number(b.palace.id === current[0]?.home) - Number(a.palace.id === current[0]?.home)
        || distance(a.camp, a.palace) - distance(b.camp, b.palace) || a.camp.id - b.camp.id);
    const destination = possible.find(({ palace }) => (staffing.get(palace.id) ?? 0) < (budgets.get(palace.id) ?? 0));
    if (!destination) continue;
    const { camp, palace } = destination;
    const unit = current[0] ?? [...available].find(unit => unit.faction === group.faction && unit.inside && unit.home === palace.id)
      ?? [...available].filter(unit => unit.faction === group.faction && !assigned.has(groups.byCamp.get(unit.collectorCamp!)!))
        .sort((a, b) => Number(a.collectorCamp !== undefined) - Number(b.collectorCamp !== undefined) || a.id - b.id)[0]
      ?? createCollector(state, palace, camp);
    available.delete(unit); staffing.set(palace.id, (staffing.get(palace.id) ?? 0) + 1);
    const field = groups.index.fields.get(unit.field!);
    const previousGroup = groups.byCamp.get(unit.collectorCamp!);
    if (previousGroup !== group || field && groups.byField.get(field) !== group || unit.home !== palace.id) {
      restoreCargo(state, unit); releaseClaims(state, unit); unit.field = undefined;
      unit.collectPhase = unit.inside ? 'idle' : 'returning'; clearJourney(unit);
    }
    // Keep an existing member as anchor, avoiding churn when a parcel grows.
    if (previousGroup !== group || !campsById.has(unit.collectorCamp!)) unit.collectorCamp = camp.id;
    if (unit.home !== palace.id) {
      invalidateFarmDispatch(state);
      unit.home = palace.id; invalidateWorkerHomes(state);
      if (unit.inside) { unit.x = palace.x + 1; unit.y = palace.y + 1; }
    }
    let storageQuery = storageQueries.get(palace.id);
    if (!storageQuery) { storageQuery = farmStorageQuery(state, palace); storageQueries.set(palace.id, storageQuery); }
    const assignment = assignFarmStorage(state, unit, palace, storageQuery(camp));
    unit.collectorStorage = assignment.storage.id;
    if (assignment.flags & STORAGE_REASSIGN) {
      releaseClaims(state, unit); unit.field = undefined; clearJourney(unit);
      unit.collectPhase = assignment.flags & STORAGE_ENTER ? 'idle' : 'returning';
      if (assignment.flags & STORAGE_ENTER) {
        unit.x = assignment.storage.x + buildingWidth(assignment.storage) / 2;
        unit.y = assignment.storage.y + buildingHeight(assignment.storage) / 2;
      }
      invalidateFarmDispatch(state);
    }
  }
  const removed = new Set(collectors.filter(unit => available.has(unit) || unit.hp <= 0).map(unit => unit.id));
  if (removed.size) {
    for (const unit of collectors) if (removed.has(unit.id)) { finishFarmTrip(state, unit); releaseClaims(state, unit); if (unit.hp > 0) restoreCargo(state, unit); }
    entityStore(state).units.retain(unit => !removed.has(unit.id));
    for (const unit of state.units) if (unit.target !== undefined && removed.has(unit.target)) unit.target = undefined;
    state.projectiles = state.projectiles?.filter(projectile => !removed.has(projectile.target));
    if (state.selectedType === 'unit' && state.selected !== null && removed.has(state.selected)) {
      state.selected = state.units.find(unit => unit.kind === 'leader' && unit.faction === playerFaction(state) && unit.hp > 0)?.id ?? null;
      state.selectedType = state.selected === null ? null : 'unit';
    }
  }
  const unitsById = new Map(state.units.map(unit => [unit.id, unit]));
  for (const field of state.fields ?? []) if (field.claimedBy !== undefined) {
    const unit = unitsById.get(field.claimedBy);
    if (!ownsHarvestClaim(unit, field) || groups.byCamp.get(unit!.collectorCamp!) !== groups.byField.get(field)) delete field.claimedBy;
  }
  invalidateCourierSleep(state);
}

interface FieldClock {
  planted: boolean; nextHarvest: number; food: number; expiresAt: number | undefined;
  batches: FoodBatch[] | undefined; batchValues: number[]; orchardReadyAt: number | undefined;
}
interface HarvestClock {
  world: World; time: number; fields: { field: FarmField; x: number; y: number }[];
  cells: Map<number, FarmField>; clocks: Map<FarmField, FieldClock>;
  events: SimulationEvents<FarmField>;
}
const harvestClocks = new WeakMap<GameState, HarvestClock>();

interface ScheduledHarvests {
  index: FarmFieldIndex; farmMembers: readonly Building[]; time: number;
  camps: Map<number, Building>; wheat: WheatGroups; clock: HarvestClock;
  dirty: Set<FarmField>; claimed: Set<FarmField>; ready: Set<FarmField>; campEvents: SimulationEvents<number, Building>;
}
const scheduledHarvests = new WeakMap<GameState, ScheduledHarvests>();

/** Structural farm edits (including orchard conversion and ownership) rebuild
 * membership once. Crop, cargo and visit changes use individual notifications. */
export function invalidateScheduledHarvests(state: GameState): void {
  scheduledHarvests.delete(state);
  invalidateFarmFieldIndex(state);
}

function harvestFieldChanged(state: GameState, field: FarmField): void {
  farmParcelChanged(state, field);
  const schedule = scheduledHarvests.get(state);
  if (!schedule) return;
  schedule.dirty.add(field);
  if (field.claimedBy !== undefined) schedule.claimed.add(field);
  else schedule.claimed.delete(field);
  if (field.food > 0) schedule.ready.add(field);
  else schedule.ready.delete(field);
}

function claimHarvestField(state: GameState, field: FarmField, worker: number): void {
  field.claimedBy = worker;
  scheduledHarvests.get(state)?.claimed.add(field);
}

function farmVisited(state: GameState, camp: Building): void {
  const schedule = scheduledHarvests.get(state);
  // A retained earlier deadline is harmless: its eventual wakeup rechecks the
  // live visit time. Only a previously dormant farm needs a new heap entry.
  if (schedule && !schedule.campEvents.has(camp.id)) scheduleFarmDeadline(state, schedule, camp);
}

function scheduleFarmDeadline(state: GameState, schedule: ScheduledHarvests, camp: Building): void {
  const dormantAt = camp.farmFallow ? Infinity : farmDormantAt(state, camp);
  const abandonedAt = camp.faction === -1 && camp.farmAbandonedAt !== undefined
    ? camp.farmAbandonedAt + FARM_ABANDON_SECONDS : Infinity;
  schedule.campEvents.schedule(camp.id, Math.min(dormantAt, abandonedAt), camp);
}

function scheduledHarvestState(state: GameState): ScheduledHarvests {
  const index = farmFieldIndex(state), buildings = entityStore(state).buildings, farmMembers = buildings.query('farm');
  let schedule = scheduledHarvests.get(state);
  if (schedule && schedule.index === index && schedule.farmMembers === farmMembers && schedule.time <= state.time) {
    schedule.time = state.time;
    return schedule;
  }
  const camps = new Map(farmMembers.filter(buildingReady).map(camp => [camp.id, camp]));
  for (const camp of camps.values()) {
    camp.farmLastVisitedAt ??= state.time;
    if (camp.faction === -1) camp.farmAbandonedAt ??= state.time;
    else delete camp.farmAbandonedAt;
  }
  const wheat = wheatFieldGroups(state);
  synchronizeWheatGroups(state, camps, wheat);
  refreshWheatReadiness(state);
  schedule = { index, farmMembers, time: state.time, camps, wheat,
    clock: harvestClock(state), dirty: new Set(index.source),
    claimed: new Set(index.source.filter(field => field.claimedBy !== undefined)),
    ready: new Set(index.source.filter(field => field.food > 0)), campEvents: new SimulationEvents() };
  scheduledHarvests.set(state, schedule);
  for (const camp of camps.values()) scheduleFarmDeadline(state, schedule, camp);
  return schedule;
}

function harvestClock(state: GameState): HarvestClock {
  let clock = harvestClocks.get(state);
  if (!clock || clock.world !== state.world || state.time < clock.time) {
    clock = { world: state.world, time: state.time, fields: [], cells: new Map(), clocks: new Map(), events: new SimulationEvents() };
    harvestClocks.set(state, clock);
  }
  clock.time = state.time;
  const fields = state.fields ?? [];
  if (clock.fields.length !== fields.length || fields.some((field, i) => {
    const old = clock!.fields[i];
    return old.field !== field || old.x !== field.x || old.y !== field.y;
  })) {
    const retained = new Set(fields);
    for (const field of clock.clocks.keys()) if (!retained.has(field)) { clock.clocks.delete(field); clock.events.cancel(field); }
    clock.fields = fields.map(field => ({ field, x: field.x, y: field.y }));
    clock.cells.clear();
    for (const field of fields) clock.cells.set(field.y * state.world.width + field.x, field);
  }
  return clock;
}

/** Scalar validation keeps public helpers and direct fixture edits observable.
 * The steady path does not recreate batches or rescan their expiry filters. */
function fieldClockChanged(clock: FieldClock | undefined, field: FarmField): boolean {
  if (!clock || clock.planted !== field.planted || clock.nextHarvest !== field.nextHarvest || clock.food !== field.food
    || clock.expiresAt !== field.expiresAt || clock.batches !== field.foodBatches || clock.orchardReadyAt !== field.orchard?.readyAt
    || clock.batchValues.length !== (field.foodBatches?.length ?? 0) * 2) return true;
  for (let i = 0; i < (field.foodBatches?.length ?? 0); i++) {
    const batch = field.foodBatches![i];
    if (clock.batchValues[i * 2] !== batch.amount || clock.batchValues[i * 2 + 1] !== batch.expiresAt) return true;
  }
  return false;
}

function rememberFieldClock(clock: HarvestClock, field: FarmField, dormantAt: number, now: number): void {
  let entry = clock.clocks.get(field);
  if (!entry) {
    entry = { planted: field.planted, nextHarvest: field.nextHarvest, food: field.food, expiresAt: field.expiresAt,
      batches: field.foodBatches, batchValues: [], orchardReadyAt: field.orchard?.readyAt };
    clock.clocks.set(field, entry);
  }
  entry.planted = field.planted; entry.nextHarvest = field.nextHarvest; entry.food = field.food;
  entry.expiresAt = field.expiresAt; entry.batches = field.foodBatches; entry.orchardReadyAt = field.orchard?.readyAt;
  entry.batchValues.length = (field.foodBatches?.length ?? 0) * 2;
  for (let i = 0; i < (field.foodBatches?.length ?? 0); i++) {
    entry.batchValues[i * 2] = field.foodBatches![i].amount;
    entry.batchValues[i * 2 + 1] = field.foodBatches![i].expiresAt;
  }
  scheduleFieldClock(clock, field, dormantAt, now);
}
function scheduleFieldClock(clock: HarvestClock, field: FarmField, dormantAt: number, now: number): void {
  const matureAt = field.orchard?.readyAt ?? Infinity;
  const next = Math.min(field.expiresAt ?? Infinity, field.planted ? Math.min(field.nextHarvest, dormantAt) : Infinity,
    matureAt > now + 1e-7 ? matureAt : Infinity);
  clock.events.schedule(field, next, field);
}

function farmDormantAt(state: GameState, camp: Building): number {
  // A staggered first crop may ripen just before the ordinary idle deadline.
  // Let its courier use the same pickup window as any other harvest.
  const deadline = Math.max(camp.farmLastVisitedAt ?? state.time, camp.orchard?.readyAt ?? -Infinity) + FARM_IDLE_SECONDS;
  return camp.farmFirstHarvestAt === undefined ? deadline
    : Math.max(deadline, camp.farmFirstHarvestAt + harvestShelfLife(state, camp));
}

/** A connected wheat patch shares its crop clock and cultivation state.
 * New plots inherit an existing clock without delaying their neighbors, but
 * cannot yield before their own full growing interval. Two established patches
 * merge onto the later clock. Existing batches/expiry are never changed. */
export function synchronizeWheatFields(state: GameState, camps = new Map(state.buildings.filter(building => isHome(building) && buildingReady(building)).map(camp => [camp.id, camp]))): void {
  synchronizeWheatGroups(state, camps, wheatFieldGroups(state));
  refreshWheatReadiness(state);
}

/** A harvest pass already owns a validated membership snapshot. Food and crop
 * clocks can change during that pass without rebuilding its connected groups. */
function synchronizeWheatGroups(state: GameState, camps: ReadonlyMap<number, Building>, groups: WheatGroups): void {
  for (const group of groups.groups) {
    if (group.fields.length < 2) { group.fields[0].wheatSynchronized = true; continue; }
    let nextHarvest = -Infinity, newPlotHarvest = -Infinity, lastVisited = -Infinity;
    const planted = group.fields.some(field => field.planted);
    for (const field of group.fields) {
      if (field.wheatSynchronized) nextHarvest = Math.max(nextHarvest, field.nextHarvest);
      newPlotHarvest = Math.max(newPlotHarvest, field.nextHarvest);
      lastVisited = Math.max(lastVisited, camps.get(field.camp)?.farmLastVisitedAt ?? state.time);
    }
    const established = Number.isFinite(nextHarvest);
    if (!established) nextHarvest = newPlotHarvest;
    for (const field of group.fields) if (established && !field.wheatSynchronized)
      field.wheatYieldAfter = state.time + FIELD_HARVEST_SECONDS;
    const replanting = planted && group.fields.some(field => !field.planted);
    if (replanting) nextHarvest = Math.max(nextHarvest, state.time + FIELD_HARVEST_SECONDS);
    // A newly joined plot's first-crop grace belongs to the whole patch too;
    // otherwise old cells could fall fallow while that plot is still growing.
    let firstHarvest = -Infinity;
    for (const field of group.fields) {
      const first = camps.get(field.camp)?.farmFirstHarvestAt;
      if (first !== undefined) {
        const firstEligible = nextHarvest + Math.max(0, Math.ceil(((field.wheatYieldAfter ?? nextHarvest) - nextHarvest - 1e-7) / FIELD_HARVEST_SECONDS)) * FIELD_HARVEST_SECONDS;
        firstHarvest = Math.max(firstHarvest, !field.wheatSynchronized ? firstEligible : first === field.nextHarvest ? nextHarvest : first);
      }
    }
    let changed = false;
    for (const field of group.fields) {
      const priorNext = field.nextHarvest;
      changed ||= priorNext !== nextHarvest || field.planted !== planted;
      field.nextHarvest = nextHarvest; field.planted = planted; field.wheatSynchronized = true;
      const camp = camps.get(field.camp);
      if (!camp) continue;
      camp.farmLastVisitedAt = lastVisited; camp.farmFallow = !planted;
      if (Number.isFinite(firstHarvest)) camp.farmFirstHarvestAt = firstHarvest;
    }
    if (changed) {
      state.farmVersion = (state.farmVersion ?? 0) + 1;
      for (const field of group.fields) { harvestFieldChanged(state, field); wakeFarmCouriers(state, field.camp); }
    }
  }
}

export function updateHarvests(state: GameState): void {
  // Standalone/editor reconciliation observes direct scalar mutations. The
  // live engine calls updateScheduledHarvests and reports mutations instead.
  invalidateScheduledHarvests(state);
  const clock = harvestClock(state), due = new Set(clock.events.takeDue(state.time + 1e-7));
  const entities = entityStore(state), units = entities.units;
  const camps = new Map(entities.buildings.query('farm').filter(buildingReady).map(camp => [camp.id, camp]));
  const fieldsByCell = clock.cells;
  const visited = new Set<number>();
  for (const unit of state.units) {
    if (unit.hp <= 0 || unit.inside || unit.faction < 0) continue;
    const field = fieldsByCell.get(Math.floor(unit.y) * state.world.width + Math.floor(unit.x));
    if (field?.faction === unit.faction && !isForbidden(state, field.x, field.y, unit.faction)) visited.add(field.camp);
  }
  for (const camp of camps.values()) {
    camp.farmLastVisitedAt ??= state.time;
    // Only ownerless farmland decays away. Fallow owned farms remain available
    // indefinitely, and their old idle time cannot backdate a later neutral claim.
    if (camp.faction === -1) camp.farmAbandonedAt ??= state.time;
    else delete camp.farmAbandonedAt;
  }
  let wheat = wheatFieldGroups(state), wheatMembershipChanged = false;
  synchronizeWheatGroups(state, camps, wheat);
  for (const field of state.fields ?? []) {
    if (field.claimedBy !== undefined) {
      const unit = units.get(field.claimedBy);
      if (!ownsHarvestClaim(unit, field)) delete field.claimedBy;
    }
    const camp = camps.get(field.camp), dormantAt = camp ? farmDormantAt(state, camp) : Infinity;
    if (camp?.orchard) {
      wheatMembershipChanged ||= !field.orchard;
      field.orchard = camp.orchard;
      if (state.time + 1e-7 < camp.orchard.readyAt) field.planted = false;
      else if (!camp.farmFallow && !field.planted) { field.planted = true; state.farmVersion = (state.farmVersion ?? 0) + 1; }
    }
    const changed = due.has(field) || fieldClockChanged(clock.clocks.get(field), field)
      || field.planted && state.time + 1e-7 >= Math.min(field.nextHarvest, dormantAt);
    if (changed) harvestDue(state, field, dormantAt);
    if (state.time + 1e-7 >= dormantAt && field.planted) {
      field.planted = false;
      state.farmVersion = (state.farmVersion ?? 0) + 1;
    }
    if (changed) rememberFieldClock(clock, field, dormantAt, state.time);
    else scheduleFieldClock(clock, field, dormantAt, state.time);
  }
  // A direct orchard edit can reach this public helper before farm topology
  // synchronization. Observe it once before visits, just as an ordinary query
  // does, instead of revalidating every field for every visited farm.
  if (wheatMembershipChanged) wheat = wheatFieldGroups(state);
  for (const camp of camps.values()) {
    const dormantAt = farmDormantAt(state, camp);
    if (state.time + 1e-7 >= dormantAt && !camp.farmFallow) {
      camp.farmFallow = true;
      wakeFarmCouriers(state, camp.id);
    }
    if (visited.has(camp.id)) visitFarm(state, camp, wheat);
  }
  refreshWheatReadiness(state);
  // Panic and blocked routes do not suspend a harvest's perishability.
  for (const unit of state.units) if (unit.collector && unit.hp > 0) spoilCargo(state, unit);
  removeAbandonedFarms(state, camps);
}

/** Live simulation path: untouched fields are absent from the work queue.
 * Preserve the original harvest -> dormancy -> physical visit -> expiry order.
 * A stale visit deadline is rechecked when it becomes due, so a continuously
 * occupied farm never postpones heap entries on every movement step. */
export function updateScheduledHarvests(state: GameState): void {
  const schedule = scheduledHarvestState(state), { index, camps, wheat, clock } = schedule;
  const entities = entityStore(state), dueCamps = new Map<number, Building>();
  const dirty = schedule.dirty;
  schedule.dirty = new Set();
  for (const field of clock.events.takeDue(state.time + 1e-7)) if (index.fields.get(field.id) === field) dirty.add(field);
  for (const camp of schedule.campEvents.takeDue(state.time + 1e-7)) {
    if (camps.get(camp.id) !== camp) continue;
    dueCamps.set(camp.id, camp);
    for (const field of index.camps.get(camp.id) ?? []) dirty.add(field);
  }
  const visited = new Set<number>();
  for (const unit of entities.units.query('active')) {
    if (unit.hp <= 0 || unit.inside || unit.faction < 0) continue;
    const field = index.cells.get(Math.floor(unit.y) * state.world.width + Math.floor(unit.x));
    if (field?.faction === unit.faction && !isForbidden(state, field.x, field.y, unit.faction)) visited.add(field.camp);
  }
  for (const field of schedule.claimed) if (!ownsHarvestClaim(entities.units.get(field.claimedBy!), field)) {
    delete field.claimedBy; schedule.claimed.delete(field);
  }
  const ordered = [...dirty].sort((a, b) => index.order.get(a)! - index.order.get(b)!);
  for (const field of ordered) {
    if (index.fields.get(field.id) !== field) continue;
    const camp = camps.get(field.camp), dormantAt = camp ? farmDormantAt(state, camp) : Infinity;
    if (camp?.orchard) {
      field.orchard = camp.orchard;
      if (state.time + 1e-7 < camp.orchard.readyAt) field.planted = false;
      else if (!camp.farmFallow && !field.planted) { field.planted = true; state.farmVersion = (state.farmVersion ?? 0) + 1; }
    }
    harvestDue(state, field, dormantAt);
    if (state.time + 1e-7 >= dormantAt && field.planted) {
      field.planted = false; state.farmVersion = (state.farmVersion ?? 0) + 1;
    }
    rememberFieldClock(clock, field, dormantAt, state.time);
    if (field.food > 0) schedule.ready.add(field); else schedule.ready.delete(field);
    farmParcelChanged(state, field);
    refreshWheatReadiness(state, field);
  }
  for (const camp of dueCamps.values()) if (state.time + 1e-7 >= farmDormantAt(state, camp) && !camp.farmFallow) {
    camp.farmFallow = true; wakeFarmCouriers(state, camp.id);
  }
  // Match farm order when multiple sources visit the same connected patch.
  const visits = [...visited].map(id => camps.get(id)).filter((camp): camp is Building => !!camp)
    .sort((a, b) => entities.buildings.indexOf(a) - entities.buildings.indexOf(b));
  for (const camp of visits) visitFarm(state, camp, wheat);
  for (const camp of dueCamps.values()) scheduleFarmDeadline(state, schedule, camp);
  for (const unit of entities.units.query('collector')) if (unit.hp > 0 && ((unit.cargo ?? 0) > 0 || unit.cargoBatches?.length)) spoilCargo(state, unit);
  removeAbandonedFarms(state, dueCamps);
}

/** Disappearance releases terrain and workers without crediting undelivered
 * food. Only ten uninterrupted minutes without an owner can remove a farm. */
function removeAbandonedFarms(state: GameState, camps: ReadonlyMap<number, Building>): void {
  const expired = new Set<number>();
  for (const camp of camps.values()) if (camp.faction === -1 && camp.farmAbandonedAt !== undefined
    && state.time + 1e-7 >= camp.farmAbandonedAt + FARM_ABANDON_SECONDS) expired.add(camp.id);
  if (!expired.size) return;
  const changed: number[] = [];
  for (const field of state.fields ?? []) if (expired.has(field.camp)) {
    const tile = tileAt(state.world, field.x, field.y);
    if (tile?.farm === field.faction) delete tile.farm;
    changed.push(field.y * state.world.width + field.x);
    if (field.food > 0) lostFood(state, field, field.food);
  }
  state.fields = (state.fields ?? []).filter(field => !expired.has(field.camp));
  entityStore(state).buildings.retain(building => !expired.has(building.id));
  for (const unit of state.units) if (expired.has(unit.collectorCamp ?? -1)) {
    unit.field = undefined; delete unit.cultivating;
    unit.collectPhase = unit.inside ? 'idle' : 'returning'; clearJourney(unit);
  }
  if (state.selectedType === 'building' && expired.has(state.selected ?? -1)) { state.selected = null; state.selectedType = null; }
  state.farmVersion = (state.farmVersion ?? 0) + 1;
  markWorldChanged(state.world, 'appearance', changed);
  synchronizeFarms(state); ensureCollectors(state);
}

type Move = (state: GameState, unit: Unit, goal: Point, dt: number, direct?: boolean, allowPartial?: boolean) => void;

interface CollectorFrame {
  fields: Map<number, FarmField>; camps: Map<number, FarmField[]>; cells: Map<number, FarmField>;
  groups: FarmWorkGroups;
}
const collectorFrames = new WeakMap<GameState, CollectorFrame>();
/** Plot membership is stable during unit updates; food and claims stay live on
 * the original field objects as earlier couriers collect or reserve them. */
export function beginCollectorFrame(state: GameState): void {
  const { fields, camps, cells } = farmFieldIndex(state);
  collectorFrames.set(state, { fields, camps, cells, groups: farmWorkGroups(state) });
}
export function endCollectorFrame(state: GameState): void { collectorFrames.delete(state); }
function campFields(state: GameState, camp: Building): readonly FarmField[] {
  return farmFieldIndex(state).camps.get(camp.id) ?? [];
}

function workGroups(state: GameState): FarmWorkGroups {
  return collectorFrames.get(state)?.groups ?? farmWorkGroups(state);
}
interface HarvestReturn { entrance: Point; path: Point[] }
/** Plan the single journey home. Shared reverse paths reuse settlement routes. */
function harvestReturn(state: GameState, unit: Unit, from: Point, palace: Building): HarvestReturn | undefined {
  const entrances = palaceEdges(state, palace).sort((a, b) => distance(from, a) - distance(from, b));
  for (const entrance of entrances) {
    if (!hasStaticPath(workNavigationState(state, false, -1, undefined, true), from, entrance, unit.faction, true)) continue;
    const path = distance(from, entrance) < .12 ? [] : courierReturnPath(state, from, entrance, unit.faction);
    if (distance(from, entrance) >= .12 && (!path.length || distance(path[path.length - 1], entrance) > .12)) continue;
    return { entrance, path };
  }
}

interface ParcelApproach { city: number; generation: object; zones: number; candidates: FarmField[] }
const parcelApproaches = new WeakMap<FarmWorkGroup, ParcelApproach>();

/** Keep only four nearest tiles plus the parcel's cardinal extremes. This
 * bounded shortlist tolerates a suboptimal entry instead of pathfinding to
 * every crop tile. A live route check still rejects walls/closed gates. */
function pickupCandidates(state: GameState, group: FarmWorkGroup, palace: Building): readonly FarmField[] {
  const generation = farmTravelRevision(state), zones = forbiddenRevision(state), old = parcelApproaches.get(group);
  if (old && old.city === palace.id && old.generation === generation && old.zones === zones && simulationReadsActive(state)) return old.candidates;
  const nearest: FarmField[] = [], extremes: (FarmField | undefined)[] = [];
  const cost = (field: FarmField) => (field.x + .5 - palace.x - 1) ** 2 + (field.y + .5 - palace.y - 1) ** 2;
  for (const field of group.fields) {
    if (isForbidden(state, field.x, field.y, group.faction)) continue;
    let i = 0;
    while (i < nearest.length && (cost(nearest[i]) < cost(field) || cost(nearest[i]) === cost(field) && nearest[i].id < field.id)) i++;
    if (i < PICKUP_CANDIDATE_LIMIT) { nearest.splice(i, 0, field); if (nearest.length > PICKUP_CANDIDATE_LIMIT) nearest.pop(); }
    if (!extremes[0] || field.x < extremes[0].x) extremes[0] = field;
    if (!extremes[1] || field.x > extremes[1].x) extremes[1] = field;
    if (!extremes[2] || field.y < extremes[2].y) extremes[2] = field;
    if (!extremes[3] || field.y > extremes[3].y) extremes[3] = field;
  }
  const candidates = [...new Set([...nearest, ...extremes.filter((field): field is FarmField => !!field)])];
  parcelApproaches.set(group, { city: palace.id, generation, zones, candidates });
  return candidates;
}

/** One arrival transfers the parcel's surviving food into one carried load.
 * Equal deadlines coalesce; a recent merge or research upgrade cannot extend
 * an older crop's life. Movement never walks or reserves individual stops. */
function collectParcel(state: GameState, unit: Unit, group: FarmWorkGroup): void {
  const batches = new Map<number, number>();
  for (const field of group.fields) {
    const camp = indexedBuilding(state, field.camp);
    if (field.faction !== unit.faction || !camp || camp.faction !== unit.faction || !buildingReady(camp)
      || isForbidden(state, field.x, field.y, unit.faction) || field.claimedBy !== undefined && field.claimedBy !== unit.id) continue;
    if (field.orchard) visitFarm(state, camp);
    for (const batch of fieldBatches(state, field)) if (batch.expiresAt > state.time + 1e-7) {
      batches.set(batch.expiresAt, (batches.get(batch.expiresAt) ?? 0) + batch.amount);
    }
    field.food = 0; field.foodBatches = []; field.expiresAt = undefined; field.harvestedAt = state.time; delete field.claimedBy;
    harvestFieldChanged(state, field);
    refreshWheatReadiness(state, field);
  }
  unit.cargoBatches = [...batches].sort((a, b) => a[0] - b[0]).map(([expiresAt, amount]) => ({ amount, expiresAt }));
  refreshCargo(unit);
  state.farmVersion = (state.farmVersion ?? 0) + 1;
}

/** Hidden idle couriers need another decision only when their farm has work. */
export function farmCourierWakeAt(state: GameState, unit: Unit): number {
  const camp = indexedBuilding(state, unit.collectorCamp);
  if (!camp || !isHome(camp) || !buildingReady(camp) || camp.faction !== unit.faction) return state.time;
  const group = workGroups(state).byCamp.get(camp.id);
  if (!group) return state.time;
  const harvest = parcelHarvest(state, group);
  if (harvest.food > 0 || harvest.fallow) return farmDispatchWakeAt(state, unit);
  let wakeAt = farmDormantAt(state, camp);
  if (camp.orchard && camp.orchard.readyAt > state.time) wakeAt = Math.min(wakeAt, camp.orchard.readyAt);
  wakeAt = Math.min(wakeAt, harvest.nextHarvest);
  return wakeAt;
}

/** Physical arrival, including a courier returning to cultivate an empty farm.
 * Restart a complete growing cycle; time spent abandoned never earns food. */
function visitFarm(state: GameState, camp: Building, groups?: WheatGroups): void {
  if (!camp.orchard) {
    const group = (groups ?? wheatFieldGroups(state)).byCamp.get(camp.id);
    if (group && group.fields.length > 1) {
      if (group.visitedAt === state.time) return;
      group.visitedAt = state.time;
      const buildings = entityStore(state).buildings;
      let replant = false, firstCamp = Infinity;
      for (const field of group.fields) {
        const farm = buildings.get(field.camp);
        if (!farm) continue;
        replant ||= !!farm.farmFallow || !field.planted;
        firstCamp = Math.min(firstCamp, farm.id);
      }
      const nextHarvest = replant ? nextCampHarvest(state.time + FIELD_HARVEST_SECONDS, firstCamp) : 0;
      for (const field of group.fields) {
        const farm = buildings.get(field.camp);
        if (!farm) continue;
        farm.farmLastVisitedAt = state.time; delete farm.farmAbandonedAt;
        if (state.time + 1e-7 >= (farm.farmFirstHarvestAt ?? Infinity)) delete farm.farmFirstHarvestAt;
        if (replant) {
          farm.farmFallow = false; farm.farmFirstHarvestAt = nextHarvest;
          field.planted = true; field.nextHarvest = nextHarvest; delete field.harvestedAt;
          harvestFieldChanged(state, field);
          wakeFarmCouriers(state, farm.id);
        }
        farmVisited(state, farm);
      }
      if (replant) state.farmVersion = (state.farmVersion ?? 0) + 1;
      return;
    }
  }
  camp.farmLastVisitedAt = state.time;
  if (state.time + 1e-7 >= (camp.farmFirstHarvestAt ?? Infinity)) delete camp.farmFirstHarvestAt;
  delete camp.farmAbandonedAt;
  if (!camp.farmFallow) { farmVisited(state, camp); return; }
  camp.farmFallow = false;
  const nextHarvest = nextCampHarvest(state.time + FIELD_HARVEST_SECONDS, camp.id);
  camp.farmFirstHarvestAt = Math.max(nextHarvest, camp.orchard?.readyAt ?? -Infinity);
  for (const field of campFields(state, camp)) {
    field.planted = !camp.orchard || state.time + 1e-7 >= camp.orchard.readyAt;
    field.nextHarvest = Math.max(nextHarvest, camp.orchard?.readyAt ?? -Infinity);
    delete field.harvestedAt;
    harvestFieldChanged(state, field);
  }
  farmVisited(state, camp);
  state.farmVersion = (state.farmVersion ?? 0) + 1;
}
function claimedField(state: GameState, id: number | undefined): FarmField | undefined {
  return id === undefined ? undefined : farmFieldIndex(state).fields.get(id);
}

function setJourney(unit: Unit, goal: Point, path: Point[]): void {
  unit.destination = goal; unit.path = path; unit.pathGoal = { ...goal }; unit.repathAt = 0;
}

/** Pickup and delivery are separate events: food in fields or in transit is not spendable. */
export function updateCollector(state: GameState, unit: Unit, dt: number, move: Move): void {
  spoilCargo(state, unit);
  if ((unit.collectPhase === 'idle' || !unit.collectPhase) && !idleJobDecisionDue(state, unit)) return;
  const city = indexedBuilding(state, unit.home), palace = indexedBuilding(state, unit.collectorStorage ?? unit.home), camp = indexedBuilding(state, unit.collectorCamp);
  if (!city || city.kind !== 'palace' || city.faction !== unit.faction || !buildingReady(city)
    || !palace || palace.faction !== unit.faction || !buildingReady(palace)) return;
  if (!camp || !isHome(camp) || camp.faction !== unit.faction || !buildingReady(camp)) {
    releaseClaims(state, unit); unit.field = undefined;
    if (unit.inside) { finishFarmTrip(state, unit); return; }
    if (unit.collectPhase !== 'returning') { unit.collectPhase = 'returning'; clearJourney(unit); }
  }
  if (unit.inside && !canDispatchPeasant(state, unit)) return;
  if (unit.collectPhase === 'idle' || !unit.collectPhase) {
    const group = workGroups(state).byCamp.get(unit.collectorCamp!);
    if (!group) return;
    const harvest = parcelHarvest(state, group);
    if (!(harvest.food > 0 || harvest.fallow) || !canDepartFarm(state, unit)) return;
    const entrances = palaceEdges(state, palace);
    for (const field of pickupCandidates(state, group, palace)) {
      const farm = indexedBuilding(state, field.camp);
      if (!farm || !buildingReady(farm) || farm.faction !== unit.faction
        || field.claimedBy !== undefined && field.claimedBy !== unit.id) continue;
      const goal = { x: field.x + .5, y: field.y + .5 };
      // Bounded city traffic needs no separate entrance lanes. Take the
      // nearest connected door, including an opposite-side island fallback.
      for (const entrance of entrances.slice().sort((a, b) => distance(a, goal) - distance(b, goal))) {
        if (!hasStaticPath(workNavigationState(state, false, -1, undefined, true), entrance, goal, unit.faction, true)) continue;
        const path = courierOutboundPath(state, entrance, goal, unit.faction);
        if (!path.length) continue;
        // One coarse round-trip estimate is sufficient. Do not dispatch a
        // queued harvest that is already too old to get back to storage.
        if (harvest.food > 0 && !harvest.fallow && state.time + 2 * path.length / Math.max(.01, unit.speed) >= harvest.expiresAt) {
          unit.repathAt = harvest.expiresAt;
          finishFarmTrip(state, unit);
          return;
        }
        unit.x = entrance.x; unit.y = entrance.y; unit.inside = false; unit.field = field.id;
        unit.collectPhase = 'outbound'; claimHarvestField(state, field, unit.id);
        unit.cultivating = harvest.fallow;
        setParcelPickup(state, group, field);
        setJourney(unit, goal, path); departFarm(state, unit);
        entityStore(state).setWorkerDormant(unit, false);
        return;
      }
    }
    unit.repathAt = state.time + FARM_ROUTE_RETRY_SECONDS;
    finishFarmTrip(state, unit);
    return;
  }
  if (unit.collectPhase === 'outbound') {
    const candidate = claimedField(state, unit.field), groups = workGroups(state);
    const group = groups.byCamp.get(unit.collectorCamp!), targetCamp = candidate && indexedBuilding(state, candidate.camp);
    const field = candidate && group && groups.byField.get(candidate) === group && candidate.faction === unit.faction
      && targetCamp && buildingReady(targetCamp) && targetCamp.faction === unit.faction
      && !isForbidden(state, candidate.x, candidate.y, unit.faction) ? candidate : undefined;
    if (!field) {
      releaseClaims(state, unit); unit.field = undefined; unit.collectPhase = 'returning'; clearJourney(unit);
    } else if (distance(unit, { x: field.x + .5, y: field.y + .5 }) < .12) {
      if (!field.orchard) visitFarm(state, targetCamp!);
      unit.cargoField = field.id;
      collectParcel(state, unit, group!);
      unit.collectPhase = 'returning'; unit.field = undefined; clearJourney(unit);
      const home = harvestReturn(state, unit, unit, palace);
      if (home) setJourney(unit, home.entrance, home.path);
    } else {
      move(state, unit, { x: field.x + .5, y: field.y + .5 }, dt);
      return;
    }
  }
  if (unit.collectPhase === 'returning') {
    if (buildingWorkForbidden(state, palace)) { clearJourney(unit); return; }
    const entrances = palaceEdges(state, palace);
    if (entrances.some(point => distance(point, unit) < .2)) {
      releaseClaims(state, unit);
      deliverFoodCargo(state, palace, unit);
      if ((unit.cargo ?? 0) > 0) { clearJourney(unit); unit.repathAt = state.time + CHECK_INTERVAL; return; }
      unit.cargo = 0; unit.cargoField = undefined; unit.cargoBatches = []; unit.cargoExpiresAt = undefined;
      unit.inside = true; unit.collectPhase = 'idle'; clearJourney(unit); finishFarmTrip(state, unit);
      unit.x = palace.x + 1; unit.y = palace.y + 1; unit.repathAt = state.time + CHECK_INTERVAL;
      return;
    }
    if (!unit.destination && state.time < (unit.repathAt ?? 0)) return;
    if (!unit.destination || !entrances.some(point => distance(point, unit.destination!) < .1)) {
      clearJourney(unit);
      const home = harvestReturn(state, unit, unit, palace);
      if (home) setJourney(unit, home.entrance, home.path);
      else unit.repathAt = state.time + FARM_ROUTE_RETRY_SECONDS;
    }
    if (unit.destination) move(state, unit, unit.destination, dt);
  }
}

export function migrateFarms(state: GameState): void {
  const legacy = state.fields === undefined;
  for (const camp of state.buildings.filter(isHome)) { entityStore(state).setBuildingKind(camp, 'camp'); camp.capacity = 0; camp.residents = 0; }
  if (legacy) {
    for (const tile of state.world.tiles) delete tile.farm;
    const workers = new Set(state.units.filter(unit => unit.kind === 'worker').map(unit => unit.id));
    entityStore(state).units.retain(unit => unit.kind !== 'worker');
    for (const unit of state.units) if (unit.target !== undefined && workers.has(unit.target)) unit.target = undefined;
    if (state.selected !== null && workers.has(state.selected)) {
      state.selected = state.units.find(unit => unit.kind === 'leader' && unit.faction === playerFaction(state))?.id ?? null;
      state.selectedType = state.selected === null ? null : 'unit';
    }
    state.fields = [];
    markWorldChanged(state.world, 'appearance');
  }
  synchronizeFarms(state);
  ensureCollectors(state);
}
