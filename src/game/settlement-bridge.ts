import { observeScalars, type ScalarObserver } from './scalar-observer';
import { rustEngine } from './rust-engine';
import { SETTLEMENT_CONSTANTS } from './settlement-constants';
export { SETTLEMENT_CONSTANTS } from './settlement-constants';
import { SIM_ENGINE, SimSlot, simCore, type SimCore } from './sim-handle';
import { entityStore, type EntityObserver } from './entity-store';
import { isHumanFaction } from './player-context';
import { nativeMovement } from './movement-native';
import { cityResidents } from './cities';
import { buildingHeight, buildingReady, buildingWidth, type Building, type BuildingKind, type Faction, type GameState,
  type GameEvent, type NeutralVillage, type Point, type VillageIdentity, type VillageRelation } from './types';

/** Encoding only. Every rule lives in rust/src/settlement.rs; this module
 * packs host rows, steps the engine, copies its outbox and keeps views. */
const constant = (index: number): number => rustEngine.settlement_constant(index);
export const STRIDE = { faction: constant(100), upsert: constant(101), civic: constant(102), result: constant(103), changed: constant(104),
  event: constant(105), request: constant(106), spawn: constant(107), charge: constant(108), breakdown: constant(109), status: constant(114), header: constant(115) };
export const EVENT = { secede: 1, petition: 2, stage: 3, adopted: 4, relation: 5, aiConfederate: 6, slotSkipped: 7, aiTrade: 8 } as const;
export const ACTION = { trade: 1, ally: 2, confederate: 3, war: 4, petition: 5 } as const;
export const REACH = { near: 1, remote: 2, leader: 4, realm: 8, ai: 16 } as const;
export const TRANSFER = { secede: 1, capture: 2, confederateVillage: 3, confederateCivilization: 4 } as const;
export const FLAG = { warning: 1, grace: 2, secede: 4, petition: 8, removed: 16 } as const;
const RELATIONS: VillageRelation[] = ['neutral', 'trade', 'allied', 'war'];
const RELATION_CODE: Record<VillageRelation, number> = { neutral: 0, trade: 1, allied: 2, war: 3 };
export const IDENTITY_CODE: Record<VillageIdentity, number> = { growers: 0, merchants: 1, builders: 2, scholars: 3 };
export const STAGE_NAMES = ['camp', 'hamlet', 'village', 'large village', 'town'] as const;
export const FAMILY_NAMES = ['', 'Roadside', 'Market cross', 'Riverside', 'Hill cluster'] as const;

export const KIND_CODE: Partial<Record<BuildingKind, number>> = { house: 1, well: 2, guardPost: 3, woodenTower: 4, tower: 5, fort: 6, monument: 7,
  library: 8, blacksmith: 9, archeryRange: 10, stable: 11, scoutLodge: 12, healerShack: 13, dock: 14, supplyDepot: 15, palace: 16, villageTent: 17, road: 18 };
export const KIND_BY_CODE = new Map<number, BuildingKind>(Object.entries(KIND_CODE).map(([kind, code]) => [code!, kind as BuildingKind]));
export const UPGRADE_CODE = 255;

export interface SettlementRow {
  id: number; owner: number; loyalty: number; target: number; rate: number; flags: number; stage: number; family: number;
  independence: number; treasury: number; claimRevision: number; topForeign: number; relationsRevision: number; kind: number;
}
export interface VillageRelations { revision: number; byFaction: Map<number, VillageRelation>; trading: Set<number>; ally?: number }
export interface SettlementEvent { code: number; settlement: number; faction: number; arg: number }
export interface BuildRequest { request: number; village: number; kind: number; x: number; y: number; w: number; h: number; group: number; cost: number; level: number }
export interface SpawnRow { village: number; role: number; attack: number; home: number; cost: number; post: number }
export interface StepOutput { events: SettlementEvent[]; requests: BuildRequest[]; spawns: SpawnRow[]; charges: { faction: number; gold: number }[] }
export type BuildReason = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const bridges = new SimSlot<SettlementBridge>();
const copy = (pointer: number, length: number): Float64Array => new Float64Array(rustEngine.memory.buffer, pointer, length).slice();
/** Writes rows into a Rust input buffer. The pointer call may grow memory, so
 * the view is created only after it returns. */
