import { factoryGoldIncome } from './civic-buildings-native';
import { chargesMaintenance } from './maintenance';
import { EconomyInputs } from './economy-inputs';
import { entityStore } from './entity-store';
import { stoneDefenseMultiplier } from './stone-defense';
import { cityOwnership } from './city-ownership';
import { farmCityQuery, farmTravelRevision } from './farm-travel';
import { prepareIrrigation } from './irrigation';
import { granaryYieldMultiplier } from './granaries-native';
import { retinueUpkeep } from './archery';
import { saltFoodConsumptionMultiplier } from './resource-development';
import { worldRevisions } from './world-revisions';
import { fishingCityFoodPerEconomyCycle } from './fishing';
import { buildingReady, buildingSize, type Building, type FarmField, type GameState, type Unit } from './types';

/** Reused scalar storage avoids serializing an economy or allocating a string
 * fingerprint on every live read inside an order callback. */
class Scalars {
  private values: unknown[] = [];
  private cursor = 0;
  changed = false;
  begin(): void { this.cursor = 0; this.changed = false; }
  add(...values: unknown[]): void {
    for (const value of values) {
      if (!Object.is(this.values[this.cursor], value)) this.changed = true;
      this.values[this.cursor++] = value;
    }
  }
  end(): boolean {
    this.changed ||= this.values.length !== this.cursor;
    this.values.length = this.cursor;
    return this.changed;
  }
}

export interface CityEconomyGroup {
  faction: number; buildings: Building[]; revision: number;
}
interface Group extends CityEconomyGroup { scalars: Scalars; }
export interface CityEconomyCity {
  palace: Building; buildings: Building[]; fields: FarmField[]; unitCosts: number[];
  capital: boolean; maintenanceCapital?: number; maintenanceCities?: number; saltConsumption: number; revision: number;
}
interface City extends CityEconomyCity { scalars: Scalars; seen: boolean; }
interface FarmOwner {
  farm?: Building; x: number; y: number; faction: number;
  travel: ReturnType<typeof farmTravelRevision>; palace?: Building;
}

const retinue = (unit: Unit): boolean => unit.kind === 'warrior' || unit.kind === 'swordsman' || unit.kind === 'spearman' || unit.kind === 'pikeman' || unit.kind === 'musketman'
  || unit.kind === 'horseman' || unit.kind === 'horseArcher' || unit.kind === 'knight' || unit.kind === 'archer';

/** Mutation notifications retain unchanged faction rosters and city outputs.
 * Resident allocation stays faction-wide and ordered; fields and upkeep are
 * reduced in their original order within each affected city. */
export class CityEconomyIndex {
  readonly groups = new Map<number, Group>();
  readonly cities = new Map<number, City>();
  private inputs?: EconomyInputs;
  private store?: ReturnType<typeof entityStore>;
  private prepare(state: GameState, residentsOnly = false): EconomyInputs {
    const store = entityStore(state);
    if (!this.inputs || this.store !== store) { this.inputs = new EconomyInputs(state); this.store = store; }
    this.inputs.synchronize(!residentsOnly);
    return this.inputs;
  }
  invalidate(): void { this.inputs?.invalidate(); }
  private farmOwners = new Map<number, FarmOwner>();
  private palaceGeometry = new Scalars();

  private groupFor(faction: number): Group {
    let group = this.groups.get(faction);
    if (!group) {
      group = { faction, buildings: [], revision: 0, scalars: new Scalars() };
      this.groups.set(faction, group);
    }
    return group;
  }

  private beginResidents(state: GameState, selected: ReadonlySet<number>): void {
    const factions = new Set(state.factions.map(faction => faction.id));
    for (const faction of this.groups.keys()) if (!factions.has(faction)) this.groups.delete(faction);
    for (const group of this.groups.values()) if (selected.has(group.faction)) { group.scalars.begin(); group.buildings.length = 0; }
    for (const faction of state.factions) if (selected.has(faction.id))
      this.groupFor(faction.id).scalars.add(faction, faction.name, faction.population, faction.defeated);
  }

