import { diplomaticRelationship } from './diplomacy-view';
import { entityStore } from './entity-store';
import { atWar } from './relations';
import { buildingReady, type GameState } from './types';

export function factionTradeActive(state: GameState, faction: number, partner: number): boolean {
  const diplomatic = diplomaticRelationship(state, faction, partner);
  if (diplomatic) {
    if (diplomatic.war || diplomatic.trade <= state.time) return false;
    const store = entityStore(state), a = store.buildings.get(diplomatic.origin), b = store.buildings.get(diplomatic.destination);
    return !!a && !!b && a.faction === diplomatic.a && b.faction === diplomatic.b && buildingReady(a) && buildingReady(b)
      && [faction, partner].every(id => state.factions.some(f => f.id === id && !f.defeated && f.relation !== 'confederated'));
  }
  return faction !== partner && !atWar(state, faction, partner)
    && [faction, partner].every(id => state.factions.some(f => f.id === id && !f.defeated && f.relation !== 'confederated' && f.villageId === undefined))
    && !!state.factionTrades?.some(a => (a.faction === faction && a.partnerFaction === partner || a.faction === partner && a.partnerFaction === faction)
      && state.buildings.some(b => b.id === a.origin && b.faction === a.faction && buildingReady(b))
      && state.buildings.some(b => b.id === a.partner && b.faction === a.partnerFaction && buildingReady(b)));
}
