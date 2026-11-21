import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer as createPortListener } from 'node:net';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { captureArmsPreview } from './startup-arms-preview.mjs';
import { captureOffensivePreview } from './startup-offensive-preview.mjs';
import { captureMilitaryPreview } from './startup-military-preview.mjs';
import { captureBarbarianLairPreview, captureBeachedGalleyPreview, captureBuildingPreview, captureCombatEdgePreview, captureThermalBathPreview } from './startup-building-preview.mjs';
import { captureCannonFirePreview } from './startup-cannon-fire-preview.mjs';
import { captureShellImpactPreview } from './startup-shell-impact-preview.mjs';
import { captureFertilityPreview, captureMeadowPreview } from './startup-meadow-preview.mjs';
import { captureFeedbackPreview } from './startup-feedback-preview.mjs';
import { captureCivicArtGallery } from './startup-civic-art-gallery.mjs';
import { captureCivicPreview } from './startup-civic-preview.mjs';
import { captureAnalyticsPreview } from './startup-analytics-preview.mjs';

// Use unbundled browser modules to catch initialization cycles hidden by builds.
// Reuse each entry point's initial world; no rebuild or gameplay scenario.
// --world checks the menu-free viewer without advancing or interacting with it.
const captureFjords = process.argv.includes('--capture-fjords');
const captureSettlementTiers = process.argv.includes('--capture-settlement-tiers');
const worldViewer = captureFjords || captureSettlementTiers || process.argv.includes('--world');
const startupTimeout = captureFjords ? 75 : 30;
const captureQuarry = process.argv.includes('--capture-quarry');
const captureMarble = process.argv.includes('--capture-marble');
const captureHarvest = process.argv.includes('--capture-peat-grapes');
const captureCoal = process.argv.includes('--capture-coal');
const captureOre = process.argv.includes('--capture-ore');
const captureUI = process.argv.includes('--capture-ui');
const captureAgriculture = process.argv.includes('--capture-agriculture');
const captureOpening = process.argv.includes('--capture-opening');
const captureStartingLibrary = process.argv.includes('--capture-starting-library');
const captureAI = process.argv.includes('--capture-ai');
const captureMilitary = process.argv.includes('--capture-military');
const captureArms = process.argv.includes('--capture-arms');
const captureOffensive = process.argv.includes('--capture-offensive');
const captureBuildings = process.argv.includes('--capture-buildings');
const captureScoutTowers = process.argv.includes('--capture-scout-towers');
const checkScoutScenarios = process.argv.includes('--check-scout-scenarios');
const captureScenarioTownRoads = process.argv.includes('--capture-scenario-town-roads');
const checkScenarioTownRoads = captureScenarioTownRoads || process.argv.includes('--check-scenario-town-roads');
const captureMenu = process.argv.includes('--capture-menu');
const captureMapTools = process.argv.includes('--capture-map-tools');
const captureArt = process.argv.includes('--capture-art');
const captureCannonFire = process.argv.includes('--capture-cannon-fire');
const captureMeadow = process.argv.includes('--capture-meadow');
const captureFertility = process.argv.includes('--capture-fertility');
const captureShellImpact = process.argv.includes('--capture-shell-impact');
const captureFeedback = process.argv.includes('--capture-feedback');
const captureCivicArt = process.argv.includes('--capture-civic-art');
const captureCivic = process.argv.includes('--capture-civic');
const captureAnalytics = process.argv.includes('--capture-analytics');
const captureAdvancedStart = process.argv.includes('--capture-advanced-start');
const captureObserver = process.argv.includes('--capture-observer');
const checkAdvancedStarts = captureAdvancedStart || process.argv.includes('--check-advanced-starts');
const started = performance.now(), errors = [];
// Vite treats port 0 as its default port. Choose an unused port explicitly.
const listener = createPortListener();
await new Promise((resolve, reject) => {
  listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve);
});
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
// Concurrent dev servers must not replace this check's optimized modules.
const startupCache = `output/startup/.vite-${process.pid}`;
const server = await createServer({ envFile: false, cacheDir: startupCache,
  server: { host: '127.0.0.1', port, strictPort: true, open: false, hmr: false } });
