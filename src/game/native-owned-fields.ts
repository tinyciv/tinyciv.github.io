import type { Building, Faction, GameState, Tile, Unit } from './types';

/** Fields whose authority has moved into the Rust simulation World.
 *
 * TypeScript keeps these as read-only mirrors that the bridge applies from
 * native outbox rows. tests/native-field-ownership.test.ts scans src/ and
 * server/ and fails on any write to a registered field outside
 * NATIVE_FIELD_BRIDGE_ALLOWLIST. Each migration step registers the fields it
 * makes Rust-owned in the same change that deletes their TypeScript rules.
 *
 * Field names are typed against the real interfaces, so a rename breaks tsc. */
export interface NativeOwnedFieldRegistry {
  Unit: readonly (keyof Unit & string)[];
  Building: readonly (keyof Building & string)[];
  Faction: readonly (keyof Faction & string)[];
  GameState: readonly (keyof GameState & string)[];
  Tile: readonly (keyof Tile & string)[];
}

export const NATIVE_OWNED_FIELDS: NativeOwnedFieldRegistry = {
  Unit: [],
  Building: [],
  Faction: [],
  // Step 02: the random stream and the native snapshot live in the sim core.
  GameState: ['rngState', 'simCore'],
  Tile: [],
};

/** Repository-relative files (posix separators) allowed to write native-owned
 * fields: the outbox mirror applier and fixture/editor bridges. */
export const NATIVE_FIELD_BRIDGE_ALLOWLIST: readonly string[] = ['src/game/sim-handle.ts'];
