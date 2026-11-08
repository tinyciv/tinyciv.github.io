import { ARMY_WARNING_SECONDS, type ArmyWarning } from '../game/army-warnings';
import { entityStore } from '../game/entity-store';
import { playerFaction } from '../game/player-context';
import type { GameState, Point, World } from '../game/types';

export interface PresentedArmyWarning extends ArmyWarning { expiresAt: number }
/** A notification lasts six wall-clock seconds, including at 4× game speed.
 * Replicated frames cannot restart it; changing worlds clears the old feed. */
export class ArmyWarningFeed {
  generation = 0;
  private world?: World;
  private state?: GameState;
  private viewer = -1;
  private seen = 0;
  private time = -Infinity;
  private active = new Map<number, PresentedArmyWarning>();
  update(state: GameState, now: number): PresentedArmyWarning[] {
    const viewer = playerFaction(state);
    if (state.world !== this.world || viewer !== this.viewer || state.time < this.time
      || !state.multiplayer && this.state !== state) {
      this.active.clear(); this.seen = 0; this.world = state.world; this.viewer = viewer;
      this.generation++;
    }
    this.state = state; this.time = state.time;
    for (const event of state.armyWarnings ?? []) {
      if (event.id <= this.seen) continue;
      this.seen = event.id;
      if (event.recipients.includes(viewer) && event.createdAt <= state.time
        && state.time - event.createdAt < ARMY_WARNING_SECONDS)
        this.active.set(event.id, { ...event, expiresAt: now + ARMY_WARNING_SECONDS * 1000 });
    }
    for (const [id, event] of this.active) {
      if (now >= event.expiresAt) { this.active.delete(id); continue; }
      const source = entityStore(state).units.get(event.sourceId);
      if (source && source.hp > 0 && !source.inside) { event.x = source.x; event.y = source.y; }
    }
    return [...this.active.values()];
  }
}

export interface WarningPosition extends Point { edge: boolean; angle: number }
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
/** Intersect the center-to-army ray with the inset screen rectangle. Clamping
 * x/y independently would give the wrong bearing near offscreen corners. */
export function armyWarningPosition(point: Point, width: number, height: number): WarningPosition {
  const left = Math.min(26, width / 4), right = width - left;
  const top = Math.min(64, height / 4), bottom = height - Math.min(26, height / 4);
  const center = { x: width / 2, y: (top + bottom) / 2 }, dx = point.x - center.x, dy = point.y - center.y;
  const angle = Math.atan2(dy, dx);
  if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) return { ...point, edge: false, angle };
  const scale = Math.min(dx ? (dx > 0 ? right - center.x : left - center.x) / dx : Infinity,
    dy ? (dy > 0 ? bottom - center.y : top - center.y) / dy : Infinity);
  return { x: clamp(center.x + dx * scale, left, right), y: clamp(center.y + dy * scale, top, bottom), edge: true, angle };
}

/** Simultaneous levy/formation messages remain separately hoverable. Spread
 * coincident warnings along their screen edge or beside an onscreen army. */
export function separateArmyWarning(position: WarningPosition, occupied: readonly Point[], width: number, height: number): WarningPosition {
  const vertical = position.edge && (position.x <= 27 || position.x >= width - 27);
  for (let step = 0; step <= occupied.length * 2; step++) {
    const offset = Math.ceil(step / 2) * 42 * (step % 2 ? 1 : -1);
    const candidate = { ...position,
      x: clamp(position.x + (vertical ? 0 : offset), 26, width - 26),
      y: clamp(position.y + (vertical ? offset : 0), Math.min(64, height / 4), height - 26) };
    if (occupied.every(other => Math.hypot(candidate.x - other.x, candidate.y - other.y) >= 40)) return candidate;
  }
  return position;
}
