import { BUILDING_KIND_CODES, entityStore } from './entity-store';
import { simCore, SimSlot } from './sim-handle';
import { rustEngine } from './rust-engine';
import { territory } from './borders';
import { territoryValue } from './territory-cells';
import { worldRevisions, markWorldChanged } from './world-revisions';
import { terrainNavigationEdges, traversable, invalidateNavigation, friendlyGateAccess } from './pathfinding';
import { pointInSight, updateFog, invalidateFog } from './fog';
import { cityResidents, invalidateCitySummarySnapshot } from './cities';
import { villageRelationView, settlements } from './settlement-bridge';
import { hermitPosition } from './hermits';
import { questGiverPosition, questMarkerRevealed, questIncompleteMessage } from './quest-presentation';
import { playerFaction } from './player-context';
import { grantIncome, recordIncome } from './resource-income';
import { recordGoldInput } from './gold-ledger';
import { updateWallStats } from './wall-stats';
import { houseCapacity } from './wells';
import { updateConstructionResearch } from './structures';
import { settlementBuildings } from './settlement-rosters';
import { logEvent } from './simulation';
import type { QuestKind, QuestView } from './quest-types';
import { buildingReady, buildingWidth, buildingHeight, type GameState, type Point } from './types';
interface Transport {
    geometry: number;
    borders: number;
    world: GameState['world'];
}
const transports = new SimSlot<Transport>();
const HEADER = 23;
function input(state: GameState, values: readonly number[]): void {
    const pointer = rustEngine.sim_quests_input(simCore(state).handle, values.length);
    new Float64Array(rustEngine.memory.buffer, pointer, values.length).set(values);
}
function readViews(state: GameState, pointer: number): void {
    const count = new Float64Array(rustEngine.memory.buffer, pointer, 1)[0];
    let offset = pointer + 8;
    const views: QuestView[] = [];
    for (let i = 0; i < count; i++) {
        const r = new Float64Array(rustEngine.memory.buffer, offset, HEADER).slice();
        offset += HEADER * 8;
        const area = Array.from(new Float64Array(rustEngine.memory.buffer, offset, r[22]));
        offset += r[22] * 8;
        views.push({ actor: r[0], kind: r[1] as QuestKind, state: r[2], giverKind: r[3], giver: r[4], village: r[5], giverFaction: r[6],
            gx: r[7], gy: r[8], discovered: !!r[9], x: r[10], y: r[11], radius: r[12], target: r[13], progress: r[14], needed: r[15], reason: r[16], land: r[17],
            gold: r[18], food: r[19], relations: r[20], benefits: r[21], area });
    }
    const previous = new Map((state.quests ?? []).map(q => [`${q.actor}:${q.kind}`, q]));
    for (const q of views)
        if (q.state === 4 && previous.get(`${q.actor}:${q.kind}`)?.state !== 4)
            logEvent(state, `Quest failed: ${QUEST_TITLES[q.kind]}.`, 'warning');
    if (views.some(q => q.state === 4 && previous.get(`${q.actor}:${q.kind}`)?.state !== 4))
        invalidateNavigation(state);
    state.quests = views;
    state.questsRevision = (state.questsRevision ?? 0) + 1;
}
export const QUEST_TITLES = ['Eyes on the Frontier', 'A Road to Solitude', 'Silence the Raiders', 'Beyond the Horizon',
    'Shelter Behind Timber', 'A Neighboring Hearth', 'Fields by the River', 'Forty Hearths Overseas'] as const;
