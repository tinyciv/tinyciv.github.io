import { rustEngine } from './rust-engine';
import { simCore, SimSlot } from './sim-handle';
import { entityStore } from './entity-store';
import type { GameState, Point, Unit, WildlifeHerd } from './types';
interface BirdSteering { goal: Point; speed: number; active: boolean }
const plans = new SimSlot<Map<number, BirdSteering>>();
export const marshBirdSpeed = (fleeing = false): number => rustEngine.marsh_bird_speed(Number(fleeing));
export function birdSteering(state: GameState, bird: Unit): BirdSteering | undefined { return plans.get(state)?.get(bird.id); }
/** Transport only: native flock decisions run alongside the existing 2 Hz herd clock. */
export function observeBirdFlock(state: GameState, members: readonly Unit[], flock: WildlifeHerd): void {
  const handle=simCore(state).handle, pointer=rustEngine.sim_bird_input(handle,members.length);
  const input=new Float64Array(rustEngine.memory.buffer,pointer,members.length*5);
  members.forEach((bird,i)=>input.set([bird.id,bird.x,bird.y,bird.facing,Number(bird.moving)],i*5));
  const fleeing=Number((flock.fleeUntil??0)>state.time), threat=flock.lastThreat??flock.waypoint;
  const output=rustEngine.sim_bird_plan(handle,members.length,state.time,flock.waypoint.x,flock.waypoint.y,
    Number((flock.wanderUntil??0)>state.time),fleeing,threat.x,threat.y);
  const rows=new Float64Array(rustEngine.memory.buffer,output,members.length*5);
  let record=plans.get(state);if(!record){record=new Map();plans.set(state,record);}
  for(let i=0;i<rows.length;i+=5)record.set(rows[i],{goal:{x:rows[i+1],y:rows[i+2]},speed:rows[i+3],active:!!rows[i+4]});
  // A bounded death cleanup on the same observation clock.
  const units=entityStore(state).units;
  for(const [id] of record)if((units.get(id)?.hp??0)<=0)record.delete(id);
}
