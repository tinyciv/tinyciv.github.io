import { playerFaction, isHumanFaction } from './player-context';
import { buildingActivityAvailable, BUILDING_ACTIVITY_RANGE } from './building-activity';
import { updateDefenseResearch } from './defense-research';
import { updateConstructionResearch } from './structures';
import { houseCapacity } from './wells';
import { invalidateSettlementDecisions } from './settlement-decisions';
import { entityStore } from './entity-store';
import { refundGold } from './gold-ledger';
import { buildingReady, type Building, type BuildingKind, type Faction, type GameState, type ResearchBranchId, type ResearchState } from './types';
export type { ResearchBranchId } from './types';

export interface ResearchTier { name: string; points: number; description: string }
export interface ResearchBranch { id: ResearchBranchId; label: string; prerequisites: readonly ResearchBranchId[]; tiers: readonly ResearchTier[] }
const BASE_RESEARCH_BRANCHES: readonly ResearchBranch[] = [
  { id: 'woodenTower', label: 'Fortification', prerequisites: [], tiers: [{ name: 'Fortification', points: 24, description: 'Unlocks wooden towers, guard posts, militia, and settlement upgrades to Keeps with ten times the health.' }] },
  { id: 'wall', label: 'Masonry', prerequisites: ['woodenTower'], tiers: [{ name: 'Masonry', points: 24, description: 'Unlocks walls and gates.' }] },
  { id: 'monument', label: 'Statehood', prerequisites: ['grainStorage'], tiers: [{ name: 'Statehood', points: 42, description: 'Unlocks culture-producing monuments.' }] },
  { id: 'blacksmith', label: 'Bronze Working', prerequisites: ['wall'], tiers: [{ name: 'Bronze Working', points: 87, description: 'Unlocks blacksmiths and armor/weapon upgrades.' }] },
  { id: 'archeryRange', label: 'Archery', prerequisites: ['scoutLodge'], tiers: [{ name: 'Archery', points: 63, description: 'Unlocks archery ranges, archer training, and recruits.' }] },
  { id: 'irrigation', label: 'Irrigation', prerequisites: [], tiers: [{ name: 'Irrigation', points: 30, description: 'Unlocks irrigation channels for watering farms.' }] },
  { id: 'scoutLodge', label: 'Exploration', prerequisites: [], tiers: [{ name: 'Exploration', points: 30, description: 'Unlocks Scouts’ Lodges. Each lodge maintains two fast, noncombat scouts that automatically explore the world.' }] },
  { id: 'sailing', label: 'Sailing', prerequisites: ['scoutLodge'], tiers: [{ name: 'Sailing', points: 30, description: 'Unlocks coastal docks. Each dock launches a rowboat for the Leader and a sailboat for fishing. Cities beside the same navigable river can also establish automatic river trade.' }] },
  { id: 'traditionalMedicine', label: 'Traditional Medicine', prerequisites: ['grainStorage', 'scoutLodge'], tiers: [{ name: 'Traditional Medicine', points: 42, description: 'Unlocks healers’ shacks: friendly units within four tiles heal three times faster inside their borders, after the normal recovery delay. Overlapping shacks do not stack.' }] },
  { id: 'reinforcedDefenses', label: 'Reinforced Defenses', prerequisites: ['metalTools'], tiers: [{ name: 'Reinforced Defenses', points: 63, description: 'Walls and towers gain 30% maximum health.' }] },
  { id: 'coinage', label: 'Coinage', prerequisites: ['monument', 'sailing'], tiers: [{ name: 'Coinage', points: 54, description: 'Caravan deliveries earn 20% more gold.' }] },
  { id: 'urbanPlanning', label: 'Urban Planning', prerequisites: ['coinage', 'metalTools'], tiers: [{ name: 'Urban Planning', points: 75, description: 'Each house gains one housing place.' }] },
  { id: 'metalTools', label: 'Metal Tools', prerequisites: ['blacksmith'], tiers: [{ name: 'Metal Tools', points: 63, description: 'Construction and repair speed increases by 25%.' }] },
  { id: 'fletching', label: 'Fletching', prerequisites: ['archeryRange', 'metalTools'], tiers: [{ name: 'Fletching', points: 42, description: 'Archers deal 15% more damage.' }] },
  { id: 'grainStorage', label: 'Grain Storage', prerequisites: ['irrigation'], tiers: [{ name: 'Grain Storage', points: 42, description: 'Newly harvested grain stays fresh 50% longer, including while carried.' }] },
  { id: 'militaryTactics', label: 'Military Tactics', prerequisites: ['blacksmith', 'archeryRange'], tiers: [{ name: 'Military Tactics', points: 63, description: 'Unlocks spearmen at blacksmiths: stronger armor and thrusts piercing two enemies behind the first.' }] },
  { id: 'infantryDrill', label: 'Infantry Drill', prerequisites: ['militaryTactics'], tiers: [{ name: 'Infantry Drill', points: 42, description: 'Unlocks Formation 3 for the Leader’s retinue.' }] },
  { id: 'siegeEngines', label: 'Siege Engines', prerequisites: ['reinforcedDefenses', 'fletching'], tiers: [{ name: 'Siege Engines', points: 87, description: 'Unlocks stationary ballistae: eighteen-tile range, automatic assembly outside borders, and slow heavy bolts aimed at defenses.' }] },
  { id: 'horsebackRiding', label: 'Horseback Riding', prerequisites: ['infantryDrill'], tiers: [{ name: 'Horseback Riding', points: 87, description: 'Unlocks stables and fast, powerful horsemen. Assign mounted retinue at a stable; running charges deal bonus damage and area damage.' }] },
  { id: 'supplyTrain', label: 'Supply train', prerequisites: ['traditionalMedicine'], tiers: [{ name: 'Supply train', points: 54, description: 'Unlocks supply depots. Each sends a vulnerable, population-free handcart to the Leader every 30 seconds. Delivery heals the Leader and all friendly units by up to 10 HP. Destroyed carts award no gold.' }] },
  { id: 'massLevy', label: 'Mass levy', prerequisites: ['militaryTactics'], tiers: [{ name: 'Mass levy', points: 63, description: 'The Leader can levy up to one third of the population. Levy infantry fight on formation wings with half warrior attack and defense, equipment upgrades, and 80% morale. Upkeep is 5 gold per soldier every 30 seconds; bankruptcy sends them home.' }] },
];
const baseBranchById = new Map(BASE_RESEARCH_BRANCHES.map(branch => [branch.id, branch]));
const depthCache = new Map<ResearchBranchId, number>();
function researchDepth(id: ResearchBranchId): number {
  if (!depthCache.has(id)) depthCache.set(id, Math.max(-1, ...baseBranchById.get(id)!.prerequisites.map(researchDepth)) + 1);
  return depthCache.get(id)!;
}
const researchStages = Math.max(...BASE_RESEARCH_BRANCHES.map(branch => researchDepth(branch.id))) + 1;
/** Fortification retains its introductory price. Every later branch ramps
 * linearly by dependency stage, reaching five times its old cost at the end. */
