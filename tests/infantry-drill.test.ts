import { describe, expect, it } from 'vitest';
import { advanceInfantryFormations, infantryFormationActive, infantryFormationGoal, infantryAttackMultiplier, infantryDefenseMultiplier, infantryPointClear,
  infantryRectangleOffsets, toggleInfantryFormation, enforceInfantryFormationStrength, infantryFormationSoldierCount,
  INFANTRY_FORMATION_ASPECT, infantryFormationAspect, INFANTRY_SPACING } from '../src/game/infantry-drill';
import { moveUnit, updateGame } from '../src/game/simulation';
import { unitObstructs, unitsCollide } from '../src/game/collisions';
import { beginUnitFrame, endUnitFrame, refreshIndexedUnit } from '../src/game/spatial';
import { beginNavigationFrame, endNavigationFrame } from '../src/game/pathfinding';
import { withPlayerFaction } from '../src/game/player-context';
import { entityStore } from '../src/game/entity-store';
import { markWorldChanged } from '../src/game/world-revisions';
import { distance, type GameState, type InputState, type Unit } from '../src/game/types';

const idle: InputState = { up: false, down: false, left: false, right: false };
function soldier(id: number, x: number, y: number, kind: Unit['kind'] = 'warrior', faction = 0): Unit {
  return { id, kind, faction, x, y, hp: 100, maxHp: 100, morale: 100, attack: 0, defense: 5, speed: kind === 'leader' ? 4.4 : kind === 'horseman' ? 5.5 : 3.3,
    range: kind === 'archer' || kind === 'leader' ? 4 : 1.1, order: kind === 'leader' ? 'hold' : 'follow', retinueStance: 'aggressive', cooldown: 0, lastCombat: -100,
    moving: false, facing: 0, attackTime: 0 };
}
function fixture(count = 12, scenario: 'field' | 'gate' | 'winding' | 'urban' = 'field', activate = true) {
  const width = 44, height = 28, leader = soldier(1, 8.5, 14.5, 'leader');
  const members = infantryRectangleOffsets(count).map((offset, index) => soldier(index + 2, leader.x + offset.x, leader.y + offset.y,
    (['warrior', 'archer', 'spearman', 'horseman'] as const)[index % 4]));
  const state = {
    world: { width, height, revision: 0, seed: 'infantry', source: 'test', spawns: [], tiles: Array.from({ length: width * height }, () =>
      ({ terrain: 'grassland', overlay: 'none', elevation: .1, moisture: .5, food: 0, production: 0, gold: 0, variation: .5 })) },
    units: [leader, ...members], buildings: [{ id: 1000, kind: 'palace', faction: 0, x: 1, y: 1, hp: 650, maxHp: 650, capacity: 4,
      governorPermissions: { housing: false, farms: false } }],
    factions: [{ id: 0, name: 'Player', color: '#f44', affinity: 100, relation: 'self', population: 0, food: 10000, gold: 10000, production: 0, culture: 0,
      yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1e9, nextRetinueAt: 1e9, defeated: false, research: { focus: 'infantryDrill', levels: { infantryDrill: 1 }, progress: {} } }],
    time: 0, tick: 0, paused: false, speed: 1, gameOver: false, victory: false, events: [], particles: [], selected: leader.id, selectedType: 'unit',
    buildMode: null, diplomacy: null, seed: 'infantry', rngState: 1, fields: [], raiderCamps: [], marauderPacks: [], villages: [],
    fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 1 }, retinueStance: 'aggressive', movementMode: 'travel',
  } as unknown as GameState;
  const fill = (x: number, y: number, w: number, h: number) => {
    for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) state.world.tiles[py * width + px].terrain = 'lake';
  };
  if (scenario === 'gate') {
    fill(21, 0, 1, height); state.world.tiles[14 * width + 21].terrain = 'grassland';
  } else if (scenario === 'winding') {
    fill(16, 2, 14, 24);
    for (const [x, y, w, h] of [[16, 14, 5, 2], [19, 9, 2, 7], [19, 9, 8, 2], [25, 9, 2, 10], [25, 17, 5, 2]])
      for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) state.world.tiles[py * width + px].terrain = 'grassland';
  } else if (scenario === 'urban') {
    for (const [x, y, w, h] of [[15, 3, 4, 9], [15, 16, 4, 9], [22, 7, 4, 11], [29, 2, 4, 9], [29, 15, 4, 11]]) fill(x, y, w, h);
  }
  if (activate) {
    expect(toggleInfantryFormation(state).ok).toBe(true);
    // Movement/contact cases start after troops have physically sorted into ranks.
    run(state, 2);
  }
  return { state, leader, members };
}
function step(state: GameState, input: InputState = idle, dt = .05) {
  state.time += dt; beginUnitFrame(state); beginNavigationFrame(state);
  try {
    advanceInfantryFormations(state, dt, faction => state.multiplayer?.inputs[faction] ?? input,
      (unit, goal, speed, elapsed) => { moveUnit(state, unit, goal, elapsed * speed / unit.speed, true, false, true); refreshIndexedUnit(state, unit); });
  } finally { endUnitFrame(state); endNavigationFrame(state); }
}
function run(state: GameState, seconds: number, input: InputState = idle) { for (let i = 0; i < Math.round(seconds / .05); i++) step(state, input); }

