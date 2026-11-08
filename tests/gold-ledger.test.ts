import { describe, expect, it, vi } from 'vitest';
import { goldFlowSummary, recordGoldInput, recordGoldOutlay, refundGold, spendGold, type GoldInputCategory, type GoldOutlayCategory } from '../src/game/gold-ledger';
import { grantIncome } from '../src/game/resource-income';
import { parseGameSave, serializeGameSave } from '../src/game/game-save';
import { fixture } from './helpers/research-income';
import { RESEARCH_BRANCHES, researchCost, updateResearch } from '../src/game/research';

const amount = (rows: {category: string; amount: number}[], category: string) => rows.find(row => row.category === category)?.amount ?? 0;
const empty = {inputs:[],outlays:[],totalInputs:0,totalOutlays:0,net:0,window:60};

describe('saved rolling gold transaction ledger', () => {
  it('excludes starting wealth and catches every transaction before the first tooltip read', () => {
    const state = fixture(), faction = state.factions[0]; faction.research={focus:'woodenTower',allocation:0,levels:{},progress:{}};
    expect(goldFlowSummary(state,faction)).toEqual(empty); expect(faction.goldLedger).toBeUndefined();
    grantIncome(faction,{gold:100},state,'taxes'); spendGold(state,faction,80,'construction'); refundGold(state,faction,20);
    spendGold(state,faction,30,'army'); grantIncome(faction,{gold:6},state,'loot');
    expect(goldFlowSummary(state,faction)).toMatchObject({totalInputs:126,totalOutlays:110,net:16});
    expect(faction.gold).toBe(2016); expect(faction.incomeTotals?.gold).toBe(106);
    expect(faction.goldLedger).toHaveLength(1);
  });
  it('records each input and outlay category independently in stable presentation order', () => {
    const state=fixture(),faction=state.factions[0];
    const inputs:GoldInputCategory[]=['taxes','trade','loot','treasure','refunds','transfers','other'];
    const outlays:GoldOutlayCategory[]=['construction','settlements','defenses','army','science','upgrades','immigration','diplomacy','raided','transfers','other'];
    for(let i=inputs.length-1;i>=0;i--)recordGoldInput(state,faction,i+.5,inputs[i]);
    for(let i=outlays.length-1;i>=0;i--)recordGoldOutlay(state,faction,i+1.25,outlays[i]);
    const summary=goldFlowSummary(state,faction);
    expect(summary.inputs.map(row=>row.category)).toEqual(inputs);expect(summary.outlays.map(row=>row.category)).toEqual(outlays);
    expect(summary.inputs.every(row=>row.label.length>0&&row.amount>0)).toBe(true);
    expect(summary.totalInputs).toBe(inputs.reduce((sum,_,i)=>sum+i+.5,0));
    expect(summary.totalOutlays).toBe(outlays.reduce((sum,_,i)=>sum+i+1.25,0));
    expect(summary.net).toBe(summary.totalInputs-summary.totalOutlays);
    expect(faction.gold).toBe(2000); // Record helpers never alter resources themselves.
  });
  it('uses an exact sixty-game-second sliding window, including fractional boundaries', () => {
    const state=fixture(),faction=state.factions[0];
    state.time=10;recordGoldInput(state,faction,100,'taxes');state.time=10.25;recordGoldInput(state,faction,20,'trade');
    state.time=11;recordGoldOutlay(state,faction,5,'army');
    state.time=69.999;expect(goldFlowSummary(state,faction)).toMatchObject({totalInputs:120,totalOutlays:5,net:115});
    state.time=70;expect(goldFlowSummary(state,faction)).toMatchObject({totalInputs:20,totalOutlays:5,net:15});
    state.time=70.25;expect(goldFlowSummary(state,faction)).toMatchObject({totalInputs:0,totalOutlays:5,net:-5});
    state.time=71;expect(goldFlowSummary(state,faction)).toEqual(empty);
    expect(faction.goldLedger).toHaveLength(3); // Display reads do not prune authoritative history.
    refundGold(state,faction,2);expect(faction.goldLedger).toHaveLength(1);expect(faction.goldLedger![0].time).toBe(71);
  });
  it('caps expenses at available gold and preserves fractional refunds without creating Science or gross income', () => {
    const state=fixture(),faction=state.factions[0];faction.gold=1;
    grantIncome(faction,{gold:8.5},state,'trade'); updateResearch(state,30);
    expect(faction.gold).toBeCloseTo(7.375);expect(faction.research?.progress.woodenTower).toBe(2.125);
    spendGold(state,faction,20,'settlements');expect(faction.gold).toBe(0);
    refundGold(state,faction,3.125);expect(faction.gold).toBe(3.125);
    expect(faction.incomeTotals?.gold).toBe(8.5);expect(faction.research?.progress.woodenTower).toBe(2.125);
    const summary=goldFlowSummary(state,faction);
    expect(amount(summary.inputs,'trade')).toBe(8.5);expect(amount(summary.inputs,'refunds')).toBe(3.125);
    expect(amount(summary.outlays,'science')).toBe(2.125);expect(amount(summary.outlays,'settlements')).toBe(7.375);
    expect(summary.net).toBe(faction.gold-1);
  });
  it('records only actual Science diversion, returning surplus to gold when the tree finishes', () => {
    const state=fixture(),faction=state.factions[0],cost=RESEARCH_BRANCHES.reduce((sum,b)=>sum+researchCost(faction,b.id),0);
    grantIncome(faction,{gold:(cost+10)*4},state,'treasure');
    const summary=goldFlowSummary(state,faction);expect(amount(summary.outlays,'science')).toBe(cost);
    expect(summary.totalInputs).toBe((cost+10)*4);expect(summary.net).toBe(faction.gold-2000);
    grantIncome(faction,{gold:100},state,'trade');expect(amount(goldFlowSummary(state,faction).outlays,'science')).toBe(cost);
  });
  it('never mutates state while reading, and a paused game does not age its ledger with wall time', () => {
    const state=fixture(),faction=state.factions[0];recordGoldInput(state,faction,7,'loot');state.paused=true;
    const before=structuredClone(state);const now=goldFlowSummary(state,faction);
    vi.useFakeTimers();try {vi.advanceTimersByTime(120000);for(let i=0;i<100;i++)expect(goldFlowSummary(state,faction)).toEqual(now);}finally{vi.useRealTimers();}
    expect(state).toEqual(before);
    spendGold(state,faction,3,'upgrades');expect(faction.goldLedger).toHaveLength(1);
    expect(goldFlowSummary(state,faction).net).toBe(4);expect(state.time).toBe(0);
  });
  it('isolates factions and retains exact transaction timestamps through a real save/load', () => {
    const state=fixture(),faction=state.factions[0];state.factions.push({...faction,id:1});
    state.time=25.125;recordGoldInput(state,faction,12.75,'taxes');recordGoldOutlay(state,state.factions[1],8.25,'raided');
    state.time=31.4;refundGold(state,faction,2.125);
    const restored=parseGameSave(serializeGameSave(state));
    expect(restored.factions.map(f=>f.goldLedger)).toEqual(state.factions.map(f=>f.goldLedger));
    expect(goldFlowSummary(restored,restored.factions[0])).toEqual(goldFlowSummary(state,faction));
    expect(goldFlowSummary(restored,restored.factions[1])).toMatchObject({totalInputs:0,totalOutlays:8.25,net:-8.25});
    restored.time=85.125;expect(goldFlowSummary(restored,restored.factions[0]).totalInputs).toBe(2.125);
  });
  it('aggregates same-step receipts and bounds retained buckets to the live window across long sessions', () => {
    const state=fixture(),faction=state.factions[0];
    for(let i=0;i<4000;i++){
      state.time=i/4;recordGoldInput(state,faction,1,'loot');recordGoldInput(state,faction,2,'loot');recordGoldOutlay(state,faction,.5,'science');
      expect(faction.goldLedger!.length).toBeLessThanOrEqual(240);
    }
    expect(goldFlowSummary(state,faction)).toMatchObject({totalInputs:720,totalOutlays:120,net:600});
    expect(faction.goldLedger!.every(entry=>entry.inputs.loot===3&&entry.outlays.science===.5)).toBe(true);
    state.time+=61;recordGoldInput(state,faction,1,'other');expect(faction.goldLedger).toHaveLength(1);
  });
  it('rejects nonpositive and nonfinite amounts without creating buckets or changing balances', () => {
    const state=fixture(),faction=state.factions[0];
    for(const value of [0,-1,NaN,Infinity,-Infinity]){recordGoldInput(state,faction,value,'other');recordGoldOutlay(state,faction,value,'other');spendGold(state,faction,value,'other');refundGold(state,faction,value);}
    expect(faction.goldLedger).toBeUndefined();expect(faction.gold).toBe(2000);
  });
  it('ignores future history after a rewind and drops it only on the next authoritative transaction',()=>{
    const state=fixture(),faction=state.factions[0];state.time=10;recordGoldInput(state,faction,1,'loot');state.time=20;recordGoldInput(state,faction,10,'taxes');
    state.time=15;expect(goldFlowSummary(state,faction).totalInputs).toBe(1);expect(faction.goldLedger).toHaveLength(2);
    recordGoldInput(state,faction,2,'trade');expect(faction.goldLedger!.map(entry=>entry.time)).toEqual([10,15]);expect(goldFlowSummary(state,faction).totalInputs).toBe(3);
  });
});
