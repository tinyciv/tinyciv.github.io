import { buildingReady, buildingWidth, buildingHeight, type Building, type GameState, type NeutralVillage, type Point, type World, WATER } from './types';
import { cultureLevel } from './culture';
import { hasSightCover, sightDistance } from './sight';
import { worldRevisions, worldStructureRevision } from './world-revisions';
import { entityStore, type EntityStore } from './entity-store';
import { simulationReadsActive, structureChangeRevision } from './simulation-reads';

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
    /** Winning individual source and strongest claim from any other source. */
    sourceIds: Int32Array; alternateOwners: Int32Array; alternateSourceIds: Int32Array;
    sourceRadii: ReadonlyMap<number, number>;
    edges: BorderEdge[]; paths: BorderPath[]; revision: number;
}
interface ClaimSource { id: number; kind: Building['kind']; faction: number; x: number; y: number; cultureAtFounding: number; level: number; initialCity: boolean }
interface CityClaim { id: number; faction: number; x: number; y: number; cultureAtFounding: number; level: number }
interface VillageClaim { cells?: number[]; id: number; campId: number; faction: number; x: number; y: number; radius: number }
interface CachedTerritory extends Territory {
    world: World; worldRevision: number; signature: string;
    levels: Map<number, number>; factions: { id: number; level: number }[]; sources: ClaimSource[]; cities: CityClaim[]; villages: VillageClaim[];
}
const cache = new WeakMap<GameState, CachedTerritory>();
const validations = new WeakMap<GameState, { view: Territory; world: World; store: EntityStore; key: string }>();

/** Only structural edits and claim thresholds affect territory. Moving units,
 * crop animation and road wear never require rediscovering claim sources. */
function claimDependencies(state: GameState, previous?: CachedTerritory): string {
    const revisions = worldRevisions(state.world);
    return `${revisions.sight}|${worldStructureRevision(state.world)}|${entityStore(state).buildings.revision}|${structureChangeRevision(state)}`
        + '|' + state.factions.map(f => `${f.id},${Number(!!f.defeated)},${f.villageId ?? ''},${cultureLevel(f.culture)},${f.villageId === undefined ? '' : f.population}`).join(';')
        + '|' + (previous?.cities ?? []).map(city => `${city.id},${cultureLevel(cityBorderCulture(state.factions.find(f => f.id === city.faction)?.culture, city.cultureAtFounding))}`).join(';')
        + '|' + (state.villages ?? []).map(v => `${v.id},${v.campId},${v.faction},${v.x},${v.y},${Number(!!v.destroyed)}`).join(';');
}

export const BASE_BORDER_RADIUS = { palace: 5, house: 2.5, monument: 4, fort: 5 } as const;
export const BORDER_RADIUS_MULTIPLIER = 1.3;
export const INHERITED_CITY_CULTURE_CAP = 100;
export const INITIAL_CITY_BORDER_BONUS = 3;
export const SETTLEMENT_BORDER_BUFFER = 1;
export const VILLAGE_BORDER_START_RADIUS = 3;
export const VILLAGE_BORDER_MAX_RADIUS = 6;

/** Three initial tents fit in a small clearing. Residents and completed civic
 * development enlarge it gradually, independently of civilization culture. */
function villageRadius(population: number, developedBuildings: number): number {
    return Math.min(VILLAGE_BORDER_MAX_RADIUS, VILLAGE_BORDER_START_RADIUS
        + Math.max(0, population - 5) * .1 + developedBuildings * .2);
}

export function villageBorderRadius(state: GameState, village: NeutralVillage): number {
    const faction = state.factions.find(owner => owner.id === village.faction);
    const developed = state.buildings.filter(building => building.villageId === village.id && building.faction === village.faction
        && ['house', 'guardPost', 'woodenTower', 'tower'].includes(building.kind) && buildingReady(building)).length;
    return villageRadius(faction?.population ?? 0, developed);
}