let browser, page, timer;
try {
  await server.listen();
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'],
    executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) });
  page = await browser.newPage({ viewport: worldViewer ? { width: 1440, height: 960 } : { width: 800, height: 600 } });
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(4096);
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function () {
      try { return await decode.call(this); }
      catch (error) { throw new Error(`Image decode failed: ${this.currentSrc || this.src}`, { cause: error }); }
    };
  });
  const failure = new Promise((_, reject) => {
    const fail = message => { errors.push(message); reject(new Error(message)); };
    page.on('pageerror', error => fail(error.stack || String(error)));
    page.on('crash', () => fail('Browser page crashed'));
    page.on('console', message => {
      if (message.type() === 'error') fail(`${message.text()} ${message.location().url}`.trim());
    });
    page.on('requestfailed', request => fail(`${request.failure()?.errorText} ${request.url()}`));
    page.on('response', response => {
      if (response.status() >= 400) fail(`HTTP ${response.status()} ${response.url()}`);
    });
    timer = setTimeout(() => fail(`Startup exceeded ${startupTimeout} seconds`), startupTimeout * 1000);
  });
  await Promise.race([failure, (async () => {
    // Attach errors before navigation and avoid networkidle's mandatory delay.
    const open = async (view, waitForMap = false) => {
      await page.goto(new URL(view, server.resolvedUrls.local[0]).href, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(readyMap => {
        const { assets, worldViewer } = document.documentElement.dataset;
        if (assets === 'error') throw new Error('Game asset loading failed');
        return assets === 'ready' && (!readyMap || worldViewer === 'ready');
      }, waitForMap);
    };
    if (captureFjords) {
      for (const [preset, style] of [['standard', 'continents'], ['pangaea', 'pangaea'], ['archipelago', 'fractal']]) {
        const defaultViewer = style === 'continents';
        await open(defaultViewer ? 'world.html?seed=NORTH-REACH' : `world.html?preset=${preset}&size=tiny&seed=NORTH-REACH`, true);
        await captureFjordPreview(page, style, defaultViewer);
      }
      return;
    }
    await open(worldViewer ? 'world.html?preset=archipelago&seed=world-viewer-review' : '');
    if (captureMilitary) {
      const recruitment = await page.evaluate(async () => {
        const { retinueRecruitmentDue } = await import('/src/game/retinue-native.ts');
        const barracks = Array.from({ length: 11 }, (_, index) => ({
          id: index + 1, faction: 0, kind: 'barracks', x: index * 2, y: 1, hp: 100,
          construction: { startedAt: 0, duration: 90 },
        }));
        const rival = { id: 12, faction: 1, kind: 'barracks', x: 0, y: 4, hp: 100 };
        const faction = { id: 0 };
        const state = { world: { width: 24 }, buildings: [...barracks, rival], units: [],
          time: 0, tick: 0, speed: 1, paused: true, rngState: 0 };
        const observe = time => {
          state.time = time;
          const due = retinueRecruitmentDue(state, faction, false);
          return [faction.retinueRecruitmentInterval, faction.nextRetinueAt, due];
        };
        const base = observe(0);
        barracks[0].construction = undefined;
        const one = observe(5);
        for (const building of barracks) building.construction = undefined;
        const capped = observe(9.7);
        barracks[0].faction = barracks[1].faction = 1;
        barracks[2].hp = 0;
        const reduced = observe(12.7);
        return { base, one, capped, reduced };
      });
      assert.deepEqual(recruitment, {
        base: [10, 10, false], one: [9.4, 9.7, false], capped: [4, 13.7, true], reduced: [5.2, 14, false],
      });
    }
    if (checkAdvancedStarts) {
      const report = await page.evaluate(async capture => {
        const { createGame } = await import('/src/game/simulation.ts');
        const { generateWorld } = await import('/src/world/generator.ts');
        const { dockBerth, dockMoorings } = await import('/src/game/dock.ts');
        const { fieldStage } = await import('/src/game/farm-art.ts');
        const { FIELD_HARVEST_SECONDS, synchronizeWheatFields } = await import('/src/game/farms.ts');
        const { farmWorkGroups } = await import('/src/game/farm-work-groups.ts');
        const { planStartingCityFarms, startingRoadRing } = await import('/src/game/settlement-layout.ts');
        const { createIrrigationConnectionQuery, irrigationYieldMultiplier } = await import('/src/game/irrigation.ts');
        const { withSimulationReads } = await import('/src/game/simulation-reads.ts');
        const { buildingWidth, buildingHeight, tileAt, isFarmKind } = await import('/src/game/types.ts');
        const { raiderCampActive, raiderCampCenter } = await import('/src/game/raider-camps.ts');
        const coastal = new Set(['dock', 'shipyard', 'whalingPost']);
        const width = 64, height = 56;
        const fixture = water => ({ width, height, seed: `advanced-start-${water}`, source: 'test', spawns: [{ x: 31, y: 27 }],
          tiles: Array.from({ length: width * height }, (_, i) => ({
            terrain: water === 'coast' && i % width >= 42 ? i % width < 44 ? 'coast' : 'ocean'
              : water === 'river' && i % width >= 44 && i % width <= 45 ? 'river' : 'grassland',
            overlay: 'none', elevation: .3, moisture: .7, food: 3, production: 1, gold: 0, variation: .5,
          })) });
        const check = (label, world, phase) => {
          const state = createGame(world, undefined, { advancedStart: phase });
          if (capture && label === 'generated midpoint') window.__advancedStartReview = state;
          const buildings = state.buildings.filter(building => building.faction === 0 && building.hp > 0);
          const palace = buildings.find(building => building.kind === 'palace'), fort = buildings.find(building => building.kind === 'fort');
          const distance = (x, y) => Math.hypot(x - palace.x - .5, y - palace.y - .5);
          const key = ({ x, y }) => y * world.width + x;
          const roads = new Set(buildings.filter(building => building.kind === 'road').map(key));
          const inside = buildings.filter(building => !coastal.has(building.kind) && !isFarmKind(building.kind)
            && !['road', 'bridge', 'irrigation', 'fort', 'scoutTower'].includes(building.kind));
          const urbanRadius = Math.max(...inside.flatMap(building => Array.from({ length: buildingWidth(building) * buildingHeight(building) }, (_, i) =>
            distance(building.x + i % buildingWidth(building), building.y + Math.floor(i / buildingWidth(building))))));
          const farms = state.fields.filter(field => field.faction === 0);
          const openingHarvests = farms.map(field => field.nextHarvest);
          synchronizeWheatFields(state);
          const ditches = buildings.filter(building => building.kind === 'irrigation');
          const connects = createIrrigationConnectionQuery({ ...state, buildings: [] }), fed = new Set();
          const ditchesConnected = ditches.every(ditch => {
            if (!connects(ditch.x, ditch.y, fed)) return false;
            fed.add(key(ditch));
            return true;
          });
          let replant;
          if (ditches.length) {
            const layout = { ...state, buildings: state.buildings.filter(building => building.faction !== 0 || !isFarmKind(building.kind)), fields: [] };
            const withoutDitches = { ...layout, buildings: layout.buildings.filter(building => building.kind !== 'irrigation') };
            const count = view => withSimulationReads(view, () => planStartingCityFarms(view, palace, 250, world.spawns[0], urbanRadius).length);
            replant = { irrigated: count(layout), dry: count(withoutDitches) };
          }
          const groups = farmWorkGroups(state).groups.filter(group => group.faction === 0);
          const rectangular = groups.every(({ fields }) => {
            const xs = fields.map(field => field.x), ys = fields.map(field => field.y);
            return (Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1) === fields.length;
          });
          const ports = buildings.filter(building => coastal.has(building.kind));
          const dock = ports.find(building => building.kind === 'dock'), berth = dock && dockBerth(dock);
          const camps = state.raiderCamps.filter(camp => raiderCampActive(state, camp)).map(raiderCampCenter)
            .sort((a, b) => distance(a.x - .5, a.y - .5) - distance(b.x - .5, b.y - .5));
          const field = { ...farms[0], nextHarvest: 60, food: 4 };
          return { label, population: state.factions[0].population, farms: farms.length,
            ditches: ditches.length, ditchesConnected, replant,
            lakes: world.tiles.filter(tile => tile.terrain === 'lake').length,
            irrigatedFarms: withSimulationReads(state, () => farms.filter(field => irrigationYieldMultiplier(state, field.x, field.y) > 1).length),
            outerFarms: farms.every(field => distance(field.x, field.y) > urbanRadius),
            largestField: Math.max(...groups.map(group => group.fields.length)), rectangular,
            staggeredOpening: farms.every((field, index) => field.planted && field.nextHarvest === openingHarvests[index]
              && field.nextHarvest >= state.time && field.nextHarvest < state.time + FIELD_HARVEST_SECONDS)
              && groups.every(group => group.fields.every(field => field.nextHarvest === group.fields[0].nextHarvest))
              && new Set(groups.map(group => group.fields[0].nextHarvest)).size > 1,
            fields: groups.length,
            singleTileFields: groups.filter(group => group.fields.length === 1).length,
            ports: ports.map(port => port.kind).sort(),
            dockAtSea: !dock || ['coast', 'ocean'].includes(tileAt(world, berth.x, berth.y).terrain) && dockMoorings(state, dock).length > 0,
            ringed: !!fort && [palace, fort, ...inside.filter(building => buildingWidth(building) * buildingHeight(building) >= 4)]
              .every(building => startingRoadRing(building, buildingWidth(building), buildingHeight(building)).every(point => roads.has(key(point)))),
            fortFacesCamp: !camps.length || !!fort && (fort.x + 1.5 - palace.x - 1) * (camps[0].x - palace.x - 1)
              + (fort.y + 1.5 - palace.y - 1) * (camps[0].y - palace.y - 1) > 0,
            stages: [0, 6, 12, 39].map(time => fieldStage(field, time)),
          };
        };
        return [
          check('generated midpoint', generateWorld('advanced-infantry-drill'), 'midpoint'),
          check('river', fixture('river'), 'complete'),
          check('coast', fixture('coast'), 'complete'),
          check('dry', fixture('dry'), 'complete'),
        ];
      }, captureAdvancedStart);
      for (const start of report) {
        const summary = JSON.stringify(start);
        assert.equal(start.population, 250, summary);
        assert.ok(start.farms > 16 && start.outerFarms && start.largestField <= 16, summary);
        assert.ok(start.rectangular && start.largestField >= 9, summary);
        assert.ok(start.staggeredOpening, 'Opening parcels have different first harvests and each parcel is synchronized');
        assert.ok(start.singleTileFields <= start.fields / 10, summary);
        assert.ok(start.ringed && start.fortFacesCamp && start.dockAtSea, summary);
        assert.ok(start.ditches <= 6 && start.ditchesConnected, summary);
        assert.deepEqual(start.stages, [0, 1, 2, 3], summary);
      }
      assert.deepEqual(report[1].ports, []);
      assert.deepEqual(report[2].ports, ['dock', 'shipyard', 'whalingPost']);
      const river = report[1];
      assert.ok(river.ditches >= 2 && river.irrigatedFarms > 0 && river.replant.irrigated < river.replant.dry, JSON.stringify(river));
      for (const start of report.slice(1)) assert.equal(start.lakes, 0, JSON.stringify(start));
      for (const start of report.slice(2)) assert.equal(start.ditches, 0, JSON.stringify(start));
      const fieldCounts = report.map(start => `${start.label} ${start.singleTileFields}/${start.fields}`).join(', ');
      console.log(`PASS advanced starts (single-tile fields: ${fieldCounts})`);
      for (const start of report) if (start.replant) {
        console.log(`  ${start.label}: ${start.ditches} ditch tiles, ${start.irrigatedFarms} irrigated farm tiles, ${start.replant.dry} → ${start.replant.irrigated} farm tiles with irrigation`);
      }
      if (captureAdvancedStart) {
        await page.setViewportSize({ width: 1440, height: 960 });
        await page.evaluate(async () => {
          const { Renderer } = await import('/src/game/renderer.ts');
          const { setMapRevealed } = await import('/src/game/fog.ts');
          const state = window.__advancedStartReview;
          state.paused = true;
          setMapRevealed(state, true);
          const town = state.buildings.find(building => building.kind === 'palace' && building.faction === 0);
          const host = document.createElement('div');
          host.id = 'advanced-start-review';
          Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '99999', background: '#20261c' });
          host.innerHTML = '<canvas style="width:100%;height:100%;display:block"></canvas><canvas hidden></canvas>';
          document.body.append(host);
          const [canvas, minimap] = host.querySelectorAll('canvas');
          const renderer = new Renderer(canvas, minimap);
          await renderer.initialize();
          renderer.follow = false;
          renderer.camera = { x: town.x + 1, y: town.y + 1 };
          renderer.zoom = .9;
          renderer.draw(state, 0);
        });
        await mkdir('output/startup', { recursive: true });
        await page.locator('#advanced-start-review').screenshot({ path: 'output/startup/advanced-start.png' });
        await page.evaluate(() => document.querySelector('#advanced-start-review').remove());
      }
    }
    const defenses = await page.evaluate(async viewerMode => {
      const state = viewerMode ? window.__worldViewer.state : window.__game.state;
      const { isHumanFaction } = await import('/src/game/player-context.ts');
      const { buildingMaintenance, watchtowerMaintenance, WATCHTOWER_MAINTENANCE } = await import('/src/game/maintenance.ts');
      const ai = new Set(state.factions.filter(faction => faction.id >= 0 && faction.villageId === undefined
        && !isHumanFaction(state, faction.id)).map(faction => faction.id));
      const towers = state.buildings.filter(building => ai.has(building.faction) && building.kind === 'woodenTower');
      return { towers: towers.length,
        palisades: state.buildings.filter(building => ai.has(building.faction) && building.kind === 'palisade').length,
        charged: towers.filter(tower => buildingMaintenance(state, tower) !== 0).length,
        reserved: towers.filter(tower => watchtowerMaintenance(state, tower.faction, tower.kind) !== 0).length,
        humanRate: WATCHTOWER_MAINTENANCE };
    }, worldViewer);
    assert.ok(defenses.towers > 0, 'AI starting wooden towers must remain');
    assert.equal(defenses.palisades, 0, 'AI starting towers must not have palisade rings');
    assert.equal(defenses.charged, 0, 'AI wooden towers must not charge upkeep');
    assert.equal(defenses.reserved, 0, 'AI tower forecasts must not reserve upkeep');
    assert.equal(defenses.humanRate, 5, 'Human watchtower upkeep must retain its normal rate');
    const scoutTowers = await page.evaluate(async viewerMode => {
      const state = viewerMode ? window.__worldViewer.state : window.__game.state;
      const { validateBuildAt, BUILD_COSTS } = await import('/src/game/simulation.ts');
      const { buildingReady, BUILDABLE_KINDS } = await import('/src/game/types.ts');
      const { entityStore } = await import('/src/game/entity-store.ts');
      const { buildingSightRadius, updateFog } = await import('/src/game/fog.ts');
      const store = entityStore(state);
      const armed = new Set(store.buildings.query('towerWeapon'));
      const towers = state.buildings.filter(b => b.kind === 'scoutTower');
      const townByFaction = new Map(store.buildings.query('palace').filter(b => b.initialCity).map(b => [b.faction, b]));
      const byFaction = new Map([...townByFaction].map(([faction]) => [faction, 0]));
      for (const tower of towers) byFaction.set(tower.faction, (byFaction.get(tower.faction) ?? 0) + 1);
      const fog = viewerMode ? undefined : updateFog(state, 0);
      const player = towers.filter(b => b.faction === 0);
      return {
        counts: [...byFaction.values()],
        healthy: towers.every(tower => buildingReady(tower) && tower.hp === 75 && tower.armor === 0 && !armed.has(tower)),
        outside: towers.every(tower => {
          const town = townByFaction.get(tower.faction);
          const distance = town && Math.hypot(tower.x - town.x - .5, tower.y - town.y - .5);
          return distance >= 7 && distance <= 12;
        }),
        radius: buildingSightRadius({ kind: 'scoutTower' }),
        sight: !fog || player.every(tower => fog.sources.some(source =>
          source.x === tower.x + .5 && source.y === tower.y + .5 && source.radius === buildingSightRadius(tower))),
        buildable: BUILDABLE_KINDS.includes('scoutTower') || validateBuildAt(state, 'scoutTower', player[0]?.x ?? 0, player[0]?.y ?? 0).ok,
        cost: Object.values(BUILD_COSTS.scoutTower).reduce((sum, amount) => sum + amount, 0),
      };
    }, worldViewer);
    assert.ok(scoutTowers.counts.length && scoutTowers.counts.every(count => count >= 2 && count <= 4),
      `Each starting faction should have multiple scout towers where the startup terrain allows (${scoutTowers.counts})`);
    assert.ok(scoutTowers.healthy && scoutTowers.outside && scoutTowers.sight, 'Scout towers must be fragile, unarmed sight sources around the city');
    assert.equal(scoutTowers.radius, 13, 'Scout towers must have a 13-tile sight radius');
    assert.ok(!scoutTowers.buildable && scoutTowers.cost === 0, 'Scout towers must be restricted to free rebuilds');
    const staffing = await page.evaluate(async viewerMode => {
      const state = viewerMode ? window.__worldViewer.state : window.__game.state;
      const { entityStore } = await import('/src/game/entity-store.ts');
      const units = entityStore(state).units;
      const actors = new Set(units.query('unit'));
      const workers = units.query('worker');
      return {
        dormant: workers.filter(unit => unit.hp > 0 && unit.inside && !actors.has(unit)).length,
        missingOutside: workers.filter(unit => unit.hp > 0 && !unit.inside && !actors.has(unit)).length,
      };
    }, worldViewer);
    assert.ok(staffing.dormant > 0, 'Starting civilian jobs should include dormant slots without native actors');
    assert.equal(staffing.missingOutside, 0, 'Every exposed worker must have a native actor');
    const landscape = await page.evaluate(async viewerMode => {
      const { world, buildings } = viewerMode ? window.__worldViewer.state : window.__game.state;
      const [{ visibleReliefStamps }, { traversable }, { settlementFootprintAllowed }] = await Promise.all([
        import('/src/game/relief-art.ts'), import('/src/game/pathfinding.ts'), import('/src/game/terrain-sites.ts'),
      ]);
      const tile = { terrain: 'grassland', overlay: 'none' };
      const fixture = { width: 8, height: 8, revision: 0, tiles: Array.from({ length: 64 }, () => ({ ...tile })) };
      fixture.tiles[2 * fixture.width + 6].resource = 'olives';
      const acceptsThreeTiles = settlementFootprintAllowed(fixture, 2, 2, 2, 2, true);
      const rejectsTwoTiles = !settlementFootprintAllowed(fixture, 3, 2, 2, 2, true);
      const capital = buildings.find(building => building.faction === 0 && building.kind === 'palace' && building.initialCity);
      const clearCapital = !!capital && settlementFootprintAllowed(world, capital.x, capital.y, 2, 2, true);
      const minerals = new Set();
      let reliefCells = 0, ledgeCells = 0;
      let solidCanopy = 0, forestPaths = 0, invalidForest = 0;
      let pondCells = 0, woodedRiverBanks = 0;
      for (const [cell, tile] of world.tiles.entries()) {
        reliefCells += Number(!!tile.relief);
        ledgeCells += Number(!!tile.ridge || !!tile.stair);
        if (tile.oreAnchor !== undefined && ['copper', 'iron', 'gold'].includes(tile.resource)) minerals.add(tile.resource);
        const x = cell % world.width, y = Math.floor(cell / world.width);
        if (tile.lakeShape === 'forest-pond' && tile.terrain === 'lake' && !traversable(world, x, y)) pondCells++;
        if (tile.biome === 'forest') {
          const tree = tile.overlay === 'forest';
          invalidForest += Number(tile.terrain !== 'grassland' || !traversable(world, x, y));
          if (!tree) forestPaths++;
          if (tree && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) =>
            x + dx >= 0 && x + dx < world.width && world.tiles[cell + dy * world.width + dx]?.terrain === 'river')) woodedRiverBanks++;
          if (tree && x + 1 < world.width && y + 1 < world.height &&
            [cell + 1, cell + world.width, cell + world.width + 1].every(next =>
              world.tiles[next].biome === 'forest' && world.tiles[next].overlay === 'forest')) solidCanopy++;
        }
      }
      return { acceptsThreeTiles, rejectsTwoTiles, clearCapital,
        reliefCells, ledgeCells, minerals: [...minerals].sort(), solidCanopy, forestPaths, invalidForest, pondCells,
        woodedRiverBanks, reliefStamps: visibleReliefStamps(world, 0, 0, world.width, world.height).length };
    }, worldViewer);
    assert.ok(landscape.acceptsThreeTiles && landscape.rejectsTwoTiles && landscape.clearCapital,
      'The first palace footprint must stay at least three tiles from every resource');
    assert.equal(landscape.reliefCells, 0, 'Generated terrain must have no hills or mountains');
    assert.equal(landscape.reliefStamps, 0, 'Generated terrain must have no hill or mountain sprites');
    assert.deepEqual(landscape.minerals, ['copper', 'gold', 'iron'], 'Generated terrain must retain all ore types');
    assert.ok(landscape.solidCanopy > 0 && landscape.forestPaths > 0, 'Forest biomes must have solid stands and open paths');
    assert.equal(landscape.invalidForest, 0, 'Forest canopy and its grassland paths are walkable');
    assert.ok(landscape.pondCells >= 6 && landscape.woodedRiverBanks > 0, 'Forests must contain ponds and grow along rivers');
    const fringe = await page.evaluate(async () => {
      const { applyForestBiomes } = await import('/src/world/terrain-ecology.ts');
      const { DEFAULT_LANDSCAPE_PARAMETERS } = await import('/src/world/options.ts');
      const { traversable } = await import('/src/game/pathfinding.ts');
      const width = 48, height = 32, edge = 20, count = width * height;
      const tiles = Array.from({ length: count }, (_, cell) => {
        const x = cell % width, cold = cell >= width * (height / 2);
        const terrain = x < edge ? 'grassland' : cold ? 'tundra' : 'plains';
        const biome = x < edge ? 'temperate' : cold ? 'tundra' : 'steppe';
        return { terrain, biome, overlay: 'none', elevation: .3, moisture: .56,
          variation: .5, food: 2, production: 1, gold: 0 };
      });
      const world = { width, height, tiles, seed: 'startup-forest-fringe', source: 'startup', spawns: [] };
      const woodland = Float32Array.from(tiles, tile => tile.terrain === 'grassland' ? .85 : .62);
      applyForestBiomes(world, { woodland, freshwater: new Int16Array(count).fill(32767) }, DEFAULT_LANDSCAPE_PARAMETERS);
      let plains = 0, tundra = 0, invalid = 0, near = 0, far = 0;
      const reach = new Uint8Array(height);
      for (let cell = 0; cell < count; cell++) {
        const x = cell % width, y = Math.floor(cell / width), tile = tiles[cell];
        if (x < edge || tile.overlay !== 'forest') continue;
        const cold = y >= height / 2;
        if (cold) tundra++;
        else plains++;
        if (x < edge + 4) near++;
        else if (x >= edge + 8) far++;
        reach[y] = Math.max(reach[y], x - edge + 1);
        if (tile.terrain !== (cold ? 'tundra' : 'plains') || tile.biome !== (cold ? 'tundra' : 'steppe')
          || !traversable(world, x, y) || x >= edge + 11) invalid++;
      }
      return { plains, tundra, invalid, near, far, variedReach: new Set(reach).size };
    });
    assert.ok(fringe.plains > 0 && fringe.tundra > 0 && fringe.near > fringe.far && fringe.variedReach > 1,
      'Forest margins must taper unevenly into plains and tundra');
    assert.equal(fringe.invalid, 0, 'Fringe woodland must retain the ground biome and remain traversable');
    const deer = await page.evaluate(async viewerMode => {
      const state = viewerMode ? window.__worldViewer.state : window.__game.state;
      const { entityStore } = await import('/src/game/entity-store.ts');
      const { isHuntable } = await import('/src/game/hunting.ts');
      const { traversable } = await import('/src/game/pathfinding.ts');
      const { wildlifeFrame, wildlifeImage, wildlifeKind } = await import('/src/game/wildlife-art.ts');
      const animals = entityStore(state).units.query('wildlife').filter(unit => unit.kind === 'deer');
      const sexes = new Set(), atlas = new Set();
      let invalid = 0, animated = true;
      for (const deer of animals) {
        sexes.add(deer.deerSex);
        const kind = wildlifeKind(deer);
        atlas.add(kind);
        invalid += Number(!isHuntable(deer) || !traversable(state.world, deer.x, deer.y) || !wildlifeImage(kind));
        const walk = [0, .2, .4].map(time => wildlifeFrame({ ...deer, moving: true, deerFleeing: false }, time).frame);
        const run = [0, .2, .4].map(time => wildlifeFrame({ ...deer, moving: true, deerFleeing: true }, time).frame);
        animated &&= new Set(walk).size > 1 && new Set(run).size > 1 && walk.every(frame => frame >= 1 && frame <= 8)
          && run.every(frame => frame >= 9 && frame <= 16);
      }
      return { sexes: [...sexes].sort(), atlas: [...atlas].sort(), invalid, animated };
    }, worldViewer);
    assert.deepEqual(deer.sexes, ['female', 'male'], 'Forest herds must contain bucks and does');
    assert.deepEqual(deer.atlas, ['buck', 'doe'], 'Deer must use separate atlases for each sex');
    assert.equal(deer.invalid, 0, 'Deer must spawn on walkable ground and be huntable');
    assert.ok(deer.animated, 'Deer must use distinct walk and run animation cycles');
    const livestock = await page.evaluate(async viewerMode => {
      const game = viewerMode ? window.__worldViewer.state : window.__game.state;
      const { isHuntable } = await import('/src/game/hunting.ts');
      const { fenceLivestockHerd, hasLivestock, livestockFenceStatus, pastureYield, planLivestock, advanceLivestock } =
        await import('/src/game/livestock.ts');
      const { insideOwnBorders } = await import('/src/game/borders.ts');
      const { wildlifeImage, wildlifeFrame, wildlifePose } = await import('/src/game/wildlife-art.ts');
      const species = ['cow', 'horse', 'sheep'];
      const spawned = new Set(game.livestock?.herds.map(herd => herd.species));
      const herdSizes = game.livestock?.herds.map(herd => herd.animals.length) ?? [];
      const noHunting = game.units.filter(unit => species.includes(unit.kind)).every(unit => !isHuntable(unit));
      const art = species.every(kind => {
        const horse = kind === 'horse', image = wildlifeImage(kind);
        return image?.width === (horse ? 64 : 120) && image.height === (horse ? 64 : 96);
      });
      const animated = ['cow', 'sheep'].every(kind => {
        const animal = game.units.find(unit => unit.kind === kind);
        if (!animal) return false;
        const idle = { ...animal, moving: false };
        const frames = [0, .2, .4, .6].map(time => wildlifeFrame({ ...animal, moving: true }, time).frame);
        return wildlifeFrame(idle, 0).frame === 0 && wildlifePose(idle, 0).bounds.width === 48
          && new Set(frames).size === 4 && frames.every(frame => frame >= 1 && frame <= 4);
      });
      const width = 40, height = 28, y = 13.5;
      const tiles = Array.from({ length: width * height }, () =>
        ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 2, production: 1, gold: 0, variation: .5 }));
      const unit = (id, kind, x, faction) => ({ id, kind, x, y, faction, hp: 20, maxHp: 20, order: 'wander', morale: 100,
        attack: 0, defense: 0, speed: .56, range: 0, cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 });
      const pastures = species.map(kind => {
        const faction = { id: 0, name: 'Home', color: '#8596e0', relation: 'self', food: 0, gold: 0, production: 0, population: 0,
          culture: 0, yields: { food: 0, production: 0, gold: 0 }, nextRaid: Infinity, defeated: false };
        const fixture = {
          world: { width, height, seed: 'startup-pasture', source: 'startup', tiles, spawns: [], revision: 0 },
          time: 0, tick: 0, paused: true, speed: 1, rngState: 1, factions: [faction], units: [],
          buildings: [{ id: 1, kind: 'palace', faction: 0, x: 9, y: 12, hp: 650, maxHp: 650, capacity: 4 }],
        };
        let x = 13;
        while (x < width - 4 && insideOwnBorders(fixture, 0, x + 1.5, y)) x++;
        const straddles = insideOwnBorders(fixture, 0, x + .5, y) && !insideOwnBorders(fixture, 0, x + 1.5, y);
        fixture.units = [unit(2, 'leader', x - .5, 0), unit(3, kind, x + .5, -3), unit(4, kind, x + 1.5, -3)];
        const herd = { id: 0, species: kind, animals: [3, 4], center: { x: x + 1, y }, nextMoveAt: 0 };
        fixture.livestock = { revision: 0, herds: [herd] };
        const required = kind === 'horse' ? 'horsebackRiding' : 'animalHusbandry';
        const wrong = kind === 'horse' ? 'animalHusbandry' : 'horsebackRiding';
        const unresearched = livestockFenceStatus(fixture, 0);
        faction.research = { focus: wrong, levels: { [wrong]: 1 }, progress: {} };
        const wrongResearch = fenceLivestockHerd(fixture, 0);
        const locked = !hasLivestock(fixture, 0, kind);
        faction.research = { focus: required, levels: { [required]: 1 }, progress: {} };
        const result = fenceLivestockHerd(fixture, 0);
        const pen = herd.pasture;
        const buffer = pen && [pen.x, pen.y, pen.width, pen.height];
        const home = { ...herd.center }, positions = fixture.units.slice(1).map(({ x, y }) => ({ x, y }));
        planLivestock(fixture);
        advanceLivestock(fixture, 1);
        const moved = fixture.units.slice(1).filter((animal, i) =>
          Math.hypot(animal.x - positions[i].x, animal.y - positions[i].y) > 0).length;
        const wanders = moved === 1 && herd.center.x === home.x && herd.center.y === home.y;
        const contained = pen && fixture.units.slice(1).every(animal => animal.x >= pen.x && animal.x < pen.x + pen.width
          && animal.y >= pen.y && animal.y < pen.y + pen.height && Math.hypot(animal.x - herd.center.x, animal.y - herd.center.y) <= 4);
        return { kind, straddles, unresearched, wrongResearch, locked, result, buffer, expected: [x - 2, 11, 6, 5], contained, wanders,
          access: hasLivestock(fixture, 0, kind), horseAccess: hasLivestock(fixture, 0, 'horse'), income: pastureYield(herd) };
      });
      return { spawned: [...spawned].sort(), herdSizes, noHunting, art, animated, pastures };
    }, worldViewer);
    assert.deepEqual(livestock.spawned, ['cow', 'horse', 'sheep'], 'Generated maps must seed all three livestock species');
    assert.ok(livestock.herdSizes.every(size => size >= 4 && size <= 7), 'Each generated livestock herd must have four to seven animals');
    assert.ok(livestock.noHunting && livestock.art, 'Livestock must be non-huntable and use their native art');
    assert.ok(livestock.animated, 'Cows and sheep must use larger sprites and separate idle and walk frames');
    for (const pasture of livestock.pastures) {
      const tech = pasture.kind === 'horse' ? 'Horseback Riding' : 'Animal Husbandry';
      const missing = { ok: false, message: `Requires ${tech}.` };
      assert.deepEqual(pasture.unresearched, missing);
      assert.deepEqual(pasture.wrongResearch, missing);
      assert.ok(pasture.straddles && pasture.locked && pasture.result.ok,
        `${tech} must fence a ${pasture.kind} herd straddling the border (${JSON.stringify(pasture.result)})`);
      assert.deepEqual(pasture.buffer, pasture.expected, 'Pastures must add two tiles around every animal');
      assert.ok(pasture.contained && pasture.wanders && pasture.access && pasture.income.food > 0 && pasture.income.gold > 0,
        'A fenced herd must graze around a fixed home and produce food and gold');
      assert.equal(pasture.horseAccess, pasture.kind === 'horse', 'Only a horse pasture must supply mounts');
    }
    assert.equal(landscape.ledgeCells, 0, 'Generated terrain must have no ledges or stairs');
    if (worldViewer) {
      await page.waitForFunction(() => document.documentElement.dataset.worldViewer === 'ready');
      const meadow = await page.evaluate(async () => {
        const { world } = window.__worldViewer.state;
        const { width, height, tiles } = world;
        const { MeadowPlacementCache, MEADOW_SPRITES, MEADOW_TUFT_SCALE } = await import('/src/game/meadow-art.ts');
        const { worldRevisions } = await import('/src/game/world-revisions.ts');
        const cache = new MeadowPlacementCache(), geometry = worldRevisions(world).geometry;
        const protectedCells = tiles.map(tile => !!tile.waterfall);
        let grass = 0, overlaps = 0;
        for (let cell = 0; cell < tiles.length; cell++) {
          const x = cell % width, y = Math.floor(cell / width);
          for (const tuft of cache.get(world, x, y, geometry)) {
            grass++;
            const left = x + tuft.x - MEADOW_TUFT_SCALE * .5;
            const top = y + tuft.y - MEADOW_SPRITES[tuft.variant].anchorY * MEADOW_TUFT_SCALE;
            for (let ny = Math.max(0, Math.floor(top)); ny < Math.min(height, top + MEADOW_TUFT_SCALE); ny++) {
              for (let nx = Math.max(0, Math.floor(left)); nx < Math.min(width, left + MEADOW_TUFT_SCALE); nx++) {
                if (protectedCells[ny * width + nx]) overlaps++;
              }
            }
          }
        }
        return { grass, overlaps };
      });
      assert.ok(meadow.grass > 0, 'Walkable terrain must retain decorative grass');
      assert.equal(meadow.overlaps, 0, 'Decorative grass must stay clear of waterfalls');
      const woodland = await page.evaluate(async () => {
        const { applyTerrainEcology } = await import('/src/world/terrain-ecology.ts');
        const { resolveLandscapeParameters } = await import('/src/world/options.ts');
        const { canTraverseEdge, traversable } = await import('/src/game/pathfinding.ts');
        const { WATER } = await import('/src/game/types.ts');
        const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        const inspect = world => {
          const { width, height, tiles } = world;
          const trees = Uint8Array.from(tiles, tile => Number(tile.overlay === 'forest' || tile.overlay === 'jungle'));
          let count = 0, solidCanopy = 0, clearings = 0, withoutOpening = 0, obstructedTerrain = 0;
          const blocked = [];
          for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            const cell = y * width + x;
            if (x + 1 < width && y + 1 < height) {
              const canopy = trees[cell] + trees[cell + 1] + trees[cell + width] + trees[cell + width + 1];
              solidCanopy += Number(canopy === 4);
              clearings += Number(canopy === 0);
            }
            if (!trees[cell]) continue;
            count++;
            obstructedTerrain += Number(!!tiles[cell].waterfall);
            if (!directions.some(([dx, dy]) => {
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) return false;
              const next = ny * width + nx;
              return !trees[next] && !WATER.has(tiles[next].terrain) && traversable(world, nx, ny)
                && canTraverseEdge(world, { x, y }, { x: nx, y: ny });
            })) {
              withoutOpening++;
              if (blocked.length < 5) blocked.push([x, y]);
            }
          }
          return { trees, count, solidCanopy, clearings, withoutOpening, obstructedTerrain, blocked };
        };
        // An even, wet site exercises local spacing without coastlines or
        // differences in habitat creating forest edges of their own.
        const size = 64;
        const wet = { width: size, height: size, seed: 'startup-wet-woodland', source: 'startup', spawns: [],
          tiles: Array.from({ length: size * size }, () => ({ terrain: 'grassland', overlay: 'none', biome: 'rainforest',
            moisture: 1, temperature: .8, elevation: .3, variation: .5, food: 3, production: 1, gold: 0 })) };
        applyTerrainEcology(wet, resolveLandscapeParameters({ forestThreshold: .48, forestLatitudeBias: .06 }));
        const { trees, ...wetStats } = inspect(wet);
        const density = wetStats.count / trees.length;
        const block = 4, blockArea = block ** 2;
        let squaredDeviation = 0;
        for (let y = 0; y < size; y += block) for (let x = 0; x < size; x += block) {
          let canopy = 0;
          for (let dy = 0; dy < block; dy++) for (let dx = 0; dx < block; dx++) canopy += trees[(y + dy) * size + x + dx];
          squaredDeviation += (canopy - blockArea * density) ** 2;
        }
        const variance = squaredDeviation / (size / block) ** 2;
        const independentVariance = blockArea * density * (1 - density);
        const clearingShare = wetStats.clearings / (size - 1) ** 2;
        const { trees: _, ...generated } = inspect(window.__worldViewer.state.world);
        return { generated, wet: { ...wetStats, density, dispersion: variance / independentVariance,
          excessClearings: clearingShare - (1 - density) ** 4 } };
      });
      assert.ok(woodland.generated.count > 0, 'Generated terrain must retain forests');
      for (const landscape of [woodland.generated, woodland.wet]) {
        assert.equal(landscape.obstructedTerrain, 0, 'Trees must stay clear of waterfalls');
      }
      assert.equal(woodland.wet.solidCanopy, 0, 'Ordinary woodland must avoid solid 2×2 canopy');
      assert.equal(woodland.wet.withoutOpening, 0, `Ordinary trees must border a walkable opening (${JSON.stringify(woodland.wet.blocked)})`);
      assert.ok(woodland.wet.density > .3, 'Wet woodland must retain substantial stands');
      assert.ok(woodland.wet.dispersion > 1.25, `Wet woodland should cluster at a local scale (${woodland.wet.dispersion.toFixed(2)})`);
      assert.ok(woodland.wet.excessClearings > .02, `Wet woodland should retain small clearings (${woodland.wet.excessClearings.toFixed(3)})`);
      const result = await page.evaluate(async () => {
        const viewer = window.__worldViewer, state = viewer?.state, renderer = viewer?.renderer;
        if (!state?.units.length || !state.buildings.length) throw new Error('Viewer initial world is empty');
        const { isMapRevealed, presentationFog } = await import('/src/game/fog.ts');
        const fog = presentationFog(state), top = renderer.screenPoint({ x: 0, y: 0 });
        const bottom = renderer.screenPoint({ x: state.world.width, y: state.world.height });
        return { fonts: document.documentElement.dataset.fonts, revealed: isMapRevealed(state) && fog.explored.every(Boolean),
          paused: state.paused && state.time === 0, fits: top.x >= 0 && top.y >= 0 && bottom.x <= renderer.width && bottom.y <= renderer.height,
          sprites: renderer.renderStats.sprites, menu: !!document.querySelector('.frontend'),
          parameters: state.world.generationParameters,
          displayedDensity: Number(document.querySelector('[data-parameter="islandDensity"]').value) };
      });
      assert.equal(result.fonts, 'ready');
      assert.ok(result.revealed, 'Viewer map must be fully revealed');
      assert.ok(result.paused, 'Viewer must keep the initial world frozen');
      assert.ok(result.fits, 'Whole map must fit on the first screen');
      assert.ok(result.sprites > 0, 'Viewer renderer must paint the world');
      assert.equal(result.menu, false, 'Viewer must start without the menu');
      assert.equal(result.parameters.islandDensity, 1.8, 'Viewer must use the game archipelago preset');
      assert.equal(result.displayedDensity, result.parameters.islandDensity, 'Controls must show the generated settings');
      await mkdir('output/startup', { recursive: true });
      await page.screenshot({ path: 'output/startup/world-viewer.png' });
      if (captureFertility) await captureFertilityPreview(page);
      if (captureQuarry) {
        const quarry = await page.evaluate(async () => {
          const { state, renderer } = window.__worldViewer;
          const { width, tiles } = state.world;
          const { buildResourceArtLayout, drawResourceObject } = await import('/src/game/resource-art.ts');
          const { ORE_FORMATION_COUNT } = await import('/src/game/ore-art.ts');
          const groups = new Map();
          for (const [cell, tile] of tiles.entries()) {
            if (tile.resource !== 'stone') continue;
            const key = tile.resourceGroup ?? cell;
            const group = groups.get(key) ?? [];
            group.push(cell);
            groups.set(key, group);
          }
          const cells = [...groups.values()].sort((a, b) => b.length - a.length)[0];
          if (!cells) throw new Error('Quarry capture requires a stone deposit.');
          const layout = buildResourceArtLayout(state.world);
          const first = layout.get(cells[0]), clump = first?.ore;
          const deposits = [...layout.values()].filter(art => art.oreDraw && art.ore?.material === 'stone').map(art => art.ore);
          const selectedShapes = ORE_FORMATION_COUNT === 6 && deposits.every(ore => Number.isInteger(ore.formation)
            && ore.formation >= 0 && ore.formation < ORE_FORMATION_COUNT);
          const compactOre = tiles.every(tile => tile.oreAnchor === undefined || tile.oreWidth <= 5 && tile.oreHeight <= 3);
          if (!clump || clump.material !== 'stone') throw new Error('The quarry is missing its stone formation.');
          const canvas = document.createElement('canvas');
          canvas.width = clump.width * 16;
          canvas.height = clump.height * 16;
          const context = canvas.getContext('2d');
          drawResourceObject(context, first, 0, 0, 16);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let left = canvas.width, right = -1;
          for (let cell = 0; cell < canvas.width * canvas.height; cell++) {
            if (!pixels[cell * 4 + 3]) continue;
            const x = cell % canvas.width;
            left = Math.min(left, x); right = Math.max(right, x);
          }
          renderer.camera = { x: clump.x + clump.width / 2, y: clump.y + clump.height / 2 };
          renderer.zoom = 1.6;
          renderer.draw(state, 0);
          return { compactOre, selectedShapes, renderedWidth: right - left + 1, shared: cells.every(cell => layout.get(cell)?.ore === clump),
            draws: cells.filter(cell => layout.get(cell)?.oreDraw).length };
        });
        assert.ok(quarry.shared && quarry.draws === 1 && quarry.renderedWidth > 16, 'Quarries must render one multi-tile formation per deposit');
        await page.locator('#world-view').screenshot({ path: 'output/startup/quarry-outcrop.png' });
        assert.ok(quarry.selectedShapes, 'Stone deposits must use only the six selected outcrops');
        assert.ok(quarry.compactOre, 'World generation must use the standard ore footprints');
      }
      if (captureMarble) {
        const marble = await page.evaluate(() => {
          const { world } = window.__worldViewer.state;
          const { spawns, secondarySpawns = [], tiles, width } = world;
          const starts = [...spawns.map((point, faction) => ({ point, faction })),
            ...secondarySpawns.map((point, index) => ({ point, faction: index + 1 }))];
          const anchors = tiles.flatMap((tile, cell) => tile.resource === 'marble' && tile.oreAnchor === cell
            && !tile.resourceDeveloped ? [cell] : []);
          const regions = anchors.map(cell => {
            const x = cell % width, y = Math.floor(cell / width);
            const distance = point => (x - Math.floor(point.x)) ** 2 + (y - Math.floor(point.y)) ** 2;
            return starts.slice().sort((a, b) => distance(a.point) - distance(b.point) || a.faction - b.faction)[0]?.faction;
          });
          return { anchor: anchors[0], count: anchors.length, regions: new Set(regions).size };
        });
        const { anchor } = marble;
        assert.ok(anchor >= 0, 'The generated map must contain a marble quarry');
        assert.equal(marble.count, marble.regions, 'Each starting faction region may have at most one marble quarry');
        const renderQuarry = active => page.evaluate(async ({ anchor, active }) => {
          const { state, renderer } = window.__worldViewer;
          const { world } = state;
          const { buildResourceArtLayout } = await import('/src/game/resource-art.ts');
          const { markWorldChanged } = await import('/src/game/world-revisions.ts');
          const cells = [anchor, anchor + 1, anchor + world.width, anchor + world.width + 1];
          const terrain = world.tiles[anchor].terrain;
          if (!cells.every(cell => {
            const tile = world.tiles[cell];
            return tile.resource === 'marble' && tile.oreAnchor === anchor && tile.terrain === terrain;
          })) throw new Error('The marble quarry must cover four matching marble tiles.');
          for (const cell of cells) world.tiles[cell].resourceDeveloped = active;
          markWorldChanged(world, 'appearance', cells);
          const layout = buildResourceArtLayout(world);
          const quarry = layout.get(anchor)?.ore;
          if (quarry?.material !== 'marble' || quarry.width !== 2 || quarry.height !== 2 || quarry.developed !== active
            || !cells.every(cell => layout.get(cell)?.ore === quarry)
            || cells.filter(cell => layout.get(cell)?.oreDraw).length !== 1) {
            throw new Error('The marble quarry must share one 2×2 sprite in each development state.');
          }
          renderer.camera = { x: quarry.x + 1, y: quarry.y + 1 };
          renderer.zoom = 3.4;
          renderer.draw(state, 0);
        }, { anchor, active });
        try {
          for (const active of [false, true]) {
            await renderQuarry(active);
            await page.locator('#world-view').screenshot({ path: `output/startup/marble-${active ? 'active' : 'undeveloped'}.png` });
          }
        } finally {
          await renderQuarry(false);
        }
        await checkMarbleConstruction(page);
      }
      if (captureHarvest || captureCoal) {
        const sizes = { ...(captureHarvest && { peat: 2, grapes: 2 }), ...(captureCoal && { coal: 3 }) };
        await captureResourceSites(page, sizes);
        await checkResourceEconomy(page);
      }
      if (captureOre) {
        const deposits = await page.evaluate(async () => {
          const { state } = window.__worldViewer;
          const { world } = state;
          const { buildResourceArtLayout } = await import('/src/game/resource-art.ts');
          const ores = [...buildResourceArtLayout(world).values()]
            .filter(art => art.oreDraw && art.ore && !art.ore.developed).map(art => art.ore);
          return [['copper', 2], ['iron', 3], ['gold', 5]].map(([material, sampleWidth]) => {
            const matches = ores.filter(ore => ore.material === material);
            matches.sort((a, b) => Math.abs(a.width - sampleWidth) - Math.abs(b.width - sampleWidth)
              || Number(b.palette === 'grassland') - Number(a.palette === 'grassland'));
            const ore = matches[0];
            if (!ore) throw new Error(`Ore capture requires a ${material} deposit.`);
            const cells = ore.visible.map(cell => ore.anchor + cell % ore.width + Math.floor(cell / ore.width) * world.width);
            return { material, anchor: ore.anchor, width: ore.width, height: ore.height, cells,
              camera: { x: ore.x + ore.width / 2, y: ore.y + ore.height / 2 } };
          });
        });
        const renderOre = (deposit, developed) => page.evaluate(async ({ deposit, developed }) => {
          const { renderer, state } = window.__worldViewer, { world } = state;
          const { buildResourceArtLayout } = await import('/src/game/resource-art.ts');
          const { markWorldChanged } = await import('/src/game/world-revisions.ts');
          for (const cell of deposit.cells) world.tiles[cell].resourceDeveloped = developed;
          markWorldChanged(world, 'appearance', deposit.cells);
          const layout = buildResourceArtLayout(world), ore = layout.get(deposit.anchor)?.ore;
          if (!ore || ore.developed !== !!developed || ore.width !== deposit.width || ore.height !== deposit.height
            || !deposit.cells.every(cell => layout.get(cell)?.ore === ore)
            || deposit.cells.filter(cell => layout.get(cell)?.oreDraw).length !== 1)
            throw new Error(`Invalid ${deposit.material} deposit art`);
          renderer.camera = deposit.camera;
          renderer.zoom = 2.35;
          renderer.draw(state, 0);
        }, { deposit, developed });
        for (const deposit of deposits) {
          try {
            await renderOre(deposit, undefined);
            await page.locator('#world-view').screenshot({ path: `output/startup/ore-${deposit.material}.png` });
            await renderOre(deposit, true);
            await page.locator('#world-view').screenshot({ path: `output/startup/ore-${deposit.material}-developed.png` });
          } finally {
            await renderOre(deposit, undefined);
          }
          console.log(`Captured ${deposit.material} deposit and mine (${deposit.width}×${deposit.height})`);
        }
      }
      if (captureAI) {
        // Photograph the initial AI city in the frozen viewer, without gameplay.
        await page.evaluate(() => {
          const { state, renderer } = window.__worldViewer;
          const city = state.buildings.find(building => building.kind === 'palace' && building.faction > 0 && building.villageId === undefined);
          renderer.camera = { x: city.x + 1, y: city.y + 1 };
          renderer.zoom = 1.4; renderer.draw(state, 0);
        });
        await page.screenshot({ path: 'output/startup/ai-start.png' });
      }
      if (captureAgriculture) {
        const agriculture = await page.evaluate(async () => {
          await import('/src/ui/game-font.css');
          await import('/src/style.css');
          await import('/src/ui/forged-hud.css');
          const { ResearchTree } = await import('/src/ui/research-tree.ts');
          const { RESEARCH_CARD_WIDTH, researchCardPosition } = await import('/src/ui/research-tree-layout.ts');
          const { fieldHarvestYield } = await import('/src/game/farms.ts');
          const { citySummaries } = await import('/src/game/cities.ts');
          const { withSimulationReads } = await import('/src/game/simulation-reads.ts');
          const initial = window.__worldViewer.state;
          const owner = initial.factions.find(faction => faction.id === 0);
          const faction = { ...owner, villageBonuses: undefined, research: {
            focus: 'ironPlows', priorities: ['ironPlows'], progress: {},
            levels: { irrigation: 1, grainStorage: 1, woodenTower: 1, wall: 1, blacksmith: 1, metalTools: 1 },
          } };
          const state = { ...initial, world: { ...initial.world, scenario: undefined },
            factions: initial.factions.map(candidate => candidate === owner ? faction : candidate) };
          const field = state.fields.find(candidate => candidate.faction === faction.id && candidate.planted && !candidate.orchard);
          const forecast = () => withSimulationReads(state, () =>
            citySummaries(state, faction.id).reduce((sum, city) => sum + city.food, 0));
          const base = fieldHarvestYield(state, field), initialForecast = forecast();
          faction.research.levels.cropRotation = 1;
          const rotation = fieldHarvestYield(state, field) / base, rotationForecast = forecast();
          faction.research.levels.ironPlows = 1;
          const combined = fieldHarvestYield(state, field) / base, combinedForecast = forecast();
          delete faction.research.levels.ironPlows;

          const popup = document.createElement('section');
          popup.className = 'building-activity is-library';
          popup.dataset.startupAgriculture = '';
          popup.style.cssText = 'position:fixed;z-index:100;left:50%;top:50%;transform:translate(-50%,-50%)';
          popup.innerHTML = '<h2>Research</h2><div class="activity-research"></div>';
          document.body.append(popup);
          const tree = new ResearchTree(popup.querySelector('.activity-research'), { allocate() {}, prioritize() {}, remove() {} });
          tree.refresh(state, { faction: faction.id });
          const scroller = popup.querySelector('.research-tree-scroll');
          scroller.scrollLeft = researchCardPosition('ironPlows').left + RESEARCH_CARD_WIDTH - scroller.clientWidth + 16;
          await Promise.all([...popup.querySelectorAll('img')].map(image => image.decode()));
          await document.fonts.ready;
          const card = id => popup.querySelector(`[data-research="${id}"]`);
          const cost = id => Number(card(id).querySelector('.research-cost-number').textContent);
          return { costs: [cost('cropRotation'), cost('ironPlows')], rotation, combined,
            forecastsIncrease: initialForecast < rotationForecast && rotationForecast < combinedForecast,
            effects: [card('cropRotation').title, card('ironPlows').title],
            pricesFit: ['cropRotation', 'ironPlows'].every(id =>
              card(id).querySelector('.research-cost-number').getBoundingClientRect().bottom <= card(id).getBoundingClientRect().bottom) };
        });
        assert.deepEqual(agriculture.costs, [60, 90]);
        assert.ok(Math.abs(agriculture.rotation - 1.15) < 1e-9);
        assert.ok(Math.abs(agriculture.combined - 1.35) < 1e-9);
        assert.ok(agriculture.forecastsIncrease, 'City food projections should refresh after each research upgrade');
        assert.match(agriculture.effects[0], /\+15% farm yield/);
        assert.match(agriculture.effects[1], /\+20% farm yield/);
        assert.match(agriculture.effects[0], /Requires Grain Storage/);
        assert.match(agriculture.effects[1], /Requires Crop Rotation and Metal Tools/);
        assert.ok(agriculture.pricesFit, 'The new research prices should fit inside their cards');
        const popup = page.locator('[data-startup-agriculture]');
        await popup.screenshot({ path: 'output/startup/agriculture-research.png' });
        const viewport = page.viewportSize();
        const board = await popup.locator('.research-board').boundingBox();
        await page.setViewportSize({ width: Math.ceil(board.width + 110), height: Math.ceil(board.height + 470) });
        await popup.evaluate((element, board) => {
          element.style.width = `${board.width + 78}px`;
          element.style.height = `${board.height + 340}px`;
          element.style.maxHeight = 'none';
          element.querySelector('.research-tree-scroll').scrollTo(0, 0);
        }, board);
        await popup.screenshot({ path: 'output/startup/research-tree-overview.png' });
        await popup.evaluate(element => element.remove());
        await page.setViewportSize(viewport);
      }
      if (captureUI) {
        // Render the real frontend over the frozen viewer for UI screenshots.
        // This never starts a scenario or drives gameplay.
        await page.evaluate(async () => {
          const { Frontend } = await import('/src/ui/frontend.ts');
          const host = document.createElement('div'); document.body.append(host);
          let quickStart;
          const preview = new Frontend(host, action => { if (action.type === 'new') quickStart = action.options; });
          preview.setSettings({ zoom: 1, minZoom: .55, maxZoom: 3, follow: true, fullscreen: false,
            banditIntensity: 0, enemyStrength: 1, autoRebuildDefenses: true });
          preview.show('main');
          host.querySelector('[data-frontend-action="quick"]').click();
          if (quickStart?.style !== 'pangaea' || quickStart.banditIntensity !== 1 || quickStart.banditStrength !== .5)
            throw new Error('Quick Start must use Pangaea and Roaming barbarians at 50% strength');
          preview.show('scenarios');
          const sandbox = host.querySelector('[data-select-scenario="sandbox"]');
          sandbox.focus(); sandbox.click();
          await Promise.all([...host.querySelectorAll('img')].map(image => image.decode()));
          window.__startupUI = preview;
        });
        await page.screenshot({ path: 'output/startup/sandbox.png' });
        await page.evaluate(() => window.__startupUI.loading('Generating world...', '', .67));
        const loading = await page.locator('.frontend-loading.menu-sheet').evaluate(element => {
          const bar = element.querySelector('progress');
          return { title: element.querySelector('#frontend-title').textContent, value: bar.value, width: bar.clientWidth };
        });
        assert.equal(loading.title, 'Generating world...');
        assert.equal(loading.value, .67);
        assert.ok(loading.width > 100, 'The progress bar must be visible');
        await page.screenshot({ path: 'output/startup/loading.png' });
        await captureAccountAndConstructionControls(page);
        await captureFarmRoads(page);
      }
      if (captureArms) await captureArmsPreview(page);
      if (captureMilitary) await captureMilitaryPreview(page);
      if (captureOffensive) await captureOffensivePreview(page);
      if (process.argv.includes('--capture-battlefield-effects')) {
        const { captureBattlefieldEffects } = await import('./startup-battlefield-effects-preview.mjs');
        await captureBattlefieldEffects(page);
      }
      return;
    }
    await page.getByRole('button', { name: 'Continue as guest', exact: true }).waitFor();
    await page.evaluate(() => {
      const game = window.__game;
      if (!game?.state.units.length || !game.state.buildings.length) throw new Error('Initial world is empty');
      const palace = game.state.buildings.find(building => building.faction === 0 && building.kind === 'palace');
      const libraries = game.state.buildings.filter(building => building.faction === 0 && building.kind === 'library');
      const libraryDistance = palace && libraries.length === 1 ? Math.hypot(libraries[0].x - palace.x, libraries[0].y - palace.y) : 0;
      if (game.state.factions[0].gold !== 300 || libraryDistance < 3 || libraryDistance > 5 || !(libraries[0]?.hp > 0) || libraries[0].construction)
        throw new Error('Standard games must start with 300 gold and one finished library 3–5 tiles from the settlement');
      if (game.state.diplomacyState?.relationships.some(pair => pair.war)
        || game.state.factions.some(faction => faction.id >= 0 && faction.relation === 'war')) throw new Error('Standard worlds must start at peace');
      if (document.documentElement.dataset.fonts !== 'ready') throw new Error('Game fonts are not ready');
      const startup = window.__startup = { frames: 0, time: game.state.time, pendingFrames: [] };
      const draw = game.renderer.draw;
      game.renderer.draw = function (...args) {
        draw.apply(this, args);
        if (++startup.frames !== 1) return;
        startup.timeWithoutRendering = game.state.time;
        startup.requestFrame = window.requestAnimationFrame;
        window.requestAnimationFrame = callback => startup.pendingFrames.push(callback);
      };
      game.state.paused = false;
      game.replaceState(game.state);
    });
    // Wait on a timer so this check also works with rendering held.
    await page.waitForFunction(() => window.__startup.frames === 1 && window.__startup.pendingFrames.length > 0
      && window.__game.state.time > window.__startup.timeWithoutRendering, null, { polling: 20, timeout: 4000 });
    await page.evaluate(() => {
      const { requestFrame, pendingFrames } = window.__startup;
      window.requestAnimationFrame = requestFrame;
      for (const callback of pendingFrames) window.requestAnimationFrame(callback);
    });
    await page.waitForFunction(() => window.__startup.frames >= 2
      && window.__game.state.time > window.__startup.time);
    const painted = await page.evaluate(() => {
      const renderer = window.__game.renderer;
      const sample = document.createElement('canvas'); sample.width = sample.height = 16;
      const context = sample.getContext('2d');
      context.drawImage(renderer.snapshot(), 0, 0, 16, 16);
      const pixels = context.getImageData(0, 0, 16, 16).data;
      const colors = new Set();
      for (let i = 0; i < pixels.length; i += 4) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
      return renderer.renderStats.sprites > 0 && colors.size > 1;
    });
    assert.ok(painted, 'World renderer produced an empty or uniform frame');
    if (captureStartingLibrary) {
      await page.setViewportSize({ width: 1120, height: 740 });
      await page.evaluate(() => {
        const { state, renderer } = window.__game;
        const town = state.buildings.find(building => building.faction === 0 && building.kind === 'palace');
        const library = state.buildings.find(building => building.faction === 0 && building.kind === 'library');
        state.paused = true;
        state.selected = library.id;
        state.selectedType = 'building';
        renderer.follow = false;
        renderer.camera = { x: (town.x + library.x) / 2 + 1, y: (town.y + library.y) / 2 + 1 };
        renderer.zoom = 1.15;
        renderer.draw(state, 0);
      });
      await mkdir('output/startup', { recursive: true });
      await page.locator('#selection-panel').getByText('Library', { exact: true }).waitFor();
      await page.screenshot({ path: 'output/startup/starting-library.png' });
    }
    if (captureObserver) {
      await page.setViewportSize({ width: 1120, height: 740 });
      const fixture = await page.evaluate(() => {
        const { state, renderer, replaceState } = window.__game;
        const city = state.buildings.find(building => building.faction > 0 && building.kind === 'palace' && building.hp > 0);
        if (!city) throw new Error('The observer preview requires a rival town');
        state.factions[0].defeated = true;
        state.units = state.units.filter(unit => unit.faction !== 0);
        state.buildings = state.buildings.filter(building => building.faction !== 0);
        state.selected = state.selectedType = null;
        state.gameOver = true;
        replaceState(state);
        renderer.follow = false;
        return { time: state.time, town: { x: city.x + 1, y: city.y + 1 } };
      });
      const observer = page.getByRole('button', { name: 'Stay as observer', exact: true });
      await observer.waitFor();
      await page.waitForFunction(() => document.querySelector('#selection-panel').classList.contains('empty'));
      await mkdir('output/startup', { recursive: true });
      await page.screenshot({ path: 'output/startup/observer-defeat.png' });
      await observer.click();
      await page.getByText('Observing', { exact: true }).waitFor();
      await page.waitForFunction(time => window.__game.state.time > time + 1 && !window.__game.state.gameOver, fixture.time);
      const visible = await page.evaluate(async town => {
        const { state, renderer } = window.__game;
        const { presentationFog, updateFog, pointInSight } = await import('/src/game/fog.ts');
        renderer.camera = town;
        renderer.zoom = .85;
        return { map: presentationFog(state).visible.every(cell => cell === 1),
          townInFactionSight: pointInSight(updateFog(state), town.x, town.y) };
      }, fixture.town);
      assert.deepEqual(visible, { map: true, townInFactionSight: false });
      assert.ok(await page.locator('#dialog').isHidden(), 'The defeat dialog must stay closed');
      assert.ok(await page.locator('.hotbar').isHidden(), 'Observer mode must hide faction commands');
      await page.screenshot({ path: 'output/startup/observer-revealed.png' });
      return;
    }
    if (captureOpening) {
      await page.setViewportSize({ width: 1120, height: 740 });
      const opening = await page.evaluate(async () => {
        const { state, renderer } = window.__game;
        state.paused = true;
        const [{ citySummaries }, { buildCostAt, minimumBuildGold }, { researchCost }, { rustEngine }, { SIM_ENGINE }] = await Promise.all([
          import('/src/game/cities.ts'), import('/src/game/simulation.ts'), import('/src/game/research.ts'),
          import('/src/game/rust-engine.ts'), import('/src/game/sim-handle.ts'),
        ]);
        const city = citySummaries(state, 0)[0], capital = city.palace;
        const harvests = state.fields.filter(field => field.faction === 0).map(field => field.nextHarvest);
        const simulation = rustEngine.sim_create(0);
        const populationEngine = rustEngine.sim_engine_create(simulation, SIM_ENGINE.population, 0, 0, 0);
        const growth = [20, 26, 32].map(peak => {
          const input = rustEngine.population_configure(populationEngine, 1, 1);
          new Float64Array(rustEngine.memory.buffer, input, 15).set([
            1, 0, 0, 20, 5, 0, 0, 0, 0,
            2, 2, 0, 20, 24, 1,
          ]);
          const output = rustEngine.population_run(populationEngine, 500, 20, 1, 0, 1, 0, 1, peak);
          const [, residents, births, credit] = new Float64Array(rustEngine.memory.buffer, output, 4);
          return { residents, births, credit, peak: rustEngine.population_opening_peak(populationEngine) };
        });
        rustEngine.sim_drop(simulation);
        renderer.follow = false;
        renderer.camera = { x: capital.x + 1, y: capital.y + 1 };
        renderer.zoom = 1.05;
        renderer.draw(state, 0);
        return { population: city.population, housing: city.housing, first: Math.min(...harvests), last: Math.max(...harvests),
          house: buildCostAt(state, 'house', capital.x, capital.y).gold, minimum: minimumBuildGold('house', state),
          research: [researchCost(undefined, 'irrigation'), researchCost(undefined, 'grainStorage')],
          discounts: Array.from({ length: 6 }, (_, order) => rustEngine.opening_house_credit(order)), growth };
      });
      assert.equal(opening.population, 20);
      assert.equal(opening.housing, 24);
      assert.ok(opening.first === 8 && opening.last <= 28);
      assert.equal(opening.house, 22.25);
      assert.equal(opening.minimum, opening.house);
      assert.deepEqual(opening.research, [50, 98]);
      assert.deepEqual(opening.discounts, [20, 16, 12, 8, 4, 0]);
      assert.deepEqual(opening.growth.map(({ residents, peak }) => [residents, peak]), [[22, 22], [22, 26], [21, 32]]);
      const baseGrowth = 3 * (0.14 + 5 / 13);
      assert.ok(opening.growth.every(({ births, credit }, index) => Math.abs(births + credit - baseGrowth * (1.8 - .4 * index)) < 1e-9));
      console.log('Opening economy:', opening);
      await mkdir('output/startup', { recursive: true });
      await page.screenshot({ path: 'output/startup/opening-economy.png' });
    }
    if (captureMapTools) {
      await page.setViewportSize({ width: 1120, height: 740 });
      await mkdir('output/startup', { recursive: true });
      await page.evaluate(async () => {
        const { state, renderer } = window.__game;
        state.paused = true;
        const player = state.units.find(unit => unit.kind === 'leader' && unit.faction === 0);
        const start = { x: Math.floor(player.x) - 2, y: Math.floor(player.y) - 2 };
        renderer.areaPreview = { tool: 'cancel', start, end: { x: start.x + 4, y: start.y + 4 } };
        document.querySelector('[data-action="cancel"]').classList.add('active');
        const { Frontend } = await import('/src/ui/frontend.ts');
        const host = document.createElement('div');
        document.body.append(host);
        const preview = new Frontend(host, () => {});
        preview.setSession(true, false);
        preview.hide();
        window.__mapToolsPreview = { preview, host };
      });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const toolBoxes = await page.locator('.special-actions button').evaluateAll(buttons =>
        buttons.map(button => { const { left, top, bottom } = button.getBoundingClientRect(); return { left, top, bottom, tool: button.dataset.action }; }));
      assert.equal(toolBoxes.length, 5);
      assert.equal(toolBoxes[4].tool, 'cancel');
      assert.ok(toolBoxes.every(box => box.top === toolBoxes[0].top && box.bottom <= 740));
      await page.screenshot({ path: 'output/startup/cancel-area.png' });
      await page.evaluate(() => {
        window.__game.renderer.areaPreview = null;
        const { preview } = window.__mapToolsPreview;
        preview.setInGame(true);
        preview.show('game-menu');
      });
      const gameMenu = page.getByRole('dialog', { name: 'Game Menu', exact: true });
      await gameMenu.getByRole('button', { name: 'Resume', exact: true }).waitFor();
      assert.equal(await gameMenu.locator('.frontend-game-menu').getByRole('heading', { includeHidden: true }).count(), 0);
      await page.waitForFunction(() => getComputedStyle(window.__mapToolsPreview.host).backdropFilter.includes('sepia(1)'));
      await page.screenshot({ path: 'output/startup/in-game-menu.png' });
      await gameMenu.getByRole('button', { name: 'New Game', exact: true }).click();
      await page.getByRole('heading', { name: 'World Generation' }).waitFor();
      assert.equal(await page.getByText('Random', { exact: true }).count(), 0);
      await page.screenshot({ path: 'output/startup/world-generation.png' });
      await page.locator('.worldgen-back').click();
      await gameMenu.getByRole('button', { name: 'Resume', exact: true }).waitFor();
      const guideSteps = await page.evaluate(() => {
        const { preview, host } = window.__mapToolsPreview;
        preview.setInGame(false);
        preview.loading('Generating world', '', .65, false, true);
        const guide = host.querySelector('.movement-guide');
        const leader = guide.querySelector('.movement-guide-leader');
        const keys = [...guide.querySelectorAll('kbd')];
        const sprites = [...leader.querySelectorAll('span')];
        const animations = guide.getAnimations({ subtree: true });
        const sample = time => {
          for (const animation of animations) { animation.pause(); animation.currentTime = time; }
          const highlighted = keys.filter(node => getComputedStyle(node).color === 'rgb(43, 32, 15)');
          const visible = sprites.filter(node => getComputedStyle(node).visibility === 'visible');
          const { x, y } = leader.getBoundingClientRect();
          return {
            keys: highlighted.map(node => node.textContent),
            sprites: visible.map(node => node.dataset.guideKey),
            frame: visible[0] && getComputedStyle(visible[0]).backgroundPositionX,
            x, y
          };
        };
        const result = [0, 800, 1600, 2400, 3200].map(start => [sample(start), sample(start + 100), sample(start + 200)]);
        sample(1000);
        return result;
      });
      const guideDirections = [['w', 0, -1], ['a', -1, 0], ['s', 0, 1], ['d', 1, 0], ['w', 0, -1]];
      for (const [index, [boundary, first, second]] of guideSteps.entries()) {
        const [key, dx, dy] = guideDirections[index];
        for (const sample of [boundary, first, second]) {
          assert.deepEqual(sample.keys, [key.toUpperCase()]);
          assert.deepEqual(sample.sprites, [key]);
        }
        assert.deepEqual([Math.sign(second.x - first.x), Math.sign(second.y - first.y)], [dx, dy]);
        assert.notEqual(first.frame, second.frame, `Leader should advance a walk frame while holding ${key.toUpperCase()}`);
      }
      await page.locator('.movement-guide').screenshot({ path: 'output/startup/wasd-guide.png' });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const staticGuide = await page.locator('.movement-guide').evaluate(guide => ({
        animationCount: guide.getAnimations({ subtree: true }).length,
        visible: [...guide.querySelectorAll('.movement-guide-leader span')]
          .filter(node => getComputedStyle(node).visibility === 'visible').map(node => node.dataset.guideKey)
      }));
      assert.deepEqual(staticGuide, { animationCount: 0, visible: ['s'] });
      await page.emulateMedia({ reducedMotion: null });
      await page.evaluate(() => window.__mapToolsPreview.host.remove());
    }
    if (captureMenu) {
      await page.setViewportSize({ width: 1280, height: 960 });
      await page.evaluate(async () => {
        window.__game.state.paused = true;
        const { Frontend } = await import('/src/ui/frontend.ts');
        const host = document.createElement('div'); document.body.append(host);
        const preview = new Frontend(host, () => {});
        preview.setSession(true, false); preview.show('main');
        await Promise.all([...host.querySelectorAll('img')].map(image => image.decode()));
        window.__menuReview = { preview, host };
      });
      await mkdir('output/startup', { recursive: true });
      await page.screenshot({ path: 'output/startup/main-menu-account.png' });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: 'output/startup/main-menu-account-mobile.png' });
      await page.evaluate(() => { window.__menuReview.host.remove(); });
    }
    if (captureFeedback) await captureFeedbackPreview(page);
    if (captureArms) await captureArmsPreview(page);
    if (captureOffensive) await captureOffensivePreview(page);
    if (captureBuildings) await captureBuildingPreview(page);
    if (process.argv.includes('--capture-barbarian-lair')) await captureBarbarianLairPreview(page);
    if (process.argv.includes('--capture-combat-edge')) await captureCombatEdgePreview(page);
    if (process.argv.includes('--capture-fountain')) {
      const { captureFountainPreview } = await import('./startup-fountain-preview.mjs');
      await captureFountainPreview(page);
    }
    if (process.argv.includes('--capture-town-growth')) {
      const { captureTownGrowthPreview } = await import('./startup-town-growth-preview.mjs');
      await captureTownGrowthPreview(page);
    }
    if (process.argv.includes('--capture-settlement')) {
      const { captureSettlementPreview } = await import('./startup-settlement-preview.mjs');
      await captureSettlementPreview(page);
    }
    if (process.argv.includes('--capture-frontier-village')) {
      const { captureFrontierVillagePreview } = await import('./startup-frontier-village-preview.mjs');
      await captureFrontierVillagePreview(page);
    }
    if (captureScoutTowers) {
      await page.setViewportSize({ width: 1360, height: 940 });
      await page.evaluate(async () => {
        const { state } = window.__game;
        const { Renderer } = await import('/src/game/renderer.ts');
        const town = state.buildings.find(b => b.kind === 'palace' && b.faction === 0 && b.initialCity);
        const towers = state.buildings.filter(b => b.kind === 'scoutTower' && b.faction === 0);
        const host = document.createElement('div');
        Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '99999', background: '#20261c' });
        host.innerHTML = '<canvas style="width:100%;height:100%;display:block"></canvas><canvas hidden></canvas>';
        document.body.append(host);
        const [canvas, minimap] = host.querySelectorAll('canvas'), renderer = new Renderer(canvas, minimap);
        await renderer.initialize();
        renderer.follow = false;
        renderer.camera = { x: town.x + 1, y: town.y + 1 };
        renderer.zoom = 1.05;
        renderer.draw(state, 0);
        for (const tower of towers) {
          const { x, y } = renderer.screenPoint({ x: tower.x + .5, y: tower.y + 1.12 });
          const label = document.createElement('div');
          Object.assign(label.style, { position: 'absolute', left: `${x}px`, top: `${y}px`, transform: 'translateX(-50%)',
            padding: '3px 7px', border: '1px solid #a89059', background: '#15201aec',
            color: '#f6e3ae', font: '20px "Pixel Operator"' });
          label.textContent = 'Scout tower';
          host.append(label);
        }
      });
      await mkdir('output/startup', { recursive: true });
      await page.screenshot({ path: 'output/startup/scout-towers.png' });
    }
    if (captureCivicArt) await captureCivicArtGallery(page);
    if (captureCivic) await captureCivicPreview(page);
    if (captureCannonFire) await captureCannonFirePreview(page);
    if (process.argv.includes('--capture-upkeep')) await captureUpkeepPreview(page);
    if (captureShellImpact) await captureShellImpactPreview(page);
    if (captureMeadow) await captureMeadowPreview(page);
    if (captureFertility) await captureFertilityPreview(page);
    if (process.argv.includes('--capture-unit-trails')) {
      const { captureUnitTrailsPreview } = await import('./startup-unit-trails-preview.mjs');
      await captureUnitTrailsPreview(page);
    }
    if (captureMilitary) await captureMilitaryPreview(page);
  })()]);
  clearTimeout(timer);
  if (process.argv.includes('--check-city-fixes')) {
    const result = await page.evaluate(async () => {
      const [{ territory, UNCLAIMED }, { removeBuildings }, { isHouseEnclosed, stoneWalledPalaces },
        { factionDevelopedResourceCount }, { buildAt, validateBuildAt }] = await Promise.all([
        import('/src/game/borders.ts'), import('/src/game/construction-cancellation.ts'), import('/src/game/enclosures.ts'),
        import('/src/game/resource-development.ts'), import('/src/game/simulation.ts'),
      ]);
      const width = 36, height = 28;
      const world = { width, height, seed: 'city-fix-review', source: 'test', spawns: [], revision: 0,
        tiles: Array.from({ length: width * height }, () => ({
          terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 2, gold: 0, production: 1, variation: .5,
        })) };
      const structure = (id, kind, x, y) => ({ id, kind, faction: 0, x, y, hp: 100, maxHp: 100, capacity: 0 });
      const home = structure(1, 'palace', 10, 10), house = structure(2, 'house', 13, 10);
      const buildings = [home, house, structure(3, 'palace', 25, 10), structure(4, 'road', 7, 11)];
      for (let y = 7; y <= 15; y++) for (let x = 7; x <= 17; x++)
        if (x === 7 || y === 7 || x === 17 || y === 15) buildings.push(structure(buildings.length + 1, 'wall', x, y));
      const leader = { id: 500, kind: 'leader', faction: 0, x: 20.5, y: 13.5, hp: 100, maxHp: 100, morale: 100,
        speed: 3.6, range: 4, attack: 10, defense: 3, cooldown: 0, lastCombat: -100, moving: false, facing: 0, attackTime: 0, order: 'hold' };
      const units = [leader, { ...leader, id: 501, kind: 'merchant', faction: 1, x: 12.5, y: 12.5 }];
      const factions = [0, 1].map(id => ({ id, name: String(id), color: '#aa6a55', relation: id ? 'peace' : 'self',
        gold: 1000, food: 500, production: 0, population: 1, nextRaid: Infinity,
        yields: { gold: 0, food: 0, production: 0 }, defeated: false }));
      const state = { world, buildings, units, factions, time: 0, tick: 0, paused: true, speed: 1,
        events: [], particles: [], fields: [], selected: null, selectedType: null, buildMode: null, diplomacy: null,
        gameOver: false, victory: false, seed: world.seed, rngState: 1 };
      const iron = 10 * width + 14, copper = 12 * width + 26, rock = 9 * width + 21, forest = 9 * width + 18;
      Object.assign(world.tiles[iron], { resource: 'iron', resourceDeveloped: true });
      Object.assign(world.tiles[copper], { resource: 'copper', resourceDeveloped: true });
      Object.assign(world.tiles[rock], { rockHost: rock, rockRelief: 0 });
      world.tiles[rock + 1].relief = 'mountains';
      world.tiles[forest].overlay = 'forest';
      const visitor = isHouseEnclosed(state, house) && stoneWalledPalaces(state).has(home.id);
      factions[1].relation = 'war';
      const intruder = !isHouseEnclosed(state, house) && !stoneWalledPalaces(state).has(home.id);
      const supplied = factionDevelopedResourceCount(state, 0, 'iron');
      const preview = validateBuildAt(state, 'palace', 18, 9);
      const untouchedForest = world.tiles[forest].overlay === 'forest';
      const ordered = buildAt(state, 'palace', 18, 9);
      const clearedForest = world.tiles[forest].overlay === 'none';
      removeBuildings(state, new Set([home.id]));
      return { visitor, intruder, supplied, preview, untouchedForest, ordered, clearedForest,
        lostClaim: territory(state).owners[iron] === UNCLAIMED,
        lostIron: factionDevelopedResourceCount(state, 0, 'iron'),
        keptCopper: factionDevelopedResourceCount(state, 0, 'copper') };
    });
    assert.equal(result.visitor, true);
    assert.equal(result.intruder, true);
    assert.equal(result.supplied, 1);
    assert.equal(result.preview.ok, true, result.preview.message);
    assert.equal(result.untouchedForest, true);
    assert.equal(result.ordered.ok, true, result.ordered.message);
    assert.equal(result.clearedForest, true);
    assert.equal(result.lostClaim, true);
    assert.equal(result.lostIron, 0);
    assert.equal(result.keptCopper, 1);
    console.log('Frozen city checks passed.');
  }
  if (process.argv.includes('--capture-thermal-bath')) await captureThermalBathPreview(page);
  if (process.argv.includes('--capture-beached-galley')) await captureBeachedGalleyPreview(page);
  if (process.argv.includes('--check-scenario-camps')) {
    const { camps, reserves } = await page.evaluate(async () => {
      const { createScenarioGame } = await import('/src/game/scenario-loader.ts');
      const state = await createScenarioGame('age-of-exploration');
      const starts = [...state.world.spawns, ...state.units.filter(unit => unit.kind === 'leader' && unit.faction >= 0)];
      const camps = state.raiderCamps.map(camp => ({
        size: camp.size,
        clearance: Math.min(...starts.map(start => Math.hypot(
          Math.max(camp.x - start.x, start.x - camp.x - camp.width, 0),
          Math.max(camp.y - start.y, start.y - camp.y - camp.height, 0)))),
      }));
      return { camps, reserves: state.units.filter(unit => unit.faction === -2 && unit.raiderGarrison !== undefined).length };
    });
    assert.ok(camps.some(camp => camp.size === 'small') && camps.some(camp => camp.size === 'large'));
    assert.ok(camps.every(camp => camp.clearance >= 60));
    assert.ok(reserves > 0, 'Age of Exploration camps must have fresh reserves');
    console.log('Age of Exploration camps:', { camps, reserves });
  }
  if (checkScoutScenarios) {
    const counts = await page.evaluate(async () => {
      const { SCENARIOS } = await import('/src/game/scenario-content.ts');
      const { createScenarioGame } = await import('/src/game/scenario-loader.ts');
      const result = {};
      for (const { id } of SCENARIOS) {
        const state = await createScenarioGame(id);
        const factions = new Map(state.buildings.filter(b => b.kind === 'palace' && b.initialCity).map(b => [b.faction, 0]));
        for (const tower of state.buildings) if (tower.kind === 'scoutTower')
          factions.set(tower.faction, (factions.get(tower.faction) ?? 0) + 1);
        result[id] = [...factions.values()];
      }
      return result;
    });
    for (const [id, factions] of Object.entries(counts)) {
      const hasStartingScouts = id !== 'sandbox' && id !== 'no-mans-land';
      assert.ok(factions.length && factions.every(count => hasStartingScouts ? count >= 2 && count <= 4 : count === 0),
        `${id} scout towers by faction: ${factions}`);
    }
    console.log('Scout towers in scenario starts:', counts);
  }
  if (checkScenarioTownRoads) {
    const viewport = page.viewportSize();
    if (captureScenarioTownRoads) await page.setViewportSize({ width: 960, height: 620 });
    const counts = await page.evaluate(async capture => {
      const { SCENARIOS } = await import('/src/game/scenario-content.ts');
      const { createScenarioGame } = await import('/src/game/scenario-loader.ts');
      const { assertPreparedTownRoadRings } = await import('/tools/scenario-bake/streets.ts');
      const counts = {};
      let preview;
      for (const { id } of SCENARIOS) {
        const state = await createScenarioGame(id);
        counts[id] = assertPreparedTownRoadRings(state);
        if (capture && id === 'age-of-exploration') preview = state;
      }
      if (preview) {
        const { Renderer } = await import('/src/game/renderer.ts');
        const { setMapRevealed } = await import('/src/game/fog.ts');
        const towns = preview.buildings.filter(building => building.kind === 'palace' && building.hp > 0);
        const town = towns.find(building => building.cityName === 'Persepolis') ?? towns[0];
        preview.paused = true;
        setMapRevealed(preview, true);
        const host = document.createElement('div');
        Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '99999', background: '#20261c' });
        host.innerHTML = '<canvas style="width:100%;height:100%;display:block"></canvas><canvas hidden></canvas>';
        document.body.append(host);
        const [canvas, minimap] = host.querySelectorAll('canvas');
        const renderer = new Renderer(canvas, minimap);
        await renderer.initialize();
        renderer.follow = false;
        renderer.camera = { x: town.x + 1, y: town.y + 1 };
        renderer.zoom = 2.6;
        renderer.draw(preview, 0);
        window.__townRoadsPreview = { host, renderer };
      }
      return counts;
    }, captureScenarioTownRoads);
    for (const [id, count] of Object.entries(counts)) assert.ok(count > 0, `${id} needs at least one town`);
    console.log('Walkable town road rings in scenario starts:', counts);
    if (captureScenarioTownRoads) {
      await mkdir('output/startup', { recursive: true });
      await page.screenshot({ path: 'output/startup/scenario-town-roads.png' });
      await page.evaluate(() => {
        const { host, renderer } = window.__townRoadsPreview;
        renderer.destroy(); host.remove(); delete window.__townRoadsPreview;
      });
      await page.setViewportSize(viewport);
    }
  }
  if (captureArt) {
    const { captureRuntimeArtReview } = await import('../tools/runtime-art/verify.mjs');
    await captureRuntimeArtReview(browser, server.resolvedUrls.local[0]);
  }
  if (captureSettlementTiers) {
    const { captureSettlementTierPreview } = await import('./startup-settlement-tier-preview.mjs');
    await captureSettlementTierPreview(page);
  }
  if (captureAnalytics) await captureAnalyticsPreview(browser, server.resolvedUrls.local[0]);
  const checked = captureFjords ? 'regional Fjords on Continents, Pangaea and Archipelago'
    : worldViewer ? 'world viewer, full reveal, frozen world, fit camera and screenshot'
    : 'browser imports, assets, fonts, simulation and world rendering';
  console.log(`PASS startup: ${checked} (${((performance.now() - started) / 1000).toFixed(1)}s)`);
} catch (error) {
  await mkdir('output/startup', { recursive: true });
  await Promise.allSettled([
    writeFile('output/startup/error.log', [error.stack || String(error), ...errors].join('\n')),
    page?.screenshot({ path: 'output/startup/failure.png', timeout: 2000 }),
  ]);
  throw error;
} finally {
  clearTimeout(timer);
  await browser?.close();
  await server.close();
  await rm(startupCache, { recursive: true, force: true });
}