  private addHome(building: Building, ownership: ReturnType<typeof cityOwnership>): void {
    if ((building.kind !== 'house' && building.kind !== 'apartments') && building.kind !== 'palace') return;
    const group = this.groups.get(building.faction);
    if (!group) return;
    group.buildings.push(building);
    group.scalars.add(building, building.kind, building.id, building.x, building.y, buildingReady(building),
      building.capacity, building.residents, building.unhousedResidents, building.houseLevel, building.cityName);
    if ((building.kind === 'house' || building.kind === 'apartments')) group.scalars.add(ownership.building(building)?.id);
  }

  /** Population-only queries never prepare routes, field yields or upkeep. */
  reconcileResidents(state: GameState): void {
    const inputs = this.prepare(state, true), selected = new Set(inputs.residentsDirty);
    if (!selected.size) return;
    this.beginResidents(state, selected);
    const ownership = cityOwnership(state);
    for (const building of inputs.buildingsFor(selected)) this.addHome(building, ownership);
    for (const group of this.groups.values()) if (selected.has(group.faction) && group.scalars.end()) group.revision++;
    for (const faction of selected) inputs.residentsDirty.delete(faction);
  }

  reconcile(state: GameState): void {
    const inputs = this.prepare(state), selected = new Set(inputs.dirty);
    if (!selected.size) return;
    const ownership = cityOwnership(state), factions = new Map(state.factions.map(faction => [faction.id, faction]));
    const capitals = new Map<number, number>(), maintenanceCapitals = new Map<number, number>(), maintenanceCities = new Map<number, number>();
    this.palaceGeometry.begin();
    this.beginResidents(state, selected);
    for (const city of this.cities.values()) if (selected.has(city.palace.faction)) {
      city.seen = false; city.scalars.begin(); city.buildings.length = 0; city.fields.length = 0; city.unitCosts.length = 0;
    }
    for (const palace of ownership.palaces) {
      this.palaceGeometry.add(palace, palace.id, palace.faction, palace.x, palace.y, buildingReady(palace));
      if (!buildingReady(palace)) continue;
      if (palace.villageId === undefined)
      { maintenanceCapitals.set(palace.faction, Math.min(maintenanceCapitals.get(palace.faction) ?? Infinity, palace.id));
        maintenanceCities.set(palace.faction, (maintenanceCities.get(palace.faction) ?? 0) + 1); }
      const faction = factions.get(palace.faction);
      if (!selected.has(palace.faction)) continue;
      if (palace.faction < 0 || !faction || faction.defeated) continue;
      capitals.set(palace.faction, Math.min(capitals.get(palace.faction) ?? Infinity, palace.id));
      let city = this.cities.get(palace.id);
      if (!city || city.palace !== palace) {
        city = { palace, buildings: [], fields: [], unitCosts: [], capital: false,
          saltConsumption: 1, revision: 0, scalars: new Scalars(), seen: true };
        this.cities.set(palace.id, city);
      }
      city.seen = true;
    }
    if (this.palaceGeometry.end()) this.farmOwners.clear();
    for (const [id, city] of this.cities) if (selected.has(city.palace.faction) && !city.seen) this.cities.delete(id);
    // Resource ownership can change independently of city population. Read its
    // authoritative index once per faction and compare the resulting value.
    const salt = new Map<number, number>(), factory = new Map<number, number>();
    for (const city of this.cities.values()) if (selected.has(city.palace.faction)) {
      const palace = city.palace, faction = factions.get(palace.faction)!;
      if (!salt.has(faction.id)) salt.set(faction.id, saltFoodConsumptionMultiplier(state, faction.id));
      if (!factory.has(faction.id)) factory.set(faction.id, factoryGoldIncome(state, faction.id, 1));
      city.capital = capitals.get(faction.id) === palace.id;
      city.maintenanceCapital = maintenanceCapitals.get(faction.id);
      city.maintenanceCities = maintenanceCities.get(faction.id);
      city.saltConsumption = salt.get(faction.id)!;
      city.scalars.add(palace, palace.faction, palace.capacity, city.capital,
        city.capital ? faction.purchasedRetinueSlots : undefined, faction.villageId, faction.achievements,
        maintenanceCapitals.get(faction.id), maintenanceCities.get(faction.id), city.saltConsumption, factory.get(faction.id), stoneDefenseMultiplier(state, faction.id, 'tower'),
        fishingCityFoodPerEconomyCycle(state, palace.id));
    }
    for (const building of inputs.buildingsFor(selected)) {
      // Only homes participate in the ordered resident ledger. A new road,
      // farm or unrelated pending upgrade does not invalidate this ledger.
      this.addHome(building, ownership);
      if (!buildingReady(building) || building.villageId !== undefined
        || !chargesMaintenance(building.kind)) continue;
      const city = this.cities.get(ownership.building(building)?.id ?? -1);
      if (!city) continue;
      city.buildings.push(building);
      city.scalars.add(building, building.kind, building.guardPost?.funded, building.guardPost?.level);
    }
    for (const city of this.cities.values()) if (selected.has(city.palace.faction)) city.scalars.add('fields');
    const farmQueries = new Map<number, ReturnType<typeof farmCityQuery>>();
    const assignedFarms = new Map<number, Building | undefined>();
    let travel: ReturnType<typeof farmTravelRevision> | undefined, yieldRevision: number | undefined;
    let irrigation: Uint8Array | undefined;
    for (const field of inputs.fieldsFor(selected)) {
      if (!field.planted) continue;
      if (!assignedFarms.has(field.camp)) {
        const farm = entityStore(state).buildings.get(field.camp), x = farm?.x ?? field.x, y = farm?.y ?? field.y;
        const faction = farm?.faction ?? field.faction;
        travel ??= farmTravelRevision(state);
        let old = this.farmOwners.get(field.camp);
        if (!old || old.farm !== farm || old.x !== x || old.y !== y || old.faction !== faction || old.travel !== travel) {
          if (farm && !farmQueries.has(faction)) farmQueries.set(faction, farmCityQuery(state, faction));
          old = { farm, x, y, faction, travel, palace: farm ? farmQueries.get(faction)!(farm)
            : ownership.nearest({ x: x + .5, y: y + .5 }, faction) };
          this.farmOwners.set(field.camp, old);
        }
        assignedFarms.set(field.camp, old.palace);
      }
      const city = this.cities.get(assignedFarms.get(field.camp)?.id ?? -1);
      if (!city) continue;
      yieldRevision ??= worldRevisions(state.world).geometry;
      irrigation ??= prepareIrrigation(state).coverage;
      city.fields.push(field);
      const tile = state.world.tiles[field.y * state.world.width + field.x];
      city.scalars.add(field, field.faction, field.x, field.y, !!field.orchard,
        field.orchard ? state.time + 1e-7 >= field.orchard.readyAt : true,
        factions.get(field.faction)?.villageBonuses?.food, factions.get(field.faction)?.achievements, state.world, yieldRevision, irrigation,
        tile?.terrain, tile?.fertility, granaryYieldMultiplier(state, field.faction, field.x, field.y));
    }
    for (const [camp, owner] of this.farmOwners) if (selected.has(owner.faction) && !assignedFarms.has(camp)) this.farmOwners.delete(camp);
    for (const city of this.cities.values()) if (selected.has(city.palace.faction)) city.scalars.add('units');
    for (const unit of inputs.unitsFor(selected)) {
      if (unit.hp <= 0) continue;
      if (unit.observationPost && !unit.observationPost.retreating) {
        const assigned = this.cities.get(unit.observationPost.city);
        const city = assigned?.palace.faction === unit.faction ? assigned
          : this.cities.get(ownership.nearest(unit, unit.faction)?.id ?? -1);
        if (city) { city.unitCosts.push(3); city.scalars.add(3); }
      }
      if (!retinue(unit)) continue;
      const home = entityStore(state).buildings.get(unit.home ?? -1);
      const city = this.cities.get(ownership.nearest(home?.faction === unit.faction && buildingReady(home)
        ? { x: home.x + buildingSize(home) / 2, y: home.y + buildingSize(home) / 2 } : unit, unit.faction)?.id ?? -1);
      if (city) { const cost = retinueUpkeep(unit); city.unitCosts.push(cost); city.scalars.add(cost); }
    }
    for (const group of this.groups.values()) if (selected.has(group.faction) && group.scalars.end()) group.revision++;
    for (const city of this.cities.values()) if (selected.has(city.palace.faction) && city.scalars.end()) city.revision++;
    for (const faction of selected) { inputs.dirty.delete(faction); inputs.residentsDirty.delete(faction); }
  }
}
