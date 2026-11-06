import { describe, expect, it } from 'vitest';
import { CompanyLab } from '../dev/company-lab/engine';
import { Navigation } from '../dev/company-lab/navigation';
import type { Point } from '../dev/company-lab/types';

function cachedRoute(next: Point, vertical = false): CompanyLab {
  const lab = new CompanyLab({ scenario: 'plain', size: 'small', combat: false });
  lab.world.tiles.fill(0);
  const company = lab.companies[0], members = lab.soldiers.filter(unit => unit.company === company.id);
  for (const unit of lab.soldiers) if (unit.company !== company.id) unit.hp = 0;
  members.forEach((unit, i) => {
    unit.x = vertical ? 20.5 : 20.5 - i; unit.y = vertical ? 20.5 + i : 20.5;
    unit.fromX = unit.toX = unit.x; unit.fromY = unit.toY = unit.y;
    unit.slot = { x: 30.5, y: 20.5 + i }; unit.moving = false;
  });
  company.x = 20.5; company.y = 20.5; company.order = 'move'; company.goal = { x: 30.5, y: 20.5 };
  const internal = lab as unknown as { chains: Map<number, number[]>; convoyRoutes: Map<number, { goal: number; route: Point[] }> };
  internal.chains.set(company.id, members.map(unit => unit.id));
  internal.convoyRoutes.set(company.id, { goal: 20 * lab.world.width + 30, route: [next] });
  return lab;
}

describe('company cached route validation', () => {
  it('discards a cached next step that is no longer adjacent after the train head changes', () => {
    const lab = cachedRoute({ x: 22.5, y: 20.5 }); lab.nav = new Navigation(lab.world);
    lab.step(.1);
    const moving = lab.soldiers.filter(unit => unit.hp > 0 && unit.moving);
    expect(moving).toHaveLength(3);
    for (const unit of moving) expect(lab.nav.canStep(unit.fromX, unit.fromY, unit.toX, unit.toY)).toBe(true);
  });

  it('rejects a cached diagonal which now cuts through a solid corner', () => {
    const lab = cachedRoute({ x: 21.5, y: 19.5 }, true);
    lab.world.tiles[20 * lab.world.width + 21] = 4; lab.nav = new Navigation(lab.world);
    lab.step(.1);
    const moving = lab.soldiers.filter(unit => unit.hp > 0 && unit.moving);
    expect(moving.length).toBeGreaterThan(0);
    for (const unit of moving) expect(lab.nav.canStep(unit.fromX, unit.fromY, unit.toX, unit.toY)).toBe(true);
  });
});
