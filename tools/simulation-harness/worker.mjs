import { pathToFileURL } from 'node:url';
import { runTrial } from './runner.mjs';

// Each trial gets a fresh process, WASM instance and module caches, even when
// the parent runs trials sequentially. Guards apply before importing the game.
Date.now = () => { throw new Error('Simulation read Date.now; use the injected wallNow clock.'); };
Math.random = () => { throw new Error('Simulation read Math.random; use the seeded simulation RNG.'); };

try {
  const { bundle, trial, config, fixtures } = JSON.parse(process.argv[2]);
  const engine = await import(pathToFileURL(bundle).href);
  const result = runTrial(engine, trial, config, fixtures);
  process.send({ type: 'result', result }, error => {
    if (error) { console.error(error); process.exitCode = 1; }
    process.disconnect();
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  if (process.connected) process.disconnect();
}
