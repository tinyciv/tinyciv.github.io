import { saltWorkNavigationState, workNavigationState, civilianGroundRoute } from './pathfinding';
import { resourceWorkAccess } from './resource-terrain';
import { factionTradeActive } from './faction-trade-agreements';
import { villageTradeActive } from './villages';
import type { GameState, Unit } from './types';
import { canUseRowboat } from './rowboats-native';
export function unitNavigationState(state: GameState, unit: Unit): GameState {
  return navigationFor(state, unit, canUseRowboat(unit));
}
export function unitMovementNavigationState(state: GameState, unit: Unit): GameState {
  const rowboat = canUseRowboat(unit);
  return navigationFor(state, unit, rowboat && !civilianGroundRoute(navigationFor(state, unit, rowboat), unit));
}
function navigationFor(state: GameState, unit: Unit, rowboat: boolean): GameState {
  const navigation = ordinaryUnitNavigationState(state, unit, unit.drainageWork ? false : rowboat), job = unit.resourceWork;
  return job?.cells && resourceWorkAccess(job.resource, job.phase, unit.kind === 'worker')
    ? saltWorkNavigationState(navigation, job.cells) : navigation;
}
function ordinaryUnitNavigationState(state: GameState, unit: Unit, rowboat: boolean): GameState {
  if (unit.builder || unit.engineer) return workNavigationState(state, true, -1, undefined, rowboat);
  if (unit.kind === 'merchant') {
    const route = state.tradeRoutes?.find(r => r.id === unit.tradeRoute);
    const village = route?.villageId === undefined ? undefined : state.villages?.find(village => village.id === route.villageId);
    if (village && villageTradeActive(state, village, unit.faction))
      return workNavigationState(state, false, unit.faction, village.faction, rowboat);
    if (route?.partnerFaction !== undefined && factionTradeActive(state, unit.faction, route.partnerFaction))
      return workNavigationState(state, false, unit.faction, route.partnerFaction, rowboat);
  }
  return rowboat ? workNavigationState(state, false, -1, undefined, true) : state;
}
