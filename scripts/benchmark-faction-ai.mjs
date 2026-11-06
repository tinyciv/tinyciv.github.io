import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Runs the authoritative simulation without a browser, rendering or wall-clock
// timers. Every policy receives the same seed, positions, research and resources.
const root = process.cwd(), scratch = path.join(root, 'scratch/faction-ai-harness');
const argument = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const seconds = Number(argument('seconds', '90')), seeds = Number(argument('seeds', '3'));
const scenarioNames = argument('scenarios', 'open-battle,fortified-assault,outnumbered-defense').split(',');
if (!(seconds > 0 && seeds >= 1)) throw new Error('Use positive --seconds and --seeds values.');
await mkdir(scratch, { recursive: true });
const bundle = path.join(scratch, 'simulation.mjs');
await build({ stdin: { contents: `
export { createGame, updateGame } from './src/game/simulation.ts';
export { entityStore } from './src/game/entity-store.ts';
export { setFactionAIProfile, FACTION_AI_PROFILES } from './src/game/faction-ai-profile.ts';
export { getFactionStrategy } from './src/game/faction-strategy.ts';
export { ensureMarauderLeaders } from './src/game/marauder-leaders.ts';
`, resolveDir: root }, bundle: true, platform: 'node', format: 'esm', outfile: bundle });
const engine = await import(pathToFileURL(bundle).href);
const idle = { up: false, down: false, left: false, right: false }, rows = [];

function createScenario(name, seed, profile) {
  const width = 64, height = 44;
  const world = { width, height, seed: `ai-tournament-${seed}`, source: 'headless faction AI benchmark', revision: 0,
    spawns: [{ x: 10, y: 21 }, { x: 49, y: 21 }],
    tiles: Array.from({ length: width * height }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
      moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) };
  const state = engine.createGame(world, undefined, { banditIntensity: 0 });
  const store = engine.entityStore(state);
  store.units.replace([]);
  store.buildings.retain(building => building.faction >= 0 && building.villageId === undefined
    && (name === 'outnumbered-defense' || building.kind === 'palace'));
  state.factions = state.factions.filter(faction => faction.villageId === undefined);
  state.villages = []; state.raiderCamps = []; state.marauderPacks = []; state.treasureChests = [];
  state.fogRaids = { nextAt: 1e9, waves: 0, pressureVersion: 1 };
  state.roamingMaraudersVersion = 1;
  for (const faction of state.factions) {
    faction.gold = 500; faction.food = 1000; faction.population = 20; faction.nextRetinueAt = 1e9;
    faction.nextRaid = faction.id === 1 && name !== 'outnumbered-defense' ? 0 : 1e9;
    faction.relation = faction.id === 0 ? 'self' : 'war';
    faction.constructionPauseUntil = { palisade: 1e9, wall: 1e9, woodenTower: 1e9, library: 1e9, guardPost: 1e9 };
    faction.research = { focus: 'infantryDrill', levels: { infantryDrill: 1, militaryTactics: 1, archeryRange: 1 }, progress: {}, allocation: 0 };
  }
  for (const palace of state.buildings.filter(building => building.kind === 'palace')) {
    palace.governorPermissions = { farms: false, housing: false };
    palace.unhousedResidents = 20; palace.capacity = 20; palace.hp = palace.maxHp = 10000;
  }
  engine.setFactionAIProfile(state, 1, profile);
  const jitter = (seed - 1) * .35, home = state.buildings.find(building => building.faction === 1 && building.kind === 'palace');
  let nextId = Math.max(0, ...state.buildings.map(building => building.id)) + 1000;
  const addUnit = (kind, faction, x, y, options = {}) => {
    const leader = kind === 'leader', ranged = kind === 'archer';
    const unit = { id: nextId++, kind, faction, x, y, hp: leader ? 150 : 100, maxHp: leader ? 150 : 100,
      attack: leader ? 25 : ranged ? 14 : 17, defense: leader ? 6 : 4, morale: 100,
      speed: leader ? 3.6 : 3.96, range: leader || ranged ? 4 : 1.1, order: faction === 0 ? 'hold' : 'follow',
      cooldown: 0, lastCombat: -60, moving: false, facing: Math.PI, attackTime: 0, ...options };
    store.units.add(unit); return unit;
  };
  addUnit('leader', 0, 12.5, 24.5, { speed: 0 });
  const leader = addUnit('leader', 1, 45.5, 22.5 + jitter, { home: home.id });
  const army = Array.from({ length: 12 }, (_, index) => addUnit(index >= 9 ? 'archer' : 'warrior', 1,
    43.5 + index % 3, 20.5 + Math.floor(index / 3) + jitter));
  if (name === 'outnumbered-defense') {
    const packId = 1, home = { x: 37.5, y: 22.5 };
    state.marauderPacks = [{ id: packId, name: 'Siege band', color: '#222', targetFaction: 1,
      home, waypoint: home, nextWanderAt: 1e9 }];
    for (let index = 0; index < 30; index++) addUnit(index % 5 === 0 ? 'archer' : 'warrior', -2,
      35.5 + index % 5, 19.5 + Math.floor(index / 5), { marauderPack: packId, order: 'wander', hp: 100, maxHp: 100, speed: 2.6 });
    engine.ensureMarauderLeaders(state);
  } else {
    const enemyCount = name === 'fortified-assault' ? 16 : 12;
    for (let index = 0; index < enemyCount; index++) addUnit(index % 4 === 0 ? 'archer' : 'warrior', 0,
      (name === 'fortified-assault' ? 17.5 : 29.5) + index % 3, 19.5 + Math.floor(index / 3) - jitter);
    if (name === 'fortified-assault') for (const point of [{ x: 17, y: 18 }, { x: 17, y: 26 }, { x: 13, y: 17 }, { x: 13, y: 27 }])
      store.buildings.add({ id: nextId++, kind: 'woodenTower', faction: 0, ...point, hp: 250, maxHp: 250, armor: 6, capacity: 0 });
  }
  state.world.revision++;
  return { state, leader, army, enemyIds: state.units.filter(unit => unit.faction !== 1).map(unit => unit.id),
    enemyPalace: state.buildings.find(building => building.faction === 0 && building.kind === 'palace') };
}

