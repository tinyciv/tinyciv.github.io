import { territory, UNCLAIMED, type Territory } from './borders';
import { territoryValue } from './territory-cells';
import { dockBerth, dockPlacement, type DockFacing } from './dock';
import { canTraverseEdge, traversable } from './pathfinding';
import { reliefFootprintAllowed } from './relief';
import { startingRoadRing } from './settlement-layout';
import { completesTileSquare } from './network-placement';
import { structureIndex } from './structure-index';
import { settlementFootprintAllowed } from './terrain-sites';
import { navigableWaterCell } from './water-navigation';
import { buildingHeight, buildingWidth, tileAt, WATER, type Building, type BuildingKind, type GameState, type Point } from './types';

export type CreateStartingBuilding = (kind: BuildingKind, point: Point, dockFacing?: DockFacing) => Building;
const CARDINAL = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const LAYOUT_RADIUS = 30;
const HARBOR_RADIUS = 16;

export function advancedStartLayout(state: GameState, city: Building, create: CreateStartingBuilding) {
  const { world } = state, faction = city.faction;
  const key = ({ x, y }: Point) => y * world.width + x;
  const occupied = new Set<number>(), roads = new Set<number>(), routes = new Set<number>();
  const structures = structureIndex(state);
  const record = (building: Building): void => {
    for (let dy = 0; dy < buildingHeight(building); dy++) for (let dx = 0; dx < buildingWidth(building); dx++)
      occupied.add(key({ x: building.x + dx, y: building.y + dy }));
    if (building.kind === 'road' && building.faction === faction) roads.add(key(building));
    if (building.kind === 'road' || building.kind === 'bridge') routes.add(key(building));
    if (building.kind === 'dock') {
      const berth = dockBerth(building);
      occupied.add(key({ x: Math.floor(berth.x), y: Math.floor(berth.y) }));
    }
  };
  for (const building of state.buildings) if (building.hp > 0) record(building);

  const left = Math.max(1, city.x - LAYOUT_RADIUS), right = Math.min(world.width - 2, city.x + LAYOUT_RADIUS);
  const top = Math.max(1, city.y - LAYOUT_RADIUS), bottom = Math.min(world.height - 2, city.y + LAYOUT_RADIUS);
  const cells: Point[] = [], district = new Set<number>();
  const otherStarts = [...world.spawns, ...world.secondarySpawns ?? []]
    .filter(spawn => Math.hypot(spawn.x - city.x, spawn.y - city.y) > 8);
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    if (otherStarts.some(spawn => (spawn.x - x) ** 2 + (spawn.y - y) ** 2 < 81)) continue;
    const point = { x, y };
    cells.push(point); district.add(key(point));
  }

  const nearest = (a: Point, b: Point) => (a.x - city.x) ** 2 + (a.y - city.y) ** 2
    - (b.x - city.x) ** 2 - (b.y - city.y) ** 2 || a.y - b.y || a.x - b.x;
  cells.sort(nearest);

  const vacant = (point: Point) => !occupied.has(key(point));
  const emptyLand = (point: Point): boolean => {
    const tile = tileAt(world, point.x, point.y);
    return !!tile && !WATER.has(tile.terrain) && !tile.marsh && vacant(point) && district.has(key(point))
      && settlementFootprintAllowed(world, point.x, point.y);
  };
  const saltwater = (point: Point): boolean => {
    const terrain = tileAt(world, point.x, point.y)?.terrain;
    return terrain === 'ocean' || terrain === 'coast';
  };

  const roadGround = new Map<number, boolean>();
  const roadAllowed = (point: Point): boolean => {
    if (point.x < left || point.x > right || point.y < top || point.y > bottom) return false;
    const cell = key(point);
    if (!district.has(cell) || occupied.has(cell) && !roads.has(cell)) return false;
    let allowed = roadGround.get(cell);
    if (allowed === undefined) {
      const tile = tileAt(world, point.x, point.y)!;
      allowed = !WATER.has(tile.terrain) && !tile.marsh && traversable(world, point.x, point.y)
        && reliefFootprintAllowed(world, point.x, point.y);
      roadGround.set(cell, allowed);
    }
    return allowed;
  };
  const add = (kind: BuildingKind, point: Point, facing?: DockFacing): Building => {
    const building = create(kind, point, facing);
    record(building);
    return building;
  };

  /** One local road search serves all candidate rings in a placement pass. */
  const roadAccess = () => {
    const queue = [...roads].map(cell => ({ x: cell % world.width, y: Math.floor(cell / world.width) }));
    const reached = new Map(queue.map(point => [key(point), { distance: 0, previous: undefined as Point | undefined }]));
    for (let i = 0; i < queue.length; i++) {
      const point = queue[i], distance = reached.get(key(point))!.distance + 1;
      for (const [dx, dy] of CARDINAL) {
        const next = { x: point.x + dx, y: point.y + dy }, nextCell = key(next);
        if (reached.has(nextCell) || !roadAllowed(next) || !canTraverseEdge(world, point, next)) continue;
        reached.set(nextCell, { distance, previous: point }); queue.push(next);
      }
    }
    return reached;
  };

  function placeLot(width: number, height: number, accept: (point: Point, borders: Territory) => boolean,
    build: (point: Point) => void, candidates: readonly Point[] = cells, waterfront = false): boolean {
    const borders = territory(state);
    let access: ReturnType<typeof roadAccess> | undefined;
    for (const anchor of candidates) {
      if (!reliefFootprintAllowed(world, anchor.x, anchor.y, width, height)) continue;
      const footprint = Array.from({ length: width * height }, (_, i) => ({ x: anchor.x + i % width, y: anchor.y + Math.floor(i / width) }));
      if (!footprint.every(emptyLand) || !accept(anchor, borders)) continue;
      const perimeter = startingRoadRing(anchor, width, height);
      const ring = waterfront ? perimeter.filter(point => !saltwater(point)) : perimeter;
      if (!ring.length || !ring.every(roadAllowed)) continue;
      // Check the entire proposed perimeter before committing the lot.
      const perimeterCells = new Set(ring.map(key));
      const routeAt = (cell: number) => routes.has(cell) || perimeterCells.has(cell);
      if (ring.some(point => !routes.has(key(point)) && completesTileSquare(world.width, world.height, point.x, point.y, routeAt))) continue;
      // On the waterfront the dry perimeter must still form one walkable
      // stretch. A single break at the sea is enough for the berth or slip.
      const breaks = ring.filter((point, i) => !canTraverseEdge(world, point, ring[(i + 1) % ring.length])).length;
      if (breaks > Number(waterfront)) continue;
      const entrance = ring.some(({ x, y }) => {
        const edge = { x: Math.max(anchor.x, Math.min(x, anchor.x + width - 1)), y: Math.max(anchor.y, Math.min(y, anchor.y + height - 1)) };
        return Math.abs(x - edge.x) + Math.abs(y - edge.y) === 1 && canTraverseEdge(world, { x, y }, edge);
      });
      if (!entrance) continue;
      const connector: Point[] = [];
      if (!ring.some(point => roads.has(key(point)))) {
        access ??= roadAccess();
        let entry: Point | undefined, shortest = Infinity;
        for (const point of ring) {
          const distance = access.get(key(point))?.distance ?? Infinity;
          if (distance < shortest) { entry = point; shortest = distance; }
        }
        if (!entry) continue;
        // The first dry perimeter tile reached by a cardinal route lies
        // outside the footprint, including on lots that end at the sea.
        for (let step = access.get(key(entry))!.previous; step; step = access.get(key(step))!.previous) connector.push(step);
      }
      build(anchor);
      for (const point of ring) if (!roads.has(key(point))) add('road', point);
      for (const point of connector) if (!roads.has(key(point)) && !structures.completesRoadSquare(point.x, point.y)) add('road', point);
      return true;
    }
    return false;
  }

  function placeSeaside(kind: 'dock' | 'whalingPost' | 'shipyard'): void {
    const width = buildingWidth({ kind }), height = buildingHeight({ kind });
    let facing: DockFacing | undefined;
    const nearShore = cells.filter(point => Math.hypot(point.x + width / 2 - city.x - 1, point.y + height / 2 - city.y - 1) <= HARBOR_RADIUS);
    placeLot(width, height, (point, borders) => {
      for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) {
        const owner = territoryValue(borders, key({ x: point.x + dx, y: point.y + dy }));
        if (owner !== faction && owner !== UNCLAIMED) return false;
      }
      if (kind === 'dock') {
        facing = dockPlacement(state, point.x, point.y, faction, saltwater)?.facing;
        return facing !== undefined;
      }
      // Fishing and naval buildings use the same cardinal shoreline access
      // as their ordinary placement. The shipyard accepts shallow coast.
      return startingRoadRing(point, width, height).some(shore =>
        (shore.x >= point.x && shore.x < point.x + width || shore.y >= point.y && shore.y < point.y + height)
        && (kind === 'whalingPost' ? saltwater(shore) : tileAt(world, shore.x, shore.y)?.terrain === 'coast')
        && navigableWaterCell(world, shore.x, shore.y));
    }, point => { add(kind, point, facing); }, nearShore, true);
  }

  return { add, cells, placeLot, placeSeaside, vacant };
}
