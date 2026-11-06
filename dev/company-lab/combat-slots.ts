import { combatLineOfSight } from './combat';
import type { Navigation } from './navigation';
import type { CombatContext, Company, Point, Soldier } from './types';

interface Slot { point: Point; frontline: boolean }
interface CompanySlots {
  anchor: Point;
  target?: number;
  targetPoint?: Point;
  targetMembers: string;
  revision: number;
  candidates: Point[];
  slots: Map<number, Slot>;
  reconsiderAt: number;
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const snapshot = (point: Point): Point => ({ x: point.x, y: point.y });
const cell = (context: CombatContext, point: Point) => Math.floor(point.y) * context.world.width + Math.floor(point.x);
const range = (company: Pick<Company, 'kind'>) => company.kind === 'archer' ? 5 : 1.3;

function connectedFootprint(nav: Navigation, anchor: Point): Point[] {
  const queue = [anchor], seen = new Set([Math.floor(anchor.y) * nav.world.width + Math.floor(anchor.x)]);
  for (let head = 0; head < queue.length; head++) {
    const from = queue[head];
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
      if (!x && !y) continue;
      const next = { x: from.x + x, y: from.y + y }, key = Math.floor(next.y) * nav.world.width + Math.floor(next.x);
      if (seen.has(key) || distance(anchor, next) > 3 || !nav.canStep(from.x, from.y, next.x, next.y)) continue;
      seen.add(key); queue.push(next);
    }
  }
  return queue;
}

function canAttack(context: CombatContext, nav: Navigation, from: Point, enemy: Soldier, kind: Company['kind']): boolean {
  if (enemy.hp <= 0 || distance(from, enemy) > range({ kind }) || !combatLineOfSight(context.world, from, enemy)) return false;
  return kind === 'archer' || cell(context, from) === cell(context, enemy) || nav.canStep(from.x, from.y, enemy.x, enemy.y);
}

/** Persistent per-member contact and staging positions, independent of movement. */
export class CombatSlots {
  private readonly companies = new Map<number, CompanySlots>();

  clear(companyIds?: Iterable<number>): void {
    if (companyIds === undefined) this.companies.clear();
    else for (const id of companyIds) this.companies.delete(id);
  }
  reset(companyIds?: Iterable<number>): void { this.clear(companyIds); }

