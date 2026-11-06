import { recordIncome } from './resource-income';
import { buildingReady, type Faction, type GameState } from './types';
import { entityStore } from './entity-store';
import { simulationReadsActive } from './simulation-reads';
import { CHECK_INTERVAL } from './work-cadence';

/** Two thirds of the former 1 culture/second rate; expansion thresholds and
 * radius gains stay unchanged so the slowdown is applied exactly once. */
export const MONUMENT_CULTURE_PER_SECOND = 2 / 3;
/** A settlement's residents develop local culture without needing a monument:
 * one city earns its first hundred culture in eight minutes twenty seconds. */
export const SETTLEMENT_CULTURE_PER_SECOND = .2;
export const CULTURE_THRESHOLD_STEP = 100;

/** Culture is saved on the faction; missing or invalid input has no influence. */
const cultureAmount = (value: number | undefined): number => Number.isFinite(value) ? Math.max(0, value!) : 0;
const accumulation = new WeakMap<Faction, { total: number; remainder: number }>();
const rateSamples = new WeakMap<GameState, { store: ReturnType<typeof entityStore>; at: number; rates: Map<number, number> }>();

/** Each level increases settlement influence. Costs accumulate as
 * 100, 300, 600, 1000, … with no gameplay cap on the number of expansions. */
export function cultureLevel(value: number | undefined): number {
    // Divide before multiplying to keep the square-root input finite even for
    // very large finite totals. Normal gameplay values retain exact thresholds.
    return Math.floor((Math.sqrt(1 + cultureAmount(value) / (CULTURE_THRESHOLD_STEP / 8)) - 1) / 2);
}

/** The total accumulated culture required for the next expansion. */
export function nextCultureThreshold(value: number | undefined): number {
    const next = cultureLevel(value) + 1;
    return Math.min(Number.MAX_VALUE, next * (next + 1) / 2 * CULTURE_THRESHOLD_STEP);
}

function cultureRates(state: GameState): Map<number, number> {
    const trusted = simulationReadsActive(state), store = entityStore(state), previous = rateSamples.get(state);
    if (trusted && previous?.store === store && state.time >= previous.at && state.time + 1e-9 < previous.at + CHECK_INTERVAL) return previous.rates;
    const rates = new Map(state.factions.filter(faction => faction.id >= 0 && !faction.defeated && faction.villageId === undefined).map(faction => [faction.id, 0]));
    for (const building of entityStore(state).buildings.query('palace')) if (buildingReady(building) && rates.has(building.faction))
        rates.set(building.faction, rates.get(building.faction)! + SETTLEMENT_CULTURE_PER_SECOND);
    for (const building of entityStore(state).buildings.query('monument')) if (buildingReady(building) && rates.has(building.faction))
        rates.set(building.faction, rates.get(building.faction)! + MONUMENT_CULTURE_PER_SECOND);
    if (trusted) rateSamples.set(state, { store, at: state.time, rates });
    return rates;
}

export function culturePerSecond(state: GameState, faction: number): number {
    return cultureRates(state).get(faction) ?? 0;
}

/** Run on simulated time, after construction updates. Destroying a monument
 * stops its production without removing culture its faction has already earned. */
export function updateCulture(state: GameState, dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const rates = cultureRates(state);
    for (const faction of state.factions) {
        const rate = rates.get(faction.id) ?? 0;
        if (rate <= 0) continue;
        const amount = cultureAmount(faction.culture), previous = accumulation.get(faction);
        // Retain the rounding remainder so 1000 frames of 0.1 seconds earn the
        // same culture as 100 seconds in one call. External transfers/reset
        // totals naturally discard the old remainder.
        const increment = rate * dt - (previous?.total === amount ? previous.remainder : 0);
        const total = Math.min(Number.MAX_VALUE, amount + increment);
        const remainder = total === Number.MAX_VALUE ? 0 : total - amount - increment;
        faction.culture = total;
        recordIncome(faction, { culture: total - amount });
        accumulation.set(faction, { total, remainder });
    }
}
