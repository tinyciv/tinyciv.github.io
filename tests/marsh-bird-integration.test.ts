import { describe, expect, it } from 'vitest';
import { createGame, migrateGame, updateGame } from '../src/game/simulation';
import { selectionSummary } from '../src/ui/selection-summary';
import { generateWorld } from '../src/world/generator';
import { type GameState, type Unit, WATER, tileAt } from '../src/game/types';

describe('marsh birds in the game', () => {
  it('hunts a swimming bird through the real projectile pipeline for exactly 20 food', () => {
    const leader: Unit = { id: 2, kind: 'leader', faction: 0, x: 10.5, y: 10.5, hp: 100, maxHp: 100,
      morale: 100, attack: 25, defense: 0, speed: 3.6, range: 4, order: 'hold', cooldown: 0,
      lastCombat: -60, moving: false, facing: 0, attackTime: 0 };
    const bird: Unit = { ...leader, id: 3, kind: 'marshBird', faction: -3, x: 13.5, y: 10.5,
      hp: 8, maxHp: 8, attack: 0, range: 0, herdId: 1, speed: .75, order: 'wander' };
    const state: GameState = {
      world: { width: 40, height: 30, seed: 'bird-hunt', source: 'test', spawns: [], tiles: Array.from({ length: 1200 }, (_, index) => {
        const x = index % 40, y = Math.floor(index / 40), marsh = x >= 12 && x <= 20 && y >= 7 && y <= 16;
        const water = marsh && (x === 13 || x === 14);
        return { terrain: water ? 'coast' : 'grassland', overlay: 'none', elevation: .1, moisture: .8,
          food: 1, production: 0, gold: 0, variation: .5, marsh: marsh && !water, delta: marsh ? 1 : undefined };
      }) },
      buildings: [{ id: 1, kind: 'palace', faction: 0, x: 5, y: 9, hp: 650, maxHp: 650, capacity: 0,
        governorPermissions: { farms: false, housing: false } }], units: [leader, bird],
      factions: [{ id: 0, name: 'Home', color: '#3988ff', relation: 'self', affinity: 100, food: 50, gold: 100,
        production: 0, population: 5, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 1e9, defeated: false }],
      wildlife: { herds: [{ id: 1, species: 'marshBird', delta: 1, waypoint: { x: 16.5, y: 10.5 }, nextWanderAt: 0 }],
        sequence: 0, nextRespawnAt: 1e9, targetHerds: 0 },
      time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: null, selectedType: null,
      buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'bird-hunt', rngState: 1,
      marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 1 },
    };
    const idle = { up: false, down: false, left: false, right: false };
    updateGame(state, .1, idle);
    expect(WATER.has(tileAt(state.world, bird.x, bird.y)!.terrain)).toBe(true);
    expect(bird.moving).toBe(true);
    expect(state.projectiles?.some(projectile => projectile.target === bird.id)).toBe(true);
    updateGame(state, .8, idle);
    expect(bird.hp).toBe(0);
    expect(state.units).not.toContain(bird);
    expect(state.factions[0].food).toBe(70);
    expect(state.factions[0].gold).toBe(100);
    expect(leader.kills ?? 0).toBe(0);
    expect(state.buildings[0].huntingBonuses).toBeUndefined();
    expect(state.particles.filter(particle => particle.text === '+20 food')).toHaveLength(1);
    updateGame(state, .2, idle);
    expect(state.factions[0].food).toBe(70);
  });

  it('preserves generated flocks when reopening a saved game and describes their hunt reward', () => {
    const state = createGame(generateWorld('ALDER-DELTA', undefined, undefined, { landformFamily: 'river-basin' }));
    const birds = state.units.filter(unit => unit.kind === 'marshBird');
    expect(birds.length).toBeGreaterThan(0);
    const saved = JSON.parse(JSON.stringify(state));
    const loaded = migrateGame(saved);
    expect(loaded.units.filter(unit => unit.kind === 'marshBird').map(unit => ({ id: unit.id, herdId: unit.herdId, x: unit.x, y: unit.y })))
      .toEqual(birds.map(unit => ({ id: unit.id, herdId: unit.herdId, x: unit.x, y: unit.y })));
    const bird = loaded.units.find(unit => unit.id === birds[0].id)!;
    const leader = loaded.units.find(unit => unit.kind === 'leader' && unit.faction === 0)!;
    leader.x = bird.x + .5; leader.y = bird.y;
    loaded.fog = undefined; loaded.selected = bird.id; loaded.selectedType = 'unit';
    const summary = selectionSummary(loaded);
    expect(summary).toMatchObject({ name: 'Marsh bird', picture: 'marshBird' });
    expect(summary?.title).toContain('Hunt: +20 food');
  });
});
