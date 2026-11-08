import { entityStore } from '../../src/game/entity-store';
import { markWorldChanged } from '../../src/game/world-revisions';
import type { GameState, RegionalResource } from '../../src/game/types';

/** Equipment/training fixtures explicitly supply their new material access. */
export function withDevelopedResources(state: GameState, resources: readonly RegionalResource[], faction = 0): GameState {
    let palace = state.buildings.find(building => building.kind === 'palace' && building.faction === faction && building.hp > 0);
    if (!palace) {
        palace = { id: Math.max(0, ...state.buildings.map(b => b.id)) + 100, kind: 'palace', faction,
            x: 4, y: 10, hp: 650, maxHp: 650, capacity: 0, governorPermissions: { farms: false, housing: false } };
        entityStore(state).buildings.add(palace);
    }
    resources.forEach((resource, i) => {
        const x = Math.max(0, palace!.x - 1), y = palace!.y + i;
        Object.assign(state.world.tiles[y * state.world.width + x], { resource, resourceDeveloped: true, resourceGroup: 9000 + i });
    });
    markWorldChanged(state.world, 'appearance');
    return state;
}
