import { observationPostVisibleTo } from './observation-visibility';
import { HIGH_GROUND_RANGE_BONUS } from './combat-range';
import { BALLISTA_RANGE } from './ballista';
import { playerFaction, withPlayerFaction, playerControl } from './player-context';
import { isSoldier } from './types';
import { buildingWidth, buildingHeight, buildingReady, isWallKind, tileAt, type Building, type FarmField, type FarmFieldMemory, type GameState, type Point, type Unit, type World } from './types';
import { hasSightCover, highGroundSightMultiplier, maximumHighGroundSightMultiplier, sightDistance } from './sight';
import { ridgeLevel } from './ridges';
import { territory } from './borders';
import { worldRevisions, worldStructureRevision } from './world-revisions';
import { entityStore, type EntityStore } from './entity-store';
import { simulationReadsActive, structureChangeRevision, withSimulationReads } from './simulation-reads';
import { CHECK_INTERVAL } from './work-cadence';

/** Visibility and last-seen memories are sampled at half the ordinary sensing
 * rate. Rendering can continue interpolating fades between these snapshots. */
export const FOG_SAMPLE_INTERVAL = CHECK_INTERVAL * 2;

export interface SightSource extends Point { radius: number; highGround?: boolean }
export interface FogView {
    faction?: number;
    width: number;
    height: number;
    /** Current sight is transient; only exploration and remembered buildings are saved. */
    visible: Uint8Array;
    /** Player-owned cells bypass cover and visual fog, including softened edges. */
    owned?: Uint8Array;
    /** Claim changes bypass the normal presentation cadence. */
    ownershipRevision?: number;
    /** Simulation clock for presentation only; synthetic snapshots render settled. */
    presentationTime?: number;
    explored: number[];
    sources: SightSource[];
    /** Omitted for synthetic, open-ground views without a terrain map. */
    world?: World;
    buildings: Building[];
    fields: FarmFieldMemory[];
    revision: number;
    explorationRevision: number;
}
interface SightRecord { source: SightSource; key: string }
interface CachedFog extends FogView {
    sampledAt?: number; rememberedAt?: number; sampledStore?: EntityStore;
    memorySignature: string; persisted: NonNullable<GameState['fog']>;
    sourceRecords: SightRecord[]; sourceScratch: SightRecord[]; sourceEntities: WeakMap<object, SightRecord>;
    buildingMemories: Map<number, Building>; fieldMemories: Map<number, FarmFieldMemory>;
    liveBuildingIds: Set<number>; liveFields: Map<number, FarmField>; hiddenSites: Set<number>;
    patches: Map<string, number[]>; coverage: Uint32Array; worldRevision: number; territoryRevision: number;
}
const cache = new WeakMap<object, CachedFog>();
const contextKeys = new WeakMap<GameState, Map<number, object>>();
function contextKey(state: GameState): object {
    let keys = contextKeys.get(state); if (!keys) { keys = new Map(); contextKeys.set(state, keys); }
    const faction = playerFaction(state); let key = keys.get(faction);
    if (!key) { key = {}; keys.set(faction, key); } return key;
}
const quantize = (n: number) => Math.floor(n) + .5;

interface FogFrame {
    sources: Map<Unit, SightSource>;
    sourceUnits?: readonly Unit[]; sourceMembership?: number; sourceWorld?: World; sourceSight?: number; sourcesDirty?: boolean;
    staticSources?: SightRecord[]; staticKey?: string;
    view?: FogView;
    remembered?: boolean;
    world?: World; tiles?: World['tiles']; revision?: number; structure?: number; time?: number;
    persisted?: GameState['fog']; units?: readonly Unit[]; unitCount?: number;
    buildings?: readonly Building[]; buildingCount?: number; fields?: FarmField[]; fieldCount?: number; farmVersion?: number;
}
const frames = new WeakMap<object, FogFrame>();
interface PublishedFog {
    store: EntityStore;
    view: FogView; world: World; tiles: World['tiles']; revision: number | undefined; time: number;
    structure: number; units: readonly Unit[]; unitRevision: number; buildings: readonly Building[]; buildingRevision: number;
    fields?: FarmField[]; fieldCount: number; farmVersion?: number; persisted?: GameState['fog'];
}
const published = new WeakMap<object, PublishedFog>();

/** Commit once after authoritative updates. Presentation reads this coherent
 * view; rendering itself never schedules simulation or revalidates the world. */
export function publishFog(state: GameState, faction = playerFaction(state)): FogView {
    if (faction !== playerFaction(state)) return withPlayerFaction(state, faction, () => publishFog(state, faction));
    const view = updateFog(state, faction), store = entityStore(state);
    published.set(contextKey(state), { store, view, world: state.world, tiles: state.world.tiles, revision: state.world.revision,
        time: state.time, structure: structureChangeRevision(state), units: state.units, unitRevision: store.units.revision,
        buildings: state.buildings, buildingRevision: store.buildings.revision, fields: state.fields,
        fieldCount: state.fields?.length ?? 0, farmVersion: state.farmVersion, persisted: state.fog });
    return view;
}

