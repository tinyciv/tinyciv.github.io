import { describe, expect, it } from 'vitest';
import { scenario } from '../dev/navigation-lab/scenarios';
import { entityStore } from '../src/game/entity-store';
import { unitObstructs } from '../src/game/collisions';
import { movementCongestion } from '../src/game/engagement';
import { isForbidden, setForbiddenRectangle } from '../src/game/forbidden-zones';
import { canMove } from '../src/game/pathfinding';
import { moveUnit, updateFriendlyYield, updateGame } from '../src/game/simulation';
import { beginUnitFrame, cellOccupant, endUnitFrame, refreshIndexedUnit, unitOccupancy } from '../src/game/spatial';
import { distance, type GameState, type Point, type Unit } from '../src/game/types';

function fixture(kind: Unit['kind'] = 'leader') {
  const state = scenario('Open melee'), base = state.units[0];
  state.marauderPacks = [];
  state.factions[0].gold = 0;
  const mover: Unit = { ...base, id: 100, kind, x: 8.5, y: 8.5, speed: 3, order: 'follow' };
  const blocker: Unit = { ...base, id: 101, kind: 'warrior', faction: 1, villageId: 1,
    x: 9.5, y: 8.5, speed: 2.4, order: 'hold', retinueStance: 'hold', villageNextWanderAt: Infinity };
  entityStore(state).units.replace([mover, blocker]);
  entityStore(state).buildings.add({ id: 3000, kind: 'villageTent', faction: 1, villageId: 1,
    x: 15, y: 14, hp: 100, maxHp: 100, capacity: 0 });
  state.villages = [{ id: 1, faction: 1, campId: 3000, name: 'Passage village', identity: 'growers', relation: 'neutral',
    x: 9, y: 8, nextGrowthAt: Infinity, nextThinkAt: Infinity, nextRecruitAt: Infinity }];
  state.factions.push({ ...state.factions[0], id: 1, villageId: 1, relation: 'peace' });
  return { state, mover, blocker };
}
const cell = (state: GameState, point: Point) => Math.floor(point.y) * state.world.width + Math.floor(point.x);
const sameCell = (a: Point, b: Point) => Math.floor(a.x) === Math.floor(b.x) && Math.floor(a.y) === Math.floor(b.y);
function corridor(state: GameState, pocket = true) {
  for (let y = 6; y <= 10; y++) for (let x = 0; x < state.world.width; x++) {
    if (y !== 8 && !(pocket && x === 9 && y === 7)) state.world.tiles[y * state.world.width + x].terrain = 'lake';
  }
  state.world.revision!++;
}
function step(state: GameState, mover: Unit, blocker: Unit, goal: Point, direct: boolean) {
  state.time += .1;
  beginUnitFrame(state);
  try {
    moveUnit(state, mover, goal, .1, direct); refreshIndexedUnit(state, mover);
    const yielding = updateFriendlyYield(state, blocker, .1); refreshIndexedUnit(state, blocker);
    return yielding;
  } finally { endUnitFrame(state); }
}

