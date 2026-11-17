import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Aggregate comparison rules retained from the migration parity harness.
export function compare(args) {
  const positional = args.filter(value => !value.startsWith('--'));
  const [baselinePath, candidatePath] = positional;
  if (!baselinePath || !candidatePath) {
    console.error('Usage: npm run sim -- compare <baseline.json> <candidate.json> [--ensemble=a,b|--no-ensemble] [--all] [--json=<file>]');
    process.exitCode = 2; return;
  }
  const option = name => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const showAll = args.includes('--all');
  const jsonOut = option('json');
  const read = file => JSON.parse(readFileSync(file, 'utf8'));
  let ensemblePaths = [];
  if (option('ensemble')) ensemblePaths = option('ensemble').split(',').filter(Boolean);
  else if (!args.includes('--no-ensemble')) {
    const directory = path.dirname(path.resolve(baselinePath));
    ensemblePaths = readdirSync(directory).filter(name => /^parity-perturbed.*\.json$/.test(name)).sort()
      .map(name => path.join(directory, name)).filter(file => path.resolve(file) !== path.resolve(candidatePath));
  }
  const baseline = read(baselinePath), candidate = read(candidatePath);
  if (!baseline.scenarios || !candidate.scenarios) throw new Error('Comparison requires world-mode reports.');
  if (!Object.keys(baseline.scenarios).length) throw new Error('Baseline report has no scenarios.');
  const ensemble = ensemblePaths.filter(file => existsSync(file)).map(read);
  const references = [baseline, ...ensemble];

  // Rule kinds (lo..hi is the reference band; b is the baseline value):
  //   rel(tol, floor): lo - max(tol*|lo|, floor) <= c <= hi + max(tol*|hi|, floor)
  //   ratio(k, floor): PASS if max(hi, c) <= floor, else lo/k <= c <= hi*k
  //   abs(n):          lo - n <= c <= hi + n
  //   info:            never fails (reported for diagnosis)
  // severity 'warn' turns a violation into WARN instead of FAIL.
  const rel = (tol, floor, severity = 'fail') => ({ kind: 'rel', tol, floor, severity });
  const ratio = (k, floor, severity = 'fail') => ({ kind: 'ratio', k, floor, severity });
  const abs = (n, severity = 'fail') => ({ kind: 'abs', n, severity });
  const info = { kind: 'info', severity: 'info' };

  const TOTAL_RULES = {
    // Economy flows and sizes, summed over all factions: +/-15% beyond the band
    // (population +/-20%: leave-one-out calibration showed 16-17% at 900 s).
    population: rel(.2, 5), incomeFood: rel(.15, 50), incomeGold: rel(.15, 100), culture: rel(.15, 25),
    buildingsReady: rel(.15, 10), territoryCells: rel(.15, 50), units: rel(.15, 10),
    // Treasury stocks are income minus spending and swing hardest: +/-30%.
    food: rel(.3, 300), gold: rel(.3, 300),
    // Development.
    researchLevels: rel(.25, 2), villageStageSum: rel(.25, 2), villagesActive: abs(1),
    buildingsConstruction: rel(.5, 10, 'warn'),
    // Combat: same order of magnitude (2x beyond the band) above a noise floor.
    soldiers: ratio(1.5, 10), hostileUnits: ratio(2, 10), deaths: ratio(2, 10), kills: ratio(2, 10),
    projectilesFired: ratio(2, 40),
    // Outcome changes are flagged for a human look, not failed automatically.
    defeatedFactions: abs(0, 'warn'), raiderCamps: abs(1, 'warn'), marauderPacks: rel(.5, 3, 'warn'),
    // Work counters may legitimately change when the implementation moves.
    pathSearches: info, travelMaps: info, nearestMaps: info,
  };
  // Per-civilization (non-village) checks are diagnostic only.
  const FACTION_RULES = { population: rel(.25, 4, 'warn'), gold: rel(.25, 150, 'warn'),
    territoryCells: rel(.25, 40, 'warn'), buildingsReady: rel(.25, 8, 'warn') };

  // Scenarios whose totals are bistable on a single outcome (an idle human's
  // capital falling to bandits). From the first game over in ANY reference run or
  // the candidate onward, their FAIL rows are downgraded to WARN ("outcome").
  const OUTCOME_BISTABLE = new Set(['duel']);

  function evaluate(rule, values, c) {
    const b = values[0];
    if (values.some(value => !Number.isFinite(value)) || !Number.isFinite(c))
      return { status: rule.kind === 'info' ? 'INFO' : 'FAIL', delta: 'missing/invalid' };
    const lo = Math.min(...values), hi = Math.max(...values);
    const delta = b === 0 ? (c === 0 ? '0%' : 'new') : `${(((c - b) / Math.abs(b)) * 100).toFixed(1)}%`;
    if (rule.kind === 'info') return { status: 'INFO', delta };
    let ok;
    if (rule.kind === 'rel') ok = c >= lo - Math.max(rule.tol * Math.abs(lo), rule.floor) && c <= hi + Math.max(rule.tol * Math.abs(hi), rule.floor);
    else if (rule.kind === 'abs') ok = c >= lo - rule.n && c <= hi + rule.n;
    else ok = Math.max(hi, c) <= rule.floor || (c >= lo / rule.k && c <= hi * rule.k);
    return { status: ok ? 'PASS' : rule.severity === 'warn' ? 'WARN' : 'FAIL', delta };
  }
  const describe = rule => rule.kind === 'rel' ? `±${rule.tol * 100}% (floor ${rule.floor})` : rule.kind === 'ratio'
    ? `${rule.k}x (floor ${rule.floor})` : rule.kind === 'abs' ? `±${rule.n}` : 'info';
  const band = values => values.every(value => typeof value === 'number') && values.length > 1
    ? `${Math.min(...values)}..${Math.max(...values)}` : '';
  const civilizationBuildings = faction => Object.values(faction.buildings.ready).reduce((sum, value) => sum + value, 0);
  const checkpointAt = (report, name, t) => report.scenarios?.[name]?.checkpoints.find(point => point.t === t);

  const rows = [];
  let missing = 0;
  for (const [name, base] of Object.entries(baseline.scenarios)) {
    if (!base.checkpoints?.length) throw new Error(`Baseline scenario ${name} has no checkpoints.`);
    if (!candidate.scenarios?.[name]) {
      rows.push({ scenario: name, t: '-', metric: 'scenario', baseline: 'present', candidate: 'missing', status: 'FAIL' }); missing++; continue;
    }
    const outcomeAt = OUTCOME_BISTABLE.has(base.scenario ?? name.split(':')[0]) ? Math.min(...[...references, candidate]
      .map(report => report.scenarios?.[name]?.gameOver?.t ?? Infinity)) : Infinity;
    for (const point of base.checkpoints) {
      const other = checkpointAt(candidate, name, point.t);
      if (!other) { rows.push({ scenario: name, t: point.t, metric: 'checkpoint', baseline: 'present', candidate: 'missing', status: 'FAIL' }); missing++; continue; }
      const refs = references.map(report => checkpointAt(report, name, point.t)).filter(Boolean);
      for (const [metric, rule] of Object.entries(TOTAL_RULES)) {
        const values = refs.map(ref => ref.totals[metric]);
        let { status, delta } = evaluate(rule, values, other.totals[metric]);
        let ruleText = describe(rule);
        if (status === 'FAIL' && point.t >= outcomeAt) { status = 'WARN'; ruleText += ' [outcome-divergent]'; }
        rows.push({ scenario: name, t: point.t, metric, baseline: values[0], band: band(values), candidate: other.totals[metric], delta, rule: ruleText, status });
      }
      for (const faction of point.factions.filter(entry => !entry.village)) {
        const match = other.factions.find(entry => entry.id === faction.id);
        if (!match) continue;
        const pick = (entry, metric) => metric === 'buildingsReady' ? civilizationBuildings(entry) : entry[metric];
        for (const [metric, rule] of Object.entries(FACTION_RULES)) {
          const values = refs.map(ref => ref.factions.find(entry => entry.id === faction.id)).filter(Boolean).map(entry => pick(entry, metric));
          const { status, delta } = evaluate(rule, values, pick(match, metric));
          rows.push({ scenario: name, t: point.t, metric: `f${faction.id}.${metric}`, baseline: values[0], band: band(values), candidate: pick(match, metric), delta, rule: describe(rule), status });
        }
      }
      rows.push({ scenario: name, t: point.t, metric: 'hash', baseline: point.hash, candidate: other.hash,
        rule: 'info (exact only for identical engines)', status: point.hash === other.hash ? 'MATCH' : 'INFO' });
    }
  }

  const counts = rows.reduce((total, row) => (total[row.status] = (total[row.status] ?? 0) + 1, total), {});
  const finalTimes = new Map(Object.entries(baseline.scenarios).map(([name, scenario]) => [name, scenario.checkpoints.at(-1)?.t]));
  const shown = rows.filter(row => showAll || row.status === 'FAIL' || row.status === 'WARN'
    || (row.t === finalTimes.get(row.scenario) && !row.metric.startsWith('f')));
  const columns = ['scenario', 't', 'metric', 'baseline', 'band', 'candidate', 'delta', 'rule', 'status'];
  const text = value => String(value ?? '');
  const widths = columns.map(column => Math.max(column.length, ...shown.map(row => text(row[column]).length)));
  const line = values => values.map((value, index) => text(value).padEnd(widths[index])).join('  ').trimEnd();
  console.log(`baseline: ${baselinePath}\ncandidate: ${candidatePath}\nensemble: ${ensemble.length ? ensemblePaths.join(', ') : '(none; band = baseline value)'}\n`);
  console.log(line(columns));
  console.log(widths.map(width => '-'.repeat(width)).join('  '));
  for (const row of shown) console.log(line(columns.map(column => row[column])));
  const verdict = (counts.FAIL ?? 0) === 0 && missing === 0 ? 'PASS' : 'FAIL';
  console.log(`\n${verdict}: ${Object.entries(counts).map(([status, count]) => `${count} ${status}`).join(', ')}`
    + ` (${rows.length} checks; table shows final checkpoints plus every WARN/FAIL; --all for everything)`);
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify({ verdict, counts, ensemble: ensemblePaths, rows }, null, 1)}\n`);
  process.exitCode = verdict === 'PASS' ? 0 : 1;
}
