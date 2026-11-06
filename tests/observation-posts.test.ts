import { describe, expect, it } from 'vitest';
import { scoutRealm } from './helpers/scouts';
import { buildAt, BUILD_COSTS, validateBuildAt, updateGame } from '../src/game/simulation';
import { beginObservationPostRetreat, OBSERVATION_POST_FLEE_SPEED, updateObservationPost, validateObservationPost } from '../src/game/observation-posts';
import { observationPostVisibleTo, observationUnitsForViewer } from '../src/game/observation-visibility';
import { entityStore } from '../src/game/entity-store';
import { cityResidents } from '../src/game/cities';
import { entityVisible, unitSightRadius, updateFog, pointInSight } from '../src/game/fog';
import { withPlayerFaction } from '../src/game/player-context';
import { unitAtPoint } from '../src/game/hit-testing';
import { goldFlowSummary } from '../src/game/gold-ledger';
import { IRRIGATION_OFFSETS, IRRIGATION_RADIUS, irrigationYieldMultiplier } from '../src/game/irrigation';
import { RESEARCH_BRANCHES } from '../src/game/research';
import { unitsCollide } from '../src/game/collisions';
import type { GameState, Unit } from '../src/game/types';

const site = { x: 31.5, y: 16.5 };
function realm(): GameState {
  const state = scoutRealm();
  entityStore(state).buildings.add({ id: 103, kind: 'palace', faction: 0, x: 2, y: 10, hp: 1000, maxHp: 1000, capacity: 4, unhousedResidents: 4 });
  state.factions[0].population = 4;
  state.units[0].x = 30.5; state.units[0].y = 16.5;
  state.factions.push({ ...state.factions[0], id: 1, relation: 'war', population: 0 });
  return state;
}
function deploy(state: GameState): Unit {
  expect(buildAt(state, 'observationPost', site.x, site.y)).toMatchObject({ ok: true });
  return state.units.find(unit => !!unit.observationPost)!;
}
const hostile = (a: number, b: number) => a !== b;
const stationary = () => { throw new Error('An undisrupted post must never issue movement.'); };

