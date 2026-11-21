import { lifetimeCulture } from './achievement-effects';
import { CellJournal, type CellChanges } from './cell-journal';
import { TerritoryCells, territoryValue } from './territory-cells';
import { buildingReady, buildingWidth, buildingHeight, type Building, type GameState, type NeutralVillage, type Point, type World, WATER } from './types';
import { borderCulture, cultureLevel } from './culture';
import { hasSightCover, sightDistance } from './sight';
import { worldSightChangesSince, worldRevisions, worldStructureRevision } from './world-revisions';
import { entityStore, type EntityStore } from './entity-store';
import { scenarioCityClaim } from './scenario-claims-native';
import { recordStructureChange, simulationReadsActive, structureChangeRevision } from './simulation-reads';
import { territorySightCosts } from './territory-sight';
import { villageCenter, villageClaimCells } from './settlement-bridge';
import { structureIndex, structuresOf, STRUCTURE_ALIVE } from './structure-index';

export const UNCLAIMED = -2147483648;
export interface BorderEdge {
    x: number; y: number; horizontal: boolean; faction: number; cell: number;
    /** A shared frontier is one physical edge with an owner on either side. */
    neighborFaction?: number; neighborCell?: number;
}
interface RoundedEnd { control: Point; tangent: Point }
export interface BorderPath { edge: BorderEdge; start: Point; end: Point; from?: RoundedEnd; to?: RoundedEnd }
export interface Territory {
    width: number; height: number; owners: Int32Array;
    readonly cells?: TerritoryCells; readonly journal?: CellJournal; readonly cellRevision?: number;
    /** Winning individual source and strongest claim from any other source. */
    sourceIds: Int32Array; alternateOwners: Int32Array; alternateSourceIds: Int32Array;
    sourceRadii: ReadonlyMap<number, number>;
    edges: BorderEdge[]; paths: BorderPath[]; revision: number;
}
interface ClaimSource { id: number; kind: Building['kind']; faction: number; x: number; y: number; cultureAtFounding: number; level: number; initialCity: boolean }
interface CityClaim { id: number; faction: number; x: number; y: number; cultureAtFounding: number; level: number }
interface VillageClaim { cells?: number[]; id: number; campId: number; faction: number; x: number; y: number; radius: number }
interface ClaimFootprint {
    key: string; left: number; top: number; right: number; bottom: number;
    cells: Uint32Array; distances: Float64Array; costs: Float64Array;
    /** Immutable pre-flood samples permit exact reuse of rays untouched by a
     * located sight edit. Connectivity is still recomputed for the whole patch. */
    samples?: Float64Array;
}
interface CachedTerritory extends Territory {
    world: World; worldRevision: number; signature: string;
    edgeCells: ReadonlyMap<number, readonly BorderEdge[]>;
    claimRevision: number; footprints: ReadonlyMap<number, ClaimFootprint>;
    levels: Map<number, number>; factions: { id: number; level: number }[]; sources: ClaimSource[]; cities: CityClaim[]; villages: VillageClaim[];
}
const journals = new WeakMap<GameState, CellJournal>();
const cache = new WeakMap<GameState, CachedTerritory>();
const validations = new WeakMap<GameState, { view: Territory; world: World; store: EntityStore; key: string }>();

/** Only structural edits and claim thresholds affect territory. Moving units,
 * crop animation and road wear never require rediscovering claim sources. */
function claimDependencies(state: GameState, previous?: CachedTerritory): string {
    const revisions = worldRevisions(state.world);
    // Within a border wave every claimed level is fixed, so the wave's claims
    // replace per-city threshold checks on each query.
    const wave = state.borderWave;
    return `${revisions.sight}|${worldStructureRevision(state.world)}|${entityStore(state).buildings.revision}|${structureChangeRevision(state)}`
        + '|' + state.factions.map(f => `${f.id},${Number(!!f.defeated)},${f.villageId ?? ''},${wave ? '' : cultureLevel(lifetimeCulture(f))},${f.villageId === undefined ? '' : f.population}`).join(';')
        + '|' + (wave ? `${wave.index}:${Object.entries(wave.culture).join(';')}`
            : (previous?.cities ?? []).map(city => `${city.id},${cultureLevel(cityBorderCulture(lifetimeCulture(state.factions.find(f => f.id === city.faction)), city.cultureAtFounding))}`).join(';'))
        + '|' + (state.villages ?? []).map(v => `${v.id},${v.campId},${v.faction},${v.x},${v.y},${Number(!!v.destroyed)}`).join(';');
}

export const BASE_BORDER_RADIUS = { palace: 5, house: 2.5, monument: 4, fort: 5 } as const;
export const BORDER_RADIUS_MULTIPLIER = 1.3;
export const INHERITED_CITY_CULTURE_CAP = 100;
export const INITIAL_CITY_BORDER_BONUS = 3;
export const SETTLEMENT_BORDER_BUFFER = 1;
export const VILLAGE_BORDER_START_RADIUS = 3;

