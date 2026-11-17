import { warshipGunPoint } from './warship-layout';
import { shipName } from './ship-names';
import { rustEngine } from './rust-engine';
import { SimSlot, simCore } from './sim-handle';
import { entityStore, type EntityStore, type EntityObserver } from './entity-store';
import { cityOwnership } from './city-ownership';
import { citySummariesForFaction } from './cities';
import { researchLevel } from './research';
import { atWar } from './relations';
import { playerFaction, isHumanFaction, withPlayerFaction } from './player-context';
import { worldRevisions, worldSightChangesSince } from './world-revisions';
import { mountainTerrainHandle } from './terrain-rays-native';
import { navigableWaterCell } from './water-navigation';
import { traversable,canWalk } from './pathfinding';
import { withSimulationReads } from './simulation-reads';
import { reliefLevel } from './relief';
import { observeScalars, type ScalarObserver } from './scalar-observer';
import { tileAt,WATER } from './types';
import { refreshIndexedUnit, nearbyUnits } from './spatial';
import { refreshFogUnit, entityVisible } from './fog';
import { refreshWaterTraffic } from './water-traffic';
import { recordGoldInput, spendGold } from './gold-ledger';
import { recallRetinue, buildAt, cancelConstruction } from './simulation';
import { buildingActivityAvailable } from './building-activity';
import { buildingWidth, buildingHeight, buildingReady, type GameState, type Unit, type Building, type Point, type InputState,
  type WarshipClass, type NavalWeapon, type MarineType, type ResearchBranchId } from './types';

export const SHIP_CLASSES: readonly WarshipClass[] = ['warGalley', 'caravel', 'frigate'];
export const NAVAL_WEAPONS: readonly NavalWeapon[] = ['empty', 'ballista', 'cannon'];
export const MARINE_TYPES: readonly MarineType[] = ['warrior', 'spearman', 'archer', 'musketman'];
export const SHIP_LABELS = { warGalley: 'War galley', caravel: 'Caravel', frigate: 'Frigate' } as const;
export const WEAPON_LABELS = { empty: 'Empty', ballista: 'Ballista', cannon: 'Cannon' } as const;
export const SHIP_BUILD_GOLD = rustEngine.naval_constant(0, 0);
export const SHIP_UPKEEP = rustEngine.naval_constant(1, 0);
export const SHIP_BOUNTY = rustEngine.naval_constant(2, 0);
const STRIDE = 68;
const TECHS: readonly ResearchBranchId[] = ['sailing', 'lateenSails', 'navalEngineering', 'siegeEngines', 'gunpowder', 'archeryRange', 'militaryTactics'];
const ERRORS = ['', 'A shipyard needs a city of at least 100 people.', 'Only one shipyard per city.',
  'A shipyard needs a clear 3×3 area of flat, dry land.', 'Move your Leader within 3 tiles of your completed shipyard.',
  'Research the technologies required by this ship, weapon or marine type.', 'This shipyard already supports a warship.',
  'Need 500 gold.', 'Return this warship within 9 tiles of its own shipyard.', 'Clear enough water beside the shipyard for a 2×5 warship.',
  'Choose clear land within 2 tiles of this ship.', 'Move your Leader to the shore beside this warship.',
  'A living Leader is required.', 'Board this warship with your Leader first.',
  'Disembark from your current boat before boarding another.', 'This warship already has a Leader aboard.',
  'Wait for this warship to finish building.', 'Cast anchor before going ashore or calling reinforcements.',
  'Wait for boarding combat to end.', 'Bring your Leader aboard or within 3 tiles of this warship’s landing point.',
  'Raise anchor before sailing.', 'Choose navigable water for this warship.', 'Choose your own surviving warship.',
  'Build a warship at this shipyard before refitting.', 'Refitting cannot change the hull. Select this warship’s current class.',
  'Research Sailing before building warships.', 'Research Lateen Sails for caravels and frigates.',
  'Research Naval Engineering for frigates.', 'Research Siege Engines before mounting ballistae or cannons.',
  'Research Gunpowder for cannons and musket marines.', 'Research Archery for archer marines.',
  'Research Military Tactics for spear marines.', 'Choose a valid ship class, weapon and marine type.',
  'Remove weapons from mounts this hull does not support.', 'Complete the shipyard before building or refitting.',
  'Place at least one shipyard edge beside coastal water.', 'Your Leader is already aboard this warship.',
  'Equip a ranged weapon or ranged marines to attack from this ship.', 'Choose a visible enemy unit to attack.',
  'No clear water is within firing range of that target. Approach from another shore.'];
