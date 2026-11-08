import { territory, UNCLAIMED } from './borders';
import { constructionEdges } from './builders';
import { civilianWorkforcePopulations, recordCivilianCasualties, workerHomeCity } from './civilian-population';
import { unitPositionBlocked } from './civilian-movement';
import { entityStore } from './entity-store';
import { forbiddenRevision, isForbidden } from './forbidden-zones';
import { canTraverseEdge, canWalk, findPath, withNavigationFrame } from './pathfinding';
import { canDispatchPeasant } from './peasant-capacity';
import { planResourceRoad, buildResourceRoadTile, resourceRoadTileReady } from './resource-roads';
import { southernResourceCell } from './resource-worksite';
import { worldRevisions, worldStructureRevision } from './world-revisions';
import { buildingHeight, buildingPresent, buildingReady, buildingWidth, distance, WATER,
    type GameState, type Point, type ResourceWorkKind, type ResourceWorkSite, type Unit } from './types';

export const RESOURCE_VISIT_INTERVAL = 10;
export const RESOURCE_WORK_SECONDS = 5;
export const RESOURCE_ROAD_TILE_SECONDS = .55;
const kinds = new Set(['copper', 'iron', 'stone', 'salt', 'olives']);
const metal = (resource: ResourceWorkKind) => resource === 'copper' || resource === 'iron';
type Move = (state: GameState, unit: Unit, goal: Point, dt: number, direct?: boolean, allowPartial?: boolean, avoidForbidden?: boolean) => void;
interface SitesCache {
    world: GameState['world']; tiles: GameState['world']['tiles']; appearance: number; structure: number; borders: number; buildings: number; factions: string;
    candidates: number[]; sites: Map<number, ResourceWorkSite>; source: GameState['resourceWorkSites'];
}
const caches = new WeakMap<GameState, SitesCache>();
const journeys = new WeakMap<ResourceWorkSite, { state: GameState; key: string; journey: ReturnType<typeof planResourceRoad> }>();
const pointAt = (state: GameState, cell: number): Point => ({ x: cell % state.world.width + .5, y: Math.floor(cell / state.world.width) + .5 });
const clearPath = (unit: Unit) => { unit.path = undefined; unit.pathGoal = undefined; unit.destination = undefined; unit.repathAt = 0; unit.moving = false; };

/** Only topology/ownership changes rebuild connected sites. The common worker
 * frame does a map lookup, not a world scan or a resource ownership query. */