async function captureAccountAndConstructionControls(page) {
  await page.evaluate(() => {
    window.__startupUI.show('create-account');
    document.querySelector('#account-username').value = 'fieldworker';
    document.querySelector('#account-password').value = 'preview';
    document.querySelector('#account-confirm').value = 'preview';
    document.querySelector('.account-submit').click();
  });
  const dialog = page.locator('.account-dialog[open]');
  assert.match(await dialog.textContent(), /If you do not provide an email address, we will not be able to reset your password if you forget it\./);
  await dialog.screenshot({ path: 'output/startup/account-without-email.png' });
  await dialog.getByRole('button', { name: 'Continue without email' }).click();
  assert.equal(await dialog.locator('[role="status"]').textContent(), 'Creating account...');
  await dialog.screenshot({ path: 'output/startup/account-creating.png' });
  await page.evaluate(() => window.__startupUI.showAccountCreated());
  await dialog.screenshot({ path: 'output/startup/account-created.png' });
  await page.evaluate(() => {
    const preview = window.__startupUI;
    preview.setAccountBusy(false);
    preview.setAccount({ id: 'preview', username: 'fieldworker', email: null, displayName: 'fieldworker', createdAt: '2026-11-20T00:00:00Z' });
    preview.setSession(true);
    preview.setSaves([{ id: 'single-player', name: 'Autosave', time: 300, seed: 'NORTH-REACH', civilization: 'Roma', savedAt: Date.UTC(2026, 10, 20, 20) }], 'Roma');
    preview.show('saves');
  });
  await page.getByRole('button', { name: 'Save to Cloud' }).waitFor();
  await page.locator('.frontend-saves').screenshot({ path: 'output/startup/cloud-saves.png' });
  await page.evaluate(async () => {
    window.__startupUI.hide();
    await import('/src/ui/forged-hud.css');
    await import('/src/ui/reference-buttons.css');
    const { constructionActionsMarkup } = await import('/src/ui/build-controls-view.ts');
    const preview = document.createElement('div');
    preview.className = 'game-area';
    preview.dataset.startupControls = '';
    Object.assign(preview.style, { position: 'fixed', right: '0', bottom: '0', width: '520px', height: '120px', zIndex: '99999' });
    preview.innerHTML = `<div class="special-actions">${constructionActionsMarkup({ build: 'Build', fortifications: 'Fortify', clear: 'Clear', forbid: 'Forbid', cancel: 'Cancel' })}</div>`;
    document.body.append(preview);
  });
  const controls = page.locator('[data-startup-controls] .special-actions');
  assert.deepEqual(await controls.locator('kbd').allTextContents(), ['B', 'F', 'C']);
  await controls.screenshot({ path: 'output/startup/construction-shortcuts.png' });
  await page.locator('[data-startup-controls]').evaluate(node => node.remove());
}

