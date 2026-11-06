import { buildingActivityAvailable } from './building-activity';
import { buildingInSight, type FogView } from './fog';
import { buildingReady, isFarmKind, type Building, type GameState } from './types';

/** Peaceful village diplomacy is available through any visible village building,
 * even beyond the Leader's local activity range. Remembered buildings must not
 * acquire an interaction halo through fog. Other activities retain their range. */
export function buildingInteractionHighlighted(state: GameState, building: Building, fog: FogView): boolean {
    if (!buildingInSight(fog, building)) return false;
    if (building.villageId !== undefined) {
        const village = state.villages?.find(candidate => candidate.id === building.villageId);
        return !state.gameOver && building.hp > 0 && !!village && !village.destroyed && village.relation !== 'war'
            && state.buildings.some(camp => camp.id === village.campId && buildingReady(camp));
    }
    return !isFarmKind(building.kind) && buildingActivityAvailable(state, building);
}
