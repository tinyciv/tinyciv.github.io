import { insideOwnBorders, territory } from './borders';
import { entityStore } from './entity-store';
import { unitInSight, updateFog } from './fog';
import { WILDLIFE_FACTION } from './hunting';
import { buildingBlockerView, canMove, scenarioAccessTerrain, withNavigationFrame } from './pathfinding';
import { playerFaction } from './player-context';
import { reliefBuildable } from './relief';
import { rustEngine } from './rust-engine';
import { SimSlot, simCore } from './sim-handle';
import { indexedLeader, refreshIndexedUnit } from './spatial';
import { WATER, buildingHeight, buildingWidth, type GameState, type Point, type Unit, type World } from './types';
import { worldRevisions, worldStructureRevision } from './world-revisions';
import { seededRandom } from '../world/generator';

const SPECIES = ['cow', 'sheep', 'horse'] as const;
export type LivestockKind = typeof SPECIES[number];
export const LIVESTOCK_NAMES: Record<LivestockKind, string> = { cow: 'Cattle', sheep: 'Sheep', horse: 'Horses' };
export const LIVESTOCK_RANGE = 3;
export function isLivestock(unit: Pick<Unit, 'kind'>): unit is Pick<Unit, 'kind'> & { kind: LivestockKind } {
  return unit.kind === 'cow' || unit.kind === 'sheep' || unit.kind === 'horse';
}

export interface Pasture { faction: number; x: number; y: number; width: number; height: number }
export interface LivestockHerd {
  id: number;
  species: LivestockKind;
  animals: number[];
  center: Point;
  nextMoveAt: number;
  wander?: { animal: number; dx: number; dy: number; remaining: number };
  pasture?: Pasture;
}
export interface LivestockState { revision: number; herds: LivestockHerd[] }

const terrainCache = new SimSlot<{ world: World; sight: number }>();
const accessCache = new WeakMap<LivestockState, { revision: number; masks: Map<number, number> }>();
const wanderTopology = new WeakMap<LivestockHerd, { structure: number; sight: number }>();

export function livestockHerd(state: GameState, id: number | undefined): LivestockHerd | undefined {
  return id === undefined ? undefined : state.livestock?.herds[id];
}

export function hasLivestock(state: GameState, faction: number, kind: LivestockKind): boolean {
  const livestock = state.livestock;
  if (!livestock) return false;
  let index = accessCache.get(livestock);
  if (index?.revision !== livestock.revision) {
    const masks = new Map<number, number>();
    for (const herd of livestock.herds) if (herd.pasture && herd.animals.length) {
      const owner = herd.pasture.faction;
      masks.set(owner, (masks.get(owner) ?? 0) | 1 << SPECIES.indexOf(herd.species));
    }
    accessCache.set(livestock, index = { revision: livestock.revision, masks });
  }
  return !!((index.masks.get(faction) ?? 0) & 1 << SPECIES.indexOf(kind));
}

function members(state: GameState, herd: LivestockHerd): Unit[] {
  const units = entityStore(state).units;
  return herd.animals.flatMap(id => {
    const animal = units.get(id);
    return animal && animal.hp > 0 ? [animal] : [];
  });
}

export function livestockApproached(leader: Point, animal: Point): boolean {
  return (leader.x - animal.x) ** 2 + (leader.y - animal.y) ** 2 <= LIVESTOCK_RANGE ** 2;
}

export function livestockInReach(state: GameState, herd: LivestockHerd, faction = playerFaction(state)): boolean {
  const leader = indexedLeader(state, faction);
  if (!leader || leader.hp <= 0 || leader.inside || leader.embarkedOn !== undefined) return false;
  const fog = updateFog(state, faction);
  return members(state, herd).some(animal => livestockApproached(leader, animal) && unitInSight(fog, animal));
}

