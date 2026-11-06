import { entityStore } from './entity-store';
import { defenseHealthMultiplier } from './research-bonuses';
import { buildingReady, isWallKind, type Building, type Faction, type GameState } from './types';
import { markWorldChanged } from './world-revisions';

export const STONE_WALL_GOLD = 30;
export const STONE_WALL_HEALTH_MULTIPLIER = 10;
export const STONE_GATE_HEALTH_MULTIPLIER = 5;
export const STONE_WALL_DEFENSE_MULTIPLIER = 1.5;

type DefensiveSite = Pick<Building, 'kind' | 'fortificationHealthMultiplier'>;
const tower = (building: Pick<Building, 'kind'>): boolean => building.kind === 'tower' || building.kind === 'woodenTower';
const defensive = (building: Pick<Building, 'kind'>): boolean => isWallKind(building.kind) || building.kind === 'fort' || tower(building);

/** Authored armor stays unchanged; equipment is applied separately by the
 * combat calculation. Timber walls and unsupported towers keep their armor. */
export function fortificationArmorMultiplier(building: DefensiveSite): number {
  return building.kind === 'wall' || building.kind === 'fort' || tower(building) && (building.fortificationHealthMultiplier ?? 1) > 1
    ? STONE_WALL_DEFENSE_MULTIPLIER : 1;
}

/** Keep the original health, including stronger camp defenses. Changing owner,
 * research, or support preserves wounds and never compounds an earlier bonus. */
export function applyDefensiveStats(building: Building, faction: Pick<Faction, 'research'> | undefined): void {
  if (!defensive(building)) return;
  const base = building.defenseBaseMaxHp ??= building.maxHp / (building.enemyStrengthMultiplier ?? 1);
  const layout = building.fortificationHealthMultiplier ?? (building.kind === 'wall' || building.kind === 'fort' ? STONE_WALL_HEALTH_MULTIPLIER : 1);
  const maximum = base * layout * defenseHealthMultiplier(faction) * (building.enemyStrengthMultiplier ?? 1);
  if (maximum === building.maxHp) return;
  const fraction = building.maxHp > 0 ? Math.max(0, Math.min(1, building.hp / building.maxHp)) : 0;
  building.maxHp = maximum;
  building.hp = maximum * fraction;
}

interface Snapshot { worldRevision: number | undefined; buildingRevision: number }
const snapshots = new WeakMap<GameState, Snapshot>();

/** Refresh on actual layout changes, not every unit/frame. A reserved road
 * already opens a gate, while tower support requires a completed living wall. */
export function updateWallStats(state: GameState, force = false): void {
  const buildingRevision = entityStore(state).buildings.revision, previous = snapshots.get(state);
  if (!force && previous?.worldRevision === state.world.revision && previous?.buildingRevision === buildingRevision) return;
  const roads = new Set<number>(), walls = new Map<number, Building>();
  const cell = (building: Building): number => building.y * state.world.width + building.x;
  for (const building of state.buildings) {
    if (building.hp <= 0) continue;
    if (building.kind === 'road') roads.add(cell(building));
    else if (building.kind === 'wall' && buildingReady(building)) walls.set(cell(building), building);
  }
  const factions = new Map(state.factions.map(faction => [faction.id, faction]));
  let changed = false;
  for (const building of state.buildings) {
    if (!defensive(building)) continue;
    const key = cell(building), wall = walls.get(key), gate = roads.has(key);
    const multiplier = building.kind === 'fort' ? STONE_WALL_HEALTH_MULTIPLIER : building.kind === 'wall' ? (gate ? STONE_GATE_HEALTH_MULTIPLIER : STONE_WALL_HEALTH_MULTIPLIER)
      : tower(building) && wall?.faction === building.faction && !gate ? STONE_WALL_HEALTH_MULTIPLIER : 1;
    const oldArmor = fortificationArmorMultiplier(building), oldMaximum = building.maxHp;
    building.fortificationHealthMultiplier = multiplier;
    applyDefensiveStats(building, factions.get(building.faction));
    changed ||= oldMaximum !== building.maxHp || oldArmor !== fortificationArmorMultiplier(building);
  }
  if (changed) markWorldChanged(state.world);
  snapshots.set(state, { worldRevision: state.world.revision, buildingRevision });
}
