import { entityStore } from './entity-store';
import { simulationReadsActive } from './simulation-reads';
import { isRetinueMember, type GameState, type RetinueSquad, type Unit } from './types';

export const RETINUE_SQUAD_SIZE = 3;
const eligible = (unit: Unit): boolean => isRetinueMember(unit) && unit.faction >= 0 && unit.marauderPack === undefined;
interface SquadIndex {
    roster: readonly Unit[]; squads: RetinueSquad[];
    byId: Map<number, RetinueSquad>; members: Map<number, Unit[]>;
    dirty: boolean; trusted: boolean;
}
const indexes = new WeakMap<GameState, SquadIndex>();
/** Death and ownership changes are the only live changes to established squad
 * membership besides entity/role changes, which replace the ECS roster view. */
export function invalidateRetinueSquads(state: GameState): void {
    const index = indexes.get(state);
    if (index) index.dirty = true;
}

/** Preserve squad identities, including wounded and temporarily hidden trainees.
 * Only an empty squad is retired; survivors never merge into another squad.
 * This changes experience ownership, not movement, orders, roles or health. */
export function synchronizeRetinueSquads(state: GameState): void {
    const squads = state.retinueSquads ??= [], roster = entityStore(state).units.query('retinue');
    const previous = indexes.get(state), trusted = simulationReadsActive(state);
    if (trusted && previous?.trusted && !previous.dirty && previous.roster === roster && previous.squads === squads) return;
    const byId = new Map(squads.map(squad => [squad.id, squad]));
    const members = new Map<number, Unit[]>();
    const unassigned: Unit[] = [];
    for (const unit of roster) {
        if (unit.hp <= 0 || !eligible(unit)) continue;
        const squad = unit.retinueSquad === undefined ? undefined : byId.get(unit.retinueSquad);
        const group = squad && (members.get(squad.id) ?? []);
        if (squad && group && squad.faction === unit.faction && group.length < RETINUE_SQUAD_SIZE) {
            group.push(unit); members.set(squad.id, group); unit.kills = squad.kills;
        } else { unit.retinueSquad = undefined; unassigned.push(unit); }
    }
    state.nextRetinueSquadId = Math.max(state.nextRetinueSquadId ?? 1, ...squads.map(squad => squad.id + 1));
    state.retinueSquads = squads.filter(squad => members.has(squad.id));
    const vacancies = new Map<number, RetinueSquad[]>();
    for (const squad of state.retinueSquads) if (members.get(squad.id)!.length < RETINUE_SQUAD_SIZE) {
        const faction = vacancies.get(squad.faction) ?? [];
        faction.push(squad); vacancies.set(squad.faction, faction);
    }
    for (const unit of unassigned) {
        const faction = vacancies.get(unit.faction) ?? [];
        let squad = faction[0];
        if (!squad) {
            squad = { id: state.nextRetinueSquadId++, faction: unit.faction, kills: 0 };
            state.retinueSquads.push(squad); members.set(squad.id, []); faction.push(squad);
            vacancies.set(unit.faction, faction);
        }
        const group = members.get(squad.id)!;
        group.push(unit); unit.retinueSquad = squad.id;
        // A newly assigned veteran must not lose rank; ordinary palace recruits
        // have zero experience and simply inherit their surviving squad's rank.
        squad.kills = Math.max(squad.kills, unit.kills ?? 0);
        for (const member of group) member.kills = squad.kills;
        if (group.length === RETINUE_SQUAD_SIZE) faction.shift();
    }
    indexes.set(state, { roster, squads: state.retinueSquads,
        byId: new Map(state.retinueSquads.map(squad => [squad.id, squad])), members, dirty: false, trusted });
}

/** Called after the palace has added a recruit to the entity store. */
export function joinRetinueSquad(state: GameState, unit: Unit): RetinueSquad | undefined {
    if (!eligible(unit) || unit.hp <= 0) return;
    synchronizeRetinueSquads(state);
    const squad = indexes.get(state)?.byId.get(unit.retinueSquad!);
    return squad?.faction === unit.faction ? squad : undefined;
}

/** A kill advances the squad once, and every living member uses that rank. */
export function recordRetinueKill(state: GameState, unit: Unit): boolean {
    const index = indexes.get(state), trusted = simulationReadsActive(state);
    if (index && !trusted) index.trusted = false;
    if (!eligible(unit)) return false;
    const roster = entityStore(state).units.query('retinue');
    const shared = trusted && index?.trusted && index.roster === roster && index.squads === state.retinueSquads ? index : undefined;
    const squad = (shared ? shared.byId.get(unit.retinueSquad!) : state.retinueSquads?.find(squad => squad.id === unit.retinueSquad && squad.faction === unit.faction))
        ?? joinRetinueSquad(state, unit);
    if (!squad || squad.faction !== unit.faction) return false;
    const members = (shared?.members.get(squad.id) ?? roster).filter(member => member.hp > 0 && eligible(member)
        && member.faction === squad.faction && member.retinueSquad === squad.id);
    if (!members.length) return false;
    squad.kills++;
    for (const member of members) member.kills = squad.kills;
    return true;
}
