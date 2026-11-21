import { canReleaseRaiderReserve, releaseRaiderReserve, updateRaiderActivity } from './raider-activity';
import { buildingWithId, entityStore } from './entity-store';
import { banditIntensity, banditPopulationCap, banditSpawnDeadline } from './bandit-intensity';
import { setSoldierRole } from './archery';
import { selectTheftPalace, SIEGE_REINFORCEMENT_SECONDS, SIEGE_REINFORCEMENT_SIZE } from './raider-motivations';
import { ensureMarauderLeaders } from './marauder-leaders';
import { buildingReady, buildingWidth, buildingHeight, distance, isSoldier, type Building, type DirectedRaid, type GameState, type MarauderPack, type Point, type RaiderCamp, type Unit } from './types';
import { isRaidObjective, selectRaidTarget } from './raid-targeting';
import { raiderMayAttack } from './raider-aggression';
import { campSpawnTiles, initializeRaiderCamps, updateRaiderCamps, MAX_LIVE_RAIDERS, RAIDER_COLOR, RAIDER_FACTION, raiderCampActive, raiderCampPartySize, raiderCampPopulationCap, raiderCampRefuge } from './raider-camps';
import { marauderBaseStats } from './raider-pressure';
import { MARAUDER_MAX_MORALE } from './battle-morale';
import { chooseRaid, directedFactions, raidArcherFraction, raidDirectorCancel, raidDirectorDefer, raidDirectorLaunched, raidEquipment, raidEra, raidProfile, stepRaidDirector, type RaidCandidate } from './raid-director';
import { constructionEdges } from './builders';
import { hasStaticPathBetween, travelTimeMap, wallBreachingNavigation, withNavigationFrame } from './pathfinding';
import { nearbyBuildings, nearbyUnits } from './spatial';
import { isKeep } from './settlement-upgrades';

const RETRY_SECONDS = 15;
const MAX_ACTIVE_WAVES = 8;
/** A scheduled band that still cannot leave after this many retries is cancelled. */
const MAX_LAUNCH_RETRIES = 3;
/** Defense and loot are counted within this many tiles of each town. */
const CITY_RADIUS = 10;
const DIRECTOR_INTERVAL = 1;
/** Includes the commander. Larger raids add parties, never oversized groups. */
export const MAX_RAIDER_GROUP_SIZE = 30;
export const MAX_RAIDER_WAVE_SIZE = 60;

/** Raider stats follow the target realm's progress era, never its army. */
export function fogRaidProfile(era: number): { hp: number; attack: number; defense: number } {
    const raw = raidProfile(era);
    return marauderBaseStats(raw.hp, raw.attack, raw.defense);
}
/** The opening is melee; the mix reaches 20% archers at era two. */
export const raiderArcherFraction = (era: number): number => raidArcherFraction(era);
function applyRaiderRoles(state: GameState, members: readonly Unit[], era: number): void {
    // Preserve returned veterans' injuries/roles; only fresh recruits switch.
    const desired = Math.floor(members.length * raiderArcherFraction(era));
    let needed = desired - members.filter(unit => unit.kind === 'archer').length;
    for (const unit of [...members].reverse()) if (needed > 0 && !unit.marauderLeader && unit.kind === 'warrior' && unit.bornAt === state.time) {
        setSoldierRole(unit, 'archer'); needed--;
    }
}

/** Migration and new-game setup call this once. Camps stay idle until the raid
 * director schedules a raid; destroyed camp records survive reloads. */
export function initializeFogRaids(state: GameState): void {
    initializeRaiderCamps(state);
    if (!state.fogRaids || !Number.isFinite(state.fogRaids.nextAt) || !Number.isFinite(state.fogRaids.waves))
        state.fogRaids = { nextAt: nextCampRaid(state), waves: 0 };
    ensureMarauderLeaders(state);
}
function nextCampRaid(state: GameState): number {
    return Math.min(Number.MAX_SAFE_INTEGER, ...(state.raiderCamps ?? []).map(camp => raiderCampActive(state, camp)
        ? camp.nextRaidAt : camp.replacementAt ?? Number.MAX_SAFE_INTEGER));
}

