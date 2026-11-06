import { readFileSync, writeFileSync } from 'node:fs';

// node scripts/summarize-cpu-profile.mjs input.cpuprofile [summary.json]
const profile = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const nodes = new Map(profile.nodes.map(node => [node.id, node]));
const parents = new Map(profile.nodes.flatMap(node => (node.children ?? []).map(child => [child, node.id])));
const functions = new Map(), groups = new Map();
const groupFunctions = {
  cityPlanningAndSummaries: new Set(['updateFactionDevelopment', 'cityDevelopmentNeeds', 'governingPalace',
    'citySummaries', 'factionCityDevelopmentPriority', 'factionDevelopmentReserve',
    'productiveDevelopmentReserve', 'updateFactionStrategies']),
  pathSearches: new Set(['findPath', 'findReversePath', 'travelTimeMapFrom', 'travelTimeMap']),
  movement: new Set(['moveUnit', 'advanceUnit', 'separateUnits', 'updateFriendlyYield']),
  localSteeringAndCollision: new Set(['requestFriendlyYield', 'separateUnits', 'unitPositionBlocked',
    'unitCanMove', 'movementCongestion', 'unitBlocksNavigationCell']),
  navigationMaintenance: new Set(['structures', 'navigationGrid', 'terrainNavigation', 'travelCache']),
  spatialMaintenance: new Set(['beginUnitFrame', 'refreshIndexedUnit']),
  collectorUpdates: new Set(['updateCollector']),
  fogUpdates: new Set(['updateFog']),
  drawing: new Set(['draw']),
};
let total = 0;
for (let index = 0; index < profile.samples.length; index++) {
  let id = profile.samples[index], leaf = true;
  const weight = profile.timeDeltas[index]; total += weight;
  const seenNodes = new Set(), seenFunctions = new Set(), names = new Set();
  while (id !== undefined && !seenNodes.has(id)) {
    seenNodes.add(id);
    const frame = nodes.get(id).callFrame;
    const url = frame.url.split('?')[0], key = `${frame.functionName}|${url}|${frame.lineNumber}|${frame.columnNumber}`;
    names.add(frame.functionName);
    let item = functions.get(key);
    if (!item) { item = { name: frame.functionName, url, line: frame.lineNumber + 1, selfUs: 0, inclusiveUs: 0 }; functions.set(key, item); }
    if (leaf) item.selfUs += weight;
    if (!seenFunctions.has(key)) item.inclusiveUs += weight;
    seenFunctions.add(key); leaf = false; id = parents.get(id);
  }
  for (const [group, members] of Object.entries(groupFunctions))
    if ([...members].some(name => names.has(name))) groups.set(group, (groups.get(group) ?? 0) + weight);
}
const rows = [...functions.values()].map(row => ({ ...row, selfPercent: row.selfUs / total * 100,
  inclusivePercent: row.inclusiveUs / total * 100 }));
const report = { source: process.argv[2], samples: profile.samples.length, sampledMilliseconds: total / 1000,
  note: 'Weighted sampling estimates. Inclusive functions and groups overlap and must not be added. Source lines refer to loaded JavaScript, before source-map remapping.',
  groups: Object.fromEntries([...groups].map(([name, weight]) => [name, { milliseconds: weight / 1000, percent: weight / total * 100 }])),
  self: [...rows].sort((a, b) => b.selfUs - a.selfUs).slice(0, 40),
  inclusive: [...rows].sort((a, b) => b.inclusiveUs - a.inclusiveUs).slice(0, 60) };
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + '\n');
else console.log(JSON.stringify(report, null, 2));
