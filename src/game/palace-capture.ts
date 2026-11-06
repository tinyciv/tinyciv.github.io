import { invalidateScheduledHarvests } from './farms';
import { entityStore } from './entity-store';
import { buildingHeight, buildingPresent, buildingReady, buildingWidth, isFarmKind, isWallKind,
  type Building, type GameState, type Point } from './types';

type CaptureOffer = NonNullable<GameState['palaceCaptures']>[number];
const DEFENSIVE_BUILDINGS = new Set<Building['kind']>(['fort', 'woodenTower', 'tower', 'guardPost']);
const defensive = (building: Building): boolean => DEFENSIVE_BUILDINGS.has(building.kind);
const center = (building: Building): Point => ({ x: building.x + buildingWidth(building) / 2, y: building.y + buildingHeight(building) / 2 });
interface DefenseIndex {
  buildings: readonly Building[]; length: number; time: number; revision: number; offers: number;
  byPalace: Map<number, Building[]>;
}
const defenseIndexes = new WeakMap<GameState, DefenseIndex>();

/** Keep fallen cities in this partition until their pending decisions resolve.
 * Otherwise simultaneous victories would annex the first city's neighbors twice. */
function cityMembers(state: GameState, palace: Building): Building[] {
  const palaces = state.buildings.filter(other => other.faction === palace.faction && other.kind === 'palace' && buildingReady(other));
  const origins = palaces.map(other => ({ id: other.id, x: other.x + 1, y: other.y + 1 }));
  if (!origins.some(other => other.id === palace.id)) origins.push({ id: palace.id, x: palace.x + 1, y: palace.y + 1 });
  for (const offer of state.palaceCaptures ?? []) if (offer.faction === palace.faction && !origins.some(other => other.id === offer.palaceId))
    origins.push({ id: offer.palaceId, x: offer.x + 1, y: offer.y + 1 });
  return state.buildings.filter(building => {
    if (building.faction !== palace.faction || building.hp <= 0 || building.kind === 'palace') return false;
    const point = center(building);
    let best = Infinity, owner = -1;
    for (const origin of origins) {
      const d = (point.x - origin.x) ** 2 + (point.y - origin.y) ** 2;
      if (d < best || d === best && origin.id < owner) { best = d; owner = origin.id; }
    }
    return owner === palace.id;
  });
}

/** Empty reservations offer no defense. Once construction physically starts,
 * a watchtower or guard post must be destroyed before its city can fall. */
export function palaceDefenses(state: GameState, palace: Building): Building[] {
  if (palace.kind !== 'palace') return [];
  let index = defenseIndexes.get(state);
  const revision = state.world.revision ?? 0, offers = state.palaceCaptures?.length ?? 0;
  if (!index || index.buildings !== state.buildings || index.length !== state.buildings.length || index.time !== state.time
    || index.revision !== revision || index.offers !== offers) {
    const palaces = state.buildings.filter(building => building.kind === 'palace' && buildingReady(building));
    const byPalace = new Map<number, Building[]>();
    for (const building of state.buildings) {
      if (!defensive(building)) continue;
      const point = center(building);
      let best = Infinity, owner: Building | undefined;
      for (const candidate of palaces) {
        if (candidate.faction !== building.faction) continue;
        const d = (point.x - candidate.x - 1) ** 2 + (point.y - candidate.y - 1) ** 2;
        if (d < best || d === best && candidate.id < owner!.id) { best = d; owner = candidate; }
      }
      if (!owner) continue;
      const list = byPalace.get(owner.id) ?? [];
      list.push(building); byPalace.set(owner.id, list);
    }
    index = { buildings: state.buildings, length: state.buildings.length, time: state.time, revision, offers, byPalace };
    defenseIndexes.set(state, index);
  }
  // Keep live references: a defense killed or activated earlier in this same
  // simulation step must take effect immediately, without another world scan.
  return (index.byPalace.get(palace.id) ?? []).filter(building => building.faction === palace.faction && buildingPresent(building));
}

