import { createGame } from '../src/game/simulation';
import { generateWorld } from '../src/world/generator';
import { describe, it, expect } from 'vitest';
import type { GameState } from '../src/game/types';
import { initializeHermits, hermitAvailable, hermitAt, hermitPosition, askHermit, updateHermits } from '../src/game/hermits';
import { territory, UNCLAIMED } from '../src/game/borders';
import { updateFog } from '../src/game/fog';
import { applyGameCommand } from '../src/multiplayer/commands';
function fixture(): GameState {
    return { world: { width: 160, height: 160, seed: 'treasure-seed', source: 'test', spawns: [],
        tiles: Array.from({ length: 160 * 160 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .5, food: 2, production: 1, gold: 0, variation: .3 })) },
        units: [{ id: 1, kind: 'leader', faction: 0, x: 6.5, y: 6.5, hp: 100, morale: 100, attack: 25, defense: 5, speed: 3.6, range: 4,
            order: 'hold', cooldown: 0, lastCombat: -100, moving: false, facing: 0, attackTime: 0 }],
        buildings: [{ id: 2, kind: 'palace', faction: 0, x: 4, y: 8, hp: 650, maxHp: 650, capacity: 0 },
            { id: 3, kind: 'palace', faction: 1, x: 45, y: 8, hp: 650, maxHp: 650, capacity: 0 }],
        factions: [{ id: 0, name: 'Player', color: '#00f', affinity: 100, relation: 'self', food: 50, gold: 50, production: 0,
            population: 10, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1000, defeated: false }],
        raiderCamps: [{ id: 10, size: 'small', name: 'Raiders', x: 22, y: 26, width: 7, height: 7, gate: { x: 25, y: 32 }, houses: [], nextRaidAt: 1000, waves: 0 }],
        time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
        buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'treasure-seed', rngState: 123 };
}


describe('hermits', () => {
 it('populates a generated world', () => {
  const s=createGame(generateWorld('hermit-wilderness'));
  expect(s.hermits!.length).toBeGreaterThan(0);
 }, 120000);
 it('seeds deterministic, noncombat encounters at least 60 tiles outside every faction border', () => {
  const a=fixture(), b=fixture(); initializeHermits(a); initializeHermits(b);
  expect(a.hermits).toEqual(b.hermits); expect(a.hermits!.length).toBeGreaterThan(0);
  const owners=territory(a).owners;
  for(const h of a.hermits!) {
   for(let cell=0;cell<owners.length;cell++) if(owners[cell]!==UNCLAIMED)
    expect(Math.hypot(h.x-cell%160,h.y-Math.floor(cell/160))).toBeGreaterThanOrEqual(60);
  }
  expect(a.units).toHaveLength(1); expect(a.buildings).toHaveLength(2);
  a.hermits![0].status='gone'; const count=a.hermits!.length; initializeHermits(a);
  expect(a.hermits!.length).toBe(count); expect(a.hermits![0].status).toBe('gone');
 });
 it('requires a living nearby leader and 25 gold; hints do not reveal terrain', () => {
  const s=fixture();s.hermits=[{id:1,x:9,y:5,status:'home'}];const h=s.hermits[0];
  s.units[0].x=10;s.units[0].y=6;updateFog(s);
  expect(hermitAvailable(s,h)).toBe(true);expect(hermitAt(s,hermitPosition(h))).toBe(h);
  const explored=updateFog(s).explored.slice();
  const result=askHermit(s,1);expect(result.ok).toBe(true);expect(result.message).toMatch(/banner/);expect(result.message).toMatch(/wolves/);
  expect(s.factions[0].gold).toBe(25);expect(updateFog(s).explored).toEqual(explored);
  s.factions[0].gold=24;expect(askHermit(s,1).ok).toBe(false);expect(s.factions[0].gold).toBe(24);
  s.units[0].hp=0;expect(hermitAvailable(s,h)).toBe(false);expect(askHermit(s,1).ok).toBe(false);
 });
 it('uses authoritative purchase validation for multiplayer commands', () => {
  const s=fixture();s.hermits=[{id:1,x:9,y:5,status:'home'}];s.units[0].x=10;s.units[0].y=6;
  expect(applyGameCommand(s,0,{type:'hermit',hermitId:1}).hermitRumor).toBeTruthy();
  expect(s.factions[0].gold).toBe(25);
  expect(applyGameCommand(s,0,{type:'hermit',hermitId:'1'}).ok).toBe(false);
 });
 it('flees on a traversable route when claimed, disappears into fog, and never returns', () => {
  const s=fixture();s.hermits=[{id:1,x:8,y:9,status:'home'}];s.units[0].x=10;s.units[0].y=10;
  const h=s.hermits[0];expect(territory(s).owners[h.y*160+h.x]).not.toBe(UNCLAIMED);
  updateHermits(s,.1);expect(h.status).toBe('fleeing');expect(askHermit(s,1).ok).toBe(false);
  for(let i=0;i<400 && h.status!=='gone';i++){s.time+=.1;updateHermits(s,.1);}
  expect(h.status).toBe('gone');const p={...h.position!};updateHermits(s,1);initializeHermits(s);
  expect(h.status).toBe('gone');expect(h.position).toEqual(p);expect(hermitAt(s,p!)).toBeUndefined();
 });
});
