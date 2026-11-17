import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPerformanceScenario } from '../dev/performance/scenarios';
import { rngDrawsBetween, setOrchestrationTraceSink } from '../src/game/orchestration-trace';
import { createDuelGame, createGame, updateGame } from '../src/game/simulation';
import type { GameState } from '../src/game/types';
import { generateWorld } from '../src/world/generator';
import { nativeFixture } from './helpers/native-fixture';
import { sha256Hex, simulationStateDigest } from './helpers/state-digest';

/** Golden orchestration safety net for the Rust migration (plan step 01).
 *
 * Three seeded fixtures run 600 substeps (60 simulated seconds at 0.1 s)
 * through updateGame on the direct/server path. Two things must not change
 * unless a step explains and re-baselines them (rust/MIGRATION.md, gates):
 *  - the orchestration trace: every update, substep, stepGame phase, recurring
 *    work key and settlement decision actually run, in order, each with the
 *    number of simulation RNG draws since the previous event;
 *  - the state digest: SHA-256 of canonical units, buildings, factions,
 *    rngState, time and tick at fixed substeps.
 *
 * Re-baseline: UPDATE_ORCHESTRATION_TRACE=1 npx vitest run --dir tests orchestration-trace
 */

const GOLDEN = path.resolve(__dirname, 'fixtures/orchestration-trace.json');
const UPDATE = process.env.UPDATE_ORCHESTRATION_TRACE === '1';
const SUBSTEPS = 600, DT = .1, REPEAT_SUBSTEPS = 100;
const DIGEST_AT = [REPEAT_SUBSTEPS, 200, 400, SUBSTEPS];
/** Injected host wall clock: a fixed epoch advanced by simulated time. */
const WALL_EPOCH = 1_800_000_000_000;
const idle = { up: false, down: false, left: false, right: false };

type FixtureName = 'combat-crowd-600' | 'settlement-economy' | 'duel';
const FIXTURES: Record<FixtureName, () => GameState> = {
  // Production performance scene: 600 soldiers in melee between two palaces.
  // Normal soldier health lets casualties, cleanup and routs happen within 60 s.
  'combat-crowd-600': () => {
    const { state } = createPerformanceScenario('combat-600'), fixture = nativeFixture(state);
    for (const unit of state.units) if (unit.kind === 'warrior') fixture.patchUnit(unit.id, { hp: 100, maxHp: 100 });
    return state;
  },
  'settlement-economy': () => createGame(generateWorld('orchestration-economy-1', 96, 72)),
  duel: () => createDuelGame(generateWorld('orchestration-duel-1', 96, 72), ['North', 'South']),
};

interface FixtureGolden {
  traceSha256: string;
  events: number;
  /** Runs per recurring work key / settlement decision. */
  work: Record<string, number>;
  /** RNG draws attributed to the phase or work key that preceded them. */
  rngDraws: Record<string, number>;
  /** State digest after N substeps. */
  digests: Record<string, string>;
  gameOverAt: number | null;
  units: number;
  buildings: number;
}

const sorted = (record: Record<string, number>) =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));

