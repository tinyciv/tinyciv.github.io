import type { Point } from '../../src/game/types';

/** Independent flood-fill oracle for the actual cardinally joined crop cells. */
export function farmBlockGeometry(points: readonly Point[]): { size: number; width: number; height: number; aspectRatio: number }[] {
  const key = (point: Point): string => `${point.x},${point.y}`, remaining = new Map(points.map(point => [key(point), point]));
  const blocks: { size: number; width: number; height: number; aspectRatio: number }[] = [];
  while (remaining.size) {
    const first = remaining.values().next().value!, pending = [first]; remaining.delete(key(first));
    let minX = first.x, maxX = first.x, minY = first.y, maxY = first.y;
    for (let i = 0; i < pending.length; i++) {
      const point = pending[i]; minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const neighbor = remaining.get(`${point.x + dx},${point.y + dy}`);
        if (neighbor) { pending.push(neighbor); remaining.delete(key(neighbor)); }
      }
    }
    const width = maxX - minX + 1, height = maxY - minY + 1;
    blocks.push({ size: pending.length, width, height, aspectRatio: Math.max(width, height) / Math.min(width, height) });
  }
  return blocks;
}
