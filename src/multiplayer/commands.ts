import { orderMarketRoute } from '../game/trade';
import { MILITARY_FORMATION_TYPES, selectMilitaryFormation } from '../game/military-academy';
import { convertFieldCannon, orderFieldCannon } from '../game/field-cannons-native';
import { resolveExploration } from '../game/exploration-native';
import { shipyardOrder, warshipAction, warshipMove, warshipAttack, SHIP_CLASSES, NAVAL_WEAPONS, MARINE_TYPES } from '../game/warships-native';
import { entityStore } from '../game/entity-store';
import { ACHIEVEMENTS, purchaseAchievement } from '../game/achievements';
import { buildSite } from '../game/site-construction';
import { dismissLevy, levyPopulation, setLevySlingerFraction } from '../game/mass-levy';
import { setPlacementIntent } from '../game/battle-support-native';
import { askHermit } from '../game/hermits';
import { performQuestAction } from '../game/quests';
import { upgradeFort, upgradeFortBrigade, rebuildFort } from '../game/forts';
import { toggleGarrison } from '../game/garrison';
import { BUILD_COSTS, buildAt, commandAttackAt, commandMove, diplomacyAction, recallRetinue, respawnLeader, setRetinueStance, toggleMovementMode } from '../game/simulation';
import { buildStroke } from '../game/construction';
import { cancelArea, clearArea } from '../game/area-tools';
import { setForbiddenRectangle } from '../game/forbidden-zones';
import { factionById, withPlayerFaction, isHumanFaction } from '../game/player-context';
import { buildingActivityAvailable, BUILDING_ACTIVITY_RANGE } from '../game/building-activity';
import { RESEARCH_BRANCHES, prioritizeResearch, removeResearchPriority, setResearchAllocation } from '../game/research';
import { purchaseBlacksmithUpgrade } from '../game/blacksmith';
import { setGovernorPermission } from '../game/governor';
import { importImmigrant } from '../game/immigration';
import { purchaseRetinueSlot } from '../game/retinue-purchases';
import { purchaseOrchardUpgrade } from '../game/orchards';
import { upgradeGuardPost, setGuardPostWallsOnly, setGuardPostAvoidForbidden } from '../game/guard-posts';
import { upgradeSettlement, purchaseKeepHousing, upgradeSettlementTier } from '../game/settlement-upgrades';
import { setRetinueCount } from '../game/archery';
import { performVillageAction } from '../game/villages';
import { learnLeaderSkill } from '../game/leader-progression';
import { toggleInfantryFormation } from '../game/infantry-drill';
import { beginOffensive, cancelOffensive } from '../game/offensive-native';
import { setAutomaticallyRebuildDefenses } from '../game/defense-rebuilding';
import { developResourceGroup } from '../game/resource-development';
import { fenceLivestockHerd } from '../game/livestock';
import { buildingReady, type GameState, type Point } from '../game/types';
import type { CommandResult, GameCommand } from './protocol';

const fail = (message = 'Invalid command.'): CommandResult => ({ ok: false, message });
const success = (ok = true): CommandResult => ({ ok });
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const point = (state: GameState, value: unknown): value is Point => record(value) && typeof value.x === 'number'
  && typeof value.y === 'number' && Number.isFinite(value.x) && Number.isFinite(value.y)
  && value.x >= 0 && value.y >= 0 && value.x < state.world.width && value.y < state.world.height;
const branches = new Set(RESEARCH_BRANCHES.map(branch => branch.id));
const compositionRoles = { 'field-cannons': 'fieldCannon', warriors: 'warrior', archers: 'archer', spearmen: 'spearman', swordsmen: 'swordsman',
  pikemen: 'pikeman', musketmen: 'musketman', horsemen: 'horseman', 'horse-archers': 'horseArcher', knights: 'knight' } as const;

/** Actor identity comes from the authenticated socket, never from a command.
 * Validate the untrusted envelope before calling the game's own cost/reach rules. */
