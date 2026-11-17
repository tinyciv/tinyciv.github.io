import { entityStore } from '../../src/game/entity-store';
import { setHostWallClock } from '../../src/game/leader-respawn';
import { markWorldChanged } from '../../src/game/world-revisions';
import { patchSimulationClock, seedSimulationRandom } from '../../src/game/sim-handle';
import type { Building, Faction, GameState, Tile, Unit } from '../../src/game/types';

/** The one sanctioned way for tests to seed and patch simulation state.
 *
 * Migration contract (rust/MIGRATION.md, Invariants): tests mutate state only
 * through these helpers or through real game commands. Today each helper
 * edits the TypeScript GameState through the entity store, exactly as the
 * existing tests do by hand. As fields become Rust-owned (registered in
 * src/game/native-owned-fields.ts), the step that moves them reroutes the
 * matching helper to a native seed/patch command and the outbox mirror, so
 * tests written against this API keep working unchanged. Patches are test and
 * editor only; gameplay never calls them. */

export type UnitPatch = Partial<Omit<Unit, 'id'>>;
export type BuildingPatch = Partial<Omit<Building, 'id'>>;
export type FactionPatch = Partial<Omit<Faction, 'id'>>;
export type StatePatch = Partial<Omit<GameState, 'world' | 'units' | 'buildings' | 'factions'>>;
export type TilePatch = Partial<Tile>;

export interface NativeFixture {
  readonly state: GameState;
  /** Insert new entities in array order; IDs must be unused. */
  seedUnits(units: readonly Unit[]): readonly Unit[];
  seedBuildings(buildings: readonly Building[]): readonly Building[];
  patchUnit(id: number, patch: UnitPatch): Unit;
  patchBuilding(id: number, patch: BuildingPatch): Building;
  patchFaction(id: number, patch: FactionPatch): Faction;
  patchState(patch: StatePatch): GameState;
  patchTile(x: number, y: number, patch: TilePatch): Tile;
  /** Host wall clock in milliseconds for the real-time Leader respawn. */
  setWallClock(now: number): void;
  /** Restart the native random stream (rngState is its read-only mirror). */
  seedRandom(seed: number): void;
  /** Set native simulated time and the economy tick (time/tick are mirrors). */
  setClock(time: number, tick?: number): void;
}

function require<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`native fixture: ${what} does not exist`);
  return value;
}

/** Wrap an existing state (createGame, createDuelGame, a hand-built scene). */
export function nativeFixture(state: GameState): NativeFixture {
  const store = () => entityStore(state);
  return {
    state,
    seedUnits(units) {
      for (const unit of units) store().units.add(unit);
      return units;
    },
    seedBuildings(buildings) {
      for (const building of buildings) store().buildings.add(building);
      return buildings;
    },
    patchUnit(id, patch) {
      const unit = require(state.units.find(candidate => candidate.id === id), `unit ${id}`);
      Object.assign(unit, patch);
      store().units.updateRoles(unit);
      return unit;
    },
    patchBuilding(id, patch) {
      const building = require(state.buildings.find(candidate => candidate.id === id), `building ${id}`);
      Object.assign(building, patch);
      store().buildings.updateRoles(building);
      return building;
    },
    patchFaction(id, patch) {
      return Object.assign(require(state.factions.find(candidate => candidate.id === id), `faction ${id}`), patch);
    },
    patchState(patch) { return Object.assign(state, patch); },
    patchTile(x, y, patch) {
      const { width, height } = state.world;
      if (x < 0 || y < 0 || x >= width || y >= height) throw new Error(`native fixture: tile ${x},${y} is outside the world`);
      const tile = state.world.tiles[y * width + x];
      Object.assign(tile, patch);
      // Conservative geometry edit for this cell (terrain, sight and art).
      markWorldChanged(state.world, 'geometry', [y * width + x]);
      return tile;
    },
    setWallClock(now) { setHostWallClock(state, now); },
    seedRandom(seed) { seedSimulationRandom(state, seed); },
    setClock(time, tick) { patchSimulationClock(state, time, tick); },
  };
}
