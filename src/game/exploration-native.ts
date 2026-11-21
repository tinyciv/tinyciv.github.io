import { rustEngine } from './rust-engine';
import { recordCampaignPopulation } from './campaign-stats';
import { explorationHost } from './exploration-host';
import { simCore, SimSlot } from './sim-handle';
import { entityStore } from './entity-store';
import { territory } from './borders';
import { territoryValue } from './territory-cells';
import { traversable, terrainNavigationEdges, invalidateNavigation, buildingBlockers } from './pathfinding';
import { settlementTerrainMask } from './terrain-sites';
import { reliefFootprintAllowed } from './relief';
import { forestBlocksConstruction } from './geography';
import { updateFog, revealExplorationCells, invalidateFog } from './fog';
import { playerFaction } from './player-context';
import { constructionEdges } from './builders';
import { RESEARCH_BRANCHES, researchCost, grantExplorationScience, grantExplorationTechnology } from './research';
import { awardLeaderXp, readLeaderProgression } from './leader-progression';
import { grantIncome } from './resource-income';
import { HOUSE_BASE_CAPACITIES } from './housing-config';
import { FIELD_HARVEST_FOOD, FIELD_HARVEST_SECONDS } from './farms';
import { ECONOMY_INTERVAL } from './economy-constants';
import { invalidateSettlementDecisions } from './settlement-decisions';
import { invalidateCitySummarySnapshot } from './cities';
import { markWorldChanged } from './world-revisions';
import { addPalaceRoadRing } from './palace-roads';
import { joinRetinueSquad } from './retinue-squads';
import { setSoldierRole } from './archery';
import { ensureMarauderLeaders } from './marauder-leaders';
import { updateMarauderFormations } from './marauder-formations';
import { sightDistance } from './sight';
import { buildingReady, buildingWidth, buildingHeight, type Faction, type GameState, type Point, type Unit } from './types';
import { EXPLORATION_MESSAGES, explorationSiteSize, FOSSIL_DISCOVERY_OUTCOME, type ExplorationSiteKind } from './exploration-content';

export interface ExplorationSite extends Point {
    id: number; kind: ExplorationSiteKind; status: number; actor: number; outcome: number; variant: number;
}
export { EXPLORATION_MESSAGES, RUINS_OFFER } from './exploration-content';
const initialized = new SimSlot<boolean>();
function input(state: GameState, data: readonly number[]): void {
    const pointer = rustEngine.sim_exploration_input(simCore(state).handle, data.length);
    new Float64Array(rustEngine.memory.buffer, pointer, data.length).set(data);
}
/** Terrain/occupancy observations are imported only at initialization or an
 * encounter, never during the routine three-Hz contact lookup. */