function reconcileSites(state: GameState, force = false): SitesCache {
    const world = state.world, revisions = worldRevisions(world), borders = territory(state), store = entityStore(state);
    const structure = worldStructureRevision(world), factions = state.factions.map(f => `${f.id}:${Number(f.defeated)}`).join(',');
    let cache = caches.get(state);
    if (!force && cache?.world === world && cache.tiles === world.tiles && cache.appearance === revisions.appearance
        && cache.structure === structure && cache.borders === borders.revision && cache.buildings === store.buildings.revision
        && cache.factions === factions && cache.source === state.resourceWorkSites) return cache;
    const candidates = !cache || cache.world !== world || cache.tiles !== world.tiles || cache.appearance !== revisions.appearance
        ? world.tiles.flatMap((tile, cell) => tile.resourceDeveloped && kinds.has(tile.resource ?? '') ? [cell] : []) : cache.candidates;
    const previous = state.resourceWorkSites ?? [], used = new Set<ResourceWorkSite>();
    const blocked = new Set<number>();
    for (const b of state.buildings) if (buildingPresent(b) && b.kind !== 'road')
        for (let y = b.y; y < b.y + buildingHeight(b); y++) for (let x = b.x; x < b.x + buildingWidth(b); x++)
            blocked.add(y * world.width + x);
    const owners = new Set(state.buildings.filter(b => b.kind === 'palace' && buildingReady(b)
        && !state.factions.find(f => f.id === b.faction)?.defeated).map(b => b.faction));
    const remaining = new Set(candidates.filter(cell => {
        const t = world.tiles[cell], owner = borders.owners[cell];
        return t.resourceDeveloped && !blocked.has(cell) && !WATER.has(t.terrain) && !t.creek
            && owner !== UNCLAIMED && owners.has(owner);
    }));
    const sites: ResourceWorkSite[] = [];
    let sequence = Math.max(state.nextResourceWorkSiteId ?? 1, ...previous.map(site => site.id + 1));
    for (const start of remaining) {
        const cells = [start], tile = world.tiles[start], faction = borders.owners[start]; remaining.delete(start);
        for (let head = 0; head < cells.length; head++) {
            const cell = cells[head], x = cell % world.width, y = Math.floor(cell / world.width);
            for (const [nx, ny] of [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]]) {
                if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
                const next = ny * world.width + nx, t = world.tiles[next];
                if (!remaining.has(next) || borders.owners[next] !== faction || t.resource !== tile.resource
                    || tile.resourceGroup !== undefined && t.resourceGroup !== undefined && tile.resourceGroup !== t.resourceGroup) continue;
                remaining.delete(next); cells.push(next);
            }
        }
        cells.sort((a, b) => a - b);
        const old = previous.find(site => !used.has(site) && site.faction === faction && site.resource === tile.resource
            && site.cells.some(cell => cells.includes(cell)));
        const same = old && old.cells.length === cells.length && cells.every((cell, i) => old.cells[i] === cell);
        const site: ResourceWorkSite = old ?? { id: sequence++, faction, resource: tile.resource as ResourceWorkKind, cells, revision: 0,
            nextVisitAt: state.time + RESOURCE_VISIT_INTERVAL, roadComplete: false };
        if (old && !same) { site.revision++; site.roadComplete = false; site.roadWorker = undefined; site.retryAt = undefined; }
        site.cells = cells; used.add(site); sites.push(site);
    }
    state.resourceWorkSites = sites; state.nextResourceWorkSiteId = sequence;
    cache = { world, tiles: world.tiles, appearance: revisions.appearance, structure, borders: borders.revision,
        buildings: store.buildings.revision, factions, candidates, sites: new Map(sites.map(site => [site.id, site])), source: sites };
    caches.set(state, cache); return cache;
}
function currentSite(state: GameState, unit: Unit): ResourceWorkSite | undefined {
    const job = unit.resourceWork; if (!job) return;
    const site = caches.get(state)?.sites.get(job.site) ?? state.resourceWorkSites?.find(site => site.id === job.site);
    return site?.faction === unit.faction && site.revision === job.revision ? site : undefined;
}
function nextUnitId(state: GameState): number {
    let id = 0;
    for (const value of entityStore(state).units.ids()) id = Math.max(id, value);
    for (const value of entityStore(state).buildings.ids()) id = Math.max(id, value);
    return id + 1;
}
function workPoint(state: GameState, site: ResourceWorkSite, approach: Point): Point | undefined {
    const cell = southernResourceCell(site.cells, state.world.width)!;
    const point = pointAt(state, cell);
    // Rocky deposits are solid. Miners enter from the exterior approach;
    // quarry workers remain there to hammer the exposed face.
    const choices = site.resource === 'stone' || metal(site.resource) ? [approach]
        : [point, ...site.cells.map(cell => pointAt(state, cell)).sort((a, b) => distance(a, approach) - distance(b, approach))];
    return choices.find(goal => canWalk(state, goal.x, goal.y, site.faction, undefined, true)
        && (distance(goal, approach) < .12 || findPath(state, approach, goal, site.faction, false, undefined, undefined, undefined, false, true).length > 0));
}
function dispatch(state: GameState, site: ResourceWorkSite, road: boolean): boolean {
    const populations = civilianWorkforcePopulations(state);
    const key = `${site.revision}:${worldStructureRevision(state.world)}:${entityStore(state).buildings.revision}:${forbiddenRevision(state, site.faction)}:${[...populations].map(([id, n]) => `${id}:${n}`).join(',')}`;
    let cached = journeys.get(site);
    if (cached?.state !== state || cached.key !== key) {
        cached = { state, key, journey: planResourceRoad(state, site.faction, site.cells, site.resource) }; journeys.set(site, cached);
    }
    const journey = cached.journey;
    if (!journey) { site.retryAt = state.time + 3; return false; }
    const population = populations.get(journey.home) ?? 0;
    if (population <= 0) { site.retryAt = state.time + 3; return false; }
    const unit: Unit = { id: nextUnitId(state), kind: 'worker', faction: site.faction, home: journey.home,
        ...journey.exit, hp: 50, maxHp: 50, morale: 100, attack: 0, defense: 0, speed: 2.2, range: 1.1,
        order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0, bornAt: state.time, inside: true };
    const active = entityStore(state).units.query('worker').filter(other => other.hp > 0 && other.faction === site.faction
        && (!other.inside || other.resourceWork?.phase === 'working') && workerHomeCity(state, other)?.id === journey.home).length;
    if (active >= population || !canDispatchPeasant(state, unit) || unitPositionBlocked(state, unit, journey.exit)) {
        site.retryAt = state.time + 3; return false;
    }
    const goal = workPoint(state, site, journey.goal);
    if (!goal) { site.retryAt = state.time + 3; return false; }
    unit.resourceWork = { site: site.id, revision: site.revision, resource: site.resource, phase: road ? 'road' : 'outbound',
        goal, approach: { ...journey.goal }, roadCells: road ? journey.roadCells : undefined, roadIndex: road ? 0 : undefined };
    unit.inside = false;
    entityStore(state).units.add(unit);
    if (road) site.roadWorker = unit.id;
    return true;
}

