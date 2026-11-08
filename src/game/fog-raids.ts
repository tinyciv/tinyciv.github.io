import { canReleaseRaiderReserve, releaseRaiderReserve, updateRaiderActivity } from './raider-activity';
import { entityStore } from './entity-store';
import { banditIntensity, banditPopulationCap, banditSpawnDelay, banditSpawnDeadline } from './bandit-intensity';
import { isSoldier, buildingWidth, buildingHeight, type MarauderPack, type Point } from './types';
import { setSoldierRole } from './archery';
import { raiderMotivationForWave, raiderMotivationSize, selectTheftPalace, SIEGE_REINFORCEMENT_SECONDS, SIEGE_REINFORCEMENT_SIZE, type RaiderMotivation } from './raider-motivations';
import { ensureMarauderLeaders } from './marauder-leaders';
import { distance, type Building, type GameState, type RaiderCamp, type Unit } from './types';
import { selectRaidTarget } from './raid-targeting';
import { campSpawnTiles, initializeRaiderCamps, updateRaiderCamps, MAX_LIVE_RAIDERS, RAIDER_COLOR, RAIDER_FACTION, RAIDER_FIRST_WAVE, raiderCampActive, raiderCampPartySize, raiderCampPopulationCap, raiderCampRefuge } from './raider-camps';
import { marauderBaseStats, raiderEquipmentMultiplier, raiderWaveInterval, updateRaiderEquipment, raiderPartySize } from './raider-pressure';
import { updateRaiderCampPressure } from './raider-camp-pressure';

const PRESSURE_VERSION = 2;
const RETRY_SECONDS = 15;
const MAX_ACTIVE_WAVES = 8;
/** Includes the commander. Later waves add parties, never oversized groups. */
export const MAX_RAIDER_GROUP_SIZE = 30;
export const MAX_RAIDER_WAVE_SIZE = 60;
export const raiderGroupSize = (elapsedSeconds: number): number => raiderPartySize(MAX_RAIDER_GROUP_SIZE, elapsedSeconds);

/** Pressure grows through the opening, then approaches two full parties.
 * Neither elapsed time nor an enormous defending army can grow waves forever. */
function baseFogRaidProfile(retinue: number, elapsedSeconds = 0): { total: number; hp: number; attack: number; defense: number } {
    const strength = Math.min(60, Math.max(0, Math.floor(Number.isFinite(retinue) ? retinue : 0)));
    const elapsed = Math.max(0, Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0);
    const ramp = Math.max(0, Math.min(1, (elapsed - RAIDER_FIRST_WAVE) / 240));
    const continuingGrowth = Math.floor(Math.max(0, elapsed - 300) / 60);
    const total = Math.min(MAX_RAIDER_WAVE_SIZE, 2 * (2 + Math.round(16 * ramp) + Math.floor(strength / 6 * ramp) + continuingGrowth));
    return { total, ...marauderBaseStats(Math.round(40 + 40 * ramp + Math.min(20, strength) * ramp),
        6 + Math.round(8 * ramp) + Math.floor(strength / 8 * ramp), Math.floor(2 * ramp)) };
}
export function fogRaidProfile(retinue: number, elapsedSeconds = 0): { total: number; parties: number; hp: number; attack: number; defense: number } {
    const profile = baseFogRaidProfile(retinue, elapsedSeconds), total = raiderPartySize(profile.total, elapsedSeconds);
    return { ...profile, total, parties: Math.ceil(total / raiderGroupSize(elapsedSeconds)) };
}

/** The opening is melee; the mix reaches 20% archers at twelve minutes. */
export function raiderArcherFraction(elapsed: number): number {
    return .2 * Math.min(1, Math.max(0, (elapsed - 120) / 600));
}
function applyRaiderRoles(state: GameState, members: readonly Unit[]): void {
    // Preserve returned veterans' injuries/roles; only fresh recruits switch.
    const desired = Math.floor(members.length * raiderArcherFraction(state.time));
    let needed = desired - members.filter(unit => unit.kind === 'archer').length;
    for (const unit of [...members].reverse()) if (needed > 0 && !unit.marauderLeader && unit.kind === 'warrior' && unit.bornAt === state.time) {
        setSoldierRole(unit, 'archer'); needed--;
    }
}

/** Migration and new-game setup call this once; destroyed camp records and
 * saved schedules survive reloads. The optional grace applies only to new camps. */
