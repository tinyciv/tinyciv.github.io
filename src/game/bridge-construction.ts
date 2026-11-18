import { entityStore } from './entity-store';
import { buildingHeight, buildingWidth, type Building, type GameState } from './types';

export function constructionFootprint(building: Building): { x: number; y: number; width: number; height: number } {
  return building.construction?.bridge ?? { x: building.x, y: building.y, width: buildingWidth(building), height: buildingHeight(building) };
}

/** The clock stays with the first living segment even if a foundation is destroyed. */
export function constructionHead(state: GameState, building: Building): Building {
  const order = building.construction?.bridge;
  if (!order) return building;
  const buildings = entityStore(state).buildings;
  for (const id of order.ids) {
    const part = buildings.get(id);
    if (part && part.hp > 0 && part.faction === building.faction && part.construction?.bridge?.ids[0] === order.ids[0]) return part;
  }
  return building;
}

export function bridgeConstructionMembers(state: GameState, building: Building): Building[] | undefined {
  const order = building.construction?.bridge;
  if (!order) return;
  const buildings = entityStore(state).buildings, parts: Building[] = [];
  for (const id of order.ids) {
    const part = buildings.get(id);
    if (part && part.hp > 0 && part.faction === building.faction && part.construction?.bridge?.ids[0] === order.ids[0]) parts.push(part);
  }
  return parts;
}