function write(pointer: number, values: readonly number[]): void {
  new Float64Array(rustEngine.memory.buffer, pointer, values.length).set(values);
}
function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) { hash ^= seed.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}
function relationCode(relation: Faction['relation']): number { return relation === 'self' ? 0 : relation === 'war' ? 2 : relation === 'confederated' ? 3 : 1; }
export function villageCenter(village: NeutralVillage): Point {
  return village.layout ? { x: village.layout.lotX + 1, y: village.layout.lotY + 1 } : { x: village.x + .5, y: village.y + .5 };
}
function isCivic(building: Building): boolean {
  return KIND_CODE[building.kind] !== undefined && (building.kind !== 'road' || building.villageId !== undefined);
}

export class SettlementBridge {
  readonly handle: number;
  readonly core: SimCore;
  readonly rows = new Map<number, SettlementRow>();
  private readonly lastUpsert = new Map<number, string>();
  private readonly lastCivic = new Map<number, string>();
  private readonly civic = new Map<number, Building>();
  private readonly dirtyCivic = new Set<number>();
  private readonly layouts = new Set<number>();
  private readonly relations = new Map<number, VillageRelations>();
  private readonly claims = new Map<number, { revision: number; cells: number[] }>();
  private readonly hostiles = new Map<number, { at: number; ids: number[] }>();
  private hostility = { revision: -1, index: new Map<number, number>(), bits: new Uint8Array(0), n: 0 };
  private hostilityDirty = true;
  private factionSignature = NaN;
  private slots: number[] = [];
  private slotsSignature = NaN;
  private populations = new Map<number, number>();
  private populationsAt = -Infinity;
  private fullAt = -Infinity;
  private readonly imported: boolean;
  private seeded = false;
  private observer: EntityObserver<Building>;
  constructor(readonly state: GameState) {
    this.core = simCore(state);
    this.handle = this.core.engine(this, SIM_ENGINE.settlement, state.world.width, state.world.height, hashSeed(`${state.world.seed}:settlements`));
    // A loaded game's core keeps its settlement section (GameState.simCore
    // section 1); every engine created for that game restores it.
    const restored = rustEngine.sim_settlement_restore(this.core.handle, this.handle);
    if (restored === 2) throw new Error('The saved town state is invalid.');
    this.imported = restored === 1;
    if (this.imported) for (const village of state.villages ?? []) this.layouts.add(village.id);
    const store = entityStore(state);
    this.observer = {
      added: building => { if (isCivic(building)) { this.civic.set(building.id, building); this.dirtyCivic.add(building.id); } },
      removed: building => { if (this.civic.delete(building.id) || this.lastCivic.has(building.id)) this.dirtyCivic.add(building.id); },
      changed: building => {
        if (isCivic(building)) this.civic.set(building.id, building); else this.civic.delete(building.id);
        this.dirtyCivic.add(building.id);
      },
    };
    for (const building of state.buildings) if (isCivic(building)) { this.civic.set(building.id, building); this.dirtyCivic.add(building.id); }
    store.buildings.observe(this.observer);
    this.sync(true);
  }

  private signature(): number {
    let hash = this.state.factions.length + (this.state.diplomacyState?.accessRevision ?? 0) * 97;
    for (const faction of this.state.factions) hash = (Math.imul(hash, 31) + faction.id * 17 + relationCode(faction.relation) * 5
      + (faction.defeated ? 3 : 0) + (faction.villageId === undefined ? 0 : 7) + (isHumanFaction(this.state, faction.id) ? 11 : 0)
      + (faction.achievements ?? 0) * 37) | 0;
    return hash;
  }
  private sendFactions(): void {
    const state = this.state, values: number[] = [];
    for (const faction of state.factions) {
      const village = faction.villageId !== undefined;
      const human = isHumanFaction(state, faction.id);
      values.push(faction.id, faction.id >= 0 && !village ? faction.id < 11 ? faction.id : 0 : -1,
        (faction.defeated ? 1 : 0) | (human ? 2 : 0) | (village ? 4 : 0) | (faction.relation === 'confederated' ? 8 : 0) | (state.multiplayer && human ? 16 : 0),
        faction.gold, faction.population, faction.villageId ?? -1, relationCode(faction.relation), faction.achievements ?? 0);
    }
    write(rustEngine.settlement_factions_input(this.handle, state.factions.length), values);
    rustEngine.settlement_factions_commit(this.handle, state.factions.length);
    for (const pair of state.diplomacyState?.relationships ?? [])
      rustEngine.settlement_civ_war(this.handle, pair.a, pair.b, Number(pair.war));
    this.factionSignature = this.signature();
    this.hostilityDirty = true;
  }