async function captureFarmRoads(page) {
  await page.evaluate(async () => {
    const state = structuredClone(window.__worldViewer.state);
    const [{ Renderer }, { setMapRevealed }, { reliefFootprintAllowed }, { recordFarmRoadCrossing, publishFarmRoads }, { WATER, buildingWidth, buildingHeight }] = await Promise.all([
      import('/src/game/renderer.ts'), import('/src/game/fog.ts'), import('/src/game/relief.ts'),
      import('/src/game/farm-roads.ts'), import('/src/game/types.ts'),
    ]);
    const { world } = state;
    const occupied = new Set();
    for (const building of state.buildings) for (let y = 0; y < buildingHeight(building); y++) for (let x = 0; x < buildingWidth(building); x++)
      occupied.add((building.y + y) * world.width + building.x + x);
    const open = ({ x, y }) => {
      const cell = y * world.width + x, tile = world.tiles[cell];
      return tile && !WATER.has(tile.terrain) && tile.farm === undefined && !tile.resource
        && !occupied.has(cell) && reliefFootprintAllowed(world, x, y);
    };
    let route;
    for (const field of state.fields.filter(field => field.faction === 0)) {
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const path = [3, 2, 1].map(step => ({ x: field.x + dx * step, y: field.y + dy * step }));
        if (path.every(open)) { route = { path, field }; break; }
      }
      if (route) break;
    }
    if (!route) throw new Error('Farm road preview needs three open tiles beside a field');
    const { path, field } = route, start = path[0];
    const courier = state.units.find(unit => unit.faction === 0 && unit.collector);
    Object.assign(courier, { inside: false, collectPhase: 'outbound', x: field.x + .5, y: field.y + .5 });
    recordFarmRoadCrossing(state, courier, start.x + .5, start.y + .5);
    recordFarmRoadCrossing(state, courier, start.x + .5, start.y + .5);
    const first = state.buildings.length;
    publishFarmRoads(state);
    const added = state.buildings.slice(first);
    if (added.length !== path.length || !path.every(point => added.some(road => road.kind === 'road' && road.x === point.x && road.y === point.y)))
      throw new Error('Farm roads must cover each open crossing once and preserve the field');
    Object.assign(courier, { x: path[1].x + .5, y: path[1].y + .5, facing: Math.atan2(field.y - start.y, field.x - start.x), moving: true });
    const host = document.createElement('div');
    host.id = 'startup-farm-roads';
    Object.assign(host.style, { position: 'fixed', inset: '0', margin: 'auto', width: '620px', height: '410px', zIndex: '99999' });
    host.innerHTML = '<canvas style="width:100%;height:100%;display:block"></canvas><canvas hidden></canvas>';
    document.body.append(host);
    const renderer = new Renderer(...host.querySelectorAll('canvas'));
    await renderer.initialize();
    setMapRevealed(state, true);
    renderer.follow = false;
    renderer.camera = { x: path[1].x + .5, y: path[1].y + .5 };
    renderer.zoom = 2.1;
    renderer.draw(state, 0);
    window.__farmRoadPreview = { host, renderer };
  });
  await page.locator('#startup-farm-roads').screenshot({ path: 'output/startup/farm-roads.png' });
  await page.evaluate(() => {
    const { host, renderer } = window.__farmRoadPreview;
    renderer.destroy(); host.remove(); delete window.__farmRoadPreview;
  });
}

