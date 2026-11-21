import { createHash } from 'node:crypto';
import { createScenario } from './ai.mjs';

export const round = (value, digits = 3) => Number.isFinite(value) ? Number(value.toFixed(digits)) : value ?? null;
const increment = (record, key, amount = 1) => { record[key] = (record[key] ?? 0) + amount; };
const sortObject = record => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));

export const WORLD_SCENARIOS = {
  // Default single-player start: 4 civilizations, villages, default bandits.
  default: { seed: 'parity-default-1', create: 'game', options: {} },
  // Advanced start: populated cities, all buildings, retinues.
  advanced: { seed: 'parity-advanced-1', create: 'game', options: { advancedStart: 'complete' } },
  // Maximum bandit intensity: raids, camps and marauder combat.
  bandits: { seed: 'parity-bandits-1', create: 'game', options: { banditIntensity: 3 } },
  // Two-human duel (multiplayer authority path) with idle human input.
  duel: { seed: 'parity-duel-1', create: 'duel', names: ['North', 'South'], colors: ['#c0392b', '#2e86c1'] },
};
export function createWorld(engine, trial, config, fixtures) {
  if (config.preparedScenario) {
    const prepared = createScenario(engine, config.preparedScenario, trial.seed, trial.seedIndex, fixtures);
    return { ...prepared, create: 'prepared-scenario', options: { preparedScenario: config.preparedScenario } };
  }
  const scenario = WORLD_SCENARIOS[trial.scenario];
  const world = engine.generateWorld(trial.seed);
  const options = { ...scenario.options, ...(config.retinueMotion ? { advancedStart: 'midpoint', banditIntensity: 0 } : {}),
    ...(config.enemyStrength === undefined ? {} : { enemyStrength: config.enemyStrength }) };
  const state = scenario.create === 'duel'
    ? engine.createDuelGame(world, scenario.names, scenario.colors)
    : engine.createGame(world, undefined, options);
  if (config.perturb) engine.seedSimulationRandom(state, (state.rngState ^ config.perturb) >>> 0);
  return { state, create: scenario.create, options };
}

export function createCounters(engine) {
  const seenProjectiles = new WeakSet(), seenDeaths = new WeakSet();
  const counters = { projectilesFired: {}, deaths: {}, deathsByKind: {}, unitKills: new Map(), nav0: engine.navigationWasmStatus() };
  return {
    counters,
    sample(state) {
      for (const projectile of state.projectiles ?? []) if (!seenProjectiles.has(projectile)) {
        seenProjectiles.add(projectile); increment(counters.projectilesFired, projectile.faction);
      }
      for (const death of state.unitDeaths ?? []) if (!seenDeaths.has(death)) {
        seenDeaths.add(death); increment(counters.deaths, death.unit.faction); increment(counters.deathsByKind, death.unit.kind);
      }
      for (const unit of state.units) {
        const kills = unit.kills ?? 0;
        if (!kills) continue;
        const entry = counters.unitKills.get(unit.id);
        if (!entry) counters.unitKills.set(unit.id, [unit.faction, kills]);
        else if (kills > entry[1]) entry[1] = kills;
      }
    },
  };
}