const navalError = (code: number): string => ERRORS[code] || 'This naval order could not be completed. Select the ship or shipyard again.';
const networks = new SimSlot<NavalBridge>();
const sinkRevisions = new SimSlot<number>();
export interface NavalLoadout { class: WarshipClass; marine: MarineType; weapons: NavalWeapon[] }
type Result = { ok: boolean; message: string; code?: number };
export interface NavalCombat {
  observe(ship: Unit,target: Unit): { eligible: boolean; defense: number };
  shoot(ship: Unit,target: Unit,slot: number,damage: number): void;
}
function technologyMask(state: GameState, faction: number): number {
  const owner = state.factions.find(f => f.id === faction);
  return TECHS.reduce((mask, branch, i) => mask | Number(researchLevel(owner, branch) > 0) << i, 0);
}
export const warships = (state: GameState): readonly Unit[] => entityStore(state).units.query('vessel').filter(u => !!u.warship);
export const shipyardWarship = (state: GameState, yard: Building): Unit | undefined => warships(state).find(s => s.hp > 0 && s.warship!.yard === yard.id);
export function shipRank(ship: Unit): string { return ['Untrained', 'Regular', 'Veteran', 'Hardened', 'Elite'][Math.min(4, Math.floor((ship.warship?.kills ?? 0) / 2))]; }
class NavalBridge implements ScalarObserver {
  private nextTargets = -Infinity;
  private targets: { ship: number; unit: number; eligible: boolean; defense: number }[] = [];
  orderChanged(): void { this.nextTargets=-Infinity; }
  readonly handle: number;
  readonly store: EntityStore;
  private terrain = -1;
  private source?: GameState['world'];
  private cursor?: number;
  private base = new Float64Array(0);
  private blocked = new Uint16Array(0);
  private footprints = new Map<Building, number[]>();
  private dirty = new Set<Building>();
  private observer: EntityObserver<Building>;
  constructor(state: GameState) {
    this.store = entityStore(state); void this.store.units; void this.store.buildings; this.handle = simCore(state).handle;
    this.observer = { added: b => this.track(b), removed: b => this.dirty.add(b), changed: b => this.track(b) };
    this.store.buildings.observe(this.observer);
    for (const b of state.buildings) this.track(b);
  }
  private track(b: Building): void { this.dirty.add(b); observeScalars(b, ['kind', 'x', 'y', 'hp'], this); }
  changed(target: object, key: string, before: unknown, after: unknown): void {
    if (key !== 'hp' || (Number(before) > 0) !== (Number(after) > 0)) this.dirty.add(target as Building);
  }
  input(values: readonly number[]): void {
    const pointer = rustEngine.sim_naval_input(this.handle, values.length);
    new Float64Array(rustEngine.memory.buffer, pointer, values.length).set(values);
  }
  geometry(state: GameState): void {
    const { width, height } = state.world, revision = worldRevisions(state.world).geometry;
    const replacement = this.source !== state.world || this.base.length !== width * height;
    const changes = replacement || revision !== this.terrain ? worldSightChangesSince(state.world, replacement ? undefined : this.cursor) : undefined;
    const full = replacement || !!changes?.full;
    if (!full && !changes?.cells.length && !this.dirty.size) return;
    this.source = state.world; this.terrain = revision; if (changes) this.cursor = changes.revision;
    if (full) {
      this.base = new Float64Array(width * height); this.blocked = new Uint16Array(width * height); this.footprints.clear();
      for (const b of state.buildings) this.dirty.add(b);
    }
    const cells = new Set<number>();
    const sample = (i: number): void => {
      const x = i % width, y = Math.floor(i / width);
      const tile=tileAt(state.world,x,y);
      this.base[i] = (navigableWaterCell(state.world, x, y) ? 1 : traversable(state.world, x, y) ? 2 : 0)
        + reliefLevel(tile) * 4 + (tile?.terrain==='coast'?128:0);
      if (!full) cells.add(i);
    };
    if (full) for (let i = 0; i < this.base.length; i++) sample(i);
    else for (const i of changes?.cells ?? []) sample(i);
    for (const b of this.dirty) {
      for (const i of this.footprints.get(b) ?? []) { this.blocked[i]--; cells.add(i); }
      const occupied: number[] = [];
      // Crops are replaceable during ordinary shipyard construction. They
      // must not hide otherwise valid shore sites from the native planner.
      if (this.store.buildings.get(b.id) === b && b.hp > 0 && !['irrigation', 'road', 'camp', 'shack', 'cottage'].includes(b.kind))
        for (let dy = 0; dy < buildingHeight(b); dy++) for (let dx = 0; dx < buildingWidth(b); dx++) {
          const x = b.x + dx, y = b.y + dy;
          if (x >= 0 && y >= 0 && x < width && y < height) { const i = y * width + x; occupied.push(i); this.blocked[i]++; cells.add(i); }
        }
      if (occupied.length) this.footprints.set(b, occupied); else this.footprints.delete(b);
    }
    this.dirty.clear();
    if (full) {
      const pointer = rustEngine.sim_naval_input(this.handle, this.base.length), data = new Float64Array(rustEngine.memory.buffer, pointer, this.base.length);
      for (let i = 0; i < this.base.length; i++) data[i] = this.blocked[i] ? 0 : this.base[i];
      rustEngine.sim_naval_geometry(this.handle, width, height);
    } else if (cells.size) {
      const values: number[] = []; for (const i of cells) values.push(i, this.blocked[i] ? 0 : this.base[i]);
      this.input(values); rustEngine.sim_naval_patch(this.handle, cells.size);
    }
  }
  sync(state: GameState, dt: number, inputFor: (faction: number) => InputState = () => ({ up: false, down: false, left: false, right: false }), onDeath?: (unit: Unit, attacker: number) => void, combat?: NavalCombat): void {
    const ships = warships(state); if (!ships.length) return;
    if (dt>0 && combat && state.time>=this.nextTargets) {
      this.nextTargets=state.time+1; this.targets=[];
      for (const ship of ships) {
        const nearby = new Map(nearbyUnits(state,ship,17).map(unit=>[unit.id,unit]));
        const ordered = this.store.units.get(ship.warship!.attackTarget ?? -1); if (ordered) nearby.set(ordered.id,ordered);
        for (const unit of nearby.values()) if (!unit.warship && !unit.inside && unit.hp>0 && atWar(state,ship.faction,unit.faction)) {
          this.targets.push({ship:ship.id,unit:unit.id,...combat.observe(ship,unit)});
        }
      }
    }
    this.geometry(state);
    rustEngine.sim_naval_terrain(this.handle, mountainTerrainHandle(state.world));
    const values: number[] = [];
    for (const ship of ships) {
      const w = ship.warship!, control = ship.sailboat?.passenger !== undefined ? inputFor(ship.faction) : undefined;
      const forward = control ? Number(control.up) - Number(control.down) : 0;
      const turn = control ? Number(control.right || control.turnRight) - Number(control.left || control.turnLeft) : 0;
      const row = Array<number>(STRIDE).fill(0);
      row[0] = ship.id; row[1] = SHIP_CLASSES.indexOf(w.class); row[2] = ship.faction; row[3] = ship.x; row[4] = ship.y;
      row[5] = ship.facing; row[6] = ship.hp; row[7] = w.speed; row[8] = w.kills; row[9] = MARINE_TYPES.indexOf(w.marine);
      row[10] = w.crewHp; row[11] = Number(w.anchored); row[12] = w.readyAt; row[13] = w.nextUpkeepAt; row[14] = Number(w.funded);
      for (let i = 0; i < 4; i++) row[15 + i] = NAVAL_WEAPONS.indexOf(w.weapons[i] ?? 'empty');
      for (let i = 0; i < 12; i++) {
        const gun = w.guns?.[i], at = 31 + i * 3;
        row[at] = gun?.target ?? -1; row[at + 1] = gun?.facing ?? ship.facing; row[at + 2] = gun?.firedAt ?? -1000;
      }
      row[19] = w.yard; row[20] = ship.destination?.x ?? NaN; row[21] = ship.destination?.y ?? NaN;
      row[22] = forward; row[23] = turn; row[24] = Number(!!forward || !!turn || !!control?.up && !!control?.down);
      row[25] = w.lastAttacker; row[26] = Number(w.rewarded); row[30] = w.lastAttackerShip ?? -1; row[29] = Number(!isHumanFaction(state, ship.faction));
      row[67] = w.attackTarget ?? -1; values.push(...row);
    }
    for (const f of state.factions) values.push(f.id, f.gold, technologyMask(state, f.id), f.whalingUntil ?? 0);
    let relations = 0;
    const factions = new Set([...state.factions.map(f=>f.id),...ships.map(s=>s.faction)]);
    for (const target of this.targets) { const unit=this.store.units.get(target.unit); if (unit) factions.add(unit.faction); }
    for (const a of factions) for (const b of factions) if (a !== b && atWar(state,a,b)) { values.push(a,b); relations++; }
    let targets=0;
    if (dt>0 && combat) for (const target of this.targets) {
      const unit=this.store.units.get(target.unit); if (!unit) continue;
      values.push(target.ship,unit.id,unit.x,unit.y,unit.faction,unit.hp,target.defense,Number(target.eligible && !unit.inside && unit.embarkedOn===undefined)); targets++;
    }
    const yards = this.store.buildings.query('shipyard').filter(yard => buildingReady(yard) && yard.hp > 0);
    values.push(yards.length);
    for (const yard of yards) values.push(yard.faction,yard.x,yard.y);
    this.input(values);
    const pointer = rustEngine.sim_naval_step(this.handle, ships.length, state.factions.length, relations,targets,state.time,dt);
    // Copy before effects can call another engine and grow WASM memory.
    const output = new Float64Array(rustEngine.memory.buffer,pointer,rustEngine.sim_naval_output_length(this.handle)).slice();
    if (dt <= 0) return;
    for (let i = 0; i < output[0]; i++) {
      const r = output.subarray(2 + i * STRIDE), ship = this.store.units.get(r[0]); if (!ship?.warship) continue;
      const w = ship.warship, previous = { x: ship.x, y: ship.y, hp: ship.hp };
      ship.x = r[3]; ship.y = r[4]; ship.facing = r[5]; ship.hp = r[6]; w.speed = r[7]; w.kills = r[8]; w.crewHp = r[10];
      w.anchored = !!r[11]; w.nextUpkeepAt = r[13]; w.funded = !!r[14]; w.lastAttacker = r[25]; w.rewarded = !!r[26];
      w.boarding = r[27] < 0 ? undefined : r[27]; w.target = r[29] < 0 ? undefined : r[29]; w.lastAttackerShip = r[30] < 0 ? undefined : r[30];
      w.guns ??= Array.from({ length: 12 }, () => ({ facing: ship.facing }));
      for (let slot = 0; slot < 12; slot++) {
        const at = 31 + slot * 3, gun = w.guns[slot], target = this.store.units.get(r[at]);
        gun.target = r[at] < 0 ? undefined : r[at]; gun.facing = r[at + 1];
        if (r[at + 2] >= 0 && gun.firedAt !== r[at + 2]) {
          gun.firedAt = r[at + 2];
          if (target) gun.shot = { from: warshipGunPoint(ship, slot), to: { x: target.x, y: target.y }, time: gun.firedAt,projectile:!target.warship };
        }
      }
      ship.destination = Number.isFinite(r[20]) ? { x: r[20], y: r[21] } : undefined;
      ship.moving = Math.hypot(previous.x - ship.x, previous.y - ship.y) > .001;
      if (ship.hp < previous.hp) { ship.lastDamagedAt = state.time; ship.damageFlashAt = state.time; }
      if (r[22]) ship.healerHealingAt = state.time;
      for (const id of w.passengers ?? []) {
        const passenger = this.store.units.get(id); if (!passenger || passenger.embarkedOn !== ship.id) continue;
        passenger.x = ship.x; passenger.y = ship.y; passenger.facing = ship.facing;
        if (ship.hp <= 0 && passenger.hp > 0) { passenger.hp = 0; passenger.inside = false; passenger.embarkedOn = undefined; onDeath?.(passenger, w.lastAttacker); }
        refreshIndexedUnit(state, passenger); refreshFogUnit(state, passenger);
      }
      if (ship.hp <= 0) { ship.sailboat!.passenger = undefined; w.passengers = []; if (previous.hp > 0) onDeath?.(ship, w.lastAttacker); }
      refreshIndexedUnit(state, ship); refreshFogUnit(state, ship); refreshWaterTraffic(state, ship);
    }
    const start = 2 + output[0] * STRIDE;
    for (let i = 0; i < output[1]; i++) {
      const at = start + i * 3, faction = state.factions.find(f => f.id === output[at]); if (!faction) continue;
      if (output[at + 1]) spendGold(state, faction, output[at + 1], 'army');
      if (output[at + 2]) { faction.gold += output[at + 2]; recordGoldInput(state, faction, output[at + 2], 'loot'); }
    }
    const shotStart = start+output[1]*3, shotCount=output[shotStart];
    for (let i=0;i<shotCount;i++) {
      const at=shotStart+1+i*4, ship=this.store.units.get(output[at]), target=this.store.units.get(output[at+1]);
      if (ship?.warship && target && target.hp>0) combat?.shoot(ship,target,output[at+2],output[at+3]);
    }
  }
  command(state: GameState, mode: number, values: readonly number[]): Float64Array {
    this.sync(state, 0); this.geometry(state); this.input(values);
    const pointer = rustEngine.sim_naval_command(this.handle, mode);
    return new Float64Array(rustEngine.memory.buffer, pointer, 5).slice();
  }
}
function network(state: GameState): NavalBridge {
  let n = networks.get(state); if (!n || n.store !== entityStore(state)) n = networks.set(state, new NavalBridge(state)); return n;
}
export function updateWarships(state: GameState, dt: number, inputFor: (faction: number) => InputState, onDeath?: (unit: Unit, attacker: number) => void, combat?: NavalCombat): void {
  network(state).sync(state, dt, inputFor, onDeath,combat);
  if (warships(state).length || state.shipSinkings?.length) publishWarshipSinkings(state);
}
function publishWarshipSinkings(state: GameState): void {
  const p = rustEngine.sim_naval_sinks(simCore(state).handle, state.time);
  const [revision, count] = new Float64Array(rustEngine.memory.buffer, p, 2);
  if (sinkRevisions.get(state) === revision) return;
  sinkRevisions.set(state, revision);
  const rows = new Float64Array(rustEngine.memory.buffer, p + 16, count * 7);
  state.shipSinkings = Array.from({ length: count }, (_, i) => {
    const at=i*7; return { id:rows[at], x:rows[at+1], y:rows[at+2], facing:rows[at+3], class:SHIP_CLASSES[rows[at+4]], faction:rows[at+5], time:rows[at+6] };
  });
}
function context(state: GameState, ship?: Unit, yard?: Building, point?: Point, loadout?: NavalLoadout): number[] {
  const faction = ship?.faction ?? yard?.faction ?? playerFaction(state), leader = entityStore(state).units.query('leader').find(u => u.faction === faction && u.hp > 0);
  const w = loadout ?? ship?.warship, city = yard ? cityOwnership(state).building(yard) : undefined;
  return [faction, ship?.id ?? -1, yard?.id ?? -1, yard?.x ?? point?.x ?? 0, yard?.y ?? point?.y ?? 0,
    city ? citySummariesForFaction(state, faction).find(c => c.palace.id === city.id)?.population ?? 0 : 0,
    0, Number(!!yard && buildingReady(yard)), Number(!!yard && buildingActivityAvailable(state, yard)),
    state.factions.find(f => f.id === faction)?.gold ?? 0, technologyMask(state, faction), SHIP_CLASSES.indexOf(w?.class ?? 'warGalley'),
    MARINE_TYPES.indexOf(w?.marine ?? 'warrior'), ...Array.from({ length: 4 }, (_, i) => NAVAL_WEAPONS.indexOf(w?.weapons[i] ?? 'empty')),
    leader?.x ?? NaN, leader?.y ?? NaN, point?.x ?? NaN, point?.y ?? NaN, state.time, leader?.id ?? -1, leader?.embarkedOn ?? -1, ship?.sailboat?.passenger ?? -1, leader?.hp ?? 0];
}
/** Actual faction walking facts include open gates, ruins and elevated banks;
 * native commands alone apply hull distance and boarding/anchor rules. */