/** Standalone previews and unpublished editor fixtures retain live queries. */
function committedFog(state: GameState): FogView | undefined {
    const snapshot = published.get(contextKey(state)), store = entityStore(state);
    const persisted = state.multiplayer ? playerControl(state).fog : state.fog;
    if (snapshot && snapshot.store === store && snapshot.world === state.world && snapshot.tiles === state.world.tiles
        && snapshot.revision === state.world.revision && snapshot.time === state.time && snapshot.persisted === persisted
        && snapshot.structure === structureChangeRevision(state) && snapshot.units === state.units && snapshot.unitRevision === store.units.revision
        && snapshot.buildings === state.buildings && snapshot.buildingRevision === store.buildings.revision
        && snapshot.fields === state.fields && snapshot.fieldCount === (state.fields?.length ?? 0) && snapshot.farmVersion === state.farmVersion) return snapshot.view;
    return undefined;
}

export function presentationFog(state: GameState): FogView {
    return committedFog(state) ?? updateFog(state);
}

/** Only a coherent published simulation state admits trusted presentation
 * queries. Unpublished fixtures/previews keep their live scalar validation. */
export function withPresentationReads<T>(state: GameState, read: () => T): T {
    return committedFog(state) ? withSimulationReads(state, read) : read();
}

/** Repeated visibility queries in the unit phase share validation work. The
 * view is invalidated as soon as a sight source changes, not once per frame. */
export function beginFogFrame(state: GameState): void {
    // Production takes one complete sight sample at most 1.5 times a second.
    // Standalone queries still support explicit live editing within a frame.
    if (simulationReadsActive(state)) return;
    const frame: FogFrame = { sources: new Map() };
    reconcileFrameSources(state, frame);
    frames.set(contextKey(state), frame);
}
export function endFogFrame(state: GameState): void { frames.delete(contextKey(state)); }
export function invalidateFog(state: GameState): void {
    published.delete(contextKey(state));
    const frame = frames.get(contextKey(state));
    if (frame) { frame.view = undefined; frame.sourcesDirty = true; frame.staticSources = undefined; }
}

function reconcileFrameSources(state: GameState, frame: FogFrame): void {
    frame.sources.clear();
    for (const unit of state.units) if (unit.faction === playerFaction(state) && unit.hp > 0 && !unit.inside)
        frame.sources.set(unit, unitSightSource(state.world, unit));
    frame.sourceUnits = state.units; frame.sourceMembership = entityStore(state).units.revision;
    frame.sourceWorld = state.world; frame.sourceSight = worldRevisions(state.world).sight; frame.sourcesDirty = false;
}

/** Call after movement/dispatch and any other change to a unit's sight. This
 * scalar check is cheap even when the source remains in its current cell. */
export function refreshFogUnit(state: GameState, unit: Unit): void {
    if (simulationReadsActive(state)) return;
    const frame = frames.get(contextKey(state));
    if (!frame) { published.delete(contextKey(state)); return; }
    const old = frame.sources.get(unit);
    if (unit.faction !== playerFaction(state) || unit.hp <= 0 || unit.inside) {
        if (old) { frame.sources.delete(unit); frame.view = undefined; }
        return;
    }
    const x = quantize(unit.x), y = quantize(unit.y), radius = unitSightRadius(unit);
    const highGround = ridgeLevel(tileAt(state.world, x, y)) > 0;
    if (old?.x === x && old.y === y && old.radius === radius && old.highGround === highGround) return;
    frame.sources.set(unit, { x, y, radius, highGround });
    frame.view = undefined;
}

function validatedFrame(state: GameState, frame: FogFrame): FogView | undefined {
    return frame.view && frame.world === state.world && frame.tiles === state.world.tiles
        && frame.revision === state.world.revision && frame.structure === structureChangeRevision(state) && frame.time === state.time
        && frame.persisted === state.fog && frame.units === state.units && frame.unitCount === state.units.length
        && frame.buildings === state.buildings && frame.buildingCount === state.buildings.length
        && frame.fields === state.fields && frame.fieldCount === state.fields?.length && frame.farmVersion === state.farmVersion
        ? frame.view : undefined;
}

function rememberValidation(state: GameState, frame: FogFrame, view: FogView, remembered: boolean): void {
    frame.view = view; frame.remembered = remembered; frame.world = state.world; frame.tiles = state.world.tiles;
    frame.revision = state.world.revision; frame.structure = structureChangeRevision(state); frame.time = state.time; frame.persisted = state.fog;
    frame.units = state.units; frame.unitCount = state.units.length;
    frame.buildings = state.buildings; frame.buildingCount = state.buildings.length;
    frame.fields = state.fields; frame.fieldCount = state.fields?.length; frame.farmVersion = state.farmVersion;
}