describe('Infantry Drill commands and ownership', () => {
  it.each([0, 1, 4, 7])('rejects activation with %i soldiers, excluding the Leader from the requirement', count => {
    const { state, leader } = fixture(count, 'field', false);
    expect(infantryFormationSoldierCount(state)).toBe(count);
    expect(toggleInfantryFormation(state)).toEqual({ ok: false, message: 'Formation requires 8 living retinue soldiers.' });
    expect(leader.infantryFormation).toBeUndefined();
    expect(state.units.every(unit => unit.infantryDrillLeader === undefined && unit.morale === 100)).toBe(true);
  });

  it('counts living available retinue soldiers, excluding guards, scouts, embarked troops and distant recruits', () => {
    const { state, leader } = fixture(7, 'field', false);
    const excluded = [
      soldier(90, 9, 14, 'scout'), { ...soldier(91, 9, 14), guardPost: 200 },
      { ...soldier(92, 9, 14), hp: 0 }, { ...soldier(93, 9, 14), inside: true },
      { ...soldier(94, 9, 14), training: { range: 1000, role: 'warrior' as const } }, { ...soldier(95, 9, 14), embarkedOn: 1000 },
      { ...soldier(96, 9, 14), boardingBoat: 1000 }, { ...soldier(97, 9, 14), order: 'flee' as const },
      { ...soldier(98, 35, 14), joiningRetinue: true }, soldier(99, 9, 14, 'warrior', 1),
    ];
    entityStore(state).units.add(...excluded);
    expect(infantryFormationSoldierCount(state)).toBe(7);
    expect(toggleInfantryFormation(state).ok).toBe(false);
    const eighth = soldier(200, leader.x + 1, leader.y); entityStore(state).units.add(eighth);
    expect(toggleInfantryFormation(state).ok).toBe(true);
    expect(eighth.infantryDrillLeader).toBe(leader.id);
    expect(excluded.every(unit => unit.infantryDrillLeader === undefined)).toBe(true);
  });

  it.each([5, 6, 7])('sustains an active formation with %i survivors but needs eight to reform', remaining => {
    const { state, leader, members } = fixture(8); step(state);
    for (const member of members.slice(remaining)) member.hp = 0;
    expect(enforceInfantryFormationStrength(state)).toBe(false);
    step(state);
    expect(infantryFormationActive(state)).toBe(true);
    expect(leader.infantryFormation!.slots).toHaveLength(remaining);
    expect(leader.morale).toBe(100);
    expect(toggleInfantryFormation(state).ok).toBe(true);
    expect(toggleInfantryFormation(state).ok).toBe(false);
  });

  it('collapses below five, routes surviving participants including the Leader, and removes their bonuses immediately', () => {
    const { state, leader, members } = fixture(8); step(state);
    const guard = { ...soldier(90, 10, 14), guardPost: 200 }, scout = soldier(91, 10, 14, 'scout');
    entityStore(state).units.add(guard, scout);
    for (const member of members.slice(4)) member.hp = 0;
    leader.destination = { x: 20, y: 14 }; leader.target = 900;
    expect(enforceInfantryFormationStrength(state, leader.faction)).toBe(true);
    expect(infantryFormationActive(state)).toBe(false);
    for (const unit of [leader, ...members.slice(0, 4)]) {
      expect(unit).toMatchObject({ morale: 0, order: 'flee', routed: true });
      expect(unit.infantryDrillLeader).toBeUndefined();
      expect(unit.target).toBeUndefined(); expect(unit.destination).toBeUndefined();
      expect(infantryFormationGoal(state, unit)).toBeUndefined();
      expect(infantryAttackMultiplier(state, unit, { x: unit.x + 1, y: unit.y })).toBe(1);
      expect(infantryDefenseMultiplier(state, unit, { x: unit.x + 1, y: unit.y })).toBe(1);
    }
    expect(guard.morale).toBe(100); expect(scout.morale).toBe(100);
    expect(guard.order).toBe('follow'); expect(scout.order).toBe('follow');
    expect(enforceInfantryFormationStrength(state)).toBe(false);
  });

  it('also catches units removed outside combat before any formation movement', () => {
    const { state, leader, members } = fixture(8);
    entityStore(state).units.retain(unit => unit === leader || members.slice(0, 4).includes(unit));
    step(state, { ...idle, up: true });
    expect(leader).toMatchObject({ x: 8.5, y: 14.5, morale: 0, order: 'flee' });
    expect(infantryFormationActive(state)).toBe(false);
  });

  it('requires research and leaves previous stance and Shift travel settings untouched', () => {
    const { state, leader, members } = fixture(); toggleInfantryFormation(state);
    state.factions[0].research!.levels.infantryDrill = 0; expect(toggleInfantryFormation(state)).toMatchObject({ ok: false, message: 'Research Infantry Drill first.' });
    state.factions[0].research!.levels.infantryDrill = 1; state.movementMode = 'formation'; state.retinueStance = 'hold';
    for (const member of members) { member.retinueStance = 'hold'; member.order = 'hold'; }
    expect(toggleInfantryFormation(state).ok).toBe(true); run(state, 1, { ...idle, up: true });
    expect(leader.x).toBeGreaterThan(9); expect(members.every(member => member.retinueStance === 'hold' && member.order === 'hold')).toBe(true);
    toggleInfantryFormation(state); expect(state.movementMode).toBe('formation'); expect(state.retinueStance).toBe('hold');
    expect(state.units.every(unit => unit.infantryDrillLeader === undefined)).toBe(true);
  });

  it('isolates toggles, rotation and input by authenticated multiplayer faction', () => {
    const { state, leader } = fixture(8); toggleInfantryFormation(state);
    const rival = soldier(100, 30.5, 14.5, 'leader', 1);
    entityStore(state).units.add(rival, ...infantryRectangleOffsets(8).map((offset, i) => soldier(101 + i, rival.x + offset.x, rival.y + offset.y, 'warrior', 1)));
    state.factions.push({ ...state.factions[0], id: 1, relation: 'war', research: { focus: 'infantryDrill', levels: { infantryDrill: 1 }, progress: {} } });
    state.multiplayer = { humanFactionIds: [0, 1], inputs: { 0: idle, 1: { ...idle, turnLeft: true } }, controls: {}, winner: null };
    expect(withPlayerFaction(state, 1, () => toggleInfantryFormation(state)).ok).toBe(true);
    expect(infantryFormationActive(state, 0)).toBe(false); expect(infantryFormationActive(state, 1)).toBe(true);
    run(state, .4); expect(leader).toMatchObject({ x: 8.5, y: 14.5 }); expect(rival.infantryFormation!.heading).toBeCloseTo(-.5);
    state.multiplayer.inputs[1] = idle; run(state, 1); expect(rival.infantryFormation!.heading).toBeCloseTo(-.5);
  });

  it('removes membership on boarding, routing or death and excludes scouts and guards', () => {
    const { state, leader, members } = fixture(8);
    const excluded = [soldier(90, 9.5, 14.5, 'scout'), soldier(91, 10.5, 14.5, 'militia')]; (state.units as Unit[]).push(...excluded);
    step(state); expect(excluded.every(unit => unit.infantryDrillLeader === undefined)).toBe(true);
    members[0].order = 'flee'; step(state); expect(members[0].infantryDrillLeader).toBeUndefined();
    leader.boardingBoat = 123; step(state); expect(infantryFormationActive(state)).toBe(false);
    expect(state.units.every(unit => unit.infantryDrillLeader === undefined)).toBe(true);
    leader.boardingBoat = undefined; members[0].order = 'follow'; expect(toggleInfantryFormation(state).ok).toBe(true); leader.hp = 0; step(state);
    expect(state.units.every(unit => unit.infantryDrillLeader === undefined)).toBe(true);
  });

  it('does not slow the army or grant bonuses for a replacement still traveling from its settlement', () => {
    const { state, leader } = fixture(8), recruit = soldier(90, 30.5, 14.5); recruit.joiningRetinue = true; (state.units as Unit[]).push(recruit);
    run(state, 1, { ...idle, up: true });
    expect(leader.x).toBeCloseTo(8.5 + 3.465); expect(recruit.infantryDrillLeader).toBeUndefined();
    expect(infantryAttackMultiplier(state, recruit, { x: recruit.x + 1, y: recruit.y })).toBe(1);
    recruit.x = leader.x + 5; step(state); expect(recruit.infantryDrillLeader).toBe(leader.id);
  });
});

