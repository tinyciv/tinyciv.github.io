import { playerFaction } from './player-context';
import { entityStore } from './entity-store';
import { BUILDABLE_KINDS, type Point, type Building, type BuildSelection, type GameState, buildingKindForSelection, isFord, isWallKind, tileAt, WATER } from './types';
import { BUILD_COSTS, buildAt, buildBridgeSpan, buildCostAt, validateBuildAt, withConstructionBatch } from './simulation';
import { hasNeighboringRoad } from './traffic';
import { hasGateWall } from './network-placement';
import { queueConstruction } from './structures';
import { bridgeStroke, type BridgeSpan } from './bridge-spans';
import { createIrrigationConnectionQuery, isFreshwaterSource } from './irrigation';
import { farmAt, planRoadFarmRelocation, planWallFarmRelocation, previewFarmRelocation } from './farm-relocation';
import { constructionPreviewContext, rememberConstructionPreview, constructionFunds, sameConstructionFunds, constructionQuoteAffordable, constructionDisplayReadsActive } from './construction-preview-cache';
import { withSimulationReads } from './simulation-reads';
import { constructionPreviewState } from './construction-preview-state';
import { withImmediateMaintenance } from './work-cadence';
import { nativeConstructionLine } from './construction-native';

/** A single-width, cardinal-connected stroke for roads, walls, bridges and irrigation. */
export function constructionLine(from: Point, to: Point): Point[] {
  return nativeConstructionLine(from, to);
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
  bridgeSpans?: readonly BridgeSpan[];
}
const commitContexts = new WeakMap<ConstructionPlan, object>();
/** Reserve each eligible cell independently; a gap never seeds a new road island. */
export function planConstruction(state: GameState, selection: BuildSelection, points: Point[]): ConstructionPlan {
  if (!['road', 'wall', 'palisade', 'bridge', 'irrigation'].includes(selection)) return planConstructionUncached(state, selection, points);
  const context = constructionPreviewContext(state, selection), key = `${selection}:${points.map(p => `${Math.floor(p.x)},${Math.floor(p.y)}`).join(';')}`;
  const cached = context.plans.get(key), funds = constructionFunds(state);
  if (cached && (sameConstructionFunds(cached.funds, funds) || constructionQuoteAffordable(cached.value, funds))) return cached.value;
  const value = planConstructionUncached(state, selection, points);
  // Interactive road caches ignore remote routine work. Keep a full-state
  // validation token so purchases can distinguish a fresh quote from one
  // whose ranking/negative result needs authoritative reconsideration.
  // A private UI view is never purchased. Its real-state release performs
  // live per-cell validation, so no global authoritative token is needed here.
  if (!constructionDisplayReadsActive(state)) commitContexts.set(value, constructionPreviewContext(state));
  return rememberConstructionPreview(context.plans, key, { value, funds }).value;
}