function activeBorderSource(building: Building): boolean {
    return !building.borderClaimSuspended && buildingReady(building)
        && (building.kind === 'palace' || building.kind === 'house' || building.kind === 'monument' || building.kind === 'fort');
}

/** The native index partitions civic claimants at the instant a city falls,
 * before its former homes can attach themselves to a distant surviving city. */
export function suspendCityBorderClaims(state: GameState, palace: Building): void {
    if (palace.construction || palace.faction < 0) return;
    const claims = structureIndex(state).fallenCityClaims(palace);
    if (!claims.length) return;
    for (const building of claims) building.borderClaimSuspended = true;
    recordStructureChange(state);
}

/** A new palace restores former civic claims where its own borders reach. */
export function restoreCityBorderClaims(state: GameState, palace: Building): void {
    const suspended = structuresOf(state, palace.faction, STRUCTURE_ALIVE, 'house', 'monument')
        .filter(building => building.borderClaimSuspended);
    if (!suspended.length) return;
    recordStructureChange(state);
    const borders = territory(state);
    let restored = false;
    for (const building of suspended) {
        const cell = building.y * borders.width + building.x;
        if (territoryValue(borders, cell) !== palace.faction
            || territoryValue(borders, cell, 1) !== palace.id && territoryValue(borders, cell, 3) !== palace.id) continue;
        delete building.borderClaimSuspended; restored = true;
    }
    if (restored) recordStructureChange(state);
}

/** Village territory is the Rust claim (design 8.6): a radius-3 disk around
 * the civic lot, cells beside built structures and the current stage's
 * reserved slots. Seceded cities keep their captured cells. The claim array
 * is cached per claim revision, so identity marks a change. */
function villageClaims(state: GameState): VillageClaim[] {
    if (!state.villages?.length) return [];
    const factions = new Map(state.factions.filter(faction => faction.villageId !== undefined && !faction.defeated).map(faction => [faction.id, faction]));
    const store = entityStore(state);
    return state.villages.filter(village => {
        const camp = store.buildings.get(village.campId);
        return !village.destroyed && !!camp && camp.villageId !== undefined && buildingReady(camp) && camp.faction === village.faction
            && (camp.kind === 'villageTent' || camp.kind === 'palace') && factions.get(village.faction)?.villageId === village.id;
    }).map(village => {
        const center = villageCenter(village);
        return { id: village.id, campId: village.campId, faction: village.faction, x: center.x, y: center.y, radius: VILLAGE_BORDER_START_RADIUS,
            cells: village.secededCity?.territoryCells ?? villageClaimCells(state, village) };
    });
}

const cultureAmount = (value: number | undefined): number => Number.isFinite(value) ? Math.max(0, value!) : 0;

/** A newly founded city borrows at most one expansion from existing culture.
 * Further expansion uses culture earned since its own foundation. */
export function cityBorderCulture(culture: number | undefined, cultureAtFounding = 0): number {
    const current = cultureAmount(culture), founding = cultureAmount(cultureAtFounding);
    return Math.max(0, current - founding) + Math.min(current, founding, INHERITED_CITY_CULTURE_CAP);
}

function nearestClaimCity(cities: readonly CityClaim[], faction: number, x: number, y: number): CityClaim | undefined {
    let nearest: CityClaim | undefined, best = Infinity;
    for (const city of cities) if (city.faction === faction) {
        const distance = (city.x + 1 - x) ** 2 + (city.y + 1 - y) ** 2;
        if (distance < best || distance === best && city.id < nearest!.id) { nearest = city; best = distance; }
    }
    return nearest;
}

/** Placement previews use the same nearest-city culture as completed sources. */
export function borderCultureAt(state: GameState, faction: number, x: number, y: number): number {
    let palace: Building | undefined, best = Infinity;
    for (const building of state.buildings) if (building.kind === 'palace' && building.faction === faction && buildingReady(building)) {
        const distance = (building.x + 1 - x) ** 2 + (building.y + 1 - y) ** 2;
        if (distance < best || distance === best && building.id < palace!.id) { palace = building; best = distance; }
    }
    return cityBorderCulture(borderCulture(state, state.factions.find(owner => owner.id === faction)), palace?.cultureAtFounding);
}

function radiusAtLevel(kind: Building['kind'], level: number): number {
    // Fixed military reach prevents older forts from expanding through another
    // faction's frontier as culture or nearby civic sources grow.
    if (kind === 'fort') return BASE_BORDER_RADIUS.fort * BORDER_RADIUS_MULTIPLIER;
    const base = kind === 'palace' || kind === 'house' || kind === 'monument' ? BASE_BORDER_RADIUS[kind] : 0;
    return base ? (kind === 'monument' ? base : base * BORDER_RADIUS_MULTIPLIER) + level * BORDER_RADIUS_MULTIPLIER : 0;
}
const sourceRadius = (source: ClaimSource): number => radiusAtLevel(source.kind, source.level)
    + (source.kind === 'palace' && source.initialCity ? INITIAL_CITY_BORDER_BONUS : 0);

