import type { GameState, Point } from '../game/types';
import { ArmyWarningFeed, armyWarningPosition, separateArmyWarning, type PresentedArmyWarning, type WarningPosition } from './army-warning-layout';
import './army-warnings.css';
import { MeasuredSize } from './measured-size';

let nextTooltip = 0;
/** Approved art is installed at this path after review; until then town
 * alerts keep the plain exclamation sign rather than a broken image. */
const townArtwork = import.meta.glob('/public/assets/ui/alerts/town.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const TOWN_ICON_URL = townArtwork['/public/assets/ui/alerts/town.png'];
let townIconReady = false;
if (TOWN_ICON_URL && typeof Image === 'function') { const probe = new Image(); probe.onload = () => { townIconReady = true; }; probe.src = TOWN_ICON_URL; }

export class ArmyWarnings {
  private readonly feed = new ArmyWarningFeed();
  private readonly layer = document.createElement('div');
  private readonly tooltip = document.createElement('div');
  private readonly markers = new Map<number, HTMLButtonElement>();
  private selected?: number;
  private generation = -1;
  private readonly parentSize: MeasuredSize;
  constructor(private readonly parent: HTMLElement, private readonly getState: () => GameState,
    private readonly screenPoint: (point: Point) => Point) {
    this.parentSize = new MeasuredSize(parent);
    this.layer.className = 'army-warnings';
    this.layer.setAttribute('aria-label', 'Army and town alerts');
    if (TOWN_ICON_URL) this.layer.style.setProperty('--town-icon', `url('${TOWN_ICON_URL}')`);
    this.tooltip.className = 'army-warning-tooltip'; this.tooltip.id = `army-warning-tooltip-${++nextTooltip}`;
    this.tooltip.setAttribute('role', 'tooltip'); this.tooltip.hidden = true;
    this.layer.append(this.tooltip); parent.append(this.layer);
  }
  private marker(event: PresentedArmyWarning): HTMLButtonElement {
    let marker = this.markers.get(event.id);
    if (marker) return marker;
    marker = document.createElement('button'); marker.type = 'button'; marker.className = 'army-warning';
    marker.dataset.warningId = String(event.id); marker.dataset.kind = event.kind;
    marker.setAttribute('aria-label', event.message); marker.setAttribute('aria-describedby', this.tooltip.id);
    marker.style.setProperty('--faction-color', event.color);
    const sign = document.createElement('span'); sign.className = 'army-warning-sign'; sign.setAttribute('aria-hidden', 'true');
    // Town alerts show the city icon once its approved art is installed.
    if (event.kind === 'town' && townIconReady) sign.classList.add('town-icon'); else sign.textContent = '!';
    const bearing = document.createElement('span'); bearing.className = 'army-warning-bearing'; bearing.setAttribute('aria-hidden', 'true');
    marker.append(sign, bearing);
    const show = () => {
      this.selected = event.id; this.tooltip.textContent = event.message; this.tooltip.hidden = false;
      this.placeTooltip(Number.parseFloat(marker!.style.left), Number.parseFloat(marker!.style.top));
    };
    const hide = () => { if (this.selected === event.id) { this.selected = undefined; this.tooltip.hidden = true; } };
    marker.addEventListener('pointerenter', show);
    marker.addEventListener('pointerleave', () => { if (document.activeElement !== marker) hide(); });
    marker.addEventListener('focus', show); marker.addEventListener('blur', hide);
    marker.addEventListener('click', event => { event.stopPropagation(); show(); });
    marker.addEventListener('pointerdown', event => event.stopPropagation());
    marker.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); marker!.blur(); hide(); } });
    this.markers.set(event.id, marker); this.layer.append(marker);
    return marker;
  }
  private placeTooltip(x: number, y: number): void {
    const width = this.parent.clientWidth, height = this.parent.clientHeight;
    const tooltipWidth = Math.min(300, width - 16);
    this.tooltip.style.width = `${tooltipWidth}px`;
    const tooltipHeight = this.tooltip.offsetHeight;
    this.tooltip.style.left = `${Math.max(8, Math.min(width - tooltipWidth - 8, x - tooltipWidth / 2))}px`;
    this.tooltip.style.top = `${y + 30 + tooltipHeight < height - 8 ? y + 30 : Math.max(8, y - 30 - tooltipHeight)}px`;
  }
  update(now: number, enabled = true): void {
    const events = this.feed.update(this.getState(), now);
    if (this.generation !== this.feed.generation) {
      for (const marker of this.markers.values()) marker.remove();
      this.markers.clear(); this.selected = undefined; this.tooltip.hidden = true; this.generation = this.feed.generation;
    }
    this.layer.hidden = !enabled;
    const { width, height } = this.parentSize.read();
    const visible: { event: PresentedArmyWarning; position: WarningPosition }[] = [];
    // Show the newest attack per edge. The number of markers stays bounded
    // even when many units take simultaneous damage in different regions.
    const attacks = new Map<string, typeof visible[number]>();
    const sideInset = Math.min(26, width / 4);
    if (enabled) for (const event of events) {
      const attack = event.kind === 'attack';
      const point = this.screenPoint(attack ? event : { x: event.x, y: event.y - 1.2 });
      if (attack && point.x >= 0 && point.x < width && point.y >= 0 && point.y < height) continue;
      const position = armyWarningPosition(point, width, height);
      const entry = { event, position };
      if (!attack) { visible.push(entry); continue; }
      const side = position.x <= sideInset + .01 ? 'left' : position.x >= width - sideInset - .01 ? 'right'
        : position.y < height / 2 ? 'top' : 'bottom';
      const previous = attacks.get(side);
      if (!previous || previous.event.id < event.id) attacks.set(side, entry);
    }
    visible.push(...attacks.values());
    const live = new Set(visible.map(({ event }) => event.id));
    for (const [id, marker] of this.markers) if (!live.has(id)) {
      marker.remove(); this.markers.delete(id);
      if (this.selected === id) { this.selected = undefined; this.tooltip.hidden = true; }
    }
    const occupied: Point[] = [];
    for (const { event, position: anchor } of visible) {
      const position = separateArmyWarning(anchor, occupied, width, height);
      occupied.push(position);
      const marker = this.marker(event);
      marker.dataset.edge = String(position.edge);
      marker.style.left = `${position.x}px`; marker.style.top = `${position.y}px`;
      marker.style.setProperty('--bearing', `${position.angle}rad`);
      marker.style.opacity = String(Math.min(1, (event.expiresAt - now) / 250));
      if (this.selected === event.id) this.placeTooltip(position.x, position.y);
    }
  }
}
