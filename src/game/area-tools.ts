import { playerFaction } from './player-context';
import { type Building, type GameState, type Point, buildingWidth, buildingHeight, tileAt } from './types';
import { cancelConstruction, refreshAfterBuildingRemoval } from './simulation';
import { prepareConstructionCancellation, removeBuildings } from './construction-cancellation';
import { clearBuildingFootprint } from './construction-clearance';
import { pauseCityConstruction } from './governor';
import { territory } from './borders';
import { buildingWithinBorders } from './property-territory';
import { buildStroke } from './construction';
import { hasTree } from './tree-clearing';

export interface AreaToolResult {
  ok: boolean;
  count: number;
  refund: number;
  skipped: number;
  message: string;
}

/** Inclusive tile bounds, independent of the direction in which the user drags. */
function rectangle(state: GameState, start: Point, end: Point): { left: number; top: number; right: number; bottom: number } | undefined {
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) return;
  const left = Math.max(0, Math.floor(Math.min(start.x, end.x)));
  const top = Math.max(0, Math.floor(Math.min(start.y, end.y)));
  const right = Math.min(state.world.width - 1, Math.floor(Math.max(start.x, end.x)));
  const bottom = Math.min(state.world.height - 1, Math.floor(Math.max(start.y, end.y)));
  return left <= right && top <= bottom ? { left, top, right, bottom } : undefined;
}

/** All cells in the rectangular extent, for both previews and clear-tree orders. */
export function tilesInRectangle(state: GameState, start: Point, end: Point): Point[] {
  const bounds = rectangle(state, start, end), points: Point[] = [];
  if (bounds) for (let y = bounds.top; y <= bounds.bottom; y++)
    for (let x = bounds.left; x <= bounds.right; x++) points.push({ x, y });
  return points;
}

/** Touching any part of a structure selects it, including a farm's outer plots. */
export function buildingsInArea(state: GameState, start: Point, end: Point, factionId = playerFaction(state), includeTerritory = false): Building[] {
  const bounds = rectangle(state, start, end);
  if (!bounds) return [];
  const borders = includeTerritory ? territory(state) : undefined;
  return state.buildings.filter(building => {
    if (building.kind === 'fort' && building.faction !== factionId) return false;
    if (building.hp <= 0 && !(building.kind === 'fort' && building.fort?.destroyed) || building.faction !== factionId && (!borders || !buildingWithinBorders(state, building, factionId, borders))) return false;
    const left = building.x, top = building.y;
    return left <= bounds.right && left + buildingWidth(building) > bounds.left && top <= bounds.bottom && top + buildingHeight(building) > bounds.top;
  });
}

function unavailable(): AreaToolResult {
  return { ok: false, count: 0, refund: 0, skipped: 0, message: 'This realm can no longer change buildings.' };
}

export function cancelConstructionInArea(state: GameState, start: Point, end: Point, factionId = playerFaction(state)): AreaToolResult {
  if (state.gameOver || !state.factions.some(faction => faction.id === factionId)) return unavailable();
  const sites = buildingsInArea(state, start, end, factionId).filter(building => building.construction);
  // Remove a queued wall before its gate road so the road cannot close that wall on an occupant.
  sites.sort((a, b) => Number(a.kind === 'road') - Number(b.kind === 'road'));
  let count = 0, refund = 0;
  for (const site of sites) {
    const result = cancelConstruction(state, site.id, factionId);
    if (result.ok) { count++; refund += result.refund; }
  }
  const skipped = sites.length - count;
  const message = count ? `Cancelled ${count} building${count === 1 ? '' : 's'}. Refunded ${refund} gold.`
    : skipped ? 'A gate is occupied and has no safe exit.' : 'No unfinished friendly buildings in this area.';
  return { ok: count > 0, count, refund, skipped, message };
}

function crossingLast(a: Building, b: Building): number {
  return Number(a.kind === 'road' || a.kind === 'bridge') - Number(b.kind === 'road' || b.kind === 'bridge');
}

function demolishBuilding(state: GameState, building: Building): boolean {
  if (!prepareConstructionCancellation(state, building)) return false;
  if (building.kind === 'bridge' && !clearBuildingFootprint(state, building)) return false;
  pauseCityConstruction(state, building);
  removeBuildings(state, new Set([building.id]));
  const left = building.x, top = building.y;
  for (let y = top; y < top + buildingHeight(building); y++) for (let x = left; x < left + buildingWidth(building); x++) {
    if (building.kind === 'irrigation') continue;
    const key = y * state.world.width + x;
    delete state.traffic?.[key];
  }
  return true;
}

/** One player tool cancels friendly orders, removes eligible property, and marks
 * trees for workers. Eligibility is captured before removing border sources. */
