import { describe, expect, it } from 'vitest';
import { createGame, createDuelGame, moveUnit, updateGame } from '../src/game/simulation';
import { RIVAL_STARTING_GOLD } from '../src/game/civilizations';
import { entityStore } from '../src/game/entity-store';
import { factionAIProfile, setFactionAIProfile } from '../src/game/faction-ai-profile';
import { updateFactionStrategies, getFactionStrategy } from '../src/game/faction-strategy';
import { prepareFactionArmy } from '../src/game/faction-military';
import { hasStaticPath } from '../src/game/pathfinding';
import { constructionEdges, notifyRepairJobChanged, updateBuilder } from '../src/game/builders';
import { factionCityTowers } from '../src/game/faction-tower-layout';
import { type GameState, type Unit, type World } from '../src/game/types';
import { withDevelopedResources } from './helpers/developed-resources';

function world(): World {
  return { width: 84, height: 64, seed: 'fortified-ai', source: 'test', revision: 0,
    spawns: [{ x: 12, y: 30 }, { x: 64, y: 44 }], secondarySpawns: [{ x: 64, y: 14 }],
    tiles: Array.from({ length: 84 * 64 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
      moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) };
}
function soldier(id: number, x: number, y: number): Unit {
  return { id, kind: 'warrior', faction: 1, x, y, hp: 100, maxHp: 100, morale: 100, attack: 20, defense: 5,
    speed: 3.96, range: 1.1, order: 'follow', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 };
}
function army(): GameState {
  const state = createGame(world());
  entityStore(state).buildings.retain(building => building.kind === 'palace' && !building.villageId);
  const palace = state.buildings.find(building => building.faction === 1)!;
  entityStore(state).units.replace([
    { ...soldier(9001, 60.5, 39.5), kind: 'leader', range: 4 },
    ...Array.from({ length: 8 }, (_, i) => soldier(9010 + i, 59.5 + i % 3, 39.5 + Math.floor(i / 3))),
  ]);
  const faction = state.factions[1]; faction.nextRaid = 0; faction.relation = 'war';
  faction.research = { focus: 'infantryDrill', levels: { infantryDrill: 1 }, progress: {} };
  state.units[0].home = palace.id;
  return state;
}
const queries = { hostile: (a: number, b: number) => a !== b, visible: () => true };

describe('fortified, coordinated faction AI', () => {
  it('grants exactly 100 additional gold and four separate gated tower enclosures to each rival city', () => {
    const state = createGame(world());
    expect(RIVAL_STARTING_GOLD).toBe(1600);
    expect(state.factions[1].gold).toBe(1600);
    expect(state.factions[0].gold).toBe(500);
    const cities = state.buildings.filter(building => building.faction === 1 && building.kind === 'palace');
    expect(cities).toHaveLength(2);
    for (const city of cities) {
      const walls = state.buildings.filter(building => building.faction === 1 && building.kind === 'palisade'
        && Math.abs(building.x - city.x) <= 11 && Math.abs(building.y - city.y) <= 11);
      const towers = factionCityTowers(state, city);
      expect(walls).toHaveLength(32);
      expect(towers).toHaveLength(4);
      expect(walls.every(building => building.hp === building.maxHp && !building.construction)).toBe(true);
      const gates = walls.filter(wall => state.buildings.some(road => road.kind === 'road' && road.x === wall.x && road.y === wall.y));
      expect(gates).toHaveLength(4);
      for (const tower of towers) {
        expect(walls.filter(wall => Math.max(Math.abs(wall.x - tower.x), Math.abs(wall.y - tower.y)) === 1)).toHaveLength(8);
        const contacts = constructionEdges(state, tower);
        expect(contacts).toHaveLength(1);
        expect(constructionEdges(state, city).some(exit => hasStaticPath(state, exit, contacts[0], 1))).toBe(true);
        expect(hasStaticPath(state, { x: city.x - .5, y: city.y + .5 }, contacts[0], 0)).toBe(false);
      }
      expect(walls.every(wall => towers.filter(tower => Math.max(Math.abs(wall.x - tower.x), Math.abs(wall.y - tower.y)) === 1).length === 1)).toBe(true);
      expect(hasStaticPath(state, { x: city.x - .5, y: city.y + .5 }, { x: city.x - 6.5, y: city.y + .5 }, 1)).toBe(true);
      expect(hasStaticPath(state, { x: city.x - 6.5, y: city.y + .5 }, { x: city.x - .5, y: city.y + .5 }, 0)).toBe(true);
    }
    expect(state.buildings.some(building => building.faction === 0 && building.kind === 'palisade')).toBe(false);
  });

  it('keeps human duel starts equal and without AI grants', () => {
    const state = createDuelGame(world());
    expect(state.factions.map(faction => faction.gold)).toEqual([500, 500]);
    expect(state.buildings.some(building => building.faction >= 0 && ['palisade', 'woodenTower'].includes(building.kind))).toBe(false);
  });

  it('sends real civilians through each tower gate to repair and return home', () => {
    const state = createGame(world(), undefined, { banditIntensity: 0 });
    const towers = state.buildings.filter(building => building.kind === 'woodenTower' && building.faction === 1);
    const workers = state.units.filter(unit => unit.builder && unit.faction === 1);
    entityStore(state).units.replace(workers);
    for (const tower of towers) { tower.hp = tower.maxHp / 2; tower.lastAttacked = -100; notifyRepairJobChanged(state, tower); }
    const repairedAt = new Set<number>();
    for (let step = 0; step < 1600; step++) {
      state.time += .1;
      for (const worker of workers) {
        updateBuilder(state, worker, .1, moveUnit);
        if (worker.buildPhase === 'repairing' && worker.repairSite !== undefined) {
          repairedAt.add(worker.repairSite);
          const tower = towers.find(tower => tower.id === worker.repairSite)!;
          expect(constructionEdges(state, tower).some(point => Math.hypot(point.x - worker.x, point.y - worker.y) < .7)).toBe(true);
        }
      }
    }
    expect(repairedAt.size).toBe(8);
    expect(towers.every(tower => tower.hp === tower.maxHp)).toBe(true);
    expect(workers.every(worker => worker.inside)).toBe(true);
  });

  it('continues opening housing, food and population development while paying four towers per city', () => {
    const state = createGame(world(), undefined, { banditIntensity: 0 }), faction = state.factions[1];
    for (const realm of state.factions) { realm.nextRaid = Infinity; if (realm.id) realm.relation = 'peace'; }
    const startingPopulation = faction.population;
    const productive = () => state.buildings.filter(building => building.faction === 1 && ['house', 'camp', 'library'].includes(building.kind) && building.hp > 0).length;
    const initialProductive = productive();
    const idle = { up: false, down: false, left: false, right: false };
    for (let step = 0; step < 900; step++) updateGame(state, .2, idle);
    expect(faction.population).toBeGreaterThan(startingPopulation);
    expect(productive()).toBeGreaterThan(initialProductive);
    expect(faction.gold).toBeGreaterThan(0);
    expect(state.buildings.filter(building => building.faction === 1 && building.kind === 'woodenTower')).toHaveLength(8);
    expect(state.buildings.filter(building => building.faction === 1 && building.kind === 'palisade')).toHaveLength(64);
  }, 60000);

  it('orders an eligible researched army into an attacking formation and releases it to retreat', () => {
    const state = army(), leader = state.units[0];
    updateFactionStrategies(state, queries);
    expect(factionAIProfile(state, 1)).toBe('coordinated');
    expect(getFactionStrategy(state, 1)?.mode).toBe('attack');
    expect(leader.infantryFormation?.active).toBe(true);
    expect(leader.destination).toBeDefined();
    expect(getFactionStrategy(state, 1)?.escortIds).toHaveLength(8);
    leader.hp = 50; state.time = .1;
    updateFactionStrategies(state, queries);
    expect(getFactionStrategy(state, 1)?.mode).toBe('recover');
    expect(leader.infantryFormation?.active).toBe(false);
    expect(leader.destination).toBeUndefined();
  });

  it('does not grant formations before research or in the legacy comparison policy', () => {
    const state = army(), leader = state.units[0];
    state.factions[1].research = undefined;
    updateFactionStrategies(state, queries);
    expect(leader.infantryFormation?.active).not.toBe(true);
    state.factions[1].research = { focus: 'infantryDrill', levels: { infantryDrill: 1 }, progress: {} };
    setFactionAIProfile(state, 1, 'legacy'); state.time = 2;
    updateFactionStrategies(state, queries);
    expect(leader.infantryFormation?.active).not.toBe(true);
  });

  it('spends earned skill points and buys equipment only with treasury and physical access', () => {
    const state = army(), leader = state.units[0], faction = state.factions[1];
    withDevelopedResources(state, ['iron'], 1);
    const palace = state.buildings.find(building => building.id === leader.home)!;
    Object.assign(leader, { x: palace.x - .5, y: palace.y + .5,
      leaderProgression: { level: 3, xp: 0, skillPoints: 2, skills: { power: 0, guard: 0, command: 0 } } });
    entityStore(state).buildings.add({ id: 9990, kind: 'blacksmith', faction: 1, x: palace.x - 3, y: palace.y,
      hp: 200, maxHp: 200, capacity: 0 });
    faction.gold = 5000;
    prepareFactionArmy(state, leader, palace);
    expect(leader.leaderProgression?.skillPoints).toBe(0);
    expect(leader.leaderProgression?.skills.command).toBe(2);
    expect(faction.weaponLevel).toBe(1);
    expect(faction.gold).toBe(4800);
    expect(state.units.every(unit => unit.weaponLevel === 1)).toBe(true);
    leader.x -= 30;
    prepareFactionArmy(state, leader, palace);
    expect(faction.gold).toBe(4800);
  });
});
