import { describe, expect, it } from 'vitest';
import { planCamp, validatePlan, CAMP_SIZE_PROFILES, type CampLayout, type CampSize } from '../src/game/warcamp-planner';
import type { World } from '../src/game/types';

function world(width=128,height=96):World {
  return {width,height,seed:'planner-properties',source:'test',spawns:[],tiles:Array.from({length:width*height},()=>({
    terrain:'grassland',overlay:'none',elevation:.3,moisture:.5,food:1,production:0,gold:0,variation:.5,
  }))};
}
const cells=(l:CampLayout)=>[...l.walls,...l.gates,...l.towers,...l.tents,...l.signs,...l.paths];

describe('bounded production warcamp planner',()=>{
  it('returns global coordinates and keeps approach roads close to the camp',()=>{
    const w=world(),anchor={x:91,y:62},options={access:new Float64Array(w.width*w.height)};
    const before=JSON.stringify(w.tiles),plan=planCamp(w,anchor,7,options);
    expect(plan.status).toBe('placed'); expect(plan.checks.valid).toBe(true);
    expect(plan.layout!.size).toBe('large');
    expect(plan.searchBounds!.width).toBeLessThanOrEqual(31);expect(plan.searchBounds!.height).toBeLessThanOrEqual(31);
    expect(plan.layout!.width).toBe(w.width);expect(plan.layout!.height).toBe(w.height);
    expect(cells(plan.layout!).every(p=>p.x>60&&p.y>30)).toBe(true);
    const b=plan.bounds!;
    expect(plan.layout!.paths.every(p=>p.x>=b.x-2&&p.x<b.x+b.width+2&&p.y>=b.y-2&&p.y<b.y+b.height+2)).toBe(true);
    expect(validatePlan(w,plan,options)).toEqual({valid:true,issues:[]});
    expect(JSON.stringify(w.tiles)).toBe(before);
  });

  it('replans around a reserved construction cell and never paves it',()=>{
    const w=world(),anchor={x:80,y:50},base={access:new Float64Array(w.width*w.height)};
    const original=planCamp(w,anchor,5,base);expect(original.status).toBe('placed');
    const reserved=original.layout!.walls[0],blocked=new Set([reserved.y*w.width+reserved.x]);
    const options={...base,blocked},replanned=planCamp(w,anchor,5,options);
    expect(replanned.status).toBe('placed');
    expect(cells(replanned.layout!).every(p=>!blocked.has(p.y*w.width+p.x))).toBe(true);
    expect(validatePlan(w,replanned,options).valid).toBe(true);
  });

  it('keeps a cropped flat plateau walkable by retaining a terrain halo',()=>{
    const w=world();for(const t of w.tiles){t.ridge=7;t.ridgeTier=1;t.elevation=.7;}
    const options={access:new Float64Array(w.width*w.height)},plan=planCamp(w,{x:80,y:50},7,options);
    expect(plan.status).toBe('placed');expect(plan.layout!.tierCount).toBe(4);
    expect(validatePlan(w,plan,options).valid).toBe(true);
  });

  it('does not mistake strategically reachable interior cells for an outside entrance',()=>{
    const w=world(),access=new Float64Array(w.width*w.height).fill(Infinity),anchor={x:80,y:50};
    for(let y=46;y<=54;y++)for(let x=76;x<=84;x++)access[y*w.width+x]=1;
    const plan=planCamp(w,anchor,7,{access});
    expect(plan.status).toBe('rejected');expect(plan.metrics.candidateCount).toBe(150);
    expect(plan.layout).toBeNull();
  });

  it('permits selective woodland clearing only when requested and never mutates tiles',()=>{
    const w=world();for(const t of w.tiles)t.overlay='forest';
    const before=JSON.stringify(w.tiles),anchor={x:80,y:50},access=new Float64Array(w.width*w.height);
    expect(planCamp(w,anchor,7,{access}).status).toBe('rejected');
    const options={access,preserveTrees:false},plan=planCamp(w,anchor,7,options);
    expect(plan.status).toBe('placed');expect(validatePlan(w,plan,options).valid).toBe(true);
    expect(JSON.stringify(w.tiles)).toBe(before);
  });

  it('rejects fully reserved sites in a bounded search without moving terrain',()=>{
    const w=world(),blocked=new Set(Array.from({length:w.width*w.height},(_,i)=>i)),before=JSON.stringify(w.tiles);
    const plan=planCamp(w,{x:80,y:50},7,{blocked,access:new Float64Array(w.width*w.height)});
    expect(plan.status).toBe('rejected');expect(plan.metrics.candidateCount).toBe(150);
    expect(plan.searchBounds).toEqual({x:65,y:35,width:31,height:31});
    expect(JSON.stringify(w.tiles)).toBe(before);
  });
  it('fits independent enclosures along the coast without building over water',()=>{
    const w=world(80,64);for(let y=0;y<w.height;y++)for(let x=45;x<w.width;x++)w.tiles[y*w.width+x].terrain='river';
    const options={access:new Float64Array(w.width*w.height)},plan=planCamp(w,{x:40,y:32},7,options);
    expect(plan.status).toBe('placed');expect(plan.metrics.naturalBarrierTiles).toBe(0);
    expect(cells(plan.layout!).every(p=>w.tiles[p.y*w.width+p.x].terrain!=='river')).toBe(true);
    expect(plan.layout!.gates).toHaveLength(4);expect(plan.layout!.tents.length).toBeGreaterThanOrEqual(10);
    const withoutSigns={...plan,layout:{...plan.layout!,signs:[]}};
    expect(validatePlan(w,withoutSigns,options).valid).toBe(true);
  });

  it.each(['ford','reserved'] as const)('never treats %s water as a natural wall',kind=>{
    const w=world(80,64),blocked=new Set<number>();
    for(let y=0;y<w.height;y++)for(let x=45;x<w.width;x++){
      const k=y*w.width+x;w.tiles[k].terrain='river';
      if(kind==='ford')w.tiles[k].overlay='ford';else blocked.add(k);
    }
    const options={access:new Float64Array(w.width*w.height),blocked},plan=planCamp(w,{x:40,y:32},7,options);
    expect(plan.status).toBe('placed');expect(plan.metrics.naturalBarrierTiles).toBe(0);
    expect(validatePlan(w,plan,options).valid).toBe(true);
  });

  it('does not strand stockades or towers on a detached island along the virtual contour',()=>{
    const w=world(80,64);
    for(let y=0;y<w.height;y++)for(let x=45;x<w.width;x++)w.tiles[y*w.width+x].terrain='river';
    for(let y=28;y<=34;y++)for(let x=47;x<=49;x++)w.tiles[y*w.width+x].terrain='grassland';
    const options={access:new Float64Array(w.width*w.height)},plan=planCamp(w,{x:40,y:32},7,options);
    expect(plan.status).toBe('placed');
    expect([...plan.layout!.walls,...plan.layout!.towers].every(p=>p.x<45)).toBe(true);
    expect(validatePlan(w,plan,options).valid).toBe(true);
  });

});


