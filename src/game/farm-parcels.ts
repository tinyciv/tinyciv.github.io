import { entityStore } from './entity-store';
import { forbiddenRevision, isForbidden } from './forbidden-zones';
import { farmWorkGroups, type FarmWorkGroup } from './farm-work-groups';
import { simulationReadsActive } from './simulation-reads';
import { buildingReady, type Building, type FarmField, type GameState } from './types';

export interface ParcelHarvest {
  food: number;
  expiresAt: number;
  nextHarvest: number;
  fallow: boolean;
  lastVisitedAt: number;
  pickup?: FarmField;
}
interface ParcelCache {
  dirty: boolean; zones: number; farms: readonly Building[]; time: number;
  index: ReturnType<typeof farmWorkGroups>['index'];
  harvest: ParcelHarvest; pickup?: FarmField;
}
interface ParcelViews {
  groups: ReturnType<typeof farmWorkGroups>;
  parcels: Map<FarmWorkGroup, ParcelCache>;
}
const views = new WeakMap<GameState, ParcelViews>();

/** Notifications only touch an existing view. They never perform a component
 * search, including when a whole patch ripens in the same harvest pass. */
export function farmParcelChanged(state: GameState, field: FarmField): void {
  const view = views.get(state), group = view?.groups.byField.get(field);
  const cached = group && view?.parcels.get(group);
  if (cached) cached.dirty = true;
  markers.delete(state);
}

/** Tile yields remain authoritative. Aggregate them once after harvest,
 * expiry, a visit or a structural edit, never on a worker's movement clock. */
export function parcelHarvest(state: GameState, group: FarmWorkGroup): ParcelHarvest {
  let view = views.get(state);
  if (!view || !view.groups.byField.has(group.fields[0]) || view.groups.byField.get(group.fields[0]) !== group) {
    view = { groups: farmWorkGroups(state), parcels: new Map() };
    views.set(state, view);
  }
  const buildings = entityStore(state).buildings, farms = buildings.query('farm'), zones = forbiddenRevision(state);
  let cached = view.parcels.get(group);
  if (cached && simulationReadsActive(state) && !cached.dirty && cached.zones === zones
    && cached.index === view.groups.index && cached.farms === farms && state.time >= cached.time) return cached.harvest;
  const harvest: ParcelHarvest = { food: 0, expiresAt: Infinity, nextHarvest: Infinity, fallow: false, lastVisitedAt: Infinity };
  let retainedPickup: FarmField | undefined;
  for (const field of group.fields) {
    const camp = buildings.get(field.camp);
    if (field.faction !== group.faction || !camp || camp.faction !== group.faction || !buildingReady(camp)
      || isForbidden(state, field.x, field.y, group.faction)) continue;
    harvest.food += field.food;
    if (field.food > 0) harvest.expiresAt = Math.min(harvest.expiresAt, field.expiresAt ?? Infinity);
    if (field.planted) harvest.nextHarvest = Math.min(harvest.nextHarvest, field.nextHarvest);
    if (field.orchard && field.orchard.readyAt > state.time) harvest.nextHarvest = Math.min(harvest.nextHarvest, field.orchard.readyAt);
    harvest.fallow ||= !!camp.farmFallow;
    harvest.lastVisitedAt = Math.min(harvest.lastVisitedAt, camp.farmLastVisitedAt ?? state.time);
    if (!harvest.pickup || field.id < harvest.pickup.id) harvest.pickup = field;
    if (field === cached?.pickup) retainedPickup = field;
  }
  harvest.pickup = retainedPickup ?? harvest.pickup;
  cached = { dirty: false, zones, farms, index: view.groups.index, time: state.time, harvest, pickup: harvest.pickup };
  view.parcels.set(group, cached);
  return harvest;
}

export function setParcelPickup(state: GameState, group: FarmWorkGroup, field: FarmField): void {
  const harvest = parcelHarvest(state, group), cached = views.get(state)!.parcels.get(group)!;
  cached.pickup = field; harvest.pickup = field;
  markers.delete(state);
}

interface HarvestMarkers {
  fields: GameState['fields']; version?: number; zones: number; time: number;
  markers: ReadonlyMap<number, { food: number; expiresAt: number }>;
}
const markers = new WeakMap<GameState, HarvestMarkers>();
/** One crate and expiry indicator per parcel. Rendering reuses this map until
 * a crop/ownership/zone edit, rather than aggregating fields on every frame. */
export function farmHarvestMarkers(state: GameState): HarvestMarkers['markers'] {
  const old = markers.get(state), zones = forbiddenRevision(state);
  if (old && old.fields === state.fields && old.version === state.farmVersion && old.zones === zones && state.time >= old.time) return old.markers;
  const result = new Map<number, { food: number; expiresAt: number }>();
  for (const group of farmWorkGroups(state).groups) {
    const harvest = parcelHarvest(state, group);
    if (harvest.food > 0 && harvest.pickup) result.set(harvest.pickup.id, { food: harvest.food, expiresAt: harvest.expiresAt });
  }
  markers.set(state, { fields: state.fields, version: state.farmVersion, zones, time: state.time, markers: result });
  return result;
}
