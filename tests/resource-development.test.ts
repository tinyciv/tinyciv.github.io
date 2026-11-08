import { describe, expect, it } from 'vitest';
import { assignRegionalResources, RESOURCE_GROUP_SEPARATION, RESOURCE_GROUP_SIZES } from '../src/world/resources';
import { resourceBlocksGround } from '../src/game/resource-terrain';
import { autoDevelopResources, cityDevelopedResourceCount, developResourceGroup, factionDevelopedResourceCount,
  factionHasDevelopedResource, oliveVillageTradeMultiplier, resourceDevelopmentStatus, saltFoodConsumptionMultiplier } from '../src/game/resource-development';
import { entityStore } from '../src/game/entity-store';
import { territory } from '../src/game/borders';
import { markWorldChanged } from '../src/game/world-revisions';
import { WATER, type GameState, type RegionalResource, type World } from '../src/game/types';

function world(seed = 'resources', width = 96, height = 72): World {
  return { width, height, seed, source: 'resource test', spawns: [], revision: 0,
    tiles: Array.from({ length: width * height }, (_, i) => ({ terrain: i % width < 3 ? 'coast' : 'grassland', overlay: 'none',
      elevation: i % width > width / 2 ? .75 : .4, moisture: .45, temperature: .65,
      food: 3, production: 1, gold: 0, variation: .2 })) };
}
function state(): GameState {
  const w = world('development', 40, 24);
  return { world: w, seed: w.seed, units: [],
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 8, y: 10, hp: 650, maxHp: 650, capacity: 20 }],
    factions: [0, 1].map(id => ({ id, name: `Faction${id}`, color: '#d85842', affinity: 100, relation: id ? 'war' : 'self', gold: 5000,
      food: 100, population: 40, production: 0, yields: { food: 0, production: 0, gold: 0 }, nextRaid: Infinity, defeated: false })),
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, rngState: 1 };
}
function deposit(s: GameState, type: RegionalResource, cells: [number, number][], developed = false): void {
  for (const [x, y] of cells) Object.assign(s.world.tiles[y * s.world.width + x], { resource: type, resourceGroup: 1, resourceDeveloped: developed });
  markWorldChanged(s.world, 'appearance');
}