async function captureFjordPreview(page, style, screenshot) {
  if (screenshot) {
    await mkdir('output/startup', { recursive: true });
    await page.locator('#world-view').screenshot({ path: 'output/startup/fjords-world.png' });
  }
  const result = await page.evaluate(async capture => {
    const { state, renderer } = window.__worldViewer;
    const { width, height, tiles } = state.world;
    const [{ navigableWaterCell }, { traversable }, { dockPlacement }, { waterDepthField }, { fishSurfaceFrame }, { TILE_SIZE }] = await Promise.all([
      import('/src/game/water-navigation.ts'), import('/src/game/pathfinding.ts'), import('/src/game/dock.ts'),
      import('/src/game/water-depth.ts'), import('/src/game/fishing-art.ts'), import('/src/game/types.ts'),
    ]);
    const shore = [], water = [];
    const waterDepth = waterDepthField(state.world);
    const saltwater = tile => tile.terrain === 'ocean' || tile.terrain === 'coast';
    let rocks = 0, ledges = 0, deep = 0, unclassified = 0, otherBiomes = 0;
    let left = width, top = height, right = 0, bottom = 0;
    for (const [cell, tile] of tiles.entries()) {
      const x = cell % width, y = Math.floor(cell / width);
      if (tile.fjord && tile.biome !== 'fjords') unclassified++;
      if (tile.biome && tile.biome !== 'fjords') otherBiomes++;
      if (tile.fjord === 'shore') shore.push({ x, y });
      if (tile.fjord === 'rock' && tile.rockHost !== undefined) rocks++;
      if (tile.ridge || tile.stair) ledges++;
      if (tile.fjord === 'water') {
        water.push(cell);
        if (waterDepth.bands[cell] === 2) deep++;
        left = Math.min(left, x); top = Math.min(top, y);
        right = Math.max(right, x); bottom = Math.max(bottom, y);
      }
    }
    // Flood open sea once to verify the inlet tags have navigable outlets.
    const seen = new Uint8Array(tiles.length), queue = [];
    const visit = (x, y) => {
      const cell = y * width + x;
      if (!seen[cell] && saltwater(tiles[cell]) && navigableWaterCell(state.world, x, y)) { seen[cell] = 1; queue.push(cell); }
    };
    for (let x = 0; x < width; x++) { visit(x, 0); visit(x, height - 1); }
    for (let y = 1; y < height - 1; y++) { visit(0, y); visit(width - 1, y); }
    for (let head = 0; head < queue.length; head++) {
      const cell = queue[head], x = cell % width, y = Math.floor(cell / width);
      if (x) visit(x - 1, y);
      if (x + 1 < width) visit(x + 1, y);
      if (y) visit(x, y - 1);
      if (y + 1 < height) visit(x, y + 1);
    }
    const dock = shore.some(({ x, y }) => {
      const berth = dockPlacement(state, x, y)?.berth;
      return berth && tiles[Math.floor(berth.y) * width + Math.floor(berth.x)].fjord === 'water';
    });
    const zones = state.fishing.zones.filter(zone => zone.cells.length && zone.cells.every(cell => tiles[cell].fjord === 'water'));
    const districtStocks = new Map();
    for (const zone of zones) {
      const cell = zone.cells[0], key = `${Math.floor((cell % width) / 12)}:${Math.floor(cell / width / 12)}`;
      districtStocks.set(key, 1 + (districtStocks.get(key) ?? 0));
    }
    const fish = state.fishing.fish.filter(({ x, y }) => tiles[Math.floor(y) * width + Math.floor(x)].fjord === 'water');
    const report = { style: state.world.generationStyle, family: state.world.landformFamily, unclassified, otherBiomes,
      water: water.length, deep, rocks, ledges, dock,
      outlets: water.every(cell => seen[cell]), openShore: shore.filter(({x, y}) => traversable(state.world, x, y)).length,
      zones: zones.length, splitDistricts: [...districtStocks.values()].filter(count => count === 2).length,
      fish: fish.length, paused: state.paused && state.time === 0 };
    if (!capture || !water.length) return report;
    renderer.camera = { x: (left + right + 1) / 2, y: (top + bottom + 1) / 2 };
    renderer.zoom = Math.min(renderer.width / ((right - left + 17) * TILE_SIZE),
      renderer.height / ((bottom - top + 17) * TILE_SIZE), 1.5);
    // Freeze a normal frame with several simultaneous fish breaches for the screenshot.
    let best = 0, artTime = 0;
    for (let frame = 0; frame < 140; frame++) {
      const time = frame / 5, visible = fish.filter(value => fishSurfaceFrame(value, time) >= 0).length;
      if (visible > best) { best = visible; artTime = time; }
    }
    const pausedTime = state.time;
    state.time = artTime;
    try { renderer.draw(state, 0); } finally { state.time = pausedTime; }
    return { ...report, visibleFish: best };
  }, screenshot);
  const summary = JSON.stringify(result);
  assert.equal(result.style, style, summary);
  assert.equal(result.family, 'mixed', summary);
  assert.equal(result.unclassified, 0, summary);
  assert.ok(result.otherBiomes > result.water, summary);
  assert.ok(result.paused && result.water > 100 && result.deep > 0 && result.rocks > 15, summary);
  assert.ok(result.outlets && result.dock && result.openShore > 20, summary);
  assert.ok(result.zones >= 4 && result.splitDistricts >= 2 && result.fish > 0, summary);
  assert.equal(result.ledges, 0, summary);
  if (screenshot) {
    assert.ok(result.visibleFish > 0, summary);
    await mkdir('output/startup', { recursive: true });
    await page.locator('#world-view').screenshot({ path: 'output/startup/fjords.png' });
  }
  console.log(`Fjords ${summary}`);
}

