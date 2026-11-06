import { engineerBuildMultiplier } from './leader-abilities';
import { playerFaction } from './player-context';
import { entityStore } from './entity-store';
import { BUILDABLE_KINDS, type Point, type Building, type BuildSelection, type GameState, buildingKindForSelection, buildingPresent, buildingReady, isFord, isWallKind, tileAt, WATER } from './types';
import { BUILD_COSTS, buildAt, buildCostAt, validateBuildAt } from './simulation';
import { hasNeighboringRoad } from './traffic';
import { hasGateWall } from './network-placement';
import { queueConstruction } from './structures';
import { bridgeStroke } from './bridge-spans';
import { irrigationConnects, isFreshwaterSource } from './irrigation';
import { farmAt, planRoadFarmRelocation, planWallFarmRelocation, relocateFarm } from './farm-relocation';
import { forbiddenRevision } from './forbidden-zones';
import { territory } from './borders';

/** A single-width, cardinal-connected stroke for roads, walls, bridges and irrigation. */
export function constructionLine(from: Point, to: Point): Point[] {
  let x = Math.floor(from.x), y = Math.floor(from.y);
  const endX = Math.floor(to.x), endY = Math.floor(to.y);
  const dx = Math.abs(endX - x), dy = Math.abs(endY - y);
  const sx = Math.sign(endX - x), sy = Math.sign(endY - y);
  let movedX = 0, movedY = 0;
  const result: Point[] = [{ x, y }];
  while (movedX < dx || movedY < dy) {
    if (movedY === dy || (movedX < dx && (movedX + .5) * dy <= (movedY + .5) * dx)) {
      x += sx; movedX++;
    } else {
      y += sy; movedY++;
    }
    result.push({ x, y });
  }
  return result;
}


export interface ConstructionCell extends Point {
  ok: boolean;
  existing: boolean;
  message: string;
}
export interface ConstructionPlan {
  ok: boolean;
  message: string;
  /** Eligible new cells, in the exact order in which they will be purchased. */
  tiles: Point[];
  /** Every unique cell in the stroke, including existing and rejected cells. */
  cells: ConstructionCell[];
  skipped: number;
  cost: number;
  costs: { production: number; food: number; gold: number };
}
interface WallFarmPreview { world: GameState['world']; tiles: GameState['world']['tiles']; signature: string; plans: Map<string, ConstructionPlan>; }
const MAX_FARM_PREVIEW_ROUTES = 32;
const wallFarmPreviews = new WeakMap<GameState, WallFarmPreview>();