interface RaiderPopulation {
    total: number;
    byCamp: Map<number, number>;
    members: Map<number, Unit[]>;
}

function raiderPopulation(state: GameState): RaiderPopulation {
    const camps = new Map((state.marauderPacks ?? []).map(pack => [pack.id, pack.raiderCamp]));
    const population: RaiderPopulation = { total: 0, byCamp: new Map(), members: new Map() };
    for (const unit of state.units) {
        if (unit.hp <= 0 || unit.faction !== RAIDER_FACTION || unit.seaInvasion !== undefined) continue;
        population.total++; // Includes returning bands, destroyed-camp survivors and unassigned raiders.
        if (unit.marauderPack === undefined) continue;
        const members = population.members.get(unit.marauderPack);
        if (members) members.push(unit); else population.members.set(unit.marauderPack, [unit]);
        const camp = camps.get(unit.marauderPack);
        if (camp !== undefined) population.byCamp.set(camp, (population.byCamp.get(camp) ?? 0) + 1);
    }
    return population;
}

function returnedCampMembers(state: GameState, camp: RaiderCamp, population: RaiderPopulation): Unit[][] {
    const groups: Unit[][] = [];
    for (const pack of state.marauderPacks ?? []) {
        if (pack.raiderCamp !== camp.id) continue;
        const current = (population.members.get(pack.id) ?? []).filter(unit => unit.marauderPack === pack.id);
        if (current.some(unit => (unit.stolenGold ?? 0) > 0)) continue;
        const members = current.filter(unit => (unit.inside || pack.returning && distance(unit, pack.home) < 4) && canReleaseRaiderReserve(state, unit));
        const leader = members.find(unit => unit.id === pack.leaderId && unit.marauderLeader);
        const ordinary = members.filter(unit => !unit.marauderLeader);
        if (leader) groups.push([leader, ...ordinary]);
        else if (ordinary.length) groups.push(ordinary);
    }
    return groups;
}

/** Smaller specialist raids may leave most of an old band at camp. Those
 * soldiers remain reusable reserves even after their commander redeploys.
 * Preserve one commander per new party; reinforcements take nonleaders only. */
function takeReturnedMembers(state: GameState, groups: Unit[][], limit: number, commander = true): Unit[] {
    const chosen: Unit[] = [];
    const own = commander ? groups.find(group => group.some(unit => unit.marauderLeader)) : undefined;
    if (own && limit > 0) {
        const leader = own.splice(own.findIndex(unit => unit.marauderLeader), 1)[0];
        if (releaseRaiderReserve(state, leader)) chosen.push(leader);
    }
    for (const group of own ? [own, ...groups.filter(group => group !== own)] : groups) {
        for (let i = 0; i < group.length && chosen.length < limit;) {
            if (group[i].marauderLeader) { i++; continue; }
            const member = group.splice(i, 1)[0];
            if (releaseRaiderReserve(state, member)) chosen.push(member);
        }
        if (chosen.length >= limit) break;
    }
    return chosen;
}
function redeploySurvivor(survivor: Unit, pack: MarauderPack): void {
    survivor.marauderPack = pack.id; survivor.marauderRetreating = false; survivor.order = 'raid'; survivor.routed = false;
    survivor.target = undefined; survivor.destination = undefined; survivor.path = undefined; survivor.pathGoal = undefined; survivor.repathAt = 0;
    survivor.raiderEquipmentMultiplier = raidEquipment(pack.raidEra ?? 0);
}

