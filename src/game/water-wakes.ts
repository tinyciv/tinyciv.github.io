import { COASTAL_FRAME_COUNT, drawCoastalFrame } from './coastal-life-art';
import { pointInSight, type FogView } from './fog';
import type { PixiScene } from './pixi-scene';
import { tileAt, WATER, type Point, type Unit, type World } from './types';

const SAMPLE_SECONDS = .125;
const MAX_SAMPLE_GAP = .4;
const MAX_JUMP = 1.75;
const MAX_MARKS = 320;
const MAX_AGE = 1.8;
const DRIFT = .20;

const PROFILES = {
    rowboat: { art: 'ripple', stern: .47, width: .49, length: .68, spacing: .36, life: .94, alpha: .62 },
    fishing: { art: 'ripple', stern: .81, width: .53, length: .79, spacing: .43, life: 1.14, alpha: .64 },
    galley: { art: 'foam', stern: .84, width: 1.04, length: .98, spacing: .51, life: 1.30, alpha: .82 },
    trade: { art: 'wash', stern: .91, width: .99, length: 1.02, spacing: .51, life: 1.64, alpha: .79 },
    whaling: { art: 'wash', stern: 1.38, width: 1.10, length: 1.17, spacing: .55, life: 1.64, alpha: .79 },
    warGalley: { art: 'foam', stern: 2.45, width: 1.38, length: 1.30, spacing: .68, life: 1.65, alpha: .83 },
    warship: { art: 'wash', stern: 2.55, width: 1.42, length: 1.40, spacing: .71, life: MAX_AGE, alpha: .83 },
} as const;
type WakeKind = keyof typeof PROFILES;
type Profile = (typeof PROFILES)[WakeKind];
export type VesselPose = Point & { moving: boolean };
export interface CoastalBounds { left: number; top: number; right: number; bottom: number }
interface Cursor extends Point { sample: number; remaining: number; kind: WakeKind }
interface Wake extends Point { at: number; dx: number; dy: number; angle: number; size: number; profile: Profile }

export function wakeForUnit(unit: Unit): WakeKind | undefined {
    if (unit.kind === 'sailboat') {
        if (!unit.warship) return 'galley';
        return unit.warship.class === 'warGalley' ? 'warGalley' : 'warship';
    }
    if (unit.aboardRowboat || unit.aboardRiverTrade) return 'rowboat';
}

function isOpenWater(world: World, x: number, y: number): boolean {
    const tile = tileAt(world, x, y);
    return !!tile && WATER.has(tile.terrain) && tile.overlay !== 'ford' && !tile.seaIce;
}

/** Check the entire envelope the foam can cover as it spreads and drifts. */
function wakeFits(world: World, x: number, y: number, dx: number, dy: number, profile: Profile, size: number): boolean {
    const width = profile.width * size * 1.15 / 2, length = profile.length * size / 2;
    const rx = Math.abs(dy) * width + Math.abs(dx) * length, ry = Math.abs(dx) * width + Math.abs(dy) * length;
    const endX = x - dx * DRIFT, endY = y - dy * DRIFT;
    const left = Math.floor(Math.min(x, endX) - rx), right = Math.floor(Math.max(x, endX) + rx);
    const top = Math.floor(Math.min(y, endY) - ry), bottom = Math.floor(Math.max(y, endY) + ry);
    for (let row = top; row <= bottom; row++) for (let column = left; column <= right; column++)
        if (!isOpenWater(world, column, row)) return false;
    return true;
}

/** Presentation-only path samples. Retain a fixed ring of marks in world
 * coordinates so turns bend the trail and stops let the foam dissipate. */
export class WaterWakes {
    private world?: World;
    private faction?: number;
    private time = -Infinity;
    private lastSample = -Infinity;
    private sample = 0;
    private cursors = new Map<number | string, Cursor>();
    private marks = new Array<Wake>(MAX_MARKS);
    private first = 0;
    private count = 0;

