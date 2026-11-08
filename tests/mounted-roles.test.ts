import { describe, expect, it } from 'vitest';
import { scoutRealm } from './helpers/scouts';
import { entityStore } from '../src/game/entity-store';
import { areHorseArchersUnlocked, areKnightsUnlocked } from '../src/game/research';
import { setMountedFraction, setSoldierRole, retinueComposition, retinueUpkeep, updateArcheryTraining } from '../src/game/archery';
import { moveUnit, updateGame } from '../src/game/simulation';
import { applyGameCommand } from '../src/multiplayer/commands';
import { recolorLightCavalryPixels } from '../src/game/cavalry-art';

function realm() {
  const state = scoutRealm(), faction = state.factions[0];
  const stable = { ...state.buildings[0], id: 102, kind: 'stable' as const, x: 16, y: 12 };
  entityStore(state).buildings.add(stable);
  return { state, faction, stable };
}
describe('light and heavy mounted roles', () => {
  it('requires both technologies and shares the finite retinue allocation', () => {
    const { state, faction, stable } = realm();
    faction.research!.levels.compoundBow = faction.research!.levels.stirrups = 1;
    expect(areHorseArchersUnlocked(faction)).toBe(false); expect(areKnightsUnlocked(faction)).toBe(false);
    expect(setMountedFraction(state, stable, 'knight', .25)).toBe(false);
    faction.research!.levels.horsebackRiding = 1;
    expect(setMountedFraction(state, stable, 'knight', .25)).toBe(true);
    expect(setMountedFraction(state, stable, 'horseArcher', .25)).toBe(true);
    expect(setMountedFraction(state, stable, 'horseman', 1)).toBe(true);
    expect(retinueComposition(state, 0)).toMatchObject({total: 4, knights: 1, horseArchers: 1, horsemen: 2, warriors: 0});
    expect(applyGameCommand(state, 0, {type: 'horse-archers', buildingId: stable.id, fraction: NaN}).ok).toBe(false);
    expect(applyGameCommand(state, 0, {type: 'knights', buildingId: stable.id, fraction: 0}).ok).toBe(true);
  });
  it.each(['horseArcher', 'knight'] as const)('trains %s at a stable, preserving wounds and experience, then demobilizes', role => {
    const { state, faction, stable } = realm();
    Object.assign(faction.research!.levels, {horsebackRiding: 1, compoundBow: 1, stirrups: 1});
    expect(setMountedFraction(state, stable, role, .25)).toBe(true);
    const soldier = state.units.find(u => u.training?.role === role)!;
    soldier.hp = 50; soldier.kills = 12;
    for(let i=0; i<200 && soldier.kind !== role; i++) {state.time += .1; updateArcheryTraining(state,soldier,.1,moveUnit);}
    expect(soldier.kind).toBe(role); expect(soldier.hp / soldier.maxHp!).toBe(.5); expect(soldier.kills).toBe(12);
    expect(retinueUpkeep(soldier)).toBe(role === 'knight' ? 2 : 1.5);
    const hp = role === 'knight' ? 180 : 80;
    expect(soldier.maxHp).toBe(hp); expect(soldier.attack).toBeCloseTo(role === 'knight' ? 42.5 : 13.6);
    expect(soldier.defense).toBe(role === 'knight' ? 10 : 2);
    setMountedFraction(state, stable, role, 0);
    for(let i=0; i<200 && soldier.kind === role; i++) {state.time += .1; updateArcheryTraining(state,soldier,.1,moveUnit);}
    expect(soldier).toMatchObject({kind: 'warrior', hp:50, maxHp:100, attack:17, defense:4});
  });
  it('fires arrows through the real combat loop', () => {
    const { state, faction } = realm(), soldier = state.units[1];
    Object.assign(faction.research!.levels, {horsebackRiding: 1, compoundBow: 1});
    faction.horseArcherFraction = .25;
    entityStore(state).buildings.add({...state.buildings[0], id: 103, kind:'palace', x:8, y:8, capacity:4, governorPermissions:{farms:false,housing:false}});
    setSoldierRole(soldier, 'horseArcher');
    const enemy = {...state.units[2], id: 300, faction: 1, x: 20, y: 20, order:'hold' as const, hp:1000, maxHp:1000};
    entityStore(state).units.add(enemy);
    state.factions.push({...faction,id:1,relation:'war',research:undefined});
    Object.assign(soldier, {x:17, y:20, order:'hold', retinueStance:'hold', joiningRetinue:false});
    for(let i=0;i<12&&!state.projectiles?.some(p=>p.kind==='arrow');i++) updateGame(state,.05,{up:false,down:false,left:false,right:false});
    expect(state.projectiles?.some(p=>p.kind==='arrow'&&p.attacker===soldier.id)).toBe(true);
  });
  it('recolors faction cloth without altering horse, skin or transparency', () => {
    const pixels = new Uint8ClampedArray([0,180,157,255, 0,79,67,255, 109,62,37,255, 0,180,157,0]);
    expect([...recolorLightCavalryPixels(pixels,'#ff0000')]).toEqual([255,0,0,255,133,0,0,255,109,62,37,255,0,180,157,0]);
  });
});
