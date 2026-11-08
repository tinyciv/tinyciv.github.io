import { describe, expect, it } from 'vitest';
import { DEFAULT_RESEARCH_ALLOCATION, RESEARCH_BRANCHES, prioritizeResearch, researchCost, researchStatus } from '../src/game/research';
import type { ResearchBranchId } from '../src/game/types';
import { fixture, points } from './helpers/research-income';

const definitions = new Map(RESEARCH_BRANCHES.map(branch => [branch.id, branch]));
function ancestors(id: ResearchBranchId, visiting = new Set<ResearchBranchId>()): Set<ResearchBranchId> {
  if (visiting.has(id)) throw Error(`Science dependency cycle at ${id}`);
  const definition = definitions.get(id); if (!definition) throw Error(`Unknown science dependency ${id}`);
  const path = new Set(visiting).add(id), result = new Set<ResearchBranchId>();
  for (const prerequisite of definition.prerequisites) {
    result.add(prerequisite); for (const ancestor of ancestors(prerequisite, path)) result.add(ancestor);
  }
  return result;
}

describe('six-stage science dependency graph', () => {
  it('has only three roots, no missing dependencies or cycles, six stages and at most five technologies per earliest stage', () => {
    expect(definitions.size).toBe(25);
    expect(RESEARCH_BRANCHES.filter(branch => !branch.prerequisites.length).map(branch => branch.id))
      .toEqual(['woodenTower', 'irrigation', 'scoutLodge']);
    const stage = (id: ResearchBranchId): number => 1 + Math.max(0, ...definitions.get(id)!.prerequisites.map(stage));
    const stages = new Map<number, ResearchBranchId[]>();
    for (const branch of RESEARCH_BRANCHES) {
      expect(ancestors(branch.id).has(branch.id)).toBe(false);
      expect(new Set(branch.prerequisites).size).toBe(branch.prerequisites.length);
      for (const prerequisite of branch.prerequisites)
        expect(branch.prerequisites.some(other => other !== prerequisite && ancestors(other).has(prerequisite))).toBe(false);
      const number = stage(branch.id); stages.set(number, [...(stages.get(number) ?? []), branch.id]);
    }
    expect([...stages.keys()].sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect([...stages.values()].every(group => group.length <= 5)).toBe(true);
    expect(stage('horsebackRiding')).toBe(2); expect(stage('siegeEngines')).toBe(6);
    expect(DEFAULT_RESEARCH_ALLOCATION).toBe(.25);
    expect(RESEARCH_BRANCHES.map(branch => branch.tiers[0].points)).toEqual([24,56,126,261,147,50,25,70,126,273,198,325,500,231,182,98,231,182,435,147,450,600,198,273,126]);
    expect(RESEARCH_BRANCHES.reduce((total, branch) => total + branch.tiers[0].points, 0)).toBe(5334);
  });

  it('links military, economic and exploration progress instead of leaving advanced branches as independent roots', () => {
    expect(definitions.get('monument')!.prerequisites).toEqual(['grainStorage']);
    expect(definitions.get('traditionalMedicine')!.prerequisites).toEqual(['grainStorage', 'scoutLodge']);
    expect(definitions.get('militaryTactics')!.prerequisites).toEqual(['blacksmith', 'archeryRange']);
    expect(definitions.get('coinage')!.prerequisites).toEqual(['monument', 'sailing']);
    expect(definitions.get('urbanPlanning')!.prerequisites).toEqual(['coinage', 'metalTools']);
    expect(definitions.get('horsebackRiding')!.prerequisites).toEqual(['scoutLodge']);
    expect(definitions.get('reinforcedDefenses')!.prerequisites).toEqual(['metalTools']);
    expect(definitions.get('engineering')!.prerequisites).toEqual(['wall']);
    expect(definitions.get('siegeEngines')!.prerequisites).toEqual(['reinforcedDefenses', 'fletching']);
    expect(ancestors('siegeEngines')).toEqual(new Set(['woodenTower', 'wall', 'blacksmith', 'metalTools', 'reinforcedDefenses', 'scoutLodge', 'archeryRange', 'fletching']));
  });

  it.each(RESEARCH_BRANCHES.map(branch => branch.id))('reaches prioritized %s from zero, completing every ancestor first and no unrelated technology', target => {
    const state = fixture(), faction = state.factions[0], required = ancestors(target).add(target);
    expect(prioritizeResearch(state, state.buildings[1], target).ok).toBe(true);
    const completed: ResearchBranchId[] = [];
    for (let count = 0; count < required.size; count++) {
      const status = researchStatus(state, 0), active = definitions.get(status.focus)!;
      expect(required.has(status.focus)).toBe(true);
      expect(active.prerequisites.every(id => completed.includes(id))).toBe(true);
      expect(status.requestedFocus).toBe(target);
      points(state, status.required - status.progress);
      expect(faction.research?.levels[active.id]).toBe(1);
      completed.push(active.id);
    }
    expect(completed.at(-1)).toBe(target);
    expect(new Set(completed)).toEqual(required);
    expect(new Set(Object.keys(faction.research!.levels))).toEqual(required);
    const spent = [...required].reduce((sum, id) => sum + researchCost(faction, id), 0);
    expect(Object.values(faction.research!.progress).reduce((sum, value) => sum + (value ?? 0), 0)).toBe(spent);
    expect(faction.gold).toBe(2000 + spent * 3); //25% conversion, without separate purchase charges.
  });
});
