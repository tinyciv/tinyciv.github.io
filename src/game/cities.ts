import { retinueUpkeep } from './archery';
import { fieldHarvestYield, harvestFoodPerEconomyCycle } from './farms';
import { guardPostUpkeep } from './guard-posts';
import { buildingMaintenance, TAX_INCOME_MULTIPLIER } from './maintenance';
import { houseGoldMultiplier } from './wells';
import { type Building, type GameState, buildingReady, buildingSize } from './types';
import { CIVILIZATIONS, civilizationFor } from './civilizations';
import { farmCityQuery } from './farm-travel';
import { palaceFoodProduction } from './city-support';
import { cityOwnership } from './city-ownership';
import { entityStore } from './entity-store';
import { retinueSlotUpkeep } from './retinue-purchases';
import { fishingCityFoodPerEconomyCycle } from './fishing';
import { saltFoodConsumptionMultiplier } from './resource-development';
import { CityEconomyIndex, type CityEconomyCity, type CityEconomyGroup } from './city-economy-index';
import { simulationReadsActive } from './simulation-reads';

export interface CitySummary {
    palace: Building;
    name: string;
    population: number;
    housing: number;
    /** Potential net harvest and net gold per 30 game seconds; food still needs delivery. */
    food: number;
    gold: number;
}

export interface CityResidents extends Pick<CitySummary, 'palace' | 'name' | 'population' | 'housing'> {
    housingGold: number;
}
interface FactionEconomy {
    revision: number; residents: CityResidents[];
}
interface CityEconomyResult { revision: number; resident: CityResidents; value: CitySummary; }
interface SummaryScope {
    value?: CitySummary[]; residents?: CityResidents[]; live?: boolean;
    index?: CityEconomyIndex; factions: Map<number, FactionEconomy>; cities: Map<number, CityEconomyResult>;
}
const summaryScopes = new WeakMap<GameState, SummaryScope>();

/** The caller owns a synchronous read-only phase. A mutation phase suspends
 * the snapshot, so queries made while building/relocating see live state. */
export function withCitySummarySnapshot<T>(state: GameState, operation: () => T): T {
    if (summaryScopes.has(state)) return operation();
    summaryScopes.set(state, { factions: new Map(), cities: new Map() });
    try { return operation(); } finally { summaryScopes.delete(state); }
}

export function withLiveCitySummaries<T>(state: GameState, operation: () => T): T {
    const previous = summaryScopes.get(state);
    // A versioned simulation owns all terrain edits. Keep its transaction
    // index, but reconcile live scalar inputs on every read during an order.
    // Standalone editor/import callers keep the unrestricted fresh-read path.
    const indexed = previous && simulationReadsActive(state) && state.world.revision !== undefined;
    const wasLive = previous?.live;
    if (indexed) previous.live = true;
    else summaryScopes.delete(state);
    try { return operation(); } finally {
        if (previous) {
            previous.live = wasLive; previous.value = undefined; previous.residents = undefined;
            summaryScopes.set(state, previous);
        }
    }
}

export function invalidateCitySummarySnapshot(state: GameState): void {
    const scope = summaryScopes.get(state);
    if (scope) {
        scope.value = undefined; scope.residents = undefined;
        scope.index = undefined; scope.factions.clear(); scope.cities.clear();
    }
}

function reconcileEconomy(state: GameState, scope: SummaryScope): CityEconomyIndex {
    const index = scope.index ??= new CityEconomyIndex();
    index.reconcile(state);
    for (const group of index.groups.values()) {
        if (scope.factions.get(group.faction)?.revision === group.revision) continue;
        scope.factions.set(group.faction, { revision: group.revision, residents: calculateCityResidents(state, group) });
    }
    return index;
}

function indexedScope(state: GameState): SummaryScope | undefined {
    const scope = summaryScopes.get(state);
    return scope && simulationReadsActive(state) && state.world.revision !== undefined ? scope : undefined;
}

/** Preserve the entity store's city order when several faction aggregates are
 * joined. Each city's summations retain original building/field/unit order. */
function orderedCities<T extends { palace: Building }>(state: GameState, groups: Iterable<readonly T[]>): T[] {
    const byPalace = new Map<number, T>();
    for (const group of groups) for (const city of group) byPalace.set(city.palace.id, city);
    const result: T[] = [];
    for (const palace of cityOwnership(state).palaces) {
        const city = byPalace.get(palace.id); if (city) result.push(city);
    }
    return result;
}

/** Naming never consumes simulation RNG; the name belongs to the palace. */
export const ROMAN_CITY_NAMES = CIVILIZATIONS[0].cities;

