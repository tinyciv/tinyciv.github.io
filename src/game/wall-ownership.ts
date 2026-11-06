import { raiderCampActive } from './raider-camps';
import { invalidateScheduledHarvests } from './farms';
import { invalidateFog } from './fog';
import { markWorldChanged } from './world-revisions';
import { friendlyGateAccess, invalidateNavigation } from './pathfinding';
import { releaseAttackSpot } from './engagement';
import { clearBuildingFootprint } from './construction-clearance';
import { territory, type Territory } from './borders';
import { buildingTerritoryOwner } from './property-territory';
import { applyDefenseResearch } from './defense-research';
import { buildingReady, buildingWidth, buildingHeight, isFarmKind, isWallKind, tileAt, type Building, type GameState, type World } from './types';

/** Match a local city neighborhood without letting distant settlements claim walls. */
export const WALL_CLAIM_RADIUS = 8;
export const NEUTRAL_WALL_FACTION = -1;
const RAIDER_FACTION = -2;

interface BuildingSnapshot {
    id: number; kind: Building['kind']; faction: number; x: number; y: number; alive: boolean; ready: boolean;
}
interface OwnershipSnapshot {
    world: World;
    territoryRevision: number;
    buildings: BuildingSnapshot[];
    factions: { id: number; defeated: boolean }[];
    /** A gate must stay public until its former occupants can step aside. */
    pendingClaim: boolean;
}
interface Influence { faction: number; x: number; y: number }
const snapshots = new WeakMap<GameState, OwnershipSnapshot>();

function unchanged(state: GameState, borders: Territory, previous: OwnershipSnapshot | undefined): boolean {
    if (!previous || previous.pendingClaim || previous.world !== state.world || previous.buildings.length !== state.buildings.length
        || previous.territoryRevision !== borders.revision || previous.factions.length !== state.factions.length) return false;
    for (let i = 0; i < state.buildings.length; i++) {
        const building = state.buildings[i], old = previous.buildings[i];
        if (building.id !== old.id || building.kind !== old.kind || building.faction !== old.faction
            || building.x !== old.x || building.y !== old.y || (building.hp > 0) !== old.alive
            || buildingReady(building) !== old.ready) return false;
    }
    for (let i = 0; i < state.factions.length; i++) {
        const faction = state.factions[i], old = previous.factions[i];
        if (faction.id !== old.id || faction.defeated !== old.defeated) return false;
    }
    return true;
}

function supportsProperty(building: Building): boolean {
    if (!buildingReady(building) || building.villageId !== undefined) return false;
    // Recorded camps claim walls through their inner towers. Independent
    // marauder settlements retain nearby walls but cannot claim neutral property. Untargetable farms cannot hold walls or one another.
    if (building.faction === RAIDER_FACTION) return building.raiderCamp === undefined && (building.kind === 'house' || building.kind === 'villageTent');
    return building.faction >= 0 && !isWallKind(building.kind) && !isFarmKind(building.kind)
        && !['road', 'bridge', 'irrigation', 'ruin'].includes(building.kind);
}

/** Territory claims civilian property, roads and walls; defensive posts/towers
 * keep their allegiance. Outside borders, walls and farms retain their owner
 * while a local supporting building survives.
 * A unique local building-count leader can claim unsupported property. Walls
 * become neutral without a winner; outlying farms keep their owner without a
 * local claimant so distant farmland can resume after a fallow period. Ties remain neutral.
 * Defeated owners retain supported property but cannot make a new claim.
 *
 * Unchanged frames compare scalars only. After a change, spatial buckets bound
 * each wall's candidate search to its neighborhood instead of all buildings. */
