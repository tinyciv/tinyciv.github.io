import type { CombatContext, Company, Point, Soldier, Team } from './types';

const squaredDistance = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const cell = (context: CombatContext, point: Point) => Math.floor(point.y) * context.world.width + Math.floor(point.x);
const center = (point: Point): Point => ({ x: Math.floor(point.x) + .5, y: Math.floor(point.y) + .5 });
function passable(context: CombatContext, point: Point): boolean {
  const { width, height, tiles } = context.world, x = Math.floor(point.x), y = Math.floor(point.y);
  return x >= 0 && y >= 0 && x < width && y < height && ![2, 3, 4, 5].includes(tiles[y * width + x]);
}

/** Only use free ground connected to the palace's immediate surroundings. */
function recruitCells(context: CombatContext, base: Point): Point[] {
  const candidates: Point[] = [];
  for (let y = Math.floor(base.y) - 6; y <= Math.floor(base.y) + 6; y++) {
    for (let x = Math.floor(base.x) - 6; x <= Math.floor(base.x) + 6; x++) {
      const point = { x: x + .5, y: y + .5 };
      if (squaredDistance(point, base) <= 36 && passable(context, point)) candidates.push(point);
    }
  }
  candidates.sort((a, b) => squaredDistance(a, base) - squaredDistance(b, base) || cell(context, a) - cell(context, b));
  if (!context.canStep || !candidates.length) return candidates;
  const available = new Map(candidates.map(point => [cell(context, point), point]));
  const seen = new Set([cell(context, candidates[0])]), queue = [candidates[0]];
  for (let head = 0; head < queue.length; head++) {
    const from = queue[head];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const point = { x: from.x + dx, y: from.y + dy }, key = cell(context, point);
      if (seen.has(key) || !available.has(key) || !context.canStep(from.x, from.y, point.x, point.y)) continue;
      seen.add(key); queue.push(point);
    }
  }
  return candidates.filter(point => seen.has(cell(context, point)));
}

function replacementSlot(context: CombatContext, company: Company, missing: Soldier | undefined, survivors: Soldier[]): Point {
  const reserved = new Set(survivors.map(unit => cell(context, unit.slot)));
  const valid = (point: Point) => squaredDistance(point, company) <= 9 && passable(context, point) && !reserved.has(cell(context, point));
  if (missing && valid(missing.slot)) return { ...missing.slot };
  const origin = center(company), candidates: Point[] = [];
  for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
    const point = { x: origin.x + x, y: origin.y + y }; if (valid(point)) candidates.push(point);
  }
  candidates.sort((a, b) => squaredDistance(a, company) - squaredDistance(b, company) || cell(context, a) - cell(context, b));
  return candidates[0] ?? { ...survivors[0].slot };
}

/** New arrivals cannot split their company while an existing step finishes. */
function cohesiveSpawn(point: Point, survivors: Soldier[]): boolean {
  const remaining = survivors.map(unit => unit.moving ? Math.max(0, unit.duration * (1 - unit.progress)) : 0);
  // Between these finish times every position is linear, so the maximum radius
  // is bounded by the endpoints of each interval.
  for (const elapsed of [0, ...remaining]) {
    const points = survivors.map((unit, i) => {
      const fraction = remaining[i] > 0 ? Math.min(1, elapsed / remaining[i]) : 0;
      return { x: unit.x + (unit.toX - unit.x) * fraction, y: unit.y + (unit.toY - unit.y) * fraction };
    });
    points.push(point);
    const mean = { x: points.reduce((sum, item) => sum + item.x, 0) / points.length,
      y: points.reduce((sum, item) => sum + item.y, 0) / points.length };
    if (points.some(item => squaredDistance(item, mean) > 2.65 ** 2 + 1e-9)) return false;
  }
  return true;
}

