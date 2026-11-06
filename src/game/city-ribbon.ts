import type { CitySummary } from './cities';
import { drawCityPanelBackground } from './city-panel-art';
import { gameFont } from './game-font';

export const CITY_RIBBON_HEIGHT = 40;
export const CITY_NAME_RIBBON_HEIGHT = 28;
export const CITY_FOOD_COLOR = '#96d887';
export const CITY_GOLD_COLOR = '#e8c56f';
const signed = (value: number) => `${Math.round(value) >= 0 ? '+' : ''}${Math.round(value)}`;

function ellipsis(c: CanvasRenderingContext2D, text: string, width: number): string {
    if (c.measureText(text).width <= width) return text;
    while (text.length && c.measureText(text + '…').width > width) text = text.slice(0, -1);
    return text + '…';
}

/** x/y is the center of a compact ribbon above the palace's roof. Text
 * stays screen-sized as the world zooms; only the attachment point moves. */
export function drawCityRibbon(c: CanvasRenderingContext2D, city: CitySummary, x: number, y: number, maxWidth = 180, faction = 0): void {
    c.save(); c.globalAlpha = 1; c.textAlign = 'left'; c.textBaseline = 'middle';
    const ownCity = city.palace.faction === faction;
    const height = ownCity ? CITY_RIBBON_HEIGHT : CITY_NAME_RIBBON_HEIGHT;
    c.font = gameFont(11, 500);
    const columns = (ownCity ? [
        { text: `${city.population} / ${city.housing}`, color: '#e8e7df' },
        { text: signed(city.food), color: CITY_FOOD_COLOR },
        { text: signed(city.gold), color: CITY_GOLD_COLOR },
    ] : []).map(column => ({ ...column, width: c.measureText(column.text).width }));
    const numbersWidth = columns.reduce((sum, column) => sum + column.width, 0) + (ownCity ? 16 : 0);
    c.font = gameFont(14, 500);
    const name = ellipsis(c, city.name, Math.max(14, Math.min(140, maxWidth - 24)));
    const nameWidth = c.measureText(name).width;
    // Twelve screen pixels of inset per side; round to the 2× native art grid.
    const width = Math.ceil((Math.max(nameWidth, numbersWidth) + 24) / 2) * 2;
    const left = Math.round(x - width / 2), top = Math.round(y - height / 2);
    drawCityPanelBackground(c, left, top, width, height);
    c.fillStyle = '#faf7ee'; c.fillText(name, left + (width - nameWidth) / 2, top + (ownCity ? 13 : height / 2));
    let cursor = left + (width - numbersWidth) / 2;
    c.font = gameFont(11, 500);
    for (const column of columns) {
        c.fillStyle = column.color; c.fillText(column.text, cursor, top + 28); cursor += column.width + 8;
    }
    c.restore();
}