async function captureResourceSites(page, sizes) {
  const anchors = await page.evaluate(resources => {
    const { tiles } = window.__worldViewer.state.world;
    return Object.fromEntries(resources.map(resource => [resource,
      tiles.flatMap((tile, cell) => tile.resource === resource && tile.oreAnchor === cell ? [cell] : [])]));
  }, Object.keys(sizes));
  const renderSite = (resource, anchor, size, developed) => page.evaluate(async ({ resource, anchor, size, developed }) => {
    const { state, renderer } = window.__worldViewer;
    const { world } = state, { width, tiles } = world;
    const { buildResourceArtLayout } = await import('/src/game/resource-art.ts');
    const { markWorldChanged } = await import('/src/game/world-revisions.ts');
    const cells = Array.from({ length: size * size }, (_, index) => anchor + index % size + Math.floor(index / size) * width);
    const terrain = tiles[anchor].terrain;
    if (!cells.every(cell => tiles[cell].resource === resource && tiles[cell].oreAnchor === anchor
      && tiles[cell].terrain === terrain)) throw new Error(`Invalid ${resource} footprint`);
    for (const cell of cells) tiles[cell].resourceDeveloped = developed;
    markWorldChanged(world, 'appearance', cells);
    const layout = buildResourceArtLayout(world), site = layout.get(anchor)?.ore;
    if (site?.material !== resource || site.width !== size || site.height !== size || site.developed !== developed
      || !cells.every(cell => layout.get(cell)?.ore === site)
      || cells.filter(cell => layout.get(cell)?.oreDraw).length !== 1) throw new Error(`Invalid ${resource} art`);
    renderer.camera = { x: site.x + size / 2, y: site.y + size / 2 };
    renderer.zoom = 3.4;
    renderer.draw(state, 0);
  }, { resource, anchor, size, developed });
  for (const [resource, sites] of Object.entries(anchors)) {
    assert.ok(sites.length > 0 && sites.length <= 3, `Expected one to three ${resource} sites, got ${sites.length}`);
    console.log(`Generated ${sites.length} ${resource} site(s)`);
    try {
      for (const developed of [false, true]) {
        await renderSite(resource, sites[0], sizes[resource], developed);
        await page.locator('#world-view').screenshot({ path: `output/startup/${resource}-${developed ? 'developed' : 'undeveloped'}.png` });
      }
    } finally {
      await renderSite(resource, sites[0], sizes[resource], false);
    }
  }
}

