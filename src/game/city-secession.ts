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
import { initialCityLoyalty } from './loyalty-model';
import { refreshVillageBonuses } from './villages';
import { updateTradeRoutes } from './trade';
import { buildingPresent, buildingReady, type Building, type GameState, type Unit } from './types';

function resetOrders(unit: Unit): void {
  unit.target = undefined; unit.destination = undefined; unit.path = undefined; unit.pathGoal = undefined;
  unit.repathAt = 0; unit.moving = false; unit.attackTime = 0; unit.morale = 100;
  unit.order = unit.kind === 'worker' ? 'work' : 'hold';
  delete unit.civilianPanic; delete unit.routed; delete unit.routOrder; delete unit.casualtyShock;
  unit.buildSite = undefined; unit.repairSite = undefined; unit.clearTree = undefined; unit.field = undefined;
  delete unit.cultivating; delete unit.resourceWork; delete unit.defensiveThreat;
  unit.buildPhase = 'idle'; unit.collectPhase = 'idle';
}
function invalidateCityTransfer(state: GameState): void {
  state.farmVersion = (state.farmVersion ?? 0) + 1; invalidateScheduledHarvests(state);
  markWorldChanged(state.world); invalidateNavigation(state); invalidateFog(state);
  invalidateCitySummarySnapshot(state); invalidateSettlementDecisions(state); updateTradeRoutes(state);
}
export function secedeCity(state: GameState, palace: Building): void {
  const former = state.factions.find(f => f.id === palace.faction);
  if (!former || former.villageId !== undefined || !buildingReady(palace)) return;
  const ownership = cityOwnership(state), population = cityResidents(state).find(c => c.palace.id === palace.id)?.population ?? 0;
  const owned = state.buildings.filter(b => b.faction === former.id && buildingPresent(b) && ownership.building(b)?.id === palace.id);
  const ids = new Set(owned.map(b => b.id));
  const citizens = state.units.filter(u => u.hp > 0 && u.faction === former.id && !u.engineer && u.kind !== 'leader'
    && (u.kind === 'worker' && (ids.has(u.home ?? -1) || ownership.nearest(u, former.id)?.id === palace.id && u.home === undefined)
      || ids.has(u.guardPost ?? -1) || u.guardCity === palace.id || u.levy?.city === palace.id));
  const borders = territory(state), territoryCells: number[] = [];
  for (let cell = 0; cell < borders.owners.length; cell++) if (borders.owners[cell] === former.id
    && ownership.nearest({ x: cell % borders.width + .5, y: Math.floor(cell / borders.width) + .5 }, former.id)?.id === palace.id) territoryCells.push(cell);
  const villageId = Math.max(0, ...(state.villages ?? []).map(v => v.id)) + 1;
  const factionId = Math.max(-1, ...state.factions.map(f => f.id)) + 1;
  const name = palace.cityName ?? `${former.name} city`;
  const food = Math.max(0, palace.storedFood ?? 0);
  state.factions.push({ id: factionId, villageId, name, color: '#ffffff', relation: 'peace', affinity: 50,
    food, gold: 0, production: 0, population, culture: 0, research: former.research ? structuredClone(former.research) : undefined, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false });
  (state.villages ??= []).push({ id: villageId, faction: factionId, campId: palace.id, name, x: palace.x, y: palace.y,
    identity: owned.some(b => b.kind === 'library') ? 'scholars' : 'merchants', relation: 'neutral',
    secededCity: { formerFaction: former.id, territoryCells }, nextThinkAt: state.time, nextGrowthAt: state.time + 90, nextRecruitAt: state.time + 90 });
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
  palace.loyalty = undefined; palace.governorPermissions = { farms: false, housing: false };
  invalidateCityTransfer(state);
  state.events.unshift({ id: Math.max(0, ...state.events.map(e => e.id)) + 1, time: state.time, text: `${name} has declared independence. Negotiate with it or conquer its settlement.`, kind: 'warning' });
  if (state.events.length > 8) state.events.length = 8;
}

/** A standing Leader can reclaim its last city instead of losing immediately. */
export function hasSecededCity(state: GameState, faction: number): boolean {
  return !!state.villages?.some(v => !v.destroyed && v.secededCity?.formerFaction === faction
    && state.buildings.some(b => b.id === v.campId && buildingReady(b)));
}

/** Seceded cities surrender their surviving civic buildings and defenses. */
export function finishSecededCityCapture(state: GameState, formerFaction: number, palace: Building): boolean {
  const village = state.villages?.find(v => v.faction === formerFaction && v.secededCity);
  if (!village) return false;
  village.destroyed = true; village.trading = false; village.tradingFactions = []; village.relation = 'neutral';
  for (const building of state.buildings) if (building.villageId === village.id) {
    if (building.hp > 0) building.faction = palace.faction;
    delete building.villageId;
  }
  for (const unit of state.units) if (unit.villageId === village.id) {
    unit.faction = palace.faction; delete unit.villageId; unit.home = palace.id; resetOrders(unit);
  }
  const farms = new Set(state.buildings.filter(b => b.faction === palace.faction).map(b => b.id));
  for (const field of state.fields ?? []) if (field.faction === formerFaction && farms.has(field.camp)) { field.faction = palace.faction; delete field.claimedBy; }
  const neutral = state.factions.find(f => f.id === formerFaction); if (neutral) { neutral.defeated = true; neutral.population = 0; }
  palace.loyalty = initialCityLoyalty(state.time, 60);
  refreshVillageBonuses(state); invalidateCityTransfer(state);
  return true;
}
