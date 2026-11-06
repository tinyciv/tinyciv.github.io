import { factionColor } from './faction-colors';
import { RAIDER_COLOR } from './raider-camps';
import type { GameState, Unit } from './types';
import { DEATH_ANIMATION_DURATION } from './combat-effect-art';

export const UNIT_DEATH_LIFETIME = DEATH_ANIMATION_DURATION;
export const MAX_UNIT_DEATHS = 256;
const recordedDeaths = new WeakMap<GameState, WeakSet<Unit>>();

/** Call at the fatal damage site, not generic entity removal: route closure,
 * guard retirement and hidden worker reconciliation are not deaths. */
export function recordUnitDeath(state: GameState, unit: Unit): void {
    if (unit.hp > 0 || unit.inside || unit.guardRetired
        || !['leader', 'warrior', 'spearman', 'horseman', 'archer', 'scout', 'militia', 'worker', 'merchant'].includes(unit.kind)) return;
    let recorded = recordedDeaths.get(state);
    if (!recorded) { recorded = new WeakSet(); recordedDeaths.set(state, recorded); }
    if (recorded.has(unit)) return;
    recorded.add(unit);
    // Animation needs the appearance snapshot, never a retained route or cargo history.
    const { path: _path, cargoBatches: _batches, ...snapshot } = unit;
    const color = factionColor(state, unit.faction,
        state.marauderPacks?.find(pack => pack.id === unit.marauderPack)?.color
        ?? (unit.faction === -2 ? RAIDER_COLOR : '#ad8c57'));
    const deaths = state.unitDeaths ??= [];
    deaths.push({ unit: { ...snapshot, order: 'hold', moving: false, attackTime: 0, cargo: 0 }, x: unit.x, y: unit.y, time: state.time, color });
    if (deaths.length > MAX_UNIT_DEATHS) deaths.splice(0, deaths.length - MAX_UNIT_DEATHS);
}

/** Simulation time drives both the fall and corpse expiry, so pause freezes them. */
export function updateUnitDeaths(state: GameState): void {
    const deaths = state.unitDeaths;
    if (!deaths?.length) return;
    let retained = 0;
    for (const death of deaths) if (state.time - death.time < UNIT_DEATH_LIFETIME) deaths[retained++] = death;
    deaths.length = retained;
    if (deaths.length > MAX_UNIT_DEATHS) deaths.splice(0, deaths.length - MAX_UNIT_DEATHS);
}
