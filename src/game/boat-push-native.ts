import { rustEngine } from './rust-engine';
import { galleyScale } from './galley-footprint';
import { simCore, SimSlot } from './sim-handle';
import { nearbyWaterVessels, refreshWaterTraffic } from './water-traffic';
import { atWar } from './relations';
import { entityStore } from './entity-store';
import { refreshIndexedUnit } from './spatial';
import { refreshFogUnit } from './fog';
import { worldRevisions } from './world-revisions';
import { reliefLevel } from './relief';
import { tileAt, type GameState, type Point, type Unit } from './types';

interface Geometry { x: number; y: number; blockers: ReadonlySet<number>; revision: number }
const geometries = new SimSlot<Geometry>();
const WIDTH = 21;

/** Indexed observations and result transport only. Rust owns contacts, chain
 * pushes, hull clearance and atomic rollback when there is no water space. */
export function pushBoatsForLeader(state: GameState, boat: Unit, target: Point, facing: number,
  blockers: ReadonlySet<number>, water: (x: number, y: number) => boolean): boolean {
  const vessels = nearbyWaterVessels(state, boat, 8).filter(vessel => vessel !== boat);
  if (!vessels.length) return true;
  const handle = simCore(state).handle;
  const pointer = rustEngine.sim_boat_push_input(handle, vessels.length);
  const rows = new Float64Array(rustEngine.memory.buffer, pointer, vessels.length * 7);
  vessels.forEach((vessel, index) => {
    const galley = 'kind' in vessel && vessel.kind === 'sailboat';
    const halfHull = galley ? .5 * galleyScale(vessel as Unit) : 'dock' in vessel ? vessel.kind === 'whaling' ? 1 : .5 : 0;
    const faction = 'village' in vessel ? state.villages?.find(v => v.id === vessel.village)?.faction ?? vessel.faction : vessel.faction;
    rows.set([index, vessel.x, vessel.y, vessel.facing, halfHull, galley ? halfHull : 'dock' in vessel ? .5 : .3,
      Number(!atWar(state, boat.faction, faction))], index * 7);
  });
  let output = rustEngine.sim_boat_push_run(handle, vessels.length, 0, target.x, target.y, facing);
  const status = new Float64Array(rustEngine.memory.buffer, output, 2)[0];
  if (status !== 2) return status === 1;
  const x = Math.floor(boat.x) - 10, y = Math.floor(boat.y) - 10;
  const revision = worldRevisions(state.world).geometry, cached = geometries.get(state);
  if (!cached || cached.x !== x || cached.y !== y || cached.blockers !== blockers || cached.revision !== revision) {
    const patch = new Float64Array(WIDTH * WIDTH);
    for (let row = 0; row < WIDTH; row++) for (let col = 0; col < WIDTH; col++)
      if (water(x + col, y + row)) patch[row * WIDTH + col] = 1 + reliefLevel(tileAt(state.world, x + col, y + row));
    const input = rustEngine.sim_boat_push_geometry(handle, x, y, WIDTH);
    new Float64Array(rustEngine.memory.buffer, input, patch.length).set(patch);
    geometries.set(state, { x, y, blockers, revision });
  }
  output = rustEngine.sim_boat_push_run(handle, vessels.length, 1, target.x, target.y, facing);
  const [success, count] = new Float64Array(rustEngine.memory.buffer, output, 2);
  if (!success) return false;
  const moved = new Float64Array(rustEngine.memory.buffer, output + 16, count * 3).slice();
  const store = entityStore(state);
  for (let row = 0; row < moved.length; row += 3) {
    const vessel = vessels[moved[row]];
    vessel.x = moved[row + 1]; vessel.y = moved[row + 2]; vessel.moving = true;
    if ('village' in vessel) {
      rustEngine.sim_harbor_push(handle, vessel.village, vessel.faction, vessel.x, vessel.y);
    } else if ('order' in vessel) {
      if (vessel.sailboat) {
        vessel.sailboat.velocity = { x: 0, y: 0 };
        const passenger = store.units.get(vessel.sailboat.passenger ?? -1);
        if (passenger) { passenger.x = vessel.x; passenger.y = vessel.y; refreshIndexedUnit(state, passenger); refreshFogUnit(state, passenger); }
      }
      refreshIndexedUnit(state, vessel); refreshFogUnit(state, vessel);
    }
    if ('dock' in vessel) rustEngine.sim_fishery_push(handle, vessel.id, vessel.x, vessel.y);
    refreshWaterTraffic(state, vessel);
  }
  return true;
}
