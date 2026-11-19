import { rustEngine } from './rust-engine';
import { grantIncome } from './resource-income';
import { insideOwnBorders, territory } from './borders';
import { type GameState, type Building, type Faction, type HouseStyle, type Point, buildingReady, distance } from './types';
import { housingResearchBonus } from './research-bonuses';
import { HOUSE_BASE_CAPACITIES } from './housing-config';
import { thermalBathCapacity } from './thermal-baths-native';
import { structureIndex, type StructureIndex } from './structure-index';
import { notifyRepairJobChanged } from './builder-jobs';
import { settlementBuildings, type SettlementBuildings } from './settlement-rosters';

export const WELL_RADIUS = 8;
export const WELL_POPULATION_REQUIREMENT = 30;
export const LEVEL_THREE_POPULATION = 40;
export const LEVEL_THREE_RADIUS = 6;
export const HOUSE_UPGRADE_SECONDS = 15;
export const HOUSE_UPGRADE_GOLD = 3;
export const HOUSE_DOWNGRADE_SECONDS = 60;
const LEVEL_STYLES: readonly HouseStyle[] = ['shack', 'hovel', 'cottage', 'villa'];
export const houseLevel = (house: Building): number => Math.max(1, Math.min(4, Math.floor(house.houseLevel ?? 1)));
export const houseCapacity = (house: Building, faction?: Pick<Faction, 'research'>, state?: GameState): number => {
  const base = (house.kind === 'apartments' ? rustEngine.civic_building_constant(39, 3) : HOUSE_BASE_CAPACITIES[houseLevel(house) - 1]) + (house.redevelopedFarm ? 1 : 0) + housingResearchBonus(faction);
  return state ? thermalBathCapacity(state, house, base) : base;
};
export const houseGoldMultiplier = (house: Building): number => houseLevel(house) >= 3 ? 1.5 : 1;

/** Revalidated every housing update; a lost requirement cancels the countdown. */
export function advanceHouseUpgrade(state: GameState, house: Building, target: number): void {
  const current = houseLevel(house);
  if (target <= current) {
    delete house.houseUpgradeAt; delete house.houseUpgradeLevel; delete house.houseUpgradeFaction;
    return;
  }
  if (house.houseUpgradeLevel !== target || house.houseUpgradeFaction !== house.faction) {
    house.houseUpgradeAt = state.time + HOUSE_UPGRADE_SECONDS;
    house.houseUpgradeLevel = target; house.houseUpgradeFaction = house.faction;
  }
  if (state.time + 1e-7 < house.houseUpgradeAt!) return;
  house.houseLevel = target;
  if (current < 2 || house.villageId !== undefined) { house.maxHp += 40; house.hp += 40; }
  notifyRepairJobChanged(state, house);
  const faction = state.factions.find(candidate => candidate.id === house.faction);
  if (faction) grantIncome(faction, { gold: HOUSE_UPGRADE_GOLD }, state);
  state.particles.push({ x: house.x + .5, y: house.y, text: `+${HOUSE_UPGRADE_GOLD} gold`, color: '#ffe33d', life: 1.6, duration: 1.6 });
  delete house.houseUpgradeAt; delete house.houseUpgradeLevel; delete house.houseUpgradeFaction;
}

/** Count the same resident ledger used by cities, never empty beds or unit sprites. */
export function housingGoldBonus(state: GameState, faction: number): number {
  let remaining = Math.max(0, state.factions.find(candidate => candidate.id === faction)?.population ?? 0), bonus = 0;
  for (const house of state.buildings) {
    if (house.kind !== 'house' || house.faction !== faction || !buildingReady(house)) continue;
    const residents = Math.min(remaining, house.capacity, Math.max(0, house.residents ?? 0));
    remaining -= residents; bonus += residents * (houseGoldMultiplier(house) - 1);
  }
  return bonus;
}

function nearestPalace(palaces: readonly Building[], point: Point): Building | undefined {
  let nearest: Building | undefined, best = Infinity;
  for (const palace of palaces) {
    const d = (point.x - palace.x - 1) ** 2 + (point.y - palace.y - 1) ** 2;
    if (d < best || d === best && palace.id < nearest!.id) { nearest = palace; best = d; }
  }
  return nearest;
}

interface HousingLayout {
  houses: Building[]; supplied: Set<Building>; cities: Map<Building, Building | undefined>;
}
const layouts = new WeakMap<SettlementBuildings, HousingLayout>();
function housingLayout(roster: SettlementBuildings): HousingLayout {
  let layout = layouts.get(roster);
  if (layout) return layout;
  layout = { houses: roster.houses.filter(buildingReady), supplied: new Set(), cities: new Map() };
  for (const house of layout.houses) {
    if (roster.wells.some(well => well.faction === house.faction && distance(well, house) <= WELL_RADIUS)) layout.supplied.add(house);
    layout.cities.set(house, nearestPalace(roster.palacesByFaction.get(house.faction) ?? [], { x: house.x + .5, y: house.y + .5 }));
  }
  for (const post of roster.posts) layout.cities.set(post,
    nearestPalace(roster.palacesByFaction.get(post.faction) ?? [], { x: post.x + .5, y: post.y + .5 }));
  layouts.set(roster, layout);
  return layout;
}

