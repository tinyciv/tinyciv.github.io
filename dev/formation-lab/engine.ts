export interface Point { x: number; y: number }
export interface Soldier extends Point { id: number; hp: number; facing: number; moving: boolean; cooldown: number; hit: number; route: Point[]; targetKey: string; repathAt: number; }
export type Scenario = 'field' | 'gate' | 'winding' | 'urban';
export const NORMAL_SPEED = 3.4, FORMATION_SPEED = NORMAL_SPEED * .7, CATCHUP_SPEED = FORMATION_SPEED * 1.25;
export const SPACING = .72, BODY_RADIUS = .17;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const copy = (p: Point): Point => ({ x: p.x, y: p.y });
export interface World { width: number; height: number; cells: Uint8Array; start: Point; goal: Point; name: string; }
export function makeWorld(scenario: Scenario): World {
  const world: World = { width: 44, height: 28, cells: new Uint8Array(44 * 28), start: { x: 8.5, y: 14.5 }, goal: { x: 35.5, y: 14.5 }, name: scenario };
  const fill = (x: number, y: number, w: number, h: number, kind: number) => {
    for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) world.cells[py * world.width + px] = kind;
  };
  if (scenario === 'gate') { fill(21, 0, 1, 28, 1); fill(21, 14, 1, 1, 0); }
  if (scenario === 'winding') {
    fill(16, 2, 14, 24, 2); fill(16, 14, 5, 2, 0); fill(19, 9, 2, 7, 0);
    fill(19, 9, 8, 2, 0); fill(25, 9, 2, 10, 0); fill(25, 17, 5, 2, 0);
    world.goal.y = 18.5;
  }
  if (scenario === 'urban') {
    for (const [x, y, w, h] of [[15, 3, 4, 9], [15, 16, 4, 9], [22, 7, 4, 11], [29, 2, 4, 9], [29, 15, 4, 11]]) fill(x, y, w, h, 3);
    fill(22, 22, 4, 3, 3); fill(9, 3, 3, 4, 3); fill(36, 4, 3, 4, 3);
  }
  for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++)
    if (!world.cells[y * world.width + x] && (x * 17 + y * 29) % 97 === 0 && (y < 5 || y > 23)) world.cells[y * world.width + x] = 4;
  return world;
}

/** Exact circle-to-tile clearance and sampled swept segments are shared by
 * route smoothing, slot viability, and every actual displacement. */
export class Navigator {
  queries = 0; milliseconds = 0; expanded = 0;
  constructor(readonly world: World) {}
  clear(p: Point, radius = BODY_RADIUS): boolean {
    const { width, height, cells } = this.world;
    if (p.x < radius || p.y < radius || p.x > width - radius || p.y > height - radius) return false;
    for (let y = Math.floor(p.y - radius); y <= Math.floor(p.y + radius); y++) for (let x = Math.floor(p.x - radius); x <= Math.floor(p.x + radius); x++) {
      if (!cells[y * width + x]) continue;
      const dx = p.x - clamp(p.x, x, x + 1), dy = p.y - clamp(p.y, y, y + 1);
      if (dx * dx + dy * dy < radius * radius - 1e-9) return false;
    }
    return true;
  }
  segment(a: Point, b: Point): boolean {
    const steps = Math.max(1, Math.ceil(distance(a, b) / .09));
    for (let i = 0; i <= steps; i++) if (!this.clear({ x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps })) return false;
    return true;
  }
  path(from: Point, to: Point): Point[] {
    const started = performance.now(); this.queries++;
    const finish = (path: Point[]) => { this.milliseconds += performance.now() - started; return path; };
    if (!this.clear(to) || !this.clear(from)) return finish([]);
    if (this.segment(from, to)) return finish([copy(to)]);
    const { width, height } = this.world, start = Math.floor(from.y) * width + Math.floor(from.x), goal = Math.floor(to.y) * width + Math.floor(to.x);
    const scores = new Float64Array(width * height).fill(Infinity), previous = new Int32Array(width * height).fill(-1), closed = new Uint8Array(width * height);
    const heap: { cell: number; f: number }[] = [];
    const push = (cell: number, f: number) => { let i = heap.length; heap.push({ cell, f }); while (i > 0) { const p = (i - 1) >> 1; if (heap[p].f <= f) break; heap[i] = heap[p]; i = p; } heap[i] = { cell, f }; };
    const pop = () => { const result = heap[0], last = heap.pop()!; if (heap.length) { let i = 0; while (i * 2 + 1 < heap.length) { let child = i * 2 + 1; if (child + 1 < heap.length && heap[child + 1].f < heap[child].f) child++; if (heap[child].f >= last.f) break; heap[i] = heap[child]; i = child; } heap[i] = last; } return result.cell; };
    const point = (cell: number) => ({ x: cell % width + .5, y: Math.floor(cell / width) + .5 });
    scores[start] = 0; push(start, distance(from, to)); let found = false;
    while (heap.length) {
      const cell = pop(); if (closed[cell]) continue; closed[cell] = 1; this.expanded++;
      if (cell === goal) { found = true; break; }
      const p = point(cell);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue; const x = p.x + dx, y = p.y + dy;
        if (x < .5 || y < .5 || x >= width || y >= height) continue;
        const next = Math.floor(y) * width + Math.floor(x), q = { x, y };
        if (closed[next] || !this.segment(p, q)) continue;
        const cost = scores[cell] + Math.hypot(dx, dy);
        if (cost >= scores[next]) continue; scores[next] = cost; previous[next] = cell; push(next, cost + distance(q, to));
      }
    }
    if (!found) return finish([]);
    const raw: Point[] = [copy(to)]; for (let cell = goal; cell !== start; cell = previous[cell]) raw.push(point(cell));
    raw.push(point(start)); raw.reverse(); raw.unshift(copy(from));
    const smooth: Point[] = []; let index = 0;
    while (index < raw.length - 1) { let end = raw.length - 1; while (end > index + 1 && !this.segment(raw[index], raw[end])) end--; smooth.push(raw[end]); index = end; }
    return finish(smooth);
  }
}

