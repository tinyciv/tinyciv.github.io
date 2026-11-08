import { territory, territoryClaimWithoutSource, UNCLAIMED, type Territory } from './borders';
import { buildingHeight, buildingWidth, buildingReady, isFarmKind, type Building, type GameState } from './types';

/** Solid buildings belong inside one complete claim. Outlying farms change
 * hands on first border contact, but keep their owner while any plot is home. */
export function buildingTerritoryOwner(state: GameState, building: Building, borders = territory(state)): number | undefined {
    if (building.villageId !== undefined) return building.faction;
    // Cities and forts anchor their own minimum territory. Their protected
    // footprint must not be bypassed by the independent-source test below;
    // a settlement changes allegiance through combat capture instead.
    if ((building.kind === 'palace' || building.kind === 'fort') && buildingReady(building)
        && state.factions.some(faction => faction.id === building.faction && faction.id >= 0 && !faction.defeated)) return building.faction;
    // Village borders reserve land without passively annexing neighboring
    // civilizations' existing cities, homes or fields.
    const villages = new Set(state.villages?.map(village => village.faction));
    const owners = footprintOwners(building, borders).map(owner => villages.has(owner) ? UNCLAIMED : owner);
    if (isFarmKind(building.kind)) {
        if (building.faction >= 0 && owners.includes(building.faction)) return building.faction;
        const counts = new Map<number, number>();
        for (const owner of owners) if (owner >= 0 && owner !== UNCLAIMED) counts.set(owner, (counts.get(owner) ?? 0) + 1);
        return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
    }
    const owner = owners[0];
    if (owner !== undefined && owner >= 0 && owner !== building.faction && owners.every(candidate => candidate === owner)) return owner;
    if (['house', 'palace', 'monument'].includes(building.kind)) {
        const radius = borders.sourceRadii.get(building.id) ?? 0;
        let claimant: number | undefined;
        for (let y = building.y; y < building.y + buildingHeight(building); y++)
            for (let x = building.x; x < building.x + buildingWidth(building); x++) {
                const claim = territoryClaimWithoutSource(state, x, y, building.id, borders);
                // The building cannot protect itself from stronger independent
                // cultural influence. Strict source priority prevents nearby
                // palaces or monuments from exchanging owners every update.
                if (!claim || villages.has(claim.faction) || claim.faction === building.faction || claim.radius < radius
                    || claim.radius === radius && claim.sourceId > building.id
                    || claimant !== undefined && claimant !== claim.faction) return owner === building.faction ? owner : undefined;
                claimant = claim.faction;
            }
        if (claimant !== undefined) return claimant;
    }
    return owner !== undefined && owner >= 0 && owners.every(candidate => candidate === owner) ? owner : undefined;
}

export function buildingWithinBorders(state: GameState, building: Building, faction: number, borders = territory(state)): boolean {
    return faction >= 0 && footprintOwners(building, borders).every(owner => owner === faction);
}

function footprintOwners(building: Building, borders: Territory): number[] {
    const owners: number[] = [];
    for (let y = building.y; y < building.y + buildingHeight(building); y++)
        for (let x = building.x; x < building.x + buildingWidth(building); x++)
            owners.push(x < 0 || y < 0 || x >= borders.width || y >= borders.height ? UNCLAIMED : borders.owners[y * borders.width + x]);
    return owners;
}
