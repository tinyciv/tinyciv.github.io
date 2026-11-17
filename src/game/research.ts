import { achievementEffect } from './achievement-effects';
import { questEffect } from './quest-effects';
import { cityOwnership } from './city-ownership';
import type { Point } from './types';
import { playerFaction, isHumanFaction } from './player-context';
import { buildingActivityAvailable, BUILDING_ACTIVITY_RANGE } from './building-activity';
import { updateDefenseResearch } from './defense-research';
import { updateConstructionResearch } from './structures';
import { houseCapacity } from './wells';
import { invalidateSettlementDecisions } from './settlement-decisions';
import { entityStore } from './entity-store';
import { refundGold } from './gold-ledger';
import { buildingReady, type Building, type BuildingKind, type Faction, type GameState, type ResearchBranchId } from './types';
import { rustEngine } from './rust-engine';
import { simCore } from './sim-handle';
import { installResearchContent, nativeResearchCost, nativeResearchIndex, runNativeResearch, type ResearchContext } from './research-native';
export type { ResearchBranchId } from './types';

export interface ResearchTier { name: string; points: number; description: string }
export interface ResearchBranch { id: ResearchBranchId; label: string; prerequisites: readonly ResearchBranchId[]; tiers: readonly ResearchTier[] }
const BASE_RESEARCH_BRANCHES: readonly ResearchBranch[] = [
  { id: 'woodenTower', label: 'Fortification', prerequisites: [], tiers: [{ name: 'Fortification', points: 24, description: 'Unlocks wooden towers, guard posts, militia, and town upgrades to Keeps with ten times the health.' }] },
  { id: 'wall', label: 'Masonry', prerequisites: ['woodenTower'], tiers: [{ name: 'Masonry', points: 24, description: 'Unlocks walls and gates.' }] },
  { id: 'monument', label: 'Statehood', prerequisites: ['grainStorage'], tiers: [{ name: 'Statehood', points: 42, description: 'Unlocks culture-producing monuments.' }] },
  { id: 'blacksmith', label: 'Bronze Working', prerequisites: ['wall'], tiers: [{ name: 'Bronze Working', points: 87, description: 'Unlocks blacksmiths. Armor/weapon upgrades require three additional developed iron tiles per purchase across both tracks.' }] },
  { id: 'archeryRange', label: 'Archery', prerequisites: ['scoutLodge'], tiers: [{ name: 'Archery', points: 63, description: 'Unlocks archery ranges, archer training, and recruits.' }] },
  { id: 'irrigation', label: 'Irrigation', prerequisites: [], tiers: [{ name: 'Irrigation', points: 30, description: 'Unlocks irrigation channels for watering farms.' }] },
  { id: 'drainage', label: 'Drainage', prerequisites: ['irrigation'], tiers: [{ name: 'Drainage', points: 42, description: 'Civilians automatically fill freshwater bodies of up to three tiles beside two or more friendly farm tiles. Each water tile requires eight seconds of work on site.' }] },
  { id: 'scoutLodge', label: 'Exploration', prerequisites: [], tiers: [{ name: 'Exploration', points: 30, description: 'Unlocks Scouts’ Lodges and their concealed observation posts.' }] },
  { id: 'sailing', label: 'Sailing', prerequisites: ['scoutLodge'], tiers: [{ name: 'Sailing', points: 30, description: 'Unlocks coastal docks. Each dock supports one fishing vessel carrying up to 20 food per trip, and a galley for the Leader. Overfishing can permanently collapse a fishery. Cities beside the same navigable river can also establish automatic river trade.' }] },
  { id: 'whaling', label: 'Whaling', prerequisites: ['sailing'], tiers: [{ name: 'Whaling', points: 60, description: 'Unlocks coastal whaling posts. Each launches one whaling ship. Whale deliveries earn 250 gold and give all your ships and units +5% movement for 60 seconds. Further deliveries refresh the duration.' }] },
  { id: 'lateenSails', label: 'Lateen Sails', prerequisites: ['sailing', 'engineering'], tiers: [{ name: 'Lateen Sails', points: 80, description: 'Unlocks caravels: three weapon mounts and 15% more speed than war galleys.' }] },
  { id: 'navalEngineering', label: 'Naval Engineering', prerequisites: ['lateenSails', 'metalCasting'], tiers: [{ name: 'Naval Engineering', points: 120, description: 'Unlocks frigates: four weapon mounts and 15% more speed than caravels.' }] },
  { id: 'traditionalMedicine', label: 'Traditional Medicine', prerequisites: ['grainStorage', 'scoutLodge'], tiers: [{ name: 'Traditional Medicine', points: 42, description: 'Unlocks healers’ shacks: friendly units within four tiles heal three times faster inside their borders, after the normal recovery delay. Overlapping shacks do not stack.' }] },
  { id: 'reinforcedDefenses', label: 'Reinforced Defenses', prerequisites: ['metalTools'], tiers: [{ name: 'Reinforced Defenses', points: 63, description: 'Walls and towers gain 30% maximum health.' }] },
  { id: 'coinage', label: 'Coinage', prerequisites: ['monument', 'sailing'], tiers: [{ name: 'Coinage', points: 54, description: 'Caravan deliveries earn 20% more gold.' }] },
  { id: 'urbanPlanning', label: 'Urban Planning', prerequisites: ['coinage', 'metalTools'], tiers: [{ name: 'Urban Planning', points: 75, description: 'Each house gains one housing place.' }] },
  { id: 'metalCasting', label: 'Metal Casting', prerequisites: ['reinforcedDefenses', 'infantryDrill'], tiers: [{ name: 'Metal Casting', points: 100, description: 'Unlocks swordsmen at blacksmiths: twice the attack of spearmen, with lower defense and no piercing thrust.' }] },
  { id: 'metalTools', label: 'Metal Tools', prerequisites: ['blacksmith'], tiers: [{ name: 'Metal Tools', points: 63, description: 'Construction and repair speed increases by 25%.' }] },
  { id: 'fletching', label: 'Fletching', prerequisites: ['archeryRange', 'metalTools'], tiers: [{ name: 'Fletching', points: 42, description: 'Archers deal 15% more damage.' }] },
  { id: 'grainStorage', label: 'Grain Storage', prerequisites: ['irrigation'], tiers: [{ name: 'Grain Storage', points: 42, description: 'Newly harvested grain stays fresh 50% longer, including while carried. Unlocks one granary per city: an additional collection point and +25% food from friendly farms within six tiles.' }] },
  { id: 'militaryTactics', label: 'Military Tactics', prerequisites: ['blacksmith', 'archeryRange'], tiers: [{ name: 'Military Tactics', points: 63, description: 'Unlocks spearmen at blacksmiths with developed copper: stronger armor and thrusts piercing two enemies behind the first.' }] },
  { id: 'infantryDrill', label: 'Infantry Drill', prerequisites: ['militaryTactics'], tiers: [{ name: 'Infantry Drill', points: 42, description: 'Unlocks Formation 3 for the Leader’s retinue.' }] },
  { id: 'siegeEngines', label: 'Siege Engines', prerequisites: ['reinforcedDefenses', 'fletching'], tiers: [{ name: 'Siege Engines', points: 87, description: 'Unlocks ballistae and siege cannons: eighteen-tile range, automatic assembly outside borders, and slow shots aimed at buildings. Siege cannons require developed iron.' }] },
  { id: 'horsebackRiding', label: 'Horseback Riding', prerequisites: ['scoutLodge'], tiers: [{ name: 'Horseback Riding', points: 63, description: 'Unlocks stables and fast unarmored spear horsemen. Assign mounted retinue at a stable; running charges deal bonus and area damage.' }] },
  { id: 'compoundBow', label: 'Compound Bow', prerequisites: ['horsebackRiding', 'fletching'], tiers: [{ name: 'Compound Bow', points: 90, description: 'Unlocks horse archers at stables with Horseback Riding: fast, lightly protected cavalry firing arrows at range.' }] },
  { id: 'stirrups', label: 'Stirrups', prerequisites: ['horsebackRiding', 'metalCasting'], tiers: [{ name: 'Stirrups', points: 120, description: 'Unlocks armored knights at stables: 180 base health, 43 base attack, 10 defense and powerful running charges. Higher upkeep than light cavalry.' }] },
  { id: 'supplyTrain', label: 'Supply train', prerequisites: ['traditionalMedicine'], tiers: [{ name: 'Supply train', points: 54, description: 'Unlocks supply depots. Each sends a vulnerable, population-free handcart to the Leader every 30 seconds. Delivery heals the Leader and friendly units within 8 tiles by up to 10 HP. Destroyed carts award no gold.' }] },
  { id: 'massLevy', label: 'Mass levy', prerequisites: ['militaryTactics'], tiers: [{ name: 'Mass levy', points: 63, description: 'The Leader can levy up to one third of the population. Levy infantry fight on formation wings with half warrior attack and defense, equipment upgrades, and 80% morale. Upkeep is 5 gold per soldier every 30 seconds; bankruptcy sends them home.' }] },
  { id: 'urbanMilitia', label: 'Urban militia', prerequisites: ['massLevy'], tiers: [{ name: 'Urban militia', points: 80, description: 'Unlocks barracks and pikemen: spearman attack with 50% more defense and 25% more reach; their thrusts pierce enemies behind and knock them back. Every new recruit for a town with a barracks musters there.' }] },
  { id: 'populism', label: 'Populism', prerequisites: ['supplyTrain', 'stirrups'], tiers: [{ name: 'Populism', points: 150, description: 'Unlocks the Colosseum (needs a town of 200 people): population grows twice as fast across the realm, and culture triples within 5 tiles, fading to normal by 25 tiles. Colosseums do not stack.' }] },
  { id: 'fieldCannon', label: 'Field cannon', prerequisites: ['gunpowder', 'siegeEngines'], tiers: [{ name: 'Field cannon', points: 180, description: 'Foundries equip field cannon. Fastest on roads; slow across open ground. Upkeep: 200 gold / 30s.' }] },
  { id: 'gunpowder', label: 'Gunpowder', prerequisites: ['metalCasting', 'urbanMilitia'], tiers: [{ name: 'Gunpowder', points: 150, description: 'Barracks equip musketmen. Leaders carry firearms.' }] },
  { id: 'culturalIdentity', label: 'Cultural Identity', prerequisites: ['monument', 'traditionalMedicine'], tiers: [{ name: 'Cultural Identity', points: 75, description: 'Unlocks forums, where culture purchases permanent faction achievements.' }] },
  { id: 'engineering', label: 'Engineering', prerequisites: ['wall'], tiers: [{ name: 'Engineering', points: 42, description: 'Bridges can cross up to 8 water tiles instead of 2. Clear land is required at both ends.' }] },
  { id: 'roadBuilding', label: 'Road Building', prerequisites: ['wall'], tiers: [{ name: 'Road Building', points: 54, description: 'Roads become paved where the median completed friendly house within 10 tiles is level 4. Paved roads give 25% faster movement than dirt roads.' }] },
  { id: 'militaryScience', label: 'Military Science', prerequisites: ['infantryDrill', 'gunpowder'], tiers: [{ name: 'Military Science', points: 120, description: 'Unlocks the Military Academy and formation choices.' }] },
  { id: 'officerCorps', label: 'Officer Corps', prerequisites: ['infantryDrill'], tiers: [{ name: 'Officer Corps', points: 90, description: 'Unlocks Offensive for the Leader’s retinue.' }] },
];
const baseBranchById = new Map(BASE_RESEARCH_BRANCHES.map(branch => [branch.id, branch]));
const depthCache = new Map<ResearchBranchId, number>();
/** Longest prerequisite chain below a branch (0 for branches with none). */
export function researchDepth(id: ResearchBranchId): number {
  if (!depthCache.has(id)) depthCache.set(id, Math.max(-1, ...baseBranchById.get(id)!.prerequisites.map(researchDepth)) + 1);
  return depthCache.get(id)!;
}
const researchStages = 6;
/** Fortification retains its introductory price. Every later branch ramps
 * linearly by dependency stage, reaching five times its old cost at the end. */
