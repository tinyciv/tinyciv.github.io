import { isWallKind, type Building, type GameState, type Point } from './types';
import { FACTION_CITY_TOWERS, factionCityTowers, nextFactionTowerEnclosure } from './faction-tower-layout';
import { findPath, hasStaticPath, invalidateNavigation, travelTimeMapFrom } from './pathfinding';
import { constructionEdges } from './builders';

type InitialDefenseKind = 'palisade' | 'road' | 'woodenTower';
type Create = (kind: InitialDefenseKind, point: Point) => Building;
const key = (point: Point): string => `${point.x},${point.y}`;

/** Rival starting grants are individual gated tower enclosures. The city and
 * its fields stay open between forts, rather than inside one long perimeter. */
export function establishFactionStartingDefenses(state: GameState, palace: Building, create: Create): void {
  for (let index = factionCityTowers(state, palace).length; index < FACTION_CITY_TOWERS; index++) {
    const enclosure = nextFactionTowerEnclosure(state, palace);
    if (!enclosure) break;
    create('woodenTower', enclosure.tower);
    for (const wall of enclosure.walls) create('palisade', wall);
    if (!state.buildings.some(building => building.hp > 0 && building.kind === 'road' && building.faction === palace.faction
      && building.x === enclosure.gate.x && building.y === enclosure.gate.y)) create('road', enclosure.gate);
    invalidateNavigation(state);
  }
}

/** Finalize once after every city and tower for this faction has been placed.
 * Deferring avoids repeating full-map reachability for earlier capitals. */
export function ensureFactionStartingExits(state: GameState, faction: number, create: Create): void {
  // A second nearby enclosure can cut the first city's former gate approach.
  // Validate a real outward route for every owned town after the final towers,
  // opening owned gate layers wherever that route crosses friendly palisades.
  for (const city of state.buildings.filter(building => building.kind === 'palace' && building.faction === faction))
    ensureStartingCityExit(state, city, create);
}

function ensureStartingCityExit(state: GameState, palace: Building, create: Create): void {
  const walls = state.buildings.filter(building => isWallKind(building.kind) && building.faction === palace.faction && building.hp > 0);
  if (!walls.length) return;
  const planning = { ...state, buildings: state.buildings.filter(building => !walls.includes(building)) };
  const exits = constructionEdges(planning, palace), width = state.world.width;
  const travel = travelTimeMapFrom(planning, exits, palace.faction, 1, Infinity);
  let goal: Point | undefined, shortest = Infinity;
  for (let cell = 0; cell < travel.length; cell++) {
    if (travel[cell] >= shortest) continue;
    const point = { x: cell % width + .5, y: Math.floor(cell / width) + .5 };
    if (Math.hypot(point.x - palace.x - 1, point.y - palace.y - 1) < 16) continue;
    shortest = travel[cell]; goal = point;
  }
  const goals = goal ? [goal] : [];
  for (const city of state.buildings.filter(building => building.kind === 'palace' && building.faction === palace.faction && building !== palace)) {
    const connection = constructionEdges(planning, city).filter(point => Number.isFinite(travel[Math.floor(point.y) * width + Math.floor(point.x)]))
      .sort((a, b) => travel[Math.floor(a.y) * width + Math.floor(a.x)] - travel[Math.floor(b.y) * width + Math.floor(b.x)])[0];
    if (connection) goals.push(connection);
  }
  const roads = new Set(state.buildings.filter(building => building.kind === 'road' && building.hp > 0).map(key));
  for (const goal of goals) {
    if (exits.some(exit => hasStaticPath(state, exit, goal, palace.faction))) continue;
    const path = exits.map(exit => findPath(planning, exit, goal, palace.faction, false, undefined, undefined, undefined, true))
      .filter(path => path.length).sort((a, b) => a.length - b.length)[0];
    if (!path) continue;
    const crossing = new Set(path.map(point => key({ x: Math.floor(point.x), y: Math.floor(point.y) })));
    // Cardinal routing is preferred; a required diagonal also needs both side
    // cells open, matching the movement system's no-corner-cutting rule.
    for (let index = 1; index < path.length; index++) {
      const previous = path[index - 1], point = path[index];
      if (Math.floor(previous.x) !== Math.floor(point.x) && Math.floor(previous.y) !== Math.floor(point.y)) {
        crossing.add(key({ x: Math.floor(previous.x), y: Math.floor(point.y) }));
        crossing.add(key({ x: Math.floor(point.x), y: Math.floor(previous.y) }));
      }
    }
    for (const wall of walls) if (crossing.has(key(wall)) && !roads.has(key(wall))) { create('road', wall); roads.add(key(wall)); }
    invalidateNavigation(state);
  }
}
