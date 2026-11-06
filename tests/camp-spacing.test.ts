import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { createGame, getLeader, validateBuildAt } from '../src/game/simulation';
import { synchronizeFarms, isPendingCampField } from '../src/game/farms';
import { campSpacingAllowed } from '../src/game/placement';
import { canWalk } from '../src/game/pathfinding';
import type { Building, World } from '../src/game/types';

function fixture() {
  const world: World = { width: 32, height: 24, seed: 'compact-farms', source: 'test', spawns: [{x: 8,y:10}],
    tiles: Array.from({length: 32*24}, () => ({terrain:'grassland',overlay:'none',elevation:.3,moisture:.5,food:3,production:1,gold:0,variation:.5})) };
  const state = createGame(world), leader = getLeader(state)!;
  entityStore(state).buildings.replace(state.buildings.filter(b => b.kind === 'palace'));
  entityStore(state).units.replace([leader]); state.fields = []; for (const t of world.tiles) delete t.farm;
  state.factions[0].culture = 10000; state.factions[0].gold = 1000;
  leader.x = 13.5; leader.y = 13.5;
  return state;
}
function farm(id:number,x:number,y:number): Building { return { id, kind:'camp', faction:0, x,y,hp:100,maxHp:100,capacity:0 }; }

describe('compact farm spacing', () => {
  it('allows farms to touch on every side while rejecting overlapping footprints', () => {
    const state = fixture(); entityStore(state).buildings.add(farm(500,12,10)); synchronizeFarms(state);
    for (const [x,y] of [[13,10],[11,10],[12,9],[12,11]]) {
      expect(campSpacingAllowed(state,x,y)).toBe(true);
      expect(validateBuildAt(state,'camp',x,y).ok).toBe(true);
    }
    for (const [x,y] of [[12,10]])
      expect(validateBuildAt(state,'camp',x,y).ok).toBe(false);
  });

  it('grows one field per touching farm and leaves every plot walkable', () => {
    const state = fixture(); entityStore(state).buildings.add(farm(500,12,10),farm(501,13,10),farm(502,12,11)); synchronizeFarms(state);
    expect(state.fields).toHaveLength(3);
    expect(new Set(state.fields!.map(f => `${f.x},${f.y}`)).size).toBe(3);
    for (const field of state.fields!) expect(canWalk(state,field.x+.5,field.y+.5,0)).toBe(true);
  });

  it('reserves only its single tile while a farm is under construction', () => {
    const state = fixture(), site = farm(500,12,10); site.construction = {startedAt:0,duration:15,waitingForBuilder:true}; entityStore(state).buildings.add(site);
    for (const [x,y] of [[12,10]]) expect(isPendingCampField(state,x,y)).toBe(true);
    for (const [x,y] of [[11,10],[13,10],[12,9],[12,11]]) expect(isPendingCampField(state,x,y)).toBe(false);
  });

  it('lets farms fill a house walking lane and houses use the lane provided by an adjacent farm', () => {
    const state = fixture();
    entityStore(state).buildings.add({id:499,kind:'house',faction:0,x:11,y:10,hp:160,maxHp:160,capacity:4});
    expect(validateBuildAt(state,'camp',12,10).ok).toBe(true);
    entityStore(state).buildings.add(farm(500,12,10)); synchronizeFarms(state);
    expect(validateBuildAt(state,'house',14,10).ok).toBe(true);
  });
});