export const RESEARCH_BRANCHES: readonly ResearchBranch[] = BASE_RESEARCH_BRANCHES.map(branch => ({
  ...branch, tiers: branch.tiers.map(tier => ({ ...tier, points: branch.id === 'woodenTower' ? tier.points
    : Math.round(tier.points * (1 + 4 * Math.min(researchStages, researchDepth(branch.id) + 1) / researchStages)) * (branch.id === 'scoutLodge' || branch.id === 'wall' ? .5 : 1) })),
}));
installResearchContent(RESEARCH_BRANCHES);
const branchById = (id: ResearchBranchId): ResearchBranch => RESEARCH_BRANCHES.find(branch => branch.id === id)!;
export function researchLevel(faction: Pick<Faction, 'research'> | undefined, branch: ResearchBranchId): number {
  return rustEngine.research_level(faction?.research?.levels[branch] ?? NaN);
}
export function buildingResearchRequirement(kind: BuildingKind): ResearchBranchId | undefined {
  if (kind === 'militaryAcademy') return 'militaryScience';
  if (kind === 'foundry') return 'fieldCannon';
  if (kind === 'whalingPost') return 'whaling';
  if (kind === 'shipyard') return 'sailing';
  if (kind === 'granary') return 'grainStorage';
  if (kind === 'forum') return 'culturalIdentity';
  if (kind === 'supplyDepot') return 'supplyTrain';
  if (kind === 'colosseum') return 'populism';
  if (kind === 'barracks') return 'urbanMilitia';
  if (kind === 'fort') return 'wall';
  return kind === 'stable' ? 'horsebackRiding' : kind === 'dock' ? 'sailing' : kind === 'ballista' || kind === 'siegeCannon' ? 'siegeEngines' : kind === 'healerShack' ? 'traditionalMedicine' : kind === 'wall' ? 'wall' : kind === 'woodenTower' || kind === 'tower' || kind === 'guardPost' ? 'woodenTower'
    : ['monument', 'blacksmith', 'archeryRange', 'irrigation', 'scoutLodge'].includes(kind) ? kind as ResearchBranchId : undefined;
}
export function isBuildingUnlocked(faction: Pick<Faction, 'research'> | undefined, kind: BuildingKind): boolean {
  const requirement = buildingResearchRequirement(kind);
  return !requirement || researchLevel(faction, requirement) > 0;
}
export const areArchersUnlocked = (faction: Pick<Faction, 'research'> | undefined): boolean => researchLevel(faction, 'archeryRange') > 0;
export const areScoutsUnlocked = (faction: Pick<Faction, 'research'> | undefined): boolean => researchLevel(faction, 'scoutLodge') > 0;
export const areSwordsmenUnlocked = (faction: Pick<Faction, 'research'> | undefined): boolean => researchLevel(faction, 'metalCasting') > 0;
export const areSpearmenUnlocked = (faction: Pick<Faction, 'research'> | undefined): boolean => researchLevel(faction, 'militaryTactics') > 0;
export const areMusketmenUnlocked = (faction: Pick<Faction, 'research'> | undefined): boolean => researchLevel(faction, 'gunpowder') > 0;
export const arePikemenUnlocked = (faction: Pick<Faction, 'research'> | undefined): boolean => researchLevel(faction, 'urbanMilitia') > 0;
export const areHorsemenUnlocked = (faction: Pick<Faction, 'research'> | undefined): boolean => researchLevel(faction, 'horsebackRiding') > 0;
export const areHorseArchersUnlocked = (faction: Pick<Faction, 'research'> | undefined): boolean => areHorsemenUnlocked(faction) && researchLevel(faction, 'compoundBow') > 0;
export const areKnightsUnlocked = (faction: Pick<Faction, 'research'> | undefined): boolean => areHorsemenUnlocked(faction) && researchLevel(faction, 'stirrups') > 0;
export const isInfantryDrillUnlocked = (faction: Pick<Faction, 'research'> | undefined): boolean => researchLevel(faction, 'infantryDrill') > 0;
export const DEFAULT_RESEARCH_ALLOCATION = rustEngine.research_constant(0);
export const RESEARCH_INCOME_WINDOW = rustEngine.research_constant(1);
/** Spread each paid receipt across the normal tax period instead of applying a lump sum. */
export const RESEARCH_FUNDING_SECONDS = rustEngine.research_constant(2);
/** At most 1% per 0.2s: the 150ms HUD cadence can display every percentage. */
export const RESEARCH_PERCENT_PER_SECOND = rustEngine.research_constant(3);
export function researchAllocation(faction: Pick<Faction, 'research'> | undefined): number {
  return rustEngine.research_allocation(faction?.research?.allocation ?? NaN);
}
/** Village scholars reduce the work required; every diverted gold still buys exactly one point. */
export function researchCost(faction: Faction | undefined, id: ResearchBranchId, state?: GameState): number {
  return nativeResearchCost(id, faction?.villageBonuses?.research ?? 0, (state?.world.scenario === 'tutorial' || state?.world.scenario === 'island-deathmatch') ? 2 : 0);
}
/** Completed libraries in distinct cities improve Science per gold. */
export function libraryResearchMultiplier(state: GameState, factionId: number): number {
  const ownership = cityOwnership(state), cities = new Set<number>();
  for (const library of entityStore(state).buildings.query('library')) {
    if (library.faction !== factionId || !buildingReady(library)) continue;
    const city = ownership.building(library);
    if (city) cities.add(city.id);
  }
  const faction = state.factions.find(faction => faction.id === factionId);
  return questEffect(faction, 7, achievementEffect(faction, 3, rustEngine.research_library_multiplier(cities.size)));
}
export function libraryPlacementAllowed(state: GameState, factionId: number, center: Point): boolean {
  const ownership = cityOwnership(state), city = ownership.nearest(center, factionId);
  return !!city && !entityStore(state).buildings.query('library').some(library => library.hp > 0
    && library.faction === factionId && ownership.building(library)?.id === city.id);
}
function hasLibrary(state: GameState, factionId: number): boolean {
  return entityStore(state).buildings.query('library').some(building => building.faction === factionId && buildingReady(building));
}
function nativeContext(state: GameState, faction: Faction | undefined, library: boolean): ResearchContext {
  return { now: state.time, library, defeated: !!faction?.defeated, gameOver: state.gameOver, paused: state.paused };
}
export interface ResearchBranchStatus {
  id: ResearchBranchId; label: string; level: number; progress: number; required: number;
  cost: number; complete: boolean; next?: ResearchTier; prerequisites: readonly ResearchBranchId[]; priority?: number;
}
export interface ResearchStatus {
  focus: ResearchBranchId; requestedFocus: ResearchBranchId; allocation: number; priorities: ResearchBranchId[];
  level: number; progress: number; required: number; cost: number; rate: number; library: boolean;
  prerequisite?: ResearchBranchId; active: boolean; completed: boolean; selectedComplete: boolean; branches: ResearchBranchStatus[];
}
export function researchStatus(state: GameState, factionId: number): ResearchStatus {
  const faction = state.factions.find(candidate => candidate.id === factionId), library = hasLibrary(state, factionId);
  const snapshot = runNativeResearch(state, faction, nativeContext(state, faction, library)), queue = snapshot.priorities;
  const resolved = snapshot.resolved, focus = resolved ?? snapshot.focus;
  const requested = queue[0] ?? focus, allocation = snapshot.allocation;
  const branches = RESEARCH_BRANCHES.map((branch, row) => {
    const { level, required } = snapshot.branches[row], index = queue.indexOf(branch.id);
    return { id: branch.id, label: branch.label, level, progress: level ? required : Math.min(required, faction?.research?.progress[branch.id] ?? 0),
      required, cost: required, complete: !!level, next: level ? undefined : branch.tiers[0], prerequisites: branch.prerequisites,
      priority: index < 0 ? undefined : index + 1 };
  });
  const selected = branches.find(branch => branch.id === focus)!, completed = !resolved, rate = snapshot.rate;
  return { focus, requestedFocus: requested, allocation, priorities: queue, level: selected.level, progress: selected.progress,
    required: selected.required, cost: selected.cost, rate, library, completed, selectedComplete: selected.complete,
    prerequisite: requested !== focus ? focus : undefined,
    active: snapshot.active, branches };
}
type ResearchResult = { ok: boolean; message: string };
function controlFaction(state: GameState, building: Building): Faction | ResearchResult {
  const faction = state.factions.find(candidate => candidate.id === building.faction);
  if (building.kind !== 'library' || building.faction !== playerFaction(state) || !faction || faction.defeated || !state.buildings.includes(building))
    return { ok: false, message: 'Choose your own library.' };
  if (!buildingActivityAvailable(state, building)) return { ok: false, message: `Move your Leader within ${BUILDING_ACTIVITY_RANGE} tiles of the completed library.` };
  return faction;
}
export function setResearchAllocation(state: GameState, building: Building, allocation: number): ResearchResult {
  const faction = controlFaction(state, building); if ('ok' in faction) return faction;
  const result = runNativeResearch(state, faction, nativeContext(state, faction, true), 5, 0, 0, 1, allocation);
  if (result.error) return { ok: false, message: 'Choose a research share from 0% to 100%.' };
  return { ok: true, message: `${Math.round(allocation * 100)}% of gold income allocated to research.` };
}
export function prioritizeResearch(state: GameState, building: Building, branch: ResearchBranchId): ResearchResult {
  const faction = controlFaction(state, building); if ('ok' in faction) return faction;
  const result = runNativeResearch(state, faction, nativeContext(state, faction, true), 3, 0, 0, 1, nativeResearchIndex(branch));
  if (result.error) return { ok: false, message: 'Choose an unfinished technology.' };
  return { ok: true, message: `Prioritizing ${branchById(branch).label}. Required technologies are researched first.` };
}
export function removeResearchPriority(state: GameState, building: Building, branch: ResearchBranchId): ResearchResult {
  const faction = controlFaction(state, building); if ('ok' in faction) return faction;
  const result = runNativeResearch(state, faction, nativeContext(state, faction, true), 4, 0, 0, 1, nativeResearchIndex(branch));
  if (result.error) return { ok: false, message: 'Choose a research priority.' };
  return { ok: true, message: 'Research priority removed. Earlier progress is retained.' };
}
function applyResearchCompletion(state: GameState, faction: Faction, focus: ResearchBranchId): void {
  const tier = branchById(focus).tiers[0];
  if (focus === 'reinforcedDefenses') updateDefenseResearch(state);
  if (focus === 'metalTools') updateConstructionResearch(state, true);
  if (focus === 'urbanPlanning') for (const house of state.buildings)
    if (house.kind === 'house' && house.faction === faction.id) house.capacity = houseCapacity(house, faction, state);
  invalidateSettlementDecisions(state);
  if (isHumanFaction(state, faction.id) && state.events) {
    state.events.unshift({ id: (state.events[0]?.id ?? 0) + 1, time: state.time, kind: 'good', text: `Research complete: ${tier.name}. ${tier.description}` });
    state.events.length = Math.min(state.events.length, 40);
  }
}
/** Reserve only paid Science for the unfinished tree. Native systems own
 * allocation, efficiency, funding merges and the rolling receipt window. */
