import { rustEngine } from './rust-engine';
import { SimSlot, simCore } from './sim-handle';
import { scenarioAccessTerrain } from './pathfinding';
import { reliefFootprintAllowed } from './relief';
import { entityStore, BUILDING_KIND_CODES, type EntityStore, type EntityObserver } from './entity-store';
import { observeScalars, type ScalarObserver } from './scalar-observer';
import { buildingWidth, buildingHeight, buildingReady, isFarmKind, type Building, type BuildingKind, type GameState, type Point } from './types';

const bridges = new SimSlot<AccessBridge>();
class AccessBridge implements ScalarObserver {
  readonly handle: number;
  readonly store: EntityStore;
  private terrain = -1;
  private dirty = new Set<Building>();
  private readonly observer: EntityObserver<Building>;
  constructor(state: GameState) {
    this.handle = simCore(state).handle; this.store = entityStore(state);
    rustEngine.sim_scenario_access_reset(this.handle);
    this.observer = { added: b => this.track(b), changed: b => this.track(b), removed: b => this.dirty.add(b) };
    this.store.buildings.observe(this.observer);
    for (const b of state.buildings) this.track(b);
  }
  private track(b: Building): void {
    this.dirty.add(b);
    observeScalars(b,['kind','x','y','hp','construction'],this);
  }
  changed(_target: object,key: string,before: unknown,after: unknown): void {
    if (key !== 'hp' || (Number(before)>0) !== (Number(after)>0)) this.dirty.add(_target as Building);
  }
  input(values: readonly number[]): void {
    const pointer = rustEngine.sim_scenario_access_input(this.handle,values.length);
    new Float64Array(rustEngine.memory.buffer,pointer,values.length).set(values);
  }
  flush(state: GameState): this {
    const terrain = scenarioAccessTerrain(state.world);
    if (terrain.version !== this.terrain) {
      const pointer = rustEngine.sim_scenario_access_input(this.handle,terrain.open.length*2);
      const facts = new Float64Array(rustEngine.memory.buffer,pointer,terrain.open.length*2);
      for (let cell=0;cell<terrain.open.length;cell++) {
        facts[cell*2] = terrain.open[cell] | terrain.bridgeGround[cell]<<1
          | Number(reliefFootprintAllowed(state.world,cell%state.world.width,Math.floor(cell/state.world.width)))<<2;
        facts[cell*2+1] = terrain.edges[cell];
      }
      rustEngine.sim_scenario_access_geometry(this.handle,state.world.width,state.world.height); this.terrain=terrain.version;
    }
    for (const b of this.dirty) rustEngine.sim_scenario_access_site(this.handle,b.id,BUILDING_KIND_CODES[b.kind],b.x,b.y,
      buildingWidth(b),buildingHeight(b),Number(this.store.buildings.get(b.id)===b && b.hp>0) | Number(buildingReady(b))<<1);
    this.dirty.clear(); return this;
  }
}
function bridge(state: GameState): AccessBridge {
  let current = bridges.get(state);
  if (!current || current.store !== entityStore(state)) current = bridges.set(state,new AccessBridge(state));
  return current.flush(state);
}
export function scenarioPlacementError(state: GameState,kind: BuildingKind,x: number,y: number): string | undefined {
  if (!state.world.scenario || isFarmKind(kind) || ['road','bridge','irrigation','ruin'].includes(kind)) return;
  const native = bridge(state);
  if (!rustEngine.sim_scenario_access_check(native.handle,BUILDING_KIND_CODES[kind],x,y,buildingWidth({kind}),buildingHeight({kind})))
    return 'Leave a walking route around this building; it would isolate part of the terrain.';
}
export interface ScenarioAccessReport {
  remove: number[]; landmasses: number; regions: number; remaining: number; unreachable: number; starts: Point[];
}
function streetObservations(state: GameState, faction: number) {
  const native=bridge(state),targets=state.buildings.filter(b=>b.hp>0&&b.faction===faction&&!isFarmKind(b.kind)&&!['road','bridge','irrigation'].includes(b.kind));
  const owned: number[] = [], shared: number[] = [];
  for (const building of state.buildings) if (building.hp > 0 && (building.kind === 'road' || building.kind === 'bridge'))
    (building.faction === faction ? owned : shared).push(building.y * state.world.width + building.x);
  native.input([...targets.map(b => b.id), ...owned, ...shared]);
  return [native.handle, targets.length, owned.length + shared.length, owned.length] as const;
}
export function scenarioRoadPlan(state:GameState,faction:number):Point[]{
  const pointer=rustEngine.sim_scenario_roads(...streetObservations(state, faction)),count=new Float64Array(rustEngine.memory.buffer,pointer,1)[0];
  const cells=Array.from(new Float64Array(rustEngine.memory.buffer,pointer+8,count));
  return cells.map(i=>({x:i%state.world.width,y:Math.floor(i/state.world.width)}));
}
export interface ScenarioStreetAudit { blockers:number[]; blockedRoads:number[]; missingRing:number[]; unserved:number[]; roadRegions:number; expectedRoadRegions:number }
export function auditScenarioStreets(state:GameState,faction:number):ScenarioStreetAudit{
  const pointer=rustEngine.sim_scenario_street_audit(...streetObservations(state, faction));
  const counts=Array.from(new Float64Array(rustEngine.memory.buffer,pointer,6));
  const data=new Float64Array(rustEngine.memory.buffer,pointer+48,counts.slice(0,4).reduce((a,b)=>a+b,0)).slice();let offset=0;
  const section=(count:number)=>Array.from(data.subarray(offset,offset+=count));
  return {blockers:section(counts[0]),blockedRoads:section(counts[1]),missingRing:section(counts[2]),unserved:section(counts[3]),roadRegions:counts[4],expectedRoadRegions:counts[5]};
}
export function scenarioStreetRelocationSites(state:GameState,building:Building):Point[]{
  const native=bridge(state),roads=state.buildings.filter(b=>b.hp>0&&b.kind==='road');
  native.input(roads.map(b=>b.y*state.world.width+b.x));
  const pointer=rustEngine.sim_scenario_street_sites(native.handle,building.id,roads.length),count=new Float64Array(rustEngine.memory.buffer,pointer,1)[0];
  const data=new Float64Array(rustEngine.memory.buffer,pointer+8,count*2).slice();
  return Array.from({length:count},(_,i)=>({x:data[i*2],y:data[i*2+1]}));
}
export function scenarioStructuresAllowed(state: GameState,buildings: readonly Pick<Building,'kind'|'x'|'y'>[]): boolean {
  if (!state.world.scenario) return true;
  const native = bridge(state);
  native.input(buildings.flatMap(b=>[BUILDING_KIND_CODES[b.kind],b.x,b.y,buildingWidth(b),buildingHeight(b)]));
  return !!rustEngine.sim_scenario_access_batch(native.handle,buildings.length);
}
/** Offline command: a complete native corridor plan, without advancing time. */
export function auditScenarioAccess(state: GameState,starts: readonly Point[]): ScenarioAccessReport {
  const native = bridge(state); native.input(starts.flatMap(p=>[p.x,p.y]));
  const pointer = rustEngine.sim_scenario_access_audit(native.handle,starts.length);
  const output = new Float64Array(rustEngine.memory.buffer,pointer,rustEngine.sim_scenario_access_length(native.handle)).slice();
  const [count,landmasses,regions,remaining,unreachable,startCount] = output;
  return {remove:Array.from(output.subarray(6,6+count)),landmasses,regions,remaining,unreachable,
    starts:Array.from({length:startCount},(_,i)=>({x:output[6+count+i*2],y:output[7+count+i*2]}))};
}
