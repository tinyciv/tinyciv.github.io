import { createWorld, createCounters, snapshot, round } from './world.mjs';
import { createScenario, observeArmy, armyOutcome } from './ai.mjs';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runMatch } from './match.mjs';
import { retinueMotion } from './retinue-motion.mjs';

const IDLE = Object.freeze({ up: false, down: false, left: false, right: false });
const EPOCH = 1_800_000_000_000;

// One fixed-step loop for all modes. Simulation time, rather than wall time or
// a speed multiplier, drives the injected host clock and all sample deadlines.
export function runTrial(engine, trial, config, fixtures) {
  if(config.mode==='match')return runMatch(engine,trial,config);
  const setupStarted = performance.now();
  const context = config.mode === 'world' ? createWorld(engine, trial, config, fixtures)
    : createScenario(engine, trial.scenario, trial.seed, trial.seedIndex, fixtures);
  const { state } = context;
  state.paused = false;
  state.speed = 1;
  const motion = config.retinueMotion && config.mode === 'world' ? retinueMotion(engine, state, config.retinueCount) : null;
  // Fingerprint the complete host-visible fixture before policy configuration;
  // policy assignment does not consume RNG or alter combat stats/resources.
  const initialStateHash = createHash('sha256').update(JSON.stringify(state)).digest('hex');
  engine.registerFactionAIPolicies(state, config.policyDefinitions);
  const policyDefinition = engine.listFactionAIPolicies(state).find(policy => policy.id === trial.policy);
  if (!policyDefinition) throw new Error(`Unknown AI policy ${trial.policy}`);
  const appliedFactions = config.mode === 'ai' ? [1] : state.factions.filter(faction => faction.id > 0
    && faction.villageId === undefined && !engine.isHumanFaction(state, faction.id)).map(faction => faction.id);
  for (const faction of appliedFactions) engine.setFactionAIProfile(state, faction, trial.policy);
  const startTime = state.time;
  const observer = config.mode === 'world' ? createCounters(engine) : null;
  const metrics = { formationSeconds: 0, maximumLeaderDistance: 0, missions: {} };
  const army = config.mode === 'ai' || !!config.preparedScenario;
  if (army) context.initialEnemyPalaceHP = context.enemyPalace.hp;
  const setupSeconds = (performance.now() - setupStarted) / 1000;
  const checkpoints = [];
  let elapsed = 0, steps = 0, nextCheckpoint = 0, gameOver = null, stopReason = 'duration', motionReported = false;
  const started = performance.now();
  const capture = () => snapshot(engine, state, elapsed, observer.counters);
  while (elapsed < config.seconds - 1e-8) {
    const target = config.checkpoints[nextCheckpoint] ?? config.seconds;
    const dt = Math.min(config.dt, config.seconds - elapsed, target - elapsed);
    const before = state.time;
    motion?.before(elapsed);
    engine.updateGame(state, dt, IDLE, { wallNow: EPOCH + Math.round(elapsed * 1000) });
    const advanced = state.time - before;
    if (!Number.isFinite(advanced) || advanced < 0) throw new Error(`Invalid simulation clock in ${trial.id}`);
    elapsed = state.time - startTime;
    steps++;
    motion?.sample(elapsed, advanced);
    if (motion && !motionReported && elapsed >= 90) {
      const observations = motion.finish();
      const file = `${config.out}.${trial.id.replaceAll(':', '-')}.retinue-motion.json`;
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify({ ...trial, initialStateHash, simulatedSeconds: round(elapsed, 6),
        baseline: !!config.retinueRestBaseline, retinueMotion: observations }, null, 2)}\n`);
      console.error(`${trial.id}${config.retinueRestBaseline ? ' baseline' : ''}: retinue rest observations ${JSON.stringify(observations.windows)}`);
      motionReported = true;
    }
    if (observer) observer.sample(state);
    if (army) observeArmy(engine, context, advanced, metrics);
    if (state.gameOver) gameOver ??= { t: round(elapsed, 6), victory: !!state.victory, winner: state.multiplayer?.winner ?? null };
    // Captures require a human decision. Report the actual stop rather than
    // counting no-op updates as successfully simulated time.
    if (state.palaceCaptures?.length) stopReason = 'palace-capture';
    else if (state.gameOver && config.gameOver === 'stop') stopReason = 'game-over';
    else if (state.paused) stopReason = 'paused';
    else if (advanced <= 1e-10) throw new Error(`Simulation did not advance in ${trial.id} at ${elapsed}s`);
    if (elapsed >= target - 1e-8) {
      if (observer) checkpoints.push(capture());
      if (motion) console.error(`${trial.id}: ${round(elapsed, 2)}s simulated`);
      if (army && observer) {
        const observations = armyOutcome(context, metrics, engine);
        mkdirSync(path.dirname(config.out), { recursive: true });
        writeFileSync(`${config.out}.army-checkpoint.json`, `${JSON.stringify({ ...trial, initialStateHash,
          simulatedSeconds: round(elapsed, 6), ...observations }, null, 2)}\n`);
        console.error(`${trial.id}: ${round(elapsed, 2)}s simulated; Offensive ${state.offensives?.find(order => order.faction === 1)?.phase ?? 'none'}; artillery ${JSON.stringify(metrics.artillery ?? {})}`);
      }
      nextCheckpoint++;
    }
    if (stopReason !== 'duration') break;
    if (state.gameOver) state.gameOver = false;
  }
  if (observer && (!checkpoints.length || Math.abs(checkpoints.at(-1).t - elapsed) > 1e-6)) checkpoints.push(capture());
  const wallSeconds = (performance.now() - started) / 1000;
  const result = { ...trial, initialStateHash, policyDefinition, appliedFactions,
    ...(motion ? { retinueMotion: motion.finish() } : {}),
    simulatedSeconds: round(elapsed, 6), steps, setupSeconds: round(setupSeconds, 6),
    wallSeconds: round(wallSeconds, 6), speedup: round(elapsed / Math.max(wallSeconds, 1e-9), 2), gameOver, stopReason };
  return observer ? { ...result, create: context.create, options: context.options,
    perturbed: config.perturb, enemyStrength: config.enemyStrength ?? null, checkpoints,
    ...(config.preparedScenario ? { preparedScenario: config.preparedScenario, fixture: context.fixture,
      armyObservations: armyOutcome(context, metrics, engine) } : {}) }
    : { ...result, ...armyOutcome(context, metrics, engine) };
}
