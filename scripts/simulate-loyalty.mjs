import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
const bundle = await build({ entryPoints: ['src/game/loyalty-model.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const { initialCityLoyalty, advanceLoyalty, citySupport } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const scenarios = [
  { name: 'Peaceful first city', distance: undefined, pressure: 0 },
  { name: 'Isolated new city, no rivals', distance: 100, pressure: 0 },
  { name: 'Isolated frontier, half perimeter pressed', distance: 100, pressure: .5 },
  { name: 'Isolated city, fully encircled', distance: 100, pressure: 1 },
  { name: 'Encircled city, 3 civic buildings, monument, 2 posts', distance: 100, pressure: 1, advanced: 3, monument: 1, guards: 2 },
  { name: 'Half-pressed frontier, 3 of 30 residents killed each minute', distance: 100, pressure: .5, raids: true },
  { name: 'Same frontier rescued at minute 3', distance: 100, pressure: .5, raids: true, rescue: true },
  { name: 'First city, five casualties in one raid', distance: undefined, pressure: 0, singleRaid: true },
];
const results = scenarios.map(s => {
  const l = Object.assign(initialCityLoyalty(0), { pressure: s.pressure, support: citySupport(s.distance), advanced: s.advanced ?? 0, monument: s.monument ?? 0, guards: s.guards ?? 0 });
  const points = [{ seconds: 0, loyalty: 75 }]; let revoltAt;
  for (let t = 5; t <= 900; t += 5) {
    if (s.singleRaid && t === 150 || s.raids && t >= 150 && t % 60 === 30 && !(s.rescue && t >= 180)) {
      l.trauma = Math.min(75, l.trauma * 2 ** (-(t - l.traumaAt) / 120) + (s.singleRaid ? 60 : 24)); l.traumaAt = t;
    }
    if (s.rescue && t === 180) { l.support = citySupport(30); l.advanced = 3; l.monument = 1; l.guards = 2; }
    advanceLoyalty(l, 5, t);
    if (t % 60 === 0) points.push({ seconds: t, loyalty: Math.round(l.value) });
    if (l.value <= 0) { revoltAt = t; break; }
  }
  return { name: s.name, target: Math.round(l.target), final: Math.round(l.value), revoltAt, points };
});
await mkdir('scratch/2026-11-07-loyalty', {recursive:true});
await writeFile('scratch/2026-11-07-loyalty/simulations.json', JSON.stringify(results,null,2));
for (const r of results) console.log(`${r.name}: ${r.final} loyalty; target ${r.target}; revolt ${r.revoltAt ? r.revoltAt+'s' : 'never in 15 minutes'}`);