function shoreFacts(state:GameState,ship:Unit):number[]{
  return withSimulationReads(state,()=>{
    const points:number[]=[];
    for(let dy=-5;dy<=5;dy++)for(let dx=-5;dx<=5;dx++){
      const x=Math.floor(ship.x)+dx+.5,y=Math.floor(ship.y)+dy+.5,tile=tileAt(state.world,x,y);
      if(tile&&!WATER.has(tile.terrain)&&canWalk(state,x,y,ship.faction))points.push(x,y);
    }
    return [points.length/2,...points];
  });
}
export function shipyardSiteError(state: GameState, faction: number, point: Point): string | undefined {
  const city = cityOwnership(state).nearest({ x: point.x + 1.5, y: point.y + 1.5 }, faction);
  const values = context(state, undefined, undefined, point); values[0] = faction;
  values[5] = city ? citySummariesForFaction(state, faction).find(c => c.palace.id === city.id)?.population ?? 0 : 0;
  values[6] = entityStore(state).buildings.query('shipyard').filter(y => y.hp > 0 && y.faction === faction && cityOwnership(state).building(y)?.id === city?.id).length;
  const result = network(state).command(state, 0, values); return result[0] ? navalError(result[0]) : undefined;
}
export function shipyardOnCoast(state:GameState,yard:Building):boolean {
  return network(state).command(state,13,context(state,undefined,yard))[0]===0;
}
export function shipyardOrder(state: GameState, yard: Building, loadout: NavalLoadout, refit = false, automatic = false): Result {
  if (yard.faction !== playerFaction(state) || yard.kind !== 'shipyard') return { ok: false, message: 'Choose your own shipyard.' };
  const ship = shipyardWarship(state, yard), values = context(state, ship, yard, undefined, loadout);
  if (automatic && (state.scenarioPreparing||!isHumanFaction(state, yard.faction))) values[8] = 1;
  const result = network(state).command(state, refit ? 2 : 1, values);
  if (result[0]) return { ok: false, message: navalError(result[0]),code:result[0] };
  if (refit && ship?.warship) {
    ship.warship.marine = loadout.marine; ship.warship.weapons = [...loadout.weapons];
  } else {
    const id = entityStore(state).allocateId(), index = SHIP_CLASSES.indexOf(loadout.class), hp = rustEngine.naval_constant(8, index);
    const name = shipName(state, yard.faction, id);
    entityStore(state).units.add({ id, kind: 'sailboat', faction: yard.faction, x: result[1], y: result[2], facing: result[3],
      hp, maxHp: hp, morale: 100, attack: 0, defense: 4, speed: rustEngine.naval_constant(6, index), range: 14,
      order: 'hold', cooldown: 0, lastCombat: -100, moving: false, attackTime: 0, sailboat: { dock: yard.id },
      warship: { class: loadout.class, name, yard: yard.id, speed: 0, kills: 0, marine: loadout.marine, crewHp: rustEngine.naval_constant(9, index),
        weapons: [...loadout.weapons], anchored: false, readyAt: state.time + rustEngine.naval_constant(5, index), nextUpkeepAt: state.time + 30,
        funded: true, lastAttacker: -1, rewarded: false } });
    spendGold(state, state.factions.find(f => f.id === yard.faction)!, result[4], 'construction');
  }
  return { ok: true, message: refit ? 'Warship refitted.' : 'Warship building.' };
}
export function warshipAction(state: GameState, ship: Unit, action: 'anchor' | 'land' | 'reinforce' | 'board', point?: Point): Result {
  const leader = entityStore(state).units.query('leader').find(u => u.faction === playerFaction(state) && u.hp > 0);
  if (!leader) return { ok: false, message: navalError(12) };
  if (!ship.warship || ship.faction !== leader.faction || ship.hp <= 0) return { ok: false, message: navalError(22) };
  const mode = { anchor: 3, land: 4, board: 5, reinforce: 6 }[action];
  const values = context(state, ship, undefined, point ?? (action === 'board' ? { x: Math.floor(leader.x) + .5, y: Math.floor(leader.y) + .5 } : undefined));
  values.push(...shoreFacts(state,ship));
  const result = network(state).command(state, mode, values); if (result[0]) return { ok: false, message: navalError(result[0]) };
  const w = ship.warship;
  if (action === 'anchor') {
    w.anchored = !!result[3]; w.shore = w.anchored ? { x: result[1], y: result[2] } : undefined;
    w.speed = 0; ship.destination = undefined;
  } else if (action === 'board') {
    w.passengers = [leader.id, ...entityStore(state).units.query('retinue').filter(u => u.faction === leader.faction && u.hp > 0 && !u.garrison).map(u => u.id)];
    for (const id of w.passengers) { const u = entityStore(state).units.get(id)!; u.inside = true; u.embarkedOn = ship.id;
      u.x = ship.x; u.y = ship.y; u.target = undefined; u.path = undefined; u.destination = undefined; u.moving = false;
      refreshIndexedUnit(state, u); refreshFogUnit(state, u); }
    leader.boardingBoat = undefined; ship.sailboat!.passenger = leader.id; w.speed = 0;
    state.selected = ship.id; state.selectedType = 'unit';
  } else if (action === 'land') {
    for (const id of w.passengers ?? []) { const u = entityStore(state).units.get(id); if (!u || u.hp <= 0 || u.embarkedOn !== ship.id) continue;
      u.embarkedOn = undefined; u.inside = false; u.x = result[1]; u.y = result[2]; u.path = undefined; u.destination = undefined;
      refreshIndexedUnit(state, u); refreshFogUnit(state, u); }
    ship.sailboat!.passenger = undefined; w.passengers = []; state.selected = leader.id; state.selectedType = 'unit';
  } else { w.crewHp = result[3]; w.reinforcing = true; recallRetinue(state); }
  return { ok: true, message: action === 'anchor' ? w.anchored ? 'Anchor cast.' : 'Anchor raised.' : action === 'land' ? 'Leader and retinue ashore.' : action === 'board' ? 'Leader and retinue aboard.' : 'Reinforcements issued.' };
}
export function warshipActionAvailable(state: GameState, ship: Unit, action: 'anchor' | 'land' | 'reinforce'): boolean {
  if (!ship.warship || ship.hp <= 0) return false;
  return network(state).command(state, { anchor: 3, land: 4, reinforce: 6 }[action], [...context(state, ship),...shoreFacts(state,ship)])[0] === 0;
}
export function warshipMove(state: GameState, ship: Unit, point: Point): Result {
  const r = network(state).command(state, 7, context(state, ship, undefined, point));
  if (r[0]) return { ok: false, message: navalError(r[0]) };
  ship.warship!.attackTarget=undefined; ship.destination = { x: r[1], y: r[2] }; return { ok: true, message: 'Sailing.' };
}
export function warshipAttack(state: GameState,ship: Unit,target: Unit): Result {
  if (!ship.warship || ship.faction!==playerFaction(state)) return {ok:false,message:navalError(22)};
  const values=context(state,ship,undefined,target);
  values.push(Number(target.hp>0 && !target.inside && atWar(state,ship.faction,target.faction) && entityVisible(state,target)),target.id);
  const native=network(state), result=native.command(state,12,values);
  if (result[0]) return {ok:false,message:navalError(result[0])};
  ship.warship.attackTarget=target.id;ship.destination={x:result[1],y:result[2]};native.orderChanged();
  return {ok:true,message:'Moving into firing range.'};
}