export function initializeFogRaids(state: GameState, graceSeconds = RAIDER_FIRST_WAVE): void {
    const hadCamps = state.raiderCamps !== undefined;
    initializeRaiderCamps(state);
    if (!hadCamps) {
        const grace = Math.max(RAIDER_FIRST_WAVE, graceSeconds);
        for (const camp of state.raiderCamps!) camp.nextRaidAt += banditSpawnDelay(state, grace - RAIDER_FIRST_WAVE);
        state.fogRaids = { nextAt: nextCampRaid(state), waves: 0, pressureVersion: PRESSURE_VERSION };
    } else if (!state.fogRaids || !Number.isFinite(state.fogRaids.nextAt) || !Number.isFinite(state.fogRaids.waves)) {
        state.fogRaids = { nextAt: nextCampRaid(state), waves: 0, pressureVersion: PRESSURE_VERSION };
    } else state.fogRaids.pressureVersion = PRESSURE_VERSION;
    ensureMarauderLeaders(state);
    updateRaiderEquipment(state);
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
        if (unit.hp <= 0 || unit.faction !== RAIDER_FACTION) continue;
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

/** Smaller specialist waves may leave most of an old band at camp. Those
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
}

function spawnCampWave(state: GameState, camp: RaiderCamp, target: Building, retinue: number,
    population: RaiderPopulation, returning: Unit[][], motivation: RaiderMotivation, entrance?: Point): boolean {
    const previous = new Map(returning.flat().map(unit => [unit, { ...unit }]));
    const cancelRelease = (): false => {
        for (const [unit, before] of previous) { Object.assign(unit, before); entityStore(state).setUnitSleeping(unit, !!before.inside); }
        return false;
    };
    // Plan the specialist role before reducing its size, so harassment/theft
    // and siege minimums cannot bypass the opening reduction or apply it twice.
    const profile = baseFogRaidProfile(retinue, state.time);
    const supplyTotal = raiderCampPartySize(state, camp, profile.total);
    if ((supplyTotal < 10 && motivation === 'siege') || (supplyTotal < 2 && motivation === 'harass')) motivation = 'assault';
    const sizePlan = raiderMotivationSize(motivation, supplyTotal, retinue);
    sizePlan.initial = raiderPartySize(Math.min(sizePlan.initial, supplyTotal), state.time);
    sizePlan.total = raiderPartySize(Math.min(sizePlan.total, supplyTotal), state.time);
    const partySize = raiderGroupSize(state.time), partyCount = Math.ceil(sizePlan.initial / partySize);
    let available = Math.max(0, Math.min(banditPopulationCap(state, MAX_LIVE_RAIDERS) - population.total,
        raiderCampPopulationCap(state, camp) - (population.byCamp.get(camp.id) ?? 0)));
    state.marauderPacks ??= [];
    const parties: { survivors: Unit[]; recruits: number }[] = [];
    for (let party = 0; party < partyCount; party++) {
        const size = Math.min(partySize, sizePlan.initial - party * partySize);
        const survivors = takeReturnedMembers(state, returning, size);
        const recruits = Math.min(size - survivors.length, available);
        if (!survivors.length && !recruits) break;
        parties.push({ survivors, recruits }); available -= recruits;
    }
    if (!parties.length || motivation === 'siege' && parties[0].survivors.length + parties[0].recruits < raiderPartySize(10, state.time)
        || motivation === 'harass' && parties[0].survivors.length + parties[0].recruits < raiderPartySize(2, state.time)) return cancelRelease();
    const recruitCount = parties.reduce((total, party) => total + party.recruits, 0);
    // Reusing a returned veteran does not require another vacant spawn tile.
    const points = recruitCount ? campSpawnTiles(state, camp, recruitCount) : [];
    if (points.length < recruitCount) return cancelRelease();
    let unitId = Math.max(0, ...state.units.map(unit => unit.id), ...state.buildings.map(building => building.id));
    let packId = Math.max(0, ...(state.marauderPacks ?? []).map(pack => pack.id), ...state.units.map(unit => unit.marauderPack ?? 0));
    let pointOffset = 0;
    const spawned: MarauderPack[] = [];
    for (const { survivors, recruits } of parties) {
        const id = ++packId;
        const name = `${camp.name} raiders`;
        const pack: MarauderPack = { id, name, color: RAIDER_COLOR, targetFaction: target.faction, raid: true, raiderCamp: camp.id,
            targetBuilding: target.id, spawnedAt: state.time, retinueAtSpawn: retinue, home: raiderCampRefuge(camp),
            waypoint: entrance ?? { x: target.x + buildingWidth(target) / 2, y: target.y + buildingHeight(target) / 2 }, nextWanderAt: state.time,
            motivation, phase: 'approach', raidGoal: entrance,
            musterTarget: motivation === 'siege' ? sizePlan.total : undefined,
            siegeNextReinforceAt: motivation === 'siege' ? banditSpawnDeadline(state, SIEGE_REINFORCEMENT_SECONDS) : undefined,
            leaderId: survivors.find(unit => unit.marauderLeader)?.id, startingTroops: survivors.length + recruits - 1 };
        state.marauderPacks.push(pack); spawned.push(pack);
        for (const survivor of survivors) redeploySurvivor(survivor, pack);
        for (const point of points.slice(pointOffset, pointOffset + recruits)) entityStore(state).units.add({
            id: ++unitId, ...point, kind: 'warrior', faction: RAIDER_FACTION, marauderPack: id, name,
            hp: profile.hp, maxHp: profile.hp, attack: profile.attack, defense: profile.defense, morale: 100, speed: 2.35, range: 1.1,
            raiderEquipmentMultiplier: raiderEquipmentMultiplier(state.time),
            order: 'raid', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0, bornAt: state.time,
        });
        pointOffset += recruits;
    }
    population.total += recruitCount;
    population.byCamp.set(camp.id, (population.byCamp.get(camp.id) ?? 0) + recruitCount);
    ensureMarauderLeaders(state);
    for (const pack of spawned) applyRaiderRoles(state, state.units.filter(unit => unit.hp > 0 && unit.marauderPack === pack.id));
    return true;
}

/** Siege reinforcements share every population cap with ordinary waves. A
 * delayed simulation tick produces one batch, never a backlog of missed spawns. */
function reinforceSieges(state: GameState, population: RaiderPopulation): void {
    for (const pack of state.marauderPacks ?? []) {
        if (pack.motivation !== 'siege' || pack.siegeNextReinforceAt === undefined || pack.siegeNextReinforceAt > state.time) continue;
        const camp = state.raiderCamps?.find(camp => camp.id === pack.raiderCamp);
        const members = population.members.get(pack.id) ?? [];
        if (pack.returning || pack.phase === 'attack' || !camp || !raiderCampActive(state, camp) || !members.length) {
            delete pack.siegeNextReinforceAt; continue;
        }
        const spawnedAt = pack.spawnedAt ?? state.time;
        const wanted = Math.min(raiderGroupSize(spawnedAt), pack.musterTarget ?? raiderPartySize(10, spawnedAt));
        const count = Math.max(0, Math.min(raiderPartySize(SIEGE_REINFORCEMENT_SIZE, spawnedAt), wanted - members.length));
        pack.siegeNextReinforceAt = banditSpawnDeadline(state, SIEGE_REINFORCEMENT_SECONDS);
        if (!count) { delete pack.siegeNextReinforceAt; continue; }
        const survivors = takeReturnedMembers(state, returnedCampMembers(state, camp, population), count, false);
        const recruits = Math.max(0, Math.min(count - survivors.length, banditPopulationCap(state, MAX_LIVE_RAIDERS) - population.total,
            raiderCampPopulationCap(state, camp) - (population.byCamp.get(camp.id) ?? 0)));
        const points = recruits ? campSpawnTiles(state, camp, recruits) : [];
        const profile = fogRaidProfile(pack.retinueAtSpawn ?? 0, pack.spawnedAt ?? state.time);
        for (const survivor of survivors) { redeploySurvivor(survivor, pack); members.push(survivor); }
        let id = Math.max(0, ...state.units.map(unit => unit.id), ...state.buildings.map(building => building.id));
        for (const point of points) {
            const recruit: Unit = { id: ++id, ...point, kind: 'warrior', faction: RAIDER_FACTION, marauderPack: pack.id, name: pack.name,
                hp: profile.hp, maxHp: profile.hp, attack: profile.attack, defense: profile.defense, morale: 100, speed: 2.35, range: 1.1,
                raiderEquipmentMultiplier: raiderEquipmentMultiplier(state.time),
                order: 'raid', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0, bornAt: state.time };
            entityStore(state).units.add(recruit); members.push(recruit);
        }
        population.members.set(pack.id, members); population.total += points.length;
        population.byCamp.set(camp.id, (population.byCamp.get(camp.id) ?? 0) + points.length);
        pack.startingTroops = Math.max(pack.startingTroops ?? 0, members.length - 1);
        applyRaiderRoles(state, members);
        if (members.length >= wanted) delete pack.siegeNextReinforceAt;
    }
}

/** Only real camps produce parties. Destroyed camps stop immediately; hidden
 * replacements arrive after a respite, with the ordinary first-wave warning. */
export function updateFogRaids(state: GameState): void {
    // Isolated simulation fixtures and imported states are initialized explicitly
    // by createGame/migrateGame. Only a recorded destroyed camp can recover.
    if (state.raiderCamps === undefined || state.paused || state.gameOver || state.victory && !state.victoryContinued) return;
    updateRaiderEquipment(state);
    const campsChanged = updateRaiderCamps(state);
    updateRaiderActivity(state);
    state.fogRaids ??= { nextAt: nextCampRaid(state), waves: 0, pressureVersion: PRESSURE_VERSION };
    const clock = state.fogRaids;
    if (!banditIntensity(state)) return;
    if (updateRaiderCampPressure(state) || campsChanged) clock.nextAt = nextCampRaid(state);
    const reinforcementDue = state.marauderPacks?.some(pack => pack.siegeNextReinforceAt !== undefined && pack.siegeNextReinforceAt <= state.time);
    if (state.time < clock.nextAt && !reinforcementDue) return;
    const living = state.units.filter(unit => unit.hp > 0);
    const livePacks = new Set(living.map(unit => unit.marauderPack));
    state.marauderPacks = (state.marauderPacks ?? []).filter(pack => livePacks.has(pack.id));
    const population = raiderPopulation(state);
    reinforceSieges(state, population);
    const activeWaves = new Set(state.marauderPacks.filter(pack => pack.raid && !pack.microRaid && !pack.campDefense && !pack.returning
        && (population.members.get(pack.id) ?? []).some(unit => !unit.inside)).map(pack => `${pack.raiderCamp}:${pack.spawnedAt}`));

    const due = state.raiderCamps.filter(camp => raiderCampActive(state, camp) && camp.nextRaidAt <= state.time).sort((a, b) => a.nextRaidAt - b.nextRaidAt || a.id - b.id);
    const interval = banditSpawnDelay(state, Math.max(1, state.raiderCamps.length) * raiderWaveInterval(state.time));
    for (const camp of due) {
        if (activeWaves.size >= banditPopulationCap(state, MAX_ACTIVE_WAVES)) { camp.nextRaidAt = banditSpawnDeadline(state, RETRY_SECONDS); continue; }
        const returning = returnedCampMembers(state, camp, population);
        if ((population.total >= banditPopulationCap(state, MAX_LIVE_RAIDERS) || (population.byCamp.get(camp.id) ?? 0) >= raiderCampPopulationCap(state, camp))
            && !returning.length) {
            // At saturation, do not rebuild continent-wide target paths merely
            // to discover that no new soldiers are allowed to leave the camp.
            camp.nextRaidAt = banditSpawnDeadline(state, RETRY_SECONDS); continue;
        }
        const previous = [...state.marauderPacks].reverse().find(pack => pack.raiderCamp === camp.id);
        const origin = { x: camp.gate.x + .5, y: camp.gate.y + .5 };
        let motivation = raiderMotivationForWave(camp.waves);
        const theft = motivation === 'theft' ? selectTheftPalace(state, origin) : undefined;
        // Closed cities turn an attempted theft into a regular assault instead
        // of emitting thieves who could never reach their objective.
        if (motivation === 'theft' && !theft) motivation = 'assault';
        const target = theft?.palace ?? selectRaidTarget(state, origin, undefined, previous?.targetFaction);
        const retinue = living.filter(unit => unit.faction === target?.faction && isSoldier(unit)).length;
        if (!target || !spawnCampWave(state, camp, target, retinue, population, returning, motivation, theft?.entrance)) { camp.nextRaidAt = banditSpawnDeadline(state, RETRY_SECONDS); continue; }
        camp.waves++; clock.waves++; activeWaves.add(`${camp.id}:${state.time}`);
        camp.nextRaidAt = state.time + interval;
    }
    // Retired groups whose members joined a new wave must not accumulate.
    const remainingPacks = new Set(state.units.filter(unit => unit.hp > 0).map(unit => unit.marauderPack));
    state.marauderPacks = state.marauderPacks.filter(pack => remainingPacks.has(pack.id));
    clock.nextAt = nextCampRaid(state);
}
