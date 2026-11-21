import { rustEngine } from './rust-engine';
import { SIM_ENGINE, SimSlot, simCore, type SimCore } from './sim-handle';
import { bridgeConstructionMembers, constructionFootprint, constructionHead } from './bridge-construction';
import { clearObservedScalar } from './scalar-observer';
import type { Building, BuildingKind, GameState, Point, Unit } from './types';

/** Stable numeric kind order used by the native construction duration table. */
export const CONSTRUCTION_KINDS: readonly BuildingKind[] = ['observationPost', 'fort', 'supplyDepot', 'villageTent', 'stable',
  'palace', 'camp', 'house', 'shack', 'cottage', 'road', 'wall', 'irrigation', 'palisade', 'bridge', 'tower', 'woodenTower',
  'ruin', 'well', 'monument', 'blacksmith', 'guardPost', 'archeryRange', 'library', 'scoutLodge', 'healerShack', 'ballista', 'dock',
  'colosseum', 'barracks', 'siegeCannon', 'forum', 'granary', 'thermalBath', 'shipyard', 'whalingPost', 'foundry', 'militaryAcademy', 'apartments', 'factory', 'goldMine', 'marketplace', 'scoutTower', 'fountain'];
const kindIndices = new Map(CONSTRUCTION_KINDS.map((kind, index) => [kind, index]));
export const nativeConstructionDuration = (kind: BuildingKind): number => rustEngine.construction_duration(kindIndices.get(kind)!);
export const CONSTRUCTION_INVALIDATE = 1, CONSTRUCTION_CLEARANCE = 2, CONSTRUCTION_COMPLETE = 4, CONSTRUCTION_SKIP = 8;
const INPUT_STRIDE = 31, OUTPUT_STRIDE = 12;
const flag = (value: boolean | undefined): number => value === undefined ? -1 : Number(value);
type Site = NonNullable<Building['construction']>;

export interface ConstructionSample {
  speed?: number;
  forbidden?: boolean;
  engineer?: Unit;
  worker?: Unit;
  workerForbidden?: boolean;
  clearance?: boolean;
  arrivingBuilder?: number;
}

const engines = new SimSlot<NativeConstruction>();

function publishNumber(site: Site, key: 'pausedAt' | 'researchSpeed' | 'engineerId' | 'builderId', value: number): void {
  if (Number.isNaN(value)) { if (site[key] !== undefined) clearObservedScalar(site, key); }
  else if (site[key] !== value) site[key] = value;
}
function publishFlag(site: Site, key: 'waitingForBuilder' | 'cleared' | 'evacuating', value: number): void {
  if (value === -1) { if (site[key] !== undefined) clearObservedScalar(site, key); }
  else if (site[key] !== !!value) site[key] = !!value;
}

/** Site components stay resident in a Bevy World. Imported snapshots retain
 * direct/editor mutations while native commands own the lifecycle decisions. */
class NativeConstruction {
  private readonly handle: number;
  private capacity = 0;
  private pointer = 0;
  private input?: Float64Array;
  private output?: Float64Array;
  constructor(readonly core: SimCore) { this.handle = core.engine(this, SIM_ENGINE.construction); }
  remove(id: number): void { rustEngine.construction_remove(this.handle, id); }
  private prepare(count: number): Float64Array {
    if (count > this.capacity) { this.pointer = rustEngine.construction_prepare(this.handle, count); this.capacity = count; this.input = undefined; }
    if (!this.input || this.input.buffer !== rustEngine.memory.buffer)
      this.input = new Float64Array(rustEngine.memory.buffer, this.pointer, this.capacity * INPUT_STRIDE);
    return this.input;
  }
  private write(input: Float64Array, row: number, building: Building, sample: ConstructionSample, followsClock = false): void {
    const site = building.construction!, offset = row * INPUT_STRIDE, engineer = sample.engineer, worker = sample.worker;
    const footprint = constructionFootprint(building);
    input[offset] = building.id; input[offset + 1] = (building.kind === 'ballista' || building.kind === 'siegeCannon') ? 1 : building.kind === 'palace' ? 2 : 0;
    input[offset + 2] = site.startedAt; input[offset + 3] = site.duration; input[offset + 4] = flag(site.waitingForBuilder);
    input[offset + 5] = site.pausedAt ?? NaN; input[offset + 6] = site.researchSpeed ?? NaN;
    input[offset + 7] = site.engineerId ?? NaN; input[offset + 8] = site.builderId ?? NaN; input[offset + 9] = flag(site.cleared);
    input[offset + 10] = site.paidGold ?? NaN; input[offset + 11] = building.hp; input[offset + 12] = sample.speed ?? 1;
    input[offset + 13] = Number(!!sample.forbidden);
    input[offset + 14] = engineer ? 1 | (engineer.hp > 0 ? 2 : 0) | (engineer.engineer ? 4 : 0) | (engineer.faction === building.faction ? 8 : 0) : 0;
    input[offset + 15] = Number(sample.clearance !== false);
    input[offset + 16] = worker ? 1 | (worker.builder ? 2 : 0) | (worker.buildPhase === 'working' ? 4 : 0)
      | (!worker.inside ? 8 : 0) | (worker.order !== 'flee' ? 16 : 0) | (!sample.workerForbidden ? 32 : 0) : 0;
    input[offset + 17] = worker?.hp ?? 0; input[offset + 18] = worker?.buildSite ?? NaN;
    input[offset + 19] = worker?.x ?? NaN; input[offset + 20] = worker?.y ?? NaN;
    input[offset + 21] = footprint.x; input[offset + 22] = footprint.y; input[offset + 23] = footprint.width; input[offset + 24] = footprint.height;
    input[offset + 25] = flag(site.evacuating); input[offset + 26] = site.replacesPalisade ?? NaN; input[offset + 27] = sample.arrivingBuilder ?? NaN;
    input[offset + 28] = building.maxHp; input[offset + 29] = site.healthProgress ?? NaN;
    input[offset + 30] = Number(followsClock);
  }
  private run(count: number, now: number, mode: number): Float64Array {
    const pointer = rustEngine.construction_run(this.handle, count, now, mode);
    if (!this.output || this.output.byteOffset !== pointer || this.output.buffer !== rustEngine.memory.buffer || this.output.length < count * OUTPUT_STRIDE)
      this.output = new Float64Array(rustEngine.memory.buffer, pointer, this.capacity * OUTPUT_STRIDE);
    return this.output;
  }
  private publish(building: Building, output: Float64Array, row: number): number {
    const site = building.construction!, offset = row * OUTPUT_STRIDE;
    site.startedAt = output[offset]; site.duration = output[offset + 1];
    publishFlag(site, 'waitingForBuilder', output[offset + 2]); publishNumber(site, 'pausedAt', output[offset + 3]);
    publishNumber(site, 'researchSpeed', output[offset + 4]); publishNumber(site, 'engineerId', output[offset + 5]);
    publishNumber(site, 'builderId', output[offset + 6]); publishFlag(site, 'cleared', output[offset + 7]);
    publishFlag(site, 'evacuating', output[offset + 8]);
    building.hp = output[offset + 10]; site.healthProgress = output[offset + 11];
    return output[offset + 9];
  }
  command(building: Building, now: number, mode: number, sample: ConstructionSample, bridge?: Building[]): number {
    const count = bridge?.length ?? 1, input = this.prepare(count);
    this.write(input, 0, building, sample);
    if (bridge) for (let row = 1; row < count; row++) this.write(input, row, bridge[row], sample, true);
    const output = this.run(count, now, mode), events = this.publish(building, output, 0);
    if (bridge) for (let row = 1; row < count; row++) this.publish(bridge[row], output, row);
    return events;
  }
  research(buildings: readonly Building[], now: number, speeds: readonly number[]): void {
    const input = this.prepare(buildings.length);
    for (let row = 0; row < buildings.length; row++) this.write(input, row, buildings[row], { speed: speeds[row] });
    const output = this.run(buildings.length, now, 2);
    for (let row = 0; row < buildings.length; row++) this.publish(buildings[row], output, row);
  }
}

