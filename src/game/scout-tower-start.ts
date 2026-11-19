import { territory, UNCLAIMED } from './borders';
import { entityStore } from './entity-store';
import { nativeScoutTowerSites } from './faction-defense-native';
import { rustEngine } from './rust-engine';
import { territoryValue } from './territory-cells';
import { buildingReady, type Building, type GameState, type Point } from './types';

/** Adapt the starting world's occupied and reserved cells once, then let the
 * native defense index choose dry, connected positions around each capital. */
export function placeStartingScoutTowers(state: GameState, add: (faction: number, point: Point) => void): boolean {
  const store = entityStore(state), capitals = new Map<number, Building>();
  for (const city of store.buildings.query('palace')) if (buildingReady(city)) {
    const current = capitals.get(city.faction);
    if (!current || city.initialCity && !current.initialCity
      || !!city.initialCity === !!current.initialCity && city.id < current.id) capitals.set(city.faction, city);
  }
  const existing = new Set(state.buildings.filter(b => b.kind === 'scoutTower').map(b => b.faction));
  const { width, height } = state.world, reserved = new Set<number>();
  const reserve = ({ x, y }: Point, size = 1): void => {
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++)
      reserved.add((Math.floor(y) + dy) * width + Math.floor(x) + dx);
  };
  for (const unit of state.units) if (unit.hp > 0 && !unit.inside) reserve(unit);
  for (const hermit of state.hermits ?? []) reserve(hermit, hermit.status === 'gone' ? 1 : 2);
  for (const site of state.explorationSites ?? []) if (site.status !== 2) reserve(site, site.kind === 0 ? 2 : 1);
  for (const chest of state.treasures ?? []) if (!chest.collected) reserve(chest);
  const borders = territory(state);
  const radius = rustEngine.scout_tower_search_radius();
  let placed = false;
  for (const faction of state.factions) {
    const city = capitals.get(faction.id);
    if (!city || faction.id < 0 || faction.villageId !== undefined || faction.defeated || existing.has(faction.id)) continue;
    const blocked: number[] = [];
    for (let y = Math.max(0, city.y + 1 - radius); y <= Math.min(height - 1, city.y + radius); y++)
      for (let x = Math.max(0, city.x + 1 - radius); x <= Math.min(width - 1, city.x + radius); x++) {
        const cell = y * width + x, owner = territoryValue(borders, cell);
        if (reserved.has(cell) || owner !== UNCLAIMED && owner !== faction.id) blocked.push(cell);
      }
    for (const point of nativeScoutTowerSites(state, city, blocked)) {
      add(faction.id, point);
      placed = true;
    }
  }
  return placed;
}
