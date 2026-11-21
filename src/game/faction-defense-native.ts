import { rustEngine } from './rust-engine';
import { SimSlot, simCore } from './sim-handle';
import { entityStore, BUILDING_KIND_CODES, type EntityStore, type EntityObserver } from './entity-store';
import { observeScalars, type ScalarObserver } from './scalar-observer';
import { scenarioAccessTerrain } from './pathfinding';
import { reliefFootprintAllowed } from './relief';
import { worldRevisions, worldSightChangesSince } from './world-revisions';
import { resourceBlocksGround } from './resource-terrain';
import { buildingReady, WATER, type Building, type GameState, type Point } from './types';

const defenseKinds = ['woodenTower', 'palisade', 'wall'] as const;
export type DefenseKind = typeof defenseKinds[number];
export const defenseKindMask = (kind: DefenseKind): number => 1 << defenseKinds.indexOf(kind);
export interface DefenseOrder extends Point { kind: DefenseKind }

const bridges = new SimSlot<DefenseBridge>();
class DefenseBridge implements ScalarObserver {
  readonly handle: number;
  readonly store: EntityStore;
  private world?: GameState['world'];
  private terrain = -1;
  private sight = -1;
  private terrainCursor?: number;
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
    observeScalars(b, ['kind', 'faction', 'x', 'y', 'hp', 'construction', 'depopulated', 'lastAttacked'], this);
  }
  changed(target: object, key: string, before: unknown, after: unknown): void {
    if (key !== 'hp' || (Number(before) > 0) !== (Number(after) > 0)) this.dirty.add(target as Building);
  }
  flush(state: GameState): this {
    const { world } = state, { width, height } = world, { geometry, sight } = worldRevisions(world);
    const replacement = this.world !== world || geometry !== this.terrain;
    if (replacement || sight !== this.sight) {
      const changes = worldSightChangesSince(world, replacement ? undefined : this.terrainCursor);
      const terrain = scenarioAccessTerrain(world), length = terrain.open.length;
      const sample = (i: number): number => {
        const tile = world.tiles[i], x = i % width, y = Math.floor(i / width);
        const dry = !tile.marsh && !WATER.has(tile.terrain) && reliefFootprintAllowed(world, x, y);
        return terrain.open[i] | terrain.bridgeGround[i] << 1
          | Number(dry) << 2 | Number(dry && !tile.creek && !resourceBlocksGround(tile)) << 3;
      };
      if (changes.full) {
        const pointer = rustEngine.sim_defense_input(this.handle, length * 2);
        const input = new Float64Array(rustEngine.memory.buffer, pointer, length * 2);
        for (let i = 0; i < length; i++) {
          input[i * 2] = sample(i); input[i * 2 + 1] = terrain.edges[i];
        }
        rustEngine.sim_defense_geometry(this.handle, width, height);
      } else if (changes.cells.length) {
        // Felling changes nearby diagonals as well as the edited cell.
        const cells = new Set<number>();
        for (const cell of changes.cells) {
          const x = cell % width, y = Math.floor(cell / width);
          for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++)
            for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) cells.add(ny * width + nx);
        }
        const pointer = rustEngine.sim_defense_input(this.handle, cells.size * 3);
        const input = new Float64Array(rustEngine.memory.buffer, pointer, cells.size * 3);
        let offset = 0;
        for (const cell of cells) {
          input[offset++] = cell; input[offset++] = sample(cell); input[offset++] = terrain.edges[cell];
        }
        rustEngine.sim_defense_patch(this.handle);
      }
      this.world = world; this.terrain = geometry; this.sight = sight; this.terrainCursor = changes.revision;
    }
    for (const b of this.dirty) rustEngine.sim_defense_site(this.handle, b.id, Number.isFinite(b.faction) ? b.faction : -2147483648, BUILDING_KIND_CODES[b.kind], b.x, b.y,
      Number(this.store.buildings.get(b.id) === b && b.hp > 0) | Number(buildingReady(b)) << 1 | Number(!!b.depopulated) << 2,
      b.lastAttacked ?? -Infinity);
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
export function nativeDefenseFacts(state: GameState, faction: number): { productive: number; pending: number; underAttack: boolean } {
  const pointer = rustEngine.sim_defense_facts(bridge(state).handle, faction, state.time);
  const [productive, pending, attacked] = new Float64Array(rustEngine.memory.buffer, pointer, 3);
  return { productive, pending, underAttack: !!attacked };
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
export function nativeDefenseOrder(state: GameState, city: Building, population: number, allowed: number): DefenseOrder | undefined {
  const pointer = rustEngine.sim_defense_plan_order(bridge(state).handle, city.faction, city.id, state.time, population, allowed);
  const [code, x, y] = new Float64Array(rustEngine.memory.buffer, pointer, 3);
  const kind = defenseKinds.find(candidate => BUILDING_KIND_CODES[candidate] === code);
  return kind ? { kind, x, y } : undefined;
}
export function nativeDefenseOrderRejected(state: GameState, city: Building, order: DefenseOrder): void {
  rustEngine.sim_defense_reject_order(simCore(state).handle, city.id, BUILDING_KIND_CODES[order.kind], order.x, order.y, state.time);
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
