import { actionTooltip } from './action-tooltips';
import { type GameState, type Point } from '../game/types';
import { resourceDevelopmentStatus, developResourceGroup, oliveVillageTradeMultiplier,
    saltFoodConsumptionMultiplier, RESOURCE_DEVELOPMENT_COST } from '../game/resource-development';
import { RESOURCE_NAMES } from '../game/geography';
import { playerFaction } from '../game/player-context';
import { isVisible } from '../game/fog';
import { resourceAtPoint } from '../game/resource-hit-testing';
import { activityPopupLayout } from './building-activity';
import { logEvent } from '../game/simulation';
import type { GameCommand } from '../multiplayer/protocol';

const descriptions: Record<string, string> = {
    copper: 'A developed copper mine supplies your whole faction’s spearmen. Military Tactics and a blacksmith are also required.',
    iron: 'A developed iron mine supplies your whole faction’s ballistae and blacksmith upgrades. Research requirements still apply.',
    stone: 'Develop a stone quarry. Stone has no additional bonus yet.',
    salt: 'Each developed tile cuts food consumption by 25% for 10 residents across your faction. Total savings cannot exceed 25%.',
    olives: 'Each developed olive tree adds 2% to your faction’s trade with neutral villages.',
};

/** Resource activity follows the selected deposit and uses the existing HUD frame. */
export class ResourceActivityPopup {
    private point: Point | undefined;
    private nextRefreshAt = -Infinity;
    constructor(private readonly element: HTMLElement, private readonly getState: () => GameState,
        private readonly project: (point: Point) => Point, private readonly viewport: () => { width: number; height: number },
        private readonly changed: () => void, private readonly focusWorld: () => void,
        private readonly sendCommand?: (command: GameCommand) => boolean) {
        element.innerHTML = `<button class="activity-close" type="button" aria-label="Close resource activity">×</button>
            <h2 id="resource-activity-title"></h2><div class="activity-stack">
            <p class="activity-note resource-city"></p><p class="resource-effect"></p>
            <button type="button" class="activity-upgrade" data-resource-develop><span class="upgrade-label">Develop resource</span>
            <span class="upgrade-price"></span><small class="resource-count"></small></button>
            <p class="activity-note resource-status"></p><p class="resource-message" role="status"></p></div>`;
        element.addEventListener('pointerdown', event => event.stopPropagation());
        element.querySelector<HTMLButtonElement>('.activity-close')!.onclick = () => { this.close(); this.focusWorld(); };
        element.querySelector<HTMLButtonElement>('[data-resource-develop]')!.onclick = () => {
            if (!this.point) return;
            const command: GameCommand = { type: 'develop-resource', ...this.point };
            if (this.sendCommand?.(command)) return;
            const result = developResourceGroup(this.getState(), this.point.x, this.point.y);
            this.message(result.message);
            if (result.ok) { logEvent(this.getState(), result.message, 'good'); this.changed(); }
            this.refresh();
        };
    }
    get isOpen(): boolean { return !!this.point; }
    close(): void { this.point = undefined; this.element.hidden = true; }
    message(text: string): void { this.element.querySelector<HTMLElement>('.resource-message')!.textContent = text; }

    open(point: Point): boolean {
        const state = this.getState(), resourcePoint = resourceAtPoint(state, point);
        if (!resourcePoint) return false;
        const { x, y } = resourcePoint;
        const status = resourceDevelopmentStatus(state, x, y);
        if (!status.resource || !descriptions[status.resource] || status.city?.faction !== playerFaction(state)) return false;
        this.point = { x, y }; this.message(''); this.refresh(); return true;
    }
    refresh(now = performance.now()): void {
        if (!this.point) return;
        this.nextRefreshAt = now + 300;
        const state = this.getState(), status = resourceDevelopmentStatus(state, this.point.x, this.point.y);
        if (state.gameOver || !status.resource || !status.city || status.city.faction !== playerFaction(state)
            || !isVisible(state, this.point.x, this.point.y)) { this.close(); return; }
        this.element.querySelector<HTMLElement>('#resource-activity-title')!.textContent = RESOURCE_NAMES[status.resource];
        this.element.querySelector<HTMLElement>('.resource-city')!.textContent = status.city.cityName || 'City resource';
        const faction = playerFaction(state);
        const bonus = status.resource === 'olives' ? ` Current bonus: +${Math.round((oliveVillageTradeMultiplier(state, faction) - 1) * 100)}%.`
            : status.resource === 'salt' ? ` Current food savings: ${Math.round((1 - saltFoodConsumptionMultiplier(state, faction)) * 1000) / 10}%.` : '';
        this.element.querySelector<HTMLElement>('.resource-effect')!.textContent = descriptions[status.resource] + bonus;
        const button = this.element.querySelector<HTMLButtonElement>('[data-resource-develop]')!;
        button.disabled = !status.ok;
        button.title = actionTooltip('Develops this connected resource deposit for your faction.', status.cost, 0, status.ok ? '' : status.message);
        button.querySelector<HTMLElement>('.upgrade-label')!.textContent = status.cells.length ? 'Develop resource' : 'Developed';
        button.querySelector<HTMLElement>('.upgrade-price')!.textContent = status.cells.length ? `${status.cost} gold` : '';
        button.querySelector<HTMLElement>('.resource-count')!.textContent = status.cells.length
            ? `${status.cells.length} tile${status.cells.length === 1 ? '' : 's'} · ${RESOURCE_DEVELOPMENT_COST} gold each` : `${status.developedCount} developed tile${status.developedCount === 1 ? '' : 's'}`;
        this.element.querySelector<HTMLElement>('.resource-status')!.textContent = status.ok
            ? 'Develops eligible connected tiles inside this city’s borders. Benefits serve your whole faction.' : status.message;
        this.position();
    }
    update(now = performance.now()): void {
        if (!this.point) return;
        if (now >= this.nextRefreshAt) this.refresh(now); else this.position();
    }
    private position(): void {
        if (!this.point) return;
        this.element.hidden = false;
        const layout = activityPopupLayout(this.project({ x: this.point.x + .5, y: this.point.y }), this.viewport(),
            { width: this.element.offsetWidth, height: this.element.offsetHeight });
        this.element.hidden = !layout.visible;
        this.element.style.left = `${layout.left}px`; this.element.style.top = `${layout.top}px`;
    }
}