/** Host observation transport. Targets and progress are never computed here. */
export function updateQuests(state: GameState, force = false): void {
    const handle = simCore(state).handle;
    if (!force && !rustEngine.sim_quests_due(handle, state.time))
        return;
    const borders = territory(state), geometry = worldRevisions(state.world).geometry, cached = transports.get(state);
    if (!cached || cached.world !== state.world || cached.geometry !== geometry || cached.borders !== borders.revision) {
        const edges = terrainNavigationEdges(state.world), data: number[] = [];
        state.world.tiles.forEach((tile, i) => data.push(tile.terrain === 'river' ? 1 : tile.terrain === 'lake' ? 2
            : tile.terrain === 'ocean' || tile.terrain === 'coast' ? 3 : 0, Number(traversable(state.world, i % state.world.width, Math.floor(i / state.world.width))), edges[i], territoryValue(borders, i)));
        input(state, data);
        rustEngine.sim_quests_geometry(handle, state.world.width, state.world.height);
        transports.set(state, { world: state.world, geometry, borders: borders.revision });
    }
    const humans = state.multiplayer?.humanFactionIds ?? [0];
    const fogs = humans.map(actor => ({ actor, fog: updateFog(state, actor) }));
    const seen = (x: number, y: number) => fogs.reduce((mask, { actor, fog }) => mask | (pointInSight(fog, x, y) ? 1 << actor : 0), 0);
    const residents = new Map(cityResidents(state).map(city => [city.palace.id, city.population]));
    const store = entityStore(state), buildings = state.buildings.filter(b => b.hp > 0), fields = state.fields ?? [];
    const posts = state.units.filter(u => u.hp > 0 && u.observationPost), leaders = store.units.query('leader');
    const combatants = state.units.filter(u => u.hp > 0 && !u.inside && u.attack > 0 && u.embarkedOn === undefined);
    const villages = (state.villages ?? []).filter(v => !v.destroyed && store.buildings.get(v.campId)?.hp! > 0);
    const hermits = state.hermits ?? [];
    const data: number[] = [state.time, store.peekId(), humans.length, villages.length, hermits.length, buildings.length, fields.length, posts.length, leaders.length, combatants.length];
    for (const actor of humans) {
        const f = state.factions.find(f => f.id === actor);
        data.push(actor, Number((f?.research?.levels.scoutLodge ?? 0) > 0) | Number((f?.research?.levels.sailing ?? 0) > 0) << 1, Number(!f || f.defeated));
    }
    for (const v of villages) {
        const camp = store.buildings.get(v.campId)!;
        const existing = (state.quests ?? []).find(q => q.village === v.id && q.giverKind === 1);
        const unit = existing ? store.units.get(existing.giver) : state.units.find(u => u.villageId === v.id && u.hp > 0 && u.kind === 'worker');
        const hostile = humans.reduce((mask, actor) => mask | (villageRelationView(state, v, actor) === 'war' ? 1 << actor : 0), 0);
        const cx=camp.x+buildingWidth(camp)/2,cy=camp.y+buildingHeight(camp)/2;
        data.push(v.id, v.faction, camp.id, unit?.id ?? -1, cx, cy, unit?.x ?? camp.x, unit?.y ?? camp.y, seen(cx,cy), unit ? seen(unit.x, unit.y) : 0, hostile, state.factions.reduce((mask, f) => mask | (friendlyGateAccess(state, v.faction, f.id) ? 1 << f.id : 0), 0));
    }
    for (const h of hermits) {
        const p = hermitPosition(h);
        data.push(h.id, p.x, p.y, Number(h.status === 'home'), seen(p.x, p.y));
    }
    for (const b of buildings)
        data.push(b.id, BUILDING_KIND_CODES[b.kind], b.faction, b.x, b.y, Number(buildingReady(b)), b.raiderCamp ?? -1,
            residents.get(b.id) ?? 0, b.villageId ?? -1, seen(b.x + .5, b.y + .5), b.roadBuildGold ?? 0);
    for (const f of fields)
        data.push(f.id, f.camp, f.faction, f.x, f.y);
    for (const u of posts)
        data.push(u.id, u.faction, u.x, u.y, Number(!u.observationPost!.retreating));
    for (const u of leaders)
        data.push(u.faction, u.x, u.y, u.hp, Number(!!u.inside), Number(u.embarkedOn !== undefined), 0);
    for (const u of combatants)
        data.push(u.faction, u.x, u.y);
    input(state, data);
    readViews(state, rustEngine.sim_quests_sync(handle));
}
export function performQuestAction(state: GameState, kind: QuestKind, action: 'accept' | 'complete'): {
    ok: boolean;
    message: string;
    questAction?: QuestKind;
} {
    updateQuests(state, true);
    const actor = playerFaction(state), handle = simCore(state).handle;
    const pointer = rustEngine.sim_quests_command(handle, actor, kind, action === 'accept' ? 1 : 2);
    const header = new Float64Array(rustEngine.memory.buffer, pointer, 8).slice();
    const gifts = new Float64Array(rustEngine.memory.buffer, pointer + 64, header[7] * 4).slice();
    if (header[0])
        return { ok: false, message: ['', 'This request is no longer available.', 'Bring your Leader ashore within 4 tiles of the giver.',
            questIncompleteMessage(state.quests?.find(q => q.actor === actor && q.kind === kind)),
            'There is no unvisited continent left.', 'The quest giver is no longer available.'][header[0]]
            ?? 'The quest could not be updated. Reopen it and try again.' };
    if (action === 'complete') {
        const faction = state.factions.find(f => f.id === actor)!;
        faction.questBenefits = (faction.questBenefits ?? 0) | header[4];
        for (const house of settlementBuildings(state).housesByFaction.get(actor) ?? [])
            if (house.faction === actor && buildingReady(house)) house.capacity = houseCapacity(house, faction, state);
        updateConstructionResearch(state, true);
        if (kind === 1) {
            // Repay construction in gold at the quoted amount.
            faction.gold += header[1];
            recordGoldInput(state, faction, header[1], 'other');
            recordIncome(faction, { gold: header[1] });
        } else grantIncome(faction, { gold: header[1], food: header[2] }, state);
        if (header[6] >= 0 && header[3] > 0)
            settlements(state).questReward(header[6], actor, header[3]);
        const store = entityStore(state);
        for (let i = 0; i < gifts.length; i += 4) {
            const [table, id, owner, village] = gifts.slice(i, i + 4);
            if (table === 0) {
                const b = store.buildings.get(id);
                if (b) {
                    b.faction = owner;
                    if (village >= 0)
                        b.villageId = village;
                    store.buildings.updateRoles(b);
                }
            }
            if (table === 1) {
                const f = state.fields?.find(f => f.id === id);
                if (f) {
                    f.faction = owner;
                    state.world.tiles[f.y * state.world.width + f.x].farm = owner;
                }
            }
            if (table === 2) {
                const u = store.units.get(id);
                if (u?.observationPost) {
                    u.faction = owner;
                    u.observationPost.questVillage = village;
                    if (!u.observationPost.discoveredBy.includes(actor))
                        u.observationPost.discoveredBy.push(actor);
                    store.units.updateRoles(u);
                }
            }
        }
        state.farmVersion = (state.farmVersion ?? 0) + 1;
        markWorldChanged(state.world, 'structure');
        invalidateNavigation(state);
        invalidateFog(state);
        invalidateCitySummarySnapshot(state);
        updateWallStats(state);
        logEvent(state, `Quest completed: ${QUEST_TITLES[kind]}. +${header[1]} gold${header[2] ? `, +${header[2]} food` : ''}.`, 'good');
    }
    updateQuests(state, true);
    invalidateNavigation(state);
    return { ok: true, message: action === 'accept' ? 'Quest accepted.' : 'Reward received.', questAction: kind };
}
export function recordQuestDestruction(state: GameState, id: number, actor: number): void { rustEngine.sim_quests_death(simCore(state).handle, id, actor); }
export function questGiverAt(state: GameState, point: Point): QuestView | undefined {
    const fog = updateFog(state);
    let closest: QuestView | undefined, distance = Infinity;
    for (const q of state.quests ?? []) {
        if (q.actor !== playerFaction(state) || !q.discovered || q.state >= 3) continue;
        const giver = questGiverPosition(state, q);
        if (!giver || !questMarkerRevealed(fog, giver)) continue;
        const d = Math.hypot(giver.x - point.x, giver.y - point.y);
        if ((d < 1.05 || Math.abs(giver.x - point.x) < .6 && point.y < giver.y && point.y > giver.y - 1.8) && d < distance) {
            closest = q; distance = d;
        }
    }
    return closest;
}