/** Wells permanently establish level two. A dense, guarded neighborhood earns
 * level three, and nearby fountain coverage earns level four.
 * Losing a requirement starts a reversible one-minute warning. */
export function updateWellUpgrades(state: GameState): void {
  const roster = settlementBuildings(state), layout = housingLayout(roster);
  const { houses } = layout, { posts, palacesByFaction: palaces } = roster;
  const factions = new Map(state.factions.map(faction => [faction.id, faction]));
  const guardedCities = new Set<number>();
  if (posts.length) {
    const borders = territory(state);
    for (const post of posts) {
      if (!insideOwnBorders(state, post.faction, post.x, post.y, borders)) continue;
      const city = layout.cities.get(post);
      if (city) guardedCities.add(city.id);
    }
  }
  interface Residents extends Point { count: number }
  const neighborhoods = new Map<string, Residents[]>();
  const remaining = new Map(state.factions.map(faction => [faction.id, Math.max(0, faction.population)]));
  const key = (faction: number, x: number, y: number) => `${faction}:${x},${y}`;
  const addResidents = (faction: number, x: number, y: number, requested: number): void => {
    const count = Math.min(remaining.get(faction) ?? 0, Math.max(0, requested));
    remaining.set(faction, (remaining.get(faction) ?? 0) - count);
    if (!count) return;
    const bucket = key(faction, Math.floor(x / LEVEL_THREE_RADIUS), Math.floor(y / LEVEL_THREE_RADIUS));
    const list = neighborhoods.get(bucket) ?? [];
    list.push({ x, y, count }); neighborhoods.set(bucket, list);
  };
  for (const house of houses) addResidents(house.faction, house.x + .5, house.y + .5, Math.min(house.capacity, house.residents ?? 0));
  for (const list of palaces.values()) for (const palace of list)
    addResidents(palace.faction, palace.x + 1, palace.y + 1, palace.unhousedResidents ?? 0);
  let structures: StructureIndex | undefined;
  for (const house of houses) {
    house.houseLevel = houseLevel(house);
    // Independent villages buy their housing quality with trade earnings;
    // their homes do not depend on the city's housing requirements.
    if (house.kind === 'apartments') { house.capacity = houseCapacity(house, factions.get(house.faction), state); continue; }
    if (house.villageId !== undefined) {
      if (house.houseUpgradeLevel !== undefined) advanceHouseUpgrade(state, house, house.houseUpgradeLevel);
      delete house.houseDowngradeAt;
      house.houseStyle = LEVEL_STYLES[house.houseLevel - 1];
      house.capacity = houseCapacity(house, factions.get(house.faction), state);
      continue;
    }
    const supplied = layout.supplied.has(house);
    const cx = house.x + .5, cy = house.y + .5;
    const city = layout.cities.get(house);
    let localPopulation = 0;
    if (supplied && city && guardedCities.has(city.id)) {
      const bx = Math.floor(cx / LEVEL_THREE_RADIUS), by = Math.floor(cy / LEVEL_THREE_RADIUS);
      for (let y = by - 1; y <= by + 1; y++) for (let x = bx - 1; x <= bx + 1; x++)
        for (const residents of neighborhoods.get(key(house.faction, x, y)) ?? [])
          if ((residents.x - cx) ** 2 + (residents.y - cy) ** 2 <= LEVEL_THREE_RADIUS ** 2) localPopulation += residents.count;
    }
    const eligible = localPopulation >= LEVEL_THREE_POPULATION;
    const earnedLevel = eligible
      ? (structures ??= structureIndex(state)).fountainCovers(house) ? 4 : 3
      : supplied ? 2 : Math.min(2, house.houseLevel);
    advanceHouseUpgrade(state, house, earnedLevel);
    if (earnedLevel >= house.houseLevel) {
      delete house.houseDowngradeAt;
    } else {
      house.houseDowngradeAt ??= state.time + HOUSE_DOWNGRADE_SECONDS;
      if (state.time + 1e-7 >= house.houseDowngradeAt) {
        house.houseLevel = earnedLevel;
        delete house.houseDowngradeAt;
      }
    }
    house.houseStyle = LEVEL_STYLES[house.houseLevel - 1];
    house.capacity = houseCapacity(house, factions.get(house.faction), state);
  }
}