function clearOfTraffic(point: Point, living: Soldier[]): boolean {
  for (const unit of living) {
    const dx = unit.moving ? unit.toX - unit.x : 0, dy = unit.moving ? unit.toY - unit.y : 0;
    const fraction = Math.max(0, Math.min(1, ((point.x - unit.x) * dx + (point.y - unit.y) * dy) / (dx * dx + dy * dy || 1)));
    const closest = { x: unit.x + dx * fraction, y: unit.y + dy * fraction };
    if (squaredDistance(point, closest) < .6 ** 2 - 1e-9) return false;
  }
  return true;
}

/** Recovery belongs to a surviving company; an annihilated company stays dead. */
export function updateRecovery(context: CombatContext, dt: number): Soldier[] {
  if (!Number.isFinite(dt) || dt <= 0) return [];
  const byId = new Map(context.soldiers.map(unit => [unit.id, unit]));
  const living = context.soldiers.filter(unit => unit.hp > 0), occupied = new Set<number>();
  for (const unit of living) {
    occupied.add(cell(context, unit));
    if (unit.moving) {
      occupied.add(cell(context, { x: unit.fromX, y: unit.fromY }));
      occupied.add(cell(context, { x: unit.toX, y: unit.toY }));
    }
  }
  const spawnCells = new Map<Team, Point[]>(), recruits: Soldier[] = [];
  let nextId = context.soldiers.reduce((maximum, unit) => Math.max(maximum, unit.id), 0) + 1;
  for (const company of context.companies) {
    const survivors = company.soldierIds.map(id => byId.get(id)).filter((unit): unit is Soldier => !!unit && unit.hp > 0);
    if (!survivors.length) continue;
    const base = context.world.bases[company.team];
    const safe = squaredDistance(company, base) <= 64 && context.time - company.lastCombatAt >= 8
      && !living.some(enemy => enemy.team !== company.team
        && (squaredDistance(enemy, company) <= 64 || squaredDistance(enemy, base) <= 64));
    if (!safe) { company.replenishAt = context.time + 8; continue; }
    for (const unit of survivors) if (squaredDistance(unit, base) <= 64) unit.hp = Math.min(unit.maxHp, unit.hp + dt * 10);
    if (survivors.length >= 3) { company.replenishAt = context.time + 8; continue; }
    if (company.replenishAt <= 0) company.replenishAt = context.time + 8;
    if (context.time < company.replenishAt) continue;
    let candidates = spawnCells.get(company.team);
    if (!candidates) { candidates = recruitCells(context, base); spawnCells.set(company.team, candidates); }
    const spawn = candidates.find(point => !occupied.has(cell(context, point))
      && cohesiveSpawn(point, survivors) && clearOfTraffic(point, living));
    if (!spawn) continue;
    const index = company.soldierIds.findIndex(id => !byId.get(id) || byId.get(id)!.hp <= 0);
    const missing = index < 0 ? undefined : byId.get(company.soldierIds[index]), template = survivors[0];
    const recruit: Soldier = {
      id: nextId++, company: company.id, team: company.team, kind: company.kind,
      x: spawn.x, y: spawn.y, hp: template.maxHp, maxHp: template.maxHp, speed: template.speed,
      moving: false, facing: template.facing, cooldown: 0, attackUntil: 0, damageFlash: 0,
      traveled: 0, lastProgressAt: context.time, fromX: spawn.x, fromY: spawn.y,
      toX: spawn.x, toY: spawn.y, progress: 1, duration: 0,
      slot: replacementSlot(context, company, missing, survivors),
    };
    if (index < 0) company.soldierIds.push(recruit.id); else company.soldierIds[index] = recruit.id;
    context.soldiers.push(recruit); byId.set(recruit.id, recruit); recruits.push(recruit);
    living.push(recruit);
    occupied.add(cell(context, spawn)); company.replenishAt = context.time + 8;
    context.events.push({ x: spawn.x, y: spawn.y, team: company.team, text: 'Recruit', bornAt: context.time });
  }
  return recruits;
}