const sizes:[CampSize,number,number,number,number,number][]=[
  ['small',2,3,5,5,5],['medium',3,6,9,6,6],['large',4,10,18,7,7],
];
describe('small, medium and large camp capacity',()=>{
  it.each(sizes)('%s fits its physical capacity and defensive depth', (size,tiers,minTents,maxTents,minTowers,maxTowers)=>{
    const w=world(80,64),options={size,access:new Float64Array(w.width*w.height)};
    const plan=planCamp(w,{x:43,y:32},7,options),l=plan.layout!;
    expect(plan.status).toBe('placed');expect(l.size).toBe(size);
    expect(l.tierCount).toBe(tiers);expect(l.gates).toHaveLength(tiers);
    expect(l.tents.length).toBeGreaterThanOrEqual(minTents);expect(l.tents.length).toBeLessThanOrEqual(maxTents);
    expect(l.towers.length).toBeGreaterThanOrEqual(minTowers);expect(l.towers.length).toBeLessThanOrEqual(maxTowers);
    expect(l.tents.every(t=>t.tier===0)).toBe(true);
    expect(l.towers.filter(t=>t.tier===1)).toHaveLength(4);
    expect(l.towers.filter(t=>t.tier===1).every(t=>Math.abs(t.x-l.refuge.x)===1&&Math.abs(t.y-l.refuge.y)===1)).toBe(true);
    const wall=new Set([...l.walls,...l.gates].map(p=>p.y*w.width+p.x));
    expect([...wall].some(k=>wall.has(k+1)&&wall.has(k+w.width)&&wall.has(k+w.width+1))).toBe(false);
    expect(validatePlan(w,plan,options)).toEqual({valid:true,issues:[]});
    expect(planCamp(w,{x:43,y:32},7,options)).toEqual(plan);
    expect(CAMP_SIZE_PROFILES[size].tierCount).toBe(tiers);
    expect(CAMP_SIZE_PROFILES[size].minTents).toBe(minTents);expect(CAMP_SIZE_PROFILES[size].maxTents).toBe(maxTents);
  });

  it.each(sizes)('%s preserves real river defenses and reachable entrances', (size,tiers,minTents)=>{
    const w=world(80,64);
    for(let y=0;y<w.height;y++)for(let x=45;x<w.width;x++)w.tiles[y*w.width+x].terrain='river';
    const before=JSON.stringify(w.tiles),options={size,access:new Float64Array(w.width*w.height)};
    const plan=planCamp(w,{x:43,y:32},7,options);
    expect(plan.status).toBe('placed');expect(plan.metrics.naturalBarrierTiles).toBe(0);
    expect(plan.layout!.gates).toHaveLength(tiers);expect(plan.layout!.tents.length).toBeGreaterThanOrEqual(minTents);
    expect(cells(plan.layout!).every(p=>w.tiles[p.y*w.width+p.x].terrain==='grassland')).toBe(true);
    expect(validatePlan(w,plan,options).valid).toBe(true);expect(JSON.stringify(w.tiles)).toBe(before);
  });

  it('rejects a clearing too small for both a refuge and an independent outpost',()=>{
    const w=world(80,64),blocked=new Set<number>();
    for(let y=0;y<w.height;y++)for(let x=0;x<w.width;x++)if(x<36||x>44||y<28||y>36)blocked.add(y*w.width+x);
    for(const size of ['small','medium','large'] as const){
      const plan=planCamp(w,{x:40,y:32},7,{blocked,access:new Float64Array(w.width*w.height),size});
      expect(plan.status).toBe('rejected');expect(plan.metrics.candidateCount).toBeLessThanOrEqual(150);
    }
  });
});