export function clearArea(state: GameState, start: Point, end: Point): AreaToolResult {
  if (state.gameOver || !state.factions.some(faction => faction.id === playerFaction(state))) return unavailable();
  const buildings = buildingsInArea(state, start, end, playerFaction(state), true).sort(crossingLast);
  const changedFactions = new Map<number, boolean>();
  let cancelled = 0, demolished = 0, refund = 0, keptCrossings = 0;
  for (const building of buildings) {
    if (building.faction === playerFaction(state) && building.construction) {
      // Cancellation normally removes only non-walkable sites, but retain an
      // occupied bridge too if its removal would strand a unit.
      if (building.kind === 'bridge' && !clearBuildingFootprint(state, building)) { keptCrossings++; continue; }
      const result = cancelConstruction(state, building.id);
      if (result.ok) { cancelled++; refund += result.refund; }
      else keptCrossings++;
      // A rejected cancellation must never fall through to demolition.
      continue;
    }
    if (!demolishBuilding(state, building)) { keptCrossings++; continue; }
    changedFactions.set(building.faction, !!changedFactions.get(building.faction) || building.capacity > 0 && !building.construction);
    demolished++;
  }
  for (const [owner, housingRemoved] of changedFactions) refreshAfterBuildingRemoval(state, owner, housingRemoved);
  const trees = tilesInRectangle(state, start, end).filter(point => hasTree(state, point));
  const includesMarsh = trees.some(point => tileAt(state.world, point.x, point.y)?.marsh);
  const coverName = (count: number) => includesMarsh ? `vegetation patch${count === 1 ? '' : 'es'}` : `tree${count === 1 ? '' : 's'}`;
  const clearing = buildStroke(state, 'clearTrees', trees);
  const count = cancelled + demolished + clearing.placed, skipped = keptCrossings + clearing.skipped;
  const messages: string[] = [];
  if (cancelled) messages.push(`Cancelled ${cancelled} construction site${cancelled === 1 ? '' : 's'}. Refunded ${refund} gold.`);
  if (demolished) messages.push(`Demolished ${demolished} building${demolished === 1 ? '' : 's'}.`);
  if (clearing.placed) messages.push(`Marked ${clearing.placed} ${coverName(clearing.placed)} for clearing.`);
  if (keptCrossings) messages.push(`Kept ${keptCrossings} occupied crossing${keptCrossings === 1 ? '' : 's'} with no safe exit.`);
  if (clearing.skipped) messages.push(`Skipped ${clearing.skipped} ${coverName(clearing.skipped)}. ${clearing.message}`.trim());
  if (!messages.length) messages.push(trees.length ? 'Vegetation already marked for clearing.' : 'No clearable trees, marsh plants or buildings in this area.');
  return { ok: count > 0, count, refund, skipped, message: messages.join(' ') };
}

/** Remove owned infrastructure or foreign property inside our borders without
 * a refund. Water crossings and gates
 * are retained if removing them would leave an occupant on impassable ground. */
export function demolishBuildingsInArea(state: GameState, start: Point, end: Point, factionId = playerFaction(state)): AreaToolResult {
  const faction = state.factions.find(candidate => candidate.id === factionId);
  if (state.gameOver || !faction) return unavailable();
  const buildings = buildingsInArea(state, start, end, factionId, true);
  buildings.sort(crossingLast);
  let count = 0;
  const changedFactions = new Map<number, boolean>();
  for (const building of buildings) {
    if (!demolishBuilding(state, building)) continue;
    changedFactions.set(building.faction, !!changedFactions.get(building.faction) || building.capacity > 0 && !building.construction);
    count++;
  }
  for (const [owner, housingRemoved] of changedFactions) refreshAfterBuildingRemoval(state, owner, housingRemoved);
  const skipped = buildings.length - count;
  const message = count ? `Demolished ${count} building${count === 1 ? '' : 's'}.${skipped ? ` Kept ${skipped} occupied crossing${skipped === 1 ? '' : 's'}.` : ''}`
    : skipped ? 'The occupied crossing has no safe exit.' : 'No owned buildings or buildings within your borders in this area.';
  return { ok: count > 0, count, refund: 0, skipped, message };
}

/** Remove the selected ditch alone; its shared farm and road remain in place. */
export function demolishIrrigationAt(state: GameState, x: number, y: number, factionId = playerFaction(state)): AreaToolResult {
  if (state.gameOver || !state.factions.some(faction => faction.id === factionId)) return unavailable();
  const borders = territory(state);
  const ditch = state.buildings.find(building => building.kind === 'irrigation' && (building.faction === factionId || buildingWithinBorders(state, building, factionId, borders))
    && building.hp > 0 && building.x === Math.floor(x) && building.y === Math.floor(y));
  if (!ditch) return { ok: false, count: 0, refund: 0, skipped: 0, message: 'No friendly irrigation ditch on this tile.' };
  removeBuildings(state, new Set([ditch.id]));
  refreshAfterBuildingRemoval(state, ditch.faction);
  return { ok: true, count: 1, refund: 0, skipped: 0, message: 'Irrigation ditch demolished. No refund.' };
}
