import { describe, expect, it } from 'vitest';
import { updateRecovery } from '../dev/company-lab/recovery';
import { Navigation } from '../dev/company-lab/navigation';
import type { CombatContext, Company, Point, Soldier } from '../dev/company-lab/types';

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
function fixture(): CombatContext {
  const width = 32, height = 24;
  const company: Company = { id: 1, team: 0, kind: 'infantry', x: 12.5, y: 12.5,
    order: 'defend', status: 'Holding', soldierIds: [1, 2, 3], goal: { x: 12.5, y: 12.5 }, rally: { x: 12.5, y: 12.5 },
    selected: false, veterancy: 2, kills: 8, experience: 8, mode: 'line', lastCombatAt: -100, lastAssignedAt: 0, replenishAt: 0 };
  const soldiers: Soldier[] = [0, 1, 2].map(i => ({ id: i + 1, company: 1, team: 0, kind: 'infantry',
    x: 12.5, y: 11.5 + i, hp: 50, maxHp: 100, speed: 3, moving: false, facing: 0, cooldown: 0,
    attackUntil: 0, damageFlash: 0, traveled: 0, lastProgressAt: 0,
    fromX: 12.5, fromY: 11.5 + i, toX: 12.5, toY: 11.5 + i, progress: 1, duration: 0,
    slot: { x: 12.5, y: 11.5 + i } }));
  return { world: { width, height, tiles: new Uint8Array(width * height), elevations: new Int8Array(width * height),
    bases: [{ x: 9.5, y: 12.5 }, { x: 28.5, y: 12.5 }] }, companies: [company], soldiers,
    time: 0, combatEnabled: true, projectiles: [], events: [], combatMetrics: { damageEvents: 0, shots: 0, kills: 0 } };
}
function due(context: CombatContext): void { context.time = 8; context.companies[0].replenishAt = 8; }
function radius(points: Point[]): number {
  const mean = { x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length };
  return Math.max(...points.map(point => distance(point, mean)));
}

describe('standalone company recovery', () => {
  it('heals near home only after eight quiet seconds with no nearby enemies', () => {
    const context = fixture(), company = context.companies[0];
    updateRecovery(context, 1); expect(context.soldiers[0].hp).toBe(60);
    company.lastCombatAt = context.time;
    updateRecovery(context, 1); expect(context.soldiers[0].hp).toBe(60);
    context.time = 8;
    const enemy: Soldier = { ...context.soldiers[0], id: 10, company: 2, team: 1, x: 9.5, y: 12.5 };
    context.soldiers.push(enemy); updateRecovery(context, 1); expect(context.soldiers[0].hp).toBe(60);
    enemy.hp = 0; updateRecovery(context, 10); expect(context.soldiers[0].hp).toBe(100);
    company.x = 20.5; context.soldiers[0].hp = 50;
    updateRecovery(context, 1); expect(context.soldiers[0].hp).toBe(50);
  });

  it('recruits one member every eight seconds without teleporting or losing company veterancy', () => {
    const context = fixture(), company = context.companies[0]; context.soldiers[1].hp = context.soldiers[2].hp = 0;
    expect(updateRecovery(context, .1)).toEqual([]);
    context.time = 7.9; expect(updateRecovery(context, .1)).toEqual([]);
    context.time = 8;
    const first = updateRecovery(context, .1); expect(first).toHaveLength(1);
    expect(first[0].id).toBe(4); expect(first[0].traveled).toBe(0);
    expect(distance(first[0], first[0].slot)).toBeGreaterThan(1);
    expect(company.soldierIds).toEqual([1, 4, 3]);
    expect(company).toMatchObject({ veterancy: 2, experience: 8, kills: 8, order: 'defend' });
    context.time = 15.9; expect(updateRecovery(context, .1)).toEqual([]);
    context.time = 16; expect(updateRecovery(context, .1)).toHaveLength(1);
    expect(new Set(company.soldierIds).size).toBe(3);
    expect(context.soldiers.filter(unit => unit.hp > 0)).toHaveLength(3);
  });

  it('never rebuilds a company with no surviving members', () => {
    const context = fixture(); context.soldiers.forEach(unit => { unit.hp = 0; }); context.time = 1000;
    expect(updateRecovery(context, 10)).toEqual([]); expect(context.soldiers).toHaveLength(3);
  });

  it('keeps the movement origin reserved until a passing soldier finishes its step', () => {
    const context = fixture(); context.soldiers[2].hp = 0; due(context);
    const passer: Soldier = { ...context.soldiers[0], id: 10, company: 2, x: 10.1, y: 12.5,
      moving: true, fromX: 9.5, fromY: 12.5, toX: 10.5, toY: 12.5, duration: 1, progress: .6 };
    context.soldiers.push(passer);
    const recruits = updateRecovery(context, .1); expect(recruits).toHaveLength(1);
    expect(recruits[0]).not.toMatchObject({ x: 9.5, y: 12.5 });
    expect(recruits[0]).not.toMatchObject({ x: 10.5, y: 12.5 });
    expect(distance(recruits[0], passer)).toBeGreaterThanOrEqual(.6);
  });

  it('chooses a nearer company-safe spawn rather than breaking cohesion at the palace', () => {
    const context = fixture(); context.soldiers[2].hp = 0; due(context);
    context.companies[0].x = 17;
    context.soldiers[0].x = context.soldiers[1].x = 17;
    const recruits = updateRecovery(context, .1); expect(recruits).toHaveLength(1);
    expect(distance(recruits[0], context.world.bases[0])).toBeLessThanOrEqual(6);
    expect(recruits[0].x).toBeGreaterThan(12.5);
    expect(radius(context.soldiers.filter(unit => unit.hp > 0))).toBeLessThanOrEqual(2.65);
  });

  it('validates cohesion at survivors future step endpoints, not just their current positions', () => {
    const context = fixture(); context.soldiers[2].hp = 0; due(context);
    for (const unit of context.soldiers.slice(0, 2)) {
      unit.x = 13; unit.fromX = 12.5; unit.toX = 13.5; unit.moving = true; unit.progress = .5; unit.duration = 1;
    }
    const recruits = updateRecovery(context, .1); expect(recruits).toHaveLength(1);
    const endpoints = context.soldiers.slice(0, 2).map(unit => ({ x: unit.toX, y: unit.toY }));
    expect(radius([...endpoints, recruits[0]])).toBeLessThanOrEqual(2.65);
    expect(recruits[0]).not.toMatchObject({ x: 9.5, y: 12.5 });
  });

  it('waits when no connected palace cell can safely fit the surviving company', () => {
    const context = fixture(); context.soldiers[2].hp = 0; due(context);
    context.world.tiles.fill(3); const base = context.world.bases[0];
    context.world.tiles[Math.floor(base.y) * context.world.width + Math.floor(base.x)] = 0;
    context.companies[0].x = 17;
    for (const unit of context.soldiers.slice(0, 2)) {
      unit.x = 17.5; context.world.tiles[Math.floor(unit.y) * context.world.width + 17] = 0;
    }
    const nav = new Navigation(context.world); context.canStep = nav.canStep.bind(nav);
    expect(updateRecovery(context, .1)).toEqual([]);
    expect(context.companies[0].soldierIds).toEqual([1, 2, 3]);
  });
});
