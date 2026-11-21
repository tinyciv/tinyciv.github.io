import { rustEngine } from './rust-engine';
import { SIM_ENGINE, SimSlot, simCore, type SimCore } from './sim-handle';
import type { Faction, GameState, ResearchBranchId, ResearchState } from './types';

const INPUT_HEADER = 16, OUTPUT_HEADER = 22;
const CREATED = 1, FOCUS = 2, CREDIT = 4, RESERVED = 8, FUNDING = 16, RECEIPTS = 32, PRIORITIES = 64, ALLOCATION = 128, TRADE_CREDIT = 512;
// Each call imports the whole account from Faction.research, so one engine
// per game serves every faction (resident accounts arrive in plan step 20).
const engines = new SimSlot<NativeResearch>();
let ids: ResearchBranchId[] = [];
const indices = new Map<ResearchBranchId, number>();

/** Costs and the dependency graph are content. Upload once, retaining labels
 * and descriptions in TypeScript for the existing interface. */
export function installResearchContent(branches: readonly { id: ResearchBranchId; prerequisites: readonly ResearchBranchId[];
  tiers: readonly { points: number }[]; fixedCost?: boolean; costScale?: number }[]): void {
  if (ids.length) throw new Error('Research content is already installed.');
  if (!branches.length || branches.length > 53) throw new Error('Research content requires between 1 and 53 technologies.');
  ids = branches.map(branch => branch.id);
  ids.forEach((id, index) => indices.set(id, index));
  const pointer = rustEngine.research_graph_prepare(ids.length), input = new Float64Array(rustEngine.memory.buffer, pointer, ids.length * 3);
  branches.forEach((branch, index) => {
    let prerequisites = 0;
    for (const id of branch.prerequisites) {
      const prerequisite = indices.get(id);
      if (prerequisite === undefined) throw new Error(`Unknown research prerequisite: ${id}`);
      prerequisites += 2 ** prerequisite;
    }
    const row = index * 3;
    input[row] = branch.tiers[0].points;
    input[row + 1] = prerequisites;
    input[row + 2] = branch.fixedCost ? 0 : branch.costScale ?? 1;
  });
  rustEngine.research_graph_commit(ids.length);
}

export const nativeResearchIndex = (id: ResearchBranchId): number => indices.get(id) ?? -1;
export const nativeResearchCost = (id: ResearchBranchId, bonus: number, scenario = 0): number => rustEngine.research_cost(nativeResearchIndex(id), bonus, scenario);
export interface ResearchContext { now: number; library: boolean; defeated: boolean; gameOver: boolean; paused: boolean }
export interface ResearchSnapshot {
  flags: number; error: number; resolved?: ResearchBranchId; focus: ResearchBranchId; allocation: number;
  credit: number; tradeCredit: number; earnedScience: number; reservedGold: number; reservedScience: number; refundedGold: number; divertedGold: number;
  priorities: ResearchBranchId[]; funding: NonNullable<ResearchState['funding']>; receipts: NonNullable<ResearchState['receipts']>;
  completions: ResearchBranchId[]; rate: number; remainingScience: number; active: boolean;
  levelsChanged: number; progressChanged: number;
  branches: { id: ResearchBranchId; rawLevel: number; rawProgress: number; level: number; required: number }[];
}
const changed = (mask: number, index: number): boolean => Math.floor(mask / 2 ** index) % 2 === 1;

