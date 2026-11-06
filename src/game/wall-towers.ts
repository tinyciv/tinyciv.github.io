import { isWallKind, type Building } from './types';

type Site = Pick<Building, 'kind' | 'faction' | 'x' | 'y'>;

/** A defensive tower and its owner's wall can occupy one logical tile.
 * They remain independent structures with their own health and construction. */
export function canShareWallTowerTile(a: Site, b: Site): boolean {
  return a.faction === b.faction && a.x === b.x && a.y === b.y
    && (a.kind === 'woodenTower' && isWallKind(b.kind) || isWallKind(a.kind) && b.kind === 'woodenTower');
}

export function sharedWallForTower(tower: Building, buildings: readonly Building[]): Building | undefined {
  if (tower.kind !== 'woodenTower' || tower.hp <= 0) return;
  return buildings.find(building => building.hp > 0 && canShareWallTowerTile(tower, building));
}

export function sharedTowerForWall(wall: Building, buildings: readonly Building[]): Building | undefined {
  if (!isWallKind(wall.kind) || wall.hp <= 0) return;
  return buildings.find(building => building.hp > 0 && canShareWallTowerTile(wall, building));
}
