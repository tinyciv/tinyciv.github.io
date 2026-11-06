import { describe, expect, it } from 'vitest';
import { scoutRealm } from './helpers/scouts';
import { entityStore } from '../src/game/entity-store';
import { buildAt, validateBuildAt } from '../src/game/simulation';
import { buildStroke, planConstruction } from '../src/game/construction';
import { farmBlockPlacementQuery } from '../src/game/farm-blocks';
import type { Building, GameState } from '../src/game/types';

function realm(): GameState {
  const state = scoutRealm();
  entityStore(state).buildings.replace([{ id: 100, kind: 'palace', faction: 0, x: 10, y: 10,
    hp: 250, maxHp: 250, capacity: 4, governorPermissions: { farms: false, housing: false } }]);
  state.units[0].x = 20.5; state.units[0].y = 15.5;
  return state;
}
function plot(state: GameState, x: number, y: number, extra: Partial<Building> = {}) {
  entityStore(state).buildings.add({ id: 1000 + y * state.world.width + x, kind: 'camp', faction: 0, x, y,
    hp: 100, maxHp: 100, capacity: 0, ...extra });
}

describe('manual farm block limits', () => {
  it('keeps one-cell farm placement and ordinary per-cell pricing', () => {
    const state = realm(), preview = planConstruction(state, 'camp', [{ x: 20, y: 15 }]);
    expect(preview).toMatchObject({ ok: true, cost: 15, tiles: [{ x: 20, y: 15 }] });
    expect(state.factions[0].gold).toBe(1000);
    expect(buildStroke(state, 'camp', [{ x: 20, y: 15 }])).toMatchObject({ ok: true, placed: 1 });
    expect(state.factions[0].gold).toBe(985);
    expect(state.buildings.filter(b => b.kind === 'camp')).toHaveLength(1);
    expect(state.buildings.find(b => b.kind === 'camp')).toMatchObject({ construction: { duration: 3.75, paidGold: 15 } });
  });

  it('allows any shape through six cells, then rejects an elongated seventh without spending', () => {
    const state = realm();
    for (let x = 18; x < 23; x++) plot(state, x, 15);
    expect(buildAt(state, 'camp', 23, 15)).toMatchObject({ ok: true });
    const gold = state.factions[0].gold, count = state.buildings.length;
    const preview = planConstruction(state, 'camp', [{ x: 24, y: 15 }]);
    expect(preview.ok).toBe(false); expect(preview.message).toContain('1.5');
    expect(preview.cells[0].ok).toBe(false);
    expect(buildAt(state, 'camp', 24, 15).ok).toBe(false);
    expect(state.factions[0].gold).toBe(gold); expect(state.buildings).toHaveLength(count);
  });

  it('allows a compact seventh plot and accepts exactly the 1.5 ratio', () => {
    const state = realm();
    for (let y = 14; y < 16; y++) for (let x = 18; x < 21; x++) plot(state, x, y);
    expect(buildAt(state, 'camp', 18, 16).ok).toBe(true);
    expect(farmBlockPlacementQuery(state).canAddAll([{ x: 19, y: 16 }, { x: 20, y: 16 }]))
      .toMatchObject({ ok: true, blocks: [{ size: 9, aspectRatio: 1 }] });
    // A connected perimeter gives a 6×4 bounding box with exactly sixteen plots.
    const exact = realm();
    for (let y = 14; y < 18; y++) for (let x = 18; x < 24; x++)
      if ((y === 14 || y === 17 || x === 18 || x === 23) && !(x === 23 && y === 17)) plot(exact, x, y);
    expect(validateBuildAt(exact, 'camp', 23, 17).ok).toBe(true);
    expect(farmBlockPlacementQuery(exact).canAdd({ x: 23, y: 17 }))
      .toMatchObject({ ok: true, blocks: [{ size: 16, width: 6, height: 4, aspectRatio: 1.5 }] });
  });

  it('counts construction and all owners, allowing sixteen and rejecting a seventeenth', () => {
    const state = realm();
    for (let y = 13; y < 17; y++) for (let x = 18; x < 22; x++) {
      if (x === 21 && y === 16) continue;
      plot(state, x, y, { faction: x % 2, construction: { startedAt: 0, duration: 3.75 },
        ...(y === 13 ? { orchard: { startedAt: 0, readyAt: 120 } } : {}) });
    }
    expect(buildAt(state, 'camp', 21, 16).ok).toBe(true);
    expect(validateBuildAt(state, 'camp', 22, 16)).toMatchObject({ ok: false });
    expect(validateBuildAt(state, 'camp', 22, 16).message).toContain('16');
    expect(buildAt(state, 'camp', 22, 16).ok).toBe(false);
  });

  it('checks the merged shape instead of treating each neighboring block separately', () => {
    const state = realm();
    for (const start of [17, 20]) for (let y = 14; y < 16; y++) for (let x = start; x < start + 2; x++) plot(state, x, y);
    // Bridging two 2×2 blocks would create a nine-cell 5×2 block (2.5:1).
    expect(validateBuildAt(state, 'camp', 19, 14).ok).toBe(false);
    expect(buildAt(state, 'camp', 24, 14).ok).toBe(true);
  });
});
