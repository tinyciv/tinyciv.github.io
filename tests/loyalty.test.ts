import { describe, expect, it } from 'vitest';
import { initialCityLoyalty, advanceLoyalty, loyaltyTarget, citySupport, loyaltyWarning, recordLoyaltyCasualty, updateCityLoyalty, loyaltyBorderPressure } from '../src/game/loyalty';
import { secedeCity, hasSecededCity } from '../src/game/city-secession';
import { recordCivilianCasualty } from '../src/game/civilian-population';
import { territory } from '../src/game/borders';
import { updateVillages, villageDiplomacyStatus, performVillageAction, villageHostility, villageTradeActive } from '../src/game/villages';
import { villageAlliedWith } from '../src/game/village-relations';
import { palaceDefenses } from '../src/game/palace-capture';
import { updateGame, resolvePalaceCapture, diplomacyAction } from '../src/game/simulation';
import { updateFog } from '../src/game/fog';
import { withPlayerFaction } from '../src/game/player-context';
import { entityStore } from '../src/game/entity-store';
import { loyaltyFixture } from './helpers/loyalty';
const idle = { up: false, down: false, left: false, right: false };

describe('city loyalty balance', () => {
  it('keeps a peaceful first city and isolated new cities viable without a hard city count limit', () => {
    expect(citySupport(undefined)).toBe(0); expect(citySupport(20)).toBe(12); expect(citySupport(80)).toBe(-24);
    for (const distance of [undefined, 100]) {
      const l = initialCityLoyalty(0); l.support = citySupport(distance);
      for (let t = 5; t <= 900; t += 5) advanceLoyalty(l, 5, t);
      expect(l.value).toBeGreaterThan(45); expect(l.target).toBe(distance ? 46 : 70);
    }
  });
  it('gives warnings and several minutes to rescue an encircled, isolated city', () => {
    const l = initialCityLoyalty(0); l.support = -24; l.pressure = 1;
    for (let t = 5; t <= 120; t += 5) advanceLoyalty(l, 5, t);
    expect(l.value).toBeGreaterThan(73);
    let collapse = 0;
    for (let t = 125; t <= 900; t += 5) { advanceLoyalty(l,5,t); if (!l.value) { collapse=t; break; } }
    expect(collapse).toBeGreaterThan(480); expect(collapse).toBeLessThan(600);
    l.value = 35; l.advanced = 3; l.monument = 1; l.guards = 2;
    expect(loyaltyTarget(l)).toBe(21);
    for (let t = 905; t <= 1800; t += 5) advanceLoyalty(l,5,t);
    expect(l.value).toBeGreaterThan(20);
  });
  it('halves recent loss trauma every two minutes and only records real marauder civilian losses', () => {
    const { state, city, worker } = loyaltyFixture();
    worker.hp = 0; expect(recordCivilianCasualty(state, worker)).toBe(true);
    recordLoyaltyCasualty(state, worker, 1); expect(city.loyalty).toBeUndefined();
    recordLoyaltyCasualty(state, worker, -2); expect(city.loyalty?.trauma).toBe(12);
    advanceLoyalty(city.loyalty!,5,120); expect(city.loyalty?.trauma).toBe(6);
    expect(recordCivilianCasualty(state, worker)).toBe(false);
  });
  it('caps monument and advanced bonuses but rewards each complete guard post', () => {
    const { state, city, add } = loyaltyFixture(); add(920,'monument',23,29); add(921,'monument',24,29); add(922,'guardPost',21,32);
    const queued = add(923,'library',24,32); queued.construction = { startedAt: 0, duration:90 };
    updateCityLoyalty(state, c => secedeCity(state,c));
    expect(city.loyalty).toMatchObject({ advanced:1, monument:1, guards:2 });
    const before = city.loyalty!.target; state.time = 1; add(924,'library',25,29); updateCityLoyalty(state,c=>secedeCity(state,c));
    expect(city.loyalty!.target).toBe(before);
    state.time=5; updateCityLoyalty(state,c=>secedeCity(state,c)); expect(city.loyalty!.advanced).toBe(2);
    const l = { ...city.loyalty!, advanced:100, pressure:0, support:0, trauma:0, monument:1, guards:0 };
    expect(loyaltyTarget(l)).toBe(100);
  });
  it('measures actual adjacent foreign borders and clears warnings when recovering', () => {
    const {state,city,other} = loyaltyFixture(); state.buildings.find(b => b.id === 901)!.x = 25; const p = loyaltyBorderPressure(state,[city,other]);
    expect(p.get(city.id)).toBeGreaterThan(0); expect(p.get(other.id)).toBe(0);
    city.loyalty = {...initialCityLoyalty(0), value:40, target:-10, rate:-.2}; expect(loyaltyWarning(city)).toBe(true);
    city.loyalty.rate=.1; expect(loyaltyWarning(city)).toBe(false);
  });
});

