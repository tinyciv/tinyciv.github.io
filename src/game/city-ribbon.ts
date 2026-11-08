import { LOYALTY_START, loyaltyWarning } from './loyalty-model';
import type { CitySummary } from './cities';
import { drawCityPanelBackground } from './city-panel-art';
import { gameFont } from './game-font';

export const CITY_RIBBON_HEIGHT = 60;
export const CITY_NAME_RIBBON_HEIGHT = 34;
export const CITY_RIBBON_MAX_WIDTH = 420;
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
export function drawCityRibbon(c: CanvasRenderingContext2D, city: CitySummary, x: number, y: number, maxWidth = CITY_RIBBON_MAX_WIDTH, faction = 0): void {
    c.save(); c.globalAlpha = 1; c.textAlign = 'left'; c.textBaseline = 'middle';
    const ownCity = city.palace.faction === faction;
    const height = ownCity ? CITY_RIBBON_HEIGHT : CITY_NAME_RIBBON_HEIGHT;
    c.font = gameFont(20, 500);
    const columns = (ownCity ? [
        { text: `${Math.round(city.population)} / ${Math.round(city.housing)}`, color: '#e8e7df' },
        { text: signed(city.food), color: CITY_FOOD_COLOR },
        { text: signed(city.gold), color: CITY_GOLD_COLOR },
        { text: String(Math.round(city.palace.loyalty?.value ?? LOYALTY_START)), color: loyaltyWarning(city.palace) ? '#ffae88' : '#c3d58b', wreath: true },
    ] : []).map(column => ({ ...column, width: c.measureText(column.text).width + ('wreath' in column ? 24 : 0) }));
    const numbersWidth = columns.reduce((sum, column) => sum + column.width, 0) + (ownCity ? 36 : 0);
    c.font = gameFont(18, 500);
    const name = ellipsis(c, city.name, Math.max(18, Math.min(220, maxWidth - 28)));
    const nameWidth = c.measureText(name).width;
    // Keep the native frame at 2× while giving its larger text room to breathe.
    const width = Math.ceil((Math.max(ownCity ? 144 : 72, nameWidth, numbersWidth) + 28) / 2) * 2;
    const left = Math.round(x - width / 2), top = Math.round(y - height / 2);
    drawCityPanelBackground(c, left, top, width, height);
    c.fillStyle = '#faf7ee'; c.fillText(name, left + (width - nameWidth) / 2, top + (ownCity ? 17 : height / 2));
    let cursor = left + (width - numbersWidth) / 2;
    c.font = gameFont(20, 500);
    for (const column of columns) {
        const wreath = 'wreath' in column;
        if (wreath) drawLoyaltyWreath(c, cursor, top + 30, column.color);
        c.fillStyle = column.color; c.fillText(column.text, cursor + (wreath ? 24 : 0), top + 40); cursor += column.width + 12;
    }
    c.restore();
}

/** Small olive branches, drawn on the same pixel grid as the HUD marks. */
export function drawLoyaltyWreath(c: CanvasRenderingContext2D, x: number, y: number, color = '#c3d58b'): void {
    c.save(); c.fillStyle = color;
    for (const side of [-1, 1]) {
        const center = x + 10;
        for (const [dx, dy] of [[3, 1], [6, 5], [7, 9], [6, 13], [3, 16]]) {
            c.fillRect(center + side * dx - 1, y + dy, 3, 2);
            c.fillRect(center + side * (dx + 1) - 1, y + dy - 2, 2, 3);
        }
        c.fillRect(center + (side < 0 ? -3 : 0), y + 18, 4, 2);
    }
    c.restore();
}
