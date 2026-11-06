import { CompanyLab } from './engine';
import type { BattleSize, Point, ScenarioId, Soldier } from './types';

export type BenchmarkMode = 'movement' | 'battle';
export interface BenchmarkOptions { scenario: ScenarioId; size: BattleSize; mode: BenchmarkMode; seconds?: number; dt?: number }
export const BENCHMARK_LIMITS = Object.freeze({ arrivalFraction: .95, stalledFraction: .05, companyRadius: 3,
  overlapDepth: .05, soldierDiameter: .6, idleDriftPerSecond: .03, p95StepMs: 1000 / 60 });
const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const rounded = (n: number): number => Math.round(n * 10000) / 10000;
const percentile = (values: number[], fraction: number): number => values.length
  ? values.sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)] : 0;
const arrived = (soldier: Soldier): boolean => !soldier.moving && gap(soldier, soldier.slot) < .15;
const position = (soldier: Soldier) => ({ id: soldier.id, company: soldier.company, team: soldier.team,
  x: rounded(soldier.x), y: rounded(soldier.y), slot: soldier.slot, moving: soldier.moving });

/** Instrumentation is outside the measured engine step. Geometry is sampled at
 * 10Hz; CPU samples include the engine's own metrics publication and combat. */
export function runBenchmark(options: BenchmarkOptions) {
  const seconds = options.seconds ?? 120, dt = options.dt ?? 1 / 30;
  const lab = new CompanyLab({ scenario: options.scenario, size: options.size, combat: options.mode === 'battle' });
  const spawned = lab.soldiers.length;
  let commandMs = 0;
  if (options.mode === 'movement') {
    // Leave company/soldier IDs stable, but remove the opposing deployment so
    // its stationary formation cannot masquerade as a navigation failure.
    for (const soldier of lab.soldiers) if (soldier.team === 1) soldier.hp = 0;
    const started = performance.now(); lab.command(0, lab.world.bases[1], 'move'); commandMs = performance.now() - started;
  }
  const initialAlive = lab.soldiers.filter(soldier => soldier.hp > 0).length;
  const unassigned = options.mode === 'movement'
    ? lab.soldiers.filter(soldier => soldier.hp > 0 && soldier.slot.x < lab.world.width / 2).map(position) : [];
  const samples: number[] = [], cohesion: number[] = [];
  const invalid = new Map<number, unknown>(), overlaps = new Map<string, unknown>();
  const worstCompanies = new Map<number, { company: number; team: number; time: number; radius: number; center: Point; members: unknown[] }>();
  let maxCohesion = 0, maxOverlap = 0, overlapSamples = 0, invalidSamples = 0;
  let settled = new Map<number, { traveled: number; x: number; y: number }>();
  let settledAt = 0, lastArrivals = 0, peakStalls = 0, firstFullArrivalAt: number | null = null;
  const checkpoints: unknown[] = [];
  const steps = Math.ceil(seconds / dt), sampleEvery = Math.max(1, Math.round(.1 / dt));
  const idleStart = Math.max(0, steps - Math.round(Math.min(10, seconds) / dt));
  const wallStart = performance.now();
  for (let step = 0; step < steps; step++) {
    const started = performance.now(); lab.step(dt); samples.push(performance.now() - started);
    if (step === idleStart) {
      settledAt = lab.time;
      settled = new Map(lab.soldiers.filter(soldier => soldier.hp > 0 && arrived(soldier)
        && !lab.companies[soldier.company - 1].engagementGoal).map(soldier => [soldier.id,
          { traveled: soldier.traveled, x: soldier.x, y: soldier.y }]));
    }
    if (step % sampleEvery !== 0 && step !== steps - 1) continue;
    const alive = lab.soldiers.filter(soldier => soldier.hp > 0), groups = new Map<number, Soldier[]>();
    for (const soldier of alive) {
      const group = groups.get(soldier.company) ?? []; group.push(soldier); groups.set(soldier.company, group);
      if (!lab.nav.passable(soldier.x, soldier.y) || soldier.moving
        && !lab.nav.canStep(soldier.fromX, soldier.fromY, soldier.toX, soldier.toY)) {
        invalidSamples++; if (invalid.size < 20) invalid.set(soldier.id, { time: rounded(lab.time), ...position(soldier),
          from: { x: soldier.fromX, y: soldier.fromY }, to: { x: soldier.toX, y: soldier.toY } });
      }
    }
    for (const [id, members] of groups) {
      const center = { x: members.reduce((sum, soldier) => sum + soldier.x, 0) / members.length,
        y: members.reduce((sum, soldier) => sum + soldier.y, 0) / members.length };
      let radius = 0;
      for (const soldier of members) { const distance = gap(soldier, center); cohesion.push(distance); radius = Math.max(radius, distance); }
      maxCohesion = Math.max(maxCohesion, radius);
      if (radius > (worstCompanies.get(id)?.radius ?? 0)) worstCompanies.set(id,
        { company: id, team: members[0].team, time: rounded(lab.time), radius: rounded(radius),
          center: { x: rounded(center.x), y: rounded(center.y) }, members: members.map(position) });
    }
    const buckets = new Map<string, Soldier[]>();
    for (const soldier of alive) {
      const x = Math.floor(soldier.x), y = Math.floor(soldier.y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
        for (const other of buckets.get(`${x + dx},${y + dy}`) ?? []) {
          const depth = BENCHMARK_LIMITS.soldierDiameter - gap(soldier, other);
          if (depth <= 1e-7) continue;
          overlapSamples++; maxOverlap = Math.max(maxOverlap, depth);
          const key = `${other.id}:${soldier.id}`;
          if (overlaps.size < 20) overlaps.set(key, { time: rounded(lab.time), depth: rounded(depth), a: position(other), b: position(soldier) });
        }
      const key = `${x},${y}`, bucket = buckets.get(key) ?? []; bucket.push(soldier); buckets.set(key, bucket);
    }
    const stalls = alive.filter(soldier => !arrived(soldier) && !soldier.moving && soldier.targetId === undefined
      && lab.time - soldier.lastProgressAt > 4).length;
    peakStalls = Math.max(peakStalls, stalls); lastArrivals = alive.filter(arrived).length;
    if (lastArrivals === initialAlive && firstFullArrivalAt === null) firstFullArrivalAt = rounded(lab.time);
    if (step % Math.max(sampleEvery, Math.round(10 / dt)) === 0 || step === steps - 1)
      checkpoints.push({ time: rounded(lab.time), alive: alive.length, arrivals: lastArrivals, stalled: stalls,
        kills: lab.combatMetrics.kills, moving: alive.filter(soldier => soldier.moving).length });
  }
  const alive = lab.soldiers.filter(soldier => soldier.hp > 0), finished = alive.filter(arrived);
  const stalled = alive.filter(soldier => !arrived(soldier) && !soldier.moving && soldier.targetId === undefined
    && lab.time - soldier.lastProgressAt > 4);
  const stable = alive.filter(soldier => settled.has(soldier.id));
  const idleDuration = Math.max(dt, lab.time - settledAt);
  const idleTravel = stable.reduce((sum, soldier) => sum + soldier.traveled - settled.get(soldier.id)!.traveled, 0);
  const idleNet = stable.reduce((sum, soldier) => sum + gap(soldier, settled.get(soldier.id)!), 0);
  const idleDrift = stable.length ? idleTravel / stable.length / idleDuration : null;
  const arrivalFraction = finished.length / Math.max(1, initialAlive), stalledFraction = stalled.length / Math.max(1, alive.length);
  const cpu = { p50Ms: rounded(percentile(samples, .5)), p95Ms: rounded(percentile(samples, .95)),
    maxMs: rounded(Math.max(...samples)), commandMs: rounded(commandMs) };
  const checks = [
    { name: 'simulation p95 within 60Hz frame budget', pass: cpu.p95Ms <= BENCHMARK_LIMITS.p95StepMs },
    { name: 'every movement stays on valid terrain and elevation edges', pass: invalidSamples === 0 },
    { name: 'soldiers remain within three tiles of their company', pass: maxCohesion <= BENCHMARK_LIMITS.companyRadius + 1e-7 },
    { name: 'no substantial physical overlap', pass: maxOverlap <= BENCHMARK_LIMITS.overlapDepth },
    ...(options.mode === 'movement' ? [
      { name: 'every soldier receives a destination across the map', pass: unassigned.length === 0 },
      { name: 'at least 95% reach assigned slots', pass: arrivalFraction >= BENCHMARK_LIMITS.arrivalFraction },
      { name: 'no more than 5% stall without combat', pass: stalledFraction <= BENCHMARK_LIMITS.stalledFraction },
      { name: 'settled soldiers do not continuously drift', pass: idleDrift !== null && idleDrift <= BENCHMARK_LIMITS.idleDriftPerSecond },
    ] : [{ name: 'battle produces contact and casualties', pass: lab.combatMetrics.damageEvents > lab.combatMetrics.shots && lab.combatMetrics.kills > 0 }]),
  ];
  return {
    scenario: options.scenario, size: options.size, mode: options.mode, seconds: rounded(lab.time), dt,
    spawned, initialAlive, finalAlive: alive.length, cpu,
    navigation: { ...lab.nav.stats, totalMs: rounded(lab.nav.stats.totalMs), maxMs: rounded(lab.nav.stats.maxMs) },
    movement: { arrived: finished.length, firstFullArrivalAt, arrivalFraction: rounded(arrivalFraction), stalled: stalled.length,
      stalledFraction: rounded(stalledFraction), unassignedDestinations: unassigned.length, peakStalls, routeFailures: lab.stats.routeFailures },
    cohesion: { p95: rounded(percentile(cohesion, .95)), max: rounded(maxCohesion) },
    idle: { sampledSoldiers: stable.length, seconds: rounded(idleDuration), tilesPerSoldierSecond: idleDrift === null ? null : rounded(idleDrift),
      meanNetDisplacement: stable.length ? rounded(idleNet / stable.length) : null },
    geometry: { samplePeriod: sampleEvery * dt, invalidSamples, overlapSamples, maxOverlapDepth: rounded(maxOverlap) },
    combat: { ...lab.combatMetrics, meleeHits: lab.combatMetrics.damageEvents - lab.combatMetrics.shots }, checks, passed: checks.every(check => check.pass),
    problems: { unassignedDestinations: unassigned, stalled: stalled.slice(0, 24).map(soldier => ({ ...position(soldier), idleSeconds: rounded(lab.time - soldier.lastProgressAt),
      company: lab.companies[soldier.company - 1].id, status: lab.companies[soldier.company - 1].status })),
      companyClusters: [...worstCompanies.values()].sort((a, b) => b.radius - a.radius).slice(0, 12),
      invalid: [...invalid.values()], overlaps: [...overlaps.values()] },
    checkpoints, wallSeconds: rounded((performance.now() - wallStart) / 1000),
  };
}
export type BenchmarkReport = ReturnType<typeof runBenchmark>;
