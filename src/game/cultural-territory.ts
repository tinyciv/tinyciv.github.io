import { AchievementEffect, achievementEffect } from './achievement-effects';
import { insideOwnBorders, territory } from './borders';
import { entityStore } from './entity-store';
import { simulationReadsActive } from './simulation-reads';
import type { Faction, GameState, Point } from './types';

interface Sample {
  at: number; world: GameState['world']; store: ReturnType<typeof entityStore>; borders: ReturnType<typeof territory>;
}
const samples = new WeakMap<GameState, Sample>();

/** Share one territory snapshot per second across morale and actual attacks.
 * Moving actors still read their current cell; no actor rebuilds border inputs. */
export function culturalHomeGround(state: GameState, faction: Pick<Faction, 'id' | 'achievements'> | undefined, point: Point): boolean {
  if (!faction || !achievementEffect(faction, AchievementEffect.needsTerritory, 0)) return false;
  if (!simulationReadsActive(state)) return insideOwnBorders(state, faction.id, point.x, point.y);
  const store = entityStore(state);
  let sample = samples.get(state);
  if (!sample || sample.world !== state.world || sample.store !== store || state.time < sample.at || state.time >= sample.at + 1) {
    sample = { at: state.time, world: state.world, store, borders: territory(state) };
    samples.set(state, sample);
  }
  return insideOwnBorders(state, faction.id, point.x, point.y, sample.borders);
}
