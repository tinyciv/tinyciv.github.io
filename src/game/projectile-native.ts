import { rustEngine } from './rust-engine';
import { SIM_ENGINE, SimSlot, simCore, type SimCore } from './sim-handle';
import { entityStore, type EntityStore } from './entity-store';
import { battleSupport } from './battle-support-native';
import { mountainLineClear, mountainTerrainHandle } from './terrain-rays-native';
import { earlyCombatBuildings, earlyCombatUnits, withEarlyCombatQueries } from './spatial';
import { publishShellImpacts, recordProjectileShellLanding } from './shell-impacts-native';
import { buildingWidth, buildingHeight, type Building, type GameState, type Point, type Projectile, type Unit } from './types';

const INPUT_STRIDE = 16, OUTPUT_STRIDE = 6;

export interface ProjectileHooks {
  target(id: number): Unit | Building | undefined;
  hostile(a: number, b: number): boolean;
  huntable(unit: Unit): boolean;
  observable(unit: Unit, faction: number): boolean;
  protected(building: Building): boolean;
  clear(projectile: Projectile, target: Unit | Building, straight: boolean): boolean;
  defense(target: Unit, from: Point): number;
  /** Native HP is published here before another target observation is taken.
   * Remaining blood/casualty/economy/fog effects retain their original order. */
  hit(projectile: Projectile, target: Unit | Building, previousHp: number, hp: number, dead: boolean, rewards?: boolean): void;
}

