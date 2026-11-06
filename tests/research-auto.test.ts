import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { parseGameSave, serializeGameSave } from '../src/game/game-save';
import { researchStatus, researchCost, prioritizeResearch, removeResearchPriority, setResearchAllocation, updateResearch, RESEARCH_BRANCHES } from '../src/game/research';
import { grantIncome } from '../src/game/resource-income';
import { updateGame } from '../src/game/simulation';
import type { GameState } from '../src/game/types';
import { fixture, building, points } from './helpers/research-income';

describe('automatic income research', () => {
  it('defaults to 25%, never spends existing savings, and credits exactly one Science per diverted gold', () => {
    const state = fixture(), faction = state.factions[0]; faction.gold = -20;
    expect(researchStatus(state,0)).toMatchObject({ allocation:.25, focus:'woodenTower', active:true, progress:0 });
    updateResearch(state,10000); expect(faction.gold).toBe(-20); expect(faction.research).toBeUndefined();
    grantIncome(faction,{gold:12,food:9,culture:2},state);
    expect(researchStatus(state,0).progress).toBe(0); updateResearch(state,30);
    expect(faction.gold).toBe(-11); expect(researchStatus(state,0).progress).toBe(3);
    expect(faction.incomeTotals).toEqual({gold:12,food:9,culture:2}); expect(faction.food).toBe(509);
    faction.gold -= 8; updateResearch(state,10000); expect(researchStatus(state,0).progress).toBe(3);
  });
  it('selects the cheapest eligible project with stable ties and spends surplus across the finite tree', () => {
    const state=fixture(), faction=state.factions[0], total=RESEARCH_BRANCHES.reduce((n,b)=>n+researchCost(faction,b.id),0);
    grantIncome(faction,{gold:(total+10)/.25},state);
    expect(researchStatus(state,0).completed).toBe(false); updateResearch(state,1000);
    expect(researchStatus(state,0)).toMatchObject({completed:true,active:false});
    expect(faction.gold).toBeCloseTo(2000+(total+10)/.25-total);
    expect(state.events.map(e=>e.text.split(': ')[1].split('. ')[0]).reverse()).toEqual(['Fortification', 'Exploration', 'Irrigation', 'Masonry', 'Sailing', 'Grain Storage', 'Statehood', 'Traditional Medicine', 'Archery', 'Coinage', 'Supply train', 'Bronze Working', 'Metal Tools', 'Fletching', 'Military Tactics', 'Infantry Drill', 'Reinforced Defenses', 'Mass levy', 'Urban Planning', 'Siege Engines', 'Horseback Riding']);
    const before=faction.gold; grantIncome(faction,{gold:100},state); expect(faction.gold).toBe(before+100); expect(state.events).toHaveLength(21);
  });
  it('automatically resolves distant prerequisites while preserving ordered priorities and partial progress', () => {
    const state=fixture(), library=state.buildings[1], faction=state.factions[0];
    prioritizeResearch(state,library,'siegeEngines');
    expect(researchStatus(state,0)).toMatchObject({requestedFocus:'siegeEngines',focus:'woodenTower',priorities:['siegeEngines']});
    points(state,3); prioritizeResearch(state,library,'irrigation'); points(state,4);
    expect(faction.research?.progress).toMatchObject({woodenTower:3,irrigation:4});
    prioritizeResearch(state,library,'siegeEngines');
    expect(researchStatus(state,0)).toMatchObject({focus:'woodenTower',progress:3,priorities:['siegeEngines','irrigation']});
    removeResearchPriority(state,library,'siegeEngines');
    expect(researchStatus(state,0)).toMatchObject({focus:'irrigation',progress:4,priorities:['irrigation']});
    points(state,researchCost(faction,'irrigation')-4+2);
    expect(researchStatus(state,0)).toMatchObject({focus:'woodenTower',progress:5,priorities:[]});
    expect(faction.research?.levels.irrigation).toBe(1);
  });
  it('stops at zero allocation, resumes at 100%, and protects against invalid shares', () => {
    const state=fixture(), library=state.buildings[1], faction=state.factions[0];
    expect(setResearchAllocation(state,library,0).ok).toBe(true); grantIncome(faction,{gold:100},state);
    expect(faction.gold).toBe(2100); expect(researchStatus(state,0).progress).toBe(0);
    expect(setResearchAllocation(state,library,1).ok).toBe(true); grantIncome(faction,{gold:3},state); updateResearch(state,30);
    expect(faction.gold).toBe(2100); expect(researchStatus(state,0).progress).toBe(3);
    for(const share of [-.1,1.1,NaN,Infinity]) expect(setResearchAllocation(state,library,share).ok).toBe(false);
    expect(researchStatus(state,0).allocation).toBe(1);
  });
  it.each(['enemy','wrong kind','removed','unfinished','destroyed','distant Leader','dead Leader','hidden Leader','defeated','game over'])('rejects inaccessible controls atomically: %s',reason=>{
    const state=fixture(),library=state.buildings[1];
    if(reason==='enemy') library.faction=1;
    if(reason==='wrong kind') entityStore(state).setBuildingKind(library,'blacksmith');
    if(reason==='removed') entityStore(state).buildings.replace([state.buildings[0]]);
    if(reason==='unfinished') library.construction={startedAt:0,duration:90};
    if(reason==='destroyed') library.hp=0;
    if(reason==='distant Leader') state.units[0].x=25;
    if(reason==='dead Leader') state.units[0].hp=0;
    if(reason==='hidden Leader') state.units[0].inside=true;
    if(reason==='defeated') state.factions[0].defeated=true;
    if(reason==='game over') state.gameOver=true;
    const before=structuredClone(state);
    expect(setResearchAllocation(state,library,.5).ok).toBe(false);
    expect(prioritizeResearch(state,library,'siegeEngines').ok).toBe(false);
    expect(removeResearchPriority(state,library,'wall').ok).toBe(false); expect(state).toEqual(before);
  });
  it('does not multiply receipts with more libraries and pauses automatically on total library loss',()=>{
    const state=fixture(),faction=state.factions[0]; entityStore(state).buildings.add(building(3,'library',20,10));
    points(state,5); expect(researchStatus(state,0).progress).toBe(5);
    state.buildings[1].hp=0; points(state,2); expect(researchStatus(state,0).progress).toBe(7);
    state.buildings[2].hp=0; const treasury=faction.gold; points(state,2);
    expect(faction.gold).toBe(treasury+8); expect(researchStatus(state,0)).toMatchObject({progress:7,library:false,active:false});
    state.buildings[2].hp=250; points(state,researchCost(faction,'woodenTower')-7); expect(faction.research?.levels.woodenTower).toBe(1); expect(researchStatus(state,0)).toMatchObject({focus:'scoutLodge',progress:0});
  });
  it('isolates owners without needing a nearby Leader to receive research income',()=>{
    const state=fixture(), faction=state.factions[0]; state.factions.push({...faction,id:1,relation:'war'});
    entityStore(state).buildings.add(building(3,'library',20,10,1)); state.units[0].x=30;
    grantIncome(state.factions[1],{gold:12},state); updateResearch(state,30); expect(researchStatus(state,1).progress).toBe(3); expect(faction.research).toBeUndefined();
    grantIncome(faction,{gold:20},state); updateResearch(state,30); expect(researchStatus(state,0).progress).toBe(5); expect(researchStatus(state,1).progress).toBe(3);
  });
  it('keeps paused simulation and elapsed time from generating points',()=>{
    const state=fixture(); points(state,3); state.paused=true; const before=structuredClone(state);
    updateGame(state,30,{up:false,down:false,left:false,right:false}); updateResearch(state,1000); expect(state).toEqual(before);
    state.paused=false; updateResearch(state,1000); expect(researchStatus(state,0).progress).toBe(3);
  });
  it('round-trips priorities, shares and partial projects and produces deterministic later receipts',()=>{
    const state=fixture(); prioritizeResearch(state,state.buildings[1],'siegeEngines'); points(state,7);
    prioritizeResearch(state,state.buildings[1],'irrigation'); setResearchAllocation(state,state.buildings[1],.6);
    grantIncome(state.factions[0],{gold:9},state);
    const restored=parseGameSave(serializeGameSave(state));
    expect(restored.factions[0].research).toEqual(state.factions[0].research);
    for(const target of [state,restored]) for(let i=0;i<50;i++){target.time+=1;grantIncome(target.factions[0],{gold:7+i/10},target);updateResearch(target,1);}
    expect(restored.factions[0].research).toEqual(state.factions[0].research); expect(restored.factions[0].gold).toBe(state.factions[0].gold);
    expect(state.factions[0].research!.receipts!.length).toBeLessThanOrEqual(31);
  });
  it('does not divert invalid, negative, food-only, or culture-only receipts',()=>{
    const state=fixture(),faction=state.factions[0];
    for(const gold of [0,-1,Infinity,NaN]) grantIncome(faction,{gold},state);
    grantIncome(faction,{food:5,culture:2},state); expect(faction.gold).toBe(2000); expect(faction.research).toBeUndefined();
  });
});