function villageClaims(state: GameState): VillageClaim[] {
    if (!state.villages?.length) return [];
    const factions = new Map(state.factions.filter(faction => faction.villageId !== undefined && !faction.defeated).map(faction => [faction.id, faction]));
    const camps = new Map<number, Building>(), development = new Map<number, number>();
    for (const building of state.buildings) {
        if (building.villageId === undefined || !buildingReady(building) || !factions.has(building.faction)) continue;
        if (building.kind === 'villageTent' || building.kind === 'palace') camps.set(building.id, building);
        else if (['house', 'guardPost', 'woodenTower', 'tower'].includes(building.kind))
            development.set(building.villageId, (development.get(building.villageId) ?? 0) + 1);
    }
    return state.villages.filter(village => !village.destroyed && camps.get(village.campId)?.faction === village.faction
        && factions.get(village.faction)?.villageId === village.id).map(village => ({
        id: village.id, campId: village.campId, faction: village.faction, x: village.x + .5, y: village.y + .5,
        radius: villageRadius(factions.get(village.faction)!.population, development.get(village.id) ?? 0), cells: village.secededCity?.territoryCells,
    }));
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
    return cityBorderCulture(state.factions.find(owner => owner.id === faction)?.culture, palace?.cultureAtFounding);
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
        const from = corner(edge, edge, { x: dx, y: dy }), to = corner(edge, last, { x: -dx, y: -dy });
        return { edge, start: from?.midpoint ?? { x: edge.x, y: edge.y }, end: to?.midpoint ?? last, from: from?.curve, to: to?.curve };
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
                && old.x === village.x && old.y === village.y && old.radius === village.radius && old.cells?.length === village.cells?.length;
        }), index = 0;
        for (const faction of state.factions) {
            if (faction.id < 0 || faction.defeated || faction.villageId !== undefined) continue;
            const old = previous.factions[index++];
            if (!old || old.id !== faction.id || old.level !== cultureLevel(faction.culture)) { unchanged = false; break; }
            // A young city can cross its own threshold while its faction stays
            // within the same older, much wider culture-level interval.
            if (previous.cities.some(city => city.faction === faction.id
                && city.level !== cultureLevel(cityBorderCulture(faction.culture, city.cultureAtFounding)))) { unchanged = false; break; }
        }
        if (index !== previous.factions.length) unchanged = false;
        if (unchanged) {
            index = 0;
            for (const building of state.buildings) {
                if (!buildingReady(building) || (building.kind !== 'palace' && building.kind !== 'house' && building.kind !== 'monument' && building.kind !== 'fort')
                    || !previous.levels.has(building.faction)) continue;
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
    const cultures = new Map(state.factions.filter(faction => faction.id >= 0 && !faction.defeated && faction.villageId === undefined).map(faction => [faction.id, faction.culture]));
    const levels = new Map([...cultures].map(([faction, culture]) => [faction, cultureLevel(culture)]));
    const sources = state.buildings.filter(building => buildingReady(building)
        && (building.kind === 'palace' || building.kind === 'house' || building.kind === 'monument' || building.kind === 'fort')
        && levels.has(building.faction));
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
        .map(faction => ({ id: faction.id, level: cultureLevel(faction.culture) }));
    if (previous?.world === world && previous.signature === signature) {
        // For example, repeated faction IDs can change the validation list
        // while leaving the Map-derived logical signature exactly the same.
        previous.factions = factions; previous.sources = sourceScalars; previous.levels = levels; previous.cities = cities; previous.villages = villages;
        return previous;
    }
    const owners = new Int32Array(width * height).fill(UNCLAIMED), influence = new Float32Array(width * height).fill(Infinity);
    const sourceIds = new Int32Array(width * height).fill(UNCLAIMED), alternateOwners = new Int32Array(width * height).fill(UNCLAIMED);
    const alternateSourceIds = new Int32Array(width * height).fill(UNCLAIMED);
    const alternateInfluence = new Float32Array(width * height).fill(Infinity);
    const sourceRadii = new Map(sourceScalars.map(source => [source.id, sourceRadius(source)]));
    // Forts extend the frontier into unclaimed ground. Resolve all civic
    // borders first, then older forts, so constructing a fort cannot displace
    // another faction's settlement or an established fort frontier. Keep the
    // original source order in the cache signature and use a separate index.
    const claimOrder = sources.map((_, index) => index).sort((a, b) =>
        Number(sources[a].kind === 'fort') - Number(sources[b].kind === 'fort')
        || (sources[a].kind === 'fort' ? sources[a].id - sources[b].id : a - b));
    for (const sourceIndex of claimOrder) {
        const source = sources[sourceIndex], radius = sourceRadius(sourceScalars[sourceIndex]);
        const cx = source.x + buildingWidth(source) / 2, cy = source.y + buildingHeight(source) / 2, radius2 = radius * radius;
        const origin = { x: cx, y: cy }, covered = hasSightCover(world, origin, radius);
        const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(width - 1, Math.floor(cx + radius));
        const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(height - 1, Math.floor(cy + radius));
        const localWidth = x1 - x0 + 1, localHeight = y1 - y0 + 1;
        const costs = covered ? new Float64Array(localWidth * localHeight).fill(Infinity) : undefined;
        const claim = (cell: number, distance: number): void => {
            const terrain = world.tiles[cell]?.terrain;
            if (!terrain || WATER.has(terrain) && terrain !== 'river') return;
            if (source.kind === 'fort' && owners[cell] !== UNCLAIMED && owners[cell] !== source.faction) return;
            const score = distance * distance / radius2;
            if (score < influence[cell] - 1e-6 || Math.abs(score - influence[cell]) <= 1e-6
                && (source.faction < owners[cell] || source.faction === owners[cell] && source.id < sourceIds[cell])) {
                alternateInfluence[cell] = influence[cell]; alternateOwners[cell] = owners[cell]; alternateSourceIds[cell] = sourceIds[cell];
                influence[cell] = score; owners[cell] = source.faction; sourceIds[cell] = source.id;
            } else if (score < alternateInfluence[cell] - 1e-6
                || Math.abs(score - alternateInfluence[cell]) <= 1e-6
                && (source.faction < alternateOwners[cell] || source.faction === alternateOwners[cell] && source.id < alternateSourceIds[cell])) {
                alternateInfluence[cell] = score; alternateOwners[cell] = source.faction; alternateSourceIds[cell] = source.id;
            }
        };
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
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
    }
    // Village land is a diplomatic reservation: a stronger civilization claim
    // cannot erase it. These owners never count as player-owned fog coverage.
    const villageInfluence = new Map<number, number>();
    for (const village of villages) {
        sourceRadii.set(village.campId, village.radius);
        if (village.cells) {
            for (const cell of village.cells) if (cell >= 0 && cell < owners.length) {
                owners[cell] = village.faction; sourceIds[cell] = village.campId;
                alternateOwners[cell] = UNCLAIMED; alternateSourceIds[cell] = UNCLAIMED;
            }
            continue;
        }
        const r2 = village.radius ** 2;
        for (let y = Math.max(0, Math.floor(village.y - village.radius)); y <= Math.min(height - 1, Math.floor(village.y + village.radius)); y++)
            for (let x = Math.max(0, Math.floor(village.x - village.radius)); x <= Math.min(width - 1, Math.floor(village.x + village.radius)); x++) {
                const distance2 = (x + .5 - village.x) ** 2 + (y + .5 - village.y) ** 2;
                if (distance2 > r2) continue;
                const cell = y * width + x, score = distance2 / r2, old = villageInfluence.get(cell);
                if (old !== undefined && (old < score || old === score && owners[cell] < village.faction)) continue;
                villageInfluence.set(cell, score);
                owners[cell] = village.faction; sourceIds[cell] = village.campId;
                alternateOwners[cell] = UNCLAIMED; alternateSourceIds[cell] = UNCLAIMED;
            }
    }
    // A standing settlement or fort keeps its footing and one complete cell
    // around it, even against overwhelming culture or dense sight cover.
    // This small reservation includes adjacent water, so a coastal city's
    // border still has a continuous buffer. It does not enlarge fort claims
    // elsewhere. In the rare case of overlapping reservations, a structure's
    // own footprint wins before nearer rings, then its stable ID breaks ties.
    // Keep the next independent claimant for ordinary property transfers.
    type ProtectedClaim = { source: Building; distance: number };
    const protectedCells = new Map<number, { first: ProtectedClaim; second?: ProtectedClaim }>();
    const precedes = (a: ProtectedClaim, b: ProtectedClaim): boolean =>
        a.distance < b.distance || a.distance === b.distance && a.source.id < b.source.id;
    for (const source of sources) {
        if (source.kind !== 'palace' && source.kind !== 'fort') continue;
        const right = source.x + buildingWidth(source) - 1, bottom = source.y + buildingHeight(source) - 1;
        for (let y = Math.max(0, source.y - SETTLEMENT_BORDER_BUFFER); y <= Math.min(height - 1, bottom + SETTLEMENT_BORDER_BUFFER); y++)
            for (let x = Math.max(0, source.x - SETTLEMENT_BORDER_BUFFER); x <= Math.min(width - 1, right + SETTLEMENT_BORDER_BUFFER); x++) {
                const cell = y * width + x;
                const dx = Math.max(source.x - x, 0, x - right), dy = Math.max(source.y - y, 0, y - bottom);
                const claim = { source, distance: dx * dx + dy * dy }, previous = protectedCells.get(cell);
                if (!previous) protectedCells.set(cell, { first: claim });
                else if (precedes(claim, previous.first)) { previous.second = previous.first; previous.first = claim; }
                else if (!previous.second || precedes(claim, previous.second)) previous.second = claim;
            }
    }
    for (const [cell, { first, second }] of protectedCells) {
        if (second) {
            alternateOwners[cell] = second.source.faction; alternateSourceIds[cell] = second.source.id;
        } else if (sourceIds[cell] !== first.source.id) {
            alternateOwners[cell] = owners[cell]; alternateSourceIds[cell] = sourceIds[cell];
        }
        owners[cell] = first.source.faction; sourceIds[cell] = first.source.id;
    }
    const edges: BorderEdge[] = [];
    const edge = (x: number, y: number, horizontal: boolean, faction: number, cell: number, neighborCell?: number): BorderEdge => ({
        x, y, horizontal, faction, cell,
        ...(neighborCell !== undefined && owners[neighborCell] !== UNCLAIMED ? { neighborCell, neighborFaction: owners[neighborCell] } : {}),
    });
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const cell = y * width + x, faction = owners[cell];
        if (faction === UNCLAIMED) continue;
        if (y === 0 || owners[cell - width] !== faction) edges.push(edge(x, y, true, faction, cell, y > 0 ? cell - width : undefined));
        if (x === 0 || owners[cell - 1] !== faction) edges.push(edge(x, y, false, faction, cell, x > 0 ? cell - 1 : undefined));
        if (y === height - 1 || owners[cell + width] === UNCLAIMED) edges.push(edge(x, y + 1, true, faction, cell));
        if (x === width - 1 || owners[cell + 1] === UNCLAIMED) edges.push(edge(x + 1, y, false, faction, cell));
    }
    const result: CachedTerritory = { width, height, owners, sourceIds, alternateOwners, alternateSourceIds, sourceRadii, edges, paths: roundedPaths(edges), world,
        worldRevision, signature, levels, factions, sources: sourceScalars, cities, villages, revision: (previous?.revision ?? 0) + 1 };
    cache.set(state, result);
    return result;
}