describe('clustered resource generation', () => {
  it('makes connected, widely separated ore groups, olive groves and larger salt pans deterministically', () => {
    for (const seed of ['resources-a', 'resources-b', 'resources-c']) {
      const a = world(seed), b = world(seed); a.spawns = b.spawns = [{ x: 10, y: 10 }];
      assignRegionalResources(a); assignRegionalResources(b); expect(a).toEqual(b);
      const groups = new Map<number, number[]>();
      a.tiles.forEach((tile, cell) => { if (tile.resourceGroup) { const cells = groups.get(tile.resourceGroup) ?? []; cells.push(cell); groups.set(tile.resourceGroup, cells); } });
      expect(new Set([...groups.values()].map(cells => a.tiles[cells[0]].resource)))
        .toEqual(new Set(['copper', 'iron', 'stone', 'olives', 'salt']));
      for (const cells of groups.values()) {
        const resource = a.tiles[cells[0]].resource as keyof typeof RESOURCE_GROUP_SIZES;
        const [min, max] = RESOURCE_GROUP_SIZES[resource];
        expect(cells.length).toBeGreaterThanOrEqual(min); expect(cells.length).toBeLessThanOrEqual(max);
        const set = new Set(cells), reached = new Set<number>([cells[0]]), queue = [cells[0]];
        for (let i = 0; i < queue.length; i++) {
          const cell = queue[i], x = cell % a.width, y = Math.floor(cell / a.width), tile = a.tiles[cell];
          expect(WATER.has(tile.terrain)).toBe(false); expect(tile.overlay).toBe('none');
          expect(Math.abs(x - 10) > 6 || Math.abs(y - 10) > 6).toBe(true);
          for (const [nx, ny] of [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]]) {
            if (nx < 0 || ny < 0 || nx >= a.width || ny >= a.height) continue;
            const next = ny * a.width + nx;
            if (a.tiles[next].resource === resource) expect(a.tiles[next].resourceGroup).toBe(tile.resourceGroup);
            if (set.has(next) && !reached.has(next)) { reached.add(next); queue.push(next); }
          }
        }
        expect(reached.size).toBe(cells.length);
      }
      const deposits = [...groups.values()];
      for (let i = 0; i < deposits.length; i++) for (let j = i + 1; j < deposits.length; j++)
        for (const cell of deposits[i]) for (const other of deposits[j])
          expect(Math.hypot(cell % a.width - other % a.width, Math.floor(cell / a.width) - Math.floor(other / a.width)))
            .toBeGreaterThanOrEqual(RESOURCE_GROUP_SEPARATION);
    }
  });

  it('varies sizes, principal directions and compactness across eight seeds', () => {
    const sizes = new Set<number>(), angles = new Set<number>(); let small = 0, large = 0, compact = 0, loose = 0, elongated = 0;
    for (let seed = 0; seed < 8; seed++) {
      const w = world(`resource-variety-${seed}`, 128, 96); assignRegionalResources(w);
      const groups = new Map<number, number[]>();
      w.tiles.forEach((tile, cell) => {
        if (tile.resourceGroup) { const cells = groups.get(tile.resourceGroup) ?? []; cells.push(cell); groups.set(tile.resourceGroup, cells); }
      });
      for (const cells of groups.values()) {
        sizes.add(cells.length); small += Number(cells.length <= 3); large += Number(cells.length >= 30);
        if (cells.length < 6) continue;
        const xs = cells.map(cell => cell % w.width), ys = cells.map(cell => Math.floor(cell / w.width));
        const dx = Math.max(...xs) - Math.min(...xs) + 1, dy = Math.max(...ys) - Math.min(...ys) + 1;
        const fill = cells.length / (dx * dy);
        compact += Number(fill >= .8); loose += Number(fill <= .65);
        const mx = xs.reduce((sum, x) => sum + x, 0) / cells.length, my = ys.reduce((sum, y) => sum + y, 0) / cells.length;
        let xx = 0, yy = 0, xy = 0;
        for (let i = 0; i < cells.length; i++) { xx += (xs[i] - mx) ** 2; yy += (ys[i] - my) ** 2; xy += (xs[i] - mx) * (ys[i] - my); }
        const delta = Math.sqrt((xx - yy) ** 2 + 4 * xy ** 2), minor = (xx + yy - delta) / 2, major = (xx + yy + delta) / 2;
        if (major / Math.max(.1, minor) >= 4) {
          elongated++;
          const angle = (.5 * Math.atan2(2 * xy, xx - yy) + Math.PI) % Math.PI;
          angles.add(Math.floor((angle + Math.PI / 8) % Math.PI / (Math.PI / 4)));
        }
      }
    }
    expect(sizes.size).toBeGreaterThanOrEqual(20);
    expect(small).toBeGreaterThan(8); expect(large).toBeGreaterThan(8);
    expect(compact).toBeGreaterThan(15); expect(loose).toBeGreaterThan(15); expect(elongated).toBeGreaterThan(20);
    expect(angles.size).toBe(4);
  });

  it('does not close a narrow land connection with blocking deposits', () => {
    for (let seed = 0; seed < 5; seed++) {
      const w = world(`resource-neck-${seed}`, 100, 52);
      for (let y = 0; y < w.height; y++) for (let x = 0; x < w.width; x++) {
        const t = w.tiles[y * w.width + x]; t.elevation = .7;
        t.terrain = x < 44 || x >= 56 || y === 25 ? 'grassland' : 'coast';
      }
      assignRegionalResources(w);
      const open = w.tiles.map(t => !WATER.has(t.terrain) && !resourceBlocksGround(t));
      const first = open.indexOf(true), seen = new Set([first]), queue = [first];
      for (let head = 0; head < queue.length; head++) {
        const x = queue[head] % w.width, y = Math.floor(queue[head] / w.width);
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          const next = ny * w.width + nx;
          if (nx < 0 || ny < 0 || nx >= w.width || ny >= w.height || !open[next] || seen.has(next)) continue;
          seen.add(next); queue.push(next);
        }
      }
      expect(seen.size).toBe(open.filter(Boolean).length);
    }
  });

  it('preserves a usable clearing beside every tree around rocky deposits', () => {
    for (let seed = 0; seed < 4; seed++) {
      const w = world(`wooded-resources-${seed}`, 96, 72);
      for (let y = 0; y < w.height; y++) for (let x = 0; x < w.width; x++)
        if (x >= 3 && (x + y) % 2 === 0) w.tiles[y * w.width + x].overlay = 'forest';
      assignRegionalResources(w);
      expect(w.tiles.some(t => resourceBlocksGround(t))).toBe(true);
      for (let y = 0; y < w.height; y++) for (let x = 0; x < w.width; x++) {
        if (w.tiles[y * w.width + x].overlay !== 'forest') continue;
        expect([[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([nx, ny]) => {
          const t = w.tiles[ny * w.width + nx];
          return nx >= 0 && ny >= 0 && nx < w.width && ny < w.height && !WATER.has(t.terrain)
            && t.overlay === 'none' && !resourceBlocksGround(t);
        })).toBe(true);
      }
    }
  });

  it('keeps beaches clear of blocking ore while retaining inland deposits', () => {
    for (let seed = 0; seed < 3; seed++) {
      const w = world(`coastal-resources-${seed}`, 96, 72);
      for (let y = 0; y < w.height; y++) for (let x = 3; x < 6; x++)
        Object.assign(w.tiles[y * w.width + x], { terrain: 'desert', beach: true, elevation: .8 });
      assignRegionalResources(w);
      expect(w.tiles.some(t => resourceBlocksGround(t))).toBe(true);
      expect(w.tiles.filter(t => t.beach).every(t => !resourceBlocksGround(t) && t.terrain === 'desert')).toBe(true);
    }
  });
});

