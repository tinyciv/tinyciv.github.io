import { rustEngine } from './rust-engine';
import { SimSlot, simCore } from './sim-handle';
import { entityStore, BUILDING_KIND_CODES, UNIT_KIND_CODES, type EntityObserver, type EntityStore } from './entity-store';
import { observeScalars, type ScalarObserver } from './scalar-observer';
import { nearbyUnits, nearbyBuildings, refreshIndexedUnit } from './spatial';
import { refreshFogUnit } from './fog';
import { traversable, nativeMoveLayers, canWalk } from './pathfinding';
import { updateArcheryTraining, setRetinueFraction, interruptOutboundTraining } from './archery';
import { infantryFormationGoal } from './infantry-drill';
import { retinueFormation } from './formation';
import { offensiveDirective } from './offensive-native';
import { worldRevisions } from './world-revisions';
import { recordGoldOutlay } from './gold-ledger';
import { researchLevel } from './research';
import { playerFaction } from './player-context';
import { buildingActivityAvailable } from './building-activity';
import { buildingWidth, buildingHeight, buildingPresent, buildingReady, isWallKind, isFarmKind, isRetinueMember,
  type GameState, type Unit, type Building, type Point } from './types';

import { FIELD_CANNON_RANGE } from './field-cannon-config';
const ROW = 24;
const networks = new SimSlot<CannonBridge>();
const ERRORS = ['', 'Choose your completed foundry.', 'Research Field cannon first.',
  'Choose an available friendly soldier. Leaders, civilians, temporary troops and garrisons cannot convert.',
  'Move the soldier within 3 tiles of the foundry.', 'Build a completed road beside the foundry and clear its exit.'];

