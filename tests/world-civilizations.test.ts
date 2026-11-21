import { describe, expect, it } from 'vitest';
import { CIVILIZATIONS, RIVAL_STARTING_GOLD, STARTING_FACTION_COUNT, OPPOSING_FACTION_COUNT } from '../src/game/civilizations';
import { citySummaries, nextCityName } from '../src/game/cities';
import { createGame } from '../src/game/simulation';
import { hasStaticPath, hasStaticPathBetween } from '../src/game/pathfinding';
import { constructionEdges } from '../src/game/builders';
import { buildingHeight, buildingReady, buildingWidth, isWallKind, tileAt, WATER, type Building } from '../src/game/types';
import { generateWorld } from '../src/world/generator';

describe('six-civilization starting worlds', () => {
  it.each(['CROWN', '42', 'first-light'])('starts five distinct two-city rivals with a funded economy on %s', seed => {
    const world = generateWorld(seed), state = createGame(world);
    expect(world.spawns).toHaveLength(STARTING_FACTION_COUNT);
    expect(world.secondarySpawns).toHaveLength(OPPOSING_FACTION_COUNT);
    const civilizations = state.factions.filter(faction => faction.villageId === undefined);
    expect(civilizations.map(faction => faction.name)).toEqual(CIVILIZATIONS.slice(0, STARTING_FACTION_COUNT).map(civilization => civilization.name));
    expect(new Set(civilizations.map(faction => faction.color)).size).toBe(STARTING_FACTION_COUNT);
    const palaces = state.buildings.filter(building => building.kind === 'palace' && building.faction >= 0);
    expect(palaces).toHaveLength(STARTING_FACTION_COUNT + OPPOSING_FACTION_COUNT);
    expect(new Set(palaces.map(palace => palace.cityName)).size).toBe(STARTING_FACTION_COUNT + OPPOSING_FACTION_COUNT);
    const cities = citySummaries(state);
    for (const faction of civilizations) {
      const towns = cities.filter(city => city.palace.faction === faction.id);
      expect(towns).toHaveLength(faction.id === 0 ? 1 : 2);
      expect(towns.map(city => city.name)).toEqual(CIVILIZATIONS[faction.id].cities.slice(0, towns.length));
      expect(towns.every(city => city.population === (faction.id === 0 ? 20 : 5) && city.housing >= city.population)).toBe(true);
      expect(faction.population).toBe(faction.id === 0 ? 20 : 10);
      expect(faction.gold).toBe(faction.id === 0 ? 300 : RIVAL_STARTING_GOLD);
      if (towns.length === 2) {
        const [first, second] = towns.map(town => town.palace);
        expect(hasStaticPath(state, { x: first.x - .5, y: first.y + .5 },
          { x: second.x - .5, y: second.y + .5 }, faction.id), `${faction.name}: connected city road loops`).toBe(true);
      }
      const rng = state.rngState;
      expect(nextCityName(state, faction.id)).toBe(CIVILIZATIONS[faction.id].cities[towns.length]);
      expect(state.rngState).toBe(rng);
    }
    const libraries = state.buildings.filter(building => building.kind === 'library' && building.faction === 0);
    expect(libraries).toHaveLength(1);
    const [library] = libraries, capital = palaces.find(palace => palace.faction === 0)!;
    const libraryDistance = Math.hypot(library.x - capital.x, library.y - capital.y);
    expect(buildingReady(library)).toBe(true);
    expect(libraryDistance).toBeGreaterThanOrEqual(3);
    expect(libraryDistance).toBeLessThanOrEqual(5);
    expect(hasStaticPathBetween(state, constructionEdges(state, capital), constructionEdges(state, library), 0)).toBe(true);
    const occupied = new Map<number, Building>();
    for (const building of state.buildings.filter(building => building.faction >= 0)) {
      for (let y = building.y; y < building.y + buildingHeight(building); y++)
        for (let x = building.x; x < building.x + buildingWidth(building); x++) {
          const tile = tileAt(world, x, y), index = y * world.width + x;
          expect(tile).toBeDefined();
          expect(WATER.has(tile!.terrain)).toBe(false);
          const previous = occupied.get(index);
          // Owned road + wall is the intentional physical gate layer. Every
          // other pair still has to reserve a disjoint starting footprint.
          const gate = previous && previous.faction === building.faction
            && (previous.kind === 'road' && isWallKind(building.kind) || building.kind === 'road' && isWallKind(previous.kind));
          expect(!!previous && !gate, `overlapping ${building.kind} at ${x},${y}`).toBe(false);
          occupied.set(index, building);
        }
    }
  }, 120_000); // Full faction/camp initialization is a correctness check, not a CPU benchmark.

  it('keeps six factions and eleven non-overlapping palaces on a small development map', () => {
    const state = createGame(generateWorld('small', 64, 64));
    expect(state.factions.filter(faction => faction.villageId === undefined)).toHaveLength(STARTING_FACTION_COUNT);
    const palaces = state.buildings.filter(building => building.kind === 'palace');
    expect(palaces).toHaveLength(STARTING_FACTION_COUNT + OPPOSING_FACTION_COUNT);
    for (let i = 0; i < palaces.length; i++) for (let j = 0; j < i; j++)
      expect(Math.max(Math.abs(palaces[i].x - palaces[j].x), Math.abs(palaces[i].y - palaces[j].y))).toBeGreaterThanOrEqual(2);
  });
});
