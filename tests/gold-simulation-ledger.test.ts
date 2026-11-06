import { describe, expect, it } from 'vitest';
import { buildAt, cancelConstruction } from '../src/game/simulation';
import { goldFlowSummary } from '../src/game/gold-ledger';
import { fixture } from './helpers/research-income';

describe('construction receipts in the live gold ledger', () => {
  it('records only successful payments and returns unused gold without funding Science', () => {
    const state = fixture(), faction = state.factions[0], before = faction.gold;
    faction.culture = 10000;
    const ordered = buildAt(state, 'library', 13, 10);
    expect(ordered.ok, ordered.message).toBe(true);
    const site = state.buildings.find(building => building.kind === 'library' && building.x === 13)!;
    expect(buildAt(state, 'library', 13, 10).ok).toBe(false);
    expect(goldFlowSummary(state, faction)).toMatchObject({ totalInputs: 0, totalOutlays: 200, net: -200,
      outlays: [{ category: 'construction', amount: 200 }] });
    expect(faction.gold).toBe(before - 200);
    expect(cancelConstruction(state, site.id)).toEqual({ ok: true, refund: 200 });
    expect(cancelConstruction(state, site.id)).toEqual({ ok: false, refund: 0 });
    const summary = goldFlowSummary(state, faction);
    expect(summary).toMatchObject({ totalInputs: 200, totalOutlays: 200, net: 0,
      inputs: [{ category: 'refunds', amount: 200 }], outlays: [{ category: 'construction', amount: 200 }] });
    expect(faction.gold).toBe(before);
    expect(faction.incomeTotals?.gold ?? 0).toBe(0);
    expect(faction.research?.progress ?? {}).toEqual({});
  });
});