export function applyGameCommand(state: GameState, actor: number, value: unknown): CommandResult {
  const faction = factionById(state, actor);
  if (!isHumanFaction(state, actor) || !faction || faction.defeated) return fail('Your faction is unavailable.');
  if (!record(value) || typeof value.type !== 'string') return fail();
  if (state.gameOver && value.type !== 'respawn') return fail('The match has ended.');
  const command = value as unknown as GameCommand;
  return withPlayerFaction(state, actor, () => {
    switch (command.type) {
      case 'offensive': return point(state, command.rally) && point(state, command.objective)
        ? beginOffensive(state, command.rally, command.objective, actor) : fail();
      case 'cancel-offensive': cancelOffensive(state, actor); return success();
      case 'military-formation': {
        if (!Number.isSafeInteger(command.buildingId) || !MILITARY_FORMATION_TYPES.includes(command.formation)) return fail();
        const academy = entityStore(state).buildings.get(command.buildingId);
        if (!academy || academy.kind !== 'militaryAcademy' || academy.faction !== actor || !buildingActivityAvailable(state, academy)) return fail('Military Academy unavailable.');
        return selectMilitaryFormation(state, command.formation, actor);
      }
      case 'foundry-convert': {
        if (!Number.isSafeInteger(command.buildingId) || !Number.isSafeInteger(command.unitId)) return fail();
        const foundry = entityStore(state).buildings.get(command.buildingId), unit = entityStore(state).units.get(command.unitId);
        if (!foundry || foundry.faction !== actor) return fail('That foundry is no longer yours. Select one of your foundries.');
        if (!unit || unit.faction !== actor) return fail('That soldier is no longer available. Choose another friendly soldier.');
        return convertFieldCannon(state, foundry, unit);
      }
      case 'field-cannon-move': {
        if (!Number.isSafeInteger(command.unitId) || !point(state, command)) return fail();
        const unit = entityStore(state).units.get(command.unitId);
        return unit && unit.faction === actor ? orderFieldCannon(state, unit, command) : fail('That cannon is no longer yours or has been destroyed. Select another cannon.');
      }
      case 'warship-move': {
        if (!Number.isSafeInteger(command.shipId) || !point(state, command)) return fail();
        const ship = entityStore(state).units.get(command.shipId);
        return ship?.warship && ship.faction === actor ? warshipMove(state, ship, command) : fail('That warship is no longer yours or has sunk. Select another warship.');
      }
      case 'warship-attack': {
        if (!Number.isSafeInteger(command.shipId) || !Number.isSafeInteger(command.targetId)) return fail();
        const ship=entityStore(state).units.get(command.shipId), target=entityStore(state).units.get(command.targetId);
        return ship?.warship && ship.faction===actor && target ? warshipAttack(state,ship,target)
          : fail('Select your surviving warship and a visible enemy unit.');
      }
      case 'warship': {
        if (!Number.isSafeInteger(command.shipId) || !['anchor', 'land', 'reinforce'].includes(command.action)) return fail();
        const ship = entityStore(state).units.get(command.shipId);
        return ship && ship.faction === actor ? warshipAction(state, ship, command.action) : fail('That warship is no longer yours or has sunk. Select another warship.');
      }
      case 'exploration-choice': return Number.isSafeInteger(command.siteId) && typeof command.accept === 'boolean'
        ? resolveExploration(state, command.siteId, command.accept ? 1 : -1, actor) : fail();
      case 'build-site': return Number.isSafeInteger(command.siteId) && command.siteId >= 0 && command.siteId < state.world.tiles.length
        ? buildSite(state, command.siteId, actor) : fail();
      case 'placement-intent':
        if (typeof command.active !== 'boolean') return fail();
        setPlacementIntent(state, actor, command.active); return success();
      case 'hermit': return Number.isInteger(command.hermitId) ? askHermit(state, command.hermitId) : fail();
      case 'quest': return Number.isInteger(command.kind) && command.kind >= 0 && command.kind <= 7 && ['accept','complete'].includes(command.action)
        ? performQuestAction(state,command.kind,command.action) : fail();
      case 'move': case 'attack': case 'interact': {
        if (!point(state, command)) return fail();
        let message = '';
        const rejected = (reason: string) => { message = reason; };
        const ok = command.type === 'move' ? commandMove(state, command.x, command.y, rejected)
          : command.type === 'attack' ? commandAttackAt(state, command.x, command.y, rejected)
          : commandAttackAt(state, command.x, command.y, rejected) || commandMove(state, command.x, command.y, rejected);
        return ok ? success() : fail(message || 'Select a living unit and try the order again.');
      }
      case 'garrison': return toggleGarrison(state);
      case 'levy': return levyPopulation(state);
      case 'dismiss-levy': return dismissLevy(state);
      case 'recall': recallRetinue(state); return success();
      case 'movement': toggleMovementMode(state); return success();
      case 'infantry-formation': return toggleInfantryFormation(state);
      case 'auto-rebuild-defenses':
        if (typeof command.enabled !== 'boolean') return fail();
        setAutomaticallyRebuildDefenses(state, command.enabled, actor); return success();
      case 'pause-spending':
        if (typeof command.enabled !== 'boolean') return fail();
        faction.spendingPaused = command.enabled; return success();
      case 'stance':
        if (!['aggressive', 'defensive', 'hold'].includes(command.stance)) return fail();
        setRetinueStance(state, command.stance); return success();
      case 'learnLeaderSkill':
        if (!['power', 'guard', 'command', 'engineer', 'brace', 'discretion'].includes(command.skill)) return fail();
        return learnLeaderSkill(state, command.skill, actor);
      case 'respawn': return state.multiplayer ? fail('Manual respawn after defeat is only available in single-player.') : respawnLeader(state);
      case 'develop-resource':
        if (!point(state, command) || !Number.isInteger(command.x) || !Number.isInteger(command.y)) return fail();
        return developResourceGroup(state, command.x, command.y, actor);
      case 'fence-herd':
        return Number.isSafeInteger(command.herdId) && command.herdId >= 0 ? fenceLivestockHerd(state, command.herdId, actor) : fail();
      case 'build': {
        if (typeof command.kind !== 'string' || command.kind !== 'clearTrees' && !Object.hasOwn(BUILD_COSTS, command.kind)
          || !Array.isArray(command.points) || !command.points.length || command.points.length > 256 || !command.points.every(item => point(state, item))) return fail();
        // Even a one-cell bridge click represents a complete bank-to-bank
        // crossing. Use the same atomic expansion as the local build tool.
        if (command.points.length === 1 && command.kind !== 'bridge') return buildAt(state, command.kind, command.points[0].x, command.points[0].y, actor);
        const result = buildStroke(state, command.kind, command.points);
        return { ok: result.ok, message: result.message };
      }
      case 'clear': case 'forbid': case 'cancel-area':
        if (!point(state, command.start) || !point(state, command.end)) return fail();
        if ((Math.abs(command.start.x - command.end.x) + 1) * (Math.abs(command.start.y - command.end.y) + 1) > 4096) return fail('Select a smaller area.');
        if (command.type === 'clear') { const result = clearArea(state, command.start, command.end); return { ok: true, message: result.message }; }
        if (command.type === 'cancel-area') return { ok: true, message: cancelArea(state, command.start, command.end).message };
        if (typeof command.enabled !== 'boolean') return fail();
        return { ok: true, message: setForbiddenRectangle(state, command.start, command.end, command.enabled).message };
      case 'diplomacy':
        // The two human opponents remain enemies for the entire duel.
        if (state.multiplayer && state.factions.find(f => f.id === command.faction)?.villageId === undefined) return fail('The opposing player is already at war with you.');
        if (!Number.isSafeInteger(command.faction) || !['war', 'trade', 'ally', 'confederate', 'petition'].includes(command.action)) return fail();
        return diplomacyAction(state, command.faction, command.action, command.buildingId);
      case 'capture': return fail('Captures are resolved by the server.');
    }
    if (!('buildingId' in command) || !Number.isSafeInteger(command.buildingId)) return fail();
    const building = state.buildings.find(item => item.id === command.buildingId);
    if (command.type === 'village') return building && building.villageId !== undefined && ['trade', 'ally', 'confederate', 'petition', 'war'].includes(command.action)
      ? performVillageAction(state, building, command.action, false, actor) : fail();
    if (!building) return fail('This building no longer exists. Select another building.');
    if (building.faction !== actor) return fail('This building is no longer owned by your faction.');
    if (command.type === 'settlement-upgrade') return upgradeSettlementTier(state, building, actor);
    if (!entityStore(state).units.query('leader').some(unit => unit.faction === actor && unit.hp > 0))
      return fail('A living Leader is required to use this building.');
    if (!buildingActivityAvailable(state, building)) return fail(!buildingReady(building)
      ? 'Complete this building before using it.' : `Move your Leader within ${BUILDING_ACTIVITY_RANGE} tiles of this building.`);
    switch (command.type) {
      case 'shipyard': {
        const l = command.loadout;
        if (building.kind !== 'shipyard' || typeof command.refit !== 'boolean' || !record(l) || !SHIP_CLASSES.includes(l.class) || !MARINE_TYPES.includes(l.marine) || !Array.isArray(l.weapons) || l.weapons.length !== 4 || !l.weapons.every(w => NAVAL_WEAPONS.includes(w))) return fail();
        return shipyardOrder(state, building, l, command.refit);
      }
      case 'research-priority': case 'research-remove-priority':
        if (!branches.has(command.branch)) return fail();
        return command.type === 'research-priority' ? prioritizeResearch(state, building, command.branch) : removeResearchPriority(state, building, command.branch);
      case 'achievement': return ACHIEVEMENTS.some(item => item.id === command.achievement) ? purchaseAchievement(state, building, command.achievement) : fail();
      case 'market-destination': return command.destination === null || Number.isSafeInteger(command.destination)
        ? orderMarketRoute(state, building, command.destination) : fail();
      case 'research-allocation': return typeof command.allocation === 'number' ? setResearchAllocation(state, building, command.allocation) : fail();
      case 'immigrant': return importImmigrant(state, building);
      case 'retinue-slot': return purchaseRetinueSlot(state, building);
      case 'fort-brigade': return upgradeFortBrigade(state, building);
      case 'fort-upgrade': return upgradeFort(state, building);
      case 'fort-rebuild': return rebuildFort(state, building);
      case 'guard-upgrade': return upgradeGuardPost(state, building);
      case 'guard-walls': return typeof command.enabled === 'boolean' ? setGuardPostWallsOnly(state, building, command.enabled) : fail();
      case 'guard-forbidden': return typeof command.enabled === 'boolean' ? setGuardPostAvoidForbidden(state, building, command.enabled) : fail();
      case 'keep': return upgradeSettlement(state, building);
      case 'keep-housing': return purchaseKeepHousing(state, building);
      case 'orchard': return command.count === 1 || command.count === 10 ? purchaseOrchardUpgrade(state, building, command.count) : fail();
      case 'blacksmith': return command.track === 'armor' || command.track === 'weapon' ? purchaseBlacksmithUpgrade(state, building, command.track) : fail();
      case 'levy-composition': return success(setLevySlingerFraction(state, building, command.fraction));
      case 'field-cannons': case 'warriors': case 'archers': case 'swordsmen': case 'spearmen': case 'pikemen': case 'musketmen': case 'horsemen': case 'horse-archers': case 'knights':
        return success(setRetinueCount(state, building, compositionRoles[command.type], command.count));
      case 'governor':
        if (!['farms', 'housing'].includes(command.permission) || typeof command.enabled !== 'boolean' || building.kind !== 'palace') return fail();
        setGovernorPermission(building, command.permission, command.enabled); return success();
      default: return fail();
    }
  });
}