/** Reserve each eligible cell independently; a gap never seeds a new road island. */
export function planConstruction(state: GameState, selection: BuildSelection, points: Point[]): ConstructionPlan {
  const kind = selection === 'clearTrees' ? selection : buildingKindForSelection(selection);
  const crossing = kind === 'bridge' ? bridgeStroke(state, points) : undefined;
  if (crossing) points = crossing.points;
  const seen = new Set<string>();
  const cells: ConstructionCell[] = points.map(p => ({ x: Math.floor(p.x), y: Math.floor(p.y) })).filter(p => {
    const key = `${p.x},${p.y}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(p => {
    // A drag can start on or cross a ford without paving over the natural
    // crossing, spending gold on it, or granting a bridge's movement speed.
    const existing = kind === 'clearTrees' ? !!state.treeClearings?.some(order => order.faction === playerFaction(state) && order.x === p.x && order.y === p.y)
      : kind === 'bridge' && !!tileAt(state.world, p.x, p.y) && !WATER.has(tileAt(state.world, p.x, p.y)!.terrain)
        || kind === 'road' && isFord(tileAt(state.world, p.x, p.y)) && !hasGateWall(state, p.x, p.y)
        || kind === 'irrigation' && isFreshwaterSource(state, p.x, p.y)
        || state.buildings.some(b => b.hp > 0 && b.kind === kind && b.faction === playerFaction(state) && b.x === p.x && b.y === p.y);
    return { ...p, ok: existing, existing, message: '' };
  });
  const rejectAll = (message: string): ConstructionPlan => ({ ok: false, message, tiles: [],
    cells: cells.map(cell => ({ ...cell, ok: false, message })), skipped: cells.length,
    cost: 0, costs: { production: 0, food: 0, gold: 0 } });
  if (crossing && !crossing.ok) return rejectAll(crossing.message);
  if (kind === 'clearTrees') {
    for (const cell of cells) if (!cell.existing) {
      const result = validateBuildAt(state, kind, cell.x, cell.y);
      cell.ok = result.ok; cell.message = result.message;
    }
    const rejected = cells.filter(cell => !cell.ok), tiles = cells.filter(cell => cell.ok && !cell.existing).map(({ x, y }) => ({ x, y }));
    return { ok: tiles.length > 0 || rejected.length === 0, message: rejected[0]?.message ?? '', tiles, cells, skipped: rejected.length,
      cost: 0, costs: { production: 0, food: 0, gold: 0 } };
  }
  if (!BUILDABLE_KINDS.includes(kind)) return rejectAll('Choose a building from the build panel.');
  if (!['road', 'wall', 'palisade', 'bridge', 'irrigation'].includes(kind) && cells.length > 1)
    return rejectAll('Place one building at a time.');

  // A single building has no later stroke cells to simulate. Validate the live
  // state read-only so its relocation and housing caches survive mouse hover.
  if (!['road', 'wall', 'palisade', 'bridge', 'irrigation'].includes(kind)) {
    const cell = cells[0];
    if (!cell || cell.existing) return { ok: true, message: '', tiles: [], cells, skipped: 0,
      cost: 0, costs: { production: 0, food: 0, gold: 0 } };
    const result = validateBuildAt(state, kind, cell.x, cell.y);
    cell.ok = result.ok; cell.message = result.message;
    const costs = result.ok ? { ...BUILD_COSTS[kind] } : { production: 0, food: 0, gold: 0 };
    return { ok: result.ok, message: result.message, tiles: result.ok ? [{ x: cell.x, y: cell.y }] : [], cells,
      skipped: result.ok ? 0 : 1, cost: costs.gold, costs };
  }

  const reservedTiles = isWallKind(kind) || kind === 'road' ? new Set(cells.map(cell => cell.y * state.world.width + cell.x)) : undefined;
  const movesFarms = !!reservedTiles && cells.some(cell => farmAt(state, cell, playerFaction(state)));
  const leader = movesFarms ? state.units.find(unit => unit.kind === 'leader' && unit.faction === playerFaction(state) && unit.hp > 0) : undefined;
  const signature = movesFarms ? JSON.stringify([playerFaction(state), state.gameOver, engineerBuildMultiplier(state, 'road', playerFaction(state)),
    state.world.revision, forbiddenRevision(state), territory(state).revision, leader && [leader.id, leader.x, leader.y],
    state.factions.map(faction => [faction.id, faction.relation, faction.defeated, faction.gold, faction.research?.levels]),
    state.buildings.map(building => [building.id, building.kind, building.faction, building.x, building.y, building.hp > 0,
      buildingReady(building), buildingPresent(building), !!building.farmSuppressed]),
    state.fields?.map(field => [field.camp, field.faction, field.x, field.y])]) : '';
  const previewKey = `${kind}:${cells.map(cell => `${cell.x},${cell.y}`).join(';')}`;
  let cached = wallFarmPreviews.get(state);
  if (movesFarms) {
    if (!cached || cached.world !== state.world || cached.tiles !== state.world.tiles || cached.signature !== signature) {
      cached = { world: state.world, tiles: state.world.tiles, signature, plans: new Map() }; wallFarmPreviews.set(state, cached);
    }
    const hit = cached.plans.get(previewKey);
    if (hit) return hit;
  }
  // Farm relocation edits crops, terrain and courier destinations. A preview
  // owns those records and never moves live farms while the mouse is held.
  const virtual: GameState = { ...state,
    multiplayer: state.multiplayer && structuredClone(state.multiplayer),
    world: movesFarms ? { ...state.world, tiles: state.world.tiles.map(tile => ({ ...tile })) } : state.world,
    buildings: movesFarms ? structuredClone(state.buildings) : [...state.buildings],
    units: movesFarms ? structuredClone(state.units) : state.units,
    fields: movesFarms ? structuredClone(state.fields) : state.fields,
    factions: state.factions.map(f => ({ ...f })),
    // Visibility validation remembers visible structures. Keep those preview
    // memories and exploration changes separate from the live save state.
    fog: state.fog && { ...state.fog, explored: [...state.fog.explored],
      buildings: state.fog.buildings && [...state.fog.buildings], fields: state.fog.fields && [...state.fog.fields] } };
  const pending = cells.filter(cell => !cell.existing), tiles: Point[] = [];
  const costs = { production: 0, food: 0, gold: 0 };
  if (kind === 'bridge') {
    const totalGold = pending.reduce((total, cell) => total + buildCostAt(virtual, kind, cell.x, cell.y).gold, 0);
    if (virtual.factions.find(faction => faction.id === playerFaction(state))!.gold < totalGold) return rejectAll(`Need ${totalGold} gold for this complete bridge.`);
  }
  while (pending.length) {
    // A stroke may be drawn toward a road instead of away from one. Always
    // reserve its connected end first, then grow outward in either direction.
    const next = kind === 'road' ? pending.findIndex(tile => hasGateWall(virtual, tile.x, tile.y) || hasNeighboringRoad(virtual, tile.x, tile.y))
      : kind === 'irrigation' ? pending.findIndex(tile => irrigationConnects(virtual, tile.x, tile.y)) : 0;
    if (next < 0) {
      for (const cell of pending) cell.message = validateBuildAt(virtual, kind, cell.x, cell.y).message;
      break;
    }
    const [cell] = pending.splice(next, 1);
    const result = validateBuildAt(virtual, kind, cell.x, cell.y, playerFaction(state), reservedTiles);
    cell.ok = result.ok; cell.message = result.message;
    if (!result.ok) continue;
    const tile = { x: cell.x, y: cell.y };
    const unitCost = buildCostAt(virtual, kind, cell.x, cell.y);
    if (reservedTiles && farmAt(virtual, tile, playerFaction(state))) {
      const relocation = (kind === 'road' ? planRoadFarmRelocation : planWallFarmRelocation)(virtual, tile, playerFaction(state), reservedTiles);
      if (!relocation || !relocateFarm(virtual, relocation, tile, { wall: true, road: kind === 'road', reservedTiles })) {
        cell.ok = false; cell.message = 'The farm no longer has a valid replacement plot.'; continue;
      }
    }
    const building: Building = { id: -virtual.buildings.length - 1, kind, faction: playerFaction(state), ...tile, hp: 100, maxHp: 100, capacity: 0 };
    // Reservations must not extend sight as though they were finished buildings.
    queueConstruction(building, state.time, 0, virtual);
    entityStore(virtual).buildings.add(building);
    for (const resource of ['production', 'food', 'gold'] as const) {
      virtual.factions.find(faction => faction.id === playerFaction(state))![resource] -= unitCost[resource];
      costs[resource] += unitCost[resource];
    }
    tiles.push(tile);
  }
  const rejected = cells.filter(cell => !cell.ok);
  if (kind === 'bridge' && rejected.length) return rejectAll(rejected[0].message);
  const plan = { ok: tiles.length > 0 || rejected.length === 0, message: rejected[0]?.message ?? '',
    tiles, cells, skipped: rejected.length, cost: costs.gold, costs };
  if (movesFarms && cached) {
    if (cached.plans.size >= MAX_FARM_PREVIEW_ROUTES) cached.plans.delete(cached.plans.keys().next().value!);
    cached.plans.set(previewKey, plan);
  }
  return plan;
}

export function buildStroke(state: GameState, selection: BuildSelection, points: Point[]) {
  const kind = selection === 'clearTrees' ? selection : buildingKindForSelection(selection);
  const plan = planConstruction(state, selection, points);
  if (!plan.ok) return { ok: false, message: plan.message, placed: 0, skipped: plan.skipped };
  let placed = 0, skipped = plan.skipped, message = plan.message;
  const reservedTiles = kind === 'wall' || kind === 'palisade' || kind === 'road' ? new Set(plan.cells.map(cell => cell.y * state.world.width + cell.x)) : undefined;
  for (const tile of plan.tiles) {
    const result = buildAt(state, selection, tile.x, tile.y, playerFaction(state), reservedTiles);
    if (result.ok) placed++;
    else { skipped++; message ||= result.message; }
  }
  return { ok: placed > 0 || plan.tiles.length === 0, message, placed, skipped };
}
