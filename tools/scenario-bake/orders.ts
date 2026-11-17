import { buildAt,validateBuildAt,refreshAfterBuildingRemoval } from '../../src/game/simulation';
import { removeBuildings } from '../../src/game/construction-cancellation';
import { buildingWidth,buildingHeight,type GameState,type Building,type BuildingKind } from '../../src/game/types';

export function scenarioDitches(state:GameState,kind:BuildingKind,x:number,y:number,faction:number):Building[]{
  return state.buildings.filter(b=>b.kind==='irrigation'&&b.faction===faction&&b.hp>0&&b.x>=x&&b.y>=y&&b.x<x+buildingWidth({kind})&&b.y<y+buildingHeight({kind}));
}
export function purchaseScenarioBuilding(state:GameState,kind:BuildingKind,x:number,y:number,faction:number,clearDitches=kind==='shipyard'):boolean {
  const ditches=clearDitches?scenarioDitches(state,kind,x,y,faction):[];
  if(ditches.length){
    const ids=new Set(ditches.map(b=>b.id)),cleared={...state,buildings:state.buildings.filter(b=>!ids.has(b.id))};
    if(!validateBuildAt(cleared,kind,x,y,faction,undefined,false,true).ok)return false;
    removeBuildings(state,ids);refreshAfterBuildingRemoval(state,faction);
  }
  return buildAt(state,kind,x,y,faction,undefined,undefined,true).ok;
}
export function retireScenarioBuilding(state:GameState,building:Building):void{
  removeBuildings(state,new Set([building.id]));refreshAfterBuildingRemoval(state,building.faction);
}
