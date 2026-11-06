import { upgradeFortBrigade, rebuildFort } from '../game/forts';
import { toggleGarrison } from '../game/garrison';
import { levyPopulation, dismissLevy } from '../game/mass-levy';
import { BUILD_COSTS, buildAt, commandAttackAt, commandMove, diplomacyAction, recallRetinue, respawnLeader, setRetinueStance, toggleMovementMode } from '../game/simulation';
import { buildStroke } from '../game/construction';
import { clearArea } from '../game/area-tools';
import { setForbiddenRectangle } from '../game/forbidden-zones';
import { withPlayerFaction, isHumanFaction } from '../game/player-context';
import { buildingActivityAvailable } from '../game/building-activity';
import { RESEARCH_BRANCHES, prioritizeResearch, removeResearchPriority, setResearchAllocation } from '../game/research';
import { purchaseBlacksmithUpgrade } from '../game/blacksmith';
import { setGovernorPermission } from '../game/governor';
import { importImmigrant } from '../game/immigration';
import { purchaseRetinueSlot } from '../game/retinue-purchases';
import { purchaseOrchardUpgrade } from '../game/orchards';
import { upgradeGuardPost, setGuardPostWallsOnly } from '../game/guard-posts';
import { upgradeSettlement, purchaseKeepHousing } from '../game/settlement-upgrades';
import { setArcherFraction, setSpearmanFraction, setHorsemanFraction } from '../game/archery';
import { performVillageAction } from '../game/villages';
import { learnLeaderSkill } from '../game/leader-progression';
import { toggleInfantryFormation } from '../game/infantry-drill';
import { setAutomaticallyRebuildDefenses } from '../game/defense-rebuilding';
import type { GameState, Point } from '../game/types';
import type { CommandResult, GameCommand } from './protocol';

const fail = (message = 'Invalid command.'): CommandResult => ({ ok: false, message });
const success = (ok = true): CommandResult => ({ ok });
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const point = (state: GameState, value: unknown): value is Point => record(value) && typeof value.x === 'number'
  && typeof value.y === 'number' && Number.isFinite(value.x) && Number.isFinite(value.y)
  && value.x >= 0 && value.y >= 0 && value.x < state.world.width && value.y < state.world.height;
const branches = new Set(RESEARCH_BRANCHES.map(branch => branch.id));

/** Actor identity comes from the authenticated socket, never from a command.
 * Validate the untrusted envelope before calling the game's own cost/reach rules. */