for (const scenario of scenarioNames) {
  if (!['open-battle', 'fortified-assault', 'outnumbered-defense'].includes(scenario)) throw new Error(`Unknown scenario: ${scenario}`);
  for (let seed = 1; seed <= seeds; seed++) for (const profile of engine.FACTION_AI_PROFILES) {
    const { state, leader, army, enemyIds, enemyPalace } = createScenario(scenario, seed, profile);
    const started = performance.now(), missions = {}, initialEnemyPalaceHP = enemyPalace.hp;
    let formationSeconds = 0, maximumLeaderDistance = 0;
    for (let frame = 0; frame < seconds * 5 && !state.gameOver; frame++) {
      engine.updateGame(state, .2, idle);
      formationSeconds += leader.infantryFormation?.active ? .2 : 0;
      maximumLeaderDistance = Math.max(maximumLeaderDistance, Math.hypot(leader.x - 45.5, leader.y - 22.5));
      const mode = engine.getFactionStrategy(state, 1)?.mode ?? 'none'; missions[mode] = (missions[mode] ?? 0) + .2;
      // A pending player capture represents a decisive loss in this scenario.
      if (state.palaceCaptures?.length) break;
    }
    const leaderAlive = state.units.includes(leader) && leader.hp > 0;
    const survivors = army.filter(unit => state.units.includes(unit) && unit.hp > 0);
    const kills = enemyIds.filter(id => !state.units.some(unit => unit.id === id && unit.hp > 0)).length;
    const survivingHP = survivors.reduce((sum, unit) => sum + unit.hp, 0);
    const palaceDamage = Math.max(0, initialEnemyPalaceHP - enemyPalace.hp);
    // Survival is the primary objective; actual damage and kills break ties.
    // All terms and raw outcomes are saved so the weighting is reviewable.
    const score = Number(leaderAlive) * 100 + survivingHP / 20 + kills * 10 + palaceDamage / 100;
    const row = { scenario, seed, profile, simulatedSeconds: Number(state.time.toFixed(2)), leaderAlive,
      leaderHP: Math.max(0, leader.hp), survivors: survivors.length, survivingHP, kills, palaceDamage,
      formationSeconds: Number(formationSeconds.toFixed(2)), maximumLeaderDistance,
      score: Number(score.toFixed(2)), missions, elapsedMs: Math.round(performance.now() - started) };
    rows.push(row); console.log(JSON.stringify(row));
  }
}
const summary = engine.FACTION_AI_PROFILES.map(profile => {
  const runs = rows.filter(row => row.profile === profile);
  const average = key => Number((runs.reduce((sum, row) => sum + Number(row[key]), 0) / runs.length).toFixed(2));
  return { profile, runs: runs.length, survivalRate: average('leaderAlive'), meanScore: average('score'),
    meanKills: average('kills'), meanSurvivors: average('survivors'), meanFormationSeconds: average('formationSeconds') };
}).sort((a, b) => b.meanScore - a.meanScore);
const report = { configuration: { seconds, seeds, scenarios: scenarioNames, step: .2,
  score: '100 for Leader survival + surviving retinue HP / 20 + enemy kills * 10 + enemy palace damage / 100' }, summary, rows };
await mkdir(path.join(root, 'benchmarks'), { recursive: true });
await writeFile(path.join(root, 'benchmarks/faction-ai.json'), JSON.stringify(report, null, 2) + '\n');
console.log('\nSUMMARY\n' + JSON.stringify(summary, null, 2));
