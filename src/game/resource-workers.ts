import { oreWorkYield } from './ore-native';
import { grantIncome } from './resource-income';
import { territoryValue } from './territory-cells';
import { unitNavigationState } from './unit-navigation';
import { territory, UNCLAIMED } from './borders';
import { constructionEdges } from './builders';
import { civilianWorkforcePopulations, recordCivilianCasualties, workerHomeCity } from './civilian-population';
import { unitPositionBlocked } from './civilian-movement';
import { entityStore } from './entity-store';
import { forbiddenRevision, isForbidden } from './forbidden-zones';
import { canTraverseNavigationEdge, canWalk, findPath, saltWorkNavigationState, withNavigationFrame } from './pathfinding';
import { resourceWorkAccess } from './resource-terrain';
import { canDispatchPeasant } from './peasant-capacity';
import { planResourceRoad, createResourceRoadCursor, resourceRoadOrigins, buildResourceRoadTile, resourceRoadTileReady, type ResourceRoadJourney, type ResourceRoadCursor } from './resource-roads';
import { simulationReadsActive, structureChangeRevision } from './simulation-reads';
import { southernResourceCell } from './resource-worksite';
import { worldRevisions, worldStructureRevision } from './world-revisions';
import { buildingHeight, buildingPresent, buildingReady, buildingWidth, distance, WATER,
    type Building, type GameState, type Point, type ResourceWorkKind, type ResourceWorkSite, type Unit } from './types';