  /** Host rows for palaces, village hubs and seceded cities; changed rows only. */
  private sendSettlements(full: boolean): void {
    const state = this.state, store = entityStore(state), rows: number[] = [];
    const villagesByFaction = new Map((state.villages ?? []).map(village => [village.faction, village]));
    if (full && state.time - this.populationsAt >= SETTLEMENT_CONSTANTS.integrateInterval) {
      this.populations = new Map(cityResidents(state).map(row => [row.palace.id, row.population]));
      this.populationsAt = state.time;
    }
    const counts = new Map<number, { villagers: number; guards: number }>();
    if (full) {
      for (const role of ['worker', 'soldier'] as const) for (const unit of store.units.query(role)) {
        if (unit.villageId === undefined || unit.hp <= 0) continue;
        const count = counts.get(unit.villageId) ?? { villagers: 0, guards: 0 };
        if (unit.kind === 'worker') count.villagers++; else if (unit.kind === 'warrior') count.guards++;
        counts.set(unit.villageId, count);
      }
    }
    const seen = new Set<number>();
    const push = (id: number, row: number[]) => {
      seen.add(id);
      const key = row.join(',');
      if (this.lastUpsert.get(id) === key) return;
      this.lastUpsert.set(id, key); rows.push(...row);
    };
    for (const palace of store.buildings.query('palace')) {
      const village = villagesByFaction.get(palace.faction);
      const seceded = !!village?.secededCity;
      const owner = state.factions.find(f => f.id === palace.faction);
      if (!seceded && owner?.villageId !== undefined) continue;
      const population = seceded ? (counts.get(village!.id)?.villagers ?? Number(this.lastUpsert.get(palace.id)?.split(',')[5] ?? 0)) : this.populations.get(palace.id) ?? 0;
      push(palace.id, [palace.id, seceded ? 3 : 1, palace.faction, palace.x + 1, palace.y + 1, population,
        palace.faction >= 0 && !seceded ? palace.faction < 11 ? palace.faction : 0 : -1, seceded ? village!.id : -1,
        palace.villageIdentity ? IDENTITY_CODE[palace.villageIdentity] : seceded ? IDENTITY_CODE[village!.identity] : 255,
        (buildingReady(palace) ? 1 : 0) | (palace.hp > 0 ? 0 : 2), seceded ? counts.get(village!.id)?.guards ?? 0 : 0, 0]);
    }
    for (const village of state.villages ?? []) {
      if (village.secededCity || village.confederatedInto !== undefined) continue;
      const camp = store.buildings.get(village.campId);
      const live = !!camp && camp.kind === 'villageTent' && camp.hp > 0 && !village.destroyed;
      const center = villageCenter(village), count = counts.get(village.id);
      const previous = this.lastUpsert.get(village.campId)?.split(',');
      push(village.campId, [village.campId, 2, village.faction, center.x, center.y, count?.villagers ?? Number(previous?.[5] ?? 0), -1, village.id,
        IDENTITY_CODE[village.identity], (live && buildingReady(camp!) ? 1 : 0) | (live ? 0 : 2), count?.guards ?? Number(previous?.[10] ?? 0), 0]);
      if (full && count) { const faction = state.factions.find(f => f.id === village.faction); if (faction) faction.population = count.villagers; }
    }
    for (const id of this.lastUpsert.keys()) if (!seen.has(id)) {
      const previous = this.lastUpsert.get(id)!.split(',').map(Number);
      previous[9] = 2; this.lastUpsert.set(id, previous.join(',')); rows.push(...previous);
    }
    const count = rows.length / STRIDE.upsert;
    if (count) { write(rustEngine.settlement_upsert_input(this.handle, count), rows); rustEngine.settlement_upsert_commit(this.handle, count); this.hostilityDirty = true; }
    for (const village of state.villages ?? []) if (village.layout && !this.layouts.has(village.id)) {
      this.layouts.add(village.id);
      rustEngine.settlement_village_layout(this.handle, village.id, village.layout.family, village.layout.transform, village.layout.lotX, village.layout.lotY);
    }
  }
  /** Scenario seeds apply once, when a fresh engine first imports the villages. */
  private seedRelations(): void {
    if (this.imported || this.seeded) return;
    this.seeded = true;
    for (const village of this.state.villages ?? []) {
      if (!village.relation || village.relation === 'neutral') continue;
      rustEngine.settlement_set_relation(this.handle, village.id, 0, RELATION_CODE[village.relation], Number(village.relation === 'trade'));
    }
  }
  private sendCivic(full: boolean): void {
    const ids = full ? new Set([...this.civic.keys(), ...this.dirtyCivic]) : this.dirtyCivic;
    const rows: number[] = [];
    for (const id of ids) {
      const building = this.civic.get(id);
      const present = !!building && building.hp > 0 && entityStore(this.state).buildings.get(id) === building;
      const row = present ? [id, KIND_CODE[building!.kind]!, building!.faction, building!.x, building!.y, buildingWidth(building!), buildingHeight(building!),
        (buildingReady(building!) ? 1 : 0) | (building!.villageId !== undefined ? 4 : 0), building!.houseLevel ?? 1] : [id, 0, 0, 0, 0, 0, 0, 2, 0];
      const key = row.join(',');
      if (!present && !this.lastCivic.has(id)) continue;
      if (this.lastCivic.get(id) === key) continue;
      if (present) this.lastCivic.set(id, key); else this.lastCivic.delete(id);
      rows.push(...row);
    }
    this.dirtyCivic.clear();
    const count = rows.length / STRIDE.civic;
    if (count) { write(rustEngine.settlement_civic_input(this.handle, count), rows); rustEngine.settlement_civic_commit(this.handle, count); }
  }
  /** Factions every call; settlements and civic diffs at most once a second. */
  sync(force = false): void {
    const full = force || this.state.time - this.fullAt >= SETTLEMENT_CONSTANTS.senseInterval || this.state.time < this.fullAt;
    if (full) this.fullAt = this.state.time;
    this.sendFactions();
    this.sendSettlements(full);
    if (force) this.seedRelations();
    this.sendCivic(full);
  }

