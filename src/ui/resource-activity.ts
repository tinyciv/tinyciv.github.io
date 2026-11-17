import { type GameState, type Point } from '../game/types';
import { resourceDevelopmentStatus, developResourceGroup } from '../game/resource-development';
import { RESOURCE_NAMES } from '../game/geography';
import { playerFaction } from '../game/player-context';
import { isVisible } from '../game/fog';
import { resourceAtPoint } from '../game/resource-hit-testing';
import { activityPopupLayout } from './building-activity';
import { MeasuredSize } from './measured-size';
import { logEvent } from '../game/simulation';
import type { GameCommand } from '../multiplayer/protocol';
import { icon } from './icons';

/** Resource activity follows the selected deposit and uses the existing HUD frame. */
export class ResourceActivityPopup {
    private point: Point | undefined;
    private nextRefreshAt = -Infinity;
    private readonly size: MeasuredSize;
    constructor(private readonly element: HTMLElement, private readonly getState: () => GameState,
        private readonly project: (point: Point) => Point, private readonly viewport: () => { width: number; height: number },
        private readonly changed: () => void, private readonly focusWorld: () => void,
        private readonly sendCommand?: (command: GameCommand) => boolean) {
        this.size = new MeasuredSize(element);
        element.innerHTML = `<button class="activity-close" type="button" aria-label="Close resource activity">×</button>
            <h2 id="resource-activity-title"></h2><div class="activity-stack">
            <p class="activity-note resource-city"></p>
            <button type="button" class="activity-upgrade" data-resource-develop><span class="upgrade-label">Develop resource</span>
            <span class="upgrade-price"><span class="resource-cost"></span>${icon('gold')}</span></button>
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
        if (!status.resource || status.city?.faction !== playerFaction(state)) return false;
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
        const button = this.element.querySelector<HTMLButtonElement>('[data-resource-develop]')!;
        button.disabled = !status.ok;
        button.title = status.ok ? '' : status.message;
        button.querySelector<HTMLElement>('.upgrade-label')!.textContent = status.cells.length ? status.remainingCount && status.ok ? 'Develop affordable tiles' : 'Develop resource' : 'Developed';
        button.querySelector<HTMLElement>('.upgrade-price')!.hidden = !status.cells.length;
        button.querySelector<HTMLElement>('.resource-cost')!.textContent = String(status.cost);
        this.element.querySelector<HTMLElement>('.resource-status')!.textContent = status.ok
            ? `${status.cells.length} tile${status.cells.length === 1 ? '' : 's'}${status.remainingCount ? ` · ${status.remainingCount} remaining` : ''}` : status.message;
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
            this.size.read());
        this.element.hidden = !layout.visible;
        this.element.style.left = `${layout.left}px`; this.element.style.top = `${layout.top}px`;
    }
}