export function snapshot(engine, state, t, counters) {
  const factions = [];
  const territoryCells = {};
  const borders = engine.territory(state);
  for (const owner of borders.owners) if (owner >= 0) increment(territoryCells, owner);
  const kills = {};
  for (const [faction, count] of counters.unitKills.values()) increment(kills, faction, count);
  const buildingsByFaction = new Map(), unitsByFaction = new Map();
  for (const building of state.buildings) {
    if (building.hp <= 0) continue;
    let entry = buildingsByFaction.get(building.faction);
    if (!entry) buildingsByFaction.set(building.faction, entry = { ready: {}, construction: {} });
    increment(engine.buildingReady(building) ? entry.ready : entry.construction, building.kind);
  }
  for (const unit of state.units) {
    if (unit.hp <= 0) continue;
    let entry = unitsByFaction.get(unit.faction);
    if (!entry) unitsByFaction.set(unit.faction, entry = {});
    increment(entry, unit.kind);
  }
  for (const faction of state.factions) {
    const levels = faction.research?.levels ?? {};
    const buildings = buildingsByFaction.get(faction.id) ?? { ready: {}, construction: {} };
    factions.push({
      id: faction.id, name: faction.name, village: faction.villageId !== undefined, defeated: !!faction.defeated,
      relation: faction.relation, population: round(faction.population, 2), food: round(faction.food, 2),
      gold: round(faction.gold, 2), culture: round(faction.culture ?? 0, 2),
      income: { food: round(faction.incomeTotals?.food ?? 0, 2), gold: round(faction.incomeTotals?.gold ?? 0, 2),
        culture: round(faction.incomeTotals?.culture ?? 0, 2) },
      research: { levelSum: Object.values(levels).reduce((sum, level) => sum + (level ?? 0), 0),
        progressSum: round(Object.values(faction.research?.progress ?? {}).reduce((sum, value) => sum + (value ?? 0), 0), 3),
        levels: sortObject(levels), focus: faction.research?.focus ?? null },
      buildings: { ready: sortObject(buildings.ready), construction: sortObject(buildings.construction) },
      units: sortObject(unitsByFaction.get(faction.id) ?? {}),
      territoryCells: territoryCells[faction.id] ?? 0,
      kills: kills[faction.id] ?? 0, deaths: counters.deaths[faction.id] ?? 0,
      projectilesFired: counters.projectilesFired[faction.id] ?? 0,
      raids: raidSummary(engine, state, faction.id),
    });
  }
  const otherUnits = {};
  for (const [faction, units] of unitsByFaction) if (!state.factions.some(entry => entry.id === faction)) otherUnits[faction] = sortObject(units);
  const otherBuildings = {};
  for (const [faction, entry] of buildingsByFaction) if (!state.factions.some(f => f.id === faction))
    otherBuildings[faction] = sortObject({ ...entry.ready, ...Object.fromEntries(Object.entries(entry.construction).map(([k, v]) => [`${k}*`, v])) });
  const villages = (state.villages ?? []).map(village => {
    const row = engine.settlementRow(state, village.campId);
    const top = row && row.topForeign >= 0 ? row.topForeign : undefined;
    const affiliation = top === undefined ? null : engine.affiliationBreakdown(state, village.campId, top).value;
    return { id: village.id, campId: village.campId, faction: village.faction, destroyed: !!village.destroyed,
      confederatedInto: village.confederatedInto ?? null, stage: row?.stage ?? null, owner: row?.owner ?? null,
      topForeign: top ?? null, topAffiliation: Number.isFinite(affiliation) ? round(affiliation, 2) : null,
      family: row?.family ?? null };
  });
  const nav = engine.navigationWasmStatus();
  const workerActors = engine.entityStore(state).units.query('unit').filter(unit => unit.kind === 'worker' && unit.hp > 0).length;
  const workerJobs = state.units.filter(unit => unit.kind === 'worker' && unit.hp > 0).length;
  const other = {
    projectilesFired: sortObject(Object.fromEntries(Object.entries(counters.projectilesFired).filter(([f]) => Number(f) < 0))),
    deaths: sortObject(Object.fromEntries(Object.entries(counters.deaths).filter(([f]) => Number(f) < 0))),
    kills: sortObject(Object.fromEntries(Object.entries(kills).filter(([f]) => Number(f) < 0))),
    units: sortObject(otherUnits), buildings: sortObject(otherBuildings),
  };
  const totals = {
    population: round(sum(factions, f => f.population), 2), food: round(sum(factions, f => f.food), 2),
    gold: round(sum(factions, f => f.gold), 2), incomeFood: round(sum(factions, f => f.income.food), 2),
    incomeGold: round(sum(factions, f => f.income.gold), 2), culture: round(sum(factions, f => f.culture), 2),
    researchLevels: sum(factions, f => f.research.levelSum),
    buildingsReady: state.buildings.filter(b => b.hp > 0 && engine.buildingReady(b)).length,
    buildingsConstruction: state.buildings.filter(b => b.hp > 0 && !engine.buildingReady(b)).length,
    units: state.units.filter(u => u.hp > 0).length,
    workerActors, dormantWorkers: workerJobs - workerActors,
    soldiers: state.units.filter(u => u.hp > 0 && u.faction >= 0 && SOLDIERS.has(u.kind)).length,
    hostileUnits: state.units.filter(u => u.hp > 0 && u.faction === -2).length,
    territoryCells: sum(Object.values(territoryCells), v => v),
    deaths: sum(Object.values(counters.deaths), v => v),
    kills: sum(Object.values(kills), v => v),
    projectilesFired: sum(Object.values(counters.projectilesFired), v => v),
    villageStageSum: sum(villages, v => v.stage ?? 0),
    villageStages: [0, 1, 2, 3, 4].map(stage => villages.filter(v => !v.destroyed && v.stage === stage).length),
    villagesActive: villages.filter(v => !v.destroyed && v.confederatedInto === null).length,
    defeatedFactions: factions.filter(f => f.defeated).length,
    raiderCamps: (state.raiderCamps ?? []).length, marauderPacks: (state.marauderPacks ?? []).length,
    pathSearches: nav.searches - counters.nav0.searches,
    travelMaps: nav.travelMaps - counters.nav0.travelMaps,
    nearestMaps: nav.nearestMaps - counters.nav0.nearestMaps,
  };
  return { t: round(t, 6), tick: state.tick, totals, deathsByKind: sortObject(counters.deathsByKind),
    factions, other, villages, hash: stateHash(state) };
}
const SOLDIERS = new Set(['leader', 'warrior', 'swordsman', 'spearman', 'pikeman', 'musketman', 'horseman', 'horseArcher', 'knight', 'slinger', 'archer', 'militia', 'scout']);
const sum = (items, value) => items.reduce((total, item) => total + value(item), 0);
// Raid director cycle per realm: phase, stress, era, raid outcomes and time in each phase.
function raidSummary(engine, state, faction) {
  const view = engine.raidDirectorView?.(state, faction);
  if (!view) return null;
  return { phase: view.phase, stress: round(view.stress, 2), peakStress: round(view.peakStress, 2), era: round(view.era, 2),
    raids: view.raids, raidersSent: view.raidersSent, raidersLost: view.raidersLost, totalStress: round(view.totalStress, 2),
    fear: view.fear, streak: view.streak, sizeRelief: view.sizeRelief, lastMotive: view.lastMotive ?? null,
    phaseSeconds: Object.fromEntries(Object.entries(view.phaseSeconds).map(([phase, seconds]) => [phase, round(seconds, 1)])) };
}

// Coarse hash: entity identity, kind, owner, rounded position/HP and faction
// stocks. Exact equality is expected only for identical engines.
function stateHash(state) {
  const hash = createHash('sha256');
  hash.update(`t${round(state.time, 2)}|r${state.rngState}|`);
  const units = [...state.units].sort((a, b) => a.id - b.id);
  for (const u of units) hash.update(`u${u.id},${u.kind},${u.faction},${round(u.x, 1)},${round(u.y, 1)},${Math.round(u.hp)};`);
  const buildings = [...state.buildings].sort((a, b) => a.id - b.id);
  for (const b of buildings) hash.update(`b${b.id},${b.kind},${b.faction},${b.x},${b.y},${Math.round(b.hp)},${b.construction ? round(b.construction.progress ?? 0, 1) : 'r'};`);
  for (const f of state.factions) hash.update(`f${f.id},${round(f.food, 0)},${round(f.gold, 0)},${round(f.population, 1)},${f.defeated ? 1 : 0};`);
  return hash.digest('hex').slice(0, 16);
}

