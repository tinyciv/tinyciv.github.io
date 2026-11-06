import { constructionEdges } from './builders';
import { travelTimeMap, withNavigationFrame } from './pathfinding';
import { buildingPresent, isFarmKind, isWallKind, type Building, type GameState, type Point } from './types';
import { villageHostility } from './villages';

/** Shared by strategic objectives and specialist raiders' local sensing. */
export function isRaiderEnemyFaction(state: GameState, faction: number): boolean {
  return faction >= 0 && villageHostility(state, -2, faction) !== false;
}

export function isRaidObjective(state: GameState, building: Building): boolean {
  const faction = state.factions.find(faction => faction.id === building.faction);
  return isRaiderEnemyFaction(state, building.faction) && (!state.factions.length || !!faction && !faction.defeated)
    && buildingPresent(building) && !isFarmKind(building.kind)
    && !['road', 'bridge', 'irrigation', 'wall', 'palisade', 'ruin'].includes(building.kind);
}

/** Known settlements are strategic destinations. This never reads hidden unit positions. */
export function selectRaidTarget(state: GameState, from: Point, ownPack?: number, previousFaction?: number): Building | undefined {
  const candidates = state.buildings.filter(building => isRaidObjective(state, building));
  if (!candidates.length) return;
  // Walls can be breached; rivers and disconnected islands cannot.
  const planning = { ...state, buildings: state.buildings.filter(building => !(building.faction >= 0 && isWallKind(building.kind))) };
  return withNavigationFrame(planning, () => {
  const travel = travelTimeMap(planning, from, -2, 2.35, Infinity);
  const pressure = new Map<number, number>(), objectives = new Map<number, number>();
  for (const pack of state.marauderPacks ?? []) if (pack.id !== ownPack && pack.raid && !pack.returning) {
    pressure.set(pack.targetFaction, (pressure.get(pack.targetFaction) ?? 0) + 1);
    if (pack.targetBuilding !== undefined) objectives.set(pack.targetBuilding, (objectives.get(pack.targetBuilding) ?? 0) + 1);
  }
  return candidates.map(building => {
    const route = Math.min(Infinity, ...constructionEdges(planning, building)
      .map(point => travel[Math.floor(point.y) * state.world.width + Math.floor(point.x)]));
    return { building, route, score: route + (pressure.get(building.faction) ?? 0) * 18
      + (objectives.get(building.id) ?? 0) * 8 + (previousFaction === building.faction ? 12 : 0) };
  }).filter(candidate => Number.isFinite(candidate.route)).sort((a, b) => a.score - b.score || a.building.id - b.building.id)[0]?.building;
  });
}