export function nextCityName(state: GameState, faction: number): string {
    const used = new Set(state.buildings.filter(building => building.kind === 'palace').map(building => building.cityName));
    for (let cycle = 1; ; cycle++) for (const name of civilizationFor(faction).cities) {
        const candidate = cycle === 1 ? name : `${name} ${cycle}`;
        if (!used.has(candidate)) return candidate;
    }
}

/** Population planning needs no field-yield, route or soldier-upkeep scan. This
 * resident pass is also reused when a full economic summary is requested. */
export function cityResidents(state: GameState): CityResidents[] {
    const scope = summaryScopes.get(state);
    if (scope?.residents && !scope.live) return scope.residents;
    const indexed = indexedScope(state);
    if (indexed) {
        reconcileEconomy(state, indexed);
        return indexed.residents = orderedCities(state, Array.from(indexed.factions.values(), value => value.residents));
    }
    const cities = calculateCityResidents(state);
    if (scope) scope.residents = cities;
    return cities;
}

function calculateCityResidents(state: GameState, group?: CityEconomyGroup): CityResidents[] {
    const cities: CityResidents[] = [];
    const byFaction = new Map<number, CityResidents[]>();
    const byPalace = new Map<number, CityResidents>();
    const ownership = cityOwnership(state);
    for (const palace of ownership.palaces) {
        if (group && palace.faction !== group.faction) continue;
        if (palace.kind !== 'palace' || palace.faction < 0 || !buildingReady(palace)) continue;
        const faction = state.factions.find(candidate => candidate.id === palace.faction);
        if (!faction || faction.defeated) continue;
        const city: CityResidents = { palace, name: palace.cityName ?? faction.name, population: 0, housing: palace.capacity, housingGold: 0 };
        cities.push(city);
        byPalace.set(palace.id, city);
        const factionCities = byFaction.get(palace.faction) ?? [];
        factionCities.push(city); byFaction.set(palace.faction, factionCities);
    }
    const remaining = new Map(state.factions.map(faction => [faction.id, Math.max(0, faction.population)]));
    for (const house of group?.buildings ?? state.buildings) {
        if (house.kind !== 'house' || !buildingReady(house)) continue;
        const city = byPalace.get(ownership.building(house)?.id ?? -1);
        if (!city) continue;
        city.housing += house.capacity;
        const residents = Math.min(Math.max(0, house.residents ?? 0), house.capacity, remaining.get(house.faction) ?? 0);
        city.population += residents;
        city.housingGold += residents * (houseGoldMultiplier(house) - 1);
        remaining.set(house.faction, (remaining.get(house.faction) ?? 0) - residents);
    }
    for (const city of cities) {
        const residents = Math.min(Math.max(0, city.palace.unhousedResidents ?? 0), remaining.get(city.palace.faction) ?? 0);
        city.population += residents;
        remaining.set(city.palace.faction, (remaining.get(city.palace.faction) ?? 0) - residents);
    }
    // Any other temporarily unhoused residents still consume food and pay taxes.
    // Attribute them to the founding city until normal housing reconciliation.
    for (const [faction, factionCities] of byFaction) {
        factionCities.sort((a, b) => a.palace.id - b.palace.id);
        factionCities[0].population += remaining.get(faction) ?? 0;
    }
    return cities;
}

/** All developed salt shares one faction-wide allowance of ten residents per
 * tile. Every city applies the same multiplier, so the allowance is not reused. */
export function factionFoodConsumption(state: GameState, faction: number): number {
    const population = Math.max(0, state.factions.find(owner => owner.id === faction)?.population ?? 0);
    return population * saltFoodConsumptionMultiplier(state, faction);
}

/** Assign every house, farm and soldier to exactly one friendly palace. The
 * local net rates sum to the faction's normal food and gold rate; joining
 * another faction does not repeat the combined realm total on every palace. */
export function citySummaries(state: GameState): CitySummary[] {
    const scope = summaryScopes.get(state);
    if (scope?.value && !scope.live) return scope.value;
    const indexed = indexedScope(state);
    if (indexed) {
        const index = reconcileEconomy(state, indexed);
        for (const [id, city] of index.cities) {
            const resident = indexed.factions.get(city.palace.faction)?.residents.find(value => value.palace === city.palace);
            if (!resident) continue;
            const cached = indexed.cities.get(id), old = cached?.resident;
            if (!cached || cached.revision !== city.revision || old!.palace !== resident.palace
                || old!.name !== resident.name || old!.population !== resident.population
                || old!.housing !== resident.housing || old!.housingGold !== resident.housingGold)
                indexed.cities.set(id, { revision: city.revision, resident, value: calculateIndexedCitySummary(state, resident, city) });
        }
        for (const id of indexed.cities.keys()) if (!index.cities.has(id)) indexed.cities.delete(id);
        return indexed.value = orderedCities(state, [Array.from(indexed.cities.values(), value => value.value)]);
    }
    const cities = calculateCitySummaries(state, cityResidents(state));
    if (scope) scope.value = cities;
    return cities;
}