  step(): StepOutput {
    this.sync();
    // The recurring pulse runs between unit frames; the resident census keeps
    // the last frame's actors, so it is sensed whether or not a frame is open.
    const movement = nativeMovement(this.state);
    const headerPointer = rustEngine.settlement_step(this.handle, this.state.time, movement.handle);
    const header = copy(headerPointer, STRIDE.header);
    const section = (index: number, count: number, stride: number) => count ? copy(rustEngine.settlement_outbox(this.handle, index), count * stride) : new Float64Array(0);
    const changed = section(0, header[0], STRIDE.changed), events = section(1, header[1], STRIDE.event);
    const requests = section(2, header[2], STRIDE.request), spawns = section(3, header[3], STRIDE.spawn), charges = section(4, header[4], STRIDE.charge);
    for (let offset = 0; offset < changed.length; offset += STRIDE.changed) {
      const r = changed.subarray(offset, offset + STRIDE.changed);
      this.rows.set(r[0], { id: r[0], owner: r[1], loyalty: r[2], target: r[3], rate: r[4], flags: r[5], stage: r[6], family: r[7], independence: r[8],
        treasury: r[9], claimRevision: r[10], topForeign: r[11], relationsRevision: r[12], kind: r[13] });
    }
    if (header[5] !== this.hostility.revision) this.hostilityDirty = true;
    const output: StepOutput = { events: [], requests: [], spawns: [], charges: [] };
    for (let o = 0; o < events.length; o += STRIDE.event) output.events.push({ code: events[o], settlement: events[o + 1], faction: events[o + 2], arg: events[o + 3] });
    for (let o = 0; o < requests.length; o += STRIDE.request) output.requests.push({ request: requests[o], village: requests[o + 1], kind: requests[o + 2],
      x: requests[o + 3], y: requests[o + 4], w: requests[o + 5], h: requests[o + 6], group: requests[o + 7], cost: requests[o + 8], level: requests[o + 9] });
    for (let o = 0; o < spawns.length; o += STRIDE.spawn) output.spawns.push({ village: spawns[o], role: spawns[o + 1], attack: spawns[o + 2],
      home: spawns[o + 3], cost: spawns[o + 4], post: spawns[o + 5] });
    for (let o = 0; o < charges.length; o += STRIDE.charge) output.charges.push({ faction: charges[o], gold: charges[o + 1] });
    if (output.events.some(event => event.code === EVENT.relation)) this.relations.clear();
    return output;
  }
  results(rows: readonly { request: number; ok: boolean; building: number; reason: BuildReason }[]): void {
    if (!rows.length) return;
    const values = rows.flatMap(row => [row.request, Number(row.ok), row.building, row.reason]);
    write(rustEngine.settlement_build_results_input(this.handle, rows.length), values);
    rustEngine.settlement_build_results_commit(this.handle, rows.length);
  }