/** Called by development itself, including AI and authenticated multiplayer
 * orders. The first resident appears immediately; walking/building uses time. */
export function onResourceDeveloped(state: GameState, cells: readonly number[], _resource: ResourceWorkKind, faction: number): void {
    const added = new Set(cells), cache = reconcileSites(state, true);
    withNavigationFrame(state, () => {
        for (const site of cache.sites.values()) if (site.faction === faction && site.cells.some(cell => added.has(cell))) {
            const worker = entityStore(state).units.get(site.roadWorker ?? -1);
            if (!site.roadComplete && (!worker || worker.hp <= 0)) dispatch(state, site, true);
        }
    });
}

/** A bounded schedule attempts one new trip per site every ten game seconds.
 * Missed visits never accumulate a burst after a pause or lack of residents. */
export function updateResourceWorkforce(state: GameState): void {
    if (state.paused || state.gameOver) return;
    recordCivilianCasualties(state);
    const sites = reconcileSites(state).sites;
    withNavigationFrame(state, () => {
        for (const site of sites.values()) {
            if (state.time < (site.retryAt ?? -Infinity)) continue;
            const roadWorker = entityStore(state).units.get(site.roadWorker ?? -1);
            if (!site.roadComplete && (!roadWorker || roadWorker.hp <= 0 || roadWorker.kind !== 'worker' || roadWorker.resourceWork?.phase !== 'road'
                || roadWorker.faction !== site.faction)) dispatch(state, site, true);
            if (state.time + 1e-8 < site.nextVisitAt) continue;
            site.nextVisitAt += (1 + Math.floor((state.time - site.nextVisitAt + 1e-8) / RESOURCE_VISIT_INTERVAL)) * RESOURCE_VISIT_INTERVAL;
            dispatch(state, site, false);
        }
    });
}
function finishResident(state: GameState, unit: Unit): void {
    unit.inside = true; clearPath(unit);
    entityStore(state).units.retain(other => other !== unit);
    if (state.selectedType === 'unit' && state.selected === unit.id) { state.selected = null; state.selectedType = null; }
}
function beginReturn(state: GameState, unit: Unit): void {
    const job = unit.resourceWork!;
    const site = currentSite(state, unit);
    if (site?.roadWorker === unit.id) site.roadWorker = undefined;
    job.phase = 'returning'; job.nextPlanAt = undefined; job.workTarget = undefined;
    unit.inside = false; unit.order = 'hold'; unit.attackTime = 0; clearPath(unit);
}
function returnHome(state: GameState, unit: Unit, dt: number, move: Move): void {
    const job = unit.resourceWork!;
    let home = entityStore(state).buildings.get(unit.home ?? -1);
    if (!home || home.kind !== 'palace' || home.faction !== unit.faction || !buildingReady(home)) {
        home = state.buildings.filter(b => b.kind === 'palace' && b.faction === unit.faction && buildingReady(b))
            .sort((a, b) => distance(a, unit) - distance(b, unit) || a.id - b.id)[0];
        unit.home = home?.id; clearPath(unit); job.nextPlanAt = undefined;
    }
    if (!home) {
        // A defeated/landless realm has no destination. Keep the surviving
        // civilian visible, but release the abandoned job instead of retrying
        // an impossible journey every frame or deleting a living resident.
        unit.order = 'hold'; unit.inside = false; unit.resourceWork = undefined; return;
    }
    if (unit.inside) { finishResident(state, unit); return; }
    if (!unit.destination || !canWalk(state, unit.destination.x, unit.destination.y, unit.faction, undefined, true)
        || (unit.stuckFor ?? 0) > 2) {
        if (state.time < (job.nextPlanAt ?? -Infinity)) return;
        job.nextPlanAt = state.time + 5;
        const choices = constructionEdges(state, home, true).sort((a, b) => distance(unit, a) - distance(unit, b));
        let found = false;
        for (const goal of choices) {
            const path = findPath(state, unit, goal, unit.faction, false, undefined, undefined, undefined, false, true);
            if (!path.length && distance(unit, goal) > .12) continue;
            clearPath(unit); unit.destination = { ...goal }; unit.pathGoal = { ...goal }; unit.path = path; found = true; break;
        }
        if (!found) return;
    }
    const goal = unit.destination!;
    move(state, unit, goal, dt, false, false, true);
    if (distance(unit, goal) <= .15) finishResident(state, unit);
}
function roadWork(state: GameState, unit: Unit, site: ResourceWorkSite, dt: number, move: Move): void {
    const job = unit.resourceWork!, cells = job.roadCells ?? [];
    const target = cells[job.roadIndex ?? 0];
    if (!target) { site.roadComplete = true; beginReturn(state, unit); return; }
    if (distance(unit, target) > .16) {
        unit.order = 'hold'; move(state, unit, target, dt, false, false, true);
        if ((unit.stuckFor ?? 0) > 4) { site.retryAt = state.time + 3; beginReturn(state, unit); }
        return;
    }
    unit.moving = false;
    if (!resourceRoadTileReady(state, unit.faction, target)) {
        unit.order = 'work'; job.roadProgress = (job.roadProgress ?? 0) + dt;
        if (job.roadProgress < RESOURCE_ROAD_TILE_SECONDS) return;
        if (!buildResourceRoadTile(state, unit, target)) { site.retryAt = state.time + 3; beginReturn(state, unit); return; }
    }
    job.roadProgress = 0; job.roadIndex = (job.roadIndex ?? 0) + 1; unit.order = 'hold'; clearPath(unit);
}
function workResource(state: GameState, unit: Unit, site: ResourceWorkSite, dt: number, move: Move): void {
    const job = unit.resourceWork!;
    job.worked = (job.worked ?? 0) + dt;
    if (job.worked + 1e-8 >= RESOURCE_WORK_SECONDS) { beginReturn(state, unit); return; }
    if (metal(site.resource)) { unit.inside = true; unit.moving = false; unit.order = 'hold'; return; }
    unit.inside = false;
    if (site.resource === 'stone') {
        const rock = pointAt(state, southernResourceCell(site.cells, state.world.width)!);
        unit.order = 'work'; unit.moving = false; unit.facing = Math.atan2(rock.y - unit.y, rock.x - unit.x); return;
    }
    // Short, readable tool strokes separated by little walks inside the grove
    // or salt beds. Move through pathfinding; no teleported decorative workers.
    if (state.time < (job.pulseUntil ?? -Infinity)) { unit.order = 'work'; unit.moving = false; return; }
    unit.order = 'hold';
    if (job.workTarget && distance(unit, job.workTarget) > .13) {
        move(state, unit, job.workTarget, dt, false, false, true); return;
    }
    if (job.workTarget) { job.workTarget = undefined; job.pulseUntil = state.time + .65; clearPath(unit); unit.order = 'work'; return; }
    const current = Math.floor(unit.y) * state.world.width + Math.floor(unit.x), candidates = site.cells
        .filter(cell => Math.abs(cell % state.world.width - current % state.world.width)
            + Math.abs(Math.floor(cell / state.world.width) - Math.floor(current / state.world.width)) === 1)
        .map(cell => ({ cell, point: pointAt(state, cell) }))
        .filter(({ point }) => distance(unit, point) < 2.1 && canTraverseEdge(state.world, unit, point)
            && canWalk(state, point.x, point.y, unit.faction, undefined, true)
            && !isForbidden(state, point.x, point.y, unit.faction));
    if (!candidates.length) { unit.order = 'work'; return; }
    candidates.sort((a, b) => a.cell - b.cell);
    const target = candidates[(unit.id + Math.floor((job.worked ?? 0) * 2)) % candidates.length].point;
    job.workTarget = target; clearPath(unit); move(state, unit, target, dt, false, false, true);
}

