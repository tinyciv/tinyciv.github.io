import { WATER, type Point, type World } from '../../src/game/types';
import { ridgeEdgeAllowed, ridgeGroundWalkable } from '../../src/game/ridges';
import type { LandscapeParameters, WorldGenerationStyle } from '../../src/world/options';
import { measure, type Summary } from '../fractal-gallery/model';
export { overviewPixels } from '../fractal-gallery/model';

export const REVIEW_SEEDS = ['ALDER-REACH', 'WINDWARD-2026', 'SILVER-WATERS'];
export const REVIEW_STYLES: WorldGenerationStyle[] = ['continents', 'pangaea', 'fractal'];
export interface ForestFocus extends Point { woodland: number; land: number }
export interface ForestSummary extends Summary {
  trees: number;
  landTiles: number;
  adjacentOpenGround: number;
  solidTwoByTwo: number;
  woodlandFocus: ForestFocus[];
}
export interface ReviewRecord {
  id: string; seed: string; style: WorldGenerationStyle; width: number; height: number;
  parameters: LandscapeParameters; summary: ForestSummary; capitals: Point[]; secondary: Point[];
  preview: string; compressedWorld: string;
}

/** Coverage is measured on dry land. A gap must be walkable, unwooded land,
 * so open sea and cliff cells do not count as forest clearings. */
export function forestSummary(world: World): ForestSummary {
  const { width, height, tiles } = world;
  const wooded = (cell: number) => tiles[cell]?.overlay === 'forest' || tiles[cell]?.overlay === 'jungle';
  const open = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height
    && !WATER.has(tiles[y * width + x].terrain) && !wooded(y * width + x) && ridgeGroundWalkable(world, x, y);
  let trees = 0, landTiles = 0, nearOpen = 0, solidTwoByTwo = 0;
  const stride = width + 1, forestIntegral = new Int32Array((height + 1) * stride), landIntegral = new Int32Array(forestIntegral.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const cell = y * width + x, forest = Number(wooded(cell)), land = Number(!WATER.has(tiles[cell].terrain));
    landTiles += land; trees += forest;
    const i = (y + 1) * stride + x + 1;
    forestIntegral[i] = forest + forestIntegral[i - 1] + forestIntegral[i - stride] - forestIntegral[i - stride - 1];
    landIntegral[i] = land + landIntegral[i - 1] + landIntegral[i - stride] - landIntegral[i - stride - 1];
    if (forest) {
      let hasGap = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (open(x + dx, y + dy) && ridgeEdgeAllowed(world, { x, y }, { x: x + dx, y: y + dy })) { hasGap = true; break; }
      nearOpen += Number(hasGap);
    }
  }
  const total = (integral: Int32Array, x: number, y: number, radius: number) => {
    const left = Math.max(0, x - radius), right = Math.min(width, x + radius + 1);
    const top = Math.max(0, y - radius), bottom = Math.min(height, y + radius + 1);
    return integral[bottom * stride + right] - integral[top * stride + right] - integral[bottom * stride + left] + integral[top * stride + left];
  };
  const candidates: ForestFocus[] = [];
  for (let y = 0; y < height - 1; y++) for (let x = 0; x < width - 1; x++) {
    const cell = y * width + x;
    if ([cell, cell + 1, cell + width, cell + width + 1].every(wooded)) solidTwoByTwo++;
  }
  for (let y = 8; y < height - 8; y += 5) for (let x = 8; x < width - 8; x += 5) {
    const land = total(landIntegral, x, y, 7), woodland = total(forestIntegral, x, y, 7);
    if (land >= 190 && woodland >= 20) candidates.push({ x: x + .5, y: y + .5, woodland, land });
  }
  candidates.sort((a, b) => b.woodland - a.woodland);
  const woodlandFocus: ForestFocus[] = [];
  for (const candidate of candidates) {
    if (woodlandFocus.every(other => Math.hypot(other.x - candidate.x, other.y - candidate.y) >= 27)) woodlandFocus.push(candidate);
    if (woodlandFocus.length >= 6) break;
  }
  return { ...measure(world), trees, landTiles, adjacentOpenGround: trees ? nearOpen / trees : 1, solidTwoByTwo, woodlandFocus };
}