export function settleWarshipBounty(state: GameState, ship: Unit, attacker: number): number {
  const values = context(state, ship); values[8] = Number(atWar(state, attacker, ship.faction));
  const r = network(state).command(state, 9, values); ship.warship!.rewarded = !!r[3]; ship.warship!.lastAttacker = attacker; return r[4];
}

const aiClocks = new SimSlot<{ next: number; city: number; yard: number }>();
/** One city and one yard per second. Rust selects purchases and candidate sites;
 * existing construction commands perform border, occupancy and builder checks. */
export function updateNavalEmpires(state: GameState): void {
  const clock = aiClocks.get(state) ?? aiClocks.set(state, { next: 0, city: 0, yard: 0 });
  if (state.time < clock.next) return; clock.next = state.time + 1;
  const cities = entityStore(state).buildings.query('palace'), yards = entityStore(state).buildings.query('shipyard');
  if (cities.length) {
    const city = cities[clock.city++ % cities.length];
    if (!isHumanFaction(state, city.faction) && buildingReady(city)) {
      const values = context(state, undefined, city); values[2] = city.id;
      values[5] = citySummariesForFaction(state, city.faction).find(c => c.palace.id === city.id)?.population ?? 0;
      values[6] = yards.filter(y => y.hp > 0 && y.faction === city.faction && cityOwnership(state).building(y)?.id === city.id).length;
      const r = network(state).command(state, 8, values);
      if (!r[0]) withPlayerFaction(state, city.faction, () => buildAt(state, 'shipyard', r[1], r[2], city.faction));
    }
  }
  if (yards.length) {
    const yard = yards[clock.yard++ % yards.length];
    if (!isHumanFaction(state, yard.faction) && buildingReady(yard)) {
      const r = network(state).command(state, 10, context(state, undefined, yard));
      if (!r[0]) {
        const count = rustEngine.naval_constant(7, r[1]);
        const loadout = { class: SHIP_CLASSES[r[1]], marine: MARINE_TYPES[r[2]], weapons: Array.from({ length: 4 }, (_, i) => i < count ? NAVAL_WEAPONS[r[3]] : 'empty' as const) };
        withPlayerFaction(state, yard.faction, () => shipyardOrder(state, yard, loadout, false, true));
      }
    }
  }
}

