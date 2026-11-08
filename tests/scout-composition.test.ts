import { withDevelopedResources } from './helpers/developed-resources';
import { describe, expect, it } from 'vitest';
import { archerFraction, nextRecruitRole, retinueComposition, scheduleArcheryTraining, setArcherFraction, setSpearmanFraction } from '../src/game/archery';
import { entityStore } from '../src/game/entity-store';

import { synchronizeRetinueSquads } from '../src/game/retinue-squads';
import { isRetinueMember } from '../src/game/types';

import { addTestScouts, scoutRealm } from './helpers/scouts';

describe('dedicated scouts and combat composition', () => {
  it('keeps explicitly placed scouts outside combat slots and squads', () => {
    const state = scoutRealm(); addTestScouts(state); synchronizeRetinueSquads(state);
    const scouts = state.units.filter(unit => unit.kind === 'scout');
    expect(scouts).toHaveLength(2);
    expect(state.units.filter(isRetinueMember)).toHaveLength(4);
    expect(scouts.every(unit => !isRetinueMember(unit) && unit.retinueSquad === undefined && !unit.joiningRetinue)).toBe(true);
    expect(entityStore(state).units.query('retinue')).toHaveLength(4);
    expect(retinueComposition(state, 0)).toMatchObject({ total: 4, warriors: 4, archers: 0, spearmen: 0 });
  });

  it('keeps archer and spearman allocations independent of the lodge explorers', () => {
    const state = withDevelopedResources(scoutRealm(), ['copper']); addTestScouts(state);
    const smithy = { ...state.buildings[0], id: 102, kind: 'blacksmith' as const, x: 14 }; entityStore(state).buildings.add(smithy);
    expect(setArcherFraction(state, state.buildings[0], .5)).toBe(true);
    expect(setSpearmanFraction(state, smithy, .5)).toBe(true);
    expect(archerFraction(state.factions[0])).toBe(.5);
    expect(retinueComposition(state, 0)).toMatchObject({ total: 4, archers: 2, spearmen: 2, warriors: 0 });
    scheduleArcheryTraining(state, true);
    expect(state.units.filter(unit => unit.kind === 'scout').every(unit => !unit.training)).toBe(true);
    expect(state.units.filter(unit => unit.training)).toHaveLength(4);
    expect(state.units.filter(unit => unit.training).every(unit => unit.training!.range === (unit.training!.role === 'spearman' ? smithy.id : 100))).toBe(true);
    expect(nextRecruitRole(state, state.factions[0])).toBe('warrior');
  });

  it('never recruits a retinue scout even with Exploration and a completed lodge', () => {
    const state = scoutRealm(); entityStore(state).units.retain(unit => unit.kind === 'leader'); addTestScouts(state);
    expect(nextRecruitRole(state, state.factions[0])).toBe('warrior');
    expect(retinueComposition(state, 0).warriors).toBe(4);
  });
});
