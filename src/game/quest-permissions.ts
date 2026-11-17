import { BUILDING_KIND_CODES, entityStore } from './entity-store';
import { playerFaction } from './player-context';
import { rustEngine } from './rust-engine';
import { simCore, SimSlot } from './sim-handle';
import type { Building, BuildingKind, GameState } from './types';
import { atWar } from './relations';
const revisions = new SimSlot<number>();
function mirror(state: GameState): number {
    const handle = simCore(state).handle;
    if (!state.multiplayer || rustEngine.sim_quests_authoritative(handle) || revisions.get(state) === (state.questsRevision ?? 0))
        return handle;
    const values: number[] = [state.quests?.length ?? 0];
    for (const q of state.quests ?? [])
        values.push(q.actor, q.kind, q.state, q.giverKind, q.giver, q.village, q.giverFaction, q.gx, q.gy, Number(q.discovered), q.x, q.y, q.radius, q.target, q.progress, q.needed, q.reason, q.land, q.gold, q.food, q.relations, q.benefits, q.area.length, ...q.area);
    const pointer = rustEngine.sim_quests_input(handle, values.length);
    new Float64Array(rustEngine.memory.buffer, pointer, values.length).set(values);
    rustEngine.sim_quests_mirrors(handle, state.world.width, state.world.height);
    revisions.set(state, state.questsRevision ?? 0);
    return handle;
}
export const questBuildPermission = (state: GameState, kind: BuildingKind, x: number, y: number, actor = playerFaction(state)): boolean => !!rustEngine.sim_quests_permits(mirror(state), actor, BUILDING_KIND_CODES[kind], Math.floor(x), Math.floor(y));
/** Native pledges keep unfinished gifts from being reclaimed before turn-in. */
export const questPropertyReserved = (state: GameState, building: Building): boolean => !!rustEngine.sim_quests_reserved(simCore(state).handle, building.id, building.faction, BUILDING_KIND_CODES[building.kind], building.x, building.y);
export const questGateAccess = (state: GameState, a: number, b: number): boolean => !!rustEngine.sim_quests_access(mirror(state), a, b) && !atWar(state, a, b);
export function transferVillageQuestPosts(state: GameState, village: number, owner: number, city: number): void {
    const pointer = rustEngine.sim_quests_transfer_posts(simCore(state).handle, village);
    const count = new Float64Array(rustEngine.memory.buffer, pointer, 1)[0];
    const ids = new Float64Array(rustEngine.memory.buffer, pointer + 8, count).slice();
    const units = entityStore(state).units;
    for (const id of ids) {
        const unit = units.get(id);
        if (!unit?.observationPost)
            continue;
        unit.faction = owner;
        unit.observationPost.city = city;
        delete unit.observationPost.questVillage;
        units.updateRoles(unit);
    }
}