class ProjectileBatch {
  readonly handle: number;
  private ids = new WeakMap<Projectile, number>();
  private nextId = 1;
  private capacity = 0;
  private pointer = 0;
  private inputView?: Float64Array;
  private roster: number[] = [];
  private rosterChanged = false;
  private plan = new Float64Array(0);
  values = new Float64Array(0);
  targets: (Unit | Building | undefined)[] = [];
  count = 0;
  readonly visualLandings: number[] = [];
  constructor(readonly store: EntityStore, readonly world: GameState['world'], readonly core: SimCore) {
    this.handle = core.engine(this, SIM_ENGINE.projectiles);
  }
  reserve(count: number): void {
    if (count <= this.capacity) return;
    this.capacity = Math.max(8, 2 ** Math.ceil(Math.log2(count)));
    this.values = new Float64Array(this.capacity * INPUT_STRIDE);
    this.plan = new Float64Array(this.capacity);
    this.rosterChanged = true;
    this.pointer = rustEngine.projectiles_input(this.handle, this.capacity);
  }
  import(projectile: Projectile, row: number): void {
    let id = this.ids.get(projectile);
    const launch = id === undefined;
    if (id === undefined) { id = this.nextId++; this.ids.set(projectile, id); }
    if (this.roster[row] !== id) this.rosterChanged = true;
    this.roster[row] = id;
    if (!launch) return;
    const index = row * INPUT_STRIDE, values = this.values;
    values[index] = id; values[index + 1] = projectile.start.x; values[index + 2] = projectile.start.y;
    values[index + 3] = projectile.elapsed; values[index + 4] = projectile.duration; values[index + 5] = projectile.damage;
    values[index + 6] = projectile.kind === 'arrow' ? 1 : projectile.kind === 'stone' ? 2 : projectile.kind === 'ballistaBolt' ? 3 : projectile.kind === 'bullet' ? 4 : projectile.kind === 'cannonball' ? 5 : 0;
    values[index + 7] = Number(!!projectile.towerArrow); values[index + 8] = projectile.faction;
    values[index + 9] = projectile.x; values[index + 10] = projectile.y;
    values[index + 11] = projectile.end.x; values[index + 12] = projectile.end.y;
    // Other native systems may have grown memory since the last publication.
    this.input().set(values.subarray(index, index + 13), index);
    rustEngine.projectiles_publish(this.handle, row);
  }
  observe(projectile: Projectile, row: number, hooks: ProjectileHooks): void {
    const target = hooks.target(projectile.target), index = row * INPUT_STRIDE;
    this.targets[row] = target;
    if (!target) { this.values[index + 15] = 0; return; }
    const building = 'capacity' in target;
    this.values[index + 13] = target.x + (building ? buildingWidth(target) / 2 : 0);
    this.values[index + 14] = target.y + (building ? buildingHeight(target) / 2 : 0);
    const hostile = hooks.hostile(projectile.faction, target.faction);
    const huntable = !hostile && !building && projectile.faction >= 0 && hooks.huntable(target);
    // Gather existing domain facts; Rust alone decides eligibility. Avoid
    // expensive fog/defense discovery when allegiance already excludes a hit.
    const eligibleAllegiance = hostile || huntable;
    const observable = !building && eligibleAllegiance && hooks.observable(target, projectile.faction);
    const protectedPalace = building && eligibleAllegiance && hooks.protected(target);
    this.values[index + 15] = 1 | (building ? 2 : 0) | (hostile ? 4 : 0) | (huntable ? 8 : 0)
      | (observable ? 16 : 0) | (protectedPalace ? 32 : 0)
      | (building && (target.kind === 'road' || target.kind === 'bridge') ? 64 : 0);
  }
  private input(): Float64Array {
    if (!this.inputView || this.inputView.buffer !== rustEngine.memory.buffer
      || this.inputView.byteOffset !== this.pointer || this.inputView.length !== this.values.length)
      this.inputView = new Float64Array(rustEngine.memory.buffer, this.pointer, this.values.length);
    return this.inputView;
  }
  write(start: number, count: number): void {
    // Flight rows stay resident. Only three target-observation scalars cross
    // the boundary, after earlier impacts have published their domain effects.
    const input = this.input();
    for (let row = start; row < start + count; row++) {
      const index = row * INPUT_STRIDE;
      input[index + 13] = this.values[index + 13];
      input[index + 14] = this.values[index + 14];
      input[index + 15] = this.values[index + 15];
    }
  }
  begin(count: number, dt: number): Float64Array {
    const changed = this.rosterChanged || this.count !== count;
    if (changed) {
      const input = this.input();
      for (let row = 0; row < count; row++) input[row * INPUT_STRIDE] = this.roster[row];
      this.roster.length = count;
    }
    this.count = count; this.rosterChanged = false;
    const pointer = rustEngine.projectiles_begin(this.handle, count, dt, Number(changed));
    // Keep a reusable detached plan: impact callbacks may grow WASM memory.
    this.plan.set(new Float64Array(rustEngine.memory.buffer, pointer, count));
    return this.plan.subarray(0, count);
  }
}

const batches = new SimSlot<ProjectileBatch>();

function cannonSplash(state: GameState, projectile: Projectile, directTarget: number, hooks: ProjectileHooks): void {
  const candidates: (Building | Unit)[] = [
    ...earlyCombatBuildings(state, projectile.end, 2), ...earlyCombatUnits(state, projectile.end, 2),
  ].filter(target => {
    const point = 'capacity' in target
      ? { x: target.x + buildingWidth(target) / 2, y: target.y + buildingHeight(target) / 2 } : target;
    return Math.abs(point.x - projectile.end.x) <= 2 && Math.abs(point.y - projectile.end.y) <= 2
      && mountainLineClear(state.world, projectile.end, point);
  });
  const targets = new Map(candidates.map(target => [target.id, target]));
  const output = battleSupport(state, 3, projectile.end, projectile.faction, directTarget,
    candidates.map(target => ({ target, damage: projectile.damage, hostile: hooks.hostile(projectile.faction, target.faction),
      defense: 'capacity' in target ? 1 : hooks.defense(target, projectile.end) })));
  for (let row = 0; row < output.length; row += 3) {
    const target = targets.get(output[row]); if (!target || target.hp <= 0) continue;
    hooks.hit(projectile, target, target.hp, output[row + 1], !!(output[row + 2] & 1), !!(output[row + 2] & 2));
  }
}

