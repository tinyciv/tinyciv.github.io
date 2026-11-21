import { drawGeothermal, geothermalArtOffsetY } from './geothermal-art';
import { silhouetteOutline } from './silhouette-outline';
import type { Tile } from './types';

export const SITE_OUTLINE_PADDING = 6;

/** Trace a fixed frame to keep the outline steady as the steam animates. */
export function drawSiteOutline(context: CanvasRenderingContext2D, variant: NonNullable<Tile['geothermal']>, mask: number): void {
    const padding = SITE_OUTLINE_PADDING;
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = 64 + 2 * padding;
    const source = sprite.getContext('2d')!;
    source.translate(padding, padding);
    source.beginPath();
    source.rect(0, -geothermalArtOffsetY(variant), 64, 64);
    source.clip();
    drawGeothermal(source, variant, 0, mask);
    context.drawImage(silhouetteOutline(sprite, '#ed574c'), -padding, -padding);
}
