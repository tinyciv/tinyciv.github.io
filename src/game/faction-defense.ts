import { isHumanFaction } from './player-context';
import { buildingPresent, buildingReady, distance, type Building, type GameState } from './types';
import { factionDevelopmentReserve } from './faction-development';
import { isBuildingUnlocked } from './research';
import { canSustainFactionDefense, factionCommittedBudget } from './faction-budget';
import { STONE_WALL_GOLD } from './wall-stats';

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
    // Finish an affordable timber enclosure before buying costly stonework.
    const wallKind = isBuildingUnlocked(faction, 'wall') && faction.gold >= 500 ? 'wall' : 'palisade';
    if (faction.gold < 12 || (faction.constructionPauseUntil?.[wallKind] ?? 0) > state.time) continue;
    const owned = state.buildings.filter(building => building.faction === faction.id && building.hp > 0);
    const productiveWork = owned.filter(building => building.construction && ['camp', 'house', 'well', 'monument', 'library'].includes(building.kind)).length;
    const underAttack = owned.some(building => state.time - (building.lastAttacked ?? -Infinity) < 12);
    // Do not bury the opening farms behind a long perimeter-building queue.
    // A recent attack still permits a tower to protect the working city.
    if (productiveWork >= 3 && !underAttack) continue;
    // Timber defenses have no upkeep and can protect a young city before a
    // library, Masonry and Fortification finish. Keep their queue small enough
    // that farms and the first library still get the construction workforce.
    const reserve = underAttack ? factionCommittedBudget(state, faction).upkeep : factionDevelopmentReserve(state, faction);
    const pending = owned.filter(building => building.construction && ['wall', 'palisade', 'woodenTower', 'road'].includes(building.kind)).length;
    const limit = productiveWork ? 1 : Math.min(4, Math.max(2, Math.floor(faction.population / 5)));
    if (pending >= limit) continue;
    let budget = limit - pending;
    const attempt = (kind: DefenseKind, x: number, y: number): boolean => {
      const cost = kind === 'woodenTower' ? 40 : kind === 'wall' ? STONE_WALL_GOLD : kind === 'palisade' ? 3 : 2;
      if (!budget || !isBuildingUnlocked(faction, kind) || faction.gold - cost < Math.max(underAttack ? 0 : 20, reserve)
        || kind === 'woodenTower' && !canSustainFactionDefense(state, faction, kind)
        || !orders.validate(faction.id, kind, x, y).ok) return false;
      if (!orders.build(faction.id, kind, x, y).ok) return false;
      budget--; return true;
    };
    for (const palace of owned.filter(building => building.kind === 'palace' && buildingReady(building))) {
      if (palace.depopulated) continue;
      const towers = owned.filter(building => building.kind === 'woodenTower' && distance(building, palace) < 9);
      // A small city starts with one affordable tower; a developed city covers
      // opposing approaches, with alternative sites for terrain and houses.
      if (isBuildingUnlocked(faction, 'woodenTower') && towers.length < (faction.population < 35 ? 1 : 2) && (faction.constructionPauseUntil?.woodenTower ?? 0) <= state.time) {
        for (const [dx, dy] of [[-3, -3], [4, 4], [4, -3], [-3, 4], [-4, 0], [5, 1]]) {
          if (towers.some(tower => distance(tower, { x: palace.x + dx, y: palace.y + dy }) < 4)) continue;
          if (attempt('woodenTower', palace.x + dx, palace.y + dy)) break;
        }
      }
      const existingRing = owned.filter(building => (building.kind === 'palisade' || building.kind === 'wall')
        && Math.abs(building.x - palace.x) <= 11 && Math.abs(building.y - palace.y) <= 11);
      // Starting enclosures expand around real farms. Repair their actual
      // perimeter instead of constructing a second, smaller ring through them.
      const established = existingRing.length >= 20;
      const left = established ? Math.min(...existingRing.map(building => building.x)) : palace.x - 4;
      const right = established ? Math.max(...existingRing.map(building => building.x)) : palace.x + 5;
      const top = established ? Math.min(...existingRing.map(building => building.y)) : palace.y - 4;
      const bottom = established ? Math.max(...existingRing.map(building => building.y)) : palace.y + 5;
      const perimeter: { x: number; y: number; gate: boolean }[] = [];
      for (let x = left; x <= right; x++)
        perimeter.push({ x, y: top, gate: x === palace.x }, { x, y: bottom, gate: x === palace.x + 1 });
      for (let y = top + 1; y < bottom; y++)
        perimeter.push({ x: left, y, gate: y === palace.y + 1 }, { x: right, y, gate: y === palace.y });
      // Existing roads retain access as owned gates. The four main entrances
      // remain open until a legal road can reach them, so farmers cannot be sealed out.
      const roadAt = (point: { x: number; y: number }): Building | undefined => state.buildings.find(building => building.faction === faction.id
        && building.kind === 'road' && building.hp > 0 && building.x === point.x && building.y === point.y);
      for (const point of perimeter) {
        if (!budget) break;
        // An existing timber ring stays useful after Masonry is researched;
        // do not repeatedly try to purchase stone walls on occupied cells.
        if (owned.some(building => (building.kind === 'wall' || building.kind === 'palisade') && building.x === point.x && building.y === point.y)) continue;
        const road = roadAt(point);
        if (point.gate && !road) { attempt('road', point.x, point.y); continue; }
        if (road && !buildingPresent(road)) continue;
        attempt(wallKind, point.x, point.y);
      }
      if (!budget) break;
    }
  }
}
