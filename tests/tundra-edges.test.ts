import { expect, it } from 'vitest';
import { tundraEdgeQuads } from '../src/game/terrain';
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