describe('player company movement priority', () => {
  it.each([false, true])('ignores friendly units in Leader occupancy, congestion and movement (indexed: %s)', indexed => {
    const { state, mover, blocker } = fixture();
    blocker.faction = 0; delete blocker.villageId;
    blocker.destination = { x: blocker.x, y: blocker.y }; blocker.target = 999; blocker.lastCombat = state.time;
    corridor(state, false);
    if (indexed) beginUnitFrame(state);
    try {
      expect(cellOccupant(state, blocker, mover)).toBeUndefined();
      expect(unitOccupancy(state, mover).has(cell(state, blocker))).toBe(false);
      const visits: Unit[] = [];
      expect(movementCongestion(state, mover, other => visits.push(other)).size).toBe(0);
      expect(visits).toEqual([]);
      let overlap = false;
      for (let i = 0; i < 25; i++) {
        state.time += .1; moveUnit(state, mover, { x: 13.5, y: 8.5 }, .1); refreshIndexedUnit(state, mover);
        overlap ||= sameCell(mover, blocker);
        expect(updateFriendlyYield(state, blocker, .1)).toBe(false);
        expect(blocker.x).toBe(9.5); expect(blocker.y).toBe(8.5);
      }
      expect(overlap).toBe(true); expect(distance(mover, { x: 13.5, y: 8.5 })).toBeLessThan(.12);
    } finally { if (indexed) endUnitFrame(state); }
  });

  it.each(['warrior', 'archer'] as const)('retains friendly collision for a %s, including the Leader cell', kind => {
    for (const blockerKind of ['leader', 'warrior', 'archer'] as const) {
      const { state, mover, blocker } = fixture(kind);
      blocker.faction = 0; blocker.kind = blockerKind; delete blocker.villageId;
      expect(unitObstructs(mover, blocker)).toBe(true);
      expect(unitOccupancy(state, mover).has(cell(state, blocker))).toBe(true);
      for (let i = 0; i < 20; i++) expect(step(state, mover, blocker, { x: 13.5, y: 8.5 }, true)).toBe(false);
      expect(mover.x).toBeLessThan(9); expect(blocker.x).toBe(9.5); expect(blocker.y).toBe(8.5);
    }
  });

  it.each([false, true])('lets retinue leave a cell shared with the Leader, while blocking the next friendly soldier (direct: %s)', direct => {
    const { state, mover, blocker } = fixture('warrior'); corridor(state, false);
    blocker.faction = 0; blocker.kind = 'leader'; blocker.x = mover.x; delete blocker.villageId;
    entityStore(state).units.add({ ...blocker, id: 102, kind: 'warrior', x: 11.5 });
    for (let i = 0; i < 30; i++) {
      step(state, mover, blocker, { x: 13.5, y: 8.5 }, direct);
      expect(blocker.x).toBe(8.5); expect(blocker.y).toBe(8.5);
      expect(mover.x).toBeLessThan(11);
    }
    expect(mover.x).toBeGreaterThan(10);
  });

  it.each(['leader', 'warrior', 'archer'] as const)('lets the player %s move a neutral guard into a side pocket at walking speed', kind => {
    for (const direct of [false, true]) {
      const { state, mover, blocker } = fixture(kind), origin = { x: blocker.x, y: blocker.y };
      const destination = { x: 13.5, y: 8.5 };
      blocker.destination = { ...origin }; corridor(state);
      if (!direct) {
        // A guard enters a route already chosen by the navigator. The retained
        // route must ask it to sidestep just as direct keyboard movement does.
        blocker.x = 15.5; step(state, mover, blocker, destination, false); blocker.x = origin.x;
      }
      let displaced = false;
      for (let i = 0; i < 60; i++) {
        const before = { x: blocker.x, y: blocker.y };
        step(state, mover, blocker, destination, direct);
        displaced ||= distance(blocker, origin) > .5;
        expect(distance(before, blocker)).toBeLessThanOrEqual(blocker.speed * .1 + 1e-8);
        expect(canMove(state, before, blocker, blocker.faction)).toBe(true);
        expect(sameCell(mover, blocker)).toBe(false);
        expect(blocker.order).toBe('hold'); expect(blocker.retinueStance).toBe('hold');
        expect(blocker.destination).toEqual(origin);
      }
      expect(displaced).toBe(true); expect(distance(mover, destination)).toBeLessThan(.12);
      expect(distance(blocker, origin)).toBeLessThan(.12);
    }
  });

  it('executes a village sidestep in the normal game update', () => {
    const { state, mover, blocker } = fixture(); corridor(state);
    let displaced = false;
    for (let i = 0; i < 25; i++) {
      updateGame(state, .1, { up: false, down: false, left: false, right: true });
      displaced ||= blocker.y < 8;
      expect(sameCell(mover, blocker)).toBe(false);
    }
    expect(displaced).toBe(true); expect(mover.x).toBeGreaterThan(13);
  });

  it.each(['water', 'building', 'forbidden'] as const)('waits when the only possible sidesteps are blocked by %s', obstacle => {
    const { state, mover, blocker } = fixture();
    for (let y = 7; y <= 9; y++) for (let x = 8; x <= 10; x++) {
      if (y === 8 && x <= 9) continue;
      if (obstacle === 'water') state.world.tiles[y * state.world.width + x].terrain = 'lake';
      else if (obstacle === 'building') entityStore(state).buildings.add({ id: 4000 + y * 32 + x, kind: 'wall', faction: 1,
        x, y, hp: 100, maxHp: 100, capacity: 0 });
      else setForbiddenRectangle(state, { x, y }, { x, y }, true);
    }
    state.world.revision!++;
    for (let i = 0; i < 20; i++) expect(step(state, mover, blocker, { x: 13.5, y: 8.5 }, true)).toBe(false);
    expect(mover.x).toBeLessThan(9); expect(blocker.x).toBe(9.5); expect(blocker.y).toBe(8.5);
  });

  it('uses an unmarked pocket and cancels a pending sidestep when it becomes forbidden', () => {
    const { state, mover, blocker } = fixture(); corridor(state);
    expect(step(state, mover, blocker, { x: 13.5, y: 8.5 }, true)).toBe(false);
    expect(step(state, mover, blocker, { x: 13.5, y: 8.5 }, true)).toBe(true);
    const before = { x: blocker.x, y: blocker.y };
    setForbiddenRectangle(state, { x: 9, y: 7 }, { x: 9, y: 7 }, true);
    expect(updateFriendlyYield(state, blocker, .1)).toBe(false);
    expect(distance(before, blocker)).toBe(0); expect(isForbidden(state, blocker.x, blocker.y)).toBe(false);
  });

  it.each(['neutral', 'trade', 'allied'] as const)('walks a guard from a %s village aside', relation => {
    const { state, mover, blocker } = fixture(); corridor(state);
    state.villages![0].relation = relation;
    for (let i = 0; i < 20; i++) step(state, mover, blocker, { x: 13.5, y: 8.5 }, true);
    expect(mover.x).toBeGreaterThan(12);
  });

  it.each(['peace', 'confederated'] as const)('walks a %s civilization soldier aside without changing its order', relation => {
    const { state, mover, blocker } = fixture(); corridor(state);
    state.villages = []; delete blocker.villageId; state.factions[1].relation = relation;
    for (let i = 0; i < 20; i++) {
      const before = { x: blocker.x, y: blocker.y };
      step(state, mover, blocker, { x: 13.5, y: 8.5 }, true);
      expect(distance(before, blocker)).toBeLessThanOrEqual(blocker.speed * .1 + 1e-8);
      expect(blocker.order).toBe('hold');
    }
    expect(mover.x).toBeGreaterThan(12);
  });

  it.each(['hostile village', 'hostile civilization', 'unknown faction', 'wildlife', 'enemy'] as const)('does not push a %s', relation => {
    const { state, mover, blocker } = fixture();
    if (relation === 'hostile village') state.villages![0].relation = 'war';
    else {
      delete blocker.villageId;
      state.villages = [];
      if (relation === 'hostile civilization') state.factions[1].relation = 'war';
      if (relation === 'unknown faction') blocker.faction = 99;
      if (relation === 'wildlife') { blocker.kind = 'boar'; blocker.faction = -1; }
      if (relation === 'enemy') blocker.faction = -2;
    }
    for (let i = 0; i < 20; i++) expect(step(state, mover, blocker, { x: 13.5, y: 8.5 }, true)).toBe(false);
    expect(mover.x).toBeLessThan(9); expect(blocker.x).toBe(9.5); expect(blocker.y).toBe(8.5);
  });

  it.each(['village', 'civilization'] as const)('stops a %s sidestep immediately when relations become hostile', source => {
    const { state, mover, blocker } = fixture(); corridor(state);
    if (source === 'civilization') { state.villages = []; delete blocker.villageId; }
    step(state, mover, blocker, { x: 13.5, y: 8.5 }, true);
    expect(step(state, mover, blocker, { x: 13.5, y: 8.5 }, true)).toBe(true);
    const before = { x: blocker.x, y: blocker.y };
    if (source === 'village') state.villages![0].relation = 'war';
    else state.factions[1].relation = 'war';
    expect(updateFriendlyYield(state, blocker, .1)).toBe(false);
    expect(distance(before, blocker)).toBe(0);
  });
});
