import { withDevelopedResources } from './helpers/developed-resources';
import { describe, expect, it } from 'vitest';
import { nextRecruitRole, setSpearmanFraction, updateArcheryTraining } from '../src/game/archery';
import { entityStore } from '../src/game/entity-store';
import { applyGameCommand } from '../src/multiplayer/commands';
import { scoutRealm } from './helpers/scouts';

function fixture() {
  const state = withDevelopedResources(scoutRealm(), ['copper']);
  const smithy = { ...state.buildings[0], id: 102, kind: 'blacksmith' as const, x: 14 };
  entityStore(state).buildings.add(smithy);
  return { state, smithy, range: state.buildings[0] };
}

describe('blacksmith spearman allocation', () => {
  it('requires Military tactics at the smithy, and rejects the former range command', () => {
    const { state, smithy, range } = fixture();
    delete state.factions[0].research!.levels.militaryTactics;
    expect(setSpearmanFraction(state, smithy, .5)).toBe(false);
    expect(applyGameCommand(state, 0, { type: 'spearmen', buildingId: smithy.id, fraction: .5 }).ok).toBe(false);
    state.factions[0].research!.levels.militaryTactics = 1;
    expect(setSpearmanFraction(state, range, .5)).toBe(false);
    expect(applyGameCommand(state, 0, { type: 'spearmen', buildingId: range.id, fraction: .5 }).ok).toBe(false);
    expect(applyGameCommand(state, 0, { type: 'spearmen', buildingId: smithy.id, fraction: .5 }).ok).toBe(true);
    const trainees = state.units.filter(unit => unit.training);
    expect(trainees).toHaveLength(2);
    expect(trainees.every(unit => unit.training?.range === smithy.id && unit.training.role === 'spearman')).toBe(true);
  });

  it.each(['foreign', 'unfinished', 'destroyed', 'distant', 'NaN'] as const)('rejects %s smithy allocation without changing composition', reason => {
    const { state, smithy } = fixture();
    if (reason === 'foreign') smithy.faction = 1;
    if (reason === 'unfinished') Object.assign(smithy, { construction: { startedAt: 0, duration: 90 } });
    if (reason === 'destroyed') smithy.hp = 0;
    if (reason === 'distant') state.units[0].x = 35;
    expect(setSpearmanFraction(state, smithy, reason === 'NaN' ? NaN : .5)).toBe(false);
    expect(state.factions[0].spearmanFraction).toBeUndefined();
    expect(state.units.some(unit => unit.training)).toBe(false);
  });

  it('does not send city garrisons away to retrain when allocation changes', () => {
    const { state, smithy } = fixture();
    const defenders = state.units.filter(unit => unit.kind === 'warrior');
    for (const unit of defenders) unit.garrison = { city: 200, post: { x: unit.x, y: unit.y }, arrived: true };
    expect(setSpearmanFraction(state, smithy, 1)).toBe(true);
    expect(defenders.every(unit => !unit.training && unit.garrison?.city === 200)).toBe(true);
  });

  it('needs a surviving blacksmith for replacement spearmen and cancels training if it is lost', () => {
    const { state, smithy } = fixture();
    expect(setSpearmanFraction(state, smithy, .5)).toBe(true);
    const trainee = state.units.find(unit => unit.training)!;
    trainee.training!.enteredAt = 0; trainee.inside = true;
    trainee.x = smithy.x + .5; trainee.y = smithy.y + .5;
    expect(nextRecruitRole(state, state.factions[0])).toBe('warrior'); // Two trainees already reserve both slots.
    entityStore(state).units.retain(unit => !unit.training || unit === trainee);
    expect(nextRecruitRole(state, state.factions[0])).toBe('spearman');
    smithy.hp = 0; state.time = 5;
    expect(nextRecruitRole(state, state.factions[0])).toBe('warrior');
    updateArcheryTraining(state, trainee, .1, () => {});
    expect(trainee.training).toBeUndefined();
    expect(trainee.inside).toBe(false);
    expect(trainee.kind).toBe('warrior');
  });
});