export function updateWallOwnership(state: GameState): boolean {
    const borders = territory(state);
    if (unchanged(state, borders, snapshots.get(state))) return false;
    const claimants = new Set(state.factions.filter(faction => faction.id >= 0 && !faction.defeated).map(faction => faction.id));
    // Independent camp outposts can extend beyond the ordinary city radius.
    // The surviving core towers support their recorded defensive perimeter.
    const liveRaiderCamps = new Set((state.raiderCamps ?? []).filter(camp => raiderCampActive(state, camp)).map(camp => camp.id));
    const influences = new Map<string, Influence[]>(), roads = new Map<string, Building[]>(), wallCells = new Set<string>();
    const key = (x: number, y: number): string => `${x},${y}`;
    for (const building of state.buildings) {
        if (isWallKind(building.kind) && building.hp > 0) wallCells.add(key(building.x, building.y));
        if (building.kind === 'road' && building.hp > 0) {
            const cell = key(building.x, building.y), layers = roads.get(cell);
            if (layers) layers.push(building); else roads.set(cell, [building]);
        }
        if (!supportsProperty(building)) continue;
        const source = { faction: building.faction, x: building.x + buildingWidth(building) / 2, y: building.y + buildingHeight(building) / 2 };
        const bucket = key(Math.floor(source.x / WALL_CLAIM_RADIUS), Math.floor(source.y / WALL_CLAIM_RADIUS));
        const nearby = influences.get(bucket);
        if (nearby) nearby.push(source); else influences.set(bucket, [source]);
    }
    const changedOwners = new Map<number, number>(), changedFarmOwners = new Map<number, number>();
    const changedPalaces = new Map<number, number>(), formerPalaceOwners = new Set<number>();
    let pendingClaim = false;
    const transfer = (building: Building, owner: number): void => {
        if (building.faction === owner) return;
        const former = state.factions.find(faction => faction.id === building.faction);
        const winner = state.factions.find(faction => faction.id === owner);
        const residents = buildingReady(building) ? Math.max(0, building.kind === 'house' ? building.residents ?? 0
            : building.kind === 'palace' ? building.unhousedResidents ?? 0 : 0) : 0;
        const moved = former ? Math.min(Math.max(0, former.population), residents) : residents;
        if (former) former.population -= moved;
        if (winner) winner.population += moved;
        if (building.kind === 'palace') {
            changedPalaces.set(building.id, owner); formerPalaceOwners.add(building.faction);
            building.cultureAtFounding = winner?.culture ?? 0;
        }
        building.faction = owner;
        applyDefenseResearch(building, winner);
        if (isFarmKind(building.kind)) {
            if (owner === NEUTRAL_WALL_FACTION) building.farmAbandonedAt = state.time;
            else delete building.farmAbandonedAt;
        }
        delete building.repairerId;
        const site = building.construction;
        if (site) {
            if (!site.waitingForBuilder) site.pausedAt = state.time;
            site.waitingForBuilder = true; site.cleared = false;
            delete site.builderId;
        }
        changedOwners.set(building.id, owner);
        // Another gate evacuation in this same frame must see earlier claims.
        if (!isFarmKind(building.kind)) invalidateNavigation(state);
    };
    for (const wall of state.buildings) {
        if (wall.hp <= 0 || wall.villageId !== undefined || ['fort', 'guardPost', 'woodenTower', 'tower', 'ballista'].includes(wall.kind)) continue;
        // A road underneath a wall follows the gate's evacuation/claim result.
        if (wall.kind === 'road' && wallCells.has(key(wall.x, wall.y))) continue;
        const farm = isFarmKind(wall.kind);
        const borderOwner = buildingTerritoryOwner(state, wall, borders);
        if (borderOwner === undefined && isWallKind(wall.kind) && wall.faction === RAIDER_FACTION
            && wall.raiderCamp !== undefined && liveRaiderCamps.has(wall.raiderCamp)) continue;
        if (borderOwner === wall.faction) continue;
        if (borderOwner === undefined && ((!isWallKind(wall.kind) && !farm) || !buildingReady(wall))) continue;
        const cx = wall.x + buildingWidth(wall) / 2, cy = wall.y + buildingHeight(wall) / 2, counts = new Map<number, number>();
        const bx = Math.floor(cx / WALL_CLAIM_RADIUS), by = Math.floor(cy / WALL_CLAIM_RADIUS);
        if (borderOwner === undefined) for (let y = by - 1; y <= by + 1; y++) for (let x = bx - 1; x <= bx + 1; x++) {
            for (const source of influences.get(key(x, y)) ?? []) {
                if ((source.x - cx) ** 2 + (source.y - cy) ** 2 <= WALL_CLAIM_RADIUS ** 2)
                    counts.set(source.faction, (counts.get(source.faction) ?? 0) + 1);
            }
        }
        if (borderOwner === undefined && wall.faction !== NEUTRAL_WALL_FACTION && counts.has(wall.faction)) continue;
        let owner = NEUTRAL_WALL_FACTION, best = 0, tied = false;
        for (const [faction, count] of counts) {
            if (!claimants.has(faction)) continue;
            if (count > best) { owner = faction; best = count; tied = false; }
            else if (count === best) tied = true;
        }
        if (tied) owner = NEUTRAL_WALL_FACTION;
        if (borderOwner !== undefined) owner = borderOwner;
        // Farms may intentionally lie far beyond a city. Mere distance or a
        // fallow period must not prevent the owner from returning to tend them.
        // A rival still claims an unsupported farm when it has local influence.
        if (farm && !best && borderOwner === undefined) continue;
        if (owner === wall.faction) continue;
        const gateRoads = isWallKind(wall.kind) ? roads.get(key(wall.x, wall.y)) : undefined;
        if (owner >= 0 && gateRoads) {
            const blockedOccupants = (): boolean => state.units.some(unit => unit.hp > 0 && !unit.inside
                && unit.x >= wall.x && unit.x < wall.x + 1 && unit.y >= wall.y && unit.y < wall.y + 1
                && !friendlyGateAccess(state, unit.faction, owner));
            if (blockedOccupants()) {
                clearBuildingFootprint(state, wall);
                if (blockedOccupants()) {
                    // Do not close a captured gate beneath a former occupant.
                    // Retry as units or terrain move, even without new buildings.
                    owner = NEUTRAL_WALL_FACTION;
                    pendingClaim = true;
                }
            }
        }
        if (owner === wall.faction) continue;
        transfer(wall, owner);
        if (farm) changedFarmOwners.set(wall.id, owner);
        // A gateway is one property even though paving and wall are separate
        // buildings. Keep its road layer selectable/demolishable by the owner.
        for (const road of gateRoads ?? []) {
            transfer(road, owner);
        }
    }
    const changed = changedOwners.size > 0;
    if (changed) {
        if (changedFarmOwners.size) {
            invalidateScheduledHarvests(state);
            // Fields retain their crops, harvest deadlines and fallow state.
            // Transfer every plot in one pass, without replanting or giving the
            // winner food that a former-owner courier has already picked up.
            for (const field of state.fields ?? []) {
                const owner = changedFarmOwners.get(field.camp);
                if (owner === undefined) continue;
                field.faction = owner;
                delete field.claimedBy;
                const tile = tileAt(state.world, field.x, field.y);
                if (tile) tile.farm = owner;
            }
            state.farmVersion = (state.farmVersion ?? 0) + 1;
        }
        for (const unit of state.units) {
            const palaceOwner = changedPalaces.get(unit.home ?? -1);
            if (unit.kind === 'worker' && unit.hp > 0 && palaceOwner !== undefined && unit.faction !== palaceOwner) {
                unit.faction = palaceOwner; unit.order = 'work'; unit.morale = 100;
                delete unit.civilianPanic; delete unit.routed; delete unit.routOrder; delete unit.casualtyShock;
                unit.buildSite = undefined; unit.repairSite = undefined; unit.clearTree = undefined;
                unit.field = undefined; delete unit.cultivating; delete unit.builderRetiring;
                unit.buildPhase = unit.inside ? 'idle' : 'returning'; unit.collectPhase = unit.inside ? 'idle' : 'returning';
                unit.target = undefined; unit.destination = undefined; unit.path = undefined; unit.pathGoal = undefined;
                unit.repathAt = 0; unit.moving = false; unit.attackTime = 0;
                releaseAttackSpot(state, unit);
            }
            const constructionOwner = changedOwners.get(unit.buildSite ?? -1), repairOwner = changedOwners.get(unit.repairSite ?? -1);
            const abandonedJob = constructionOwner !== undefined && constructionOwner !== unit.faction
                || repairOwner !== undefined && repairOwner !== unit.faction;
            if (abandonedJob) {
                unit.buildSite = undefined; unit.repairSite = undefined;
                unit.buildPhase = unit.inside ? 'idle' : 'returning';
            }
            const farmOwner = changedFarmOwners.get(unit.collectorCamp ?? -1);
            const abandonedFarm = farmOwner !== undefined && farmOwner !== unit.faction;
            if (abandonedFarm) {
                unit.field = undefined;
                delete unit.cultivating;
                unit.collectPhase = unit.inside ? 'idle' : 'returning';
                // Keep faction, home and carried food. The normal courier
                // reassignment pass finds a new friendly farm or retires it.
            }
            const peacefulTarget = (id: number | undefined): boolean => {
                const owner = changedOwners.get(id ?? -1);
                return owner !== undefined && (owner === NEUTRAL_WALL_FACTION || friendlyGateAccess(state, unit.faction, owner));
            };
            // Keep the forced-attack context so its normal live validation can
            // restore the previous destination, recall and defensive post.
            if (abandonedJob || abandonedFarm || peacefulTarget(unit.target) || peacefulTarget(unit.forcedAttack?.target)) {
                unit.target = undefined; unit.destination = undefined; unit.path = undefined; unit.pathGoal = undefined;
                unit.repathAt = 0; unit.moving = false; unit.attackTime = 0;
                releaseAttackSpot(state, unit);
            }
        }
        for (const id of formerPalaceOwners) {
            const faction = state.factions.find(candidate => candidate.id === id);
            if (faction && !state.buildings.some(building => building.kind === 'palace' && building.faction === id && buildingReady(building)))
                faction.defeated = true;
        }
        markWorldChanged(state.world);
        invalidateNavigation(state);
        invalidateFog(state);
    }
    snapshots.set(state, {
        world: state.world,
        territoryRevision: borders.revision,
        pendingClaim,
        buildings: state.buildings.map(building => ({ id: building.id, kind: building.kind, faction: building.faction,
            x: building.x, y: building.y, alive: building.hp > 0, ready: buildingReady(building) })),
        factions: state.factions.map(faction => ({ id: faction.id, defeated: faction.defeated })),
    });
    return changed;
}