function initialCitySummary(state: GameState, { housingGold, ...city }: CityResidents, salt = saltFoodConsumptionMultiplier(state, city.palace.faction)): CitySummary {
    return { ...city,
        food: palaceFoodProduction(city.palace) + fishingCityFoodPerEconomyCycle(state, city.palace.id)
            - city.population * salt,
        gold: (city.population + housingGold) * TAX_INCOME_MULTIPLIER };
}

function calculateIndexedCitySummary(state: GameState, resident: CityResidents, inputs: CityEconomyCity): CitySummary {
    const city = initialCitySummary(state, resident, inputs.saltConsumption);
    if (inputs.capital) {
        const faction = state.factions.find(faction => faction.id === city.palace.faction);
        if (faction) city.gold -= retinueSlotUpkeep(faction);
    }
    for (const building of inputs.buildings)
        city.gold -= building.kind === 'guardPost'
            ? building.guardPost?.funded === true ? guardPostUpkeep(building) : 0
            : buildingMaintenance(state, building);
    for (const field of inputs.fields) city.food += harvestFoodPerEconomyCycle(fieldHarvestYield(state, field));
    for (const cost of inputs.unitCosts) city.gold -= cost;
    return city;
}

function calculateCitySummaries(state: GameState, residents: readonly CityResidents[]): CitySummary[] {
    const cities: CitySummary[] = residents.map(city => initialCitySummary(state, city));
    const byPalace = new Map(cities.map(city => [city.palace.id, city]));
    // Purchased capacity is one faction-wide expense, including vacant slots.
    // Attribute it once to the capital rather than charging it in every city.
    for (const faction of state.factions) {
        const capital = cities.filter(city => city.palace.faction === faction.id)
            .reduce<CitySummary | undefined>((oldest, city) => !oldest || city.palace.id < oldest.palace.id ? city : oldest, undefined);
        if (capital) capital.gold -= retinueSlotUpkeep(faction);
    }
    const buildings = entityStore(state).buildings, ownership = cityOwnership(state);
    for (const building of state.buildings) {
        if (!buildingReady(building) || building.villageId !== undefined
            || !['palace', 'woodenTower', 'tower', 'guardPost'].includes(building.kind)) continue;
        const city = byPalace.get(ownership.building(building)?.id ?? -1);
        if (!city) continue;
        const upkeep = building.kind === 'guardPost'
            ? building.guardPost?.funded === true ? guardPostUpkeep(building) : 0
            : buildingMaintenance(state, building);
        city.gold -= upkeep;
    }
    const farmCities = new Map<number, CitySummary | undefined>();
    const farmQueries = new Map<number, ReturnType<typeof farmCityQuery>>();
    for (const field of state.fields ?? []) {
        if (!field.planted) continue;
        if (!farmCities.has(field.camp)) {
            const farm = buildings.get(field.camp);
            if (farm && !farmQueries.has(farm.faction)) farmQueries.set(farm.faction, farmCityQuery(state, farm.faction));
            farmCities.set(field.camp, farm
                ? byPalace.get(farmQueries.get(farm.faction)?.(farm)?.id ?? -1)
                : byPalace.get(ownership.nearest({ x: field.x + .5, y: field.y + .5 }, field.faction)?.id ?? -1));
        }
        const city = farmCities.get(field.camp);
        if (city) city.food += harvestFoodPerEconomyCycle(fieldHarvestYield(state, field));
    }
    for (const unit of state.units) {
        if (unit.hp > 0 && unit.observationPost && !unit.observationPost.retreating) {
            const post = unit.observationPost, assigned = byPalace.get(post.city);
            const city = assigned?.palace.faction === unit.faction ? assigned : byPalace.get(ownership.nearest(unit, unit.faction)?.id ?? -1);
            if (city) city.gold -= 3;
        }
        if ((unit.kind !== 'warrior' && unit.kind !== 'swordsman' && unit.kind !== 'spearman' && unit.kind !== 'horseman' && unit.kind !== 'horseArcher' && unit.kind !== 'knight' && unit.kind !== 'archer') || unit.hp <= 0) continue;
        const home = unit.home === undefined ? undefined : buildings.get(unit.home);
        const city = byPalace.get(ownership.nearest(home?.faction === unit.faction && buildingReady(home)
            ? { x: home.x + buildingSize(home) / 2, y: home.y + buildingSize(home) / 2 } : unit, unit.faction)?.id ?? -1);
        if (city) city.gold -= retinueUpkeep(unit);
    }
    return cities;
}
