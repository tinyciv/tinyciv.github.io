import { rustEngine } from './rust-engine';
import { SIM_ENGINE, SimSlot, simCore, type SimCore } from './sim-handle';
import type { EntityObserver, EntityStore } from './entity-store';
import type { GameState, Point, Unit, World } from './types';

export type CollisionTraits = Pick<Unit, 'kind'> & Partial<Pick<Unit,
  'faction' | 'infantryDrillLeader' | 'engineer' | 'levyAssembling' | 'wallPatrol' | 'inside' | 'humanControlled' | 'embarkedOn' | 'training'>>;
const RETRAINING = 1 << 6;
const marchGroups = new WeakMap<CollisionTraits, number>();
export function setMarchCollisionGroup(unit: Unit, faction?: number): void {
  if (faction === undefined) marchGroups.delete(unit);
  else marchGroups.set(unit, -faction - 1);
}
export const movementFormation = (unit: CollisionTraits): number => marchGroups.get(unit) ?? unit.infantryDrillLeader ?? NaN;

/** Encoding only: collision classifications and exceptions belong to Rust. */
export function movementKind(kind: Unit['kind']): number {
  switch (kind) {
    case 'worker': return 1; case 'scout': return 2; case 'merchant': return 3; case 'supplyCart': return 4;
    case 'leader': return 5; case 'militia': return 6; case 'warrior': return 7; case 'swordsman': return 8;
    case 'spearman': case 'pikeman': return 9; case 'archer': case 'musketman': return 10; case 'horseman': return 11; case 'horseArcher': return 12;
    case 'knight': return 13; case 'levyInfantry': return 14; case 'slinger': return 15; case 'skirmisher': return 16;
    case 'fieldCannon': return 18;
    case 'cow': case 'sheep': case 'horse': return 19;
    case 'marshBird': return 17; default: return 0;
  }
}
export function movementFlags(unit: Partial<CollisionTraits>): number {
  return Number(!!unit.engineer) | Number(!!unit.levyAssembling) << 1 | Number(unit.wallPatrol?.wall !== undefined) << 2
    | Number(!!unit.inside) << 3 | Number(!!unit.humanControlled) << 4
    | Number(unit.kind === 'sailboat' || unit.embarkedOn !== undefined) << 5 | (unit.training ? RETRAINING : 0);
}

interface ActorRecord {
  unit: Unit; x: number; y: number; kind: number; faction: number; hp: number; flags: number; drill: number;
  order: number; bucketOrder: number; indexedCell: number; overlay: boolean;
}
const same = (a: number, b: number) => a === b || Number.isNaN(a) && Number.isNaN(b);
const finalizedWorlds = new FinalizationRegistry<number>(handle => rustEngine.movement_drop(handle));
const finalizedMasks = new FinalizationRegistry<{ world: number; mask: number }>(value => rustEngine.movement_mask_drop(value.world, value.mask));
class NativeMask {
  readonly handle: number;
  constructor(world: NativeMovementWorld, cells: ReadonlySet<number>) {
    this.handle = rustEngine.movement_mask_create(world.handle, cells.size);
    const pointer = rustEngine.movement_mask_input(world.handle, this.handle);
    const input = new Float64Array(rustEngine.memory.buffer, pointer, cells.size);
    let row = 0; for (const cell of cells) input[row++] = cell;
    rustEngine.movement_mask_commit(world.handle, this.handle);
    finalizedMasks.register(this, { world: world.handle, mask: this.handle });
  }
}

/** One resident occupancy world. Sensing still keeps its existing broad-phase
 * buckets; native tile membership is changed only by explicit spatial events. */
