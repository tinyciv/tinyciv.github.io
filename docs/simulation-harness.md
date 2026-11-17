# Headless simulation harness

`npm run sim -- [world|ai|match] [options]` runs the production simulation and its Rust/WASM core as fast as the CPU allows. It creates no browser, renderer, UI, or real-time timers. Host orchestration stays in Node; gameplay rules are the same ones used by the game. Build the core with `npm run build:wasm` after changing Rust code.

```sh
# One hour of a normal generated world with idle human input
npm run sim -- world --scenarios=default --seconds=3600 --out=scratch/long-game.json

# Compare faction policies on identical starting conditions
npm run sim -- ai --seconds=90 --seeds=3

# Multiple reproducible worlds, with two isolated processes at a time
npm run sim -- world --seed=economy-study --seeds=3 --jobs=2

# Compare world report checkpoints against a baseline
npm run sim -- compare scratch/baseline.json scratch/candidate.json --no-ensemble
```

World mode defaults to 900 seconds for each of `default`, `advanced`, `bandits`, and `duel`, with one seed and the expansionist policy. AI mode defaults to 90 seconds for each of `open-battle`, `fortified-assault`, and `outnumbered-defense`, with three seeds and all available policies. Use `--scenarios=a,b` and `--policies=a,b` to narrow a run. `--policy-file=experiments/ai-policies.json` loads additional variants; AI mode automatically includes the `--baseline=coordinated` policy for paired comparisons. See [AI policy experiments](ai-policy-experiments.md) for configuration and analysis. `npm run sim -- --help` and `--list` inspect configuration without running the game.

All runs use the same 0.1-second step and advance the injected host clock from simulated time, including Leader respawn deadlines. `--dt=N` may select a smaller positive step. Runs reject unseeded randomness and reads of the real clock. With `--seed=TEXT`, a single seed uses that text verbatim; multiple seeds use `TEXT-1`, `TEXT-2`, etc. Each AI policy receives the same world seed and placement for a given scenario and seed index.

Every trial runs in a fresh process, so module caches and WASM state cannot leak between policies or seeds. `--jobs=N` bounds concurrency; the default is one to avoid competing for CPU during timing measurements. There are no sleeps or speed multipliers. The normal simulation still computes gameplay work such as pathfinding and visibility.

World mode continues after recording the first game over; AI mode stops. Override either with `--game-over=stop|continue`. A pending palace-capture decision or pause stops the trial and records the reason. Reports use the actual game clock and never count stalled updates toward the requested duration. Human movement input is idle in both modes; world mode exercises the ordinary faction AI, while AI mode compares controlled tactical scenarios.

The AI scenario `musketry-deathmatch` loads `public/scenarios/musketry-deathmatch.json.gz` through the production save loader. It keeps the prepared terrain, two cities per faction, roads, musketmen, cannons, technologies and normal economy, with idle human input. Trial seeds reset the native random stream while the baked map remains identical. Unlike the smaller combat fixtures, this scenario already unlocks Officer Corps. Its report records the artifact hash and the AI faction's Offensive launches, rally/attack/captured time, flag objective and target changes, phase transitions, and any time an ordinary infantry formation conflicts with an active Offensive.

```sh
npm run build:wasm
npm run sim -- ai --seconds=90 --seeds=3 --scenarios=musketry-deathmatch --policies=expansionist --baseline=expansionist --jobs=2 --out=scratch/offensive-ai/report.json
```

World mode can observe the same prepared realm for longer without generating another map:

```sh
npm run sim -- world --scenarios=default --seconds=3600 --prepared-scenario=musketry-deathmatch --game-over=stop --out=scratch/cannon-recovery/world.json
```

This reports `create: prepared-scenario`, the actual scenario/artifact hash, ordinary world checkpoints and `armyObservations` for faction 1. A sidecar army checkpoint is written at each world sample, including cannon travel, arrival, reversals, shots and native path state. The Musketry artifact is frozen beside the engine/WASM before any worker starts; `--fixture-file=FILE` selects a saved artifact for controlled comparisons. Palace-capture decisions and game-over conditions retain their normal stop behavior.

Reports default to `benchmarks/simulation-world.json` or `benchmarks/simulation-ai.json`; `--out=FILE` changes the path. They include configuration, seeds, source-bundle/WASM hashes, environment, actual simulated duration, stop reasons, and speedup. Per-trial `wallSeconds` measures stepping plus metric collection; `setupSeconds` measures world creation; report-level elapsed time also includes bundling and process startup. Speedup depends on scenario size and machine load.

World checkpoints include economy, population, research, combat, villages, navigation work, and a coarse state hash. `--checkpoints=30,120,300` changes sample times; the final state is always recorded, including early stops. `--perturb=N` XORs the initial world RNG state for divergence studies, and `--enemy-strength=N` overrides enemy strength. AI reports include policy rankings and raw survival, kills, damage, and mission/formation time using the existing tournament score.