export function applyGameCommand(state: GameState, actor: number, value: unknown): CommandResult {
  if (!isHumanFaction(state, actor) || !state.factions.some(faction => faction.id === actor && !faction.defeated)) return fail('Your faction is unavailable.');
  if (!record(value) || typeof value.type !== 'string') return fail();
  if (state.gameOver && value.type !== 'respawn') return fail('The match has ended.');
  const command = value as unknown as GameCommand;
  return withPlayerFaction(state, actor, () => {
    switch (command.type) {
      case 'move': case 'attack': case 'interact':
        if (!point(state, command)) return fail();
        if (command.type === 'move') return success(commandMove(state, command.x, command.y));
        if (command.type === 'attack') return success(commandAttackAt(state, command.x, command.y));
        return success(commandAttackAt(state, command.x, command.y) || commandMove(state, command.x, command.y));
      case 'garrison': return toggleGarrison(state);
      case 'levy': return levyPopulation(state);
      case 'dismiss-levy': return dismissLevy(state);
      case 'recall': recallRetinue(state); return success();
      case 'movement': toggleMovementMode(state); return success();
      case 'infantry-formation': return toggleInfantryFormation(state);
      case 'auto-rebuild-defenses':
        if (typeof command.enabled !== 'boolean') return fail();
        setAutomaticallyRebuildDefenses(state, command.enabled, actor); return success();
      case 'stance':
        if (!['aggressive', 'defensive', 'hold'].includes(command.stance)) return fail();
        setRetinueStance(state, command.stance); return success();
      case 'learnLeaderSkill':
        if (!['power', 'guard', 'command', 'engineer', 'brace', 'discretion'].includes(command.skill)) return fail();
        return learnLeaderSkill(state, command.skill, actor);
      case 'respawn': return state.multiplayer ? fail('This match has ended.') : respawnLeader(state);
      case 'build': {
        if (typeof command.kind !== 'string' || command.kind !== 'clearTrees' && !Object.hasOwn(BUILD_COSTS, command.kind)
          || !Array.isArray(command.points) || !command.points.length || command.points.length > 256 || !command.points.every(item => point(state, item))) return fail();
        // Even a one-cell bridge click represents a complete bank-to-bank
        // crossing. Use the same atomic expansion as the local build tool.
        if (command.points.length === 1 && command.kind !== 'bridge') return buildAt(state, command.kind, command.points[0].x, command.points[0].y, actor);
        const result = buildStroke(state, command.kind, command.points);
        return { ok: result.ok, message: result.message };
      }
      case 'clear': case 'forbid':
        if (!point(state, command.start) || !point(state, command.end)) return fail();
        if ((Math.abs(command.start.x - command.end.x) + 1) * (Math.abs(command.start.y - command.end.y) + 1) > 4096) return fail('Select a smaller area.');
        if (command.type === 'clear') { const result = clearArea(state, command.start, command.end); return { ok: true, message: result.message }; }
        if (typeof command.enabled !== 'boolean') return fail();
        return { ok: true, message: setForbiddenRectangle(state, command.start, command.end, command.enabled).message };
      case 'diplomacy':
        // The two human opponents remain enemies for the entire duel.
        if (state.multiplayer) return fail('The opposing player is already at war with you.');
        if (!Number.isSafeInteger(command.faction) || !['war', 'trade', 'ally', 'confederate'].includes(command.action)) return fail();
        return diplomacyAction(state, command.faction, command.action, command.buildingId);
      case 'capture': return fail('Captures are resolved by the server.');
    }
    if (!('buildingId' in command) || !Number.isSafeInteger(command.buildingId)) return fail();
    const building = state.buildings.find(item => item.id === command.buildingId);
    if (!building || building.faction !== actor || !buildingActivityAvailable(state, building)) return fail('Move your Leader closer to your building.');
    switch (command.type) {
      case 'research-priority': case 'research-remove-priority':
        if (!branches.has(command.branch)) return fail();
        return command.type === 'research-priority' ? prioritizeResearch(state, building, command.branch) : removeResearchPriority(state, building, command.branch);
      case 'research-allocation': return typeof command.allocation === 'number' ? setResearchAllocation(state, building, command.allocation) : fail();
      case 'immigrant': return importImmigrant(state, building);
      case 'retinue-slot': return purchaseRetinueSlot(state, building);
      case 'fort-brigade': return upgradeFortBrigade(state, building);
      case 'fort-rebuild': return rebuildFort(state, building);
      case 'guard-upgrade': return upgradeGuardPost(state, building);
      case 'guard-walls': return typeof command.enabled === 'boolean' ? setGuardPostWallsOnly(state, building, command.enabled) : fail();
      case 'keep': return upgradeSettlement(state, building);
      case 'keep-housing': return purchaseKeepHousing(state, building);
      case 'orchard': return command.count === 1 || command.count === 10 ? purchaseOrchardUpgrade(state, building, command.count) : fail();
      case 'blacksmith': return command.track === 'armor' || command.track === 'weapon' ? purchaseBlacksmithUpgrade(state, building, command.track) : fail();
      case 'archers': case 'spearmen': case 'horsemen':
        if (typeof command.fraction !== 'number' || !Number.isFinite(command.fraction) || command.fraction < 0 || command.fraction > 1) return fail();
        return success(command.type === 'horsemen' ? setHorsemanFraction(state, building, command.fraction) : command.type === 'archers' ? setArcherFraction(state, building, command.fraction) : setSpearmanFraction(state, building, command.fraction));
      case 'governor':
        if (!['farms', 'housing'].includes(command.permission) || typeof command.enabled !== 'boolean' || building.kind !== 'palace') return fail();
        setGovernorPermission(building, command.permission, command.enabled); return success();
      case 'village': return ['trade', 'ally', 'war'].includes(command.action) ? performVillageAction(state, building, command.action) : fail();
      default: return fail();
    }
  });
}
