import { territoryValue } from './territory-cells';
import { transferVillageQuestPosts } from './quest-permissions';
import { recordCampaignPopulation } from './campaign-stats';
import { constructionEdges } from './builders';
import { cityOwnership } from './city-ownership';
import { cityResidents, invalidateCitySummarySnapshot } from './cities';
import { territory } from './borders';
import { entityStore } from './entity-store';
import { invalidateNavigation } from './pathfinding';
import { invalidateFog } from './fog';
import { markWorldChanged } from './world-revisions';
import { invalidateSettlementDecisions } from './settlement-decisions';
import { invalidateScheduledHarvests } from './farms';
import { updateTradeRoutes } from './trade';
import { grantIncome } from './resource-income';
import { applyDefenseResearch } from './defense-research';
import { addPalaceRoadRing } from './palace-roads';
import { validatePhysicalFootprint } from './placement-physical';
import { applyVillageBonuses, settlements, TRANSFER, villageTreasury } from './settlement-bridge';
import type { SettlementHost } from './settlement-host';
import { buildingPresent, buildingReady, type Building, type GameState, type NeutralVillage, type Point, type Unit } from './types';

export function resetOrders(unit: Unit): void {
  unit.target = undefined; unit.destination = undefined; unit.path = undefined; unit.pathGoal = undefined;
  unit.repathAt = 0; unit.moving = false; unit.attackTime = 0; unit.morale = 100;
  unit.order = unit.kind === 'worker' ? 'work' : 'hold';
  delete unit.civilianPanic; delete unit.routed; delete unit.routOrder; delete unit.casualtyShock;
  unit.buildSite = undefined; unit.repairSite = undefined; unit.clearTree = undefined; unit.field = undefined;
  delete unit.cultivating; delete unit.resourceWork; delete unit.defensiveThreat;
  unit.buildPhase = 'idle'; unit.collectPhase = 'idle';
}
export function invalidateCityTransfer(state: GameState): void {
  state.farmVersion = (state.farmVersion ?? 0) + 1; invalidateScheduledHarvests(state);
  markWorldChanged(state.world); invalidateNavigation(state); invalidateFog(state);
  invalidateCitySummarySnapshot(state); invalidateSettlementDecisions(state); updateTradeRoutes(state);
}