/** Apply the native/ordinary combat sink event before cleanup removes the hull. */
export function resolveWarshipLoss(state: GameState, ship: Unit, attacker: number, onDeath: (unit: Unit, attacker: number) => void): void {
  const w = ship.warship; if (!w || ship.hp > 0) return;
  rustEngine.sim_naval_record_sink(simCore(state).handle, ship.id, ship.x, ship.y, ship.facing, SHIP_CLASSES.indexOf(w.class), ship.faction, state.time);
  publishWarshipSinkings(state);
  for (const id of w.passengers ?? []) {
    const unit = entityStore(state).units.get(id); if (!unit || unit.hp <= 0 || unit.embarkedOn !== ship.id) continue;
    unit.hp = 0; unit.inside = false; unit.embarkedOn = undefined; onDeath(unit, attacker);
    refreshIndexedUnit(state, unit); refreshFogUnit(state, unit);
  }
  w.passengers = []; if (ship.sailboat) ship.sailboat.passenger = undefined;
}

const reinforcementPlans = new SimSlot<WeakMap<Unit, { next: number; goal?: Point }>>();
/** Native boarding decisions run once a second per arriving replacement. */
export function warshipReinforcementGoal(state: GameState, member: Unit): Point | undefined {
  const leader = entityStore(state).units.query('leader').find(u => u.faction === member.faction && u.hp > 0);
  const ship = leader?.embarkedOn === undefined ? undefined : entityStore(state).units.get(leader.embarkedOn);
  if (!ship?.warship?.reinforcing || !ship.warship.anchored) return undefined;
  const plans = reinforcementPlans.get(state) ?? reinforcementPlans.set(state, new WeakMap());
  const old = plans.get(member); if (old && state.time < old.next) return old.goal;
  const values = context(state, ship); values.push(Number(ship.warship.reinforcing), member.x, member.y, member.hp, member.faction);
  values.push(...shoreFacts(state,ship));
  const r = network(state).command(state, 11, values);
  const goal = !r[0] && !r[3] ? { x: r[1], y: r[2] } : undefined; plans.set(member, { next: state.time + 1, goal });
  if (!r[0] && r[3]) {
    member.inside = true; member.embarkedOn = ship.id; member.x = ship.x; member.y = ship.y;
    member.path = undefined; member.destination = undefined; member.target = undefined; member.moving = false;
    (ship.warship.passengers ??= []).push(member.id); refreshIndexedUnit(state, member); refreshFogUnit(state, member);
  }
  return goal;
}