function spawnCampWave(state: GameState, camp: RaiderCamp, target: Building, raid: DirectedRaid,
    population: RaiderPopulation, returning: Unit[][]): boolean {
    const previous = new Map(returning.flat().map(unit => [unit, { ...unit }]));
    const cancelRelease = (): false => {
        for (const [unit, before] of previous) { Object.assign(unit, before); entityStore(state).setUnitSleeping(unit, !!before.inside); }
        return false;
    };
    // Burned tents shrink what a camp can field.
    let motivation = raid.motive;
    const total = raiderCampPartySize(state, camp, raid.total);
    let initial = Math.min(raid.initial, total);
    if (motivation === 'siege' && total < 10) { motivation = 'assault'; initial = total; }
    const profile = fogRaidProfile(raid.era), equipment = raidEquipment(raid.era);
    const partyCount = Math.ceil(initial / MAX_RAIDER_GROUP_SIZE);
    let available = Math.max(0, Math.min(banditPopulationCap(state, MAX_LIVE_RAIDERS) - population.total,
        raiderCampPopulationCap(state, camp) - (population.byCamp.get(camp.id) ?? 0)));
    state.marauderPacks ??= [];
    const parties: { survivors: Unit[]; recruits: number }[] = [];
    for (let party = 0; party < partyCount; party++) {
        const size = Math.min(MAX_RAIDER_GROUP_SIZE, initial - party * MAX_RAIDER_GROUP_SIZE);
        const survivors = takeReturnedMembers(state, returning, size);
        const recruits = Math.min(size - survivors.length, available);
        if (!survivors.length && !recruits) break;
        parties.push({ survivors, recruits }); available -= recruits;
    }
    const first = parties[0] ? parties[0].survivors.length + parties[0].recruits : 0;
    if (!parties.length || motivation === 'siege' && first < Math.min(10, initial) || motivation === 'harass' && first < 2) return cancelRelease();
    const recruitCount = parties.reduce((sum, party) => sum + party.recruits, 0);
    // Reusing a returned veteran does not require another vacant spawn tile.
    const points = recruitCount ? campSpawnTiles(state, camp, recruitCount) : [];
    if (points.length < recruitCount) return cancelRelease();
    let packId = Math.max(0, ...(state.marauderPacks ?? []).map(pack => pack.id), ...state.units.map(unit => unit.marauderPack ?? 0));
    let pointOffset = 0;
    const spawned: MarauderPack[] = [];
    for (const { survivors, recruits } of parties) {
        const id = ++packId;
        const name = `${camp.name} raiders`;
        const pack: MarauderPack = { id, name, color: RAIDER_COLOR, targetFaction: target.faction, raid: true, raiderCamp: camp.id,
            targetBuilding: target.id, spawnedAt: state.time, directorFaction: raid.faction, raidEra: raid.era, home: raiderCampRefuge(camp),
            waypoint: raid.entrance ?? { x: target.x + buildingWidth(target) / 2, y: target.y + buildingHeight(target) / 2 }, nextWanderAt: state.time,
            motivation, phase: 'approach', raidGoal: raid.entrance,
            musterTarget: motivation === 'siege' ? total : undefined,
            siegeNextReinforceAt: motivation === 'siege' ? banditSpawnDeadline(state, SIEGE_REINFORCEMENT_SECONDS) : undefined,
            leaderId: survivors.find(unit => unit.marauderLeader)?.id, startingTroops: survivors.length + recruits - 1 };
        state.marauderPacks.push(pack); spawned.push(pack);
        for (const survivor of survivors) redeploySurvivor(survivor, pack);
        for (const point of points.slice(pointOffset, pointOffset + recruits)) entityStore(state).units.add({
            id: entityStore(state).allocateId(), ...point, kind: 'warrior', faction: RAIDER_FACTION, marauderPack: id, name,
            hp: profile.hp, maxHp: profile.hp, attack: profile.attack, defense: profile.defense, morale: MARAUDER_MAX_MORALE, speed: 2.35, range: 1.1,
            raiderEquipmentMultiplier: equipment,
            order: 'raid', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0, bornAt: state.time,
        });
        pointOffset += recruits;
    }
    population.total += recruitCount;
    population.byCamp.set(camp.id, (population.byCamp.get(camp.id) ?? 0) + recruitCount);
    ensureMarauderLeaders(state);
    for (const pack of spawned) applyRaiderRoles(state, state.units.filter(unit => unit.hp > 0 && unit.marauderPack === pack.id), raid.era);
    return true;
}

