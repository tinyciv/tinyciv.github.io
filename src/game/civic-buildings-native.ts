import { rustEngine } from './rust-engine';
import { simCore } from './sim-handle';
import { entityStore, UNIT_KIND_CODES } from './entity-store';
import { structureIndex, structuresOf, STRUCTURE_ALIVE } from './structure-index';
import { markWorldChanged } from './world-revisions';
import { grantIncome } from './resource-income';
import { reliefFootprintAllowed } from './relief';
import { buildingWidth, buildingHeight, unitMaxHp, WATER, type BuildingKind, type GameState, type Point } from './types';

const CODES = { hospital: 38, apartments: 39, factory: 40, goldMine: 41 } as const;
export type CivicBuildingKind = keyof typeof CODES;
export const civicBuildingProperty = (kind: CivicBuildingKind, property: number): number => rustEngine.civic_building_constant(CODES[kind], property);
export const COAL_FACTORY_GOLD_BONUS = civicBuildingProperty('factory', 4);
export const isCivicBuilding = (kind: BuildingKind): kind is CivicBuildingKind => kind in CODES;
const UNIT_STRIDE = 9;

/** Transport for one native 1 Hz pass. Site membership, spatial hospital
 * lookups, biological eligibility and capture decisions live in Rust. */
export function updateCivicBuildings(state: GameState, elapsed: number): void {
  const store = entityStore(state), index = structureIndex(state), handle = simCore(state).handle;
  const mines = index.query(undefined, STRUCTURE_ALIVE, ['goldMine']);
  for (const mine of mines) rustEngine.sim_civic_mine_progress(handle, mine.id, mine.mineCaptureFaction ?? -1, mine.mineCaptureProgress ?? 0);
  const units = [...new Set([...store.units.query('soldier'), ...store.units.query('leader'), ...store.units.query('wounded')])];
  const pointer = rustEngine.sim_civic_prepare(handle, units.length * UNIT_STRIDE);
  const input = new Float64Array(rustEngine.memory.buffer, pointer, units.length * UNIT_STRIDE);
  for (let row = 0; row < units.length; row++) {
    const unit = units[row], offset = row * UNIT_STRIDE;
    input[offset] = unit.id; input[offset + 1] = unit.faction; input[offset + 2] = unit.x; input[offset + 3] = unit.y;
    input[offset + 4] = unit.hp; input[offset + 5] = unitMaxHp(unit); input[offset + 6] = unit.lastDamagedAt ?? 0;
    input[offset + 7] = Number(!unit.inside && unit.embarkedOn === undefined && !unit.aboardRowboat);
    input[offset + 8] = UNIT_KIND_CODES[unit.kind];
  }
  publish(state, rustEngine.sim_civic_step(handle, units.length, state.time, elapsed));
}

function publish(state: GameState, pointer: number): void {
  const count = new Float64Array(rustEngine.memory.buffer, pointer, 1)[0];
  // Applying role and structure changes can grow native memory.
  const values = new Float64Array(rustEngine.memory.buffer, pointer + 8, count * 4).slice();
  const store = entityStore(state);
  for (let row = 0; row < count; row++) {
    const [kind, id, value, extra] = values.subarray(row * 4, row * 4 + 4);
    if (kind === 0) {
      const unit = store.units.get(id); if (!unit) continue;
      unit.hp = value; unit.healerHealingAt = state.time; store.units.updateRoles(unit, false);
    } else if (kind === 1) {
      const mine = store.buildings.get(id); if (!mine) continue;
      if (mine.faction !== value) {
        mine.faction = value; store.buildings.updateRoles(mine);
        markWorldChanged(state.world, 'structure', [mine.y * state.world.width + mine.x]);
      }
      mine.mineCaptureProgress = extra;
    } else if (kind === 2) {
      const mine = store.buildings.get(id); if (mine) { mine.mineCaptureFaction = value; mine.mineContested = !!extra; }
    } else if (kind === 3) {
      const faction = state.factions.find(owner => owner.id === id);
      if (faction && !faction.defeated && faction.relation !== 'confederated') grantIncome(faction, { gold: value }, state, 'controlMines');
    }
  }
}

export function payGoldMineDividends(state: GameState): void {
  structureIndex(state);
  publish(state, rustEngine.sim_civic_dividends(simCore(state).handle));
}

/** Read the generated terrain once. Rust chooses spaced control points,
 * favoring the world's existing gold deposits and preserving city layouts. */
export function initializeGoldMines(state: GameState, makeMine: (point: Point) => void): void {
  if (structuresOf(state, undefined, STRUCTURE_ALIVE, 'goldMine').length) return;
  const { world } = state, blocked = new Uint8Array(world.width * world.height);
  for (const building of state.buildings) for (let dy = -1; dy <= buildingHeight(building); dy++) for (let dx = -1; dx <= buildingWidth(building); dx++) {
    const x = building.x + dx, y = building.y + dy;
    if (x >= 0 && y >= 0 && x < world.width && y < world.height) blocked[y * world.width + x] = 1;
  }
  for (const spawn of world.spawns) for (let y = Math.max(0, spawn.y - 16); y <= Math.min(world.height - 1, spawn.y + 16); y++)
    for (let x = Math.max(0, spawn.x - 16); x <= Math.min(world.width - 1, spawn.x + 16); x++) blocked[y * world.width + x] = 1;
  for (const point of [...state.explorationSites ?? [], ...state.treasures ?? [], ...state.hermits ?? []]) {
    const px = Math.floor(point.x), py = Math.floor(point.y);
    for (let y = Math.max(0,py-2); y <= Math.min(world.height-1,py+2); y++) for (let x = Math.max(0,px-2); x <= Math.min(world.width-1,px+2); x++) blocked[y*world.width+x]=1;
  }
  const values = new Float64Array(world.tiles.length);
  for (let cell = 0; cell < values.length; cell++) {
    const tile = world.tiles[cell];
    values[cell] = tile.resource === 'gold' ? 2 : 0;
    if (blocked[cell] || WATER.has(tile.terrain) || tile.geothermal || tile.overlay === 'volcano' || tile.overlay === 'glacier'
      || !reliefFootprintAllowed(world, cell % world.width, Math.floor(cell / world.width))) continue;
    values[cell] |= 1;
  }
  const handle = simCore(state).handle, pointer = rustEngine.sim_civic_prepare(handle, values.length);
  new Float64Array(rustEngine.memory.buffer, pointer, values.length).set(values);
  const outputPointer = rustEngine.sim_civic_generate(handle, world.width, world.height, state.rngState);
  const count = new Float64Array(rustEngine.memory.buffer, outputPointer, 1)[0];
  const sites = new Float64Array(rustEngine.memory.buffer, outputPointer + 8, count * 2).slice();
  for (let row = 0; row < count; row++) makeMine({ x: sites[row * 2], y: sites[row * 2 + 1] });
}