function prepareTerrain(state: GameState): void {
  const { world } = state, { sight } = worldRevisions(world), old = terrainCache.get(state);
  if (old?.world === world && old.sight === sight) return;
  const { open, edges } = scenarioAccessTerrain(world);
  const handle = simCore(state).handle;
  const pointer = rustEngine.sim_livestock_terrain_input(handle, world.width, world.height);
  const input = new Uint8Array(rustEngine.memory.buffer, pointer, world.tiles.length * 2);
  for (let cell = 0; cell < world.tiles.length; cell++) {
    const tile = world.tiles[cell], dry = !!open[cell] && !WATER.has(tile.terrain) && !tile.creek;
    const meadow = dry && tile.overlay === 'none' && !tile.marsh && !tile.beach && !tile.resource;
    input[cell * 2] = Number(dry) | Number(meadow && tile.terrain === 'grassland') << 1
      | Number(meadow && tile.terrain === 'plains') << 2
      | Number(dry && !tile.resource && !tile.marsh && tile.rockHost === undefined && reliefBuildable(tile)) << 3;
    input[cell * 2 + 1] = edges[cell];
  }
  rustEngine.sim_livestock_terrain_finish(handle);
  terrainCache.set(state, { world, sight });
}

function randomSeed(state: GameState, event: string): number {
  return Math.floor(seededRandom(`${state.world.seed}:livestock:${event}`)() * 0x100000000);
}

export function initializeLivestock(state: GameState): void {
  if (state.livestock) return;
  state.livestock = { revision: 0, herds: [] };
  prepareTerrain(state);
  const { width, height, tiles, spawns } = state.world, handle = simCore(state).handle;
  const startPointer = rustEngine.sim_livestock_start_input(handle, spawns.length);
  const starts = new Float64Array(rustEngine.memory.buffer, startPointer, spawns.length * 2);
  spawns.forEach((point, i) => { starts[i * 2] = point.x; starts[i * 2 + 1] = point.y; });
  const maskPointer = rustEngine.sim_livestock_spawn_input(handle, tiles.length);
  const excluded = new Uint8Array(rustEngine.memory.buffer, maskPointer, tiles.length);
  for (let cell = 0; cell < tiles.length; cell++) excluded[cell] = Number(tiles[cell].farm !== undefined);
  for (const building of state.buildings) if (building.hp > 0) {
    const left = Math.max(0, building.x - 2), right = Math.min(width, building.x + buildingWidth(building) + 2);
    for (let y = Math.max(0, building.y - 2); y < Math.min(height, building.y + buildingHeight(building) + 2); y++)
      excluded.fill(1, y * width + left, y * width + right);
  }
  for (const unit of state.units) if (unit.hp > 0 && !unit.inside && unit.x >= 0 && unit.y >= 0 && unit.x < width && unit.y < height)
    excluded[Math.floor(unit.y) * width + Math.floor(unit.x)] = 1;
  const output = rustEngine.sim_livestock_spawn(handle, randomSeed(state, 'spawn'));
  const count = new Float64Array(rustEngine.memory.buffer, output, 1)[0];
  const rows = new Float64Array(rustEngine.memory.buffer, output + 8, count * 4).slice();
  const store = entityStore(state);
  for (let i = 0; i < rows.length; i += 4) {
    const [id, species, cell, facing] = rows.subarray(i, i + 4);
    const x = cell % width + .5, y = Math.floor(cell / width) + .5;
    const herd = state.livestock.herds[id] ??= { id, species: SPECIES[species], animals: [],
      center: { x: 0, y: 0 }, nextMoveAt: state.time + 4 + id % 7 };
    const hp = rustEngine.livestock_stat(species, 3), animalId = store.allocateId();
    herd.animals.push(animalId);
    herd.center.x += x;
    herd.center.y += y;
    store.units.add({ id: animalId, livestockHerd: id, kind: herd.species, faction: WILDLIFE_FACTION,
      x, y, hp, maxHp: hp, attack: 0, defense: 0, morale: 100, speed: rustEngine.livestock_stat(species, 0),
      range: 0, order: 'wander', cooldown: 0, lastCombat: -60, moving: false, facing, attackTime: 0, bornAt: state.time });
  }
  for (const herd of state.livestock.herds) {
    herd.center.x /= herd.animals.length;
    herd.center.y /= herd.animals.length;
  }
}

