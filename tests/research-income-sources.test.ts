import { describe, expect, it } from 'vitest';
import { fixture, building, person } from './helpers/research-income';
import { entityStore } from '../src/game/entity-store';
import { updateGame, commandAttackAt } from '../src/game/simulation';
import { DEFAULT_RESEARCH_ALLOCATION, researchStatus, updateResearch } from '../src/game/research';
import { updateTreasureChests } from '../src/game/treasure';
import { updateTradeRoutes, updateMerchant } from '../src/game/trade';
const idle={up:false,down:false,left:false,right:false};
const points=(state: ReturnType<typeof fixture>)=>Object.values(state.factions[0].research?.progress??{}).reduce((a,b)=>a+(b??0),0);

describe('research receives every positive gold source',()=>{
 it('diverts gross population taxes before maintenance, rather than taxing the remaining surplus',()=>{
  const state=fixture(),faction=state.factions[0]; state.units[1].hp=0;
  Object.assign(state.buildings[0],{capacity:20,unhousedResidents:20,governorPermissions:{farms:false,housing:false}});
  entityStore(state).buildings.add({...building(40,'palace',23,15),capacity:4,unhousedResidents:0,governorPermissions:{farms:false,housing:false}});
  // A second empty city costs25, exceeding the twenty-person city's tax receipts.
  state.time=29.9;updateGame(state,.1,idle);
  const gross=faction.incomeTotals?.gold??0; expect(gross).toBe(14); updateResearch(state,1000);
  const science = gross * DEFAULT_RESEARCH_ALLOCATION;
  expect(points(state)).toBeCloseTo(science); expect(faction.gold).toBeCloseTo(2000 + gross - science - 25);
 });
 it('splits a treasure exactly once and leaves its displayed gross value unchanged',()=>{
  const state=fixture(),leader=state.units[0];state.treasures=[{id:1,x:Math.floor(leader.x),y:Math.floor(leader.y),rewardGold:200}];
  updateTreasureChests(state);updateTreasureChests(state); updateResearch(state,1000);
  const science = 200 * DEFAULT_RESEARCH_ALLOCATION;
  expect(state.factions[0].gold).toBeCloseTo(2000 + 200 - science); expect(points(state)).toBeCloseTo(science);
  expect(state.factions[0].incomeTotals?.gold).toBe(200);expect(state.particles.some(p=>p.text==='+200 gold')).toBe(true);
 });
 it.each(['warrior','merchant','marauder leader','building'] as const)('funds research from an actual %s combat bounty',kind=>{
  const state=fixture(),leader=state.units[0],faction=state.factions[0];leader.attack=10000;leader.x=15.5;leader.y=15.5;leader.range=3;
  entityStore(state).units.replace([leader]);
  const enemy=person(99,kind==='merchant'?'merchant':'warrior',16.5,15.5,-2);Object.assign(enemy,{hp:1,maxHp:1,speed:0,attack:0,cooldown:1000,stolenGold:4});
  if(kind==='marauder leader')enemy.marauderLeader=true;
  if(kind==='building') entityStore(state).buildings.add({...building(99,'house',16,15,-2),hp:1});else entityStore(state).units.add(enemy);
  expect(commandAttackAt(state,16.5,15.5)).toBe(true);
  for(let i=0;i<20 && !(faction.incomeTotals?.gold);i++) updateGame(state,.05,idle);
  updateResearch(state,1000);
  const reward=kind==='building'?10:kind==='merchant'?204:kind==='marauder leader'?54:10;
  const science = reward * DEFAULT_RESEARCH_ALLOCATION;
  expect(faction.incomeTotals?.gold).toBe(reward);
  expect(faction.gold).toBeCloseTo(2000 + reward - science); expect(points(state)).toBeCloseTo(science);
 });
 it('uses the same split for completed domestic merchant deliveries',()=>{
  const state=fixture(),faction=state.factions[0];
  entityStore(state).buildings.add(building(40,'palace',24,16));
  for(const palace of state.buildings.filter(b=>b.kind==='palace')){palace.capacity=60;palace.unhousedResidents=60;}
  faction.population=120;updateTradeRoutes(state); const merchant=state.units.find(u=>u.tradeRoute!==undefined)!;
  expect(merchant).toBeDefined();updateMerchant(state,merchant,.1,()=>{});const route=state.tradeRoutes![0],quote=route.legValue!.goldPerSecond;
  expect(quote).toBeGreaterThan(0);updateMerchant(state,merchant,1,(_,u,goal)=>Object.assign(u,goal));
  updateResearch(state,1000);
  const science = quote * DEFAULT_RESEARCH_ALLOCATION;
  expect(route.journeys).toBe(1); expect(faction.incomeTotals?.gold).toBeCloseTo(quote);
  expect(faction.gold).toBeCloseTo(2000 + quote - science); expect(points(state)).toBeCloseTo(science);
  expect(researchStatus(state,0).library).toBe(true);
 });
});
