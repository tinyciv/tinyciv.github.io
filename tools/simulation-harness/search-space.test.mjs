import test from 'node:test';
import assert from 'node:assert/strict';
import { randomSource,propose,pairedEvidence,genomeHash,logicSize } from './search-space.mjs';
const parent={id:'base',extends:'expansionist',features:{formations:true},logic:{},parameters:{retreatHealth:.55,recoveryHealth:.9,retreatMorale:40,recoveryMorale:75,formationStayCount:6,formationEnterCount:8}};
test('seeded mutation is repeatable, bounded, repaired, and does not mutate parents',()=>{
  const before=structuredClone(parent),options={id:'child',lane:'parameters',bounds:{retreatHealth:[.9,1]}};
  const a=propose(randomSource('repeat'),parent,parent,options),b=propose(randomSource('repeat'),parent,parent,options);
  assert.deepEqual(a,b);assert.deepEqual(parent,before);assert.ok(a.definition.parameters.recoveryHealth>=a.definition.parameters.retreatHealth);
  assert.notEqual(genomeHash(a.definition),genomeHash(parent));
  const rng=randomSource('resume');rng.next();const saved=rng.state,expected=rng.next();rng.state=saved;assert.equal(rng.next(),expected);
});
test('logic candidates synthesize bounded rule trees without changing parameters',()=>{
  const proposal=propose(randomSource('rule'),parent,parent,{id:'child',lane:'logic'});
  assert.deepEqual(proposal.definition.parameters,parent.parameters);assert.ok(Object.keys(proposal.definition.logic).length);
  assert.ok(Object.values(proposal.definition.logic).every(tree=>logicSize(tree)<=64));
});
function pair(seed,winners,scenario='field-battle') {return winners.map((winner,leg)=>({seed,scenario,left:leg?'b':'a',right:leg?'a':'b',winner,initialStateHash:`${scenario}:${seed}`}));}
test('confirmation groups both sides and all scenarios by seed, and retains draws',()=>{
  const report={rows:[...pair('one',['b','b']),...pair('one',['a','a'],'siege-war'),...pair('two',[null,null])]};
  const evidence=pairedEvidence(report,'b','a');assert.equal(evidence.seeds,2);assert.equal(evidence.tied,2);assert.equal(evidence.positive,0);assert.equal(evidence.signTestP,1);
  const wins={rows:Array.from({length:8},(_,i)=>pair(`s${i}`,['b','b'])).flat()};
  assert.ok(Math.abs(pairedEvidence(wins,'b','a').signTestP-1/256)<1e-12);
  assert.throws(()=>pairedEvidence({rows:pair('partial',['b'])},'b','a'));
  const mismatched=pair('bad',['b','b']);mismatched[1].initialStateHash='changed';assert.throws(()=>pairedEvidence({rows:mismatched},'b','a'));
});
