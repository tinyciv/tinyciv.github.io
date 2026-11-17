import { compileLogic, decodeLogic, logicSchema, type PolicyLogic } from './faction-ai-logic';
import schema from './faction-ai-policy-schema.json';
import { rustEngine } from './rust-engine';
import { SimSlot, simCore } from './sim-handle';
import type { GameState } from './types';

export type FactionAIProfile = string;
export const FACTION_AI_PROFILES: readonly string[] = Object.freeze(schema.builtins);
export const DEFAULT_FACTION_AI_PROFILE = schema.default;

export interface AIPolicyParameters {
  retreatHealth: number; retreatPowerRatio: number; huntPowerRatio: number; garrisonFraction: number;
  towerGarrisonCount: number; hostileTowerPower: number; hostileFortPower: number; friendlyTowerPower: number;
  campaignSafetyRatio: number; campaignDangerWeight: number; retreatMorale: number;
  recoveryHealth: number; recoveryMorale: number; recoveryPowerRatio: number; decisionInterval: number;
  formationEnterCount: number; formationStayCount: number;
  housingOrdersPerCycle: number; developmentInterval: number; cityLimit: number; populationPerCity: number;
  reserveUpkeepCycles: number; campaignCooldown: number; siegeLimit: number; fortsPerCity: number;
}
export interface AIPolicyFeatures {
  formations: boolean; militaryPurchases: boolean; towerGarrison: boolean; towerAwareness: boolean;
  interceptEnemies: boolean; defensiveLevy: boolean; campaignLevy: boolean; safeCampaigns: boolean; formationApproach: boolean;
  proactiveHousing: boolean; foundCities: boolean; fortifyCities: boolean; offensiveSiege: boolean; territorialWars: boolean;
}
export interface AIPolicyDefinition {
  id: string;
  extends?: string;
  parameters?: Partial<AIPolicyParameters>;
  features?: Partial<AIPolicyFeatures>;
  logic?: { [K in keyof PolicyLogic]?: PolicyLogic[K] | null };
}
export interface FactionAIPolicy {
  readonly id: string;
  readonly code: number;
  readonly logic: Readonly<PolicyLogic>;
  readonly parameters: Readonly<AIPolicyParameters>;
  readonly features: Readonly<AIPolicyFeatures>;
}
interface Catalog {
  names: string[];
  codes: Map<string, number>;
  views: Map<number, FactionAIPolicy>;
  factions: Map<number, FactionAIPolicy>;
}
const catalogs = new SimSlot<Catalog>();
const ROW = 1 + schema.parameters.length;
function catalog(state: GameState): Catalog {
  const existing = catalogs.get(state);
  if (existing) return existing;
  simCore(state);
  const names = [...(state.aiPolicyNames ?? schema.builtins)];
  return catalogs.set(state, { names, codes: new Map(names.map((name, code) => [name, code])), views: new Map(), factions: new Map() });
}
function readView(state: GameState, mode: number, index: number): FactionAIPolicy {
  const host = catalog(state);
  const pointer = rustEngine.sim_ai_policy_view(simCore(state).handle, mode, index);
  if (!pointer) throw new Error(`Unknown native AI policy ${index}`);
  const row = new Float64Array(rustEngine.memory.buffer, pointer, ROW + 1);
  const code = row[0];
  const cached = host.views.get(code);
  if (cached) return cached;
  // Copy numeric policy fields before another native call can grow WASM memory.
  const values = Array.from(row);
  const logicPointer = rustEngine.sim_ai_logic_view(simCore(state).handle, code);
  const length = new Float64Array(rustEngine.memory.buffer, logicPointer, 1)[0];
  const logicWords = Array.from(new Float64Array(rustEngine.memory.buffer, logicPointer, length));
  const logic: PolicyLogic = {}; let cursor = 2;
  for (let i = 0; i < logicWords[1]; i++) {
    const mode = logicWords[cursor++], size = logicWords[cursor++];
    const [name, expression] = decodeLogic(mode, logicWords.slice(cursor, cursor + size)); cursor += size;
    logic[name] = expression;
  }
  const freeze = (value: unknown): void => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } };
  freeze(logic);
  const policy = Object.freeze({ logic, code, id: host.names[code] ?? `policy-${code}`,
    features: Object.freeze(Object.fromEntries(schema.features.map((name, bit) => [name, !!(values[1] & 1 << bit)]))) as Readonly<AIPolicyFeatures>,
    parameters: Object.freeze(Object.fromEntries(schema.parameters.map((name, offset) => [name, values[2 + offset]]))) as unknown as Readonly<AIPolicyParameters> });
  host.views.set(code, policy);
  return policy;
}
function encode(definition: Pick<FactionAIPolicy, 'features' | 'parameters'>): number[] {
  return [schema.features.reduce((flags, name, bit) => flags | (definition.features[name as keyof AIPolicyFeatures] ? 1 << bit : 0), 0),
    ...schema.parameters.map(name => definition.parameters[name as keyof AIPolicyParameters])];
}
function publishInput(state: GameState, row: readonly number[]): void {
  const pointer = rustEngine.sim_ai_policy_input(simCore(state).handle);
  new Float64Array(rustEngine.memory.buffer, pointer, ROW).set(row);
}