export const unitSightRadius = (unit: Pick<Unit, 'kind' | 'observationPost'>): number => unit.observationPost && !unit.observationPost.retreating ? 21 : unit.kind === 'leader' || unit.kind === 'sailboat' ? 9 : isSoldier(unit) || unit.kind === 'scout' || unit.kind === 'militia' ? 7 : 6;
export const buildingSightRadius = (building: Pick<Building, 'kind'>): number => building.kind === 'tower' ? 18 : building.kind === 'ballista' ? BALLISTA_RANGE + HIGH_GROUND_RANGE_BONUS + .65 : building.kind === 'woodenTower' || building.kind === 'fort' ? 12 : building.kind === 'palace' ? 9 : building.kind === 'monument' ? 7 : isWallKind(building.kind) ? 3 : 6;

function unitSightSource(world: World, unit: Unit): SightSource {
    const x = quantize(unit.x), y = quantize(unit.y);
    const tile = tileAt(world, x, y);
    return { x, y, radius: unitSightRadius(unit), highGround: ridgeLevel(tile) > 0 };
}

function rememberBuilding(building: Building): Building {
    const memory = { ...building };
    if (building.fort) memory.fort = { ...building.fort };
    if (building.construction) memory.construction = { ...building.construction };
    buildingMemoryKeys.set(memory, Object.keys(memory).length);
    return memory;
}

const buildingMemoryKeys = new WeakMap<Building, number>();
function shallowEqual(left: object | undefined, right: object | undefined): boolean {
    if (left === right) return true;
    if (!left || !right) return false;
    const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
    let count = 0;
    for (const key in a) { if (a[key] !== b[key] || !(key in b)) return false; count++; }
    for (const _key in b) if (--count < 0) return false;
    return count === 0;
}

/** Most observed structures have not changed. Retain their detached snapshot
 * instead of allocating thousands of identical objects every observation. */
function buildingMemoryCurrent(memory: Building, building: Building): boolean {
    const previous = memory as unknown as Record<string, unknown>;
    let count = 0;
    for (const key in building) {
        const value = building[key as keyof Building]; count++;
        if (key === 'construction' || key === 'fort') {
            if (!(key in previous) || !shallowEqual(memory[key], building[key])) return false;
        } else if (previous[key] !== value || value === undefined && !(key in previous)) return false;
    }
    return count === buildingMemoryKeys.get(memory);
}

function rememberField(field: FarmField, time: number): FarmFieldMemory {
    // Excluding reservations when creating the object avoids delete-induced
    // dictionary objects for every remembered farm plot on every visible frame.
    return { id: field.id, camp: field.camp, faction: field.faction, x: field.x, y: field.y,
        planted: field.planted, orchard: field.orchard && { ...field.orchard }, food: field.food, nextHarvest: field.nextHarvest, expiresAt: field.expiresAt,
        harvestStaggered: field.harvestStaggered, harvestedAt: field.harvestedAt, wheatRipe: field.wheatRipe, observedAt: time };
}

function fieldMemoryCurrent(memory: FarmFieldMemory, field: FarmField): boolean {
    return memory.camp === field.camp && memory.faction === field.faction && memory.x === field.x && memory.y === field.y
        && memory.planted === field.planted && memory.food === field.food && memory.nextHarvest === field.nextHarvest
        && memory.expiresAt === field.expiresAt && memory.harvestStaggered === field.harvestStaggered
        && memory.harvestedAt === field.harvestedAt && memory.wheatRipe === field.wheatRipe
        && memory.orchard?.startedAt === field.orchard?.startedAt && memory.orchard?.readyAt === field.orchard?.readyAt
        && !!memory.orchard === !!field.orchard;
}

/** Validate live scalars even outside a simulation frame, but reuse each
 * unchanged source and its coverage key. Avoid constructing a world-sized
 * signature string and fresh source objects on every visibility query. */