  // ------------------------------------------------------------- views
  private ensureFactions(): void { if (this.signature() !== this.factionSignature) this.sendFactions(); }
  hostile(a: number, b: number): boolean {
    this.ensureFactions();
    if (this.hostilityDirty) {
      this.hostilityDirty = false;
      const revision = rustEngine.settlement_hostility_revision(this.handle);
      if (revision !== this.hostility.revision) {
        const pointer = rustEngine.settlement_hostility(this.handle);
        const n = new Float64Array(rustEngine.memory.buffer, pointer, 1)[0];
        const values = copy(pointer, 1 + n + n * n);
        const index = new Map<number, number>();
        for (let i = 0; i < n; i++) index.set(values[1 + i], i);
        this.hostility = { revision, index, bits: Uint8Array.from(values.subarray(1 + n)), n };
      }
    }
    const i = this.hostility.index.get(a), j = this.hostility.index.get(b);
    return i !== undefined && j !== undefined && this.hostility.bits[i * this.hostility.n + j] === 1;
  }
  private slotFactions(): number[] {
    this.ensureFactions();
    if (this.slotsSignature !== this.factionSignature) {
      this.slots = Array.from(copy(rustEngine.settlement_slot_factions(this.handle), 16));
      this.slotsSignature = this.factionSignature;
    }
    return this.slots;
  }
  villageRelations(village: NeutralVillage): VillageRelations {
    const revision = this.rows.get(village.secededCity ? village.campId : village.campId)?.relationsRevision ?? -1;
    const cached = this.relations.get(village.id);
    if (cached && cached.revision === revision) return cached;
    const slots = this.slotFactions();
    const values = copy(rustEngine.settlement_village_relations(this.handle, village.id), 18);
    const view: VillageRelations = { revision, byFaction: new Map(), trading: new Set() };
    slots.forEach((faction, slot) => {
      if (!Number.isFinite(faction) || faction < 0 || Number.isNaN(values[slot])) return;
      view.byFaction.set(faction, RELATIONS[values[slot]] ?? 'neutral');
      if (Math.floor(values[16] / 2 ** slot) % 2 === 1) view.trading.add(faction);
    });
    if (values[17] >= 0) view.ally = values[17];
    this.relations.set(village.id, view);
    return view;
  }
  invalidateRelations(): void { this.relations.clear(); this.hostilityDirty = true; }
  claim(village: NeutralVillage): number[] | undefined {
    if (!village.layout) return undefined;
    const revision = this.rows.get(village.campId)?.claimRevision ?? -1;
    const cached = this.claims.get(village.id);
    if (cached && cached.revision === revision && revision >= 0) return cached.cells;
    const pointer = rustEngine.settlement_claim(this.handle, village.id);
    const count = new Float64Array(rustEngine.memory.buffer, pointer, 1)[0];
    const cells = Array.from(copy(pointer, count + 1).subarray(1));
    if (revision < 0 && cells.length === 0) return undefined;
    this.claims.set(village.id, { revision, cells });
    return cells;
  }
  villageHostiles(village: NeutralVillage): number[] {
    const cached = this.hostiles.get(village.id);
    if (cached && cached.at === this.state.time) return cached.ids;
    const pointer = rustEngine.settlement_village_hostiles(this.handle, village.id);
    const count = new Float64Array(rustEngine.memory.buffer, pointer, 1)[0];
    const ids = Array.from(copy(pointer, count + 1).subarray(1));
    this.hostiles.set(village.id, { at: this.state.time, ids });
    return ids;
  }
  bonuses(): Map<number, NonNullable<Faction['villageBonuses']>> {
    const pointer = rustEngine.settlement_village_bonuses(this.handle);
    const count = new Float64Array(rustEngine.memory.buffer, pointer, 1)[0];
    const values = copy(pointer, 1 + count * 5), result = new Map<number, NonNullable<Faction['villageBonuses']>>();
    for (let o = 1; o < values.length; o += 5) result.set(values[o], { food: values[o + 1], trade: values[o + 2], construction: values[o + 3], research: values[o + 4] });
    return result;
  }
  breakdown(settlement: number, faction: number): Float64Array {
    this.ensureFactions();
    return copy(rustEngine.settlement_breakdown(this.handle, settlement, faction), STRIDE.breakdown);
  }
  villageStatus(village: NeutralVillage, faction: number, gold: number, reach: number): Float64Array {
    this.ensureFactions();
    return copy(rustEngine.settlement_village_status(this.handle, village.id, faction, gold, reach), STRIDE.status);
  }
  villageCommand(village: NeutralVillage, faction: number, action: number, gold: number, reach: number): Float64Array {
    this.ensureFactions();
    const result = copy(rustEngine.settlement_village_command(this.handle, village.id, faction, action, gold, reach), 4);
    this.invalidateRelations();
    return result;
  }
  questReward(settlement: number, faction: number, amount: number): void {
    this.ensureFactions();
    rustEngine.settlement_quest_reward(this.handle, settlement, faction, amount);
    this.invalidateRelations();
  }
  questPostUpkeep(village: number, amount: number): void {
    rustEngine.settlement_quest_post_upkeep(this.handle,village,amount);
  }
  commitTransfer(oldId: number, newId: number, owner: number, kind: number, village = -1): void {
    rustEngine.settlement_commit_transfer(this.handle, oldId, newId, owner, kind, village);
    this.rows.delete(oldId); this.invalidateRelations(); this.lastUpsert.delete(oldId);
    this.sync(true);
  }
  markFactionsChanged(): void { this.factionSignature = NaN; this.hostilityDirty = true; }
}

