import { simCore, SimSlot } from './sim-handle';
import { rustEngine } from './rust-engine';
import { structureIndex } from './structure-index';
import { BUILDING_KIND_CODES, entityStore } from './entity-store';
import { worldRevisions } from './world-revisions';
import { playerFaction } from './player-context';
import { SITE_DEFINITIONS, type SiteView } from './site-types';
import type { BuildingKind, GameState, World } from './types';

interface Geometry { world: World; revision: number; values: number[] }
interface Transport { geometry?: Geometry; views: Map<number, SiteView[]> }
const transports = new SimSlot<Transport>();
const geometries = new WeakMap<World, Geometry>();

function transport(state: GameState): Transport {
    const handle = simCore(state).handle;
    const current = transports.get(state) ?? transports.set(state, { views: new Map() });
    const revision = worldRevisions(state.world).geometry;
    let geometry = geometries.get(state.world);
    if (!geometry || geometry.revision !== revision) {
        const values: number[] = [];
        state.world.tiles.forEach((tile, cell) => { if (tile.geothermalAnchor === cell) values.push(cell, tile.geothermal ?? 0); });
        geometry = { world: state.world, revision, values }; geometries.set(state.world, geometry);
    }
    if (current.geometry !== geometry) {
        const count = geometry.values.length / 2;
        const pointer = rustEngine.sim_sites_input(handle, count);
        new Float64Array(rustEngine.memory.buffer, pointer, geometry.values.length).set(geometry.values);
        rustEngine.sim_sites_geometry(handle, state.world.width, state.world.height, count);
        current.geometry = geometry; current.views.clear();
    }
    return current;
}
function leaderObservation(state: GameState, actor: number) {
    const leader = entityStore(state).units.query('leader').find(u => u.faction === actor);
    return { x: leader?.x ?? NaN, y: leader?.y ?? NaN,
        flags: Number(!!leader) | Number(!!leader && leader.hp > 0) << 1 | Number(!!leader?.inside) << 2
            | Number(leader?.embarkedOn !== undefined) << 3 | Number(!!state.gameOver) << 4 };
}

/** Presentation samples at four Hz. Tile imports happen only on geometry
 * revision changes; occupancy reads use the maintained native building index. */
export function siteViews(state: GameState, now = performance.now(), actor = playerFaction(state)): readonly SiteView[] {
    const current = transport(state), handle = simCore(state).handle;
    const due = rustEngine.sim_sites_due(handle, actor, now / 1000);
    if (current.views.has(actor) && !due) return current.views.get(actor)!;
    structureIndex(state);
    const leader = leaderObservation(state, actor);
    const pointer = rustEngine.sim_sites_sample(handle, leader.x, leader.y, leader.flags);
    const count = new Float64Array(rustEngine.memory.buffer, pointer, 1)[0];
    const rows = new Float64Array(rustEngine.memory.buffer, pointer + 8, count * 7);
    const views: SiteView[] = [];
    for (let i = 0; i < count; i++) {
        const o = i * 7, flags = rows[o + 6];
        views.push({ id: rows[o], kind: rows[o + 1] as SiteView['kind'], x: rows[o + 2], y: rows[o + 3],
            width: rows[o + 4], height: rows[o + 5], near: !!(flags & 1), withinVisit: !!(flags & 2), available: !!(flags & 4), showBrackets: !!(flags & 8) });
    }
    current.views.set(actor, views); return views;
}
/** Fresh native validation for an action, independent of the presentation clock. */
export function siteTarget(state: GameState, id: number, actor = playerFaction(state)): { kind: BuildingKind; x: number; y: number } | undefined {
    if (!Number.isSafeInteger(id) || id < 0 || id >= state.world.tiles.length) return;
    transport(state); structureIndex(state);
    const leader = leaderObservation(state, actor);
    const code = rustEngine.sim_sites_target(simCore(state).handle, id, leader.x, leader.y, leader.flags);
    if (code < 0) return;
    const definition = Object.values(SITE_DEFINITIONS).find(site => BUILDING_KIND_CODES[site.building] === code);
    if (!definition) return;
    return { kind: definition.building, x: id % state.world.width, y: Math.floor(id / state.world.width) };
}
