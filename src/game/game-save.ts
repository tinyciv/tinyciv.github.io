import type { GameState, Tile } from './types';
import { worldChangesSince } from './world-revisions';
import { flushSimulationSnapshot } from './sim-handle';

/** 8: the sectioned native core (GameState.simCore) replaces settlementCore. */
export const GAME_SAVE_VERSION = 8;
const FLOAT_FIELDS = new Set(['elevation', 'moisture', 'temperature', 'rainfall', 'fertility',
  'flow', 'rockResistance', 'sediment', 'variation', 'channelWidth']);

interface TerrainChunk {
  tileSchemas: string[][];
  tileFloats: string;
  tiles: unknown[][];
}
interface GameSave {
  version: typeof GAME_SAVE_VERSION;
  terrain: TerrainChunk[];
  state: Omit<GameState, 'world'> & {
    world: Omit<GameState['world'], 'tiles'>;
  };
}
const CHUNK_SIZE = 256;

/** Terrain dominates a saved world. Store each repeated set of property names
 * once, retaining the original numeric values and any optional tile metadata. */
function encodeTerrain(source: readonly Tile[]): string {
  const tileSchemas: string[][] = [], schemaIds = new Map<string, number>(), floats: number[] = [];
  const tiles = source.map(tile => {
    const record = tile as unknown as Record<string, unknown>;
    // Match JSON object semantics: absent/undefined metadata remains absent.
    const keys = Object.keys(record).filter(key => record[key] !== undefined);
    const signature = JSON.stringify(keys);
    let schema = schemaIds.get(signature);
    if (schema === undefined) {
      schema = tileSchemas.length; tileSchemas.push(keys); schemaIds.set(signature, schema);
    }
    const values: unknown[] = [schema];
    for (const key of keys) {
      if (FLOAT_FIELDS.has(key)) floats.push(record[key] as number);
      else values.push(record[key]);
    }
    return values;
  });
  // Geology, runoff and climate add many precise doubles. Preserve every bit
  // without repeating their much longer decimal spellings in each tile row.
  const bytes = new Uint8Array(floats.length * 8), view = new DataView(bytes.buffer);
  floats.forEach((value, index) => view.setFloat64(index * 8, value, true));
  let binary = '';
  for (let start = 0; start < bytes.length; start += 16384) binary += String.fromCharCode(...bytes.subarray(start, start + 16384));
  return JSON.stringify({ tileSchemas, tileFloats: btoa(binary), tiles } satisfies TerrainChunk);
}

function assembleSave(state: GameState, chunks: readonly string[], paused = state.paused): string {
  const { tiles: _tiles, ...world } = state.world;
  // The native snapshot (clock, RNG, settlements) is taken at the same
  // instant as the dynamic state, preserving the async save's ordering guarantee.
  const simCore = flushSimulationSnapshot(state, paused);
  const { shellImpacts: _shellImpacts, gunSmoke: _gunSmoke, ...dynamicState } = state;
  const dynamic = JSON.stringify({ ...dynamicState, paused, world, simCore });
  return `{"version":${GAME_SAVE_VERSION},"terrain":[${chunks.join(',')}],"state":${dynamic}}`;
}

export function serializeGameSave(state: GameState, paused = state.paused): string {
  const chunks: string[] = [];
  for (let start = 0; start < state.world.tiles.length; start += CHUNK_SIZE)
    chunks.push(encodeTerrain(state.world.tiles.slice(start, start + CHUNK_SIZE)));
  return assembleSave(state, chunks, paused);
}

interface TerrainCache { tiles: Tile[]; revision: number; chunks: string[] }
const terrainCaches = new WeakMap<GameState['world'], TerrainCache>();
const yieldToBrowser = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** Encode terrain in short tasks so autosave never serializes the entire map
 * inside one animation frame. The journal catches edits made while yielding;
 * dynamic entities are captured only once terrain matches that same instant.
 * Manual saves refresh all chunks to include unversioned editor metadata. */
