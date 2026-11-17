import { FORT_BRIGADE_COSTS, fortBrigadeLevel, upgradeFortBrigade } from './forts';
import { KEEP_UPGRADE_COST, KEEP_HOUSING_COST, isKeep, upgradeSettlement, purchaseKeepHousing } from './settlement-upgrades';
import { BLACKSMITH_UPGRADE_COSTS, blacksmithIronRequired, purchaseBlacksmithUpgrade } from './blacksmith';
import { constructionEdges } from './builders';
import { factionAIPolicy, factionAIDecision } from './faction-ai-profile';
import { factionCommittedBudget } from './faction-budget';
import { factionDevelopmentReserve } from './faction-development';
import { learnLeaderSkill, readLeaderProgression } from './leader-progression';
import { hasStaticPath } from './pathfinding';
import { withPlayerFaction } from './player-context';
import { desiredRetinueSize } from './archery';
import { isInfantryDrillUnlocked, isBuildingUnlocked } from './research';
import { purchaseRetinueSlot, RETINUE_SLOT_COST, RETINUE_SLOT_UPKEEP } from './retinue-purchases';
import { structuresOf, STRUCTURE_READY } from './structure-index';
import { buildingReady, distance, type Building, type GameState, type Point, type Unit } from './types';
import { factionDevelopedResourceCount } from './resource-development';
import { ACHIEVEMENTS, purchaseAchievement } from './achievements';
import { nativeInstitutionPlan } from './institution-native';

/** Real purchases with normal Leader reach, prices, treasury and equipment
 * effects. Return a nearby service destination when a physical visit is due. */
export function prepareFactionArmy(state: GameState, leader: Unit, palace: Building): Point | undefined {
  if (!factionAIPolicy(state, leader.faction).features.militaryPurchases) return;
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
  // One sparse native choice per strategy pass. A forum visit uses the same
  // physical reach, prerequisites and culture payment as a player purchase.
  const achievement = nativeInstitutionPlan(state, faction.id, 3, [faction.culture ?? 0, faction.achievements ?? 0])[0];
  if (achievement >= 0 && isBuildingUnlocked(faction, 'forum')) {
    const forums = structuresOf(state, faction.id, STRUCTURE_READY, 'forum').filter(forum => distance(forum, palace) <= 12)
      .slice().sort((a, b) => distance(a, leader) - distance(b, leader) || a.id - b.id);
    for (const forum of forums) {
      const definition = ACHIEVEMENTS[achievement];
      if (!definition) break;
      if (withPlayerFaction(state, faction.id, () => purchaseAchievement(state, forum, definition.id)).ok) break;
      const approach = constructionEdges(state, forum).filter(point => hasStaticPath(state, leader, point, faction.id))
        .sort((a, b) => distance(a, leader) - distance(b, leader))[0];
      if (approach) return approach;
    }
  }
  const townReserve = factionDevelopmentReserve(state,faction);
  const townUpgrade=factionAIDecision(state,faction.id,'keepUpgrade',faction.gold,townReserve,KEEP_UPGRADE_COST,KEEP_HOUSING_COST,
    Number(isKeep(palace)),Number(!!palace.keepHousingExpanded));
  if(townUpgrade && isBuildingUnlocked(faction,'woodenTower')) {
    const result=withPlayerFaction(state,faction.id,()=>{
      if(townUpgrade===1 && !upgradeSettlement(state,palace).ok)return false;
      return purchaseKeepHousing(state,palace).ok;
    });
    if(!result)return constructionEdges(state,palace).filter(point=>hasStaticPath(state,leader,point,faction.id))
      .sort((a,b)=>distance(a,leader)-distance(b,leader))[0];
  }
  for(const fort of structuresOf(state,faction.id,STRUCTURE_READY,'fort').filter(fort=>distance(fort,palace)<=10)) {
    const level=fortBrigadeLevel(fort),cost=FORT_BRIGADE_COSTS.at(level);
    if(cost===undefined||!factionAIDecision(state,faction.id,'fortBrigade',faction.gold,townReserve,cost,level))continue;
    if(withPlayerFaction(state,faction.id,()=>upgradeFortBrigade(state,fort)).ok)break;
    return constructionEdges(state,fort).filter(point=>hasStaticPath(state,leader,point,faction.id))
      .sort((a,b)=>distance(a,leader)-distance(b,leader))[0];
  }
  const armor = faction.armorLevel ?? 0, weapon = faction.weaponLevel ?? 0;
  const track = armor < weapon ? 'armor' : 'weapon', level = track === 'armor' ? armor : weapon;
  const upgradeCost = factionDevelopedResourceCount(state, faction.id, 'iron') >= blacksmithIronRequired(faction) ? BLACKSMITH_UPGRADE_COSTS.at(level) : undefined;
  const smith = structuresOf(state, faction.id, STRUCTURE_READY, 'blacksmith').filter(building => distance(building, palace) < 12)
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