function planConstructionUncached(state: GameState, selection: BuildSelection, points: Point[]): ConstructionPlan {
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

  // A hover over completed/queued cells is a no-op. It needs no private
  // transaction, terrain reset, farm view or ECS reconstruction.
  if (cells.every(cell => cell.existing)) return { ok: true, message: '', tiles: [], cells, skipped: 0,
    cost: 0, costs: { production: 0, food: 0, gold: 0 } };

  const reservedTiles = isWallKind(kind) || kind === 'road' ? new Set(cells.map(cell => cell.y * state.world.width + cell.x)) : undefined;
  const movesFarms = !!reservedTiles && cells.some(cell => farmAt(state, cell, playerFaction(state)));
  // Farm relocation edits crops, terrain and courier destinations. A preview
  // owns those records and never moves live farms while the mouse is held.
  // UI irrigation never relocates crops or changes occupancy: an accepted-cell
  // overlay supplies connectivity. Keep its existing indexed view instead of
  // cloning fog/the world and rebuilding ECS for each pointer endpoint.
  const lightweightIrrigation = kind === 'irrigation' && constructionDisplayReadsActive(state);
  const virtual = lightweightIrrigation ? state : constructionPreviewState(state, movesFarms);
  // This private transaction owns every mutation and publishes membership and
  // structure revisions. Share derived reads between its consecutive cells.
  return withSimulationReads(virtual, () => {
    const factions = virtual.factions;
    if (lightweightIrrigation) virtual.factions = factions.map(faction => ({ ...faction }));
    try {
    const pending = cells.filter(cell => !cell.existing), tiles: Point[] = [];
    const costs = { production: 0, food: 0, gold: 0 };
    const irrigationConnections = kind === 'irrigation' ? createIrrigationConnectionQuery(virtual) : undefined;
    const reservedDitches = kind === 'irrigation' ? new Set<number>() : undefined;
    if (kind === 'bridge') {
      const totalGold = pending.reduce((total, cell) => total + buildCostAt(virtual, kind, cell.x, cell.y).gold, 0);
      if (virtual.factions.find(faction => faction.id === playerFaction(state))!.gold < totalGold) return rejectAll(`Need ${totalGold} gold for this complete bridge.`);
    }
    while (pending.length) {
      // A stroke may be drawn toward a road instead of away from one. Always
      // reserve its connected end first, then grow outward in either direction.
      const next = kind === 'road' ? pending.findIndex(tile => hasGateWall(virtual, tile.x, tile.y) || hasNeighboringRoad(virtual, tile.x, tile.y))
        : irrigationConnections ? pending.findIndex(tile => irrigationConnections(tile.x, tile.y, reservedDitches)) : 0;
      if (next < 0) {
        for (const cell of pending) cell.message = validateBuildAt(virtual, kind, cell.x, cell.y, playerFaction(state), reservedDitches).message;
        break;
      }
      const [cell] = pending.splice(next, 1);
      const result = validateBuildAt(virtual, kind, cell.x, cell.y, playerFaction(state), reservedDitches ?? reservedTiles);
      cell.ok = result.ok; cell.message = result.message;
      if (!result.ok) continue;
      const tile = { x: cell.x, y: cell.y };
      const unitCost = buildCostAt(virtual, kind, cell.x, cell.y);
      if (reservedTiles && farmAt(virtual, tile, playerFaction(state))) {
        const relocation = (kind === 'road' ? planRoadFarmRelocation : planWallFarmRelocation)(virtual, tile, playerFaction(state), reservedTiles);
        // No replacement plot: the order clears the farm for a half refund.
        if (relocation) previewFarmRelocation(virtual, relocation);
      }
      reservedDitches?.add(cell.y * virtual.world.width + cell.x);
      if (!lightweightIrrigation) {
        const building: Building = { id: -virtual.buildings.length - 1, kind, faction: playerFaction(state), ...tile, hp: 100, maxHp: 100, capacity: 0 };
        // Reservations must not extend sight as though they were finished buildings.
        queueConstruction(building, state.time, 0, virtual);
        entityStore(virtual).buildings.addPreview(building);
      }
      for (const resource of ['production', 'food', 'gold'] as const) {
        virtual.factions.find(faction => faction.id === playerFaction(state))![resource] -= unitCost[resource];
        costs[resource] += unitCost[resource];
      }
      tiles.push(tile);
    }
    const rejected = cells.filter(cell => !cell.ok);
    if (kind === 'bridge' && rejected.length) return rejectAll(rejected[0].message);
    const plan = { ok: tiles.length > 0 || rejected.length === 0, message: rejected[0]?.message ?? '',
      tiles, cells, skipped: rejected.length, cost: costs.gold, costs, ...(crossing && { bridgeSpans: crossing.spans }) };
    return plan;
    } finally { if (lightweightIrrigation) virtual.factions = factions; }
  });
}

export function buildStroke(state: GameState, selection: BuildSelection, points: Point[]) {
  // The transaction and final reconciliation both own their indexed writes.
  // Explicit commands also force one maintenance pass per key, including when
  // paused after the ordinary simulation clock was already sampled.
  return withSimulationReads(state, () => withImmediateMaintenance(state,
    () => withConstructionBatch(state, () => buildStrokeInBatch(state, selection, points), true)));
}

function buildStrokeInBatch(state: GameState, selection: BuildSelection, points: Point[]) {
  const kind = selection === 'clearTrees' ? selection : buildingKindForSelection(selection);
  let plan = planConstruction(state, selection, points);
  if (['road', 'wall', 'palisade', 'bridge', 'irrigation'].includes(selection)
    && commitContexts.get(plan) !== constructionPreviewContext(state)) plan = planConstructionUncached(state, selection, points);
  if (!plan.ok) return { ok: false, message: plan.message, placed: 0, skipped: plan.skipped };
  if (kind === 'bridge') {
    const faction = playerFaction(state), width = state.world.width;
    const pending = new Set(plan.tiles.map(tile => tile.y * width + tile.x));
    for (const span of plan.bridgeSpans ?? []) buildBridgeSpan(state, faction, span, pending);
    return { ok: true, message: plan.message, placed: plan.tiles.length, skipped: plan.skipped };
  }
  let placed = 0, skipped = plan.skipped, message = plan.message;
  const reservedTiles = kind === 'wall' || kind === 'palisade' || kind === 'road' ? new Set(plan.cells.map(cell => cell.y * state.world.width + cell.x)) : undefined;
  for (const tile of plan.tiles) {
    const result = buildAt(state, selection, tile.x, tile.y, playerFaction(state), reservedTiles);
    if (result.ok) placed++;
    else { skipped++; message ||= result.message; }
  }
  return { ok: placed > 0 || plan.tiles.length === 0, message, placed, skipped };
}