function refreshSightSources(state: GameState, fog: CachedFog): boolean {
    const records = fog.sourceScratch; records.length = 0;
    const frame = frames.get(contextKey(state));
    const add = (entity: object, x: number, y: number, radius: number, highGround?: boolean): void => {
        let record = fog.sourceEntities.get(entity);
        const source = record?.source;
        if (!source || source.x !== x || source.y !== y || source.radius !== radius || source.highGround !== highGround) {
            record = { source: highGround === undefined ? { x, y, radius } : { x, y, radius, highGround },
                key: `${x},${y},${radius},${Number(!!highGround)}` };
            fog.sourceEntities.set(entity, record);
        }
        records.push(record!);
    };
    if (frame) {
        if (frame.sourcesDirty || frame.sourceUnits !== state.units || frame.sourceMembership !== entityStore(state).units.revision
            || frame.sourceWorld !== state.world || frame.sourceSight !== worldRevisions(state.world).sight) reconcileFrameSources(state, frame);
        for (const [unit, source] of frame.sources) add(unit, source.x, source.y, source.radius, source.highGround);
    } else for (const u of state.units) if (u.faction === playerFaction(state) && u.hp > 0 && !u.inside) {
        const x = quantize(u.x), y = quantize(u.y);
        add(u, x, y, unitSightRadius(u), ridgeLevel(tileAt(state.world, x, y)) > 0);
    }
    for (const boat of state.fishing?.boats ?? []) if (boat.faction === playerFaction(state) && boat.hp > 0)
        add(boat, quantize(boat.x), quantize(boat.y), 4);
    const staticKey = frame && `${worldStructureRevision(state.world)}|${entityStore(state).buildings.revision}|${structureChangeRevision(state)}|`
        + (state.villages ?? []).map(v => `${v.id},${v.campId},${v.relation},${Number(!!v.destroyed)}`).join(';');
    if (frame?.staticSources && frame.staticKey === staticKey) records.push(...frame.staticSources);
    else {
    const start = records.length;
    for (const b of state.buildings) if (b.faction === playerFaction(state) && buildingReady(b) && !['road', 'bridge', 'irrigation', 'ruin'].includes(b.kind)) {
        const x = b.x + buildingWidth(b) / 2, y = b.y + buildingHeight(b) / 2;
        add(b, x, y, buildingSightRadius(b));
    }
    for (const village of state.villages ?? []) if (village.relation === 'allied' && !village.destroyed) {
        const candidate = entityStore(state).buildings.get(village.campId);
        const camp = candidate && buildingReady(candidate) ? candidate : undefined;
        if (camp) {
            add(village, camp.x + .5, camp.y + .5, 20);
        }
    }
    if (frame) { frame.staticSources = records.slice(start); frame.staticKey = staticKey; }
    }
    if (records.length === fog.sourceRecords.length && records.every((record, index) => record === fog.sourceRecords[index])) return false;
    fog.sourceScratch = fog.sourceRecords; fog.sourceRecords = records;
    fog.sources = records.map(record => record.source);
    return true;
}

/** A cell is the unit of sight, exploration, selection, and concealment. */
export function pointInSight(fog: FogView, x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < fog.width && y < fog.height
        && !!fog.visible[Math.floor(y) * fog.width + Math.floor(x)];
}