/** Rust emitted SECEDE: the city becomes an independent white settlement. */
export function secedeCity(state: GameState, palace: Building): boolean {
  const former = state.factions.find(f => f.id === palace.faction);
  if (!former || former.villageId !== undefined || !buildingReady(palace)) return false;
  const ownership = cityOwnership(state), population = cityResidents(state).find(c => c.palace.id === palace.id)?.population ?? 0;
  const owned = state.buildings.filter(b => b.faction === former.id && buildingPresent(b) && ownership.building(b)?.id === palace.id);
  const ids = new Set(owned.map(b => b.id));
  const citizens = state.units.filter(u => u.hp > 0 && u.faction === former.id && !u.engineer && u.kind !== 'leader'
    && (u.kind === 'worker' && (ids.has(u.home ?? -1) || ownership.nearest(u, former.id)?.id === palace.id && u.home === undefined)
      || ids.has(u.guardPost ?? -1) || u.guardCity === palace.id || u.levy?.city === palace.id));
  const borders = territory(state), territoryCells: number[] = [];
  for (let cell = 0; cell < (borders.width * borders.height); cell++) if (territoryValue(borders, cell) === former.id
    && ownership.nearest({ x: cell % borders.width + .5, y: Math.floor(cell / borders.width) + .5 }, former.id)?.id === palace.id) territoryCells.push(cell);
  const villageId = Math.max(0, ...(state.villages ?? []).map(v => v.id)) + 1;
  const factionId = Math.max(-1, ...state.factions.map(f => f.id)) + 1;
  const name = palace.cityName ?? `${former.name} city`;
  const food = Math.max(0, palace.storedFood ?? 0);
  state.factions.push({ id: factionId, villageId, name, color: '#ffffff', relation: 'peace',
    food, gold: 0, production: 0, population, culture: 0, research: former.research ? structuredClone(former.research) : undefined, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false });
  (state.villages ??= []).push({ id: villageId, faction: factionId, campId: palace.id, name, x: palace.x, y: palace.y,
    identity: owned.some(b => b.kind === 'library') ? 'scholars' : 'merchants', secededCity: { formerFaction: former.id, territoryCells } });
  former.population = Math.max(0, former.population - population); former.food = Math.max(0, former.food - food);
  for (const building of owned) {
    building.faction = factionId; building.villageId = villageId;
    delete building.repairerId;
    if (building.construction) { building.construction.waitingForBuilder = true; building.construction.pausedAt = state.time; delete building.construction.builderId; }
  }
  for (const unit of citizens) {
    if (unit.levy) { entityStore(state).setUnitRole(unit, { kind: 'worker' }); delete unit.levy; }
    unit.faction = factionId; unit.villageId = villageId; unit.home = palace.id; resetOrders(unit);
    if (unit.kind === 'worker') entityStore(state).setUnitRole(unit, { kind: 'worker', builder: false, collector: false });
    if (unit.inside) { const exit = constructionEdges(state, palace, true)[0]; if (exit) { Object.assign(unit, exit); unit.inside = false; } }
  }
  for (const field of state.fields ?? []) if (ids.has(field.camp)) { field.faction = factionId; delete field.claimedBy; }
  for (const clearing of state.treeClearings ?? []) if (clearing.workerId && citizens.some(u => u.id === clearing.workerId)) delete clearing.workerId;
  palace.governorPermissions = { farms: false, housing: false };
  settlements(state).commitTransfer(palace.id, palace.id, factionId, TRANSFER.secede, villageId);
  invalidateCityTransfer(state);
  state.events.unshift({ id: Math.max(0, ...state.events.map(e => e.id)) + 1, time: state.time, text: `${name} has declared independence. Negotiate with it or conquer its town.`, kind: 'warning' });
  if (state.events.length > 8) state.events.length = 8;
  return true;
}

/** A standing Leader can reclaim its last city instead of losing immediately. */
export function hasSecededCity(state: GameState, faction: number): boolean {
  return !!state.villages?.some(v => !v.destroyed && v.secededCity?.formerFaction === faction
    && state.buildings.some(b => b.id === v.campId && buildingReady(b)));
}

function absorbSecededCity(state: GameState, village: NeutralVillage, palace: Building): void {
  transferVillageQuestPosts(state,village.id,palace.faction,palace.id);
  village.destroyed = true;
  for (const building of state.buildings) if (building.villageId === village.id) {
    if (building.hp > 0) building.faction = palace.faction;
    delete building.villageId;
  }
  for (const unit of state.units) if (unit.villageId === village.id) {
    unit.faction = palace.faction; delete unit.villageId; unit.home = palace.id; resetOrders(unit);
  }
  const farms = new Set(state.buildings.filter(b => b.faction === palace.faction).map(b => b.id));
  for (const field of state.fields ?? []) if (field.faction === village.faction && farms.has(field.camp)) { field.faction = palace.faction; delete field.claimedBy; }
  const neutral = state.factions.find(f => f.id === village.faction); if (neutral) { neutral.defeated = true; neutral.population = 0; }
}
/** Seceded cities surrender their surviving civic buildings and defenses. */
export function captureSecededCity(state: GameState, formerFaction: number, palace: Building, previousPalaceId: number): boolean {
  const village = state.villages?.find(v => v.faction === formerFaction && v.secededCity);
  if (!village) return false;
  absorbSecededCity(state, village, palace);
  settlements(state).commitTransfer(previousPalaceId, palace.id, palace.faction, TRANSFER.capture);
  applyVillageBonuses(state); invalidateCityTransfer(state);
  return true;
}

