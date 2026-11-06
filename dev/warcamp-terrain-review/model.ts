import type { World, Point } from '../../src/game/types';
import { planCamp, type AdaptiveCampPlan } from '../../src/game/warcamp-planner';
export { planCamp, validatePlan, isBuildable } from '../../src/game/warcamp-planner';
export type { AdaptiveCampPlan, CampPlanningOptions } from '../../src/game/warcamp-planner';
export interface ReviewCase { id:string;name:string;description:string;world:World;plan:AdaptiveCampPlan }
const noise=(x:number,y:number,s:number)=>{let n=Math.imul(x+s*131,374761393)^Math.imul(y+719,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967296;};
function scenario(kind:number,seed:number):{world:World;anchor:Point;name:string;description:string}{
  const width=39,height=33,tiles:World['tiles']=[];
  const shift=(seed%3)-1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const t:World['tiles'][number]={terrain:'grassland',overlay:'none',elevation:.3,moisture:.55,food:1,production:0,gold:0,variation:noise(x,y,seed)};
    if(kind===0){const bank=26+Math.round(3*Math.sin((y+shift)/7));if(x>=bank){t.terrain=x>bank+2?'river':'river';t.elevation=.05;t.channel='main';t.channelWidth=5;}if(x>bank+6){t.terrain='grassland';t.elevation=.3;}}
    if(kind===1){const left=4+(y<10?2:0),right=30-(y>23?4:0);if(x>=left&&x<=right&&y>=4&&y<=28){t.ridge=1;t.ridgeTier=1;t.relief='hills';t.elevation=.65;}if(t.ridge&&x>=25&&y<15){t.ridgeTier=2;t.relief='mountains';t.elevation=.85;}if(x===17&&y===28)t.stair='north';}
    if(kind===2){const coast=29+Math.round(2*Math.sin((x+shift)/5));if(y>=coast){t.terrain=y>coast+2?'ocean':'coast';t.elevation=.02;}if(y<=10||(x<7&&y<15)||(x>27&&y<18)){t.ridge=2;t.ridgeTier=1;t.relief='hills';t.elevation=.65;}if(y<5&&x>8&&x<25&&noise(x,y,seed)>.5)t.overlay='forest';}
    if(kind===3){const center=19+Math.round(2*Math.sin(y/4));if(Math.abs(x-center)>0){t.terrain='lake';t.elevation=.03;}else if(y%5===0&&x===center+3)t.overlay='forest';}
    if(kind<3&&x<3&&y>5&&y<26&&noise(x,y,seed)>.5)t.overlay='forest';
    tiles.push(t);
  }
  const data=[{anchor:{x:17,y:16},name:'River bend',description:'The outer ward must fit the curved bank while keeping a landward entrance.'},{anchor:{x:18,y:16},name:'Raised bench',description:'Three wards sit on the usable plateau floor. The existing southern stair remains the route in.'},{anchor:{x:18,y:18},name:'Coastal pocket',description:'An elongated footprint fits between rocky shoulders and the shoreline.'},{anchor:{x:19,y:16},name:'Narrow isthmus',description:'A single-file causeway cannot hold tent plots while preserving the route through three defended wards.'}][kind];
  return{world:{width,height,seed:`terrain-camp-${seed}-${kind}`,source:'terrain-adaptation study',spawns:[],tiles},...data};
}
export function buildReview(seed=1):ReviewCase[]{return[0,1,2,3].map(kind=>{const s=scenario(kind,seed);return{id:`terrain-${kind}`,name:s.name,description:s.description,world:s.world,plan:planCamp(s.world,s.anchor,seed+kind*7)};});}