/** Exercise the resource purchase and economy on a fixture while the viewer is frozen. */
async function checkResourceEconomy(page) {
  const result = await page.evaluate(async () => {
    const { state } = window.__worldViewer;
    const [{ developResourceGroup }, { revealExplorationCells }, { buildingMaintenance },
      { fieldCannonUpkeep }, { marketQuote }, { factoryIncomeQuote }, { cityTaxIncome }, { markWorldChanged }] = await Promise.all([
      import('/src/game/resource-development.ts'), import('/src/game/fog.ts'), import('/src/game/maintenance.ts'),
      import('/src/game/field-cannons-native.ts'), import('/src/game/marketplace.ts'),
      import('/src/game/factory-economy.ts'), import('/src/game/cities.ts'), import('/src/game/world-revisions.ts'),
    ]);
    const width = 32, height = 20, faction = 0;
    const palace = state.buildings.find(b => b.kind === 'palace' && b.faction === faction);
    const leader = state.units.find(u => u.kind === 'leader' && u.faction === faction);
    const owner = state.factions.find(f => f.id === faction);
    const world = { width, height, seed: 'resource-economy-startup', spawns: [{ x: 8, y: 8 }], revision: 0,
      tiles: Array.from({ length: width * height }, () => ({
        terrain: 'grassland', overlay: 'none', elevation: .45, moisture: .6, variation: .5, food: 2, production: 0, gold: 0,
      })) };
    const city = { ...palace, id: 101, x: 8, y: 8 };
    const partner = { ...city, id: 102, x: 24 };
    const factory = { ...city, id: 103, kind: 'factory', x: 8, y: 12 };
    const otherFactory = { ...factory, id: 104, x: 24 };
    const cannon = { ...leader, id: 105, kind: 'fieldCannon', fieldCannon: { supplyCity: city.id, nextUpkeepAt: 30, funded: true } };
    const fixture = { ...state, world, fog: undefined, fields: [], resourceWorkSites: [], nextResourceWorkSiteId: 1,
      factions: [{ ...owner, gold: 1000 }], buildings: [city, partner, factory, otherFactory],
      units: [{ ...leader, x: 9.5, y: 10.5 }], villages: [], hermits: [], explorationSites: [] };
    const addSite = (resource, x, y, size = 2) => {
      const anchor = y * width + x;
      const cells = Array.from({ length: size * size }, (_, index) => anchor + index % size + Math.floor(index / size) * width);
      for (const cell of cells) Object.assign(world.tiles[cell], { resource, resourceGroup: anchor,
        oreAnchor: anchor, oreWidth: size, oreHeight: size, oreFamily: size - 2 });
      return cells;
    };
    const coalCells = addSite('coal', 5, 9, 3);
    revealExplorationCells(fixture, faction, [...addSite('peat', 5, 7), ...addSite('grapes', 11, 8), ...coalCells]);
    const quote = () => marketQuote(fixture, city, partner, { distance: 30, seconds: 30 }, 75, 75, 1, 1);
    const income = () => factoryIncomeQuote(fixture)(faction, 100);
    const taxes = () => cityTaxIncome(fixture, fixture.factions[0]);
    const baseline = { factory: buildingMaintenance(fixture, factory), cannon: fieldCannonUpkeep(fixture, cannon), trade: quote(),
      factoryIncome: income(), cityTax: taxes() };
    const peat = developResourceGroup(fixture, 5, 7, faction);
    const grapes = developResourceGroup(fixture, 11, 8, faction);
    const coal = developResourceGroup(fixture, 5, 9, faction);
    const factoryIncome = income(), cityTax = taxes();
    const coalTiles = coalCells.filter(cell => world.tiles[cell].resourceDeveloped).length;
    const factoryHp = factory.hp;
    factory.hp = 0;
    const afterFactoryLoss = income();
    factory.hp = factoryHp;
    const afterFactoryReturn = income();
    for (const cell of coalCells) delete world.tiles[cell].resourceDeveloped;
    markWorldChanged(world, 'appearance', coalCells);
    return {
      baseline, peat, grapes, coal, coalTiles, factoryIncome, cityTax, afterFactoryLoss, afterFactoryReturn,
      afterCoalLoss: income(), factory: buildingMaintenance(fixture, factory), cannon: fieldCannonUpkeep(fixture, cannon),
      otherFactory: buildingMaintenance(fixture, otherFactory), trade: quote(),
    };
  });
  assert.ok(result.peat.ok && result.grapes.ok && result.coal.ok, JSON.stringify(result));
  assert.ok(result.baseline.factory > 0 && result.baseline.cannon > 0 && result.baseline.trade.outboundGold > 0);
  assert.equal(result.factory, result.baseline.factory * .7);
  assert.equal(result.cannon, result.baseline.cannon * .7);
  assert.equal(result.otherFactory, result.baseline.factory);
  assert.equal(result.trade.outboundGold, result.baseline.trade.outboundGold * 1.3);
  assert.equal(result.trade.returnGold, result.baseline.trade.returnGold);
  assert.equal(result.trade.science, result.baseline.trade.science);
  assert.equal(result.coalTiles, 9);
  assert.equal(result.baseline.factoryIncome, 140, 'Both ordinary factories contribute 20% each');
  assert.equal(result.factoryIncome, 155, 'Only the factory supplied with coal contributes 35%');
  assert.ok(result.baseline.cityTax > 0 && Math.abs(result.cityTax / result.baseline.cityTax - 155 / 140) < 1e-12,
    'Coal increases both the factory quote and settlement tax income');
  assert.equal(result.afterFactoryLoss, 120, 'Losing a supplied factory removes its contribution');
  assert.equal(result.afterFactoryReturn, 155, 'A ready factory counts again');
  assert.equal(result.afterCoalLoss, 140, 'Losing coal supply restores the ordinary factory bonus');
}