/** Siege reinforcements share every population cap with ordinary raids. A
 * delayed simulation tick produces one batch, never a backlog of missed spawns. */
function reinforceSieges(state: GameState, population: RaiderPopulation): void {
    for (const pack of state.marauderPacks ?? []) {
        if (pack.motivation !== 'siege' || pack.siegeNextReinforceAt === undefined || pack.siegeNextReinforceAt > state.time) continue;
        const camp = state.raiderCamps?.find(camp => camp.id === pack.raiderCamp);
        const members = population.members.get(pack.id) ?? [];
        if (pack.returning || pack.phase === 'attack' || !camp || !raiderCampActive(state, camp) || !members.length) {
            delete pack.siegeNextReinforceAt; continue;
        }
        const wanted = Math.min(MAX_RAIDER_GROUP_SIZE, pack.musterTarget ?? 10);
        const count = Math.max(0, Math.min(SIEGE_REINFORCEMENT_SIZE, wanted - members.length));
        pack.siegeNextReinforceAt = banditSpawnDeadline(state, SIEGE_REINFORCEMENT_SECONDS);
        if (!count) { delete pack.siegeNextReinforceAt; continue; }
        const survivors = takeReturnedMembers(state, returnedCampMembers(state, camp, population), count, false);
        const recruits = Math.max(0, Math.min(count - survivors.length, banditPopulationCap(state, MAX_LIVE_RAIDERS) - population.total,
            raiderCampPopulationCap(state, camp) - (population.byCamp.get(camp.id) ?? 0)));
        const points = recruits ? campSpawnTiles(state, camp, recruits) : [];
        const era = pack.raidEra ?? 0, profile = fogRaidProfile(era), equipment = raidEquipment(era);
        for (const survivor of survivors) { redeploySurvivor(survivor, pack); members.push(survivor); }
        for (const point of points) {
            const recruit: Unit = { id: entityStore(state).allocateId(), ...point, kind: 'warrior', faction: RAIDER_FACTION, marauderPack: pack.id, name: pack.name,
                hp: profile.hp, maxHp: profile.hp, attack: profile.attack, defense: profile.defense, morale: MARAUDER_MAX_MORALE, speed: 2.35, range: 1.1,
                raiderEquipmentMultiplier: equipment,
                order: 'raid', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0, bornAt: state.time };
            entityStore(state).units.add(recruit); members.push(recruit);
        }
        population.members.set(pack.id, members); population.total += points.length;
        population.byCamp.set(camp.id, (population.byCamp.get(camp.id) ?? 0) + points.length);
        pack.startingTroops = Math.max(pack.startingTroops ?? 0, members.length - 1);
        applyRaiderRoles(state, members, era);
        if (members.length >= wanted) delete pack.siegeNextReinforceAt;
    }
}

// ------------------------------------------------------------ raid director
const directorClocks = new WeakMap<GameState, number>();
const center = (building: Building): Point => ({ x: building.x + buildingWidth(building) / 2, y: building.y + buildingHeight(building) / 2 });
const gate = (camp: RaiderCamp): Point => ({ x: camp.gate.x + .5, y: camp.gate.y + .5 });
const DEFENSES = new Set<Building['kind']>(['woodenTower', 'tower', 'guardPost', 'fort', 'ballista', 'siegeCannon']);

