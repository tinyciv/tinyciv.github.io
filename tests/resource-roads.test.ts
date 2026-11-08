import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { buildingOverlapsVillageBorders } from '../src/game/border-placement';
import { setForbiddenRectangle } from '../src/game/forbidden-zones';
import { validateNetworkPlacement } from '../src/game/network-placement';
import { buildResourceRoadTile, planResourceRoad, resourceRoadJourney, resourceRoadTileReady } from '../src/game/resource-roads';
import { southernResourceCell } from '../src/game/resource-worksite';
import { type Building, type GameState, type Point, type Unit } from '../src/game/types';

function fixture() {
  const city: Building = {id:1,kind:'palace',faction:0,x:3,y:8,hp:650,maxHp:650,capacity:20,unhousedResidents:20};
  const state = {world:{width:30,height:20,revision:0,seed:'resource-roads',source:'test',spawns:[],
    tiles:Array.from({length:600},()=>({terrain:'grassland',overlay:'none',elevation:.4,moisture:.4,food:3,gold:0,production:1,variation:.3}))},
    buildings:[city],units:[],fields:[],factions:[{id:0,name:'Test',relation:'self',population:20,gold:300,food:100,defeated:false}],
    time:0,tick:0,events:[],particles:[],seed:'resource-roads',rngState:1} as unknown as GameState;
  const cells=[12+8*30,13+8*30,12+9*30,13+9*30];
  cells.forEach(cell=>Object.assign(state.world.tiles[cell],{resource:'copper',resourceGroup:1,resourceDeveloped:true}));
  const worker:Unit={id:90,kind:'worker',faction:0,home:1,x:0,y:0,hp:50,maxHp:50,morale:100,attack:0,defense:0,speed:2.2,range:1,
    order:'work',cooldown:0,lastCombat:-60,moving:false,facing:0,attackTime:0};
  entityStore(state).units.add(worker);
  return{state,city,cells,worker};
}
const at=(point:Point)=>[Math.floor(point.x),Math.floor(point.y)].join(',');