export interface FogRevealMask {
    scale: number; width: number; height: number; alpha: Uint8ClampedArray; revision?: number;
    /** Cells changed since previousRevision. A consumer that skipped that revision must repaint all. */
    previousRevision?: number; dirtyCells?: number[];
}
export const FOG_MASK_SCALE = 8;
export const FOG_MEMORY_ALPHA = 163;
export const FOG_RETURN_DELAY = 1.25;
export const FOG_RETURN_FADE = .8;
export const FOG_REVEAL_FADE = .25;
const FOG_ANIMATION_STEP = .05;
const FOG_EDGE_WIDTH = .36;
const maskNeighbors = [[0, -1], [1, 0], [0, 1], [-1, 0], [-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
interface FogPresentation {
    revision: number;
    explorationRevision: number;
    reveal: FogRevealMask;
    render: FogRevealMask;
    cellStates: Uint8Array;
}
const revealCaches = new WeakMap<FogView, FogPresentation>();
interface FogTransition {
    mask: FogRevealMask;
    target: Uint8ClampedArray;
    from: Uint8ClampedArray;
    revision: number;
    ownershipRevision?: number;
    tick: number;
    time: number;
    cells: Map<number, { start: number; end: number }>;
}
const transitionCaches = new WeakMap<FogView, FogTransition>();
const edgeTemplates = new Map<number, Uint8ClampedArray>();
const smoothEdge = (distance: number, guard = .5 / FOG_MASK_SCALE): number => {
    // Keep the first sample fully closed. Linear image scaling then cannot
    // bleed terrain from an unknown cell across the cell's exact boundary.
    const t = Math.max(0, Math.min(1, (distance - guard) / FOG_EDGE_WIDTH));
    return t * t * (3 - 2 * t);
};

/** Local eight-neighbor stencils soften a cell frontier without drawing radial
 * sight circles or blurring an entire map. Multiplying edge falloffs rounds
 * exposed corners; diagonal holes receive a small inward curved corner too. */
function edgeTemplate(neighbors: number): Uint8ClampedArray {
    let template = edgeTemplates.get(neighbors);
    if (template) return template;
    template = new Uint8ClampedArray(FOG_MASK_SCALE ** 2);
    const top = !!(neighbors & 1), right = !!(neighbors & 2), bottom = !!(neighbors & 4), left = !!(neighbors & 8);
    for (let y = 0; y < FOG_MASK_SCALE; y++) for (let x = 0; x < FOG_MASK_SCALE; x++) {
        const px = (x + .5) / FOG_MASK_SCALE, py = (y + .5) / FOG_MASK_SCALE;
        let reveal = (top ? 1 : smoothEdge(py)) * (right ? 1 : smoothEdge(1 - px))
            * (bottom ? 1 : smoothEdge(1 - py)) * (left ? 1 : smoothEdge(px));
        const cornerGuard = Math.SQRT2 * .5 / FOG_MASK_SCALE;
        if (top && left && !(neighbors & 16)) reveal *= smoothEdge(Math.hypot(px, py), cornerGuard);
        if (top && right && !(neighbors & 32)) reveal *= smoothEdge(Math.hypot(1 - px, py), cornerGuard);
        if (bottom && right && !(neighbors & 64)) reveal *= smoothEdge(Math.hypot(1 - px, 1 - py), cornerGuard);
        if (bottom && left && !(neighbors & 128)) reveal *= smoothEdge(Math.hypot(px, 1 - py), cornerGuard);
        template[y * FOG_MASK_SCALE + x] = Math.round(reveal * 255);
    }
    edgeTemplates.set(neighbors, template);
    return template;
}

function fogPresentation(fog: FogView): FogPresentation {
    const scale = FOG_MASK_SCALE, width = fog.width * scale, height = fog.height * scale;
    let cached = revealCaches.get(fog);
    if (!cached || cached.render.width !== width || cached.render.height !== height) {
        const mask = (): FogRevealMask => ({ scale, width, height, alpha: new Uint8ClampedArray(width * height) });
        cached = { revision: -1, explorationRevision: -1, reveal: mask(), render: mask(),
            cellStates: new Uint8Array(fog.width * fog.height).fill(255) };
        cached.render.alpha.fill(255);
        revealCaches.set(fog, cached);
    }
    if (cached.revision === fog.revision && cached.explorationRevision === fog.explorationRevision) return cached;
    const reveal = cached.reveal.alpha, render = cached.render.alpha;
    // Changes affect one tile and its eight edge stencils. Comparing compact
    // cell flags avoids scanning millions of mask pixels when a scout moves.
    const dirty = new Set<number>();
    for (let index = 0; index < cached.cellStates.length; index++) {
        const state = Number(!!fog.visible[index]) | Number(!!fog.explored[index]) << 1 | Number(!!fog.owned?.[index]) << 2;
        if (cached.cellStates[index] === state) continue;
        cached.cellStates[index] = state;
        const x = index % fog.width, y = Math.floor(index / fog.width);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
            if (x + dx >= 0 && y + dy >= 0 && x + dx < fog.width && y + dy < fog.height)
                dirty.add((y + dy) * fog.width + x + dx);
    }
    for (const index of dirty) {
        const x = index % fog.width, y = Math.floor(index / fog.width), visible = !!fog.visible[index];
        if (!visible && !fog.explored[index]) {
            for (let sy = 0; sy < scale; sy++) {
                const offset = (y * scale + sy) * width + x * scale;
                reveal.fill(0, offset, offset + scale); render.fill(255, offset, offset + scale);
            }
            continue;
        }
        let sightNeighbors = 0, knownNeighbors = 0;
        for (let d = 0; d < maskNeighbors.length; d++) {
            const nx = x + maskNeighbors[d][0], ny = y + maskNeighbors[d][1];
            // A world edge is a crop, not an internal fog bank.
            if (nx < 0 || ny < 0 || nx >= fog.width || ny >= fog.height) {
                sightNeighbors |= 1 << d; knownNeighbors |= 1 << d; continue;
            }
            const next = ny * fog.width + nx;
            if (fog.visible[next]) sightNeighbors |= 1 << d;
            if (fog.visible[next] || fog.explored[next]) knownNeighbors |= 1 << d;
        }
        const owned = !!fog.owned?.[index];
        const sight = visible ? edgeTemplate(sightNeighbors) : undefined, known = edgeTemplate(knownNeighbors);
        for (let sy = 0; sy < scale; sy++) {
            const offset = (y * scale + sy) * width + x * scale, source = sy * scale;
            for (let sx = 0; sx < scale; sx++) {
                const current = owned ? 255 : sight?.[source + sx] ?? 0;
                reveal[offset + sx] = current;
                render[offset + sx] = owned ? 0 : 255 - Math.round(((255 - FOG_MEMORY_ALPHA) * known[source + sx] + FOG_MEMORY_ALPHA * current) / 255);
            }
        }
    }
    cached.revision = fog.revision; cached.explorationRevision = fog.explorationRevision;
    if (dirty.size) {
        cached.render.previousRevision = cached.render.revision;
        cached.render.revision = (cached.render.revision ?? 0) + 1;
        cached.render.dirtyCells = [...dirty];
    }
    return cached;
}

/** Presentation only: gameplay visibility remains the discrete visible cells. */
export function fogRevealMask(fog: FogView): FogRevealMask { return fogPresentation(fog).reveal; }

/** Blend only changing cells. A returning fog bank waits before fading in, so
 * scouts moving across adjacent cell boundaries do not pulse the map dark.
 * This does not extend enemy observation: visible[] remains current LOS. */
export function fogRenderMask(fog: FogView): FogRevealMask {
    const time = fog.presentationTime;
    if (time === undefined) return fogPresentation(fog).render;
    let transition = transitionCaches.get(fog);
    const tick = Math.floor((time + 1e-8) / FOG_ANIMATION_STEP);
    // Source movement may change logical sight every frame. Keep only its
    // latest state for the next visual tick, before doing any mask work.
    if (transition && transition.mask.width === fog.width * FOG_MASK_SCALE && transition.mask.height === fog.height * FOG_MASK_SCALE
        && time >= transition.time && tick === transition.tick && fog.ownershipRevision === transition.ownershipRevision) return transition.mask;
    const desired = fogPresentation(fog).render;
    if (!transition || transition.mask.width !== desired.width || transition.mask.height !== desired.height || time < transition.time) {
        transition = { mask: { scale: desired.scale, width: desired.width, height: desired.height,
                alpha: desired.alpha.slice(), revision: 1 },
            target: desired.alpha.slice(), from: desired.alpha.slice(), revision: desired.revision!,
            ownershipRevision: fog.ownershipRevision, tick, time, cells: new Map() };
        transitionCaches.set(fog, transition);
        return transition.mask;
    }
    const targetChanged = transition.revision !== desired.revision;
    transition.tick = tick; transition.time = time;
    transition.ownershipRevision = fog.ownershipRevision;
    const { mask, target, from, cells } = transition, scale = mask.scale;
    const dirty = new Set<number>();
    // Finish the old trajectory first, so reversals start at the current shade.
    for (const [cell, timing] of cells) {
        const x = cell % fog.width, y = Math.floor(cell / fog.width), elapsed = time - timing.start;
        for (let sy = 0; sy < scale; sy++) {
            const offset = (y * scale + sy) * mask.width + x * scale;
            for (let sx = 0; sx < scale; sx++) {
                const i = offset + sx, darkening = target[i] > from[i];
                const t = Math.max(0, Math.min(1, (elapsed - (darkening ? FOG_RETURN_DELAY : 0)) / (darkening ? FOG_RETURN_FADE : FOG_REVEAL_FADE)));
                const smooth = t * t * (3 - 2 * t), next = Math.round(from[i] + (target[i] - from[i]) * smooth);
                if (mask.alpha[i] !== next) { mask.alpha[i] = next; dirty.add(cell); }
            }
        }
        if (time >= timing.end) cells.delete(cell);
    }
    if (targetChanged) {
        const changedCells = desired.previousRevision === transition.revision && desired.dirtyCells
            ? desired.dirtyCells : Array.from({ length: fog.width * fog.height }, (_, index) => index);
        for (const cell of changedCells) {
            const x = cell % fog.width, y = Math.floor(cell / fog.width), owned = !!fog.owned?.[cell];
            let difference = false, darkening = false;
            for (let sy = 0; sy < scale && !difference; sy++) {
                const offset = (y * scale + sy) * mask.width + x * scale;
                for (let sx = 0; sx < scale; sx++) if (target[offset + sx] !== desired.alpha[offset + sx]) { difference = true; break; }
            }
            if (!difference && !owned) continue;
            for (let sy = 0; sy < scale; sy++) {
                const offset = (y * scale + sy) * mask.width + x * scale;
                for (let sx = 0; sx < scale; sx++) {
                    const i = offset + sx;
                    from[i] = mask.alpha[i]; target[i] = desired.alpha[i];
                    if (owned && mask.alpha[i]) { mask.alpha[i] = 0; dirty.add(cell); }
                    if (target[i] > from[i]) darkening = true;
                }
            }
            if (owned) cells.delete(cell);
            else cells.set(cell, { start: time, end: time + (darkening ? FOG_RETURN_DELAY + FOG_RETURN_FADE : FOG_REVEAL_FADE) });
        }
        transition.revision = desired.revision!;
    }
    if (dirty.size) {
        mask.previousRevision = mask.revision;
        mask.revision = (mask.revision ?? 0) + 1;
        mask.dirtyCells = [...dirty];
    }
    return mask;
}

export function pointExplored(fog: FogView, x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < fog.width && y < fog.height && !!fog.explored[Math.floor(y) * fog.width + Math.floor(x)];
}

export function buildingInSight(fog: FogView, b: Building): boolean {
    // Rival build orders and worksites are private until the building is ready.
    // Share this rule with targeting and selection, not just the compositor.
    if (b.faction !== (fog.faction ?? 0) && b.construction) return false;
    for (let dy = 0; dy < buildingHeight(b); dy++) for (let dx = 0; dx < buildingWidth(b); dx++)
        if (pointInSight(fog, b.x + dx + .5, b.y + dy + .5)) return true;
    return false;
}

/** Empty saves start black, then reveal only the player's present surroundings. */
export function updateFog(state: GameState, faction = playerFaction(state), remember = true): FogView {
    if (faction !== playerFaction(state)) return withPlayerFaction(state, faction, () => updateFog(state, faction, remember));
    if (state.multiplayer) state.fog = playerControl(state).fog;
    const trusted = simulationReadsActive(state), store = trusted ? entityStore(state) : undefined;
    const previous = cache.get(contextKey(state));
    const retained = trusted && !!previous && previous.sampledStore === store && previous.world === state.world && previous.persisted === state.fog;
    const sampleSight = !retained || previous.sampledAt === undefined || state.time < previous.sampledAt
        || state.time + 1e-9 >= previous.sampledAt + FOG_SAMPLE_INTERVAL;
    const sampleMemories = remember && (!retained || previous.rememberedAt === undefined || state.time < previous.rememberedAt
        || state.time + 1e-9 >= previous.rememberedAt + FOG_SAMPLE_INTERVAL);
    if (!sampleSight && !sampleMemories) { previous!.presentationTime = state.time; return previous!; }
    const frame = frames.get(contextKey(state)), validated = frame && validatedFrame(state, frame);
    if (validated && (!remember || frame!.remembered)) return validated;
    const { width, height, seed } = state.world;
    const worldRevision = worldRevisions(state.world).sight;
    if (!state.fog || state.fog.width !== width || state.fog.height !== height || state.fog.seed !== seed || !Array.isArray(state.fog.explored) || state.fog.explored.length !== width * height) {
        state.fog = { width, height, seed, explored: Array(width * height).fill(0), buildings: [], fields: [] };
    }
    const persisted = state.fog;
    if (state.multiplayer) playerControl(state).fog = persisted;
    let fog = cache.get(contextKey(state));
    if (!fog || fog.persisted !== persisted || fog.world !== state.world) {
        fog = { faction: playerFaction(state), width, height, world: state.world, visible: new Uint8Array(width * height), owned: new Uint8Array(width * height), ownershipRevision: 0, explored: persisted.explored,
            sources: [], buildings: (persisted.buildings ?? []).filter(b => b.faction === playerFaction(state) || !b.construction).map(rememberBuilding),
            fields: (persisted.fields ?? []).map(field => rememberField(field, field.observedAt ?? state.time)), revision: 0, explorationRevision: 0,
            memorySignature: '', persisted, patches: new Map(), coverage: new Uint32Array(width * height),
            sourceRecords: [], sourceScratch: [], sourceEntities: new WeakMap(),
            buildingMemories: new Map(), fieldMemories: new Map(), liveBuildingIds: new Set(), liveFields: new Map(), hiddenSites: new Set(),
            worldRevision, territoryRevision: -1 };
        for (const building of fog.buildings) fog.buildingMemories.set(building.id, building);
        for (const field of fog.fields) fog.fieldMemories.set(field.id, field);
        cache.set(contextKey(state), fog);
    }
    fog.presentationTime = state.time;
    if (sampleSight) {
    const borders = territory(state);
    const sourcesChanged = refreshSightSources(state, fog);
    if (sourcesChanged || worldRevision !== fog.worldRevision || borders.revision !== fog.territoryRevision || !fog.revision) {
        let discovered = false, ownershipChanged = false, visibilityChanged = false;
        const worldChanged = fog.worldRevision !== worldRevision;
        const touched = new Set<number>();
        const patches = new Map<string, number[]>();
        for (const { source: s, key } of fog.sourceRecords) {
            if (patches.has(key)) continue;
            let cells = worldChanged ? undefined : fog.patches.get(key);
            if (!cells) {
                cells = [];
                const elevated = !!s.highGround;
                const radius = s.radius * (elevated ? maximumHighGroundSightMultiplier(state.world, s, !!s.highGround) : 1), covered = hasSightCover(state.world, s, radius);
                const x0 = Math.max(0, Math.floor(s.x - radius)), x1 = Math.min(width - 1, Math.ceil(s.x + radius));
                const y0 = Math.max(0, Math.floor(s.y - radius)), y1 = Math.min(height - 1, Math.ceil(s.y + radius));
                for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
                    const d2 = (x + .5 - s.x) ** 2 + (y + .5 - s.y) ** 2;
                    const targetRadius = s.radius * (elevated ? highGroundSightMultiplier(state.world, s, { x, y }, !!s.highGround) : 1);
                    if (d2 > targetRadius ** 2) continue;
                    if (!covered || sightDistance(state.world, s, x + .5, y + .5, targetRadius) <= targetRadius) cells.push(y * width + x);
                }
            }
            patches.set(key, cells);
        }
        // A crowd changes only a few quantized sight sources per step. Keep
        // coverage counts for the union instead of repainting every source's
        // patch whenever one scout crosses a cell boundary. Equal source keys
        // remain deduplicated, just as they are in the full union.
        for (const [key, cells] of fog.patches) if (worldChanged || !patches.has(key)) {
            for (const i of cells) { fog.coverage[i]--; touched.add(i); }
        }
        for (const [key, cells] of patches) if (worldChanged || !fog.patches.has(key)) {
            for (const i of cells) { fog.coverage[i]++; touched.add(i); }
        }
        if (fog.territoryRevision !== borders.revision) {
            for (let i = 0; i < fog.visible.length; i++) {
                const owned = Number(borders.owners[i] === playerFaction(state));
                if (fog.owned![i] !== owned) { ownershipChanged = true; touched.add(i); }
                fog.owned![i] = owned;
            }
            fog.territoryRevision = borders.revision;
        }
        for (const i of touched) {
            const visible = Number(!!fog.owned![i] || fog.coverage[i] > 0);
            if (fog.visible[i] !== visible) visibilityChanged = true;
            fog.visible[i] = visible;
            if (fog.visible[i] && !fog.explored[i]) { fog.explored[i] = 1; discovered = true; }
        }
        if (ownershipChanged) fog.ownershipRevision = (fog.ownershipRevision ?? 0) + 1;
        fog.worldRevision = worldRevision;
        fog.patches = patches;
        if (visibilityChanged || ownershipChanged || !fog.revision) fog.revision++;
        if (discovered || !fog.explorationRevision) fog.explorationRevision++;
    }
    if (trusted) { fog.sampledAt = state.time; fog.sampledStore = store; }
    }
    // A structure remains as last seen until its site is scouted again. New
    // construction and damage outside sight therefore cannot leak through fog.
    // A scout moving inside already observed ground changes the source list,
    // not what can be remembered. Keep the observation cadence, but avoid
    // rebuilding every building/field memory repeatedly within that interval.
    const memorySignature = `${fog.revision}|${state.world.revision ?? 0}|${state.time.toFixed(1)}|${state.buildings.length}|${state.fields?.length ?? 0}|${state.farmVersion ?? 0}`;
    if (sampleMemories && memorySignature !== fog.memorySignature) {
        fog.memorySignature = memorySignature;
        const memories = fog.buildingMemories, live = fog.liveBuildingIds, hiddenSites = fog.hiddenSites;
        live.clear(); hiddenSites.clear();
        for (const building of state.buildings) {
            live.add(building.id);
            if (building.faction !== playerFaction(state) && building.construction) hiddenSites.add(building.id);
        }
        let buildingsChanged = false;
        for (const [id, b] of memories) if (hiddenSites.has(id) || b.faction !== playerFaction(state) && b.construction
            || (b.faction === playerFaction(state) || buildingInSight(fog, b)) && !live.has(id)) { memories.delete(id); buildingsChanged = true; }
        for (const b of state.buildings) if (b.faction === playerFaction(state) || buildingInSight(fog, b)) {
            const previous = memories.get(b.id);
            if (!previous || !buildingMemoryCurrent(previous, b)) { memories.set(b.id, rememberBuilding(b)); buildingsChanged = true; }
        }
        if (buildingsChanged) fog.buildings = [...memories.values()];
        persisted.buildings = fog.buildings;
        // Fields are remembered independently of camps: a scout can observe
        // one side of a farm without seeing its camp or the opposite fields.
        const fieldMemories = fog.fieldMemories, liveFields = fog.liveFields;
        liveFields.clear();
        for (const field of state.fields ?? []) liveFields.set(field.id, field);
        let fieldsChanged = false;
        for (const [id, field] of fieldMemories) {
            const live = liveFields.get(id);
            if (hiddenSites.has(field.camp) || (field.faction === playerFaction(state) || pointInSight(fog, field.x + .5, field.y + .5))
                && (!live || live.x !== field.x || live.y !== field.y)) { fieldMemories.delete(id); fieldsChanged = true; }
        }
        for (const field of state.fields ?? []) if (!hiddenSites.has(field.camp) && (field.faction === playerFaction(state) || pointInSight(fog, field.x + .5, field.y + .5))) {
            const previous = fieldMemories.get(field.id);
            if (!previous || !fieldMemoryCurrent(previous, field)) { fieldMemories.set(field.id, rememberField(field, state.time)); fieldsChanged = true; }
            // Observation time is presentation data. A still-visible unchanged
            // crop keeps growing; once hidden this timestamp stops advancing.
            else previous.observedAt = state.time;
        }
        if (fieldsChanged) fog.fields = [...fieldMemories.values()];
        persisted.fields = fog.fields;
    }
    if (trusted && sampleMemories) fog.rememberedAt = state.time;
    // An explicit/editor query is a new live observation; it must not leave a
    // trusted timestamp behind for a subsequently resumed simulation.
    if (!trusted) { fog.sampledAt = undefined; fog.rememberedAt = undefined; fog.sampledStore = undefined; }
    if (frame) rememberValidation(state, frame, fog, remember);
    return fog;
}

export function isVisible(state: GameState, x: number, y: number): boolean { return pointInSight(updateFog(state), x, y); }
/** Wilderness spawning must stay hidden from every human, not just the host. */
export function humanFogViews(state: GameState): FogView[] {
    return state.multiplayer ? state.multiplayer.humanFactionIds.map(faction => updateFog(state, faction)) : [updateFog(state)];
}
/** Simulation scheduling needs current sight, but must not repeatedly copy
 * remembered buildings and fields during updateGame's internal substeps. A
 * later ordinary updateFog still commits those memories, even in this frame. */
export function humanVisibilityViews(state: GameState): FogView[] {
    return state.multiplayer ? state.multiplayer.humanFactionIds.map(faction => updateFog(state, faction, false))
        : [updateFog(state, playerFaction(state), false)];
}
export function isExplored(state: GameState, x: number, y: number): boolean { return pointExplored(updateFog(state), x, y); }
export function entityVisible(state: GameState, entity: Unit | Building): boolean {
    if ('inside' in entity && entity.inside || !('capacity' in entity) && !observationPostVisibleTo(entity, playerFaction(state))) return false;
    if (entity.faction === playerFaction(state)) return true;
    const fog = updateFog(state);
    return 'capacity' in entity ? buildingInSight(fog, entity) : pointInSight(fog, entity.x, entity.y);
}