export const projectileDuration = (from: Point, end: Point): number => rustEngine.projectiles_duration(from.x, from.y, end.x, end.y);

/** The Bevy schedule advances flight and decides expiry/impact/damage. Ranges
 * stop at every potential impact so subsequent observations see earlier deaths,
 * captures, allegiance changes, and removal of palace defenses immediately. */
export function advanceProjectiles(state: GameState, dt: number, hooks: ProjectileHooks): void {
  withEarlyCombatQueries(state, () => advanceProjectileBatch(state, dt, hooks));
}

function advanceProjectileBatch(state: GameState, dt: number, hooks: ProjectileHooks): void {
  const projectiles = state.projectiles ?? [], count = projectiles.length;
  const store = entityStore(state);
  let batch = batches.get(state);
  if (!count) {
    if (batch?.count && batch.store === store && batch.world === state.world) batch.begin(0, dt);
    state.projectiles = []; publishShellImpacts(state); return;
  }
  if (!batch || batch.store !== store || batch.world !== state.world)
    batch = batches.set(state, new ProjectileBatch(store, state.world, simCore(state)));
  rustEngine.projectiles_terrain(batch.handle, mountainTerrainHandle(state.world));
  batch.reserve(count); batch.targets.length = count;
  for (let row = 0; row < count; row++) batch.import(projectiles[row], row);
  const plan = batch.begin(count, dt), retained: Projectile[] = [];
  let start = 0;
  while (start < count) {
    let end = start;
    while (end < count) { const boundary = plan[end++] !== 0; if (boundary) break; }
    for (let row = start; row < end; row++) batch.observe(projectiles[row], row, hooks);
    batch.write(start, end - start);
    const pointer = rustEngine.projectiles_advance(batch.handle, start, end - start);
    const output = new Float64Array(rustEngine.memory.buffer, pointer + start * OUTPUT_STRIDE * 8, (end - start) * OUTPUT_STRIDE);
    let pendingStatus = 0;
    batch.visualLandings.length = 0;
    for (let row = start; row < end; row++) {
      const index = (row - start) * OUTPUT_STRIDE, status = output[index];
      if (!status) continue;
      const projectile = projectiles[row];
      projectile.x = output[index + 1]; projectile.y = output[index + 2];
      projectile.end = { x: output[index + 3], y: output[index + 4] }; projectile.elapsed = output[index + 5];
      if (status === 1) retained.push(projectile);
      else if (status === 2 || status === 3) pendingStatus = status;
      else if (status === 4) batch.visualLandings.push(row);
    }
    // Capture every returned scalar before recording events: a native queue
    // append may grow linear memory and detach the borrowed output view.
    for (const row of batch.visualLandings) recordProjectileShellLanding(state, batch.handle, row);
    if (pendingStatus) {
      // A range ends at its sole potential impact. Capture returned scalars
      // before callbacks can invoke other native rules or grow linear memory.
      const row = end - 1, projectile = projectiles[row], target = batch.targets[row]!;
      // Cannon flight has already swept the terrain in Rust. Structures only
      // need an additional contact check for the other projectile types.
      const clear = projectile.kind === 'cannonball' || hooks.clear(projectile, target, pendingStatus === 3);
      const defense = clear && !('capacity' in target) ? hooks.defense(target, projectile.start) : 1;
      const resultPointer = rustEngine.projectiles_impact(batch.handle, row, Number(clear), target.hp,
        'capacity' in target ? 0 : target.kills ?? 0, defense);
      const event = new Float64Array(rustEngine.memory.buffer, resultPointer, 3);
      const kind = event[0], previousHp = event[1], hp = event[2];
      if (projectile.kind === 'cannonball') recordProjectileShellLanding(state, batch.handle, row, target);
      if (kind) {
        hooks.hit(projectile, target, previousHp, hp, kind === 2);
        if (projectile.kind === 'cannonball') cannonSplash(state, projectile, target.id, hooks);
      }
    }
    start = end;
  }
  state.projectiles = retained;
  publishShellImpacts(state);
}