export function updateResourceWorker(state: GameState, unit: Unit, dt: number, move: Move): void {
    if (!unit.resourceWork || unit.hp <= 0 || state.paused || state.gameOver) return;
    const job = unit.resourceWork;
    if (job.phase === 'returning') { returnHome(state, unit, dt, move); return; }
    const site = currentSite(state, unit);
    if (!site || !site.cells.length) { beginReturn(state, unit); returnHome(state, unit, dt, move); return; }
    // Civilian panic may have walked this worker all the way back into shelter.
    // Its resource shift is abandoned rather than restarted remotely there.
    if (unit.inside && !(job.phase === 'working' && metal(job.resource))) {
        beginReturn(state, unit); unit.inside = true; returnHome(state, unit, dt, move); return;
    }
    if (job.phase === 'road') { roadWork(state, unit, site, dt, move); return; }
    if (job.phase === 'working') { workResource(state, unit, site, dt, move); return; }
    unit.inside = false; unit.order = 'hold';
    // Use the fenced southern approach before entering any resource footprint.
    const goal = distance(unit, job.approach) > .15 && !job.workTarget ? job.approach : job.goal;
    if (goal === job.goal) job.workTarget = { ...job.goal };
    move(state, unit, goal, dt, false, false, true);
    if ((unit.stuckFor ?? 0) > 4) {
        site.retryAt = state.time + RESOURCE_VISIT_INTERVAL;
        beginReturn(state, unit); return;
    }
    if (goal !== job.goal || distance(unit, job.goal) > .15) return;
    clearPath(unit); job.workTarget = undefined; job.phase = 'working'; job.worked = 0;
    job.pulseUntil = state.time + .55; unit.facing = -Math.PI / 2;
    unit.inside = metal(job.resource); unit.order = metal(job.resource) ? 'hold' : 'work';
}