class NativeResearch {
  private readonly handle: number;
  private input?: Float64Array;
  constructor(readonly core: SimCore) { this.handle = core.engine(this, SIM_ENGINE.research); }
  operation(faction: Faction | undefined, context: ResearchContext, mode: number, elapsed: number, gross: number,
    efficiency: number, target: number, scenario: number): ResearchSnapshot {
    const research = faction?.research, priorities = research?.priorities ?? [], funding = research?.funding ?? [], receipts = research?.receipts ?? [];
    const pointer = rustEngine.research_prepare(this.handle, priorities.length, funding.length, receipts.length);
    const length = INPUT_HEADER + 2 * ids.length + priorities.length + 2 * funding.length + 2 * receipts.length;
    if (!this.input || this.input.buffer !== rustEngine.memory.buffer || this.input.byteOffset !== pointer || this.input.length < length)
      this.input = new Float64Array(rustEngine.memory.buffer, pointer, length);
    const input = this.input;
    input[0] = Number(!!research); input[1] = nativeResearchIndex(research?.focus ?? ids[0]);
    input[2] = research?.allocation ?? NaN; input[3] = research?.credit ?? NaN; input[4] = research?.reservedGold ?? NaN;
    input[5] = faction?.villageBonuses?.research ?? 0; input[6] = Number(context.library); input[7] = Number(context.defeated);
    input[8] = Number(context.gameOver); input[9] = Number(context.paused); input[10] = Number(research?.funding !== undefined);
    input[11] = Number(research?.receipts !== undefined); input[12] = Number(research?.priorities !== undefined); input[13] = Number(!!faction); input[14] = scenario; input[15] = research?.tradeCredit ?? 0;
    let offset = INPUT_HEADER;
    for (const id of ids) { input[offset++] = research?.levels[id] ?? NaN; input[offset++] = research?.progress[id] ?? NaN; }
    for (const id of priorities) input[offset++] = nativeResearchIndex(id);
    for (const receipt of funding) { input[offset++] = receipt.points; input[offset++] = receipt.remaining; }
    for (const receipt of receipts) { input[offset++] = receipt.time; input[offset++] = receipt.points; }
    const outputPointer = rustEngine.research_run(this.handle, mode, context.now, elapsed, gross, efficiency, target);
    const header = new Float64Array(rustEngine.memory.buffer, outputPointer, OUTPUT_HEADER);
    const priorityCount = header[11], fundingCount = header[12], receiptCount = header[13], completionCount = header[14];
    const output = new Float64Array(rustEngine.memory.buffer, outputPointer,
      OUTPUT_HEADER + 4 * ids.length + priorityCount + 2 * fundingCount + 2 * receiptCount + completionCount);
    const snapshot: ResearchSnapshot = { flags: output[0], error: output[1], resolved: output[2] < 0 ? undefined : ids[output[2]],
      focus: ids[output[3]] ?? ids[0], allocation: output[4], credit: output[5], reservedGold: output[6], reservedScience: output[7],
      refundedGold: output[8], divertedGold: output[9], priorities: [], funding: [], receipts: [], completions: [],
      tradeCredit: output[20], earnedScience: output[21], rate: output[15], remainingScience: output[16], active: !!output[17], levelsChanged: output[18], progressChanged: output[19], branches: [] };
    offset = OUTPUT_HEADER;
    for (const id of ids) snapshot.branches.push({ id, rawLevel: output[offset++], rawProgress: output[offset++], level: output[offset++], required: output[offset++] });
    for (let index = 0; index < priorityCount; index++) snapshot.priorities.push(ids[output[offset++]]);
    for (let index = 0; index < fundingCount; index++) snapshot.funding.push({ points: output[offset++], remaining: output[offset++] });
    for (let index = 0; index < receiptCount; index++) snapshot.receipts.push({ time: output[offset++], points: output[offset++] });
    for (let index = 0; index < completionCount; index++) snapshot.completions.push(ids[output[offset++]]);
    // Copy native events and state before any derived-building callback can
    // grow WASM memory. Query mode publishes no JavaScript mutations.
    if (faction && snapshot.flags) publish(faction, snapshot);
    return snapshot;
  }
}

function publish(faction: Faction, snapshot: ResearchSnapshot): void {
  if (snapshot.flags & CREATED) faction.research ??= { focus: ids[0], levels: {}, progress: {} };
  const research = faction.research!;
  if (snapshot.flags & FOCUS) research.focus = snapshot.focus;
  if (snapshot.flags & TRADE_CREDIT) research.tradeCredit = snapshot.tradeCredit;
  if (snapshot.flags & CREDIT) research.credit = snapshot.credit;
  if (snapshot.flags & RESERVED) research.reservedGold = snapshot.reservedGold;
  if (snapshot.flags & FUNDING) research.funding = snapshot.funding;
  if (snapshot.flags & RECEIPTS) research.receipts = snapshot.receipts;
  if (snapshot.flags & PRIORITIES) research.priorities = snapshot.priorities;
  if (snapshot.flags & ALLOCATION) research.allocation = snapshot.allocation;
  snapshot.branches.forEach((branch, index) => {
    if (changed(snapshot.levelsChanged, index)) research.levels[branch.id] = branch.rawLevel;
    if (changed(snapshot.progressChanged, index)) research.progress[branch.id] = branch.rawProgress;
  });
}

export function runNativeResearch(state: GameState, faction: Faction | undefined, context: ResearchContext, mode = 0,
  elapsed = 0, gross = 0, efficiency = 1, target = 0): ResearchSnapshot {
  const engine = engines.get(state) ?? engines.set(state, new NativeResearch(simCore(state)));
  return engine.operation(faction, context, mode, elapsed, gross, efficiency, target, (state.world.scenario === 'tutorial' || state.world.scenario === 'island-deathmatch') ? 2 : 0);
}
