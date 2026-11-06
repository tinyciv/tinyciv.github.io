import type { GameState, Tile } from './types';

export const GAME_SAVE_VERSION = 5;
const FLOAT_FIELDS = new Set(['elevation', 'moisture', 'temperature', 'rainfall', 'fertility',
  'flow', 'rockResistance', 'sediment', 'variation', 'channelWidth']);

interface GameSave {
  version: typeof GAME_SAVE_VERSION;
  tileSchemas: string[][];
  tileFloats: string;
  state: Omit<GameState, 'world'> & {
    world: Omit<GameState['world'], 'tiles'> & { tiles: unknown[][] };
  };
}

/** Terrain dominates a saved world. Store each repeated set of property names
 * once, retaining the original numeric values and any optional tile metadata. */
export function serializeGameSave(state: GameState): string {
  const tileSchemas: string[][] = [], schemaIds = new Map<string, number>(), floats: number[] = [];
  const tiles = state.world.tiles.map(tile => {
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
  const saved: GameSave = { version: GAME_SAVE_VERSION, tileSchemas, tileFloats: btoa(binary),
    state: { ...state, world: { ...state.world, tiles } } };
  return JSON.stringify(saved);
}

/** Restore ordinary mutable tile objects for the simulation and renderer. */
export function parseGameSave(serialized: string): GameState {
  const saved = JSON.parse(serialized) as GameSave;
  if (saved.version !== GAME_SAVE_VERSION || !Array.isArray(saved.tileSchemas) || typeof saved.tileFloats !== 'string'
    || !Array.isArray(saved.state?.world?.tiles))
    throw new Error('Unsupported game save.');
  const bytes = Uint8Array.from(atob(saved.tileFloats), character => character.charCodeAt(0));
  if (bytes.length % 8) throw new Error('Invalid terrain numbers in game save.');
  const numbers = new DataView(bytes.buffer); let cursor = 0;
  const tiles = saved.state.world.tiles.map(row => {
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
  return { ...saved.state, world: { ...saved.state.world, tiles } };
}