function engine(state: GameState): NativeConstruction {
  return engines.get(state) ?? engines.set(state, new NativeConstruction(simCore(state)));
}

export function runConstructionRule(state: GameState, building: Building, mode: number, sample: ConstructionSample = {}): number {
  if (!building.construction) return 0;
  const bridge = bridgeConstructionMembers(state, building);
  if (bridge && bridge[0] !== building) return 0;
  return engine(state).command(building, state.time, mode, sample, bridge);
}
export function retimeNativeConstruction(state: GameState, buildings: readonly Building[], speeds: readonly number[]): void {
  const ordinary: Building[] = [], ordinarySpeeds: number[] = [];
  for (let row = 0; row < buildings.length; row++) {
    const building = buildings[row], speed = speeds[row];
    if (!building.construction?.bridge) { ordinary.push(building); ordinarySpeeds.push(speed); }
    else if (constructionHead(state, building) === building) runConstructionRule(state, building, 2, { speed });
  }
  if (ordinary.length) engine(state).research(ordinary, state.time, ordinarySpeeds);
}
export function forgetNativeConstruction(state: GameState, id: number): void { engines.get(state)?.remove(id); }
export function nativeConstructionLine(from: Point, to: Point): Point[] {
  const pointer = rustEngine.construction_line(from.x, from.y, to.x, to.y);
  const count = new Float64Array(rustEngine.memory.buffer, pointer, 1)[0];
  const values = new Float64Array(rustEngine.memory.buffer, pointer + 8, count * 2), points: Point[] = [];
  for (let row = 0; row < count; row++) points.push({ x: values[row * 2], y: values[row * 2 + 1] });
  return points;
}
export function nativeConstructionAccess(x: number, y: number, width: number, height: number): Point[] {
  const pointer = rustEngine.construction_access(x, y, width, height);
  const count = new Float64Array(rustEngine.memory.buffer, pointer, 1)[0];
  const values = new Float64Array(rustEngine.memory.buffer, pointer + 8, count * 2), points: Point[] = [];
  for (let row = 0; row < count; row++) points.push({ x: values[row * 2], y: values[row * 2 + 1] });
  return points;
}
export function nativeConstructionProgress(time: number, site: Site): number {
  return rustEngine.construction_progress(site.startedAt, site.duration, flag(site.waitingForBuilder), site.pausedAt ?? NaN, time);
}
export function initializeConstructionHealth(building: Building): void {
  building.hp = rustEngine.construction_initial_hp(building.maxHp);
  building.construction!.healthProgress = rustEngine.construction_health_fraction(building.maxHp, 0);
}
export function nativeConstructionRefund(time: number, site: Site): number {
  return rustEngine.construction_refund(site.paidGold ?? 0, site.startedAt, site.duration, flag(site.waitingForBuilder), site.pausedAt ?? NaN, time);
}
export const nativeRepairRate = (maximum: number, kind: BuildingKind): number => rustEngine.construction_repair_rate(maximum, kindIndices.get(kind)!);
export const nativeRepair = (hp: number, maximum: number, kind: BuildingKind, speed: number, elapsed: number): number =>
  rustEngine.construction_repair(hp, maximum, kindIndices.get(kind)!, speed, elapsed);
