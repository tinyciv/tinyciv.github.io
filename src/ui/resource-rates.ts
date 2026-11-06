import type { GameState } from '../game/types';
import { CHECK_INTERVAL } from '../game/work-cadence';

export const RESOURCE_CHANGE_WINDOW_SECONDS = 30;
const SAMPLE_INTERVAL = CHECK_INTERVAL;
const SAMPLE_CAPACITY = Math.ceil(RESOURCE_CHANGE_WINDOW_SECONDS / SAMPLE_INTERVAL) + 2;

type ResourceState = Pick<GameState, 'time' | 'factions' | 'playerFaction'>;
interface Sample { time: number; food: number; gold: number; culture: number }
interface History {
  startedAt: number;
  lastObservedAt: number;
  samples: (Sample | undefined)[];
  head: number;
  count: number;
}
export interface ResourceChanges { food: number; gold: number; culture: number; elapsedSeconds: number }

const histories = new WeakMap<object, History>();
const sampleAt = (history: History, offset: number): Sample => history.samples[(history.head + offset) % SAMPLE_CAPACITY]!;

/** Actual gross receipts, excluding purchases, upkeep and refunds, over 30 game
 * seconds. The first observation supplies a partial-window baseline; it is
 * never extrapolated. Historical samples are at most 3 Hz, so the cutoff
 * uses the last retained observation at or before the window's start.
 * Cumulative income is read on every call, including while paused. */
export function resourceChanges(state: ResourceState, historyKey: object = state): ResourceChanges {
  const faction = state.factions.find(candidate => candidate.id === (state.playerFaction ?? 0));
  if (!faction) {
    histories.delete(historyKey);
    return { food: 0, gold: 0, culture: 0, elapsedSeconds: 0 };
  }
  const time = state.time, food = faction.incomeTotals?.food ?? 0,
    gold = faction.incomeTotals?.gold ?? 0, culture = faction.incomeTotals?.culture ?? 0;
  let history = histories.get(historyKey);
  if (!history || time < history.lastObservedAt) {
    history = { startedAt: time, lastObservedAt: time, samples: new Array(SAMPLE_CAPACITY), head: 0, count: 1 };
    history.samples[0] = { time, food, gold, culture };
    histories.set(historyKey, history);
  }
  history.lastObservedAt = time;
  const cutoff = time - RESOURCE_CHANGE_WINDOW_SECONDS;
  // Retain one sample at/before the cutoff. Ring indices avoid shifting the
  // history on each frame and keep storage fixed even in a long-running game.
  while (history.count > 1 && sampleAt(history, 1).time <= cutoff) {
    history.head = (history.head + 1) % SAMPLE_CAPACITY;
    history.count--;
  }
  const latest = sampleAt(history, history.count - 1);
  if (time - latest.time >= SAMPLE_INTERVAL - 1e-9) {
    if (history.count === SAMPLE_CAPACITY) {
      history.head = (history.head + 1) % SAMPLE_CAPACITY;
      history.count--;
    }
    history.samples[(history.head + history.count) % SAMPLE_CAPACITY] = { time, food, gold, culture };
    history.count++;
  }
  const baseline = sampleAt(history, 0);
  return {
    food: food - baseline.food,
    gold: gold - baseline.gold,
    culture: culture - baseline.culture,
    elapsedSeconds: Math.min(RESOURCE_CHANGE_WINDOW_SECONDS, Math.max(0, time - history.startedAt)),
  };
}