interface CannonCombat {
  observe(cannon: Unit, target: Unit | Building): { eligible: boolean; range: number; defense: number; edge: number };
  attack(cannon: Unit): { attack: number; strength: number };
  validOrder(cannon: Unit, target: Unit | Building): boolean;
  finishOrder(cannon: Unit): void;
  shoot(cannon: Unit, target: Unit | Building, damage: number): void;
}
class CannonBridge implements ScalarObserver {
  readonly handle: number;
  readonly store: EntityStore;
  readonly cannons = new Set<Unit>();
  private dirty = new Set<Building>();
  private roster: Unit[] = [];
  private rosterDirty = true;
  private cursor = 0;
  private units: EntityObserver<Unit>;
  private buildings: EntityObserver<Building>;
  constructor(private state: GameState) {
    this.store = entityStore(state); void this.store.units; void this.store.buildings;
    this.handle = simCore(state).handle; rustEngine.sim_field_reset(this.handle);
    this.units = { added: u => this.trackUnit(u), removed: u => { this.cannons.delete(u); this.rosterDirty = true; }, changed: u => this.trackUnit(u) };
    this.buildings = { added: b => this.track(b), removed: b => this.dirty.add(b), changed: b => this.dirty.add(b) };
    this.store.units.observe(this.units); this.store.buildings.observe(this.buildings);
    for (const u of state.units) this.trackUnit(u);
    for (const b of state.buildings) this.track(b);
  }
  private trackUnit(u: Unit): void {
    const before = this.cannons.has(u);
    if (u.kind === 'fieldCannon') this.cannons.add(u); else this.cannons.delete(u);
    if (before !== this.cannons.has(u)) this.rosterDirty = true;
  }
  private track(b: Building): void { this.dirty.add(b); observeScalars(b, ['kind', 'faction', 'x', 'y', 'hp', 'construction', 'roadPaved'], this); }
  changed(target: object, key: string, before: unknown, after: unknown): void {
    if (key !== 'hp' || (Number(before) > 0) !== (Number(after) > 0)) this.dirty.add(target as Building);
  }
  flush(): void {
    for (const b of this.store.buildings.query('construction')) this.dirty.add(b);
    for (const b of this.dirty) {
      const exists = this.store.buildings.get(b.id) === b;
      const flags = Number(exists && b.hp > 0) | Number(exists && buildingPresent(b)) << 1 | Number(exists && buildingReady(b)) << 2
        | Number(b.kind === 'bridge' || traversable(this.state.world, b.x, b.y)) << 3 | Number(!!b.roadPaved) << 4;
      rustEngine.sim_field_site(this.handle, b.id, BUILDING_KIND_CODES[b.kind], b.faction, b.x, b.y, flags);
    }
    this.dirty.clear();
  }
  input(values: readonly number[]): void {
    const pointer = rustEngine.sim_field_input(this.handle, values.length);
    new Float64Array(rustEngine.memory.buffer, pointer, values.length).set(values);
  }
  road(point: Point, from = point): boolean { this.flush(); return !!rustEngine.sim_field_road(this.handle, from.x, from.y, point.x, point.y); }
  conversion(foundry: Building, soldier: Unit): Float64Array {
    this.flush();
    const occupied = nearbyUnits(this.state, { x: foundry.x + 1, y: foundry.y + 1 }, 5).filter(u => u !== soldier && u.hp > 0 && !u.inside);
    const f = this.state.factions.find(f => f.id === foundry.faction);
    this.input([soldier.id, UNIT_KIND_CODES[soldier.kind], soldier.faction, soldier.x, soldier.y, soldier.hp, soldier.maxHp ?? 100,
      soldier.hp / (soldier.maxHp ?? 100), Number(!!(soldier.ranger || soldier.inside || soldier.garrison || soldier.training || soldier.fort !== undefined || soldier.villageId !== undefined || soldier.engineer || soldier.marauderPack !== undefined)),
      this.state.time, foundry.id, Number(soldier.faction === foundry.faction && researchLevel(f, 'fieldCannon') > 0), ...occupied.flatMap(u => [u.x, u.y])]);
    const pointer = rustEngine.sim_field_convert(this.handle, occupied.length);
    return new Float64Array(rustEngine.memory.buffer, pointer, ROW).slice();
  }
  step(dt: number, combat: CannonCombat): void {
    if (!this.cannons.size) return;
    this.flush();
    if (this.rosterDirty) { this.roster = [...this.cannons]; this.rosterDirty = false; }
    const start = this.cursor++ % this.roster.length;
    for (let offset = 0; offset < this.roster.length; offset++) {
      const u = this.roster[(start + offset) % this.roster.length];
      if (u.hp <= 0) continue;
      let trainingGoal: Point | undefined;
      if (u.training) updateArcheryTraining(this.state, u, dt, (_state, _unit, goal) => { trainingGoal = goal; });
      if (u.inside || u.kind !== 'fieldCannon') continue;
      const layers = nativeMoveLayers(this.state, u.faction, true);
      if (layers) rustEngine.sim_field_navigation(this.handle, u.faction, layers.engine.handle, layers.grid, layers.blockers, layers.forbidden,
        this.state.world.width, this.state.world.height, worldRevisions(this.state.world).geometry);
      const f = this.state.factions.find(f => f.id === u.faction); if (!f) continue;
      const forced = u.forcedAttack ? this.store.units.get(u.forcedAttack.target) ?? this.store.buildings.get(u.forcedAttack.target) : undefined;
      const leader = u.order === 'follow' ? this.store.units.query('leader').find(l => l.faction === u.faction && l.hp > 0) : undefined;
      const formation = leader ? infantryFormationGoal(this.state, u) ?? retinueFormation(this.state, leader).goals.get(u.id) : undefined;
      const goal = trainingGoal ?? u.destination ?? forced ?? formation ?? leader;
      const directive = offensiveDirective(this.state, u);
      const goalFlags = Number(!!u.destination) | Number(directive?.mode === 3) << 1
        | Number(directive?.mode === 1) << 2 | Number(u.order === 'follow') << 3;
      const a = combat.attack(u), w = u.fieldCannon;
      const candidates: (Unit | Building)[] = rustEngine.sim_field_due(this.handle, u.id, this.state.time) && u.cooldown <= dt && !u.training
        ? [...nearbyBuildings(this.state, u, FIELD_CANNON_RANGE + 4), ...nearbyUnits(this.state, u, FIELD_CANNON_RANGE + 4)] : [];
      const values = [u.id, u.faction, u.x, u.y, u.hp, u.speed, goal?.x ?? NaN, goal?.y ?? NaN, u.facing, u.cooldown,
        w?.shotAt ?? -1000, w?.nextUpkeepAt ?? NaN, Number(w?.funded ?? true), u.attackTime, goalFlags,
        u.forcedAttack ? u.target ?? -1 : -1, a.attack, f.gold, a.strength, f.whalingUntil && f.whalingUntil > this.state.time ? 1.05 : 1, 0, -1, 0, Number(!u.forcedAttack || !!forced && combat.validOrder(u, forced))];
      for (const target of candidates) {
        const building = 'capacity' in target, observation = combat.observe(u, target);
        values.push(target.id, target.x + (building ? buildingWidth(target) / 2 : 0), target.y + (building ? buildingHeight(target) / 2 : 0),
          observation.range, observation.defense, observation.edge, Number(observation.eligible), building ? 1 : 0,
          Number(building), Number(building && isWallKind(target.kind)), building ? BUILDING_KIND_CODES[target.kind] : UNIT_KIND_CODES[target.kind], Number(building && target.kind === 'palace' && (target.palaceLevel ?? 0) >= 2));
      }
      this.input(values);
      const pointer = rustEngine.sim_field_step(this.handle, u.id, this.state.time, dt, candidates.length);
      const r = new Float64Array(rustEngine.memory.buffer, pointer, ROW).slice();
      recordGoldOutlay(this.state, f, f.gold - r[17], 'army'); f.gold = r[17];
      u.x = r[2]; u.y = r[3]; u.facing = r[8]; u.cooldown = r[9]; u.attackTime = r[13]; u.moving = !!r[20];
      u.fieldCannon = { nextUpkeepAt: r[11], funded: !!r[12], shotAt: r[10] >= 0 ? r[10] : undefined };
      if (r[15] < 0 && u.forcedAttack) combat.finishOrder(u);
      if (r[23]) u.destination = undefined;
      const target = candidates.find(t => t.id === r[21]); if (target) combat.shoot(u, target, r[22]);
      refreshIndexedUnit(this.state, u); refreshFogUnit(this.state, u);
    }
  }
}
function network(state: GameState): CannonBridge { return networks.get(state) ?? networks.set(state, new CannonBridge(state)); }
export function fieldCannonCandidates(state: GameState, foundry: Building): Unit[] {
  return nearbyUnits(state, { x: foundry.x + 1, y: foundry.y + 1 }, 6).filter(u => u.hp > 0 && u.faction === foundry.faction && !u.inside && u.kind !== 'fieldCannon');
}
export function foundryConversionStatus(state: GameState, foundry: Building, soldier: Unit | undefined): { ok: boolean; message: string } {
  if (state.gameOver) return { ok: false, message: 'The match has ended.' };
  if (foundry.kind !== 'foundry' || foundry.faction !== playerFaction(state)) return { ok: false, message: 'Choose your own foundry.' };
  if (!buildingReady(foundry)) return { ok: false, message: 'Complete the foundry before converting soldiers.' };
  if (!entityStore(state).units.query('leader').some(unit => unit.faction === playerFaction(state) && unit.hp > 0))
    return { ok: false, message: 'A living Leader is required to use the foundry.' };
  if (!buildingActivityAvailable(state, foundry)) return { ok: false, message: 'Move your Leader within 3 tiles of the foundry.' };
  if (!soldier) return { ok: false, message: 'Bring a retinue soldier within 3 tiles of the foundry.' };
  const r = network(state).conversion(foundry, soldier);
  return { ok: !r[0], message: ERRORS[r[0]] ?? 'The conversion could not be completed. Reselect a soldier at your foundry.' };
}
export function convertFieldCannon(state: GameState, foundry: Building, soldier: Unit): { ok: boolean; message: string } {
  const status = foundryConversionStatus(state, foundry, soldier); if (!status.ok) return status;
  const r = network(state).conversion(foundry, soldier);
  entityStore(state).setUnitRole(soldier, { kind: 'fieldCannon', builder: false, collector: false });
  soldier.x = r[2]; soldier.y = r[3]; soldier.maxHp = r[4]; soldier.hp = r[5];
  soldier.attack = r[6]; soldier.defense = r[7]; soldier.speed = r[8]; soldier.range = r[9];
  soldier.fieldCannon = { nextUpkeepAt: r[10], funded: true };
  soldier.order = 'follow'; soldier.retinueStance = 'aggressive'; soldier.attackTime = 0; soldier.cooldown = 0; soldier.moving = false;
  soldier.target = undefined; soldier.destination = undefined; soldier.path = undefined; soldier.pathGoal = undefined; soldier.forcedAttack = undefined;
  soldier.training = undefined; soldier.infantryDrillLeader = undefined; soldier.joiningRetinue = undefined; soldier.retinueSquad = undefined;
  refreshIndexedUnit(state, soldier); refreshFogUnit(state, soldier);
  const soldiers = entityStore(state).units.query('soldier').filter(unit => unit.faction === soldier.faction && unit.hp > 0 && !unit.ranger && unit.marauderPack === undefined && isRetinueMember(unit));
  setRetinueFraction(state, foundry, 'fieldCannon', soldiers.filter(unit => unit.kind === 'fieldCannon').length / Math.max(1, soldiers.length));
  return { ok: true, message: 'Field cannon deployed on the road.' };
}
export function updateFieldCannons(state: GameState, dt: number, combat: CannonCombat): void { network(state).step(dt, combat); }
export function orderFieldCannon(state: GameState, unit: Unit, point: Point): { ok: boolean; message: string } {
  if (state.gameOver || unit.kind !== 'fieldCannon' || unit.hp <= 0 || unit.faction !== playerFaction(state)) return { ok: false, message: 'Choose your field cannon.' };
  if (!canWalk(state, point.x, point.y, unit.faction)) return { ok: false, message: 'Choose reachable ground for the field cannon.' };
  interruptOutboundTraining(state, unit);
  unit.destination = { x: Math.floor(point.x) + .5, y: Math.floor(point.y) + .5 };
  unit.target = undefined; unit.forcedAttack = undefined; unit.order = 'hold';
  requestFieldCannonDecision(state, unit);
  return { ok: true, message: 'Destination set.' };
}

export function fieldCannonRoadPoint(state: GameState, point: Point, from = point): boolean { return network(state).road(point, from); }
export function requestFieldCannonDecision(state: GameState, unit: Unit): void { rustEngine.sim_field_order(simCore(state).handle, unit.id); }
export function fieldCannonPathStatus(state: GameState, unit: Unit) {
  const pointer = rustEngine.sim_field_status(simCore(state).handle, unit.id);
  const values = new Float64Array(rustEngine.memory.buffer, pointer, 12);
  const point = (index: number): Point | undefined => Number.isFinite(values[index]) ? { x: values[index], y: values[index + 1] } : undefined;
  return { requested: point(0), goal: point(2), waypoint: point(4), nextPlan: values[6], nextThink: values[7],
    holdUntil: values[8], rejectedComponents: values[9], geometryRevision: values[10], goalFlags: values[11] };
}
