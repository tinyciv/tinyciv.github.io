import { cityOwnership } from './city-ownership';
import { farmCityQuery, farmTravelRevision } from './farm-travel';
import { prepareIrrigation } from './irrigation';
import { retinueUpkeep } from './archery';
import { saltFoodConsumptionMultiplier } from './resource-development';
import { worldRevisions } from './world-revisions';
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
  capital: boolean; saltConsumption: number; revision: number;
}
interface City extends CityEconomyCity { scalars: Scalars; seen: boolean; }
interface FarmOwner {
  farm?: Building; x: number; y: number; faction: number;
  travel: ReturnType<typeof farmTravelRevision>; palace?: Building;
}

const retinue = (unit: Unit): boolean => unit.kind === 'warrior' || unit.kind === 'swordsman' || unit.kind === 'spearman'
  || unit.kind === 'horseman' || unit.kind === 'horseArcher' || unit.kind === 'knight' || unit.kind === 'archer';

/** A synchronous planning transaction owns this index. It never crosses a
 * simulation step. Resident allocation is faction-wide and ordered, while
 * fields, upkeep and completed output aggregates belong to individual cities.
 * Live scalar reconciliation observes edits inside an order without rebuilding
 * unchanged cities or recomputing farm routes for a rejected/no-op order. */
export class CityEconomyIndex {
  readonly groups = new Map<number, Group>();
  readonly cities = new Map<number, City>();
  private buildingById = new Map<number, Building>();
  private farmOwners = new Map<number, FarmOwner>();
  private palaceGeometry = new Scalars();

  reconcile(state: GameState): void {
    const ownership = cityOwnership(state), factions = new Map(state.factions.map(faction => [faction.id, faction]));
    const capitals = new Map<number, number>(), maintenanceCapitals = new Map<number, number>();
    this.palaceGeometry.begin();
    for (const group of this.groups.values()) { group.scalars.begin(); group.buildings.length = 0; }
    for (const city of this.cities.values()) {
      city.seen = false; city.scalars.begin(); city.buildings.length = 0; city.fields.length = 0; city.unitCosts.length = 0;
    }
    const groupFor = (faction: number): Group => {
      let group = this.groups.get(faction);
      if (!group) {
        group = { faction, buildings: [], revision: 0, scalars: new Scalars() };
        this.groups.set(faction, group);
      }
      return group;
    };
    for (const faction of state.factions)
      groupFor(faction.id).scalars.add(faction, faction.name, faction.population, faction.defeated);
    for (const palace of ownership.palaces) {
      this.palaceGeometry.add(palace, palace.id, palace.faction, palace.x, palace.y, buildingReady(palace));
      if (!buildingReady(palace)) continue;
      if (palace.villageId === undefined)
        maintenanceCapitals.set(palace.faction, Math.min(maintenanceCapitals.get(palace.faction) ?? Infinity, palace.id));
      const faction = factions.get(palace.faction);
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
    for (const [id, city] of this.cities) if (!city.seen) this.cities.delete(id);
    // Resource ownership can change independently of city population. Read its
    // authoritative index once per faction and compare the resulting value.
    const salt = new Map<number, number>();
    for (const city of this.cities.values()) {
      const palace = city.palace, faction = factions.get(palace.faction)!;
      if (!salt.has(faction.id)) salt.set(faction.id, saltFoodConsumptionMultiplier(state, faction.id));
      city.capital = capitals.get(faction.id) === palace.id;
      city.saltConsumption = salt.get(faction.id)!;
      city.scalars.add(palace, palace.faction, palace.capacity, city.capital,
        city.capital ? faction.purchasedRetinueSlots : undefined, faction.villageId,
        maintenanceCapitals.get(faction.id), city.saltConsumption,
        state.fishing?.startedAt, state.fishing ? state.time : undefined);
    }
    this.buildingById.clear();
    for (const building of state.buildings) {
      this.buildingById.set(building.id, building);
      const group = groupFor(building.faction);
      // Only homes participate in the ordered resident ledger. A new road,
      // farm or unrelated pending upgrade does not invalidate this ledger.
      if (building.kind === 'house' || building.kind === 'palace') {
        group.buildings.push(building);
        group.scalars.add(building, building.kind, building.id, building.x, building.y, buildingReady(building),
          building.capacity, building.residents, building.unhousedResidents, building.houseLevel, building.cityName);
        if (building.kind === 'house') group.scalars.add(ownership.building(building)?.id);
      }
      if (!buildingReady(building) || building.villageId !== undefined
        || !['palace', 'woodenTower', 'tower', 'guardPost'].includes(building.kind)) continue;
      const city = this.cities.get(ownership.building(building)?.id ?? -1);
      if (!city) continue;
      city.buildings.push(building);
      city.scalars.add(building, building.kind, building.guardPost?.funded, building.guardPost?.level);
    }
    for (const city of this.cities.values()) city.scalars.add('fields');
    const farmQueries = new Map<number, ReturnType<typeof farmCityQuery>>();
    const assignedFarms = new Map<number, Building | undefined>();
    let travel: ReturnType<typeof farmTravelRevision> | undefined, yieldRevision: number | undefined;
    let irrigation: Uint8Array | undefined;
    for (const field of state.fields ?? []) {
      if (!field.planted) continue;
      if (!assignedFarms.has(field.camp)) {
        const farm = this.buildingById.get(field.camp), x = farm?.x ?? field.x, y = farm?.y ?? field.y;
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
        factions.get(field.faction)?.villageBonuses?.food, state.world, yieldRevision, irrigation,
        tile?.terrain, tile?.fertility);
    }
    for (const city of this.cities.values()) city.scalars.add('units');
    for (const unit of state.units) {
      if (unit.hp <= 0) continue;
      if (unit.observationPost && !unit.observationPost.retreating) {
        const assigned = this.cities.get(unit.observationPost.city);
        const city = assigned?.palace.faction === unit.faction ? assigned
          : this.cities.get(ownership.nearest(unit, unit.faction)?.id ?? -1);
        if (city) { city.unitCosts.push(3); city.scalars.add(3); }
      }
      if (!retinue(unit)) continue;
      const home = this.buildingById.get(unit.home ?? -1);
      const city = this.cities.get(ownership.nearest(home?.faction === unit.faction && buildingReady(home)
        ? { x: home.x + buildingSize(home) / 2, y: home.y + buildingSize(home) / 2 } : unit, unit.faction)?.id ?? -1);
      if (city) { const cost = retinueUpkeep(unit); city.unitCosts.push(cost); city.scalars.add(cost); }
    }
    for (const city of this.cities.values()) city.scalars.add('fishing');
    for (const receipt of state.fishing?.receipts ?? []) {
      const city = this.cities.get(receipt.city);
      if (city && receipt.faction === city.palace.faction) city.scalars.add(receipt.at, receipt.food);
    }
    for (const group of this.groups.values()) if (group.scalars.end()) group.revision++;
    for (const city of this.cities.values()) if (city.scalars.end()) city.revision++;
  }
}
