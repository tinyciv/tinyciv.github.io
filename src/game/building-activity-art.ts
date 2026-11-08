import { silhouetteOutline } from './silhouette-outline';
import { drawBuilding } from './sprites';
import { punyWorldImage } from './puny-world';
import { buildingArtTop, buildingWidth, buildingHeight, isFarmKind, type Building } from './types';
import { drawFarmField } from './farm-art';

const outlines = new Map<string, { canvas: HTMLCanvasElement; top: number }>();

/** Dilate the actual sprite alpha, then remove its interior. The outline follows
 * roofs and entrances instead of drawing a box around the occupied ground. */
export function drawBuildingActivityOutline(c: CanvasRenderingContext2D, building: Building, x: number, y: number, size: number, color: string): void {
  if (!punyWorldImage()) return;
  const key = `${building.kind}:${building.houseLevel ?? 1}:${Number(!!building.orchard)}:${building.id & 1}:${color}`;
  let cached = outlines.get(key);
  if (!cached) {
    const padding = 6, top = buildingArtTop(building), width = buildingWidth(building), height = buildingHeight(building);
    const sprite = document.createElement('canvas');
    sprite.width = width * 32 + padding * 2;
    sprite.height = Math.ceil((height - top) * 32) + padding * 2;
    const original = sprite.getContext('2d')!;
    if (isFarmKind(building.kind)) {
      for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++)
        drawFarmField(original, padding + dx * 32, padding - top * 32 + dy * 32, 32, building.orchard?.readyAt ?? 30,
          { id: 0, camp: building.id, faction: building.faction, x: dx, y: dy, planted: true, food: 1, nextHarvest: 30, orchard: building.orchard });
    } else drawBuilding(original, building, padding, padding - top * 32, 32, 0, color);
    const canvas = silhouetteOutline(sprite, color);
    cached = { canvas, top }; outlines.set(key, cached);
  }
  c.save(); c.imageSmoothingEnabled = false;
  c.drawImage(cached.canvas, x - size * 6 / 32, y + cached.top * size - size * 6 / 32,
    cached.canvas.width * size / 32, cached.canvas.height * size / 32);
  c.restore();
}
