import { expect, it } from 'vitest';
import { applyTundra } from '../src/world/tundra';
import { climateTreeClass } from '../src/world/tree-climate';
import { vegetationVariant, TREE_FAMILIES } from '../src/game/vegetation-art';
import { generateWorld, normalizePunyWorld } from '../src/world/generator';
import type { World } from '../src/game/types';
it('creates reproducible polar tundra while preserving water and restricting snow trees', () => {
 const w: World = { width: 80, height: 100, seed: 'polar', source: 'test', spawns: [], tiles: Array.from({length:8000}, () => ({terrain:'grassland',overlay:'forest',elevation:.4,moisture:.5,food:3,production:1,gold:0,variation:.4,treeClass:'snowy'})) };
 w.tiles[0].terrain='lake'; const b=structuredClone(w);applyTundra(w);applyTundra(b);expect(w).toEqual(b);
 expect(w.tiles[0].terrain).toBe('lake');
 expect(w.tiles.slice(80,800).every(t=>t.terrain==='tundra')).toBe(true);
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

it('keeps entire overlapping ledge aprons on one terrain and refreshes tundra fertility', () => {
 const w: World = { width: 40, height: 40, seed:'tundra-apron', source:'test', spawns:[], tiles:Array.from({length:1600},()=>({terrain:'grassland',overlay:'forest',elevation:.4,moisture:.5,food:3,production:1,gold:0,variation:.4,fertility:1})) };
 for(let y=3;y<=22;y++)for(let x=10;x<=15;x++)w.tiles[y*40+x].ridge=1;
 applyTundra(w);
 const terrain=w.tiles[3*40+10].terrain;
 for(let y=1;y<=24;y++)for(let x=8;x<=17;x++) expect(w.tiles[y*40+x].terrain).toBe(terrain);
 for(const t of w.tiles) if(t.terrain==='tundra') {expect(t.fertility).toBe(.25);expect(t.treeClass).toBe('snowy');}
});
