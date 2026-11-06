import type { CombatContext, Company, LabWorld, Point, Soldier } from './types';

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const cell = (world: LabWorld, point: Point) => Math.floor(point.y) * world.width + Math.floor(point.x);
const attackRange = (unit: Pick<Soldier, 'kind'>) => unit.kind === 'archer' ? 5 : 1.3;
const passive = (company: Company) => company.order === 'move' || company.order === 'regroup' || company.order === 'retreat';

function passable(world: LabWorld, point: Point): boolean {
  const x = Math.floor(point.x), y = Math.floor(point.y);
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return false;
  return ![2, 3, 4, 5].includes(world.tiles[y * world.width + x]);
}

/** Water does not block arrows; solid tree, house, and wall silhouettes do. */
export function combatLineOfSight(world: LabWorld, from: Point, to: Point): boolean {
  const steps = Math.max(1, Math.ceil(distance(from, to) * 5));
  for (let i = 1; i < steps; i++) {
    const x = Math.floor(from.x + (to.x - from.x) * i / steps);
    const y = Math.floor(from.y + (to.y - from.y) * i / steps);
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return false;
    const tile = world.tiles[y * world.width + x];
    if (tile === 2 || tile === 4 || tile === 5) return false;
  }
  return true;
}

function contact(context: CombatContext, from: Point, to: Point, kind: Soldier['kind']): boolean {
  if (!combatLineOfSight(context.world, from, to)) return false;
  if (kind === 'archer' || cell(context.world, from) === cell(context.world, to)) return true;
  if (context.canStep) return context.canStep(from.x, from.y, to.x, to.y);
  return context.world.elevations[cell(context.world, from)] === context.world.elevations[cell(context.world, to)];
}

/** Assign a reachable contact cell, not the enemy's occupied center. */
function approach(context: CombatContext, company: Company, victims: Soldier[], occupied: Map<number, number>, reserved: Map<number, number>): Point | undefined {
  const candidates: { point: Point; score: number }[] = [];
  const previous = company.engagementGoal, world = context.world;
  const allow = (point: Point, victim: Soldier) => {
    const key = cell(world, point), owner = occupied.get(key), claimant = reserved.get(key);
    if (!passable(world, point) || owner !== undefined && owner !== company.id || claimant !== undefined && claimant !== company.id) return;
    if (company.order === 'defend' && distance(company.goal, point) > 3) return;
    if (!contact(context, point, victim, company.kind)) return;
    const d = distance(point, victim);
    if (d > attackRange(company) || d < .55 || company.kind === 'archer' && d < 2.5) return;
    const stable = previous && distance(previous, point) < .2 ? -1.75 : 0;
    candidates.push({ point, score: distance(company, point) + stable + Math.abs(d - (company.kind === 'archer' ? 4.25 : 1)) * .3 });
  };
  for (const victim of victims) {
    if (company.kind === 'archer') {
      allow({ x: Math.floor(company.x) + .5, y: Math.floor(company.y) + .5 }, victim);
      for (let side = 0; side < 16; side++) {
        const angle = side * Math.PI / 8;
        allow({ x: Math.floor(victim.x + Math.cos(angle) * 4.2) + .5,
          y: Math.floor(victim.y + Math.sin(angle) * 4.2) + .5 }, victim);
      }
    } else {
      for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) if (x || y) {
        allow({ x: Math.floor(victim.x) + x + .5, y: Math.floor(victim.y) + y + .5 }, victim);
      }
    }
  }
  candidates.sort((a, b) => a.score - b.score || cell(world, a.point) - cell(world, b.point));
  return candidates[0]?.point;
}