/** Completed monuments immediately claim four tiles, without a culture gate.
 * Palace/house bases retain their 30% buffer; civic sources add 1.3 tiles per
 * culture level. Forts retain a fixed 6.5-tile reach. These are influence
 * budgets: woodland consumes the same extra distance as it does for sight.
 * Population has no effect. */
export function borderRadius(kind: Building['kind'], culture = 0): number {
    return radiusAtLevel(kind, cultureLevel(culture));
}

/** Join the centerline around a turn, instead of just rounding a sharp stroke's
 * caps. Adjacent edges own equal halves of each curve, retaining cell visibility. */
const villageMasks = new WeakMap<number[], { count: number; cells: ReadonlySet<number> }>();
function villageMask(cells: number[]): ReadonlySet<number> {
    let cached = villageMasks.get(cells);
    if (!cached || cached.count !== cells.length) { cached = { count: cells.length, cells: new Set(cells) }; villageMasks.set(cells, cached); }
    return cached.cells;
}
const roundedCache = new WeakMap<BorderEdge, { start: BorderEdge[]; end: BorderEdge[]; path: BorderPath }>();
function roundedPaths(edges: BorderEdge[]): BorderPath[] {
    const vertices = new Map<string, BorderEdge[]>(), radius = .18;
    const end = (edge: BorderEdge): Point => ({ x: edge.x + Number(edge.horizontal), y: edge.y + Number(!edge.horizontal) });
    const key = (point: Point, edge: BorderEdge): string => {
        const owners = edge.neighborFaction === undefined ? `${edge.faction}`
            : `${Math.min(edge.faction, edge.neighborFaction)},${Math.max(edge.faction, edge.neighborFaction)}`;
        return `${owners}:${point.x},${point.y}`;
    };
    for (const edge of edges) for (const point of [edge, end(edge)]) {
        const index = key(point, edge), joined = vertices.get(index);
        if (joined) joined.push(edge); else vertices.set(index, [edge]);
    }
    const corner = (edge: BorderEdge, vertex: Point, away: Point): { midpoint: Point; curve: RoundedEnd } | undefined => {
        const joined = vertices.get(key(vertex, edge));
        // A junction or touching diagonal regions need their exact shared vertex.
        if (joined?.length !== 2) return;
        const neighbor = joined.find(other => other !== edge)!;
        if (neighbor.horizontal === edge.horizontal) return;
        const far = neighbor.x === vertex.x && neighbor.y === vertex.y ? end(neighbor) : neighbor;
        const nx = far.x - vertex.x, ny = far.y - vertex.y;
        return { midpoint: { x: vertex.x + radius * (nx + away.x) / 4, y: vertex.y + radius * (ny + away.y) / 4 },
            curve: { control: { x: vertex.x + radius * away.x / 2, y: vertex.y + radius * away.y / 2 },
                tangent: { x: vertex.x + radius * away.x, y: vertex.y + radius * away.y } } };
    };
    return edges.map(edge => {
        const dx = Number(edge.horizontal), dy = Number(!edge.horizontal), last = end(edge);
        const startNeighbors = vertices.get(key(edge, edge))!, endNeighbors = vertices.get(key(last, edge))!;
        const cached = roundedCache.get(edge);
        const same = (a: BorderEdge[], b: BorderEdge[]) => a.length === b.length && a.every((value, i) => value === b[i]);
        if (cached && same(cached.start, startNeighbors) && same(cached.end, endNeighbors)) return cached.path;
        const from = corner(edge, edge, { x: dx, y: dy }), to = corner(edge, last, { x: -dx, y: -dy });
        const path = { edge, start: from?.midpoint ?? { x: edge.x, y: edge.y }, end: to?.midpoint ?? last, from: from?.curve, to: to?.curve };
        roundedCache.set(edge, { start: startNeighbors, end: endNeighbors, path });
        return path;
    });
}

/** Culture supplies an influence budget; each crossed tile consumes its LOS
 * traversal cost. Forests therefore indent and shadow borders rather than
 * granting a uniform disk. Clear land retains the original circular reach.
 * Overlaps use relative cultural distance; lower faction IDs break exact ties
 * independently of building array order. */
export function territory(state: GameState): Territory {
    if (!simulationReadsActive(state)) {
        const view = computeTerritory(state);
        // A standalone caller can make untracked editor changes. Do not leave
        // a trusted dependency stamp pointing at its previous result.
        validations.delete(state);
        return view;
    }
    const store = entityStore(state), previous = cache.get(state), key = claimDependencies(state, previous);
    const validation = validations.get(state);
    if (validation && validation.view === previous && validation.world === state.world && validation.store === store && validation.key === key) return previous!;
    const view = computeTerritory(state);
    validations.set(state, { view, world: state.world, store, key: claimDependencies(state, cache.get(state)) });
    return view;
}

/** Seed a preview whose terrain initially matches the source. Claim arrays
 * are immutable derived data and may be shared; the cache header is private.
 * The target still validates its own sources, culture and sight revision on
 * its next query, and allocates new arrays when any claim actually changes. */
