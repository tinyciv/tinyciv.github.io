import { drawArrow } from './archery-art';
import type { Point, Projectile } from './types';
import { pointInSight, type FogView } from './fog';

export interface MoveMarker extends Point { elapsed: number }

/** Projectiles remain concealed outside current sight, just like units. */
export function drawJavelins(c: CanvasRenderingContext2D, projectiles: readonly Projectile[], fog: FogView, ox: number, oy: number, size: number): void {
  for (const shot of projectiles) {
    if (shot.elapsed >= shot.duration || !pointInSight(fog, shot.x, shot.y)) continue;
    const progress = shot.elapsed / shot.duration;
    const height = (shot.startHeight ?? .48) * (1 - progress) + .48 * progress + Math.sin(progress * Math.PI) * .25;
    c.save();
    c.translate(ox + shot.x * size, oy + (shot.y - height) * size);
    c.rotate(Math.atan2(shot.end.y - shot.start.y, shot.end.x - shot.start.x));
    if (shot.kind === 'arrow') { drawArrow(c, size); c.restore(); continue; }
    const length = size * .42, tip = length * .5;
    c.fillStyle = '#34261a'; c.fillRect(-tip, -1.6, length, 3.2);
    c.fillStyle = '#cfaa6e'; c.fillRect(-tip, -.7, length * .85, 1.4);
    c.beginPath(); c.moveTo(tip + size * .1, 0); c.lineTo(tip - 2, -2.8); c.lineTo(tip - 2, 2.8); c.closePath();
    c.fillStyle = '#dae9d7'; c.fill();
    c.restore();
  }
}