/** One engine per game state, created from the saved snapshot or host rows.
 * Saves export it through the simulation core (sim-handle.ts). */
export function settlements(state: GameState): SettlementBridge {
  return bridges.get(state) ?? bridges.set(state, new SettlementBridge(state));
}
export function hasSettlementEngine(state: GameState): boolean { return bridges.get(state) !== undefined; }
export function importSettlementSnapshot(state: GameState): void { bridges.delete(state); settlements(state); applyVillageBonuses(state); }

// ------------------------------------------------------------- read helpers
/** Factions that own a village. `atWar` asks this for every candidate pair, so
 * the set is maintained from village membership and faction changes instead
 * of scanning the village list per call. */
interface VillageFactions { villages: readonly NeutralVillage[]; length: number; factions: Set<number>; stale: boolean; observer: ScalarObserver }
const villageFactionSets = new WeakMap<GameState, VillageFactions>();
function villageFactions(state: GameState, villages: readonly NeutralVillage[]): ReadonlySet<number> {
  let cache = villageFactionSets.get(state);
  if (!cache) {
    const created: VillageFactions = { villages, length: -1, factions: new Set(), stale: true, observer: { changed: () => { created.stale = true; } } };
    villageFactionSets.set(state, cache = created);
  }
  if (cache.stale || cache.villages !== villages || cache.length !== villages.length) {
    cache.villages = villages; cache.length = villages.length; cache.stale = false;
    cache.factions.clear();
    for (const village of villages) { cache.factions.add(village.faction); observeScalars(village, ['faction'], cache.observer); }
  }
  return cache.factions;
}
export function hostileView(state: GameState, a: number, b: number): boolean | undefined {
  if (!state.villages?.length) return undefined;
  const factions = villageFactions(state, state.villages);
  if (!factions.has(a) && !factions.has(b)) return undefined;
  return settlements(state).hostile(a, b);
}
export function villageRelationView(state: GameState, village: NeutralVillage, faction: number): VillageRelation {
  return settlements(state).villageRelations(village).byFaction.get(faction) ?? 'neutral';
}
export function villageAllyView(state: GameState, village: NeutralVillage): number | undefined {
  return settlements(state).villageRelations(village).ally;
}
export function villageAlliedWith(state: GameState, village: NeutralVillage, faction: number): boolean {
  return !village.destroyed && villageAllyView(state, village) === faction;
}
export function villageTrading(state: GameState, village: NeutralVillage, faction: number): boolean {
  return settlements(state).villageRelations(village).trading.has(faction);
}
export function villageTradingFactions(state: GameState, village: NeutralVillage): number[] {
  return [...settlements(state).villageRelations(village).trading].sort((a, b) => a - b);
}
export function villageTradeOrigin(state: GameState, village: NeutralVillage, faction: number, preferred?: number): number {
  const bridge = settlements(state);
  bridge.sync();
  return rustEngine.settlement_village_trade_origin(bridge.handle, village.id, faction, preferred ?? -1);
}
export function villageClaimCells(state: GameState, village: NeutralVillage): number[] | undefined { return settlements(state).claim(village); }
export function villageHostilesView(state: GameState, village: NeutralVillage): number[] { return settlements(state).villageHostiles(village); }
export function settlementRow(state: GameState, id: number): SettlementRow | undefined { return settlements(state).rows.get(id); }
export function villageStage(state: GameState, village: NeutralVillage): number { return settlementRow(state, village.campId)?.stage ?? 0; }
export function villageTreasury(state: GameState, village: NeutralVillage): number { return settlementRow(state, village.campId)?.treasury ?? 0; }