interface CityFacts { palace: Building; defense: number; loot: number; keep: boolean }
/** Local defense and loot around one town, from the spatial indexes. */
function cityFacts(state: GameState, faction: number, palace: Building): CityFacts {
    const point = center(palace);
    let defense = isKeep(palace) ? 2 : 0, loot = 1;
    for (const building of nearbyBuildings(state, point, CITY_RADIUS)) {
        if (building.faction !== faction || building.hp <= 0 || !buildingReady(building) || building === palace) continue;
        if (DEFENSES.has(building.kind)) defense += 2;
        else if (building.capacity > 0) loot++;
    }
    for (const unit of nearbyUnits(state, point, CITY_RADIUS))
        if (unit.faction === faction && unit.hp > 0 && !unit.inside && (isSoldier(unit) || unit.kind === 'militia')) defense++;
    return { palace, defense, loot, keep: isKeep(palace) };
}
function nearestPalace(palaces: readonly Building[], building: Building): Building | undefined {
    const point = center(building);
    let best: Building | undefined, bestDistance = Infinity;
    for (const palace of palaces) {
        const d = distance(point, center(palace));
        if (d < bestDistance || d === bestDistance && best && palace.id < best.id) { best = palace; bestDistance = d; }
    }
    return best;
}
function announce(state: GameState, camp: RaiderCamp, raid: DirectedRaid, warning: number): void {
    camp.directedRaid = raid;
    camp.warningSeconds = warning;
    camp.nextRaidAt = state.time + warning;
    if (state.fogRaids) state.fogRaids.nextAt = Math.min(state.fogRaids.nextAt, camp.nextRaidAt);
}
function eligibleCamps(state: GameState, faction: number): RaiderCamp[] {
    return (state.raiderCamps ?? []).filter(camp => !camp.directedRaid && raiderCampActive(state, camp)
        && raiderMayAttack(state, faction, camp.id) && raiderCampPopulationCap(state, camp) > 0);
}

/** Routes eligible camps to each town, lets the director pick the weakest
 * target and raid type, then announces the raid at its camp. */
export function scheduleDirectedRaid(state: GameState, faction: number, budget: number): boolean {
    const store = entityStore(state);
    const palaces = store.buildings.queryFaction('palace', faction).filter(palace => palace.hp > 0 && buildingReady(palace));
    return scheduleRaid(state, faction, budget, palaces, store.units.queryFaction('soldier', faction).length);
}
function scheduleRaid(state: GameState, faction: number, budget: number, palaces: readonly Building[], soldiers: number): boolean {
    if (!palaces.length) return false;
    const camps = eligibleCamps(state, faction);
    if (!camps.length) return false;
    const cities = palaces.map(palace => cityFacts(state, faction, palace));
    const planning = wallBreachingNavigation(state, { kind: 'raider' });
    const candidates: RaidCandidate[] = [];
    withNavigationFrame(planning, () => {
        const destinations = cities.map(city => ({ ...city, exits: constructionEdges(planning, city.palace) }));
        for (const camp of camps) {
            const start = gate(camp);
            const reachable = destinations.filter(city => hasStaticPathBetween(planning, [start], city.exits, RAIDER_FACTION));
            if (!reachable.length) continue;
            const travel = travelTimeMap(planning, start, RAIDER_FACTION, 2.35, Infinity);
            for (const city of reachable) {
                let route = Infinity;
                for (const exit of city.exits)
                    route = Math.min(route, travel[Math.floor(exit.y) * state.world.width + Math.floor(exit.x)]);
                if (Number.isFinite(route))
                    candidates.push({ camp: camp.id, city: city.palace.id, route, defense: city.defense, loot: city.loot, keep: city.keep, waves: camp.waves });
            }
        }
    });
    const gold = state.factions.find(owner => owner.id === faction)?.gold ?? 0;
    const choice = chooseRaid(state, faction, candidates, budget, gold, soldiers);
    if (!choice) return false;
    const row = candidates[choice.index], camp = camps.find(entry => entry.id === row.camp)!, city = palaces.find(palace => palace.id === row.city)!;
    const era = raidEra(state, faction);
    let { motive, initial, total, warning } = choice;
    let target: Building | undefined, entrance: Point | undefined;
    if (motive === 'theft') {
        const theft = selectTheftPalace(state, gate(camp), faction, camp.id);
        if (theft) { target = theft.palace; entrance = theft.entrance; }
        // A closed city turns the theft into an ordinary assault of the full raid.
        else { motive = 'assault'; initial = total = budget; warning = Math.max(warning, 20); }
    }
    target ??= selectRaidTarget(state, gate(camp), undefined, faction, camp.id,
        building => building.faction === faction && (motive === 'harass' || nearestPalace(palaces, building) === city));
    if (!target) return false;
    announce(state, camp, { faction, target: target.id, motive, initial, total, era, entrance }, warning);
    let raiders = total, bands = 1;
    if (choice.bands > 1) {
        // Variety for a realm that keeps winning: a second band harasses from another camp.
        const route = candidates.filter(candidate => candidate.camp !== camp.id)
            .sort((a, b) => a.route - b.route || a.camp - b.camp)[0];
        const flank = route && camps.find(other => other.id === route.camp);
        const flankTarget = flank && selectRaidTarget(state, gate(flank), undefined, faction, flank.id, building => building.faction === faction);
        if (flank && flankTarget) {
            const size = Math.max(2, Math.round(budget * .4));
            announce(state, flank, { faction, target: flankTarget.id, motive: 'harass', initial: size, total: size, era }, warning);
            raiders += size; bands = 2;
        }
    }
    raidDirectorLaunched(state, faction, raiders, motive, bands);
    return true;
}