export const RESOURCE_VISIT_INTERVAL = 10;
export const RESOURCE_WORK_SECONDS = 5;
export const RESOURCE_ROAD_TILE_SECONDS = .55;
const kinds = new Set(['copper', 'iron', 'gold', 'stone', 'salt', 'olives']);
const metal = (resource: ResourceWorkKind) => resource === 'copper' || resource === 'iron' || resource === 'gold';
type Move = (state: GameState, unit: Unit, goal: Point, dt: number, direct?: boolean, allowPartial?: boolean, avoidForbidden?: boolean) => void;
interface SitesCache {
    world: GameState['world']; tiles: GameState['world']['tiles']; appearance: number; structure: number; borders: number; buildings: number; factions: string;
    candidates: number[]; sites: Map<number, ResourceWorkSite>; source: GameState['resourceWorkSites'];
}
const caches = new WeakMap<GameState, SitesCache>();
const journeys = new WeakMap<ResourceWorkSite, { state: GameState; key: string; journey: ReturnType<typeof planResourceRoad> }>();
interface PendingDispatch { site: ResourceWorkSite; road: boolean; visit: boolean; key?: string; cities: Building[]; next: number; notBefore: number }
interface DispatchQueue { world: GameState['world']; tiles: GameState['world']['tiles']; store: ReturnType<typeof entityStore>; observedAt: number; jobs: Map<ResourceWorkSite, PendingDispatch>; active?: { job: PendingDispatch; city: Building; revision: number; cursor: ResourceRoadCursor } }
const dispatchQueues = new WeakMap<GameState, DispatchQueue>();
function dispatchQueue(state: GameState): DispatchQueue {
    const store = entityStore(state);
    let queue = dispatchQueues.get(state);
    if (!queue || queue.world !== state.world || queue.tiles !== state.world.tiles || queue.store !== store || state.time < queue.observedAt) {
        queue?.active?.cursor.cancel();
        queue = { world: state.world, tiles: state.world.tiles, store, observedAt: state.time, jobs: new Map() };
        dispatchQueues.set(state, queue);
    }
    queue.observedAt = state.time; return queue;
}
function journeyContext(state: GameState, site: ResourceWorkSite) {
    const populations = civilianWorkforcePopulations(state), cities = resourceRoadOrigins(state, site.faction, site.cells, populations);
    // Counts may grow without changing the origins a route search can use.
    const origins = cities.map(city => `${city.id}:${city.x}:${city.y}`).join(',');
    const relations = state.factions.map(faction => `${faction.id}:${faction.relation}:${Number(faction.defeated)}`).join(',');
    const key = `${site.revision}:${worldStructureRevision(state.world)}:${entityStore(state).buildings.revision}:${structureChangeRevision(state)}:${forbiddenRevision(state, site.faction)}:${territory(state).revision}:${origins}:${relations}`;
    return { populations, cities, key };
}
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
        const t = world.tiles[cell], owner = territoryValue(borders, cell);
        return t.resourceDeveloped && !blocked.has(cell) && !WATER.has(t.terrain) && !t.creek
            && owner !== UNCLAIMED && owners.has(owner);
    }));
    const sites: ResourceWorkSite[] = [];
    let sequence = Math.max(state.nextResourceWorkSiteId ?? 1, ...previous.map(site => site.id + 1));
    for (const start of remaining) {
        const cells = [start], tile = world.tiles[start], faction = territoryValue(borders, start); remaining.delete(start);
        for (let head = 0; head < cells.length; head++) {
            const cell = cells[head], x = cell % world.width, y = Math.floor(cell / world.width);
            for (const [nx, ny] of [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]]) {
                if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
                const next = ny * world.width + nx, t = world.tiles[next];
                if (!remaining.has(next) || territoryValue(borders, next) !== faction || t.resource !== tile.resource
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
    const navigation = resourceWorkAccess(site.resource, 'outbound') ? saltWorkNavigationState(state, site.cells) : state;
    const cell = southernResourceCell(site.cells, state.world.width)!;
    const point = pointAt(state, cell);
    // Rocky deposits are solid. Miners enter from the exterior approach;
    // quarry workers remain there to hammer the exposed face.
    const choices = site.resource === 'stone' || metal(site.resource) ? [approach]
        : [point, ...site.cells.map(cell => pointAt(state, cell)).sort((a, b) => distance(a, approach) - distance(b, approach))];
    return choices.find(goal => canWalk(navigation, goal.x, goal.y, site.faction, undefined, true)
        && (distance(goal, approach) < .12 || findPath(navigation, approach, goal, site.faction, false, undefined, undefined, undefined, false, true).length > 0));
}
function dispatchJourney(state: GameState, site: ResourceWorkSite, road: boolean, journey: ResourceRoadJourney | undefined,
    populations = civilianWorkforcePopulations(state)): boolean {
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
    unit.resourceWork = { site: site.id, revision: site.revision, resource: site.resource, cells: site.cells, phase: road ? 'road' : 'outbound',
        goal, approach: { ...journey.goal }, roadCells: road ? journey.roadCells : undefined, roadIndex: road ? 0 : undefined };
    unit.inside = false;
    entityStore(state).units.add(unit);
    if (road) site.roadWorker = unit.id;
    return true;
}
function dispatch(state: GameState, site: ResourceWorkSite, road: boolean, queued = false): boolean | undefined {
    const { populations, cities, key } = journeyContext(state, site);
    let cached = journeys.get(site);
    if (cached?.state !== state || cached.key !== key) {
        if (queued) {
            const queue = dispatchQueue(state), old = queue.jobs.get(site);
            if (old) { old.road ||= road; old.visit ||= !road; }
            else queue.jobs.set(site, { site, road, visit: !road, cities, next: 0, key, notBefore: state.time });
            return;
        }
        cached = { state, key, journey: planResourceRoad(state, site.faction, site.cells, site.resource) }; journeys.set(site, cached);
    }
    return dispatchJourney(state, site, road, cached.journey, populations);
}

function consumeVisit(state: GameState, site: ResourceWorkSite): void {
    if (state.time + 1e-8 >= site.nextVisitAt)
        site.nextVisitAt += (1 + Math.floor((state.time - site.nextVisitAt + 1e-8) / RESOURCE_VISIT_INTERVAL)) * RESOURCE_VISIT_INTERVAL;
}

/** One bounded search chunk per fast step, rotating sites after each origin. Successful
 * searches use live geometry; a changed topology cannot publish an old failure.
 * Unfinished work is neither a failed route nor a consumed visit. Repeated
 * edits back off an invalidated cohort instead of searching on every frame. */
export function advanceResourceWorkforce(state: GameState): void {
    if (state.paused || state.gameOver) return;
    const queue = dispatchQueue(state);
    const entries = queue.active ? [[queue.active.job.site, queue.active.job] as const] : queue.jobs.entries();
    for (const [site, job] of entries) {
        if (state.time < job.notBefore) continue;
        queue.jobs.delete(site);
        if (caches.get(state)?.sites.get(site.id) !== site || state.factions.find(f => f.id === site.faction)?.defeated) {
            queue.active?.cursor.cancel(); queue.active = undefined; continue;
        }
        const context = journeyContext(state, site);
        if (!queue.active && job.key !== context.key && job.next === 0) { job.key = context.key; job.cities = context.cities; }
        const siteRevision = site.revision;
        let active = queue.active;
        if (active && (active.revision !== siteRevision || !context.cities.includes(active.city))) {
            active.cursor.cancel(); queue.active = active = undefined;
            job.key = undefined; job.cities = []; job.next = 0; job.notBefore = state.time;
            queue.jobs.set(site, job); return;
        }
        const city = active?.city ?? job.cities[job.next];
        if (!active && city && context.cities.includes(city)) {
            active = { job, city, revision: siteRevision, cursor: createResourceRoadCursor(state, city, site.cells, site.resource) };
            queue.active = active;
        }
        const progress = active?.cursor.advance(1024, 64, context.key);
        if (progress && !progress.done) { queue.jobs.set(site, job); return; }
        active?.cursor.cancel(); queue.active = undefined;
        if (progress?.invalidated) {
            queue.jobs.set(site, job); return;
        }
        job.next++;
        const journey = progress?.journey;
        if (journey) {
            // The site list has a slower sensing clock than this queue. Do not
            // dispatch to a deposit captured, removed or built over meanwhile.
            if (reconcileSites(state).sites.get(site.id) !== site) return;
            if (site.revision !== siteRevision) {
                job.key = undefined; job.cities = []; job.next = 0; job.notBefore = state.time;
                queue.jobs.set(site, job); return;
            }
        }
        if (!journey && job.next < job.cities.length) { queue.jobs.set(site, job); return; }
        if (!journey && job.key !== context.key) {
            job.key = undefined; job.cities = []; job.next = 0; job.notBefore = state.time + 3;
            queue.jobs.set(site, job); return;
        }
        journeys.set(site, { state, key: context.key, journey });
        const worker = entityStore(state).units.get(site.roadWorker ?? -1);
        if (job.road && !site.roadComplete && (!worker || worker.hp <= 0 || worker.resourceWork?.phase !== 'road' || worker.faction !== site.faction))
            dispatchJourney(state, site, true, journey, context.populations);
        if (job.visit && state.time + 1e-8 >= site.nextVisitAt) { dispatchJourney(state, site, false, journey, context.populations); consumeVisit(state, site); }
        return;
    }
}

/** Called by development itself, including AI and authenticated multiplayer
 * orders. The first resident appears immediately; walking/building uses time. */
export function onResourceDeveloped(state: GameState, cells: readonly number[], _resource: ResourceWorkKind, faction: number): void {
    const added = new Set(cells), cache = reconcileSites(state, true);
    withNavigationFrame(state, () => {
        for (const site of cache.sites.values()) if (site.faction === faction && site.cells.some(cell => added.has(cell))) {
            const worker = entityStore(state).units.get(site.roadWorker ?? -1);
            if (!site.roadComplete && (!worker || worker.hp <= 0)) dispatch(state, site, true, simulationReadsActive(state));
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
                || roadWorker.faction !== site.faction)) dispatch(state, site, true, simulationReadsActive(state));
            if (state.time + 1e-8 < site.nextVisitAt) continue;
            if (dispatch(state, site, false, simulationReadsActive(state)) !== undefined) consumeVisit(state, site);
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
            const path = findPath(unitNavigationState(state, unit), unit, goal, unit.faction, false, undefined, undefined, undefined, false, true);
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
    const navigation = unitNavigationState(state, unit);
    job.worked = (job.worked ?? 0) + dt;
    if (job.worked + 1e-8 >= RESOURCE_WORK_SECONDS) {
        const gold = oreWorkYield(site.resource, site.cells.length), faction = state.factions.find(f => f.id === site.faction);
        if (gold > 0 && faction) grantIncome(faction, { gold }, state, 'mining');
        beginReturn(state, unit); return;
    }
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
        .filter(({ point }) => distance(unit, point) < 2.1 && canTraverseNavigationEdge(navigation, unit, point)
            && canWalk(navigation, point.x, point.y, unit.faction, undefined, true)
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