export async function serializeGameSaveAsync(state: GameState, options: {
  incremental?: boolean; paused?: boolean; yieldTask?: () => Promise<void>;
} = {}): Promise<string> {
  const world = state.world, tiles = world.tiles, previous = terrainCaches.get(world);
  const cached = previous?.tiles === tiles && options.incremental ? previous : undefined;
  let changes = worldChangesSince(world, cached?.revision);
  const chunks = cached ? cached.chunks.slice() : new Array<string>(Math.ceil(tiles.length / CHUNK_SIZE));
  const dirtyChunks = (full: boolean, cells: readonly number[]) => full
    ? Array.from({ length: chunks.length }, (_, index) => index)
    : [...new Set(cells.map(cell => Math.floor(cell / CHUNK_SIZE)))];
  let dirty = dirtyChunks(changes.full, changes.cells);
  let revision = changes.revision;
  const yieldTask = options.yieldTask ?? yieldToBrowser;
  let taskStarted = performance.now();
  while (true) {
    for (const index of dirty) {
      const start = index * CHUNK_SIZE;
      chunks[index] = encodeTerrain(tiles.slice(start, start + CHUNK_SIZE));
      if (performance.now() - taskStarted >= 3) { await yieldTask(); taskStarted = performance.now(); }
    }
    if (state.world !== world || world.tiles !== tiles) throw new Error('World terrain replaced during save.');
    changes = worldChangesSince(world, revision);
    if (!changes.full && !changes.cells.length) break;
    dirty = dirtyChunks(changes.full, changes.cells); revision = changes.revision;
  }
  terrainCaches.set(world, { tiles, revision, chunks });
  return assembleSave(state, chunks, options.paused);
}

/** Restore ordinary mutable tile objects for the simulation and renderer. */
export function parseGameSave(serialized: string): GameState {
  let saved: GameSave;
  try { saved = JSON.parse(serialized) as GameSave; }
  catch (cause) { throw new Error('This save is damaged or is not a game save. Choose another save.', { cause }); }
  if (!saved || typeof saved !== 'object' || !Number.isInteger(saved.version)) throw new Error('This file is not a game save. Choose another save.');
  if (saved.version !== GAME_SAVE_VERSION)
    throw new Error('This save uses an incompatible game version. Choose another save or start a new game.');
  try {
    if (!Array.isArray(saved.terrain) || !saved.state?.world) throw new Error('Missing terrain or world data.');
    const tiles: Tile[] = [];
    for (const chunk of saved.terrain) tiles.push(...decodeTerrain(chunk));
    if (tiles.length !== saved.state.world.width * saved.state.world.height) throw new Error('Invalid terrain size in game save.');
    return { ...saved.state, world: { ...saved.state.world, tiles } };
  } catch (cause) { throw new Error('This save is damaged or incomplete. Choose another save.', { cause }); }
}

function decodeTerrain(saved: TerrainChunk): Tile[] {
  if (!Array.isArray(saved.tileSchemas) || typeof saved.tileFloats !== 'string' || !Array.isArray(saved.tiles))
    throw new Error('Invalid terrain chunk in game save.');
  const bytes = Uint8Array.from(atob(saved.tileFloats), character => character.charCodeAt(0));
  if (bytes.length % 8) throw new Error('Invalid terrain numbers in game save.');
  const numbers = new DataView(bytes.buffer); let cursor = 0;
  const tiles = saved.tiles.map(row => {
    const schema = Array.isArray(row) && typeof row[0] === 'number' ? saved.tileSchemas[row[0]] : undefined;
    if (!schema || schema.some(key => typeof key !== 'string') || schema.filter(key => !FLOAT_FIELDS.has(key)).length !== row.length - 1)
      throw new Error('Invalid terrain data in game save.');
    let index = 1;
    return Object.fromEntries(schema.map(key => {
      if (!FLOAT_FIELDS.has(key)) return [key, row[index++]];
      if (cursor + 8 > bytes.length) throw new Error('Missing terrain numbers in game save.');
      const value = numbers.getFloat64(cursor, true); cursor += 8; return [key, value];
    })) as unknown as Tile;
  });
  if (cursor !== bytes.length) throw new Error('Unused terrain numbers in game save.');
  return tiles;
}
