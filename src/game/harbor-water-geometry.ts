import { dockBerth } from './dock';
import { entityStore } from './entity-store';
import { canTraverseEdge } from './pathfinding';
import { navigableWaterCell } from './water-navigation';
import { worldRevisions } from './world-revisions';
import { buildingHeight, buildingWidth, tileAt, WATER, type Building, type GameState, type Point, type World } from './types';
const DIRECTIONS = [[0,-1],[1,0],[0,1],[-1,0]] as const;
interface WaterNavigation {
  world: World; tiles: World['tiles']; geometry: number; structures: string; edges: Uint8Array;
}
interface NavigationRecord {
  nav?: WaterNavigation; buildingRevision: number; rawRevision?: number;
  blocked: Set<number>; structures: string; buildings: Building[];
}
const navigationRecords = new WeakMap<GameState, NavigationRecord>();
const cellAt = (world: World, point: Point): number => Math.floor(point.y) * world.width + Math.floor(point.x);
const pointAt = (world: World, cell: number): Point => ({ x: cell % world.width + .5, y: Math.floor(cell / world.width) + .5 });
/** Share water geometry between every dock. Ordinary road/house changes only
 * recheck the tiny set of water blockers; they never rebuild ocean navigation. */
function navigation(state: GameState): WaterNavigation {
  const { world } = state, geometry = worldRevisions(world).geometry, revision = entityStore(state).buildings.revision;
  let record = navigationRecords.get(state);
  if (!record) {
    record = { buildingRevision: -1, blocked: new Set(), structures: '', buildings: [] }; navigationRecords.set(state, record);
  }
  if (!record.nav || record.nav.world !== world || record.nav.geometry !== geometry || record.buildingRevision !== revision
    || record.rawRevision !== world.revision || record.buildings.some(building => building.hp <= 0)) {
    const blocked = new Set<number>(), buildings: Building[] = [];
    for (const building of state.buildings) {
      if (building.hp <= 0 || building.kind === 'irrigation') continue;
      let relevant = false;
      for (let dy = 0; dy < buildingHeight(building); dy++) for (let dx = 0; dx < buildingWidth(building); dx++) {
        const x = building.x + dx, y = building.y + dy;
        if (WATER.has(tileAt(world, x, y)?.terrain!)) { blocked.add(y * world.width + x); relevant = true; }
      }
      if (building.kind === 'dock') { blocked.add(cellAt(world, dockBerth(building))); relevant = true; }
      if (relevant) buildings.push(building);
    }
    record.blocked = blocked; record.structures = [...blocked].sort((a, b) => a - b).join(','); record.buildings = buildings;
    record.buildingRevision = revision; record.rawRevision = world.revision;
  }
  const old = record.nav;
  if (old && old.world === world && old.tiles === world.tiles && old.geometry === geometry && old.structures === record.structures) return old;
  const count = world.width * world.height, open = new Uint8Array(count), edges = new Uint8Array(count);
  for (let cell = 0; cell < count; cell++) {
    const x = cell % world.width, y = Math.floor(cell / world.width);
    if (!record.blocked.has(cell) && navigableWaterCell(world, x, y)) open[cell] = 1;
  }
  for (let cell = 0; cell < count; cell++) if (open[cell]) {
    const point = pointAt(world, cell);
    for (let side = 0; side < 4; side++) {
      const [dx, dy] = DIRECTIONS[side], x = Math.floor(point.x) + dx, y = Math.floor(point.y) + dy;
      if (x >= 0 && y >= 0 && x < world.width && y < world.height && open[y * world.width + x]
        && canTraverseEdge(world, point, { x: point.x + dx, y: point.y + dy })) edges[cell] |= 1 << side;
    }
  }
  return record.nav = { world, tiles: world.tiles, geometry, structures: record.structures, edges };
}

/** Immutable geometry transport; native consumers own graph searches. */
export function harborWaterEdges(state: GameState): Uint8Array { return navigation(state).edges; }
