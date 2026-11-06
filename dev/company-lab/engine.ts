import { Navigation, type FlowField } from './navigation';
import { createWorld } from './scenarios';
import { updateCombat } from './combat';
import { updateRecovery } from './recovery';
import { CombatSlots } from './combat-slots';
import { findConvoyDetour } from './convoy-detour';
import type { BattleSize, Company, CompanyOrder, LabOptions, LabStats, LabWorld, Point, Soldier, Team, Projectile, BattleEvent } from './types';
export const SIZES: Record<BattleSize, number> = { small: 6, medium: 20, large: 60, stress: 120 };
const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const center = (p: Point): Point => ({ x: Math.floor(p.x) + .5, y: Math.floor(p.y) + .5 });
const percentile = (values: number[], q: number) => values.length ? [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * q)] : 0;
/** An isolated company experiment. No production game state or orders are used. */
export class CompanyLab {
    world!: LabWorld;
    nav!: Navigation;
    options!: LabOptions;
    companies: Company[] = [];
    soldiers: Soldier[] = [];
    time = 0;
    combatEnabled = true;
    projectiles: Projectile[] = [];
    events: BattleEvent[] = [];
    combatMetrics = { damageEvents: 0, shots: 0, kills: 0 };
    stats: LabStats = { stepMs: 0, p95StepMs: 0, frameMs: 0, pathMs: 0, maxPathMs: 0, searches: 0, cacheHits: 0, expanded: 0, alive: 0, moving: 0, waiting: 0, stuckUnits: 0, idleDrift: 0, cohesionP95: 0, maxOverlap: 0, arrivals: 0, routeFailures: 0, kills: 0, damageEvents: 0 };
    private fields = new Map<string, FlowField>();
    private orderGoals = new Map<number, Point>();
    private chains = new Map<number, number[]>();
    private deployed = new Set<number>();
    private docking = new Map<number, Point[]>();
    private convoyRoutes = new Map<number, {
        goal: number;
        route: Point[];
    }>();
    private detourAt = new Map<number, number>();
    private detourBudget = 2;
    private combatSlots = new CombatSlots();
    private battlePositions = new Map<number, Point>();
    private nextCombatSlots = 0;
    private assembly = new Map<number, Map<number, Point>>();
    private battleResolved = false;
    private nextRecovery = 0;
    private byId = new Map<number, Soldier>();
    private motionBuckets = new Map<number, number[]>();
    private occupancy!: Int32Array;
    private reservations!: Int32Array;
    private noParking!: Uint8Array;
    private resting = new Set<number>();
    private idleTravel = 0;
    private idleSeconds = 0;
    private stepSamples: number[] = [];
    private fieldBudget = 2;
    private lastMetrics = -1;
    private diagonals = new Set<string>();
    private wave = 0;
    constructor(options: LabOptions = { scenario: 'plain', size: 'small' }) { this.reset(options); }
    canStep = (ax: number, ay: number, bx: number, by: number) => this.nav.canStep(ax, ay, bx, by);
    private key(p: Point): number { return Math.floor(p.y) * this.world.width + Math.floor(p.x); }
    private at(index: number): Point { return { x: index % this.world.width + .5, y: Math.floor(index / this.world.width) + .5 }; }
    private living(company: Company): Soldier[] { return company.soldierIds.map(id => this.byId.get(id)!).filter(s => s.hp > 0); }
    reset(options: LabOptions = this.options): void {
        this.options = { ...options };
        this.world = createWorld(options.scenario, options.size === 'stress');
        this.nav = new Navigation(this.world, 512);
        this.time = 0;
        this.battleResolved = false;
        this.nextRecovery = 0;
        this.combatEnabled = options.combat !== false;
        this.companies = [];
        this.soldiers = [];
        this.byId.clear();
        this.fields.clear();
        this.orderGoals.clear();
        this.chains.clear();
        this.deployed.clear();
        this.docking.clear();
        this.convoyRoutes.clear();
        this.detourAt.clear();
        this.assembly.clear();
        this.combatSlots.clear();
        this.battlePositions.clear();
        this.nextCombatSlots = 0;
        this.resting.clear();
        this.projectiles = [];
        this.events = [];
        this.combatMetrics = { damageEvents: 0, shots: 0, kills: 0 };
        this.idleTravel = 0;
        this.idleSeconds = 0;
        this.stepSamples = [];
        this.lastMetrics = -1;
        this.wave = 0;
        this.occupancy = new Int32Array(this.world.width * this.world.height);
        this.reservations = new Int32Array(this.occupancy.length);
        this.noParking = new Uint8Array(this.occupancy.length);
        for (let y = 0; y < this.world.height; y++)
            for (let x = 0; x < this.world.width; x++) {
                const p = { x: x + .5, y: y + .5 }, kind = this.world.tiles[this.key(p)];
                if (!this.nav.passable(x, y))
                    continue;
                if (kind !== 6 && kind !== 8 && this.neighbors(p).length > 2)
                    continue;
                // A formation may pass through a gate/bridge/ramp, but never park on its
                // landing. Keep two tiles clear around these mandatory traffic links.
                for (let dy = -2; dy <= 2; dy++)
                    for (let dx = -2; dx <= 2; dx++)
                        if (dx * dx + dy * dy <= 4 && x + dx >= 0 && y + dy >= 0 && x + dx < this.world.width && y + dy < this.world.height)
                            this.noParking[(y + dy) * this.world.width + x + dx] = 1;
            }
        const used = new Set<number>();
        let unitId = 1;
        for (const team of [0, 1] as const) {
            const base = this.world.bases[team], count = SIZES[options.size];
            const cells: Point[] = [];
            for (let y = 2; y < this.world.height - 2; y++)
                for (let x = 2; x < this.world.width - 2; x++)
                    if (this.nav.passable(x, y) && (team === 0 ? x < this.world.width * .36 : x > this.world.width * .64))
                        cells.push({ x: x + .5, y: y + .5 });
            cells.sort((a, b) => gap(a, base) - gap(b, base) || a.y - b.y || a.x - b.x);
            for (let i = 0; i < count; i++) {
                let chain: Point[] | undefined;
                for (const p of cells) {
                    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
                        const candidate = [p, { x: p.x + dx, y: p.y + dy }, { x: p.x + dx * 2, y: p.y + dy * 2 }];
                        if (candidate.every(q => this.nav.passable(q.x, q.y) && !used.has(this.key(q))) && this.nav.canStep(candidate[0].x, candidate[0].y, candidate[1].x, candidate[1].y) && this.nav.canStep(candidate[1].x, candidate[1].y, candidate[2].x, candidate[2].y)) {
                            chain = candidate;
                            break;
                        }
                    }
                    if (chain)
                        break;
                }
                if (!chain)
                    break;
                const point = chain[0];
                const id = this.companies.length + 1, kind = i % 4 === 3 ? 'archer' : 'infantry';
                const company: Company = { id, team, kind, x: point.x, y: point.y, order: 'defend', status: 'Holding', soldierIds: [], goal: { ...point }, rally: { ...point }, selected: false, veterancy: 0, kills: 0, experience: 0, mode: 'line', lastCombatAt: -100, lastAssignedAt: 0, replenishAt: 0 };
                const members = chain.slice(0, 3);
                for (const p of members) {
                    used.add(this.key(p));
                    const hp = kind === 'archer' ? 70 : 100;
                    const soldier: Soldier = { id: unitId++, company: id, team, kind, x: p.x, y: p.y, hp, maxHp: hp, speed: 3.15, moving: false, facing: team ? Math.PI : 0, cooldown: 0, attackUntil: 0, damageFlash: 0, traveled: 0, lastProgressAt: 0, fromX: p.x, fromY: p.y, toX: p.x, toY: p.y, progress: 1, duration: 0, slot: { ...p } };
                    this.soldiers.push(soldier);
                    this.byId.set(soldier.id, soldier);
                    company.soldierIds.push(soldier.id);
                    this.resting.add(soldier.id);
                }
                this.companies.push(company);
                this.orderGoals.set(id, { ...point });
                this.chains.set(id, company.soldierIds.slice());
            }
        }
        this.updateCenters();
        this.rebuildOccupancy();
        if (this.combatEnabled)
            for (const team of [0, 1] as const)
                this.command(team, this.world.bases[team ? 0 : 1], 'attack');
        this.publishMetrics(0);
    }
    setCombat(enabled: boolean): void {
        this.combatEnabled = enabled;
        if (!enabled)
            for (const c of this.companies) {
                c.engagementGoal = undefined;
                c.targetCompany = undefined;
                for (const s of this.living(c))
                    s.targetId = undefined;
            }
    }
    select(ids: number[]): void { const selected = new Set(ids); for (const c of this.companies)
        c.selected = selected.has(c.id); }
    command(team: Team, point: Point, order: CompanyOrder = 'move', ids?: number[]): void {
        const selected = ids ? new Set(ids) : undefined, companies = this.companies.filter(c => c.team === team && this.living(c).length && (!selected || selected.has(c.id)));
        if (!companies.length)
            return;
        const destination = this.nav.nearestOpen(order === 'retreat' ? this.world.bases[team] : point, this.living(companies[0])[0]);
        const field = this.nav.field(destination, this.living(companies[0])[0]);
        this.fields.set(`${Math.floor(destination.x)},${Math.floor(destination.y)}`, field);
        const reserved = new Set<number>();
        const assigned = new Set(companies.map(c => c.id));
        for (const c of this.companies)
            if (c.team === team && !assigned.has(c.id))
                for (const s of this.living(c))
                    reserved.add(this.key(s.slot));
        const cells: Point[] = [];
        for (let i = 0; i < field.distances.length; i++)
            if (Number.isFinite(field.distances[i]) && this.nav.passable(i % this.world.width, Math.floor(i / this.world.width)))
                cells.push(this.at(i));
        cells.sort((a, b) => gap(a, destination) - gap(b, destination) || a.y - b.y || a.x - b.x);
        // Allocate complete compact clusters before assigning companies. Never leave
        // the third member with its obsolete spawn destination.
        const clusters: Point[][] = [];
        const horizontal = Math.abs(destination.x - companies[0].x) >= Math.abs(destination.y - companies[0].y);
        for (const rally of cells) {
            if (clusters.length >= companies.length)
                break;
            const x = Math.floor(rally.x), y = Math.floor(rally.y);
            if (horizontal ? (x % 3 !== 0 || y % 4 !== 0) : (y % 3 !== 0 || x % 4 !== 0))
                continue;
            const cluster = [rally, { x: rally.x + (horizontal ? 0 : 1), y: rally.y + (horizontal ? 1 : 0) }, { x: rally.x + (horizontal ? 0 : 2), y: rally.y + (horizontal ? 2 : 0) }];
            if (cluster.some(p => reserved.has(this.key(p)) || this.noParking[this.key(p)] || !this.nav.passable(p.x, p.y)) || !this.nav.canStep(cluster[0].x, cluster[0].y, cluster[1].x, cluster[1].y) || !this.nav.canStep(cluster[1].x, cluster[1].y, cluster[2].x, cluster[2].y))
                continue;
            clusters.push(cluster);
            for (const p of cluster)
                reserved.add(this.key(p));
        }
        if (clusters.length < companies.length)
            for (const rally of cells) {
                if (clusters.length >= companies.length)
                    break;
                if (reserved.has(this.key(rally)) || this.noParking[this.key(rally)])
                    continue;
                const nearby = [rally, ...this.neighbors(rally)].filter(p => !reserved.has(this.key(p)) && !this.noParking[this.key(p)]);
                if (nearby.length < 3)
                    continue;
                const cluster = nearby.slice(0, 3);
                clusters.push(cluster);
                for (const p of cluster)
                    reserved.add(this.key(p));
            }
        const average = { x: companies.reduce((n, c) => n + c.x, 0) / companies.length, y: companies.reduce((n, c) => n + c.y, 0) / companies.length };
        const dx = destination.x - average.x, dy = destination.y - average.y;
        // Fill the far side first so early arrivals do not seal the front door.
        clusters.sort((a, b) => (b[0].x - a[0].x) * dx + (b[0].y - a[0].y) * dy);
        const waiting = [...companies];
        for (const cluster of clusters) {
            const rally = cluster[0];
            waiting.sort((a, b) => gap(a, rally) - gap(b, rally) || a.id - b.id);
            const company = waiting.shift()!;
            const members = this.living(company), available = [...members];
            for (const p of cluster) {
                if (!available.length)
                    break;
                available.sort((a, b) => gap(a, p) - gap(b, p) || a.id - b.id);
                const soldier = available.shift()!;
                soldier.slot = { ...p };
                soldier.waitSince = undefined;
                soldier.lastProgressAt = this.time;
                this.detourAt.delete(soldier.id);
                this.resting.delete(soldier.id);
            }
            company.order = order;
            company.goal = { ...rally };
            company.rally = { ...rally };
            company.status = 'Moving';
            company.engagementGoal = undefined;
            company.targetCompany = undefined;
            company.lastAssignedAt = this.time;
            this.docking.set(company.id, cluster.slice(0, members.length).map(p => ({ ...p })));
            this.orderGoals.set(company.id, { ...destination });
            this.convoyRoutes.delete(company.id);
            this.deployed.delete(company.id);
            this.assembly.delete(company.id);
            this.combatSlots.clear([company.id]);
            this.chains.set(company.id, [...members].sort((a, b) => field.distances[this.key(a)] - field.distances[this.key(b)] || a.id - b.id).map(s => s.id));
            for (const soldier of members)
                soldier.targetId = undefined;
        }
        this.idleTravel = 0;
        this.idleSeconds = 0;
    }
    private getField(goal: Point, from: Point): FlowField | undefined {
        const key = `${Math.floor(goal.x)},${Math.floor(goal.y)}`;
        const found = this.fields.get(key);
        if (found) {
            this.nav.stats.cacheHits++;
            return found;
        }
        if (this.fieldBudget <= 0)
            return;
        this.fieldBudget--;
        const field = this.nav.field(goal, from);
        this.fields.set(key, field);
        if (this.fields.size > 512)
            this.fields.delete(this.fields.keys().next().value!);
        return field;
    }
    private clearLine(a: Point, b: Point): boolean {
        const steps = Math.ceil(gap(a, b) * 3);
        let previous = center(a);
        for (let i = 1; i <= steps; i++) {
            const p = center({ x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps });
            if (this.key(p) !== this.key(previous) && !this.nav.canStep(previous.x, previous.y, p.x, p.y))
                return false;
            previous = p;
        }
        return true;
    }
    private updateCenters(): void {
        for (const c of this.companies) {
            const members = this.living(c);
            if (!members.length) {
                c.status = 'Destroyed';
                continue;
            }
            c.x = members.reduce((n, s) => n + s.x, 0) / members.length;
            c.y = members.reduce((n, s) => n + s.y, 0) / members.length;
        }
    }
    private rebuildOccupancy(): void {
        this.occupancy.fill(0);
        this.reservations.fill(0);
        this.diagonals.clear();
        this.motionBuckets.clear();
        for (const s of this.soldiers)
            if (s.hp > 0) {
                const origin = this.key(s.moving ? { x: s.fromX, y: s.fromY } : s), previous = this.byId.get(this.occupancy[origin]);
                if (!previous || !s.moving || previous.moving && s.progress < previous.progress)
                    this.occupancy[origin] = s.id;
                for (const cell of new Set([this.key(s), origin, ...(s.moving ? [this.key({ x: s.toX, y: s.toY })] : [])])) {
                    const bucket = this.motionBuckets.get(cell) ?? [];
                    bucket.push(s.id);
                    this.motionBuckets.set(cell, bucket);
                }
                if (s.moving) {
                    this.reservations[this.key({ x: s.toX, y: s.toY })] = s.id;
                    this.reserveDiagonal(s.fromX, s.fromY, s.toX, s.toY);
                }
            }
    }
    private diagonalKey(ax: number, ay: number, bx: number, by: number): string | undefined {
        const x = Math.floor(ax), y = Math.floor(ay), xx = Math.floor(bx), yy = Math.floor(by);
        return x !== xx && y !== yy ? `${Math.min(x, xx)},${Math.min(y, yy)}` : undefined;
    }
    private reserveDiagonal(ax: number, ay: number, bx: number, by: number): void { const key = this.diagonalKey(ax, ay, bx, by); if (key)
        this.diagonals.add(key); }
    private vacant(s: Soldier, p: Point): boolean {
        const index = this.key(p), diagonal = this.diagonalKey(s.x, s.y, p.x, p.y), occupant = this.byId.get(this.occupancy[index]);
        let clear = !occupant || occupant.id === s.id;
        if (occupant && occupant.team === s.team && occupant.moving) {
            const ax = p.x - s.x, ay = p.y - s.y, bx = occupant.toX - occupant.fromX, by = occupant.toY - occupant.fromY;
            // A convoy may enter a cell already being vacated in the same direction.
            // Equal travel speed preserves spacing without stop/start tile queues.
            clear = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by)) > .99;
        }
        return clear && this.cohesive(s, p) && this.safeTrain([s], p) && !this.reservations[index] && (!diagonal || !this.diagonals.has(diagonal));
    }
    private cohesive(s: Soldier, p: Point): boolean {
        const members = this.living(this.companies[s.company - 1]);
        if (members.length < 2)
            return true;
        const radius = (replace: boolean) => {
            const points = members.map(m => m.id === s.id && replace ? p : m.moving ? { x: m.toX, y: m.toY } : m);
            const mean = { x: points.reduce((n, a) => n + a.x, 0) / points.length, y: points.reduce((n, a) => n + a.y, 0) / points.length };
            return Math.max(...points.map(a => gap(a, mean)));
        };
        const next = radius(true);
        return next <= 2.65 || next < radius(false) - .01;
    }
    private beginMove(s: Soldier, p: Point): void {
        s.fromX = s.x;
        s.fromY = s.y;
        s.toX = p.x;
        s.toY = p.y;
        s.progress = 0;
        s.duration = gap(s, p) / s.speed;
        s.moving = true;
        s.facing = Math.atan2(p.y - s.y, p.x - s.x);
        this.reservations[this.key(p)] = s.id;
        this.reserveDiagonal(s.x, s.y, p.x, p.y);
        s.waitSince = undefined;
        const bucket = this.motionBuckets.get(this.key(p)) ?? [];
        bucket.push(s.id);
        this.motionBuckets.set(this.key(p), bucket);
    }
    private neighbors(s: Point): Point[] { const points: Point[] = []; for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
            if ((dx || dy) && this.nav.canStep(s.x, s.y, s.x + dx, s.y + dy))
                points.push({ x: Math.floor(s.x) + dx + .5, y: Math.floor(s.y) + dy + .5 }); return points; }
    private tryYield(blocker: Soldier, requester: Soldier, desired: Point): boolean {
        if (blocker.team !== requester.team || blocker.moving || blocker.hp <= 0 || blocker.targetId !== undefined)
            return false;
        const options = this.neighbors(blocker).filter(p => this.vacant(blocker, p) && this.key(p) !== this.key(requester));
        options.sort((a, b) => gap(a, desired) - gap(b, desired) || gap(a, blocker.slot) - gap(b, blocker.slot));
        const point = options[0];
        if (!point)
            return false;
        // Yielding is a new stable resting place, not a trip back into traffic.
        if (this.resting.has(blocker.id))
            blocker.slot = { ...point };
        this.beginMove(blocker, point);
        return true;
    }
    private desired(s: Soldier, c: Company): Point {
        if (c.engagementGoal) {
            const target = this.byId.get(s.targetId ?? -1);
            const range = s.kind === 'archer' ? 4.8 : 1.35;
            if (target && target.hp > 0 && gap(s, target) <= range && this.clearLine(s, target))
                return center(s);
            return this.battlePositions.get(s.id) ?? center(s);
        }
        return this.assembly.get(c.id)?.get(s.id) ?? s.slot;
    }
    private planMove(s: Soldier, c: Company): void {
        const desired = this.desired(s, c);
        const close = gap(s, desired) < .12;
        if (close) {
            s.waitSince = undefined;
            if (!c.engagementGoal && gap(s, s.slot) < .15)
                this.resting.add(s.id);
            return;
        }
        const straight = this.clearLine(s, desired);
        let field: FlowField | undefined;
        if (!straight) {
            const shared = this.orderGoals.get(c.id) ?? c.goal;
            field = this.getField(c.engagementGoal || gap(desired, s.slot) > .1 ? desired : shared, s);
            if (!c.engagementGoal && gap(desired, s.slot) < .1 && field && gap(s, shared) < Math.max(5, gap(desired, shared) + 2))
                field = this.getField(desired, s) ?? field;
        }
        let candidates = this.neighbors(s);
        const score = (p: Point) => straight ? gap(p, desired) : (field ? field.distances[this.key(p)] : gap(p, desired));
        const current = straight ? gap(s, desired) : (field ? field.distances[this.key(s)] : gap(s, desired));
        // Prefer stable progress. Lateral moves are a bounded response to real
        // congestion, never a random steering force applied to resting companies.
        candidates.sort((a, b) => score(a) - score(b) || gap(a, desired) - gap(b, desired) || this.key(a) - this.key(b));
        let next = candidates.find(p => score(p) < current - 1e-5 && this.vacant(s, p));
        if (!next) {
            s.waitSince ??= this.time;
            const best = candidates.find(p => score(p) < current - 1e-5);
            const blocker = best && this.byId.get(this.occupancy[this.key(best)]);
            if (blocker && this.time - s.waitSince > .3)
                this.tryYield(blocker, s, desired);
            if (this.time - s.waitSince > 1.1)
                next = candidates.find(p => this.vacant(s, p) && this.key(p) !== s.previousCell && score(p) <= current + (straight ? .5 : 1.45));
            if (!next) {
                if (!straight && !field)
                    this.stats.routeFailures++;
                return;
            }
        }
        s.previousCell = this.key(s);
        this.beginMove(s, next);
    }
    private trainOrder(c: Company): Soldier[] | undefined {
        const living = this.living(c), old = this.chains.get(c.id) ?? c.soldierIds;
        const permutations = living.length === 3 ? [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]] : living.length === 2 ? [[0, 1], [1, 0]] : [[0]];
        const options = permutations.map(p => p.map(i => living[i])).filter(p => p.every((m, i) => i === 0 || this.nav.canStep(m.x, m.y, p[i - 1].x, p[i - 1].y)) && (p.length < 3 || this.segmentGap(p[1], p[0], p[2], p[1]) >= .6 - 1e-6));
        options.sort((a, b) => a.reduce((n, m, i) => n + (m.id === old[i] ? 0 : 100), 0) - b.reduce((n, m, i) => n + (m.id === old[i] ? 0 : 100), 0) || gap(a[0], c.goal) - gap(b[0], c.goal));
        return options[0];
    }
    private segmentGap(a: Point, aa: Point, b: Point, bb: Point): number {
        const x = a.x - b.x, y = a.y - b.y, dx = (aa.x - a.x) - (bb.x - b.x), dy = (aa.y - a.y) - (bb.y - b.y);
        const t = Math.max(0, Math.min(1, -(x * dx + y * dy) / (dx * dx + dy * dy || 1)));
        return Math.hypot(x + dx * t, y + dy * t);
    }
    private safeTrain(train: Soldier[], next: Point): boolean {
        const targets = [next, ...train.slice(0, -1).map(s => center(s))], ids = new Set(train.map(s => s.id));
        const duration = Math.max(...train.map((s, i) => gap(s, targets[i]))) / train[0].speed;
        for (let i = 0; i < train.length; i++) {
            for (let j = i + 1; j < train.length; j++)
                if (this.segmentGap(train[i], targets[i], train[j], targets[j]) < .6 - 1e-6)
                    return false;
            const nearby = new Set<number>();
            for (const p of [train[i], targets[i]])
                for (let dy = -1; dy <= 1; dy++)
                    for (let dx = -1; dx <= 1; dx++) {
                        const cell = this.key(p) + dy * this.world.width + dx;
                        for (const id of this.motionBuckets.get(cell) ?? [])
                            nearby.add(id);
                    }
            for (const id of nearby) {
                if (!id || ids.has(id))
                    continue;
                const other = this.byId.get(id)!;
                const remaining = other.moving ? other.duration * (1 - other.progress) : 0;
                const first = Math.min(duration, remaining || duration), ownAt = { x: train[i].x + (targets[i].x - train[i].x) * first / duration, y: train[i].y + (targets[i].y - train[i].y) * first / duration };
                const fraction = remaining > 0 ? Math.min(1, first / remaining) : 0;
                const end = other.moving ? { x: other.x + (other.toX - other.x) * fraction, y: other.y + (other.toY - other.y) * fraction } : other;
                if (this.segmentGap(train[i], ownAt, other, end) < .6 - 1e-6)
                    return false;
                if (first < duration && this.segmentGap(ownAt, targets[i], end, end) < .6 - 1e-6)
                    return false;
            }
        }
        return true;
    }
    private moveTrain(c: Company, reversing = false): boolean {
        const members = this.living(c);
        if (members.some(s => s.moving))
            return true;
        const train = this.trainOrder(c);
        if (!train) {
            if (!this.assembly.has(c.id)) {
                const origin = this.nav.nearestOpen(c, members[0]), candidates = [origin, ...this.neighbors(origin)];
                const triples: Point[][] = [];
                for (const p of candidates)
                    for (const q of this.neighbors(p))
                        for (const r of this.neighbors(q)) {
                            const cells = [p, q, r].slice(0, members.length);
                            if (new Set(cells.map(a => this.key(a))).size !== members.length)
                                continue;
                            if (cells.some(a => { const id = this.occupancy[this.key(a)]; return id && this.byId.get(id)!.company !== c.id; }))
                                continue;
                            triples.push(cells);
                        }
                triples.sort((a, b) => a.reduce((n, p, i) => n + gap(p, members[i]), 0) - b.reduce((n, p, i) => n + gap(p, members[i]), 0));
                if (triples[0])
                    this.assembly.set(c.id, new Map(members.map((s, i) => [s.id, triples[0][i]])));
            }
            return false;
        }
        this.assembly.delete(c.id);
        this.chains.set(c.id, train.map(s => s.id));
        const head = train[0];
        if (gap(head, c.goal) < .15) {
            if (c.engagementGoal)
                return false;
            const dock = this.docking.get(c.id) ?? [], expected = new Set(dock.map(p => this.key(p)));
            if (dock.length && train.some(s => !expected.has(this.key(s)))) {
                c.goal = { ...dock[dock.length - 1] };
            }
            else {
                for (const soldier of train) {
                    soldier.slot = center(soldier);
                    soldier.waitSince = undefined;
                    this.resting.add(soldier.id);
                }
                this.deployed.add(c.id);
                return true;
            }
        }
        const field = this.getField(c.goal, head);
        if (!field)
            return true;
        const keys = new Set(train.map(s => this.key(s))), current = field.distances[this.key(head)];
        const free = (from: Point, p: Point) => { const key = this.key(p), occupant = this.occupancy[key]; return this.nav.canStep(from.x, from.y, p.x, p.y) && (!occupant || keys.has(key)) && !this.reservations[key] && !this.diagonals.has(this.diagonalKey(from.x, from.y, p.x, p.y) ?? ''); };
        const dock = this.docking.get(c.id), docking = !c.engagementGoal && !!dock && gap(head, c.goal) < 4;
        const goalKey = this.key(c.goal), cached = this.convoyRoutes.get(c.id);
        if (cached && cached.goal !== goalKey)
            this.convoyRoutes.delete(c.id);
        let route = this.convoyRoutes.get(c.id)?.route;
        let next = route?.[0];
        if (next && (!free(head, next) || keys.has(this.key(next)) || !this.safeTrain(train, next))) {
            this.convoyRoutes.delete(c.id);
            route = undefined;
            next = undefined;
        }
        if (!next) {
            const options = this.nav.choices(head.x, head.y, field).filter(p => !keys.has(this.key(p)) && free(head, p));
            next = options.find(p => field.distances[this.key(p)] < current - .01 && this.safeTrain(train, p));
        }
        if (!next) {
            for (const soldier of train)
                soldier.waitSince ??= this.time;
            if (this.detourBudget > 0 && this.time - (this.detourAt.get(head.id) ?? -100) > .5) {
                this.detourBudget--;
                this.detourAt.set(head.id, this.time);
                const blocked = new Set<number>(), ids = new Set(train.map(s => s.id));
                for (let i = 0; i < this.occupancy.length; i++)
                    if (this.occupancy[i] && !ids.has(this.occupancy[i]) || this.reservations[i] && !ids.has(this.reservations[i]))
                        blocked.add(i);
                const result = findConvoyDetour({ nav: this.nav, train: train.map(s => center(s)), goal: c.goal, field, blocked, firstStepSafe: p => this.safeTrain(train, p),
                    targetFootprint: docking ? new Set(dock!.map(p => this.key(p))) : undefined, maxExpanded: 1500 });
                this.nav.stats.searches++;
                this.nav.stats.expanded += result.stats.expanded;
                this.nav.stats.totalMs += result.stats.totalMs;
                this.nav.stats.maxMs = Math.max(this.nav.stats.maxMs, result.stats.totalMs);
                if (result.route.length) {
                    route = result.route;
                    this.convoyRoutes.set(c.id, { goal: goalKey, route });
                    next = route[0];
                }
            }
            if (!next) {
                if (!reversing && train.length > 1 && this.time - (head.waitSince ?? this.time) > .5) {
                    this.chains.set(c.id, train.map(s => s.id).reverse());
                    this.moveTrain(c, true);
                    if (!members.some(s => s.moving))
                        this.chains.set(c.id, train.map(s => s.id));
                }
                return true;
            }
        }
        if (route && next === route[0]) {
            route.shift();
            if (!route.length)
                this.convoyRoutes.delete(c.id);
        }
        const targets = [next, ...train.slice(0, -1).map(s => center(s))];
        // Reserve and move the company as one convoy. No other company can insert
        // a member in its middle while crossing a single-cell gate or bridge.
        const duration = Math.max(...train.map((s, i) => gap(s, targets[i]))) / head.speed;
        for (let i = 0; i < train.length; i++) {
            const soldier = train[i];
            this.resting.delete(soldier.id);
            this.beginMove(soldier, targets[i]);
            soldier.duration = duration;
        }
        return true;
    }
    step(dt: number): void {
        if (!Number.isFinite(dt) || dt <= 0)
            return;
        dt = Math.min(dt, .1);
        const started = performance.now();
        this.time += dt;
        this.fieldBudget = 2;
        this.detourBudget = 2;
        for (const s of this.soldiers) {
            s.cooldown = Math.max(0, s.cooldown - dt);
            s.damageFlash = Math.max(0, s.damageFlash - dt);
            if (s.hp <= 0) {
                s.moving = false;
                s.deadAt ??= this.time;
                continue;
            }
            if (this.resting.has(s.id))
                this.idleSeconds += dt;
            if (s.moving) {
                const before = { x: s.x, y: s.y };
                s.progress = Math.min(1, s.progress + dt / s.duration);
                s.x = s.fromX + (s.toX - s.fromX) * s.progress;
                s.y = s.fromY + (s.toY - s.fromY) * s.progress;
                const moved = gap(s, before);
                s.traveled += moved;
                if (this.resting.has(s.id))
                    this.idleTravel += moved;
                if (moved > .00001)
                    s.lastProgressAt = this.time;
                if (s.progress >= 1) {
                    s.x = s.toX;
                    s.y = s.toY;
                    s.moving = false;
                }
            }
        }
        this.updateCenters();
        updateCombat(this, dt);
        if (this.time >= this.nextCombatSlots) {
            this.battlePositions = this.combatSlots.prepareCombatSlots(this, this.nav);
            this.nextCombatSlots = this.time + .2;
        }
        if (this.time >= this.nextRecovery) {
            for (const recruit of updateRecovery(this, .25))
                this.byId.set(recruit.id, recruit);
            this.nextRecovery = this.time + .25;
        }
        this.rebuildOccupancy();
        if (this.combatEnabled && !this.battleResolved) {
            const teams = new Set(this.soldiers.filter(s => s.hp > 0).map(s => s.team));
            if (teams.size === 1) {
                this.battleResolved = true;
                for (const c of this.companies) {
                    const members = this.living(c);
                    if (!members.length)
                        continue;
                    c.order = 'defend';
                    c.engagementGoal = undefined;
                    c.targetCompany = undefined;
                    c.goal = center(c);
                    this.deployed.add(c.id);
                    this.assembly.delete(c.id);
                    for (const soldier of members) {
                        soldier.slot = soldier.moving ? { x: soldier.toX, y: soldier.toY } : center(soldier);
                        soldier.targetId = undefined;
                        soldier.waitSince = undefined;
                        this.resting.add(soldier.id);
                    }
                }
            }
        }
        const handled = new Set<number>();
        const approaching = (c: Company) => !!c.engagementGoal && (gap(c, c.engagementGoal) > 3.5 || !this.clearLine(this.nav.nearestOpen(c), c.engagementGoal));
        const traveling = this.companies.filter(c => this.living(c).length && (!c.engagementGoal && !this.deployed.has(c.id) || approaching(c)));
        traveling.sort((a, b) => gap(a, a.goal) - gap(b, b.goal) || a.id - b.id);
        for (const c of traveling) {
            const goal = c.goal;
            if (approaching(c))
                c.goal = { ...c.engagementGoal! };
            if (this.moveTrain(c))
                handled.add(c.id);
            if (c.engagementGoal)
                c.goal = goal;
        }
        const ready = this.soldiers.filter(s => s.hp > 0 && !s.moving && !handled.has(s.company));
        ready.sort((a, b) => gap(a, this.desired(a, this.companies[a.company - 1])) - gap(b, this.desired(b, this.companies[b.company - 1])) || a.id - b.id);
        this.wave++;
        for (const soldier of ready)
            if (!soldier.moving)
                this.planMove(soldier, this.companies[soldier.company - 1]);
        for (const c of this.companies) {
            const members = this.living(c);
            if (!members.length)
                continue;
            const moving = members.some(s => s.moving), waiting = members.some(s => s.waitSince !== undefined);
            c.mode = c.engagementGoal ? 'combat' : this.neighbors(center(c)).length < 6 ? 'column' : 'line';
            c.status = c.engagementGoal ? (moving ? 'Closing' : members.some(s => s.targetId !== undefined) ? 'Fighting' : 'Waiting for frontage') : moving ? 'Moving' : waiting ? 'Waiting at passage' : 'Holding';
        }
        this.projectiles = this.projectiles.filter(p => this.time - p.bornAt < p.life);
        this.events = this.events.filter(e => this.time - e.bornAt < 2);
        const elapsed = performance.now() - started;
        this.stepSamples.push(elapsed);
        if (this.stepSamples.length > 300)
            this.stepSamples.shift();
        this.stats.stepMs = elapsed;
        if (this.time - this.lastMetrics > .25)
            this.publishMetrics(elapsed);
    }
    private publishMetrics(elapsed: number): void {
        this.lastMetrics = this.time;
        const alive = this.soldiers.filter(s => s.hp > 0), distances: number[] = [];
        for (const c of this.companies)
            for (const s of this.living(c))
                distances.push(gap(s, c));
        const stuck = alive.filter(s => !s.moving && !this.resting.has(s.id) && s.targetId === undefined && this.time - s.lastProgressAt > 4 && gap(s, this.desired(s, this.companies[s.company - 1])) > .3).length;
        let overlap = 0;
        const bins = new Map<number, Soldier[]>();
        for (const soldier of alive) {
            const cell = this.key(soldier);
            const bin = bins.get(cell) ?? [];
            bin.push(soldier);
            bins.set(cell, bin);
        }
        for (const soldier of alive)
            for (let dy = -1; dy <= 1; dy++)
                for (let dx = -1; dx <= 1; dx++)
                    for (const other of bins.get(this.key(soldier) + dy * this.world.width + dx) ?? [])
                        if (other.id > soldier.id)
                            overlap = Math.max(overlap, .6 - gap(soldier, other));
        const nav = this.nav.stats;
        Object.assign(this.stats, { stepMs: elapsed, p95StepMs: percentile(this.stepSamples, .95), pathMs: nav.totalMs, maxPathMs: nav.maxMs, searches: nav.searches, cacheHits: nav.cacheHits, expanded: nav.expanded, alive: alive.length, moving: alive.filter(s => s.moving).length, waiting: alive.filter(s => s.waitSince !== undefined).length, stuckUnits: stuck, idleDrift: this.idleTravel / Math.max(1, this.idleSeconds), cohesionP95: percentile(distances, .95), maxOverlap: overlap, arrivals: alive.filter(s => gap(s, s.slot) < .15).length, kills: this.combatMetrics.kills, damageEvents: this.combatMetrics.damageEvents });
    }
    snapshot() { return { time: this.time, scenario: this.options.scenario, size: this.options.size, stats: { ...this.stats }, teams: ([0, 1] as const).map(team => ({ team, alive: this.soldiers.filter(s => s.team === team && s.hp > 0).length, companies: this.companies.filter(c => c.team === team && this.living(c).length).length })), companies: this.companies.map(c => ({ id: c.id, team: c.team, status: c.status, x: c.x, y: c.y, goal: c.goal, alive: this.living(c).length })) }; }
}