describe('civilian resource access roads',()=>{
  it('plans a connected cardinal road to the southmost mine without placing it remotely or charging extra gold',()=>{
    const {state,cells,worker}=fixture(), journey=planResourceRoad(state,0,cells)!;
    const anchor=southernResourceCell(cells,30)!;
    expect(journey).toBeDefined();expect(journey.home).toBe(1);
    expect(journey.goal).toEqual({x:anchor%30+.5,y:Math.floor(anchor/30)+1.5});
    expect(state.buildings).toHaveLength(1);
    expect(buildResourceRoadTile(state,worker,journey.roadCells[0])).toBe(false);
    for(let i=0;i<journey.path.length;i++){
      const point=journey.path[i];
      if(i)expect(Math.abs(point.x-journey.path[i-1].x)+Math.abs(point.y-journey.path[i-1].y)).toBe(1);
      expect(cells).not.toContain(Math.floor(point.y)*30+Math.floor(point.x));
      Object.assign(worker,point);
      expect(validateNetworkPlacement(state,'road',point.x,point.y,0).ok).toBe(true);
      expect(buildResourceRoadTile(state,worker,point)).toBe(true);
    }
    const count=state.buildings.length;
    expect(buildResourceRoadTile(state,worker,journey.goal)).toBe(true);
    expect(state.buildings).toHaveLength(count);
    expect(state.factions[0].gold).toBe(300);
    expect(cells.every(cell=>state.world.tiles[cell].resource==='copper')).toBe(true);
  });

  it('routes around fields, occupied buildings and forbidden cells while preserving trees',()=>{
    const {state,city,cells,worker}=fixture();
    entityStore(state).buildings.add({...city,id:2,kind:'house',x:8,y:10,capacity:4});
    state.fields=[{id:20,camp:20,faction:0,x:7,y:10,planted:true,food:4,nextHarvest:30}];
    setForbiddenRectangle(state,{x:9,y:10},{x:10,y:10},true);
    const journey=resourceRoadJourney(state,city,cells)!;
    expect(journey).toBeDefined();
    expect(journey.path.map(at)).not.toContain('8,10');expect(journey.path.map(at)).not.toContain('7,10');
    expect(journey.path.map(at)).not.toContain('9,10');expect(journey.path.map(at)).not.toContain('10,10');
    const point=journey.path[1],tile=state.world.tiles[Math.floor(point.y)*30+Math.floor(point.x)];
    tile.overlay='forest';tile.palm=true;
    Object.assign(worker,point);expect(buildResourceRoadTile(state,worker,point)).toBe(true);
    expect(tile.overlay).toBe('forest');expect(tile.palm).toBe(true);expect(state.fields[0].food).toBe(4);
  });

  it('reuses bridges and existing gates, but never creates water crossings or opens a closed wall',()=>{
    const {state,city,cells,worker}=fixture();
    for(let y=0;y<20;y++)state.world.tiles[y*30+8].terrain='river';
    expect(resourceRoadJourney(state,city,cells)).toBeUndefined();
    entityStore(state).buildings.add({...city,id:30,kind:'bridge',x:8,y:10,capacity:0});
    let journey=resourceRoadJourney(state,city,cells)!;
    expect(journey).toBeDefined();expect(journey.path.map(at)).toContain('8,10');
    Object.assign(worker,{x:8.5,y:10.5});
    expect(resourceRoadTileReady(state,0,worker)).toBe(true);expect(buildResourceRoadTile(state,worker,worker)).toBe(true);
    expect(state.buildings.filter(b=>b.x===8&&b.y===10)).toHaveLength(1);
    for(let y=0;y<20;y++)entityStore(state).buildings.add({...city,id:50+y,kind:'wall',x:10,y,capacity:0});
    expect(resourceRoadJourney(state,city,cells)).toBeUndefined();
    entityStore(state).buildings.add({...city,id:80,kind:'road',x:10,y:10,capacity:0});
    journey=resourceRoadJourney(state,city,cells)!;
    expect(journey).toBeDefined();expect(journey.path.map(at)).toContain('10,10');
  });

  it('preserves neutral village reservations in both the route search and live placement',()=>{
    const {state,city,cells,worker}=fixture();
    state.factions.push({...state.factions[0],id:1,name:'Village',relation:'peace',population:3,villageId:1});
    state.villages=[{id:1,faction:1,campId:100,name:'Village',identity:'growers',relation:'neutral',x:8,y:10,
      nextGrowthAt:90,nextThinkAt:0,nextRecruitAt:90}];
    entityStore(state).buildings.add({...city,id:100,kind:'villageTent',x:8,y:10,faction:1,villageId:1});
    const journey=resourceRoadJourney(state,city,cells)!;
    expect(journey).toBeDefined();
    for(const point of journey.roadCells)expect(buildingOverlapsVillageBorders(state,'road',Math.floor(point.x),Math.floor(point.y),0)).toBe(false);
    Object.assign(worker,{x:9.5,y:10.5});
    expect(buildResourceRoadTile(state,worker,worker)).toBe(false);
  });

  it('rechecks occupancy, crops, and resource cells at construction time',()=>{
    const {state,city,cells,worker}=fixture(),journey=resourceRoadJourney(state,city,cells)!;
    const target=journey.path[1],x=Math.floor(target.x),y=Math.floor(target.y);
    Object.assign(worker,target);
    const house={...city,id:3,kind:'house' as const,x,y,capacity:4};entityStore(state).buildings.add(house);
    expect(buildResourceRoadTile(state,worker,target)).toBe(false);
    expect(state.buildings.filter(b=>b.kind==='road')).toHaveLength(0);
    house.hp=0;
    state.fields=[{id:20,camp:20,faction:0,x,y,planted:true,food:4,nextHarvest:30}];
    expect(buildResourceRoadTile(state,worker,target)).toBe(false);
    state.fields=[];state.world.tiles[y*30+x].resource='stone';
    expect(buildResourceRoadTile(state,worker,target)).toBe(false);
    expect(state.world.tiles[y*30+x].resource).toBe('stone');
  });

  it('chooses the nearest inhabited friendly settlement and ignores empty or hostile origins',()=>{
    const {state,city,cells}=fixture();
    const near={...city,id:2,x:15,y:10,unhousedResidents:5};
    entityStore(state).buildings.add(near,{...city,id:3,x:12,y:12,faction:1,unhousedResidents:10});
    state.factions[0].population=25;
    expect(planResourceRoad(state,0,cells)?.home).toBe(2);
    near.unhousedResidents=0;state.factions[0].population=20;
    expect(planResourceRoad(state,0,cells)?.home).toBe(1);
    expect(planResourceRoad(state,2,cells)).toBeUndefined();
  });

  it('keeps proposed junctions legal when joining a dense existing network',()=>{
    const {state,city,cells,worker}=fixture();
    for(let x=5;x<11;x++)entityStore(state).buildings.add({...city,id:30+x,kind:'road',x,y:9,capacity:0});
    for(let y=6;y<13;y++)if(y!==9)entityStore(state).buildings.add({...city,id:50+y,kind:'road',x:7,y,capacity:0});
    const journey=resourceRoadJourney(state,city,cells)!;expect(journey).toBeDefined();
    for(const point of journey.roadCells){Object.assign(worker,point);expect(buildResourceRoadTile(state,worker,point)).toBe(true);}
    const roads=state.buildings.filter(b=>b.kind==='road');
    expect(new Set(roads.map(b=>`${b.x},${b.y}`)).size).toBe(roads.length);
  });
});
