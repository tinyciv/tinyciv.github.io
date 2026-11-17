import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { cancellationRefund, constructionProgress } from '../src/game/construction-cancellation';
import { runConstructionRule } from '../src/game/construction-native';
import { rustEngine } from '../src/game/rust-engine';
import { CONSTRUCTION_SECONDS, updateActiveConstruction, updateConstructionResearch } from '../src/game/structures';
import type { Building, BuildingKind, GameState, Unit } from '../src/game/types';

function fixture(kind: BuildingKind = 'house') {
  const site: Building = { id: 100, kind, faction: 0, x: 10, y: 10, hp: 1, maxHp: 160, capacity: 2,
    construction: { startedAt: 0, duration: 20, healthProgress: 1 / 160, waitingForBuilder: false, builderId: 200, cleared: true, paidGold: 42.25 } };
  const worker: Unit = { id: 200, kind: 'worker', faction: 0, x: 9.5, y: 10.5, hp: 50, maxHp: 50,
    morale: 100, attack: 0, defense: 0, speed: 2.2, range: 1.1, order: 'work', cooldown: 0,
    lastCombat: -60, lastDamagedAt: -60, moving: false, facing: 0, attackTime: 0,
    builder: true, buildSite: site.id, home: 1, buildPhase: 'working', inside: false };
  const state: GameState = { world: { width: 24, height: 24, seed: 'rust-sites', source: 'test', spawns: [], revision: 0,
    tiles: Array.from({ length: 576 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
      moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 2, y: 4, hp: 650, maxHp: 650, capacity: 4 }, site], units: [worker],
    factions: [{ id: 0, name: 'Test', color: '#f00', affinity: 100, relation: 'self', food: 500, gold: 1000,
      culture: 150, production: 0, population: 5, yields: { food: 0, production: 0, gold: 0 }, nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'rust-sites', rngState: 1 };
  return { state, site, worker };
}

describe('resident Rust construction lifecycle', () => {
  it('completes at the exact work deadline and publishes construction role removal once', () => {
    const { state, site } = fixture();
    state.time = 20 - 2e-7;
    expect(updateActiveConstruction(state)).toBe(false);
    expect(site.construction).toBeDefined();
    state.time = 20 - 5e-8;
    expect(updateActiveConstruction(state)).toBe(true);
    expect(site.construction).toBeUndefined();
    expect(entityStore(state).buildings.query('construction')).not.toContain(site);
    const revision = state.world.revision;
    expect(updateActiveConstruction(state)).toBe(false);
    expect(state.world.revision).toBe(revision);
  });

  it('pauses an absent worker and resumes its saved work only on a real arrival', () => {
    const { state, site, worker } = fixture();
    worker.x = 8.5; state.time = 5;
    expect(updateActiveConstruction(state)).toBe(false);
    expect(site.construction).toMatchObject({ startedAt: 0, pausedAt: 5, waitingForBuilder: true, builderId: worker.id, cleared: false });
    worker.x = 9.5; state.time = 30;
    updateActiveConstruction(state);
    expect(site.construction).toMatchObject({ startedAt: 0, pausedAt: 5, waitingForBuilder: true });
    runConstructionRule(state, site, 4, { arrivingBuilder: worker.id });
    expect(site.construction).toMatchObject({ startedAt: 25, waitingForBuilder: false, builderId: worker.id });
    expect(site.construction!.pausedAt).toBeUndefined();
    expect(updateActiveConstruction(state)).toBe(false);
    state.time = 45;
    expect(updateActiveConstruction(state)).toBe(true);
  });

  it.each(['dead', 'fleeing', 'inside', 'reassigned'] as const)('releases the stale assignment for a %s worker without completing a site', reason => {
    const { state, site, worker } = fixture(); state.time = 30;
    if (reason === 'dead') worker.hp = 0;
    if (reason === 'fleeing') worker.order = 'flee';
    if (reason === 'inside') worker.inside = true;
    if (reason === 'reassigned') worker.buildSite = 1;
    expect(updateActiveConstruction(state)).toBe(false);
    expect(site.construction).toMatchObject({ waitingForBuilder: true, pausedAt: 30, cleared: false });
    expect(site.construction!.builderId).toBeUndefined();
  });

  it('retimes active and queued sites in one research batch while preserving each earned fraction', () => {
    const { state, site } = fixture();
    const queued: Building = { ...site, id: 101, x: 14,
      construction: { startedAt: 4, duration: 20, waitingForBuilder: true, paidGold: 42.25 } };
    entityStore(state).buildings.add(queued);
    state.factions[0].research = { levels: { metalTools: 1 }, progress: {}, focus: 'metalTools' };
    state.time = 10;
    updateConstructionResearch(state);
    expect(site.construction).toMatchObject({ startedAt: 2, duration: 16, researchSpeed: 1.25 });
    expect(queued.construction).toMatchObject({ startedAt: 4, duration: 16, waitingForBuilder: true, researchSpeed: 1.25 });
    expect(constructionProgress(state, site)).toBe(.5);
    expect(constructionProgress(state, queued)).toBe(0);
    expect(cancellationRefund(state, site)).toBe(21.13);
    expect(cancellationRefund(state, queued)).toBe(42.25);
  });

  it('keeps queued footprints open and preserves their full paid price through arbitrarily late checks', () => {
    const { state, site } = fixture();
    site.construction!.waitingForBuilder = true; site.construction!.cleared = false;
    state.time = 10000;
    expect(updateActiveConstruction(state)).toBe(false);
    expect(site.construction).toMatchObject({ startedAt: 0, duration: 20, waitingForBuilder: true, cleared: false });
    expect(constructionProgress(state, site)).toBe(0);
    expect(cancellationRefund(state, site)).toBe(42.25);
  });

  it('applies completed-city scenery and cultural baseline after the native completion event', () => {
    const { state, site } = fixture('palace');
    expect(site.cultureAtFounding).toBeUndefined();
    state.time = 20;
    expect(updateActiveConstruction(state)).toBe(true);
    expect(site.cultureAtFounding).toBe(150);
    expect(state.buildings.filter(building => building.kind === 'road')).toHaveLength(12);
  });

  it('removes a replaced palisade only when its matching wall finishes', () => {
    const { state, site } = fixture('wall');
    const palisade: Building = { id: 101, kind: 'palisade', faction: 0, x: site.x, y: site.y, hp: 56.25, maxHp: 56.25, capacity: 0 };
    site.construction!.replacesPalisade = palisade.id;
    entityStore(state).buildings.add(palisade);
    state.time = 10; updateActiveConstruction(state);
    expect(state.buildings).toContain(palisade);
    state.time = 20; updateActiveConstruction(state);
    expect(state.buildings).not.toContain(palisade);
    expect(state.buildings).toContain(site);
    expect(site.construction).toBeUndefined();
  });

  it('refreshes cached transfer views after native memory growth and accepts direct site edits', () => {
    const { state, site } = fixture(); state.time = 1;
    updateActiveConstruction(state);
    rustEngine.memory.grow(1);
    site.construction!.duration = 2;
    state.time = 2;
    expect(updateActiveConstruction(state)).toBe(true);
    expect(site.construction).toBeUndefined();
    expect(CONSTRUCTION_SECONDS.camp).toBe(3.75);
    expect(CONSTRUCTION_SECONDS.house).toBe(40 / 3);
  });
});