describe('concealed observation posts', () => {
  it('deploys instantly with one actual city resident and 20 gold, without replacing the lodge explorers', () => {
    const state = realm(), before = state.factions[0].gold, count = state.buildings.length;
    const post = deploy(state);
    expect(post).toMatchObject({ kind: 'scout', order: 'hold', x: site.x, y: site.y, observationPost: { city: 103, discoveredBy: [] } });
    expect(post.scoutLodge).toBeUndefined();
    expect(state.buildings).toHaveLength(count);
    expect(state.factions[0].gold).toBe(before - 20);
    expect(state.factions[0].population).toBe(3);
    expect(cityResidents(state).find(city => city.palace.id === 103)?.population).toBe(3);
    updateObservationPost(state, post, 1, stationary, hostile);
    expect(unitsCollide(post, state.units[0])).toBe(false);
  });

  it('requires a completed lodge, available population and neutral ground', () => {
    const state = realm(), lodge = state.buildings.find(building => building.kind === 'scoutLodge')!;
    lodge.construction = { duration: 45, startedAt: 0 };
    expect(validateBuildAt(state, 'observationPost', site.x, site.y)).toMatchObject({ ok: false });
    delete lodge.construction;
    state.factions[0].population = 0;
    expect(validateObservationPost(state, 0, site).message).toContain('resident');
    state.factions[0].population = 4;
    expect(validateObservationPost(state, 0, { x: 5.5, y: 11.5 }).message).toContain('outside all borders');
    deploy(state);
    expect(validateBuildAt(state, 'observationPost', site.x, site.y)).toMatchObject({ ok: false });
  });

  it('stays invisible and untargetable in fully observed terrain until an enemy Leader enters its exact tile', () => {
    const state = realm(), post = deploy(state);
    const enemy: Unit = { ...state.units[0], id: 900, kind: 'warrior', faction: 1, x: post.x, y: post.y };
    entityStore(state).units.add(enemy);
    updateObservationPost(state, post, .1, stationary, hostile);
    expect(observationPostVisibleTo(post, 1)).toBe(false);
    withPlayerFaction(state, 1, () => {
      expect(pointInSight(updateFog(state), post.x, post.y)).toBe(true);
      expect(entityVisible(state, post)).toBe(false);
      expect(unitAtPoint(state, post)?.id).not.toBe(post.id);
    });
    enemy.kind = 'leader'; entityStore(state).units.updateRoles(enemy);
    enemy.x = post.x + 1;
    updateObservationPost(state, post, .1, stationary, hostile);
    expect(observationPostVisibleTo(post, 1)).toBe(false);
    enemy.x = post.x;
    updateObservationPost(state, post, .1, stationary, hostile);
    expect(observationPostVisibleTo(post, 1)).toBe(true);
    expect(observationPostVisibleTo(post, 2)).toBe(false);
    withPlayerFaction(state, 1, () => expect(entityVisible(state, post)).toBe(true));
    expect(state.units.filter(unit => observationPostVisibleTo(unit, 2))).not.toContain(post);
  });

  it('rejects stale melee/projectile targets while concealed, and awards exactly 20 gold when killed after discovery', () => {
    const state = realm(), post = deploy(state);
    state.victoryContinued = true;
    for (const unit of state.units) unit.attack = 0;
    post.faction = 1;
    const shooter = state.units[0];
    entityStore(state).units.add({ ...shooter, id: 901, kind: 'warrior', attack: 1000, range: 1.1, speed: 0,
      x: post.x - 1, y: post.y, target: post.id, order: 'hold' });
    shooter.target = post.id;
    const shot = () => ({ attacker: shooter.id, faction: 0, target: post.id, damage: 1000, x: post.x - 1, y: post.y,
      start: { x: post.x - 1, y: post.y }, end: { x: post.x, y: post.y }, elapsed: 0, duration: .01 });
    state.projectiles = [shot()];
    updateGame(state, .05, { up: false, down: false, left: false, right: false });
    expect(post.hp).toBe(100);
    post.observationPost!.discoveredBy.push(0);
    state.projectiles = [shot()];
    updateGame(state, .05, { up: false, down: false, left: false, right: false });
    expect(post.hp).toBe(0);
    expect(goldFlowSummary(state, state.factions[0]).inputs).toContainEqual({ category: 'loot', label: 'Loot', amount: 20 });
  });

  it('does not deploy a stranded lookout with no walking route home', () => {
    const state = realm();
    for (let y = 0; y < state.world.height; y++) state.world.tiles[y * state.world.width + 20].terrain = 'river';
    state.world.revision!++;
    expect(validateBuildAt(state, 'observationPost', site.x, site.y).message).toContain('walking route');
  });

  it('omits the entire hidden scout and platform identity from multiplayer snapshots and frame state', () => {
    const state = realm(), post = deploy(state);
    const enemySnapshot = { ...state, units: observationUnitsForViewer(state.units, 1) };
    const { world: _world, ...enemyFrame } = enemySnapshot;
    for (const payload of [enemySnapshot, enemyFrame]) {
      const received = JSON.parse(JSON.stringify(payload));
      expect(received.units.some((unit: Unit) => unit.id === post.id)).toBe(false);
      expect(JSON.stringify(received)).not.toContain('observationPost');
    }
    expect(observationUnitsForViewer(state.units, 0)).toContain(post);
    post.observationPost!.discoveredBy.push(1);
    expect(observationUnitsForViewer(state.units, 1)).toContain(post);
  });

  it('also recognizes marauder Leaders, without revealing to unrelated factions', () => {
    const state = realm(), post = deploy(state);
    const enemy: Unit = { ...state.units[0], id: 900, kind: 'warrior', faction: -2, marauderLeader: true, x: post.x, y: post.y };
    entityStore(state).units.add(enemy);
    updateObservationPost(state, post, .1, stationary, hostile);
    expect(post.observationPost?.discoveredBy).toEqual([-2]);
    expect(observationPostVisibleTo(post, 1)).toBe(false);
  });

  it('has 3x scout sight and charges 3 gold per 30 seconds in the gold ledger', () => {
    const state = realm(), post = deploy(state);
    expect(unitSightRadius(post)).toBe(unitSightRadius({ kind: 'scout' }) * 3);
    const before = state.factions[0].gold;
    state.time = 29.99; updateObservationPost(state, post, 0, stationary, hostile);
    expect(state.factions[0].gold).toBe(before);
    state.time = 30; updateObservationPost(state, post, 0, stationary, hostile);
    expect(state.factions[0].gold).toBe(before - 3);
    state.time = 91; updateObservationPost(state, post, 0, stationary, hostile);
    expect(state.factions[0].gold).toBe(before - 9);
    expect(goldFlowSummary(state, state.factions[0]).outlays).toContainEqual({ category: 'defenses', label: 'Defenses', amount: 6 });
  });

  it('emits only a displaced five-tile smoke hint every sixty seconds', () => {
    const state = realm(), post = deploy(state);
    state.time = 59.99; updateObservationPost(state, post, 0, stationary, hostile);
    expect(state.observationSmoke).toBeUndefined();
    state.time = 60; updateObservationPost(state, post, 0, stationary, hostile);
    const smoke = state.observationSmoke![0];
    expect(Math.hypot(smoke.x - post.x, smoke.y - post.y)).toBeGreaterThan(2);
    expect(Math.hypot(smoke.x - post.x, smoke.y - post.y)).toBeLessThanOrEqual(5);
    expect(Object.keys(smoke).sort()).toEqual(['faction', 'startedAt', 'x', 'y']);
    expect(post.observationPost?.nextSmokeAt).toBe(120);
  });

  it('abandons the platform on attack and returns its resident to a reachable city once, with 30% faster flight', () => {
    const state = realm(), post = deploy(state), before = state.factions[0].population;
    beginObservationPostRetreat(post);
    expect(post.observationPost?.retreating).toBeUndefined();
    post.observationPost!.discoveredBy.push(1); post.hp -= 10;
    beginObservationPostRetreat(post);
    expect(post.observationPost?.retreating).toBe(true);
    expect(post.speed).toBe(OBSERVATION_POST_FLEE_SPEED);
    expect(unitSightRadius(post)).toBe(7);
    expect(observationPostVisibleTo(post, 2)).toBe(true);
    updateObservationPost(state, post, 1, (_state, unit, goal) => { unit.x = goal.x; unit.y = goal.y; }, hostile);
    updateObservationPost(state, post, 1, stationary, hostile);
    expect(state.factions[0].population).toBe(before + 1);
    expect(state.units).not.toContain(post);
    expect(cityResidents(state).find(city => city.palace.id === 103)?.population).toBe(4);
    expect(updateObservationPost(state, post, 1, stationary, hostile)).toBe(false);
  });
});

describe('scouting and irrigation rebalance', () => {
  it('halves the lodge and Exploration costs and reduces irrigation by 30%', () => {
    expect(BUILD_COSTS.scoutLodge.gold).toBe(100);
    expect(RESEARCH_BRANCHES.find(branch => branch.id === 'scoutLodge')!.tiers[0].points).toBe(25);
    expect(BUILD_COSTS.irrigation.gold).toBe(35);
  });
  it('uses a symmetric two-tile irrigation radius for both yields and preview offsets', () => {
    const state = realm();
    entityStore(state).buildings.add({ id: 200, kind: 'irrigation', faction: 0, x: 20, y: 20, hp: 100, maxHp: 100, capacity: 0 });
    expect(IRRIGATION_RADIUS).toBe(2); expect(IRRIGATION_OFFSETS).toHaveLength(13);
    for (const [x, y] of IRRIGATION_OFFSETS) expect(IRRIGATION_OFFSETS).toContainEqual([-x || 0, -y || 0]);
    expect(irrigationYieldMultiplier(state, 22, 20)).toBe(2);
    expect(irrigationYieldMultiplier(state, 23, 20)).toBe(1);
    expect(irrigationYieldMultiplier(state, 20, 18)).toBe(2);
  });
});
