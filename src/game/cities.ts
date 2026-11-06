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
const summaryScopes = new WeakMap<GameState, { value?: CitySummary[]; residents?: CityResidents[] }>();

/** The caller owns a synchronous read-only phase. A mutation phase suspends
 * the snapshot, so queries made while building/relocating see live state. */
export function withCitySummarySnapshot<T>(state: GameState, operation: () => T): T {
    if (summaryScopes.has(state)) return operation();
    summaryScopes.set(state, {});
    try { return operation(); } finally { summaryScopes.delete(state); }
}

export function withLiveCitySummaries<T>(state: GameState, operation: () => T): T {
    const previous = summaryScopes.get(state);
    summaryScopes.delete(state);
    try { return operation(); } finally {
        if (previous) { previous.value = undefined; previous.residents = undefined; summaryScopes.set(state, previous); }
    }
}

export function invalidateCitySummarySnapshot(state: GameState): void {
    const scope = summaryScopes.get(state);
    if (scope) { scope.value = undefined; scope.residents = undefined; }
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
    if (scope?.residents) return scope.residents;
    const cities: CityResidents[] = [];
    const byFaction = new Map<number, CityResidents[]>();
    const byPalace = new Map<number, CityResidents>();
    const ownership = cityOwnership(state);
    for (const palace of ownership.palaces) {
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
    for (const house of state.buildings) {
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
    if (scope) scope.residents = cities;
    return cities;
}

/** Assign every house, farm and soldier to exactly one friendly palace. The
 * local net rates sum to the faction's normal food and gold rate; joining
 * another faction does not repeat the combined realm total on every palace. */
export function citySummaries(state: GameState): CitySummary[] {
    const scope = summaryScopes.get(state);
    if (scope?.value) return scope.value;
    const cities: CitySummary[] = cityResidents(state).map(({ housingGold, ...city }) => ({ ...city,
        food: palaceFoodProduction(city.palace) + fishingCityFoodPerEconomyCycle(state, city.palace.id) - city.population,
        gold: (city.population + housingGold) * TAX_INCOME_MULTIPLIER }));
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
        if ((unit.kind !== 'warrior' && unit.kind !== 'spearman' && unit.kind !== 'horseman' && unit.kind !== 'archer') || unit.hp <= 0) continue;
        const home = unit.home === undefined ? undefined : buildings.get(unit.home);
        const city = byPalace.get(ownership.nearest(home?.faction === unit.faction && buildingReady(home)
            ? { x: home.x + buildingSize(home) / 2, y: home.y + buildingSize(home) / 2 } : unit, unit.faction)?.id ?? -1);
        if (city) city.gold -= unit.kind === 'archer' ? 1 : .5;
    }
    if (scope) scope.value = cities;
    return cities;
}
