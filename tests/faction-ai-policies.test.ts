import { describe, expect, it } from 'vitest';
import { factionAILogicFaults, factionAIDecision, factionAIPolicy, factionAIProfile, listFactionAIPolicies, registerFactionAIPolicies,
  setFactionAIProfile, type AIPolicyDefinition } from '../src/game/faction-ai-profile';
import { flushSimulationSnapshot } from '../src/game/sim-handle';
import { rustEngine } from '../src/game/rust-engine';
import type { GameState } from '../src/game/types';

// These commands only need a simulation core, not terrain or a rendered game.
const state = (): GameState => ({ time: 0, tick: 0, speed: 1, rngState: 123, paused: false,
  gameOver: false, victory: false } as GameState);

describe('native faction AI policy registry', () => {
  it('defaults to funded expansion and gives legacy policies their former investment limits', () => {
    const game=state();
    expect(factionAIPolicy(game,1).features.foundCities).toBe(true);
    expect(factionAIDecision(game,1,'housingCredit',0,30,0)).toBe(4);
    expect(factionAIDecision(game,1,'housingLimit')).toBe(4);
    expect(factionAIDecision(game,1,'keepUpgrade',1000,100,200,100,0,0)).toBe(1);
    setFactionAIProfile(game,1,'coordinated');
    expect(factionAIDecision(game,1,'housingCredit',0,30,0)).toBe(2);
    expect(factionAIDecision(game,1,'keepUpgrade',1000,100,200,100,0,0)).toBe(0);
  });
  it('resolves forward inheritance while retaining immutable builtin definitions', () => {
    const game = state(), original = factionAIPolicy(game, 1);
    const [child, parent] = registerFactionAIPolicies(game, [
      { id: 'child', extends: 'parent', features: { formations: false } },
      { id: 'parent', extends: 'coordinated', parameters: { retreatHealth: .8 } },
    ]);
    expect(child.parameters.retreatHealth).toBe(.8);
    expect(child.features.formations).toBe(false);
    expect(parent.features.formations).toBe(true);
    expect(original.parameters.retreatHealth).toBe(.55);
    expect(Object.isFrozen(child.parameters)).toBe(true);
    expect(Object.isFrozen(child.features)).toBe(true);
    expect(factionAIProfile(game, 1)).toBe('expansionist');
  });

  it('uses selected policy rules per faction and per world without consuming RNG', () => {
    const game = state(), other = state(), rng = game.rngState;
    registerFactionAIPolicies(game, [{ id: 'cautious', parameters: { retreatHealth: .8 } }]);
    setFactionAIProfile(game, 1, 'cautious'); setFactionAIProfile(game, 2, 'aggressive');
    expect(factionAIDecision(game, 1, 'retreat', 75, 100, 100, 0, 100)).toBe(1);
    expect(factionAIDecision(game, 2, 'retreat', 75, 100, 100, 0, 100)).toBe(0);
    expect(factionAIDecision(other, 1, 'retreat', 75, 100, 100, 0, 100)).toBe(0);
    expect(game.rngState).toBe(rng);
    expect(() => setFactionAIProfile(other, 1, 'cautious')).toThrow();
    expect(() => setFactionAIProfile(game, -1, 'legacy')).toThrow();
    expect(() => setFactionAIProfile(game, 2 ** 32 + 1, 'legacy')).toThrow();
  });

  it('rejects cycles, unknown fields, nonfinite values and unsafe decision rates atomically', () => {
    const game = state();
    const invalid: AIPolicyDefinition[][] = [
      [{ id: 'a', extends: 'b' }, { id: 'b', extends: 'a' }],
      [{ id: 'a', extends: 'missing' }],
      [{ id: 'a', parameters: { retreatHealth: NaN } }],
      [{ id: 'a', parameters: { decisionInterval: .1 } }],
      [{ id: 'a', parameters: { retreatHealth: .95, recoveryHealth: .9 } }],
      [{ id: 'valid' }, { id: 'invalid', parameters: { decisionInterval: .1 } }],
      [{ id: 'legacy' }],
      [{ id: 'a' }, { id: 'a' }],
      [{ id: 'a', parameters: { typo: 1 } } as AIPolicyDefinition],
    ];
    for (const definitions of invalid) {
      expect(() => registerFactionAIPolicies(game, definitions)).toThrow();
      expect(listFactionAIPolicies(game).map(policy => policy.id)).toEqual(['legacy', 'aggressive', 'coordinated', 'expansionist']);
    }
  });

  it('retains custom definitions and assignments through native snapshots and memory growth', () => {
    const game = state();
    registerFactionAIPolicies(game, [{ id: 'no-formations', features: { formations: false } }]);
    setFactionAIProfile(game, 1, 'no-formations');
    const copy = { ...state(), aiPolicyNames: [...game.aiPolicyNames!], simCore: flushSimulationSnapshot(game) };
    rustEngine.memory.grow(1);
    expect(factionAIProfile(copy, 1)).toBe('no-formations');
    expect(factionAIPolicy(copy, 1).features.formations).toBe(false);
    expect(factionAIProfile(copy, 2)).toBe('expansionist');
    expect(factionAIDecision(copy, 1, 'formation', 1, 1, 12, 0, 1, 0)).toBe(0);
    expect(factionAIDecision(copy, 2, 'formation', 1, 1, 12, 0, 1, 0)).toBe(1);
  });
  it('executes inherited conditional logic natively and preserves it through snapshots', () => {
    const game=state();
    registerFactionAIPolicies(game,[{id:'contextual',logic:{retreat:{op:'and',args:[
      {op:'gt',args:[{fact:'enemyPower'},{fact:'friendlyPower'}]},
      {op:'gt',args:[{fact:'distanceHome'},5]},
    ]}}},{id:'inherited',extends:'contextual'},{id:'reset',extends:'contextual',logic:{retreat:null}}]);
    setFactionAIProfile(game,1,'inherited');
    expect(factionAIDecision(game,1,'retreat',100,100,100,200,100,2)).toBe(0);
    expect(factionAIDecision(game,1,'retreat',100,100,100,200,100,8)).toBe(1);
    expect(Object.isFrozen(factionAIPolicy(game,1).logic.retreat)).toBe(true);
    const copy={...state(),aiPolicyNames:[...game.aiPolicyNames!],simCore:flushSimulationSnapshot(game)};
    rustEngine.memory.grow(1);
    expect(factionAIDecision(copy,1,'retreat',100,100,100,200,100,8)).toBe(1);
    const [grandchild]=registerFactionAIPolicies(copy,[{id:'grandchild',extends:'inherited'}]);
    expect(grandchild.logic).toEqual(factionAIPolicy(game,1).logic);
    setFactionAIProfile(copy,1,'reset');
    expect(factionAIPolicy(copy,1).logic).toEqual({});
    expect(factionAIDecision(copy,1,'retreat',100,100,100,200,100,2)).toBe(1);
  });

  it('rejects malformed logic atomically and counts nonfinite arithmetic fallbacks', () => {
    const game=state();
    expect(()=>registerFactionAIPolicies(game,[{id:'valid'},{id:'bad',logic:{retreat:{fact:'hiddenEnemyArmy'}}}])).toThrow();
    expect(listFactionAIPolicies(game)).toHaveLength(4);
    let expression: import('../src/game/faction-ai-logic').LogicExpression=1e6;
    for(let i=0;i<52;i++)expression={op:'mul',args:[expression,1e6]};
    expect(()=>registerFactionAIPolicies(game,[{id:'oversized',logic:{retreat:expression}}])).toThrow();
    // Squaring reuses already finite facts; a single overflowing operation is
    // sufficient to verify native fault handling without a large expression.
    const [policy]=registerFactionAIPolicies(game,[{id:'overflow',logic:{retreat:{op:'mul',args:[{fact:'enemyPower'},{fact:'enemyPower'}]}}}]);
    setFactionAIProfile(game,1,policy.id);
    expect(factionAIDecision(game,1,'retreat',100,100,100,1e200,100,5)).toBe(1);
    expect(factionAILogicFaults(game,policy.code)).toBe(1);
  });

});