    beginFrame(world: World, faction: number, time: number): boolean {
        if (this.world !== world || this.faction !== faction || time < this.time) {
            this.world = world; this.faction = faction;
            this.lastSample = -Infinity;
            this.sample = this.first = this.count = 0;
            this.cursors.clear();
        }
        this.time = time;
        while (this.count && time >= this.marks[this.first].at + MAX_AGE) this.removeOldest();
        if (time + 1e-7 < this.lastSample + SAMPLE_SECONDS) return false;
        if (time - this.lastSample > MAX_SAMPLE_GAP) this.cursors.clear();
        this.lastSample = time;
        this.sample++;
        if (this.sample % 8 === 0) for (const [key, cursor] of this.cursors)
            if (cursor.sample < this.sample - 1) this.cursors.delete(key);
        return true;
    }

    observe(key: number | string, boat: VesselPose, kind: WakeKind, fog: FogView): void {
        const world = this.world!;
        if (!boat.moving || !isOpenWater(world, boat.x, boat.y) || !pointInSight(fog, boat.x, boat.y)) {
            this.cursors.delete(key);
            return;
        }
        const profile = PROFILES[kind], cursor = this.cursors.get(key);
        if (!cursor || cursor.sample !== this.sample - 1 || cursor.kind !== kind) {
            this.cursors.set(key, { x: boat.x, y: boat.y, remaining: profile.spacing * .5, sample: this.sample, kind });
            return;
        }
        const x = cursor.x, y = cursor.y, dx = boat.x - x, dy = boat.y - y;
        cursor.x = boat.x; cursor.y = boat.y; cursor.sample = this.sample;
        const distance = Math.hypot(dx, dy);
        if (distance > MAX_JUMP) { cursor.remaining = profile.spacing * .5; return; }
        if (distance < cursor.remaining) { cursor.remaining -= distance; return; }
        const ux = dx / distance, uy = dy / distance, angle = Math.atan2(dy, dx) + Math.PI / 2;
        while (cursor.remaining <= distance) {
            const offset = cursor.remaining - profile.stern, px = x + ux * offset, py = y + uy * offset;
            cursor.remaining += profile.spacing;
            if (!pointInSight(fog, px, py)) continue;
            const size = wakeFits(world, px, py, ux, uy, profile, 1) ? 1 : .6;
            if (size === 1 || wakeFits(world, px, py, ux, uy, profile, size)) this.add(px, py, ux, uy, angle, size, profile);
        }
        cursor.remaining -= distance;
    }

    draw(scene: PixiScene, fog: FogView, bounds: CoastalBounds, tileSize: number): void {
        for (let i = 0; i < this.count; i++) {
            const mark = this.marks[(this.first + i) % MAX_MARKS], p = mark.profile;
            const progress = (this.time - mark.at) / p.life;
            if (progress >= 1) continue;
            const x = mark.x - mark.dx * progress * DRIFT, y = mark.y - mark.dy * progress * DRIFT;
            if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom
                || !pointInSight(fog, x, y) || !isOpenWater(this.world!, x, y)) continue;
            drawCoastalFrame(scene, p.art, Math.floor(progress * COASTAL_FRAME_COUNT), x * tileSize, y * tileSize,
                p.width * mark.size * tileSize * (.9 + .25 * progress), p.length * mark.size * tileSize,
                mark.angle, p.alpha * (1 - progress) ** .9);
        }
    }

    private add(x: number, y: number, dx: number, dy: number, angle: number, size: number, profile: Profile): void {
        if (this.count === MAX_MARKS) this.removeOldest();
        const index = (this.first + this.count++) % MAX_MARKS;
        const mark = this.marks[index] ??= { x, y, dx, dy, angle, size, profile, at: this.time };
        mark.x = x; mark.y = y; mark.dx = dx; mark.dy = dy;
        mark.angle = angle; mark.size = size; mark.profile = profile; mark.at = this.time;
    }

    private removeOldest(): void {
        this.first = (this.first + 1) % MAX_MARKS;
        this.count--;
    }
}
