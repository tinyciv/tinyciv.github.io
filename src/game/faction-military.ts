import { BLACKSMITH_UPGRADE_COSTS, purchaseBlacksmithUpgrade } from './blacksmith';
import { constructionEdges } from './builders';
import { factionAIProfile } from './faction-ai-profile';
import { factionCommittedBudget } from './faction-budget';
import { factionDevelopmentReserve } from './faction-development';
import { learnLeaderSkill, readLeaderProgression } from './leader-progression';
import { hasStaticPath } from './pathfinding';
import { withPlayerFaction } from './player-context';
import { desiredRetinueSize } from './archery';
import { isInfantryDrillUnlocked } from './research';
import { purchaseRetinueSlot, RETINUE_SLOT_COST, RETINUE_SLOT_UPKEEP } from './retinue-purchases';
import { buildingReady, distance, type Building, type GameState, type Point, type Unit } from './types';
import { factionHasDevelopedResource } from './resource-development';

/** Real purchases with normal Leader reach, prices, treasury and equipment
 * effects. Return a nearby service destination when a physical visit is due. */
export function prepareFactionArmy(state: GameState, leader: Unit, palace: Building): Point | undefined {
  if (factionAIProfile(state, leader.faction) === 'legacy') return;
  const faction = state.factions.find(candidate => candidate.id === leader.faction)!;
  withPlayerFaction(state, faction.id, () => {
    for (let attempt = 0; attempt < 9; attempt++) {
      const progress = readLeaderProgression(leader);
      if (!progress.skillPoints) break;
      const priority = progress.skills.command < 3 ? 'command' : progress.skills.guard < 3 ? 'guard' : 'power';
      if (!learnLeaderSkill(state, priority, faction.id).ok) break;
    }
  });
  // A long expedition does not reverse across the map to spend a small windfall.
  if (distance(leader, palace) > 12 || state.time - leader.lastCombat < 5) return;
  const armor = faction.armorLevel ?? 0, weapon = faction.weaponLevel ?? 0;
  const track = armor < weapon ? 'armor' : 'weapon', level = track === 'armor' ? armor : weapon;
  const upgradeCost = factionHasDevelopedResource(state, faction.id, 'iron') ? BLACKSMITH_UPGRADE_COSTS.at(level) : undefined;
  const smith = state.buildings.filter(building => building.kind === 'blacksmith' && buildingReady(building)
    && building.faction === faction.id && distance(building, palace) < 12)
    .sort((a, b) => distance(a, leader) - distance(b, leader))[0];
  const needsSlots = isInfantryDrillUnlocked(faction) && desiredRetinueSize(faction, leader) < 8;
  if ((!smith || upgradeCost === undefined || faction.gold < upgradeCost) && (!needsSlots || faction.gold < RETINUE_SLOT_COST)) return;
  const reserve = factionDevelopmentReserve(state, faction) + Math.max(100, factionCommittedBudget(state, faction).upkeep * 2);
  let destination: Building | undefined;
  if (smith && upgradeCost !== undefined && faction.gold >= upgradeCost + reserve) {
    if (withPlayerFaction(state, faction.id, () => purchaseBlacksmithUpgrade(state, smith, track)).ok) return;
    destination = smith;
  } else if (needsSlots
    && faction.gold >= RETINUE_SLOT_COST + reserve && factionCommittedBudget(state, faction).surplus > RETINUE_SLOT_UPKEEP + 5) {
    if (withPlayerFaction(state, faction.id, () => purchaseRetinueSlot(state, palace)).ok) return;
    destination = palace;
  }
  return destination && constructionEdges(state, destination)
    .filter(point => hasStaticPath(state, leader, point, faction.id)).sort((a, b) => distance(a, leader) - distance(b, leader))[0];
}