export interface LoyaltyView { value: number; target: number; rate: number; warning: boolean; grace: boolean }
export function loyaltyOf(state: GameState, palace: Building): LoyaltyView {
  const row = settlements(state).rows.get(palace.id);
  if (row && row.owner === palace.faction && Number.isFinite(row.loyalty))
    return { value: row.loyalty, target: row.target, rate: row.rate, warning: !!(row.flags & FLAG.warning), grace: !!(row.flags & FLAG.grace) };
  const b = settlements(state).breakdown(palace.id, palace.faction);
  return Number.isFinite(b[0]) ? { value: b[0], target: b[1], rate: b[2], warning: false, grace: false }
    : { value: SETTLEMENT_CONSTANTS.loyaltyStart, target: 70, rate: 0, warning: false, grace: true };
}
export interface AffiliationBreakdown { value: number; target: number; rate: number; culture: number; trade: number; alliance: number;
  protector: number; fear: number; threat: number; governance: number; snub: number; independence: number }
export function affiliationBreakdown(state: GameState, settlement: number, faction: number): AffiliationBreakdown {
  const b = settlements(state).breakdown(settlement, faction);
  return { value: b[0], target: b[1], rate: b[2], culture: b[3], trade: b[4], alliance: b[5], protector: b[6], fear: b[7], threat: b[8], governance: b[9], snub: b[10], independence: b[11] };
}
export const loyaltyWarning = (state: GameState, palace: Building): boolean => loyaltyOf(state, palace).warning;
export function loyaltyPanelAlpha(state: GameState, palace: Building, viewer: number, now: number): number {
  return palace.faction === viewer && loyaltyWarning(state, palace) ? .72 + .14 * (1 + Math.cos(now * 2 * Math.PI / 3000)) : 1;
}

