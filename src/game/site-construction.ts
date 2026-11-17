import { buildAt, validateBuildAt } from './simulation';
import { siteTarget } from './sites-native';
import { playerFaction } from './player-context';
import type { GameState } from './types';

/** Shared local/server command: native Site rules select the building, then
 * the ordinary construction transaction validates, reserves and charges it. */
export function buildSite(state: GameState, siteId: number, actor = playerFaction(state)) {
    const target = siteTarget(state, siteId, actor);
    if (!target) return { ok: false, message: 'Approach an available site with your Leader.', siteId };
    return { ...buildAt(state, target.kind, target.x, target.y, actor), siteId };
}
export function quoteSite(state: GameState, siteId: number, actor = playerFaction(state)) {
    const target = siteTarget(state, siteId, actor);
    return target ? validateBuildAt(state, target.kind, target.x, target.y, actor)
        : { ok: false, message: 'Approach an available site with your Leader.' };
}
