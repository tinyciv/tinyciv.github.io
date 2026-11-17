import type { GameState, ResearchBranchId } from './types';

export const TREATY = { peace: 1, pact: 2, trade: 4, access: 8, alliance: 16, support: 32 } as const;
export interface DiplomacyTerms {
  flags: number; giveGold: number; getGold: number; giveRate: number; getRate: number; duration: number;
  giveTech: ResearchBranchId[]; getTech: ResearchBranchId[]; giveCity: number; getCity: number;
  enemy: number; origin: number; destination: number;
}
export const emptyDiplomacyTerms = (): DiplomacyTerms => ({ flags: 0, giveGold: 0, getGold: 0, giveRate: 0, getRate: 0,
  duration: 300, giveTech: [], getTech: [], giveCity: -1, getCity: -1, enemy: -1, origin: -1, destination: -1 });
export interface DiplomaticRelationship {
  a: number; b: number; contact: boolean; war: boolean; since: number;
  truce: number; pact: number; trade: number; access: number; alliance: number; withdrawal: number;
  trust: [number, number]; grievances: [number, number]; interest: [number, number]; affiliation: [number, number];
  observedPower: [number, number]; observedCities: [number, number]; origin: number; destination: number;
  giveRate: number; getRate: number; paymentAt: number; paymentEnd: number; arrears: [number, number];
  defaultAt: [number, number]; honored: number;
}
export interface DiplomaticOffer { id: number; from: number; to: number; expires: number; call: boolean; score: number; terms: DiplomacyTerms }
export interface DiplomaticHistory { time: number; kind: number; a: number; b: number; value: number; extra: number }
export interface DiplomacySnapshot {
  revision: number; accessRevision: number; relationships: DiplomaticRelationship[]; offers: DiplomaticOffer[];
  personalities: Record<number, number>;
  assistance: Record<number, { city: number; ally: number; until: number }>;
  history: DiplomaticHistory[]; transferable: Record<number, number>;
}
// A mirror of native pair records. The index is rebuilt only when a native
// snapshot is published, never during combat candidate or gate checks.
const indices = new WeakMap<DiplomacySnapshot, Map<number, Map<number, DiplomaticRelationship>>>();
export function diplomaticRelationship(state: GameState, a: number, b: number): DiplomaticRelationship | undefined {
  const snapshot = state.diplomacyState;
  if (!snapshot) return undefined;
  let index = indices.get(snapshot);
  if (!index) {
    index = new Map();
    for (const pair of snapshot.relationships) {
      for (const [from, to] of [[pair.a, pair.b], [pair.b, pair.a]]) {
        let row = index.get(from); if (!row) index.set(from, row = new Map()); row.set(to, pair);
      }
    }
    indices.set(snapshot, index);
  }
  return index.get(a)?.get(b);
}
export const diplomaticSide = (pair: DiplomaticRelationship, faction: number): 0 | 1 => pair.a === faction ? 0 : 1;
export function diplomaticAllies(state: GameState, a: number, b: number): boolean {
  const pair = diplomaticRelationship(state, a, b);
  return !!pair && !pair.war && pair.alliance > state.time;
}
export function diplomaticAccess(state: GameState, a: number, b: number): boolean {
  const pair = diplomaticRelationship(state, a, b);
  return !!pair && !pair.war && Math.max(pair.access, pair.alliance, pair.withdrawal) > state.time;
}