describe('city secession and reconquest', () => {
  it('automatically secedes at zero through the scheduled loyalty update', () => {
    const {state,city}=loyaltyFixture(); state.time=5; state.loyaltyUpdatedAt=0;
    city.loyalty={...initialCityLoyalty(0,.1),graceUntil:0,trauma:75,traumaAt:5};
    updateCityLoyalty(state, city=>secedeCity(state,city));
    expect(city.villageId).toBeDefined(); expect(state.villages).toHaveLength(1);
    state.time=10; updateCityLoyalty(state, city=>secedeCity(state,city));
    expect(state.villages).toHaveLength(1);
  });
  it('transfers only the city, its people, fields and defenses, preserving white territory', () => {
    const {state,city,other,worker,defender,retinue,library,wall} = loyaltyFixture();
    const before = territory(state); const cell = city.y * before.width + city.x;
    secedeCity(state,city); const village = state.villages![0], neutral = state.factions.find(f=>f.id===city.faction)!;
    expect(neutral).toMatchObject({color:'#ffffff',population:9,villageId:village.id});
    expect(state.factions[0].population).toBe(4); expect(other.faction).toBe(0); expect(retinue.faction).toBe(0);
    expect([worker,defender,library,wall].every(e=>e.faction===city.faction && e.villageId===village.id)).toBe(true);
    expect(state.fields![0].faction).toBe(city.faction); expect(territory(state).owners[cell]).toBe(city.faction);
    expect(village.secededCity!.territoryCells.length).toBeGreaterThan(20);
    state.time=1000; updateVillages(state); expect(neutral.population).toBe(9); expect(village.destroyed).not.toBe(true);
    expect(palaceDefenses(state,city)).toEqual([]);
  });
  it('offers trade, alliance and war, and changes route and hostility state', () => {
    const {state,city} = loyaltyFixture(); secedeCity(state,city); const village=state.villages![0];
    expect(villageDiplomacyStatus(state,city,true)).toMatchObject({trade:{available:true,cost:250},ally:{available:true,cost:3000},war:{available:true,cost:0}});
    expect(performVillageAction(state,city,'trade',true).ok).toBe(true); expect(villageTradeActive(state,village,0)).toBe(true);
    expect(state.tradeRoutes?.some(route=>route.villageId===village.id)).toBe(true);
    expect(performVillageAction(state,city,'ally',true).ok).toBe(true); expect(villageAlliedWith(village,0)).toBe(true);
    expect(performVillageAction(state,city,'war',true).ok).toBe(true); expect(villageHostility(state,0,city.faction)).toBe(true);
    expect(villageTradeActive(state,village,0)).toBe(false); expect(villageAlliedWith(village,0)).toBe(false);
  });
  it('lets the second multiplayer faction negotiate for itself', () => {
    const {state,city,leader}=loyaltyFixture(); secedeCity(state,city);
    state.multiplayer={humanFactionIds:[0,1],inputs:{},controls:{},winner:null};
    entityStore(state).units.add({...leader,id:990,faction:1}); state.factions[1].gold=10000;
    withPlayerFaction(state,1,()=>{ updateFog(state); expect(diplomacyAction(state,city.faction,'ally',city.id).ok).toBe(true); });
    expect(state.factions[1].gold).toBe(7000); expect(state.factions[0].gold).toBe(10000);
    expect(villageAlliedWith(state.villages![0],1)).toBe(true); expect(villageAlliedWith(state.villages![0],0)).toBe(false);
  });
  it('captures through real projectile combat and restores people, defenses, borders and loyalty', () => {
    const {state,city,leader,guard,library,worker,wall}=loyaltyFixture(); secedeCity(state,city); const neutral=city.faction;
    performVillageAction(state,city,'war',true); city.hp=1;
    state.projectiles=[{start:{x:leader.x,y:leader.y},end:{x:city.x+1,y:city.y+1},x:leader.x,y:leader.y,
      attacker:leader.id,target:city.id,faction:0,damage:100,elapsed:0,duration:.01}];
    updateGame(state,.1,idle); expect(state.palaceCaptures?.length).toBe(1);
    const result=resolvePalaceCapture(state,city.id,true); expect(result.ok).toBe(true);
    expect(state.factions[0].population).toBe(13); expect(state.factions.find(f=>f.id===neutral)?.defeated).toBe(true);
    expect([guard,library,worker,wall].every(e=>e.faction===0 && e.villageId===undefined)).toBe(true);
    expect(guard.hp).toBeGreaterThan(0); expect(result.palace?.loyalty).toMatchObject({value:60,trauma:0});
    expect(territory(state).owners[city.y*state.world.width+city.x]).toBe(0);
    expect(state.villages![0].destroyed).toBe(true);
  });
  it('keeps a surviving Leader in play when their last city secedes', () => {
    const {state,city,other}=loyaltyFixture(); entityStore(state).buildings.retain(b=>b!==other);
    secedeCity(state,city); expect(hasSecededCity(state,0)).toBe(true);
    updateGame(state,.1,idle); expect(state.gameOver).toBe(false);
  });
});
