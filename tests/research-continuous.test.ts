import { describe, expect, it } from 'vitest';
import { grantIncome } from '../src/game/resource-income';
import { goldFlowSummary } from '../src/game/gold-ledger';
import { researchCost, researchStatus, prioritizeResearch, setResearchAllocation, updateResearch, RESEARCH_BRANCHES } from '../src/game/research';
import { fixture } from './helpers/research-income';

const reserve = (state: ReturnType<typeof fixture>) => {
  const research = state.factions[0].research;
  return (research?.credit ?? 0) + (research?.funding ?? []).reduce((sum, funding) => sum + funding.points, 0);
};
const work = (state: ReturnType<typeof fixture>) => Object.values(state.factions[0].research?.progress ?? {}).reduce((sum, amount) => sum + (amount ?? 0), 0);
const step = (state: ReturnType<typeof fixture>, seconds = .1) => { state.time += seconds; updateResearch(state, seconds); };

describe('continuous, paid Science', () => {
  it('spreads a tax receipt through the whole 30-second period and visits every percentage without jumps', () => {
    const state = fixture(), faction = state.factions[0], seen = new Set<number>([0]);
    grantIncome(faction, { gold: researchCost(faction, 'woodenTower') * 4 }, state, 'taxes');
    expect(researchStatus(state, 0).progress).toBe(0); expect(reserve(state)).toBe(24);
    let previous = 0;
    for (let count = 1; count <= 300; count++) {
      step(state);
      const progress = faction.research?.progress.woodenTower ?? 0;
      const percentage = Math.floor(progress / 24 * 100 + 1e-7);
      expect(percentage - previous).toBeGreaterThanOrEqual(0);
      expect(percentage - previous).toBeLessThanOrEqual(1);
      seen.add(percentage); previous = percentage;
      expect(work(state) + reserve(state)).toBeCloseTo(24, 9);
      if (count === 150) expect(progress).toBeCloseTo(12, 9);
      if (count < 300) expect(faction.research?.levels.woodenTower).toBeUndefined();
    }
    expect([...seen]).toEqual(Array.from({ length: 101 }, (_, index) => index));
    expect(faction.research?.levels.woodenTower).toBe(1); expect(reserve(state)).toBeCloseTo(0, 9);
    expect(faction.gold).toBe(2072); // Income96 minus24 paid Science, with no later debit.
  });

  it('limits enormous trade deliveries to one percentage point per two simulation steps', () => {
    const state = fixture(), faction = state.factions[0]; grantIncome(faction, { gold: 100000 }, state, 'trade');
    for (let index = 1; index < 200; index++) {
      step(state);
      expect(faction.research?.progress.woodenTower).toBeCloseTo(index * .12, 8);
      expect(faction.research?.levels.woodenTower).toBeUndefined();
    }
    step(state); expect(faction.research?.levels.woodenTower).toBe(1);
    expect(researchStatus(state, 0).focus).toBe('scoutLodge');
    const total = RESEARCH_BRANCHES.reduce((sum, branch) => sum + researchCost(faction, branch.id), 0);
    expect(work(state) + reserve(state)).toBeCloseTo(total, 8);
    const treasury = faction.gold; grantIncome(faction, { gold: 200 }, state, 'trade');
    expect(faction.gold).toBeCloseTo(treasury + 200, 8); // The already fully funded tree takes no more gold.
  });

  it('preserves funded work through pause and library destruction, resumes without charging twice, and cannot advance unfunded work', () => {
    const state = fixture(), faction = state.factions[0], library = state.buildings[1];
    grantIncome(faction, { gold: 40 }, state); step(state, 15);
    expect(work(state)).toBe(5); expect(reserve(state)).toBe(5);
    state.paused = true; const paused = structuredClone(faction.research); step(state, 60); expect(faction.research).toEqual(paused);
    state.paused = false; library.hp = 0; step(state, 60); expect(faction.research).toEqual(paused);
    library.hp = 250; expect(setResearchAllocation(state, library, 0).ok).toBe(true);
    const treasury = faction.gold; step(state, 15);
    expect(work(state)).toBe(10); expect(reserve(state)).toBe(0); expect(faction.gold).toBe(treasury);
    step(state, 1000); expect(work(state)).toBe(10);
    grantIncome(faction, { gold: 40 }, state); step(state, 30);
    expect(work(state)).toBe(10); expect(faction.gold).toBe(treasury + 40);
  });

  it('redirects the remaining paid reserve to a new priority without resetting the earlier project', () => {
    const state = fixture(), faction = state.factions[0]; grantIncome(faction, { gold: 40 }, state); step(state, 15);
    expect(faction.research?.progress.woodenTower).toBe(5);
    expect(prioritizeResearch(state, state.buildings[1], 'irrigation').ok).toBe(true); step(state, 15);
    expect(faction.research?.progress).toMatchObject({ woodenTower: 5, irrigation: 5 });
    expect(reserve(state)).toBe(0); expect(faction.gold).toBe(2030);
  });

  it('refunds a fully funded tree’s excess when a scholar alliance reduces its cost, without treating the refund as income', () => {
    const state = fixture(), faction = state.factions[0]; grantIncome(faction, { gold: 100000 }, state, 'trade');
    const originalCost = reserve(state), treasury = faction.gold;
    faction.villageBonuses = { food: 0, trade: 0, construction: 0, research: 1 };
    step(state);
    expect(work(state) + reserve(state)).toBeCloseTo(originalCost / 2, 8);
    expect(faction.gold).toBeCloseTo(treasury + originalCost / 2, 8);
    expect(faction.incomeTotals?.gold).toBe(100000);
    expect(goldFlowSummary(state, faction).inputs.find(row => row.category === 'refunds')?.amount).toBeCloseTo(originalCost / 2, 8);
    updateResearch(state, 1000); expect(researchStatus(state, 0).completed).toBe(true); expect(reserve(state)).toBeCloseTo(0, 8);
  });
});