function geometry(state: GameState, actor: number, current?: number): void {
    const { world } = state, n = world.tiles.length, edges = terrainNavigationEdges(world), owners = territory(state);
    const terrain = settlementTerrainMask(world), fog = updateFog(state, actor), occupied = new Set<number>(), solid = buildingBlockers(state, actor);
    for (const b of state.buildings) if (b.hp > 0) {
        for (let dy = 0; dy < buildingHeight(b); dy++) for (let dx = 0; dx < buildingWidth(b); dx++) {
            const cell = (b.y + dy) * world.width + b.x + dx; occupied.add(cell);
        }
    }
    for (const f of state.fields ?? []) occupied.add(f.y * world.width + f.x);
    for (const h of state.hermits ?? []) occupied.add(h.y * world.width + h.x);
    for (const c of state.treasures ?? []) if (!c.collected) occupied.add(c.y * world.width + c.x);
    for (const site of state.explorationSites ?? []) if (site.id !== current && site.status !== 2) {
        const size = explorationSiteSize(site.kind);
        for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) occupied.add((site.y + dy) * world.width + site.x + dx);
    }
    const roots = new Set(entityStore(state).units.query('leader').filter(u => u.hp > 0 && !u.inside && u.embarkedOn === undefined
        && (state.multiplayer?.humanFactionIds ?? [actor]).includes(u.faction)).map(u => Math.floor(u.y) * world.width + Math.floor(u.x)));
    const data = new Array<number>(n * 4);
    world.tiles.forEach((tile, cell) => {
        const x = cell % world.width, y = Math.floor(cell / world.width), walk = traversable(world, x, y);
        const openDesert = tile.terrain === 'desert' && !tile.beach && !tile.creek && !tile.snow && !tile.geothermal && !tile.resource;
        data[cell * 4] = Number(walk && !solid.has(cell)) | Number(walk && tile.overlay === 'none' && !occupied.has(cell)) << 1
            | Number(reliefFootprintAllowed(world, x, y)) << 2 | Number(!forestBlocksConstruction(tile) && (terrain[cell] & 3) === 3) << 3
            | Number(roots.has(cell)) << 4 | Number(walk) << 5 | Number(openDesert) << 6;
        data[cell * 4 + 1] = edges[cell]; data[cell * 4 + 2] = territoryValue(owners, cell); data[cell * 4 + 3] = Number(!!fog.explored[cell]);
    });
    input(state, data); rustEngine.sim_exploration_geometry(simCore(state).handle, world.width, world.height);
}
export function initializeExploration(state: GameState): void {
    if (initialized.get(state)) return;
    const restore = state.explorationSites !== undefined;
    geometry(state, playerFaction(state));
    if (restore) input(state, state.explorationSites!.flatMap(s => [s.id, s.kind, s.x, s.y, s.status, s.actor, s.outcome, s.variant]));
    let seed = 2166136261;
    for (const c of `${state.world.seed}:exploration`) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619);
    const p = rustEngine.sim_exploration_initialize(simCore(state).handle, seed >>> 0, Number(restore));
    const count = new Float64Array(rustEngine.memory.buffer, p, 1)[0], rows = new Float64Array(rustEngine.memory.buffer, p + 8, count * 8).slice();
    state.explorationSites = Array.from({ length: count }, (_, i) => {
        const r = rows.subarray(i * 8, i * 8 + 8);
        return { id: r[0], kind: r[1] as ExplorationSiteKind, x: r[2], y: r[3], status: r[4], actor: r[5], outcome: r[6], variant: r[7] };
    });
    initialized.set(state, true);
}
/** Native grid traversal visits only cells crossed since the prior sample;
 * work is independent of world size and number of exploration sites. */
