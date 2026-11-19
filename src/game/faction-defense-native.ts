import { rustEngine } from './rust-engine';
import { SimSlot, simCore } from './sim-handle';
import { entityStore, BUILDING_KIND_CODES, type EntityStore, type EntityObserver } from './entity-store';
import { observeScalars, type ScalarObserver } from './scalar-observer';
import { scenarioAccessTerrain } from './pathfinding';
import { reliefFootprintAllowed } from './relief';
import { worldRevisions } from './world-revisions';
import { resourceBlocksGround } from './resource-terrain';
import { buildingReady, WATER, type Building, type GameState, type Point } from './types';

const bridges = new SimSlot<DefenseBridge>();
class DefenseBridge implements ScalarObserver {
  readonly handle: number;
  readonly store: EntityStore;
  private world?: GameState['world'];
  private terrain = -1;
  private dirty = new Set<Building>();
  private readonly observer: EntityObserver<Building>;
  constructor(state: GameState) {
    this.handle = simCore(state).handle; this.store = entityStore(state);
    rustEngine.sim_defense_reset(this.handle);
    this.observer = { added: b => this.track(b), changed: b => this.track(b), removed: b => this.dirty.add(b) };
    this.store.buildings.observe(this.observer);
    for (const b of state.buildings) this.track(b);
  }
  private track(b: Building): void {
    this.dirty.add(b);
    observeScalars(b, ['kind', 'faction', 'x', 'y', 'hp', 'construction', 'depopulated'], this);
  }
  changed(target: object, key: string, before: unknown, after: unknown): void {
    if (key !== 'hp' || (Number(before) > 0) !== (Number(after) > 0)) this.dirty.add(target as Building);
  }
  flush(state: GameState): this {
    // Tower placement consumes passability/relief, never road wear or crop
    // appearance. Explicit world geometry changes invalidate the native layer.
    const geometry = worldRevisions(state.world).geometry;
    if (this.world !== state.world || geometry !== this.terrain) {
      const terrain = scenarioAccessTerrain(state.world), length = terrain.open.length;
      const pointer = rustEngine.sim_defense_input(this.handle, length * 2);
      const input = new Float64Array(rustEngine.memory.buffer, pointer, length * 2);
      for (let i = 0; i < length; i++) {
        const tile = state.world.tiles[i];
        const x = i % state.world.width, y = Math.floor(i / state.world.width);
        const dry = !tile.marsh && !WATER.has(tile.terrain) && reliefFootprintAllowed(state.world, x, y);
        input[i * 2] = terrain.open[i] | terrain.bridgeGround[i] << 1
          | Number(dry) << 2 | Number(dry && !tile.creek && !tile.stair && !resourceBlocksGround(tile, false, i, state.world.width)) << 3;
        input[i * 2 + 1] = terrain.edges[i];
      }
      rustEngine.sim_defense_geometry(this.handle, state.world.width, state.world.height);
      this.world = state.world; this.terrain = geometry;
    }
    for (const b of this.dirty) rustEngine.sim_defense_site(this.handle, b.id, Number.isFinite(b.faction) ? b.faction : -2147483648, BUILDING_KIND_CODES[b.kind], b.x, b.y,
      Number(this.store.buildings.get(b.id) === b && b.hp > 0) | Number(buildingReady(b)) << 1 | Number(!!b.depopulated) << 2);
    this.dirty.clear(); return this;
  }
  buildings(pointer: number): Building[] {
    const count = new Float64Array(rustEngine.memory.buffer, pointer, 1)[0];
    const ids = Array.from(new Float64Array(rustEngine.memory.buffer, pointer + 8, count));
    return ids.flatMap(id => { const b = this.store.buildings.get(id); return b ? [b] : []; });
  }
}
function view(state: GameState): DefenseBridge {
  let current = bridges.get(state);
  if (!current || current.store !== entityStore(state)) current = bridges.set(state, new DefenseBridge(state));
  return current;
}
function bridge(state: GameState): DefenseBridge { return view(state).flush(state); }
export function nativeDefenseDue(state: GameState, faction: number, interval: number): boolean {
  return !!rustEngine.sim_defense_due(view(state).handle, faction, state.time, interval);
}
export function nativeDefenseBuildings(state: GameState, faction: number): Building[] {
  const native = bridge(state);
  return native.buildings(rustEngine.sim_defense_owned(native.handle, faction));
}
export function nativeDefenseCity(state: GameState, faction: number): Building | undefined {
  const native = bridge(state);
  return native.store.buildings.get(rustEngine.sim_defense_city(native.handle, faction));
}
export function nativeCityTowers(state: GameState, city: Building): Building[] {
  const native = bridge(state);
  return native.buildings(rustEngine.sim_defense_towers(native.handle, city.id));
}
export function nativeDefenseSite(state: GameState, city: Building, budget: number): Point | undefined {
  const native = bridge(state);
  const pointer = rustEngine.sim_defense_next(native.handle, city.id, state.time, budget);
  const result = new Float64Array(rustEngine.memory.buffer, pointer, 4);
  return result[0] ? { x: result[1], y: result[2] } : undefined;
}
export function nativeDefenseRejected(state: GameState, city: Building): void {
  rustEngine.sim_defense_rejected(simCore(state).handle, city.id);
}

export function nativeScoutTowerSites(state: GameState, city: Building, blocked: readonly number[]): Point[] {
  const { handle } = bridge(state);
  const input = rustEngine.sim_defense_input(handle, blocked.length);
  new Float64Array(rustEngine.memory.buffer, input, blocked.length).set(blocked);
  const pointer = rustEngine.sim_scout_tower_sites(handle, city.id, blocked.length);
  const count = new Float64Array(rustEngine.memory.buffer, pointer, 1)[0];
  const cells = new Float64Array(rustEngine.memory.buffer, pointer + 8, count * 2);
  return Array.from({ length: count }, (_, i) => ({ x: cells[i * 2], y: cells[i * 2 + 1] }));
}
