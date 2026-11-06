import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = process.cwd(), out = path.join(root, 'scratch/2026-11-01-raid-stoppage');
await mkdir(out, { recursive: true });
const version = 'current', duration = Number(process.argv.find(arg => arg.startsWith('--seconds='))?.split('=')[1] ?? 180);
const outfile = path.join(out, `replay-${version}.mjs`);
await build({ stdin: { contents: "export {parseGameSave} from './src/game/game-save.ts';export {updateGame} from './src/game/simulation.ts';", resolveDir: root },
  bundle: true, platform: 'node', format: 'esm', outfile,
});
const { parseGameSave, updateGame } = await import(pathToFileURL(outfile).href);
const state = parseGameSave(await readFile(path.join(out, 'live-save.json'), 'utf8'));
state.paused = false; state.speed = 1;
const initialTime = state.time, idle = { up: false, down: false, left: false, right: false };
let previousIds = new Set(state.units.filter(u => u.faction === -2 && u.hp > 0).map(u => u.id)), deaths = 0, recruits = 0;
let previousRaiders = new Map(state.units.filter(u => u.faction === -2 && u.hp > 0).map(u => [u.id, { x: u.x, y: u.y }]));
let previousPlayerHp = new Map([...state.units, ...state.buildings].filter(e => e.faction === 0 && e.hp > 0).map(e => [e.id, e.hp]));
let playerHpLost = 0, raiderDeathsNearPlayerBuildings = 0, playerContactSeconds = 0, lastPlayerContactAt;
const rows = [], started = performance.now();
function record() {
  const raiders = state.units.filter(u => u.faction === -2 && u.hp > 0), packs = new Map(state.marauderPacks.map(p => [p.id, p]));
  const row = { elapsed: Math.round(state.time - initialTime), time: state.time, waves: state.fogRaids?.waves,
    smallWaves: Object.values(state.raiderSkirmishes?.wavesByFaction ?? {}).reduce((a, b) => a + b, 0),
    raiders: raiders.length, active: raiders.filter(u => !u.inside).length, inside: raiders.filter(u => u.inside).length,
    deaths, recruits, playerHpLost: Math.round(playerHpLost), raiderDeathsNearPlayerBuildings, playerContactSeconds,
    lastPlayerContactAt, gameOver: state.gameOver, victory: state.victory,
    staleApproaches: state.marauderPacks.filter(p => !p.returning && p.phase !== 'muster' && state.time - (p.lastProgressAt ?? state.time) > 30).length,
    camps: state.raiderCamps.map(c => ({ id: c.id, waves: c.waves, nextIn: Math.round(c.nextRaidAt - state.time),
      raiders: raiders.filter(u => packs.get(u.marauderPack)?.raiderCamp === c.id).length,
      active: raiders.filter(u => !u.inside && packs.get(u.marauderPack)?.raiderCamp === c.id).length })),
    watchedPacks: [289, 305, 312].map(id => {
      const pack = packs.get(id), active = raiders.filter(u => !u.inside && u.marauderPack === id);
      return { id, target: pack?.targetBuilding, returning: pack?.returning, active: active.map(u => ({ id: u.id,
        x: Math.round(u.x * 10) / 10, y: Math.round(u.y * 10) / 10, target: u.target,
        distanceFromCamp: pack ? Math.round(Math.hypot(u.x - pack.home.x, u.y - pack.home.y)) : undefined })) };
    }) };
  rows.push(row); console.log(JSON.stringify(row));
}
record();
for (let second = 1; second <= duration; second++) {
  updateGame(state, 1, idle);
  const ids = new Set(state.units.filter(u => u.faction === -2 && u.hp > 0).map(u => u.id));
  deaths += [...previousIds].filter(id => !ids.has(id)).length;
  recruits += [...ids].filter(id => !previousIds.has(id)).length;
  const playerBuildings = state.buildings.filter(b => b.faction === 0 && b.hp > 0);
  for (const [id, point] of previousRaiders) if (!ids.has(id)
    && playerBuildings.some(b => Math.hypot(point.x - b.x, point.y - b.y) <= 8)) raiderDeathsNearPlayerBuildings++;
  const playerEntities = [...state.units, ...state.buildings].filter(e => e.faction === 0);
  for (const e of playerEntities) playerHpLost += Math.max(0, (previousPlayerHp.get(e.id) ?? e.hp) - e.hp);
  const playerIds = new Set(playerEntities.map(e => e.id));
  if (state.units.some(u => u.faction === -2 && u.hp > 0 && !u.inside && playerIds.has(u.target)
    && state.time - u.lastCombat < 1.1)) { playerContactSeconds++; lastPlayerContactAt = state.time; }
  previousRaiders = new Map(state.units.filter(u => u.faction === -2 && u.hp > 0).map(u => [u.id, { x: u.x, y: u.y }]));
  previousPlayerHp = new Map(playerEntities.map(e => [e.id, e.hp]));
  previousIds = ids;
  if (second % 30 === 0 || state.gameOver) record();
  if (state.gameOver) break;
}
const report = { version, elapsedMs: Math.round(performance.now() - started), rows };
await writeFile(path.join(out, `replay-${version}-metrics.json`), JSON.stringify(report, null, 2));
await writeFile(path.join(out, `replay-${version}-state.json`), JSON.stringify(state));
console.log(JSON.stringify({ version, elapsedMs: report.elapsedMs }));