`compare` applies the migration harness's aggregate tolerances and returns a nonzero exit code for failures or missing checkpoints. Use matching seeds, durations, steps, and scenario selections. Exact hashes are informational; aggregate comparison allows chaotic trajectories to differ. Existing sibling `parity-perturbed*.json` files form a reference band unless `--no-ensemble` is supplied; `--ensemble=a.json,b.json` selects it explicitly. `--all` shows every comparison and `--json=FILE` writes the comparison details.

The implementation lives in `tools/simulation-harness/`: `engine.mjs` bundles the production entry points, `runner.mjs` owns the shared loop, `world.mjs` and `ai.mjs` supply scenarios and observations, and `worker.mjs` isolates each trial. The older AI/parity scripts are thin adapters to this implementation; `npm run benchmark:ai` also selects AI mode.

### Retinue movement and settling observations

`--retinue-motion` gives the player the ordinary midpoint city start on generated terrain, fills a 40-member escort roster using the existing unit templates on reachable free cells, issues three normal Leader destination orders at 1, 15 and 30 seconds, then leaves input idle. `--retinue-count=N` changes the requested roster size. It preserves the city's buildings, roads, other factions and landscape. Each report includes the initial escort count, reachable waypoints, one-second position traces through 90 seconds, and motion measurements from 55–90 seconds when the Leader has been stationary for at least two seconds. It also measures the first 0.5–8 seconds after each stop. Combatants are excluded from the quiet measurements; units within eight tiles of the Leader and units still catching up are recorded separately. A separate intermediate motion report is written as soon as 90 seconds have elapsed.

```sh
npm run build:wasm
npm run sim -- world --scenarios=default --seconds=3600 --retinue-motion --retinue-rest-baseline --seed=parity-advanced-1 --out=scratch/retinue-baseline.json
npm run sim -- world --scenarios=default --seconds=3600 --retinue-motion --seed=parity-advanced-1 --out=scratch/retinue-candidate.json
```

The baseline switch substitutes the original exact-slot behavior for the new settling bridge only in the headless bundle. Both runs use the same current engine for other rules. `retinueMotion.windows` records moving-unit time, distance traveled per unit-second, and consecutive movement reversals greater than 120 degrees. These diagnose visible shuffling independently of the world's economy comparison. Check the unit-seconds and near-Leader coverage alongside the motion rate: a company stranded far away should not count as successfully settled.

## Direct policy matches and experiment loops

`match` plays a mirrored round robin between every selected policy pair. Both contestants are ordinary nonhuman factions running production simulation. The observer is neutral, and automatic diplomacy is disabled for combat fixtures so rivals cannot negotiate an early draw. Victory comes from the production simulation's faction-defeated flag; a duration limit produces a draw regardless of remaining HP. Every pair plays both starting sides on the same fixture. The report checks fixture hashes before ranking 3 points per win and 1 per draw.

```sh
npm run build:wasm
npm run sim -- match --policy-file=experiments/2026-11-15/policies.json --policies=expansionist,hard-assault,disciplined,loose-order --scenarios=field-battle,siege-war --seconds=180 --seeds=4 --jobs=2 --out=scratch/round-robin.json
node tools/simulation-harness/experiment.mjs experiments/2026-11-15/experiment.json scratch/ai-experiment
```

`field-battle` starts equal 12-soldier armies and Leaders with no construction funds. `siege-war` supplies equal Keep towns, two gated tower enclosures, housing, farms, developed iron, military research, 1,800 gold, and 40 population per contestant. Armies, construction, damage, upkeep, research gates, retreats, respawns and captures use normal gameplay rules. Seeded placement variation uses the native simulation RNG. These are controlled military scenarios, not self-play on arbitrary generated worlds or a comprehensive economic balance study.

The experiment plan chooses policy names, screening and validation seed families, durations, scenarios and process count. The loop screens all policies, advances every policy at or above the second-place points cutoff, retains the baseline, then runs the finalists on fresh validation seeds. It writes the plan, raw stage reports and a Markdown result summary. Both stages share one frozen game bundle and WASM copy, and the loop checks that its orchestration source files did not change. It never promotes a winner into the live default automatically. Mirrored legs share seeds and are correlated, so match counts should not be described as independent sample counts.

### Iterative parameter and logic search

`npm run ai:search -- experiments/ai-search.json benchmarks/creative-ai-001` evolves parameter settings and native decision programs across generations. See [the search guide](ai-search.md) for budgets, creative proposal files, selection evidence, and `--resume`. Build changed Rust first with `npm run build:wasm`.
