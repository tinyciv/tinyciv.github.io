import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export const AI_SCENARIOS = ['open-battle', 'fortified-assault', 'outnumbered-defense', 'musketry-deathmatch'];
export const SCORE = '100 for Leader survival + surviving retinue HP / 20 + enemy kills * 10 + enemy palace damage / 100';

export function createScenario(engine, name, seed, seedIndex, fixtures = {}) {
  if (name === 'musketry-deathmatch') return createMusketryScenario(engine, seed, fixtures[name]);
  const width = 64, height = 44;
  const world = { width, height, seed, source: 'headless faction AI benchmark', revision: 0,
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
  const jitter = ((seedIndex - 1) % 3) * .35, home = state.buildings.find(building => building.faction === 1 && building.kind === 'palace');
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
  return { state, leader, leaderStart: { x: leader.x, y: leader.y }, army, enemyIds: state.units.filter(unit => unit.faction !== 1).map(unit => unit.id),
    enemyPalace: state.buildings.find(building => building.faction === 0 && building.kind === 'palace') };
}

/** Load the shipped scenario through the production save boundary. The city,
 * terrain, troops, technology and economy remain the baked game state. Only
 * its native random stream varies by trial seed; human input remains idle. */
function createMusketryScenario(engine, seed, frozenArtifact) {
  const artifact = frozenArtifact ?? new URL('../../public/scenarios/musketry-deathmatch.json.gz', import.meta.url);
  const bytes = readFileSync(artifact);
  const state = engine.migrateGame(engine.parseGameSave(gunzipSync(bytes).toString('utf8')));
  let rng = 2166136261;
  for (let index = 0; index < seed.length; index++) rng = Math.imul(rng ^ seed.charCodeAt(index), 16777619);
  engine.seedSimulationRandom(state, rng >>> 0);
  const leader = state.units.find(unit => unit.faction === 1 && unit.kind === 'leader' && unit.hp > 0);
  if (!leader) throw new Error('Musketry Deathmatch requires the AI Leader');
  const enemyPalace = state.buildings.filter(building => building.faction === 0 && building.kind === 'palace' && engine.buildingReady(building))
    .sort((a, b) => Math.hypot(a.x - leader.x, a.y - leader.y) - Math.hypot(b.x - leader.x, b.y - leader.y) || a.id - b.id)[0];
  if (!enemyPalace) throw new Error('Musketry Deathmatch requires a human city');
  return { state, leader, leaderStart: { x: leader.x, y: leader.y },
    army: state.units.filter(unit => unit.faction === 1 && unit.hp > 0 && engine.isRetinueMember(unit)),
    enemyIds: state.units.filter(unit => unit.faction !== 1 && unit.hp > 0 && unit.attack > 0).map(unit => unit.id),
    enemyPalace, initialBuildings: new Map(state.buildings.map(building => [building.id, buildingSnapshot(building)])),
    fixture: { source: 'public/scenarios/musketry-deathmatch.json.gz', artifactSha256: createHash('sha256').update(bytes).digest('hex'),
      frozen: !!frozenArtifact, sourceSeed: state.world.seed, seededRng: rng >>> 0, cities: state.buildings.filter(building => building.kind === 'palace' && engine.buildingReady(building)).length } };
}

export function observeArmy(engine, context, dt, metrics) {
  const { leader, leaderStart } = context;
  metrics.formationSeconds += leader.infantryFormation?.active ? dt : 0;
  metrics.maximumLeaderDistance = Math.max(metrics.maximumLeaderDistance, Math.hypot(leader.x - leaderStart.x, leader.y - leaderStart.y));
  const mission = engine.getFactionStrategy(context.state, 1), mode = mission?.mode ?? 'none';
  metrics.missions[mode] = (metrics.missions[mode] ?? 0) + dt;
  const offensive = metrics.offensive ??= { launches: 0, retargets: 0, attackStarts: 0, rallyReturns: 0, captures: 0,
    secondsByPhase: { none: 0, rally: 0, attack: 0, captured: 0 }, formationConflictSeconds: 0,
    objectiveChanges: [], targetChanges: [], transitions: [] };
  const order = context.state.offensives?.find(order => order.faction === 1), phase = order?.phase ?? 'none';
  offensive.secondsByPhase[phase] += dt;
  if (order && phase !== 'captured' && leader.infantryFormation?.active) offensive.formationConflictSeconds += dt;
  const previous = context.offensiveObservation;
  const target = order ? engine.offensiveAiTarget?.(context.state, 1) ?? mission?.targetId ?? context.state.buildings.find(building => building.hp > 0 && building.faction !== 1
    && order.objective.x >= building.x && order.objective.x < building.x + engine.buildingWidth(building)
    && order.objective.y >= building.y && order.objective.y < building.y + engine.buildingHeight(building))?.id : undefined;
  const objective = order && { x: order.objective.x, y: order.objective.y };
  const changed = !!objective && !!previous?.objective && (objective.x !== previous.objective.x || objective.y !== previous.objective.y);
  const flagsChanged = changed || !!order && !!previous?.rally && (order.rally.x !== previous.rally.x || order.rally.y !== previous.rally.y);
  const now = Number(context.state.time.toFixed(6));
  if (order && phase !== 'captured' && (!previous || previous.phase === 'none' || previous.phase === 'captured' || flagsChanged)) offensive.launches++;
  if (objective && (!previous?.objective || changed)) {
    offensive.objectiveChanges.push({ t: now, from: previous?.objective ?? null, to: objective, target: target ?? null });
    if (changed) offensive.retargets++;
  }
  if (target !== previous?.target) offensive.targetChanges.push({ t: now, from: previous?.target ?? null, to: target ?? null });
  if (phase !== (previous?.phase ?? 'none')) {
    offensive.transitions.push({ t: now, from: previous?.phase ?? 'none', to: phase });
    if (phase === 'attack') offensive.attackStarts++;
    if (phase === 'rally' && previous?.phase === 'attack') offensive.rallyReturns++;
    if (phase === 'captured') offensive.captures++;
  }
  context.offensiveObservation = { phase, objective, target, rally: order && { ...order.rally } };
  const guns = metrics.artillery ??= {};
  const observed = context.artilleryObservation ??= new Map();
  for (const unit of context.state.units) if (unit.faction === 1 && unit.kind === 'fieldCannon') {
    const previous = observed.get(unit.id), dx = previous ? unit.x - previous.x : 0, dy = previous ? unit.y - previous.y : 0;
    const moved = Math.hypot(dx, dy), directive = engine.offensiveDirective(context.state, unit);
    const requested = directive ? `${phase}:${directive.mode}:${directive.goal.x},${directive.goal.y}` : `${unit.destination?.x},${unit.destination?.y}`;
    const gun = guns[unit.id] ??= { id: unit.id, start: { x: unit.x, y: unit.y }, traveled: 0, movingSeconds: 0,
      reversalsSameGoal: 0, firstRallyArrival: null, closestRally: null, shots: 0 };
    gun.traveled += moved; if (moved > .005) gun.movingSeconds += dt;
    if (previous && requested === previous.requested && moved > .005 && Math.hypot(previous.dx, previous.dy) > .005
      && (dx * previous.dx + dy * previous.dy) / (moved * Math.hypot(previous.dx, previous.dy)) < -.5) gun.reversalsSameGoal++;
    if (unit.fieldCannon?.shotAt !== undefined && unit.fieldCannon.shotAt !== previous?.shotAt) gun.shots++;
    let rallyPost = previous?.rallyPost;
    if (order) {
      const gap = Math.hypot(unit.x - order.rally.x, unit.y - order.rally.y);
      gun.closestRally = Math.min(gun.closestRally ?? Infinity, gap);
      if (phase === 'rally') rallyPost = engine.fieldCannonPathStatus(context.state, unit).goal;
      // The global attack can begin inside the normal ready tolerance. The
      // gun still finishes its retained segment to the exact rally post.
      if (rallyPost && Math.hypot(unit.x - rallyPost.x, unit.y - rallyPost.y) <= .45 && gun.firstRallyArrival === null) gun.firstRallyArrival = now;
    }
    gun.rallyPost = rallyPost;
    gun.end = { x: unit.x, y: unit.y }; gun.netDistance = Math.hypot(unit.x - gun.start.x, unit.y - gun.start.y);
    observed.set(unit.id, { x: unit.x, y: unit.y, dx, dy, requested, shotAt: unit.fieldCannon?.shotAt, rallyPost });
  }
}

export function armyOutcome(context, metrics, engine) {
  const { state, leader, army, enemyIds, enemyPalace, initialEnemyPalaceHP } = context;
  const living = new Map(state.units.filter(unit => unit.hp > 0).map(unit => [unit.id, unit]));
  const leaderAlive = living.get(leader.id) === leader;
  const survivors = army.filter(unit => living.get(unit.id) === unit);
  const kills = enemyIds.filter(id => !living.has(id)).length;
  const survivingHP = survivors.reduce((sum, unit) => sum + unit.hp, 0);
  const palaceDamage = Math.max(0, initialEnemyPalaceHP - enemyPalace.hp);
  return { leaderAlive, leaderHP: Math.max(0, leader.hp), survivors: survivors.length, survivingHP, kills, palaceDamage,
    ...(context.fixture ? { fixture: context.fixture } : {}),
    ...(context.initialBuildings ? { diagnostics: musketryDiagnostics(engine, context) } : {}),
    ...metrics, score: Number((Number(leaderAlive) * 100 + survivingHP / 20 + kills * 10 + palaceDamage / 100).toFixed(2)) };
}

function buildingSnapshot(building) {
  return { id: building.id, kind: building.kind, faction: building.faction, x: building.x, y: building.y,
    hp: building.hp, maxHp: building.maxHp, construction: building.construction ?? null };
}

/** End-state observations only; no diagnostic changes a production command. */
function musketryDiagnostics(engine, context) {
  const { state, initialBuildings, leader } = context;
  const buildings = new Map(state.buildings.map(building => [building.id, building]));
  const entities = new Map([...state.units, ...state.buildings].map(entity => [entity.id, entity]));
  const order = state.offensives?.find(order => order.faction === 1);
  const unitSnapshot = unit => ({ id: unit.id, kind: unit.kind, faction: unit.faction,
    x: unit.x, y: unit.y, hp: unit.hp, maxHp: unit.maxHp, morale: unit.morale,
    order: unit.order, target: unit.target ?? null, moving: !!unit.moving,
    destination: unit.destination ?? null, pathGoal: unit.pathGoal ?? null, pathLength: unit.path?.length ?? 0,
    pathStart: unit.path?.slice(0, 4) ?? [], stuckFor: unit.stuckFor ?? 0, inside: !!unit.inside,
    training: unit.training ?? null, routed: !!unit.routed, joiningRetinue: !!unit.joiningRetinue,
    fieldCannon: unit.fieldCannon ?? null,
    nativePath: unit.kind === 'fieldCannon' ? engine.fieldCannonPathStatus(state, unit) : null,
    offensive: engine.offensiveDirective(state, unit) ?? null,
    offensiveTargetState: !entities.has(engine.offensiveDirective(state, unit)?.target) ? null
      : buildingSnapshot(entities.get(engine.offensiveDirective(state, unit).target)),
    targetState: unit.target === undefined || !entities.has(unit.target) ? null : buildingSnapshot(entities.get(unit.target)) });
  const target = engine.offensiveAiTarget(state, 1);
  const targetBuilding = target === undefined ? undefined : buildings.get(target);
  const changedBuildings = [...initialBuildings.values()].flatMap(initial => {
    const current = buildings.get(initial.id), damage = initial.hp - (current?.hp ?? 0);
    return damage > .01 || current?.faction !== initial.faction ? [{ initial, current: current ? buildingSnapshot(current) : null, damage }] : [];
  });
  const neighborhood = !order ? [] : state.buildings.filter(building => {
    const x = Math.max(building.x, Math.min(order.objective.x, building.x + engine.buildingWidth(building)));
    const y = Math.max(building.y, Math.min(order.objective.y, building.y + engine.buildingHeight(building)));
    return Math.hypot(order.objective.x - x, order.objective.y - y) <= 8;
  }).map(buildingSnapshot);
  return { time: state.time, offensive: order ?? null, aiTarget: target ?? null,
    leader: unitSnapshot(leader), retinue: state.units.filter(unit => unit.faction === 1 && engine.isRetinueMember(unit)).map(unitSnapshot),
    objectiveBuilding: targetBuilding ? buildingSnapshot(targetBuilding) : null, changedBuildings, objectiveNeighborhood: neighborhood };
}

export function summarizeArmies(rows, policies) {
  return policies.map(policy => {
    const runs = rows.filter(row => row.policy === policy);
    const average = key => Number((runs.reduce((sum, row) => sum + Number(row[key]), 0) / runs.length).toFixed(2));
    return { policy, runs: runs.length, survivalRate: average('leaderAlive'), meanScore: average('score'),
      meanKills: average('kills'), meanSurvivors: average('survivors'), meanFormationSeconds: average('formationSeconds'),
      meanOffensiveLaunches: Number((runs.reduce((sum, row) => sum + (row.offensive?.launches ?? 0), 0) / runs.length).toFixed(2)),
      meanOffensiveAttackSeconds: Number((runs.reduce((sum, row) => sum + (row.offensive?.secondsByPhase.attack ?? 0), 0) / runs.length).toFixed(2)) };
  }).sort((a, b) => b.meanScore - a.meanScore);
}
