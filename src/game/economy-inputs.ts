import { chargesMaintenance } from './maintenance';
import { entityStore, type EntityObserver } from './entity-store';
import { observeScalars, type ScalarObserver } from './scalar-observer';
import { SimulationEvents } from './simulation-events';
import { worldRevisions } from './world-revisions';
import { farmTravelRevision } from './farm-travel';
import { prepareIrrigation } from './irrigation';
import { fishingCityFoodPerEconomyCycle } from './fishing';
import { farmResearchYieldMultiplier } from './research-bonuses';
import { citiesWithDevelopedCoal, citiesWithDevelopedPeat } from './resource-development';
import { buildingReady, isFarmKind, type Building, type FarmField, type GameState, type Unit } from './types';

type Input = Building | Unit | FarmField;
interface FactionInputs { buildings: Set<Building>; units: Set<Unit>; fields: Set<FarmField>;
  ordered: { buildings?: Building[]; units?: Unit[]; fields?: FarmField[] } }
interface FieldLink { source: number; owner: number; key: string }
interface Member { value: Input; type: 'buildings' | 'units' | 'fields'; faction: number }
const homes = ['kind', 'id', 'x', 'y', 'hp', 'faction', 'construction', 'capacity', 'residents', 'unhousedResidents', 'houseLevel', 'cityName', 'villageId', 'guardPost'] as const;
const basicBuildingScalars = ['kind', 'faction', 'hp'];
const workBuildingScalars = [...basicBuildingScalars, 'x', 'y', 'construction', 'villageId', 'guardPost'];
const retinue = (unit: Unit) => ['warrior', 'swordsman', 'spearman', 'pikeman', 'musketman', 'horseman', 'horseArcher', 'knight', 'archer'].includes(unit.kind);

/** Index mutation sites instead of rediscovering all economy inputs on reads.
 * Ordered reductions remain city/faction-local so floating-point sums keep
 * their original deterministic order. Treasury and crop cargo are not inputs. */
