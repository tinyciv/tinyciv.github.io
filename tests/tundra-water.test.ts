import { expect, it } from 'vitest';
import { tundraWaterMask } from '../src/game/tundra-water';
import { rasterTerrain, waterArtKey } from '../src/game/terrain';
import { punyAtlas } from './puny-atlas';
import type { World } from '../src/game/types';
const world=(): World=>({width:5,height:5,seed:'cold-river',source:'test',spawns:[],revision:0,tiles:Array.from({length:25},(_,i)=>({terrain:i%5===2?'river':'tundra',overlay:'none',elevation:.4,moisture:.5,food:0,gold:0,production:0,variation:.2,riverArt:i%5===2?'banked':undefined}))});
it('follows each bank at mixed-biome river crossings and invalidates cached decisions',()=>{
 const w=world();expect(tundraWaterMask(w,2,2)).toBe(15);const before=waterArtKey(w,2,2);
 for(let y=0;y<5;y++)for(let x=3;x<5;x++)w.tiles[y*5+x].terrain='grassland';w.revision!++;
 expect(tundraWaterMask(w,2,2)).toBe(5);expect(waterArtKey(w,2,2)).not.toBe(before);
 for(const t of w.tiles)if(t.terrain==='tundra')t.terrain='grassland';w.revision!++;
 expect(tundraWaterMask(w,2,2)).toBe(0);
});
it('recolors ground in every river and waterfall frame without changing water pixels or masks',()=>{
 const w=world(),source=punyAtlas();const data=new Uint8ClampedArray(48*48*4);
 for(let i=0;i<data.length;i+=4)data.set([148,169,157,255],i);
 const tundra={width:48,height:48,data};
 for(const waterfall of [undefined,'south'] as const)for(let frame=0;frame<4;frame++){
  w.tiles[12].waterfall=waterfall;
  const plain=rasterTerrain(w,{x:2,y:2,width:1,height:1},source,undefined,undefined,frame);
  const cold=rasterTerrain(w,{x:2,y:2,width:1,height:1},source,undefined,undefined,frame,tundra);
  expect(cold.water).toEqual(plain.water);let changed=0;
  for(let i=0;i<256;i++){
   const a=plain.pixels.slice(i*4,i*4+4),b=cold.pixels.slice(i*4,i*4+4);
   if(a[1]>a[0]+20 && a[2]>a[0]+20)expect(b).toEqual(a);
   if(a.some((v,k)=>v!==b[k]))changed++;
  }
  expect(changed).toBeGreaterThan(0);
 }
});
