# Faction AI tournament

Run `npm run benchmark:ai`. The harness bundles the authoritative TypeScript game simulation for Node and advances it without a renderer or browser. Options include `--seconds=90`, `--seeds=3`, and `--scenarios=open-battle,fortified-assault,outnumbered-defense`. When using npm, put options after `--`.

The default run compares three policies in 27 deterministic trials: three policies × three scenarios × three seeds. Every policy receives identical initial units, research, resources, terrain, and positions for a given trial. Calls advance 0.2 game seconds; decisive game-over states stop a trial early. Results are written to `benchmarks/faction-ai.json`, including raw unit survival, damage, kills, mission time, formation time, and run configuration.

## Policies

- **Legacy:** Previous garrison allocation and threat thresholds; no automatic Infantry Drill formations or military purchases.
- **Aggressive:** Formation attacks and military purchases, with a lower retreat-health threshold and greater willingness to fight unfavorable groups.
- **Coordinated:** Complete professional armies when town towers can cover the garrison; researched formation attacks that engage intercepting troops before advancing on the city; observed tower and army strength estimates; earlier retreat; reachable attack positions; regrouping and recovery from stuck ranks.

The live coordinated AI also spends earned Leader skill points, purchases affordable equipment and extra retinue capacity through normal building access, develops researched supply depots and sustainable Forts, and raises an affordable defensive levy before returning peasants to their jobs after danger passes. These economic capabilities do not confer free combat stats or ignore research requirements.

## Results, 2026-11-04

The latest 90-second, three-seed run selected **coordinated** as the default:

| Policy | Mean score | Leader survival | Mean enemy kills | Mean surviving retinue |
| --- | ---: | ---: | ---: | ---: |
| Coordinated | 261.33 | 9/9 | 11.44 | 10.44 |
| Aggressive | 238.09 | 9/9 | 10.78 | 7.33 |
| Legacy | 221.18 | 8/9 | 9.00 | 10.44 |

Coordinated scored 18.2% above legacy and preserved more troops than the aggressive policy. Score is explicitly survival-weighted: `100 × Leader alive + surviving retinue HP / 20 + enemy kills × 10 + enemy palace damage / 100`. Raw outcomes remain available so alternative weighting can be reviewed.

The controlled scenarios test open combat, an assault on a defended settlement, and defense against an oversized marauder band. Open-combat and fortified-assault opponents use fixed holding orders; the defensive scenario uses the ordinary marauder AI. These are tactical regression and policy-comparison experiments, not proof of universal superiority across every generated world or a complete long-game economic balance study. Three seeds vary reproducible placement; they do not represent a large statistical sample.

## Starting defenses and navigation

AI factions now start with 1,600 gold (the former 1,500 plus the requested 100), a completed palisade enclosure, and four watchtowers where the map has sufficient room. Walls use a clear rectangle when possible and a closed terrain-following contour around marsh, fords, stairs, and occupied ground otherwise. No passable wall cell is silently omitted. Same-owner road/wall layers provide real gates.

Post-placement checks preserve exterior access and connections between a faction's cities after towers and later enclosures are placed. A generated-world audit covering 30 AI cities found no hostile wall breaches and no blocked friendly exits; synthetic regressions cover marsh, ford, stair, and farm obstructions. Towers retain their ordinary recurring upkeep.

Gate-route finalization runs once after all cities of a faction have been placed, avoiding redundant full-map searches. A bounded seed-42 startup measurement (pre-generated world, one discarded warmup, three measured `createGame` calls) reduced mean initialization from 3,812 ms to 3,225 ms, about 15.4%. The samples vary; this is an indicative local measurement, not a performance guarantee. Raw samples are in `benchmarks/faction-ai-startup.json`.

Relevant tests are `faction-ai-upgrade`, `faction-start-terrain`, `faction-strategy`, `faction-ai-integration`, `faction-development`, and `world-civilizations`. The final targeted run passed 118 of 119 tests; the remaining existing marauder-counts simulation test exceeded its explicit 30-second timeout. City connectivity, terrain preservation, starting grants, formations, and spending assertions passed.
