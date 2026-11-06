import { playerFaction } from './player-context';
import { CITY_GOLD_COLOR } from './city-ribbon';
import { buildingInSight, type FogView } from './fog';
import { researchStatus } from './research';
import { buildingArtTop, buildingReady, buildingWidth, type GameState } from './types';

export const RESEARCH_BAR_WIDTH = 44;
export const RESEARCH_BAR_HEIGHT = 5;
export const RESEARCH_BAR_GAP = 8;

/** Libraries share one faction research project and do not stack speed. Every
 * completed player library displays that project; enemy projects stay private.
 * The bar reads simulated progress directly, so it remains frozen when paused. */
export function drawResearchBars(c: CanvasRenderingContext2D, state: GameState, fog: FogView,
    ox: number, oy: number, size: number, viewportWidth: number, viewportHeight: number): void {
    const faction = state.factions.find(candidate => candidate.id === playerFaction(state));
    if (!faction || faction.defeated || state.gameOver) return;
    const research = researchStatus(state, playerFaction(state));
    if (!research.library || research.completed || research.required <= 0 || research.progress >= research.required) return;
    const fraction = Math.max(0, research.progress / research.required);
    for (const library of state.buildings) {
        if (library.kind !== 'library' || library.faction !== playerFaction(state) || !buildingReady(library) || !buildingInSight(fog, library)) continue;
        // Screen-sized like city ribbons; center on the full 2x2 footprint.
        // Leave room below for a damaged building's separate health bar.
        const x = Math.round(ox + (library.x + buildingWidth(library) / 2) * size - RESEARCH_BAR_WIDTH / 2);
        const y = Math.round(oy + (library.y + buildingArtTop(library)) * size - RESEARCH_BAR_GAP - RESEARCH_BAR_HEIGHT);
        if (x + RESEARCH_BAR_WIDTH < 0 || x > viewportWidth || y + RESEARCH_BAR_HEIGHT < 0 || y > viewportHeight) continue;
        c.save(); c.globalAlpha = 1;
        c.fillStyle = 'rgba(0,0,0,.76)'; c.strokeStyle = 'rgba(232,197,111,.48)'; c.lineWidth = 1;
        c.beginPath(); c.roundRect(x + .5, y + .5, RESEARCH_BAR_WIDTH - 1, RESEARCH_BAR_HEIGHT - 1, 2); c.fill(); c.stroke();
        if (fraction > 0) {
            c.fillStyle = CITY_GOLD_COLOR;
            c.fillRect(x + 1, y + 1, (RESEARCH_BAR_WIDTH - 2) * fraction, RESEARCH_BAR_HEIGHT - 2);
        }
        c.restore();
    }
}
