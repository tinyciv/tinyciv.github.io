import { COASTAL_FRAME_COUNT, drawCoastalFrame } from './coastal-life-art';
import { dockBerth } from './dock';
import { buildingInSight, pointInSight, type FogView } from './fog';
import type { PixiScene } from './pixi-scene';
import { buildingReady, tileAt, WATER, type Building, type Point, type Unit, type World } from './types';
import type { CoastalBounds } from './water-wakes';

const SAMPLE_SECONDS = .5;
const CHUNK = 5;
const APPROACH_RADIUS = 2.4;
const MAX_DISCOVERIES = 8;
const MAX_MARSH_FLIGHTS = 2;
const MAX_HARBOR_FLIGHTS = 2;
const HARBOR_SECONDS = 6.5;
const MARSH_SECONDS = 3.3;
const FOLLOWER_DELAY = .24;
const HEADING_STEP = Math.PI / 8;

interface RoostChunk { spots: Point[]; lastApproach: number; readyAt: number }
interface Flight extends Point { at: number; heading: number }
interface Bird extends Point { kind: 'gull' | 'heron'; frame: number; heading: number; altitude: number; alpha: number }

function randomPhase(key: number): number {
    const hash = Math.imul(key ^ key >>> 16, 0x45d9f3b);
    return ((hash ^ hash >>> 16) >>> 0) / 0x100000000;
}

function inView(point: Point, bounds: CoastalBounds): boolean {
    return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
}

function flap(time: number, index: number): number {
    const phase = (time * 1.32 + index * .37) % 1;
    return phase < .68 ? Math.floor(phase / .68 * COASTAL_FRAME_COUNT) : 0;
}

function takeoffHeading(world: World, roost: Point, unit: Point): number {
    const away = Math.atan2(roost.y - unit.y, roost.x - unit.x);
    let heading = away, best = -Infinity;
    // Herons favor clear air over water or a gap in the reeds. These are
    // fixed presentation probes made only when a pair actually takes flight.
    for (const turn of [0, -.65, .65, -1.3, 1.3, -1.95, 1.95]) {
        const angle = away + turn, dx = Math.cos(angle), dy = Math.sin(angle);
        let score = Math.cos(turn) * 1.2;
        for (const distance of [1.25, 2.75, 4.25]) {
            const tile = tileAt(world, roost.x + dx * distance, roost.y + dy * distance);
            if (!tile) score -= 2;
            else if (WATER.has(tile.terrain)) score += 2;
            else if (!tile.marsh && tile.overlay === 'none') score += 1;
            else score -= .5;
        }
        if (score > best) { best = score; heading = angle; }
    }
    return heading;
}

/** Cosmetic only. Docks use staggered flight times. Marsh takeoffs sample the
 * already visible moving units and discover a bounded number of chunks each tick. */
export class AmbientBirds {
    private world?: World;
    private viewer?: number;
    private time = -Infinity;
    private nextSampleAt = -Infinity;
    private nextTakeoffAt = -Infinity;
    private discoveriesLeft = 0;
    private sample = 0;
    private roosts = new Map<number, RoostChunk>();
    private takeoffs: Flight[] = [];
    private poses: Bird[] = [];
    private dockSource?: readonly Building[];
    private docks: Building[] = [];

    beginFrame(world: World, viewer: number, time: number): boolean {
        if (this.world !== world || this.viewer !== viewer || time < this.time) {
            this.world = world; this.viewer = viewer;
            this.nextSampleAt = this.nextTakeoffAt = -Infinity;
            this.sample = 0;
            this.roosts.clear();
            this.takeoffs.length = 0;
            this.dockSource = undefined;
        }
        this.time = time;
        this.poses.length = 0;
        for (let i = this.takeoffs.length - 1; i >= 0; i--)
            if (time >= this.takeoffs[i].at + MARSH_SECONDS + FOLLOWER_DELAY) this.takeoffs.splice(i, 1);
        if (time + 1e-7 < this.nextSampleAt) return false;
        // A skipped presentation interval should not count as continued proximity.
        if (time > this.nextSampleAt + SAMPLE_SECONDS) this.sample++;
        this.sample++;
        this.nextSampleAt = time + SAMPLE_SECONDS;
        this.discoveriesLeft = MAX_DISCOVERIES;
        return true;
    }

    observeApproach(unit: Unit, fog: FogView, bounds: CoastalBounds): void {
        if (!unit.moving || unit.faction < 0 || unit.kind === 'sailboat' || unit.aboardRiverTrade || unit.aboardRowboat
            || unit.embarkedOn !== undefined || unit.wallPatrol?.wall !== undefined || !inView(unit, bounds)) return;
        const world = this.world!, tile = tileAt(world, unit.x, unit.y);
        if (!tile || WATER.has(tile.terrain) || !pointInSight(fog, unit.x, unit.y)) return;
        const left = Math.max(0, Math.floor((unit.x - APPROACH_RADIUS) / CHUNK));
        const right = Math.floor(Math.min(world.width - 1, unit.x + APPROACH_RADIUS) / CHUNK);
        const top = Math.max(0, Math.floor((unit.y - APPROACH_RADIUS) / CHUNK));
        const bottom = Math.floor(Math.min(world.height - 1, unit.y + APPROACH_RADIUS) / CHUNK);
        let closest: Point | undefined, home: RoostChunk | undefined, distanceSquared = APPROACH_RADIUS ** 2;
        for (let row = top; row <= bottom; row++) for (let column = left; column <= right; column++) {
            const chunk = this.roostsIn(world, column, row);
            if (!chunk) continue;
            for (const roost of chunk.spots) {
                const distance = (roost.x - unit.x) ** 2 + (roost.y - unit.y) ** 2;
                if (distance >= distanceSquared || !inView(roost, bounds) || !pointInSight(fog, roost.x, roost.y)
                    || !tileAt(world, roost.x, roost.y)?.marsh) continue;
                closest = roost; home = chunk; distanceSquared = distance;
            }
        }
        if (!closest || !home) return;
        const arrival = home.lastApproach < this.sample - 1;
        home.lastApproach = this.sample;
        if (!arrival || this.time < home.readyAt || this.time < this.nextTakeoffAt || this.takeoffs.length >= MAX_MARSH_FLIGHTS) return;
        const heading = takeoffHeading(world, closest, unit);
        this.takeoffs.push({ x: closest.x, y: closest.y, at: this.time, heading });
        home.readyAt = this.time + 25 + randomPhase(Math.floor(closest.y) * world.width + Math.floor(closest.x)) * 10;
        this.nextTakeoffAt = this.time + 2;
    }