export const RESEARCH_BRANCHES: readonly ResearchBranch[] = BASE_RESEARCH_BRANCHES.map(branch => ({
  ...branch, tiers: branch.tiers.map(tier => ({ ...tier, points: branch.id === 'woodenTower' ? tier.points
    : Math.round(tier.points * (1 + 4 * (researchDepth(branch.id) + 1) / researchStages)) * (branch.id === 'scoutLodge' ? .5 : 1) })),
}));
const branchById = (id: ResearchBranchId): ResearchBranch => RESEARCH_BRANCHES.find(branch => branch.id === id)!;
export function researchLevel(faction: Pick<Faction, 'research'> | undefined, branch: ResearchBranchId): number {
  return Math.max(0, Math.min(1, Math.floor(faction?.research?.levels[branch] ?? 0)));
}
export function buildingResearchRequirement(kind: BuildingKind): ResearchBranchId | undefined {
  if (kind === 'supplyDepot') return 'supplyTrain';
  if (kind === 'fort') return 'wall';
  return kind === 'stable' ? 'horsebackRiding' : kind === 'dock' ? 'sailing' : kind === 'ballista' ? 'siegeEngines' : kind === 'healerShack' ? 'traditionalMedicine' : kind === 'wall' ? 'wall' : kind === 'woodenTower' || kind === 'tower' || kind === 'guardPost' ? 'woodenTower'
    : ['monument', 'blacksmith', 'archeryRange', 'irrigation', 'scoutLodge'].includes(kind) ? kind as ResearchBranchId : undefined;
}
export function isBuildingUnlocked(faction: Pick<Faction, 'research'> | undefined, kind: BuildingKind): boolean {
  const requirement = buildingResearchRequirement(kind);
  return !requirement || researchLevel(faction, requirement) > 0;
}
export const areArchersUnlocked = (faction: Pick<Faction, 'research'> | undefined): boolean => researchLevel(faction, 'archeryRange') > 0;
export const areScoutsUnlocked = (faction: Pick<Faction, 'research'> | undefined): boolean => researchLevel(faction, 'scoutLodge') > 0;
export const areSpearmenUnlocked = (faction: Pick<Faction, 'research'> | undefined): boolean => researchLevel(faction, 'militaryTactics') > 0;
export const areHorsemenUnlocked = (faction: Pick<Faction, 'research'> | undefined): boolean => researchLevel(faction, 'horsebackRiding') > 0;
export const isInfantryDrillUnlocked = (faction: Pick<Faction, 'research'> | undefined): boolean => researchLevel(faction, 'infantryDrill') > 0;
export const DEFAULT_RESEARCH_ALLOCATION = .25;
export const RESEARCH_INCOME_WINDOW = 30;
/** Spread each paid receipt across the normal tax period instead of applying a lump sum. */
export const RESEARCH_FUNDING_SECONDS = 30;
/** At most 1% per 0.2s: the 150ms HUD cadence can display every percentage. */
export const RESEARCH_PERCENT_PER_SECOND = 5;
const branchIds = new Set(RESEARCH_BRANCHES.map(branch => branch.id));
export function researchAllocation(faction: Pick<Faction, 'research'> | undefined): number {
  const value = faction?.research?.allocation;
  return value === undefined || !Number.isFinite(value) ? DEFAULT_RESEARCH_ALLOCATION : Math.max(0, Math.min(1, value));
}
function ensureResearch(faction: Faction): ResearchState {
  return faction.research ??= { focus: 'woodenTower', levels: {}, progress: {} };
}
function priorities(faction: Faction | undefined): ResearchBranchId[] {
  return [...new Set(faction?.research?.priorities ?? [])].filter(id => branchIds.has(id) && !researchLevel(faction, id));
}
/** Village scholars reduce the work required; every diverted gold still buys exactly one point. */
export function researchCost(faction: Faction | undefined, id: ResearchBranchId): number {
  return branchById(id).tiers[0].points / (1 + Math.max(0, faction?.villageBonuses?.research ?? 0));
}
function resolveFocus(faction: Faction | undefined): ResearchBranchId | undefined {
  const requested = priorities(faction)[0], needed = new Set<ResearchBranchId>();
  const visit = (id: ResearchBranchId): void => {
    if (researchLevel(faction, id) || needed.has(id)) return;
    needed.add(id); for (const prerequisite of branchById(id).prerequisites) visit(prerequisite);
  };
  if (requested) visit(requested);
  return RESEARCH_BRANCHES.filter(branch => !researchLevel(faction, branch.id)
    && (!requested || needed.has(branch.id)) && branch.prerequisites.every(id => researchLevel(faction, id)))
    .reduce<ResearchBranch | undefined>((best, branch) => !best || researchCost(faction, branch.id) < researchCost(faction, best.id) ? branch : best, undefined)?.id;
}
function hasLibrary(state: GameState, factionId: number): boolean {
  return entityStore(state).buildings.query('library').some(building => building.faction === factionId && buildingReady(building));
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
  const faction = state.factions.find(candidate => candidate.id === factionId), queue = priorities(faction);
  const resolved = resolveFocus(faction), focus = resolved ?? faction?.research?.focus ?? 'woodenTower';
  const requested = queue[0] ?? focus, allocation = researchAllocation(faction);
  const branches = RESEARCH_BRANCHES.map(branch => {
    const level = researchLevel(faction, branch.id), required = researchCost(faction, branch.id), index = queue.indexOf(branch.id);
    return { id: branch.id, label: branch.label, level, progress: level ? required : Math.min(required, faction?.research?.progress[branch.id] ?? 0),
      required, cost: required, complete: !!level, next: level ? undefined : branch.tiers[0], prerequisites: branch.prerequisites,
      priority: index < 0 ? undefined : index + 1 };
  });
  const selected = branches.find(branch => branch.id === focus)!, completed = !resolved, library = hasLibrary(state, factionId);
  const rate = (faction?.research?.receipts ?? []).reduce((sum, receipt) => receipt.time > state.time - RESEARCH_INCOME_WINDOW && receipt.time <= state.time ? sum + receipt.points : sum, 0) / RESEARCH_INCOME_WINDOW;
  return { focus, requestedFocus: requested, allocation, priorities: queue, level: selected.level, progress: selected.progress,
    required: selected.required, cost: selected.cost, rate, library, completed, selectedComplete: selected.complete,
    prerequisite: requested !== focus ? focus : undefined,
    active: !!faction && !faction.defeated && !state.gameOver && !state.paused && library && !completed && (allocation > 0 || reservedScience(faction.research) > 0), branches };
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
  if (!Number.isFinite(allocation) || allocation < 0 || allocation > 1) return { ok: false, message: 'Choose a research share from 0% to 100%.' };
  ensureResearch(faction).allocation = allocation;
  return { ok: true, message: `${Math.round(allocation * 100)}% of gold income allocated to research.` };
}
export function prioritizeResearch(state: GameState, building: Building, branch: ResearchBranchId): ResearchResult {
  const faction = controlFaction(state, building); if ('ok' in faction) return faction;
  if (!branchIds.has(branch) || researchLevel(faction, branch)) return { ok: false, message: 'Choose an unfinished technology.' };
  const research = ensureResearch(faction);
  research.priorities = [branch, ...priorities(faction).filter(id => id !== branch)];
  research.focus = resolveFocus(faction)!;
  return { ok: true, message: `Prioritizing ${branchById(branch).label}. Required technologies are researched first.` };
}
export function removeResearchPriority(state: GameState, building: Building, branch: ResearchBranchId): ResearchResult {
  const faction = controlFaction(state, building); if ('ok' in faction) return faction;
  if (!branchIds.has(branch)) return { ok: false, message: 'Choose a research priority.' };
  const research = ensureResearch(faction); research.priorities = priorities(faction).filter(id => id !== branch);
  research.focus = resolveFocus(faction) ?? research.focus;
  return { ok: true, message: 'Research priority removed. Earlier progress is retained.' };
}
function completeResearch(state: GameState, faction: Faction, focus: ResearchBranchId): void {
  const research = ensureResearch(faction), tier = branchById(focus).tiers[0];
  research.levels[focus] = 1; research.progress[focus] = researchCost(faction, focus);
  research.priorities = priorities(faction);
  if (focus === 'reinforcedDefenses') updateDefenseResearch(state);
  if (focus === 'metalTools') updateConstructionResearch(state, true);
  if (focus === 'urbanPlanning') for (const house of state.buildings)
    if (house.kind === 'house' && house.faction === faction.id) house.capacity = houseCapacity(house, faction);
  invalidateSettlementDecisions(state);
  if (isHumanFaction(state, faction.id) && state.events) {
    state.events.unshift({ id: (state.events[0]?.id ?? 0) + 1, time: state.time, kind: 'good', text: `Research complete: ${tier.name}. ${tier.description}` });
    state.events.length = Math.min(state.events.length, 40);
  }
}
/** Science already paid for, whether still releasing or ready for the next step. */
function reservedScience(research: ResearchState | undefined): number {
  return Math.max(0, research?.credit ?? 0) + (research?.funding ?? []).reduce((sum, receipt) => sum + receipt.points, 0);
}
function remainingScience(faction: Faction): number {
  return RESEARCH_BRANCHES.reduce((sum, branch) => sum + (researchLevel(faction, branch.id) ? 0
    : Math.max(0, researchCost(faction, branch.id) - (faction.research?.progress[branch.id] ?? 0))), 0);
}
/** A new scholar alliance can reduce a previously funded bill. Return excess
 * reserves as a refund, never as taxable income or another research receipt. */