/** Once per second: advance every realm's cycle and schedule the raids it asks for. */
export function updateRaidDirector(state: GameState): void {
    if (state.time < (directorClocks.get(state) ?? -Infinity)) return;
    directorClocks.set(state, state.time + DIRECTOR_INTERVAL);
    for (const camp of state.raiderCamps ?? []) if (camp.directedRaid && !raiderCampActive(state, camp)) {
        raidDirectorCancel(state, camp.directedRaid.faction, camp.directedRaid.total);
        delete camp.directedRaid; camp.nextRaidAt = Number.MAX_SAFE_INTEGER;
    }
    const live = new Set<number>();
    for (const unit of state.units) if (unit.hp > 0 && unit.marauderPack !== undefined && unit.faction === RAIDER_FACTION) live.add(unit.marauderPack);
    const active = new Map<number, number>();
    const count = (faction: number): void => { active.set(faction, (active.get(faction) ?? 0) + 1); };
    for (const pack of state.marauderPacks ?? []) if (pack.directorFaction !== undefined && pack.seaInvasion === undefined && !pack.returning && live.has(pack.id)) count(pack.directorFaction);
    for (const camp of state.raiderCamps ?? []) if (camp.directedRaid) count(camp.directedRaid.faction);
    for (const invasion of state.seaRaids?.invasions ?? []) if (invasion.stage !== 'collapsed') count(invasion.faction);
    const store = entityStore(state);
    for (const faction of directedFactions(state)) {
        const palaces = store.buildings.queryFaction('palace', faction.id).filter(palace => palace.hp > 0 && buildingReady(palace));
        const soldiers = store.units.queryFaction('soldier', faction.id).length;
        const towers = store.buildings.queryFaction('towerWeapon', faction.id).filter(tower => tower.kind !== 'palace' && buildingReady(tower)).length;
        const techs = Object.values(faction.research?.levels ?? {}).reduce((sum, level) => sum + (level ?? 0), 0);
        const budget = stepRaidDirector(state, faction.id, { techs, population: faction.population, gold: faction.gold,
            soldiers, towers, active: active.get(faction.id) ?? 0, alive: palaces.length > 0 });
        if (budget > 0 && !scheduleRaid(state, faction.id, budget, palaces, soldiers)) raidDirectorDefer(state, faction.id);
    }
}

/** Only real camps produce parties, and only for raids the director announced.
 * Destroyed camps stop immediately; hidden replacements arrive after a respite. */