function observeMembers(state: GameState, animals: readonly Unit[], owner?: number): number {
  const borders = owner === undefined ? undefined : territory(state);
  const handle = simCore(state).handle;
  const pointer = rustEngine.sim_livestock_herd_input(handle, animals.length);
  const input = new Float64Array(rustEngine.memory.buffer, pointer, animals.length * 3);
  for (let i = 0; i < animals.length; i++) {
    const { x, y } = animals[i];
    input[i * 3] = x; input[i * 3 + 1] = y;
    input[i * 3 + 2] = Number(owner !== undefined && insideOwnBorders(state, owner, x, y, borders));
  }
  return handle;
}

export function planLivestock(state: GameState): void {
  const livestock = state.livestock;
  if (!livestock) return;
  withNavigationFrame(state, () => {
    for (const herd of livestock.herds) {
      if (herd.wander || state.time < herd.nextMoveAt || !herd.animals.length) continue;
      const animals = members(state, herd);
      if (animals.length !== herd.animals.length) {
        herd.animals = animals.map(animal => animal.id);
        livestock.revision++;
      }
      if (!animals.length) continue;
      if (!terrainCache.get(state)) prepareTerrain(state);
      const handle = observeMembers(state, animals), pen = herd.pasture;
      const output = rustEngine.sim_livestock_goals(handle, randomSeed(state, `${herd.id}:${herd.nextMoveAt}`),
        herd.center.x, herd.center.y, pen?.x ?? 0, pen?.y ?? 0, pen?.width ?? 0, pen?.height ?? 0);
      const [count, rest] = new Float64Array(rustEngine.memory.buffer, output, 2);
      const options = new Float64Array(rustEngine.memory.buffer, output + 16, count * 3).slice();
      const blockers = buildingBlockerView(state, WILDLIFE_FACTION);
      herd.nextMoveAt = state.time + rest;
      for (let i = 0; i < options.length; i += 3) {
        const animal = animals[options[i]], dx = options[i + 1], dy = options[i + 2];
        if (!canMove(state, animal, { x: animal.x + dx, y: animal.y + dy }, WILDLIFE_FACTION, blockers)) continue;
        herd.wander = { animal: animal.id, dx, dy, remaining: 1 };
        wanderTopology.set(herd, { sight: worldRevisions(state.world).sight, structure: worldStructureRevision(state.world) });
        break;
      }
    }
  });
}

/** Advance the currently grazing animal without moving its herd's home. */
export function advanceLivestock(state: GameState, elapsed: number): void {
  const herds = state.livestock?.herds;
  if (!herds?.some(herd => herd.wander)) return;
  const { sight } = worldRevisions(state.world), structure = worldStructureRevision(state.world);
  const units = entityStore(state).units;
  for (const herd of herds) {
    const wander = herd.wander;
    if (!wander) continue;
    const animal = units.get(wander.animal);
    if (!animal || animal.hp <= 0) { delete herd.wander; continue; }
    const topology = wanderTopology.get(herd);
    if (topology?.sight !== sight || topology.structure !== structure) {
      const goal = { x: animal.x + wander.dx * wander.remaining, y: animal.y + wander.dy * wander.remaining };
      if (!canMove(state, animal, goal, WILDLIFE_FACTION)) {
        delete herd.wander;
        animal.moving = false;
        continue;
      }
      wanderTopology.set(herd, { sight, structure });
    }
    const step = rustEngine.livestock_step(SPECIES.indexOf(herd.species), wander.remaining, elapsed);
    wander.remaining -= step;
    animal.x += wander.dx * step;
    animal.y += wander.dy * step;
    animal.facing = Math.atan2(wander.dy, wander.dx);
    animal.moving = wander.remaining > 1e-6;
    if (step > 0) refreshIndexedUnit(state, animal);
    if (!animal.moving) delete herd.wander;
  }
}