function refundExcessScience(state: GameState, faction: Faction): void {
  const research = faction.research;
  if (!research) return;
  const reserved = reservedScience(research); if (reserved <= 1e-9) return;
  const excess = reserved - remainingScience(faction);
  if (excess <= 1e-8) return;
  let remaining = excess;
  const credit = Math.min(remaining, research.credit ?? 0);
  research.credit = Math.max(0, (research.credit ?? 0) - credit); remaining -= credit;
  for (let index = (research.funding?.length ?? 0) - 1; index >= 0 && remaining > 1e-9; index--) {
    const receipt = research.funding![index], removed = Math.min(remaining, receipt.points);
    receipt.points -= removed; remaining -= removed;
    if (receipt.points <= 1e-9) research.funding!.splice(index, 1);
  }
  refundGold(state, faction, excess - remaining);
}
/** Called once per positive gold receipt. Reserve only the unfinished tree's
 * remaining work; surplus gold is never trapped after the tree is fully funded. */
export function advanceResearchIncome(state: GameState, faction: Faction, grossGold: number): number {
  if (!Number.isFinite(grossGold) || grossGold <= 0 || faction.defeated || state.gameOver || !hasLibrary(state, faction.id)) return 0;
  const offered = grossGold * researchAllocation(faction); if (!offered) return 0;
  const focus = resolveFocus(faction); if (!focus) return 0;
  const research = ensureResearch(faction);
  const diverted = Math.min(offered, Math.max(0, remainingScience(faction) - reservedScience(research)));
  if (diverted <= 1e-9) return 0;
  research.focus = focus;
  const funding = research.funding ??= [], previous = funding.at(-1);
  if (previous?.remaining === RESEARCH_FUNDING_SECONDS) previous.points += diverted;
  else funding.push({ points: diverted, remaining: RESEARCH_FUNDING_SECONDS });
  research.receipts = (research.receipts ?? []).filter(receipt => receipt.time > state.time - RESEARCH_INCOME_WINDOW);
  const last = research.receipts.at(-1), second = Math.floor(state.time);
  if (last?.time === second) last.points += diverted; else research.receipts.push({ time: second, points: diverted });
  return diverted;
}
/** Release previously purchased Science over time. A simulation step advances
 * at most one displayed percentage point, even after a very large trade payout. */
