import { describe, expect, it } from 'vitest';
import { CIVILIZATIONS, RIVAL_STARTING_GOLD, STARTING_FACTION_COUNT, OPPOSING_FACTION_COUNT } from '../src/game/civilizations';
import { citySummaries, nextCityName } from '../src/game/cities';
import { createGame } from '../src/game/simulation';
import { hasStaticPath } from '../src/game/pathfinding';
import { buildingHeight, buildingWidth, isWallKind, tileAt, WATER, type Building } from '../src/game/types';
import { generateWorld } from '../src/world/generator';
import { harmonizeRidgeTerrain, ridgeStatistics } from '../src/world/ridges';

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
      expect(faction.gold).toBe(faction.id === 0 ? 500 : RIVAL_STARTING_GOLD);
      if (towns.length === 2) {
        const [first, second] = towns.map(town => town.palace);
        expect(hasStaticPath(state, { x: first.x - .5, y: first.y + .5 },
          { x: second.x - .5, y: second.y + .5 }, faction.id), `${faction.name}: connected city road loops`).toBe(true);
      }
      const rng = state.rngState;
      expect(nextCityName(state, faction.id)).toBe(CIVILIZATIONS[faction.id].cities[towns.length]);
      expect(state.rngState).toBe(rng);
    }
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
    const ridges = ridgeStatistics(state.world);
    expect(ridges.raised / ridges.land).toBeGreaterThan(.01);
    expect(ridges.raised / ridges.land).toBeLessThanOrEqual(.12);
    const palaces = state.buildings.filter(building => building.kind === 'palace');
    expect(palaces).toHaveLength(STARTING_FACTION_COUNT + OPPOSING_FACTION_COUNT);
    for (let i = 0; i < palaces.length; i++) for (let j = 0; j < i; j++)
      expect(Math.max(Math.abs(palaces[i].x - palaces[j].x), Math.abs(palaces[i].y - palaces[j].y))).toBeGreaterThanOrEqual(2);
  });
});

describe('uniform ledge surroundings', () => {
  it.each(['CROWN', '42', 'first-light'])('has one grass/desert palette through each two-cell apron on %s', seed => {
    const world = generateWorld(seed);
    expect(world.tiles.some(tile => tile.ridge)).toBe(true);
    for (let i = 0; i < world.tiles.length; i++) {
      const tile = world.tiles[i];
      if (!tile.ridge) continue;
      if (WATER.has(tile.terrain)) {
        expect(tile.terrain).toBe('river'); expect(tile.riverArt).toBe('banked'); continue;
      }
      // Ledge aprons also support the current plains and polar ground palettes.
      expect(['grassland', 'desert', 'plains', 'tundra']).toContain(tile.terrain);
      const x = i % world.width, y = Math.floor(i / world.width);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const neighbor = tileAt(world, x + dx, y + dy)!;
        // River canyons intentionally cut the dry apron; water must retain its own palette.
        if (!WATER.has(neighbor.terrain)) expect(neighbor.terrain).toBe(tile.terrain);
        expect(neighbor.beach).not.toBe(true);
      }
    }
  });

  it('does not repaint waterways or change the geometry of existing stairs', () => {
    const world = generateWorld('ridge-water-preservation');
    const water = world.tiles.map(tile => WATER.has(tile.terrain) ? { ...tile } : null);
    const geometry = world.tiles.map(tile => [tile.ridge, tile.stair]);
    harmonizeRidgeTerrain(world);
    expect(world.tiles.map(tile => [tile.ridge, tile.stair])).toEqual(geometry);
    for (let i = 0; i < water.length; i++) if (water[i]) expect(world.tiles[i]).toEqual(water[i]);
  });
});
