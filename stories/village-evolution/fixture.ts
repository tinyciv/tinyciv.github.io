/**
 * Village evolution fixture (design: docs/loyalty-affiliation-design.md, section 13).
 *
 * DOM-free, so it also runs in Node via vite-node. Every state is real:
 * generateWorld -> createGame -> updateGame (Rust settlement core included),
 * with a fixed seed per layout family. The only scenario edits are game
 * actions a player could take on the first tick:
 *  - the player's Leader establishes trade with the village (performVillageAction,
 *    the same path as the village popup), which gives the village caravan income;
 *  - the player builds an "adoption quarter" (library, blacksmith, wooden tower,
 *    healer's shack, monument, and a dock by the riverside village) on its own land
 *    facing the village, through the real build path (buildStroke);
 *  - the alliance is formed as soon as the village offers it;
 *  - the design's scripted trade receipt (30 gold every 60 s, section 13) is booked
 *    through settlement_trade, the call a finished caravan makes.
 * Rival civilizations are removed from the generated spawns so a 2600 s run stays
 * affordable in the browser, and bandits are off so nothing interrupts the clocks.
 */
import { generateWorld } from '../../src/world/generator';
import { createGame, updateGame } from '../../src/game/simulation';
import { RESEARCH_BRANCHES, buildingResearchRequirement } from '../../src/game/research';
import { performVillageAction, villageCamp, villageDiplomacyStatus } from '../../src/game/villages';
import { FAMILY_NAMES, STAGE_NAMES, settlementTrade, villageAlliedWith, villageStage } from '../../src/game/settlement-bridge';
import { setMapRevealed } from '../../src/game/fog';
import type { BuildingKind, GameState, NeutralVillage, Point, ResearchBranchId } from '../../src/game/types';
import { IDLE_INPUT, scenarioTools } from '../harness/scenario';

export type FamilyId = 1 | 2 | 3 | 4;

export interface EvolutionDefinition {
  id: string;
  family: FamilyId;
  /** Generated world seed (the player's civilization only). */
  seed: string;
  /** World size in tiles (default 64 x 64, the generator's minimum). */
  size?: number;
  /** Village id in that world with the wanted family. */
  village: number;
  /** Stage reached at each EVOLUTION_TIMES entry; a balance change that shifts a gate fails loudly. */
  expectedStages?: readonly number[];
}

/** Just past each stage gate with caravan income (design 13: 0, 420, 1000, 1650, 2600 s). */
export const EVOLUTION_TIMES = [0, 420, 1000, 1650, 2600] as const;
export const TIMESTEP_NAMES = ['Founding', 'Early', 'Mid', 'Developed', 'Mature'] as const;

/** Seeds were picked so the generator founds a village of the wanted family
 * that reaches stage 4 by 2600 s. Market cross is rare on 64-tile worlds and
 * its 64-tile candidates stalled at stage 1 (water inside the template), so it
 * uses an 80-tile world. */
export const EVOLUTION_DEFINITIONS = {
  roadside: { id: 'roadside', family: 1, seed: 'SB-Cross-146', village: 1, expectedStages: [0, 1, 2, 3, 4] },
  marketCross: { id: 'market-cross', family: 2, seed: 'SB-Cross-27', village: 1, size: 80, expectedStages: [0, 1, 2, 3, 4] },
  riverside: { id: 'riverside', family: 3, seed: 'SB-Village-37', village: 2, expectedStages: [0, 1, 2, 3, 4] },
  hillCluster: { id: 'hill-cluster', family: 4, seed: 'SB-Village-18', village: 1, expectedStages: [0, 1, 2, 3, 4] },
} as const satisfies Record<string, EvolutionDefinition>;
export type EvolutionKey = keyof typeof EVOLUTION_DEFINITIONS;
export const EVOLUTION_KEYS = Object.keys(EVOLUTION_DEFINITIONS) as EvolutionKey[];

export const familyName = (family: number): string => FAMILY_NAMES[family] || 'Unknown';
export const stageName = (stage: number): string => {
  const name = STAGE_NAMES[stage] ?? 'camp';
  return name[0].toUpperCase() + name.slice(1);
};

export interface EvolutionGame {
  state: GameState;
  village: NeutralVillage;
  /** Centre of the village civic lot, in world tiles. */
  center: Point;
  /** The player's capital (trade origin). */
  palace: number;
  /** Adoptable buildings the player placed for the village to learn from. */
  quarter: { kind: BuildingKind; x: number; y: number }[];
}

const QUARTER: readonly BuildingKind[] = ['library', 'blacksmith', 'woodenTower', 'healerShack', 'monument', 'woodenTower'];

function unlockResearch(state: GameState, kinds: readonly BuildingKind[]): void {
  const faction = state.factions[0];
  const research = faction.research ??= { focus: 'woodenTower', levels: {}, progress: {} };
  const unlock = (id: ResearchBranchId): void => {
    const branch = RESEARCH_BRANCHES.find(candidate => candidate.id === id);
    if (!branch) return;
    for (const prerequisite of branch.prerequisites) unlock(prerequisite);
    research.levels[id] = Math.max(1, research.levels[id] ?? 0);
  };
  for (const kind of kinds) { const required = buildingResearchRequirement(kind); if (required) unlock(required); }
}