function freeExit(state: GameState, lot: Point, blocked: (x: number, y: number) => boolean): Point | undefined {
  for (let radius = 1; radius <= 4; radius++) for (let y = lot.y - radius; y <= lot.y + 1 + radius; y++) for (let x = lot.x - radius; x <= lot.x + 1 + radius; x++) {
    if (x >= lot.x && x <= lot.x + 1 && y >= lot.y && y <= lot.y + 1 || blocked(x, y)) continue;
    const tile = state.world.tiles[y * state.world.width + x];
    if (tile && x >= 0 && y >= 0 && x < state.world.width && y < state.world.height) return { x: x + .5, y: y + .5 };
  }
}
/** Rust accepted the request: the village becomes a real city on its civic lot.
 * Returns false (nothing changed) when the green is blocked. */
export function confederateVillage(state: GameState, village: NeutralVillage, factionId: number, host: SettlementHost): boolean {
  const faction = state.factions.find(f => f.id === factionId), camp = entityStore(state).buildings.get(village.campId);
  if (!faction || !camp || village.destroyed) return false;
  if (village.secededCity) {
    absorbSecededCity(state, village, camp);
    camp.faction = factionId; camp.villageIdentity = village.identity; delete camp.villageId;
    for (const building of state.buildings) if (building.faction === factionId) applyDefenseResearch(building, faction);
    settlements(state).commitTransfer(camp.id, camp.id, factionId, TRANSFER.capture);
    village.confederatedInto = camp.id;
    applyVillageBonuses(state); invalidateCityTransfer(state); host.afterTransfer(state, factionId);
    return true;
  }
  const lot = village.layout ? { x: village.layout.lotX, y: village.layout.lotY } : { x: camp.x, y: camp.y };
  const tents = state.buildings.filter(b => b.villageId === village.id && b.kind === 'villageTent');
  const ignore = new Set(tents.map(tent => tent.id));
  if (!validatePhysicalFootprint(state, 'palace', lot.x, lot.y, village.faction, { ignore, units: false }).ok) return false;
  const footprint = (x: number, y: number) => x >= lot.x && x <= lot.x + 1 && y >= lot.y && y <= lot.y + 1;
  for (const unit of state.units) if (unit.hp > 0 && !unit.inside && footprint(Math.floor(unit.x), Math.floor(unit.y))) {
    const exit = freeExit(state, lot, (x, y) => state.buildings.some(b => b.hp > 0 && !ignore.has(b.id) && x >= b.x && y >= b.y && x < b.x + (b.kind === 'palace' ? 2 : 1) && y < b.y + (b.kind === 'palace' ? 2 : 1)));
    if (exit) { unit.x = exit.x; unit.y = exit.y; unit.path = undefined; unit.destination = undefined; }
  }
  const villagers = state.units.filter(u => u.villageId === village.id && u.hp > 0);
  const treasury = villageTreasury(state, village);
  entityStore(state).buildings.retain(building => !ignore.has(building.id));
  const palace = host.makePalace(state, factionId, lot);
  palace.cityName = village.name; palace.villageIdentity = village.identity; palace.palaceLevel = 1;
  delete palace.construction;
  addPalaceRoadRing(state, palace);
  for (const building of state.buildings) if (building.villageId === village.id) {
    building.faction = factionId; delete building.villageId; applyDefenseResearch(building, faction);
  }
  let workers = 0;
  for (const unit of villagers) {
    unit.faction = factionId; delete unit.villageId; resetOrders(unit);
    if (unit.kind === 'worker') { unit.home = palace.id; workers++; entityStore(state).setUnitRole(unit, { kind: 'worker', builder: false, collector: false }); }
    else { entityStore(state).setUnitRole(unit, { kind: 'militia' }); unit.guardCity = palace.id; unit.home = palace.id; }
  }
  transferVillageQuestPosts(state,village.id,factionId,palace.id);
  faction.population += workers;
  recordCampaignPopulation(state, faction);
  if (treasury > 0) grantIncome(faction, { gold: treasury }, state, 'transfers');
  const neutral = state.factions.find(f => f.id === village.faction); if (neutral) { neutral.defeated = true; neutral.population = 0; }
  village.destroyed = true; village.confederatedInto = palace.id;
  settlements(state).commitTransfer(camp.id, palace.id, factionId, TRANSFER.confederateVillage, village.id);
  applyVillageBonuses(state); invalidateCityTransfer(state); host.afterTransfer(state, factionId);
  return true;
}
