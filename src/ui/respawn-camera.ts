import type { Point } from '../game/types';
export const RESPAWN_CAMERA_SECONDS = 1.5;
export class RespawnCamera {
  private movement?: { from: Point; to: Point; elapsed: number };
  start(from: Point, to: Point): void { this.movement = { from: { ...from }, to: { ...to }, elapsed: 0 }; }
  cancel(): void { this.movement = undefined; }
  advance(dt: number): Point | undefined {
    const movement = this.movement;
    if (!movement) return;
    movement.elapsed = Math.min(RESPAWN_CAMERA_SECONDS, movement.elapsed + Math.max(0, dt));
    const t = movement.elapsed / RESPAWN_CAMERA_SECONDS, blend = t * t * (3 - 2 * t);
    const point = { x: movement.from.x + (movement.to.x - movement.from.x) * blend,
      y: movement.from.y + (movement.to.y - movement.from.y) * blend };
    if (t >= 1) this.movement = undefined;
    return point;
  }
}