    collect(structures: readonly Building[], fog: FogView, bounds: CoastalBounds): void {
        if (structures !== this.dockSource) {
            this.dockSource = structures;
            this.docks = structures.filter(b => b.kind === 'dock');
        }
        let harborFlights = 0;
        for (const dock of this.docks) {
            if (!buildingReady(dock)) continue;
            const phase = randomPhase(dock.y * this.world!.width + dock.x + 119), period = 22 + phase * 10;
            const age = (this.time + phase * period) % period;
            if (age >= HARBOR_SECONDS || !buildingInSight(fog, dock)) continue;
            const berth = dockBerth(dock), dx = berth.x - (dock.x + .5), dy = berth.y - (dock.y + .5);
            const centerX = berth.x + dx * .74, centerY = berth.y + dy * .74;
            const before = this.poses.length;
            for (let i = 0; i < 3; i++) {
                const angle = age * .88 + i * .31 + phase * Math.PI * 2;
                const x = centerX + Math.cos(angle) * 1.79, y = centerY + Math.sin(angle) * 1.41 + i * .25;
                const alpha = Math.min(1, age / .55, (HARBOR_SECONDS - age) / .72);
                this.addPose('gull', age, i, x, y, Math.atan2(Math.cos(angle) * 1.41, -Math.sin(angle) * 1.79),
                    .68 + Math.sin(angle * 2 + i) * .11, alpha, bounds, fog);
            }
            if (this.poses.length > before && ++harborFlights >= MAX_HARBOR_FLIGHTS) break;
        }
        for (const flight of this.takeoffs) {
            for (let i = 0; i < 2; i++) {
                const age = this.time - flight.at - i * FOLLOWER_DELAY;
                if (age <= 0 || age >= MARSH_SECONDS) continue;
                const heading = flight.heading + (i ? .21 : -.12), travel = age * 1.72;
                const x = flight.x + Math.cos(heading) * travel - i * .29, y = flight.y + Math.sin(heading) * travel + i * .18;
                const altitude = (1 - Math.exp(-age * 2.1)) * (1.05 + .11 * i);
                const alpha = Math.min(1, age / .27, (MARSH_SECONDS - age) / .5);
                this.addPose('heron', age * 1.1, i, x, y, heading, altitude, alpha, bounds, fog);
            }
        }
    }

    draw(scene: PixiScene, fog: FogView, tileSize: number, shadows: boolean): void {
        for (const bird of this.poses) {
            const size = (bird.kind === 'gull' ? .53 : .60) * tileSize;
            const x = shadows ? bird.x + bird.altitude * .26 : bird.x;
            const y = shadows ? bird.y + bird.altitude * .19 : bird.y - bird.altitude;
            if (!pointInSight(fog, x, y)) continue;
            drawCoastalFrame(scene, bird.kind, bird.frame, x * tileSize, y * tileSize, size, shadows ? size * .54 : size,
                bird.heading, shadows ? bird.alpha * .27 : bird.alpha, shadows);
        }
    }

    private addPose(kind: Bird['kind'], time: number, index: number, x: number, y: number, heading: number, altitude: number,
        alpha: number, bounds: CoastalBounds, fog: FogView): void {
        const point = { x, y };
        if (alpha <= 0 || !inView(point, bounds) || !pointInSight(fog, x, y)) return;
        const rotation = Math.round(heading / HEADING_STEP) * HEADING_STEP;
        this.poses.push({ ...point, kind, frame: flap(time, index), heading: rotation, altitude, alpha });
    }

    private roostsIn(world: World, column: number, row: number): RoostChunk | undefined {
        const key = row * Math.ceil(world.width / CHUNK) + column;
        const cached = this.roosts.get(key);
        if (cached || !this.discoveriesLeft) return cached;
        this.discoveriesLeft--;
        const spots: Point[] = [];
        for (let y = row * CHUNK; y < Math.min(world.height, (row + 1) * CHUNK); y++) {
            for (let x = column * CHUNK; x < Math.min(world.width, (column + 1) * CHUNK); x++) {
                const tile = world.tiles[y * world.width + x];
                if (tile.marsh && !WATER.has(tile.terrain)) spots.push({ x: x + .5, y: y + .5 });
            }
        }
        const chunk = { spots, lastApproach: -Infinity, readyAt: -Infinity };
        this.roosts.set(key, chunk);
        return chunk;
    }
}
