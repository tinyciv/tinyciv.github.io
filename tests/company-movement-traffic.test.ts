import { describe, expect, it } from 'vitest';
import { CompanyLab } from '../dev/company-lab/engine';
import type { Point, Soldier } from '../dev/company-lab/types';

describe('company traffic collision checks', () => {
  it('does not hide a stationary soldier behind a departing ally sharing its old cell', () => {
    const lab = new CompanyLab({ scenario: 'plain', size: 'small', combat: false });
    const [requester, standing, departing] = [lab.soldiers[0], lab.soldiers[3], lab.soldiers[6]];
    for (const unit of lab.soldiers) if (![requester, standing, departing].includes(unit)) unit.hp = 0;
    Object.assign(requester, { x: 20.5, y: 21.5, moving: false });
    Object.assign(standing, { x: 20.5, y: 20.5, moving: false });
    Object.assign(departing, { x: 20.5, y: 19.7, moving: true, fromX: 20.5, fromY: 20.5,
      toX: 20.5, toY: 19.5, progress: .8, duration: .448 });
    const internal = lab as unknown as {
      rebuildOccupancy(): void;
      vacant(unit: Soldier, point: Point): boolean;
      safeTrain(train: Soldier[], point: Point): boolean;
    };
    internal.rebuildOccupancy();
    const destination = { x: 20.5, y: 20.5 };
    expect(internal.safeTrain([requester], destination)).toBe(false);
    expect(internal.vacant(requester, destination)).toBe(false);
  });
});
