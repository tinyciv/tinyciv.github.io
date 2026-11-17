import { expect, it } from 'vitest';
import { terrainQuads, tundraEdgeQuads } from '../src/game/terrain';
import type { World } from '../src/game/types';
it('uses native Puny outer rims, seamless interiors and diagonal inner corners',()=>{
 const w={width:3,height:3,tiles:Array.from({length:9},()=>({terrain:'tundra'}))} as World;
 const inner=tundraEdgeQuads(w,1,1);
 expect(inner.map(q=>[q.sx,q.sy])).toEqual([[368,16],[376,16],[368,24],[376,24]]);
 w.tiles[3].terrain='grassland';
 const rim=tundraEdgeQuads(w,1,1);expect(rim[0].sx).toBe(352);expect(rim[2].sx).toBe(352);
 w.tiles[3].terrain='tundra';w.tiles[0].terrain='grassland';
 expect(tundraEdgeQuads(w,1,1)[0]).toMatchObject({sx:400,sy:0});
});

it.each(['plains', 'desert'] as const)('avoids a second green-backed %s rim inside tundra', terrain => {
 const w = {width:5,height:5,seed:'edges',source:'test',spawns:[],tiles:Array.from({length:25},()=>({terrain:'tundra',overlay:'none',elevation:.4,moisture:.5,variation:.4,food:1,production:1,gold:0}))} as World;
 w.tiles[12].terrain=terrain;
 const quads=terrainQuads(w,2,2), center=terrain==='plains'?11*16:23*16;
 expect(quads.map(q=>[q.sx,q.sy])).toEqual([[center,16],[center+8,16],[center,24],[center+8,24]]);
 // Real grassland still gets the original authored transition.
 w.tiles[11].terrain='grassland';
 expect(terrainQuads(w,2,2)[0].sx).toBe(center-16);
 // The tundra side continues to provide the soft rim against the deposit.
 expect(tundraEdgeQuads(w,2,1)[2].sy).not.toBe(24);
});
