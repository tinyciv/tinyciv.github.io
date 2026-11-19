import { cannonFireImage, CANNON_FIRE_FRAME_COUNT, CANNON_FIRE_FRAME_SIZE } from './cannon-fire-art';
import { pointInSight, type FogView } from './fog';
import type { PixiScene } from './pixi-scene';
import { isMountedKind, tileAt, WATER, type Point, type Unit, type World } from './types';

const SAMPLE_SECONDS = .125;
const MAX_SAMPLE_GAP = .4;
const MAX_SAMPLE_TRAVEL = 1.5;
const TRACK_SECONDS = 5;
const MAX_TRACKS = 1536;
const CHUNK_SIZE = 8;

const SURFACES = {
    desert: { impression: '#78512d', rim: '#f7d9a0', opacity: .59, dust: '#f8dfa7', puffSeconds: .72, puffSize: .83, puffAlpha: .89 },
    plains: { impression: '#665030', rim: '#dfcb91', opacity: .43, dust: '#ddc698', puffSeconds: .48, puffSize: .52, puffAlpha: .66 },
    grassland: { impression: '#3d5028', rim: '#c2cb7c', opacity: .38, dust: '#d5c39b', puffSeconds: .42, puffSize: .46, puffAlpha: .58 },
    tundra: { impression: '#52665c', rim: '#e3ead3', opacity: .40, dust: '#d7ddd0', puffSeconds: .42, puffSize: .46, puffAlpha: .58 },
};
type Surface = keyof typeof SURFACES;
type TrackStyle = 'foot' | 'hoof' | 'wheel';
const STRIDE = { foot: .37, hoof: .42, wheel: .32 };
const TRACK_SIZE = 8;

interface TrailCursor extends Point { sample: number; remaining: number; step: number }
export interface UnitTrack extends Point {
    at: number; angle: number; chunk: number; surface: Surface; style: TrackStyle; puff: boolean;
}
interface Bounds { left: number; right: number; top: number; bottom: number }

/** Local presentation history. Only already-visible units are sampled, and
 * only viewport chunks are drawn. The ring bounds decals even in large battles. */
export class UnitTrails {
    private world?: World;
    private faction?: number;
    private time = -Infinity;
    private lastSample = -Infinity;
    private sample = 0;
    private cursors = new Map<number, TrailCursor>();
    private columns = 0;
    private chunks = new Map<number, Set<UnitTrack>>();
    private tracks = new Array<UnitTrack>(MAX_TRACKS);
    private first = 0;
    private count = 0;

    beginFrame(world: World, faction: number, time: number): boolean {
        if (world !== this.world || faction !== this.faction || time < this.time) {
            this.world = world;
            this.faction = faction;
            this.columns = Math.ceil(world.width / CHUNK_SIZE);
            this.lastSample = -Infinity;
            this.sample = this.first = this.count = 0;
            this.cursors.clear();
            this.chunks.clear();
        }
        this.time = time;
        while (this.count && time >= this.tracks[this.first].at + TRACK_SECONDS) this.removeOldest();
        if (time + 1e-7 < this.lastSample + SAMPLE_SECONDS) return false;
        if (time - this.lastSample > MAX_SAMPLE_GAP) this.cursors.clear();
        this.lastSample = time;
        this.sample++;
        if (this.sample % 8 === 0) for (const [id, cursor] of this.cursors)
            if (cursor.sample < this.sample - 1) this.cursors.delete(id);
        return true;
    }

    observe(unit: Unit, world: World, fog: FogView): void {
        if (!unit.moving || unit.kind === 'sailboat' || unit.embarkedOn !== undefined || unit.aboardRowboat
            || unit.aboardRiverTrade || unit.wallPatrol?.wall !== undefined) {
            this.cursors.delete(unit.id);
            return;
        }
        const style = trackStyle(unit.kind), stride = STRIDE[style];
        const cursor = this.cursors.get(unit.id);
        if (!cursor || cursor.sample !== this.sample - 1) {
            this.cursors.set(unit.id, { x: unit.x, y: unit.y, sample: this.sample, remaining: stride, step: unit.id & 1 });
            return;
        }
        const x = cursor.x, y = cursor.y, dx = unit.x - x, dy = unit.y - y;
        cursor.x = unit.x;
        cursor.y = unit.y;
        cursor.sample = this.sample;
        const distance = Math.hypot(dx, dy);
        if (distance > MAX_SAMPLE_TRAVEL) { cursor.remaining = stride; return; }
        if (distance < cursor.remaining) { cursor.remaining -= distance; return; }
        const ux = dx / distance, uy = dy / distance, angle = Math.atan2(dy, dx);
        while (cursor.remaining <= distance) {
            const step = cursor.step++;
            const offset = style === 'wheel' ? 0 : (step & 1 ? 1 : -1) * (style === 'hoof' ? .11 : .085);
            const px = x + ux * cursor.remaining - uy * offset, py = y + uy * cursor.remaining + ux * offset;
            cursor.remaining += stride;
            const tile = tileAt(world, px, py);
            if (!tile || WATER.has(tile.terrain) || !pointInSight(fog, px, py)) continue;
            const surface = tile.terrain as Surface;
            const puff = !tile.marsh && !tile.creek && (surface === 'desert' || (step & 1) === 0);
            this.add(px, py, angle, surface, style, puff);
        }
        cursor.remaining -= distance;
    }

