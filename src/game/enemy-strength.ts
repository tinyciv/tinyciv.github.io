import { entityStore } from './entity-store';
import { isHumanFaction } from './player-context';
import { unitMaxHp, type GameState } from './types';

export const DEFAULT_ENEMY_STRENGTH = 1;
export const MIN_ENEMY_STRENGTH = .25;
export const MAX_ENEMY_STRENGTH = 3;
function normalizeStrength(value: number | undefined, fallback = DEFAULT_ENEMY_STRENGTH): number {
  return value !== undefined && Number.isFinite(value)
    ? Math.max(MIN_ENEMY_STRENGTH, Math.min(MAX_ENEMY_STRENGTH, value)) : fallback;
}
export const enemyStrength = (state: Pick<GameState, 'enemyStrength'>): number => normalizeStrength(state.enemyStrength);

/** Difficulty belongs to computer civilizations and marauders, not neutral
 * villages, wildlife, or another human in a multiplayer match. */
export function enemyFactionStrength(state: GameState, faction: number): number {
  if (faction === -2) return normalizeStrength(state.banditStrength, enemyStrength(state));
  if (faction < 0 || isHumanFaction(state, faction)) return 1;
  const owner = state.factions.find(owner => owner.id === faction);
  return owner && owner.villageId === undefined ? enemyStrength(state) : 1;
}

interface Snapshot { units: number; buildings: number; factor: number; bandits: number; at: number }
const snapshots = new WeakMap<GameState, Snapshot>();
/** Preserve the fraction wounded and each existing layout/research bonus.
 * Cached role maxima follow the same change, so retraining cannot erase it. */
export function updateEnemyStrength(state: GameState, force = false): void {
  const store = entityStore(state), factor = enemyStrength(state), bandits = normalizeStrength(state.banditStrength, factor);
  const previous = snapshots.get(state);
  if (!force && previous?.units === store.units.revision && previous.buildings === store.buildings.revision
    && previous.factor === factor && previous.bandits === bandits && state.time >= previous.at && state.time < previous.at + .25) return;
  const factions = new Map(state.factions.map(owner => [owner.id, enemyFactionStrength(state, owner.id)]));
  const multiplier = (faction: number): number => faction === -2 ? bandits : factions.get(faction) ?? 1;
  for (const unit of state.units) {
    const desired = multiplier(unit.faction), old = unit.enemyStrengthMultiplier ?? 1;
    if (desired === old) continue;
    const ratio = desired / old;
    unit.maxHp = unitMaxHp(unit) * ratio; unit.hp *= ratio;
    if (unit.warriorStats) unit.warriorStats.hp *= ratio;
    if (unit.levy?.original.maxHp !== undefined) unit.levy.original.maxHp *= ratio;
    unit.enemyStrengthMultiplier = desired;
  }
  for (const building of state.buildings) {
    const desired = multiplier(building.faction), old = building.enemyStrengthMultiplier ?? 1;
    if (desired === old) continue;
    building.maxHp *= desired / old; building.hp *= desired / old;
    building.enemyStrengthMultiplier = desired;
  }
  snapshots.set(state, { units: store.units.revision, buildings: store.buildings.revision, factor, bandits, at: state.time });
}

export function setEnemyStrength(state: GameState, multiplier: number): number {
  state.enemyStrength = normalizeStrength(multiplier);
  updateEnemyStrength(state, true);
  return state.enemyStrength;
}