export function updateExploration(state: GameState): void {
    initializeExploration(state);
    const leaders = entityStore(state).units.query('leader');
    for (const actor of state.multiplayer?.humanFactionIds ?? [playerFaction(state)]) {
        const leader = leaders.find(u => u.faction === actor), faction = state.factions.find(f => f.id === actor);
        if (!leader || !faction || faction.defeated || state.gameOver) continue;
        const flags = Number(leader.hp > 0 && !leader.inside && leader.embarkedOn === undefined);
        const p = rustEngine.sim_exploration_contact(simCore(state).handle, actor, leader.x, leader.y, flags);
        const [id, outcome] = new Float64Array(rustEngine.memory.buffer, p, 2);
        simCore(state).mirrorRandom(state);
        if (id) {
            const site = state.explorationSites!.find(s => s.id === id)!;
            site.actor = actor; site.outcome = outcome; site.status = 1;
        }
        for (const site of state.explorationSites ?? []) if (site.actor === actor && site.status === 1 && site.outcome !== 2 && rustEngine.sim_exploration_reward_due(simCore(state).handle, site.id, state.time))
            resolveExploration(state, site.id, 0, actor);
    }
}
function prepareExplorationReward(state: GameState, id: number, faction: Faction, leader: Unit) {
    const actor = faction.id;
    geometry(state, actor, id);
    const buildings = entityStore(state).buildings.query('palace').filter(buildingReady);
    const capital = buildings.filter(b => b.faction === actor).sort((a, b) => a.id - b.id)[0];
    const fog = updateFog(state, actor), progress = readLeaderProgression(leader);
    const targets: number[] = [];
    for (const b of state.buildings) if (buildingReady(b) && (b.kind === 'palace' || b.raiderCamp !== undefined && b.kind === 'villageTent')) {
        for (const edge of constructionEdges(state, b)) {
            const cell = Math.floor(edge.y) * state.world.width + Math.floor(edge.x);
            targets.push(cell, Number(!!fog.explored[b.y * state.world.width + b.x]), b.raiderCamp !== undefined ? -1 - b.raiderCamp : b.id, Number(b.kind === 'palace' && b.faction === actor));
        }
    }
    const retinue = entityStore(state).units.query('retinue').filter(u => u.faction === actor && u.hp > 0).length;
    const data = [retinue, progress.level, progress.xp, faction.villageBonuses?.research ?? 0, RESEARCH_BRANCHES.length, targets.length / 4,
        capital?.id ?? -1, capital ? capital.y * state.world.width + capital.x : -1, 0, 0, HOUSE_BASE_CAPACITIES[0], FIELD_HARVEST_FOOD * ECONOMY_INTERVAL / FIELD_HARVEST_SECONDS];
    for (const b of RESEARCH_BRANCHES) data.push(researchCost(faction, b.id, state), faction.research?.levels[b.id] ?? 0,
        b.prerequisites.reduce((mask, id) => mask + 2 ** RESEARCH_BRANCHES.findIndex(branch => branch.id === id), 0));
    data.push(...targets); input(state, data);
    return capital;
}
export function resolveExploration(state: GameState, id: number, choice: number, actor = playerFaction(state)): { ok: boolean; message: string } {
    initializeExploration(state);
    const site = state.explorationSites?.find(s => s.id === id), faction = state.factions.find(f => f.id === actor);
    const leader = entityStore(state).units.query('leader').find(u => u.faction === actor);
    if (!site || site.actor !== actor || site.status !== 1 || !faction || faction.defeated || state.gameOver || !leader) return { ok: false, message: 'This discovery is no longer available.' };
    const host = explorationHost();
    const capital = site.outcome === FOSSIL_DISCOVERY_OUTCOME ? undefined : prepareExplorationReward(state, id, faction, leader);
    const p = rustEngine.sim_exploration_reward(simCore(state).handle, id, actor, choice);
    const result = new Float64Array(rustEngine.memory.buffer, p, rustEngine.sim_exploration_length(simCore(state).handle)).slice();
    simCore(state).mirrorRandom(state);
    if (!result[3]) return { ok: false, message: 'There is no safe space for this settlement. Clear nearby ground and try again.' };
    site.status = 2;
    if (choice < 0) return { ok: true, message: '' };
    const [outcome, amount, technology] = result; site.outcome = outcome;
    if (outcome === 0 || outcome === 8) grantIncome(faction, { gold: amount }, state, 'treasure');
    if (outcome === 1) grantExplorationTechnology(state, faction, RESEARCH_BRANCHES[technology].id);
    if (outcome === FOSSIL_DISCOVERY_OUTCOME) grantExplorationScience(state, faction, amount);
    if (outcome === 7) awardLeaderXp(state, amount, actor);
    if (outcome === 6) { faction.rangerCompanions = (faction.rangerCompanions ?? 0) + amount; faction.bonusRetinueSlots = (faction.bonusRetinueSlots ?? 0) + amount; }
    let pack: NonNullable<GameState['marauderPacks']>[number] | undefined;
    const revealed: number[] = [];
    for (let i = 4; i < result.length; i += 4) {
        const [op, x, y, value] = result.subarray(i, i + 4);
        if (op === 1) {
            const town = host.building(state, 'palace', actor, { x, y });
            town.capacity = value; town.unhousedResidents = value; town.settlementUpkeepUntil = state.time + amount;
            faction.population += value;
            recordCampaignPopulation(state, faction);
            addPalaceRoadRing(state, town);
        }
        if (op === 2) host.building(state, 'house', actor, { x, y });
        if (op === 3) host.building(state, 'camp', actor, { x, y });
        if (op === 4) {
            const person = host.unit(state, 'worker', actor, { x, y }, value);
            const goal = result.subarray(result.length - 4); // Native op 8 carries the receiving city's reachable approach.
            person.explorationRefugee = { x: goal[1], y: goal[2], city: value };
        }
        if (op === 5) {
            if (!pack) {
                const packId = Math.max(0, ...(state.marauderPacks ?? []).map(p => p.id)) + 1;
                pack = { id: packId, name: 'Sacred clan', color: '#b4443f', targetFaction: actor, home: { x, y }, waypoint: { ...leader },
                    nextWanderAt: Number.MAX_SAFE_INTEGER, raid: true, motivation: 'assault', phase: 'attack', targetBuilding: capital?.id,
                    spawnedAt: state.time, startingTroops: amount, ruinsAmbush: { leader: leader.id, committed: false } };
                (state.marauderPacks ??= []).push(pack);
            }
            const enemy = host.unit(state, 'warrior', -2, { x, y }); enemy.marauderPack = pack.id; enemy.order = 'raid'; enemy.name = pack.name;
        }
        if (op === 6) revealed.push(x);
        if (op === 7) { const ranger = host.unit(state, 'warrior', actor, { x, y }, capital?.id); makeRanger(ranger); joinRetinueSquad(state, ranger); }
    }
    if (outcome === 3) {
        ensureMarauderLeaders(state);
        updateMarauderFormations(state, (observer, target) => sightDistance(state.world, observer, target.x, target.y, 8) <= 8, true);
    }
    if (outcome === 4) { faction.population += amount; const receiving = entityStore(state).buildings.get(result[result.length - 1]); if (receiving) receiving.unhousedResidents = (receiving.unhousedResidents ?? 0) + amount; recordCampaignPopulation(state, faction); }
    if (revealed.length) revealExplorationCells(state, actor, revealed);
    if (outcome !== 2) state.particles.push({ x: leader.x, y: leader.y, text: EXPLORATION_MESSAGES[outcome], color: '#ffffff',
        kind: 'exploration', life: 12, duration: 12, faction: actor, followUnit: leader.id });
    markWorldChanged(state.world, 'structure');
    if (outcome !== FOSSIL_DISCOVERY_OUTCOME) {
        invalidateNavigation(state); invalidateFog(state); invalidateCitySummarySnapshot(state); invalidateSettlementDecisions(state);
        host.changed(state, actor);
    }
    return { ok: true, message: '' };
}
export function makeRanger(unit: Unit): void {
    setSoldierRole(unit, 'archer'); unit.ranger = true; unit.name = 'Ranger';
    unit.range = rustEngine.exploration_ranger(0, unit.range, 1); unit.speed = rustEngine.exploration_ranger(1, unit.speed, 1);
}
export function needsRanger(state: GameState, faction: number): boolean {
    const entitled = state.factions.find(f => f.id === faction)?.rangerCompanions ?? 0;
    const alive = entityStore(state).units.query('retinue').filter(u => u.faction === faction && u.hp > 0 && u.ranger).length;
    return !!rustEngine.exploration_ranger_recruit(entitled, alive);
}
/** Strategic observations are sampled with the existing pack scheduler. Rust
 * makes the irreversible switch from the discovering Leader to the capital. */
export function updateExplorationAmbush(state: GameState, pack: NonNullable<GameState['marauderPacks']>[number], members: readonly Unit[]): void {
    const ambush = pack.ruinsAmbush!;
    if (!rustEngine.exploration_ambush_active(Number(!!ambush.finished), members.filter(u => u.hp > 0 && !u.routed && u.order !== 'flee').length)) {
        ambush.finished = true; pack.raid = false; pack.waypoint = { ...pack.home }; return;
    }
    const leader = entityStore(state).units.get(ambush.leader);
    const origin = members.find(u => u.hp > 0 && !u.routed && u.order !== 'flee') ?? members[0];
    ambush.committed = !!rustEngine.exploration_ambush_committed(Number(ambush.committed), Number(!!leader && leader.hp > 0),
        Number(!!leader?.routed || leader?.order === 'flee'), leader ? Math.hypot(leader.x - origin.x, leader.y - origin.y) : Infinity);
    const capital = entityStore(state).buildings.get(pack.targetBuilding ?? -1);
    if (ambush.committed && capital && capital.hp > 0) pack.waypoint = { x: capital.x + 1, y: capital.y + 1 };
    else if (!ambush.committed && leader) pack.waypoint = { x: leader.x, y: leader.y };
}