export function advanceResearchIncome(state: GameState, faction: Faction, grossGold: number): number {
  const library = hasLibrary(state, faction.id);
  return runNativeResearch(state, faction, nativeContext(state, faction, library), 1, 0, grossGold,
    library ? libraryResearchMultiplier(state, faction.id) : 1).divertedGold;
}
/** Native completion events retain their order; the browser applies only
 * derived-building updates, ledger refunds, and existing player messages. */
export function updateResearch(state: GameState, dt: number): void {
  if (!Number.isFinite(dt) || dt <= 0 || state.paused || state.gameOver) return;
  for (const faction of state.factions) if (faction.research && !faction.defeated) {
    const result = runNativeResearch(state, faction, nativeContext(state, faction, hasLibrary(state, faction.id)), 2, dt);
    if (result.refundedGold > 0) refundGold(state, faction, result.refundedGold);
    for (const focus of result.completions) {
      rustEngine.sim_campaign_researched(simCore(state).handle, faction.id);
      applyResearchCompletion(state, faction, focus);
    }
  }
}

/** Apply a technology transfer already validated by the diplomacy ECS. The
 * research engine owns completion, priority cleanup and excess-funding refunds. */
export function receiveDiplomaticTechnology(state: GameState, factionId: number, branch: ResearchBranchId): void {
  const faction = state.factions.find(item => item.id === factionId);
  if (!faction) return;
  const result = runNativeResearch(state, faction, nativeContext(state, faction, hasLibrary(state, factionId)), 6, 0, 0, 1, nativeResearchIndex(branch));
  if (result.error) throw new Error('Diplomacy and research technology validation disagree.');
  if (result.refundedGold > 0) refundGold(state, faction, result.refundedGold);
  for (const completed of result.completions) applyResearchCompletion(state, faction, completed);
}

/** Exploration uses the same native completion command as diplomacy. */
export function grantExplorationTechnology(state: GameState, faction: Faction, branch: ResearchBranchId): void {
  const result = runNativeResearch(state, faction, nativeContext(state, faction, hasLibrary(state, faction.id)), 6, 0, 0, 1, nativeResearchIndex(branch));
  for (const completed of result.completions) applyResearchCompletion(state, faction, completed);
}