export function captureOffer(state: GameState, palace: Building): CaptureOffer {
  const buildings = cityMembers(state, palace).filter(building => !isWallKind(building.kind) && building.kind !== 'fort');
  const faction = state.factions.find(other => other.id === palace.faction);
  const unhousedResidents = Math.max(0, palace.unhousedResidents ?? 0);
  const residents = buildings.reduce((sum, building) => sum + (building.kind === 'house' && buildingReady(building)
    ? Math.min(building.capacity, Math.max(0, building.residents ?? 0)) : 0), unhousedResidents);
  return { palaceId: palace.id, faction: palace.faction, x: palace.x, y: palace.y,
    cityName: palace.cityName ?? faction?.name ?? 'Captured city', buildingIds: buildings.map(building => building.id),
    workerIds: state.units.filter(unit => unit.kind === 'worker' && unit.faction === palace.faction && unit.home === palace.id && unit.hp > 0).map(unit => unit.id),
    population: Math.min(Math.max(0, faction?.population ?? 0), residents), unhousedResidents,
    populationGrowth: palace.populationGrowth ?? 0 };
}

/** Civilian property and its residents change hands together. Soldiers remain
 * with their original army; surviving walls follow the normal local claims. */
export function transferCapturedCity(state: GameState, offer: CaptureOffer, palace: Building): void {
  const captured = new Set(offer.buildingIds), workers = new Set(offer.workerIds);
  for (const building of state.buildings) {
    // Fort ownership and foundations are permanent even when surrounding cities fall.
    if (building.kind === 'fort' || !captured.has(building.id) || building.faction !== offer.faction || building.hp <= 0) continue;
    // An unstarted defense order is cancelled when the city falls.
    if (defensive(building)) { building.hp = 0; continue; }
    building.faction = palace.faction;
    delete building.repairerId; delete building.farmAbandonedAt;
    const site = building.construction;
    if (site) {
      if (!site.waitingForBuilder) site.pausedAt = state.time;
      site.waitingForBuilder = true; site.cleared = false; delete site.builderId;
    }
  }
  entityStore(state).buildings.retain(building => building.hp > 0 || building.kind === 'fort');
  for (const unit of state.units) {
    if (!workers.has(unit.id) || unit.faction !== offer.faction || unit.hp <= 0) continue;
    unit.faction = palace.faction; unit.home = palace.id; unit.order = 'work'; unit.morale = 100;
    delete unit.civilianPanic; delete unit.routed; delete unit.routOrder; delete unit.casualtyShock;
    unit.target = undefined; unit.destination = undefined; unit.path = undefined; unit.pathGoal = undefined;
    unit.repathAt = 0; unit.moving = false; unit.attackTime = 0;
    unit.buildSite = undefined; unit.repairSite = undefined; unit.clearTree = undefined;
    unit.field = undefined; delete unit.cultivating; delete unit.builderRetiring;
    unit.buildPhase = unit.inside ? 'idle' : 'returning'; unit.collectPhase = unit.inside ? 'idle' : 'returning';
  }
  const farms = new Set(state.buildings.filter(building => captured.has(building.id) && isFarmKind(building.kind)
    && building.faction === palace.faction).map(building => building.id));
  for (const field of state.fields ?? []) if (farms.has(field.camp)) { field.faction = palace.faction; delete field.claimedBy; }
  if (farms.size) { state.farmVersion = (state.farmVersion ?? 0) + 1; invalidateScheduledHarvests(state); }
  const former = state.factions.find(faction => faction.id === offer.faction), winner = state.factions.find(faction => faction.id === palace.faction)!;
  const population = Math.min(offer.population, Math.max(0, former?.population ?? 0));
  if (former) former.population -= population;
  winner.population += population;
  palace.unhousedResidents = Math.min(population, offer.unhousedResidents);
  palace.populationGrowth = offer.populationGrowth;
}
