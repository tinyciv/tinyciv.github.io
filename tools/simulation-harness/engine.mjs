import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// Only host orchestration lives here. Every scenario uses the production game
// and its required Rust/WASM core; no replacement simulation rules or renderer.
export async function bundleEngine({ retinueRestBaseline = false, fixtureFile } = {}) {
  const scratch = path.join(ROOT, 'scratch/simulation-harness');
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(path.join(scratch, 'run-'));
  const bundle = path.join(directory, 'engine.mjs');
  const wasm = path.join(ROOT, 'public/wasm/simulation.wasm');
  try {
    const fixtureSource = fixtureFile ?? path.join(ROOT, 'public/scenarios/musketry-deathmatch.json.gz');
    const fixtureBytes = await readFile(fixtureSource);
    const fixture = path.join(directory, 'musketry-deathmatch.json.gz');
    await writeFile(fixture, fixtureBytes);
    await build({ stdin: { contents: `
export { createGame, createDuelGame, updateGame, migrateGame } from './src/game/simulation.ts';
export { parseGameSave } from './src/game/game-save.ts';
export { generateWorld } from './src/world/generator.ts';
export { territory } from './src/game/borders.ts';
export { navigationWasmStatus } from './src/game/navigation-wasm.ts';
export { settlementRow, affiliationBreakdown } from './src/game/settlement-bridge.ts';
export { buildingReady } from './src/game/types.ts';
export { seedSimulationRandom } from './src/game/sim-handle.ts';
export { entityStore } from './src/game/entity-store.ts';
export { setFactionAIProfile, registerFactionAIPolicies, listFactionAIPolicies, factionAIPolicy, factionAILogicFaults } from './src/game/faction-ai-profile.ts';
export { isHumanFaction } from './src/game/player-context.ts';
export { getFactionStrategy } from './src/game/faction-strategy.ts';
export { offensiveAiTarget, offensiveDirective } from './src/game/offensive-native.ts';
export { fieldCannonPathStatus } from './src/game/field-cannons-native.ts';
export { ensureMarauderLeaders } from './src/game/marauder-leaders.ts';
export { configureAIMatch } from './src/game/ai-match.ts';
export { simRandom } from './src/game/sim-handle.ts';
export { markWorldChanged } from './src/game/world-revisions.ts';
export { canWalk, hasStaticPath } from './src/game/pathfinding.ts';
export { isRetinueMember, buildingWidth, buildingHeight } from './src/game/types.ts';
`, resolveDir: ROOT, loader: 'ts' }, bundle: true, platform: 'node', target: 'node22', format: 'esm',
      outfile: bundle, logLevel: 'silent',
      // Paired diagnostic baseline keeps the original exact-slot behavior.
      // The production bundle never uses this observation-only substitution.
      plugins: retinueRestBaseline ? [{ name: 'original-retinue-rest', setup(plugin) {
        plugin.onLoad({ filter: /retinue-settling-native\.ts$/ }, () => ({ loader: 'ts', contents:
          'export const nativeRetinueSettled = () => false; export const nativeRetinueYieldAllowed = () => true;' }));
      } }] : [],
      define: { 'import.meta.env.BASE_URL': '"/"' } });
    const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
    const [source, core] = await Promise.all([readFile(bundle), readFile(wasm)]);
    // rust-engine prefers the file beside its bundle. Freeze it so a rebuild
    // elsewhere in this workspace cannot change later trials in this run.
    await writeFile(path.join(directory,'simulation.wasm'),core);
    return { directory, bundle, fixtures: { 'musketry-deathmatch': fixture }, artifacts: {
      bundleSha256: sha256(source), wasmSha256: sha256(core), musketryScenarioSha256: sha256(fixtureBytes) } };
  } catch (error) {
    // Also remove failed builds; callers only receive successful directories.
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