export class NativeMovementWorld {
  readonly handle: number;
  readonly width: number;
  readonly height: number;
  private readonly records = new Map<number, ActorRecord>();
  private readonly candidateCaches = [new Map<number, number[]>(), new Map<number, number[]>()];
  private readonly masks = new WeakMap<ReadonlySet<number>, NativeMask>();
  private store?: EntityStore;
  private observer?: EntityObserver<Unit>;
  private ordersDirty = false;
  active = false;
  /** A game's occupancy world is owned by its simulation core; standalone
   * geometry worlds (work and trade probes) own their handle. */
  constructor(readonly world: Pick<World, 'width' | 'height'>, readonly owner?: SimCore) {
    this.width = world.width; this.height = world.height;
    if (owner) this.handle = owner.engine(this, SIM_ENGINE.movement, world.width, world.height);
    else { this.handle = rustEngine.movement_create(world.width, world.height); finalizedWorlds.register(this, this.handle); }
  }
  begin(store: EntityStore): void {
    if (this.store !== store) {
      for (const id of this.records.keys()) rustEngine.movement_remove(this.handle, id);
      this.records.clear(); this.candidateCaches.forEach(cache => cache.clear()); this.store = store;
      this.observer = {
        added: unit => {
          if (this.store !== store || !this.active || store.isUnitSleeping(unit)) return;
          this.publish(unit, store.units.indexOf(unit), store.units.indexOf(unit), NaN, true);
        },
        removed: unit => { if (this.store === store) { this.remove(unit); this.ordersDirty = true; } },
        changed: unit => {
          if (this.store !== store) return;
          const record = this.records.get(unit.id);
          if (record?.overlay && store.isUnitSleeping(unit)) this.remove(unit);
          else this.syncLive(unit);
        },
      };
      store.units.observe(this.observer);
    }
    this.active = true;
    rustEngine.movement_begin(this.handle);
  }
  finishBegin(): void {
    // Spatial reconciliation already emits removals for its stale entries.
    this.ordersDirty = false;
  }
  index(unit: Unit, order: number, bucketOrder: number, indexedCell: number): void {
    this.publish(unit, order, bucketOrder, indexedCell, false);
  }
  remove(unit: Unit): void {
    const record = this.records.get(unit.id);
    if (record?.unit !== unit) return;
    this.invalidateCell(record.indexedCell, false);
    if (record.overlay) this.invalidateCell(Math.floor(record.y) * this.world.width + Math.floor(record.x), true);
    this.records.delete(unit.id);
    rustEngine.movement_remove(this.handle, unit.id);
  }
  private invalidateCell(cell: number, overlayOnly: boolean): void {
    if (!Number.isFinite(cell)) return;
    if (!overlayOnly) this.candidateCaches[0].delete(cell);
    this.candidateCaches[1].delete(cell);
  }
  private publish(unit: Unit, order: number, bucketOrder: number, indexedCell: number, overlay: boolean): void {
    const previous = this.records.get(unit.id), kind = movementKind(unit.kind), flags = movementFlags(unit);
    const faction = unit.faction ?? NaN, drill = movementFormation(unit);
    const changed = !previous || previous.unit !== unit || previous.x !== unit.x || previous.y !== unit.y || previous.kind !== kind
      || !same(previous.faction, faction) || previous.hp !== unit.hp || previous.flags !== flags || !same(previous.drill, drill)
      || previous.order !== order || previous.bucketOrder !== bucketOrder || !same(previous.indexedCell, indexedCell) || previous.overlay !== overlay;
    if (!changed) return;
    const previousOverlay = previous?.overlay ? Math.floor(previous.y) * this.world.width + Math.floor(previous.x) : NaN;
    const nextOverlay = overlay ? Math.floor(unit.y) * this.world.width + Math.floor(unit.x) : NaN;
    const collisionChanged = previous && ((previous.flags ^ flags) & RETRAINING) !== 0;
    if (!previous || collisionChanged || !same(previous.indexedCell, indexedCell)) {
      this.invalidateCell(previous?.indexedCell ?? NaN, false); this.invalidateCell(indexedCell, false);
    }
    if (collisionChanged || !same(previousOverlay, nextOverlay)) { this.invalidateCell(previousOverlay, true); this.invalidateCell(nextOverlay, true); }
    if (!previous) this.records.set(unit.id, { unit, x: unit.x, y: unit.y, kind, faction, hp: unit.hp, flags, drill,
      order, bucketOrder, indexedCell, overlay });
    else {
      previous.unit = unit; previous.x = unit.x; previous.y = unit.y; previous.kind = kind; previous.faction = faction;
      previous.hp = unit.hp; previous.flags = flags; previous.drill = drill; previous.order = order;
      previous.bucketOrder = bucketOrder; previous.indexedCell = indexedCell; previous.overlay = overlay;
    }
    rustEngine.movement_actor(this.handle, unit.id, unit.x, unit.y, kind, faction, unit.hp, flags, drill,
      order, bucketOrder, indexedCell, Number(overlay));
  }
  private syncLive(unit: Unit): void {
    const record = this.records.get(unit.id);
    if (record?.unit === unit) this.publish(unit, record.order, record.bucketOrder, record.indexedCell, record.overlay);
  }
  private candidates(cell: number, mode: 0 | 1): readonly number[] {
    const cache = this.candidateCaches[mode], previous = cache.get(cell);
    if (previous) return previous;
    if (cache.size > 1024) cache.clear();
    const pointer = rustEngine.movement_candidates(this.handle, cell, mode);
    const count = new Float64Array(rustEngine.memory.buffer, pointer, 1)[0];
    const values = new Float64Array(rustEngine.memory.buffer, pointer + 8, count);
    // Snapshot before live-policy publications can grow native component memory.
    const ids = Array.from(values);
    cache.set(cell, ids);
    return ids;
  }
  occupant(cell: number, observer: Unit, mode: 0 | 1): number {
    if (mode === 1 && this.ordersDirty && this.store) {
      for (const record of this.records.values()) {
        const order = this.store.units.indexOf(record.unit);
        if (order !== record.order) this.publish(record.unit, order, record.bucketOrder, record.indexedCell, record.overlay);
      }
      this.ordersDirty = false;
    }
    this.syncLive(observer);
    // Direct editor/fixture mutations remain observable. Only occupants of the
    // queried tile are reconciled, rather than copying the active roster again.
    for (const id of this.candidates(cell, mode)) {
      const record = this.records.get(id);
      if (record) this.syncLive(record.unit);
    }
    return rustEngine.movement_occupant(this.handle, cell, observer.id, movementKind(observer.kind),
      observer.faction ?? NaN, movementFlags(observer), movementFormation(observer), mode);
  }
  /** Whether this actor has a resident transform in an active frame. */
  resident(unit: Unit): boolean { return this.active && this.records.get(unit.id)?.unit === unit; }
  /** Reconcile direct host mutations for the observer and the tiles a step can
   * probe, then run one atomic native steering command. Rust writes the
   * authoritative transform; the host mirror and Unit view follow it. */
  steer(unit: Unit, probe: NativeMoveProbe, next: Point, speed: number, dt: number, anchor: Point | undefined, radius: number): SteerResult | undefined {
    this.syncLive(unit);
    if (!unit.training) {
      const reach = Math.max(0, speed * dt);
      const toX = unit.x + Math.max(-reach, Math.min(reach, next.x - unit.x)), toY = unit.y + Math.max(-reach, Math.min(reach, next.y - unit.y));
      const x0 = Math.max(0, Math.floor(Math.min(unit.x, toX))), x1 = Math.min(this.width - 1, Math.floor(Math.max(unit.x, toX)));
      const y0 = Math.max(0, Math.floor(Math.min(unit.y, toY))), y1 = Math.min(this.height - 1, Math.floor(Math.max(unit.y, toY)));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        for (const id of this.candidates(y * this.width + x, 0)) { const record = this.records.get(id); if (record) this.syncLive(record.unit); }
      }
    }
    const pointer = rustEngine.movement_steer(this.handle, unit.id, probe.engine.handle, probe.grid, probe.blockers, probe.guard,
      probe.forbidden, Number(probe.exemptCurrent), next.x, next.y, speed, dt, anchor?.x ?? NaN, anchor?.y ?? NaN, radius);
    const output = new Float64Array(rustEngine.memory.buffer, pointer, 7), status = output[0];
    if (status & STEER_UNKNOWN) return;
    const result = steerResult;
    result.status = status; result.x = output[1]; result.y = output[2]; result.moving = output[3] !== 0; result.facing = output[4];
    result.candidate.x = output[5]; result.candidate.y = output[6];
    if (result.x !== unit.x || result.y !== unit.y) this.accept(unit, result.x, result.y);
    return result;
  }
  /** Mirror the result of native placement displacement. */
  evacuate(unit: Unit, probe: NativeMoveProbe, footprint: number): boolean {
    const pointer = rustEngine.movement_evacuate(this.handle, unit.id, probe.engine.handle, probe.grid,
      probe.blockers, probe.guard, probe.forbidden, footprint);
    const result = new Float64Array(rustEngine.memory.buffer, pointer, 2), x = result[0], y = result[1];
    if (!Number.isFinite(x) || x === unit.x && y === unit.y) return false;
    this.accept(unit, x, y);
    return true;
  }
  /** Apply a native transform to the Unit view and its mirror record. */
  private accept(unit: Unit, x: number, y: number): void {
    unit.x = x; unit.y = y;
    const record = this.records.get(unit.id);
    if (record?.unit === unit) {
      const width = this.world.width;
      if (record.overlay && Math.floor(record.y) * width + Math.floor(record.x) !== Math.floor(y) * width + Math.floor(x)) {
        this.invalidateCell(Math.floor(record.y) * width + Math.floor(record.x), true); this.invalidateCell(Math.floor(y) * width + Math.floor(x), true);
      }
      record.x = x; record.y = y;
    }
  }
  /** Post-loop separation in active order. Moved actors are reported in that
   * same order; the caller refreshes its broad-phase buckets for each one. */
  separate(rows: readonly SeparationRow[], radius: number, moved: (unit: Unit) => void): void {
    if (!rows.length) return;
    const stride = separationStride ??= rustEngine.movement_separation_stride();
    // Reserve first: growing the input can grow (and detach) WASM memory.
    const inputPointer = rustEngine.movement_separation_input(rows.length);
    const input = new Float64Array(rustEngine.memory.buffer, inputPointer, rows.length * stride);
    for (let row = 0; row < rows.length; row++) {
      const value = rows[row], offset = row * stride, probe = value.probe;
      input[offset] = value.unit.id; input[offset + 1] = Number(!!probe);
      input[offset + 2] = value.anchor?.x ?? NaN; input[offset + 3] = value.anchor?.y ?? NaN;
      input[offset + 4] = value.next?.x ?? NaN; input[offset + 5] = value.next?.y ?? NaN;
      input[offset + 6] = value.old?.x ?? NaN; input[offset + 7] = value.old?.y ?? NaN;
      input[offset + 8] = probe?.engine.handle ?? 0; input[offset + 9] = probe?.grid ?? 0;
      input[offset + 10] = probe?.blockers ?? 0; input[offset + 11] = probe?.guard ?? 0; input[offset + 12] = probe?.forbidden ?? 0;
      input[offset + 13] = Number(!!probe?.exemptCurrent); input[offset + 14] = probe?.plainForbidden ?? 0;
    }
    const pointer = rustEngine.movement_separate(this.handle, rows.length, radius);
    const count = new Float64Array(rustEngine.memory.buffer, pointer, 1)[0];
    // Copy before host refreshes can grow native memory.
    const output = Float64Array.from(new Float64Array(rustEngine.memory.buffer, pointer + 8, count * 3));
    for (let row = 0; row < count; row++) {
      const unit = this.records.get(output[row * 3])?.unit;
      if (!unit) continue;
      this.accept(unit, output[row * 3 + 1], output[row * 3 + 2]);
      moved(unit);
    }
  }
  mask(cells: ReadonlySet<number> | undefined): number {
    if (!cells?.size) return 0;
    let mask = this.masks.get(cells);
    if (!mask) { mask = new NativeMask(this, cells); this.masks.set(cells, mask); }
    return mask.handle;
  }
}
/** Native obstacle masks for one mover: faction structures, guard boundary,
 * and forbidden cells (optionally exempting the mover's current tile). The
 * plain layer is the unguarded faction view used for segment continuity. */