describe('resource development and faction benefits', () => {
  it('charges 50 gold per new tile once, retains inspection for finished/poor deposits and refuses invalid targets', () => {
    const s = state(); deposit(s, 'copper', [[11, 10], [12, 10], [11, 11], [12, 11]]);
    expect(resourceDevelopmentStatus(s, 11, 10)).toMatchObject({ ok: true, cost: 200, developedCount: 0, totalCount: 4, city: { id: 1 } });
    s.factions[0].gold = 199;
    expect(developResourceGroup(s, 11, 10).ok).toBe(false); expect(s.factions[0].gold).toBe(199);
    expect(resourceDevelopmentStatus(s, 11, 10)).toMatchObject({ ok: false, resource: 'copper', city: { id: 1 }, cost: 200 });
    s.factions[0].gold = 250;
    expect(developResourceGroup(s, 11, 10).ok).toBe(true); expect(s.factions[0].gold).toBe(50);
    expect(factionHasDevelopedResource(s, 0, 'copper')).toBe(true);
    expect(resourceDevelopmentStatus(s, 11, 10)).toMatchObject({ ok: false, developedCount: 4, cost: 0, resource: 'copper' });
    expect(developResourceGroup(s, 11, 10).ok).toBe(false); expect(s.factions[0].gold).toBe(50);
    expect(developResourceGroup(s, NaN, 10).ok).toBe(false); expect(developResourceGroup(s, -1, 10).ok).toBe(false);
  });

  it('develops only the claimed part of a patch and excludes occupied cells', () => {
    const s = state();
    deposit(s, 'iron', Array.from({ length: 11 }, (_, i) => [11 + i, 10]));
    entityStore(s).buildings.add({ id: 2, kind: 'house', faction: 0, x: 12, y: 10, hp: 100, maxHp: 100, capacity: 1 });
    const borders = territory(s), status = resourceDevelopmentStatus(s, 11, 10);
    expect(status.ok).toBe(true); expect(status.cells.length).toBeLessThan(11);
    expect(status.cells).not.toContain(10 * s.world.width + 12);
    expect(status.cells.every(cell => borders.owners[cell] === 0)).toBe(true);
    expect(developResourceGroup(s, 11, 10).ok).toBe(true);
    for (let x = 11; x <= 21; x++) expect(!!s.world.tiles[10 * s.world.width + x].resourceDeveloped)
      .toBe(status.cells.includes(10 * s.world.width + x));
  });

  it('shares salt coverage and olive trade across the faction and moves benefits with captured borders', () => {
    const s = state(); deposit(s, 'salt', [[11, 10], [12, 10]], true);
    deposit(s, 'olives', [[11, 12], [12, 12], [13, 12]], true);
    expect(factionDevelopedResourceCount(s, 0, 'salt')).toBe(2);
    expect(saltFoodConsumptionMultiplier(s, 0)).toBe(.875); // 20 of 40 residents at 25% less food.
    expect(saltFoodConsumptionMultiplier(s, 0, 10)).toBe(.75);
    expect(saltFoodConsumptionMultiplier(s, 0, 0)).toBe(1);
    expect(oliveVillageTradeMultiplier(s, 0)).toBeCloseTo(1.06);
    expect(oliveVillageTradeMultiplier(s, 1)).toBe(1);
    expect(cityDevelopedResourceCount(s, s.buildings[0], 'salt')).toBe(2);
    s.buildings[0].faction = 1; markWorldChanged(s.world, 'structure');
    expect(factionDevelopedResourceCount(s, 0, 'salt')).toBe(0);
    expect(factionDevelopedResourceCount(s, 1, 'salt')).toBe(2);
    expect(saltFoodConsumptionMultiplier(s, 0)).toBe(1);
    expect(oliveVillageTradeMultiplier(s, 1)).toBeCloseTo(1.06);
  });

  it('updates benefits for unversioned fixtures and caps only the salt reduction, not olives', () => {
    const s = state(); delete s.world.revision;
    const cells: [number, number][] = [[11, 10], [12, 10], [13, 10], [11, 11], [12, 11], [13, 11]];
    for (const [x, y] of cells) Object.assign(s.world.tiles[y * s.world.width + x], { resource: 'salt', resourceDeveloped: true });
    expect(saltFoodConsumptionMultiplier(s, 0)).toBe(.75);
    for (const [x, y] of cells) s.world.tiles[y * s.world.width + x].resource = 'olives';
    expect(saltFoodConsumptionMultiplier(s, 0)).toBe(1);
    expect(oliveVillageTradeMultiplier(s, 0)).toBeCloseTo(1.12);
  });

  it('lets governors buy an affordable patch within their maintenance-reserved budget', () => {
    const s = state(); s.buildings[0].faction = 1;
    deposit(s, 'copper', [[11, 10], [12, 10], [11, 11], [12, 11]]);
    expect(autoDevelopResources(s, 1, 199).ok).toBe(false);
    expect(autoDevelopResources(s, 1, 200).ok).toBe(true);
    expect(s.factions[1].gold).toBe(4800);
    expect(factionHasDevelopedResource(s, 1, 'copper')).toBe(true);
  });
});
