import { constructionEdges } from './builders';
import { canWalk, hasStaticPath, withNavigationFrame } from './pathfinding';
import { validateNetworkPlacement } from './network-placement';
import { ridgeFootprintAllowed } from './ridges';
import { buildingHeight, buildingWidth, isWallKind, tileAt, WATER, type Building, type GameState, type Point } from './types';

export const FACTION_CITY_TOWERS = 4;
export interface FactionTowerEnclosure { tower: Point; walls: Point[]; gate: Point }
const cardinal = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const key = (point: Point): string => `${point.x},${point.y}`;
const same = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;
const chebyshev = (a: Point, b: Point): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const nearestCity = (cities: Building[], palace: Building, point: Point): boolean => cities.every(city => city.id === palace.id
  || Math.hypot(point.x - palace.x, point.y - palace.y) < Math.hypot(point.x - city.x, point.y - city.y)
  || Math.hypot(point.x - palace.x, point.y - palace.y) === Math.hypot(point.x - city.x, point.y - city.y) && palace.id < city.id);

export function factionCityTowers(state: GameState, palace: Building): Building[] {
  const cities = state.buildings.filter(building => building.hp > 0 && building.kind === 'palace' && building.faction === palace.faction);
  return state.buildings.filter(building => building.hp > 0 && building.kind === 'woodenTower' && building.faction === palace.faction
    && chebyshev(building, palace) <= 12 && nearestCity(cities, palace, building));
}

/** Eight palisades surround a single tower. Its cardinal gate is also the
 * civilian's repair contact cell; no building occupies that entrance. */
function planner(state: GameState, palace: Building): (tower: Point) => FactionTowerEnclosure | undefined {
  const occupied = new Map<string, Building[]>();
  for (const building of state.buildings) if (building.hp > 0) {
    for (let y = building.y; y < building.y + buildingHeight(building); y++) for (let x = building.x; x < building.x + buildingWidth(building); x++) {
      const cell = `${x},${y}`, at = occupied.get(cell);
      if (at) at.push(building); else occupied.set(cell, [building]);
    }
  }
  const buildable = (point: Point): boolean => {
    const tile = tileAt(state.world, point.x, point.y);
    return !!tile && !tile.marsh && !WATER.has(tile.terrain) && !['volcano', 'glacier'].includes(tile.overlay)
      && ridgeFootprintAllowed(state.world, point.x, point.y);
  };
  return tower => {
    const walls: Point[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const point = { x: tower.x + dx, y: tower.y + dy }, center = !dx && !dy;
      if (!buildable(point)) return;
      if ((occupied.get(key(point)) ?? []).some(building => building.faction !== palace.faction
        || (center ? building.kind !== 'woodenTower' : !isWallKind(building.kind) && building.kind !== 'road'))) return;
      if (!center) walls.push(point);
    }
    // Leave one walkable cell around the fortlet. Besides separating its walls
    // from neighboring forts, this keeps city paths from being cut by a tower
    // erected in a one-cell land bridge or among tightly packed buildings.
    const collarClear = withNavigationFrame(state, () => {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) === 2 || Math.abs(dy) === 2)
        if (!canWalk(state, tower.x + dx + .5, tower.y + dy + .5, palace.faction)) return false;
      return true;
    });
    if (!collarClear) return;
    const roads = walls.filter(point => occupied.get(key(point))?.some(building => building.kind === 'road'));
    if (roads.length > 1) return;
    const gates = cardinal.map(([dx, dy]) => ({ x: tower.x + dx, y: tower.y + dy }))
      .filter(point => !roads.length || same(point, roads[0]))
      .sort((a, b) => Math.hypot(a.x - palace.x - .5, a.y - palace.y - .5)
        - Math.hypot(b.x - palace.x - .5, b.y - palace.y - .5));
    for (const gate of gates) {
      const planned: Building[] = [
        { ...tower, kind: 'woodenTower', id: -900000, faction: palace.faction, hp: 1, maxHp: 1, capacity: 0 },
        ...walls.map((point, index) => ({ ...point, kind: 'palisade' as const, id: -900001 - index, faction: palace.faction, hp: 1, maxHp: 1, capacity: 0 })),
        { ...gate, kind: 'road', id: -900010, faction: palace.faction, hp: 1, maxHp: 1, capacity: 0 },
      ];
      // Replace unfinished local orders with their completed geometry when
      // checking the final layout, rather than relying on open footprints.
      const completed = { ...state, buildings: [...state.buildings.filter(building => !planned.some(point => same(point, building))), ...planned] };
      if (!walls.every(point => validateNetworkPlacement(completed, 'palisade', point.x, point.y, palace.faction).ok)
        || !validateNetworkPlacement(completed, 'road', gate.x, gate.y, palace.faction).ok) continue;
      const contact = { x: gate.x + .5, y: gate.y + .5 };
      if (constructionEdges(completed, palace).some(exit => hasStaticPath(completed, exit, contact, palace.faction)))
        return { tower: { ...tower }, walls, gate };
    }
  };
}

export function factionTowerEnclosure(state: GameState, palace: Building, tower: Point): FactionTowerEnclosure | undefined {
  return planner(state, palace)(tower);
}

/** Fill different approaches, keeping each three-cell enclosure independent.
 * Terrain may shift a position locally; no long connecting wall is generated. */
export function nextFactionTowerEnclosure(state: GameState, palace: Building,
  allowed: (point: Point) => boolean = () => true): FactionTowerEnclosure | undefined {
  const towers = factionCityTowers(state, palace), plan = planner(state, palace);
  const cities = state.buildings.filter(building => building.hp > 0 && building.kind === 'palace' && building.faction === palace.faction);
  const centers = state.buildings.filter(building => building.hp > 0 && building.kind === 'woodenTower');
  const sectors = [[-4, -4], [5, 5], [5, -4], [-4, 5]];
  sectors.sort((a, b) => Number(towers.some(tower => (tower.x < palace.x + .5) === (a[0] < 0) && (tower.y < palace.y + .5) === (a[1] < 0)))
    - Number(towers.some(tower => (tower.x < palace.x + .5) === (b[0] < 0) && (tower.y < palace.y + .5) === (b[1] < 0))));
  for (const [dx, dy] of sectors) {
    const candidates: Point[] = [];
    for (let y = palace.y - 9; y <= palace.y + 10; y++) for (let x = palace.x - 9; x <= palace.x + 10; x++) {
      if ((x < palace.x + .5) !== (dx < 0) || (y < palace.y + .5) !== (dy < 0)) continue;
      const point = { x, y };
      if (chebyshev(point, palace) < 3 || !nearestCity(cities, palace, point) || centers.some(other => chebyshev(point, other) < 4)) continue;
      candidates.push(point);
    }
    candidates.sort((a, b) => Math.hypot(a.x - palace.x - dx, a.y - palace.y - dy)
      - Math.hypot(b.x - palace.x - dx, b.y - palace.y - dy) || a.y - b.y || a.x - b.x);
    for (const candidate of candidates) {
      // Cheap geometry checks precede expensive authoritative placement checks.
      const enclosure = plan(candidate);
      if (enclosure && allowed(candidate)) return enclosure;
    }
  }
}