export class EconomyInputs implements ScalarObserver {
  readonly dirty = new Set<number>();
  readonly residentsDirty = new Set<number>();
  peatCities: ReadonlySet<number> = new Set();
  coalCities: ReadonlySet<number> = new Set();
  private full = false;
  private factions = new Map<number, FactionInputs>();
  private members = new WeakMap<object, Member>();
  private nested = new WeakMap<object, Member | number>();
  private factionObjects = new WeakSet<object>();
  private factionIds = new Set<number>();
  private farmResearchYields = new Map<number, number>();
  private fieldSource?: FarmField[];
  private fieldCount = -1;
  private fieldOrder = new Map<FarmField, number>();
  private fieldsByCamp = new Map<number, Set<FarmField>>();
  private campByField = new WeakMap<FarmField, number>();
  private fieldLinks = new WeakMap<FarmField, FieldLink>();
  private links = new Map<string, FieldLink & { count: number }>();
  private orchards = new SimulationEvents<FarmField>();
  private time = -Infinity;
  private world: GameState['world'];
  private tiles: GameState['world']['tiles'];
  private sight = -1;
  private travel?: object;
  private coverage?: Uint8Array;
  private fishing = new Map<number, number>();
  private palaceReady = new WeakMap<Building, boolean>();
  private palaceInGrace = new WeakMap<Building, boolean>();
  private buildings: EntityObserver<Building>;
  private units: EntityObserver<Unit>;
  constructor(private state: GameState) {
    this.world = state.world; this.tiles = state.world.tiles;
    this.buildings = { added: value => this.add(value, 'buildings'), removed: value => this.remove(value), changed: value => this.touch(value) };
    this.units = { added: value => this.add(value, 'units'), removed: value => this.remove(value) };
    const store = entityStore(state);
    store.buildings.observe(this.buildings);
    for (const building of state.buildings) this.add(building, 'buildings');
  }
  private activateFull(): void {
    if (this.full) return;
    this.full = true;
    for (const building of this.state.buildings) this.watch(this.members.get(building)!);
    entityStore(this.state).units.observe(this.units);
    for (const unit of this.state.units) this.add(unit, 'units');
  }
  private checkPalaces(): void {
    for (const palace of entityStore(this.state).buildings.query('palace')) {
      const ready = buildingReady(palace);
      if (this.palaceReady.get(palace) !== ready) {
        this.mark(palace.faction); const member = this.members.get(palace); if (member) this.watch(member);
        this.palaceReady.set(palace, ready);
      }
      if (palace.settlementUpkeepUntil !== undefined) {
        const inGrace = palace.settlementUpkeepUntil > this.state.time;
        if (this.palaceInGrace.get(palace) !== inGrace) {
          this.dirty.add(palace.faction);
          this.palaceInGrace.set(palace, inGrace);
        }
      }
    }
  }
  private group(faction: number): FactionInputs {
    let group = this.factions.get(faction);
    if (!group) { group = { buildings: new Set(), units: new Set(), fields: new Set(), ordered: {} }; this.factions.set(faction, group); }
    return group;
  }
  private mark(faction: number): void { this.dirty.add(faction); this.residentsDirty.add(faction); }
  invalidate(): void { for (const faction of this.factions.keys()) this.mark(faction); }
  private add(value: Input, type: Member['type']): void {
    const member = { value, type, faction: value.faction };
    this.members.set(value, member);
    (this.group(value.faction)[type] as Set<Input>).add(value);
    this.group(value.faction).ordered[type] = undefined;
    this.mark(value.faction); this.watch(member);
    if (type === 'fields') this.linkField(value as FarmField);
    else if (type === 'buildings') this.linkCamp((value as Building).id);
  }
  private remove(value: Input): void {
    const member = this.members.get(value); if (!member) return;
    (this.group(member.faction)[member.type] as Set<Input>).delete(value);
    this.group(member.faction).ordered[member.type] = undefined;
    this.members.delete(value); this.mark(member.faction);
    if (member.type === 'fields') {
      const field = value as FarmField;
      this.orchards.cancel(field); this.unlinkField(field);
      this.fieldsByCamp.get(this.campByField.get(field)!)?.delete(field); this.campByField.delete(field);
    } else if (member.type === 'buildings') this.linkCamp((value as Building).id);
  }
  private unlinkField(field: FarmField): void {
    const old = this.fieldLinks.get(field); if (!old) return;
    const pair = this.links.get(old.key)!;
    if (!--pair.count) this.links.delete(old.key);
    this.fieldLinks.delete(field); this.mark(old.source); this.mark(old.owner);
  }
  private linkField(field: FarmField): void {
    this.unlinkField(field);
    const oldCamp = this.campByField.get(field);
    if (oldCamp !== field.camp) {
      if (oldCamp !== undefined) this.fieldsByCamp.get(oldCamp)?.delete(field);
      let fields = this.fieldsByCamp.get(field.camp);
      if (!fields) { fields = new Set(); this.fieldsByCamp.set(field.camp, fields); }
      fields.add(field); this.campByField.set(field, field.camp);
    }
    const owner = entityStore(this.state).buildings.get(field.camp)?.faction ?? field.faction;
    if (owner === field.faction) return;
    const key = `${field.faction}:${owner}`, link = { source: field.faction, owner, key };
    const pair = this.links.get(key);
    if (pair) pair.count++; else this.links.set(key, { ...link, count: 1 });
    this.fieldLinks.set(field, link); this.mark(link.source); this.mark(link.owner);
  }
  private linkCamp(id: number): void { for (const field of this.fieldsByCamp.get(id) ?? []) this.linkField(field); }
  private expandLinks(selected: Set<number>): void {
    let changed = true;
    while (changed) {
      const count = selected.size;
      for (const link of this.links.values()) if (selected.has(link.source) || selected.has(link.owner)) {
        selected.add(link.source); selected.add(link.owner);
      }
      changed = count !== selected.size;
    }
  }
  private touch(value: Input): void {
    const member = this.members.get(value); if (!member) return;
    this.mark(member.faction); this.watch(member);
  }
  private watch(member: Member): void {
    const value = member.value;
    if (!this.full) {
      if (member.type === 'buildings' && (((value as Building).kind === 'house' || (value as Building).kind === 'apartments') || (value as Building).kind === 'palace')) observeScalars(value, homes, this);
      return;
    }
    if (member.type === 'buildings') {
      const building = value as Building;
      observeScalars(building, (building.kind === 'house' || building.kind === 'apartments') || building.kind === 'palace' ? homes
        : isFarmKind(building.kind) || chargesMaintenance(building.kind)
          ? workBuildingScalars : basicBuildingScalars, this);
      if (building.guardPost) {
        this.nested.set(building.guardPost, member); observeScalars(building.guardPost, ['funded', 'level'], this);
      }
    } else if (member.type === 'units') {
      const unit = value as Unit;
      observeScalars(unit, ['kind', 'hp', 'home', 'faction', 'observationPost'], this);
      if (retinue(unit) || unit.observationPost) observeScalars(unit, ['x', 'y'], this);
      if (unit.observationPost) {
        this.nested.set(unit.observationPost, member); observeScalars(unit.observationPost, ['city', 'retreating'], this);
      }
    } else {
      const field = value as FarmField;
      observeScalars(field, ['faction', 'x', 'y', 'camp', 'planted', 'orchard'], this);
      if (field.orchard) {
        this.nested.set(field.orchard, member); observeScalars(field.orchard, ['readyAt', 'startedAt'], this);
        this.orchards.schedule(field, field.orchard.readyAt, field);
      } else this.orchards.cancel(field);
      const tile = this.state.world.tiles[field.y * this.state.world.width + field.x];
      if (tile) { this.nested.set(tile, member); observeScalars(tile, ['terrain', 'fertility', 'fertilityGrass'], this); }
    }
  }
  changed(target: object, key: string, previous: unknown, value: unknown): void {
    const member = this.members.get(target), nested = this.nested.get(target);
    if (!member) {
      if (typeof nested === 'number') {
        this.mark(nested);
        const bonuses = (target as { villageBonuses?: object }).villageBonuses;
        if (bonuses) { this.nested.set(bonuses, nested); observeScalars(bonuses, ['food'], this); }
      } else if (nested) { this.mark(nested.faction); if (nested.type === 'fields') this.watch(nested); }
      return;
    }
    if (key === 'hp' && (Number(previous) > 0) === (Number(value) > 0)) return;
    if (member.type === 'units' && (key === 'x' || key === 'y')) {
      const unit = member.value as Unit, home = entityStore(this.state).buildings.get(unit.home ?? -1);
      if (!retinue(unit) && !unit.observationPost || home && home.faction === unit.faction && buildingReady(home)
        && (!unit.observationPost || unit.observationPost.city !== undefined)) return;
    }
    this.mark(member.faction);
    if (key === 'faction') {
      (this.group(member.faction)[member.type] as Set<Input>).delete(member.value);
      this.group(member.faction).ordered[member.type] = undefined;
      member.faction = member.value.faction;
      (this.group(member.faction)[member.type] as Set<Input>).add(member.value); this.mark(member.faction);
      this.group(member.faction).ordered[member.type] = undefined;
    }
    if (member.type === 'buildings' && key === 'faction') this.linkCamp((member.value as Building).id);
    if (member.type === 'fields' && (key === 'camp' || key === 'faction')) this.linkField(member.value as FarmField);
    // A palace changes assignment for every home/field/soldier in these factions.
    if (key === 'kind' || key === 'guardPost' || key === 'observationPost' || key === 'orchard'
      || member.type === 'fields' && (key === 'x' || key === 'y')) this.watch(member);
  }
  synchronize(full = true): void {
    if (full) this.activateFull();
    const state = this.state;
    const factionIds = new Set(state.factions.map(faction => faction.id));
    for (const faction of factionIds) if (!this.factionIds.has(faction)) this.mark(faction);
    for (const faction of state.factions) if (!this.factionObjects.has(faction)) {
      this.factionObjects.add(faction); this.nested.set(faction, faction.id); this.mark(faction.id);
      observeScalars(faction, ['id', 'name', 'population', 'defeated', 'purchasedRetinueSlots', 'villageId', 'villageBonuses', 'achievements'], this);
      if (faction.villageBonuses) { this.nested.set(faction.villageBonuses, faction.id); observeScalars(faction.villageBonuses, ['food'], this); }
    }
    for (const faction of this.factionIds) if (!factionIds.has(faction)) {
      this.mark(faction);
      this.farmResearchYields.delete(faction);
    }
    this.factionIds = factionIds;
    this.checkPalaces();
    if (!full) { this.expandLinks(this.residentsDirty); return; }
    for (const faction of state.factions) {
      const multiplier = farmResearchYieldMultiplier(faction);
      if (this.farmResearchYields.get(faction.id) === multiplier) continue;
      this.farmResearchYields.set(faction.id, multiplier);
      this.dirty.add(faction.id);
    }
    const fields = state.fields;
    if (fields !== this.fieldSource || (fields?.length ?? 0) !== this.fieldCount) {
      if (this.fieldSource) for (const field of this.fieldOrder.keys()) this.remove(field);
      this.fieldSource = fields; this.fieldCount = fields?.length ?? 0; this.fieldOrder.clear();
      for (let i = 0; i < (fields?.length ?? 0); i++) { this.fieldOrder.set(fields![i], i); this.add(fields![i], 'fields'); }
    }
    if (this.world !== state.world || this.tiles !== state.world.tiles)
      for (const field of this.fieldOrder.keys()) this.watch(this.members.get(field)!);
    const sight = worldRevisions(state.world).sight;
    const travel = fields?.length ? farmTravelRevision(state) : undefined;
    const coverage = fields?.length ? prepareIrrigation(state).coverage : undefined;
    if (this.world !== state.world || this.tiles !== state.world.tiles || sight !== this.sight || travel !== this.travel
      || coverage !== this.coverage || state.time < this.time) this.invalidate();
    this.world = state.world; this.tiles = state.world.tiles; this.sight = sight; this.travel = travel; this.coverage = coverage;
    if (state.time < this.time) for (const field of this.fieldOrder.keys()) this.watch(this.members.get(field)!);
    for (const field of this.orchards.takeDue(state.time + 1e-7)) this.mark(field.faction);
    const peatCities = citiesWithDevelopedPeat(state);
    const coalCities = citiesWithDevelopedCoal(state);
    for (const palace of entityStore(state).buildings.query('palace')) {
      const food = fishingCityFoodPerEconomyCycle(state, palace.id);
      if ((this.fishing.get(palace.id) ?? 0) !== food) this.mark(palace.faction);
      this.fishing.set(palace.id, food);
      if (peatCities.has(palace.id) !== this.peatCities.has(palace.id)) this.dirty.add(palace.faction);
      if (coalCities.has(palace.id) !== this.coalCities.has(palace.id)) this.dirty.add(palace.faction);
    }
    this.peatCities = peatCities;
    this.coalCities = coalCities;
    this.expandLinks(this.dirty); this.expandLinks(this.residentsDirty);
    this.time = state.time;
  }
  buildingsFor(factions: ReadonlySet<number>): Building[] {
    const store = entityStore(this.state).buildings;
    const groups = [...factions].map(faction => {
      const group = this.group(faction);
      return group.ordered.buildings ??= [...group.buildings].sort((a, b) => store.indexOf(a) - store.indexOf(b));
    });
    return groups.length === 1 ? groups[0] : groups.flat().sort((a, b) => store.indexOf(a) - store.indexOf(b));
  }
  unitsFor(factions: ReadonlySet<number>): Unit[] {
    const store = entityStore(this.state).units;
    const groups = [...factions].map(faction => {
      const group = this.group(faction);
      return group.ordered.units ??= [...group.units].sort((a, b) => store.indexOf(a) - store.indexOf(b));
    });
    return groups.length === 1 ? groups[0] : groups.flat().sort((a, b) => store.indexOf(a) - store.indexOf(b));
  }
  fieldsFor(factions: ReadonlySet<number>): FarmField[] {
    const groups = [...factions].map(faction => {
      const group = this.group(faction);
      return group.ordered.fields ??= [...group.fields].sort((a, b) => this.fieldOrder.get(a)! - this.fieldOrder.get(b)!);
    });
    return groups.length === 1 ? groups[0] : groups.flat().sort((a, b) => this.fieldOrder.get(a)! - this.fieldOrder.get(b)!);
  }
}
