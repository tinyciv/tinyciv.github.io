import { playerFaction } from './player-context';
import { entityStore } from './entity-store';
import { hermitPosition } from './hermits';
import { fogRenderMask, pointInSight, type FogView } from './fog';
import { buildingWidth, buildingHeight, type GameState, type Point } from './types';
import type { QuestView } from './quest-types';

export function questFailureReason(quest: QuestView): string {
    return ['The quest failed.', 'The giver is gone or hostile.', 'Your original capital has fallen.',
        'Another realm ended the camp’s threat.', 'Your realm can no longer fulfill the request.'][quest.reason] ?? 'The quest failed.';
}

/** Describe published native progress without rechecking quest rules. */
export function questIncompleteMessage(quest: QuestView | undefined): string {
    if (!quest) return 'Complete the quest objective before claiming its reward.';
    if (quest.state === 0) return 'Accept this quest before claiming its reward.';
    if (quest.state === 3) return 'This quest’s reward has already been claimed.';
    if (quest.state === 4) return questFailureReason(quest);
    switch (quest.kind) {
        case 0: return `Complete an observation post in the marked area and keep it standing for 180 seconds (${Math.floor(quest.progress)}/180).`;
        case 1: return 'Connect your original capital’s road network to the giver with completed roads and bridges.';
        case 2: return `Destroy the marked camp’s remaining targets (${quest.progress}/${quest.needed} destroyed).`;
        case 3: return 'Land your Leader on an unvisited continent, then return to the giver.';
        case 4: return 'Enclose the village’s main tent and homes with completed palisade walls.';
        case 5: return 'Complete a new town within 8 tiles of the village.';
        case 6: return `Complete 10 new farm tiles in the marked riverside area (${quest.progress}/10).`;
        case 7: return `Grow one town on the new continent to 40 residents (${quest.progress}/40).`;
    }
}

/** Marker placement follows the same live coordinates as the rendered giver.
 * Quest progress and last-seen positions retain their one-second cadence. */
export function questGiverPosition(state: GameState, quest: QuestView): Point | undefined {
    if (quest.giverKind >= 2) {
        const hermit = state.hermits?.find(h => h.id === quest.giver);
        return hermit?.status === 'home' ? hermitPosition(hermit) : undefined;
    }
    const store = entityStore(state);
    if (quest.giverKind === 1) {
        const unit = store.units.get(quest.giver);
        return unit && unit.hp > 0 && !unit.inside ? unit : undefined;
    }
    const building = store.buildings.get(quest.giver);
    return building && building.hp > 0
        ? { x: building.x + buildingWidth(building) / 2, y: building.y + buildingHeight(building) / 2 } : undefined;
}

/** Keep markers off fog frontiers and wait until the reveal fade has cleared.
 * The surrounding cells also cover the icon's raised position above its giver. */
export function questMarkerRevealed(fog: FogView, point: Point): boolean {
    const x = Math.floor(point.x), y = Math.floor(point.y);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= fog.width || ny >= fog.height) continue;
        if (!pointInSight(fog, nx, ny)) return false;
    }
    if (!pointInSight(fog, x, y)) return false;
    const mask = fogRenderMask(fog);
    for (let py = y * mask.scale; py < (y + 1) * mask.scale; py++)
        for (let px = x * mask.scale; px < (x + 1) * mask.scale; px++)
            if (mask.alpha[py * mask.width + px]) return false;
    return true;
}
const caches = new WeakMap<GameState, {
    source: QuestView[] | undefined;
    actor: number;
    cells: Set<number>;
}>();
export function questAreaCells(state: GameState): ReadonlySet<number> {
    const actor = playerFaction(state), cached = caches.get(state);
    if (cached?.source === state.quests && cached?.actor === actor)
        return cached.cells;
    const cells = new Set<number>();
    for (const q of state.quests ?? [])
        if (q.actor === actor && (q.state === 1 || q.state === 2))
            for (const cell of q.area)
                cells.add(cell);
    caches.set(state, { source: state.quests, actor, cells });
    return cells;
}
