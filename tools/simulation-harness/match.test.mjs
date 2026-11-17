import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeMatches } from './match.mjs';

const row=(left,right,winner,hash='same')=>({scenario:'field-battle',seed:'s1',left,right,winner,initialStateHash:hash,
  factions:[{policy:left,survivingArmyHP:100},{policy:right,survivingArmyHP:50}]});
test('round-robin standings use actual wins and balance both starting sides',()=>{
  const result=summarizeMatches([row('a','b','a'),row('b','a','b')],['a','b']);
  assert.equal(result.uniqueLeader,null);
  for(const entry of result.table){assert.equal(entry.wins,1);assert.equal(entry.losses,1);assert.equal(entry.points,3);}
});
test('timeouts remain draws despite unequal surviving army health',()=>{
  const result=summarizeMatches([row('a','b',null),row('b','a',null)],['a','b']);
  assert.equal(result.uniqueLeader,null);
  for(const entry of result.table){assert.equal(entry.wins,0);assert.equal(entry.draws,2);assert.equal(entry.points,2);}
});
test('standings reject initial-condition mismatches across opponents or legs',()=>{
  assert.throws(()=>summarizeMatches([row('a','b','a'),row('b','a','b','different')],['a','b']));
});