async function runFixture(name: FixtureName, substeps: number): Promise<{ golden: FixtureGolden; trace: string[] }> {
  const state = FIXTURES[name]();
  const trace: string[] = [], work: Record<string, number> = {}, rngDraws: Record<string, number> = {};
  const digests: Record<string, string> = {};
  let rng = state.rngState >>> 0, owner = 'setup';
  const account = () => {
    const draws = rngDrawsBetween(rng, state.rngState >>> 0);
    rng = state.rngState >>> 0;
    if (draws) rngDraws[owner] = (rngDraws[owner] ?? 0) + draws;
    return draws;
  };
  let gameOverAt: number | null = null;
  setOrchestrationTraceSink((traced, kind, key) => {
    if (traced !== state) return;
    trace.push(`${account()}|${kind}:${key}`);
    owner = kind === 'phase' ? `phase:${key}` : kind === 'work' || kind === 'decision' ? `${kind}:${key}` : owner;
    if (kind === 'work' || kind === 'decision') work[`${kind}:${key}`] = (work[`${kind}:${key}`] ?? 0) + 1;
  });
  try {
    for (let step = 1; step <= substeps; step++) {
      updateGame(state, DT, idle, { wallNow: WALL_EPOCH + Math.round((step - 1) * DT * 1000) });
      trace.push(`${account()}|end`);
      owner = 'between-updates';
      // Keep simulating after the first game over (as scripts/sim-parity.mjs does);
      // updateGame is a no-op while the flag is set.
      if (state.gameOver) { gameOverAt ??= step; state.gameOver = false; trace.push('game-over-cleared'); }
      if (DIGEST_AT.includes(step)) digests[step] = await simulationStateDigest(state);
    }
  } finally { setOrchestrationTraceSink(undefined); }
  return {
    trace,
    golden: {
      traceSha256: await sha256Hex(trace.join('\n')), events: trace.length,
      work: sorted(work), rngDraws: sorted(rngDraws), digests, gameOverAt,
      units: state.units.length, buildings: state.buildings.length,
    },
  };
}

const golden: Partial<Record<FixtureName, FixtureGolden>> = existsSync(GOLDEN) && !UPDATE
  ? JSON.parse(readFileSync(GOLDEN, 'utf8')).fixtures : {};

describe('golden orchestration trace and state digest', () => {
  for (const name of Object.keys(FIXTURES) as FixtureName[]) {
    it(`${name}: 600 substeps keep the recorded phase/work/RNG trace and state digest`, async () => {
      const first = await runFixture(name, SUBSTEPS);
      // A second run in the same module instance must reproduce the prefix:
      // module-level caches or counters may not leak between games.
      const repeat = await runFixture(name, REPEAT_SUBSTEPS);
      const prefix = first.trace.slice(0, repeat.trace.length);
      expect(repeat.trace.length).toBeGreaterThan(REPEAT_SUBSTEPS * 3);
      expect(await sha256Hex(repeat.trace.join('\n'))).toBe(await sha256Hex(prefix.join('\n')));
      expect(repeat.golden.digests[REPEAT_SUBSTEPS]).toBe(first.golden.digests[REPEAT_SUBSTEPS]);
      // The trace must cover real orchestration, not an empty hook.
      expect(Object.keys(first.golden.work).length).toBeGreaterThan(10);
      expect(first.trace.filter(entry => entry.endsWith('|phase:actors'))).toHaveLength(SUBSTEPS);

      if (UPDATE) {
        const existing = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, 'utf8')) : { fixtures: {} };
        existing.fixtures[name] = first.golden;
        existing.substeps = SUBSTEPS; existing.dt = DT; existing.wallEpoch = WALL_EPOCH;
        existing.fixtures = Object.fromEntries(Object.entries(existing.fixtures).sort(([a], [b]) => a < b ? -1 : 1));
        mkdirSync(path.dirname(GOLDEN), { recursive: true });
        writeFileSync(GOLDEN, JSON.stringify(existing, null, 2) + '\n');
        return;
      }
      const expected = golden[name];
      expect(expected, `missing golden for ${name}; run with UPDATE_ORCHESTRATION_TRACE=1`).toBeDefined();
      // Compare the explanatory summaries first so a failure names what moved.
      expect(first.golden.work).toEqual(expected!.work);
      expect(first.golden.rngDraws).toEqual(expected!.rngDraws);
      expect({ units: first.golden.units, buildings: first.golden.buildings, gameOverAt: first.golden.gameOverAt, events: first.golden.events })
        .toEqual({ units: expected!.units, buildings: expected!.buildings, gameOverAt: expected!.gameOverAt, events: expected!.events });
      expect(first.golden.traceSha256).toBe(expected!.traceSha256);
      expect(first.golden.digests).toEqual(expected!.digests);
    }, 600_000);
  }
});
