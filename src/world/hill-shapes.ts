import type { Point } from '../game/types';
const DIRS=[[1,0],[-1,0],[0,1],[0,-1]] as const;
export interface HillShape {name:string;points:Point[]}
/** Approved varied contours; the native relief builder constructs shelves and ramps. */
export function hillShape(random:()=>number,landmark=false,size=1):HillShape{
  const kind=landmark?[0,1,6][Math.floor(random()*3)]:Math.floor(random()*7),band=random();
  const stretch=(landmark?1.8+random()*.55:band<.25?.7+random()*.2:band<.72?1+random()*.35:1.65+random()*.55)*size;
  const angle=Math.floor(random()*8)*Math.PI/4,mirror=random()<.5?-1:1;
  const cosine=Math.cos(angle),sine=Math.sin(angle),points:Point[]=[];
  const rect=(x:number,y:number,l:number,t:number,r:number,b:number)=>x>=l&&x<=r&&y>=t&&y<=b;
  const ellipse=(x:number,y:number,cx:number,cy:number,rx:number,ry:number)=>(x-cx)**2/rx**2+(y-cy)**2/ry**2<=1;
  for(let y=-25;y<=25;y++)for(let x=-25;x<=25;x++){
    const u=(x*cosine+y*sine)/stretch*mirror,v=(-x*sine+y*cosine)/stretch;
    let on=false;
    if(kind===0)on=ellipse(u,v,0,0,3.1,2.6);
    if(kind===1)on=ellipse(u,v,-1.5,-.4,2.8,2.6)||ellipse(u,v,1.7,.8,2.8,2.5);
    if(kind===2)on=rect(u,v,-3.8,-4.3,-.3,4.3)||rect(u,v,-3.8,1.1,4.1,4.3);
    if(kind===3)on=rect(u,v,-4.1,-4.2,-.6,4.2)||rect(u,v,-4.1,-4.2,3.7,-.8)||rect(u,v,-4.1,.8,2.8,4.2);
    if(kind===4)on=rect(u,v,-5.3,-1.8,5.3,1.8)||rect(u,v,-1.7,-2.7,1.7,2.7);
    if(kind===5)on=rect(u,v,-4.8,-3.7,1.2,-.2)||rect(u,v,-1.9,-3.7,1.2,3.7)||rect(u,v,-1.9,.2,4.8,3.7);
    if(kind===6)on=ellipse(u,v,0,0,3.7,3.4)&&!(u>1.2&&v<-.5);
    if(on)points.push({x,y});
  }
  // Native edge art needs complete2×2 support. Match the production safety rule.
  const keys=new Set(points.map(p=>`${p.x},${p.y}`));
  const supported=points.filter(p=>[-1,0].some(dx=>[-1,0].some(dy=>[[0,0],[1,0],[0,1],[1,1]].every(([ox,oy])=>keys.has(`${p.x+dx+ox},${p.y+dy+oy}`)))));
  return{name:['rounded','lobed','hook','crescent','spine','offset','notched'][kind],points:supported};
}
export function hillFloorConnected(points:Point[]):boolean{
  const keys=new Set(points.map(p=>`${p.x},${p.y}`));
  const floors=points.filter(p=>[-1,0,1].every(dx=>[-1,0,1].every(dy=>keys.has(`${p.x+dx},${p.y+dy}`))));
  if(floors.length<3)return false;
  const floorKeys=new Set(floors.map(p=>`${p.x},${p.y}`)),seen=new Set<string>(),q=[floors[0]];seen.add(`${q[0].x},${q[0].y}`);
  for(let h=0;h<q.length;h++)for(const[dx,dy]of DIRS){const p={x:q[h].x+dx,y:q[h].y+dy},key=`${p.x},${p.y}`;if(floorKeys.has(key)&&!seen.has(key)){seen.add(key);q.push(p);}}
  return seen.size===floors.length;
}
