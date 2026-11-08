import { describe, expect, it } from 'vitest';
import { type GameState, type Unit, isSoldier, isRetinueMember } from '../src/game/types';
import { levyPopulation, setLevySlingerFraction, levySlingerFraction, dismissLevy, updateMassLevy, recordLevyCasualty, SLINGER_ATTACK } from '../src/game/mass-levy';
import { civilianWorkforcePopulations } from '../src/game/civilian-population';
import { applyGameCommand } from '../src/multiplayer/commands';
import { updateGame } from '../src/game/simulation';
import { entityStore } from '../src/game/entity-store';
const idle = { up: false, down: false, left: false, right: false };
function unit(id: number, kind: Unit['kind'] = 'worker', faction = 0): Unit {
  return { id, kind, faction, x: 12 + id % 4, y: 12 + Math.floor(id / 4) % 4, hp: 50, maxHp: 50, attack: 0, defense: 0,
    morale: 100, speed: 2.2, range: 1.1, order: kind === 'worker' ? 'work' : 'follow', cooldown: 0, lastCombat: -60,
    moving: false, facing: 0, attackTime: 0, home: 100, collector: kind === 'worker', collectorCamp: 100 };
}
function fixture(): GameState {
  return {
    world: { width: 40, height: 40, seed: 'levy-supply', source: 'test', spawns: [], tiles: Array.from({ length: 1600 }, () =>
      ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .6, food: 3, production: 1, gold: 0, variation: .5 })) },
    units: [unit(1, 'leader'), ...Array.from({ length: 9 }, (_, i) => unit(i + 2))],
    buildings: [{ id: 100, kind: 'palace', faction: 0, x: 8, y: 8, hp: 650, maxHp: 650, capacity: 30, unhousedResidents: 9, governorPermissions: { farms: false, housing: false } },
      { id: 101, kind: 'supplyDepot', faction: 0, x: 10, y: 10, hp: 200, maxHp: 200, capacity: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 100, production: 0, population: 9,
      yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1e9, nextRetinueAt: 1e9, defeated: false,
      research: { focus: 'massLevy', levels: { supplyTrain: 1, massLevy: 1, infantryDrill: 1 }, progress: {} } }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'levy-supply', rngState: 1,
    fields: [], raiderCamps: [], marauderPacks: [], villages: [], fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 1 },
  };
}

function ready() {
 const s=fixture(); s.factions[0].gold=1000;
 Object.assign(s.buildings[0],{palaceLevel:2});
 Object.assign(s.units[0],{x:10,y:10});
 return s;
}
describe('slinger levy',()=>{
 it('requires a completed owned Keep, research, nearby Leader and valid fraction',()=>{
  const s=ready(), b=s.buildings[0];
  b.palaceLevel=1; expect(setLevySlingerFraction(s,b,.5)).toBe(false);
  b.palaceLevel=2; delete s.factions[0].research!.levels.massLevy;
  expect(setLevySlingerFraction(s,b,.5)).toBe(false);
  s.factions[0].research!.levels.massLevy=1;
  for(const n of [NaN,Infinity,-.1,1.1]) expect(setLevySlingerFraction(s,b,n)).toBe(false);
  expect(setLevySlingerFraction(s,b,.5)).toBe(true);
  s.units[0].x=35; expect(setLevySlingerFraction(s,b,.8)).toBe(false);
  b.hp=0; expect(levySlingerFraction(s)).toBe(0);
 });
 it('drafts a mixed roster, preserves wounds and restores civilian roles on dismissal',()=>{
  const s=ready(); s.units[1].hp=25;
  expect(setLevySlingerFraction(s,s.buildings[0],.67)).toBe(true);
  expect(levyPopulation(s).count).toBe(3);
  const slingers=s.units.filter(u=>u.kind==='slinger');
  expect(slingers).toHaveLength(2);
  expect(slingers[0]).toMatchObject({defense:1,maxHp:40,hp:20,range:4});
  expect(slingers[0].attack).toBeCloseTo(10.2);
  expect(SLINGER_ATTACK).toBeCloseTo(17*.8*.75);
  expect(isSoldier(slingers[0])).toBe(true); expect(isRetinueMember(slingers[0])).toBe(false);
  expect(s.units.filter(u=>u.kind==='levyInfantry')).toHaveLength(1);
  expect(civilianWorkforcePopulations(s).get(100)).toBe(6);
  s.time=30; updateMassLevy(s); expect(s.factions[0].gold).toBe(940);
  expect(dismissLevy(s).ok).toBe(true); expect(slingers[0]).toMatchObject({kind:'worker',maxHp:50,hp:25});
 });
 it('validates multiplayer composition and removes slain slingers from population once',()=>{
  const s=ready();
  expect(applyGameCommand(s,0,{type:'levy-composition',buildingId:100,fraction:1}).ok).toBe(true);
  levyPopulation(s); const u=s.units.find(u=>u.kind==='slinger')!;u.hp=0;
  expect(recordLevyCasualty(s,u)).toBe(true); expect(recordLevyCasualty(s,u)).toBe(false);
  expect(s.factions[0].population).toBe(8);
 });
 it('fires stone projectiles in the real combat loop',()=>{
  const s=ready();setLevySlingerFraction(s,s.buildings[0],1);levyPopulation(s,1);
  const u=s.units.find(u=>u.kind==='slinger')!;
  Object.assign(u,{x:20,y:20,order:'hold',retinueStance:'hold',joiningRetinue:false});
  const enemy={...unit(200,'warrior',1),x:23,y:20,hp:100,maxHp:100,attack:0,order:'hold' as const};
  s.factions.push({...structuredClone(s.factions[0]),id:1,relation:'war',population:0});
  entityStore(s).units.add(enemy);
  for(let i=0;i<10&&!s.projectiles?.some(p=>p.kind==='stone');i++)updateGame(s,.05,idle);
  expect(s.projectiles?.some(p=>p.kind==='stone'&&p.attacker===u.id)).toBe(true);
 });
});
