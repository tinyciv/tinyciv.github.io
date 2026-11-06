import { isHumanFaction } from './player-context';
import { buildingReady, isWallKind, type GameState } from './types';
import { factionDevelopmentReserve } from './faction-development';
import { isBuildingUnlocked } from './research';
import { canSustainFactionDefense, factionCommittedBudget } from './faction-budget';
import { STONE_WALL_GOLD } from './wall-stats';
import { FACTION_CITY_TOWERS, factionCityTowers, factionTowerEnclosure, nextFactionTowerEnclosure, type FactionTowerEnclosure } from './faction-tower-layout';

export type DefenseKind = 'road' | 'wall' | 'palisade' | 'woodenTower';
type Order = (faction: number, kind: DefenseKind, x: number, y: number) => { ok: boolean };
export interface DefenseOrders { validate: Order; build: Order }
const nextPlans = new WeakMap<GameState, Map<number, number>>();

/** NPC realms invest their own gold and workforce in guarded, passable enclosures. */
export function updateFactionDefenses(state: GameState, orders: DefenseOrders): void {
  let schedule = nextPlans.get(state);
  if (!schedule) { schedule = new Map(); nextPlans.set(state, schedule); }
  for (const faction of state.factions) {
    if ((faction.id <= 0 || isHumanFaction(state, faction.id)) || faction.villageId !== undefined || faction.defeated || faction.relation === 'confederated' || faction.population < 1
      || state.time < (schedule.get(faction.id) ?? 6 + faction.id)) continue;
    schedule.set(faction.id, state.time + 6);
    if (faction.gold < 15) continue;
    const owned = state.buildings.filter(building => building.faction === faction.id && building.hp > 0);
    const productiveWork = owned.filter(building => building.construction && ['camp', 'house', 'well', 'monument', 'library'].includes(building.kind)).length;
    const underAttack = owned.some(building => state.time - (building.lastAttacked ?? -Infinity) < 12);
    // Do not bury the opening farms behind a long perimeter-building queue.
    // A recent attack still permits a tower to protect the working city.
    if (productiveWork >= 3 && !underAttack) continue;
    // Small tower enclosures share the city's actual budget and workforce;
    // farm and housing orders retain priority over further fortifications.
    const reserve = underAttack ? factionCommittedBudget(state, faction).upkeep : factionDevelopmentReserve(state, faction);
    const pending = owned.filter(building => building.construction && ['wall', 'palisade', 'woodenTower', 'road'].includes(building.kind)).length;
    const limit = productiveWork ? 1 : Math.min(4, Math.max(2, Math.floor(faction.population / 5)));
    if (pending >= limit) continue;
    let budget = limit - pending;
    const attempt = (kind: DefenseKind, x: number, y: number): boolean => {
      const cost = kind === 'woodenTower' ? 40 : kind === 'wall' ? STONE_WALL_GOLD : kind === 'palisade' ? 5 : 10;
      if (!budget || (faction.constructionPauseUntil?.[kind] ?? 0) > state.time || !isBuildingUnlocked(faction, kind) || faction.gold - cost < Math.max(underAttack ? 0 : 20, reserve)
        || kind === 'woodenTower' && !canSustainFactionDefense(state, faction, kind)
        || !orders.validate(faction.id, kind, x, y).ok) return false;
      if (!orders.build(faction.id, kind, x, y).ok) return false;
      budget--; return true;
    };
    for (const palace of owned.filter(building => building.kind === 'palace' && buildingReady(building))) {
      if (palace.depopulated) continue;
      const towers = factionCityTowers(state, palace);
      const finishEnclosure = (enclosure: FactionTowerEnclosure): void => {
        const wallAt = (x: number, y: number) => state.buildings.some(building => building.faction === faction.id
          && building.hp > 0 && isWallKind(building.kind) && building.x === x && building.y === y);
        const gate = enclosure.gate;
        // Queue the gate wall first so its road receives the normal gate
        // exemption. Finish that road before closing any remaining sides.
        if (!wallAt(gate.x, gate.y) && !attempt('palisade', gate.x, gate.y)) return;
        const road = state.buildings.find(building => building.faction === faction.id && building.hp > 0
          && building.kind === 'road' && building.x === gate.x && building.y === gate.y);
        if (!road) { attempt('road', gate.x, gate.y); return; }
        if (!buildingReady(road)) return;
        for (const point of enclosure.walls) {
          if (!budget) break;
          if (!wallAt(point.x, point.y)) attempt('palisade', point.x, point.y);
        }
      };
      for (const tower of towers) {
        if (!budget) break;
        const ring = owned.filter(building => isWallKind(building.kind)
          && Math.max(Math.abs(building.x - tower.x), Math.abs(building.y - tower.y)) === 1);
        if (ring.length === 8 && owned.some(building => building.kind === 'road' && buildingReady(building)
          && Math.abs(building.x - tower.x) + Math.abs(building.y - tower.y) === 1)) continue;
        const enclosure = factionTowerEnclosure(state, palace, tower);
        if (enclosure) finishEnclosure(enclosure);
      }
      if (budget && towers.length < FACTION_CITY_TOWERS && isBuildingUnlocked(faction, 'woodenTower')
        && canSustainFactionDefense(state, faction, 'woodenTower') && (faction.constructionPauseUntil?.woodenTower ?? 0) <= state.time) {
        const enclosure = nextFactionTowerEnclosure(state, palace,
          point => orders.validate(faction.id, 'woodenTower', point.x, point.y).ok);
        if (enclosure && attempt('woodenTower', enclosure.tower.x, enclosure.tower.y)) finishEnclosure(enclosure);
      }
      if (!budget) break;
    }
  }
}