// ------------------------------------------------------------- inputs
export function settlementTrade(state: GameState, settlement: number, other: number, faction: number, partner: number, gold: number, kind: 1 | 2 | 3): void {
  if (!Number.isFinite(gold) || gold <= 0) return;
  rustEngine.settlement_trade(settlements(state).handle, settlement, other, faction, partner, gold, kind);
}
export function settlementCasualty(state: GameState, settlement: number, attacker: number, population: number): void {
  rustEngine.settlement_casualty(settlements(state).handle, settlement, attacker, population);
}
/** Scenario/editor input: install a relation without charges. */
export function setVillageRelation(state: GameState, village: NeutralVillage, faction: number, relation: VillageRelation, trading = relation === 'trade'): void {
  const bridge = settlements(state);
  bridge.sync(true);
  rustEngine.settlement_set_relation(bridge.handle, village.id, faction, RELATION_CODE[relation], Number(trading));
  bridge.invalidateRelations();
  applyVillageBonuses(state);
}
/** A faction's Leader died: all of its cities' loyalty is halved in the native core. */
export function settlementLeaderDeath(state: GameState, faction: number): void {
  const bridge = settlements(state); bridge.sync(true);
  rustEngine.settlement_leader_death(bridge.handle, faction);
}
/** Scenario/editor input: set one affiliation row directly. */
export function setSettlementAffiliation(state: GameState, settlement: number, faction: number, value: number): void {
  const bridge = settlements(state); bridge.sync(true);
  rustEngine.settlement_set_affiliation(bridge.handle, settlement, faction, value);
}
export function civConfederateStatus(state: GameState, target: number, requester: number): { chancePercent: number; affiliation: number } {
  const bridge = settlements(state); bridge.sync();
  const status = copy(rustEngine.settlement_civ_confederate_status(bridge.handle, target, requester), 3);
  return { chancePercent: status[2], affiliation: rustEngine.settlement_civ_affiliation(bridge.handle, target, requester) };
}
export function civConfederate(state: GameState, target: number, requester: number): { accepted: boolean; warDeclared: boolean; chancePercent: number } {
  const bridge = settlements(state); bridge.sync();
  const result = copy(rustEngine.settlement_civ_confederate(bridge.handle, target, requester), 3);
  return { accepted: result[0] === 1, warDeclared: result[1] === 1, chancePercent: result[2] };
}
/** Same-identity bonuses never stack; Rust counts allies and confederated palaces. */
export function applyVillageBonuses(state: GameState): void {
  const bonuses = settlements(state).bonuses();
  for (const faction of state.factions) {
    if (faction.villageId !== undefined) continue;
    faction.villageBonuses = bonuses.get(faction.id) ?? { food: 0, trade: 0, construction: 0, research: 0 };
  }
}
export function logSettlementEvent(state: GameState, text: string, kind: GameEvent['kind'] = 'info'): void {
  state.events.unshift({ id: (state.events[0]?.id ?? 0) + 1, time: state.time, text, kind });
  if (state.events.length > 40) state.events.length = 40;
}

/** Founding patch (design 8.4): one code per cell of a 25×25 window. */
export function chooseVillageLayout(state: GameState, villageId: number, center: Point, encode: (x: number, y: number) => number, forceFamily = 0, attempt = 160):
  { family: number; transform: number; lot: Point; hub: Point; tents: [Point, Point]; dock?: Point } | undefined {
  const bridge = settlements(state), size = SETTLEMENT_CONSTANTS.patch, half = Math.floor(size / 2);
  const values: number[] = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) values.push(encode(center.x - half + x, center.y - half + y));
  write(rustEngine.settlement_plan_input(bridge.handle), values);
  const result = copy(rustEngine.settlement_plan_choose(bridge.handle, villageId, center.x, center.y, forceFamily, attempt), 14);
  if (!result[0]) return undefined;
  return { family: result[1], transform: result[2], lot: { x: result[3], y: result[4] }, hub: { x: result[5], y: result[6] },
    tents: [{ x: result[7], y: result[8] }, { x: result[9], y: result[10] }], dock: result[11] ? { x: result[12], y: result[13] } : undefined };
}

/** Population-weighted cultural attachment, independent of treaty trust. */
export function civAffiliation(state: GameState, target: number, requester: number): number {
  const bridge = settlements(state); bridge.sync();
  return rustEngine.settlement_civ_affiliation(bridge.handle, target, requester);
}