    forEachVisible(bounds: Bounds, fog: FogView, draw: (track: UnitTrack, age: number) => void): void {
        if (!this.count) return;
        const { left, right, top, bottom } = bounds;
        const lastColumn = Math.min(this.columns - 1, Math.floor(right / CHUNK_SIZE));
        for (let row = Math.floor(top / CHUNK_SIZE); row <= Math.floor(bottom / CHUNK_SIZE); row++) {
            for (let column = Math.floor(left / CHUNK_SIZE); column <= lastColumn; column++) {
                const tracks = this.chunks.get(row * this.columns + column);
                if (!tracks) continue;
                for (const track of tracks) {
                    if (track.x < left || track.x > right || track.y < top || track.y > bottom || !pointInSight(fog, track.x, track.y)) continue;
                    draw(track, this.time - track.at);
                }
            }
        }
    }

    private add(x: number, y: number, angle: number, surface: Surface, style: TrackStyle, puff: boolean): void {
        if (this.count === MAX_TRACKS) this.removeOldest();
        const chunk = Math.floor(y / CHUNK_SIZE) * this.columns + Math.floor(x / CHUNK_SIZE);
        let cell = this.chunks.get(chunk);
        if (!cell) this.chunks.set(chunk, cell = new Set());
        const index = (this.first + this.count++) % MAX_TRACKS;
        const track = this.tracks[index] ??= {} as UnitTrack;
        track.x = x; track.y = y; track.at = this.time; track.angle = angle;
        track.chunk = chunk; track.surface = surface; track.style = style; track.puff = puff;
        cell.add(track);
    }

    private removeOldest(): void {
        const track = this.tracks[this.first], cell = this.chunks.get(track.chunk)!;
        cell.delete(track);
        if (!cell.size) this.chunks.delete(track.chunk);
        this.first = (this.first + 1) % MAX_TRACKS;
        this.count--;
    }
}

function trackStyle(kind: Unit['kind']): TrackStyle {
    if (kind === 'fieldCannon' || kind === 'supplyCart') return 'wheel';
    if (isMountedKind(kind) || kind === 'deer' || kind === 'boar' || kind === 'buffalo') return 'hoof';
    return 'foot';
}

export function drawUnitTrack(scene: PixiScene, track: UnitTrack, age: number, tileSize: number): void {
    const surface = SURFACES[track.surface], pixel = tileSize / 16;
    const picture = scene.art.paint(`unit-track:${track.style}:${track.surface}`, { x: 0, y: 0, width: TRACK_SIZE, height: TRACK_SIZE }, c => {
        c.fillStyle = surface.impression;
        if (track.style === 'wheel') {
            c.fillRect(1, 2, 1, 4); c.fillRect(6, 2, 1, 4);
            c.fillStyle = surface.rim;
            c.fillRect(2, 3, 1, 2); c.fillRect(7, 3, 1, 2);
        } else if (track.style === 'hoof') {
            c.fillRect(3, 3, 2, 2);
            c.fillStyle = surface.rim;
            c.fillRect(5, 4, 1, 1);
        } else {
            c.fillRect(3, 3, 2, 1); c.fillRect(3, 4, 1, 2);
            c.fillStyle = surface.rim;
            c.fillRect(4, 4, 1, 1);
        }
    }, 1);
    const sprite = scene.image(picture.texture, track.x * tileSize, track.y * tileSize, TRACK_SIZE * pixel, TRACK_SIZE * pixel,
        surface.opacity * (1 - age / TRACK_SECONDS));
    sprite.anchor.set(.5);
    sprite.rotation = track.angle + Math.PI / 2;
}

export function unitDustVisible(track: UnitTrack, age: number): boolean {
    return track.puff && age < SURFACES[track.surface].puffSeconds;
}

export function drawUnitDust(scene: PixiScene, track: UnitTrack, age: number, tileSize: number): void {
    const sheet = cannonFireImage();
    if (!sheet) return;
    const surface = SURFACES[track.surface], phase = age / surface.puffSeconds;
    // Reuse the PixelLab smoke frames after ignition, with a dusty palette.
    const frame = 2 + Math.floor(phase * (CANNON_FIRE_FRAME_COUNT - 2)), size = CANNON_FIRE_FRAME_SIZE;
    const picture = scene.art.paint(`unit-dust:${track.surface}:${frame}`, { x: -16, y: -24, width: size, height: size }, c => {
        c.drawImage(sheet, frame * size, 0, size, size, -16, -24, size, size);
        c.globalCompositeOperation = 'source-atop';
        c.globalAlpha = .8;
        c.fillStyle = surface.dust;
        c.fillRect(-16, -24, size, size);
    }, 1);
    const drift = phase * .23, spread = .7 + .4 * phase + (track.style === 'foot' ? 0 : .12);
    scene.sprite(picture, (track.x - Math.cos(track.angle) * drift) * tileSize,
        (track.y - Math.sin(track.angle) * drift - phase * .09) * tileSize,
        tileSize / 32 * surface.puffSize * spread, surface.puffAlpha * (1 - phase) ** 1.3);
}