export interface NativeMoveProbe {
  engine: NativeMovementWorld; grid: number; blockers: number; guard: number; forbidden: number; exemptCurrent: boolean; plainForbidden: number;
}
export const STEER_BLOCKED = 1, STEER_TRAFFIC = 2, STEER_UNKNOWN = 4;
export interface SteerResult { status: number; x: number; y: number; moving: boolean; facing: number; candidate: Point; }
const steerResult: SteerResult = { status: 0, x: 0, y: 0, moving: false, facing: 0, candidate: { x: 0, y: 0 } };
export interface SeparationRow { unit: Unit; probe?: NativeMoveProbe; anchor?: Point; next?: Point; old?: Point; }
let separationStride: number | undefined;

const worlds = new SimSlot<NativeMovementWorld>();
export function nativeMovement(state: GameState): NativeMovementWorld {
  let value = worlds.get(state);
  if (!value || value.world !== state.world || value.width !== state.world.width || value.height !== state.world.height)
    value = worlds.set(state, new NativeMovementWorld(state.world, simCore(state)));
  return value;
}
export function nativePositionBlocked(state: GameState, unit: Unit, point: Point): boolean | undefined {
  const value = worlds.get(state);
  if (!value?.active || !Number.isFinite(point.x) || !Number.isFinite(point.y)
    || point.x < 0 || point.y < 0 || point.x >= value.width || point.y >= value.height) return;
  if (rustEngine.movement_civilian(movementKind(unit.kind), movementFlags(unit))) return false;
  return !Number.isNaN(value.occupant(Math.floor(point.y) * value.width + Math.floor(point.x), unit, 0));
}