/** Company decisions are throttled; individual soldiers only handle local contact. */
export function updateCombat(context: CombatContext, _dt: number): void {
  const companies = new Map(context.companies.map(company => [company.id, company]));
  const members = new Map<number, Soldier[]>(), occupied = new Map<number, number>();
  const spatial = new Map<number, Soldier[]>(), bucketSize = 6, bucketWidth = Math.ceil(context.world.width / bucketSize);
  for (const unit of context.soldiers) if (unit.hp > 0) {
    let group = members.get(unit.company);
    if (!group) members.set(unit.company, group = []);
    group.push(unit); occupied.set(cell(context.world, unit), unit.company);
    const key = Math.floor(unit.y / bucketSize) * bucketWidth + Math.floor(unit.x / bucketSize);
    let bucket = spatial.get(key); if (!bucket) spatial.set(key, bucket = []); bucket.push(unit);
  }
  const assignments = new Map<string, number>(), reserved = new Map<number, number>();
  const assignmentKey = (company: Company, target: number) => `${company.kind}:${target}`;
  for (const company of context.companies) {
    if (!context.combatEnabled || passive(company) || !members.has(company.id)) {
      company.targetCompany = undefined; company.engagementGoal = undefined;
      for (const unit of members.get(company.id) ?? []) unit.targetId = undefined;
      continue;
    }
    if (company.targetCompany !== undefined) {
      const key = assignmentKey(company, company.targetCompany);
      assignments.set(key, (assignments.get(key) ?? 0) + 1);
    }
    if (company.engagementGoal) reserved.set(cell(context.world, company.engagementGoal), company.id);
  }
  if (!context.combatEnabled) return;

  for (const company of context.companies) {
    if (passive(company) || !members.has(company.id)) continue;
    const current = company.targetCompany === undefined ? undefined : companies.get(company.targetCompany);
    const scanInterval = .35 + company.id % 5 * .025;
    if ((!current || members.has(current.id)) && context.time - (company.lastTargetScan ?? -Infinity) < scanInterval) continue;
    if (company.targetCompany !== undefined) {
      const key = assignmentKey(company, company.targetCompany);
      assignments.set(key, Math.max(0, (assignments.get(key) ?? 1) - 1));
    }
    if (company.engagementGoal) reserved.delete(cell(context.world, company.engagementGoal));
    company.lastTargetScan = context.time;
    const radius = company.order === 'defend' ? 3 + attackRange(company) : company.order === 'escort' ? 7 : 9;
    const origin = company.order === 'defend' ? company.goal : company;
    const nearby = context.companies.filter(enemy => enemy.team !== company.team && members.has(enemy.id)
      && distance(origin, enemy) <= radius);
    const options = nearby
      .map(enemy => ({ enemy, count: assignments.get(assignmentKey(company, enemy.id)) ?? 0 }))
      .filter(option => option.count < (company.kind === 'archer' ? 3 : 2))
      .sort((a, b) => distance(company, a.enemy) + a.count * 1.8 - (a.enemy === current ? 1.5 : 0)
        - distance(company, b.enemy) - b.count * 1.8 + (b.enemy === current ? 1.5 : 0) || a.enemy.id - b.enemy.id);
    let goal: Point | undefined, enemy: Company | undefined;
    for (const candidate of options) {
      const point = approach(context, company, members.get(candidate.enemy.id)!, occupied, reserved);
      if (point) { goal = point; enemy = candidate.enemy; break; }
    }
    // No free frontage is a staging condition. Wait on present open ground
    // instead of pushing the entire rear rank through fighting soldiers.
    const staging = { x: Math.floor(company.x) + .5, y: Math.floor(company.y) + .5 };
    company.targetCompany = enemy?.id;
    company.engagementGoal = goal ?? (nearby.length && passable(context.world, staging) ? staging : undefined);
    if (enemy && goal) {
      const key = assignmentKey(company, enemy.id);
      assignments.set(key, (assignments.get(key) ?? 0) + 1); reserved.set(cell(context.world, goal), company.id);
    }
  }

  for (const unit of context.soldiers) {
    if (unit.hp <= 0) continue;
    const company = companies.get(unit.company);
    if (!company || passive(company)) { unit.targetId = undefined; continue; }
    const range = attackRange(unit), bx = Math.floor(unit.x / bucketSize), by = Math.floor(unit.y / bucketSize);
    let target: Soldier | undefined, best = Infinity;
    for (let yy = Math.max(0, by - 1); yy <= by + 1; yy++) for (let xx = Math.max(0, bx - 1); xx <= Math.min(bucketWidth - 1, bx + 1); xx++) {
      for (const enemy of spatial.get(yy * bucketWidth + xx) ?? []) {
        if (enemy.team === unit.team || enemy.hp <= 0) continue;
        const gap = distance(unit, enemy);
        if (gap > range || company.order === 'defend' && distance(company.goal, enemy) > 3 + range
          || !contact(context, unit, enemy, unit.kind)) continue;
        const score = gap - (enemy.id === unit.targetId ? .4 : 0) - (enemy.company === company.targetCompany ? .2 : 0);
        if (score < best) { target = enemy; best = score; }
      }
    }
    unit.targetId = target?.id;
    if (!target || unit.cooldown > 0) continue;
    const damage = (unit.kind === 'archer' ? 10 : 14) * (1 + company.veterancy * .12);
    target.hp = Math.max(0, target.hp - damage); target.damageFlash = .16;
    unit.attackUntil = context.time + (unit.kind === 'archer' ? .18 : .22);
    unit.cooldown = unit.kind === 'archer' ? 1.25 : .8;
    unit.facing = Math.atan2(target.y - unit.y, target.x - unit.x);
    company.lastCombatAt = context.time;
    const defender = companies.get(target.company); if (defender) defender.lastCombatAt = context.time;
    context.combatMetrics.damageEvents++;
    if (unit.kind === 'archer') {
      context.combatMetrics.shots++;
      context.projectiles.push({ x: unit.x, y: unit.y, targetX: target.x, targetY: target.y,
        team: unit.team, bornAt: context.time, life: .2 + distance(unit, target) * .035 });
    }
    if (target.hp <= 0) {
      target.deadAt = context.time; target.targetId = undefined;
      company.kills++; company.experience++; context.combatMetrics.kills++;
      const level = Math.min(3, Math.floor(company.experience / 4));
      if (level > company.veterancy) {
        company.veterancy = level;
        context.events.push({ x: company.x, y: company.y, team: company.team, text: `Veterancy ${level}`, bornAt: context.time });
      }
    }
  }
}