/** The offline scenario bake issues native site and purchase commands.
 * Normal builders complete the selected foundations before the save is written. */
const scenarioYardFailures = new SimSlot<Map<number, Point[]>>();
export function prepareScenarioFleet(state: GameState, place: (faction: number, x: number, y: number) => boolean, retire?: (yard: Building)=>void): boolean {
  let ready = true;
  const failures = scenarioYardFailures.get(state) ?? scenarioYardFailures.set(state,new Map());
  const cities = entityStore(state).buildings.query('palace').filter(city => city.scenarioCity);
  for (const city of cities) {
    const yard = entityStore(state).buildings.query('shipyard').find(y => y.faction === city.faction && cityOwnership(state).building(y)?.id === city.id);
    if (!yard) {
      ready = false;
      const values = context(state, undefined, city); values[2] = city.id;
      values[5] = citySummariesForFaction(state, city.faction).find(c => c.palace.id === city.id)?.population ?? 0;
      for (let attempt=0;attempt<16;attempt++) {
        const r = network(state).command(state, 8, values);
        if (!r[0] && !(failures.get(city.id) ?? []).some(p=>Math.hypot(p.x-r[1],p.y-r[2])<6)
          && place(city.faction, r[1], r[2])) break;
      }
    } else if (!buildingReady(yard)) {
      ready = false;
      if (yard.construction?.waitingForBuilder && state.time-yard.construction.startedAt > 180
        && cancelConstruction(state,yard.id,city.faction).ok) {
        const sites = failures.get(city.id) ?? []; sites.push({x:yard.x,y:yard.y}); failures.set(city.id,sites);
      }
    }
    else if (!shipyardWarship(state, yard)) {
      ready = false;
      const order=withPlayerFaction(state, city.faction, () => shipyardOrder(state, yard,
        { class:'caravel', marine:'archer', weapons:['ballista','ballista','ballista','empty'] }, false, true));
      if(order.code===9&&retire){retire(yard);const sites=failures.get(city.id)??[];sites.push({x:yard.x,y:yard.y});failures.set(city.id,sites);}
    } else if (shipyardWarship(state,yard)!.warship!.readyAt > state.time) ready = false;
  }
  return ready;
}

export function fleetUpkeep(state: GameState, faction: number): number { return rustEngine.naval_fleet_upkeep(warships(state).filter(s => s.faction === faction && s.hp > 0).length); }
