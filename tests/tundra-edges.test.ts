import { expect, it } from 'vitest';
import { terrainQuads } from '../src/game/terrain';
import type { World } from '../src/game/types';

it.each(['plains', 'desert'] as const)('avoids a second green-backed %s rim inside tundra', terrain => {
 const w = {width:5,height:5,seed:'edges',source:'test',spawns:[],tiles:Array.from({length:25},()=>({terrain:'tundra',overlay:'none',elevation:.4,moisture:.5,variation:.4,food:1,production:1,gold:0}))} as World;
 w.tiles[12].terrain=terrain;
 const quads=terrainQuads(w,2,2), center=terrain==='plains'?11*16:23*16;
 expect(quads.map(q=>[q.sx,q.sy])).toEqual([[center,16],[center+8,16],[center,24],[center+8,24]]);
 // Real grassland still gets the original authored transition.
 w.tiles[11].terrain='grassland';
 expect(terrainQuads(w,2,2)[0].sx).toBe(center-16);
});
