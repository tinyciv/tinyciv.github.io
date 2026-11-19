import { BUILDING_KIND_CODES } from './entity-store';
import { rustEngine } from './rust-engine';
import { SimSlot, simCore } from './sim-handle';
import type { Building, BuildingDestruction, BuildingKind, GameState } from './types';

const kindByCode = new Map(Object.entries(BUILDING_KIND_CODES).map(([kind, code]) => [code, kind as BuildingKind]));

interface View {
    revision: number;
    records: Map<number, BuildingDestruction>;
    snapshots: Map<number, Building>;
}
const views = new SimSlot<View>();
function view(state: GameState): View {
    return views.get(state) ?? views.set(state, { revision: -1,
        records: new Map((state.buildingDestructions ?? []).map(effect => [effect.id, effect])), snapshots: new Map() });
}

/** Event transport and appearance capture only. Rust decides eligibility,
 * footprint, deduplication, bounded retention and simulation-time expiry. */
export function recordBuildingDestruction(state: GameState, building: Building): void {
    const core = simCore(state);
    core.adoptClock(state);
    if (!rustEngine.sim_building_destruction_record(core.handle, building.id, building.x, building.y,
        BUILDING_KIND_CODES[building.kind], building.faction, building.hp)) return;
    view(state).snapshots.set(building.id, { ...building, hp: building.maxHp,
        construction: building.construction ? { ...building.construction } : undefined,
        fort: building.fort ? { ...building.fort } : undefined });
    publishBuildingDestructions(state);
}

export function cancelBuildingDestruction(state: GameState, id: number): void {
    rustEngine.sim_building_destruction_cancel(simCore(state).handle, id);
    publishBuildingDestructions(state);
}

/** The cached native output changes only on a death or expiry. Plain state
 * mirrors carry the same effects through saves and multiplayer replication. */
export function publishBuildingDestructions(state: GameState): void {
    const cached = view(state);
    const pointer = rustEngine.sim_building_destructions(simCore(state).handle);
    const header = new Float64Array(rustEngine.memory.buffer, pointer, 2);
    if (cached.revision === header[0]) return;
    cached.revision = header[0];
    const rows = new Float64Array(rustEngine.memory.buffer, pointer + 16, header[1] * 8);
    const next: BuildingDestruction[] = [], records = new Map<number, BuildingDestruction>();
    for (let row = 0; row < rows.length; row += 8) {
        const id = rows[row], previous = cached.records.get(id);
        const building = cached.snapshots.get(id) ?? previous?.building;
        const kind = kindByCode.get(rows[row + 3]);
        const effect: BuildingDestruction = previous?.time === rows[row + 5] && kind === previous.kind && building === previous.building
            ? previous : { id, x: rows[row + 1], y: rows[row + 2], faction: rows[row + 4],
                kind, time: rows[row + 5], width: rows[row + 6], height: rows[row + 7], building };
        next.push(effect); records.set(id, effect);
    }
    cached.snapshots.clear(); cached.records = records;
    state.buildingDestructions = next;
}