/** Build one of each adoptable kind on the player's land, as close to the village as the rules allow. */
function buildQuarter(state: GameState, center: Point, kinds: readonly BuildingKind[]): EvolutionGame['quarter'] {
  const tools = scenarioTools(state);
  unlockResearch(state, kinds);
  const cells: Point[] = [];
  for (let y = 1; y < state.world.height - 2; y++) for (let x = 1; x < state.world.width - 2; x++) cells.push({ x, y });
  cells.sort((a, b) => Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y) || a.y - b.y || a.x - b.x);
  const placed: EvolutionGame['quarter'] = [];
  for (const kind of kinds) {
    // The validator rejects cells outside the player's borders and inside the village claim.
    for (const cell of cells.slice(0, 1600)) {
      const before = state.buildings.length;
      if (tools.build(kind, [cell]).placed > 0) {
        const building = state.buildings.slice(before).find(b => b.kind === kind);
        if (building) placed.push({ kind, x: building.x, y: building.y });
        break;
      }
    }
  }
  tools.completeConstruction();
  return placed;
}

/** A fresh game at t = 0 for one layout family, ready to be advanced with advanceEvolution. */
export function createEvolutionGame(definition: EvolutionDefinition): EvolutionGame {
  const world = generateWorld(definition.seed, definition.size ?? 64, definition.size ?? 64);
  world.spawns = world.spawns.slice(0, 1);
  world.secondarySpawns = [];
  const state = createGame(world, undefined, { banditIntensity: 0 });
  // One real tick publishes the village camps and settlement rows.
  updateGame(state, .1, IDLE_INPUT);
  const village = state.villages?.find(candidate => candidate.id === definition.village);
  if (!village) throw new Error(`Seed ${definition.seed} has no village ${definition.village}.`);
  if (village.layout?.family !== definition.family)
    throw new Error(`Seed ${definition.seed} village ${village.id} chose the ${familyName(village.layout?.family ?? 0)} layout, not ${familyName(definition.family)}.`);
  const lot = village.layout ? { x: village.layout.lotX, y: village.layout.lotY } : village;
  const center = { x: lot.x + 1, y: lot.y + 1 };
  const player = state.factions[0];
  player.gold = Math.max(player.gold, 2000);
  for (const candidate of state.villages ?? []) {
    const camp = villageCamp(state, candidate);
    if (camp) performVillageAction(state, camp, 'trade', true);
  }
  const quarter = buildQuarter(state, center, definition.family === 3 ? [...QUARTER, 'dock'] : QUARTER);
  // The build helper tops gold up; give the treasury back a plain mid-game value.
  player.gold = 3000;
  setMapRevealed(state, true);
  return { state, village, center, quarter, palace: scenarioTools(state).playerPalace().id };
}

/** Player diplomacy during the run: form the alliance as soon as the village
 * offers it (affiliation 45), through the same remote negotiation as the popup. */
function playerDiplomacy(game: EvolutionGame): void {
  const { state, village } = game, camp = villageCamp(state, village);
  if (!camp || villageAlliedWith(state, village, 0)) return;
  // The player has saved enough for the alliance price (about 3,000 gold).
  const player = state.factions[0];
  player.gold = Math.max(player.gold, 4000);
  if (villageDiplomacyStatus(state, camp, true)?.ally.available) performVillageAction(state, camp, 'ally', true);
}

const DIPLOMACY_INTERVAL = 10;
/** Design 13: a scripted trade receipt of 30 gold every 60 s from the player,
 * booked through the same settlement_trade call a finished caravan makes. */
export const TRADE_RECEIPT = { gold: 30, interval: 60 } as const;
const crossed = (before: number, after: number, interval: number) => Math.floor(after / interval) !== Math.floor(before / interval);
function stepEvolution(game: EvolutionGame, time: number): void {
  const state = game.state, before = state.time;
  updateGame(state, Math.min(.1, time - state.time), IDLE_INPUT);
  if (state.gameOver) throw new Error(`The game ended at t = ${state.time.toFixed(1)} s.`);
  if (crossed(before, state.time, DIPLOMACY_INTERVAL)) playerDiplomacy(game);
  if (crossed(before, state.time, TRADE_RECEIPT.interval) && !game.village.destroyed && game.village.confederatedInto === undefined)
    settlementTrade(state, game.village.campId, game.palace, 0, -1, TRADE_RECEIPT.gold, 1);
}

/** Advance the real simulation to `time` in 0.1 s steps, yielding to the page every `yieldEvery` steps. */
export async function advanceEvolution(game: EvolutionGame, time: number, options: { yieldEvery?: number; progress?: (time: number) => void } = {}): Promise<void> {
  const chunk = options.yieldEvery ?? 200;
  let steps = 0;
  while (game.state.time < time - 1e-6) {
    stepEvolution(game, time);
    if (++steps % chunk === 0) { options.progress?.(game.state.time); await new Promise(resolve => setTimeout(resolve, 0)); }
  }
}
export function advanceEvolutionSync(game: EvolutionGame, time: number): void {
  while (game.state.time < time - 1e-6) stepEvolution(game, time);
}

export interface VillageSnapshot {
  time: number;
  stage: number;
  buildings: Record<string, number>;
  adopted: string[];
}
const ADOPTABLE = new Set(['woodenTower', 'library', 'blacksmith', 'healerShack', 'dock', 'monument', 'scoutLodge', 'stable', 'archeryRange']);
export function villageSnapshot(state: GameState, village: NeutralVillage): VillageSnapshot {
  const buildings: Record<string, number> = {};
  for (const building of state.buildings) if (building.villageId === village.id && building.hp > 0) buildings[building.kind] = (buildings[building.kind] ?? 0) + 1;
  return { time: Math.round(state.time), stage: villageStage(state, village), buildings, adopted: Object.keys(buildings).filter(kind => ADOPTABLE.has(kind)).sort() };
}