/** Resolves configuration only. Rust validates every complete row before any
 * definition is registered, and owns all policy-dependent gameplay decisions. */
export function registerFactionAIPolicies(state: GameState, definitions: readonly AIPolicyDefinition[]): readonly FactionAIPolicy[] {
  const host = catalog(state), pending = new Map<string, AIPolicyDefinition>();
  if (host.names.length + definitions.length > 100_000) throw new Error('Too many AI policy definitions');
  for (const definition of definitions) {
    if (!definition || typeof definition.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(definition.id)
      || host.codes.has(definition.id) || pending.has(definition.id)) throw new Error(`Invalid or duplicate AI policy ID: ${definition?.id}`);
    if (Object.keys(definition).some(key => !['id', 'extends', 'parameters', 'features', 'logic'].includes(key))) throw new Error(`Unknown field in AI policy ${definition.id}`);
    pending.set(definition.id, definition);
  }
  const resolved = new Map<string, Omit<FactionAIPolicy, 'code'>>(), visiting = new Set<string>();
  const resolve = (id: string): Omit<FactionAIPolicy, 'code'> => {
    const code = host.codes.get(id);
    if (code !== undefined) return readView(state, 0, code);
    const cached = resolved.get(id); if (cached) return cached;
    const definition = pending.get(id);
    if (!definition) throw new Error(`Unknown parent AI policy: ${id}`);
    if (visiting.has(id)) throw new Error(`AI policy inheritance cycle at ${id}`);
    visiting.add(id);
    const parent = resolve(definition.extends ?? DEFAULT_FACTION_AI_PROFILE);
    for (const [values, keys, type] of [[definition.parameters, schema.parameters, 'number'], [definition.features, schema.features, 'boolean']] as const) {
      if (values === undefined) continue;
      if (!values || typeof values !== 'object' || Array.isArray(values)
        || Object.entries(values).some(([key, value]) => !keys.includes(key) || typeof value !== type))
        throw new Error(`Invalid ${type === 'number' ? 'parameters' : 'features'} in AI policy ${id}`);
    }
    const logic = { ...parent.logic };
    if (definition.logic !== undefined) {
      if (!definition.logic || typeof definition.logic !== 'object' || Array.isArray(definition.logic)) throw new Error(`Invalid logic in ${id}`);
      for (const [decision, expression] of Object.entries(definition.logic)) {
        if (!Object.hasOwn(logicSchema.decisions, decision)) throw new Error(`Unknown logic decision: ${decision}`);
        if (expression === null) delete logic[decision as keyof PolicyLogic];
        else { compileLogic(decision, expression!); logic[decision as keyof PolicyLogic] = expression!; }
      }
    }
    const policy = { id, logic, parameters: { ...parent.parameters, ...definition.parameters }, features: { ...parent.features, ...definition.features } };
    resolved.set(id, policy); visiting.delete(id);
    return policy;
  };
  for (const id of pending.keys()) resolve(id);
  const rows = [...resolved.values()].map(policy => ({ policy, row: encode(policy) }));
  const publishLogic = (decision: string, expression: NonNullable<PolicyLogic[keyof PolicyLogic]>) => {
    const words = compileLogic(decision, expression), handle = simCore(state).handle;
    const pointer = rustEngine.sim_ai_logic_input(handle, words.length);
    if (!pointer) throw new Error('Native AI logic allocation rejected');
    new Float64Array(rustEngine.memory.buffer, pointer, words.length).set(words);
    return logicSchema.decisions[decision as keyof PolicyLogic].mode;
  };
  for (const { policy, row } of rows) {
    for (const [decision, expression] of Object.entries(policy.logic)) {
      const mode = publishLogic(decision, expression!);
      if (!rustEngine.sim_ai_logic_validate(simCore(state).handle, mode)) throw new Error(`Rust rejected logic in ${policy.id}`);
    }
    publishInput(state, row);
    if (!rustEngine.sim_ai_policy_validate(simCore(state).handle)) throw new Error(`Rust rejected AI policy ${policy.id}: invalid parameter range or inconsistent thresholds`);
  }
  for (const { policy, row } of rows) {
    publishInput(state, row);
    const code = rustEngine.sim_ai_policy_register(simCore(state).handle);
    if (code === 0xffffffff || code !== host.names.length) throw new Error(`Could not register AI policy ${policy.id}`);
    for (const [decision, expression] of Object.entries(policy.logic)) {
      const mode = publishLogic(decision, expression!);
      if (!rustEngine.sim_ai_logic_set(simCore(state).handle, code, mode)) throw new Error(`Cannot register AI logic ${policy.id}`);
    }
    host.codes.set(policy.id, code); host.names.push(policy.id);
  }
  state.aiPolicyNames = [...host.names];
  return definitions.map(definition => readView(state, 0, host.codes.get(definition.id)!));
}
export function listFactionAIPolicies(state: GameState): readonly FactionAIPolicy[] {
  return catalog(state).names.map((_, code) => readView(state, 0, code));
}
export function setFactionAIProfile(state: GameState, faction: number, id: FactionAIProfile): void {
  const host = catalog(state), code = host.codes.get(id);
  if (!Number.isInteger(faction) || faction < 0 || faction > 0x7fffffff || code === undefined
    || !rustEngine.sim_ai_policy_assign(simCore(state).handle, faction, code)) throw new Error(`Cannot assign AI policy ${id} to faction ${faction}`);
  host.factions.set(faction, readView(state, 0, code));
}
export function factionAIPolicy(state: GameState, faction: number): FactionAIPolicy {
  const host = catalog(state), cached = host.factions.get(faction);
  if (cached) return cached;
  const policy = readView(state, 1, faction); host.factions.set(faction, policy); return policy;
}
export function factionAIProfile(state: GameState, faction: number): FactionAIProfile { return factionAIPolicy(state, faction).id; }

export type AIPolicyDecision = keyof typeof logicSchema.decisions;
/** Observations are submitted on demand; this bridge owns no decision rules. */
export function factionAIDecision(state: GameState, faction: number, decision: AIPolicyDecision,
  a = 0, b = 0, c = 0, d = 0, e = 0, f = 0): number {
  return rustEngine.sim_ai_policy_decide(simCore(state).handle, faction, logicSchema.decisions[decision].mode, a,b,c,d,e,f);
}

export function factionAILogicFaults(state: GameState, code: number): number {
  return rustEngine.sim_ai_logic_faults(simCore(state).handle, code);
}
