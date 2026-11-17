import { entityStore } from './entity-store';
import { isHumanFaction, playerFaction } from './player-context';
import { spendGold } from './gold-ledger';
import { invalidateFog, isExplored } from './fog';
import { markWorldChanged } from './world-revisions';
import { tradeConnection, updateTradeRoutes } from './trade';
import { applyVillageRequests, spawnVillageUnits } from './village-sites';
import { confederateVillage, secedeCity, settlementHost } from './settlement-transfer';
import { ACTION, applyVillageBonuses, EVENT, KIND_BY_CODE, logSettlementEvent, REACH, settlementCasualty, settlements, STAGE_NAMES, villageCenter } from './settlement-bridge';
import { workerHomeCity } from './civilian-population';
import { cityResidents } from './cities';
import { buildingReady, distance, type GameState, type NeutralVillage, type Unit } from './types';

const LABELS: Record<string, string> = { woodenTower: 'wooden tower', library: 'library', blacksmith: 'blacksmith', healerShack: "healer's shack",
  dock: 'dock', monument: 'monument', scoutLodge: "scouts' lodge", stable: 'stable', archeryRange: 'archery range', colosseum: 'Colosseum', barracks: 'barracks' };

/** One recurring pulse: Rust decides on its own 1 Hz / 5 s / per-village clocks;
 * the host then carries out the decided effects in Outbox order. */
export function settlementStep(state: GameState): void {
  const bridge = settlements(state), output = bridge.step(), store = entityStore(state);
  const villageAt = (settlement: number): NeutralVillage | undefined => state.villages?.find(v => v.campId === settlement);
  const known = (village: NeutralVillage) => { const c = villageCenter(village); return isExplored(state, Math.floor(c.x), Math.floor(c.y)); };
  let relationsChanged = false;
  const tradeCandidates = new Map<number, NeutralVillage[]>();
  for (const event of output.events) {
    const village = villageAt(event.settlement);
    switch (event.code) {
      case EVENT.secede: {
        const palace = store.buildings.get(event.settlement);
        if (palace && palace.faction === event.faction) secedeCity(state, palace);
        break;
      }
      case EVENT.petition:
        if (village && isHumanFaction(state, event.faction))
          logSettlementEvent(state, `${village.name} asks to join your realm. Visit the village to accept the petition.`, 'good');
        break;
      case EVENT.stage:
        if (village && known(village)) logSettlementEvent(state, `${village.name} has grown into a ${STAGE_NAMES[event.arg] ?? 'village'}.`);
        break;
      case EVENT.adopted: {
        const kind = KIND_BY_CODE.get(event.arg), source = state.factions.find(f => f.id === event.faction);
        if (village && kind && known(village)) logSettlementEvent(state, `${village.name} built a ${LABELS[kind] ?? kind}, learned from ${source?.name ?? 'its neighbors'}.`);
        break;
      }
      case EVENT.relation: relationsChanged = true; break;
      case EVENT.aiConfederate: {
        const faction = state.factions.find(f => f.id === event.faction);
        if (!village || !faction || faction.defeated || isHumanFaction(state, faction.id) || faction.gold < event.arg) break;
        if (confederateVillage(state, village, faction.id, settlementHost())) {
          if (event.arg > 0) spendGold(state, faction, event.arg, 'diplomacy');
          logSettlementEvent(state, `${village.name} joined ${faction.name}.`, faction.id === playerFaction(state) ? 'good' : 'info');
          relationsChanged = true;
        }
        break;
      }
      case EVENT.aiTrade:
        if (village) { const list = tradeCandidates.get(event.faction) ?? []; list.push(village); tradeCandidates.set(event.faction, list); }
        break;
    }
  }
  // Rust ranked the candidates; reachability remains a host check.
  for (const [factionId, villages] of tradeCandidates) {
    const faction = state.factions.find(f => f.id === factionId);
    if (!faction) continue;
    const origins = store.buildings.query('palace').filter(palace => palace.faction === factionId && buildingReady(palace));
    for (const village of villages) {
      const camp = store.buildings.get(village.campId);
      if (!camp || !origins.sort((a, b) => distance(a, camp) - distance(b, camp) || a.id - b.id).some(origin => tradeConnection(state, origin, camp))) continue;
      const result = bridge.villageCommand(village, factionId, ACTION.trade, faction.gold, REACH.ai);
      if (result[0] === 1) { spendGold(state, faction, result[2], 'diplomacy'); relationsChanged = true; }
      break;
    }
  }
  if (output.requests.length) bridge.results(applyVillageRequests(state, output.requests));
  if (output.spawns.length) spawnVillageUnits(state, output.spawns);
  for (const charge of output.charges) {
    const faction = state.factions.find(f => f.id === charge.faction);
    if (faction) spendGold(state, faction, charge.gold, 'diplomacy');
  }
  let destroyed = false;
  for (const village of state.villages ?? []) {
    if (village.destroyed || village.confederatedInto !== undefined) continue;
    const camp = store.buildings.get(village.campId);
    if (!camp || camp.hp <= 0) { village.destroyed = true; destroyed = true; }
  }
  if (relationsChanged || destroyed) {
    bridge.invalidateRelations(); applyVillageBonuses(state); invalidateFog(state);
    markWorldChanged(state.world); updateTradeRoutes(state);
  }
}

/** Call only after a real civilian casualty has been charged to its home.
 * Any attacker counts; Rust weighs it by hostility and population. */
export function recordSettlementCasualty(state: GameState, victim: Unit, attackerFaction: number): void {
  if (victim.engineer) return;
  if (victim.villageId !== undefined) {
    const village = state.villages?.find(v => v.id === victim.villageId);
    if (village && !village.destroyed) settlementCasualty(state, village.campId, attackerFaction, (state.factions.find(f => f.id === village.faction)?.population ?? 0) + 1);
    return;
  }
  const homeId = victim.guardCity ?? victim.levy?.city;
  const home = homeId === undefined ? undefined : entityStore(state).buildings.get(homeId);
  const city = home && home.faction === victim.faction && buildingReady(home) ? home : workerHomeCity(state, victim);
  if (!city || state.factions.find(f => f.id === city.faction)?.villageId !== undefined) return;
  const population = (cityResidents(state).find(row => row.palace.id === city.id)?.population ?? 0) + 1;
  settlementCasualty(state, city.id, attackerFaction, population);
}