export function updateResearch(state: GameState, dt: number): void {
  if (!Number.isFinite(dt) || dt <= 0 || state.paused || state.gameOver) return;
  for (const faction of state.factions) if (faction.research && !faction.defeated) {
    const research = faction.research;
    refundExcessScience(state, faction);
    let focus = resolveFocus(faction);
    if (!focus) continue;
    research.focus = focus;
    if (!hasLibrary(state, faction.id)) continue;
    let credit = Math.max(0, research.credit ?? 0);
    for (const receipt of research.funding ?? []) {
      const elapsed = Math.min(dt, receipt.remaining);
      const released = receipt.remaining > 0 ? receipt.points * elapsed / receipt.remaining : receipt.points;
      credit += released; receipt.points -= released; receipt.remaining -= elapsed;
    }
    if (research.funding) research.funding = research.funding.filter(receipt => receipt.points > 1e-9 && receipt.remaining > 1e-9);
    let elapsed = dt;
    for (let pass = 0; focus && pass < RESEARCH_BRANCHES.length && elapsed > 1e-9; pass++) {
      research.focus = focus;
      const required = researchCost(faction, focus), previous = research.progress[focus] ?? 0;
      if (previous + 1e-8 >= required) {
        completeResearch(state, faction, focus); focus = resolveFocus(faction); continue;
      }
      if (credit <= 1e-9) break;
      const rate = required * RESEARCH_PERCENT_PER_SECOND / 100;
      const spent = Math.min(credit, Math.max(0, required - previous), rate * elapsed);
      research.progress[focus] = previous + spent; credit -= spent; elapsed -= spent / rate;
      if (research.progress[focus]! + 1e-8 < required) break;
      completeResearch(state, faction, focus); focus = resolveFocus(faction);
    }
    research.credit = Math.max(0, credit);
    if (focus) research.focus = focus;
  }
}
