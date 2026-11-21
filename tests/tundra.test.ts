import { expect, it } from 'vitest';
import { tundraStartAllowed } from '../src/game/tundra-starts';
import { planStartingSettlement } from '../src/game/settlement-layout';
import { DEFAULT_LANDSCAPE_PARAMETERS } from '../src/world/options';
import { applyTundra } from '../src/world/tundra';
import { climateTreeClass } from '../src/world/tree-climate';
import { vegetationVariant, TREE_FAMILIES } from '../src/game/vegetation-art';
import { generateWorld, normalizePunyWorld } from '../src/world/generator';
import type { World, GameState } from '../src/game/types';
it('creates reproducible polar tundra while preserving water and restricting snow trees', () => {
 const w: World = { width: 80, height: 100, seed: 'polar', source: 'test', spawns: [], tiles: Array.from({length:8000}, () => ({terrain:'grassland',overlay:'forest',elevation:.4,moisture:.5,food:3,production:1,gold:0,variation:.4,treeClass:'snowy'})) };
 w.tiles[0].terrain='lake';
 Object.assign(w.tiles[1], { terrain: 'desert', beach: true, palm: true });
 const b=structuredClone(w);applyTundra(w);applyTundra(b);expect(w).toEqual(b);
 expect(w.tiles[0].terrain).toBe('lake');
 expect(w.tiles[1]).toMatchObject({ terrain: 'tundra', biome: 'tundra' });
 expect(w.tiles[1].beach).toBeUndefined();
 expect(w.tiles[1].palm).toBeUndefined();
 expect(w.tiles.slice(80,560).every(t=>t.terrain==='tundra')).toBe(true);
 expect(w.tiles.slice(7440).every(t=>t.terrain==='tundra')).toBe(true);
 expect(w.tiles.slice(4800,6400).every(t=>t.terrain==='grassland')).toBe(true);
 for(const t of w.tiles) expect(t.treeClass==='snowy').toBe(t.terrain==='tundra');
 expect(climateTreeClass(0,{...w.tiles[80],temperature:.9})).toBe('snowy');
 expect(climateTreeClass(2,{...w.tiles[5000],temperature:0,biome:'alpine'})).toBe('conifer');
 expect(TREE_FAMILIES.snowy).toContain(vegetationVariant(w.tiles[80]));
 expect(TREE_FAMILIES.snowy).not.toContain(vegetationVariant({...w.tiles[5000],treeClass:'snowy'}));
});
it('keeps tundra in a playable generated world and through normalization', () => {
 const w=generateWorld('tundra-1c-north',96,80);const tundra=w.tiles.filter(t=>t.terrain==='tundra');
 expect(tundra.length).toBeGreaterThan(80);
 expect(tundra.some(t=>t.treeClass==='snowy')).toBe(true);
 for(const t of w.tiles) if(t.treeClass==='snowy') expect(t.terrain).toBe('tundra');
 normalizePunyWorld(w);expect(w.tiles.filter(t=>t.terrain==='tundra').length).toBe(tundra.length);
});

it('refreshes fertility and trees in both tundra caps', () => {
 const w: World = { width: 40, height: 40, seed:'tundra-fertility', source:'test', spawns:[], tiles:Array.from({length:1600},()=>({terrain:'grassland',overlay:'forest',elevation:.4,moisture:.5,food:3,production:1,gold:0,variation:.4,fertility:1})) };
 applyTundra(w);
 const tundra = w.tiles.filter(tile => tile.terrain === 'tundra');
 expect(tundra.length).toBeGreaterThan(0);
 for(const t of tundra) {expect(t.fertility).toBe(.25);expect(t.treeClass).toBe('snowy');}
});

it('keeps both polar caps narrow even when the equator is shifted', () => {
 const w:World={width:80,height:100,seed:'two-poles',source:'test',spawns:[],tiles:Array.from({length:8000},()=>({terrain:'grassland',overlay:'none',elevation:.4,moisture:.5,food:3,production:1,gold:0,variation:.4}))};
 applyTundra(w,{...DEFAULT_LANDSCAPE_PARAMETERS,equatorPosition:.85,equatorWidth:.1});
 expect(w.tiles.slice(0,80*7).every(t=>t.terrain==='tundra')).toBe(true);
 expect(w.tiles.slice(80*93).every(t=>t.terrain==='tundra')).toBe(true);
 expect(w.tiles.slice(80*16,80*84).every(t=>t.terrain!=='tundra')).toBe(true);
});
it('allows frontier starts but moves a proposed town out of deep tundra', () => {
 const w:World={width:60,height:60,seed:'polar-starts',source:'test',spawns:[{x:30,y:10}],tiles:Array.from({length:3600},(_,i)=>({terrain:Math.floor(i/60)<20?'tundra':'grassland',overlay:'none',elevation:.4,moisture:.5,food:3,production:1,gold:0,variation:.4}))};
 expect(tundraStartAllowed(w,30,10)).toBe(false);
 expect(tundraStartAllowed(w,30,17)).toBe(false);
 expect(tundraStartAllowed(w,30,18)).toBe(true);
 const state={world:w,buildings:[],units:[],fields:[],factions:[],time:0,tick:0} as unknown as GameState;
 const layout=planStartingSettlement(state,w.spawns[0]);
 expect(layout.palace.y).toBeGreaterThanOrEqual(18);
 expect(tundraStartAllowed(w,layout.palace.x,layout.palace.y)).toBe(true);
});
it.each(['polar-frontier-a','polar-frontier-b','polar-frontier-c'])('keeps every generated starting town out of deep tundra on %s', seed => {
 const w=generateWorld(seed,194,153);
 for(const spawn of [...w.spawns,...w.secondarySpawns??[]]) expect(tundraStartAllowed(w,spawn.x,spawn.y)).toBe(true);
});