export function updateFogRaids(state: GameState): void {
    // Isolated simulation fixtures and imported states are initialized explicitly
    // by createGame/migrateGame. Only a recorded destroyed camp can recover.
    if (state.raiderCamps === undefined || state.paused || state.gameOver || state.victory && !state.victoryContinued) return;
    const campsChanged = updateRaiderCamps(state);
    updateRaiderActivity(state);
    state.fogRaids ??= { nextAt: nextCampRaid(state), waves: 0 };
    const clock = state.fogRaids;
    if (!banditIntensity(state)) return;
    updateRaidDirector(state);
    if (campsChanged) clock.nextAt = nextCampRaid(state);
    const reinforcementDue = state.marauderPacks?.some(pack => pack.siegeNextReinforceAt !== undefined && pack.siegeNextReinforceAt <= state.time);
    if (state.time < clock.nextAt && !reinforcementDue) return;
    const living = new Set(state.units.filter(unit => unit.hp > 0).map(unit => unit.marauderPack));
    state.marauderPacks = (state.marauderPacks ?? []).filter(pack => living.has(pack.id));
    const population = raiderPopulation(state);
    reinforceSieges(state, population);
    const activeWaves = new Set(state.marauderPacks.filter(pack => pack.raid && !pack.microRaid && !pack.campDefense && !pack.returning
        && (population.members.get(pack.id) ?? []).some(unit => !unit.inside)).map(pack => `${pack.raiderCamp}:${pack.spawnedAt}`));

    const due = state.raiderCamps.filter(camp => raiderCampActive(state, camp) && camp.nextRaidAt <= state.time).sort((a, b) => a.nextRaidAt - b.nextRaidAt || a.id - b.id);
    for (const camp of due) {
        const raid = camp.directedRaid;
        if (!raid) { camp.nextRaidAt = Number.MAX_SAFE_INTEGER; continue; }
        const cancel = (): void => {
            raidDirectorCancel(state, raid.faction, raid.total);
            delete camp.directedRaid; camp.nextRaidAt = Number.MAX_SAFE_INTEGER;
        };
        const retry = (): void => {
            raid.retries = (raid.retries ?? 0) + 1;
            if (raid.retries > MAX_LAUNCH_RETRIES) cancel(); else camp.nextRaidAt = banditSpawnDeadline(state, RETRY_SECONDS);
        };
        if (!raiderMayAttack(state, raid.faction, camp.id) || !directedFactions(state).some(faction => faction.id === raid.faction)) { cancel(); continue; }
        if (activeWaves.size >= banditPopulationCap(state, MAX_ACTIVE_WAVES)) { retry(); continue; }
        const returning = returnedCampMembers(state, camp, population);
        if ((population.total >= banditPopulationCap(state, MAX_LIVE_RAIDERS) || (population.byCamp.get(camp.id) ?? 0) >= raiderCampPopulationCap(state, camp))
            && !returning.length) { retry(); continue; }
        let target = buildingWithId(state, raid.target, building => building.faction === raid.faction && isRaidObjective(state, building));
        if (!target) {
            // The announced objective fell meanwhile; strike the realm's next one.
            target = selectRaidTarget(state, gate(camp), undefined, raid.faction, camp.id, building => building.faction === raid.faction);
            raid.entrance = undefined;
            if (raid.motive === 'theft') raid.motive = 'assault';
        }
        if (!target) { cancel(); continue; }
        if (!spawnCampWave(state, camp, target, raid, population, returning)) { retry(); continue; }
        delete camp.directedRaid; camp.nextRaidAt = Number.MAX_SAFE_INTEGER;
        camp.waves++; clock.waves++; activeWaves.add(`${camp.id}:${state.time}`);
    }
    // Retired groups whose members joined a new raid must not accumulate.
    const remainingPacks = new Set(state.units.filter(unit => unit.hp > 0).map(unit => unit.marauderPack));
    state.marauderPacks = state.marauderPacks.filter(pack => remainingPacks.has(pack.id));
    clock.nextAt = nextCampRaid(state);
}