/** Immutable blocker snapshots can be installed once. Arbitrary caller-owned
 * Sets and callback layers keep their live extra-mask check after native DDA. */
const blockerSources = new WeakMap<object, ReadonlySet<number>>();
export function registerNativeBlockers(view: object, cells: ReadonlySet<number>): void { blockerSources.set(view, cells); }
export function nativeBlockerSource(view: object): ReadonlySet<number> | undefined { return blockerSources.get(view); }

export class NativeMovementGeometry {
  readonly grid: number;
  private input = new Float64Array(0);
  private traceView?: Float64Array;
  private readonly traceCells: Int32Array[];
  private traceDepth = 0;
  constructor(readonly engine: NativeMovementWorld, readonly width: number, readonly height: number) {
    this.grid = rustEngine.movement_grid_create(engine.handle, width, height);
    this.traceCells = [new Int32Array(width + height + 2)];
  }
  patch(cells: ReadonlySet<number> | undefined, fill: (cell: number, output: Float64Array, offset: number) => void): void {
    const count = cells?.size ?? this.width * this.height;
    if (!count) return;
    if (this.input.length < count * 4) this.input = new Float64Array(Math.max(count * 4, this.input.length * 2));
    let row = 0;
    if (cells) for (const cell of cells) fill(cell, this.input, row++ * 4);
    else for (let cell = 0; cell < count; cell++) fill(cell, this.input, row++ * 4);
    const pointer = rustEngine.movement_grid_input(this.engine.handle, this.input.length / 4);
    new Float64Array(rustEngine.memory.buffer, pointer, this.input.length).set(this.input);
    rustEngine.movement_grid_patch(this.engine.handle, this.grid, count);
  }
  canMove(from: Point, to: Point, blockers: ReadonlySet<number>, forbidden?: ReadonlySet<number>): boolean {
    const first = this.engine.mask(blockers), second = this.engine.mask(forbidden);
    return !!rustEngine.movement_sweep(this.engine.handle, this.grid, from.x, from.y, to.x, to.y, first, second);
  }
  private acquireTrace(): Int32Array {
    const depth = this.traceDepth++;
    return this.traceCells[depth] ??= new Int32Array(this.width + this.height + 2);
  }
  private trace(from: Point, to: Point, output: Int32Array): number {
    const pointer = rustEngine.movement_trace(this.engine.handle, this.grid, from.x, from.y, to.x, to.y);
    if (!this.traceView || this.traceView.buffer !== rustEngine.memory.buffer || this.traceView.byteOffset !== pointer)
      this.traceView = new Float64Array(rustEngine.memory.buffer, pointer, this.width + this.height + 4);
    if (!this.traceView[0]) return -1;
    const count = this.traceView[1];
    for (let row = 0; row < count; row++) output[row] = this.traceView[row + 2];
    return count;
  }
  withExtraBlockers(from: Point, to: Point, blockers: { has(cell: number): boolean }, forbidden?: ReadonlySet<number>): boolean {
    const cells = this.acquireTrace();
    try {
      const count = this.trace(from, to, cells);
      if (count < 0) return false;
      for (let row = 0; row < count; row++) {
        const cell = cells[row];
        if (blockers.has(cell) || forbidden?.has(cell)) return false;
      }
      return true;
    } finally { this.traceDepth--; }
  }
  withScalarTerrain(from: Point, to: Point, walk: (x: number, y: number) => boolean,
    edge: (from: Point, to: Point) => boolean): boolean {
    const cells = this.acquireTrace();
    try {
      const count = this.trace(from, to, cells);
      if (count < 0 || !walk(from.x, from.y) || !walk(to.x, to.y)) return false;
      let previous = cells[0];
      for (let row = 1; row < count; row++) {
        const cell = cells[row], x = cell % this.width, y = Math.floor(cell / this.width);
        if (!walk(x, y) || !edge({ x: previous % this.width, y: Math.floor(previous / this.width) }, { x, y })) return false;
        previous = cell;
      }
      return true;
    } finally { this.traceDepth--; }
  }
}
