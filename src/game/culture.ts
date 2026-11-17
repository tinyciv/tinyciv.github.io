import { AchievementEffect, achievementEffect, lifetimeCulture } from './achievement-effects';
import { recordIncome } from './resource-income';
import { buildingHeight, buildingReady, buildingWidth, type Building, type Faction, type GameState } from './types';
import { colosseumCultureMultiplier } from './colosseum';
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
/** Borders grow in one game-wide wave per interval rather than whenever any
 * city crosses a threshold. */
export const BORDER_WAVE_SECONDS = 720;

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
    const factions = new Map(state.factions.map(faction => [faction.id, faction]));
    const rates = new Map(state.factions.filter(faction => faction.id >= 0 && !faction.defeated && faction.villageId === undefined).map(faction => [faction.id, 0]));
    // Each source's culture is multiplied by its faction's strongest nearby Colosseum.
    const colosseums = new Map<number, Building[]>();
    for (const building of state.buildings) if (building.kind === 'colosseum' && buildingReady(building))
        colosseums.set(building.faction, [...colosseums.get(building.faction) ?? [], building]);
    const boost = (building: Building) => colosseumCultureMultiplier(colosseums.get(building.faction) ?? [],
        { x: building.x + buildingWidth(building) / 2, y: building.y + buildingHeight(building) / 2 });
    for (const building of entityStore(state).buildings.query('palace')) if (buildingReady(building) && rates.has(building.faction))
        rates.set(building.faction, rates.get(building.faction)! + SETTLEMENT_CULTURE_PER_SECOND
            * achievementEffect(factions.get(building.faction), AchievementEffect.culture, boost(building), 1));
    for (const building of entityStore(state).buildings.query('monument')) if (buildingReady(building) && rates.has(building.faction))
        rates.set(building.faction, rates.get(building.faction)! + MONUMENT_CULTURE_PER_SECOND
            * achievementEffect(factions.get(building.faction), AchievementEffect.culture, boost(building)));
    if (trusted) rateSamples.set(state, { store, at: state.time, rates });
    return rates;
}

export function culturePerSecond(state: GameState, faction: number): number {
    return cultureRates(state).get(faction) ?? 0;
}

/** Each wave claims the culture every realm will hold at the wave's midpoint,
 * so time-averaged borders match continuous growth. A realm that appears
 * mid-wave is sampled on arrival; the others keep this wave's claim. */
export function updateBorderWave(state: GameState): void {
    const index = Math.floor(state.time / BORDER_WAVE_SECONDS), wave = state.borderWave;
    if (wave?.index === index && state.factions.every(faction => faction.id in wave.culture)) return;
    const culture: Record<number, number> = wave?.index === index ? { ...wave.culture } : {};
    const rates = cultureRates(state), remaining = (index + .5) * BORDER_WAVE_SECONDS - state.time;
    for (const faction of state.factions) if (!(faction.id in culture))
        culture[faction.id] = Math.max(0, lifetimeCulture(faction) + (rates.get(faction.id) ?? 0) * remaining);
    state.borderWave = { index, culture };
}

/** Culture that drives territorial influence: this wave's claim, or live culture before the first wave. */
export function borderCulture(state: GameState, faction: Pick<Faction, 'id' | 'culture' | 'cultureSpent'> | undefined): number {
    const claimed = faction && state.borderWave?.culture[faction.id];
    return claimed ?? lifetimeCulture(faction);
}

/** Run on simulated time, after construction updates. Destroying a monument
 * stops its production without removing culture its faction has already earned. */
export function updateCulture(state: GameState, dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    updateBorderWave(state);
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