const soldier = (id: number, p: Point): Soldier => ({ id, ...p, hp: 120, facing: 0, moving: false, cooldown: 0, hit: 0, route: [], targetKey: '', repathAt: 0 });
export function frontMultiplier(formed: boolean, facing: number, source: Point, target: Point): number {
  return formed && Math.cos(angleDelta(facing, Math.atan2(target.y - source.y, target.x - source.x))) >= .5 - 1e-9 ? 2 : 1;
}
export class FormationLab {
  world: World; nav: Navigator; leader: Soldier; troops: Soldier[]; enemies: Soldier[] = [];
  formation = true; mode: 'rectangle' | 'column' | 'loose' = 'rectangle'; time = 0; heading = 0; goal?: Point;
  spine: Point[] = []; lengths: number[] = []; progress = 0; goalDistance = 0; slots: Point[] = [];
  damageDealt = 0; damageTaken = 0; frontalHits = 0; flankHits = 0; compressed = 0; clipping = 0;
  maxCatchupRatio = 0; travelled = 0; slotError = 0; moving = false; settled = true; status = 'Ready for orders';
  sparks: { from: Point; to: Point; at: number; boosted: boolean }[] = [];
  modeSince = 0; private forceTurn?: number; private detachedRoute: Point[] = []; private slow = false;
  private strafe: -1 | 0 | 1 = 0; private strafeHeading = 0; private strafePlanAt = 0;
  constructor(readonly scenario: Scenario = 'gate', readonly count = 12) {
    this.world = makeWorld(scenario); this.nav = new Navigator(this.world); this.leader = soldier(0, this.world.start);
    const columns = count <= 6 ? 3 : 5, rows = count <= 12 ? 3 : 5, candidates: Point[] = [];
    for (let y = -Math.floor(rows / 2); y <= Math.floor(rows / 2); y++) for (let x = -Math.floor(columns / 2); x <= Math.floor(columns / 2); x++) if (x || y) candidates.push({ x: y * SPACING, y: x * SPACING });
    candidates.sort((a, b) => Math.abs(a.x) + Math.abs(a.y) - Math.abs(b.x) - Math.abs(b.y) || a.x - b.x || a.y - b.y);
    // Opposite pairs keep the Leader at the exact centroid even for a partial row.
    const chosen: Point[] = []; for (const p of candidates) { if (chosen.length >= count) break; if (chosen.some(q => q.x === p.x && q.y === p.y)) continue; chosen.push(p, { x: -p.x, y: -p.y }); }
    this.slots = chosen.slice(0, count); this.troops = this.slots.map((slot, i) => soldier(i + 1, { x: this.leader.x + slot.x, y: this.leader.y + slot.y }));
  }
  private rotated(center: Point, slot: Point, angle = this.heading): Point {
    return { x: center.x + Math.cos(angle) * slot.x - Math.sin(angle) * slot.y, y: center.y + Math.sin(angle) * slot.x + Math.cos(angle) * slot.y };
  }
  toggle(): void { this.formation = !this.formation; this.mode = this.formation ? 'rectangle' : 'loose'; this.modeSince = this.time; this.status = this.formation ? 'Forming around the Leader' : 'Formation released'; }
  turn(amount: number): void { this.forceTurn = (this.forceTurn ?? this.heading) + amount; this.status = 'Wheeling'; }
  setStrafe(direction: -1 | 0 | 1): void {
    if (direction === this.strafe) return;
    this.strafe = direction; this.strafePlanAt = 0;
    // Direct keyboard control replaces the current march, and releasing it stops
    // the center immediately. Retain the spine so compressed ranks can settle.
    this.goal = undefined; this.goalDistance = this.progress;
    this.status = direction ? 'Shifting ranks' : 'Holding ranks';
  }
  private planStrafe(): void {
    const angle = this.heading + this.strafe * Math.PI / 2;
    let target = copy(this.leader);
    // A short straight ray lets the existing column/reformation logic handle
    // passages without finding a detour the keyboard operator did not request.
    for (let ahead = .25; ahead <= (this.count / 2 + 1) * SPACING + 4; ahead += .25) {
      const next = { x: this.leader.x + Math.cos(angle) * ahead, y: this.leader.y + Math.sin(angle) * ahead };
      if (!this.nav.segment(target, next)) break;
      target = next;
    }
    if (distance(target, this.leader) > .01) this.setRoute(target, [target]);
    else { this.goal = undefined; this.goalDistance = this.progress; }
    this.strafeHeading = this.heading; this.strafePlanAt = this.time + .5;
  }
  command(target: Point): boolean {
    const route = this.nav.path(this.leader, target); if (!route.length) { this.status = 'No traversable route'; return false; }
    this.strafe = 0; this.forceTurn = undefined; this.setRoute(target, route);
    this.status = 'Marching'; this.settled = false; return true;
  }
  private setRoute(target: Point, route: Point[]): void {
    this.goal = copy(target); this.detachedRoute = route.map(copy);
    const first = route[0], angle = Math.atan2(first.y - this.leader.y, first.x - this.leader.x), tail = (this.count / 2 + 1) * SPACING;
    const back = { x: this.leader.x - Math.cos(angle) * tail, y: this.leader.y - Math.sin(angle) * tail };
    this.spine = [this.nav.segment(back, this.leader) ? back : copy(this.leader), copy(this.leader), ...route];
    const last = route.at(-1)!, prev = route.length > 1 ? route.at(-2)! : this.leader, endAngle = Math.atan2(last.y - prev.y, last.x - prev.x);
    const extended = { x: last.x + Math.cos(endAngle) * tail, y: last.y + Math.sin(endAngle) * tail };
    this.lengths = [0]; for (let i = 1; i < this.spine.length; i++) this.lengths.push(this.lengths.at(-1)! + distance(this.spine[i - 1], this.spine[i]));
    this.progress = this.lengths[1]; this.goalDistance = this.lengths.at(-1)!;
    if (this.nav.segment(last, extended)) { this.spine.push(extended); this.lengths.push(this.goalDistance + tail); }
  }
  sample(at: number): Point {
    if (!this.spine.length) return copy(this.leader); at = clamp(at, 0, this.lengths.at(-1)!);
    for (let i = 1; i < this.spine.length; i++) if (at <= this.lengths[i]) {
      const t = (at - this.lengths[i - 1]) / Math.max(1e-9, this.lengths[i] - this.lengths[i - 1]);
      return { x: this.spine[i - 1].x + (this.spine[i].x - this.spine[i - 1].x) * t, y: this.spine[i - 1].y + (this.spine[i].y - this.spine[i - 1].y) * t };
    }
    return copy(this.spine.at(-1)!);
  }
  rectangleFits(center: Point, angle: number): boolean {
    return this.nav.clear(center) && this.slots.every(slot => this.nav.clear(this.rotated(center, slot, angle)));
  }
  targetFor(index: number): Point {
    if (this.mode === 'loose') {
      const angle = index * 2.399963229728653, radius = .65 * Math.sqrt(index + 1);
      return this.rotated(this.leader, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    }
    if (this.mode === 'column' && this.spine.length) {
      const rank = (Math.floor(index / 2) + 1) * (index % 2 ? -1 : 1);
      return this.sample(this.progress + rank * SPACING);
    }
    return this.rotated(this.leader, this.slots[index]);
  }
  private walk(unit: Soldier, target: Point, speed: number, dt: number): void {
    const before = copy(unit); unit.moving = false;
    if (distance(unit, target) < .002) return;
    let point = target;
    if (!this.nav.segment(unit, target)) {
      const key = `${Math.round(target.x * 2)},${Math.round(target.y * 2)}`;
      if ((!unit.route.length || key !== unit.targetKey) && this.time >= unit.repathAt) {
        unit.route = this.nav.path(unit, target); unit.targetKey = key; unit.repathAt = this.time + .25;
      }
      while (unit.route.length && distance(unit, unit.route[0]) < .035) unit.route.shift();
      if (!unit.route.length) return; point = unit.route[0];
    } else unit.route = [];
    const d = distance(unit, point), step = Math.min(d, speed * dt);
    if (d < 1e-9) return;
    const next = { x: unit.x + (point.x - unit.x) * step / d, y: unit.y + (point.y - unit.y) * step / d };
    if (this.nav.segment(unit, next)) { unit.x = next.x; unit.y = next.y; unit.moving = step > .002; unit.facing = Math.atan2(point.y - before.y, point.x - before.x); }
    if (!this.nav.clear(unit)) this.clipping++;
    if (this.formation && unit.id > 0 && unit.id < 100) this.maxCatchupRatio = Math.max(this.maxCatchupRatio, distance(before, unit) / dt / FORMATION_SPEED);
  }
  spawnAttack(side: 'front' | 'flank' | 'rear'): void {
    this.enemies = []; this.damageDealt = this.damageTaken = this.frontalHits = this.flankHits = 0;
    const angle = this.heading + (side === 'front' ? 0 : side === 'flank' ? Math.PI / 2 : Math.PI);
    for (let i = 0; i < Math.min(8, Math.max(3, this.count / 3)); i++) {
      const p = this.rotated(this.leader, { x: 6.5, y: (i - (Math.min(8, Math.max(3, this.count / 3)) - 1) / 2) * .75 }, angle);
      if (this.nav.clear(p)) this.enemies.push(soldier(100 + i, p));
    }
    this.status = `${side[0].toUpperCase() + side.slice(1)} attack incoming`;
  }
  private hit(attacker: Soldier, defender: Soldier, friendly: boolean): void {
    const attack = frontMultiplier(friendly && this.formation, this.heading, attacker, defender);
    const defense = frontMultiplier(!friendly && this.formation, this.heading, defender, attacker);
    const damage = (friendly ? 10 : 12) * attack / defense; defender.hp = Math.max(0, defender.hp - damage); defender.hit = this.time;
    attacker.cooldown = this.time + 1; if (friendly) this.damageDealt += damage; else this.damageTaken += damage;
    if (attack === 2 || defense === 2) this.frontalHits++; else this.flankHits++;
    this.sparks.push({ from: copy(attacker), to: copy(defender), at: this.time, boosted: attack === 2 || defense === 2 });
  }
  step(dt: number): void {
    dt = Math.min(.05, dt); this.time += dt; this.sparks = this.sparks.filter(spark => this.time - spark.at < .23);
    const alive = this.troops.filter(unit => unit.hp > 0), before = copy(this.leader);
    const desired = this.forceTurn ?? (!this.strafe && this.goal && this.progress < this.goalDistance - .01 ? Math.atan2(this.sample(this.progress + .3).y - this.leader.y, this.sample(this.progress + .3).x - this.leader.x) : this.heading);
    const outer = Math.max(1, ...this.slots.map(slot => Math.hypot(slot.x, slot.y))), angularSpeed = Math.min(1.25, CATCHUP_SPEED * .7 / outer);
    this.heading += clamp(angleDelta(this.heading, desired), -angularSpeed * dt, angularSpeed * dt);
    if (this.forceTurn !== undefined && Math.abs(angleDelta(this.heading, this.forceTurn)) < .005) this.forceTurn = undefined;
    if (this.strafe && (this.time >= this.strafePlanAt || Math.abs(angleDelta(this.strafeHeading, this.heading)) > .03)) this.planStrafe();
    let narrow = !this.rectangleFits(this.leader, this.heading);
    if (this.goal && this.progress < this.goalDistance) for (const ahead of [1, 2, 3, 4]) {
      const center = this.sample(Math.min(this.goalDistance, this.progress + ahead)), next = this.sample(Math.min(this.goalDistance, this.progress + ahead + .2));
      if (!this.rectangleFits(center, !this.strafe && distance(center, next) > .01 ? Math.atan2(next.y - center.y, next.x - center.x) : this.heading)) narrow = true;
    }
    if (this.formation && narrow && this.mode !== 'column') { this.mode = 'column'; this.compressed++; this.modeSince = this.time; }
    else if (this.formation && !narrow && this.mode === 'column' && this.time - this.modeSince > 1) { this.mode = 'rectangle'; this.modeSince = this.time; }
    else if (!this.formation) this.mode = 'loose';
    const errors = this.troops.map((unit, i) => unit.hp > 0 ? distance(unit, this.targetFor(i)) : 0); this.slotError = Math.max(0, ...errors);
    if (this.slotError > 1.4) this.slow = true; else if (this.slotError < .5) this.slow = false;
    const turning = Math.abs(angleDelta(this.heading, desired)) > .15;
    if (this.goal && this.progress < this.goalDistance - .005 && this.leader.hp > 0) {
      const speed = this.formation ? FORMATION_SPEED : NORMAL_SPEED;
      const motion = this.formation && (this.slow || turning) ? .15 : 1;
      const nextProgress = Math.min(this.goalDistance, this.progress + speed * motion * dt), next = this.sample(nextProgress);
      if (this.nav.segment(this.leader, next)) { this.leader.x = next.x; this.leader.y = next.y; this.progress = nextProgress; }
    }
    this.leader.facing = this.heading; this.leader.moving = distance(before, this.leader) > .002; this.travelled += distance(before, this.leader);
    for (let i = 0; i < this.troops.length; i++) {
      const unit = this.troops[i]; if (unit.hp <= 0) continue;
      let target = this.targetFor(i);
      if (!this.formation && this.enemies.some(e => e.hp > 0)) {
        const enemy = this.enemies.filter(e => e.hp > 0).sort((a, b) => distance(a, unit) - distance(b, unit))[0];
        if (distance(enemy, unit) < 5) target = distance(enemy, unit) > .7 ? enemy : copy(unit);
      }
      this.walk(unit, target, this.formation ? CATCHUP_SPEED : NORMAL_SPEED, dt);
      if (this.formation) unit.facing = this.heading;
    }
    const friends = [this.leader, ...alive].filter(unit => unit.hp > 0);
    for (const enemy of this.enemies) if (enemy.hp > 0 && friends.length) {
      const target = friends.reduce((a, b) => distance(a, enemy) < distance(b, enemy) ? a : b);
      if (distance(enemy, target) > .8) this.walk(enemy, target, 2.1, dt); else { enemy.moving = false; enemy.facing = Math.atan2(target.y - enemy.y, target.x - enemy.x); }
      if (distance(enemy, target) <= .9 && this.nav.segment(enemy, target) && enemy.cooldown <= this.time) this.hit(enemy, target, false);
    }
    for (const friend of friends) {
      const candidates = this.enemies.filter(enemy => enemy.hp > 0 && distance(friend, enemy) <= 1.05 && this.nav.segment(friend, enemy));
      if (candidates.length && friend.cooldown <= this.time) this.hit(friend, candidates.sort((a, b) => distance(friend, a) - distance(friend, b))[0], true);
    }
    this.moving = this.leader.moving || alive.some(unit => unit.moving); this.settled = !this.moving && this.slotError < .04 && !this.forceTurn;
    if (this.goal && this.progress >= this.goalDistance - .005 && this.settled) this.status = 'Destination reached · holding ranks';
    else if (this.mode === 'column' && this.moving) this.status = 'Single-file passage';
    else if (this.strafe && this.moving) this.status = 'Shifting ranks';
    if (!this.nav.clear(this.leader)) this.clipping++;
  }
  snapshot() { return { time: this.time, mode: this.mode, formation: this.formation, heading: this.heading, leader: copy(this.leader),
    goal: this.goal, remaining: this.goalDistance - this.progress, slotError: this.slotError, settled: this.settled, compressed: this.compressed,
    clipping: this.clipping, maxCatchupRatio: this.maxCatchupRatio, travelled: this.travelled, alive: this.troops.filter(unit => unit.hp > 0).length,
    damageDealt: this.damageDealt, damageTaken: this.damageTaken, frontalHits: this.frontalHits, flankHits: this.flankHits,
    pathQueries: this.nav.queries, pathMs: this.nav.milliseconds, units: this.troops.map(unit => ({ ...copy(unit), hp: unit.hp })) }; }
}
