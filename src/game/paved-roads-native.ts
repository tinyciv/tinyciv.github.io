import { rustEngine } from './rust-engine';
import { simCore, SimSlot } from './sim-handle';
import { BUILDING_KIND_CODES, entityStore, type EntityObserver, type EntityStore } from './entity-store';
import { observeScalars, type ScalarObserver } from './scalar-observer';
import { buildingReady, type Building, type GameState } from './types';
import { invalidateNavigation } from './pathfinding';
import { markWorldChanged } from './world-revisions';

const networks = new SimSlot<NativePavedRoads>();
const relevant = (b: Building): boolean => b.kind === 'house' || b.kind === 'road';
/** Lifecycle/scalar transport only. Neighborhoods, median, research gate,
 * cadence, bounded work admission and surfacing decisions live in Rust. */
class NativePavedRoads implements ScalarObserver {
    readonly handle: number;
    readonly store: EntityStore;
    private readonly dirty = new Set<Building>();
    private readonly tracked = new Set<Building>();
    private readonly cells = new Set<number>();
    private readonly factions = new Set<number>();
    private readonly observer: EntityObserver<Building>;
    constructor(private readonly state: GameState) {
        this.handle = simCore(state).handle; this.store = entityStore(state);
        rustEngine.sim_paving_reset(this.handle);
        this.observer = {
            added: b => this.track(b), changed: b => this.track(b),
            removed: b => { if (this.tracked.delete(b)) rustEngine.sim_paving_remove(this.handle, b.id); this.dirty.delete(b); },
        };
        this.store.buildings.observe(this.observer);
        for (const b of state.buildings) this.track(b);
    }
    private track(b: Building): void {
        if (!relevant(b) && !this.tracked.has(b)) return;
        if (!this.tracked.has(b) && b.roadPaved) { b.roadPaved = false; this.cells.add(b.y * this.state.world.width + b.x); }
        this.tracked.add(b); this.dirty.add(b);
        observeScalars(b, ['kind', 'faction', 'x', 'y', 'hp', 'construction', 'houseLevel'], this);
    }
    changed(target: object, key: string, before: unknown, after: unknown): void {
        if (key !== 'hp' || (Number(before) > 0) !== (Number(after) > 0)) this.dirty.add(target as Building);
    }
    update(): void {
        for (const b of this.dirty) if (this.store.buildings.get(b.id) === b)
            rustEngine.sim_paving_upsert(this.handle, b.id, BUILDING_KIND_CODES[b.kind], b.faction, b.x, b.y,
                Number(b.hp > 0) | Number(buildingReady(b)) << 1, b.houseLevel ?? NaN);
        this.dirty.clear();
        const live = new Set<number>();
        for (const faction of this.state.factions) {
            live.add(faction.id);
            rustEngine.sim_paving_faction(this.handle, faction.id, faction.research?.levels.roadBuilding ?? NaN);
        }
        for (const id of this.factions) if (!live.has(id)) rustEngine.sim_paving_faction(this.handle, id, NaN);
        this.factions.clear(); for (const id of live) this.factions.add(id);
        const count = rustEngine.sim_paving_update(this.handle, this.state.time);
        const output = new Float64Array(rustEngine.memory.buffer, rustEngine.sim_paving_output(this.handle), count * 2);
        for (let row = 0; row < count; row++) {
            const road = this.store.buildings.get(output[row * 2]);
            if (!road) continue;
            road.roadPaved = !!output[row * 2 + 1];
            this.cells.add(road.y * this.state.world.width + road.x);
        }
        if (this.cells.size) {
            invalidateNavigation(this.state);
            markWorldChanged(this.state.world, 'appearance', this.cells);
            this.cells.clear();
        }
    }
}
export function updatePavedRoads(state: GameState): void {
    let network = networks.get(state);
    if (!network || network.store !== entityStore(state)) network = networks.set(state, new NativePavedRoads(state));
    network.update();
}