async function checkMarbleConstruction(page) {
  const result = await page.evaluate(async () => {
    const { state } = window.__worldViewer;
    const [{ buildAt, buildCostAt, BUILD_COSTS }, { planConstruction }, { constructionPreviewContext },
      { activeMarbleQuarry, developResourceGroup, resourceDevelopmentStatus }, { markWorldChanged },
      { revealExplorationCells, setMapRevealed }, { ResourceActivityPopup }] = await Promise.all([
      import('/src/game/simulation.ts'), import('/src/game/construction.ts'), import('/src/game/construction-preview-cache.ts'),
      import('/src/game/resource-development.ts'), import('/src/game/world-revisions.ts'), import('/src/game/fog.ts'),
      import('/src/ui/resource-activity.ts'),
    ]);
    const width = 20, height = 20, faction = 0;
    const capital = state.buildings.find(b => b.kind === 'palace' && b.faction === faction);
    const resident = state.units.find(u => u.kind === 'leader' && u.faction === faction);
    const owner = state.factions.find(f => f.id === faction);
    const world = { width, height, seed: 'marble-startup', spawns: [{ x: 8, y: 8 }], revision: 0,
      tiles: Array.from({ length: width * height }, () => ({
        terrain: 'grassland', overlay: 'none', elevation: .45, moisture: .5, variation: .5, food: 2, production: 0, gold: 0,
      })) };
    const fixture = { ...state, world, fog: undefined, fields: [], resourceWorkSites: [], nextResourceWorkSiteId: 1,
      factions: [{ ...owner, gold: 1000 }], buildings: [{ ...capital, x: 8, y: 8 }],
      units: [{ ...resident, x: 9.5, y: 10.5 }], villages: [], hermits: [], explorationSites: [] };
    const addQuarry = (x, y) => {
      const anchor = y * width + x, cells = [anchor, anchor + 1, anchor + width, anchor + width + 1];
      for (const cell of cells) Object.assign(world.tiles[cell], {
        resource: 'marble', resourceGroup: anchor, oreAnchor: anchor, oreWidth: 2, oreHeight: 2, oreFamily: 0,
      });
      return cells;
    };
    const primary = addQuarry(5, 7), secondary = addQuarry(11, 8);
    revealExplorationCells(fixture, faction, [...primary, ...secondary]);
    const house = { x: 8, y: 12 };
    const price = () => buildCostAt(fixture, 'house', house.x, house.y).gold;
    const base = price();
    const initialPreview = constructionPreviewContext(fixture, 'road');
    const first = developResourceGroup(fixture, 5, 7, faction, 50);
    const partial = price();
    const secondBlocked = !resourceDevelopmentStatus(fixture, 11, 8, faction).ok;
    const finished = developResourceGroup(fixture, 5, 7, faction);
    const discounted = price();
    const refreshedPreview = initialPreview !== constructionPreviewContext(fixture, 'road');
    const before = fixture.factions[0].gold;
    const denied = !developResourceGroup(fixture, 11, 8, faction).ok && fixture.factions[0].gold === before;
    const quote = planConstruction(fixture, 'house', [house]);
    const ordered = buildAt(fixture, 'house', house.x, house.y);
    const paid = before - fixture.factions[0].gold;
    const receipt = fixture.buildings.find(b => b.kind === 'house')?.construction?.paidGold;
    const workSites = fixture.resourceWorkSites.filter(site => site.resource === 'marble' && site.faction === faction).length;

    // A capture can bring an already cut deposit inside the same borders.
    for (const cell of secondary) world.tiles[cell].resourceDeveloped = true;
    markWorldChanged(world, 'appearance', secondary);
    const afterCapture = price(), chosen = activeMarbleQuarry(fixture, faction)?.anchor;
    const capturedCapital = { ...capital, x: 8, y: 8, faction: 1 };
    const transferred = { ...fixture, factions: [{ ...owner, defeated: true }, { ...owner, id: 1 }],
      buildings: [capturedCapital], units: [] };
    await import('/src/ui/game-font.css');
    await import('/src/style.css');
    await import('/src/ui/resource-activity.css');
    setMapRevealed(fixture, true);
    const host = document.createElement('section');
    host.className = 'building-activity resource-activity';
    host.dataset.marblePreview = '';
    document.body.append(host);
    const popup = new ResourceActivityPopup(host, () => fixture,
      () => ({ x: innerWidth / 2, y: innerHeight / 2 }),
      () => ({ width: innerWidth, height: innerHeight }), () => {}, () => {});
    const visibleBonus = popup.open({ x: 5.5, y: 7.5 })
      && !host.querySelector('.resource-benefit').hidden
      && host.querySelector('.resource-benefit').textContent.includes('10%');
    return {
      base, partial, discounted, cutoff: BUILD_COSTS.house.gold * .9, refreshedPreview, denied, paid, receipt,
      first, finished, quote, ordered, secondBlocked, afterCapture, chosen, expectedQuarry: primary[0], workSites, visibleBonus,
      oldOwner: buildCostAt(transferred, 'house', house.x, house.y, faction).gold,
      newOwner: buildCostAt(transferred, 'house', house.x, house.y, 1).gold,
    };
  });
  assert.ok(result.first.ok, result.first.message);
  assert.equal(result.partial, result.base, 'Partially developed marble must not change the price');
  assert.ok(result.secondBlocked, 'A partially developed quarry must reserve the faction’s single quarry');
  assert.ok(result.finished.ok, result.finished.message);
  assert.equal(result.discounted, result.cutoff);
  assert.ok(result.refreshedPreview, 'Activate a new construction quote when the quarry is completed');
  assert.ok(result.denied, 'Reject a second quarry without charging the faction');
  assert.ok(result.quote.ok, result.quote.message);
  assert.equal(result.quote.cost, result.discounted);
  assert.ok(result.ordered.ok, result.ordered.message);
  assert.ok(Math.abs(result.paid - result.discounted) < 1e-9, 'Charge the exact quoted price');
  assert.equal(result.receipt, result.discounted);
  assert.equal(result.afterCapture, result.discounted);
  assert.equal(result.chosen, result.expectedQuarry);
  assert.equal(result.oldOwner, result.base);
  assert.equal(result.newOwner, result.discounted);
  assert.equal(result.workSites, 1, 'A developed quarry has one worker site');
  assert.ok(result.visibleBonus, 'The marble popup must show its construction discount');
  await page.locator('[data-marble-preview]').screenshot({ path: 'output/startup/marble-construction-discount.png' });
  await page.locator('[data-marble-preview]').evaluate(element => element.remove());
}

/** Exercise payroll and photograph the selection on a detached, frozen scenario. */
async function captureUpkeepPreview(page) {
  await page.setViewportSize({ width: 1040, height: 640 });
  await page.evaluate(async () => {
    const { createScenarioGame } = await import('/src/game/scenario-loader.ts');
    const { Renderer } = await import('/src/game/renderer.ts');
    const { setMapRevealed } = await import('/src/game/fog.ts');
    const { retinueUpkeep } = await import('/src/game/archery.ts');
    const { settleRetinuePayroll } = await import('/src/game/retinue-native.ts');
    const { unitDamage, unitDefense, hasUnpaidUpkeep } = await import('/src/game/veterancy.ts');
    const { selectionSummary } = await import('/src/ui/selection-summary.ts');
    const { icon } = await import('/src/ui/icons.ts');
    const { wholeNumber } = await import('/src/ui/number-format.ts');

    const state = await createScenarioGame('musketry-deathmatch');
    state.paused = true;
    const time = state.time, faction = state.factions.find(owner => owner.id === 0);
    const musket = state.units.find(unit => unit.faction === 0 && unit.kind === 'musketman' && unit.hp > 0 && !unit.inside);
    if (!faction || !musket) throw new Error('Upkeep preview requires a musketman');
    const warrior = { ...musket, kind: 'warrior' }, ranger = { ...musket, kind: 'archer', ranger: true };
    const bill = retinueUpkeep(musket) + retinueUpkeep(warrior);
    if (bill !== 5.5 || retinueUpkeep(ranger) !== 0) throw new Error('Unexpected basic or specialist upkeep');
    const fullDamage = unitDamage(musket, 100, faction), fullDefense = unitDefense(musket, faction);
    faction.gold = bill - .5;
    settleRetinuePayroll(state, faction, bill);
    if (faction.gold !== 0 || unitDamage(musket, 100, faction) !== fullDamage / 2
      || unitDefense(musket, faction) !== fullDefense / 2 || hasUnpaidUpkeep(warrior, faction) || hasUnpaidUpkeep(ranger, faction))
      throw new Error('Short payroll must halve specialist damage and defense and exempt warriors and Rangers');
    faction.gold = bill;
    settleRetinuePayroll(state, faction, bill);
    if (faction.gold !== 0 || hasUnpaidUpkeep(musket, faction) || unitDamage(musket, 100, faction) !== fullDamage)
      throw new Error('Exact payment must restore full strength');
    settleRetinuePayroll(state, faction, bill);

    setMapRevealed(state, true);
    state.selected = musket.id; state.selectedType = 'unit';
    const selection = selectionSummary(state);
    if (selection?.hint !== 'Unpaid upkeep') throw new Error('The selection must show unpaid upkeep');
    const host = document.createElement('div');
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '99999', background: '#20261c' });
    host.innerHTML = '<canvas style="width:100%;height:100%;display:block"></canvas><canvas hidden></canvas>';
    document.body.append(host);
    const [canvas, minimap] = host.querySelectorAll('canvas');
    const renderer = new Renderer(canvas, minimap);
    await renderer.initialize();
    renderer.follow = false; renderer.zoom = 4;
    renderer.camera = { x: musket.x + .9, y: musket.y };
    renderer.draw(state, 0);

    const panel = document.querySelector('#selection-panel').cloneNode(true);
    panel.classList.remove('empty');
    panel.title = selection.title;
    panel.querySelector('#selection-name').textContent = selection.name;
    panel.querySelector('#selection-hint').textContent = selection.hint;
    panel.querySelector('#selection-hint').hidden = false;
    panel.querySelector('#selection-stats').innerHTML = `<span><span class="stat-label">HP</span> ${wholeNumber(selection.hp)} / ${wholeNumber(selection.maxHp)}</span>
      <span><span class="stat-label">Attack</span> ${wholeNumber(selection.attack)}</span>
      <span><span class="stat-label">Defense</span> ${wholeNumber(selection.defense)}</span>`;
    panel.querySelector('#portrait').innerHTML = icon(selection.picture, selection.factionColor, selection.houseTier, selection.armorLevel);
    panel.querySelector('#selection-health').style.width = `${selection.hp / selection.maxHp * 100}%`;
    host.append(panel);
    await document.fonts.ready;
    if (!state.paused || state.time !== time) throw new Error('The upkeep preview must remain frozen');
  });
  await mkdir('output/startup', { recursive: true });
  await page.screenshot({ path: 'output/startup/retinue-unpaid-upkeep.png' });
}