describe('tight centered movement', () => {
  it('checks an already-active shape once and reforms through movement without teleporting', () => {
    const { state, leader, members } = fixture(12);
    leader.infantryFormation!.slots = leader.infantryFormation!.slots.map(slot => ({ ...slot, y: slot.y * .5 }));
    for (const member of members) {
      const slot = leader.infantryFormation!.slots.find(candidate => candidate.id === member.id)!;
      member.x = leader.x + slot.x; member.y = leader.y + slot.y;
    }
    const before = members.map(member => ({ ...member })); step(state);
    members.forEach((member, index) => expect(distance(member, before[index])).toBeLessThanOrEqual(3.465 * 1.25 * .05 + 1e-7));
    const nominal = infantryRectangleOffsets(12);
    expect(leader.infantryFormation!.slots.every(slot => nominal.some(point => point.x === slot.x && point.y === slot.y))).toBe(true);
    run(state, 2);
    expect(members.every(member => distance(member, infantryFormationGoal(state, member)!) < .01)).toBe(true);
    const slots = leader.infantryFormation!.slots; step(state); expect(leader.infantryFormation!.slots).toBe(slots);
  });

  it.each([4, 5, 6, 7, 8, 9, 10, 12, 16, 20, 24, 30, 31, 32, 48, 80, 120])(
    'uses the correct balanced rectangle for %i soldiers without crowding', count => {
      const offsets = infantryRectangleOffsets(count), occupied = [{ x: 0, y: 0 }, ...offsets];
      const depth = Math.max(...offsets.map(point => point.x)) - Math.min(...offsets.map(point => point.x));
      const width = Math.max(...offsets.map(point => point.y)) - Math.min(...offsets.map(point => point.y));
      expect(offsets).toHaveLength(count); expect(width / depth).toBeCloseTo(infantryFormationAspect(count), 10);
      const ranks = new Map<number, number>();
      for (const point of occupied) ranks.set(point.x, (ranks.get(point.x) ?? 0) + 1);
      expect(Math.max(...ranks.values()) - Math.min(...ranks.values())).toBeLessThanOrEqual(2);
      for (let a = 0; a < occupied.length; a++) for (let b = a + 1; b < occupied.length; b++)
        expect(distance(occupied[a], occupied[b])).toBeGreaterThanOrEqual(INFANTRY_SPACING - 1e-9);
      if (count % 2 === 0) for (const point of offsets)
        expect(offsets.some(other => Math.abs(point.x + other.x) < 1e-9 && Math.abs(point.y + other.y) < 1e-9)).toBe(true);
    });

  it('widens above thirty soldiers and reforms after casualties and reinforcements, with archers still behind melee', () => {
    const { state, leader, members } = fixture(31);
    const aspect = () => {
      const slots = leader.infantryFormation!.slots;
      return (Math.max(...slots.map(slot => slot.y)) - Math.min(...slots.map(slot => slot.y)))
        / (Math.max(...slots.map(slot => slot.x)) - Math.min(...slots.map(slot => slot.x)));
    };
    const rangedInRear = () => {
      const slots = leader.infantryFormation!.slots;
      const ranged = slots.filter(slot => state.units.find(unit => unit.id === slot.id)!.range > 1.5);
      const melee = slots.filter(slot => state.units.find(unit => unit.id === slot.id)!.range <= 1.5);
      expect(Math.max(...ranged.map(slot => slot.x))).toBeLessThanOrEqual(Math.min(...melee.map(slot => slot.x)));
    };
    expect(aspect()).toBeCloseTo(2.2, 10); rangedInRear();
    members.at(-1)!.hp = 0; run(state, .5);
    expect(leader.infantryFormation!.slots).toHaveLength(30); expect(aspect()).toBeCloseTo(1.6, 10); rangedInRear();
    entityStore(state).units.add(soldier(200, leader.x - 1, leader.y, 'archer')); run(state, .5);
    expect(leader.infantryFormation!.slots).toHaveLength(31); expect(aspect()).toBeCloseTo(2.2, 10); rangedInRear();
    const settled = leader.infantryFormation!.slots;
    run(state, .5); expect(leader.infantryFormation!.slots).toBe(settled);
  });

  it.each([0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 2])(
    'keeps the wide side across travel at heading %f and maintains ranged rear ranks', heading => {
      const { state, leader, members } = fixture(24, 'field', false);
      leader.facing = heading; expect(toggleInfantryFormation(state).ok).toBe(true); run(state, 4);
      const start = { x: leader.x, y: leader.y };
      run(state, 1, { ...idle, up: true }); run(state, 1);
      const dx = leader.x - start.x, dy = leader.y - start.y;
      expect(dx).toBeCloseTo(Math.cos(heading) * 3.465, 5);
      expect(dy).toBeCloseTo(Math.sin(heading) * 3.465, 5);
      const projected = members.map(unit => ({ unit,
        forward: (unit.x - leader.x) * Math.cos(heading) + (unit.y - leader.y) * Math.sin(heading),
        lateral: -(unit.x - leader.x) * Math.sin(heading) + (unit.y - leader.y) * Math.cos(heading) }));
      const depth = Math.max(...projected.map(point => point.forward)) - Math.min(...projected.map(point => point.forward));
      const width = Math.max(...projected.map(point => point.lateral)) - Math.min(...projected.map(point => point.lateral));
      expect(width / depth).toBeCloseTo(INFANTRY_FORMATION_ASPECT, 4);
      expect(Math.max(...projected.filter(point => point.unit.kind === 'archer').map(point => point.forward)))
        .toBeLessThanOrEqual(Math.min(...projected.filter(point => point.unit.kind !== 'archer').map(point => point.forward)) + .01);
      expect(members.every(unit => distance(unit, infantryFormationGoal(state, unit)!) < .01)).toBe(true);
    });

  it('places mixed ranged troops behind melee relative to the heading and keeps those slots while moving and turning', () => {
    const { state, leader, members } = fixture(12, 'field', false);
    members[0].range = 3; // Future ranged retinue use the same rear-rank rule.
    expect(toggleInfantryFormation(state).ok).toBe(true);
    run(state, 2);
    const roles = () => leader.infantryFormation!.slots.map(slot => ({ ...slot, ranged: members.find(unit => unit.id === slot.id)!.range > 1.5 }));
    const rear = roles().filter(slot => slot.ranged), front = roles().filter(slot => !slot.ranged);
    expect(rear).toHaveLength(4);
    expect(Math.max(...rear.map(slot => slot.x))).toBeLessThanOrEqual(Math.min(...front.map(slot => slot.x)));
    expect(Math.max(...rear.map(slot => slot.x))).toBeLessThan(0);
    const slots = structuredClone(leader.infantryFormation!.slots);
    run(state, 1, { ...idle, up: true }); run(state, 1, { ...idle, turnRight: true }); run(state, 2);
    expect(leader.infantryFormation!.slots).toEqual(slots);
    const forward = (unit: Unit) => (unit.x - leader.x) * Math.cos(leader.facing) + (unit.y - leader.y) * Math.sin(leader.facing);
    expect(Math.max(...members.filter(unit => unit.range > 1.5).map(forward)))
      .toBeLessThanOrEqual(Math.min(...members.filter(unit => unit.range <= 1.5).map(forward)) + .02);
    expect(members.every(unit => distance(unit, infantryFormationGoal(state, unit)!) < .02)).toBe(true);
  });

  it('fills a ranged casualty with a ranged replacement without moving surviving assigned slots', () => {
    const { state, leader, members } = fixture();
    const fallen = members.find(unit => unit.kind === 'archer')!, previous = structuredClone(leader.infantryFormation!.slots);
    fallen.hp = 0;
    const replacement = { ...fallen, id: 500, hp: 100 }; entityStore(state).units.add(replacement);
    step(state);
    for (const old of previous) expect(leader.infantryFormation!.slots.find(slot => slot.id === (old.id === fallen.id ? replacement.id : old.id)))
      .toEqual({ ...old, id: old.id === fallen.id ? replacement.id : old.id });
  });

  it('rebalances only incompatible ranks when soldiers change between melee and ranged roles', () => {
    const { state, leader, members } = fixture();
    const original = structuredClone(leader.infantryFormation!.slots);
    const front = [...original].filter(slot => members.find(unit => unit.id === slot.id)!.kind !== 'archer').sort((a, b) => b.x - a.x)[0];
    const rear = original.find(slot => members.find(unit => unit.id === slot.id)!.kind === 'archer')!;
    const newArcher = members.find(unit => unit.id === front.id)!, newWarrior = members.find(unit => unit.id === rear.id)!;
    newArcher.kind = 'archer'; newArcher.range = 4;
    newWarrior.kind = 'warrior'; newWarrior.range = 1.1;
    step(state);
    for (const slot of original.filter(slot => slot.id !== front.id && slot.id !== rear.id))
      expect(leader.infantryFormation!.slots.find(current => current.id === slot.id)).toEqual(slot);
    expect(leader.infantryFormation!.slots.find(slot => slot.id === newArcher.id)!.x).toBeLessThan(0);
    expect(leader.infantryFormation!.slots.find(slot => slot.id === newWarrior.id)!.x).toBe(front.x);
  });

  it.each([4, 6, 12, 24])('keeps %i escorts symmetric about the Leader with distinct tight slots', count => {
    const offsets = infantryRectangleOffsets(count);
    expect(offsets.reduce((sum, point) => sum + point.x, 0)).toBeCloseTo(0);
    expect(offsets.reduce((sum, point) => sum + point.y, 0)).toBeCloseTo(0);
    expect(new Set(offsets.map(point => `${point.x},${point.y}`)).size).toBe(count);
  });

  it('moves mixed troops at 105% of the common infantry pace and caps every catch-up step', () => {
    const { state, leader, members } = fixture(), start = { ...leader };
    for (let i = 0; i < 20; i++) {
      const old = members.map(unit => ({ ...unit })); step(state, { ...idle, up: true });
      members.forEach((unit, index) => expect(distance(unit, old[index])).toBeLessThanOrEqual(3.3 * 1.05 * 1.25 * .05 + 1e-7));
    }
    expect(leader.x - start.x).toBeCloseTo(3.3 * 1.05, 5); expect(leader.y).toBe(start.y);
    expect(members.every(unit => distance(unit, infantryFormationGoal(state, unit)!) < .1)).toBe(true);
  });

  it('strafes and reverses in local space, stops on release, and wheels without teleporting', () => {
    const { state, leader, members } = fixture(), start = { ...leader };
    run(state, 1, { ...idle, right: true }); expect(leader.x).toBe(start.x); expect(leader.y - start.y).toBeCloseTo(3.465); expect(leader.facing).toBe(0);
    const stopped = { ...leader }; run(state, 1); expect(distance(leader, stopped)).toBe(0);
    run(state, 1, { ...idle, down: true }); expect(leader.x - start.x).toBeCloseTo(-3.465); expect(leader.facing).toBe(0);
    run(state, .1); const center = { ...leader };
    for (let i = 0; i < 20; i++) {
      const old = members.map(unit => ({ ...unit })); step(state, { ...idle, turnRight: true });
      members.forEach((unit, index) => expect(distance(unit, old[index])).toBeLessThanOrEqual(3.465 * 1.25 * .05 + 1e-7));
    }
    expect(distance(leader, center)).toBe(0); expect(leader.facing).toBeCloseTo(1.25);
    run(state, 2); expect(leader.facing).toBeCloseTo(1.25);
    expect(members.every(unit => distance(unit, infantryFormationGoal(state, unit)!) < .04)).toBe(true);
  });

  it('holds the chosen angle after releasing rotation during a click march and cancels opposed turn keys', () => {
    const { state, leader } = fixture(); leader.destination = { x: 35.5, y: 14.5 };
    run(state, .4, { ...idle, turnRight: true }); const heading = leader.facing;
    expect(heading).toBeCloseTo(.5); run(state, 1); expect(leader.facing).toBe(heading);
    run(state, .4, { ...idle, turnLeft: true, turnRight: true }); expect(leader.facing).toBe(heading);
    run(state, .2, { ...idle, turnLeft: true }); expect(leader.facing).toBeCloseTo(.25);
    const released = leader.facing; run(state, 1); expect(leader.facing).toBe(released);
  });

  it('adjusts just one blocked outer soldier and restores its slot when the obstacle is cleared', () => {
    const { state, leader, members } = fixture(); step(state);
    const affected = members.find(unit => Math.abs(unit.x - leader.x) < .01 && Math.abs(unit.y - (leader.y - 1.44)) < .01)!;
    const nominal = { ...infantryFormationGoal(state, affected)! }, others = members.filter(unit => unit !== affected).map(unit => ({ unit, point: { x: unit.x, y: unit.y } }));
    // The house's edge grazes this one outer body; start it just outside that
    // edge, as actual placement would not create a structure through a person.
    affected.y += .25;
    entityStore(state).buildings.add({ id: 2000, kind: 'house', faction: 0, x: 8, y: 12, hp: 100, maxHp: 100, capacity: 4 });
    markWorldChanged(state.world, 'structure'); run(state, 3);
    expect(distance(infantryFormationGoal(state, affected)!, nominal)).toBeGreaterThan(.1);
    expect(others.every(({ unit, point }) => distance(unit, point) < .001 && distance(infantryFormationGoal(state, unit)!, point) < .001)).toBe(true);
    entityStore(state).buildings.retain(building => building.id !== 2000); markWorldChanged(state.world, 'structure'); run(state, 2);
    expect(distance(affected, nominal)).toBeLessThan(.01); expect(leader.infantryFormation!.mode).toBe('rectangle');
    expect(others.every(({ unit, point }) => distance(unit, point) < .001)).toBe(true);
  });

  it.each(['gate', 'winding', 'urban'] as const)('threads a mixed army through %s terrain and reforms without idle milling', scenario => {
    const { state, leader, members } = fixture(12, scenario); leader.destination = { x: 35.5, y: scenario === 'winding' ? 18.5 : 14.5 };
    const destination = { ...leader.destination }; let compressed = false;
    for (let i = 0; i < 1800; i++) {
      step(state); compressed ||= leader.infantryFormation!.mode === 'column';
      for (const unit of [leader, ...members]) expect(infantryPointClear(state, unit, 0)).toBe(true);
    }
    expect(compressed).toBe(true); expect(distance(leader, destination)).toBeLessThan(.03);
    expect(leader.infantryFormation!.mode).toBe('rectangle');
    expect(members.every(unit => distance(unit, infantryFormationGoal(state, unit)!) < .04)).toBe(true);
    const rest = members.map(unit => ({ ...unit })); run(state, 5);
    expect(members.every((unit, index) => distance(unit, rest[index]) < .001)).toBe(true);
  });

  it('moves and reforms a 24-soldier force through a one-tile gate', () => {
    const { state, leader, members } = fixture(24, 'gate'); leader.destination = { x: 35.5, y: 14.5 };
    run(state, 100); expect(leader.x).toBeCloseTo(35.5, 2); expect(leader.infantryFormation!.mode).toBe('rectangle');
    expect(members.every(unit => distance(unit, infantryFormationGoal(state, unit)!) < .04)).toBe(true);
    const snapshots = state.units.map(unit => ({ ...unit })), started = performance.now(); run(state, 30);
    console.info('24-soldier stationary drill milliseconds/update:', (performance.now() - started) / 600);
    expect(state.units.every((unit, index) => distance(unit, snapshots[index]) < .001)).toBe(true);
  });

  it('ignores only participating friendly collision pairs', () => {
    const { state, leader, members } = fixture(8); step(state);
    expect(unitObstructs(members[0], members[1])).toBe(false); expect(unitObstructs(members[0], leader)).toBe(false);
    const enemy = soldier(50, 9.5, 14.5, 'warrior', 1), guard = soldier(51, 9.5, 14.5, 'militia');
    expect(unitObstructs(members[0], enemy)).toBe(true); expect(unitObstructs(members[0], guard)).toBe(true);
    expect(unitsCollide({ kind: 'warrior' }, { kind: 'warrior' })).toBe(true);
    toggleInfantryFormation(state); expect(unitObstructs(members[0], members[1])).toBe(true);
  });

  it('uses the real unit loop without archers evading or changing orientation', () => {
    const { state, leader, members } = fixture(8);
    const enemy = soldier(90, 8.5, 18.2, 'warrior', 1); enemy.order = 'hold'; enemy.speed = 0; entityStore(state).units.add(enemy);
    state.factions.push({ ...state.factions[0], id: 1, relation: 'war', nextRetinueAt: 1e9 });
    for (let i = 0; i < 20; i++) updateGame(state, .05, idle);
    expect(leader.facing).toBe(0); expect(members.every(unit => unit.facing === 0)).toBe(true);
    expect(members.every(unit => distance(unit, infantryFormationGoal(state, unit)!) < .04)).toBe(true);
  });
});

describe('frontal sector eligibility', () => {
  it.each([[infantryAttackMultiplier, 1.25], [infantryDefenseMultiplier, 1.5]] as const)('applies %s only in the 120-degree front and withholds bonuses from detached recruits', (multiplier, bonus) => {
    const { state, members } = fixture(8); step(state); const unit = members[0];
    for (const angle of [0, Math.PI / 3, -Math.PI / 3]) expect(multiplier(state, unit, { x: unit.x + Math.cos(angle), y: unit.y + Math.sin(angle) })).toBe(bonus);
    for (const angle of [Math.PI / 3 + .01, Math.PI / 2, Math.PI]) expect(multiplier(state, unit, { x: unit.x + Math.cos(angle), y: unit.y + Math.sin(angle) })).toBe(1);
    unit.x -= 10; expect(multiplier(state, unit, { x: unit.x + 1, y: unit.y })).toBe(1);
  });
});
