import { rustEngine } from './rust-engine';
import { simCore, SimSlot } from './sim-handle';
import { BUILDING_KIND_CODES, entityStore, type EntityObserver, type EntityStore } from './entity-store';
import { observeScalars, type ScalarObserver } from './scalar-observer';
import { buildingReady, tileAt, type Building, type GameState, type Point } from './types';

export const THERMAL_BATH_GOLD = rustEngine.thermal_bath_constant(0);
export const THERMAL_BATH_UPKEEP = rustEngine.thermal_bath_constant(1);
export const THERMAL_BATH_HP = rustEngine.thermal_bath_constant(2);
const networks = new SimSlot<NativeThermalBaths>();
const relevant = (b: Building): boolean => b.kind === 'palace' || b.kind === 'house' || b.kind === 'apartments' || b.kind === 'thermalBath';

/** Transport only. Native assignment maps change on site lifecycle edits;
 * ordinary capacity reads never rebuild or scan the building roster. */
class NativeThermalBaths implements ScalarObserver {
    readonly handle: number;
    readonly store: EntityStore;
    private readonly dirty = new Set<Building>();
    private readonly tracked = new Set<Building>();
    private readonly observer: EntityObserver<Building>;
    constructor(state: GameState) {
        this.handle = simCore(state).handle; this.store = entityStore(state);
        rustEngine.sim_bath_reset(this.handle);
        this.observer = {
            added: b => this.track(b), changed: b => this.track(b),
            removed: b => { if (this.tracked.delete(b)) rustEngine.sim_bath_remove(this.handle, b.id); this.dirty.delete(b); },
        };
        this.store.buildings.observe(this.observer);
        for (const b of state.buildings) this.track(b);
    }
    private track(b: Building): void {
        if (!relevant(b) && !this.tracked.has(b)) return;
        this.tracked.add(b); this.dirty.add(b);
        observeScalars(b, ['kind', 'faction', 'x', 'y', 'hp', 'construction'], this);
    }
    changed(target: object, key: string, before: unknown, after: unknown): void {
        if (key !== 'hp' || (Number(before) > 0) !== (Number(after) > 0)) this.dirty.add(target as Building);
    }
    flush(): this {
        for (const b of this.dirty) if (this.store.buildings.get(b.id) === b)
            rustEngine.sim_bath_upsert(this.handle, b.id, BUILDING_KIND_CODES[b.kind], b.faction, b.x, b.y,
                Number(b.hp > 0) | Number(buildingReady(b)) << 1);
        this.dirty.clear(); return this;
    }
}
function network(state: GameState): NativeThermalBaths {
    let current = networks.get(state);
    if (!current || current.store !== entityStore(state)) current = networks.set(state, new NativeThermalBaths(state));
    return current.flush();
}

export function thermalBathSiteError(state: GameState, faction: number, point: Point): string | undefined {
    const handle = network(state).handle;
    const input = new Float64Array(rustEngine.memory.buffer, rustEngine.sim_bath_input(handle), 8);
    for (let i = 0; i < 4; i++) {
        const tile = tileAt(state.world, point.x + i % 2, point.y + Math.floor(i / 2));
        input[i * 2] = tile?.geothermal ?? 0; input[i * 2 + 1] = tile?.geothermalAnchor ?? -1;
    }
    return [undefined, 'Place the entire thermal bath over one mud pool.', 'A thermal bath needs a completed friendly town.']
        [rustEngine.sim_bath_placement(handle, faction, point.x, point.y, state.world.width, state.world.height)];
}
export function thermalBathCapacity(state: GameState, house: Building, base: number): number {
    return rustEngine.sim_bath_capacity(network(state).handle, house.id, house.faction, house.x, house.y, base);
}
export function thermalBathCity(state: GameState, bath: Building): Building | undefined {
    const current = network(state);
    return current.store.buildings.get(rustEngine.sim_bath_owner(current.handle, bath.id));
}
export function thermalBathCityMultiplier(state: GameState, city: Building): number {
    return rustEngine.sim_bath_city_multiplier(network(state).handle, city.id);
}
