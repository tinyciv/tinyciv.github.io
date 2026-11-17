const round = value => Number(value.toFixed(6));
const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;

function describe(pairs) {
  const deltas = pairs.map(([candidate, baseline]) => candidate.score - baseline.score);
  const mean = average(deltas);
  const sd = deltas.length > 1 ? Math.sqrt(deltas.reduce((sum, delta) => sum + (delta - mean) ** 2, 0) / (deltas.length - 1)) : null;
  const se = sd === null ? null : sd / Math.sqrt(deltas.length);
  return { matchedPairs: pairs.length, wins: deltas.filter(delta => delta > 1e-8).length,
    ties: deltas.filter(delta => Math.abs(delta) <= 1e-8).length, losses: deltas.filter(delta => delta < -1e-8).length,
    meanScoreDelta: round(mean), pairedScoreSD: sd === null ? null : round(sd),
    approximate95PercentInterval: se === null ? null : [round(mean - 1.96 * se), round(mean + 1.96 * se)],
    meanLeaderSurvivalDelta: round(average(pairs.map(([candidate, baseline]) => Number(candidate.leaderAlive) - Number(baseline.leaderAlive)))),
    meanKillsDelta: round(average(pairs.map(([candidate, baseline]) => candidate.kills - baseline.kills))),
    meanSurvivorsDelta: round(average(pairs.map(([candidate, baseline]) => candidate.survivors - baseline.survivors))) };
}

/** Paired analysis is host-side experiment analysis, never a gameplay rule. */
export function comparePolicies(rows, policies, baseline) {
  const key = row => JSON.stringify([row.scenario, row.seed]);
  const references = new Map();
  for (const row of rows.filter(row => row.policy === baseline)) {
    if (references.has(key(row))) throw new Error(`Duplicate baseline trial ${key(row)}`);
    references.set(key(row), row);
  }
  if (!references.size) throw new Error(`No baseline trials for ${baseline}`);
  const comparisons = policies.filter(policy => policy !== baseline).map(policy => {
    const candidates = rows.filter(row => row.policy === policy), seen = new Set();
    const pairs = candidates.map(candidate => {
      const trial = key(candidate), reference = references.get(trial);
      if (seen.has(trial)) throw new Error(`Duplicate trial ${policy}: ${trial}`);
      seen.add(trial);
      if (!reference) throw new Error(`Missing baseline for ${policy}: ${trial}`);
      if (!candidate.initialStateHash || candidate.initialStateHash !== reference.initialStateHash)
        throw new Error(`Unmatched initial conditions for ${policy}: ${trial}`);
      if (!Number.isFinite(candidate.score) || !Number.isFinite(reference.score)) throw new Error(`Invalid score for ${policy}: ${trial}`);
      return [candidate, reference];
    });
    if (pairs.length !== references.size) throw new Error(`Missing paired trials for ${policy}`);
    const scenarios = [...new Set(candidates.map(row => row.scenario))];
    return { policy, ...describe(pairs), scenarios: Object.fromEntries(scenarios.map(scenario => [scenario,
      describe(pairs.filter(([row]) => row.scenario === scenario))])) };
  });
  return { baseline, intervalMethod: 'Normal approximation to paired mean score differences (mean +/- 1.96 standard errors); descriptive, especially with few seeds.',
    comparisons: comparisons.sort((a, b) => b.meanScoreDelta - a.meanScoreDelta) };
}