const failure = (message: string) => ({ ok: false as const, message });
const fenceResearchMessages = ['', 'Requires Animal Husbandry.', 'Requires Horseback Riding.'] as const;
type FenceStatus = { ok: true; pasture: Pasture } | ReturnType<typeof failure>;
export function livestockFenceStatus(state: GameState, id: number, faction = playerFaction(state)): FenceStatus {
  const herd = livestockHerd(state, id);
  const owner = state.factions.find(item => item.id === faction && !item.defeated);
  if (!herd || !owner || state.gameOver || herd.pasture) return failure('Herd unavailable.');
  const leader = indexedLeader(state, faction);
  if (!leader || !livestockInReach(state, herd, faction)) return failure('Approach the herd.');
  const levels = owner.research?.levels;
  const missingResearch = rustEngine.livestock_missing_fence_research(SPECIES.indexOf(herd.species),
    levels?.animalHusbandry ?? 0, levels?.horsebackRiding ?? 0);
  if (missingResearch) return failure(fenceResearchMessages[missingResearch]);
  prepareTerrain(state);
  const handle = observeMembers(state, members(state, herd), faction);
  const result = rustEngine.sim_livestock_fence_plan(handle, leader.x, leader.y);
  const [status, x, y, width, height] = new Float64Array(rustEngine.memory.buffer, result, 5);
  if (status === 2) return failure('Approach the herd.');
  if (status === 3) return failure('An animal must be within your borders.');
  if (status !== 1) return failure('The herd needs room for a two-tile buffer.');
  const blockers = buildingBlockerView(state, faction);
  const pointer = rustEngine.sim_livestock_fence_input(handle, width * height);
  const blocked = new Uint8Array(rustEngine.memory.buffer, pointer, width * height);
  const otherPastures = state.livestock!.herds.flatMap(candidate => candidate.pasture ? [candidate.pasture] : []);
  if (otherPastures.some(pen => x < pen.x + pen.width && pen.x < x + width && y < pen.y + pen.height && pen.y < y + height))
    return failure('Pastures need separate ground.');
  for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) {
    const cell = (y + dy) * state.world.width + x + dx;
    blocked[dy * width + dx] = Number(blockers.has(cell));
  }
  if (!rustEngine.sim_livestock_fence_finish(handle)) return failure('Buildings obstruct the pasture.');
  return { ok: true, pasture: { faction, x, y, width, height } };
}

export function fenceLivestockHerd(state: GameState, id: number, faction = playerFaction(state)) {
  const status = livestockFenceStatus(state, id, faction);
  if (!status.ok) return status;
  const herd = livestockHerd(state, id)!;
  herd.pasture = status.pasture;
  delete herd.wander;
  for (const animal of members(state, herd)) animal.moving = false;
  state.livestock!.revision++;
  return { ok: true, message: 'Pasture fenced.' };
}

export function pastureYield(herd: LivestockHerd): { food: number; gold: number } {
  const species = SPECIES.indexOf(herd.species);
  return { food: herd.animals.length * rustEngine.livestock_stat(species, 1),
    gold: herd.animals.length * rustEngine.livestock_stat(species, 2) };
}

export function livestockIncome(state: GameState): ReadonlyMap<number, { food: number; gold: number }> {
  const result = new Map<number, { food: number; gold: number }>();
  for (const herd of state.livestock?.herds ?? []) if (herd.pasture) {
    const value = pastureYield(herd);
    const sum = result.get(herd.pasture.faction) ?? { food: 0, gold: 0 };
    sum.food += value.food; sum.gold += value.gold;
    result.set(herd.pasture.faction, sum);
  }
  return result;
}