export function forkTerritory(source: GameState, target: GameState): void {
    if (source === target) return;
    territory(source);
    const original = cache.get(source)!;
    if (target.world.width !== original.width || target.world.height !== original.height) {
        cache.delete(target); validations.delete(target); return;
    }
    const worldRevision = worldRevisions(target.world).sight;
    cache.set(target, Object.assign(Object.create(original), { world: target.world, worldRevision, claimRevision: worldSightChangesSince(target.world).revision,
        signature: `${worldRevision}${original.signature.slice(original.signature.indexOf('|'))}` }));
    // Never bless the target's dependencies before checking them: a crop-free
    // search view is equivalent, but a new completed house is not.
    validations.delete(target);
}

/** Source geometry is independent of ownership and competing claims. Keep
 * immutable ray/flood results while houses are added elsewhere; terrain edits
 * invalidate only footprints whose conservative sight bounds intersect them. */
function sourceFootprint(world: World, source: Building, radius: number, key: string,
    previous?: ClaimFootprint, changedCells?: readonly number[]): ClaimFootprint {
    const { width, height } = world;
    const cx = source.x + buildingWidth(source) / 2, cy = source.y + buildingHeight(source) / 2, radius2 = radius * radius;
    const origin = { x: cx, y: cy }, covered = hasSightCover(world, origin, radius);
    const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(width - 1, Math.floor(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(height - 1, Math.floor(cy + radius));
    const localWidth = x1 - x0 + 1, localHeight = y1 - y0 + 1;
    const priorSamples = previous?.key === key && previous.left === x0 && previous.top === y0
        && previous.right === x1 && previous.bottom === y1 ? previous.samples : undefined;
    const sampled = covered ? territorySightCosts(world, origin, radius, x0, y0, x1, y1, priorSamples, changedCells) : undefined;
    const costs = covered ? sampled?.slice() ?? new Float64Array(localWidth * localHeight).fill(Infinity) : undefined;
    const cells: number[] = [], distances: number[] = [];
    const claim = (cell: number, distance: number): void => { cells.push(cell); distances.push(distance); };
    if (!sampled) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const cell = y * width + x, tile = world.tiles[cell];
        if (!tile || !costs && WATER.has(tile.terrain) && tile.terrain !== 'river') continue;
        const d2 = (x + .5 - cx) ** 2 + (y + .5 - cy) ** 2;
        if (d2 > radius2) continue;
        const distance = covered ? sightDistance(world, origin, x + .5, y + .5, radius) : Math.sqrt(d2);
        if (distance > radius) continue;
        if (costs) costs[(y - y0) * localWidth + x - x0] = distance;
        else claim(cell, distance);
    }
    if (costs) {
        // Grid samples on opposite sides of a tree can have very different
        // ray costs. Keep only affordable cells connected to this footing,
        // avoiding detached one-cell claims beyond an expensive tree tile.
        // Open water transmits influence but remains unclaimed, just as on
        // clear terrain; an unrelated tree must not block the other bank.
        // This local flood is needed only around woodland, on cache misses.
        const queue = new Int32Array(costs.length); let count = 0;
        const visit = (x: number, y: number): void => {
            if (x < 0 || y < 0 || x >= localWidth || y >= localHeight) return;
            const at = y * localWidth + x, distance = costs[at];
            if (distance < 0 || !Number.isFinite(distance)) return;
            costs[at] = -1; queue[count++] = at;
            claim((y + y0) * width + x + x0, distance);
        };
        for (let dy = 0; dy < buildingHeight(source); dy++) for (let dx = 0; dx < buildingWidth(source); dx++)
            visit(Math.floor(source.x) + dx - x0, Math.floor(source.y) + dy - y0);
        for (let head = 0; head < count; head++) {
            const at = queue[head], x = at % localWidth, y = Math.floor(at / localWidth);
            visit(x, y - 1); visit(x - 1, y); visit(x + 1, y); visit(x, y + 1);
        }
    }
    const dense = new Float64Array(localWidth * localHeight).fill(Infinity);
    for (let i = 0; i < cells.length; i++) dense[(Math.floor(cells[i] / width) - y0) * localWidth + cells[i] % width - x0] = distances[i];
    return { key, left: x0, top: y0, right: x1, bottom: y1, samples: sampled, costs: dense,
        cells: Uint32Array.from(cells), distances: Float64Array.from(distances) };
}

function computeTerritory(state: GameState): Territory {
    const { world } = state, { width, height } = world;
    const worldRevision = worldRevisions(world).sight;
    const villages = villageClaims(state);
    const previous = cache.get(state);
    // Traffic and visibility ask about the same claims many times per step.
    // Compare only the scalars used by the claim signature before allocating
    // filtered arrays, maps and strings. Direct edits remain visible immediately.
    if (previous?.world === world && previous.worldRevision === worldRevision) {
        let unchanged = previous.villages.length === villages.length && villages.every((village, index) => {
            const old = previous.villages[index];
            return old.id === village.id && old.campId === village.campId && old.faction === village.faction
                && old.x === village.x && old.y === village.y && old.radius === village.radius && old.cells === village.cells;
        }), index = 0;
        for (const faction of state.factions) {
            if (faction.id < 0 || faction.defeated || faction.villageId !== undefined) continue;
            const old = previous.factions[index++];
            if (!old || old.id !== faction.id || old.level !== cultureLevel(borderCulture(state, faction))) { unchanged = false; break; }
            // A young city can cross its own threshold while its faction stays
            // within the same older, much wider culture-level interval.
            if (previous.cities.some(city => city.faction === faction.id
                && city.level !== cultureLevel(cityBorderCulture(borderCulture(state, faction), city.cultureAtFounding)))) { unchanged = false; break; }
        }
        if (index !== previous.factions.length) unchanged = false;
        if (unchanged) {
            index = 0;
            for (const building of state.buildings) {
                if (!activeBorderSource(building) || !previous.levels.has(building.faction)) continue;
                const old = previous.sources[index++];
                if (!old || old.id !== building.id || old.kind !== building.kind || old.faction !== building.faction
                    || old.x !== building.x || old.y !== building.y
                    || old.initialCity !== !!building.initialCity
                    || old.cultureAtFounding !== cultureAmount(building.cultureAtFounding)) { unchanged = false; break; }
            }
            if (index !== previous.sources.length) unchanged = false;
        }
        if (unchanged) return previous;
    }
    const cultures = new Map(state.factions.filter(faction => faction.id >= 0 && !faction.defeated && faction.villageId === undefined).map(faction => [faction.id, borderCulture(state, faction)]));
    const levels = new Map([...cultures].map(([faction, culture]) => [faction, cultureLevel(culture)]));
    const sources = state.buildings.filter(building => activeBorderSource(building) && levels.has(building.faction));
    const cities: CityClaim[] = sources.filter(building => building.kind === 'palace').map(building => ({
        id: building.id, faction: building.faction, x: building.x, y: building.y,
        cultureAtFounding: cultureAmount(building.cultureAtFounding),
        level: cultureLevel(cityBorderCulture(cultures.get(building.faction), building.cultureAtFounding)),
    }));
    const sourceScalars: ClaimSource[] = sources.map(building => ({
        id: building.id, kind: building.kind, faction: building.faction, x: building.x, y: building.y,
        cultureAtFounding: cultureAmount(building.cultureAtFounding),
        initialCity: !!building.initialCity,
        level: building.kind === 'fort' ? 0 : (building.kind === 'palace' ? cities.find(city => city.id === building.id)
            : nearestClaimCity(cities, building.faction, building.x + buildingWidth(building) / 2, building.y + buildingHeight(building) / 2))?.level
            ?? levels.get(building.faction)!,
    }));
    const signature = `${worldRevision}|${[...levels].map(pair => pair.join(',')).join(';')}|${sourceScalars.map(b => `${b.id},${b.kind},${b.faction},${b.x},${b.y},${b.level},${Number(b.initialCity)}`).join(';')}`
        + `|${villages.map(village => `${village.id},${village.campId},${village.faction},${village.x},${village.y},${village.radius},${village.cells?.length ?? 0}`).join(';')}`;
    const factions = state.factions.filter(faction => faction.id >= 0 && !faction.defeated && faction.villageId === undefined)
        .map(faction => ({ id: faction.id, level: cultureLevel(borderCulture(state, faction)) }));
    if (previous?.world === world && previous.signature === signature) {
        // For example, repeated faction IDs can change the validation list
        // while leaving the Map-derived logical signature exactly the same.
        previous.factions = factions; previous.sources = sourceScalars; previous.levels = levels; previous.cities = cities; previous.villages = villages;
        return previous;
    }
    const compatible = previous?.world === world && previous.width === width && previous.height === height && previous.cells;
    const cells = new TerritoryCells(width * height, UNCLAIMED, compatible ? previous.cells : undefined);
    const sourceRadii = new Map(sourceScalars.map(source => [source.id, sourceRadius(source)]));
    const claimOrder = sources.map((_, index) => index).sort((a, b) =>
        Number(sources[a].kind === 'fort') - Number(sources[b].kind === 'fort')
        || (sources[a].kind === 'fort' ? sources[a].id - sources[b].id : a - b));
    const footprints = new Map<number, ClaimFootprint>(), dirty = new Set<number>();
    const changes = previous?.world === world && previous.worldRevision !== worldRevision
        ? worldSightChangesSince(world, previous.claimRevision) : undefined;
    const oldSources = new Map(previous?.sources.map(source => [source.id, source]));
    const touch = (source: ClaimSource, footprint?: ClaimFootprint): void => {
        for (const cell of footprint?.cells ?? []) dirty.add(cell);
        if (source.kind !== 'palace' && source.kind !== 'fort') return;
        for (let y = Math.max(0, source.y - SETTLEMENT_BORDER_BUFFER); y < Math.min(height, source.y + buildingHeight(source) + SETTLEMENT_BORDER_BUFFER); y++)
            for (let x = Math.max(0, source.x - SETTLEMENT_BORDER_BUFFER); x < Math.min(width, source.x + buildingWidth(source) + SETTLEMENT_BORDER_BUFFER); x++) dirty.add(y * width + x);
    };
    for (const sourceIndex of claimOrder) {
        const source = sources[sourceIndex], scalar = sourceScalars[sourceIndex], radius = sourceRadius(scalar);
        const key = `${source.x},${source.y},${buildingWidth(source)},${buildingHeight(source)},${radius}`;
        let footprint = previous?.world === world ? previous.footprints.get(source.id) : undefined;
        const changed = changes && (changes.full || !changes.cells.length || footprint && changes.cells.some(cell => {
            const x = cell % width, y = Math.floor(cell / width);
            return x >= footprint!.left && x <= footprint!.right && y >= footprint!.top && y <= footprint!.bottom;
        }));
        if (!footprint || footprint.key !== key || changed) {
            footprint = sourceFootprint(world, source, radius, key,
                footprint, changes && !changes.full && changes.cells.length ? changes.cells : undefined);
            const grant = scenarioCityClaim(state, source, radius);
            if (grant) {
                const left = Math.min(footprint.left, grant[1]), top = Math.min(footprint.top, grant[2]);
                const right = Math.max(footprint.right, grant[3]), bottom = Math.max(footprint.bottom, grant[4]);
                const localWidth = right - left + 1, costs = new Float64Array(localWidth * (bottom - top + 1)).fill(Infinity);
                const grantedCells: number[] = [], distances: number[] = [];
                const add = (cell: number, distance: number) => {
                    const index = (Math.floor(cell / width) - top) * localWidth + cell % width - left;
                    if (!Number.isFinite(costs[index])) { grantedCells.push(cell); distances.push(distance); costs[index] = distance; }
                };
                footprint.cells.forEach((cell, i) => add(cell, footprint!.distances[i]));
                for (let i = 0; i < grant[0]; i++) add(grant[5 + i * 2], grant[6 + i * 2]);
                footprint = { key, left, top, right, bottom, costs, cells: Uint32Array.from(grantedCells), distances: Float64Array.from(distances) };
            }
        }
        footprints.set(source.id, footprint);
        const old = oldSources.get(source.id);
        if (!compatible || !old || previous!.footprints.get(source.id) !== footprint || old.faction !== scalar.faction || old.kind !== scalar.kind) {
            if (old) touch(old, previous!.footprints.get(old.id));
            touch(scalar, footprint);
        }
        oldSources.delete(source.id);
    }
    for (const old of oldSources.values()) touch(old, previous!.footprints.get(old.id));
    // Preserve exact Float32 comparison order even after an editor reorders
    // surviving sources. Appends/removals do not reorder the other claimants.
    if (compatible) {
        const retained = new Set(sourceScalars.map(source => source.id));
        const oldOrder = previous!.sources.filter(source => retained.has(source.id)).map(source => source.id);
        const oldIds = new Set(oldOrder), newOrder = sourceScalars.filter(source => oldIds.has(source.id));
        if (newOrder.some((source, i) => source.id !== oldOrder[i]))
            for (const source of sourceScalars) touch(source, footprints.get(source.id));
    }
    const visitVillage = (village: VillageClaim, visit: (cell: number) => void): void => {
        if (village.cells) { for (const cell of village.cells) if (cell >= 0 && cell < width * height) visit(cell); return; }
        for (let y = Math.max(0, Math.floor(village.y - village.radius)); y <= Math.min(height - 1, Math.floor(village.y + village.radius)); y++)
            for (let x = Math.max(0, Math.floor(village.x - village.radius)); x <= Math.min(width - 1, Math.floor(village.x + village.radius)); x++)
                if ((x + .5 - village.x) ** 2 + (y + .5 - village.y) ** 2 <= village.radius ** 2) visit(y * width + x);
    };
    const oldVillages = new Map(previous?.villages.map(village => [village.id, village]));
    for (const village of villages) {
        sourceRadii.set(village.campId, village.radius);
        const old = oldVillages.get(village.id);
        if (!compatible || !old || old.faction !== village.faction || old.campId !== village.campId || old.x !== village.x
            || old.y !== village.y || old.radius !== village.radius || old.cells !== village.cells) {
            if (old) visitVillage(old, cell => dirty.add(cell));
            visitVillage(village, cell => dirty.add(cell));
        }
        oldVillages.delete(village.id);
    }
    for (const old of oldVillages.values()) visitVillage(old, cell => dirty.add(cell));
    // Source buckets make removal/capture reveal every remaining contender,
    // including the third and later claimants hidden behind the old winners.
    const bucketSize = 16, columns = Math.ceil(width / bucketSize), buckets = new Map<number, number[]>();
    for (const sourceIndex of claimOrder) {
        const source = sourceScalars[sourceIndex], footprint = footprints.get(source.id)!;
        const left = Math.max(0, Math.min(footprint.left, source.x - SETTLEMENT_BORDER_BUFFER));
        const right = Math.min(width - 1, Math.max(footprint.right, source.x + buildingWidth(source)));
        const top = Math.max(0, Math.min(footprint.top, source.y - SETTLEMENT_BORDER_BUFFER));
        const bottom = Math.min(height - 1, Math.max(footprint.bottom, source.y + buildingHeight(source)));
        for (let y = Math.floor(top / bucketSize); y <= Math.floor(bottom / bucketSize); y++)
            for (let x = Math.floor(left / bucketSize); x <= Math.floor(right / bucketSize); x++) {
                const key = y * columns + x, list = buckets.get(key);
                if (list) list.push(sourceIndex); else buckets.set(key, [sourceIndex]);
            }
    }
    const captured = villages.map(village => village.cells ? villageMask(village.cells) : undefined);
    const changedOwners: number[] = [];
    for (const cell of dirty) {
        const x = cell % width, y = Math.floor(cell / width), terrain = world.tiles[cell]?.terrain;
        const candidates = buckets.get(Math.floor(y / bucketSize) * columns + Math.floor(x / bucketSize)) ?? [];
        let owner = UNCLAIMED, id = UNCLAIMED, alternateOwner = UNCLAIMED, alternateId = UNCLAIMED;
        let influence = Infinity, alternateInfluence = Infinity;
        for (const index of candidates) {
            const source = sourceScalars[index], footprint = footprints.get(source.id)!;
            if (!terrain || WATER.has(terrain) && terrain !== 'river' || x < footprint.left || x > footprint.right
                || y < footprint.top || y > footprint.bottom || source.kind === 'fort' && owner !== UNCLAIMED && owner !== source.faction) continue;
            const distance = footprint.costs[(y - footprint.top) * (footprint.right - footprint.left + 1) + x - footprint.left];
            if (!Number.isFinite(distance)) continue;
            const score = distance * distance / sourceRadius(source) ** 2;
            if (score < influence - 1e-6 || Math.abs(score - influence) <= 1e-6
                && (source.faction < owner || source.faction === owner && source.id < id)) {
                alternateInfluence = influence; alternateOwner = owner; alternateId = id;
                influence = Math.fround(score); owner = source.faction; id = source.id;
            } else if (score < alternateInfluence - 1e-6 || Math.abs(score - alternateInfluence) <= 1e-6
                && (source.faction < alternateOwner || source.faction === alternateOwner && source.id < alternateId)) {
                alternateInfluence = Math.fround(score); alternateOwner = source.faction; alternateId = source.id;
            }
        }
        let villageInfluence: number | undefined;
        for (let i = 0; i < villages.length; i++) {
            const village = villages[i];
            if (captured[i]) {
                if (captured[i]!.has(cell)) { owner = village.faction; id = village.campId; alternateOwner = alternateId = UNCLAIMED; }
                continue;
            }
            const d2 = (x + .5 - village.x) ** 2 + (y + .5 - village.y) ** 2;
            if (d2 > village.radius ** 2) continue;
            const score = d2 / village.radius ** 2;
            if (villageInfluence !== undefined && (villageInfluence < score || villageInfluence === score && owner < village.faction)) continue;
            villageInfluence = score; owner = village.faction; id = village.campId; alternateOwner = alternateId = UNCLAIMED;
        }
        let first: { source: ClaimSource; distance: number } | undefined, second: typeof first;
        const precedes = (a: NonNullable<typeof first>, b: NonNullable<typeof first>) => a.distance < b.distance || a.distance === b.distance && a.source.id < b.source.id;
        for (const index of candidates) {
            const source = sourceScalars[index]; if (source.kind !== 'palace' && source.kind !== 'fort') continue;
            const right = source.x + buildingWidth(source) - 1, bottom = source.y + buildingHeight(source) - 1;
            if (x < source.x - SETTLEMENT_BORDER_BUFFER || x > right + SETTLEMENT_BORDER_BUFFER
                || y < source.y - SETTLEMENT_BORDER_BUFFER || y > bottom + SETTLEMENT_BORDER_BUFFER) continue;
            const dx = Math.max(source.x - x, 0, x - right), dy = Math.max(source.y - y, 0, y - bottom);
            const claim = { source, distance: dx * dx + dy * dy };
            if (!first) first = claim;
            else if (precedes(claim, first)) { second = first; first = claim; }
            else if (!second || precedes(claim, second)) second = claim;
        }
        if (first) {
            if (second) { alternateOwner = second.source.faction; alternateId = second.source.id; }
            else if (id !== first.source.id) { alternateOwner = owner; alternateId = id; }
            owner = first.source.faction; id = first.source.id;
        }
        if (cells.get(cell) !== owner) changedOwners.push(cell);
        cells.set(cell, [owner, id, alternateOwner, alternateId]);
    }
    cells.seal();
    const edgeCells = new Map(compatible ? previous!.edgeCells : undefined), edgeDirty = new Set(changedOwners);
    for (const cell of changedOwners) {
        const x = cell % width, y = Math.floor(cell / width);
        if (x) edgeDirty.add(cell - 1); if (x + 1 < width) edgeDirty.add(cell + 1);
        if (y) edgeDirty.add(cell - width); if (y + 1 < height) edgeDirty.add(cell + width);
    }
    for (const cell of edgeDirty) {
        const x = cell % width, y = Math.floor(cell / width), faction = cells.get(cell), edges: BorderEdge[] = [];
        const edge = (x: number, y: number, horizontal: boolean, neighborCell?: number): void => {
            const value: BorderEdge = { x, y, horizontal, faction, cell };
            if (neighborCell !== undefined && cells.get(neighborCell) !== UNCLAIMED) {
                value.neighborCell = neighborCell; value.neighborFaction = cells.get(neighborCell);
            }
            const old = previous?.edgeCells.get(cell)?.find(old => old.x === x && old.y === y && old.horizontal === horizontal
                && old.faction === faction && old.neighborCell === value.neighborCell && old.neighborFaction === value.neighborFaction);
            edges.push(old ?? value);
        };
        if (faction !== UNCLAIMED) {
            if (y === 0 || cells.get(cell - width) !== faction) edge(x, y, true, y > 0 ? cell - width : undefined);
            if (x === 0 || cells.get(cell - 1) !== faction) edge(x, y, false, x > 0 ? cell - 1 : undefined);
            if (y === height - 1 || cells.get(cell + width) === UNCLAIMED) edge(x, y + 1, true);
            if (x === width - 1 || cells.get(cell + 1) === UNCLAIMED) edge(x + 1, y, false);
        }
        if (edges.length) edgeCells.set(cell, edges); else edgeCells.delete(cell);
    }
    let journal = journals.get(state);
    if (!journal || !compatible) { journal = new CellJournal(width * height * 2); journals.set(state, journal); journal.publish(); }
    else journal.publish(changedOwners);
    const arrays: (Int32Array | undefined)[] = [];
    let edges: BorderEdge[] | undefined, paths: BorderPath[] | undefined;
    const result: CachedTerritory = {
        width, height, cells, edgeCells, journal, cellRevision: journal.revision,
        get owners() { return arrays[0] ??= cells.flatten(0); },
        get sourceIds() { return arrays[1] ??= cells.flatten(1); },
        get alternateOwners() { return arrays[2] ??= cells.flatten(2); },
        get alternateSourceIds() { return arrays[3] ??= cells.flatten(3); },
        sourceRadii,
        get edges() { return edges ??= [...edgeCells.keys()].sort((a, b) => a - b).flatMap(cell => edgeCells.get(cell)!); },
        get paths() { return paths ??= roundedPaths(this.edges); },
        world, footprints, claimRevision: worldSightChangesSince(world).revision,
        worldRevision, signature, levels, factions, sources: sourceScalars, cities, villages, revision: (previous?.revision ?? 0) + 1,
    };
    cache.set(state, result);
    return result;
}

export function insideOwnBorders(state: GameState, faction: number, x: number, y: number, borders = territory(state)): boolean {
    return faction >= 0 && x >= 0 && y >= 0 && x < borders.width && y < borders.height
        && territoryValue(borders, Math.floor(y) * borders.width + Math.floor(x)) === faction;
}

/** Test independent territorial support without letting a building's own
 * zero-distance claim protect it forever. The runner-up includes friendly
 * sources, so a nearby palace or house still shields its city's property. */
export function territoryOwnerWithoutSource(state: GameState, x: number, y: number, excludedSourceId: number,
    borders = territory(state)): number {
    if (!(x >= 0 && y >= 0 && x < borders.width && y < borders.height)) return UNCLAIMED;
    const cell = Math.floor(y) * borders.width + Math.floor(x);
    return territoryValue(borders, cell, 1) === excludedSourceId ? territoryValue(borders, cell, 2) : territoryValue(borders, cell);
}

export interface IndependentBorderClaim { faction: number; sourceId: number; radius: number }
/** Source strength lets property transfers resolve equal overlapping sources
 * deterministically, rather than having two isolated cities swap owners. */
export function territoryClaimWithoutSource(state: GameState, x: number, y: number, excludedSourceId: number,
    borders = territory(state)): IndependentBorderClaim | undefined {
    if (!(x >= 0 && y >= 0 && x < borders.width && y < borders.height)) return;
    const cell = Math.floor(y) * borders.width + Math.floor(x), alternate = territoryValue(borders, cell, 1) === excludedSourceId;
    const faction = alternate ? territoryValue(borders, cell, 2) : territoryValue(borders, cell);
    if (faction === UNCLAIMED) return;
    const sourceId = alternate ? territoryValue(borders, cell, 3) : territoryValue(borders, cell, 1);
    return { faction, sourceId, radius: borders.sourceRadii.get(sourceId)! };
}

/** Ownership-only journal consumed independently by fog and the minimap. */
export function territoryChanges(view: Territory, previous?: Territory): CellChanges {
    return view.journal && view.journal === previous?.journal
        ? view.journal.since(previous?.cellRevision) : { revision: view.cellRevision ?? view.revision, full: true, cells: [] };
}