export function insideOwnBorders(state: GameState, faction: number, x: number, y: number, borders = territory(state)): boolean {
    return faction >= 0 && x >= 0 && y >= 0 && x < borders.width && y < borders.height
        && borders.owners[Math.floor(y) * borders.width + Math.floor(x)] === faction;
}

/** Test independent territorial support without letting a building's own
 * zero-distance claim protect it forever. The runner-up includes friendly
 * sources, so a nearby palace or house still shields its city's property. */
export function territoryOwnerWithoutSource(state: GameState, x: number, y: number, excludedSourceId: number,
    borders = territory(state)): number {
    if (!(x >= 0 && y >= 0 && x < borders.width && y < borders.height)) return UNCLAIMED;
    const cell = Math.floor(y) * borders.width + Math.floor(x);
    return borders.sourceIds[cell] === excludedSourceId ? borders.alternateOwners[cell] : borders.owners[cell];
}

export interface IndependentBorderClaim { faction: number; sourceId: number; radius: number }
/** Source strength lets property transfers resolve equal overlapping sources
 * deterministically, rather than having two isolated cities swap owners. */
export function territoryClaimWithoutSource(state: GameState, x: number, y: number, excludedSourceId: number,
    borders = territory(state)): IndependentBorderClaim | undefined {
    if (!(x >= 0 && y >= 0 && x < borders.width && y < borders.height)) return;
    const cell = Math.floor(y) * borders.width + Math.floor(x), alternate = borders.sourceIds[cell] === excludedSourceId;
    const faction = alternate ? borders.alternateOwners[cell] : borders.owners[cell];
    if (faction === UNCLAIMED) return;
    const sourceId = alternate ? borders.alternateSourceIds[cell] : borders.sourceIds[cell];
    return { faction, sourceId, radius: borders.sourceRadii.get(sourceId)! };
}