  prepareCombatSlots(context: CombatContext, nav: Navigation): Map<number, Point> {
    const result = new Map<number, Point>(), byId = new Map<number, Soldier>();
    const members = new Map<number, Soldier[]>(), occupied = new Map<number, number>();
    for (const unit of context.soldiers) if (unit.hp > 0) {
      byId.set(unit.id, unit);
      let group = members.get(unit.company); if (!group) members.set(unit.company, group = []);
      group.push(unit); occupied.set(cell(context, unit), unit.company);
      if (unit.moving) occupied.set(cell(context, { x: unit.toX, y: unit.toY }), unit.company);
    }
    const eligible = context.combatEnabled ? context.companies.filter(company => company.engagementGoal && members.has(company.id)
      && company.order !== 'move' && company.order !== 'regroup' && company.order !== 'retreat') : [];
    const active = new Set(eligible.map(company => company.id));
    for (const id of this.companies.keys()) if (!active.has(id)) this.companies.delete(id);
    const claims = new Map<number, number>();

    for (const company of eligible) {
      const victims = members.get(company.targetCompany ?? -1) ?? [];
      const target = context.companies.find(candidate => candidate.id === company.targetCompany);
      const targetMembers = victims.map(unit => unit.id).join(',');
      let cached = this.companies.get(company.id);
      if (!cached || cached.target !== company.targetCompany || cached.targetMembers !== targetMembers
        || cached.revision !== (context.world.revision ?? 0) || distance(cached.anchor, company.engagementGoal!) > 1.5
        || target && cached.targetPoint && distance(target, cached.targetPoint) > 1.5) {
        const anchor = nav.nearestOpen(company.engagementGoal!, company);
        cached = { anchor, target: company.targetCompany, targetPoint: target && snapshot(target), targetMembers,
          revision: context.world.revision ?? 0, candidates: connectedFootprint(nav, anchor), slots: new Map(), reconsiderAt: 0 };
        this.companies.set(company.id, cached);
      }
      for (const id of cached.slots.keys()) if (!byId.has(id)) cached.slots.delete(id);
      // A real, legal attack position wins over any cached ideal destination.
      for (const unit of members.get(company.id)!) {
        const victim = byId.get(unit.targetId ?? -1), key = cell(context, unit);
        if (unit.moving || !victim || victim.team === unit.team || claims.has(key)
          || distance(unit, cached.anchor) > 3 || !canAttack(context, nav, unit, victim, company.kind)) continue;
        const point = snapshot(unit); claims.set(key, unit.id); result.set(unit.id, point);
        cached.slots.set(unit.id, { point, frontline: true });
      }
    }

    // Reserve surviving assignments before choosing any new positions. A later
    // company cannot lose its destination merely because it updates last.
    for (const company of eligible) {
      const cached = this.companies.get(company.id)!, victims = members.get(company.targetCompany ?? -1) ?? [];
      for (const unit of members.get(company.id)!) {
        if (result.has(unit.id)) continue;
        const old = cached.slots.get(unit.id); if (!old) continue;
        const key = cell(context, old.point), owner = occupied.get(key);
        const valid = !claims.has(key) && (owner === undefined || owner === company.id)
          && nav.passable(old.point.x, old.point.y) && distance(old.point, cached.anchor) <= 3
          && (!old.frontline || victims.some(victim => canAttack(context, nav, old.point, victim, company.kind)));
        if (!valid) { cached.slots.delete(unit.id); continue; }
        claims.set(key, unit.id); result.set(unit.id, snapshot(old.point));
      }
    }

    for (const company of eligible) {
      const cached = this.companies.get(company.id)!, victims = members.get(company.targetCompany ?? -1) ?? [];
      const frontline = new Set(cached.candidates.filter(point => victims.some(victim => canAttack(context, nav, point, victim, company.kind)))
        .map(point => cell(context, point)));
      const reconsider = context.time >= cached.reconsiderAt;
      for (const unit of members.get(company.id)!) {
        const old = cached.slots.get(unit.id);
        // Staged soldiers only advance when an actual contact cell opens;
        // equivalent staging cells never cause formation shuffling.
        if (result.has(unit.id) && (!reconsider || old?.frontline)) continue;
        const available = cached.candidates.filter(point => {
          const key = cell(context, point), owner = occupied.get(key), claimant = claims.get(key);
          return (owner === undefined || owner === company.id) && (claimant === undefined || claimant === unit.id);
        });
        const contacts = available.filter(point => frontline.has(cell(context, point)));
        if (result.has(unit.id) && !contacts.length) continue;
        const choices = contacts.length ? contacts : available;
        choices.sort((a, b) => distance(unit, a) - distance(unit, b)
          + (victims.length ? distance(a, cached.anchor) - distance(b, cached.anchor) : 0)
          || cell(context, a) - cell(context, b));
        const point = choices[0];
        if (!point) {
          // If the entire footprint is full, leave the member's old safe
          // position alone; never fall back to the shared occupied anchor.
          const key = cell(context, unit), owner = occupied.get(key);
          if (!claims.has(key) && owner === company.id && nav.passable(unit.x, unit.y) && distance(unit, cached.anchor) <= 3) {
            const waiting = snapshot(unit); result.set(unit.id, waiting); claims.set(key, unit.id);
            cached.slots.set(unit.id, { point: waiting, frontline: false });
          }
          continue;
        }
        const previous = result.get(unit.id);
        if (previous) claims.delete(cell(context, previous));
        const key = cell(context, point); claims.set(key, unit.id); result.set(unit.id, snapshot(point));
        cached.slots.set(unit.id, { point: snapshot(point), frontline: frontline.has(key) });
      }
      if (reconsider) cached.reconsiderAt = context.time + .6;
    }
    return result;
  }
}

const instances = new WeakMap<CombatContext, CombatSlots>();
export function prepareCombatSlots(context: CombatContext, nav: Navigation): Map<number, Point> {
  let slots = instances.get(context); if (!slots) { slots = new CombatSlots(); instances.set(context, slots); }
  return slots.prepareCombatSlots(context, nav);
}
